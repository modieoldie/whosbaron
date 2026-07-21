/**
 * The white desk, the two monitors on their arms, the tower, and the chair.
 *
 * Screen surfaces use MeshBasicMaterial with `toneMapped = false` — a monitor
 * emits light, it does not receive it, and running it through the tone mapper
 * is what makes most 3D screens look like printed stickers.
 */

import * as THREE from "three";
import { HEX } from "./palette";
import { RADIAL, RINGS, roundedBox, strut } from "./geometry";
import type { ProjectsScreen, AboutScreen } from "./screens";

export const DESK_TOP_Y = 0.74;
export const DESK_CENTER_Z = -1.1;
export const DESK_DEPTH = 0.92;
export const DESK_THICKNESS = 0.038;
/** Rear edge of the desk top. The monitor arms clamp onto it. */
export const DESK_BACK_Z = DESK_CENTER_Z - DESK_DEPTH / 2;

// 16:10, which is the 1024×640 canvas the screens paint into, exactly.
// These are 34"-class panels: the monitors are the content of this scene, so
// they run right out to the edges of the desk rather than sitting politely on
// it. Inner edges land at x ≈ ±0.06 and outer at ±0.99 against a 2.12 desk.
export const SCREEN_W = 0.93;
export const SCREEN_H = 0.581;
export const SCREEN_Y = 1.2;
export const SCREEN_Z = -1.42;
/** How far either monitor sits from the desk's centre line. */
export const MONITOR_X = 0.525;
export const TOE_IN = 0.2;

export interface DeskRig {
  group: THREE.Group;
  projectsScreen: THREE.Mesh;
  aboutScreen: THREE.Mesh;
  deskTop: THREE.Mesh;
  chair: THREE.Group;
}

