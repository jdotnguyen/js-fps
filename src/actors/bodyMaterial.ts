import * as THREE from 'three';

/** Upper bound on bones per humanoid (21 joints + growths, ribs, tendrils, stumps). */
export const MAX_BONES = 64;

export interface BodyUniforms {
  /** 0 = human skin, 1 = fully infected (stage 3). */
  uInfect: THREE.IUniform<number>;
  /** Bioluminescence of eyes, pustules and tendril tips (0 on a healthy body). */
  uGlow: THREE.IUniform<number>;
  /** Per-bone darkening (Reduced gore marks dead limbs this way). */
  uDark: THREE.IUniform<Float32Array>;
}

export interface BodyMaterials {
  body: THREE.MeshStandardMaterial;
  wet: THREE.MeshStandardMaterial;
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
uniform float uDark[${MAX_BONES}];
`;

const VERT_MAIN = /* glsl */ `
vSkin = aSkin;
vGlow = aGlow;
vRot = aRot;
vBodyPos = position;
#ifdef USE_SKINNING
  vDark = uDark[int(skinIndex.x + 0.5)];
#else
  vDark = 0.0;
#endif
`;

const FRAG_PARS = /* glsl */ `
varying float vSkin;
varying float vGlow;
varying float vRot;
varying float vDark;
varying vec3 vBodyPos;
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
}
`;

const FRAG_ROUGH = /* glsl */ `
roughnessFactor = mix(roughnessFactor, 0.32, vSkin * uInfect);
roughnessFactor = mix(roughnessFactor, mix(0.55, 0.12, inner), gRot);
roughnessFactor = mix(roughnessFactor, 0.1, clamp(-vRot, 0.0, 1.0));
`;

const FRAG_EMISSIVE = /* glsl */ `
totalEmissiveRadiance += vec3(0.22, 0.85, 0.62) * vGlow * uGlow * (1.0 - vDark);
`;

function hook(material: THREE.MeshStandardMaterial, uniforms: BodyUniforms, key: string): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uInfect = uniforms.uInfect;
    shader.uniforms.uGlow = uniforms.uGlow;
    shader.uniforms.uDark = uniforms.uDark;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_COLOR}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FRAG_ROUGH}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAG_EMISSIVE}`);
  };
  // Same source for every humanoid, so they share one compiled program per variant.
  material.customProgramCacheKey = () => key;
}

/** One pair per humanoid: the uniforms (infection, glow, dark limbs) are per body. */
export function createBodyMaterials(): BodyMaterials {
  const uniforms: BodyUniforms = {
    uInfect: { value: 0 },
    uGlow: { value: 0 },
    uDark: { value: new Float32Array(MAX_BONES) },
  };
  const body = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });
  body.name = 'humanoid-body';
  const wet = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.2, metalness: 0, envMapIntensity: 1.8 });
  wet.name = 'humanoid-wet';
  hook(body, uniforms, 'tag-humanoid-body-v3');
  hook(wet, uniforms, 'tag-humanoid-wet-v3');
  return { body, wet, uniforms };
}
