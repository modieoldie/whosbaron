/**
 * Pointer plumbing: hover highlighting, click-vs-drag disambiguation, and the
 * UV hit-test that turns "you clicked a polygon" into "you clicked the third
 * project in the list on the left monitor".
 */

import * as THREE from "three";
import { HEX } from "./palette";
import type { Hotspot, HotspotAction } from "./types";
import type { ProjectsScreen, AboutScreen } from "./screens";

const CLICK_SLOP_PX = 6;
const CLICK_MAX_MS = 500;

// A finger is not a mouse: it lands on a moving target, rolls a few pixels while
// it presses, and lifts later than a click does. Holding touches to the mouse
// thresholds throws away taps the visitor meant.
const TOUCH_SLOP_PX = 12;
const TOUCH_MAX_MS = 900;

export interface InteractionCallbacks {
  onAction(action: HotspotAction): void;
  onProjectHover(index: number): void;
  onProjectSelect(index: number): void;
  /** A link on either monitor was clicked. */
  onScreenLink(href: string): void;
}

export class Interaction {
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2(-10, -10);
  private pointerOnScreen = false;

  private downAt = 0;
  private downX = 0;
  private downY = 0;
  private dragged = false;

  /**
   * Whether the last pointer to touch the canvas was a finger. Touch has no
   * hover state at all, no "before the tap", so on touch the whole
   * highlight/label/cursor path is skipped and picking happens at the tap
   * itself. Read per event rather than from a media query: a laptop with a
   * touchscreen is both, depending on which input the visitor just used.
   */
  private touch = false;

  /** Texture-space Y of the last drag sample on the projects pane, or null. */
  private scrollFrom: number | null = null;

  private hotspotRoots: THREE.Object3D[] = [];
  private hovered: Hotspot | null = null;
  private originalEmissive = new WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>();

  /** Set false while the camera is flying, so clicks don't fight the tween. */
  enabled = true;
  /** In desk view the monitors become interactive; in orbit view they don't. */
  screensLive = false;

  /** Id of the hotspot under the pointer, for the prop markers to track. */
  get hoveredId(): string | null {
    return this.hovered?.id ?? null;
  }

  /** True while a drag is scrolling the projects detail pane. */
  get grabbingPane(): boolean {
    return this.scrollFrom !== null;
  }

