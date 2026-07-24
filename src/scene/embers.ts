/**
 * Embers rising from the fire pit. Same GPU-only technique as dust.ts but
 * inverted: additive, rising, cooling from white-gold to deep red. Sparse
 * and slow so individual embers read, not a stream.
 */

import * as THREE from "three";
import { FIRE_ORIGIN, FIRE_BED_RADIUS } from "./lounge";

/** Sparse enough that you follow individual embers rather than a stream. */
const COUNT = 64;

/** Column height. Tall enough for embers to clear the pit lip. */
const RISE = 1.55;

/** Just off the logs, and after it has cooled on the way up. */
const HOT = 0xffb257;
const COOL = 0x9e2708;
/** Peak brightness of an ember dead centre; this is additive, so it carries. */
const OPACITY = 0.85;

export interface Embers {
  update(elapsed: number): void;
  /** Point sizes are in device pixels, so they track the renderer's ratio. */
  setPixelRatio(ratio: number): void;
  /**
   * How hard the fire is being stoked, 0–1, straight off `lounge.fireBoost`.
   * A stoked fire throws sparks: the column runs faster, brighter and wider
   * while the flare lasts.
   */
  setBoost(boost: number): void;
}

export function buildEmbers(scene: THREE.Scene): Embers {
  const seed = new Float32Array(COUNT * 3);
  const phase = new Float32Array(COUNT);
  const speed = new Float32Array(COUNT);
  const size = new Float32Array(COUNT);

  for (let i = 0; i < COUNT; i++) {
    seed[i * 3] = Math.random(); // angle around the bed
    seed[i * 3 + 1] = Math.random(); // radius on the bed (evened out in the shader)
    seed[i * 3 + 2] = Math.random(); // tumble phase
    phase[i] = Math.random();
    // Nine to eighteen seconds to make the climb. No two rates match, or the
    // column reads as one rising sheet.
    speed[i] = 0.055 + Math.random() * 0.06;
    // Biased small (pow > 1): a few embers carry, the rest are specks.
    size[i] = 0.5 + Math.pow(Math.random(), 1.7) * 0.8;
  }

  const geometry = new THREE.BufferGeometry();
  // Zeroed; shader places embers from seed. Attribute needed for three.js draw sizing.
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seed, 3));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
  geometry.setAttribute("aSpeed", new THREE.BufferAttribute(speed, 1));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(size, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    // Depth test on so the bench occludes embers still in the well.
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uOrigin: { value: FIRE_ORIGIN.clone() },
      uBedRadius: { value: FIRE_BED_RADIUS },
      uRise: { value: RISE },
      uHot: { value: new THREE.Color(HOT) },
      uCool: { value: new THREE.Color(COOL) },
      uOpacity: { value: OPACITY },
      uScale: { value: 62 },
      uBoost: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aSeed;
      attribute float aPhase;
      attribute float aSpeed;
      attribute float aSize;

      uniform float uTime;
      uniform vec3 uOrigin;
      uniform float uBedRadius;
      uniform float uRise;
      uniform float uScale;
      uniform float uBoost;

      varying float vFade;
      varying float vHeat;

      void main() {
        // Rising, wrapped: the ember that goes dark at the top of the column is
        // the next one lifting off the logs. Opposite sign to the dust's fall.
        float t = fract(aPhase + uTime * aSpeed);

        // Launch from a point on the log bed. sqrt for uniform disc distribution.
        float a = aSeed.x * 6.2831853;
        float r0 = sqrt(aSeed.y) * uBedRadius;
        // Plume opens with height; stoke widens it further.
        float spread = 0.4 + t * t * 1.5 + uBoost * 0.6;

        // Decelerating rise; stoke increases height.
        float climb = pow(t, 0.78) * uRise * (1.0 + uBoost * 0.5);

        vec3 p = uOrigin + vec3(cos(a) * r0 * spread, climb, sin(a) * r0 * spread);

        // Tumbling wander, growing with height.
        float w = aSeed.z * 6.2831853;
        float wobble = 0.03 + t * 0.14;
        p.x += sin(uTime * 0.9 + w * 3.1 + t * 7.0) * wobble;
        p.z += cos(uTime * 0.7 + w * 2.3 + t * 6.0) * wobble;

        // Quick fade-in, long fade-out before column top. Throb simulates tumbling.
        vFade = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.3, 0.95, t));
        vFade *= 0.65 + 0.35 * sin(uTime * (2.4 + aSpeed * 18.0) + w * 5.0);
        // Stoke lifts dim specks into view for a denser column.
        vFade *= 1.0 + uBoost * 1.1;

        // Heat gradient: white-gold at base, deep red at top. Stoke extends heat.
        vHeat = 1.0 - smoothstep(0.0, 0.7 + uBoost * 0.25, t);

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        // Embers swell as they cool.
        gl_PointSize = aSize * (0.75 + t * 1.1) * (1.0 + uBoost * 0.45) * uScale / max(-mv.z, 0.001);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uHot;
      uniform vec3 uCool;
      uniform float uOpacity;

      varying float vFade;
      varying float vHeat;

      void main() {
        // Tighter falloff than dust: point of light with haze.
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float core = pow(1.0 - clamp(d, 0.0, 1.0), 3.0);
        // Clamped so stoke lifts dim specks without overdriving bright ones.
        float a = min(core * vFade * uOpacity, 1.0);
        if (a <= 0.002) discard;
        gl_FragColor = vec4(mix(uCool, uHot, vHeat), a);
      }
    `,
  });

  const points = new THREE.Points(geometry, material);
  // Shader-driven positions; disable frustum culling.
  points.frustumCulled = false;
  points.renderOrder = 3;
  scene.add(points);

  /** Integrated clock so stoke speed changes are smooth, not jarring. */
  let flow = 0;
  let lastElapsed = 0;
  let boost = 0;

  return {
    update(elapsed: number) {
      flow += Math.max(elapsed - lastElapsed, 0) * (1 + boost * 1.8);
      lastElapsed = elapsed;
      material.uniforms.uTime!.value = flow;
    },
    setPixelRatio(ratio: number) {
      material.uniforms.uScale!.value = 62 * ratio;
    },
    setBoost(next: number) {
      boost = next;
      material.uniforms.uBoost!.value = next;
    },
  };
}
