import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS, ITEM_GROUP, armLevel, armQuality, armShared, releaseUnadopted, type ItemName, type SharedLoaders } from './titlePrepare.ts';
import { TitlePreload, type PreloadKey } from './titlePreload.ts';

const KEY: PreloadKey = { levelId: 'slice01', quality: 'high', gpu: 'g' };

function fakeLoaders(): { loaders: SharedLoaders; calls: Map<ItemName, number> } {
  const calls = new Map<ItemName, number>();
  const loaders = {} as SharedLoaders;
  for (const item of Object.values(ITEMS)) {
    loaders[item] = async () => {
      calls.set(item, (calls.get(item) ?? 0) + 1);
      return `prepared:${item}`;
    };
  }
  return { loaders, calls };
}

test('armShared starts every shared item exactly once, however often it is called', () => {
  const p = new TitlePreload(KEY, { warn: () => undefined });
  const { loaders, calls } = fakeLoaders();
  armShared(p, loaders);
  armShared(p, loaders);
  assert.equal(calls.size, Object.values(ITEMS).filter((i) => ITEM_GROUP[i] === 'shared').length);
  assert.equal(calls.has(ITEMS.materials), false, 'quality items wait for armQuality');
  for (const n of calls.values()) assert.equal(n, 1);
});

test('a session gets the prepared result and its own loader never runs', async () => {
  const p = new TitlePreload(KEY, { warn: () => undefined });
  const { loaders } = fakeLoaders();
  armShared(p, loaders);
  let ownLoads = 0;
  const got = await p.take(ITEMS.weapons, KEY, async () => {
    ownLoads++;
    return 'own';
  });
  assert.equal(got, 'prepared:models:weapons');
  assert.equal(ownLoads, 0);
});

test('an unprepared load still runs its own loader', async () => {
  const p = new TitlePreload(KEY, { warn: () => undefined });
  assert.equal(await p.take(ITEMS.mocap, KEY, async () => 'own'), 'own');
});

test('one failing item does not stop the others and falls back to the session loader', async () => {
  const p = new TitlePreload(KEY, { warn: () => undefined });
  const { loaders } = fakeLoaders();
  loaders[ITEMS.bodyModels] = async () => {
    throw new Error('glb 404');
  };
  armShared(p, loaders);
  assert.equal(await p.take(ITEMS.bodyModels, KEY, async () => 'own'), 'own');
  assert.equal(await p.take(ITEMS.weapons, KEY, async () => 'own'), 'prepared:models:weapons');
});

test('shared items are valid for any level and quality', async () => {
  const p = new TitlePreload(KEY, { warn: () => undefined });
  armShared(p, fakeLoaders().loaders);
  const other: PreloadKey = { levelId: 'lab', quality: 'low', gpu: 'other' };
  assert.equal(await p.take(ITEMS.mocap, other, async () => 'own'), 'prepared:models:mocap');
});

test('an unadopted body-model library is disposed when the holder is', async () => {
  let disposed = 0;
  const p = new TitlePreload(KEY, { warn: () => undefined });
  const { loaders } = fakeLoaders();
  loaders[ITEMS.bodyModels] = async () => ({ dispose: () => void disposed++ });
  armShared(p, loaders, releaseUnadopted);
  p.dispose();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(disposed, 1);
});

test('materials are a quality item: made for the current quality, dropped on a change, made again for the new one', async () => {
  const released: unknown[] = [];
  const p = new TitlePreload(KEY, { warn: () => undefined });
  let quality = 'high';
  const sizes: string[] = [];
  const { loaders } = fakeLoaders();
  loaders[ITEMS.materials] = async () => {
    sizes.push(quality);
    return { made: quality };
  };
  const release = { [ITEMS.materials]: (m: unknown) => void released.push(m) };

  armQuality(p, loaders, release);
  assert.deepEqual(sizes, ['high']);

  quality = 'low';
  p.setQuality('low');
  armQuality(p, loaders, release);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(sizes, ['high', 'low']);
  assert.deepEqual(released, [{ made: 'high' }], 'the stale set is released');

  const lowKey: PreloadKey = { ...KEY, quality: 'low' };
  assert.deepEqual(await p.take(ITEMS.materials, lowKey, async () => 'own'), { made: 'low' });
});

test('a session on another quality than the title prepared builds its own materials', async () => {
  const p = new TitlePreload(KEY, { warn: () => undefined });
  armQuality(p, fakeLoaders().loaders);
  assert.equal(await p.take(ITEMS.materials, { ...KEY, quality: 'medium' }, async () => 'own'), 'own');
});

test('the built world is a level item: another level or GPU keeps the shared items and builds its own world', async () => {
  const p = new TitlePreload(KEY, { warn: () => undefined });
  const { loaders } = fakeLoaders();
  armShared(p, loaders);
  armQuality(p, loaders);
  armLevel(p, loaders);
  const otherLevel: PreloadKey = { ...KEY, levelId: 'lab' };
  assert.equal(await p.take(ITEMS.world, otherLevel, async () => 'own'), 'own');
  assert.equal(await p.take(ITEMS.world, { ...KEY, gpu: '8/512/8' }, async () => 'own'), 'own');
  assert.equal(await p.take(ITEMS.mocap, otherLevel, async () => 'own'), 'prepared:models:mocap', 'shared items still come from the title');
  assert.equal(await p.take(ITEMS.materials, otherLevel, async () => 'own'), 'prepared:quality:materials', 'same quality, so the textures are still good');
  assert.equal(await p.take(ITEMS.world, KEY, async () => 'own'), 'prepared:level:world', 'the matching session still adopts it');
});

test('a quality change drops the world with the materials it was built from, and both are rebuilt', async () => {
  const released: string[] = [];
  const p = new TitlePreload(KEY, { warn: () => undefined });
  const { loaders } = fakeLoaders();
  const release = {
    [ITEMS.materials]: () => void released.push('materials'),
    [ITEMS.world]: () => void released.push('world'),
  };
  armQuality(p, loaders, release);
  armLevel(p, loaders, release);
  p.setQuality('low');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(released.sort(), ['materials', 'world']);
  assert.equal(p.has(ITEMS.world), false);
  armQuality(p, loaders, release);
  armLevel(p, loaders, release);
  assert.equal(p.has(ITEMS.world), true, 'prepared again for the new quality');
});

test('the world can build from the holder’s own in-flight materials', async () => {
  const p = new TitlePreload(KEY, { warn: () => undefined });
  const loaders = fakeLoaders().loaders;
  let seen: unknown = null;
  loaders[ITEMS.world] = async () => {
    seen = await p.peek(ITEMS.materials);
    return 'world';
  };
  armQuality(p, loaders);
  armLevel(p, loaders);
  assert.equal(await p.take(ITEMS.world, KEY, async () => 'own'), 'world');
  assert.equal(seen, 'prepared:quality:materials');
  assert.equal(p.has(ITEMS.materials), true, 'peeking does not take the materials from the holder');
});
