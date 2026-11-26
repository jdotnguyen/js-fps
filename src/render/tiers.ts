import type { Settings } from '../core/settings.ts';

export type Quality = Settings['quality'];

/** Every rendering budget one quality tier sets (render-quality spec). One edit here changes what a tier means. */
export interface RenderTier {
  /** Real fill point lights in each world's pool (render-lighting spec). */
  fillLights: number;
  /** Shadow-casting room spot lights, on top of the flashlight. */
  shadowLights: number;
  /** Of those, how many can project a light pattern (a cookie; shadow-rich-rooms D7). Each takes one more texture unit. */
  cookieSpots: number;
  shadowMapSize: number;
  /** Highest device pixel ratio rendered; Infinity renders at the display's own ratio. */
  pixelRatioCap: number;
  smaa: boolean;
  gtao: boolean;
  bloom: boolean;
  /** Texture anisotropy, or 'max' for the GPU's maximum. */
  anisotropy: number | 'max';
  /** Characters cast shadows up to this far from the camera (m). */
  characterShadowDistance: number;
}

export const RENDER_TIERS: Readonly<Record<Quality, Readonly<RenderTier>>> = Object.freeze({
  low: Object.freeze({ fillLights: 12, shadowLights: 0, cookieSpots: 0, shadowMapSize: 512, pixelRatioCap: 1, smaa: false, gtao: false, bloom: false, anisotropy: 8, characterShadowDistance: 15 }),
  medium: Object.freeze({ fillLights: 16, shadowLights: 2, cookieSpots: 1, shadowMapSize: 1024, pixelRatioCap: 1.25, smaa: true, gtao: false, bloom: true, anisotropy: 8, characterShadowDistance: 15 }),
  high: Object.freeze({ fillLights: 32, shadowLights: 6, cookieSpots: 2, shadowMapSize: 2048, pixelRatioCap: Infinity, smaa: true, gtao: true, bloom: true, anisotropy: 'max', characterShadowDistance: 40 }),
});

/** What the GPU allows, read once at startup. */
export interface GpuLimits {
  /** MAX_TEXTURE_IMAGE_UNITS (fragment samplers). */
  maxTextures: number;
  /** MAX_FRAGMENT_UNIFORM_VECTORS. */
  maxFragmentUniforms: number;
  /** Samplers the heaviest lit material uses itself (maps plus environment). */
  materialUnits: number;
}

/** Fragment uniform vectors per point light (position, colour, distance and decay) in three's lights struct. */
const VECTORS_PER_POINT_LIGHT = 3;
/** Fragment uniform vectors per shadowed spot light (light struct plus shadow params). */
const VECTORS_PER_SHADOW_SPOT = 7;
/** Vectors left for the material, the hemisphere and key lights, fog and the flashlight. */
const RESERVED_FRAGMENT_VECTORS = 128;

/** Texture units the flashlight takes on every tier: its shadow map and its lens pattern (player-flashlight spec). */
export const FLASHLIGHT_UNITS = 2;

/**
 * A tier fitted to the GPU: shadow lights and their patterns to the samplers left after the heaviest material and
 * the flashlight (patterns are cut first), fill lights to the fragment uniforms left after those. Each cut is a warning.
 */
export function clampTier(tier: Readonly<RenderTier>, gpu: GpuLimits): { tier: RenderTier; warnings: string[] } {
  const out: RenderTier = { ...tier };
  const warnings: string[] = [];
  const unitsLeft = Math.max(0, gpu.maxTextures - gpu.materialUnits - FLASHLIGHT_UNITS);
  const used = `${gpu.maxTextures} texture units, ${gpu.materialUnits} used by materials, ${FLASHLIGHT_UNITS} by the flashlight`;
  out.cookieSpots = Math.min(out.cookieSpots, out.shadowLights);
  const cookieFit = Math.max(0, Math.min(out.cookieSpots, unitsLeft - out.shadowLights));
  if (cookieFit < out.cookieSpots) {
    warnings.push(`light patterns ${out.cookieSpots} -> ${cookieFit}: ${used}`);
    out.cookieSpots = cookieFit;
  }
  if (out.shadowLights > unitsLeft) {
    warnings.push(`shadow lights ${out.shadowLights} -> ${unitsLeft}: ${used}`);
    out.shadowLights = unitsLeft;
  }
  const vectorsLeft = gpu.maxFragmentUniforms - RESERVED_FRAGMENT_VECTORS - (out.shadowLights + 1) * VECTORS_PER_SHADOW_SPOT;
  const fillFit = Math.max(0, Math.floor(vectorsLeft / VECTORS_PER_POINT_LIGHT));
  if (out.fillLights > fillFit) {
    warnings.push(`fill lights ${out.fillLights} -> ${fillFit}: ${gpu.maxFragmentUniforms} fragment uniform vectors`);
    out.fillLights = fillFit;
  }
  return { tier: out, warnings };
}

/** The tier's anisotropy as a number for this GPU. */
export function anisotropyFor(tier: Readonly<RenderTier>, gpuMax: number): number {
  return tier.anisotropy === 'max' ? gpuMax : Math.min(tier.anisotropy, gpuMax);
}

const TEXTURE_SLOTS = [
  'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'displacementMap', 'lightMap', 'envMap',
  // MeshPhysicalMaterial's clearcoat (the Juggernaut's eyes and teeth, openspec rig-juggernaut D11).
  'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap',
] as const;

/**
 * Samplers a material binds for its own maps (the shadow budget's "material units"). Since r187 every
 * MeshStandardMaterial (and MeshPhysicalMaterial) program also binds three's `dfgLUT`; leaving it out let the
 * heaviest materials exceed the GPU's units on High (hull plates, lab decals: shader validation failed).
 */
export function materialTextureUnits(material: object, sceneEnvironment: boolean): number {
  const rec = material as Record<string, unknown>;
  let n = 0;
  for (const k of TEXTURE_SLOTS) if (rec[k]) n++;
  if (sceneEnvironment && !rec['envMap'] && 'envMapIntensity' in rec) n++;
  if (rec['isMeshStandardMaterial'] === true) n++;
  return n;
}
