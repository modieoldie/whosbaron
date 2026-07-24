/**
 * Dust motes over the desk. Motes catch the sunbeam (faked in the shader from
 * the beam's line and brightness). Normal blending, not additive. All motion
 * and lighting in the vertex shader — one draw call, no CPU work per frame.
 */

import * as THREE from "three";
import { DESK_CENTER_Z } from "./desk";
import { SUN_ORIGIN, SUN_DIR, SUN_BEAM_RADIUS, SUN_COLOR } from "./sunbeam";

/** Few enough that you notice them only once; scaled up with the volume. */
const COUNT = 130;

/** Volume the dust occupies. Triangular sampling clusters motes toward the centre. */
const CENTER = new THREE.Vector3(0, 1.15, DESK_CENTER_Z + 0.55);
const SIZE = new THREE.Vector3(5.4, 2.4, 3.8);

/** Cool near-white, a touch under the room's light so it never pops. */
const COLOR = 0x9aa0ab;
/** Peak opacity of a mote dead centre; higher reads as snow. */
const OPACITY = 0.14;

export interface Dust {
  update(elapsed: number): void;
  /** Point sizes are in device pixels, so they track the renderer's ratio. */
  setPixelRatio(ratio: number): void;
  /**
   * How much of the cloud is present, 0–1. The desk view puts the camera inside
   * the box, where motes read as specks on the glass, so it fades to 0.
   */
  setPresence(k: number): void;
  /**
   * The sunbeam's current brightness, ~1, so the whole cloud brightens and dims
   * with the light the motes are supposedly catching.
   */
  setSunlight(brightness: number): void;
}

export function buildDust(scene: THREE.Scene): Dust {
  const seed = new Float32Array(COUNT * 3);
  const phase = new Float32Array(COUNT);
  const speed = new Float32Array(COUNT);
  const size = new Float32Array(COUNT);

  // Triangular sampling biases placement toward centre.
  const centred = () => (Math.random() + Math.random()) * 0.5;

  for (let i = 0; i < COUNT; i++) {
    seed[i * 3] = centred(); // x across the box, clustered mid
    seed[i * 3 + 1] = centred(); // z through the box, clustered mid
    seed[i * 3 + 2] = Math.random(); // drift phase
    phase[i] = Math.random();
    // Two to six minutes to sink the box. No two rates match, or the cloud
    // reads as one scrolling sheet.
    speed[i] = 0.003 + Math.random() * 0.006;
    // Bias toward smaller motes so the largest don't dominate in shade.
    size[i] = 0.6 + Math.pow(Math.random(), 1.6) * 0.95;
  }

  const geometry = new THREE.BufferGeometry();
  // Zeroed, since the shader places every mote from its seed, but the attribute
  // has to exist for three.js to size the draw.
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seed, 3));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
  geometry.setAttribute("aSpeed", new THREE.BufferAttribute(speed, 1));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(size, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(COLOR) },
      uCenter: { value: CENTER.clone() },
      uSize: { value: SIZE.clone() },
      uOpacity: { value: OPACITY },
      uScale: { value: 190 },
      // Sunbeam line and radius for per-mote sun-catching.
      uSunOrigin: { value: SUN_ORIGIN.clone() },
      uSunDir: { value: SUN_DIR.clone() },
      uSunRadius: { value: SUN_BEAM_RADIUS },
      uSunColor: { value: new THREE.Color(SUN_COLOR) },
      uSunlight: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aSeed;
      attribute float aPhase;
      attribute float aSpeed;
      attribute float aSize;

      uniform float uTime;
      uniform vec3 uCenter;
      uniform vec3 uSize;
      uniform float uScale;
      uniform vec3 uSunOrigin;
      uniform vec3 uSunDir;
      uniform float uSunRadius;
      uniform float uSunlight;

      varying float vFade;
      varying float vLit;

      void main() {
        // Sinking, wrapped: bottom of the box reappears at the top. The end
        // fades below hide the seam.
        float t = fract(aPhase - uTime * aSpeed);

        vec3 p = uCenter + vec3(
          (aSeed.x - 0.5) * uSize.x,
          (t - 0.5) * uSize.y,
          (aSeed.y - 0.5) * uSize.z
        );

        // Per-mote air-current wander; layered frequencies prevent sheet effect.
        float w = aSeed.z * 6.2831853;
        p.x += sin(uTime * 0.14 + w) * 0.18 + cos(uTime * 0.31 + w * 1.7) * 0.07;
        p.z += cos(uTime * 0.11 + w) * 0.18 + sin(uTime * 0.27 + w * 2.3) * 0.07;
        p.y += sin(uTime * 0.09 + w * 2.0) * 0.06;

        // Vertical fade covers the wrap seam where the bottom reappears at top.
        vFade = smoothstep(0.0, 0.22, t) * smoothstep(1.0, 0.78, t);
        // Radial falloff gives a soft disc cross-section, no box edges.
        vec2 off = (aSeed.xy - 0.5) * 2.0; // -1..1 across the volume
        float r = length(off);
        vFade *= smoothstep(1.1, 0.35, r);

        // Sun-catching: perpendicular distance to beam centre line
        // determines brightness. Rides uSunlight to breathe with the beam.
        vec3 rel = p - uSunOrigin;
        float along = dot(rel, uSunDir);
        float perp = length(rel - along * uSunDir);
        vLit = smoothstep(uSunRadius, uSunRadius * 0.35, perp);
        vFade *= (0.45 + 1.7 * vLit) * uSunlight;

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = aSize * uScale / max(-mv.z, 0.001);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uSunColor;
      uniform float uOpacity;

      varying float vFade;
      varying float vLit;

      void main() {
        // Round and soft-edged; square motes read as noise.
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = pow(1.0 - clamp(d, 0.0, 1.0), 2.0) * vFade * uOpacity;
        if (a <= 0.002) discard;
        // Warm toward sun colour in the shaft, cool near-white in shade.
        vec3 color = mix(uColor, uSunColor, vLit * 0.8);
        gl_FragColor = vec4(color, a);
      }
    `,
  });

  const points = new THREE.Points(geometry, material);
  // The shader moves them, so the bounding sphere off the zeroed positions
  // would cull the whole cloud once the origin left frame.
  points.frustumCulled = false;
  points.renderOrder = 3;
  scene.add(points);

  return {
    update(elapsed: number) {
      material.uniforms.uTime!.value = elapsed;
    },
    setPixelRatio(ratio: number) {
      material.uniforms.uScale!.value = 190 * ratio;
    },
    setPresence(k: number) {
      material.uniforms.uOpacity!.value = OPACITY * k;
      // Fully faded: skip the draw rather than discarding 90 points a frame.
      points.visible = k > 0.001;
    },
    setSunlight(brightness: number) {
      material.uniforms.uSunlight!.value = brightness;
    },
  };
}
