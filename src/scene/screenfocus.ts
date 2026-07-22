/**
 * The portrait-phone reading view.
 *
 * The desk view frames both monitors at once, which works down to about a 5:4
 * window and then stops: a phone held upright would have to sit seven metres
 * back to fit 2.4m of desk across 390 points of width, and at that range the
 * panels are thumbnails. So on a narrow touch screen the camera goes to one
 * panel at a time, square on, filling the frame, and pinch and drag let the
 * visitor lean in on the text the way a desktop visitor already can by sitting
 * closer to a large display.
 *
 * Nothing here runs for a mouse. Every listener drops any pointer that isn't a
 * finger, and `active` is only ever set by the narrow-viewport branch.
 */

import * as THREE from "three";
import { SCREEN_W, SCREEN_H } from "./desk";

/** Breathing room around the panel at zoom 1, in metres. */
const MARGIN = 0.05;
/**
 * How far in a pinch may go. At 1 the panel spans the viewport width; the
 * 1024px-wide texture is then squeezed into ~390 points and the 15px body text
 * lands under 6. Four gets that past a comfortable reading size on a phone,
 * which is the whole reason this view exists.
 */
const MAX_ZOOM = 4;

export interface ScreenFocusHooks {
  /**
   * True while a finger is already grab-scrolling the projects detail pane.
   * That gesture owns the finger; panning the camera under it as well would
   * move the text twice.
   */
  paneGrabbed(): boolean;
  /** Turn the in-flight gesture into a non-tap, so a pinch can't select a row. */
  cancelTap(): void;
}

/** A panel's own axes in world space. The monitors are toed in, so this is per-screen. */
interface Frame {
  center: THREE.Vector3;
  normal: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
}

export class ScreenFocus {
  /** Where the camera should sit and look. Recomputed by `update()`. */
  readonly view = { position: new THREE.Vector3(), target: new THREE.Vector3() };

  private frames: Frame[];
  private index = 0;
  private zoom = 1;
  private pan = new THREE.Vector2();

  /** Only true while the camera is actually in this view. */
  active = false;