export function buildDesk(
  scene: THREE.Scene,
  screens: { projects: ProjectsScreen; about: AboutScreen },
): DeskRig {
  const group = new THREE.Group();
  scene.add(group);

  const white = new THREE.MeshStandardMaterial({
    color: HEX.deskTop,
    roughness: 0.42,
    metalness: 0.02,
  });
  const legMaterial = new THREE.MeshStandardMaterial({
    color: HEX.deskLeg,
    roughness: 0.35,
    metalness: 0.15,
  });
  const shellMaterial = new THREE.MeshStandardMaterial({
    color: HEX.monitorShell,
    roughness: 0.55,
    metalness: 0.25,
  });
  const armMaterial = new THREE.MeshStandardMaterial({
    color: HEX.monitorStand,
    roughness: 0.42,
    metalness: 0.45,
  });

  /* ------------------------------ desk ------------------------------ */

  const deskTop = new THREE.Mesh(roundedBox(2.12, DESK_THICKNESS, DESK_DEPTH, 0.012), white);
  deskTop.position.set(0, DESK_TOP_Y - DESK_THICKNESS / 2, DESK_CENTER_Z);
  group.add(deskTop);

  const legGeometry = roundedBox(0.045, DESK_TOP_Y - DESK_THICKNESS, 0.045, 0.008);
  for (const [x, z] of [
    [-0.98, -0.72],
    [0.98, -0.72],
    [-0.98, -1.48],
    [0.98, -1.48],
  ] as const) {
    const leg = new THREE.Mesh(legGeometry, legMaterial);
    leg.position.set(x, (DESK_TOP_Y - DESK_THICKNESS) / 2, z);
    group.add(leg);
  }

  // Cross-brace between the back legs. Reads as furniture rather than a slab.
  const brace = new THREE.Mesh(roundedBox(1.96, 0.03, 0.03, 0.008), legMaterial);
  brace.position.set(0, 0.16, -1.48);
  group.add(brace);

  /* ---------------------------- monitors ---------------------------- */

  // Where the desk's rear edge falls inside a monitor group's local space.
  const deskEdgeZ = DESK_BACK_Z - SCREEN_Z;

  const makeMonitor = (x: number, rotationY: number, texture: THREE.Texture) => {
    const monitor = new THREE.Group();
    monitor.position.set(x, 0, SCREEN_Z);
    monitor.rotation.y = rotationY;

    const shell = new THREE.Mesh(
      roundedBox(SCREEN_W + 0.026, SCREEN_H + 0.04, 0.026, 0.009),
      shellMaterial,
    );
    shell.position.set(0, SCREEN_Y - 0.007, -0.015);
    monitor.add(shell);

    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(SCREEN_W, SCREEN_H),
      new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
    );
    screen.position.set(0, SCREEN_Y, 0.0015);
    monitor.add(screen);

    // No brand dot on the chin: a small brass circle floating over the desk is
    // now the room's word for "this is a hotspot", and one baked into the bezel
    // reads as a marker you can't click.

    /* --------------------------- the arm --------------------------- */

    // A C-clamp on the desk's rear edge, a post, and a strut out to the VESA
    // plate. The rig is parented to the monitor group so the arm follows the
    // panel instead of pointing at it sideways — but the clamp itself is
    // counter-rotated back to square, because a real one grips the desk edge
    // flush and lets the arm absorb the toe-in.
    const spineZ = deskEdgeZ - 0.014;

    const clamp = new THREE.Group();
    clamp.position.set(0, 0, spineZ);
    clamp.rotation.y = -rotationY;
    monitor.add(clamp);

    const jaw = roundedBox(0.082, 0.014, 0.08, 0.005);
    const jawZ = 0.049; // forward of the spine, onto the desk

    const topPad = new THREE.Mesh(jaw, armMaterial);
    topPad.position.set(0, DESK_TOP_Y + 0.007, jawZ);
    clamp.add(topPad);

    const bottomPad = new THREE.Mesh(jaw, armMaterial);
    bottomPad.position.set(0, DESK_TOP_Y - DESK_THICKNESS - 0.007, jawZ);
    clamp.add(bottomPad);

    const spine = new THREE.Mesh(roundedBox(0.05, 0.09, 0.022, 0.008), armMaterial);
    spine.position.set(0, DESK_TOP_Y - 0.019, 0);
    clamp.add(spine);

    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.017, 0.019, 0.6, RADIAL),
      armMaterial,
    );
    post.position.set(0, DESK_TOP_Y + 0.3, spineZ);
    monitor.add(post);

    const shoulder = new THREE.Vector3(0, DESK_TOP_Y + 0.585, spineZ);
    const mount = new THREE.Vector3(0, SCREEN_Y, -0.05);
    monitor.add(strut(shoulder, mount, 0.015, armMaterial));

    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.026, RADIAL, RINGS), armMaterial);
    elbow.position.copy(shoulder);
    monitor.add(elbow);

    const vesa = new THREE.Mesh(roundedBox(0.1, 0.1, 0.016, 0.006), armMaterial);
    vesa.position.set(0, SCREEN_Y, -0.038);
    monitor.add(vesa);

    group.add(monitor);
    return screen;
  };

  const projectsScreen = makeMonitor(-MONITOR_X, TOE_IN, screens.projects.texture);
  const aboutScreen = makeMonitor(MONITOR_X, -TOE_IN, screens.about.texture);

  /* ------------------------ keyboard & mouse ------------------------ */

  const keyboardBody = new THREE.Mesh(
    roundedBox(0.42, 0.016, 0.135, 0.006),
    new THREE.MeshStandardMaterial({ color: HEX.keyboard, roughness: 0.42, metalness: 0.25 }),
  );
  keyboardBody.position.set(-0.02, DESK_TOP_Y + 0.008, -0.86);
  keyboardBody.rotation.y = 0.03;
  group.add(keyboardBody);

  // 70 keycaps as one InstancedMesh — the detail is free, the draw call is one.
  const COLS = 14;
  const ROWS = 5;
  const keycaps = new THREE.InstancedMesh(
    roundedBox(0.021, 0.005, 0.019, 0.0014),
    new THREE.MeshStandardMaterial({ color: HEX.keycap, roughness: 0.7 }),
    COLS * ROWS,
  );
  const dummy = new THREE.Object3D();
  let i = 0;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      dummy.position.set(-0.195 + col * 0.028, 0.011, -0.048 + row * 0.024);
      dummy.updateMatrix();
      keycaps.setMatrixAt(i++, dummy.matrix);
    }
  }
  keycaps.instanceMatrix.needsUpdate = true;
  keyboardBody.add(keycaps);

  const mouse = new THREE.Mesh(
    new THREE.SphereGeometry(0.032, RADIAL, RINGS),
    new THREE.MeshStandardMaterial({ color: HEX.keyboard, roughness: 0.45 }),
  );
  mouse.scale.set(0.72, 0.5, 1.1);
  mouse.position.set(0.32, DESK_TOP_Y + 0.014, -0.85);
  group.add(mouse);

  /* ------------------------------ tower ----------------------------- */

  const tower = new THREE.Mesh(
    roundedBox(0.2, 0.44, 0.44, 0.014),
    new THREE.MeshStandardMaterial({ color: HEX.tower, roughness: 0.4, metalness: 0.35 }),
  );
  tower.position.set(1.3, 0.22, -1.32);
  group.add(tower);

  // Tempered-glass side panel with a brass glow inside — every build has one.
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(0.4, 0.4),
    new THREE.MeshStandardMaterial({
      color: 0x2a2418,
      roughness: 0.1,
      metalness: 0.6,
      transparent: true,
      opacity: 0.55,
      emissive: HEX.brassDim,
      emissiveIntensity: 0.4,
    }),
  );
  glass.rotation.y = -Math.PI / 2;
  glass.position.set(1.199, 0.22, -1.32);
  group.add(glass);

  // No power LED on the tower either: same reason as the monitor chins. The
  // glow through the glass panel already says the machine is on.

  /* ------------------------------ chair ----------------------------- */

  const chair = buildChair();
  // Tucked in: the seat front now sits ~0.09 short of the desk's front edge
  // (z = -0.64), close enough to read as "pulled up" rather than parked.
  chair.position.set(0.02, 0, -0.32);
  chair.rotation.y = 0.14;
  group.add(chair);

  return { group, projectsScreen, aboutScreen, deskTop, chair };
}

