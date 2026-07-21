/**
 * Everything that glows in this room is a 2D canvas painted into a CanvasTexture.
 *
 * The monitors are the whole point of the scene, so they get real UI rather than
 * a screenshot: the left one is a browsable project list, the right one is the
 * `whoami` card — who he is, when he graduates, and how to reach him. Both
 * redraw only when something actually changed — a 60fps canvas repaint of static
 * text is a great way to cook a laptop for no reason.
 */

import * as THREE from "three";
import { CSS, MONO, SANS } from "./palette";
import { projects, profile, education, skills } from "../data/content";

const SERIF = '"Cormorant Garamond", Georgia, serif';

/**
 * Height of the window chrome on every screen.
 *
 * Type on these canvases is sized against one constraint: a 1024px-wide texture
 * lands on roughly 800 screen pixels once the desk view has framed both
 * monitors. Anything under ~18px here arrives smaller than 14px real and stops
 * being readable, which is why the numbers below look large for a "UI".
 */
const TITLE_BAR = 56;

/**
 * A clickable line on a screen, positioned in that screen's content space.
 * Both monitors put links on glass, so both hit-test them the same way.
 */
export type ScreenLink = { href: string; label: string; text: string; x: number; y: number; w: number };

/** Padding around a link's painted box, so a near-miss still counts as a hit. */
const LINK_PAD = { x: 10, top: 22, bottom: 10 };

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
      c.arc(30 + i * 27, height / 2, 8, 0, Math.PI * 2);
      c.fillStyle = color;
      c.fill();
    });

    c.font = `500 19px ${MONO}`;
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
 * Left monitor — the projects browser. This is the site's navigation. *
 * ------------------------------------------------------------------ */

const SIDEBAR_W = 400;
const ROW_H = 88;
const LIST_TOP = 118;

/**
 * The detail pane is a scrolling viewport, not a fixed poster: a project's
 * blurb, stack, every bullet and its links are laid out in full and clipped to
 * the band below the title bar. Nothing is truncated — the reader scrolls.
 */
