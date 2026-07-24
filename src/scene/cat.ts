import * as THREE from "three";
import { HEX } from "./palette";
import { RADIAL, RINGS, knots, limb } from "./geometry";
import { DESK_TOP_Y, DESK_WIDTH } from "./desk";

export interface CatRig {
  group: THREE.Group;
  /** Breathing and, when poked, a brief stir. */
  update(elapsed: number): void;
  /**
   * Poke her: she stirs in her sleep — a stretch, a chin lift, an ear swivel and
   * a tail flick — then settles back down. Retriggerable; a fresh poke restarts
   * the stir from the top.
   */
  poke(): void;
}

type Table = readonly (readonly [number, number])[];

const point = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** Circular profile: legs, tail. */
const round = (table: Table) => (t: number) => {
  const r = knots(table, t);
  return [r, r] as const;
};
/** Elliptical profile: separate width and height tables. */
const oval = (wide: Table, tall: Table) => (t: number) =>
  [knots(wide, t), knots(tall, t)] as const;

const { smoothstep } = THREE.MathUtils;

/* ------------------------------- placement ------------------------------- */

/** Back right of the desk top, under the right monitor, near the edge her tail hangs over. */
const CAT_X = 0.9;
const CAT_Z = -1.375;
const CAT_YAW = -0.62;

/* --------------------------------- coat ---------------------------------- */

const FUR = new THREE.Color(HEX.catFur);
const STRIPE = new THREE.Color(HEX.catStripe);
const SPINE_SHADE = new THREE.Color(HEX.catSpine);
const CREAM = new THREE.Color(HEX.catCream);
const SOCK = new THREE.Color(HEX.catSock);
/** The lighter brown between the tail rings. */
const TAIL_PALE = FUR.clone().lerp(CREAM, 0.45);

const scratch = new THREE.Color();

/** Writes a colour attribute by evaluating `shade` at every vertex. */
function paint(
  geometry: THREE.BufferGeometry,
  shade: (p: THREE.Vector3) => THREE.Color,
): THREE.BufferGeometry {
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  const p = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i);
    const c = shade(p);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/**
 * How far along a spine a point lies, 0 to 1. Nearest-neighbour against a dense
 * polyline of the same curve `limb` sweeps, so bands stay square across the
 * form round a bend instead of shearing.
 */
function alongSpine(spine: readonly THREE.Vector3[], samples = 160) {
  const curve = new THREE.CatmullRomCurve3(spine.map((p) => p.clone()), false, "centripetal");
  const points = curve.getSpacedPoints(samples);
  return (p: THREE.Vector3) => {
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i <= samples; i++) {
      const d = points[i]!.distanceToSquared(p);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    return best / samples;
  };
}

/**
 * One whisker. Not `strut`: at a few pixels wide, its 48-segment capsule would
 * spend thousands of triangles on a curve nobody can see.
 */
function whiskerAt(from: THREE.Vector3, to: THREE.Vector3, material: THREE.Material): THREE.Mesh {
  const direction = new THREE.Vector3().subVectors(to, from);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0004, 0.0008, direction.length(), 6, 1),
    material,
  );
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(Y_AXIS, direction.normalize());
  return mesh;
}

/** A band function: 1 on a stripe, 0 between them. `edge` sets how soft it is. */
const bands = (u: number, count: number, edge = 0.5) =>
  smoothstep(Math.sin(u * count * Math.PI * 2) * 0.5 + 0.5, edge, Math.min(edge + 0.4, 0.99));

/* ------------------------------- the shape -------------------------------- */

// Rump to chest, curled slightly to her left so she reads as coiled.
const BODY_SPINE = [
  point(0.0, 0.05, -0.12),
  point(-0.014, 0.058, -0.055),
  point(-0.008, 0.06, 0.012),
  point(0.02, 0.05, 0.062),
];

const BODY_WIDE: Table = [[0, 0.05], [0.22, 0.076], [0.5, 0.078], [0.78, 0.07], [1, 0.055]];
const BODY_TALL: Table = [[0, 0.044], [0.22, 0.06], [0.5, 0.062], [0.78, 0.056], [1, 0.05]];