  /** Live touches on the canvas, by pointerId. */
  private touches = new Map<number, { x: number; y: number }>();
  private pinchFrom = 0;
  private zoomFrom = 1;
  /** Where the pinch was centred at the last sample, in normalised screen space. */
  private pinchMid = new THREE.Vector2();

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: THREE.PerspectiveCamera,
    meshes: THREE.Mesh[],
    private hooks: ScreenFocusHooks,
  ) {
    // World transforms have to be settled before they can be read off.
    for (const mesh of meshes) mesh.updateWorldMatrix(true, false);

    this.frames = meshes.map((mesh) => {
      const q = mesh.getWorldQuaternion(new THREE.Quaternion());
      return {
        center: mesh.getWorldPosition(new THREE.Vector3()),
        normal: new THREE.Vector3(0, 0, 1).applyQuaternion(q),
        right: new THREE.Vector3(1, 0, 0).applyQuaternion(q),
        up: new THREE.Vector3(0, 1, 0).applyQuaternion(q),
      };
    });

    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onUp);

    this.update();
  }

  dispose() {
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("pointermove", this.onMove);
    this.canvas.removeEventListener("pointerup", this.onUp);
    this.canvas.removeEventListener("pointercancel", this.onUp);
  }

  get screen(): number {
    return this.index;
  }

  /** Point at a panel, from the top: a new screen is a new page, not a new crop. */
  focus(index: number) {
    this.index = THREE.MathUtils.clamp(index, 0, this.frames.length - 1);
    this.zoom = 1;
    this.pan.set(0, 0);
    this.update();
  }

  /* ---------------------------- framing ---------------------------- */

  private halfFov() {
    return THREE.MathUtils.degToRad(this.camera.fov / 2);
  }

  /** Distance at which the whole panel just fits the frame. */
  private fitDistance() {
    const t = Math.tan(this.halfFov());
    return Math.max((SCREEN_H / 2 + MARGIN) / t, (SCREEN_W / 2 + MARGIN) / (t * this.camera.aspect));
  }

  /**
   * Half the panel area visible at the current zoom, in metres. Half-extents
   * rather than full ones because normalised screen coordinates run -1..1, so
   * this is the number a coordinate multiplies by to become a distance.
   */
  private extents(): { w: number; h: number } {
    const h = Math.tan(this.halfFov()) * (this.fitDistance() / this.zoom);
    return { w: h * this.camera.aspect, h };
  }

  /** A client point in normalised screen space: -1..1, y up. */
  private normalised(x: number, y: number, out: THREE.Vector2): THREE.Vector2 {
    const rect = this.canvas.getBoundingClientRect();
    return out.set(
      ((x - rect.left) / rect.width) * 2 - 1,
      -(((y - rect.top) / rect.height) * 2 - 1),
    );
  }

  /** Midpoint of the first two live touches, normalised. */
  private midpoint(out: THREE.Vector2): THREE.Vector2 {
    const [a, b] = [...this.touches.values()];
    if (!a || !b) return out.set(0, 0);
    return this.normalised((a.x + b.x) / 2, (a.y + b.y) / 2, out);
  }

  /**
   * Recompute the camera placement from the current zoom and pan. Cheap enough
   * to run every frame, which is what keeps the view correct through a pinch,
   * a device rotation, and the flight in, all of which change the answer.
   */
  update() {
    const frame = this.frames[this.index]!;
    const distance = this.fitDistance() / this.zoom;

    // Half the panel area the camera can see from here.
    const halfH = Math.tan(this.halfFov()) * distance;
    const halfW = halfH * this.camera.aspect;

    // Zoomed out there is nothing to pan to, so the limits collapse to zero and
    // the panel stays centred however hard the visitor drags.
    const limitX = Math.max(0, SCREEN_W / 2 - halfW);
    const limitY = Math.max(0, SCREEN_H / 2 - halfH);
    this.pan.x = THREE.MathUtils.clamp(this.pan.x, -limitX, limitX);
    this.pan.y = THREE.MathUtils.clamp(this.pan.y, -limitY, limitY);

    this.view.target
      .copy(frame.center)
      .addScaledVector(frame.right, this.pan.x)
      .addScaledVector(frame.up, this.pan.y);
    this.view.position.copy(this.view.target).addScaledVector(frame.normal, distance);
  }

  /* ---------------------------- gestures --------------------------- */

  private onDown = (event: PointerEvent) => {
    if (event.pointerType !== "touch") return;
    this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!this.active) return;

    if (this.touches.size === 2) {
      this.pinchFrom = this.spread();
      this.zoomFrom = this.zoom;
      this.midpoint(this.pinchMid);
      // Two fingers are never a tap, and the second one landing would otherwise
      // read as one the moment it lifts.
      this.hooks.cancelTap();
    }
  };

  private onMove = (event: PointerEvent) => {
    if (event.pointerType !== "touch") return;
    const previous = this.touches.get(event.pointerId);
    if (!previous) return;

    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    previous.x = event.clientX;
    previous.y = event.clientY;

    if (!this.active) return;

    if (this.touches.size >= 2) {
      if (this.pinchFrom > 0) {
        // Zoom about the point between the fingers rather than the middle of
        // the frame. Whatever is under the pinch stays under it, so the visitor
        // magnifies the corner of the panel they are actually reading instead
        // of driving into the centre and panning back out to find it.
        //
        // Held as "the panel point beneath the old midpoint must end up beneath
        // the new one", which folds the anchoring and a two-finger drag into
        // the same correction, so a pinch that slides also carries the view.
        const before = this.extents();
        const from = this.pinchMid.clone();

        this.zoom = THREE.MathUtils.clamp(
          (this.zoomFrom * this.spread()) / this.pinchFrom,
          1,
          MAX_ZOOM,
        );

        const after = this.extents();
        const to = this.midpoint(this.pinchMid);
        this.pan.x += from.x * before.w - to.x * after.w;
        this.pan.y += from.y * before.h - to.y * after.h;

        this.update();
      }
      return;
    }

    // One finger pans, but only once there is somewhere to pan to, and never
    // while the detail pane has claimed the gesture.
    if (this.hooks.paneGrabbed()) return;

    const distance = this.fitDistance() / this.zoom;
    // Viewport height in metres at the panel, over its height in points: drag a
    // finger an inch and the text under it travels the same inch.
    const perPixel = (2 * Math.tan(this.halfFov()) * distance) / this.canvas.clientHeight;
    this.pan.x -= dx * perPixel;
    this.pan.y += dy * perPixel;
    this.update();
  };

  private onUp = (event: PointerEvent) => {
    this.touches.delete(event.pointerId);
    // Lifting a finger changes which pair `spread()` measures, so the pinch is
    // re-anchored against what is left rather than jumping to a scale derived
    // from fingers that are no longer on the glass.
    if (this.touches.size >= 2) {
      this.pinchFrom = this.spread();
      this.zoomFrom = this.zoom;
      this.midpoint(this.pinchMid);
    } else {
      this.pinchFrom = 0;
    }
  };

  /** Distance between the first two live touches, in points. */
  private spread(): number {
    const [a, b] = [...this.touches.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
}
