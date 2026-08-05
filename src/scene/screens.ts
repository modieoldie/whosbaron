/**
 * Everything that glows in this room is a 2D canvas painted into a CanvasTexture.
 *
 * The monitors are the whole point of the scene, so they get real UI rather
 * than a screenshot.
 */

import * as THREE from "three";
import { CSS, MONO, SANS } from "./palette";
import { projects, profile, education, skills } from "../data/content";

const SERIF = '"Cormorant Garamond", Georgia, serif';

/** Height of the window chrome on every screen. */
const TITLE_BAR = 56;

/** A clickable line on a screen, positioned in that screen's content space. */
export type ScreenLink = { href: string; label: string; text: string; x: number; y: number; w: number };

/** Padding around a link's painted box, so a near-miss still counts as a hit. */
const LINK_PAD = { x: 12, top: 26, bottom: 14 };

/**
 * Side of the square every screen is averaged down to before its colour is read.
 * One pixel would do the job in theory, but a single-step downscale to 1×1 is
 * the case browsers filter worst; 8×8 costs nothing and is actually a mean.
 */
const SAMPLE_N = 8;

/** One scratch canvas serves every screen; sampling is never re-entrant. */
let samplerCtx: CanvasRenderingContext2D | null = null;
function sampler(): CanvasRenderingContext2D {
  if (samplerCtx) return samplerCtx;
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_N;
  canvas.height = SAMPLE_N;
  samplerCtx = canvas.getContext("2d", { willReadFrequently: true })!;
  samplerCtx.imageSmoothingQuality = "high";
  return samplerCtx;
}

/** How hard the sampled cast is pushed before a light is allowed to use it. */
const SAMPLE_SATURATE = 2.2;

/** Index of the link under a content-space point, or -1. */
function linkIndexAt(links: ScreenLink[], x: number, y: number): number {
  return links.findIndex(
    (link) =>
      x >= link.x - LINK_PAD.x &&
      x <= link.x + link.w + LINK_PAD.x &&
      y >= link.y - LINK_PAD.top &&
      y <= link.y + LINK_PAD.bottom,
  );
}

abstract class CanvasScreen {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  protected dirty = true;

  constructor(width: number, height: number) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext("2d")!;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    // Screens are viewed near head-on; anisotropy buys sharpness at glancing angles.
    this.texture.anisotropy = 8;
    this.texture.minFilter = THREE.LinearFilter;
  }

  get width() {
    return this.canvas.width;
  }
  get height() {
    return this.canvas.height;
  }

  invalidate() {
    this.dirty = true;
  }

  /** Repaint if needed. Called every frame; usually a no-op. */
  render() {
    if (!this.dirty) return;
    this.draw();
    this.texture.needsUpdate = true;
    this.dirty = false;
    this.castStale = true;
  }

  /* ------------------------------ colour ----------------------------- */

  private readonly cast = new THREE.Color(1, 1, 1);
  private castStale = true;

  /**
   * Recomputed only after a repaint. The screens redraw on change rather than
   * on a clock, so this rides that instead of reading back a canvas per frame.
   */
  screenCast(): THREE.Color {
    if (!this.castStale) return this.cast;
    this.castStale = false;

    const s = sampler();
    s.clearRect(0, 0, SAMPLE_N, SAMPLE_N);
    s.drawImage(this.canvas, 0, 0, SAMPLE_N, SAMPLE_N);
    const { data } = s.getImageData(0, 0, SAMPLE_N, SAMPLE_N);

    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i]!;
      g += data[i + 1]!;
      b += data[i + 2]!;
    }

    // Divide by the peak channel rather than the pixel count: brightness is the
    // job of the light's intensity, and a screen that happens to be showing a
    // dark project should not quietly dim the desk.
    const peak = Math.max(r, g, b, 1);
    this.cast.setRGB(r / peak, g / peak, b / peak, THREE.SRGBColorSpace);

    const hsl = { h: 0, s: 0, l: 0 };
    this.cast.getHSL(hsl);
    this.cast.setHSL(hsl.h, Math.min(1, hsl.s * SAMPLE_SATURATE), hsl.l);
    return this.cast;
  }

  protected abstract draw(): void;

  protected roundRect(x: number, y: number, w: number, h: number, r: number) {
    const c = this.ctx;
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  /** Greedy word wrap. Returns the laid-out lines, capped at maxLines. */
  protected wrap(text: string, maxWidth: number, maxLines = 99): string[] {
    const c = this.ctx;
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let line = "";

    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (c.measureText(candidate).width <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
    if (line && lines.length < maxLines) lines.push(line);

    // Ellipsize the final line if we ran out of room mid-sentence.
    if (lines.length === maxLines && lines.length < this.countWords(text, maxWidth)) {
      let last = lines[maxLines - 1]!;
      while (last.length > 1 && c.measureText(`${last}…`).width > maxWidth) {
        last = last.slice(0, -1);
      }
      lines[maxLines - 1] = `${last}…`;
    }
    return lines;
  }

  private countWords(text: string, maxWidth: number) {
    // Cheap check for "did we truncate": full wrap without a cap.
    const c = this.ctx;
    let count = 1;
    let line = "";
    for (const word of text.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (c.measureText(candidate).width <= maxWidth) line = candidate;
      else {
        count++;
        line = word;
      }
    }
    return count;
  }

  /** macOS-ish window chrome. Sells "this is a real screen" for ~20 lines. */
  protected titleBar(title: string, height = TITLE_BAR) {
    const c = this.ctx;
    c.fillStyle = CSS.surface3;
    c.fillRect(0, 0, this.width, height);
    c.fillStyle = CSS.hairline;
    c.fillRect(0, height - 1, this.width, 1);

    const lights = ["#c96a5e", "#d8a657", "#7fb069"];
    lights.forEach((color, i) => {
      c.beginPath();
      c.arc(32 + i * 29, height / 2, 9, 0, Math.PI * 2);
      c.fillStyle = color;
      c.fill();
    });

    c.font = `500 22px ${MONO}`;
    c.fillStyle = CSS.ash;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(title, this.width / 2, height / 2 + 1);
    c.textAlign = "left";
  }

  /** Scanlines + a soft vignette. Without this a canvas reads as a flat decal. */
  protected screenGrade() {
    const c = this.ctx;
    c.save();
    c.globalAlpha = 0.045;
    c.fillStyle = "#000";
    for (let y = 0; y < this.height; y += 3) c.fillRect(0, y, this.width, 1);
    c.restore();

    const g = c.createRadialGradient(
      this.width / 2,
      this.height / 2,
      this.height * 0.3,
      this.width / 2,
      this.height / 2,
      this.height * 0.9,
    );
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.35)");
    c.fillStyle = g;
    c.fillRect(0, 0, this.width, this.height);
  }
}

/* ------------------------------------------------------------------ *
 * Left monitor: the projects browser. This is the site's navigation. *
 * ------------------------------------------------------------------ */

