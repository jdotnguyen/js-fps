import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loudnessAt, loudnessEnvelope } from './loudness.ts';

const RATE = 8000;

/** A made-up recording: `[seconds, amplitude]` stretches of a 400 Hz tone. */
function tones(...parts: Array<[number, number]>): Float32Array {
  const out: number[] = [];
  for (const [s, amp] of parts) for (let i = 0; i < Math.round(s * RATE); i++) out.push(amp * Math.sin((2 * Math.PI * 400 * out.length) / RATE));
  return Float32Array.from(out);
}

test('tone, gap, tone: the envelope is full in the tones and empty in the gap', () => {
  const env = loudnessEnvelope(tones([0.5, 0.6], [0.3, 0], [0.5, 0.6]), RATE);
  assert.ok(Math.abs(env.step - 0.005) < 1e-9, `step ${env.step}`);
  assert.equal(env.values.length, 260);
  for (const t of [0.1, 0.3, 0.45, 0.9, 1.1, 1.25]) assert.ok(loudnessAt(env, t) > 0.97, `tone at ${t} s: ${loudnessAt(env, t)}`);
  for (const t of [0.65, 0.7, 0.78]) assert.ok(loudnessAt(env, t) < 0.01, `gap at ${t} s: ${loudnessAt(env, t)}`);
  assert.ok([...env.values].every((v) => v >= 0 && v <= 1), 'within 0..1');
});

test('the attack covers a step up in about 15 ms and the release a step down in about 60 ms', () => {
  const env = loudnessEnvelope(tones([0.3, 0], [0.3, 0.6], [0.3, 0]), RATE);
  // The 20 ms window starts to hear the tone 10 ms early, so each figure may run up to a window over.
  assert.ok(loudnessAt(env, 0.285) < 0.01, 'silent before the tone');
  assert.ok(loudnessAt(env, 0.325) > 0.85, `attacked: ${loudnessAt(env, 0.325)}`);
  assert.ok(loudnessAt(env, 0.61) > 0.4, `released slower than it attacked: ${loudnessAt(env, 0.61)}`);
  assert.ok(loudnessAt(env, 0.68) < 0.1, `released: ${loudnessAt(env, 0.68)}`);
});

test('it is normalised to the 95th percentile, so one spike does not shrink the rest, and half as loud reads half', () => {
  const env = loudnessEnvelope(tones([1, 0.2], [0.02, 1], [1, 0.2], [0.5, 0.1]), RATE);
  assert.ok(loudnessAt(env, 0.5) > 0.97, `the body of the sound is full scale: ${loudnessAt(env, 0.5)}`);
  assert.ok(Math.abs(loudnessAt(env, 2.35) - 0.5) < 0.03, `half the amplitude: ${loudnessAt(env, 2.35)}`);
});

test('silence and an empty recording give an empty envelope, and outside the recording is silent', () => {
  assert.ok([...loudnessEnvelope(new Float32Array(RATE), RATE).values].every((v) => v === 0));
  assert.equal(loudnessAt(loudnessEnvelope(new Float32Array(0), RATE), 0), 0);
  const env = loudnessEnvelope(tones([0.5, 0.6]), RATE);
  assert.equal(loudnessAt(env, -0.01), 0);
  assert.equal(loudnessAt(env, 0.6), 0);
});
