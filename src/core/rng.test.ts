import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from './rng.ts';

test('same seed gives the same sequence', () => {
  const a = new Rng('test-room');
  const b = new Rng('test-room');
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
});

test('different seeds differ', () => {
  assert.notEqual(new Rng(1).next(), new Rng(2).next());
});

test('ranges stay in bounds', () => {
  const r = new Rng(42);
  for (let i = 0; i < 1000; i++) {
    const f = r.next();
    assert.ok(f >= 0 && f < 1);
    const n = r.int(3, 5);
    assert.ok(n >= 3 && n <= 5 && Number.isInteger(n));
  }
});

test('fork is stable for the same parent state and label', () => {
  assert.equal(new Rng(7).fork('pipe').next(), new Rng(7).fork('pipe').next());
});
