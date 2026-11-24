import * as THREE from 'three';

/**
 * Shared transit-wing constants and unlit effect materials (openspec train-interior-abyssal-ride,
 * Decisions 6-10). Nothing here adds a scene light or a texture sampler: every effect is a procedural
 * `ShaderMaterial`, so the fixed `LightPool` count and the texture-unit budget are untouched.
 */

/** The car body is lifted this far above the track so the rails and bogies show below the floor. */
export const TRAIN_RIDE_HEIGHT = 0.4;
/** Rail head height above the track-bed origin; every rail in the ride rooms stays at or below it. */
export const RAIL_TOP = 0.12;
/** Half gauge: rails sit at x = +/- RAIL_HALF_GAUGE. */
export const RAIL_HALF_GAUGE = 0.72;
/** Boarding step risers (two steps bridge the lifted threshold; the motor steps up 0.35 m). */
export const BOARDING_STEP_RISE = 0.24;

/**
 * Stage 2 -> 3 hand-off geometry (design Decision 15). R16a's closed north blast gate (wall at z = 30.125) is this far ahead
 * of the Stage 3 start car centre (z = 20), and the rig's approaching gate travels from `RIG_GATE_START_Z` (in the fog) to it.
 */
export const RIG_GATE_FINAL_Z = 10.125;
export const RIG_GATE_START_Z = 27;
/** Speed (m/s) at the start of the R16a glide-in (ease-out cubic over 15 m in 9 s); the Stage 2 slow-down ends exactly here. */
export const GLIDE_START_SPEED = 5.0;

let railMat: THREE.MeshStandardMaterial | undefined;
/** Polished steel rail head: metallic and smooth so headlights and the guide strip glint along it. */
export function railMaterial(): THREE.MeshStandardMaterial {
  if (!railMat) {
    railMat = new THREE.MeshStandardMaterial({ color: 0xaeb8c2, roughness: 0.26, metalness: 0.92 });
    railMat.name = 'transit-rail';
    railMat.userData['flat'] = true;
  }
  return railMat;
}

const BILLBOARD_VERT = /* glsl */ `
  uniform float uSize;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    mv.xy += (uv - 0.5) * uSize;
    gl_Position = projectionMatrix * mv;
  }
`;

const GLOW_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying vec2 vUv;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float a = pow(max(0.0, 1.0 - d), 2.4);
    gl_FragColor = vec4(uColor * uIntensity * a, 1.0);
  }
`;

/** Soft additive camera-facing glow quad (lens bloom, beacon halos). Drive `uniforms.uIntensity`. */
export function glowMaterial(name: string, color: number, size: number, intensity = 1): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: intensity },
      uSize: { value: size },
    },
    vertexShader: BILLBOARD_VERT,
    fragmentShader: GLOW_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  mat.name = name;
  return mat;
}

const BEAM_VERT = /* glsl */ `
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  varying float vAxial;
  void main() {
    vAxial = uv.y;
    vNormalV = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPos = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const BEAM_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  varying float vAxial;
  void main() {
    float facing = abs(dot(normalize(vNormalV), normalize(vViewPos)));
    float edge = pow(facing, 1.8);
    float along = pow(max(0.0, 1.0 - vAxial), 1.5) * smoothstep(0.0, 0.06, vAxial);
    gl_FragColor = vec4(uColor * uIntensity * edge * along, 1.0);
  }
`;

/** Gradient headlight beam: bright at the lens, fading along its length and toward its silhouette edge. */
export function beamMaterial(name: string, color = 0xcfe8f6): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uIntensity: { value: 0 } },
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.AdditiveBlending,
  });
  mat.name = name;
  return mat;
}

const POOL_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const POOL_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uSym;
  varying vec2 vUv;
  void main() {
    // uv.y runs from the lamp (0) outward (1); uv.x across the pool.
    float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
    float lamp = pow(max(0.0, 1.0 - vUv.y), 1.3) * smoothstep(0.0, 0.08, vUv.y);
    float even = smoothstep(0.0, 0.2, vUv.y) * smoothstep(1.0, 0.8, vUv.y);
    float a = smoothstep(0.0, 0.65, across) * mix(lamp, even, uSym);
    gl_FragColor = vec4(uColor * uIntensity * a, 1.0);
  }
`;

/** Soft additive light pool laid just above the rail-top plane (headlight pool, under-car glow). */
export function poolMaterial(name: string, color: number, intensity = 0, symmetric = false): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uIntensity: { value: intensity }, uSym: { value: symmetric ? 1 : 0 } },
    vertexShader: POOL_VERT,
    fragmentShader: POOL_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  mat.name = name;
  return mat;
}

/** Motion state a car piece reads from `transit:car_motion` (published by `TransitRideController`). */
export interface CarMotion {
  /** Speed along the track, m/s. */
  speed: number;
  /** Free distance ahead of the nose before the beam would meet geometry, m. */
  clear: number;
}

export function parseCarMotion(payload: unknown, carId: string): CarMotion | null {
  if (!payload || typeof payload !== 'object') return null;
  const rec = payload as Record<string, unknown>;
  if (typeof rec['carId'] === 'string' && carId && rec['carId'] !== carId) return null;
  const speed = typeof rec['speed'] === 'number' && Number.isFinite(rec['speed']) ? Math.max(0, rec['speed']) : 0;
  const clear = typeof rec['clear'] === 'number' && Number.isFinite(rec['clear']) ? Math.max(0, rec['clear']) : 8;
  return { speed, clear };
}
