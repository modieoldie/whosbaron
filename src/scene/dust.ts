/**
 * Dust hanging in the air over the desk, so the volume between the camera and
 * the desk stops reading as empty.
 *
 * Deliberately unattached to the sunbeam, and normally blended rather than
 * additive: additive motes turn into sparks and the bloom pass finds them.
 *
 * All motion is in the vertex shader off a per-mote seed: one draw call, no
 * CPU work per frame.
 */

import * as THREE from "three";
import { DESK_CENTER_Z } from "./desk";

/** Few enough that you notice them only once. */
const COUNT = 90;

/** The box the dust lives in: over the desktop, out to about the chair. */
const CENTER = new THREE.Vector3(0, 1.05, DESK_CENTER_Z + 0.45);
const SIZE = new THREE.Vector3(2.7, 1.5, 1.6);

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
}

export function buildDust(scene: THREE.Scene): Dust {
  const seed = new Float32Array(COUNT * 3);
  const phase = new Float32Array(COUNT);
  const speed = new Float32Array(COUNT);
  const size = new Float32Array(COUNT);

  for (let i = 0; i < COUNT; i++) {
    seed[i * 3] = Math.random(); // x across the box
    seed[i * 3 + 1] = Math.random(); // z through the box
    seed[i * 3 + 2] = Math.random(); // drift phase
    phase[i] = Math.random();
    // Two to six minutes to sink the box. No two rates match, or the cloud
    // reads as one scrolling sheet.
    speed[i] = 0.003 + Math.random() * 0.006;
    size[i] = 0.6 + Math.random() * 1.1;
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

      varying float vFade;

      void main() {
        // Sinking, wrapped: bottom of the box reappears at the top. The end
        // fades below hide the seam.
        float t = fract(aPhase - uTime * aSpeed);

        vec3 p = uCenter + vec3(
          (aSeed.x - 0.5) * uSize.x,
          (t - 0.5) * uSize.y,
          (aSeed.y - 0.5) * uSize.z
        );

        // Air currents, just enough that the fall is not a straight line.
        float w = aSeed.z * 6.2831853;
        p.x += sin(uTime * 0.14 + w) * 0.06;
        p.z += cos(uTime * 0.11 + w) * 0.06;
        p.y += sin(uTime * 0.09 + w * 2.0) * 0.025;

        // Fade at the walls of the box, or motes pop in and out of existence:
        // top and bottom for the wrap, sides for the edges.
        vFade = smoothstep(0.0, 0.16, t) * smoothstep(1.0, 0.84, t);
        vFade *= smoothstep(0.0, 0.2, aSeed.x) * smoothstep(1.0, 0.8, aSeed.x);

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = aSize * uScale / max(-mv.z, 0.001);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;

      varying float vFade;

      void main() {
        // Round and soft-edged; square motes read as noise.
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = pow(1.0 - clamp(d, 0.0, 1.0), 2.0) * vFade * uOpacity;
        if (a <= 0.002) discard;
        gl_FragColor = vec4(uColor, a);
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
  };
}
