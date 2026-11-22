import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { NOISE_GLSL } from '../fx/glsl.ts';
import type { WaterBody } from '../../world/water.ts';

/**
 * The surface of a standing-water body (standing-water spec, overhaul-flooded-tunnel D3): a built-in standard material,
 * so the light pool, shadow lights, the flashlight and every light pattern light it with no extra code path, patched
 * with `onBeforeCompile` for:
 * - normals from two scrolling detail layers plus the ripple simulation's heights (D6)
 * - the planar reflection (D4), weighted by Schlick Fresnel, or the fog colour where there is none (Low)
 * - alpha that rises at grazing angles and under bright highlights, so glints stay bright on a see-through surface
 */

/** Uniforms one water body's surface shares with the ripple simulation and the reflection pass. */
export interface WaterSurfaceUniforms {
  uTime: { value: number };
  /** Ripple heights (R, metres), or null while the simulation is off. */
  uRipple: { value: THREE.Texture | null };
  uRippleOn: { value: number };
  /** World xz of the simulation's min corner, and its size (m). */
  uRippleBounds: { value: THREE.Vector4 };
  /** One texel of the ripple texture, in uv. */
  uRippleTexel: { value: THREE.Vector2 };
  /** Mirror render of the room (D4), or null on Low / while not rendered. */
  uRefl: { value: THREE.Texture | null };
  uReflOn: { value: number };
  /** World position to reflection-texture projection (bias * mirror projection * mirror view). */
  uReflMatrix: { value: THREE.Matrix4 };
  /** Base opacity looking straight down (the water is see-through; murk comes from below, D5). */
  uOpacity: { value: number };
}

/** Water colour (albedo), roughness and see-through amount. */
export const WATER_LOOK = { color: 0x0b2426, roughness: 0.045, opacity: 0.42, fresnelF0: 0.02 } as const;

export function waterSurfaceUniforms(): WaterSurfaceUniforms {
  return {
    uTime: { value: 0 },
    uRipple: { value: null },
    uRippleOn: { value: 0 },
    uRippleBounds: { value: new THREE.Vector4(0, 0, 1, 1) },
    uRippleTexel: { value: new THREE.Vector2(1 / 256, 1 / 256) },
    uRefl: { value: null },
    uReflOn: { value: 0 },
    uReflMatrix: { value: new THREE.Matrix4() },
    uOpacity: { value: WATER_LOOK.opacity },
  };
}

const VERT_PARS = /* glsl */ `
uniform mat4 uReflMatrix;
varying vec3 vWaterWorld;
varying vec4 vReflCoord;`;

const VERT_MAIN = /* glsl */ `
vWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vReflCoord = uReflMatrix * vec4(vWaterWorld, 1.0);`;

const FRAG_PARS = /* glsl */ `
uniform float uTime;
uniform sampler2D uRipple;
uniform float uRippleOn;
uniform vec4 uRippleBounds;
uniform vec2 uRippleTexel;
uniform sampler2D uRefl;
uniform float uReflOn;
uniform float uOpacity;
varying vec3 vWaterWorld;
varying vec4 vReflCoord;
${NOISE_GLSL}
// Slow, fine detail: standing water never rolls (standing-water spec, "calm but alive").
float waterDetail(vec2 p) {
  float t = uTime;
  return vnoise(p * 2.1 + vec2(t * 0.11, t * 0.07)) * 0.6 + vnoise(p * 5.3 - vec2(t * 0.05, -t * 0.09)) * 0.4;
}
vec2 waterSlope(vec2 p) {
  const float e = 0.03;
  const float amp = 0.0045;
  vec2 g = vec2(waterDetail(p + vec2(e, 0.0)) - waterDetail(p - vec2(e, 0.0)), waterDetail(p + vec2(0.0, e)) - waterDetail(p - vec2(0.0, e))) * (amp / (2.0 * e));
  if (uRippleOn > 0.5) {
    vec2 uv = (p - uRippleBounds.xy) / uRippleBounds.zw;
    vec2 d = uRippleTexel;
    float hx = texture2D(uRipple, uv + vec2(d.x, 0.0)).r - texture2D(uRipple, uv - vec2(d.x, 0.0)).r;
    float hz = texture2D(uRipple, uv + vec2(0.0, d.y)).r - texture2D(uRipple, uv - vec2(0.0, d.y)).r;
    g += vec2(hx, hz) / (2.0 * d * uRippleBounds.zw);
  }
  return g;
}`;

