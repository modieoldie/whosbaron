/**
 * Two things, both about depth. The patterned rug lies under the desk and
 * chair, giving the workspace a footprint to stand on. Behind the chair, on the
 * near side, the floor drops away into a sunken conversation pit modelled on
 * the Miller House one, reworked in fall brown: a run of wool seating around a
 * square well (blind where an ebony stair drops in), a carpeted floor, a live
 * fire pit at the centre, mugs left on the seating, and potted plants with a
 * marble bust set out on the floor around the rim.
 *
 * The pit is the reason `room.ts` cuts a hole in the floor. Without walls the
 * room has nothing to measure the desk against, and a hole is more arresting
 * than anything you could stand on the floor: the eye starts down in the pit,
 * climbs out across the rug, and lands on the monitors.
 *
 * The rug is a real slab, not a decal: it has pile thickness and a bound edge,
 * so it meets the floor with an edge and reads as something laid down rather
 * than painted on. Its pattern is a canvas texture, painted here for the same
 * reason the monitors are painted rather than imported: one file, no assets,
 * and the palette stays in one place.
 */

import * as THREE from "three";
import { HEX } from "./palette";
import { RADIAL, RINGS, roundedBox } from "./geometry";

/* -------------------------------- the pit -------------------------------- */

/** Centre of the pit, on the near side of the chair. */
const PIT_X = 0;
// Set back off the desk: its front edge clears the rug under the desk, and its
// near edge falls behind the default camera so you look down into it.
const PIT_Z = 3.2;
/** Opening at floor level, and the rectangle `room.ts` bites out of the floor. */
const PIT_W = 4.4;
const PIT_D = 4.2;
/** Horizontal depth of the bench seat, wall to footwell. */
const SEAT_DEPTH = 0.8;
/** Seat top below the surrounding floor; you step down onto it. */
const SEAT_DROP = 0.36;
/** Footwell floor below the surrounding floor: another step down for your feet. */
const PIT_DEPTH = 0.66;
/** The low upholstered wall standing between the seat and the floor edge. */
const WALL_T = 0.06;
/**
 * Which side the ebony stair comes down. -z faces the desk, so the stair faces
 * the camera on the far side of the pit. The seat and back cushions both stop
 * short of it, leaving a blind gap in the sofa for the steps.
 */
const STAIR_SIGN = -1;
/** Half-width of the stair, and of the gap left in the seating for it. */
const STAIR_HALF = 0.55;

/** Shared with `room.ts`, which needs the footprint to open the floor over it. */
export const PIT = { x: PIT_X, z: PIT_Z, width: PIT_W, depth: PIT_D } as const;

/* -------------------------------- the rug -------------------------------- */

/** Sized to frame the desk and chair it now lies under. */
const RUG_W = 4.8;
const RUG_D = 3.4;
/** Pile depth. Small, but it is the whole difference between a rug and a decal. */
const RUG_PILE = 0.028;
/** How far the bound edge stands proud of the pile on each side. */
const RUG_BINDING = 0.035;

/* ------------------------------ the rug ------------------------------ */

/**
 * Palette for the woven pattern, taken off the gilded coffered ceiling this is
 * borrowed from: a painted panel of deep reds and volcanic light, held inside a
 * band of gold-ruled cassettes.
 */
const RUG = {
  ground: "#3a2729",
  field: "#4a1b1e",
  fieldGlow: "#8f4726",
  fieldDark: "#2a1013",
  gold: "#c9a961",
  goldDim: "#8a7440",
  goldLight: "#e6cf95",
  cream: "#ece5d4",
  slate: "#3d4f63",
  red: "#7c2f2a",
} as const;

/** Border ring thicknesses, outermost first, in canvas pixels. */
const BIND = 22;
const PIN = 10;
const BAND = 132;
const ROPE = 26;
const BORDER = BIND + PIN + BAND + ROPE;

/** A rectangle with its corners cut off, which is the shape of every gilt frame
 * on that ceiling. Left as a path for the caller to fill or stroke. */
function cartouche(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  notch: number,
) {
  c.beginPath();
  c.moveTo(x + notch, y);
  c.lineTo(x + w - notch, y);
  c.lineTo(x + w, y + notch);
  c.lineTo(x + w, y + h - notch);
  c.lineTo(x + w - notch, y + h);
  c.lineTo(x + notch, y + h);
  c.lineTo(x, y + h - notch);
  c.lineTo(x, y + notch);
  c.closePath();
}

/** Eight petals and a boss. The ceiling puts one of these in every corner. */
function rosette(c: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  c.fillStyle = color;
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    c.beginPath();
    c.ellipse(
      x + Math.cos(angle) * r * 0.52,
      y + Math.sin(angle) * r * 0.52,
      r * 0.44,
      r * 0.22,
      angle,
      0,
      Math.PI * 2,
    );
    c.fill();
  }
  c.beginPath();
  c.arc(x, y, r * 0.26, 0, Math.PI * 2);
  c.fill();
}

