import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from './events.ts';

test('on/emit/off', () => {
  const bus = new EventBus();
  const seen: boolean[] = [];
  const off = bus.on('input:pointerLock', ({ locked }) => seen.push(locked));
  bus.emit('input:pointerLock', { locked: true });
  off();
  bus.emit('input:pointerLock', { locked: false });
  assert.deepEqual(seen, [true]);
});

test('once fires a single time', () => {
  const bus = new EventBus();
  let n = 0;
  bus.once('game:booted', () => n++);
  bus.emit('game:booted', { at: 0 });
  bus.emit('game:booted', { at: 1 });
  assert.equal(n, 1);
});
