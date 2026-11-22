import * as THREE from 'three';
import type { WaterBody } from '../../world/water.ts';

/**
 * Murk under standing water (standing-water spec "Depth makes the water murky", overhaul-flooded-tunnel D5): computed in
 * the material of whatever is under the surface, not from a depth buffer. A fragment inside a water box and below its
 * level mixes toward the water colour by `1 - exp(-absorb * length)`, where `length` is how far the view ray travels
 * under the surface to reach it. One set of uniforms is shared by every patched material; with no water active (or a
 * fragment outside every box) the branch does nothing.
 */

/** Boxes the murk can cover at once (a water body's footprint is split into rows of cells). */
export const MAX_MURK_BOXES = 12;

export const MURK_LOOK = {
  /** Linear colour of the water a long way down (dark, green-teal). */
  color: new THREE.Color(0.0045, 0.012, 0.011),
  /** Per metre of view ray under water: the first step 10 cm down stays clear, the floor 75 cm down is nearly lost. */
  absorb: 1.6,
} as const;

export interface MurkUniforms {
  uMurkCount: { value: number };
  /** min x, min z, max x, max z per box. */
  uMurkBox: { value: THREE.Vector4[] };
  uMurkLevel: { value: number[] };
  uMurkColor: { value: THREE.Color };
  uMurkAbsorb: { value: number };
}

/** The one shared set (every patched material references these objects). */
export const MURK: MurkUniforms = {
  uMurkCount: { value: 0 },
  uMurkBox: { value: Array.from({ length: MAX_MURK_BOXES }, () => new THREE.Vector4()) },
  uMurkLevel: { value: new Array<number>(MAX_MURK_BOXES).fill(0) },
  uMurkColor: { value: MURK_LOOK.color.clone() },
  uMurkAbsorb: { value: MURK_LOOK.absorb },
};

/** How much of the water colour a point under the surface takes (the shader's formula, for tests and tools). */
export function murkAmount(cam: { x: number; y: number; z: number }, p: { x: number; y: number; z: number }, level: number, absorb = MURK_LOOK.absorb): number {
  if (p.y >= level) return 0;
  const d = Math.hypot(cam.x - p.x, cam.y - p.y, cam.z - p.z);
  const under = cam.y > level ? (d * (level - p.y)) / Math.max(cam.y - p.y, 1e-3) : d;
  return 1 - Math.exp(-absorb * under);
}

/** A body's footprint as boxes, one per cell, stopping short of its walls (`WaterBody.interior`). */
export function murkBoxes(body: WaterBody): Array<[number, number, number, number]> {
  return body.interior().map((c) => [c.minX, c.minZ, c.maxX, c.maxZ]);
}

/** Cells merged along x within each row of z (kept for tools; the murk uses `murkBoxes`). */
export function murkRows(body: WaterBody): Array<[number, number, number, number]> {
  const rows = new Map<string, Array<{ minX: number; maxX: number }>>();
  for (const c of body.cells) {
    const key = `${c.minZ},${c.maxZ}`;
    const row = rows.get(key) ?? [];
    row.push({ minX: c.minX, maxX: c.maxX });
    rows.set(key, row);
  }
  const out: Array<[number, number, number, number]> = [];
  for (const [key, row] of rows) {
    const [minZ, maxZ] = key.split(',').map(Number) as [number, number];
    row.sort((a, b) => a.minX - b.minX);
    let cur = { ...row[0]! };
    for (const c of row.slice(1)) {
      if (c.minX <= cur.maxX + 1e-6) cur.maxX = Math.max(cur.maxX, c.maxX);
      else {
        out.push([cur.minX, minZ, cur.maxX, maxZ]);
        cur = { ...c };
      }
    }
    out.push([cur.minX, minZ, cur.maxX, maxZ]);
  }
  return out;
}