/**
 * One run of cassettes along an edge of the border band, alternating slate and
 * red panels behind a gold double rule. `vertical` swings the run down the side
 * edges instead of across the top and bottom.
 */
function cassettes(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  length: number,
  thickness: number,
  vertical: boolean,
) {
  // Cells land near square on every edge, so the rhythm reads as one band that
  // turns the corner rather than four unrelated strips.
  const count = Math.max(2, Math.round(length / 172));
  const gap = 7;

  for (let i = 0; i < count; i++) {
    const from = (i / count) * length + gap;
    const span = length / count - gap * 2;
    const px = vertical ? x : x + from;
    const py = vertical ? y + from : y;
    const pw = vertical ? thickness : span;
    const ph = vertical ? span : thickness;

    c.fillStyle = i % 2 === 0 ? RUG.slate : RUG.red;
    c.fillRect(px, py, pw, ph);

    c.strokeStyle = RUG.gold;
    c.lineWidth = 5;
    c.strokeRect(px + 3, py + 3, pw - 6, ph - 6);
    c.strokeStyle = RUG.goldDim;
    c.lineWidth = 2;
    c.strokeRect(px + 14, py + 14, pw - 28, ph - 28);

    rosette(c, px + pw / 2, py + ph / 2, Math.min(pw, ph) * 0.2, RUG.gold);
  }
}

function makeRugTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = Math.round(2048 * (RUG_D / RUG_W));
  const c = canvas.getContext("2d")!;
  const W = canvas.width;
  const H = canvas.height;

  /* ---------------------------- the border ---------------------------- */

  // Nested rings, outermost first. Each one covers the middle of the last, so
  // the border is built the way it would be woven: from the edge inward.
  const ring = (inset: number, fill: string) => {
    c.fillStyle = fill;
    c.fillRect(inset, inset, W - inset * 2, H - inset * 2);
  };

  ring(0, RUG.goldDim);
  ring(BIND, RUG.red);
  ring(BIND + PIN, RUG.cream);

  const bandAt = BIND + PIN;
  // Corner blocks first; the cassette runs then span the gaps between them.
  for (const [cx, cy] of [
    [bandAt, bandAt],
    [W - bandAt - BAND, bandAt],
    [bandAt, H - bandAt - BAND],
    [W - bandAt - BAND, H - bandAt - BAND],
  ] as const) {
    c.fillStyle = RUG.red;
    c.fillRect(cx, cy, BAND, BAND);
    c.strokeStyle = RUG.gold;
    c.lineWidth = 5;
    c.strokeRect(cx + 3, cy + 3, BAND - 6, BAND - 6);
    rosette(c, cx + BAND / 2, cy + BAND / 2, BAND * 0.3, RUG.goldLight);
  }

  const runX = bandAt + BAND;
  const runW = W - runX * 2;
  const runH = H - runX * 2;
  cassettes(c, runX, bandAt, runW, BAND, false);
  cassettes(c, runX, H - bandAt - BAND, runW, BAND, false);
  cassettes(c, bandAt, runX, runH, BAND, true);
  cassettes(c, W - bandAt - BAND, runX, runH, BAND, true);

  // Bead rope between the cassettes and the field, the way the ceiling separates
  // its coffers from the painting.
  const ropeAt = bandAt + BAND;
  ring(ropeAt, RUG.goldDim);
  c.fillStyle = RUG.goldLight;
  const beadR = 7;
  const beadStep = 26;
  const inner = { x: ropeAt, y: ropeAt, w: W - ropeAt * 2, h: H - ropeAt * 2 };
  for (let x = inner.x + beadStep / 2; x < inner.x + inner.w; x += beadStep) {
    for (const y of [inner.y + ROPE / 2, inner.y + inner.h - ROPE / 2]) {
      c.beginPath();
      c.arc(x, y, beadR, 0, Math.PI * 2);
      c.fill();
    }
  }
  for (let y = inner.y + beadStep / 2; y < inner.y + inner.h; y += beadStep) {
    for (const x of [inner.x + ROPE / 2, inner.x + inner.w - ROPE / 2]) {
      c.beginPath();
      c.arc(x, y, beadR, 0, Math.PI * 2);
      c.fill();
    }
  }

  /* ----------------------------- the field ---------------------------- */

  ring(BORDER, RUG.ground);

  // The gilt frame, and inside it the painting: a warm blowing sky rather than
  // any attempt at figures, which at rug scale would only read as smudges.
  const frameAt = BORDER + 46;
  const panel = { x: frameAt + 14, y: frameAt + 14, w: W - (frameAt + 14) * 2, h: H - (frameAt + 14) * 2 };

  const sky = c.createRadialGradient(
    panel.x + panel.w * 0.62,
    panel.y + panel.h * 0.34,
    40,
    panel.x + panel.w * 0.5,
    panel.y + panel.h * 0.5,
    panel.w * 0.62,
  );
  sky.addColorStop(0, RUG.fieldGlow);
  sky.addColorStop(0.42, RUG.field);
  sky.addColorStop(1, RUG.fieldDark);
  c.save();
  cartouche(c, panel.x, panel.y, panel.w, panel.h, 30);
  c.clip();
  c.fillStyle = sky;
  c.fillRect(panel.x, panel.y, panel.w, panel.h);

  // Cloud banks. Soft, low-contrast and deliberately few: this is a woven
  // impression of the painting, not a copy of it.
  for (const [fx, fy, fr, tint, alpha] of [
    [0.24, 0.62, 0.3, RUG.slate, 0.5],
    [0.52, 0.7, 0.26, "#8a8d92", 0.32],
    [0.78, 0.6, 0.24, RUG.fieldDark, 0.55],
    [0.4, 0.24, 0.22, RUG.fieldGlow, 0.28],
  ] as const) {
    const cloud = c.createRadialGradient(
      panel.x + panel.w * fx,
      panel.y + panel.h * fy,
      0,
      panel.x + panel.w * fx,
      panel.y + panel.h * fy,
      panel.w * fr,
    );
    cloud.addColorStop(0, tint);
    cloud.addColorStop(1, "rgba(0,0,0,0)");
    c.globalAlpha = alpha;
    c.fillStyle = cloud;
    c.fillRect(panel.x, panel.y, panel.w, panel.h);
  }
  c.globalAlpha = 1;

  // A medallion woven over the panel, held back to half strength so it sits in
  // the cloth instead of on top of it.
  c.globalAlpha = 0.5;
  c.strokeStyle = RUG.gold;
  c.lineWidth = 6;
  const mx = panel.x + panel.w / 2;
  const my = panel.y + panel.h / 2;
  c.beginPath();
  c.ellipse(mx, my, panel.h * 0.3, panel.h * 0.24, 0, 0, Math.PI * 2);
  c.stroke();
  c.lineWidth = 2;
  c.beginPath();
  c.ellipse(mx, my, panel.h * 0.26, panel.h * 0.2, 0, 0, Math.PI * 2);
  c.stroke();
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    rosette(c, mx + Math.cos(angle) * panel.h * 0.28, my + Math.sin(angle) * panel.h * 0.22, 16, RUG.gold);
  }
  rosette(c, mx, my, 42, RUG.goldLight);
  c.globalAlpha = 1;
  c.restore();

  // The frame itself, on top of the panel's clipped edge.
  c.strokeStyle = RUG.gold;
  c.lineWidth = 10;
  cartouche(c, frameAt, frameAt, W - frameAt * 2, H - frameAt * 2, 34);
  c.stroke();
  c.strokeStyle = RUG.goldDim;
  c.lineWidth = 3;
  cartouche(c, frameAt + 20, frameAt + 20, W - (frameAt + 20) * 2, H - (frameAt + 20) * 2, 26);
  c.stroke();

  for (const [x, y] of [
    [BORDER + 23, BORDER + 23],
    [W - BORDER - 23, BORDER + 23],
    [BORDER + 23, H - BORDER - 23],
    [W - BORDER - 23, H - BORDER - 23],
  ] as const) {
    rosette(c, x, y, 17, RUG.gold);
  }

  /* ------------------------------- pile ------------------------------- */

  // Per-pixel grain. This is what stops the whole thing reading as printed
  // paper, and it doubles as the bump map, so the pattern comes out slightly
  // carved and the ground slightly fuzzy.
  const grain = c.getImageData(0, 0, W, H);
  const pixels = grain.data;
  for (let i = 0; i < pixels.length; i += 4) {
    const n = (Math.random() - 0.5) * 30;
    pixels[i] = Math.min(255, Math.max(0, pixels[i]! + n));
    pixels[i + 1] = Math.min(255, Math.max(0, pixels[i + 1]! + n));
    pixels[i + 2] = Math.min(255, Math.max(0, pixels[i + 2]! + n));
  }
  c.putImageData(grain, 0, 0);

  // Nap: the pile lies one way, so one end of the rug is lighter than the other.
  const nap = c.createLinearGradient(0, 0, W, H);
  nap.addColorStop(0, "rgba(255,235,205,0.07)");
  nap.addColorStop(0.55, "rgba(0,0,0,0)");
  nap.addColorStop(1, "rgba(0,0,0,0.16)");
  c.fillStyle = nap;
  c.fillRect(0, 0, W, H);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function buildRug(): THREE.Group {
  const rug = new THREE.Group();

  // The same canvas serves as the bump map: the gold rules come out standing
  // slightly proud of the ground and the grain becomes pile. One upload, and
  // the relief lines up with the pattern by construction.
  const map = makeRugTexture();

  const pileTop = new THREE.MeshStandardMaterial({
    map,
    bumpMap: map,
    bumpScale: 0.25,
    roughness: 1,
    metalness: 0,
  });
  const pileSide = new THREE.MeshStandardMaterial({ color: HEX.velvetDeep, roughness: 1 });
  const pileUnder = new THREE.MeshStandardMaterial({ color: 0x120c0e, roughness: 1 });

  // A plain box, not a rounded one: `RoundedBoxGeometry` does not lay a clean
  // 0–1 UV square on its top face, and the top face is the entire point here.
  // Face order is +x, -x, +y, -y, +z, -z.
  const pile = new THREE.Mesh(new THREE.BoxGeometry(RUG_W, RUG_PILE, RUG_D), [
    pileSide,
    pileSide,
    pileTop,
    pileUnder,
    pileSide,
    pileSide,
  ]);
  pile.position.y = 0.006 + RUG_PILE / 2;
  rug.add(pile);

  // The bound edge, slightly wider and rounded, tucked under the pile. It hides
  // the slab's hard bottom corner and gives the rug somewhere to meet the floor.
  const binding = new THREE.Mesh(
    roundedBox(RUG_W + RUG_BINDING * 2, 0.012, RUG_D + RUG_BINDING * 2, 0.005),
    new THREE.MeshStandardMaterial({ color: HEX.brassDim, roughness: 0.85, metalness: 0.2 }),
  );
  binding.position.y = 0.006;
  rug.add(binding);

  return rug;
}