/** Wide enough that the longest project title still sets on one line at 23px. */
const SIDEBAR_W = 416;
/** Sized so the whole list clears the bottom edge: LIST_TOP + rows ≤ 640. */
const ROW_H = 88;
const LIST_TOP = 106;

/**
 * The detail pane is a scrolling viewport, not a fixed poster: a project's
 * blurb, stack, every bullet and its links are laid out in full and clipped to
 * the band below the title bar. Nothing is truncated; the reader scrolls.
 */
const DETAIL_TOP = TITLE_BAR;
const DETAIL_BOTTOM_PAD = 18;
/** First baseline of the detail content, measured from DETAIL_TOP. */
const DETAIL_LEAD = 82;
const DETAIL_X = SIDEBAR_W + 40;
/** Right margin is wider than the left to leave the scrollbar its own gutter. */
const DETAIL_RIGHT_PAD = 56;
/** Link rows: a mono label in the gutter, then the href itself. */
const LINK_FONT = `400 17px ${MONO}`;
const LINK_TEXT_X = 74;
/** Shared by the chip's measure pass and its painter; they must not drift. */
const CHIP_FONT = `400 17px ${MONO}`;

/** A laid-out piece of the detail pane, positioned in content space. */
type DetailItem =
  | { kind: "text"; text: string; x: number; y: number; font: string; color: string }
  | { kind: "rule"; x: number; y: number; w: number; color: string }
  | { kind: "chip"; x: number; y: number; w: number; text: string };

type DetailLayout = { items: DetailItem[]; links: ScreenLink[]; height: number };

export class ProjectsScreen extends CanvasScreen {
  selected = 0;
  hovered = -1;
  hoveredLink = -1;

  private scroll = 0;
  private layoutCache: (DetailLayout & { index: number }) | null = null;

  constructor() {
    super(1024, 640);
  }

  /**
   * Map a UV hit on the monitor plane to a project row.
   * Returns -1 when the pointer is off the list.
   */
  hitTest(u: number, v: number): number {
    const x = u * this.width;
    const y = (1 - v) * this.height;
    if (x > SIDEBAR_W || y < LIST_TOP) return -1;
    const index = Math.floor((y - LIST_TOP) / ROW_H);
    return index >= 0 && index < projects.length ? index : -1;
  }

  /** True when a UV hit lands in the scrollable detail pane. */
  isOverDetail(u: number, v: number): boolean {
    return u * this.width > SIDEBAR_W && (1 - v) * this.height > DETAIL_TOP;
  }

  /** UV → texture pixels, so a drag can be measured on the panel's own scale. */
  toTextureY(v: number): number {
    return (1 - v) * this.height;
  }

  /**
   * The link line under a UV hit, or -1. Scroll-aware: the hit is converted into
   * content space and rejected outside the clipped viewport, so a link parked
   * under the title bar or below the bottom edge is not secretly clickable.
   */
  linkAt(u: number, v: number): number {
    const px = u * this.width;
    const py = (1 - v) * this.height;
    if (px <= SIDEBAR_W || py <= DETAIL_TOP || py >= DETAIL_TOP + this.viewportH) return -1;

    return linkIndexAt(this.layout().links, px, py - DETAIL_TOP + this.scroll);
  }

  /** Href for a link index from {@link linkAt}. */
  linkHref(index: number): string | null {
    return this.layout().links[index]?.href ?? null;
  }

  setHovered(index: number) {
    if (this.hovered === index) return;
    this.hovered = index;
    this.invalidate();
  }

  setHoveredLink(index: number) {
    if (this.hoveredLink === index) return;
    this.hoveredLink = index;
    this.invalidate();
  }

  setSelected(index: number) {
    if (index < 0 || index >= projects.length || this.selected === index) return;
    this.selected = index;
    this.scroll = 0; // A new project starts at its title, not mid-bullet.
    this.hoveredLink = -1;
    this.invalidate();
  }

  /* ---------------------------- scrolling ---------------------------- */

  private get viewportH() {
    return this.height - DETAIL_TOP - DETAIL_BOTTOM_PAD;
  }

  get maxScroll(): number {
    return Math.max(0, this.layout().height - this.viewportH);
  }

  /** One keyboard page, with a couple of lines of overlap for continuity. */
  get pageScroll(): number {
    return this.viewportH - 60;
  }

  scrollBy(delta: number) {
    this.scrollTo(this.scroll + delta);
  }

  scrollTo(value: number) {
    const next = Math.max(0, Math.min(value, this.maxScroll));
    if (next === this.scroll) return;
    this.scroll = next;
    this.invalidate();
  }

  protected draw() {
    const c = this.ctx;
    c.fillStyle = CSS.surface;
    c.fillRect(0, 0, this.width, this.height);

    this.titleBar("~/dev/projects");
    this.drawSidebar();
    this.drawDetail();
    this.screenGrade();
  }

  private drawSidebar() {
    const c = this.ctx;
    c.fillStyle = CSS.surface2;
    c.fillRect(0, TITLE_BAR, SIDEBAR_W, this.height - TITLE_BAR);
    c.fillStyle = CSS.hairline;
    c.fillRect(SIDEBAR_W - 1, TITLE_BAR, 1, this.height - TITLE_BAR);

    c.font = `500 17px ${MONO}`;
    c.fillStyle = CSS.ashDim;
    c.fillText(`${projects.length} PROJECTS`, 28, 92);

    projects.forEach((project, i) => {
      const y = LIST_TOP + i * ROW_H;
      const isSelected = i === this.selected;
      const isHovered = i === this.hovered;

      if (isSelected || isHovered) {
        c.fillStyle = isSelected ? CSS.surface3 : "rgba(255,255,255,0.03)";
        c.fillRect(0, y, SIDEBAR_W - 1, ROW_H);
      }
      if (isSelected) {
        c.fillStyle = CSS.brass;
        c.fillRect(0, y, 4, ROW_H);
      }

      c.font = `400 23px ${SANS}`;
      c.fillStyle = isSelected ? CSS.bone : isHovered ? CSS.bone : CSS.ash;
      // Stops short of the selected-row chevron so the longest title clears it
      // rather than ellipsising into it.
      const title = this.wrap(project.title, SIDEBAR_W - 74, 1)[0]!;
      c.fillText(title, 28, y + 38);

      c.font = `400 16px ${MONO}`;
      c.fillStyle = isSelected ? CSS.brassDim : CSS.ashDim;
      c.fillText(project.period.toUpperCase(), 28, y + 70);

      if (isSelected) {
        c.fillStyle = CSS.brass;
        c.font = `400 20px ${MONO}`;
        c.fillText("▸", SIDEBAR_W - 38, y + 52);
      }
    });
  }

  /** Cached layout for the selected project; rebuilt only when it changes. */
  private layout(): DetailLayout {
    if (this.layoutCache?.index === this.selected) return this.layoutCache;
    this.layoutCache = { index: this.selected, ...this.layoutDetail() };
    return this.layoutCache;
  }

