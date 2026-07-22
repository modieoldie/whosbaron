/**
 * The lights that stand in for the spill off the glass.
 *
 * Two things go on here. Every screen light breathes. Every screen light
 * is tinted by what its screen is actually showing, so changing the project on
 * the left monitor pulls its spill with it instead of leaving one fixed blue
 * wash sitting under changing content.
 */

import * as THREE from "three";

/** Anything that can report the colour it is currently showing. */
export interface GlowSource {
  screenCast(): THREE.Color;
}

/** A light this driver owns, plus how far it is allowed to move. */
export interface GlowSpec {
  /** Its colour and intensity at construction become the values drifted around. */
  light: THREE.Light;
  source: GlowSource;
  /** How far toward the screen's own colour the tint may pull, 0–1. */
  tint: number;
  /** Peak drift as a fraction of the light's base intensity. */
  breath: number;
}

/**
 * The two breathing periods, in radians per second: about 20s and about 13s.
 */
const BREATH_A = 0.31;
const BREATH_B = 0.47;

/** Seconds for the tint to close most of the way onto a new target. */
const TINT_RESPONSE = 1.6;

interface Entry extends GlowSpec {
  baseColor: THREE.Color;
  baseIntensity: number;
  /** Spread around the circle so no two lights breathe together. */
  phase: number;
}

export class ScreenGlow {
  private readonly entries: Entry[];
  private readonly target = new THREE.Color();

  constructor(specs: GlowSpec[]) {
    this.entries = specs.map((spec, i) => ({
      ...spec,
      baseColor: spec.light.color.clone(),
      baseIntensity: spec.light.intensity,
      phase: (i * Math.PI * 2) / specs.length + i * 0.7,
    }));
  }

  update(elapsed: number, dt: number) {
    // Framerate-independent easing: same fraction of the remaining gap per second.
    const k = 1 - Math.exp(-dt / TINT_RESPONSE);

    for (const entry of this.entries) {
      const t = elapsed + entry.phase;
      const drift = Math.sin(t * BREATH_A) * 0.6 + Math.sin(t * BREATH_B) * 0.4;

      entry.light.intensity = entry.baseIntensity * (1 + entry.breath * drift);

      this.target.copy(entry.baseColor).lerp(entry.source.screenCast(), entry.tint);
      entry.light.color.lerp(this.target, k);
    }
  }
}
