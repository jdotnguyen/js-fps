import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../core/rng.ts';
import { Scheduler } from './scheduler.ts';

test('fires within the requested interval range', () => {
  const s = new Scheduler(new Rng(1));
  const times: number[] = [];
  let t = 0;
  s.add([2, 4], () => times.push(t));
  for (; t < 120; t += 1 / 60) s.update(t);
  assert.ok(times.length >= 120 / 4 - 1 && times.length <= 120 / 2 + 1, `${times.length} firings`);
  for (let i = 1; i < times.length; i++) {
    const gap = times[i]! - times[i - 1]!;
    assert.ok(gap >= 2 - 1e-6 && gap <= 4 + 1 / 60, `gap ${gap}`);
  }
});
