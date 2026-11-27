// visor-hud: the heartbeat trace follows health and advances only in play time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { VitalState } from '../../../actors/vitals.ts';
import { BPM_EASE, DOWNED_BPM, ECG_SAMPLES, HeartModel, targetBpm } from './heartModel.ts';

const STEP = 1 / 60;

function play(m: HeartModel, hp: number, state: VitalState, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / STEP); i++) m.step(hp, state, STEP);
}

/** Heights of the spikes in a trace: the local tops that stand well clear of the smaller waves. */
function spikes(trace: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 1; i < trace.length - 1; i++) {
    if (trace[i]! > 0.4 && trace[i]! >= trace[i - 1]! && trace[i]! > trace[i + 1]!) out.push(trace[i]!);
  }
  return out;
}

function snapped(hp: number, state: VitalState = 'alive'): HeartModel {
  const m = new HeartModel(() => 0.8);
  m.snap(hp, state);
  return m;
}

test('the rate and the beat count at 20 health are clearly higher than at 100', () => {
  const full = snapped(100);
  const low = snapped(20);
  assert.equal(Math.round(full.bpm), 72);
  assert.ok(low.bpm > full.bpm + 50, `${low.bpm} against ${full.bpm}`);
  assert.ok(spikes(low.trace()).length > spikes(full.trace()).length);
});

test('the rate eases to its target instead of jumping on a hit', () => {
  const m = snapped(100);
  play(m, 20, 'alive', 1);
  assert.ok(Math.abs(m.bpm - (72 + BPM_EASE)) < 0.5, `${m.bpm}`);
  play(m, 20, 'alive', 10);
  assert.ok(Math.abs(m.bpm - targetBpm(20, 'alive')) < 1e-6);
});

test('the trace stays at 96 samples and scrolls', () => {
  const m = snapped(100);
  const before = Array.from(m.trace());
  assert.equal(m.step(100, 'alive', 0.1), true);
  const after = Array.from(m.trace());
  assert.equal(after.length, ECG_SAMPLES);
  assert.equal(ECG_SAMPLES, 96);
  assert.deepEqual(after.slice(0, 90), before.slice(3, 93), 'oldest first, shifted along');
});

test('a frozen scene does not advance it', () => {
  const m = snapped(40);
  play(m, 40, 'alive', 0.4);
  const trace = Array.from(m.trace());
  const bpm = m.bpm;
  for (let i = 0; i < 600; i++) assert.equal(m.step(40, 'alive', 0), false);
  assert.deepEqual(Array.from(m.trace()), trace);
  assert.equal(m.bpm, bpm);
});

test('beats are even above the threshold and irregular at or below it', () => {
  const steady = spikes(snapped(31).trace());
  assert.ok(steady.every((h) => h > 0.85), steady.join(' '));
  const uneven = spikes(snapped(30).trace());
  assert.ok(uneven.some((h) => h < 0.65) && uneven.some((h) => h > 0.85), uneven.join(' '));
});

test('downed draws a weak, slow trace', () => {
  const m = snapped(100);
  play(m, 0, 'downed', 10);
  assert.ok(Math.abs(m.bpm - DOWNED_BPM) < 1e-6);
  const trace = Array.from(m.trace());
  assert.ok(Math.max(...trace) > 0.2 && Math.max(...trace) < 0.4, `${Math.max(...trace)}`);
});

test('dead flatlines', () => {
  const m = snapped(50);
  play(m, 0, 'dead', 3);
  assert.equal(m.bpm, 0);
  assert.ok(m.trace().every((v) => v === 0));
});