/* ------------------------------- pit props ------------------------------- */

/**
 * A potted plant: a tapered pot and a spray of upright blade leaves, each a
 * flattened, slightly bent capsule so the clump reads as foliage rather than a
 * cone of green. Origin at the base of the pot.
 */
function buildPlant(blades = 9, tint = 0x3f6b3a): THREE.Group {
  const g = new THREE.Group();

  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.09, 0.17, RADIAL),
    new THREE.MeshStandardMaterial({ color: 0x8a5636, roughness: 0.85 }),
  );
  pot.position.y = 0.085;
  g.add(pot);

  const soil = new THREE.Mesh(
    new THREE.CylinderGeometry(0.108, 0.108, 0.02, RADIAL),
    new THREE.MeshStandardMaterial({ color: 0x241a12, roughness: 1 }),
  );
  soil.position.y = 0.17;
  g.add(soil);

  const leafMat = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.7 });
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + i * 0.7;
    const lean = 0.12 + (i % 3) * 0.12;
    const len = 0.34 + (i % 4) * 0.06;
    const leaf = new THREE.Mesh(new THREE.CapsuleGeometry(0.016, len, 6, 10), leafMat);
    leaf.scale.set(1.7, 1, 0.35); // flatten into a blade
    leaf.position.set(Math.cos(a) * 0.05, 0.18 + len / 2, Math.sin(a) * 0.05);
    leaf.rotation.set(Math.cos(a) * lean, -a, Math.sin(a) * lean);
    g.add(leaf);
  }
  return g;
}

/** A ceramic mug: an open cylinder with a torus handle. Origin at its base. */
function buildMug(color: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.031, 0.075, RADIAL), mat);
  body.position.y = 0.0375;
  g.add(body);
  // Coffee sitting just below the rim.
  const brew = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.006, RADIAL),
    new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.3 }),
  );
  brew.position.y = 0.066;
  g.add(brew);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.007, RINGS / 2, RADIAL), mat);
  handle.position.set(0.038, 0.04, 0);
  g.add(handle);
  return g;
}

/**
 * A classical marble bust on a fluted plinth: a draped torso lofted from a
 * stack of ellipses, a spherical head and a rolled hair mass, all in one
 * off-white stone. Origin at the foot of the plinth.
 */
function buildStatue(): THREE.Group {
  const g = new THREE.Group();
  const marble = new THREE.MeshStandardMaterial({ color: 0xdedad0, roughness: 0.5, metalness: 0.02 });
  const stone = new THREE.MeshStandardMaterial({ color: 0xc9c3b6, roughness: 0.7 });

  // Fluted plinth.
  const plinthH = 0.62;
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, plinthH, RADIAL), stone);
  plinth.position.y = plinthH / 2;
  g.add(plinth);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.04, RADIAL), stone);
  cap.position.y = plinthH + 0.02;
  g.add(cap);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const flute = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, plinthH * 0.9, 8), stone);
    flute.position.set(Math.cos(a) * 0.125, plinthH / 2, Math.sin(a) * 0.125);
    g.add(flute);
  }

  // Bust: shoulders, chest, neck, head.
  const base = plinthH + 0.04;
  const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.17, RADIAL, RINGS), marble);
  shoulders.scale.set(1, 0.55, 0.7);
  shoulders.position.y = base + 0.14;
  g.add(shoulders);
  const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 0.16, RADIAL), marble);
  chest.position.y = base + 0.08;
  g.add(chest);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.08, RADIAL), marble);
  neck.position.y = base + 0.24;
  g.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.08, RADIAL, RINGS), marble);
  head.scale.set(0.9, 1.05, 0.95);
  head.position.set(0, base + 0.34, 0.005);
  g.add(head);
  // Rolled classical hair, and a plain nose so the face has a front.
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.088, RADIAL, RINGS), marble);
  hair.scale.set(0.95, 0.8, 0.95);
  hair.position.set(0, base + 0.37, -0.02);
  g.add(hair);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.05, 12), marble);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, base + 0.33, 0.08);
  g.add(nose);
  return g;
}

