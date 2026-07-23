/**
 * One palette, two consumers: Three.js materials (hex numbers) and the
 * 2D canvas textures painted onto the monitors (CSS strings). Keeping them
 * in one file is the only reason the screens look like they belong in the room.
 */

export const HEX = {
  ink: 0x0a0a0b,
  wall: 0x17171a,
  wallWarm: 0x1d1c1f,
  floor: 0x121214,
  rug: 0x24242a,

  deskTop: 0xf2f1ee,
  deskEdge: 0xe2e0da,
  deskLeg: 0xd8d6d0,

  monitorShell: 0x1a1a1d,
  monitorStand: 0x232327,
  tower: 0x151518,

  keyboard: 0x0c0c0e,
  keycap: 0x131318,

  brass: 0xc9a961,
  brassDim: 0x8a7440,
  steel: 0x6b8299,

  skin: 0xc08a63,
  skinShade: 0xa87652,
  hair: 0x16141a,
  zip: 0x2b2e35,
  zipDark: 0x22252b,
  tee: 0xd7d5d0,
  denim: 0x232730,
  sneaker: 0xececed,
  sole: 0xc9c9cc,

  chair: 0x1c1e22,
  chairMesh: 0x2a2d33,

  // The cut edge of the rug pile: the dark side of its woven field, so the
  // slab's sides read as the same cloth as its face.
  velvetDeep: 0x4d1a24,

  // Warm fall-brown wool for the conversation pit's wraparound seating, after
  // the Miller House pit this is lifted from, plus a near-black ebony for its
  // stair and bench frame. The seat runs bright where the pile faces the lamp
  // and near-black in the wells; `pitLift` is only the colour of that sheen.
  pit: 0x6f4a2b,
  pitLift: 0x9a6a3c,
  pitDeep: 0x452c17,
  pitFrame: 0x241a12,
  pitCarpet: 0x5a3a20,

  // Dark brown mackerel tabby: one hue at four values, so stripe against
  // ground, toe against leg and nose against muzzle all separate on lightness
  // alone. Mixed per-vertex and never used flat. Any darker and the bands stop
  // resolving in a room lit like this one.
  catFur: 0x6a5335,
  catStripe: 0x342719,
  catSpine: 0x241a10,
  catCream: 0x7c6440, // underside; a lighter brown, not a cream
  catSock: 0x8a7047, // toes; the lightest brown she has
  catNose: 0x5c4032, // darker than the muzzle, or it reads as a highlight
  catEar: 0x6d4c3c,

  frame: 0x3b2b1d,
  frameLip: 0x4d3a27,
  matte: 0xece5d4,
  paper: 0xf6f5f2,
  bookRed: 0x8c3b32,
  bookBlue: 0x2f4a6b,
  bookCream: 0xd8cfbd,
} as const;

export const CSS = {
  ink: "#0a0a0b",
  surface: "#141416",
  surface2: "#1b1b1e",
  surface3: "#212126",
  hairline: "#2a2a2e",
  bone: "#ededed",
  ash: "#8b8b93",
  ashDim: "#5f5f66",
  brass: "#c9a961",
  brassDim: "#8a7440",
  steel: "#6b8299",
  green: "#7fb069",
  amber: "#d8a657",
  red: "#c96a5e",
} as const;

export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
export const SANS = '"Inter", system-ui, sans-serif';
