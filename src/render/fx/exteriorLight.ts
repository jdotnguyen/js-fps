import * as THREE from 'three';

/**
 * Lighting and water for everything outside the station (openspec change overhaul-exterior-ocean,
 * spec exterior-ocean). Exterior surfaces are not lit like rooms: the level's hemisphere, key and
 * pooled room lights are scaled down to a faint ambient, and up to `MAX_EXTERIOR_LAMPS` shadowless
 * spot lamps (hull floodlights, the sub's headlamps) are added on top. Everything fades into one
 * water colour by camera distance, whatever fog the current room uses.
 */

export const MAX_EXTERIOR_LAMPS = 8;
/** Near-black blue. Clear at ~8 m, ~two-thirds gone at 15 m, black by ~30 m. */
export const WATER_COLOR = 0x02070a;
export const WATER_DENSITY = 0.07;
/** How much of the ordinary (room / hemisphere / key) lighting still reaches exterior surfaces. */
export const EXTERIOR_AMBIENT = 0.08;
/** The dome is the water colour at and below the horizon, lifted by up to this factor straight up. */
export const DOME_LIFT = 0.6;

export interface ExteriorLamp {
  position: THREE.Vector3;
  /** Unit vector the lamp points along. */
  direction: THREE.Vector3;
  color: THREE.Color;
  intensity: number;
  /** Distance (m) at which the light reaches zero. */
  range: number;
  /** Half-angles (radians): full brightness inside `inner`, zero outside `outer`. */
  inner: number;
  outer: number;
}

const vec4s = (): THREE.Vector4[] => Array.from({ length: MAX_EXTERIOR_LAMPS }, () => new THREE.Vector4());

/** One uniform block shared by every exterior material: update once per frame, every shader sees it. */
export const exteriorUniforms = {
  uWaterColor: { value: new THREE.Color(WATER_COLOR) },
  uWaterDensity: { value: WATER_DENSITY },
  uExtAmbient: { value: EXTERIOR_AMBIENT },
  /** xyz position, w range. */
  uLampPos: { value: vec4s() },
  /** xyz direction, w cos(outer). */
  uLampDir: { value: vec4s() },
  /** rgb colour x intensity, w cos(inner). */
  uLampCol: { value: vec4s() },
  uLampCount: { value: 0 },
};

/** Dome brightness factor for a view direction's height (y of the unit vector). Mirrors the dome shader. */
export function domeLift(y: number): number {
  const t = Math.min(1, Math.max(0, y));
  return 1 + DOME_LIFT * t * t * (3 - 2 * t);
}

/**
 * Write `lamps` into the shared uniforms, nearest `eye` first, at most `MAX_EXTERIOR_LAMPS`.
 * Returns the number written.
 */
export function packLamps(lamps: readonly ExteriorLamp[], eye: THREE.Vector3): number {
  const order = lamps
    .filter((l) => l.intensity > 0)
    .map((l) => ({ l, d: l.position.distanceToSquared(eye) - l.range * l.range * 0.25 }))
    .sort((a, b) => a.d - b.d)
    .slice(0, MAX_EXTERIOR_LAMPS);
  const u = exteriorUniforms;
  order.forEach(({ l }, i) => {
    u.uLampPos.value[i]!.set(l.position.x, l.position.y, l.position.z, l.range);
    u.uLampDir.value[i]!.set(l.direction.x, l.direction.y, l.direction.z, Math.cos(l.outer));
    u.uLampCol.value[i]!.set(l.color.r * l.intensity, l.color.g * l.intensity, l.color.b * l.intensity, Math.cos(l.inner));
  });
  u.uLampCount.value = order.length;
  return order.length;
}

/** Uniform declarations and helpers, for exterior ShaderMaterials (beams, fish) and patched standard materials. */
export const EXTERIOR_GLSL = /* glsl */ `
uniform vec3 uWaterColor;
uniform float uWaterDensity;
uniform float uExtAmbient;
uniform vec4 uLampPos[${MAX_EXTERIOR_LAMPS}];
uniform vec4 uLampDir[${MAX_EXTERIOR_LAMPS}];
uniform vec4 uLampCol[${MAX_EXTERIOR_LAMPS}];
uniform int uLampCount;
/** Light from the exterior lamps reaching point p with normal n (n = vec3(0) for volume, no N.L). */
vec3 extLamps(vec3 p, vec3 n) {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < ${MAX_EXTERIOR_LAMPS}; i++) {
    if (i >= uLampCount) break;
    vec3 L = uLampPos[i].xyz - p;
    float d = length(L);
    vec3 l = L / max(d, 1e-4);
    float fall = clamp(1.0 - d / uLampPos[i].w, 0.0, 1.0);
    fall *= fall;
    float cone = smoothstep(uLampDir[i].w, uLampCol[i].w, dot(-l, uLampDir[i].xyz));
    float ndl = dot(n, n) > 0.5 ? max(dot(n, l), 0.0) : 1.0;
    sum += uLampCol[i].rgb * fall * cone * ndl / (1.0 + 0.05 * d * d);
  }
  return sum;
}
/** Subtle wet specular highlight from the exterior lamps (matte seabed stays matte; painted steel catches a sheen). */
vec3 extLampsSpec(vec3 p, vec3 n, vec3 v, float rough) {
  vec3 sum = vec3(0.0);
  float r = clamp(rough, 0.0, 1.0);
  float shininess = mix(48.0, 6.0, r);
  float specScale = mix(0.45, 0.03, r);
  for (int i = 0; i < ${MAX_EXTERIOR_LAMPS}; i++) {
    if (i >= uLampCount) break;
    vec3 L = uLampPos[i].xyz - p;
    float d = length(L);
    vec3 l = L / max(d, 1e-4);
    if (dot(n, l) <= 0.0) continue;
    float fall = clamp(1.0 - d / uLampPos[i].w, 0.0, 1.0);
    fall *= fall;
    float cone = smoothstep(uLampDir[i].w, uLampCol[i].w, dot(-l, uLampDir[i].xyz));
    vec3 h = normalize(l + v);
    float spec = pow(max(dot(n, h), 0.0), shininess) * specScale;
    sum += uLampCol[i].rgb * fall * cone * spec / (1.0 + 0.05 * d * d);
  }
  return sum;
}
float waterFog(float dist) {
  float k = uWaterDensity * dist;
  return clamp(1.0 - exp(-k * k), 0.0, 1.0);
}`;