/**
 * An offset in room axes, restated in the cat's yawed space. The tail is aimed
 * at the desk's right edge, a fact about the room, so re-yawing her keeps the
 * tail on the edge.
 */
const fromRoom = (x: number, y: number, z: number) =>
  new THREE.Vector3(x, y, z).applyAxisAngle(Y_AXIS, -CAT_YAW);

/** How far the desk's right edge lies from her, along the room's x. */
const EDGE = DESK_WIDTH / 2 - CAT_X;

/** Where the tail leaves the rump, i.e. where the body's own spine ends. */
const TAIL_ROOT_X = 0.093;
/** The flat stretch out to the edge. */
const RUN = EDGE - TAIL_ROOT_X;
/** How far below the desk top the tip falls once it is over the side. */
const HANG = 0.088;

// Out of the rump, flat across the desk, then dropped at the lip. The spine is
// dense through the bend so the curve takes it as a drape, not a corner.
// Stations are fractions of `RUN`, so moving her toward the edge shortens the
// tail instead of folding it back on itself.
const TAIL_SPINE = [
  fromRoom(TAIL_ROOT_X, 0.044, -0.096),
  fromRoom(TAIL_ROOT_X + RUN * 0.44, 0.032, -0.076),
  fromRoom(TAIL_ROOT_X + RUN * 0.8, 0.024, -0.055),
  fromRoom(EDGE, 0.02, -0.044),
  fromRoom(EDGE + 0.028, 0.0, -0.034),
  fromRoom(EDGE + 0.044, -HANG * 0.52, -0.027),
  fromRoom(EDGE + 0.046, -HANG, -0.023),
];

const HEAD = point(0.03, 0.076, 0.14);

/**
 * How far off centre the body axis has drifted by the hip. Anything hung off
 * both flanks measures from here, not zero, or it sits unevenly.
 */
const CURL = -0.011;

