import type { TextureKey } from './generators.ts';

/**
 * Photoscanned texture slots (openspec: adopt-photoscanned-textures).
 *
 * Files live at `public/assets/textures/<dir>/{color,normal,orm}.webp`
 * (ORM: R = AO, G = roughness, B = metalness).
 *
 * UV / repeat contract: kit geometry UVs are in metres when a kit piece's `tile`
 * argument is 1. The loader therefore sets `texture.repeat = 1 / metersPerTile` on
 * all three maps, so one texture image covers `metersPerTile` metres. Kit pieces
 * using photo slots must pass `tile = 1` (or `1 / metersPerTile` is applied twice).
 * Non-tiling slots (`tiling: false`) use repeat 1 and ClampToEdge; they expect
 * full 0..1 UVs on a single quad.
 */
export interface PhotoSlot {
  /** Folder under `assets/textures/`. */
  dir: string;
  /** Physical size in metres that one image repeat covers. */
  metersPerTile: number;
  /** Albedo multiplier (hex RGB), applied as `material.color`. */
  tint: number;
  /** Multiplies the ORM roughness channel (`material.roughness`). */
  roughnessScale: number;
  /** Optional normal-map strength (`material.normalScale`, both axes). */
  normalScale?: number;
  /** Procedural generator used when the image files fail to load. */
  fallback: TextureKey;
  /** False for decals: repeat 1, ClampToEdge. */
  tiling: boolean;
}

const slot = (
  metersPerTile: number,
  tint: number,
  fallback: TextureKey,
  o: { roughnessScale?: number; normalScale?: number; tiling?: boolean; dir?: string } = {},
): PhotoSlot => ({
  dir: o.dir ?? '',
  metersPerTile,
  tint,
  roughnessScale: o.roughnessScale ?? 1,
  ...(o.normalScale !== undefined ? { normalScale: o.normalScale } : {}),
  fallback,
  tiling: o.tiling ?? true,
});

const RAW = {
  paintBone: slot(2, 0xa8a8a0, 'paintBone'),
  paintDark: slot(2, 0x595959, 'paintDark'),
  paintTeal: slot(2, 0x8fb5b0, 'paintTeal'),
  labPanel: slot(2, 0xcccccc, 'labPanel', { roughnessScale: 0.85 }),
  diamond: slot(1, 0xa6a6a6, 'diamond'),
  diamondHazard: slot(1, 0xa6a6a6, 'diamond'),
  diamondRusty: slot(1, 0xa6a6a6, 'diamond'),
  hazard: slot(2, 0xb0b0b0, 'hazard'),
  rubber: slot(1.5, 0xb0b0b0, 'rubber'),
  rustHeavy: slot(2, 0x8c8c8c, 'paintDark'),
  rustDrip: slot(2, 0x9a9a9a, 'paintDark'),
  rustBlotch: slot(2, 0x9a9a9a, 'paintBone'),
  concrete: slot(3, 0xa6a6a6, 'concrete'),
  concreteFloor: slot(3, 0xa6a6a6, 'concrete'),
  concretePainted: slot(3, 0x8c8c8c, 'concrete'),
  labTile: slot(1.5, 0xa6a6a6, 'labTile'),
  tileBroken: slot(1.5, 0xa6a6a6, 'labTile'),
  tileWall: slot(1.2, 0xa6a6a6, 'labTile'),
  tileWashroom: slot(1.5, 0xa6a6a6, 'labTile'),
  signDanger: slot(1, 0xb0b0b0, 'paintBone', { tiling: false }),
  hullPlate: slot(2, 0x7c848a, 'paintDark'),
  boltPanel: slot(2.4, 0x8e949a, 'steel', { normalScale: 1.2 }),
  servicePaint: slot(2, 0x999ea0, 'paintDark'),
  grating: slot(1, 0xb0b5b8, 'grating'),
  steelBrushed: slot(1.5, 0x9aa2a8, 'steel', { roughnessScale: 0.9 }),
  deckCorrugated: slot(2, 0x585e64, 'paintDark', { normalScale: 1.3 }),
  acousticCeiling: slot(0.65, 0xa8aca8, 'paintBone'),
  vinylPanel: slot(1.5, 0xa29d90, 'paintBone', { roughnessScale: 0.95, normalScale: 0.6 }),
  officeCeiling: slot(4, 0xa8a69e, 'paintBone'),
  woodPanel: slot(2, 0xc8b298, 'paintBone', { roughnessScale: 0.9 }),
  carpet: slot(1.5, 0x8e98a6, 'rubber'),
  // Clean architectural variants derived from existing rust-free PBR maps.
  steelDark: slot(1.5, 0x465058, 'steel', { dir: 'steelBrushed', roughnessScale: 1.15 }),
  cleanWall: slot(2, 0xb8b6ac, 'paintBone', { dir: 'vinylPanel', roughnessScale: 0.95, normalScale: 0.35 }),
  cleanSlate: slot(2, 0x62707a, 'paintDark', { dir: 'vinylPanel', roughnessScale: 0.85, normalScale: 0.35 }),
  cleanTeal: slot(2, 0x3b787c, 'paintTeal', { dir: 'vinylPanel', roughnessScale: 0.85, normalScale: 0.35 }),
} satisfies Record<string, PhotoSlot>;

export type PhotoSlotKey = keyof typeof RAW;

/** Slot table with `dir` defaulting to the slot name. */
export const PHOTO_SLOTS: Record<PhotoSlotKey, PhotoSlot> = Object.fromEntries(
  Object.entries(RAW).map(([k, v]) => [k, { ...v, dir: v.dir || k }]),
) as Record<PhotoSlotKey, PhotoSlot>;

export const PHOTO_SLOT_KEYS = Object.keys(PHOTO_SLOTS) as PhotoSlotKey[];
