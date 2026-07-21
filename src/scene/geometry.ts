/**
 * Shared geometry helpers, all in service of one thing: nothing in this scene
 * should show a facet.
 *
 * Round primitives are built at a segment count high enough that the silhouette
 * still reads as a curve when you orbit right up to it, and boxes get their
 * edges rounded so an edge catches a highlight instead of terminating in a hard
 * black line. Both are cheap — this scene's triangle budget is nowhere near
 * anything a GPU would notice.
 */

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/** Segments around anything cylindrical or spherical. */
export const RADIAL = 48;
/** Segments along the sweep of a sphere or the cap of a capsule. */
export const RINGS = 32;

/**
 * A box with rounded edges. `radius` defaults to a fraction of the shortest
 * side, which softens thin slabs — a desk top, a phone — without inflating them
 * into pills.
 */
export function roundedBox(
  width: number,
  height: number,
  depth: number,
  radius?: number,
): THREE.BufferGeometry {
  const shortest = Math.min(width, height, depth);
  return new RoundedBoxGeometry(width, height, depth, 3, radius ?? shortest * 0.3);
}

/**
 * A capsule stretched between two points. Saves a lot of quaternion math at
 * every call site that needs a limb, a brace, or a monitor arm.
 */
export function strut(
  from: THREE.Vector3Like,
  to: THREE.Vector3Like,
  radius: number,
  material: THREE.Material,
): THREE.Mesh {
  const a = new THREE.Vector3(from.x, from.y, from.z);
  const b = new THREE.Vector3(to.x, to.y, to.z);
  const direction = new THREE.Vector3().subVectors(b, a);
  const length = direction.length();

  const mesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(radius, Math.max(length - radius * 2, 0.001), RINGS / 2, RADIAL),
    material,
  );
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

/* --------------------------------- lofts --------------------------------- */

/**
 * Smooth interpolation through a table of `[position, value]` knots, sorted by
 * position, with a smoothstep between each pair.
 */
export function knots(table: readonly (readonly [number, number])[], t: number): number {
  const first = table[0]!;
  const last = table[table.length - 1]!;
  if (t <= first[0]) return first[1];
  if (t >= last[0]) return last[1];
  for (let i = 1; i < table.length; i++) {
    const a = table[i - 1]!;
    const b = table[i]!;
    if (t <= b[0]) {
      const k = (t - a[0]) / (b[0] - a[0]);
      return a[1] + (b[1] - a[1]) * k * k * (3 - 2 * k);
    }
  }
  return last[1];
}

/** One cross-section: an ellipse of half-axes `rx`/`ry` in the right/up plane. */
export interface LoftRing {
  center: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  rx: number;
  ry: number;
}

/**
 * Skins a stack of cross-sections into one closed, smooth-shaded surface.
 *
 * Rings must be ordered along the form and framed so that `right × up` points
 * the way the stack is going, which is what keeps the triangles facing out. A
 * ring with both radii at zero is a pole and collapses to a single vertex, so
 * a form can be closed off at either end without a visible disc.
 */
