import * as THREE from 'three';

/** Upper bound on bones per humanoid (20 joints + extras + 9 stumps). */
export const MAX_BONES = 48;

export interface BodyUniforms {
  /** 0 = human skin, 1 = fully infected (stage 3). */
  uInfect: THREE.IUniform<number>;
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
varying float vSkin;
varying float vDark;
varying vec3 vBodyPos;
uniform float uDark[${MAX_BONES}];
`;

const VERT_MAIN = /* glsl */ `
vSkin = aSkin;
vBodyPos = position;
#ifdef USE_SKINNING
  vDark = uDark[int(skinIndex.x + 0.5)];
#else
  vDark = 0.0;
#endif
`;

const FRAG_PARS = /* glsl */ `
varying float vSkin;
varying float vDark;
varying vec3 vBodyPos;
uniform float uInfect;
`;

// Grey-violet mottled skin with dark veins as infection rises; cloth gets stained a little.
const FRAG_COLOR = /* glsl */ `
{
  vec3 q = vBodyPos * 38.0;
  float m = sin(q.x + sin(q.y * 0.7)) * sin(q.y * 1.3 + 1.7) * sin(q.z * 0.9 + 2.3);
  vec3 sick = mix(vec3(0.36, 0.35, 0.33), vec3(0.26, 0.15, 0.19), 0.5 + 0.5 * m);
  vec3 w = vBodyPos * vec3(23.0, 31.0, 27.0);
  float v1 = abs(sin(w.y * 2.3 + sin(w.x * 1.7 + w.z * 1.3) * 2.6 + sin(w.z * 0.9) * 1.5));
  float v2 = abs(sin(w.x * 2.1 - w.z * 1.4 + sin(w.y * 1.1) * 2.2));
  float vein = max(smoothstep(0.94, 1.0, v1), smoothstep(0.95, 1.0, v2)) * smoothstep(-0.3, 0.5, m);
  sick = mix(sick, vec3(0.08, 0.03, 0.06), vein * 0.7);
  float k = vSkin * smoothstep(0.0, 1.0, uInfect);
  diffuseColor.rgb = mix(diffuseColor.rgb, sick * (0.6 + 0.6 * diffuseColor.rgb), k);
  float stain = (1.0 - vSkin) * uInfect * 0.35 * smoothstep(0.2, 0.9, 0.5 + 0.5 * m);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.12, 0.03, 0.03), stain);
  diffuseColor.rgb *= 1.0 - 0.82 * vDark;
}
`;

const FRAG_ROUGH = /* glsl */ `
roughnessFactor = mix(roughnessFactor, 0.32, vSkin * uInfect);
`;

function hook(material: THREE.MeshStandardMaterial, uniforms: BodyUniforms, key: string): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uInfect = uniforms.uInfect;
    shader.uniforms.uDark = uniforms.uDark;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_COLOR}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FRAG_ROUGH}`);
  };
  // Same source for every humanoid, so they share one compiled program per variant.
  material.customProgramCacheKey = () => key;
}

/** One pair per humanoid: the uniforms (infection, dark limbs) are per body. */
export function createBodyMaterials(): BodyMaterials {
  const uniforms: BodyUniforms = {
    uInfect: { value: 0 },
    uDark: { value: new Float32Array(MAX_BONES) },
  };
  const body = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });
  body.name = 'humanoid-body';
  const wet = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.26, metalness: 0, envMapIntensity: 1.6 });
  wet.name = 'humanoid-wet';
  hook(body, uniforms, 'tag-humanoid-body-v1');
  hook(wet, uniforms, 'tag-humanoid-wet-v1');
  return { body, wet, uniforms };
}
