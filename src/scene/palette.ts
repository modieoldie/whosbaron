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
  hoodie: 0x2b2e35,
  hoodieDark: 0x22252b,
  denim: 0x232730,
  sneaker: 0xececed,
  sole: 0xc9c9cc,

  chair: 0x1c1e22,
  chairMesh: 0x2a2d33,

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
