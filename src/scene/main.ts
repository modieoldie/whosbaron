/**
 * Bootstrap: renderer, camera rig, the two views (orbit / desk), and the wiring
 * between 3D hotspots and the DOM overlay.
 *
 * Two camera states, one tween between them. Orbit is the default — you are
 * over the room and can swing around it. Clicking the desk flies you in until
 * the monitors fill the frame, and they become clickable.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

import { buildRoom, ROOM_CENTER_Z } from "./room";
import { buildDesk, MONITOR_X, SCREEN_W, SCREEN_Y, SCREEN_Z } from "./desk";
import { buildProps } from "./props";
import { ProjectsScreen, AboutScreen, ConwayScreen } from "./screens";
import { Interaction } from "./interaction";
import { PropMarkers } from "./markers";
import type { CardContent, HotspotAction, Hotspot } from "./types";
import { projects } from "../data/content";

/* ------------------------------ views ------------------------------ */

// The landing view. `ORBIT_PULLBACK` scales the camera's offset from the target,
// so 1.5 sits it half again as far out as the framing the angle was chosen at —
// same direction, more room around him.
const ORBIT_PULLBACK = 1.5;
// Screen-space nudge, in metres along the camera's own right axis. The ensemble
// is centred on the origin, but its mass is not: the shelf, the tray and the
// books all sit out to the left, so aiming at the origin lands the room off to
// the right of frame. Panning the whole rig — camera and pivot together, so
// orbiting still turns about the same point — recentres it.
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
// has to hold the whole desktop, and everything worth clicking — the tray, the
// pad, the phone, the NFC card — sits below the screens, not level with them.
const DESK_TARGET = new THREE.Vector3(0, SCREEN_Y - 0.3, SCREEN_Z);
// Up and in front, looking down across the desk from about where your own head
// would be. The pitch is what puts the desk surface in frame at all: shallower
// and the near props fall off the bottom of the screen.
const DESK_DIR = new THREE.Vector3(0, 0.26, 1).normalize();
// Width the framing has to cover. Wider than the two panels themselves (2.08)
// because the props out at the edges of the desk — the books, the sketchpad —
// sit closer to the camera than the screens do and so read wider than they are.
const DESK_SPAN = MONITOR_X * 2 + SCREEN_W + 0.42;
// Floor on the flight-in distance. At wide aspect ratios the horizontal fit is
// satisfied long before the vertical one, and the desk top is the thing that
// runs out of frame first — this is how far back the near edge of the desk needs
// the camera to be.
const DESK_MIN_DIST = 1.98;

type ViewName = "orbit" | "desk";

/**
 * The standing line at the foot of the screen. It changes with the view because
 * the two views need different things said: out in the room, how to move; at the
 * desk, which panel is which — the right monitor is the about page, and nothing
 * about a wall of text says so on its own.
 */
const HINTS: Record<ViewName, string> = {
  orbit: "Drag to look around · Click the desk to pull up a chair",
  desk: "Left screen — projects · Right screen — about me & contact",
};

// How long to wait on the Google Fonts request before painting the monitors
// with whatever is available.
const FONT_TIMEOUT_MS = 3000;

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
    // bypasses entirely — without this, every silhouette in the scene crawls
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

  // Canvas text is the entire content of the monitors — painting before the
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
  controls.zoomSpeed = 0.7;

  /* ---------------------------- content ---------------------------- */

  const screens = {
    projects: new ProjectsScreen(),
    about: new AboutScreen(),
    conway: new ConwayScreen(),
  };

  buildRoom(scene);
  const desk = buildDesk(scene, screens);
  const props = buildProps(scene, screens.conway);

  /* ---------------------------- hotspots --------------------------- */

  // The desk surface and both monitors all mean "take me in".
  const focusHotspots: Hotspot[] = [
    { object: desk.deskTop, id: "desk", label: "Pull up to the desk", action: { type: "focus-desk" } },
    { object: desk.projectsScreen, id: "screen-left", label: "Projects — click to read", action: { type: "focus-desk" } },
    { object: desk.aboutScreen, id: "screen-right", label: "About me & contact", action: { type: "focus-desk" } },
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
      0.42, // strength — enough for the screens to bleed, not enough to fog the room
      0.6,
      0.85,
    );
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }

  /* --------------------------- view state -------------------------- */

  const DESK_VIEW = { position: new THREE.Vector3(), target: DESK_TARGET };

  /**
   * How far back the camera has to sit for the whole desk — both monitors and
   * everything standing on the surface — to fit in frame. Derived from the
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

  function goTo(next: ViewName) {
    if (view === next && !tween) return;
    view = next;
    const destination = next === "desk" ? DESK_VIEW : ORBIT_VIEW;

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
    dom.hintText.textContent = HINTS[next];
    dom.hint.dataset.visible = "true";
    dom.back.dataset.visible = String(next === "desk");
    if (next === "desk") closeCard();
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
        goTo("desk");
        break;
      case "card":
        openCard(action.card);
        break;
      case "projects":
        goTo("desk");
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
  dom.cardClose.addEventListener("click", closeCard);

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (dom.card.dataset.visible === "true") closeCard();
      else if (view === "desk") goTo("orbit");
      return;
    }
    if (view !== "desk") return;
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
    screens.projects.render();
    screens.about.render();
    screens.conway.render();

    if (tween) {
      tween.t = Math.min(tween.t + dt / tween.duration, 1);
      const k = easeInOutCubic(tween.t);
      camera.position.lerpVectors(tween.fromPos, tween.to.position, k);
      controls.target.lerpVectors(tween.fromTarget, tween.to.target, k);
      camera.lookAt(controls.target);
      if (tween.t >= 1) finishTween();
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

    interaction.update();
    propMarkers.update(elapsed, interaction.hoveredId, view === "orbit" && !tween);

    if (composer) composer.render();
    else renderer.render(scene, camera);
  }

  frame();

  // First frame is on screen; drop the loader.
  requestAnimationFrame(() => {
    dom.loader.dataset.visible = "false";
    dom.intro.dataset.visible = "true";
    dom.hint.dataset.visible = "true";
  });
}
