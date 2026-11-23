/**
 * What the title prepares for the next session (openspec `preload-during-title`). This module sits in the entry
 * chunk, so it imports nothing heavy: every real loader below is a dynamic import (startup-bundle spec).
 *
 * Two kinds of item:
 *  - warmed: the loader is already memoized for the page (modules, the mocap library, physics, the navmesh
 *    engine, the seabed and submarine models). Starting it early is all the adoption it needs; the session's own
 *    later call returns the same result.
 *  - taken: the loader returns an instance the session then owns (weapon models, the body-model library, the
 *    mocap clip packs). The session `take`s it from the holder and builds it itself on a miss.
 */
import type { AudioEngine } from '../audio/engine.ts';
import type { PhysicsSwitches, Settings } from '../core/settings.ts';
import { validate } from '../core/validate.ts'; // already in the entry chunk
import type { ItemTable } from '../data/types/items.ts';
import type { UiText } from '../data/types/uiText.ts';
import type { PreloadGroup, TitlePreload } from './titlePreload.ts';

/** Item names the session `take`s. Warmed items are only listed so tests and logs can name them. */
export const ITEMS = {
  sessionCode: 'code:session',
  levelCode: 'code:level',
  navmeshEngine: 'engine:navmesh',
  physicsEngine: 'engine:physics',
  mocap: 'models:mocap',
  environment: 'models:environment',
  weapons: 'models:weapons',
  bodyModels: 'models:body',
  audioSounds: 'audio:sounds',
  audioSamples: 'audio:samples',
  materials: 'quality:materials',
  world: 'level:world',
} as const;
export type ItemName = (typeof ITEMS)[keyof typeof ITEMS];

/** One loader per item; each resolves to what the session would have loaded itself. */
export type SharedLoaders = Record<ItemName, () => Promise<unknown>>;

/** What invalidates each item (see TitlePreload). Anything not listed is shared. */
export const ITEM_GROUP: Readonly<Record<ItemName, PreloadGroup>> = {
  [ITEMS.sessionCode]: 'shared',
  [ITEMS.levelCode]: 'shared',
  [ITEMS.navmeshEngine]: 'shared',
  [ITEMS.physicsEngine]: 'shared',
  [ITEMS.mocap]: 'shared',
  [ITEMS.environment]: 'shared',
  [ITEMS.weapons]: 'shared',
  [ITEMS.bodyModels]: 'shared',
  [ITEMS.audioSounds]: 'shared',
  [ITEMS.audioSamples]: 'shared',
  [ITEMS.materials]: 'quality',
  [ITEMS.world]: 'level',
};

/** Items whose finished result a session adopts through `take`; the rest are warmed. */
export const TAKEN_ITEMS: readonly ItemName[] = [ITEMS.mocap, ITEMS.weapons, ITEMS.bodyModels, ITEMS.audioSounds, ITEMS.audioSamples, ITEMS.materials, ITEMS.world];

/** Start every item of `group`. Items already started or held are skipped, so this can be called again safely. */
export function armGroup(preload: TitlePreload, group: PreloadGroup, loaders: SharedLoaders, release: Partial<Record<ItemName, (value: never) => void>> = {}): void {
  for (const item of Object.values(ITEMS)) if (ITEM_GROUP[item] === group) preload.start(item, group, loaders[item], release[item] as ((value: unknown) => void) | undefined);
}

/** The items that do not depend on level or quality. */
export function armShared(preload: TitlePreload, loaders: SharedLoaders, release?: Partial<Record<ItemName, (value: never) => void>>): void {
  armGroup(preload, 'shared', loaders, release);
}

/** The level-dependent items (the built world). Only valid for the holder's level, quality and GPU limits. */
export function armLevel(preload: TitlePreload, loaders: SharedLoaders, release?: Partial<Record<ItemName, (value: never) => void>>): void {
  armGroup(preload, 'level', loaders, release);
}

/** The items made for the holder's current graphics quality; call again after `setQuality`. */
export function armQuality(preload: TitlePreload, loaders: SharedLoaders, release?: Partial<Record<ItemName, (value: never) => void>>): void {
  armGroup(preload, 'quality', loaders, release);
}

/**
 * The real loaders. Each import is dynamic and loads in the browser only; none touches WebGL.
 * `physics` is the resolved switches, so a game with physics off never fetches the engine (physics-world spec).
 */
/** What building the station world at the title needs (design D9/D10). */
export interface WorldPrep {
  levelId: string;
  quality: Settings['quality'];
  caps: { maxTextures: number; maxFragmentUniforms: number };
  itemTable: ItemTable;
  uiText: UiText;
  /** The in-flight materials item, so the world builds from the same materials the holder owns. */
  materials: () => Promise<unknown> | null;
  /** Awaited between build chunks so the build waits for the menu to be idle. */
  yieldTo?: () => Promise<void>;
  /** Work at most this long between yields while building. */
  sliceMs?: number;
}

