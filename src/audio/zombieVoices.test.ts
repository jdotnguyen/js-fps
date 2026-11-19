import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZombieVoices, type VoiceSource, type ZombieVoiceCall } from './zombieVoices.ts';

const at = { x: 0, y: 0, z: 0 };
const zed = (x: number, state = 'dormant', hero = false): VoiceSource => ({ hero, state, motor: { x, y: 0, z: 0 } });

function rig(opts: { maxVoices?: number; minGap?: number } = {}) {
  const calls: ZombieVoiceCall[] = [];
  const v = new ZombieVoices({ play: (c) => calls.push(c), rng: () => 0.5, idleEvery: [4, 4], ...opts });
  return { v, calls };
}

test('clips take turns, in order, and wrap around', () => {
  const { v, calls } = rig();
  for (let i = 0; i < 4; i++) {
    v.alerted(at, false);
    v.update(2, [], at); // let the gap pass
  }
  assert.deepEqual(calls.map((c) => c.variant), [0, 1, 2, 0]);
});

test('a slice always fits inside its clip', () => {
  const calls: ZombieVoiceCall[] = [];
  for (const r of [0, 0.5, 0.999]) {
    const v = new ZombieVoices({ play: (c) => calls.push(c), rng: () => r });
    v.alerted(at, false);
  }
  const clips = [8.1, 8.1, 3.9];
  for (const c of calls) assert.ok(c.offset >= 0 && c.offset + c.duration <= clips[c.variant]! + 1e-9);
});

test('voices are spaced out and capped', () => {
  const { v, calls } = rig({ maxVoices: 2, minGap: 0 });
  v.alerted(at, false);
  v.alerted(at, false);
  v.alerted(at, false);
  assert.equal(calls.length, 2);
  const spaced = rig({ minGap: 2 });
  spaced.v.alerted(at, false);
  spaced.v.alerted(at, false);
  assert.equal(spaced.calls.length, 1);
});

test('idle groans only come from awake infected within range', () => {
  const { v, calls } = rig();
  v.update(5, [zed(80), zed(3, 'playDead'), zed(3, 'dead')], at);
  assert.equal(calls.length, 0);
  v.update(5, [zed(80), zed(6)], at);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.x, 6);
});

test('heroes sound deeper than the common infected', () => {
  const a = rig();
  a.v.alerted(at, false);
  const b = rig();
  b.v.alerted(at, true);
  assert.ok(b.calls[0]!.rate < a.calls[0]!.rate);
});
