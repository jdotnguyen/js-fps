import type * as THREE from 'three';
import type { Materials } from '../../render/materials.ts';
import { PHOTO_SLOT_KEYS } from '../../render/tex/manifest.ts';
import type { PieceParams, SurfaceMaterial } from './types.ts';

/**
 * Per-area material palettes (openspec: adopt-photoscanned-textures, "Per-area palette").
 * The level builder injects the room's `area` into every piece's params; structure pieces
 * call `resolvePalette(params, m)` to get their materials. A piece can override the main
 * surface with `params.material: "<slot>"` (any key in `PALETTE_MATERIAL_KEYS`).
 *
 * UV contract: photo slots need metre UVs (`tile` = 1 in kit geometry). The clean warning paint keeps its finer procedural tile.
 */

/** Materials a palette entry or `params.material` override may name (surface materials, not glass/black/cable/glow). */
export const PALETTE_MATERIAL_KEYS = [...PHOTO_SLOT_KEYS, 'steel', 'hazardClean'] as const satisfies ReadonlyArray<keyof Materials>;
export type PaletteMaterialKey = (typeof PALETTE_MATERIAL_KEYS)[number];

export function isPaletteMaterialKey(k: string): k is PaletteMaterialKey {
  return (PALETTE_MATERIAL_KEYS as readonly string[]).includes(k);
}

export interface AreaPalette {
  /** Wall backing and lower panels. */
  wallMain: PaletteMaterialKey;
  /** Upper panels and the occasional accent panel; defaults to `wallMain`. */
  wallAlt?: PaletteMaterialKey;
  /** Ceiling slab; defaults to `paintDark`. */
  ceiling?: PaletteMaterialKey;
  /** Structural trim (pilasters, rails, ceiling beams, window/door frames); defaults to `steel`. */
  trim?: PaletteMaterialKey;
  /** Floor plates. */
  floor: PaletteMaterialKey;
  /** Floor trim (grate rims, inlays); defaults to `steel`. */
  floorAlt?: PaletteMaterialKey;
  /** Hazard striping: photo `hazard` is rusty (dive bay, tunnel); everywhere else the clean procedural stripes. */
  hazard: 'hazard' | 'hazardClean';
  /** Wall filler surround flanking and above door frames; defaults to `paintDark`. */
  doorSurround?: PaletteMaterialKey;
  /** Door jamb/lintel inset accent and pressure-door leaf panels; defaults to `paintDark`. */
  doorPanel?: PaletteMaterialKey;
  /** Glass-door horizontal mid-bar; defaults to `paintBone`. */
  doorGlassBar?: PaletteMaterialKey;
  /** Accent ceiling/wall pipes (and valve wheels); defaults to `paintTeal`. */
  pipeAccent?: PaletteMaterialKey;
  /** Main dark ceiling/wall pipes; defaults to `paintDark`. */
  pipeMain?: PaletteMaterialKey;
}

