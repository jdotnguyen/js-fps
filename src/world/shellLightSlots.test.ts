import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readLevel } from '../data/levels/readLevel.ts';
import type { LevelData } from '../data/types/level.ts';
import { loadSlice01 } from './headlessSlice.ts';

// Room shells (split-level-data D3, risk "lights land on the wrong fixtures"): a numeric light slot indexes the room's
// fixtures in piece order, so building the shells at load must keep every fixture where the stored pieces had it.
// The snapshot holds each numeric slot's fixture (world x, z) from the level as built before phase 1b. A light that
// has since been removed or moved to a kind slot is skipped. If a room's cells or fixtures change on purpose, its
// lights move with them: check them in the game, then update the room's entry here.

const SNAPSHOT = JSON.parse(readFileSync(new URL('./shellLightSlots.snapshot.json', import.meta.url), 'utf8')) as Record<string, Record<string, [number, number]>>;

test('every numeric light slot lights the same fixture as before the shells were built at load', () => {
  const data = readLevel('slice01') as LevelData;
  const { level } = loadSlice01();
  const moved: string[] = [];
  for (const room of data.rooms) {
    const want = SNAPSHOT[room.id];
    if (!want) continue;
    const lights = room.lights ?? [];
    const built = level.roomLights(room.id);
    assert.equal(built.length, lights.length, `${room.id}: every light found its slot`);
    lights.forEach((l, i) => {
      if (typeof l.slot !== 'number') return;
      const at = want[String(l.slot)];
      if (!at) return;
      const p = built[i]!.position;
      if (Math.abs(p.x - at[0]) > 0.01 || Math.abs(p.z - at[1]) > 0.01) moved.push(`${room.id} slot ${l.slot}: [${at.join(', ')}] -> [${p.x.toFixed(2)}, ${p.z.toFixed(2)}]`);
    });
  }
  assert.deepEqual(moved, []);
});
