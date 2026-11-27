// visor-hud: the panels dim after six quiet seconds of play and wake at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALM_AFTER, CalmModel } from './calmModel.ts';

const STEP = 1 / 60;

function play(m: CalmModel, busy: boolean, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / STEP); i++) m.step(busy, STEP);
}

test('six quiet seconds dim the panels', () => {
  const m = new CalmModel();
  assert.equal(CALM_AFTER, 6);
  play(m, false, 5.9);
  assert.equal(m.dim, false);
  play(m, false, 0.2);
  assert.equal(m.dim, true);
});

test('an event wakes them at once and the count starts over', () => {
  const m = new CalmModel();
  play(m, false, 8);
  m.wake();
  assert.equal(m.dim, false);
  play(m, false, 5.9);
  assert.equal(m.dim, false);
  play(m, false, 0.2);
  assert.equal(m.dim, true);
});

test('anything below full wakes them at once and keeps them awake', () => {
  const m = new CalmModel();
  play(m, false, 8);
  m.step(true, STEP);
  assert.equal(m.dim, false);
  play(m, true, 30);
  assert.equal(m.dim, false);
});

test('a frozen scene does not count', () => {
  const m = new CalmModel();
  for (let i = 0; i < 1000; i++) m.step(false, 0);
  assert.equal(m.dim, false);
});
