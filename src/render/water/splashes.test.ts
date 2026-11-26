import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPLASH_PRESETS, WaterSplashes, burstCount } from './splashes.ts';

// standing-water spec "Splashes" (overhaul-flooded-tunnel D7).

test('bigger impacts throw more spray: a creature stomp over a body over a bullet over a step over a drip', () => {
  assert.ok(burstCount('stomp', 1) > burstCount('body', 1));
  assert.ok(burstCount('kick', 1) > burstCount('takeoff', 0.6));
  assert.ok(burstCount('body', 1) > burstCount('bullet', 0.4));
  assert.ok(burstCount('bullet', 0.4) > burstCount('step', 0.3));
  assert.ok(burstCount('step', 0.3) > burstCount('drip', 0.1));
  assert.ok(burstCount('land', 1) > burstCount('land', 0.2), 'a landing scales with the fall');
});

test('a bullet throws a narrow, fast spout; a body a wide, heavy one', () => {
  assert.ok(SPLASH_PRESETS.bullet.spread < SPLASH_PRESETS.body.spread);
  assert.ok(SPLASH_PRESETS.bullet.up[1] > SPLASH_PRESETS.step.up[1]);
});

test('a burst lives for its preset life and then is gone', () => {
  const s = new WaterSplashes(() => 0.5);
  s.burst({ x: 1, y: -0.45, z: 2, kind: 'bullet', size: 0.4 });
  s.update(0.05, 720, 75);
  assert.equal(s.live(), burstCount('bullet', 0.4));
  s.update(2, 720, 75);
  assert.equal(s.live(), 0);
});

test('the ring buffer never grows past its cap', () => {
  const s = new WaterSplashes();
  for (let i = 0; i < 100; i++) s.burst({ x: 0, y: 0, z: 0, kind: 'body', size: 1 });
  s.update(0.06, 720, 75);
  assert.ok(s.live() <= 2048);
});
