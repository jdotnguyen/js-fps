import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Loop } from './loop.ts';

function counting(): { loop: Loop; updates: number[]; renders: number } {
  const state = { updates: [] as number[], renders: 0 };
  const loop = new Loop({ update: (dt) => state.updates.push(dt), render: () => void state.renders++ });
  return { loop, get updates() { return state.updates; }, get renders() { return state.renders; } };
}

test('runs fixed steps and carries the remainder', () => {
  const t = counting();
  assert.equal(t.loop.advance(1 / 60 + 0.001), 1);
  assert.equal(t.loop.advance(1 / 60 - 0.0005), 1);
  assert.ok(t.updates.every((dt) => dt === 1 / 60));
  assert.equal(t.renders, 2);
});

test('caps steps per frame and drops backlog', () => {
  const t = counting();
  assert.equal(t.loop.advance(0.25), 5);
  assert.equal(t.loop.advance(0), 0);
});

test('time scale 0 pauses the simulation but still renders', () => {
  const t = counting();
  t.loop.clock.scale = 0;
  assert.equal(t.loop.advance(0.1), 0);
  assert.equal(t.renders, 1);
});
