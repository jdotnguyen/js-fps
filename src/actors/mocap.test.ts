import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearSharedMocapLibrary, loadSharedMocapLibrary, sharedMocapLibrary } from './mocap.ts';

// startup-bundle spec: Shared clip data is its own chunk (trim-startup-bundle D1).

test('the shared library throws a named error until it is loaded', () => {
  clearSharedMocapLibrary();
  assert.throws(() => sharedMocapLibrary(), /await loadSharedMocapLibrary\(\)/);
});

test('loading compiles the core clips once; concurrent loads share it', async () => {
  clearSharedMocapLibrary();
  const [a, b] = await Promise.all([loadSharedMocapLibrary(), loadSharedMocapLibrary()]);
  assert.equal(a, b);
  assert.equal(sharedMocapLibrary(), a);
  assert.ok(a.ids().length > 0, 'core clips compiled');
  assert.equal(await loadSharedMocapLibrary(), a);
});

test('clearing releases the library and the next load compiles a fresh one', async () => {
  clearSharedMocapLibrary();
  const first = await loadSharedMocapLibrary();
  clearSharedMocapLibrary();
  assert.throws(() => sharedMocapLibrary());
  const second = await loadSharedMocapLibrary();
  assert.notEqual(second, first);
  assert.deepEqual(second.ids(), first.ids());
});

test('a clear during a load leaves the library unloaded', async () => {
  clearSharedMocapLibrary();
  const pending = loadSharedMocapLibrary();
  clearSharedMocapLibrary();
  await pending;
  assert.throws(() => sharedMocapLibrary());
  await loadSharedMocapLibrary();
  assert.ok(sharedMocapLibrary());
});
