import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProgramWatch, programWarning, type ProgramEntry } from './programWatch.ts';

// session-loading "First-use shader compiles are reported" (openspec stop-midgame-shader-stalls D6).

const program = (id: number, name = `m${id}`): ProgramEntry => ({ id, name, type: 'MeshStandardMaterial' });

test('a program built after the baseline is returned once, by name', () => {
  const watch = new ProgramWatch();
  watch.accept([program(0), program(1)]);
  assert.deepEqual(watch.unexpected([program(0), program(1)]), []);
  const fresh = watch.unexpected([program(0), program(1), program(2, 'humanoid-wet')]);
  assert.deepEqual(fresh.map((p) => p.id), [2]);
  assert.match(programWarning(fresh[0]!), /MeshStandardMaterial "humanoid-wet"/);
  assert.deepEqual(watch.unexpected([program(0), program(1), program(2)]), [], 'a repeat is silent');
});

test('a new program is seen even when another was destroyed, so the list is no longer', () => {
  const watch = new ProgramWatch();
  watch.accept([program(0), program(1)]);
  assert.deepEqual(watch.unexpected([program(2), program(1)]).map((p) => p.id), [2]);
});

test('programs accepted later (a quality change, the fly camera) are never reported', () => {
  const watch = new ProgramWatch();
  watch.accept([program(0)]);
  watch.accept([program(0), program(1)]);
  assert.deepEqual(watch.unexpected([program(0), program(1), program(2)]).map((p) => p.id), [2]);
});
