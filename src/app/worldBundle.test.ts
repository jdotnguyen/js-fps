import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { validate } from '../core/validate.ts';
import { validateItemTable } from '../data/types/items.ts';
import { validateUiText } from '../data/types/uiText.ts';
import type { Materials } from '../render/materials.ts';

// Headless stubs (no WebGL): canvas 2D contexts that draw nothing, as the other level tests do.
const noop = (): void => undefined;
const g = globalThis as Record<string, unknown>;
g.Path2D ??= class {
  addPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  arc(): void {}
  rect(): void {}
  closePath(): void {}
};
g.document ??= {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () =>
      new Proxy(
        {},
        {
          get: (_t, k) =>
            k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern'
              ? () => ({ addColorStop: noop })
              : k === 'getImageData' || k === 'createImageData'
                ? () => ({ data: new Uint8ClampedArray(4 * 512 * 512) })
                : k === 'measureText'
                  ? () => ({ width: 10 })
                  : noop,
          set: () => true,
        },
      ),
  }),
};

const { prepareWorldBundle, buildStationWorld, disposeWorldBundle, stationLightBudget, createStationScene } = await import('./worldBundle.ts');
const { EventBus } = await import('../core/events.ts');
const { Inventory } = await import('../game/inventory.ts');

const json = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const itemTable = validate(validateItemTable, json('../data/items.json'), 'items');
const uiText = validate(validateUiText, json('../data/dialogue/ui.json'), 'ui');
const levelJson = (): Promise<unknown> => Promise.resolve(json('../data/levels/kit_test.json'));
const kitManifest = (): Promise<unknown> => Promise.resolve(json('../data/kit-manifest.json'));
const mat = new THREE.MeshStandardMaterial();
const stubMaterials = (): Materials => new Proxy({}, { get: () => mat, ownKeys: () => [] }) as never;
const caps = { maxTextures: 16, maxFragmentUniforms: 1024 };

test('a world is built at the title with its own bus, inventory and scene, and no renderer', async () => {
  const materials = stubMaterials();
  const bundle = await prepareWorldBundle({
    levelId: 'kit_test',
    quality: 'high',
    caps,
    materials: Promise.resolve(materials),
    loadLevelJson: levelJson,
    loadKitManifest: kitManifest,
    itemTable,
    uiText,
    buildNav: async () => undefined,
  });
  assert.equal(bundle.levelId, 'kit_test');
  assert.equal(bundle.materials, materials, 'built from the holder’s materials, not a copy');
  assert.ok(bundle.events instanceof EventBus);
  assert.ok(bundle.inventory instanceof Inventory);
  assert.ok(bundle.scene.fog instanceof THREE.FogExp2, 'the scene carries the station fog the level updates');
  assert.equal(bundle.scene.environment, null, 'the environment map comes later, from the renderer');
  assert.ok(bundle.level.group.children.length > 0);
  assert.equal(bundle.level.pool.size, stationLightBudget('high', caps, materials).fillLights, 'built with the light pools this GPU and quality allow');
  assert.ok(bundle.level.pool.size > 0);
  disposeWorldBundle(bundle);
  assert.equal(bundle.level.pool.size, 0, 'a dropped bundle releases its light pools');
  assert.equal(bundle.level.group.children.length, 0);
});

test('the session path and the title path build the same world', async () => {
  const lightBudget = stationLightBudget('high', caps, stubMaterials());
  const make = async (): Promise<{ n: number; pool: number; name: string }> => {
    const events = new EventBus();
    const w = await buildStationWorld({
      levelId: 'kit_test',
      loadLevelJson: levelJson,
      loadKitManifest: kitManifest,
      materials: stubMaterials(),
      events,
      scene: createStationScene(),
      inventory: new Inventory(itemTable, events),
      itemTable,
      uiText,
      lightBudget,
    });
    const out = { n: w.level.group.children.length, pool: w.level.pool.size, name: w.level.name };
    w.level.dispose();
    w.registry.dispose();
    return out;
  };
  const viaSession = await make();
  const bundle = await prepareWorldBundle({ levelId: 'kit_test', quality: 'high', caps, materials: Promise.resolve(stubMaterials()), loadLevelJson: levelJson, loadKitManifest: kitManifest, itemTable, uiText, buildNav: async () => undefined });
  assert.deepEqual({ n: bundle.level.group.children.length, pool: bundle.level.pool.size, name: bundle.level.name }, viaSession);
  disposeWorldBundle(bundle);
});

