import * as THREE from "three";
import { HEX } from "./palette";
import { RADIAL, RINGS, knots, limb, loft, type LoftRing } from "./geometry";

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

/* ---------------------------- shape vocabulary ---------------------------- */

type Table = readonly (readonly [number, number])[];

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
// Paired with +X, this is the frame `loft` wants for a form stacked up +Y.
const RING_UP = new THREE.Vector3(0, 0, -1);

/** A horizontal cross-section: `rx` across the body, `rz` front to back. */
const section = (y: number, rx: number, rz: number, z = 0): LoftRing => ({
  center: new THREE.Vector3(0, y, z),
  right: X_AXIS,
  up: RING_UP,
  rx,
  ry: rz,
});

/** A circular profile — limbs, fingers, cords. */
const round = (table: Table) => (t: number) => {
  const r = knots(table, t);
  return [r, r] as const;
};

/** A flattened profile — palms, ears, shoes, anything pressed. */
const oval = (wide: Table, thick: Table) => (t: number) =>
  [knots(wide, t), knots(thick, t)] as const;

const point = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/* -------------------------------- the head -------------------------------- */

// Half-dimensions, so 0.154 across, 0.196 front to back and 0.224 chin to
// crown. Real measurements, which is most of why the head stops reading as a
// ball: a sphere is as wide as it is deep and a skull is nothing like.
const HEAD_W = 0.077;
const HEAD_H = 0.112;
const HEAD_D = 0.098;

// All indexed by height on the unit sphere: -1 is under the chin, 1 the crown.
// Width stays past 1 through the jaw and cheekbones — wider there than a sphere
// would be — then falls away fast to the chin, which is the single silhouette
// cue that says "face" from behind and above, where this figure is mostly seen.
const HEAD_WIDTH: Table = [
  [-1, 0.72], [-0.7, 0.94], [-0.45, 1.06], [-0.2, 1.05],
  [0.05, 1.0], [0.4, 0.99], [0.75, 0.93], [1, 0.84],
];
const HEAD_DEPTH: Table = [
  [-1, 0.78], [-0.6, 0.94], [-0.2, 1.0], [0.3, 1.0], [0.7, 0.95], [1, 0.86],
];
// Pushed out on the front half only: the chin below, the brow ridge above.
const HEAD_FRONT: Table = [
  [-1, 0.016], [-0.55, 0.010], [-0.15, 0.002], [0.2, 0.006], [0.55, 0.001], [1, 0],
];
// And on the back half: the occiput, tucking back under toward the neck.
const HEAD_BACK: Table = [[-1, -0.012], [-0.35, 0], [0.15, 0.007], [0.6, 0.004], [1, 0]];

/**
 * Maps a direction on the unit sphere onto the head's surface, `swell` metres
 * proud of it.
 *
 * One map for the skull and the hair both. Because every term is either scaled
 * up by `swell` or identical between the two, the hair is guaranteed to lie
 * outside the scalp at every single vertex — no amount of tuning the profile
 * can make the skull poke through it.
 */
function headSurface(v: THREE.Vector3, swell: number): THREE.Vector3 {
  const u = THREE.MathUtils.clamp(v.y, -1, 1);
  return new THREE.Vector3(
    v.x * (HEAD_W + swell) * knots(HEAD_WIDTH, u),
    v.y * (HEAD_H + swell),
    v.z * (HEAD_D + swell) * knots(HEAD_DEPTH, u) -
      knots(HEAD_FRONT, u) * Math.max(0, -v.z) +
      knots(HEAD_BACK, u) * Math.max(0, v.z),
  );
}