const OUTGOING = 'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;';
let warned = false;

/** The shader hooks applyExterior needs; exported so a test can check them against three's source. */
export const EXTERIOR_HOOKS = { vertex: ['#include <common>', '#include <worldpos_vertex>'], fragment: ['#include <common>', OUTGOING, '#include <fog_fragment>'] };

/** Rewrite a standard/physical program for the exterior. Exposed for tests. */
export function patchExteriorShader(shader: { vertexShader: string; fragmentShader: string; uniforms: Record<string, THREE.IUniform> }): void {
  Object.assign(shader.uniforms, exteriorUniforms);
  const missing = [
    ...EXTERIOR_HOOKS.vertex.filter((h) => !shader.vertexShader.includes(h)),
    ...EXTERIOR_HOOKS.fragment.filter((h) => !shader.fragmentShader.includes(h)),
  ];
  if (missing.length && !warned) {
    warned = true;
    console.warn('[exterior] shader hooks missing, exterior lighting falls back to the standard look:', missing);
  }
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vExtWorld;')
    .replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
      vec4 extWorld = vec4(transformed, 1.0);
      #ifdef USE_BATCHING
        extWorld = batchingMatrix * extWorld;
      #endif
      #ifdef USE_INSTANCING
        extWorld = instanceMatrix * extWorld;
      #endif
      vExtWorld = (modelMatrix * extWorld).xyz;`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\nvarying vec3 vExtWorld;\n${EXTERIOR_GLSL}`)
    .replace(
      OUTGOING,
      `vec3 extN = inverseTransformDirection(normal, viewMatrix);
      vec3 extV = normalize(cameraPosition - vExtWorld);
      vec3 outgoingLight = (totalDiffuse + totalSpecular) * uExtAmbient + totalEmissiveRadiance + diffuseColor.rgb * extLamps(vExtWorld, extN) + extLampsSpec(vExtWorld, extN, extV, roughnessFactor);`,
    )
    .replace('#include <fog_fragment>', 'gl_FragColor.rgb = mix(gl_FragColor.rgb, uWaterColor, waterFog(length(vExtWorld - cameraPosition)));');
}

const patched = new WeakMap<THREE.Material, THREE.Material>();

/**
 * A copy of `material` lit and fogged as an exterior surface. Standard and physical materials only;
 * anything else is returned as-is. The same source always gives the same copy (shared programs).
 */
export function applyExterior<T extends THREE.Material>(material: T): T {
  if (!(material instanceof THREE.MeshStandardMaterial)) return material;
  if (material.userData['exterior'] === true) return material;
  const hit = patched.get(material);
  if (hit) return hit as T;
  const m = (material as THREE.MeshStandardMaterial).clone();
  m.name = `${material.name || material.type}:exterior`;
  m.userData = { ...material.userData, exterior: true };
  m.fog = true;
  const prior = material.customProgramCacheKey.call(material);
  m.onBeforeCompile = (shader) => patchExteriorShader(shader);
  m.customProgramCacheKey = () => `exterior|${prior}`;
  patched.set(material, m);
  return m as unknown as T;
}

/** Replace every mesh material under `root` with its exterior copy. */
export function exteriorize(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.material = Array.isArray(o.material) ? o.material.map((m) => applyExterior(m)) : applyExterior(o.material);
  });
}

/** Camera-centred water dome: drawn at the far plane, so every surface in front of it wins. */
export function createWaterDome(radius = 60): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: { ...exteriorUniforms },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 world = modelMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewMatrix * world;
        gl_Position.z = gl_Position.w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uWaterColor;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        float y = clamp(normalize(vDir).y, 0.0, 1.0);
        vec3 col = uWaterColor * (1.0 + ${DOME_LIFT.toFixed(3)} * y * y * (3.0 - 2.0 * y));
        // Dither so the near-black gradient never bands.
        col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
        gl_FragColor = vec4(max(col, 0.0), 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 12), material);
  dome.name = 'exterior-water-dome';
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  dome.userData['skipGtao'] = true;
  dome.castShadow = false;
  dome.receiveShadow = false;
  return dome;
}
