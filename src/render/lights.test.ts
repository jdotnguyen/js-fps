import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_PATTERNS, patternValue } from './lights.ts';

test('all patterns stay within [0, 1]', () => {
  for (const p of LIGHT_PATTERNS) {
    for (const reduced of [false, true]) {
      for (let t = 0; t < 30; t += 0.013) {
        const v = patternValue(p, t, 7, reduced);
        assert.ok(v >= 0 && v <= 1, `${p} ${reduced} t=${t} -> ${v}`);
      }
    }
  }
});

test('reduced flashing limits big brightness jumps to <= 3 per second', () => {
  for (const p of LIGHT_PATTERNS) {
    let jumps = 0;
    let prev = patternValue(p, 0, 3, true);
    const seconds = 20;
    for (let t = 1 / 60; t < seconds; t += 1 / 60) {
      const v = patternValue(p, t, 3, true);
      if (Math.abs(v - prev) > 0.25) jumps++;
      prev = v;
    }
    assert.ok(jumps / seconds <= 3, `${p}: ${jumps / seconds} jumps/s`);
  }
});

test('flicker actually flickers when not reduced', () => {
  let low = 0;
  for (let t = 0; t < 30; t += 1 / 60) if (patternValue('flicker', t, 11, false) < 0.5) low++;
  assert.ok(low > 0);
});
