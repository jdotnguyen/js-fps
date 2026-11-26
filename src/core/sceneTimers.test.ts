import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SceneTimers } from './sceneTimers.ts';

const STEP = 1 / 60;
const run = (t: SceneTimers, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds / STEP); i++) t.update(STEP);
};

test('a timer fires once, after its seconds of play and in due order', () => {
  const t = new SceneTimers();
  const log: string[] = [];
  t.after(1, () => log.push('late'));
  t.after(0.5, () => log.push('early'));
  run(t, 0.49);
  assert.deepEqual(log, []);
  run(t, 0.51);
  assert.deepEqual(log, ['early', 'late']);
  run(t, 2);
  assert.deepEqual(log, ['early', 'late']);
});

test('unstepped timers hold, however long that lasts', () => {
  const t = new SceneTimers();
  let fired = 0;
  t.after(1, () => fired++);
  run(t, 0.6);
  // Frozen: no steps.
  assert.equal(fired, 0);
  run(t, 0.4);
  assert.equal(fired, 1);
});

test('cancelling runs neither; clearing runs only what a timer asked for when dropped', () => {
  const t = new SceneTimers();
  const log: string[] = [];
  const cancel = t.after(1, () => log.push('run a'), () => log.push('dropped a'));
  t.after(1, () => log.push('run b'), () => log.push('dropped b'));
  t.after(1, () => log.push('run c'));
  cancel();
  t.clear();
  run(t, 2);
  assert.deepEqual(log, ['dropped b']);
});

test('a timer may clear or set timers as it fires', () => {
  const t = new SceneTimers();
  const log: string[] = [];
  t.after(0.5, () => {
    log.push('first');
    t.clear();
    t.after(0, () => log.push('next step'));
  });
  t.after(0.5, () => log.push('cleared'));
  run(t, 0.5);
  assert.deepEqual(log, ['first']);
  t.update(STEP);
  assert.deepEqual(log, ['first', 'next step']);
});
