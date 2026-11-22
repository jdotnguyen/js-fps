import * as THREE from 'three';
import { addMurk } from '../render/water/murk.ts';

/** Upper bound on bones per humanoid (21 joints + detail hand/twist bones + growths, ribs, tendrils, stumps). */
export const MAX_BONES = 96;

/** Lumps that can crawl under the skin at once (infection-kills spec: something moving under the skin). */
export const MAX_BULGES = 4;

export interface BodyUniforms {
  /** 0 = human skin, 1 = fully infected (stage 3). */
  uInfect: THREE.IUniform<number>;
  /** Bioluminescence of eyes, pustules and tendril tips (0 on a healthy body). */
  uGlow: THREE.IUniform<number>;
  /** Per-bone darkening (Reduced gore marks dead limbs this way). */
  uDark: THREE.IUniform<Float32Array>;
  /**
   * Lumps under the skin, in bind-pose body space: xyz centre, w radius (0 = off). Displaced before skinning, so they ride
   * the bones of any body, procedural or imported.
   */
  uBulge: THREE.IUniform<THREE.Vector4[]>;
  /** Outward push of each lump (m). */
  uBulgeAmp: THREE.IUniform<Float32Array>;
  /** A torn-open wound on the front of the body, in bind-pose body space: xyz centre, w radius (0 = none). */
  uTear: THREE.IUniform<THREE.Vector4>;
  /** World height below which the body is wet from standing water (standing-water spec: Bodies stay wet); DRY when dry. */
  uWetLine: THREE.IUniform<number>;
}

/** A textured material for imported body models (one per model material). Textures are shared between bodies. */
export interface SurfaceDef {
  map: THREE.Texture | null;
  normalMap: THREE.Texture | null;
  /** Tint multiplied with the map (the model's base colour factor). */
  color: THREE.Color;
  /** 0 = opaque; otherwise cut-out alpha (hair cards). */
  alphaTest: number;
  doubleSided: boolean;
  roughness: number;
}

export interface BodyMaterials {
  body: THREE.MeshStandardMaterial;
  wet: THREE.MeshStandardMaterial;
  /** Imported-model surfaces by key (empty for procedural bodies). */
  surfaces: Record<string, THREE.MeshStandardMaterial>;
  uniforms: BodyUniforms;
}

const VERT_PARS = /* glsl */ `
attribute float aSkin;
attribute float aGlow;
attribute float aRot;
varying float vSkin;
varying float vGlow;
varying float vRot;
varying float vDark;
varying vec3 vBodyPos;
varying float vBulge;
varying float vTear;
uniform float uDark[${MAX_BONES}];
uniform vec4 uBulge[${MAX_BULGES}];
uniform float uBulgeAmp[${MAX_BULGES}];
uniform vec4 uTear;
varying float vWetY;
`;

const VERT_MAIN = /* glsl */ `
vSkin = aSkin;
vGlow = aGlow;
vRot = aRot;
vBodyPos = position;
// Lumps under the skin swell the surface along its rest normal; the bones then carry them (infection-kills spec).
vBulge = 0.0;
for (int i = 0; i < ${MAX_BULGES}; i++) {
  vec4 b = uBulge[i];
  if (b.w <= 0.0) continue;
  float d = length(position - b.xyz) / b.w;
  float f = exp(-d * d * 2.5);
  vBulge += f;
  transformed += normal * (uBulgeAmp[i] * f);
}
// A torn chest: the front caves in and turns to wet meat (the shader cannot open a hole without showing the inside).
vTear = 0.0;
if (uTear.w > 0.0) {
  // A ragged edge: the distance wobbles with the surface position.
  float rag = sin(position.x * 57.0 + sin(position.y * 43.0) * 2.0) * sin(position.y * 39.0 + position.z * 23.0);
  float d = length(position - uTear.xyz) / uTear.w * (1.0 + 0.16 * rag);
  float front = smoothstep(0.0, 0.35, -normal.z) * (1.0 - smoothstep(0.08, 0.13, abs(position.x - uTear.x)));
  vTear = (1.0 - smoothstep(0.6, 1.0, d)) * front;
  transformed -= normal * (0.045 * vTear * (1.0 - d * 0.6));
}
#ifdef USE_SKINNING
  vDark = uDark[int(skinIndex.x + 0.5)];
#else
  vDark = 0.0;
#endif
`;