test('a failing navmesh build disposes the level it was building for', async () => {
  let built: { pool: { size: number } } | null = null;
  await assert.rejects(
    prepareWorldBundle({
      levelId: 'kit_test',
      quality: 'high',
      caps,
      materials: Promise.resolve(stubMaterials()),
      loadLevelJson: levelJson,
      loadKitManifest: kitManifest,
      itemTable,
      uiText,
      buildNav: async (level) => {
        built = level;
        throw new Error('recast failed');
      },
    }),
    /recast failed/,
  );
  assert.equal(built!.pool.size, 0, 'the half-made world was released');
});

test('an unknown level or a bad manifest rejects without leaking a registry', async () => {
  await assert.rejects(
    buildStationWorld({
      levelId: 'nope',
      loadLevelJson: () => Promise.reject(new Error('No level')),
      loadKitManifest: kitManifest,
      materials: stubMaterials(),
      events: new EventBus(),
      scene: createStationScene(),
      inventory: new Inventory(itemTable),
      itemTable,
      uiText,
      lightBudget: stationLightBudget('low', caps, stubMaterials()),
    }),
    /No level/,
  );
});

test('the light budget follows the GPU: fewer samplers or uniforms shrink the pools, never grow them', () => {
  const roomy = stationLightBudget('high', { maxTextures: 32, maxFragmentUniforms: 2048 }, stubMaterials());
  const tight = stationLightBudget('high', { maxTextures: 8, maxFragmentUniforms: 256 }, stubMaterials());
  assert.ok(tight.shadowLights <= roomy.shadowLights);
  assert.ok(tight.fillLights <= roomy.fillLights);
  assert.ok((tight.cookieSpots ?? 0) <= (roomy.cookieSpots ?? 0));
  const low = stationLightBudget('low', caps, stubMaterials());
  assert.ok(low.fillLights <= stationLightBudget('high', caps, stubMaterials()).fillLights);
});

test('the build waits on the supplied yield between chunks, so the title can hold it for the menu', async () => {
  let yields = 0;
  const bundle = await prepareWorldBundle({
    levelId: 'kit_test',
    quality: 'high',
    caps,
    materials: Promise.resolve(stubMaterials()),
    loadLevelJson: levelJson,
    loadKitManifest: kitManifest,
    itemTable,
    uiText,
    buildNav: async () => undefined,
    yieldTo: async () => void yields++,
  });
  assert.ok(yields >= 4, `one yield per room build and merge, saw ${yields}`);
  disposeWorldBundle(bundle);
});

test('a time-sliced build gives the same world as an unsliced one, and hands the thread back many times', async () => {
  const shape = (b: Awaited<ReturnType<typeof prepareWorldBundle>>): unknown => {
    const rooms: unknown[] = [];
    b.level.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const g = o.geometry as THREE.BufferGeometry;
        rooms.push([o.name, g.getAttribute('position').count, g.index?.count ?? 0, g.getAttribute('color')?.count ?? 0]);
      }
    });
    return { rooms, pool: b.level.pool.size };
  };
  const common = { levelId: 'kit_test', quality: 'high' as const, caps, loadLevelJson: levelJson, loadKitManifest: kitManifest, itemTable, uiText, buildNav: async () => undefined };
  const plain = await prepareWorldBundle({ ...common, materials: Promise.resolve(stubMaterials()) });
  let yields = 0;
  const sliced = await prepareWorldBundle({ ...common, materials: Promise.resolve(stubMaterials()), yieldTo: async () => void yields++, sliceMs: 0.0001 });
  assert.deepEqual(shape(sliced), shape(plain), 'the same meshes, vertex counts and baked colours');
  assert.ok(yields > 20, `many small steps, saw ${yields} hand-backs`);
  disposeWorldBundle(plain);
  disposeWorldBundle(sliced);
});