export const AREA_PALETTES: Record<string, AreaPalette> = {
  dock: {
    wallMain: 'cleanSlate',
    wallAlt: 'boltPanel',
    ceiling: 'steelDark',
    trim: 'steelBrushed',
    floor: 'concretePainted',
    floorAlt: 'diamond',
    hazard: 'hazardClean',
    doorSurround: 'cleanSlate',
    doorPanel: 'steelDark',
    doorGlassBar: 'steelBrushed',
    pipeAccent: 'cleanTeal',
    pipeMain: 'steelDark',
  },
  // The cafeteria lounge (R02): clean vinyl lower walls, smooth matte bone upper band, drop acoustic ceiling, tiled floor.
  commons: {
    wallMain: 'vinylPanel',
    wallAlt: 'cleanWall',
    ceiling: 'officeCeiling',
    trim: 'steelBrushed',
    floor: 'labTile',
    hazard: 'hazardClean',
    doorSurround: 'vinylPanel',
    doorPanel: 'steelDark',
    doorGlassBar: 'cleanWall',
  },
  // The observation gallery (R03): a clean, dim lounge before the drop. Slate walls, teal upper band, the commons'
  // acoustic ceiling, brushed trim; `floorAlt` is the bare metal strip along the Lab B glass (floor_carpet `bare`).
  gallery: {
    wallMain: 'cleanSlate',
    wallAlt: 'cleanTeal',
    ceiling: 'officeCeiling',
    trim: 'steelBrushed',
    floor: 'rubber',
    floorAlt: 'steelBrushed',
    hazard: 'hazardClean',
    doorSurround: 'cleanSlate',
    doorPanel: 'steelDark',
    doorGlassBar: 'steelBrushed',
    pipeAccent: 'cleanTeal',
    pipeMain: 'steelDark',
  },
  // Lab wing (R04-R06, openspec rebuild-lab-wing): a clean, working lab wing that went bad an hour ago. Wear is
  // placed (decals, blood, the bloom), never baked into the base. Lab B's `floor_tiles` falls back to `labTile`, so
  // the outbreak swap to `tileBroken` still applies there.
  labs: {
    wallMain: 'cleanWall',
    wallAlt: 'cleanSlate',
    ceiling: 'steelDark',
    trim: 'steelBrushed',
    floor: 'rubber',
    floorAlt: 'steelBrushed',
    hazard: 'hazardClean',
    doorSurround: 'cleanWall',
    doorPanel: 'steelDark',
    doorGlassBar: 'steelBrushed',
    pipeAccent: 'cleanTeal',
    pipeMain: 'steelDark',
  },
  // Security office (R07, R07a; openspec overhaul-security-medbay-look): clean institutional slate with a light upper
  // band, acoustic office ceiling, brushed trim and dark steel door panels. R07a overrides its walls to `cleanWall`.
  security: {
    wallMain: 'cleanSlate',
    wallAlt: 'cleanWall',
    ceiling: 'officeCeiling',
    trim: 'steelBrushed',
    floor: 'rubber',
    floorAlt: 'steelBrushed',
    hazard: 'hazardClean',
    doorSurround: 'cleanSlate',
    doorPanel: 'steelDark',
    doorGlassBar: 'steelBrushed',
    pipeAccent: 'cleanTeal',
    pipeMain: 'steelDark',
  },
  // Medical bay and surgery (R08, R08b; openspec overhaul-security-medbay-look): clean clinical tiles with a teal upper
  // band (`wall_tiles` reads `wallAlt` above 2.4 m), acoustic office ceiling, brushed trim and clean lab tile floor.
  medbay: {
    wallMain: 'cleanWall',
    wallAlt: 'cleanTeal',
    ceiling: 'officeCeiling',
    trim: 'steelBrushed',
    floor: 'labTile',
    floorAlt: 'steelBrushed',
    hazard: 'hazardClean',
    doorSurround: 'cleanWall',
    doorPanel: 'steelDark',
    doorGlassBar: 'steelBrushed',
    pipeAccent: 'cleanTeal',
    pipeMain: 'steelDark',
  },
  tunnel: { wallMain: 'rustHeavy', wallAlt: 'concrete', floor: 'concreteFloor', floorAlt: 'diamondRusty', hazard: 'hazard' },
  control: { wallMain: 'paintDark', floor: 'concretePainted', hazard: 'hazardClean' },
  // Lower transit wing (R11 Power Bay, R13d Maintenance Corridor, R15a Departure Bay, R16a-c Arrival Terminal):
  // clean architectural concrete/slate with dark structural steel and brushed trim.
  transit: {
    wallMain: 'cleanSlate',
    wallAlt: 'concrete',
    ceiling: 'steelDark',
    trim: 'steelBrushed',
    floor: 'concretePainted',
    floorAlt: 'diamond',
    hazard: 'hazardClean',
    doorSurround: 'cleanSlate',
    doorPanel: 'steelDark',
    doorGlassBar: 'steelBrushed',
    pipeAccent: 'cleanTeal',
    pipeMain: 'steelDark',
  },
  // Hydroponics (R12a-R12e): clean washable white FRP-style panels, cool slate upper service band, stainless trim and dark structural ceiling.
  hydroponics: {
    wallMain: 'cleanWall',
    wallAlt: 'cleanSlate',
    ceiling: 'steelDark',
    trim: 'steelBrushed',
    floor: 'labTile',
    floorAlt: 'steelBrushed',
    hazard: 'hazardClean',
    doorSurround: 'cleanWall',
    doorPanel: 'steelDark',
    doorGlassBar: 'steelBrushed',
    pipeAccent: 'cleanTeal',
    pipeMain: 'steelDark',
  },
  // Dive bay (R13a-e, openspec rebuild-dive-bay): a working 1-atm launch-and-recovery facility in the station's clean
  // service finish (slate panels, a bolted upper band), with clean treadplate and grating. `servicePaint` is a
  // peeling-rust photo and `boltPanel` alone reads black without reflections, so neither is the main wall.
  // Rust lives only in R13d, by per-room material overrides.
  dive_bay: {
    wallMain: 'cleanSlate',
    wallAlt: 'boltPanel',
    ceiling: 'steelDark',
    trim: 'steelBrushed',
    floor: 'diamond',
    floorAlt: 'grating',
    hazard: 'hazardClean',
    doorSurround: 'cleanSlate',
    doorPanel: 'steelDark',
    doorGlassBar: 'steelBrushed',
    pipeAccent: 'cleanTeal',
    pipeMain: 'steelDark',
  },
  // Admin uses corporate drop ceiling, wood panelling (wall_wood / wall_window), clean wood door surrounds and navy carpet (floor_carpet).
  admin: {
    wallMain: 'woodPanel',
    wallAlt: 'cleanWall',
    ceiling: 'officeCeiling',
    trim: 'steelBrushed',
    floor: 'diamond',
    hazard: 'hazardClean',
    doorSurround: 'woodPanel',
    doorPanel: 'steelDark',
    doorGlassBar: 'steelBrushed',
  },
};