export function realSharedLoaders(options: { baseUrl: string; physicsSetting: () => PhysicsSwitches; search: string; audio: AudioEngine; quality: () => string; world: () => WorldPrep | null; yieldTo?: () => Promise<void> }): SharedLoaders {
  const { baseUrl, physicsSetting, search, audio, quality, world, yieldTo } = options;
  return {
    [ITEMS.sessionCode]: () => import('./session.ts'),
    [ITEMS.levelCode]: () =>
      Promise.all([import('../world/level.ts'), import('../world/registry.ts'), import('../render/roomCaptures.ts'), import('../render/gltf.ts'), import('../data/kit-manifest.json')]),
    [ITEMS.navmeshEngine]: async () => (await import('../ai/navmeshBuild.ts')).initNavmesh(),
    [ITEMS.physicsEngine]: async () => {
      const [{ loadPhysics }, { anyPhysics, resolvePhysicsSwitches }] = await Promise.all([import('../physics/load.ts'), import('../physics/switches.ts')]);
      const { switches } = resolvePhysicsSwitches(physicsSetting(), search); // the same resolution the session makes
      return anyPhysics(switches) ? loadPhysics(switches) : null;
    },
    [ITEMS.mocap]: async () => {
      const [{ loadSharedMocapLibrary }, { loadMocapPacks }, { sharedMotionProfiles }] = await Promise.all([
        import('../actors/mocap.ts'),
        import('../actors/mocapPacks.ts'),
        import('../actors/motionProfiles.ts'),
      ]);
      const lib = await loadSharedMocapLibrary();
      await loadMocapPacks(lib, Object.keys(sharedMotionProfiles().profiles));
      return lib;
    },
    [ITEMS.environment]: async () => {
      const [{ preloadSeabed }, { preloadSubModel }] = await Promise.all([import('../render/fx/seabed.ts'), import('../render/fx/subModel.ts')]);
      await Promise.all([preloadSeabed(baseUrl), preloadSubModel(baseUrl)]);
    },
    // The engine is the shell's and already skips sounds it holds, so a session that finds these done costs nothing.
    // One sound per slice, so a slice stays well under a frame at the title (the session load uses batches of four).
    [ITEMS.audioSounds]: () => audio.renderSoundsAsync(undefined, { batchSize: 1 }),
    [ITEMS.audioSamples]: () => audio.loadGameplaySamples(),
    [ITEMS.materials]: async () => {
      const [{ createMaterialsAsync, textureSizeFor }, { currentAnisotropy }] = await Promise.all([import('../render/materials.ts'), import('../render/anisotropy.ts')]);
      return createMaterialsAsync(textureSizeFor(quality()), currentAnisotropy(), baseUrl);
    },
    [ITEMS.world]: async () => {
      const prep = world();
      if (!prep) throw new Error('title-preload: no GPU limits, so no world is prepared');
      const [{ prepareWorldBundle }, { levelFileLoader }] = await Promise.all([import('./worldBundle.ts'), import('./levelFiles.ts')]);
      const materials = prep.materials();
      if (!materials) throw new Error('title-preload: the materials are not being prepared');
      return prepareWorldBundle({
        levelId: prep.levelId,
        quality: prep.quality,
        caps: prep.caps,
        materials: materials as Parameters<typeof prepareWorldBundle>[0]['materials'],
        loadLevelJson: levelFileLoader(prep.levelId),
        itemTable: prep.itemTable,
        uiText: prep.uiText,
        ...(prep.yieldTo ? { yieldTo: prep.yieldTo } : {}),
        ...(prep.sliceMs ? { sliceMs: prep.sliceMs } : {}),
      });
    },
    [ITEMS.weapons]: async () => (await import('../render/viewmodel/glbWeapons.ts')).loadWeaponModels(),
    [ITEMS.bodyModels]: async () => {
      const [{ BodyModelLibrary, validateBodyModelTable }, { default: table }] = await Promise.all([import('../actors/bodyModelLibrary.ts'), import('../data/body-models.json')]);
      const lib = new BodyModelLibrary(validate(validateBodyModelTable, table, 'data/body-models.json'));
      await lib.load(baseUrl, yieldTo);
      return lib;
    },
  };
}

/** What to do with a prepared result nobody adopted. */
export const releaseUnadopted: Partial<Record<ItemName, (value: never) => void>> = {
  [ITEMS.bodyModels]: (lib: { dispose(): void }) => lib.dispose(),
  [ITEMS.materials]: (materials: unknown) => void releaseMaterials(materials),
  [ITEMS.world]: (bundle: unknown) => void releaseWorld(bundle),
};

/** A world nobody adopted: its level and registry are released (the materials are the holder's own item). */
export async function releaseWorld(bundle: unknown): Promise<void> {
  try {
    const { disposeWorldBundle } = await import('./worldBundle.ts');
    disposeWorldBundle(bundle as Parameters<typeof disposeWorldBundle>[0]);
  } catch (error) {
    console.warn('[title-preload] releasing the prepared world failed', error);
  }
}

/** Released with the loader so `disposeMaterials` stays out of the entry chunk. */
export async function releaseMaterials(materials: unknown): Promise<void> {
  try {
    const { disposeMaterials } = await import('../render/materials.ts');
    disposeMaterials(materials as Parameters<typeof disposeMaterials>[0]);
  } catch (error) {
    console.warn('[title-preload] releasing the prepared materials failed', error);
  }
}
