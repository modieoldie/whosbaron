/**
 * Desk objects. Each one is a hotspot that opens a card, so the résumé is
 * spatial rather than a list: the framed diploma is school, the books are the
 * languages, the NFC card is the home-automation project, the pad runs Conway.
 */

import * as THREE from "three";
import { HEX } from "./palette";
import { DESK_TOP_Y, DESK_CENTER_Z, DESK_DEPTH } from "./desk";
import { RADIAL, RINGS, roundedBox, strut } from "./geometry";
import {
  makeResumeTexture,
  makeDiplomaTexture,
  type ConwayScreen,
  type PhoneScreen,
} from "./screens";
import { profile, projects, education, skills } from "../data/content";
import type { Hotspot } from "./types";

const byTitle = (title: string) => projects.find((p) => p.title === title)!;

export interface PropsRig {
  hotspots: Hotspot[];
}

export function buildProps(
  scene: THREE.Scene,
  conway: ConwayScreen,
  phoneUi: PhoneScreen,
): PropsRig {
  const group = new THREE.Group();
  scene.add(group);

  const hotspots: Hotspot[] = [];

  /* -------------------------- framed diploma ------------------------ */

  // Stood on the desk rather than hung on the wall: it has to be close enough
  // to the camera's desk framing to be readable, and the easel leg is what
  // sells it as an object in the room instead of a texture on a plane.
  const FRAME_W = 0.3;
  const FRAME_H = 0.232;
  const RAIL = 0.02;

  const diploma = new THREE.Group();
  diploma.position.set(-0.63, DESK_TOP_Y, -1.31);
  diploma.rotation.y = 0.3;

  // Pivots at the desk surface, so leaning it back keeps the bottom edge down.
  const lean = new THREE.Group();
  lean.rotation.x = -0.13;
  diploma.add(lean);

  const woodMaterial = new THREE.MeshStandardMaterial({
    color: HEX.frame,
    roughness: 0.45,
    metalness: 0.05,
  });
  const lipMaterial = new THREE.MeshStandardMaterial({
    color: HEX.frameLip,
    roughness: 0.38,
    metalness: 0.08,
  });

  const backing = new THREE.Mesh(roundedBox(FRAME_W, FRAME_H, 0.012, 0.004), woodMaterial);
  backing.position.y = FRAME_H / 2;
  lean.add(backing);

  const matte = new THREE.Mesh(
    new THREE.PlaneGeometry(FRAME_W - RAIL * 2, FRAME_H - RAIL * 2),
    new THREE.MeshStandardMaterial({ color: HEX.matte, roughness: 0.9 }),
  );
  matte.position.set(0, FRAME_H / 2, 0.0065);
  lean.add(matte);

  const sheetW = FRAME_W - RAIL * 2 - 0.026;
  const parchment = new THREE.Mesh(
    new THREE.PlaneGeometry(sheetW, sheetW * (660 / 880)),
    new THREE.MeshStandardMaterial({ map: makeDiplomaTexture(), roughness: 0.82 }),
  );
  parchment.position.set(0, FRAME_H / 2, 0.007);
  lean.add(parchment);

  // Four rails standing slightly proud of the glass line.
  const rails: THREE.Mesh[] = [];
  for (const [w, h, x, y] of [
    [FRAME_W, RAIL, 0, FRAME_H - RAIL / 2],
    [FRAME_W, RAIL, 0, RAIL / 2],
    [RAIL, FRAME_H - RAIL * 2, -(FRAME_W - RAIL) / 2, FRAME_H / 2],
    [RAIL, FRAME_H - RAIL * 2, (FRAME_W - RAIL) / 2, FRAME_H / 2],
  ] as const) {
    const rail = new THREE.Mesh(roundedBox(w, h, 0.019, 0.003), lipMaterial);
    rail.position.set(x, y, 0.005);
    lean.add(rail);
    rails.push(rail);
  }

  // Glass: barely there, but it catches the desk lamp and reads as a frame.
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(FRAME_W - RAIL * 2, FRAME_H - RAIL * 2),
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.07,
      roughness: 0.06,
      metalness: 0,
    }),
  );
  glass.position.set(0, FRAME_H / 2, 0.0125);
  lean.add(glass);

  const easel = strut(
    { x: 0, y: 0.135, z: -0.022 },
    { x: 0, y: 0.006, z: -0.095 },
    0.005,
    woodMaterial,
  );
  diploma.add(easel);
  group.add(diploma);

  hotspots.push({
    object: diploma,
    id: "diploma",
    label: "University at Buffalo",
    highlight: [backing, ...rails],
    action: {
      type: "card",
      card: {
        eyebrow: "Education",
        title: education[0]!.school,
        // The card body renders with `white-space: pre-line`, so the break is a
        // real newline: the transfer is a separate thought from the degree.
        body: `${education[0]!.degree}, ${education[0]!.detail}.\n\n${education[1]!.note}`,
        meta: [education[0]!.period, education[0]!.location],
      },
    },
  });

  /* --------------------- headphones on their stand ------------------- */

  // Not a stand on the desktop: a clamp-on hook gripping the front edge of the
  // desk, off to the figure's right, with the cans hanging in the knee well.
  // It costs no desk surface, which is the entire reason these things exist.
  const HOOK_X = 0.86;
  /** Front face of the desk top: the vertical edge the clamp grips. */
  const HOOK_Z = DESK_CENTER_Z + DESK_DEPTH / 2;
  /** Drop from the desk top down to the hook bar. */
  const HOOK_DROP = 0.12;
  const HOOK_R = 0.009;

  const metal = new THREE.MeshStandardMaterial({
    color: HEX.monitorStand,
    roughness: 0.38,
    metalness: 0.55,
  });

  // Local origin sits on the desk top, at the front edge. +Z is out of the desk.
  const hanger = new THREE.Group();
  hanger.position.set(HOOK_X, DESK_TOP_Y, HOOK_Z);

  // Clamp: a plate lying on the desk top, folded down over the front edge.
  const clampTop = new THREE.Mesh(roundedBox(0.052, 0.005, 0.06, 0.002), metal);
  clampTop.position.set(0, 0.0025, -0.03);
  hanger.add(clampTop);

  const clampFace = new THREE.Mesh(roundedBox(0.052, 0.062, 0.005, 0.002), metal);
  clampFace.position.set(0, -0.026, 0.0025);
  hanger.add(clampFace);

  // Drop arm down the face, then the bar the band straddles.
  const drop = new THREE.Mesh(
    new THREE.CylinderGeometry(HOOK_R, HOOK_R, HOOK_DROP - 0.05, RADIAL),
    metal,
  );
  drop.position.set(0, -(0.05 + HOOK_DROP) / 2, 0.006);
  hanger.add(drop);

  const elbow = new THREE.Mesh(new THREE.SphereGeometry(HOOK_R, RADIAL, RINGS), metal);
  elbow.position.set(0, -HOOK_DROP, 0.006);
  hanger.add(elbow);

  const bar = new THREE.Mesh(new THREE.CylinderGeometry(HOOK_R, HOOK_R, 0.1, RADIAL), metal);
  bar.rotation.x = Math.PI / 2;
  bar.position.set(0, -HOOK_DROP, 0.056);
  hanger.add(bar);

  // Upturned lip at the end, so the headphones cannot slide off.
  const lip = new THREE.Mesh(new THREE.CylinderGeometry(HOOK_R, HOOK_R, 0.03, RADIAL), metal);
  lip.position.set(0, -HOOK_DROP + 0.015, 0.106);
  hanger.add(lip);

  const lipCap = new THREE.Mesh(new THREE.SphereGeometry(HOOK_R, RADIAL, RINGS), metal);
  lipCap.position.set(0, -HOOK_DROP + 0.03, 0.106);
  hanger.add(lipCap);

  group.add(hanger);

  /** Headband arc radius. Everything below hangs off it. */
  const BAND_R = 0.115;
  const BAND_TUBE = 0.011;
  /**
   * More than a half circle, so the band keeps curving past its widest point
   * and the ends come back in and down, the way a real band cradles a head,
   * rather than the croquet hoop a flat 180° arc reads as.
   */
  const BAND_ARC = Math.PI * 1.32;
  const BAND_HALF = BAND_ARC / 2;
  /** Where the arc ends, measured from the band's own origin. */
  const END_X = BAND_R * Math.sin(BAND_HALF);
  const END_Y = 0.002 + BAND_R * Math.cos(BAND_HALF);

  const headphones = new THREE.Group();
  // The inside of the band's crown rests on top of the hook bar.
  headphones.position.set(
    HOOK_X,
    DESK_TOP_Y - HOOK_DROP + HOOK_R - (0.002 + BAND_R - BAND_TUBE),
    HOOK_Z + 0.05,
  );
  headphones.rotation.y = 0.06;
  const cans = new THREE.MeshStandardMaterial({ color: 0x1b1c20, roughness: 0.6 });

  const band = new THREE.Mesh(
    new THREE.TorusGeometry(BAND_R, BAND_TUBE, RINGS / 2, RADIAL, BAND_ARC),
    cans,
  );
  // The arc sweeps from angle 0; roll it back so its midpoint is the crown.
  band.rotation.z = Math.PI / 2 - BAND_HALF;
  band.position.y = 0.002;
  headphones.add(band);

  for (const side of [-1, 1]) {
    const cup = new THREE.Mesh(
      new THREE.CylinderGeometry(0.034, 0.034, 0.024, RADIAL),
      cans,
    );
    cup.rotation.z = Math.PI / 2;
    // Cups hang just under the ends of the arc.
    cup.position.set(side * END_X, END_Y - 0.02, 0);
    headphones.add(cup);

    // Pad on the inboard face, the side that meets an ear. The black shell is
    // what you see from outside.
    const pad = new THREE.Mesh(
      new THREE.TorusGeometry(0.028, 0.009, RINGS / 2, RADIAL),
      new THREE.MeshStandardMaterial({ color: HEX.brassDim, roughness: 0.7 }),
    );
    pad.rotation.y = Math.PI / 2;
    pad.position.set(side * (END_X - 0.014), END_Y - 0.02, 0);
    headphones.add(pad);
  }
  group.add(headphones);

  const karaoke = byTitle("Karaoke Web Platform");
  hotspots.push({
    object: headphones,
    id: "headphones",
    label: "Karaoke Web Platform",
    highlight: [band],
    action: {
      type: "card",
      card: {
        eyebrow: "Project · " + karaoke.period,
        title: karaoke.title,
        body: karaoke.blurb,
        meta: karaoke.stack,
        link: karaoke.demo ? { label: "Open demo", href: karaoke.demo, external: true } : undefined,
      },
    },
  });

  /* ---------------------------- NFC card ---------------------------- */

  const nfc = new THREE.Mesh(
    roundedBox(0.088, 0.003, 0.056, 0.0012),
    new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.4 }),
  );
  nfc.position.set(-0.42, DESK_TOP_Y + 0.0015, -0.73);
  nfc.rotation.y = 0.35;
  group.add(nfc);

  const nfcMark = new THREE.Mesh(
    new THREE.TorusGeometry(0.013, 0.0022, RINGS / 2, RADIAL, Math.PI * 0.8),
    new THREE.MeshStandardMaterial({ color: HEX.brass, roughness: 0.5, metalness: 0.4 }),
  );
  nfcMark.rotation.set(-Math.PI / 2, 0, 0.35);
  nfcMark.position.set(-0.42, DESK_TOP_Y + 0.004, -0.73);
  group.add(nfcMark);

  const smartHome = byTitle("Smart Home Automation");
  hotspots.push({
    object: nfc,
    id: "nfc",
    label: "NFC tag — Smart Home",
    highlight: [nfc],
    action: {
      type: "card",
      card: {
        eyebrow: "Project · " + smartHome.period,
        title: smartHome.title,
        body: smartHome.blurb,
        meta: smartHome.stack,
      },
    },
  });

  /* --------------------- sketchpad running Conway -------------------- */

  const pad = new THREE.Group();
  pad.position.set(0.68, DESK_TOP_Y + 0.005, -0.95);
  pad.rotation.y = -0.28;

  const padBody = new THREE.Mesh(
    roundedBox(0.2, 0.008, 0.2, 0.003),
    new THREE.MeshStandardMaterial({ color: 0x17171a, roughness: 0.45 }),
  );
  pad.add(padBody);

  const padScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.174, 0.174),
    new THREE.MeshBasicMaterial({ map: conway.texture, toneMapped: false }),
  );
  padScreen.rotation.x = -Math.PI / 2;
  padScreen.position.y = 0.0045;
  pad.add(padScreen);
  group.add(pad);

  const conwayProject = byTitle("Conway's Game of Life");
  hotspots.push({
    object: pad,
    id: "pad",
    label: "Conway's Game of Life",
    highlight: [padBody],
    action: {
      type: "card",
      card: {
        eyebrow: "Project · " + conwayProject.period,
        title: conwayProject.title,
        body: conwayProject.blurb,
        meta: conwayProject.stack,
      },
    },
  });

  /* ----------------------------- books ------------------------------ */

  const books = new THREE.Group();
  books.position.set(-0.88, DESK_TOP_Y, -1.42);
  const bookColors = [HEX.bookCream, HEX.bookRed, HEX.bookBlue];
  const bookMeshes: THREE.Mesh[] = [];
  bookColors.forEach((color, i) => {
    const book = new THREE.Mesh(
      roundedBox(0.16, 0.03, 0.22, 0.005),
      new THREE.MeshStandardMaterial({ color, roughness: 0.8 }),
    );
    book.position.set(i * 0.004, 0.016 + i * 0.031, 0);
    book.rotation.y = (i - 1) * 0.06;
    books.add(book);
    bookMeshes.push(book);
  });
  group.add(books);

  hotspots.push({
    object: books,
    id: "books",
    label: "Languages & tooling",
    highlight: bookMeshes,
    action: {
      type: "card",
      card: {
        eyebrow: "Skills",
        title: "The stack, roughly in order of comfort",
        // A blank line between groups: four dense comma lists stacked directly
        // on top of each other read as one paragraph of nouns.
        body: skills.map((s) => `${s.group}: ${s.items.join(", ")}.`).join("\n\n"),
      },
    },
  });

  /* -------------------------- résumé tray --------------------------- */

  const tray = new THREE.Group();
  tray.position.set(-0.78, DESK_TOP_Y, -0.86);
  tray.rotation.y = 0.22;

  const trayBase = new THREE.Mesh(
    roundedBox(0.23, 0.006, 0.3, 0.0024),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.5, metalness: 0.3 }),
  );
  tray.add(trayBase);

  const sheet = new THREE.Mesh(
    new THREE.PlaneGeometry(0.205, 0.265),
    new THREE.MeshStandardMaterial({ map: makeResumeTexture(), roughness: 0.85 }),
  );
  sheet.rotation.x = -Math.PI / 2;
  sheet.position.set(0, 0.005, 0);
  tray.add(sheet);
  group.add(tray);

  hotspots.push({
    object: tray,
    id: "resume",
    label: "Résumé — open PDF",
    highlight: [trayBase],
    action: {
      type: "card",
      card: {
        eyebrow: "Document",
        title: "Résumé",
        body: "One page, kept current. Everything on these monitors, compressed into something a recruiter can skim in forty seconds.",
        link: { label: "Open PDF", href: profile.resume, external: true },
      },
    },
  });

  /* ----------------------------- phone ------------------------------ */

  const phone = new THREE.Group();
  phone.position.set(0.42, DESK_TOP_Y + 0.004, -0.7);
  phone.rotation.y = -0.6;

  const phoneBody = new THREE.Mesh(
    roundedBox(0.072, 0.008, 0.148, 0.0032),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.3, metalness: 0.5 }),
  );
  phone.add(phoneBody);

  const phoneScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.062, 0.134),
    new THREE.MeshBasicMaterial({ map: phoneUi.texture, toneMapped: false }),
  );
  phoneScreen.rotation.x = -Math.PI / 2;
  phoneScreen.position.y = 0.0045;
  phone.add(phoneScreen);
  group.add(phone);

  hotspots.push({
    object: phone,
    id: "phone",
    label: "Get in touch",
    highlight: [phoneBody],
    action: {
      type: "card",
      card: {
        eyebrow: "Contact",
        title: "Open to 2027 internships and new-grad roles",
        body: `${profile.email}\n${profile.phone}\n${profile.location}`,
        link: { label: "Send an email", href: `mailto:${profile.email}` },
      },
    },
  });

  return { hotspots };
}