/** Used when a piece has no area (corridors, test rooms): the docking ring look. */
export const DEFAULT_PALETTE: AreaPalette = AREA_PALETTES.dock!;

export interface ResolvedPalette {
  wallMain: THREE.MeshStandardMaterial;
  wallAlt: THREE.MeshStandardMaterial;
  ceiling: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  floor: THREE.MeshStandardMaterial;
  floorAlt: THREE.MeshStandardMaterial;
  /** Acoustic footstep surface matching the visual `floor` material. */
  floorSurface: SurfaceMaterial;
  hazard: THREE.MeshStandardMaterial;
  doorSurround: THREE.MeshStandardMaterial;
  doorPanel: THREE.MeshStandardMaterial;
  doorGlassBar: THREE.MeshStandardMaterial;
  pipeAccent: THREE.MeshStandardMaterial;
  pipeMain: THREE.MeshStandardMaterial;
  /** True when `params.material` replaced the area's main surfaces. */
  overridden: boolean;
}

/** Derive the acoustic footstep surface from a floor's visual palette material key. */
export function floorSurfaceForKey(key: PaletteMaterialKey): SurfaceMaterial {
  if (key === 'concrete' || key === 'concreteFloor' || key === 'concretePainted') return 'concrete';
  if (key === 'rubber' || key === 'carpet') return 'rubber';
  if (key === 'grating') return 'grate';
  return 'metal';
}

/** Palette for an area name (unknown or missing areas get the default). */
export function paletteFor(area: string | undefined): AreaPalette {
  return (area !== undefined ? AREA_PALETTES[area] : undefined) ?? DEFAULT_PALETTE;
}

/**
 * Materials for a piece from `params.area` (injected by the level builder) and the optional
 * `params.material` override, which replaces wallMain/wallAlt/ceiling/floor (not the hazard or trim).
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
  const ceiling = overrideKey ?? pal.ceiling ?? 'paintDark';
  const trim = pal.trim ?? 'steel';
  const floor = overrideKey ?? pal.floor;
  return {
    wallMain: m[main],
    wallAlt: m[alt],
    ceiling: m[ceiling],
    trim: m[trim],
    floor: m[floor],
    floorAlt: m[pal.floorAlt ?? 'steel'],
    floorSurface: floorSurfaceForKey(floor),
    hazard: m[pal.hazard],
    doorSurround: m[pal.doorSurround ?? 'paintDark'],
    doorPanel: m[pal.doorPanel ?? 'paintDark'],
    doorGlassBar: m[pal.doorGlassBar ?? 'paintBone'],
    pipeAccent: m[pal.pipeAccent ?? 'paintTeal'],
    pipeMain: m[pal.pipeMain ?? 'paintDark'],
    overridden: overrideKey !== undefined,
  };
}

/** Floor materials that make sense as a tiled floor; other palette floors fall back to `labTile` for `floor_tiles`. */
export const TILE_FLOOR_KEYS: readonly PaletteMaterialKey[] = ['labTile', 'tileBroken', 'tileWall', 'tileWashroom'];
