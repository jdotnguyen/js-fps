import type * as THREE from 'three';
import type { Materials } from '../../render/materials.ts';
import { PHOTO_SLOT_KEYS } from '../../render/tex/manifest.ts';
import type { PieceParams } from './types.ts';

/**
 * Per-area material palettes (openspec: adopt-photoscanned-textures, "Per-area palette").
 * The level builder injects the room's `area` into every piece's params; structure pieces
 * call `resolvePalette(params, m)` to get their materials. A piece can override the main
 * surface with `params.material: "<slot>"` (any key in `PALETTE_MATERIAL_KEYS`).
 *
 * UV contract: photo slots need metre UVs (`tile` = 1 in kit geometry); `steel`, `grating`
 * and `hazardClean` are procedural and keep their old tile values.
 */

/** Materials a palette entry or `params.material` override may name (surface materials, not glass/black/cable/glow). */
export const PALETTE_MATERIAL_KEYS = [...PHOTO_SLOT_KEYS, 'steel', 'grating', 'hazardClean'] as const satisfies ReadonlyArray<keyof Materials>;
export type PaletteMaterialKey = (typeof PALETTE_MATERIAL_KEYS)[number];

export function isPaletteMaterialKey(k: string): k is PaletteMaterialKey {
  return (PALETTE_MATERIAL_KEYS as readonly string[]).includes(k);
}

export interface AreaPalette {
  /** Wall backing and lower panels. */
  wallMain: PaletteMaterialKey;
  /** Upper panels and the occasional accent panel; defaults to `wallMain`. */
  wallAlt?: PaletteMaterialKey;
  /** Floor plates. */
  floor: PaletteMaterialKey;
  /** Floor trim (grate rims, inlays); defaults to `steel`. */
  floorAlt?: PaletteMaterialKey;
  /** Hazard striping: photo `hazard` is rusty (dive bay, tunnel); everywhere else the clean procedural stripes. */
  hazard: 'hazard' | 'hazardClean';
}

export const AREA_PALETTES: Record<string, AreaPalette> = {
  dock: { wallMain: 'paintDark', wallAlt: 'steel', floor: 'concretePainted', floorAlt: 'diamond', hazard: 'hazardClean' },
  commons: { wallMain: 'paintBone', wallAlt: 'paintTeal', floor: 'rubber', hazard: 'hazardClean' },
  gallery: { wallMain: 'paintDark', floor: 'rubber', hazard: 'hazardClean' },
  labs: { wallMain: 'labPanel', floor: 'labTile', hazard: 'hazardClean' },
  security: { wallMain: 'paintDark', floor: 'rubber', hazard: 'hazardClean' },
  medbay: { wallMain: 'paintBone', floor: 'labTile', hazard: 'hazardClean' },
  tunnel: { wallMain: 'rustHeavy', wallAlt: 'concrete', floor: 'concreteFloor', floorAlt: 'diamondRusty', hazard: 'hazard' },
  control: { wallMain: 'paintDark', floor: 'concretePainted', hazard: 'hazardClean' },
  hydroponics: { wallMain: 'paintTeal', floor: 'labTile', hazard: 'hazardClean' },
  dive_bay: { wallMain: 'rustBlotch', wallAlt: 'paintDark', floor: 'diamondRusty', floorAlt: 'diamondHazard', hazard: 'hazard' },
  // Admin keeps its procedural wood and carpet (wall_wood / floor_carpet); the plain walls are bone.
  admin: { wallMain: 'paintBone', floor: 'diamond', hazard: 'hazardClean' },
};

/** Used when a piece has no area (corridors, test rooms): the docking ring look. */
export const DEFAULT_PALETTE: AreaPalette = AREA_PALETTES.dock!;

export interface ResolvedPalette {
  wallMain: THREE.MeshStandardMaterial;
  wallAlt: THREE.MeshStandardMaterial;
  floor: THREE.MeshStandardMaterial;
  floorAlt: THREE.MeshStandardMaterial;
  hazard: THREE.MeshStandardMaterial;
  /** Tile argument for thin hazard strips: photo `hazard` needs metre UVs, the procedural stripes want 0.5. */
  hazardTile: number;
  /** True when `params.material` replaced the area's main surfaces. */
  overridden: boolean;
}

/** Palette for an area name (unknown or missing areas get the default). */
export function paletteFor(area: string | undefined): AreaPalette {
  return (area !== undefined ? AREA_PALETTES[area] : undefined) ?? DEFAULT_PALETTE;
}

/**
 * Materials for a piece from `params.area` (injected by the level builder) and the optional
 * `params.material` override, which replaces wallMain/wallAlt/floor (not the hazard or trim).
 */
export function resolvePalette(params: PieceParams, m: Materials): ResolvedPalette {
  const area = typeof params.area === 'string' ? params.area : undefined;
  const pal = paletteFor(area);
  const ov = params.material;
  let overrideKey: PaletteMaterialKey | undefined;
  if (ov !== undefined) {
    if (typeof ov !== 'string' || !isPaletteMaterialKey(ov)) {
      throw new Error(`piece param material "${String(ov)}" is not a palette material (one of ${PALETTE_MATERIAL_KEYS.join(', ')})`);
    }
    overrideKey = ov;
  }
  const main = overrideKey ?? pal.wallMain;
  const alt = overrideKey ?? pal.wallAlt ?? pal.wallMain;
  const floor = overrideKey ?? pal.floor;
  return {
    wallMain: m[main],
    wallAlt: m[alt],
    floor: m[floor],
    floorAlt: m[pal.floorAlt ?? 'steel'],
    hazard: m[pal.hazard],
    hazardTile: pal.hazard === 'hazard' ? 1 : 0.5,
    overridden: overrideKey !== undefined,
  };
}

/** Floor materials that make sense as a tiled floor; other palette floors fall back to `labTile` for `floor_tiles`. */
export const TILE_FLOOR_KEYS: readonly PaletteMaterialKey[] = ['labTile', 'tileBroken', 'tileWall', 'tileWashroom'];
