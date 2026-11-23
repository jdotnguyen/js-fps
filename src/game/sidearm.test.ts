import test from 'node:test';
import assert from 'node:assert/strict';
import { sidearmAllowed } from './sidearm.ts';

test('holstered before the drop on a level that has it', () => {
  assert.equal(sidearmAllowed({}, true), false);
  assert.equal(sidearmAllowed({ introSeen: true, briefingSeen: true, rounds_done: true, drop_started: true }, true), false);
});

test('armed once the first duct bang sets gunDrawn', () => {
  assert.equal(sidearmAllowed({ gunDrawn: true }, true), true);
});

test('armed after the drop, including saves from before gunDrawn existed', () => {
  assert.equal(sidearmAllowed({ drop_done: true }, true), true);
  assert.equal(sidearmAllowed({ drop_done: true, gunDrawn: true }, true), true);
});

test('a flag that is not exactly true does not arm Jay', () => {
  assert.equal(sidearmAllowed({ gunDrawn: 1 }, true), false);
  assert.equal(sidearmAllowed({ drop_done: 'true' }, true), false);
});

test('a level without the drop is never holstered', () => {
  assert.equal(sidearmAllowed({}, false), true);
});
