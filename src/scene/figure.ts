/**
 * The seated figure.
 *
 * Built entirely from primitives — capsules, spheres, boxes — because a rigged
 * humanoid GLB that actually looks like a specific person is a modelling
 * project, not a coding one. Stylised-and-deliberate beats realistic-and-off:
 * the read here is "low-poly character", which the eye forgives completely.
 *
 * Low-poly in shape only, though: every primitive is tessellated finely enough
 * that no facet shows on the silhouette when the camera swings past.
 *
 * The figure is authored facing -Z (toward the desk), so the default camera
 * behind it gets the over-the-shoulder shot for free.
 */

import * as THREE from "three";
import { HEX } from "./palette";
import { RADIAL, RINGS, roundedBox, strut } from "./geometry";

export interface FigureRig {
  group: THREE.Group;
  meshes: THREE.Mesh[];
  update(elapsed: number): void;
  /**
   * Fade the whole figure, 1 solid to 0 gone. He is the subject of the orbit
   * view and an obstruction at the desk — you pull up to the monitors and he is
   * sitting between you and them — so the flight in dissolves him.
   */
  setOpacity(amount: number): void;
}

export function buildFigure(): FigureRig {
  const group = new THREE.Group();
  const meshes: THREE.Mesh[] = [];
  const track = <T extends THREE.Mesh>(mesh: T): T => {
    meshes.push(mesh);
    return mesh;
  };

  const hoodie = new THREE.MeshStandardMaterial({ color: HEX.hoodie, roughness: 0.95 });
  const hoodieDark = new THREE.MeshStandardMaterial({ color: HEX.hoodieDark, roughness: 0.95 });
  const denim = new THREE.MeshStandardMaterial({ color: HEX.denim, roughness: 0.92 });
  const skin = new THREE.MeshStandardMaterial({ color: HEX.skin, roughness: 0.72 });
  const hair = new THREE.MeshStandardMaterial({ color: HEX.hair, roughness: 0.82 });
  const sneaker = new THREE.MeshStandardMaterial({ color: HEX.sneaker, roughness: 0.6 });
  const sole = new THREE.MeshStandardMaterial({ color: HEX.sole, roughness: 0.75 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.4 });

  /* ----------------------------- core ----------------------------- */

  const pelvis = track(new THREE.Mesh(roundedBox(0.32, 0.17, 0.28, 0.05), denim));
  pelvis.position.set(0, 0.5, 0.02);
  group.add(pelvis);

  // Torso pivots at the hips so the breathing scale doesn't detach the head.
  const torso = new THREE.Group();
  torso.position.set(0, 0.56, 0.01);
  torso.rotation.x = -0.13; // slight forward lean, the universal posture of a desk
  group.add(torso);

  const chest = track(
    new THREE.Mesh(new THREE.CapsuleGeometry(0.155, 0.2, RINGS / 2, RADIAL), hoodie),
  );
  chest.position.set(0, 0.21, 0);
  chest.scale.set(1, 1, 0.82);
  torso.add(chest);

  // Hood, bunched at the back of the neck.
  const hood = track(new THREE.Mesh(new THREE.SphereGeometry(0.115, RADIAL, RINGS), hoodieDark));
  hood.position.set(0, 0.36, 0.1);
  hood.scale.set(1.15, 0.72, 0.85);
  torso.add(hood);

  for (const side of [-1, 1]) {
    const string = new THREE.Mesh(
      new THREE.CylinderGeometry(0.005, 0.005, 0.13, RADIAL / 2),
      new THREE.MeshStandardMaterial({ color: HEX.brass, roughness: 0.6, metalness: 0.2 }),
    );
    string.position.set(side * 0.05, 0.29, -0.12);
    torso.add(string);
  }

  const neck = track(
    new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.055, 0.08, RADIAL), skin),
  );
  neck.position.set(0, 0.4, -0.01);
  torso.add(neck);

  /* ----------------------------- head ----------------------------- */

  const head = new THREE.Group();
  head.position.set(0, 0.46, -0.025);
  torso.add(head);

  const skull = track(new THREE.Mesh(new THREE.SphereGeometry(0.113, RADIAL, RINGS), skin));
  skull.scale.set(1, 1.1, 1.04);
  head.add(skull);

  // Hair as a cap plus a back mass — reads correctly from every orbit angle.
  const hairCap = track(
    new THREE.Mesh(
      new THREE.SphereGeometry(0.12, RADIAL, RINGS, 0, Math.PI * 2, 0, Math.PI * 0.58),
      hair,
    ),
  );
  hairCap.scale.set(1, 1.12, 1.06);
  hairCap.position.y = 0.004;
  head.add(hairCap);

  const hairBack = track(new THREE.Mesh(new THREE.SphereGeometry(0.1, RADIAL, RINGS), hair));
  hairBack.position.set(0, 0.01, 0.045);
  hairBack.scale.set(1.02, 1.0, 0.7);
  head.add(hairBack);

  const earGeometry = new THREE.SphereGeometry(0.024, RADIAL / 2, RINGS / 2);
  const eyeGeometry = new THREE.SphereGeometry(0.0125, RADIAL / 2, RINGS / 2);
  for (const side of [-1, 1]) {
    const ear = track(new THREE.Mesh(earGeometry, skin));
    ear.position.set(side * 0.108, -0.005, 0.005);
    ear.scale.set(0.5, 1, 0.75);
    head.add(ear);

    // Two dots and nothing else. Any more detail and it lands in the valley.
    const eye = new THREE.Mesh(eyeGeometry, dark);
    eye.position.set(side * 0.042, 0.012, -0.1);
    eye.scale.set(1, 1.15, 0.6);
    head.add(eye);
  }

  /* ----------------------------- arms ----------------------------- */

  const elbows: THREE.Group[] = [];

  // Hand positions are tuned so that, after the torso's forward lean and the
  // group's yaw, the wrists land on the keyboard and mouse in world space.
  const armSpecs = [
    { side: -1, shoulder: [-0.185, 0.34, -0.01], elbow: [-0.24, 0.15, -0.19], hand: [-0.16, 0.32, -0.7] },
    { side: 1, shoulder: [0.185, 0.34, -0.01], elbow: [0.255, 0.15, -0.18], hand: [0.36, 0.32, -0.7] },
  ] as const;

  for (const spec of armSpecs) {
    const shoulder = new THREE.Vector3(...spec.shoulder);
    const elbow = new THREE.Vector3(...spec.elbow);
    const hand = new THREE.Vector3(...spec.hand);

    const cap = track(new THREE.Mesh(new THREE.SphereGeometry(0.078, RADIAL, RINGS), hoodie));
    cap.position.copy(shoulder);
    torso.add(cap);

    torso.add(track(strut(shoulder, elbow, 0.062, hoodie)));

    // Forearm + hand hang off a pivot at the elbow so they can be animated.
    const elbowGroup = new THREE.Group();
    elbowGroup.position.copy(elbow);
    torso.add(elbowGroup);
    elbows.push(elbowGroup);

    const localHand = new THREE.Vector3().subVectors(hand, elbow);
    elbowGroup.add(track(strut(new THREE.Vector3(0, 0, 0), localHand, 0.052, hoodie)));

    const wrist = track(new THREE.Mesh(new THREE.SphereGeometry(0.042, RADIAL, RINGS), skin));
    wrist.position.copy(localHand);
    wrist.scale.set(0.95, 0.72, 1.25);
    elbowGroup.add(wrist);
  }

  /* ----------------------------- legs ----------------------------- */

  for (const side of [-1, 1]) {
    const hip = new THREE.Vector3(side * 0.115, 0.48, -0.02);
    const knee = new THREE.Vector3(side * 0.14, 0.45, -0.34);
    const ankle = new THREE.Vector3(side * 0.148, 0.1, -0.38);

    group.add(track(strut(hip, knee, 0.088, denim)));
    group.add(track(strut(knee, ankle, 0.062, denim)));

    const shoe = track(new THREE.Mesh(roundedBox(0.105, 0.075, 0.235, 0.03), sneaker));
    shoe.position.set(side * 0.148, 0.06, -0.45);
    group.add(shoe);

    const shoeSole = track(new THREE.Mesh(roundedBox(0.112, 0.022, 0.245, 0.01), sole));
    shoeSole.position.set(side * 0.148, 0.018, -0.452);
    group.add(shoeSole);
  }

  /* --------------------------- animation --------------------------- */

  const restLean = torso.rotation.x;
  let nextTwitch = 3;

  // Every material here was created in this function, so fading them is safe —
  // nothing else in the room shares one. Collected from the graph rather than
  // from `meshes` so the odds and ends that aren't tracked as hover targets —
  // the eyes, the hood strings — fade with the rest of him.
  const materials = new Set<THREE.Material>();
  group.traverse((child) => {
    const material = (child as THREE.Mesh).material;
    if (!material) return;
    for (const entry of Array.isArray(material) ? material : [material]) materials.add(entry);
  });

  return {
    group,
    meshes,
    setOpacity(amount: number) {
      // Below a pixel's worth of alpha he is off entirely, which also takes him
      // out of the raycaster — no invisible hotspot left floating at the desk.
      group.visible = amount > 0.004;
      for (const material of materials) {
        material.transparent = amount < 1;
        material.opacity = amount;
        // Depth writes stay on: this is a solid body dissolving uniformly, and
        // leaving them on keeps his own far side from showing through his front.
      }
    },
    update(elapsed: number) {
      // Breathing: a slow chest scale plus a matching micro-lean.
      const breath = Math.sin(elapsed * 1.15);
      chest.scale.y = 1 + breath * 0.016;
      chest.scale.z = 0.82 + breath * 0.008;
      torso.rotation.x = restLean + breath * 0.006;

      // Idle head drift. Two detuned sines never resolve into a visible loop.
      head.rotation.y = Math.sin(elapsed * 0.23) * 0.07 + Math.sin(elapsed * 0.61) * 0.02;
      head.rotation.x = Math.sin(elapsed * 0.31) * 0.035;

      // Left hand types in bursts; right hand nudges the mouse occasionally.
      const typing = Math.max(0, Math.sin(elapsed * 0.42));
      elbows[0]!.rotation.x = Math.sin(elapsed * 11) * 0.02 * typing;

      if (elapsed > nextTwitch) {
        nextTwitch = elapsed + 2.5 + Math.random() * 5;
      }
      const sinceTwitch = elapsed - (nextTwitch - 2.5);
      const twitch = sinceTwitch > 0 && sinceTwitch < 0.5 ? Math.sin(sinceTwitch * Math.PI * 2) : 0;
      elbows[1]!.rotation.x = twitch * 0.03;
      elbows[1]!.rotation.y = twitch * 0.05;
    },
  };
}
