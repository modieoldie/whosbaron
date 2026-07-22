/**
 * A shaft of afternoon sun coming in over the viewer's right shoulder, landing
 * across the desk and the seated figure.
 *
 * Two halves: a spotlight does the actual lighting, and a cone of additive
 * geometry does the *visible* shaft, which no three.js light gives you.
 *
 * The shaft is a shell, not a volume, so the shader fakes depth from
 * `dot(normal, view)` — face-on looks down the thickest part of the beam,
 * edge-on through almost none. Additive and double-sided, that reads as a
 * soft-edged column of air.
 */

import * as THREE from "three";

/** High and to the right, well outside anything the camera can orbit to. */
const SUN_ORIGIN = new THREE.Vector3(4.1, 5.0, 1.9);
/** Aimed across the desktop and the figure's near shoulder. */
const SUN_TARGET = new THREE.Vector3(0.05, 0.95, -0.78);

const SUN_COLOR = 0xffd9a3;

/** Half-widths of the shaft at the source and where it runs out. */
const RADIUS_TOP = 0.62;
const RADIUS_BOTTOM = 1.15;
/** How far past the target the shaft carries before it is cut off underground. */
const OVERRUN = 1.9;

export interface Sunbeam {
  /** Frame loop; the shaft breathes very slightly. */
  update(elapsed: number): void;
}

export function buildSunbeam(scene: THREE.Scene): Sunbeam {
  const direction = new THREE.Vector3().subVectors(SUN_TARGET, SUN_ORIGIN).normalize();
  const reach = SUN_ORIGIN.distanceTo(SUN_TARGET) + OVERRUN;

  /* ----------------------------- the light ---------------------------- */

  // Narrow, soft-edged, and dimmer than the key: an accent falling across the
  // scene, not the thing lighting it.
  const spot = new THREE.SpotLight(SUN_COLOR, 9, 12, 0.3, 0.85, 1.6);
  spot.position.copy(SUN_ORIGIN);
  spot.target.position.copy(SUN_TARGET);
  scene.add(spot);
  scene.add(spot.target);

  /* ----------------------------- the shaft ---------------------------- */

  const geometry = new THREE.CylinderGeometry(RADIUS_TOP, RADIUS_BOTTOM, reach, 40, 1, true);
  // Cylinders are built about their centre on +Y; shift so the top is the
  // source, ready to be aimed down the sun direction.
  geometry.translate(0, -reach / 2, 0);

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
    uniforms: {
      uColor: { value: new THREE.Color(SUN_COLOR) },
      uStrength: { value: 0.16 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vViewW;

      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vViewW = normalize(cameraPosition - world.xyz);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;

      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vViewW;

      void main() {
        // Thickness of air the eye looks through: full facing the shell,
        // nothing at the silhouette — this is what softens the edges.
        float depth = abs(dot(normalize(vNormalW), normalize(vViewW)));
        depth = pow(depth, 1.6);

        // Along the shaft: eased in below the source so there is no hard cap,
        // and spent by the floor.
        float t = vUv.y;
        float along = smoothstep(1.0, 0.86, t) * smoothstep(0.02, 0.42, t);

        float a = depth * along * uStrength;
        if (a <= 0.001) discard;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
  });

  const shaft = new THREE.Mesh(geometry, material);
  shaft.position.copy(SUN_ORIGIN);
  shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), direction);
  // Pure add-on-top; never sorted against anything.
  shaft.renderOrder = 2;
  scene.add(shaft);

  /* --------------------------- the floor pool -------------------------- */

  // Where the shaft crosses the floor. Without it the beam stops in mid-air.
  const hit = SUN_ORIGIN.clone().addScaledVector(direction, -SUN_ORIGIN.y / direction.y);
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 3.4),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      uniforms: { uColor: { value: new THREE.Color(SUN_COLOR) } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
          float d = length(vUv - 0.5) * 2.0;
          float a = pow(1.0 - clamp(d, 0.0, 1.0), 2.4) * 0.13;
          gl_FragColor = vec4(uColor * a, a);
        }
      `,
    }),
  );
  pool.rotation.x = -Math.PI / 2;
  // The shaft comes in at an angle, so the footprint is an ellipse stretched
  // along the direction of travel.
  pool.scale.set(1, 1.55, 1);
  pool.rotation.z = Math.atan2(direction.x, direction.z);
  pool.position.set(hit.x, 0.008, hit.z);
  pool.renderOrder = 1;
  scene.add(pool);

  /* ------------------------------ breathing ---------------------------- */

  const baseShaft = material.uniforms.uStrength!.value as number;
  const baseSpot = spot.intensity;

  return {
    update(elapsed: number) {
      // Slow and shallow: air moving, not a flicker.
      const b = Math.sin(elapsed * 0.21) * 0.5 + Math.sin(elapsed * 0.37) * 0.5;
      material.uniforms.uStrength!.value = baseShaft * (1 + b * 0.09);
      spot.intensity = baseSpot * (1 + b * 0.05);
    },
  };
}
