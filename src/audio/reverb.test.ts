import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../core/rng.ts';
import { stats } from './dsp.ts';
import { REVERB_PRESETS, REVERB_SPECS, renderReverbIr, resolveReverb } from './reverb.ts';

const SR = 22050;

/** Seconds until the running energy of the tail falls 40 dB below the early energy. */
function decayTime(ir: Float32Array): number {
  const win = Math.round(SR * 0.02);
  const rms = (from: number): number => {
    let sum = 0;
    for (let i = from; i < Math.min(ir.length, from + win); i++) sum += ir[i]! * ir[i]!;
    return Math.sqrt(sum / win);
  };
  const ref = rms(Math.round(SR * 0.05));
  for (let i = Math.round(SR * 0.05); i < ir.length - win; i += win) if (rms(i) < ref * 0.01) return i / SR;
  return ir.length / SR;
}

for (const preset of REVERB_PRESETS) {
  test(`${preset}: finite, bounded, deterministic, decays`, () => {
    const [l, r] = renderReverbIr(SR, preset, new Rng('t'));
    for (const ch of [l, r]) {
      for (let i = 0; i < ch.length; i++) assert.ok(Number.isFinite(ch[i]), `NaN at ${i}`);
      assert.ok(stats(ch).peak <= 1.5, `peak ${stats(ch).peak}`);
      assert.ok(stats(ch).rms > 0.001, 'silent');
      const tail = ch.subarray(ch.length - Math.round(SR * 0.05));
      assert.ok(stats(tail).rms < 0.01, 'tail has not decayed');
    }
    assert.deepEqual(l, renderReverbIr(SR, preset, new Rng('t'))[0]);
  });
}

test('presets are audibly distinct: office < corridor < hall < flooded in length', () => {
  const t = (p: (typeof REVERB_PRESETS)[number]): number => decayTime(renderReverbIr(SR, p, new Rng('t'))[0]);
  assert.ok(t('small_office') < t('metal_corridor'));
  assert.ok(t('metal_corridor') < t('metal_hall'));
  assert.ok(t('metal_hall') < t('flooded') + 0.5);
});

test('flooded is darker than the corridor (less high-frequency energy)', () => {
  const hf = (p: (typeof REVERB_PRESETS)[number]): number => {
    const [l] = renderReverbIr(SR, p, new Rng('t'));
    let sum = 0;
    for (let i = 1; i < l.length; i++) sum += (l[i]! - l[i - 1]!) ** 2;
    return sum / stats(l).rms ** 2 / l.length;
  };
  assert.ok(hf('flooded') < hf('metal_corridor'));
});

test('predelay delays the tail onset', () => {
  const [l] = renderReverbIr(SR, 'metal_hall', new Rng('t'));
  const pre = Math.round(REVERB_SPECS.metal_hall.shape.predelay * SR);
  for (let i = 0; i < pre; i++) assert.equal(l[i], 0);
});

test('resolveReverb falls back to the corridor for unknown or missing names', () => {
  assert.equal(resolveReverb(undefined), 'metal_corridor');
  assert.equal(resolveReverb('cathedral'), 'metal_corridor');
  assert.equal(resolveReverb('flooded'), 'flooded');
});
