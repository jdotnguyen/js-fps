/**
 * Building the station world, shared by the play session and the title preload (openspec `preload-during-title`,
 * design D9). The level builds into Three.js objects and needs no GL context, so the title can build it before any
 * session exists. Everything here is loaded dynamically from the session or the title; none of it is in the entry
 * chunk.
 */
import * as THREE from 'three';
import { EventBus } from '../core/events.ts';
import { validate } from '../core/validate.ts';
import { levelValidator, type LevelData } from '../data/types/level.ts';
import type { ItemTable } from '../data/types/items.ts';
import type { UiText } from '../data/types/uiText.ts';
import { Inventory } from '../game/inventory.ts';
import type { Materials } from '../render/materials.ts';
import { RENDER_TIERS, clampTier, materialTextureUnits } from '../render/tiers.ts';
import type { Settings } from '../core/settings.ts';
import type { Level } from '../world/level.ts';
import type { KitRegistry } from '../world/registry.ts';
import type { LightBudget } from '../world/world.ts';

/** Fog and background colour of the station scene (also the sea beyond the hull). */
export const FOG_COLOR = 0x04080a;

/** The scene a station world lives in. The session adds the environment map on top once it has a renderer. */
export function createStationScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(FOG_COLOR);
  scene.fog = new THREE.FogExp2(FOG_COLOR, 0.05);
  return scene;
}

export interface GpuCaps {
  readonly maxTextures: number;
  readonly maxFragmentUniforms: number;
}

/**
 * The light pools the station level is built with: the quality tier fitted to this GPU and to the heaviest material
 * (an environment map is always present once the session runs, so each standard material counts its sampler).
 */
export function stationLightBudget(quality: Settings['quality'], caps: GpuCaps, materials: Materials): LightBudget {
  let materialUnits = 0;
  for (const m of Object.values(materials)) if (m instanceof THREE.Material) materialUnits = Math.max(materialUnits, materialTextureUnits(m, true));
  const { tier } = clampTier(RENDER_TIERS[quality], { maxTextures: caps.maxTextures, maxFragmentUniforms: caps.maxFragmentUniforms, materialUnits });
  return { fillLights: tier.fillLights, shadowLights: tier.shadowLights, shadowMapSize: tier.shadowMapSize, cookieSpots: tier.cookieSpots };
}

export interface StationWorldOptions {
  levelId: string;
  /** Loads the level's JSON (the session and the title both use the Vite glob in `levelFiles.ts`). */
  loadLevelJson: () => Promise<unknown>;
  /** The kit manifest. Defaults to the bundled JSON; Node tests pass it in because a bare JSON import needs an attribute there. */
  loadKitManifest?: () => Promise<unknown>;
  materials: Materials;
  events: EventBus;
  scene: THREE.Scene;
  inventory: Inventory;
  itemTable: ItemTable;
  uiText: UiText;
  debugChecker?: boolean;
  lightBudget: LightBudget;
  onProgress?: (fraction: number, label: string) => void;
  /** Awaited between build chunks (the title passes one that waits for the menu to be idle). */
  yieldTo?: () => Promise<void>;
  /** Work at most this long between yields while merging rooms. */
  sliceMs?: number;
}

export interface StationWorld {
  registry: KitRegistry;
  level: Level;
  data: LevelData;
}

