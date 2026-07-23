/**
 * Bootstrap: renderer, camera rig, the two views (orbit / desk), and the wiring
 * between 3D hotspots and the DOM overlay.
 *
 * Two camera states, one tween between them. Orbit is the default: you are over
 * the room and can swing around it. Clicking the desk flies you in until the
 * monitors fill the frame, and they become clickable.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

import { buildRoom, ROOM_CENTER_Z } from "./room";
import { buildDesk, MONITOR_X, SCREEN_W, SCREEN_Y, SCREEN_Z } from "./desk";
import { buildLounge } from "./lounge";
import { buildProps } from "./props";
import { buildFigure } from "./figure";
import { buildCat } from "./cat";
import { buildSunbeam } from "./sunbeam";
import { buildDust } from "./dust";
import { ProjectsScreen, AboutScreen, ConwayScreen, PhoneScreen } from "./screens";
import { ScreenGlow } from "./glow";
import { Interaction } from "./interaction";
import { ScreenFocus } from "./screenfocus";
import { PropMarkers } from "./markers";
import type { CardContent, HotspotAction, Hotspot } from "./types";
import { projects } from "../data/content";

/* ------------------------------ views ------------------------------ */

// The landing view. `ORBIT_PULLBACK` scales the camera's offset from the target,
// so 1.5 sits it half again as far out as the framing the angle was chosen at:
// same direction, more room around him.
const ORBIT_PULLBACK = 1.5;
// Screen-space nudge, in metres along the camera's own right axis. The ensemble
// is centred on the origin, but its mass is not: the shelf, the tray and the
// books all sit out to the left, so aiming at the origin lands the room off to
// the right of frame. Panning the whole rig recentres it: camera and pivot
// together, so orbiting still turns about the same point.
const ORBIT_SHIFT = 0.35;

const ORBIT_TARGET = new THREE.Vector3(0, 0.95, ROOM_CENTER_Z);
const ORBIT_EYE = ORBIT_TARGET.clone().add(
  new THREE.Vector3(2.6, 2.05, 2.35).sub(ORBIT_TARGET).multiplyScalar(ORBIT_PULLBACK),
);
// Right of the view, flattened onto the ground plane so the pan is level.
const ORBIT_RIGHT = new THREE.Vector3()
  .subVectors(ORBIT_EYE, ORBIT_TARGET)
  .setY(0)
  .cross(new THREE.Vector3(0, -1, 0))
  .normalize()
  .multiplyScalar(ORBIT_SHIFT);

const ORBIT_VIEW = {
  position: ORBIT_EYE.add(ORBIT_RIGHT),
  target: ORBIT_TARGET.add(ORBIT_RIGHT),
};

// Aimed at the bottom edge of the panels rather than their middle: the desk view
// has to hold the whole desktop, and everything worth clicking (tray, pad,
// phone, NFC card) sits below the screens, not level with them.
const DESK_TARGET = new THREE.Vector3(0, SCREEN_Y - 0.3, SCREEN_Z);
// Up and in front, looking down across the desk from about where your own head
// would be. The pitch is what puts the desk surface in frame at all: shallower
// and the near props fall off the bottom of the screen.
const DESK_DIR = new THREE.Vector3(0, 0.26, 1).normalize();
// Width the framing has to cover. Wider than the two panels themselves (2.08)
// because the props out at the edges of the desk, the books and the sketchpad,
// sit closer to the camera than the screens do and so read wider than they are.
const DESK_SPAN = MONITOR_X * 2 + SCREEN_W + 0.42;
// Floor on the flight-in distance. At wide aspect ratios the horizontal fit is
// satisfied long before the vertical one, and the desk top is the thing that
// runs out of frame first. This is how far back the near edge of the desk needs
// the camera to be.
const DESK_MIN_DIST = 1.98;

// A phone held upright, where the desk view's framing gives out (see
// `screenfocus.ts`). Landscape phones clear this comfortably and get the desk
// view exactly as a desktop does.
const NARROW_ASPECT = 1.25;
const COARSE_POINTER = window.matchMedia("(pointer: coarse)").matches;

/** Whether this viewport has to read the monitors one at a time. */
function narrowViewport() {
  return COARSE_POINTER && window.innerWidth / window.innerHeight < NARROW_ASPECT;
}

type ViewName = "orbit" | "desk" | "screen";

/**
 * The standing line at the foot of the screen. It changes with the view because
 * the views need different things said: out in the room, how to move; at the
 * desk, which panel is which, since nothing about a wall of text says that the
 * right monitor is the about page.
 *
 * And it changes with the input, because "drag" and "click" are not what a
 * visitor on a phone does, nor is either one of them what they need told: on a
 * single panel filling the frame, the thing worth saying is that it zooms.
 */