const FRAG_PARS = /* glsl */ `
uniform float uWetLine;
varying float vWetY;
varying float vSkin;
varying float vGlow;
varying float vRot;
varying float vDark;
varying vec3 vBodyPos;
varying float vBulge;
varying float vTear;
uniform float uInfect;
uniform float uGlow;
float gRot;
float inner;
`;

// As infection rises: skin goes grey-violet with dark veins, the bloom eats holes through
// cloth and skin (raw, wet flesh), blood runs from eyes and mouth, eyes turn milky.
const FRAG_COLOR = /* glsl */ `
{
  vec3 q = vBodyPos * 38.0;
  float m = sin(q.x + sin(q.y * 0.7)) * sin(q.y * 1.3 + 1.7) * sin(q.z * 0.9 + 2.3);
  vec3 sick = mix(vec3(0.34, 0.33, 0.32), vec3(0.24, 0.13, 0.18), 0.5 + 0.5 * m);
  vec3 w = vBodyPos * vec3(23.0, 31.0, 27.0);
  float v1 = abs(sin(w.y * 2.3 + sin(w.x * 1.7 + w.z * 1.3) * 2.6 + sin(w.z * 0.9) * 1.5));
  float v2 = abs(sin(w.x * 2.1 - w.z * 1.4 + sin(w.y * 1.1) * 2.2));
  float vein = max(smoothstep(0.93, 1.0, v1), smoothstep(0.94, 1.0, v2)) * smoothstep(-0.3, 0.5, m);
  sick = mix(sick, vec3(0.06, 0.02, 0.05), vein * 0.8);
  float k = vSkin * smoothstep(0.0, 1.0, uInfect);
  diffuseColor.rgb = mix(diffuseColor.rgb, sick * (0.6 + 0.6 * diffuseColor.rgb), k);
  float stain = (1.0 - vSkin) * uInfect * 0.45 * smoothstep(0.2, 0.9, 0.5 + 0.5 * m);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.1, 0.02, 0.02), stain);
  // Rot and blood, revealed progressively by infection: a dark crusted rim, glistening
  // meat inside, clotted streaks.
  float r = vRot * uInfect * 1.6;
  gRot = smoothstep(0.32, 0.6, r);
  inner = smoothstep(0.55, 0.95, r);
  float grain = 0.5 + 0.5 * sin(q.x * 2.3 + sin(q.y * 3.1) * 2.0) * sin(q.z * 2.7 + q.y);
  vec3 crust = vec3(0.07, 0.012, 0.012);
  vec3 meat = mix(vec3(0.16, 0.012, 0.02), vec3(0.34, 0.05, 0.06), grain);
  meat = mix(meat, vec3(0.42, 0.24, 0.2), smoothstep(0.85, 1.0, grain) * 0.6 * (1.0 - vSkin));
  vec3 raw = mix(crust, meat, inner);
  diffuseColor.rgb = mix(diffuseColor.rgb, raw, gRot);
  // Milky, sick eyes.
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.47, 0.4), step(0.5, vGlow) * uInfect * 0.8);
  diffuseColor.rgb *= 1.0 - 0.82 * vDark;
  // Skin stretched over a lump: bruised, purple-dark, with a dark vein web round it.
  float lump = clamp(vBulge, 0.0, 1.0);
  float web = smoothstep(0.92, 1.0, v1) * smoothstep(0.05, 0.5, lump) * (1.0 - smoothstep(0.75, 1.0, lump));
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.62, 0.42, 0.55), lump * 0.75);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.08, 0.02, 0.05), web * 0.85);
  // Torn open: a dark clotted rim round glistening meat.
  if (vTear > 0.01) {
    vec3 tq = vBodyPos * 70.0;
    float tg = 0.5 + 0.5 * sin(tq.x + sin(tq.y * 1.3) * 2.0) * sin(tq.z * 1.7 + tq.y);
    // Dark clotted rim, then wet meat that only goes bright deep inside, with darker pits.
    vec3 meat = mix(vec3(0.14, 0.008, 0.015), vec3(0.34, 0.03, 0.045), tg * smoothstep(0.45, 0.9, vTear));
    vec3 wound = mix(vec3(0.035, 0.003, 0.005), meat, smoothstep(0.2, 0.55, vTear));
    diffuseColor.rgb = mix(diffuseColor.rgb, wound, smoothstep(0.02, 0.22, vTear));
  }
}
`;

