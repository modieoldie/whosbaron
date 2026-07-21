/**
 * The room is open floor and light — no walls, no ceiling, nothing to orbit
 * into. Fog does the job the back wall used to: the floor fades into the
 * background colour long before its edge, so the space reads as large and
 * unbounded from every angle instead of as a box you are stuck inside.
 *
 * Everything is arranged around ROOM_CENTER_Z, which is the middle of the
 * desk-and-figure ensemble. That is the centre of the room.
 */

import * as THREE from "three";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { HEX } from "./palette";
import { MONITOR_X, SCREEN_H, SCREEN_W, SCREEN_Y, SCREEN_Z } from "./desk";

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

  // Far wider than anything you can orbit to. The fog reaches its full density
  // well inside this radius, so the edge is never on screen.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(48, 48),
    new THREE.MeshStandardMaterial({ color: HEX.floor, roughness: 0.92, metalness: 0.02 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, ROOM_CENTER_Z);
  scene.add(floor);

  // The rug is what gives the open floor a sense of scale now that there are no
  // walls to measure against, so it is sized to frame the desk and the chair.
  const rug = new THREE.Mesh(
    new THREE.PlaneGeometry(4.8, 3.4),
    new THREE.MeshStandardMaterial({ color: HEX.rug, roughness: 1 }),
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.004, ROOM_CENTER_Z);
  scene.add(rug);

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

  // Brass rim from behind the desk — separates the silhouette from the dark.
  const rim = new THREE.PointLight(0xc9a961, 1.6, 5, 2);
  rim.position.set(1.6, 1.95, -1.95);
  scene.add(rim);

  return { key, screenGlow };
}
