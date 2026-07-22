/**
 * Markers for the desk props. Each object stands for something (the framed
 * diploma is school, the books are the stack) and none of that is guessable
 * from a silhouette, so every prop carries a small brass dot above it saying
 * "there is something here". Titles stay on hover: eight of them standing in
 * the room at once collapse into unreadable overlap the moment you orbit off
 * axis, whereas a four-pixel dot has nothing to collide with.
 */

import * as THREE from "three";
import type { Hotspot } from "./types";

/** Metres above the object's bounding box that the dot floats. */
const LIFT = 0.06;
/** Amplitude of the idle drift, in screen pixels. */
const BOB_PX = 2;
/**
 * How far short of the anchor the occlusion ray stops. The prop's own body sits
 * directly under its anchor, and a monitor arm passing a centimetre in front of
 * a dot is not what anyone means by "blocked".
 */
const CLEARANCE = 0.04;
/**
 * Seconds between occlusion sweeps. The dots fade over 260ms anyway, so testing
 * at ~12Hz costs a seventh of the rays and looks identical.
 */
const TEST_INTERVAL = 0.08;

interface Marker {
  id: string;
  anchor: THREE.Vector3;
  el: HTMLElement;
  phase: number;
}

export class PropMarkers {
  private markers: Marker[] = [];
  private projected = new THREE.Vector3();
  private raycaster = new THREE.Raycaster();
  private toAnchor = new THREE.Vector3();
  private lastTest = -Infinity;

  constructor(
    private container: HTMLElement,
    hotspots: Hotspot[],
    private camera: THREE.Camera,
    /** Everything a dot can hide behind; in practice, the whole scene. */
    private occluders: THREE.Object3D[],
    private canvas: HTMLCanvasElement,
    private reducedMotion: boolean,
  ) {
    const box = new THREE.Box3();

    hotspots.forEach((hotspot, i) => {
      box.setFromObject(hotspot.object);
      const anchor = new THREE.Vector3(
        (box.min.x + box.max.x) / 2,
        box.max.y + LIFT,
        (box.min.z + box.max.z) / 2,
      );

      const el = document.createElement("span");
      el.className = "prop-marker";
      container.append(el);

      // Staggered phases: eight dots bobbing in unison would read as a UI
      // animation rather than as things sitting quietly in a room.
      this.markers.push({ id: hotspot.id, anchor, el, phase: i * 1.7 });
    });
  }

  /**
   * @param hoveredId Hotspot currently under the pointer, so its dot can lift.
   * @param visible   False in desk view and mid-flight, where the props are out
   *                  of frame and the dots would just smear across the screen.
   */
  update(elapsed: number, hoveredId: string | null, visible: boolean) {
    this.container.dataset.visible = String(visible);
    if (!visible) return;

    const rect = this.canvas.getBoundingClientRect();
    const sweep = elapsed - this.lastTest >= TEST_INTERVAL;
    if (sweep) this.lastTest = elapsed;

    for (const marker of this.markers) {
      this.projected.copy(marker.anchor).project(this.camera);

      // z > 1 puts the anchor behind the camera, where projection mirrors it to
      // a plausible-looking but wrong spot on screen. Drop the dot instead.
      if (this.projected.z > 1) {
        marker.el.style.display = "none";
        continue;
      }
      marker.el.style.display = "";

      const x = ((this.projected.x + 1) / 2) * rect.width;
      const y = ((-this.projected.y + 1) / 2) * rect.height;
      const bob = this.reducedMotion ? 0 : Math.sin(elapsed * 0.9 + marker.phase) * BOB_PX;

      marker.el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y + bob}px)`;
      marker.el.dataset.active = String(marker.id === hoveredId);

      // A dot floating over the monitor that hides its prop, or over his back,
      // points at nothing. Only worth asking for dots actually in frame.
      if (sweep) {
        const onScreen = Math.abs(this.projected.x) <= 1 && Math.abs(this.projected.y) <= 1;
        marker.el.dataset.occluded = String(onScreen && this.isOccluded(marker.anchor));
      }
    }
  }

  /** True when anything in the scene sits between the camera and the anchor. */
  private isOccluded(anchor: THREE.Vector3): boolean {
    this.toAnchor.subVectors(anchor, this.camera.position);
    const distance = this.toAnchor.length();

    this.raycaster.set(this.camera.position, this.toAnchor.divideScalar(distance));
    this.raycaster.far = distance - CLEARANCE;
    // `far` does the work: anything the ray reaches is, by definition, in front
    // of the dot, so the first hit is enough and the rest never get tested.
    return this.raycaster.intersectObjects(this.occluders, true).length > 0;
  }
}