/** Point the shared uniforms at these bodies (their current levels). Bodies past MAX_MURK_BOXES are left out. */
export function updateMurk(bodies: readonly WaterBody[]): void {
  let n = 0;
  for (const b of bodies) {
    for (const box of murkBoxes(b)) {
      if (n >= MAX_MURK_BOXES) break;
      MURK.uMurkBox.value[n]!.set(...box);
      MURK.uMurkLevel.value[n] = b.level;
      n++;
    }
  }
  MURK.uMurkCount.value = n;
}

const VERT_PARS = /* glsl */ `
varying vec3 vMurkWorld;`;

const VERT_MAIN = /* glsl */ `
{
  vec4 murkP = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    murkP = instanceMatrix * murkP;
  #endif
  vMurkWorld = (modelMatrix * murkP).xyz;
}`;

const FRAG_PARS = /* glsl */ `
uniform int uMurkCount;
uniform vec4 uMurkBox[${MAX_MURK_BOXES}];
uniform float uMurkLevel[${MAX_MURK_BOXES}];
uniform vec3 uMurkColor;
uniform float uMurkAbsorb;
varying vec3 vMurkWorld;`;

const FRAG_MAIN = /* glsl */ `
for (int i = 0; i < ${MAX_MURK_BOXES}; i++) {
  if (i >= uMurkCount) break;
  vec4 mb = uMurkBox[i];
  float lv = uMurkLevel[i];
  if (vMurkWorld.y < lv && vMurkWorld.x > mb.x && vMurkWorld.x < mb.z && vMurkWorld.z > mb.y && vMurkWorld.z < mb.w) {
    float md = distance(cameraPosition, vMurkWorld);
    float under = cameraPosition.y > lv ? md * (lv - vMurkWorld.y) / max(cameraPosition.y - vMurkWorld.y, 1e-3) : md;
    gl_FragColor.rgb = mix(gl_FragColor.rgb, uMurkColor, 1.0 - exp(-uMurkAbsorb * under));
    break;
  }
}`;

/** Where the patch goes; `murk.test.ts` checks each exists in the installed three.js shaders. */
export const MURK_ANCHORS = {
  vertexPars: '#include <common>',
  vertexMain: '#include <project_vertex>',
  fragmentPars: '#include <common>',
  fragmentMain: '#include <fog_fragment>',
} as const;

export function patchMurkShader(shader: { vertexShader: string; fragmentShader: string; uniforms: Record<string, THREE.IUniform> }): void {
  Object.assign(shader.uniforms, MURK);
  shader.vertexShader = shader.vertexShader
    .replace(MURK_ANCHORS.vertexPars, `${MURK_ANCHORS.vertexPars}\n${VERT_PARS}`)
    .replace(MURK_ANCHORS.vertexMain, `${MURK_ANCHORS.vertexMain}\n${VERT_MAIN}`);
  shader.fragmentShader = shader.fragmentShader
    .replace(MURK_ANCHORS.fragmentPars, `${MURK_ANCHORS.fragmentPars}\n${FRAG_PARS}`)
    .replace(MURK_ANCHORS.fragmentMain, `${FRAG_MAIN}\n${MURK_ANCHORS.fragmentMain}`);
}

const patched = new WeakSet<THREE.Material>();

/**
 * Give a material the murk, keeping any patch it already has (it runs first). Idempotent. Only built-in lit materials
 * are patched; shader materials and the water surface itself are left alone.
 */
export function addMurk(material: THREE.Material): void {
  if (patched.has(material)) return;
  if (!(material instanceof THREE.MeshStandardMaterial) || material.name === 'standing-water') return;
  patched.add(material);
  const prior = material.onBeforeCompile;
  // three's default key is the onBeforeCompile source: key on the original patch, not on this wrapper, so materials
  // with different patches never share a program.
  const defaultKey = material.customProgramCacheKey === THREE.Material.prototype.customProgramCacheKey;
  const priorKey = defaultKey ? ((src: string) => () => src)(prior.toString()) : material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    prior.call(material, shader, renderer);
    patchMurkShader(shader);
  };
  material.customProgramCacheKey = () => `${priorKey()}|murk`;
  material.needsUpdate = true;
}

/** Patch every material under `root`. */
export function addMurkTo(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) addMurk(mat);
  });
}
