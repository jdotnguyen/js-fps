import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TitleArming, type TitleArmingDeps } from './titleArming.ts';
import { ITEMS, ITEM_GROUP, type ItemName, type SharedLoaders } from './titlePrepare.ts';
import type { TitlePreload } from './titlePreload.ts';
import type { Settings } from '../core/settings.ts';

const LIMITS = { maxTextures: 16, maxFragmentUniforms: 1024, maxAnisotropy: 16 };

function setup(over: Partial<TitleArmingDeps> = {}): { arming: TitleArming; started: ItemName[]; state: { quality: Settings['quality']; holder: TitlePreload | null } } {
  const started: ItemName[] = [];
  const state = { quality: 'high' as Settings['quality'], holder: null as TitlePreload | null };
  const arming = new TitleArming({
    defaultLevel: 'slice01',
    quality: () => state.quality,
    probe: () => LIMITS,
    loaders: () => {
      const loaders = {} as SharedLoaders;
      for (const item of Object.values(ITEMS)) {
        loaders[item] = async () => {
          started.push(item);
          return item;
        };
      }
      return loaders;
    },
    current: () => state.holder,
    worldAllowed: true,
    ...over,
  });
  return { arming, started, state };
}

test('a title arms the shared, quality and level items for the default level, quality and GPU', () => {
  const { arming, started, state } = setup();
  const holder = arming.create();
  state.holder = holder;
  assert.deepEqual(holder.current, { levelId: 'slice01', quality: 'high', gpu: '16/1024/16' });
  assert.deepEqual([...started].sort(), Object.values(ITEMS).sort());
});

test('without GPU limits no world is prepared, but everything else is', () => {
  const { arming, started } = setup({ probe: () => null });
  const holder = arming.create();
  assert.equal(holder.current.gpu, '');
  assert.equal(started.includes(ITEMS.world), false);
  assert.equal(started.includes(ITEMS.materials), true);
  assert.equal(started.includes(ITEMS.mocap), true);
});

test('the UV checker load builds its own world, so the title builds none', () => {
  const { arming, started } = setup({ worldAllowed: false });
  arming.create();
  assert.equal(started.includes(ITEMS.world), false);
});

test('a quality change on the title rebuilds the quality and level items, not the shared ones', async () => {
  const { arming, started, state } = setup();
  state.holder = arming.create();
  started.length = 0;
  state.quality = 'low';
  arming.qualityChanged();
  assert.equal(state.holder.current.quality, 'low');
  assert.deepEqual(
    [...started].sort(),
    Object.values(ITEMS)
      .filter((i) => ITEM_GROUP[i] !== 'shared')
      .sort(),
  );
});

test('an unchanged quality or no holder does nothing', () => {
  const { arming, started, state } = setup();
  arming.qualityChanged(); // no holder yet
  state.holder = arming.create();
  started.length = 0;
  arming.qualityChanged(); // same quality
  assert.equal(started.length, 0);
});

test('a holder a session already took is not touched by a later settings change', () => {
  const { arming, started, state } = setup();
  arming.create();
  state.holder = null; // the coordinator handed it to a session
  started.length = 0;
  state.quality = 'low';
  arming.qualityChanged();
  assert.equal(started.length, 0);
});
