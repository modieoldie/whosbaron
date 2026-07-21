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