/** Load the level's data, validate it, and build the world. The one path every station load takes. */
export async function buildStationWorld(o: StationWorldOptions): Promise<StationWorld> {
  const [levelJson, { loadLevel }, { KitRegistry: KitReg, validateKitManifest }, kitManifestJson] = await Promise.all([
    o.loadLevelJson(),
    import('../world/level.ts'),
    import('../world/registry.ts'),
    (o.loadKitManifest ?? (() => import('../data/kit-manifest.json').then((m) => m.default)))(),
  ]);
  const registry = new KitReg(validate(validateKitManifest, kitManifestJson, 'data/kit-manifest.json'), undefined);
  try {
    const refs = { items: new Set(Object.keys(o.itemTable)), uiText: new Set(Object.keys(o.uiText)) };
    const data = validate(levelValidator(registry.ids(), refs), levelJson, `data/levels/${o.levelId}.json`);
    const level = await loadLevel(
      data,
      {
        materials: o.materials,
        registry,
        events: o.events,
        scene: o.scene,
        inventory: o.inventory,
        uiText: o.uiText,
        ...(o.debugChecker === undefined ? {} : { debugChecker: o.debugChecker }),
        lightBudget: o.lightBudget,
      },
      o.onProgress || o.yieldTo || o.sliceMs
        ? { ...(o.onProgress ? { onProgress: o.onProgress } : {}), ...(o.yieldTo ? { yieldTo: o.yieldTo } : {}), ...(o.sliceMs ? { sliceMs: o.sliceMs } : {}) }
        : undefined,
    );
    return { registry, level, data };
  } catch (err) {
    registry.dispose();
    throw err;
  }
}

/** A built world with everything the session would otherwise create before it, adopted whole (design D9). */
export interface WorldBundle extends StationWorld {
  readonly levelId: string;
  readonly events: EventBus;
  readonly inventory: Inventory;
  readonly scene: THREE.Scene;
  readonly materials: Materials;
  /** The light pools it was built with, so the session can resize them if the renderer reports other limits. */
  readonly lightBudget: LightBudget;
}

export interface PrepareWorldOptions {
  levelId: string;
  quality: Settings['quality'];
  caps: GpuCaps;
  /** The materials the world is built from: the title's own quality item, so the bundle and the holder share them. */
  materials: Promise<Materials>;
  loadLevelJson: () => Promise<unknown>;
  loadKitManifest?: () => Promise<unknown>;
  itemTable: ItemTable;
  uiText: UiText;
  /** Awaited between build chunks, so the build can wait for the menu to go idle. */
  yieldTo?: () => Promise<void>;
  /** Work at most this long between yields while merging rooms. */
  sliceMs?: number;
  /** Builds the navmesh once the level exists (so the session finds it ready). Defaults to the level's own async build. */
  buildNav?: (level: Level) => Promise<unknown>;
}

/** Build a station world at the title: its own bus, inventory and scene, the title's materials, and the navmesh. */
export async function prepareWorldBundle(o: PrepareWorldOptions): Promise<WorldBundle> {
  const materials = await o.materials;
  const events = new EventBus();
  const inventory = new Inventory(o.itemTable, events);
  const scene = createStationScene();
  const lightBudget = stationLightBudget(o.quality, o.caps, materials);
  const world = await buildStationWorld({
    levelId: o.levelId,
    loadLevelJson: o.loadLevelJson,
    ...(o.loadKitManifest ? { loadKitManifest: o.loadKitManifest } : {}),
    materials,
    events,
    scene,
    inventory,
    itemTable: o.itemTable,
    uiText: o.uiText,
    lightBudget,
    ...(o.yieldTo ? { yieldTo: o.yieldTo } : {}),
    ...(o.sliceMs ? { sliceMs: o.sliceMs } : {}),
  });
  try {
    await (o.buildNav ?? ((level: Level) => level.buildNavAsync()))(world.level);
  } catch (err) {
    disposeWorldBundle({ ...world, levelId: o.levelId, events, inventory, scene, materials, lightBudget }, false);
    throw err;
  }
  return { ...world, levelId: o.levelId, events, inventory, scene, materials, lightBudget };
}

/**
 * Release a bundle nobody adopted: the level (geometry, pools, bus listeners) and the kit registry.
 * The materials belong to the holder's quality item, which releases them itself, so they stay out unless asked.
 */
export function disposeWorldBundle(bundle: WorldBundle, withMaterials = false): void {
  bundle.level.dispose();
  bundle.registry.dispose();
  if (withMaterials) void import('../render/materials.ts').then((m) => m.disposeMaterials(bundle.materials));
}
