import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CROWD_MASS, DEFAULT_SEPARATION, HERO_MASS, footprintOf, separate, type SepBody } from './separation.ts';

const body = (x: number, z: number, r = 0.3, mass = 1): SepBody => ({ x, z, r, mass });
const gap = (a: SepBody, b: SepBody): number => Math.hypot(b.x - a.x, b.z - a.z) - a.r - b.r;
/** Run frames until the pass reports no overlap, or `frames` pass. */
const settle = (bodies: SepBody[], frames = 60): number => {
  let worst = Infinity;
  for (let f = 0; f < frames && worst > DEFAULT_SEPARATION.slop + 1e-4; f++) worst = separate(bodies);
  return worst;
};

test('two overlapping equal bodies are pushed apart evenly until they touch', () => {
  const a = body(0, 0);
  const b = body(0.2, 0);
  settle([a, b]);
  assert.ok(gap(a, b) >= -DEFAULT_SEPARATION.slop - 1e-3, `gap ${gap(a, b)}`);
  assert.ok(Math.abs(a.x + b.x - 0.2) < 1e-9, 'the pair moved symmetrically about its midpoint');
});

test('the heavier body moves less: a hero shoves a crowd body aside', () => {
  const hero = body(0, 0, 0.45, HERO_MASS);
  const crowd = body(0.3, 0, 0.28, CROWD_MASS);
  separate([hero, crowd]);
  const heroMoved = Math.abs(hero.x);
  const crowdMoved = Math.abs(crowd.x - 0.3);
  assert.ok(crowdMoved > heroMoved * 3, `crowd ${crowdMoved} vs hero ${heroMoved}`);
});

test('an immovable body never moves', () => {
  const wall = body(0, 0, 0.4, Infinity);
  const crowd = body(0.1, 0);
  settle([wall, crowd]);
  assert.equal(wall.x, 0);
  assert.equal(wall.z, 0);
  assert.ok(gap(wall, crowd) >= -DEFAULT_SEPARATION.slop - 1e-3);
});

test('two immovable bodies are left alone and not reported', () => {
  const a = body(0, 0, 0.3, Infinity);
  const b = body(0.1, 0, 0.3, Infinity);
  assert.equal(separate([a, b]), 0);
  assert.equal(a.x, 0);
  assert.equal(b.x, 0.1);
});

test('bodies stacked on exactly the same spot escape in a deterministic direction', () => {
  const run = (): SepBody[] => {
    const bodies = [body(1, 1), body(1, 1), body(1, 1)];
    settle(bodies);
    return bodies;
  };
  const first = run();
  const second = run();
  assert.deepEqual(first, second);
  for (let i = 0; i < first.length; i++) {
    for (let j = i + 1; j < first.length; j++) {
      const a = first[i];
      const b = first[j];
      assert.ok(a && b && gap(a, b) >= -DEFAULT_SEPARATION.slop - 1e-3, `pair ${i},${j} still overlaps`);
      assert.ok(Number.isFinite(a.x) && Number.isFinite(a.z));
    }
  }
});

test('a crowd converging on one point ends up in a ring around the immovable target', () => {
  const player = body(0, 0, 0.35, Infinity);
  const crowd: SepBody[] = [];
  for (let k = 0; k < 8; k++) crowd.push(body(Math.cos(k) * 0.4, Math.sin(k) * 0.4, 0.28));
  const all = [player, ...crowd];
  const worst = settle(all, 200);
  assert.ok(worst <= DEFAULT_SEPARATION.slop + 1e-3, `worst overlap ${worst}`);
  assert.equal(player.x, 0);
});

test('a settled group is left alone: a further pass moves nothing', () => {
  const bodies = [body(0, 0), body(0.7, 0), body(0, 0.7)];
  const before = bodies.map((b) => ({ ...b }));
  assert.equal(separate(bodies), 0);
  assert.deepEqual(bodies, before);
});

test('one pass never pushes a pair further than the per-pass cap', () => {
  const a = body(0, 0);
  const b = body(0.01, 0);
  separate([a, b], { iterations: 1 });
  assert.ok(Math.abs(b.x - 0.01) <= DEFAULT_SEPARATION.maxPush + 1e-9);
});

test('hero footprints are wider and heavier than a crowd body of the same build', () => {
  const hero = footprintOf(true, 1.25);
  const crowd = footprintOf(false, 1.25);
  assert.ok(hero.r > crowd.r && hero.mass > crowd.mass);
  assert.ok(hero.r * 2 > 0.8, 'hero footprint is wider than the old fixed 0.8 m separation spacing');
});
