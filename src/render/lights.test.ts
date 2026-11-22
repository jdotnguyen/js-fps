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

// render-lighting spec "Failing-tube light pattern" (overhaul-flooded-tunnel D11).
test('a failing tube is mostly lit, stutters, and goes fully dark at least once in 30 s', () => {
  for (const seed of [1, 7, 23, 101, 555]) {
    let lit = 0;
    let dark = 0;
    let stutters = 0;
    let prev = patternValue('failing', 0, seed, false);
    const n = 30 * 120;
    for (let i = 1; i <= n; i++) {
      const v = patternValue('failing', i / 120, seed, false);
      if (v > 0.9) lit++;
      if (v === 0) dark++;
      if (prev > 0.9 && v < 0.2 && v > 0) stutters++;
      prev = v;
    }
    assert.ok(lit / n > 0.6, `seed ${seed}: lit ${((lit / n) * 100).toFixed(0)}% of the time`);
    assert.ok(dark > 0, `seed ${seed}: dark at least once`);
    assert.ok(stutters >= 2, `seed ${seed}: stutters (${stutters})`);
  }
});

test('a failing tube never changes more than three times in any second, and reduced flashing leaves it alone', () => {
  for (const seed of [1, 7, 23, 101, 555]) {
    const changes: number[] = [];
    let prev = patternValue('failing', 0, seed, false);
    for (let i = 1; i <= 120 * 120; i++) {
      const t = i / 120;
      const v = patternValue('failing', t, seed, false);
      assert.equal(patternValue('failing', t, seed, true), v, 'identical with reduced flashing');
      if (Math.abs(v - prev) > 0.3) changes.push(t);
      prev = v;
    }
    for (let k = 3; k < changes.length; k++) assert.ok(changes[k]! - changes[k - 3]! >= 1 - 1e-9, `seed ${seed}: 4 changes within ${(changes[k]! - changes[k - 3]!).toFixed(2)} s at t=${changes[k]!.toFixed(2)}`);
  }
});
