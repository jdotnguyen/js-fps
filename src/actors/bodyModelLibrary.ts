import { arr, bool, numRange, obj, oneOf, optional, record, str, type Infer, type Validator } from '../core/validate.ts';
import type { Rng } from '../core/rng.ts';
import { disposeTexture } from '../render/materials.ts';
import { prepareBodyModel, type PrepareOptions, type PreparedBodyModel } from './bodyModel.ts';
import bladeCreatureJson from '../data/creatures/blade/creature.json' with { type: 'json' };
import { loadBladeCreature, type BladeCreatureProfile } from '../data/types/bladeCreature.ts';

/**
 * Imported body models (ADR-0026, `data/bodyModelFiles.ts`): loaded once at boot, then shared by every body
 * that uses them. A model that fails to load is logged and skipped; those bodies stay procedural.
 */

const modelShape = {
  /** Path under public/. */
  url: str,
  /** Enemy variants (data/enemies.json ids) that may use this body. */
  variants: arr(str),
  /** Chance (0..1) that a spawn of one of those variants uses it instead of a procedural body. */
  share: numRange(0, 1),
  /** The body's gender: picks the masculine or feminine crew motion profile (character-motion spec). */
  gender: oneOf(['m', 'f'] as const),
  /** How much the infection shader tints the model's opaque surfaces (default 0.3). */
  sickTint: optional(numRange(0, 1)),
  /** Preserve individual finger and forearm-twist bones for biomechanical hand physics (main cast). */
  handRig: optional(bool),
  /** A creature profile the body is prepared and driven with (`blade`: data/creatures/blade/creature.json, openspec rig-necromorph). */
  rig: optional(oneOf(['blade'] as const)),
  /** Attribution for CREDITS.md and the credits screen (CC-BY and friends require it). */
  credit: obj({ title: str, author: str, source: str, license: str }),
};

export type BodyModelDef = Infer<typeof modelShape>;
export type BodyModelTable = Record<string, BodyModelDef>;
export const validateBodyModelTable: Validator<BodyModelTable> = record(obj(modelShape));

let blade: BladeCreatureProfile | null = null;
/** The blade creature's profile (data/creatures/blade/creature.json), validated once. */
export function bladeCreatureProfile(): BladeCreatureProfile {
  blade ??= loadBladeCreature(bladeCreatureJson);
  return blade;
}

/** How a model is prepared: its tint, its hand rig, and its creature profile's extra bones. */
export function prepareOptionsFor(def: BodyModelDef): PrepareOptions {
  const out: PrepareOptions = {};
  if (def.sickTint !== undefined) out.sickTint = def.sickTint;
  if (def.handRig) out.detailHands = true;
  if (def.rig === 'blade') {
    const p = bladeCreatureProfile();
    out.creature = { segments: p.segments, limbs: p.limbs, hits: p.hits };
  }
  return out;
}

export class BodyModelLibrary {
  readonly table: Readonly<BodyModelTable>;
  /** Debug (`?bodyModels=all|off`): overrides every model's share. */
  forceShare: number | null = null;
  private readonly loaded = new Map<string, PreparedBodyModel>();

  constructor(table: Readonly<BodyModelTable>) {
    this.table = table;
  }

  /**
   * Load and prepare every model. Never throws: failures are warned about and the model is left out.
   * With `yieldTo`, preparing runs one model at a time with a hand-back before each, so a page that is animating
   * (the title behind the splash) is not stalled by several finishing together.
   */
  async load(baseUrl: string, yieldTo?: () => Promise<void>): Promise<void> {
    const { createGltfLoader } = await import('../render/gltf.ts');
    const loader = await createGltfLoader();
    let turn: Promise<void> = Promise.resolve();
    await Promise.all(
      Object.entries(this.table).map(async ([id, def]) => {
        try {
          const t0 = performance.now();
          const gltf = await loader.loadAsync(baseUrl + def.url);
          let model: PreparedBodyModel;
          if (yieldTo) {
            const mine = turn;
            let done!: () => void;
            turn = new Promise<void>((resolve) => (done = resolve));
            await mine;
            await yieldTo();
            try {
              model = prepareBodyModel(gltf.scene, prepareOptionsFor(def));
            } finally {
              done();
            }
          } else {
            model = prepareBodyModel(gltf.scene, prepareOptionsFor(def));
          }
          this.loaded.set(id, model);
          console.info(`[body-models] ${id}: ${model.triangles} triangles, ${model.parts.length} pieces in ${(performance.now() - t0).toFixed(0)} ms`);
        } catch (err) {
          console.warn(`[body-models] ${id} (${def.url}) not loaded, using procedural bodies:`, err);
        }
      }),
    );
  }

  get(id: string): PreparedBodyModel | undefined {
    return this.loaded.get(id);
  }

  /** A loaded model for a spawn of `variant`, chosen by each model's share, or null for a procedural body. */
  pick(variant: string, rng: Rng): string | null {
    for (const [id, def] of Object.entries(this.table)) {
      if (!this.loaded.has(id) || !def.variants.includes(variant)) continue;
      if (rng.chance(this.forceShare ?? def.share)) return id;
    }
    return null;
  }

  /** Dispose all prepared body model geometries and shared surface textures (session teardown). */
  dispose(): void {
    const textures = new Set<import('three').Texture>();
    for (const model of this.loaded.values()) {
      for (const part of model.parts) part.geometry.dispose();
      for (const s of Object.values(model.surfaces)) {
        if (s.map) textures.add(s.map);
        if (s.normalMap) textures.add(s.normalMap);
      }
    }
    for (const t of textures) disposeTexture(t);
    this.loaded.clear();
  }
}
