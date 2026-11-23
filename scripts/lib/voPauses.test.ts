import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BEAT_CAP, joinSpans, LEAD, longestPause, PAUSE_CAP, pauseSpans, TAIL, TIGHT_LINES } from './voPauses.ts';

const SR = 24000;
/** Tone bursts and silences, in seconds: positive = sound, negative = silence. */
function clip(parts: number[]): Float32Array {
  const out: number[] = [];
  for (const p of parts) {
    const n = Math.round(Math.abs(p) * SR);
    for (let i = 0; i < n; i++) out.push(p > 0 ? 0.3 * Math.sin((2 * Math.PI * 220 * i) / SR) : 0);
  }
  return Float32Array.from(out);
}

test('a 3 s pause inside a line comes down to the cap; the words are kept whole', () => {
  const s = clip([-0.5, 1.0, -3.0, 0.8, -0.6]);
  const out = joinSpans(s, SR, pauseSpans(s, SR, PAUSE_CAP));
  assert.ok(Math.abs(longestPause(out, SR) - PAUSE_CAP) < 0.05, `longest pause ${longestPause(out, SR).toFixed(2)} s`);
  const expected = LEAD + 1.0 + PAUSE_CAP + 0.8 + TAIL;
  assert.ok(Math.abs(out.length / SR - expected) < 0.05, `${(out.length / SR).toFixed(2)} s, expected about ${expected.toFixed(2)} s`);
});

test('short pauses and an already tight clip are left alone', () => {
  const s = clip([-LEAD, 0.7, -0.4, 0.9, -TAIL]);
  const spans = pauseSpans(s, SR, PAUSE_CAP);
  assert.equal(spans.length, 1);
  const out = joinSpans(s, SR, spans);
  assert.ok(Math.abs(out.length - s.length) < SR * 0.03, 'nothing removed');
  assert.ok(Math.abs(joinSpans(out, SR, pauseSpans(out, SR, PAUSE_CAP)).length - out.length) < SR * 0.03, 'idempotent');
});

test('the rescue lines are capped, and the written beats get the longer cap', () => {
  assert.equal(TIGHT_LINES['sec_priya_12'], PAUSE_CAP);
  for (const beat of ['sec_priya_10', 'sec_giles_10', 'sec_okafor_13', 'sec_okafor_15', 'sec_priya_16', 'sec_okafor_17']) assert.equal(TIGHT_LINES[beat], BEAT_CAP, beat);
  assert.equal(TIGHT_LINES['sec_priya_17'], undefined, 'her panicked breathing is not a line to tighten');
});
