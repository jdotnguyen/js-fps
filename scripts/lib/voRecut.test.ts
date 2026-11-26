import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeMono, encodeRecut, joinParts, validateRecipe, type RecipePart } from './voRecut.ts';

const SR = 24000;
const tone = (seconds: number, level: number): Float32Array => new Float32Array(Math.round(seconds * SR)).fill(level);
const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

test('recut: spans join in order with their gaps, and fade at the ends and the join', () => {
  const sources: Record<string, Float32Array> = { a: tone(2, 0.5), b: tone(2, 0.25) };
  const out = joinParts([{ clip: 'a', from: 0.5, to: 1.5 }, { clip: 'b', from: 0, to: 0.5, gap: 0.25 }], (p) => sources[p.clip!]!);
  assert.equal(out.length, SR * 1.75);
  assert.equal(out[0], 0);
  assert.equal(out[SR / 2], 0.5);
  assert.equal(out[SR + SR / 8], 0, 'the gap is silent');
  assert.equal(out[SR * 1.5], 0.25);
  assert.equal(out[out.length - 1], 0);
});

test('recut: a span past the end of its source is an error', () => {
  assert.throws(() => joinParts([{ clip: 'a', from: 3, to: 4 }], () => tone(1, 0.1)), /outside its source/);
});

test('recut: a recipe takes one kind of source per clip and sane spans', () => {
  const recipe = (parts: RecipePart[]) => () => validateRecipe({ commit: 'abc', clips: { x: parts } });
  assert.doesNotThrow(recipe([{ wav: 'older/a.wav', from: 0, to: 1 }]));
  assert.throws(recipe([]), /no parts/);
  assert.throws(recipe([{ from: 0, to: 1 }]), /exactly one/);
  assert.throws(recipe([{ wav: 'a.wav', clip: 'a', from: 0, to: 1 }]), /exactly one/);
  assert.throws(recipe([{ wav: 'a.wav', from: 0, to: 1 }, { clip: 'a', from: 0, to: 1 }]), /mixes/);
  assert.throws(recipe([{ clip: 'a', from: 1, to: 1 }]), /bad span/);
});

test('recut: running a recipe twice writes the same clip', { skip: !hasFfmpeg }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'vo-recut-test-'));
  try {
    const source = join(dir, 'source.wav');
    execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=3', '-ac', '1', '-ar', String(SR), source]);
    const load = (): Float32Array => decodeMono(source);
    for (const parts of [
      [{ wav: 'source.wav', from: 0.2, to: 1.4 }],
      [{ clip: 'a', from: 0, to: 0.6 }, { clip: 'b', from: 1, to: 1.8, gap: 0.3 }],
    ] satisfies RecipePart[][]) {
      const first = join(dir, 'first.mp3');
      const second = join(dir, 'second.mp3');
      const seconds = encodeRecut(parts, load, first);
      assert.equal(encodeRecut(parts, load, second), seconds);
      assert.ok(readFileSync(first).equals(readFileSync(second)));
      assert.ok(Math.abs(decodeMono(first).length / SR - seconds) < 0.1);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
