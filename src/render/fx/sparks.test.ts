import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sparks, landingTime } from './sparks.ts';

// flooded-tunnel spec "Failing lights and sparks in the tunnel": sparks that reach the water hiss and ring it.

test('landing time of a falling spark', () => {
  // Dropped from 2.9 m with no upward speed onto water at -0.45: about 0.83 s.
  assert.ok(Math.abs(landingTime(2.9, 0, -0.45) - Math.sqrt((2 * 3.35) / 9.8)) < 1e-9);
  assert.equal(landingTime(0, 0, 1), Infinity, 'never reaches a surface above it');
});

test('sparks over water land in it (each landing calls back once); over a dry floor they do not', () => {
  let seed = 3;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const wet = new Sparks(() => ({ y: 1.6, water: true }), rnd);
  const hits: number[] = [];
  wet.onWater = (_x, y) => hits.push(y);
  wet.burst(0, 2.9, 0, true);
  const expected = wet.waiting;
  assert.ok(expected > 0, 'some sparks live long enough to reach the water');
  for (let i = 0; i < 180; i++) wet.update(1 / 60, 720, 75);
  assert.equal(hits.length, expected);
  assert.ok(hits.every((y) => y === 1.6));
  const dry = new Sparks(() => ({ y: 0, water: false }), rnd);
  dry.burst(0, 2.9, 0, true);
  assert.equal(dry.waiting, 0);
});

test('a cut-out throws a bigger shower than a strike', () => {
  let seed = 9;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const s = new Sparks(() => ({ y: -10, water: true }), rnd);
  const count = (strong: boolean): number => {
    const before = (s as unknown as { cursor: number }).cursor;
    s.burst(0, 3, 0, strong);
    return ((s as unknown as { cursor: number }).cursor - before + 512) % 512;
  };
  assert.ok(count(true) > count(false));
});