/** Pushes a unit sphere's vertices through `headSurface`, in place. */
function shapeHead(geometry: THREE.BufferGeometry, swell: number, tilt = 0) {
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i);
    // Tilting the direction rather than the finished mesh is what lets the
    // hairline sit at an angle while the shell stays a true offset of the
    // scalp: it moves which part of the head is covered, not the shape of it.
    if (tilt) v.applyAxisAngle(X_AXIS, tilt);
    const p = headSurface(v, swell);
    position.setXYZ(i, p.x, p.y, p.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/* --------------------------------- hands --------------------------------- */

const PALM_WIDE: Table = [[0, 0.030], [0.35, 0.041], [0.8, 0.043], [1, 0.041]];
const PALM_THICK: Table = [[0, 0.024], [0.4, 0.020], [1, 0.017]];
const FINGER: Table = [[0, 0.0098], [0.5, 0.0092], [1, 0.0072]];
const THUMB: Table = [[0, 0.014], [0.5, 0.012], [1, 0.0095]];

/** Across the knuckles, and how far each finger reaches past them. */
const FINGERS = [
  { x: -0.032, length: 0.070 },
  { x: -0.011, length: 0.075 },
  { x: 0.011, length: 0.071 },
  { x: 0.031, length: 0.059 },
] as const;

interface Hand {
  group: THREE.Group;
  /** Knuckle pivots, thumb last, so the typing burst can drive them. */
  fingers: THREE.Group[];
}

/**
 * A hand at the origin with the wrist at 0 and the fingers reaching -Z, palm
 * down. `thumbSide` is +1 for a left hand, -1 for a right.
 *
 * Fingers are separate lofts on their own pivots rather than a shape suggested
 * by the palm, because they are the part of him that actually moves: a hand on
 * a keyboard is read entirely through its fingers.
 */
function buildHand(
  skin: THREE.Material,
  thumbSide: number,
  track: <T extends THREE.Mesh>(mesh: T) => T,
): Hand {
  const group = new THREE.Group();
  const fingers: THREE.Group[] = [];

  const palm = track(
    new THREE.Mesh(
      limb(
        [point(0, 0, 0), point(0, -0.004, -0.050), point(0, -0.008, -0.095)],
        oval(PALM_WIDE, PALM_THICK),
        { up: Y_AXIS, radial: 24, segments: 14 },
      ),
      skin,
    ),
  );
  group.add(palm);

  for (const spec of FINGERS) {
    const pivot = new THREE.Group();
    pivot.position.set(spec.x, -0.008, -0.092);
    group.add(pivot);
    fingers.push(pivot);

    const l = spec.length;
    pivot.add(
      track(
        new THREE.Mesh(
          limb(
            [point(0, 0, 0), point(spec.x * 0.06, -0.005, -l * 0.55), point(spec.x * 0.1, -0.014, -l)],
            round(FINGER),
            { radial: 12, segments: 10 },
          ),
          skin,
        ),
      ),
    );
  }

  // The thumb comes off the side of the palm and points inward across it, which
  // is the pose it holds over a keyboard's space bar and over a mouse button.
  const thumb = new THREE.Group();
  thumb.position.set(thumbSide * 0.030, -0.006, -0.030);
  group.add(thumb);
  fingers.push(thumb);

  thumb.add(
    track(
      new THREE.Mesh(
        limb(
          [
            point(0, 0, 0),
            point(thumbSide * 0.016, -0.006, -0.030),
            point(thumbSide * 0.019, -0.014, -0.055),
          ],
          round(THUMB),
          { radial: 14, segments: 10 },
        ),
        skin,
      ),
    ),
  );

  return { group, fingers };
}

/* --------------------------------- figure --------------------------------- */

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
  const lip = new THREE.MeshStandardMaterial({ color: HEX.skinShade, roughness: 0.7 });
  const sneaker = new THREE.MeshStandardMaterial({ color: HEX.sneaker, roughness: 0.6 });
  const cord = new THREE.MeshStandardMaterial({
    color: HEX.brass,
    roughness: 0.6,
    metalness: 0.2,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.4 });
  const hair = new THREE.MeshStandardMaterial({
    color: HEX.hair,
    roughness: 0.88,
    side: THREE.DoubleSide,
  });

  /* ---------------------------- hips and torso ---------------------------- */

  // Jeans, not leaning: the lean below is a hip hinge, and a hinge does not
  // take the pelvis with it. The seat top is 0.485, which is where this sits.
  const hips = track(
    new THREE.Mesh(
      loft([
        section(0.452, 0, 0),
        section(0.468, 0.118, 0.095, 0.026),
        section(0.492, 0.150, 0.116, 0.030),
        section(0.522, 0.158, 0.120, 0.028),
        section(0.560, 0.153, 0.113, 0.024),
        section(0.600, 0.144, 0.104, 0.018),
        section(0.634, 0.136, 0.098, 0.014),
        section(0.650, 0.110, 0.082, 0.012),
        section(0.660, 0, 0, 0.010),
      ]),
      denim,
    ),
  );
  group.add(hips);

  const torso = new THREE.Group();
  torso.position.set(0, 0.545, 0.02); // the hip hinge
  torso.rotation.x = -0.13; // slight forward lean, the universal posture of a desk
  group.add(torso);

  const sweatshirt = track(
    new THREE.Mesh(
      loft([
        section(0.008, 0, 0),
        section(0.020, 0.110, 0.084, 0.014),
        section(0.036, 0.144, 0.108, 0.013),
        section(0.055, 0.152, 0.113, 0.012), // hem, sitting over the jeans
        section(0.095, 0.146, 0.107, 0.006),
        section(0.140, 0.143, 0.104, 0),
        section(0.195, 0.150, 0.108, -0.004),
        section(0.250, 0.158, 0.112, -0.006), // chest
        section(0.300, 0.160, 0.112, -0.004),
        section(0.347, 0.155, 0.107, 0), // shoulder line
        section(0.385, 0.138, 0.098, 0.004), // the slope up to the neck
        section(0.412, 0.100, 0.082, 0.006),
        section(0.434, 0.072, 0.069, 0.004), // collar
        section(0.424, 0.050, 0.050, 0.004),
        section(0.408, 0, 0, 0.004),
      ]),
      hoodie,
    ),
  );
  torso.add(sweatshirt);

  const neck = track(
    new THREE.Mesh(
      loft([
        section(0.395, 0, 0),
        section(0.406, 0.053, 0.053),
        section(0.440, 0.057, 0.058),
        section(0.480, 0.055, 0.056, -0.004),
        section(0.512, 0.050, 0.052, -0.009),
        section(0.526, 0, 0, -0.011),
      ]),
      skin,
    ),
  );
  torso.add(neck);

  // The hood, bunched across the back of the neck.
  const hood = track(
    new THREE.Mesh(
      limb(
        [point(-0.092, 0.358, 0.070), point(0, 0.404, 0.098), point(0.092, 0.358, 0.070)],
        round([[0, 0.026], [0.5, 0.058], [1, 0.026]]),
        { radial: 28, segments: 20 },
      ),
      hoodieDark,
    ),
  );
  torso.add(hood);

  for (const side of [-1, 1]) {
    torso.add(
      new THREE.Mesh(
        limb(
          [
            point(side * 0.028, 0.418, -0.070),
            point(side * 0.032, 0.370, -0.100),
            point(side * 0.030, 0.320, -0.112),
          ],
          round([[0, 0.0045], [1, 0.004]]),
          { radial: 10, segments: 10 },
        ),
        cord,
      ),
    );
  }

  /* --------------------------------- head --------------------------------- */

  const head = new THREE.Group();
  head.position.set(0, 0.568, -0.001);
  torso.add(head);

  const skull = track(
    new THREE.Mesh(shapeHead(new THREE.SphereGeometry(1, RADIAL, RINGS), 0), skin),
  );
  head.add(skull);
  const nose = track(
    new THREE.Mesh(
      limb(
        [
          point(0, 0.026, -0.082),
          point(0, 0.000, -0.106),
          point(0, -0.020, -0.108),
          point(0, -0.030, -0.090),
        ],
        round([[0, 0.007], [0.4, 0.011], [0.75, 0.014], [1, 0.011]]),
        { radial: 20, segments: 16 },
      ),
      skin,
    ),
  );
  head.add(nose);

  // Lips
  head.add(
    track(
      new THREE.Mesh(
        limb(
          [point(-0.020, -0.046, -0.085), point(0, -0.045, -0.091), point(0.020, -0.046, -0.085)],
          oval([[0, 0.005], [1, 0.005]], [[0, 0.004], [1, 0.004]]),
          { up: Y_AXIS, radial: 12, segments: 12 },
        ),
        lip,
      ),
    ),
  );

  for (const side of [-1, 1]) {
    head.add(
      track(
        new THREE.Mesh(
          limb(
            [point(side * 0.068, -0.004, 0.012), point(side * 0.084, -0.004, 0.012)],
            oval([[0, 0.014], [1, 0.017]], [[0, 0.024], [1, 0.028]]),
            { up: Y_AXIS, radial: 20, segments: 6 },
          ),
          skin,
        ),
      ),
    );

    head.add(
      track(
        new THREE.Mesh(
          limb(
            [point(side * 0.012, 0.031, -0.096), point(side * 0.042, 0.026, -0.082)],
            oval([[0, 0.005], [1, 0.004]], [[0, 0.004], [1, 0.003]]),
            { up: Y_AXIS, radial: 12, segments: 8 },
          ),
          hair,
        ),
      ),
    );

    // Almonds rather than dots, set flush enough that the lids of the socket
    // do the cropping. Two spheres is all the face gets that isn't skin.
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.013, 20, 14), dark);
    eye.position.set(side * 0.031, 0.008, -0.083);
    eye.scale.set(1, 0.55, 0.9);
    head.add(eye);
  }

  /* --------------------------------- arms --------------------------------- */

  // Authored in figure space, which until main.ts sets the group onto the chair
  // is the room's own space, so the hands are the keyboard and mouse read off
  // desk.ts. `toTorso` folds them back through the lean, which means the lean
  // and the shoulder height can be retuned without re-solving the reach.
  torso.updateWorldMatrix(true, false);
  const toTorso = (p: readonly [number, number, number]) =>
    torso.worldToLocal(point(p[0], p[1], p[2]));

  // Elbows are a two-link solve held at desk height and flared outward. Held
  // there because the alternative — elbows dropped to the sides, as they hang
  // when you are not typing — runs the forearms straight through the desk's
  // front edge on the way up to the keys.
  const UPPER_ARM = round([[0, 0.068], [0.3, 0.056], [0.7, 0.049], [1, 0.044]]);
  const FOREARM = round([[0, 0.044], [0.2, 0.049], [0.55, 0.042], [1, 0.030]]);

  const armSpecs = [
    {
      shoulder: [-0.145, 0.9, -0.05],
      elbow: [-0.253, 0.785, -0.257],
      hand: [-0.093, 0.805, -0.417],
      thumb: 1,
      yaw: 0.16,
    },
    {
      shoulder: [0.145, 0.9, -0.05],
      elbow: [0.358, 0.785, -0.144],
      hand: [0.355, 0.805, -0.369],
      thumb: -1,
      yaw: -0.05,
    },
  ] as const;

  const elbows: THREE.Group[] = [];
  const hands: Hand[] = [];

  for (const spec of armSpecs) {
    const shoulder = toTorso(spec.shoulder);
    const elbow = toTorso(spec.elbow);
    const hand = toTorso(spec.hand);

    // The upper arm's start cap is the deltoid: a hemisphere of its own radius
    // swept back into the shoulder, which is why there is no ball joint here.
    torso.add(
      track(
        new THREE.Mesh(
          limb(
            [shoulder, shoulder.clone().lerp(elbow, 0.5), elbow],
            UPPER_ARM,
            { radial: 32, segments: 16 },
          ),
          hoodie,
        ),
      ),
    );

    // Forearm and hand hang off a pivot at the elbow so they can be animated.
  
    const elbowGroup = new THREE.Group();
    elbowGroup.position.copy(elbow);
    torso.add(elbowGroup);
    elbows.push(elbowGroup);

    const localHand = new THREE.Vector3().subVectors(hand, elbow);
    elbowGroup.add(
      track(
        new THREE.Mesh(
          limb(
            [point(0, 0, 0), localHand.clone().multiplyScalar(0.5), localHand],
            FOREARM,
            { radial: 32, segments: 16 },
          ),
          hoodie,
        ),
      ),
    );

    const built = buildHand(skin, spec.thumb, track);
    built.group.position.copy(localHand);
    built.group.rotation.set(-torso.rotation.x, spec.yaw, 0);
    elbowGroup.add(built.group);
    hands.push(built);
  }

  /* --------------------------------- legs --------------------------------- */

  const THIGH = round([[0, 0.098], [0.35, 0.091], [0.75, 0.074], [1, 0.062]]);
  const SHIN = round([[0, 0.062], [0.15, 0.061], [0.35, 0.052], [0.75, 0.039], [1, 0.033]]);

  for (const side of [-1, 1]) {
    const hip = point(side * 0.1, 0.575, -0.02);
    const knee = point(side * 0.135, 0.555, -0.4);
    const ankle = point(side * 0.145, 0.1, -0.435);

    group.add(
      track(
        new THREE.Mesh(
          limb([hip, hip.clone().lerp(knee, 0.5), knee], THIGH, { radial: 32, segments: 16 }),
          denim,
        ),
      ),
    );
    group.add(
      track(
        new THREE.Mesh(
          limb([knee, knee.clone().lerp(ankle, 0.5), ankle], SHIN, { radial: 32, segments: 16 }),
          denim,
        ),
      ),
    );

    // One piece, a shoe 
    group.add(
      track(
        new THREE.Mesh(
          limb(
            [
              point(side * 0.145, 0.058, -0.375),
              point(side * 0.145, 0.046, -0.47),
              point(side * 0.148, 0.036, -0.575),
            ],
            oval(
              [[0, 0.046], [0.45, 0.052], [1, 0.04]],
              [[0, 0.054], [0.45, 0.042], [1, 0.029]],
            ),
            { up: Y_AXIS, radial: 32, segments: 18 },
          ),
          sneaker,
        ),
      ),
    );
  }

  /* ------------------------------- animation ------------------------------- */

  const restLean = torso.rotation.x;

  /** How long one mouse nudge takes, start to rest. */
  const NUDGE = 0.38;
  let nudgeStart = -NUDGE;
  let nextNudge = 1.4;
  let nudgeDir = 1;

  // Every material here was created in this function, so fading them is safe —
  // nothing else in the room shares one. Collected from the graph rather than
  // from `meshes` so the odds and ends that aren't tracked as hover targets —
  // the eyes, the hood cords — fade with the rest of him.
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
      // Breathing: the chest swells mostly front to back, plus a matching micro-lean.
      const breath = Math.sin(elapsed * 1.15);
      sweatshirt.scale.set(1 + breath * 0.006, 1, 1 + breath * 0.014);
      torso.rotation.x = restLean + breath * 0.006;

      // Idle head drift. Two detuned sines never resolve into a visible loop.
      head.rotation.y = Math.sin(elapsed * 0.23) * 0.07 + Math.sin(elapsed * 0.61) * 0.02;
      head.rotation.x = Math.sin(elapsed * 0.31) * 0.035;

      // Left hand types in bursts
      const burst = Math.max(0, Math.sin(elapsed * 0.42) - 0.15) / 0.85;
      const left = hands[0]!.fingers;
      for (let i = 0; i < left.length; i++) {
        const strike = Math.sin(elapsed * (11 + i * 2.3) + i * 1.9);
        left[i]!.rotation.x = -0.12 - Math.max(0, strike) * 0.34 * burst;
      }
      elbows[0]!.rotation.x = Math.sin(elapsed * 13.5) * 0.006 * burst;
      elbows[0]!.rotation.z = Math.sin(elapsed * 6.1) * 0.012 * burst;

      // Right hand tremor runs constantly resting on a mouse
      if (elapsed >= nextNudge) {
        nudgeStart = elapsed;
        nextNudge = elapsed + 1.6 + Math.random() * 3.4;
        nudgeDir = Math.random() < 0.5 ? -1 : 1;
      }
      const sinceNudge = elapsed - nudgeStart;
      // A half-sine over the window: starts and ends at rest with no step at
      // either end, so the nudge never snaps back.
      const nudge = sinceNudge < NUDGE ? Math.sin((sinceNudge / NUDGE) * Math.PI) : 0;
      const tremor = Math.sin(elapsed * 17.3) * 0.0035 + Math.sin(elapsed * 26.1) * 0.0018;
      elbows[1]!.rotation.x = tremor + nudge * 0.024;
      elbows[1]!.rotation.y = tremor * 0.6 + nudge * 0.038 * nudgeDir;

      // The index finger clicks on the way out of a nudge, which is the order
      // it happens in: you move the pointer onto the thing, then you click it.
      const right = hands[1]!.fingers;
      const click = sinceNudge > NUDGE && sinceNudge < NUDGE + 0.16
        ? Math.sin(((sinceNudge - NUDGE) / 0.16) * Math.PI)
        : 0;
      right[0]!.rotation.x = -0.2 - click * 0.22;
      right[1]!.rotation.x = -0.18;
      right[2]!.rotation.x = -0.24 + tremor * 4;
      right[3]!.rotation.x = -0.3;
      right[4]!.rotation.x = -0.1;
    },
  };
}