/** World-space normal of the surface, then into view space for the lighting that follows. */
const FRAG_NORMAL = /* glsl */ `
vec2 wSlope = waterSlope(vWaterWorld.xz);
vec3 wNormal = normalize(vec3(-wSlope.x, 1.0, -wSlope.y));
normal = normalize((viewMatrix * vec4(wNormal, 0.0)).xyz);`;

const FRAG_OUT = /* glsl */ `
{
  vec3 toEye = normalize(cameraPosition - vWaterWorld);
  float cosV = clamp(dot(toEye, wNormal), 0.0, 1.0);
  float fres = ${WATER_LOOK.fresnelF0} + (1.0 - ${WATER_LOOK.fresnelF0}) * pow(1.0 - cosV, 5.0);
  vec3 refl;
  if (uReflOn > 0.5) {
    vec2 ruv = vReflCoord.xy / vReflCoord.w + wSlope * 0.35;
    refl = texture2D(uRefl, ruv).rgb;
  } else {
    #ifdef USE_FOG
      refl = fogColor * 0.6;
    #else
      refl = vec3(0.02, 0.05, 0.05);
    #endif
  }
  outgoingLight += refl * fres;
  vec3 spec = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
  float specL = dot(spec, vec3(0.299, 0.587, 0.114));
  diffuseColor.a = clamp(max(mix(uOpacity, 1.0, fres), specL * 1.5), 0.0, 1.0);
}`;

/** The anchors the patch replaces; `water.test.ts` checks every one exists in the installed three.js shaders. */
export const WATER_ANCHORS = {
  vertexPars: '#include <common>',
  vertexMain: '#include <project_vertex>',
  fragmentPars: '#include <common>',
  fragmentNormal: '#include <normal_fragment_maps>',
  fragmentOut: '#include <opaque_fragment>',
} as const;

/** Patch a standard-material shader into the water surface shader. */
export function patchWaterShader(shader: { vertexShader: string; fragmentShader: string; uniforms: Record<string, THREE.IUniform> }, u: WaterSurfaceUniforms): void {
  Object.assign(shader.uniforms, u);
  shader.vertexShader = shader.vertexShader
    .replace(WATER_ANCHORS.vertexPars, `${WATER_ANCHORS.vertexPars}\n${VERT_PARS}`)
    .replace(WATER_ANCHORS.vertexMain, `${WATER_ANCHORS.vertexMain}\n${VERT_MAIN}`);
  shader.fragmentShader = shader.fragmentShader
    .replace(WATER_ANCHORS.fragmentPars, `${WATER_ANCHORS.fragmentPars}\n${FRAG_PARS}`)
    .replace(WATER_ANCHORS.fragmentNormal, `${WATER_ANCHORS.fragmentNormal}\n${FRAG_NORMAL}`)
    .replace(WATER_ANCHORS.fragmentOut, `${FRAG_OUT}\n${WATER_ANCHORS.fragmentOut}`);
}

export function waterSurfaceMaterial(u: WaterSurfaceUniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: WATER_LOOK.color, roughness: WATER_LOOK.roughness, metalness: 0, transparent: true, depthWrite: false });
  m.name = 'standing-water';
  m.onBeforeCompile = (shader) => patchWaterShader(shader, u);
  m.customProgramCacheKey = () => 'standing-water';
  return m;
}

/** One flat plane per footprint cell, merged, at y = 0 (the mesh is moved to the water level each frame). */
export function waterSurfaceGeometry(body: WaterBody): THREE.BufferGeometry {
  const parts = body.interior().map((c) => {
    const g = new THREE.PlaneGeometry(c.maxX - c.minX, c.maxZ - c.minZ, 1, 1);
    g.rotateX(-Math.PI / 2);
    g.translate((c.minX + c.maxX) / 2, 0, (c.minZ + c.maxZ) / 2);
    return g;
  });
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

/** The visible surface of one water body. `update` follows the body's level and the clock. */
export class WaterSurface {
  readonly mesh: THREE.Mesh;
  readonly uniforms = waterSurfaceUniforms();
  readonly body: WaterBody;

  constructor(body: WaterBody) {
    this.body = body;
    this.mesh = new THREE.Mesh(waterSurfaceGeometry(body), waterSurfaceMaterial(this.uniforms));
    this.mesh.name = `water:${body.room}`;
    this.mesh.renderOrder = 2;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.userData['water'] = body.room;
    this.update(0);
  }

  update(t: number): void {
    this.uniforms.uTime.value = t;
    this.mesh.position.y = this.body.level;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