export function loft(rings: readonly LoftRing[], radial = RADIAL): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const starts: number[] = [];
  const isPole: boolean[] = [];

  for (const ring of rings) {
    starts.push(positions.length / 3);
    if (ring.rx < 1e-6 && ring.ry < 1e-6) {
      isPole.push(true);
      positions.push(ring.center.x, ring.center.y, ring.center.z);
      continue;
    }
    isPole.push(false);
    for (let i = 0; i < radial; i++) {
      const angle = (i / radial) * Math.PI * 2;
      const c = Math.cos(angle) * ring.rx;
      const s = Math.sin(angle) * ring.ry;
      positions.push(
        ring.center.x + ring.right.x * c + ring.up.x * s,
        ring.center.y + ring.right.y * c + ring.up.y * s,
        ring.center.z + ring.right.z * c + ring.up.z * s,
      );
    }
  }

  for (let r = 0; r < rings.length - 1; r++) {
    const lowPole = isPole[r]!;
    const highPole = isPole[r + 1]!;
    if (lowPole && highPole) continue; // a zero-length segment; nothing to skin
    for (let i = 0; i < radial; i++) {
      const j = (i + 1) % radial;
      const a = starts[r]! + (lowPole ? 0 : i);
      const aNext = starts[r]! + (lowPole ? 0 : j);
      const b = starts[r + 1]! + (highPole ? 0 : i);
      const bNext = starts[r + 1]! + (highPole ? 0 : j);
      if (!lowPole) indices.push(a, aNext, bNext);
      if (!highPole) indices.push(a, bNext, b);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  // The ring seam shares its vertices rather than duplicating them, so averaged
  // normals close all the way round and no shading line runs down the form.
  geometry.computeVertexNormals();
  return geometry;
}

export interface LimbOptions {
  radial?: number;
  /** Stations along the spine. More only matters where the spine curves. */
  segments?: number;
  /** Reference axis for the cross-section frame. Picked automatically if unset. */
  up?: THREE.Vector3;
  capStart?: boolean;
  capEnd?: boolean;
}

/** Rings in each rounded end cap. Six is past the point of seeing the steps. */
const CAP_RINGS = 6;

/**
 * A tapered, smoothly bent form swept along a spine
 *
 * `profile` gives the half-width and half-thickness at each point from 0 at the
 * first spine point to 1 at the last, and the ends close with hemispherical
 * caps rather than flat discs, so two of these overlapping at a joint read as
 * one continuous piece of body instead of two parts meeting.
 */
export function limb(
  spine: readonly THREE.Vector3[],
  profile: (t: number) => readonly [number, number],
  options: LimbOptions = {},
): THREE.BufferGeometry {
  const radial = options.radial ?? RADIAL;
  const segments = options.segments ?? 24;
  const path = new THREE.CatmullRomCurve3(
    spine.map((point) => point.clone()),
    false,
    "centripetal",
  );

  // A fixed reference axis rather than Frenet frames: Frenet twists wherever the
  // spine's curvature flips, which on a nearly straight limb is wherever the
  // rounding noise decides.
  let reference = options.up?.clone();
  if (!reference) {
    const direction = path.getTangent(0.5);
    const axes = [new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)];
    reference = axes.reduce((best, axis) =>
      Math.abs(axis.dot(direction)) < Math.abs(best.dot(direction)) ? axis : best,
    );
  }

  const rings: LoftRing[] = [];
  const frameAt = (t: number) => {
    const tangent = path.getTangent(t).normalize();
    const right = new THREE.Vector3().crossVectors(reference!, tangent).normalize();
    // right × up == tangent, which is the winding `loft` expects.
    const up = new THREE.Vector3().crossVectors(tangent, right).normalize();
    return { center: path.getPoint(t), tangent, right, up };
  };

  /** A hemisphere of rings closing off one end, swept away along `direction`. */
  const cap = (t: number, direction: THREE.Vector3, into: LoftRing[]) => {
    const [rx, ry] = profile(t);
    const reach = (rx + ry) / 2;
    const { center, right, up } = frameAt(t);
    for (let i = CAP_RINGS; i >= 1; i--) {
      const angle = (i / CAP_RINGS) * (Math.PI / 2);
      into.push({
        center: center.clone().addScaledVector(direction, reach * Math.sin(angle)),
        right,
        up,
        rx: rx * Math.cos(angle),
        ry: ry * Math.cos(angle),
      });
    }
  };

  if (options.capStart !== false) {
    const start = frameAt(0);
    cap(0, start.tangent.clone().negate(), rings);
  }

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const [rx, ry] = profile(t);
    const { center, right, up } = frameAt(t);
    rings.push({ center, right, up, rx, ry });
  }

  if (options.capEnd !== false) {
    const end = frameAt(1);
    const tail: LoftRing[] = [];
    cap(1, end.tangent, tail);
    rings.push(...tail.reverse());
  }

  return loft(rings, radial);
}
