/**
 * The room is open floor and light: no walls, no ceiling, nothing to orbit
 * into. Fog does the job the back wall used to, fading the floor into the
 * background colour long before its edge so the space reads as unbounded.
 *
 * Everything is arranged around ROOM_CENTER_Z, which is the middle of the
 * desk-and-figure ensemble. That is the centre of the room.
 */

import * as THREE from "three";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { HEX } from "./palette";
import { MONITOR_X, SCREEN_H, SCREEN_W, SCREEN_Y, SCREEN_Z } from "./desk";
import { PIT } from "./lounge";

/**
 * The desk sits at the back of the ensemble and the chair at the front; this is
 * the midpoint between them. The floor, the rug and both camera views are all
 * centred here so the composition sits dead centre in the room.
 */
export const ROOM_CENTER_Z = -0.72;

export interface RoomLights {
  key: THREE.DirectionalLight;
  screenGlow: THREE.RectAreaLight[];
}

export function buildRoom(scene: THREE.Scene): RoomLights {
  RectAreaLightUniformsLib.init();

  scene.background = new THREE.Color(HEX.ink);
  scene.fog = new THREE.Fog(HEX.ink, 7.5, 18);

  /* ---------------------------- surfaces ---------------------------- */

  // Far wider than anything you can orbit to, with a rectangular bite taken out
  // for the conversation pit: the pit's seating and footwell live below this
  // plane, so the plane has to open up over them or it would roof them over.
  // The fog reaches full density well inside the outer edge, so that edge is
  // never on screen.
  const floorShape = new THREE.Shape();
  floorShape.moveTo(-24, -24);
  floorShape.lineTo(24, -24);
  floorShape.lineTo(24, 24);
  floorShape.lineTo(-24, 24);
  floorShape.closePath();

  // Shape space is X/Y; once the mesh is laid flat by the -90° X rotation, its
  // Y axis maps to world -Z, which is why the hole's depth is negated here.
  const hole = new THREE.Path();
  const hw = PIT.width / 2;
  const hd = PIT.depth / 2;
  hole.moveTo(PIT.x - hw, -PIT.z - hd);
  hole.lineTo(PIT.x + hw, -PIT.z - hd);
  hole.lineTo(PIT.x + hw, -PIT.z + hd);
  hole.lineTo(PIT.x - hw, -PIT.z + hd);
  hole.closePath();
  floorShape.holes.push(hole);

  const floor = new THREE.Mesh(
    new THREE.ShapeGeometry(floorShape),
    new THREE.MeshStandardMaterial({ color: HEX.floor, roughness: 0.92, metalness: 0.02 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // The rug that gives the open floor a sense of scale is the patterned slab
  // built in `lounge.ts`, laid under the desk and chair from there.

  /* ----------------------------- lights ----------------------------- */

  scene.add(new THREE.AmbientLight(0x3d434f, 0.6));
  scene.add(new THREE.HemisphereLight(0x2c3240, 0x0c0c0e, 0.65));

  const key = new THREE.DirectionalLight(0xfff1dc, 1.05);
  key.position.set(3.4, 4.2, 2.6);
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x8fa8c4, 0.32);
  fill.position.set(-3.2, 2.4, 1.8);
  scene.add(fill);

  // The money light: the monitors throwing cold light onto the desk and figure.
  // A RectAreaLight's intensity is per unit area, so the bigger panels get a
  // lower number to land on roughly the same amount of spill as before.
  const screenGlow = [-MONITOR_X, MONITOR_X].map((x) => {
    const light = new THREE.RectAreaLight(0xa9c8ec, 2.3, SCREEN_W, SCREEN_H);
    light.position.set(x, SCREEN_Y, SCREEN_Z + 0.02);
    light.lookAt(x * 0.4, 1.0, 1.5);
    scene.add(light);
    return light;
  });

  // Warm counterweight to the screens, standing in for the bounce the walls
  // used to provide. Without it the open floor reads flat and uniformly blue.
  const warmFill = new THREE.PointLight(0xffb367, 1.9, 5.5, 2);
  warmFill.position.set(-1.7, 1.5, -0.5);
  scene.add(warmFill);

  // Brass rim from behind the desk, separating the silhouette from the dark.
  const rim = new THREE.PointLight(0xc9a961, 1.6, 5, 2);
  rim.position.set(1.6, 1.95, -1.95);
  scene.add(rim);

  return { key, screenGlow };
}