const HINTS: Record<ViewName, string> = {
  orbit: "Drag to look around · Click the desk",
  desk: "Left screen — projects · Right screen — about me & contact",
  screen: "Pinch to zoom · Drag to move around the screen",
};

const TOUCH_HINTS: Partial<Record<ViewName, string>> = {
  orbit: "Swipe to look around · Tap the desk",
  desk: "Left screen — projects · Right screen — about me & contact",
};

// How long to wait on the Google Fonts request before painting the monitors
// with whatever is available.
const FONT_TIMEOUT_MS = 3000;

// Fraction of the flight the figure's dissolve occupies. Short enough that he
// is gone well before the camera arrives where he is sitting.
const DISSOLVE_SPAN = 0.55;

const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/* ---------------------------- quality ------------------------------ */

function detectQuality() {
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const small = window.innerWidth < 900;
  const lowPower = coarse || small || navigator.hardwareConcurrency <= 4;

  return {
    bloom: !lowPower,
    // MSAA for the composer's offscreen buffer. `antialias: true` on the
    // renderer only covers the default framebuffer, which the composer
    // bypasses entirely. Without this, every silhouette in the scene crawls
    // with stair-steps as you orbit.
    samples: lowPower ? 2 : 4,
    pixelRatio: Math.min(window.devicePixelRatio, lowPower ? 1.5 : 2),
  };
}

/* ------------------------------ boot ------------------------------- */

