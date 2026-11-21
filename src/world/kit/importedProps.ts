import * as THREE from 'three';
import recordsJson from '../../data/imported-props.json' with { type: 'json' };
import { PieceBuilder, type PieceDef } from './types.ts';

/**
 * Stand-ins for imported props (openspec import-lab-props, spec imported-props, docs/imported-props.md).
 *
 * Every id in src/data/imported-props.json (written by `npm run props`) gets a procedural piece of the model's
 * recorded size: boxes in one shared stand-in material (all stand-ins in a room merge into one draw call, which
 * the room budget count subtracts again; see Level.addImportedCost) with the colliders,
 * so headless builds, collision, nav and the jump-tops test treat it like any kit prop. When the registry has
 * the model, it swaps in only the visible meshes (world/registry.ts). Pivot: base centre, facing -Z, metres.
 */

export interface ImportedPropRecord {
  url: string;
  size: [number, number, number];
  triangles: number;
  materials: number;
  transparentMaterials: number;
  texturePixels: number;
  bytes: number;
  parts: string[];
  source: { title: string; author: string; licence: string; url: string };
}

export const IMPORTED_PROPS: Readonly<Record<string, ImportedPropRecord>> = (recordsJson as unknown as { props: Record<string, ImportedPropRecord> }).props;

/** Stand-in sizes are the recorded model size rounded to 5 cm (never below 5 cm). */
export const standInSize = (size: readonly [number, number, number]): [number, number, number] =>
  size.map((v) => Math.max(0.05, Math.round(v / 0.05) * 0.05)) as [number, number, number];

/** A box in piece space: min and max corners. */
type Box = [[number, number, number], [number, number, number]];

/**
 * Collision shape per prop, from its stand-in size. Default: one box over the whole model. A prop whose
 * silhouette would make a misleading solid block (a low deck with a tall handle) gets its own shape here.
 */
const SHAPES: Record<string, (s: [number, number, number]) => Box[]> = {
  // A 0.3 m deck you can step onto, and the push handle (0.2 m deep) standing at its -X end.
  platform_trolley: ([w, h, d]) => [
    [[-w / 2, 0, -d / 2], [w / 2, 0.3, d / 2]],
    [[-w / 2, 0, -d / 2], [-w / 2 + 0.2, h, d / 2]],
  ],
  // Bloom masses (rebuild-lab-wing): solid, but 1.1 m tall so they are never a perch (Jay's jump reaches 1.0 m).
  bloom_growth_c: ([w, , d]) => [[[-w / 2, 0, -d / 2], [w / 2, 1.1, d / 2]]],
  bloom_growth_d: ([w, , d]) => [[[-w / 2, 0, -d / 2], [w / 2, 1.1, d / 2]]],
};

const fullBox = ([w, h, d]: [number, number, number]): Box[] => [[[-w / 2, 0, -d / 2], [w / 2, h, d / 2]]];

let paint: THREE.MeshStandardMaterial | null = null;
function standInPaint(): THREE.MeshStandardMaterial {
  if (!paint) {
    paint = new THREE.MeshStandardMaterial({ color: 0x5f666b, roughness: 0.7, metalness: 0.1 });
    paint.name = 'imported-stand-in';
  }
  return paint;
}

export function standInPieces(records: Readonly<Record<string, ImportedPropRecord>>): PieceDef[] {
  return Object.entries(records).map(([id, rec]) => ({
    id,
    family: 'prop' as const,
    footprint: [0, 0] as [number, number],
    importedProp: true,
    importedCost: { materials: rec.materials, triangles: rec.triangles, standInTriangles: 12 * (SHAPES[id] ?? fullBox)(standInSize(rec.size)).length },
    generate(params) {
      const b = new PieceBuilder();
      const size = standInSize(rec.size);
      // `solid: false`: visual only (e.g. cylinders inside a cage that already collides).
      const solid = params['solid'] !== false;
      for (const [min, max] of (SHAPES[id] ?? fullBox)(size)) {
        const h = Math.min(max[1], size[1]) - min[1];
        const geo = new THREE.BoxGeometry(max[0] - min[0], h, max[2] - min[2]);
        b.add(geo, standInPaint(), new THREE.Matrix4().makeTranslation((min[0] + max[0]) / 2, min[1] + h / 2, (min[2] + max[2]) / 2));
        if (solid) b.solid(min[0], min[1], min[2], max[0], max[1], max[2], 'metal');
      }
      return b.build();
    },
  }));
}

export const IMPORTED_PROP_PIECES: PieceDef[] = standInPieces(IMPORTED_PROPS);

/**
 * Problems with the imported-prop records (spec imported-props): a model file that is missing or no longer matches
 * its recorded byte size (re-imported without the record), or a prop with no `CREDITS.md` entry. Pure, so tests can
 * feed it broken data; `bytesOf` returns null for a missing file.
 */
export function recordProblems(
  records: Readonly<Record<string, ImportedPropRecord>>,
  bytesOf: (url: string) => number | null,
  credits: string,
): string[] {
  const out: string[] = [];
  for (const [id, rec] of Object.entries(records)) {
    const bytes = bytesOf(rec.url);
    if (bytes === null) out.push(`${id}: model file ${rec.url} is missing`);
    else if (bytes !== rec.bytes) out.push(`${id}: ${rec.url} is ${bytes} bytes but its record says ${rec.bytes}; re-run npm run props -- ${id}`);
    if (!credits.includes(`props/${id}.glb`)) out.push(`${id}: no CREDITS.md entry (expected a row naming public/assets/models/props/${id}.glb)`);
  }
  return out;
}
