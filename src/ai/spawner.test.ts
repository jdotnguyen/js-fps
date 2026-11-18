import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MAX_ACTIVE, Spawner, variantOf, type SpawnPointData, type SpawnRequest } from './spawner.ts';

const pt = (id: string, extra: Partial<SpawnPointData> = {}): SpawnPointData => ({ id, pos: [0, 0, 0], kind: 'floor', ...extra });

/** Drive a spawner: `alive` live enemies by group, killed on demand. */
function harness(points: SpawnPointData[]) {
  const s = new Spawner(points);
  const live: SpawnRequest[] = [];
  const cleared: string[] = [];
  const step = (seconds: number): void => {
    for (let t = 0; t < seconds; t += 0.1) s.update(0.1, live.length, (r) => live.push(r));
  };
  const kill = (n: number): void => {
    for (let i = 0; i < n && live.length; i++) {
      const r = live.shift()!;
      if (s.died(r.group)) cleared.push(r.group!);
    }
  };
  return { s, live, cleared, step, kill };
}

test('level-start points spawn at once; inactive ones wait for their group', () => {
  const h = harness([pt('a'), pt('b', { group: 'g', active: false }), pt('c', { group: 'g', active: false })]);
  h.s.reset();
  h.step(0.2);
  assert.deepEqual(h.live.map((r) => r.point.id), ['a']);
  assert.ok(h.s.trigger('g'));
  assert.ok(!h.s.trigger('g'), 'a group triggers once');
  assert.ok(!h.s.trigger('nope'));
  h.step(0.2);
  assert.deepEqual(h.live.map((r) => r.point.id).sort(), ['a', 'b', 'c']);
});

test('R11: 14 enemies through two entrances, never more than 8 alive, the rest queued as reinforcements', () => {
  const h = harness([
    pt('north', { group: 'r11', active: false, count: 7, interval: 1 }),
    pt('south', { group: 'r11', active: false, count: 7, interval: 1 }),
  ]);
  h.s.reset();
  h.s.trigger('r11');
  let peak = 0;
  let spawnedTotal = 0;
  const before = (): number => h.live.length;
  for (let t = 0; t < 120 && !h.cleared.length; t += 0.1) {
    const n0 = before();
    h.s.update(0.1, h.live.length, (r) => h.live.push(r));
    spawnedTotal += h.live.length - n0;
    peak = Math.max(peak, h.live.length);
    // The player kills one every 1.5 s once the room is full.
    if (Math.round(t * 10) % 15 === 0 && h.live.length >= DEFAULT_MAX_ACTIVE) h.kill(1);
    if (h.s.pending('r11') === 0) h.kill(h.live.length);
  }
  assert.equal(peak, 8);
  assert.equal(spawnedTotal, 14);
  assert.deepEqual(h.cleared, ['r11']);
  // Both entrances fed in (round-robin), not one after the other.
  assert.ok(new Set(h.live.concat().map((r) => r.point.id)).size <= 2);
});

test('both entrances alternate while the cap allows', () => {
  const h = harness([pt('n', { group: 'w', active: false, count: 3, interval: 0 }), pt('s', { group: 'w', active: false, count: 3, interval: 0 })]);
  h.s.reset();
  h.s.trigger('w');
  h.step(0.3);
  assert.deepEqual(h.live.map((r) => r.point.id), ['n', 's', 'n', 's', 'n', 's']);
});

test('group:cleared only after the whole group (queued too) is dead, once', () => {
  const h = harness([pt('a', { group: 'g', active: false, count: 3, interval: 5 })]);
  h.s.reset();
  h.s.trigger('g');
  h.step(0.2);
  assert.equal(h.live.length, 1);
  h.kill(1);
  assert.deepEqual(h.cleared, [], 'two still to come');
  h.step(11);
  h.kill(5);
  assert.deepEqual(h.cleared, ['g']);
  assert.ok(h.s.isCleared('g'));
  assert.equal(h.s.died('g'), false);
});

test('reset skips groups already cleared (checkpoint restart) and can cancel a group', () => {
  const h = harness([pt('a', { group: 'g' }), pt('b', { group: 'h' })]);
  h.s.reset(new Set(['g']));
  h.step(0.2);
  assert.deepEqual(h.live.map((r) => r.point.id), ['b']);
  h.s.cancel('h');
  assert.ok(h.s.isCleared('h'));
  assert.equal(h.s.pending(), 0);
});

test('variant defaults: corpse spawns are play-deads', () => {
  assert.equal(variantOf(pt('x')), 'shambler');
  assert.equal(variantOf(pt('x', { kind: 'corpse' })), 'playDead');
  assert.equal(variantOf(pt('x', { kind: 'corpse', variant: 'shambler' })), 'shambler');
  assert.equal(variantOf(pt('x', { variant: 'hero' })), 'hero');
});