function buildChair(): THREE.Group {
  const chair = new THREE.Group();

  const frame = new THREE.MeshStandardMaterial({ color: HEX.chair, roughness: 0.5, metalness: 0.3 });
  const upholstery = new THREE.MeshStandardMaterial({ color: HEX.chairMesh, roughness: 0.9 });

  const seat = new THREE.Mesh(roundedBox(0.48, 0.07, 0.46, 0.026), upholstery);
  seat.position.set(0, 0.45, 0);
  chair.add(seat);

  const back = new THREE.Mesh(roundedBox(0.46, 0.56, 0.055, 0.024), upholstery);
  back.position.set(0, 0.75, 0.22);
  back.rotation.x = -0.14;
  chair.add(back);

  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.038, 0.36, RADIAL), frame);
  post.position.set(0, 0.24, 0);
  chair.add(post);

  // Five-star base, because office chairs are legally required to have five.
  const armGeometry = roundedBox(0.028, 0.022, 0.3, 0.01);
  const casterGeometry = new THREE.CylinderGeometry(0.028, 0.028, 0.018, RADIAL);
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    const arm = new THREE.Mesh(armGeometry, frame);
    arm.position.set(Math.sin(angle) * 0.15, 0.06, Math.cos(angle) * 0.15);
    arm.rotation.y = angle;
    chair.add(arm);

    const caster = new THREE.Mesh(casterGeometry, frame);
    caster.rotation.z = Math.PI / 2;
    caster.position.set(Math.sin(angle) * 0.29, 0.03, Math.cos(angle) * 0.29);
    chair.add(caster);
  }

  for (const side of [-1, 1]) {
    const armrest = new THREE.Mesh(roundedBox(0.05, 0.02, 0.24, 0.009), frame);
    armrest.position.set(side * 0.27, 0.63, 0.02);
    chair.add(armrest);

    const support = new THREE.Mesh(roundedBox(0.03, 0.16, 0.03, 0.01), frame);
    support.position.set(side * 0.27, 0.54, 0.08);
    chair.add(support);
  }

  return chair;
}