/** Cover colours for the book stacks, the desk's three plus a few more spines. */
const BOOK_COLORS = [HEX.bookRed, HEX.bookBlue, HEX.bookCream, 0x46664e, 0x6b4a2f, 0x7a6f9b] as const;

/**
 * A short stack of books, each a flat block with a cream page-block peeking out
 * of its covers, given a little rotation and offset so the pile looks set down
 * rather than shelved. Origin at the base of the bottom book.
 */
function buildBookStack(count: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  const pageMat = new THREE.MeshStandardMaterial({ color: HEX.bookCream, roughness: 0.95 });
  let y = 0;
  for (let i = 0; i < count; i++) {
    const w = 0.19 + ((seed + i) % 3) * 0.02;
    const d = 0.15 + ((seed * 2 + i * 3) % 3) * 0.018;
    const h = 0.032 + ((seed + i * 5) % 3) * 0.01;
    const yaw = (((seed + i * 7) % 5) - 2) * 0.06;

    // Pages sit a hair narrower than the covers so the cream shows on the edges.
    const pages = new THREE.Mesh(roundedBox(w - 0.01, h * 0.6, d - 0.01, 0.004), pageMat);
    pages.position.set(0, y + h / 2, 0);
    pages.rotation.y = yaw;
    g.add(pages);

    // Covers as top and bottom boards plus a spine, leaving the other edges to
    // the pages: a thin board top and bottom, and a slab down one side.
    const boardMat = new THREE.MeshStandardMaterial({
      color: BOOK_COLORS[(seed + i) % BOOK_COLORS.length]!,
      roughness: 0.65,
    });
    for (const by of [y + 0.004, y + h - 0.004]) {
      const board = new THREE.Mesh(roundedBox(w, 0.008, d, 0.004), boardMat);
      board.position.set(0, by, 0);
      board.rotation.y = yaw;
      g.add(board);
    }
    const spine = new THREE.Mesh(roundedBox(0.01, h, d, 0.004), boardMat);
    spine.position.set(Math.cos(yaw) * (w / 2 - 0.005), y + h / 2, -Math.sin(yaw) * (w / 2 - 0.005));
    spine.rotation.y = yaw;
    g.add(spine);

    y += h + 0.003;
  }
  return g;
}

/* ----------------------------- the pit build ----------------------------- */

/**
 * The Miller House conversation pit, reworked in fall brown: a wool bench
 * running unbroken around a square well (blind where the ebony stair drops in),
 * a brown-carpeted floor, a live fire pit at the centre, mugs on the seating,
 * and potted plants, book stacks and a marble bust set out on the floor around
 * the rim.
 *
 * Local origin sits on the surrounding floor at the pit's centre, so every
 * negative Y below is a real step-down measurement. The bench blocks overlap at
 * the corners on purpose: four solid boxes crossing there read as one bench that
 * turns the corner, with no seam to mitre.
 *
 * Returns the group and a per-frame `update` for the fire's flicker.
 */