const DETAIL_TOP = TITLE_BAR;
const DETAIL_BOTTOM_PAD = 18;
/** First baseline of the detail content, measured from DETAIL_TOP. */
const DETAIL_LEAD = 76;
const DETAIL_X = SIDEBAR_W + 40;
/** Right margin is wider than the left to leave the scrollbar its own gutter. */
const DETAIL_RIGHT_PAD = 56;
/** Link rows: a mono label in the gutter, then the href itself. */
const LINK_FONT = `400 15px ${MONO}`;
const LINK_TEXT_X = 66;

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

    c.font = `500 15px ${MONO}`;
    c.fillStyle = CSS.ashDim;
    c.fillText(`${projects.length} PROJECTS`, 28, 96);

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

      c.font = `400 20px ${SANS}`;
      c.fillStyle = isSelected ? CSS.bone : isHovered ? CSS.bone : CSS.ash;
      // Stops short of the selected-row chevron so the longest title clears it
      // rather than ellipsising into it.
      const title = this.wrap(project.title, SIDEBAR_W - 74, 1)[0]!;
      c.fillText(title, 28, y + 37);

      c.font = `400 14px ${MONO}`;
      c.fillStyle = isSelected ? CSS.brassDim : CSS.ashDim;
      c.fillText(project.period.toUpperCase(), 28, y + 64);

      if (isSelected) {
        c.fillStyle = CSS.brass;
        c.font = `400 18px ${MONO}`;
        c.fillText("▸", SIDEBAR_W - 38, y + 48);
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
   * Lay the whole project out in content space — nothing capped, nothing
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

    const titleFont = `300 44px ${SERIF}`;
    c.font = titleFont;
    for (const line of this.wrap(project.title, maxW)) {
      items.push({ kind: "text", text: line, x, y, font: titleFont, color: CSS.bone });
      y += 48;
    }

    y += 6;
    const metaFont = `400 14px ${MONO}`;
    c.font = metaFont;
    items.push({
      kind: "text",
      text: project.period.toUpperCase(),
      x,
      y,
      font: metaFont,
      color: CSS.brassDim,
    });

    y += 38;
    const blurbFont = `400 20px ${SANS}`;
    c.font = blurbFont;
    for (const line of this.wrap(project.blurb, maxW)) {
      items.push({ kind: "text", text: line, x, y, font: blurbFont, color: CSS.ash });
      y += 30;
    }

    // Stack chips, wrapped across as many rows as they need.
    y += 24;
    c.font = `400 15px ${MONO}`;
    let chipX = x;
    for (const item of project.stack) {
      const w = c.measureText(item).width + 26;
      if (chipX + w > x + maxW) {
        chipX = x;
        y += 36;
      }
      items.push({ kind: "chip", text: item, x: chipX, y, w });
      chipX += w + 10;
    }

    y += 46;
    items.push({ kind: "rule", x, y, w: maxW, color: CSS.hairline });
    y += 34;

    const bulletFont = `400 18px ${SANS}`;
    c.font = bulletFont;
    for (const bullet of project.bullets) {
      items.push({ kind: "rule", x, y: y - 6, w: 16, color: CSS.brassDim });
      for (const line of this.wrap(bullet, maxW - 34)) {
        items.push({ kind: "text", text: line, x: x + 34, y, font: bulletFont, color: CSS.ash });
        y += 26;
      }
      y += 16;
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
        y += 34;
      }
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
        this.roundRect(item.x, item.y - 19, item.w, 32, 4);
        c.stroke();
        c.font = `400 15px ${MONO}`;
        c.fillStyle = CSS.ash;
        c.fillText(item.text, item.x + 13, item.y + 3);
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
        this.roundRect(link.x - 10, link.y - 22, link.w + 20, 32, 4);
        c.fill();
      }

      c.font = LINK_FONT;
      c.fillStyle = CSS.ashDim;
      c.fillText(link.label, link.x, link.y);

      c.fillStyle = hot ? CSS.brass : CSS.brassDim;
      c.fillText(link.text, textX, link.y);
      // Underline: without it the href reads as one more line of metadata.
      c.fillRect(textX, link.y + 7, link.w - LINK_TEXT_X, 1);
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
 * Right monitor — whoami.                                             *
 *                                                                     *
 * The left monitor answers "what has he built". This one answers the  *
 * questions a recruiter asks next, in the order they ask them: who,   *
 * when does he graduate, what does he know, how do I reach him. It    *
 * keeps the shell chrome so the two panels stay visually distinct.    *
 * Everything on it is real — the only motion is the prompt caret.     *
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
 * The skill rows are the one exception — they wrap, so they flow from `rows`
 * and are sized to land above `rule2`. */
const ABOUT = {
  prompt: 96,
  name: 156,
  meta: 190,
  tagline: 228,
  taglineLead: 30,
  rule1: 292,
  rows: 326,
  rowLineLead: 25,
  rowGap: 11,
  rule2: 528,
  links: 568,
  linkLead: 38,
};