export async function boot() {
  const canvas = document.getElementById("scene-canvas") as HTMLCanvasElement | null;
  // Throwing rather than returning: a silent return leaves the loader up
  // forever, which reads as a hang. The caller redirects to /text instead.
  if (!canvas) throw new Error("#scene-canvas is missing");

  const dom = {
    loader: document.getElementById("loader")!,
    label: document.getElementById("hover-label")!,
    propMarkers: document.getElementById("prop-markers")!,
    intro: document.getElementById("intro")!,
    hint: document.getElementById("hint")!,
    hintText: document.getElementById("hint-text")!,
    back: document.getElementById("back-btn")!,
    screenSwitch: document.getElementById("screen-switch")!,
    screenTabs: [...document.querySelectorAll<HTMLButtonElement>("#screen-switch button")],
    card: document.getElementById("card")!,
    cardEyebrow: document.getElementById("card-eyebrow")!,
    cardTitle: document.getElementById("card-title")!,
    cardBody: document.getElementById("card-body")!,
    cardMeta: document.getElementById("card-meta")!,
    cardLink: document.getElementById("card-link") as HTMLAnchorElement,
    cardClose: document.getElementById("card-close")!,
  };

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const quality = detectQuality();

  // Canvas text is the entire content of the monitors, so painting before the
  // webfont resolves bakes a fallback into the texture permanently. Worth
  // waiting for, but never indefinitely: the fonts come from a third party, and
  // an ad blocker or a captive proxy can leave that request pending forever.
  // Losing the serif on the monitors beats stranding someone on the loader.
  try {
    await Promise.race([
      document.fonts.ready,
      new Promise((resolve) => setTimeout(resolve, FONT_TIMEOUT_MS)),
    ]);
  } catch {
    /* Font loading API unavailable; fallbacks are fine. */
  }

  /* --------------------------- renderer --------------------------- */

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(quality.pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 60);
  camera.position.copy(ORBIT_VIEW.position);

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(ORBIT_VIEW.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = false;
  controls.minDistance = 1.9;
  controls.maxDistance = 9;
  controls.minPolarAngle = 0.15;
  controls.maxPolarAngle = 1.5; // stop just above the floor plane
  // No walls, so no arc to clamp: the room is open all the way round and you
  // can swing to the front of the desk and look back at him.
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 2.0;

  /* ---------------------------- content ---------------------------- */

  const screens = {
    projects: new ProjectsScreen(),
    about: new AboutScreen(),
    conway: new ConwayScreen(),
    phone: new PhoneScreen(),
  };

  const room = buildRoom(scene);
  const desk = buildDesk(scene, screens);
  // The patterned rug under the desk, plus the sunken conversation pit behind
  // the chair. Nothing here is clickable: it is set dressing for depth, not
  // another thing to hunt through.
  const lounge = buildLounge(scene, ROOM_CENTER_Z);
  const props = buildProps(scene, screens.conway, screens.phone);
  const cat = buildCat(scene);
  // After the room, so the additive passes sort on top of the surfaces.
  const sunbeam = buildSunbeam(scene);
  const dust = buildDust(scene);
  dust.setPixelRatio(quality.pixelRatio);

  // The monitors' spill never sits still: it breathes a few percent and takes
  // its cast from whatever the panel is showing.
  const glow = new ScreenGlow([
    { light: room.screenGlow[0]!, source: screens.projects, tint: 0.3, breath: 0.045 },
    { light: room.screenGlow[1]!, source: screens.about, tint: 0.3, breath: 0.045 },
  ]);

  // Dropped onto the chair rather than positioned by eye: the figure is built
  // at true room heights, so copying the chair's own transform is the whole
  // placement, and moving the chair moves him with it.
  const figure = buildFigure();
  figure.group.position.copy(desk.chair.position);
  figure.group.rotation.y = desk.chair.rotation.y;
  scene.add(figure.group);

  /* ---------------------------- hotspots --------------------------- */

  // The desk surface and both monitors all mean "take me in".
  const focusHotspots: Hotspot[] = [
    { object: desk.deskTop, id: "desk", label: "Pull up to the desk", action: { type: "focus-desk", screen: 0 } },
    { object: desk.projectsScreen, id: "screen-left", label: "Projects — click to read", action: { type: "focus-desk", screen: 0 } },
    { object: desk.aboutScreen, id: "screen-right", label: "About me & contact", action: { type: "focus-desk", screen: 1 } },
  ];

  const hotspots = [...props.hotspots, ...focusHotspots];

  /* ------------------------- post-processing ----------------------- */

  let composer: EffectComposer | null = null;
  if (quality.bloom) {
    // The composer's default buffer has no MSAA, so hand it one that does.
    const buffer = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: quality.samples,
    });
    composer = new EffectComposer(renderer, buffer);
    composer.setSize(window.innerWidth, window.innerHeight);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.42, // strength: enough for the screens to bleed, not enough to fog the room
      0.6,
      0.85,
    );
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }

  /* --------------------------- view state -------------------------- */

  const DESK_VIEW = { position: new THREE.Vector3(), target: DESK_TARGET };

  /**
   * How far back the camera has to sit for the whole desk, both monitors and
   * everything standing on the surface, to fit in frame. Derived from the
   * aspect ratio rather than hard-coded: the monitors are wide enough that a
   * portrait window would crop them otherwise.
   */
  function updateDeskView() {
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    const needed = DESK_SPAN / 2 / (Math.tan(halfFov) * camera.aspect);
    DESK_VIEW.position
      .copy(DESK_DIR)
      .multiplyScalar(THREE.MathUtils.clamp(needed, DESK_MIN_DIST, 5.2))
      .add(DESK_TARGET);
  }
  updateDeskView();

  let view: ViewName = "orbit";
  let tween: { fromPos: THREE.Vector3; fromTarget: THREE.Vector3; to: typeof ORBIT_VIEW; t: number; duration: number } | null = null;
  const parallax = new THREE.Vector2();

  /**
   * @param screen Which panel the reading view should open on. Ignored by the
   *               orbit and desk views, which don't single one out.
   */
  function goTo(next: ViewName, screen = 0) {
    // Re-tapping the other monitor while already in the reading view is a page
    // turn, not a no-op, so the early-out has to let a screen change through.
    if (view === next && !tween && !(next === "screen" && screen !== screenFocus.screen)) return;
    view = next;
    if (next === "screen") screenFocus.focus(screen);
    const destination =
      next === "desk" ? DESK_VIEW : next === "screen" ? screenFocus.view : ORBIT_VIEW;

    tween = {
      fromPos: camera.position.clone(),
      fromTarget: controls.target.clone(),
      to: destination,
      t: 0,
      duration: reducedMotion ? 0.01 : 1.35,
    };

    controls.enabled = false;
    interaction.enabled = false;
    interaction.screensLive = false;
    // The screens stop being hit-tested the moment the camera moves, so a link
    // left lit under the pointer would stay lit for the whole flight out.
    screens.projects.setHoveredLink(-1);
    screens.about.setHoveredLink(-1);

    dom.intro.dataset.visible = String(next === "orbit");
    dom.hintText.textContent = (COARSE_POINTER && TOUCH_HINTS[next]) || HINTS[next];
    dom.hint.dataset.view = next;
    dom.hint.dataset.visible = "true";
    dom.back.dataset.visible = String(next !== "orbit");
    // The panel switcher only exists in the reading view: it is the one view
    // that shows a single monitor and so needs a way to reach the other.
    dom.screenSwitch.dataset.visible = String(next === "screen");
    dom.screenTabs.forEach((tab, i) => {
      tab.dataset.active = String(next === "screen" && i === screen);
    });
    if (next !== "orbit") closeCard();
  }

  /**
   * How solid the figure is this frame. He owns the orbit view but obstructs
   * the desk one, sitting in front of the monitors, so the flight in dissolves
   * him.
   *
   * Front-loaded on the way in and back-loaded on the way out, both against the
   * eased camera progress rather than raw time: he has to be gone before the
   * camera reaches him, and on the way back he should not fade up until the
   * chair is far enough away to see the whole of him arrive.
   */
  function figureOpacity(): number {
    if (!tween) return view === "orbit" ? 1 : 0;
    const k = easeInOutCubic(tween.t);
    return view !== "orbit"
      ? 1 - Math.min(k / DISSOLVE_SPAN, 1)
      : Math.max(0, (k - (1 - DISSOLVE_SPAN)) / DISSOLVE_SPAN);
  }

  function finishTween() {
    interaction.enabled = true;
    if (view === "orbit") {
      controls.enabled = true;
    } else {
      interaction.screensLive = true;
    }
    tween = null;
  }

  /* ----------------------------- cards ----------------------------- */

  function openCard(card: CardContent) {
    dom.cardEyebrow.textContent = card.eyebrow;
    dom.cardTitle.textContent = card.title;
    dom.cardBody.textContent = card.body;

    dom.cardMeta.innerHTML = "";
    for (const item of card.meta ?? []) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = item;
      dom.cardMeta.append(chip);
    }
    dom.cardMeta.dataset.visible = String((card.meta?.length ?? 0) > 0);

    if (card.link) {
      dom.cardLink.textContent = card.link.label;
      dom.cardLink.href = card.link.href;
      if (card.link.external) {
        dom.cardLink.target = "_blank";
        dom.cardLink.rel = "noopener noreferrer";
      } else {
        dom.cardLink.removeAttribute("target");
        dom.cardLink.removeAttribute("rel");
      }
      dom.cardLink.dataset.visible = "true";
    } else {
      dom.cardLink.dataset.visible = "false";
    }

    dom.card.dataset.visible = "true";
  }

  function closeCard() {
    dom.card.dataset.visible = "false";
  }

  function handleAction(action: HotspotAction) {
    switch (action.type) {
      case "focus-desk":
        goTo(narrowViewport() ? "screen" : "desk", action.screen ?? 0);
        break;
      case "card":
        openCard(action.card);
        break;
      case "projects":
        goTo(narrowViewport() ? "screen" : "desk", 0);
        break;
    }
  }

  /* -------------------------- interaction -------------------------- */

  const interaction = new Interaction(
    canvas,
    camera,
    hotspots,
    desk.projectsScreen,
    screens.projects,
    desk.aboutScreen,
    screens.about,
    dom.label,
    {
      onAction: handleAction,
      onProjectHover: () => {},
      onProjectSelect: (index) => screens.projects.setSelected(index),
      // Fired from pointerup, so this counts as a user gesture and survives
      // popup blockers. mailto: is left to the browser's handler rather than
      // opened in a tab that would sit there blank afterwards.
      onScreenLink: (href) =>
        href.startsWith("mailto:")
          ? (window.location.href = href)
          : window.open(href, "_blank", "noopener,noreferrer"),
    },
  );

  // Pinch/drag rig for the narrow-viewport reading view. Constructed on every
  // device, costing two quaternion reads, but its listeners ignore anything
  // that isn't a finger and it only steers the camera while `active`.
  const screenFocus = new ScreenFocus(canvas, camera, [desk.projectsScreen, desk.aboutScreen], {
    paneGrabbed: () => interaction.grabbingPane,
    cancelTap: () => interaction.cancelTap(),
  });

  // Built from the props rather than every hotspot: the desk and the monitors
  // explain themselves, and marking them would only add dots to ignore.
  const propMarkers = new PropMarkers(
    dom.propMarkers,
    props.hotspots,
    camera,
    scene.children,
    canvas,
    reducedMotion,
  );

  dom.back.addEventListener("click", () => goTo("orbit"));
  dom.screenTabs.forEach((tab, i) => tab.addEventListener("click", () => goTo("screen", i)));
  dom.cardClose.addEventListener("click", closeCard);

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (dom.card.dataset.visible === "true") closeCard();
      else if (view !== "orbit") goTo("orbit");
      return;
    }
    if (view === "orbit") return;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      screens.projects.setSelected((screens.projects.selected + 1) % projects.length);
      event.preventDefault();
    }
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      screens.projects.setSelected((screens.projects.selected - 1 + projects.length) % projects.length);
      event.preventDefault();
    }
    // Arrows move between projects, so paging keys read the one you're on.
    if (event.key === "PageDown" || event.key === " ") {
      screens.projects.scrollBy(screens.projects.pageScroll);
      event.preventDefault();
    }
    if (event.key === "PageUp") {
      screens.projects.scrollBy(-screens.projects.pageScroll);
      event.preventDefault();
    }
    if (event.key === "Home") {
      screens.projects.scrollTo(0);
      event.preventDefault();
    }
    if (event.key === "End") {
      screens.projects.scrollTo(screens.projects.maxScroll);
      event.preventDefault();
    }
  });

  window.addEventListener("pointermove", (event) => {
    // Normalised to [-1, 1] for the desk-view parallax drift.
    parallax.set(
      (event.clientX / window.innerWidth) * 2 - 1,
      (event.clientY / window.innerHeight) * 2 - 1,
    );
  });

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    updateDeskView();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer?.setSize(window.innerWidth, window.innerHeight);

    // Turning a phone sideways swaps which framing can hold the monitors, so
    // the visitor is moved to whichever one now works, landing on the panel
    // they were already reading.
    if (view === "screen" && !narrowViewport()) goTo("desk");
    else if (view === "desk" && narrowViewport()) goTo("screen", screenFocus.screen);
  });

  /* ------------------------------ loop ----------------------------- */

  const clock = new THREE.Clock();
  let elapsed = 0;

  function frame() {
    requestAnimationFrame(frame);

    const dt = Math.min(clock.getDelta(), 0.1);
    elapsed += dt;

    screens.about.update(dt);
    screens.conway.update(dt);
    screens.phone.update(dt);
    screens.projects.render();
    screens.about.render();
    screens.conway.render();
    screens.phone.render();
    // After the repaints, so a screen that just changed is sampled this frame
    // rather than the next one.
    glow.update(elapsed, dt);
    sunbeam.update(elapsed);
    dust.update(elapsed);
    lounge.update(elapsed);

    // Driven every frame even while he is dissolved out: the idle is built from
    // continuous sines, and freezing it would mean he snaps to a new pose the
    // moment he fades back in at the end of the flight out.
    figure.update(elapsed);
    // She stays put through the flight in: on the desk, not in the way of it,
    // so unlike him she never dissolves.
    cat.update(elapsed);

    // Kept current before it is read, so a pinch mid-flight is followed rather
    // than snapped to on arrival.
    screenFocus.active = view === "screen";
    if (screenFocus.active) screenFocus.update();

    if (tween) {
      tween.t = Math.min(tween.t + dt / tween.duration, 1);
      const k = easeInOutCubic(tween.t);
      camera.position.lerpVectors(tween.fromPos, tween.to.position, k);
      controls.target.lerpVectors(tween.fromTarget, tween.to.target, k);
      camera.lookAt(controls.target);
      if (tween.t >= 1) finishTween();
    } else if (view === "screen") {
      camera.position.copy(screenFocus.view.position);
      camera.lookAt(screenFocus.view.target);
    } else if (view === "desk") {
      // Slight drift so the close-up doesn't feel like a frozen screenshot.
      camera.position.set(
        DESK_VIEW.position.x + parallax.x * 0.035,
        DESK_VIEW.position.y - parallax.y * 0.022,
        DESK_VIEW.position.z,
      );
      camera.lookAt(DESK_TARGET);
    } else {
      controls.update();
    }

    // Dust rides the figure's curve: both belong to the room, and both are in
    // the way once the camera is at the monitors.
    const presence = figureOpacity();
    figure.setOpacity(presence);
    dust.setPresence(presence);

    interaction.update();
    propMarkers.update(elapsed, interaction.hoveredId, view === "orbit" && !tween);

    if (composer) composer.render();
    else renderer.render(scene, camera);
  }

  frame();

  // The markup ships the mouse wording, since that is what most visitors get
  // and it should be right before any script runs. A finger needs the other one.
  if (COARSE_POINTER) dom.hintText.textContent = TOUCH_HINTS.orbit!;

  // First frame is on screen; drop the loader.
  requestAnimationFrame(() => {
    dom.loader.dataset.visible = "false";
    dom.intro.dataset.visible = "true";
    dom.hint.dataset.visible = "true";
  });
}
