import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutWord } from '../../render/logo.ts';
import { letterAlpha, planFault, REDUCED_TEAR_DX, tearOffset, WORD, type Fault } from './titleWordmark.ts';

/** Deterministic pseudo-random source for repeatable fault plans. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

test('THALASSA lays out left to right with the narrow L', () => {
  assert.deepEqual(
    WORD.letters.map((l) => l.ch),
    [...'THALASSA'],
  );
  assert.equal(WORD.letters.find((l) => l.ch === 'L')?.width, 80);
  assert.equal(WORD.width, 7 * 100 + 80 + 7 * 24);
  WORD.letters.slice(1).forEach((l, i) => {
    const prev = WORD.letters[i];
    assert.ok(prev);
    assert.equal(l.x, prev.x + prev.width + 24);
  });
});

test('layoutWord rejects letters with no glyph', () => {
  assert.throws(() => layoutWord('TAX'), /no glyph for 'X'/);
});

test('reduced flashing never plans a signal loss and keeps tears small and rare', () => {
  const rand = seeded(11);
  let now = 0;
  for (let i = 0; i < 500; i++) {
    const { fault, next } = planFault(now, true, rand);
    assert.notEqual(fault.kind, 'loss');
    assert.ok(fault.bands.length <= 1);
    for (const b of fault.bands) assert.ok(Math.abs(b.dx) <= REDUCED_TEAR_DX);
    assert.ok(next - fault.end >= 5000, 'at least 5 s between faults');
    now = next;
  }
});

test('full mode plans every fault kind', () => {
  const rand = seeded(3);
  const kinds = new Set<string>();
  let now = 0;
  for (let i = 0; i < 200; i++) {
    const { fault, next } = planFault(now, false, rand);
    kinds.add(fault.kind);
    assert.ok(fault.letter >= 0 && fault.letter < WORD.letters.length);
    now = next;
  }
  assert.deepEqual([...kinds].sort(), ['drop', 'loss', 'tear']);
});

test('a dropped letter blanks in full mode but only dims under reduced flashing', () => {
  const drop: Fault = { kind: 'drop', start: 0, end: 1000, letter: 2, bands: [] };
  assert.equal(letterAlpha(drop, 2, 200, false), 0);
  assert.equal(letterAlpha(drop, 1, 200, false), 1, 'other letters stay lit');
  for (let t = 0; t <= 1000; t += 25) assert.ok(letterAlpha(drop, 2, t, true) >= 0.35);
  assert.equal(letterAlpha(drop, 2, 1500, false), 1, 'back on once the fault ends');
});

test('tears shift only the rows inside their bands', () => {
  const tear: Fault = { kind: 'tear', start: 0, end: 100, letter: 0, bands: [{ y: 0.4, h: 0.1, dx: 12 }] };
  assert.equal(tearOffset(tear, 0.45), 12);
  assert.equal(tearOffset(tear, 0.3), 0);
  assert.equal(tearOffset(null, 0.45), 0);
});