  /**
   * Abandon the gesture in progress as a click. Used when a second finger
   * lands: a pinch is not a tap, however still the first finger held.
   */
  cancelTap() {
    this.dragged = true;
    this.scrollFrom = null;
  }

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: THREE.Camera,
    private hotspots: Hotspot[],
    private projectsMesh: THREE.Mesh,
    private projectsScreen: ProjectsScreen,
    private aboutMesh: THREE.Mesh,
    private aboutScreen: AboutScreen,
    private label: HTMLElement,
    private callbacks: InteractionCallbacks,
  ) {
    this.hotspotRoots = hotspots.map((h) => h.object);

    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    // Not passive: over the projects pane the wheel drives the panel, not the page.
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
  }

  dispose() {
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
    this.canvas.removeEventListener("wheel", this.onWheel);
  }

  /**
   * Park the raycaster on this event's position. Called from down, move and up
   * rather than move alone: a tap can produce no pointermove whatsoever, and
   * picking against wherever the pointer was last left is how touch ends up
   * hit-testing empty space.
   */
  private trackPointer(event: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.pointerOnScreen = true;
  }

  private onPointerMove = (event: PointerEvent) => {
    this.trackPointer(event);

    const slop = this.touch ? TOUCH_SLOP_PX : CLICK_SLOP_PX;
    if (Math.hypot(event.clientX - this.downX, event.clientY - this.downY) > slop) {
      this.dragged = true;
    }

    // Grab-scroll the detail pane. Sampling in texture space rather than screen
    // pixels means the content tracks the pointer at any camera distance.
    if (this.scrollFrom !== null && event.buttons) {
      const uv = this.projectsUV();
      if (uv && this.projectsScreen.isOverDetail(uv.x, uv.y)) {
        const y = this.projectsScreen.toTextureY(uv.y);
        this.projectsScreen.scrollBy(this.scrollFrom - y);
        this.scrollFrom = y;
      }
    }
  };

  private onPointerDown = (event: PointerEvent) => {
    this.touch = event.pointerType === "touch";
    this.trackPointer(event);
    this.downAt = performance.now();
    this.downX = event.clientX;
    this.downY = event.clientY;
    this.dragged = false;

    const uv = this.enabled && this.screensLive ? this.projectsUV() : null;
    this.scrollFrom =
      uv && this.projectsScreen.isOverDetail(uv.x, uv.y) ? this.projectsScreen.toTextureY(uv.y) : null;
  };

  private onPointerLeave = () => {
    this.pointerOnScreen = false;
    this.scrollFrom = null;
    this.projectsScreen.setHoveredLink(-1);
    this.aboutScreen.setHoveredLink(-1);
    this.clearHover();
    this.label.dataset.visible = "false";
  };

  private onWheel = (event: WheelEvent) => {
    if (!this.enabled || !this.screensLive) return;
    const uv = this.projectsUV();
    if (!uv || !this.projectsScreen.isOverDetail(uv.x, uv.y)) return;

    event.preventDefault();
    // deltaMode 1 is lines, 2 is pages; normalise both to texture pixels.
    const scale = event.deltaMode === 1 ? 30 : event.deltaMode === 2 ? this.projectsScreen.pageScroll : 1;
    this.projectsScreen.scrollBy(event.deltaY * scale);
  };

  /** UV of the pointer on a monitor's glass, or null if it isn't over it. */
  private screenUV(mesh: THREE.Mesh): THREE.Vector2 | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(mesh, false)[0];
    return hit?.uv ?? null;
  }

  private projectsUV(): THREE.Vector2 | null {
    return this.screenUV(this.projectsMesh);
  }

  private aboutUV(): THREE.Vector2 | null {
    return this.screenUV(this.aboutMesh);
  }

  private onPointerUp = (event: PointerEvent) => {
    this.scrollFrom = null;
    if (!this.enabled) return;
    // Pick from where the finger lifted, not from wherever the pointer was last
    // seen; on touch those are the same only by accident.
    this.trackPointer(event);
    // An orbit drag that happens to end on a hotspot is not a click.
    if (this.dragged || performance.now() - this.downAt > (this.touch ? TOUCH_MAX_MS : CLICK_MAX_MS)) {
      return;
    }

    if (this.screensLive) {
      const uv = this.projectsUV();
      if (uv) {
        const link = this.projectsScreen.linkAt(uv.x, uv.y);
        const href = link >= 0 ? this.projectsScreen.linkHref(link) : null;
        if (href) {
          this.callbacks.onScreenLink(href);
          return;
        }
        const row = this.projectsScreen.hitTest(uv.x, uv.y);
        if (row >= 0) {
          this.callbacks.onProjectSelect(row);
          return;
        }
      }

      const aboutUV = this.aboutUV();
      if (aboutUV) {
        const link = this.aboutScreen.linkAt(aboutUV.x, aboutUV.y);
        const href = link >= 0 ? this.aboutScreen.linkHref(link) : null;
        if (href) {
          this.callbacks.onScreenLink(href);
          return;
        }
      }
    }
    // With a mouse the hotspot was already resolved by the hover pass. With a
    // finger there was no hover pass, so resolve it now.
    let hotspot = this.hovered;
    if (this.touch) {
      this.raycaster.setFromCamera(this.pointer, this.camera);
      hotspot = this.pickHotspot().hotspot;
    }
    if (hotspot) this.callbacks.onAction(hotspot.action);
  };

  /**
   * The hotspot under the pointer right now, with the point it was struck at so
   * the label has somewhere to sit. Assumes the raycaster is already aimed.
   */
  private pickHotspot(): { hotspot: Hotspot | null; point: THREE.Vector3 | null } {
    const hit = this.raycaster.intersectObjects(this.hotspotRoots, true)[0];
    const found = hit ? this.findHotspot(hit.object) : null;
    // Him, the desk and the monitors all only mean "take me in". Once you are
    // in, they stop responding entirely rather than offering to fly you
    // somewhere you already are.
    const hotspot = found && this.screensLive && found.action.type === "focus-desk" ? null : found;
    return { hotspot, point: hit?.point ?? null };
  }

  update() {
    if (!this.enabled || !this.pointerOnScreen) return;
    // Nothing in this pass means anything without a hover state: no highlight to
    // pre-light, no label to trail, no cursor to change. Touch picks at the tap.
    if (this.touch) return;

    this.raycaster.setFromCamera(this.pointer, this.camera);

    if (this.screensLive) {
      const uv = this.projectsUV();
      const row = uv ? this.projectsScreen.hitTest(uv.x, uv.y) : -1;
      this.projectsScreen.setHovered(row);
      this.projectsScreen.setHoveredLink(uv ? this.projectsScreen.linkAt(uv.x, uv.y) : -1);
      this.callbacks.onProjectHover(row);

      if (row >= 0) {
        this.clearHover();
        this.canvas.style.cursor = "pointer";
        this.label.dataset.visible = "false";
        return;
      }
      // Over the detail pane: it scrolls, its links open, and "click to pull up
      // to the desk" is meaningless when you are already sitting at it.
      if (uv && this.projectsScreen.isOverDetail(uv.x, uv.y)) {
        this.clearHover();
        this.canvas.style.cursor =
          this.projectsScreen.hoveredLink >= 0
            ? "pointer"
            : this.projectsScreen.maxScroll > 0
              ? "ns-resize"
              : "default";
        this.label.dataset.visible = "false";
        return;
      }

      // The about panel doesn't scroll or select; the only live thing on it is
      // the row of contact links.
      const aboutUV = this.aboutUV();
      this.aboutScreen.setHoveredLink(aboutUV ? this.aboutScreen.linkAt(aboutUV.x, aboutUV.y) : -1);
      if (aboutUV) {
        this.clearHover();
        this.canvas.style.cursor = this.aboutScreen.hoveredLink >= 0 ? "pointer" : "default";
        this.label.dataset.visible = "false";
        return;
      }
    }

    const { hotspot, point } = this.pickHotspot();

    if (hotspot !== this.hovered) {
      this.clearHover();
      if (hotspot) this.applyHover(hotspot);
      this.hovered = hotspot;
    }

    // Orbiting is off at the desk, so the grab cursor would be a lie there.
    this.canvas.style.cursor = hotspot ? "pointer" : this.screensLive ? "default" : "grab";

    if (hotspot && point) {
      this.positionLabel(hotspot.label, point);
    } else {
      this.label.dataset.visible = "false";
    }
  }

  private positionLabel(text: string, worldPoint: THREE.Vector3) {
    const projected = worldPoint.clone().project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    const x = ((projected.x + 1) / 2) * rect.width;
    const y = ((-projected.y + 1) / 2) * rect.height;

    this.label.textContent = text;
    this.label.style.transform = `translate(-50%, -140%) translate(${x}px, ${y}px)`;
    this.label.dataset.visible = "true";
  }

  /** Walk up from the hit mesh until we reach a registered hotspot root. */
  private findHotspot(object: THREE.Object3D): Hotspot | null {
    let node: THREE.Object3D | null = object;
    while (node) {
      const match = this.hotspots.find((h) => h.object === node);
      if (match) return match;
      node = node.parent;
    }
    return null;
  }

  private applyHover(hotspot: Hotspot) {
    const targets = hotspot.highlight ?? this.collectMeshes(hotspot.object);
    for (const mesh of targets) {
      if (!this.originalEmissive.has(mesh)) {
        this.originalEmissive.set(mesh, mesh.material);
        // Clone first: these materials are shared, and lighting up every hoodie
        // in the scene because you grazed a sleeve is a bad look.
        mesh.material = Array.isArray(mesh.material)
          ? mesh.material.map((m) => m.clone())
          : mesh.material.clone();
      }
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if ("emissive" in material) {
          (material as THREE.MeshStandardMaterial).emissive.setHex(HEX.brass);
          (material as THREE.MeshStandardMaterial).emissiveIntensity = 0.34;
        }
      }
    }
  }

  private clearHover() {
    if (!this.hovered) return;
    const targets = this.hovered.highlight ?? this.collectMeshes(this.hovered.object);
    for (const mesh of targets) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if ("emissive" in material) {
          (material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
        }
      }
    }
    this.hovered = null;
  }

  private collectMeshes(root: THREE.Object3D): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    root.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh);
    });
    return meshes;
  }
}