const ROW_LABEL_X = 28;
const ROW_VALUE_X = 200;
/** Contact links sit in two columns; four of them fill exactly two rows. */
const LINK_COL_X = [28, 528];
/** Larger than the projects pane's links — this panel is read, not scanned. */
const ABOUT_LINK_FONT = `400 18px ${MONO}`;

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
   * layout is computed on first use and kept — unlike the projects pane, there
   * is no selection or scroll to invalidate it.
   */
  private links(): ScreenLink[] {
    if (this.linkCache) return this.linkCache;

    const c = this.ctx;
    c.font = ABOUT_LINK_FONT;
    const strip = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

    const entries: [label: string, text: string, href: string][] = [
      ["EMAIL", profile.email, `mailto:${profile.email}`],
      ["RESUME", profile.resume.replace(/^\//, ""), profile.resume],
      ["GITHUB", strip(profile.github), profile.github],
      ["LINKEDIN", strip(profile.linkedin), profile.linkedin],
    ];

    this.linkCache = entries.map(([label, text, href], i) => {
      const display = `↗ ${text}`;
      return {
        href,
        label,
        text: display,
        x: LINK_COL_X[i % 2]!,
        y: ABOUT.links + Math.floor(i / 2) * ABOUT.linkLead,
        w: c.measureText(display).width,
      };
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

    c.font = `400 21px ${MONO}`;
    c.fillStyle = CSS.green;
    c.fillText("$", 28, ABOUT.prompt);
    c.fillStyle = CSS.ash;
    c.fillText("whoami", 54, ABOUT.prompt);

    // The one moving thing on the panel, and the only honest one: a caret.
    if (this.caretOn) {
      c.fillRect(64 + c.measureText("whoami").width, ABOUT.prompt - 15, 10, 19);
    }

    c.font = `300 50px ${SERIF}`;
    c.fillStyle = CSS.bone;
    c.fillText(profile.name, 28, ABOUT.name);

    c.font = `400 15px ${MONO}`;
    c.fillStyle = CSS.brassDim;
    c.fillText(
      `SOFTWARE ENGINEER · ${profile.location.toUpperCase()} · AVAILABLE ${gradDate().toUpperCase()}`,
      28,
      ABOUT.meta,
    );

    const taglineFont = `400 20px ${SANS}`;
    c.font = taglineFont;
    c.fillStyle = CSS.ash;
    this.wrap(profile.tagline, this.width - 84, 2).forEach((line, i) => {
      c.fillText(line, 28, ABOUT.tagline + i * ABOUT.taglineLead);
    });

    this.rule(ABOUT.rule1);
  }

  /** Education first — the fact a recruiter is scanning for — then the stack. */
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
    const valueFont = `400 19px ${SANS}`;
    const valueW = this.width - ROW_VALUE_X - 36;
    let y = ABOUT.rows;

    rows.forEach(([label, value]) => {
      c.font = valueFont;
      const wrapped = this.wrap(value, valueW, 2);

      c.font = `400 15px ${MONO}`;
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
        this.roundRect(link.x - LINK_PAD.x, link.y - LINK_PAD.top, link.w + LINK_PAD.x * 2, 32, 4);
        c.fill();
      }

      c.font = ABOUT_LINK_FONT;
      c.fillStyle = hot ? CSS.brass : CSS.brassDim;
      c.fillText(link.text, link.x, link.y);
      // Underline: without it the href reads as one more line of metadata.
      c.fillRect(link.x, link.y + 8, link.w, 1);
    });
  }
}

/** "May 2027" out of "Aug 2023 — May 2027". */
function gradDate(): string {
  const [, end] = education[0]!.period.split("—");
  return end?.trim() ?? education[0]!.period;
}

/* ------------------------------------------------------- *
 * The sketchpad on the desk — Conway, stepping forever.    *
 * ------------------------------------------------------- */

export class ConwayScreen extends CanvasScreen {
  private readonly cols = 32;
  private readonly rows = 32;
  private grid: Uint8Array;
  private stepIn = 0;

  constructor() {
    super(320, 320);
    this.grid = new Uint8Array(this.cols * this.rows);
    this.seed();
  }

  private seed() {
    this.grid.fill(0);
    for (let i = 0; i < this.grid.length; i++) {
      this.grid[i] = Math.random() > 0.78 ? 1 : 0;
    }
    // A glider, because it is the only cellular automaton anyone recognises.
    const glider = [
      [1, 0],
      [2, 1],
      [0, 2],
      [1, 2],
      [2, 2],
    ];
    for (const [x, y] of glider) this.grid[y! * this.cols + x!] = 1;
  }

  private step() {
    const next = new Uint8Array(this.grid.length);
    let alive = 0;

    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            // Toroidal wrap — gliders leave one edge and come back the other.
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
    if (alive < 12) this.seed(); // Died out or froze — reseed rather than sit still.
  }

  update(dt: number) {
    this.stepIn -= dt;
    if (this.stepIn > 0) return;
    this.stepIn = 0.22;
    this.step();
    this.invalidate();
  }

  protected draw() {
    const c = this.ctx;
    c.fillStyle = "#0d0d0f";
    c.fillRect(0, 0, this.width, this.height);

    const cw = this.width / this.cols;
    const ch = this.height / this.rows;

    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        if (!this.grid[y * this.cols + x]) continue;
        c.fillStyle = CSS.brass;
        c.fillRect(x * cw + 1, y * ch + 1, cw - 2, ch - 2);
      }
    }
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