/** uWetLine when dry: far below anything. */
export const DRY = -1e4;

// World height of the skinned vertex, for the wet line (after skinning, so it follows the legs).
const VERT_WET = /* glsl */ `
vWetY = (modelMatrix * vec4(transformed, 1.0)).y;
`;

// Below the wet line: darker and glossier, with a soft 5 cm edge.
const FRAG_WET = /* glsl */ `
float wetK = 1.0 - smoothstep(uWetLine - 0.03, uWetLine + 0.02, vWetY);
diffuseColor.rgb *= mix(1.0, 0.55, wetK);
`;

const FRAG_ROUGH = /* glsl */ `
roughnessFactor = mix(roughnessFactor, 0.14, wetK);
roughnessFactor = mix(roughnessFactor, 0.32, vSkin * uInfect);
roughnessFactor = mix(roughnessFactor, mix(0.55, 0.12, inner), gRot);
roughnessFactor = mix(roughnessFactor, 0.1, clamp(-vRot, 0.0, 1.0));
roughnessFactor = mix(roughnessFactor, 0.12, smoothstep(0.02, 0.3, vTear));
`;

const FRAG_EMISSIVE = /* glsl */ `
totalEmissiveRadiance += vec3(0.22, 0.85, 0.62) * vGlow * uGlow * (1.0 - vDark);
`;

function hook(material: THREE.MeshStandardMaterial, uniforms: BodyUniforms, key: string): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uInfect = uniforms.uInfect;
    shader.uniforms.uGlow = uniforms.uGlow;
    shader.uniforms.uDark = uniforms.uDark;
    shader.uniforms.uBulge = uniforms.uBulge;
    shader.uniforms.uBulgeAmp = uniforms.uBulgeAmp;
    shader.uniforms.uTear = uniforms.uTear;
    shader.uniforms.uWetLine = uniforms.uWetLine;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_MAIN}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_WET}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_COLOR}\n${FRAG_WET}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FRAG_ROUGH}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAG_EMISSIVE}`);
  };
  // Same source for every humanoid, so they share one compiled program per variant.
  material.customProgramCacheKey = () => key;
  // Legs under standing water fade into it (standing-water spec: Depth makes the water murky).
  addMurk(material);
}

/** One set per humanoid: the uniforms (infection, glow, dark limbs) are per body. */
export function createBodyMaterials(surfaceDefs: Readonly<Record<string, SurfaceDef>> = {}): BodyMaterials {
  const uniforms: BodyUniforms = {
    uInfect: { value: 0 },
    uGlow: { value: 0 },
    uDark: { value: new Float32Array(MAX_BONES) },
    uBulge: { value: Array.from({ length: MAX_BULGES }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uBulgeAmp: { value: new Float32Array(MAX_BULGES) },
    uTear: { value: new THREE.Vector4(0, 0, 0, 0) },
    uWetLine: { value: DRY },
  };
  const body = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });
  body.name = 'humanoid-body';
  const wet = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.2, metalness: 0, envMapIntensity: 1.8 });
  wet.name = 'humanoid-wet';
  hook(body, uniforms, 'tag-humanoid-body-v4');
  hook(wet, uniforms, 'tag-humanoid-wet-v4');
  const surfaces: Record<string, THREE.MeshStandardMaterial> = {};
  for (const [key, def] of Object.entries(surfaceDefs)) {
    // Vertex colours stay on (white on imported pieces) so the infection shader reads the same inputs.
    const m = new THREE.MeshStandardMaterial({
      vertexColors: true,
      color: def.color,
      map: def.map,
      normalMap: def.normalMap,
      roughness: def.roughness,
      metalness: 0,
      alphaTest: def.alphaTest,
      side: def.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    });
    m.name = `humanoid-surface:${key}`;
    hook(m, uniforms, 'tag-humanoid-surface-v2');
    surfaces[key] = m;
  }
  return { body, wet, surfaces, uniforms };
}