export function buildCat(scene: THREE.Scene): CatRig {
  const group = new THREE.Group();
  group.position.set(CAT_X, DESK_TOP_Y, CAT_Z);
  group.rotation.y = CAT_YAW;
  scene.add(group);

  const fur = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
  });
  const nosePink = new THREE.MeshStandardMaterial({ color: HEX.catNose, roughness: 0.55 });
  const earPink = new THREE.MeshStandardMaterial({ color: HEX.catEar, roughness: 0.85 });
  const closedEye = new THREE.MeshStandardMaterial({ color: 0x241a11, roughness: 0.7 });
  // Brown, only a little lighter than the muzzle; pale whiskers read as white.
  const whiskerHair = new THREE.MeshStandardMaterial({ color: 0x8d7750, roughness: 0.5 });

  /* -------------------------------- body -------------------------------- */

  const bodyT = alongSpine(BODY_SPINE);
  const body = new THREE.Mesh(
    paint(
      limb(BODY_SPINE, oval(BODY_WIDE, BODY_TALL), { up: Y_AXIS, segments: 32 }),
      (p) => {
        const t = bodyT(p);
        // Cream comes up from the belly; the back stays in the brown.
        scratch.copy(CREAM).lerp(FUR, smoothstep(p.y, 0.016, 0.058));
        // Mackerel bands, square across the spine, wobbled by flank position so
        // they don't come out as a barcode.
        const flank = smoothstep(p.y, 0.012, 0.055);
        const stripe = bands(t + Math.sin(p.x * 24) * 0.008, 7, 0.52) * flank;
        scratch.lerp(STRIPE, stripe * 0.85);
        // Dorsal shadow along the top of the back.
        scratch.lerp(SPINE_SHADE, smoothstep(p.y, 0.086, 0.122) * 0.5);
        return scratch;
      },
    ),
    fur,
  );
  group.add(body);

  /* -------------------------------- tail -------------------------------- */

  const tailT = alongSpine(TAIL_SPINE);
  const tail = new THREE.Mesh(
    paint(
      limb(TAIL_SPINE, round([[0, 0.024], [0.5, 0.02], [0.85, 0.017], [1, 0.014]]), {
        up: Y_AXIS,
        segments: 48,
      }),
      (p) => {
        const t = tailT(p);
        // Hard rings rather than the soft body bands: the one part of her meant
        // to read as banded from across the room.
        scratch.copy(TAIL_PALE).lerp(STRIPE, bands(t, 6, 0.34));
        scratch.lerp(SPINE_SHADE, smoothstep(t, 0.84, 0.98));
        return scratch;
      },
    ),
    fur,
  );
  group.add(tail);

  /* -------------------------------- head -------------------------------- */

  // Built about the head's own centre, so it can be tipped without re-aiming
  // any of the features.
  const head = new THREE.Group();
  head.position.copy(HEAD);
  head.rotation.set(-0.17, 0.16, 0.1);
  group.add(head);

  const skull = new THREE.SphereGeometry(1, RADIAL, RINGS);
  skull.scale(0.05, 0.046, 0.048);
  head.add(
    new THREE.Mesh(
      paint(skull, (p) => {
        // Muzzle and chin go cream; fine stripes run back off the brow as the
        // tabby "M".
        const muzzle = smoothstep(p.z, 0.014, 0.038) * (1 - smoothstep(p.y, -0.02, 0.012));
        scratch.copy(FUR).lerp(CREAM, Math.min(muzzle, 0.92));
        const stripe = bands(p.x, 34, 0.55) * smoothstep(p.y, 0.0, 0.028);
        scratch.lerp(STRIPE, stripe * 0.75);
        return scratch;
      }),
      fur,
    ),
  );

  const muzzle = new THREE.SphereGeometry(1, RADIAL, RINGS);
  muzzle.scale(0.028, 0.02, 0.022);
  muzzle.translate(0, -0.018, 0.038);
  head.add(new THREE.Mesh(paint(muzzle, () => scratch.copy(CREAM)), fur));

  const nose = new THREE.Mesh(new THREE.SphereGeometry(1, RADIAL, RINGS), nosePink);
  nose.scale.set(0.009, 0.0065, 0.006);
  nose.position.set(0, -0.009, 0.057);
  head.add(nose);

  // Closed eyes: a shallow arc apiece bowing upward, just proud of the skull.
  for (const side of [-1, 1]) {
    const lid = new THREE.Mesh(
      new THREE.TorusGeometry(0.0105, 0.0016, 8, 28, Math.PI),
      closedEye,
    );
    lid.position.set(side * 0.023, 0.006, 0.0435);
    lid.rotation.y = side * 0.42;
    head.add(lid);
  }

  const ears: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    // Dark at the base, fading up: an ear backed by the coat it grows out of.
    const shell = paint(new THREE.ConeGeometry(0.026, 0.036, RADIAL), (p) =>
      scratch.copy(STRIPE).lerp(FUR, smoothstep(p.y, -0.014, 0.012)),
    );
    const ear = new THREE.Mesh(shell, fur);
    ear.scale.z = 0.55;
    ear.position.set(side * 0.033, 0.046, -0.006);
    ear.rotation.set(-0.18, 0, side * -0.34);
    head.add(ear);
    ears.push(ear);

    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.024, RADIAL), earPink);
    inner.scale.z = 0.4;
    inner.position.set(side * 0.033, 0.044, 0.006);
    inner.rotation.copy(ear.rotation);
    head.add(inner);

    for (const [drop, spread, length] of [
      [0.004, 0.2, 0.055],
      [-0.002, 0.02, 0.06],
      [-0.008, -0.14, 0.052],
    ] as const) {
      head.add(
        whiskerAt(
          point(side * 0.021, -0.012, 0.046),
          point(
            side * (0.021 + length),
            -0.012 + drop + spread * 0.05,
            0.046 + length * 0.35,
          ),
          whiskerHair,
        ),
      );
    }
  }

  /* -------------------------------- legs --------------------------------- */

  // All four legs are swept along a spine that starts inside the body, so the
  // cap at the hip is buried in the flank and there is no seam to orbit to.
  //
  // The toes lift to her lightest brown over the last fifth. `SOCK_IN`/
  // `SOCK_FULL` are fractions of each leg's length, so all four match on legs
  // that don't.
  const SOCK_IN = 0.76;
  const SOCK_FULL = 0.84;

  const addLeg = (spine: THREE.Vector3[], thickness: Table) => {
    const legT = alongSpine(spine);
    group.add(
      new THREE.Mesh(
        paint(limb(spine, round(thickness), { up: Y_AXIS, segments: 20 }), (p) => {
          const t = legT(p);
          const flank = smoothstep(p.y, 0.006, 0.026);
          scratch.copy(CREAM).lerp(FUR, flank);
          scratch.lerp(STRIPE, bands(t, 3, 0.6) * 0.5 * flank);
          scratch.lerp(SOCK, smoothstep(t, SOCK_IN, SOCK_FULL));
          return scratch;
        }),
        fur,
      ),
    );
  };

  for (const side of [-1, 1]) {
    // Front: out of the chest and stretched forward under her chin.
    const x = 0.03 + side * 0.03;
    addLeg(
      [point(x, 0.05, 0.05), point(x, 0.022, 0.115), point(x + side * 0.005, 0.02, 0.176)],
      [[0, 0.03], [0.4, 0.021], [0.75, 0.019], [1, 0.018]],
    );

    // Hind: hip buried high in the flank, down and out to the hock, then
    // forward to the toes: a folded leg.
    //
    // Measured from `CURL`, not x = 0: the curl puts her flanks at -0.088 and
    // +0.064, so a mirrored ±x swallows the right leg and beaches the left.
    addLeg(
      [
        point(CURL + side * 0.046, 0.068, -0.08),
        point(CURL + side * 0.082, 0.042, -0.072),
        point(CURL + side * 0.09, 0.025, -0.045),
        point(CURL + side * 0.086, 0.02, -0.004),
      ],
      [[0, 0.042], [0.32, 0.031], [0.68, 0.022], [1, 0.018]],
    );
  }

  /* --------------------------- breathing & stir --------------------------- */

  // Rest angles; poke rotations reset to these each frame.
  const HEAD_REST_X = -0.17;
  const HEAD_REST_Z = 0.1;
  const EAR_REST_X = -0.18;

  /** How long one stir lasts, and when the current one began (-1 = at rest). */
  const POKE_DUR = 1.5;
  let pokeAt = -1;
  // Cached so `poke` can timestamp the stir start.
  let lastElapsed = 0;

  return {
    group,
    poke() {
      // Retrigger from the top on every poke.
      pokeAt = lastElapsed;
    },
    update(elapsed: number) {
      lastElapsed = elapsed;

      // A single raised bump, 0 → 1 → 0 over the stir, eased at both ends.
      let k = 0;
      if (pokeAt >= 0) {
        const s = elapsed - pokeAt;
        if (s >= POKE_DUR) pokeAt = -1;
        else k = Math.sin((s / POKE_DUR) * Math.PI);
      }

      // Breathing swell (upward only). Stir adds a forward stretch.
      const breath = Math.sin(elapsed * 0.9) * 0.5 + 0.5;
      body.scale.set(1 + breath * 0.012, 1 + breath * 0.02, 1 + k * 0.05);

      // Slow tail sway + quick flick on poke.
      tail.rotation.y = Math.sin(elapsed * 0.37) * 0.012 + k * Math.sin(elapsed * 22) * 0.13;

      head.position.y = HEAD.y + breath * 0.0015 + k * 0.018;
      head.rotation.x = HEAD_REST_X - k * 0.42;
      head.rotation.z = HEAD_REST_Z + k * 0.1;

      // Ears swivel up on poke, near ear more than far.
      ears[0]!.rotation.x = EAR_REST_X + k * 0.32;
      ears[1]!.rotation.x = EAR_REST_X + k * 0.24;
    },
  };
}