  /**
   * Lay the whole project out in content space: nothing capped, nothing
   * ellipsised. Y is measured from the top of the viewport, so the painter only
   * has to translate by the scroll offset.
   */
  private layoutDetail(): DetailLayout {
    const c = this.ctx;
    const project = projects[this.selected]!;
    const x = DETAIL_X;
    const maxW = this.width - x - DETAIL_RIGHT_PAD;
    const items: DetailItem[] = [];
    let y = DETAIL_LEAD;

    const titleFont = `300 50px ${SERIF}`;
    c.font = titleFont;
    for (const line of this.wrap(project.title, maxW)) {
      items.push({ kind: "text", text: line, x, y, font: titleFont, color: CSS.bone });
      y += 54;
    }

    y += 8;
    const metaFont = `400 16px ${MONO}`;
    c.font = metaFont;
    items.push({
      kind: "text",
      text: project.period.toUpperCase(),
      x,
      y,
      font: metaFont,
      color: CSS.brassDim,
    });

    y += 42;
    const blurbFont = `400 23px ${SANS}`;
    c.font = blurbFont;
    for (const line of this.wrap(project.blurb, maxW)) {
      items.push({ kind: "text", text: line, x, y, font: blurbFont, color: CSS.ash });
      y += 34;
    }

    // Stack chips, wrapped across as many rows as they need.
    y += 26;
    c.font = CHIP_FONT;
    let chipX = x;
    for (const item of project.stack) {
      const w = c.measureText(item).width + 28;
      if (chipX + w > x + maxW) {
        chipX = x;
        y += 40;
      }
      items.push({ kind: "chip", text: item, x: chipX, y, w });
      chipX += w + 10;
    }

    y += 50;
    items.push({ kind: "rule", x, y, w: maxW, color: CSS.hairline });
    y += 38;

    const bulletFont = `400 21px ${SANS}`;
    c.font = bulletFont;
    for (const bullet of project.bullets) {
      items.push({ kind: "rule", x, y: y - 7, w: 18, color: CSS.brassDim });
      for (const line of this.wrap(bullet, maxW - 38)) {
        items.push({ kind: "text", text: line, x: x + 38, y, font: bulletFont, color: CSS.ash });
        y += 30;
      }
      y += 18;
    }

    // Links live at the bottom of the scroll, where a reader who got through
    // the bullets is looking for somewhere to go next. These are the one part
    // of the panel that leaves the room, so they are hit-tested separately.
    const links: ScreenLink[] = [];
    const hrefs: [string, string][] = [];
    if (project.demo) hrefs.push(["DEMO", project.demo]);
    if (project.repo) hrefs.push(["CODE", project.repo]);

    if (hrefs.length) {
      y += 6;
      c.font = LINK_FONT;
      for (const [label, href] of hrefs) {
        const text = `↗ ${href.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
        links.push({ href, label, text, x, y, w: LINK_TEXT_X + c.measureText(text).width });
        y += 38;
      }
    }

    // A missing repo row reads as an oversight otherwise. Laid out on the link
    // grid so it lines up with the rows above it, but it is a plain item: there
    // is nowhere for it to go, so it is neither hit-tested nor underlined.
    if (!project.repo && !project.noRepo) {
      if (!hrefs.length) y += 6;
      items.push({ kind: "text", text: "CODE", x, y, font: LINK_FONT, color: CSS.ashDim });
      items.push({
        kind: "text",
        text: "Private repository",
        x: x + LINK_TEXT_X,
        y,
        font: LINK_FONT,
        color: CSS.ashDim,
      });
      y += 38;
    }

    return { items, links, height: y + 12 };
  }

  private drawDetail() {
    const c = this.ctx;
    const { items, links, height: contentH } = this.layout();
    const paneX = SIDEBAR_W;
    const paneW = this.width - SIDEBAR_W;

    c.save();
    c.beginPath();
    c.rect(paneX, DETAIL_TOP, paneW, this.viewportH);
    c.clip();
    c.translate(0, DETAIL_TOP - this.scroll);

    for (const item of items) {
      if (item.kind === "rule") {
        c.fillStyle = item.color;
        c.fillRect(item.x, item.y, item.w, 1);
        continue;
      }
      if (item.kind === "chip") {
        c.strokeStyle = CSS.hairline;
        c.lineWidth = 1;
        this.roundRect(item.x, item.y - 22, item.w, 36, 4);
        c.stroke();
        c.font = CHIP_FONT;
        c.fillStyle = CSS.ash;
        c.fillText(item.text, item.x + 14, item.y + 3);
        continue;
      }
      c.font = item.font;
      c.fillStyle = item.color;
      c.fillText(item.text, item.x, item.y);
    }

    links.forEach((link, i) => {
      const hot = i === this.hoveredLink;
      const textX = link.x + LINK_TEXT_X;

      if (hot) {
        c.fillStyle = "rgba(201,169,97,0.10)";
        this.roundRect(link.x - LINK_PAD.x, link.y - LINK_PAD.top, link.w + LINK_PAD.x * 2, 40, 4);
        c.fill();
      }

      c.font = LINK_FONT;
      c.fillStyle = CSS.ashDim;
      c.fillText(link.label, link.x, link.y);

      c.fillStyle = hot ? CSS.brass : CSS.brassDim;
      c.fillText(link.text, textX, link.y);
      // Underline: without it the href reads as one more line of metadata.
      c.fillRect(textX, link.y + 8, link.w - LINK_TEXT_X, 1);
    });

    c.restore();

    this.drawScrollAffordances(contentH);
  }

  /**
   * Everything that says "there is more here": a fade against each cut edge and
   * a proportional thumb. Both are suppressed when the project already fits.
   */
  private drawScrollAffordances(contentH: number) {
    const max = this.maxScroll;
    if (max <= 0) return;

    const c = this.ctx;
    const paneX = SIDEBAR_W;
    const paneW = this.width - SIDEBAR_W;
    const bottom = DETAIL_TOP + this.viewportH;
    const FADE = 30;

    const fade = (from: number, to: number) => {
      const g = c.createLinearGradient(0, from, 0, to);
      g.addColorStop(0, CSS.surface);
      g.addColorStop(1, "rgba(20,20,22,0)");
      c.fillStyle = g;
      c.fillRect(paneX, Math.min(from, to), paneW, FADE);
    };

    if (this.scroll > 0.5) fade(DETAIL_TOP, DETAIL_TOP + FADE);
    if (this.scroll < max - 0.5) fade(bottom, bottom - FADE);

    const trackX = this.width - 28;
    const trackY = DETAIL_TOP + 14;
    const trackH = this.viewportH - 28;

    c.fillStyle = CSS.hairline;
    this.roundRect(trackX, trackY, 4, trackH, 2);
    c.fill();

    const thumbH = Math.max(40, trackH * (this.viewportH / contentH));
    const thumbY = trackY + (trackH - thumbH) * (this.scroll / max);
    c.fillStyle = CSS.brassDim;
    this.roundRect(trackX, thumbY, 4, thumbH, 2);
    c.fill();
  }
}

/* ------------------------------------------------------------------ *
 * Right monitor: whoami.                                             *
 *                                                                     *
 * The left monitor answers "what has he built". This one answers the  *
 * questions a recruiter asks next, in the order they ask them: who,   *
 * when does he graduate, what does he know, how do I reach him. It    *
 * keeps the shell chrome so the two panels stay visually distinct.    *
 * Everything on it is real; the only motion is the prompt caret.     *
 * ------------------------------------------------------------------ */

/** Skill group names, shortened to fit the label gutter. */
const GROUP_LABEL: Record<string, string> = {
  Languages: "LANGUAGES",
  "Frameworks & Development": "FRAMEWORKS",
  Tools: "TOOLS",
  Certifications: "CERTS",
};

/* Vertical stops. Hand-placed rather than flowed: the panel is a fixed 640 tall
 * and the blocks are known, so there is nothing for a layout pass to decide.
 * The skill rows are the one exception: they wrap, so they flow from `rows`
 * and are sized to land above `rule2`. */
const ABOUT = {
  prompt: 100,
  name: 172,
  meta: 206,
  tagline: 244,
  taglineLead: 33,
  rule1: 304,
  rows: 338,
  rowLineLead: 29,
  rowGap: 13,
  rule2: 556,
  links: 598,
};

const ROW_LABEL_X = 28;
const ROW_VALUE_X = 200;
/** Named links are short, so all four flow along one row under the rule. */
const LINK_X = 28;
const LINK_GAP = 50;
/** Larger than the projects pane's links: this panel is read, not scanned. */
const ABOUT_LINK_FONT = `400 21px ${MONO}`;

export class AboutScreen extends CanvasScreen {
  hoveredLink = -1;

  private caretOn = true;
  private caretTimer = 0;
  private linkCache: ScreenLink[] | null = null;

  constructor() {
    super(1024, 640);
  }

  /* ------------------------------ links ------------------------------ */

  /**
   * The four ways out of this room, laid out once. Nothing here moves, so the
   * layout is computed on first use and kept. Unlike the projects pane, there
   * is no selection or scroll to invalidate it.
   */
  private links(): ScreenLink[] {
    if (this.linkCache) return this.linkCache;

    const c = this.ctx;
    c.font = ABOUT_LINK_FONT;

    // The destination is the label — the URL itself carries nothing a reader
    // wants, and spelling it out made four lines of noise out of four words.
    const entries: [label: string, href: string][] = [
      ["Email", `mailto:${profile.email}`],
      ["Résumé", profile.resume],
      ["GitHub", profile.github],
      ["LinkedIn", profile.linkedin],
    ];

    let x = LINK_X;
    this.linkCache = entries.map(([label, href]) => {
      const display = `↗ ${label}`;
      const w = c.measureText(display).width;
      const link = { href, label, text: display, x, y: ABOUT.links, w };
      x += w + LINK_GAP;
      return link;
    });
    return this.linkCache;
  }

  /** The link under a UV hit, or -1. No scroll here, so UV maps straight down. */
  linkAt(u: number, v: number): number {
    return linkIndexAt(this.links(), u * this.width, (1 - v) * this.height);
  }

  linkHref(index: number): string | null {
    return this.links()[index]?.href ?? null;
  }

  setHoveredLink(index: number) {
    if (this.hoveredLink === index) return;
    this.hoveredLink = index;
    this.invalidate();
  }

  update(dt: number) {
    this.caretTimer += dt;
    if (this.caretTimer >= 0.53) {
      this.caretTimer = 0;
      this.caretOn = !this.caretOn;
      this.invalidate();
    }
  }

  protected draw() {
    const c = this.ctx;
    c.fillStyle = "#0b0b0d";
    c.fillRect(0, 0, this.width, this.height);

    this.titleBar("baron@whosbaron: ~ — whoami");
    this.drawIdentity();
    this.drawRows();
    this.drawLinks();
    this.screenGrade();
  }

  private rule(y: number) {
    this.ctx.fillStyle = CSS.hairline;
    this.ctx.fillRect(28, y, this.width - 56, 1);
  }

  private drawIdentity() {
    const c = this.ctx;

    c.font = `400 24px ${MONO}`;
    c.fillStyle = CSS.green;
    c.fillText("$", 28, ABOUT.prompt);
    c.fillStyle = CSS.ash;
    c.fillText("whoami", 58, ABOUT.prompt);

    // The one moving thing on the panel, and the only honest one: a caret.
    if (this.caretOn) {
      c.fillRect(70 + c.measureText("whoami").width, ABOUT.prompt - 17, 11, 22);
    }

    c.font = `300 58px ${SERIF}`;
    c.fillStyle = CSS.bone;
    c.fillText(profile.name, 28, ABOUT.name);

    c.font = `400 17px ${MONO}`;
    c.fillStyle = CSS.brassDim;
    c.fillText(
      `${profile.location.toUpperCase()} · CURRENTLY OPEN TO FULL-TIME AND INTERNSHIP`,
      28,
      ABOUT.meta,
    );

    const taglineFont = `400 22px ${SANS}`;
    c.font = taglineFont;
    c.fillStyle = CSS.ash;
    this.wrap(profile.tagline, this.width - 84, 2).forEach((line, i) => {
      c.fillText(line, 28, ABOUT.tagline + i * ABOUT.taglineLead);
    });

    this.rule(ABOUT.rule1);
  }

  /** Education first, the fact a recruiter is scanning for, then the stack. */
  private drawRows() {
    const c = this.ctx;
    const school = education[0]!;

    const rows: [string, string][] = [
      ["EDUCATION", `${school.degree} · ${school.school} · ${gradDate()}`],
      ...skills.map(
        (group) =>
          [GROUP_LABEL[group.group] ?? group.group.toUpperCase(), group.items.join(" · ")] as [
            string,
            string,
          ],
      ),
    ];

    // Values are set big enough that the longer skill lists no longer fit on
    // one line, so rows flow: each one takes the height its value needs.
    const valueFont = `400 22px ${SANS}`;
    const valueW = this.width - ROW_VALUE_X - 36;
    let y = ABOUT.rows;

    rows.forEach(([label, value]) => {
      c.font = valueFont;
      const wrapped = this.wrap(value, valueW, 2);

      c.font = `400 17px ${MONO}`;
      c.fillStyle = CSS.ashDim;
      c.fillText(label, ROW_LABEL_X, y);

      c.font = valueFont;
      c.fillStyle = CSS.ash;
      wrapped.forEach((line, i) => c.fillText(line, ROW_VALUE_X, y + i * ABOUT.rowLineLead));

      y += wrapped.length * ABOUT.rowLineLead + ABOUT.rowGap;
    });

    this.rule(ABOUT.rule2);
  }

  private drawLinks() {
    const c = this.ctx;

    this.links().forEach((link, i) => {
      const hot = i === this.hoveredLink;

      if (hot) {
        c.fillStyle = "rgba(201,169,97,0.10)";
        this.roundRect(link.x - LINK_PAD.x, link.y - LINK_PAD.top, link.w + LINK_PAD.x * 2, 40, 4);
        c.fill();
      }

      c.font = ABOUT_LINK_FONT;
      c.fillStyle = hot ? CSS.brass : CSS.brassDim;
      c.fillText(link.text, link.x, link.y);
      // Underline: without it the href reads as one more line of metadata.
      c.fillRect(link.x, link.y + 9, link.w, 1);
    });
  }
}

/** "May 2027" out of "Aug 2023 — May 2027". */
function gradDate(): string {
  const [, end] = education[0]!.period.split("—");
  return end?.trim() ?? education[0]!.period;
}

/* ------------------------------------------------------- *
 * The sketchpad on the desk: Conway, stepping forever.     *
 * ------------------------------------------------------- */

export class ConwayScreen extends CanvasScreen {
  private readonly cols = 32;
  private readonly rows = 24;
  private readonly topBarHeight = 36;
  private readonly gridTop = 36;
  private readonly gridHeight = 240; // 36px top header + 240px grid + 44px bottom toolbar = 320px
  private grid: Uint8Array;
  private stepIn = 0;

  private speedIndex = 0;
  private readonly speeds = [
    { label: "1x", dt: 0.22 },
    { label: "2x", dt: 0.11 },
    { label: "4x", dt: 0.05 },
    { label: "0.5x", dt: 0.44 },
  ];
  private isPaused = false;
  private userInteracted = false;
  private presetIndex = 0;
  private readonly presetNames = ["GUN", "PULSAR", "SPACESHIP", "RANDOM"];
  private activeHoverButton: "presets" | "play" | "speed" | "reset" | "clear" | null = null;

  constructor() {
    super(320, 320);
    this.grid = new Uint8Array(this.cols * this.rows);
    this.seed();
  }

  /** Called when the user zooms into the tablet: resets to a clean slate. */
  public onZoomIn() {
    this.clear();
  }

  public seed() {
    this.grid.fill(0);
    for (let i = 0; i < this.grid.length; i++) {
      this.grid[i] = Math.random() > 0.78 ? 1 : 0;
    }
    // A glider in the top left
    const glider = [
      [1, 0],
      [2, 1],
      [0, 2],
      [1, 2],
      [2, 2],
    ];
    for (const [x, y] of glider) {
      if (x < this.cols && y < this.rows) {
        this.grid[y * this.cols + x] = 1;
      }
    }
    this.userInteracted = false;
    this.isPaused = false;
    this.invalidate();
  }

  public clear() {
    this.grid.fill(0);
    this.isPaused = true; // Pause on clean slate so user drawings don't immediately die
    this.userInteracted = true;
    this.invalidate();
  }

  public togglePause(): boolean {
    this.isPaused = !this.isPaused;
    this.invalidate();
    return this.isPaused;
  }

  public getIsPaused(): boolean {
    return this.isPaused;
  }

  public toggleSpeed(): string {
    this.speedIndex = (this.speedIndex + 1) % this.speeds.length;
    this.invalidate();
    return this.speeds[this.speedIndex]!.label;
  }

  public getSpeedLabel(): string {
    return this.speeds[this.speedIndex]!.label;
  }

  public loadNextPreset(): string {
    this.presetIndex = (this.presetIndex + 1) % this.presetNames.length;
    this.applyPreset(this.presetIndex);
    this.isPaused = false;
    this.userInteracted = true;
    this.invalidate();
    return this.presetNames[this.presetIndex]!;
  }

  public getPresetLabel(): string {
    return this.presetNames[this.presetIndex]!;
  }

  public applyPreset(index: number) {
    this.grid.fill(0);
    const name = this.presetNames[index];
    if (name === "GUN") {
      // Gosper Glider Gun: continuous glider generator
      const gun = [
        [24,0],[22,1],[24,1],[12,2],[13,2],[20,2],[21,2],[34,2],[35,2],
        [11,3],[15,3],[20,3],[21,3],[34,3],[35,3],[0,4],[1,4],[10,4],[16,4],[20,4],[21,4],
        [0,5],[1,5],[10,5],[14,5],[16,5],[17,5],[22,5],[24,5],[10,6],[16,6],[24,6],
        [11,7],[15,7],[12,8],[13,8]
      ];
      for (const [x, y] of gun) {
        const gx = x! - 1;
        const gy = y! + 2;
        if (gx >= 0 && gx < this.cols && gy >= 0 && gy < this.rows) {
          this.grid[gy * this.cols + gx] = 1;
        }
      }
    } else if (name === "PULSAR") {
      // Pulsar oscillator
      const pulsarCoords = [
        [2,0],[3,0],[4,0],[8,0],[9,0],[10,0],
        [0,2],[5,2],[7,2],[12,2],
        [0,3],[5,3],[7,3],[12,3],
        [0,4],[5,4],[7,4],[12,4],
        [2,5],[3,5],[4,5],[8,5],[9,5],[10,5],
        [2,7],[3,7],[4,7],[8,7],[9,7],[10,7],
        [0,8],[5,8],[7,8],[12,8],
        [0,9],[5,9],[7,9],[12,9],
        [0,10],[5,10],[7,10],[12,10],
        [2,12],[3,12],[4,12],[8,12],[9,12],[10,12]
      ];
      for (const [x, y] of pulsarCoords) {
        const gx = x! + 9;
        const gy = y! + 5;
        if (gx >= 0 && gx < this.cols && gy >= 0 && gy < this.rows) {
          this.grid[gy * this.cols + gx] = 1;
        }
      }
    } else if (name === "SPACESHIP") {
      // Lightweight Spaceships
      const lwss = [
        [1,0],[4,0],[0,1],[0,2],[4,2],[0,3],[1,3],[2,3],[3,3]
      ];
      for (let i = 0; i < 3; i++) {
        for (const [x, y] of lwss) {
          const gx = x! + 2 + i * 9;
          const gy = y! + 3 + i * 5;
          if (gx >= 0 && gx < this.cols && gy >= 0 && gy < this.rows) {
            this.grid[gy * this.cols + gx] = 1;
          }
        }
      }
    } else {
      this.seed();
    }
  }

  private step() {
    if (this.isPaused) return;
    const next = new Uint8Array(this.grid.length);
    let alive = 0;

    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            // Toroidal wrap
            const nx = (x + dx + this.cols) % this.cols;
            const ny = (y + dy + this.rows) % this.rows;
            n += this.grid[ny * this.cols + nx]!;
          }
        }
        const self = this.grid[y * this.cols + x]!;
        const live = n === 3 || (self === 1 && n === 2) ? 1 : 0;
        next[y * this.cols + x] = live;
        alive += live;
      }
    }

    this.grid = next;
    // Auto-reseed only if grid has died out and user hasn't explicitly cleared/drawn
    if (alive === 0 && !this.userInteracted) {
      this.seed();
    }
  }

  update(dt: number) {
    if (this.isPaused) return;
    this.stepIn -= dt;
    if (this.stepIn > 0) return;
    this.stepIn = this.speeds[this.speedIndex]!.dt;
    this.step();
    this.invalidate();
  }

  public reset() {
    this.clear();
  }

  /**
   * Handles user interaction (click, tap, drag) on normalized coordinates [0, 1].
   */
  public handleInput(normX: number, normY: number, isDrag = false): boolean {
    const px = normX * this.width;
    const py = normY * this.height;

    // Top Bar (Y = 0..36)
    if (py < this.topBarHeight) {
      if (!isDrag && px >= 190 && px <= 312 && py >= 4 && py <= 32) {
        this.loadNextPreset();
        return true;
      }
    }
    // Grid area (Y = 36..276)
    else if (py < this.gridTop + this.gridHeight) {
      const cw = this.width / this.cols;
      const ch = this.gridHeight / this.rows;
      const col = Math.floor(px / cw);
      const row = Math.floor((py - this.gridTop) / ch);
      if (col >= 0 && col < this.cols && row >= 0 && row < this.rows) {
        const idx = row * this.cols + col;
        if (isDrag) {
          this.grid[idx] = 1;
        } else {
          this.grid[idx] = this.grid[idx] ? 0 : 1;
        }
        this.userInteracted = true;
        this.invalidate();
        return true;
      }
    }
    // Bottom Toolbar (Y = 276..320)
    else if (!isDrag) {
      // 1. Play/Pause: X in [8, 104]
      // 2. Speed: X in [112, 208]
      // 3. Reset (Clean Slate): X in [216, 312]
      if (px >= 8 && px <= 104) {
        this.togglePause();
        return true;
      } else if (px >= 112 && px <= 208) {
        this.toggleSpeed();
        return true;
      } else if (px >= 216 && px <= 312) {
        this.clear();
        return true;
      }
    }
    return false;
  }

  public setHover(normX: number, normY: number) {
    const px = normX * this.width;
    const py = normY * this.height;
    let newHover: "presets" | "play" | "speed" | "reset" | null = null;
    if (py < this.topBarHeight) {
      if (px >= 190 && px <= 312 && py >= 4 && py <= 32) newHover = "presets";
    } else if (py >= this.gridTop + this.gridHeight) {
      if (px >= 8 && px <= 104) newHover = "play";
      else if (px >= 112 && px <= 208) newHover = "speed";
      else if (px >= 216 && px <= 312) newHover = "reset";
    }
    if (this.activeHoverButton !== newHover) {
      this.activeHoverButton = newHover;
      this.invalidate();
    }
  }

  public clearHover() {
    if (this.activeHoverButton !== null) {
      this.activeHoverButton = null;
      this.invalidate();
    }
  }

  protected draw() {
    const c = this.ctx;
    // Dark tablet screen background
    c.fillStyle = "#0c0c11";
    c.fillRect(0, 0, this.width, this.height);

    // Top Header Bar
    c.fillStyle = "#12121a";
    c.fillRect(0, 0, this.width, this.topBarHeight);
    c.fillStyle = "#222230";
    c.fillRect(0, this.topBarHeight - 1, this.width, 1);

    // Title
    c.fillStyle = "#94a3b8";
    c.font = "600 10px system-ui, sans-serif";
    c.textAlign = "left";
    c.textBaseline = "middle";
    c.fillText("GAME OF LIFE", 10, this.topBarHeight / 2);

    // Top Presets Button
    this.drawButton(
      190,
      5,
      122,
      26,
      `PRESET: ${this.presetNames[this.presetIndex]}`,
      this.activeHoverButton === "presets",
      "#38bdf8",
    );

    // Grid area
    const cw = this.width / this.cols;
    const ch = this.gridHeight / this.rows;

    // Draw subtle grid lines
    c.strokeStyle = "rgba(255, 255, 255, 0.04)";
    c.lineWidth = 1;
    for (let x = 0; x <= this.width; x += cw) {
      c.beginPath();
      c.moveTo(x, this.gridTop);
      c.lineTo(x, this.gridTop + this.gridHeight);
      c.stroke();
    }
    for (let y = this.gridTop; y <= this.gridTop + this.gridHeight; y += ch) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(this.width, y);
      c.stroke();
    }

    // Draw cells
    c.fillStyle = CSS.green;
    let liveCellCount = 0;
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        if (!this.grid[y * this.cols + x]) continue;
        c.fillRect(x * cw + 1, this.gridTop + y * ch + 1, cw - 2, ch - 2);
        liveCellCount++;
      }
    }

    // Helper overlay text when board is empty and paused
    if (liveCellCount === 0 && this.isPaused) {
      const centerY = this.gridTop + this.gridHeight / 2;
      c.fillStyle = "#64748b";
      c.font = "600 11px system-ui, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText("TAP OR DRAG TO DRAW CELLS", this.width / 2, centerY - 10);
      c.fillStyle = "#22c55e";
      c.font = "600 10px system-ui, sans-serif";
      c.fillText("PRESS PLAY ▶ TO START SIMULATION", this.width / 2, centerY + 10);
    }

    // Bottom toolbar
    const barY = this.gridTop + this.gridHeight;
    const barH = this.height - barY;
    c.fillStyle = "#14141a";
    c.fillRect(0, barY, this.width, barH);

    // Separator border
    c.fillStyle = "#262632";
    c.fillRect(0, barY, this.width, 1);

    // Draw 3 Control Buttons: PLAY/PAUSE, SPEED, RESET (Cleans slate)
    const speedInfo = this.speeds[this.speedIndex]!;
    const playText = this.isPaused ? "PLAY ▶" : "PAUSE ❚❚";
    const playColor = this.isPaused ? "#f59e0b" : "#22c55e";

    this.drawButton(8, barY + 7, 96, 30, playText, this.activeHoverButton === "play", playColor);
    this.drawButton(112, barY + 7, 96, 30, `SPEED: ${speedInfo.label}`, this.activeHoverButton === "speed", "#38bdf8");
    this.drawButton(216, barY + 7, 96, 30, "RESET", this.activeHoverButton === "reset");
  }

  private drawButton(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    hovered: boolean,
    accentColor?: string,
  ) {
    const c = this.ctx;
    c.fillStyle = hovered ? "#262634" : "#1b1b22";
    c.strokeStyle = hovered ? "#4c4c60" : "#2a2a38";
    c.lineWidth = 1;

    this.roundRect(x, y, w, h, 4);
    c.fill();
    c.stroke();

    c.fillStyle = accentColor && !hovered ? accentColor : "#e2e8f0";
    c.font = "600 10px system-ui, sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(label, x + w / 2, y + h / 2);
  }
}

/* ------------------------------------------------------- *
 * The phone face-up on the desk: a lock screen, awake. A   *
 * notification arrives, sits for a few seconds and fades,  *
 * then the phone goes back to the clock.                   *
 * ------------------------------------------------------- */

/** Seconds between notifications. Everything below is an offset into one cycle. */
const PHONE_CYCLE = 20;

/** The banner's life inside a cycle, in seconds. */
const BANNER = { in: 0.45, hold: 6.5, out: 8.6 };

const BANNER_FEED: { app: string; badge: string; title: string; body: string }[] = [
  { app: "MAIL", badge: "M", title: "Recruiting", body: "Re: Summer 2027 internship" },
  { app: "GITHUB", badge: "G", title: "whosbaron", body: "All checks passed on main" },
  { app: "CALENDAR", badge: "C", title: "Standup", body: "In 15 minutes · Zoom" },
];

/** The lock screen's own palette. Dimmer than the monitors. */
const PHONE = {
  top: "#0d1117",
  bottom: "#151b26",
  bright: "#c5cdd9",
  dim: "#6f7a8a",
  banner: "rgba(232,238,246,0.10)",
  bannerEdge: "rgba(232,238,246,0.16)",
} as const;

const smoothstep = (t: number) => t * t * (3 - 2 * t);

export class PhoneScreen extends CanvasScreen {
  /** Position within the current cycle. */
  private t = 0;
  private banner = 0;
  private alpha = 0;
  private clock = "";

  constructor() {
    // Portrait, matching the 0.062 × 0.134 slab it is painted onto.
    super(256, 552);
    this.clock = this.clockAt();
  }

  /** Banner opacity at a point in the cycle. */
  private alphaAt(t: number): number {
    if (t < BANNER.in) return smoothstep(t / BANNER.in);
    if (t < BANNER.hold) return 1;
    if (t < BANNER.out) return 1 - smoothstep((t - BANNER.hold) / (BANNER.out - BANNER.hold));
    return 0;
  }

  /** Real wall-clock time. */
  private clockAt(): string {
    const now = new Date();
    return `${now.getHours() % 12 || 12}:${String(now.getMinutes()).padStart(2, "0")}`;
  }

  update(dt: number) {
    this.t += dt;
    if (this.t >= PHONE_CYCLE) {
      this.t -= PHONE_CYCLE;
      this.banner = (this.banner + 1) % BANNER_FEED.length;
    }

    // Repaint only while the banner is moving, and once a minute for the clock.
    const alpha = this.alphaAt(this.t);
    if (Math.abs(alpha - this.alpha) > 0.002) {
      this.alpha = alpha;
      this.invalidate();
    }

    const clock = this.clockAt();
    if (clock !== this.clock) {
      this.clock = clock;
      this.invalidate();
    }
  }

  protected draw() {
    const c = this.ctx;

    const wash = c.createLinearGradient(0, 0, 0, this.height);
    wash.addColorStop(0, PHONE.top);
    wash.addColorStop(1, PHONE.bottom);
    c.fillStyle = wash;
    c.fillRect(0, 0, this.width, this.height);

    this.statusBar();
    this.lockClock();
    if (this.alpha > 0.002) this.bannerCard();

    // Home indicator
    c.fillStyle = "rgba(197,205,217,0.30)";
    this.roundRect(this.width / 2 - 42, this.height - 22, 84, 5, 3);
    c.fill();
  }

  private statusBar() {
    const c = this.ctx;
    c.textBaseline = "middle";

    c.font = `500 17px ${MONO}`;
    c.fillStyle = PHONE.bright;
    c.fillText(this.clock, 20, 32);

    // Battery: a pill and a fill that stops short of full.
    const bx = this.width - 46;
    c.strokeStyle = "rgba(197,205,217,0.45)";
    c.lineWidth = 1.5;
    this.roundRect(bx, 24, 26, 14, 4);
    c.stroke();
    c.fillStyle = "rgba(197,205,217,0.45)";
    c.fillRect(bx + 27, 28, 2.5, 6);
    c.fillStyle = PHONE.bright;
    this.roundRect(bx + 2.5, 26.5, 17, 9, 2);
    c.fill();

    // Signal: four rising bars, the last one unlit.
    for (let i = 0; i < 4; i++) {
      const h = 4 + i * 3;
      c.fillStyle = i === 3 ? "rgba(197,205,217,0.28)" : PHONE.bright;
      c.fillRect(this.width - 84 + i * 7, 37 - h, 4, h);
    }

    c.textBaseline = "alphabetic";
  }

  private lockClock() {
    const c = this.ctx;
    c.textAlign = "center";

    c.font = `200 76px ${SANS}`;
    c.fillStyle = PHONE.bright;
    c.fillText(this.clock, this.width / 2, 168);

    c.font = `400 15px ${MONO}`;
    c.fillStyle = PHONE.dim;
    const now = new Date();
    c.fillText(
      now
        .toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
        .toUpperCase(),
      this.width / 2,
      196,
    );

    c.textAlign = "left";
  }

  /**
   * The frosted banner. Everything inside it rides one `globalAlpha`, so the
   * whole card fades as a unit rather than dissolving piece by piece.
   */
  private bannerCard() {
    const c = this.ctx;
    const x = 14;
    const w = this.width - 28;
    const y = 240;
    const h = 92;
    const item = BANNER_FEED[this.banner]!;

    c.save();
    c.globalAlpha = this.alpha;

    c.fillStyle = PHONE.banner;
    this.roundRect(x, y, w, h, 18);
    c.fill();
    c.strokeStyle = PHONE.bannerEdge;
    c.lineWidth = 1;
    c.stroke();

    // App tile.
    c.fillStyle = CSS.brassDim;
    this.roundRect(x + 16, y + 16, 30, 30, 8);
    c.fill();
    c.font = `600 17px ${SANS}`;
    c.fillStyle = "#12100a";
    c.textAlign = "center";
    c.fillText(item.badge, x + 31, y + 37);
    c.textAlign = "left";

    const textX = x + 58;

    c.font = `500 13px ${MONO}`;
    c.fillStyle = PHONE.dim;
    c.fillText(item.app, textX, y + 27);
    c.textAlign = "right";
    c.fillText("NOW", x + w - 16, y + 27);
    c.textAlign = "left";

    c.font = `600 17px ${SANS}`;
    c.fillStyle = PHONE.bright;
    c.fillText(item.title, textX, y + 52);

    c.font = `400 15px ${SANS}`;
    c.fillStyle = PHONE.dim;
    c.fillText(this.wrap(item.body, w - 74, 1)[0]!, textX, y + 74);

    c.restore();
  }
}

/** Static label texture for the résumé sheet sitting in the tray. */
export function makeResumeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 340;
  canvas.height = 440;
  const c = canvas.getContext("2d")!;

  c.fillStyle = "#f6f5f2";
  c.fillRect(0, 0, canvas.width, canvas.height);

  c.fillStyle = "#1a1a1c";
  c.font = `300 30px ${SERIF}`;
  c.fillText(profile.name, 30, 58);

  c.fillStyle = "#8a7440";
  c.font = `400 10px ${MONO}`;
  c.fillText("SOFTWARE ENGINEER · QUEENS, NY", 30, 78);

  // Suggested text: legible as a document, unreadable as content. Correct.
  c.fillStyle = "#c9c7c1";
  let y = 108;
  for (let block = 0; block < 5; block++) {
    c.fillStyle = "#a8a49b";
    c.fillRect(30, y, 90, 5);
    y += 16;
    c.fillStyle = "#d5d3cd";
    for (let line = 0; line < 3 + (block % 2); line++) {
      const w = 200 + Math.random() * 80;
      c.fillRect(30, y, w, 4);
      y += 12;
    }
    y += 12;
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/* ------------------------------------------------------- *
 * The framed diploma on the desk.                          *
 * ------------------------------------------------------- */

/** UB royal blue, and the ink/gold a real diploma is printed in. */
const DIPLOMA = {
  parchment: "#f2ecdc",
  parchmentEdge: "#e3d9c0",
  blue: "#1d3f7a",
  ink: "#191712",
  faded: "#6a6255",
  gold: "#a98d4b",
} as const;

/**
 * Canvas letter-spacing. `ctx.letterSpacing` exists but is recent enough that
 * hand-advancing per glyph is the cheaper bet, and a diploma needs the wide
 * tracking on its display lines to read as engraved rather than typed.
 */
function spaced(
  c: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  y: number,
  spacing: number,
): void {
  const glyphs = [...text];
  const width =
    glyphs.reduce((sum, g) => sum + c.measureText(g).width, 0) + spacing * (glyphs.length - 1);
  let x = centerX - width / 2;
  for (const g of glyphs) {
    c.fillText(g, x, y);
    x += c.measureText(g).width + spacing;
  }
}

/** A hand-signature: one wandering stroke, deterministic per seed. */
function signature(c: CanvasRenderingContext2D, x: number, y: number, w: number, seed: number): void {
  c.strokeStyle = "#2a3550";
  c.lineWidth = 2.2;
  c.lineCap = "round";
  c.beginPath();
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const wobble =
      Math.sin(t * 11 + seed) * 9 + Math.sin(t * 27 + seed * 3) * 4 + Math.sin(t * 4 + seed) * 6;
    const px = x + t * w;
    const py = y - wobble * (1 - t * 0.35);
    if (i === 0) c.moveTo(px, py);
    else c.lineTo(px, py);
  }
  c.stroke();
}

/** The parchment face of the diploma, painted once and never redrawn. */
export function makeDiplomaTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 880;
  canvas.height = 660;
  const c = canvas.getContext("2d")!;
  const mid = canvas.width / 2;

  /* parchment, warmer at the edges so it doesn't read as flat paper */
  const wash = c.createRadialGradient(mid, 300, 80, mid, 330, 560);
  wash.addColorStop(0, DIPLOMA.parchment);
  wash.addColorStop(1, DIPLOMA.parchmentEdge);
  c.fillStyle = wash;
  c.fillRect(0, 0, canvas.width, canvas.height);

  /* engraved double rule */
  c.strokeStyle = DIPLOMA.gold;
  c.lineWidth = 3;
  c.strokeRect(26, 26, canvas.width - 52, canvas.height - 52);
  c.lineWidth = 1;
  c.strokeRect(38, 38, canvas.width - 76, canvas.height - 76);

  c.textAlign = "left";
  c.textBaseline = "alphabetic";

  c.fillStyle = DIPLOMA.blue;
  c.font = `600 52px ${SERIF}`;
  spaced(c, "UNIVERSITY AT BUFFALO", mid, 118, 3);

  c.fillStyle = DIPLOMA.gold;
  c.font = `500 14px ${MONO}`;
  spaced(c, "THE STATE UNIVERSITY OF NEW YORK", mid, 146, 5);

  c.strokeStyle = DIPLOMA.gold;
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(mid - 90, 168);
  c.lineTo(mid + 90, 168);
  c.stroke();

  c.textAlign = "center";
  c.fillStyle = DIPLOMA.faded;
  c.font = `italic 300 21px ${SERIF}`;
  c.fillText("Upon the recommendation of the Faculty, the Council has conferred upon", mid, 214);

  c.fillStyle = DIPLOMA.ink;
  c.font = `500 74px ${SERIF}`;
  c.fillText(profile.name, mid, 296);

  c.fillStyle = DIPLOMA.faded;
  c.font = `italic 300 21px ${SERIF}`;
  c.fillText("the degree of", mid, 338);

  c.fillStyle = DIPLOMA.blue;
  c.font = `600 46px ${SERIF}`;
  c.fillText(education[0]!.degree.replace("B.S.", "Bachelor of Science in"), mid, 396);

  c.textAlign = "left";
  c.fillStyle = DIPLOMA.faded;
  c.font = `400 13px ${MONO}`;
  spaced(c, education[0]!.detail.toUpperCase(), mid, 432, 3);

  /* gold foil seal, embossed */
  const sealX = 178;
  const sealY = 548;
  c.strokeStyle = DIPLOMA.gold;
  c.fillStyle = "rgba(201, 169, 97, 0.22)";
  c.beginPath();
  c.arc(sealX, sealY, 46, 0, Math.PI * 2);
  c.fill();
  c.lineWidth = 2.5;
  c.stroke();
  c.lineWidth = 1;
  c.beginPath();
  c.arc(sealX, sealY, 38, 0, Math.PI * 2);
  c.stroke();
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    c.beginPath();
    c.moveTo(sealX + Math.cos(a) * 46, sealY + Math.sin(a) * 46);
    c.lineTo(sealX + Math.cos(a) * 53, sealY + Math.sin(a) * 53);
    c.stroke();
  }
  c.fillStyle = DIPLOMA.gold;
  c.font = `600 30px ${SERIF}`;
  c.textAlign = "center";
  c.fillText("UB", sealX, sealY + 4);
  c.font = `500 9px ${MONO}`;
  c.fillText("1846", sealX, sealY + 24);

  /* signatures */
  signature(c, 360, 556, 150, 1.7);
  signature(c, 590, 556, 170, 4.3);
  c.strokeStyle = "#b9ae95";
  c.lineWidth = 1;
  for (const [x, w] of [
    [360, 150],
    [590, 170],
  ] as const) {
    c.beginPath();
    c.moveTo(x, 570);
    c.lineTo(x + w, 570);
    c.stroke();
  }
  c.fillStyle = DIPLOMA.faded;
  c.font = `400 11px ${MONO}`;
  c.textAlign = "left";
  spaced(c, "PRESIDENT", 435, 588, 3);
  spaced(c, "DEAN, ENGINEERING", 675, 588, 3);

  c.fillStyle = DIPLOMA.gold;
  c.font = `400 12px ${MONO}`;
  spaced(c, `CONFERRED ${gradDate().toUpperCase()} · BUFFALO, NEW YORK`, mid, 622, 4);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}
