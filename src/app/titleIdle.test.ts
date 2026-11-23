import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IdleGate } from './titleIdle.ts';

function clock(): { now: () => number; advance: (ms: number) => void } {
  let t = 1000;
  return { now: () => t, advance: (ms) => void (t += ms) };
}

test('with no interaction the wait is just a frame', async () => {
  const c = clock();
  let frames = 0;
  let sleeps = 0;
  const gate = new IdleGate({ now: c.now, frame: async () => void frames++, sleep: async () => void sleeps++ });
  await gate.wait();
  assert.deepEqual([frames, sleeps], [1, 0]);
});

test('work holds while the player is interacting and resumes once the menu is quiet', async () => {
  const c = clock();
  let sleeps = 0;
  const gate = new IdleGate({
    quietMs: 300,
    now: c.now,
    frame: async () => undefined,
    sleep: async (ms) => {
      sleeps++;
      c.advance(ms);
    },
  });
  gate.touch();
  assert.equal(gate.busy, true);
  await gate.wait();
  assert.equal(gate.busy, false);
  assert.equal(sleeps, 6, '300 ms of quiet in 50 ms steps');
});

test('a new touch while waiting extends the hold', async () => {
  const c = clock();
  let touched = false;
  const gate = new IdleGate({
    quietMs: 100,
    now: c.now,
    frame: async () => undefined,
    sleep: async (ms) => {
      c.advance(ms);
      if (!touched && c.now() === 1050) {
        touched = true;
        gate.touch();
      }
    },
  });
  gate.touch();
  await gate.wait();
  assert.ok(c.now() >= 1050 + 100, 'quiet for a full window after the last touch');
});