function buildPit(): { group: THREE.Group; update: (t: number) => void } {
  const pit = new THREE.Group();

  const structure = new THREE.MeshStandardMaterial({
    color: HEX.pitFrame,
    roughness: 0.6,
    metalness: 0.05,
  });
  const carpet = new THREE.MeshStandardMaterial({ color: HEX.pitCarpet, roughness: 1 });
  // Wool, not velvet: a low sheen so the brown reads as a matte upholstery that
  // still catches the lamp along its rolled edges.
  const wool = new THREE.MeshPhysicalMaterial({
    color: HEX.pit,
    roughness: 0.78,
    metalness: 0,
    sheen: 0.7,
    sheenColor: new THREE.Color(HEX.pitLift),
    sheenRoughness: 0.4,
  });
  const ebony = new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.34, metalness: 0.08 });

  const blockH = PIT_DEPTH - SEAT_DROP;
  const blockCY = -(PIT_DEPTH + SEAT_DROP) / 2;
  const seatY = -SEAT_DROP + 0.08;
  const backH = 0.34;

  /* ------------------------------ the bench ------------------------------ */

  for (const { axis, sign } of [
    { axis: "x", sign: 1 },
    { axis: "x", sign: -1 },
    { axis: "z", sign: 1 },
    { axis: "z", sign: -1 },
  ] as const) {
    const x = axis === "x";
    const stairSide = axis === "z" && sign === STAIR_SIGN;

    // Bench: floor of the well up to seat height, the full length of its side.
    const block = new THREE.Mesh(
      roundedBox(x ? SEAT_DEPTH : PIT_W, blockH, x ? PIT_D : SEAT_DEPTH, 0.02),
      structure,
    );
    if (x) block.position.set(sign * (PIT_W / 2 - SEAT_DEPTH / 2), blockCY, 0);
    else block.position.set(0, blockCY, sign * (PIT_D / 2 - SEAT_DEPTH / 2));
    pit.add(block);

    // Low back wall behind the seat, capping the opening so nothing shows
    // through to the void under the floor.
    const wall = new THREE.Mesh(
      roundedBox(x ? WALL_T : PIT_W, SEAT_DROP, x ? PIT_D : WALL_T, 0.01),
      structure,
    );
    if (x) wall.position.set(sign * (PIT_W / 2 - WALL_T / 2), -SEAT_DROP / 2, 0);
    else wall.position.set(0, -SEAT_DROP / 2, sign * (PIT_D / 2 - WALL_T / 2));
    pit.add(wall);

    // Seat and back cushions. On the stair side both part into two stubs,
    // leaving a blind gap in the sofa where the steps come down; every other
    // side runs its full length so the corners meet under the overlap.
    const seatLen = x ? PIT_D : PIT_W;
    const backT = 0.16;
    const backCenter = -SEAT_DROP + backH / 2 + 0.04;

    const addSeat = (len: number, offset: number) => {
      const seat = new THREE.Mesh(
        roundedBox(x ? SEAT_DEPTH - 0.06 : len, 0.16, x ? len : SEAT_DEPTH - 0.06, 0.06),
        wool,
      );
      if (x) seat.position.set(sign * (PIT_W / 2 - SEAT_DEPTH / 2), seatY, offset);
      else seat.position.set(offset, seatY, sign * (PIT_D / 2 - SEAT_DEPTH / 2));
      pit.add(seat);
    };
    const addBack = (len: number, offset: number) => {
      const back = new THREE.Mesh(
        roundedBox(x ? backT : len, backH, x ? len : backT, 0.06),
        wool,
      );
      if (x) back.position.set(sign * (PIT_W / 2 - WALL_T - backT / 2), backCenter, offset);
      else back.position.set(offset, backCenter, sign * (PIT_D / 2 - WALL_T - backT / 2));
      pit.add(back);
    };

    if (!stairSide) {
      addSeat(seatLen, 0);
      addBack(seatLen - 0.04, 0);
    } else {
      const stub = (PIT_W - STAIR_HALF * 2) / 2 - 0.02;
      addSeat(stub, -(STAIR_HALF + stub / 2));
      addSeat(stub, STAIR_HALF + stub / 2);
      addBack(stub, -(STAIR_HALF + stub / 2));
      addBack(stub, STAIR_HALF + stub / 2);
    }
  }

  /* ----------------------------- the footwell ---------------------------- */

  const wellFloor = new THREE.Mesh(
    roundedBox((PIT_W / 2 - SEAT_DEPTH) * 2 + 0.06, 0.04, (PIT_D / 2 - SEAT_DEPTH) * 2 + 0.06, 0.01),
    carpet,
  );
  wellFloor.position.y = -PIT_DEPTH + 0.02;
  pit.add(wellFloor);

  // Carpet climbs the well walls too, so the step down is red on every face
  // rather than a dark box under the red seat.
  const wellInnerX = PIT_W / 2 - SEAT_DEPTH;
  const wellInnerZ = PIT_D / 2 - SEAT_DEPTH;
  for (const { w, d, x, z } of [
    { w: wellInnerX * 2, d: 0.04, x: 0, z: -wellInnerZ },
    { w: wellInnerX * 2, d: 0.04, x: 0, z: wellInnerZ },
    { w: 0.04, d: wellInnerZ * 2, x: -wellInnerX, z: 0 },
    { w: 0.04, d: wellInnerZ * 2, x: wellInnerX, z: 0 },
  ]) {
    const face = new THREE.Mesh(roundedBox(w, blockH, d, 0.01), carpet);
    face.position.set(x, blockCY, z);
    pit.add(face);
  }

  /* ------------------------------ the stair ------------------------------ */

  // Open ebony treads bridging the bench, from the floor edge down to the near
  // edge of the footwell. It lands at the foot of the seating rather than
  // running on toward the middle, so it no longer steps straight into the fire.
  const stair = new THREE.Group();
  const treads = 4;
  const stairTopZ = STAIR_SIGN * (PIT_D / 2 - 0.16);
  const stairBotZ = STAIR_SIGN * (PIT_D / 2 - SEAT_DEPTH + 0.02);
  const stairDrop = PIT_DEPTH - 0.18;
  for (let i = 0; i < treads; i++) {
    const k = i / (treads - 1);
    const tread = new THREE.Mesh(roundedBox(STAIR_HALF * 2, 0.05, 0.26, 0.012), ebony);
    tread.position.set(0, -0.09 - k * stairDrop, stairTopZ + (stairBotZ - stairTopZ) * k);
    stair.add(tread);
  }
  // Two stringers carrying the treads, sloped from the rim down to the footwell.
  const runZ = Math.abs(stairBotZ - stairTopZ);
  const runLen = Math.hypot(runZ, stairDrop);
  for (const sx of [-1, 1]) {
    const stringer = new THREE.Mesh(roundedBox(0.05, 0.12, runLen + 0.12, 0.02), ebony);
    stringer.position.set(sx * STAIR_HALF, -0.09 - stairDrop / 2, (stairTopZ + stairBotZ) / 2);
    stringer.rotation.x = -STAIR_SIGN * Math.atan2(stairDrop, runZ);
    stair.add(stringer);
  }
  pit.add(stair);

  /* ----------------------------- the fire pit ---------------------------- */

  // A stone ring at the centre of the well, a bed of embers, crossed logs, and
  // a cluster of additive flame cones that flicker in `update`.
  const fireY = -PIT_DEPTH + 0.02;
  const basinR = 0.6;
  const stone = new THREE.MeshStandardMaterial({ color: 0x39332d, roughness: 0.95 });

  const basin = new THREE.Mesh(
    new THREE.CylinderGeometry(basinR, basinR * 0.94, 0.2, RADIAL),
    stone,
  );
  basin.position.y = fireY + 0.1;
  pit.add(basin);

  const bowl = new THREE.Mesh(
    new THREE.CylinderGeometry(basinR - 0.07, basinR * 0.55, 0.16, RADIAL),
    new THREE.MeshStandardMaterial({ color: 0x120c08, roughness: 1 }),
  );
  bowl.position.y = fireY + 0.13;
  pit.add(bowl);

  const rimRing = new THREE.Mesh(
    new THREE.TorusGeometry(basinR, 0.045, RINGS / 2, RADIAL),
    new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.5, metalness: 0.5 }),
  );
  rimRing.rotation.x = Math.PI / 2;
  rimRing.position.y = fireY + 0.2;
  pit.add(rimRing);

  // Glowing ember bed, just below the log line.
  const embers = new THREE.Mesh(
    new THREE.CircleGeometry(basinR - 0.12, 48),
    new THREE.MeshBasicMaterial({ color: 0xff7a1e, transparent: true, toneMapped: false }),
  );
  embers.rotation.x = -Math.PI / 2;
  embers.position.y = fireY + 0.16;
  pit.add(embers);

  // Crossed logs.
  const logMat = new THREE.MeshStandardMaterial({ color: 0x3a2414, roughness: 0.85 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI;
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.8, RADIAL), logMat);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = a;
    log.position.set(0, fireY + 0.15 + (i % 2) * 0.05, 0);
    pit.add(log);
  }

  // Flames: two shells each, an orange outer and a brighter inner, additive so
  // they read as light rather than plastic. `update` breathes their height and
  // opacity out of phase so the cluster never sits still.
  const flames: { mesh: THREE.Mesh; baseY: number; phase: number; speed: number }[] = [];
  const flameOuter = 0xff6a1e;
  const flameInner = 0xffd166;
  const flameCount = 9;
  for (let i = 0; i < flameCount; i++) {
    const a = (i / flameCount) * Math.PI * 2;
    const r = (i % 3) * 0.12;
    const inner = i % 2 === 0;
    const h = inner ? 0.34 + (i % 3) * 0.06 : 0.48 + (i % 3) * 0.08;
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(inner ? 0.07 : 0.11, h, 14, 1, true),
      new THREE.MeshBasicMaterial({
        color: inner ? flameInner : flameOuter,
        transparent: true,
        opacity: inner ? 0.9 : 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    );
    flame.position.set(Math.cos(a) * r, fireY + 0.18 + h / 2, Math.sin(a) * r);
    flames.push({ mesh: flame, baseY: h, phase: i * 1.4, speed: 5 + (i % 3) });
    pit.add(flame);
  }

  const fireLight = new THREE.PointLight(0xff7a2a, 3.2, 4.5, 2);
  fireLight.position.set(0, fireY + 0.55, 0);
  pit.add(fireLight);

  /* ------------------------------ the props ------------------------------ */

  // The room's clutter is set out on the floor around the lip of the pit rather
  // than down in it, the way the real pit was ringed with potted flowers. Local
  // y is 0 here: the surrounding floor, not the seating.
  const seatTop = -SEAT_DROP + 0.16;
  const seatX = PIT_W / 2 - SEAT_DEPTH / 2;
  const rimX = PIT_W / 2;
  const rimZ = PIT_D / 2;

  // Plants ringing the whole rim, spread across all four edges rather than
  // banked up at the stair — two per side, kept clear of the stair mouth and
  // the bust. [x, z, scale, tint].
  const plantSpots: [number, number, number, number][] = [
    // desk-facing (-z) edge, flanking the stair
    [-1.75, -(rimZ + 0.22), 1.2, 0x35602f],
    [1.75, -(rimZ + 0.22), 1.15, 0x3f6b3a],
    // left (-x) edge
    [-(rimX + 0.24), 1.35, 1.05, 0x4a7a40],
    [-(rimX + 0.24), -1.55, 1.0, 0x35602f],
    // right (+x) edge, clear of the bust
    [rimX + 0.24, 0.55, 1.1, 0x3f6b3a],
    [rimX + 0.24, 1.6, 0.95, 0x4a7a40],
    // near (+z) edge, behind the seating
    [-1.15, rimZ + 0.22, 1.0, 0x35602f],
    [1.15, rimZ + 0.22, 1.05, 0x3f6b3a],
  ];
  for (const [px, pz, scale, tint] of plantSpots) {
    const plant = buildPlant(9, tint);
    plant.scale.setScalar(scale);
    plant.position.set(px, 0, pz);
    plant.rotation.y = px * 1.7;
    pit.add(plant);
  }

  // Marble bust outside the pit, on the floor at the front-centre rim (the
  // camera side), turned to look back across the pit into the room.
  const statue = buildStatue();
  statue.position.set(0, 0, rimZ + 0.4);
  statue.rotation.y = Math.PI;
  pit.add(statue);

  // A few book stacks set on the floor around the rim, between the plants.
  // [x, z, count, yaw, seed].
  const bookSpots: [number, number, number, number, number][] = [
    [-(rimX + 0.26), -0.4, 4, 0.5, 1],
    [rimX + 0.26, -0.6, 3, -0.7, 4],
    [-1.15, -(rimZ + 0.26), 3, 2.4, 7],
    [rimX + 0.28, 1.05, 2, 1.2, 2],
  ];
  for (const [bx, bz, count, yaw, seed] of bookSpots) {
    const stack = buildBookStack(count, seed);
    stack.position.set(bx, 0, bz);
    stack.rotation.y = yaw;
    pit.add(stack);
  }

  // Mugs stay down on the seating, where a mug actually gets left. Each one
  // breathes a little steam, a column of soft additive puffs that rise, swell
  // and fade on a loop (driven in `update`).
  const steam: { mesh: THREE.Mesh; x0: number; z0: number; baseY: number; phase: number; speed: number }[] = [];
  const addSteam = (x: number, z: number) => {
    const puffs = 6;
    for (let i = 0; i < puffs; i++) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(0.018, 10, 8),
        new THREE.MeshBasicMaterial({
          color: 0xe4e8ea,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      pit.add(puff);
      steam.push({ mesh: puff, x0: x, z0: z, baseY: seatTop + 0.07, phase: i / puffs, speed: 0.32 + (i % 3) * 0.035 });
    }
  };

  const mugA = buildMug(0xcdbfae);
  mugA.position.set(-seatX + 0.2, seatTop, -0.4);
  pit.add(mugA);
  addSteam(-seatX + 0.2, -0.4);

  const mugB = buildMug(0x6b7d6a);
  mugB.position.set(seatX - 0.15, seatTop, 1.25);
  pit.add(mugB);
  addSteam(seatX - 0.15, 1.25);

  /* -------------------------------- lamp --------------------------------- */

  // The pit's own lamp. Every light in the room aims at the desk from beyond
  // this point, so the seating only ever catches their far sides; without this
  // the brown is a black hole in the floor.
  const lamp = new THREE.PointLight(0xffd0a0, 2.4, 6.5, 2);
  lamp.position.set(0, 1.7, 0);
  pit.add(lamp);

  const update = (t: number) => {
    for (const f of flames) {
      const s = 1 + Math.sin(t * f.speed + f.phase) * 0.22;
      f.mesh.scale.y = s;
      f.mesh.position.y = fireY + 0.18 + (f.baseY * s) / 2;
      (f.mesh.material as THREE.MeshBasicMaterial).opacity =
        0.55 + 0.35 * (0.5 + 0.5 * Math.sin(t * f.speed * 1.3 + f.phase));
    }
    fireLight.intensity = 2.9 + Math.sin(t * 9) * 0.5 + Math.sin(t * 15.3) * 0.3;
    (embers.material as THREE.MeshBasicMaterial).opacity = 0.85 + 0.15 * Math.sin(t * 6);

    for (const p of steam) {
      // A looping rise: each puff climbs 0.26m, swelling as it goes and fading
      // in and out so it never pops on or off at the ends of the loop.
      const prog = (t * p.speed + p.phase) % 1;
      p.mesh.position.set(
        p.x0 + Math.sin(prog * 6 + p.phase * 8) * 0.02 * prog,
        p.baseY + prog * 0.26,
        p.z0,
      );
      p.mesh.scale.setScalar(0.5 + prog * 1.9);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.sin(prog * Math.PI) * 0.2;
    }
  };

  return { group: pit, update };
}

/* -------------------------------- assembly ------------------------------- */

export interface Lounge {
  /** Frame loop; drives the fire's flicker. */
  update(elapsed: number): void;
}

/**
 * @param rugCenterZ Where the desk-and-chair ensemble is centred, so the rug
 *                   lands square under it.
 */
export function buildLounge(scene: THREE.Scene, rugCenterZ: number): Lounge {
  const rug = buildRug();
  rug.position.set(0, 0, rugCenterZ);
  scene.add(rug);

  const pit = buildPit();
  pit.group.position.set(PIT.x, 0, PIT.z);
  scene.add(pit.group);

  return { update: pit.update };
}
