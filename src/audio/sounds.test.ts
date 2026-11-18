import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../core/rng.ts';
import { impulseResponse, stats } from './dsp.ts';
import { SOUND_SPECS } from './sounds.ts';

const SR = 22050;

for (const [name, spec] of Object.entries(SOUND_SPECS)) {
  test(`${name}: finite, not clipping, audible, deterministic`, () => {
    const a = spec.make(SR, new Rng(`${name}:0`));
    for (let i = 0; i < a.length; i++) assert.ok(Number.isFinite(a[i]), `${name}: NaN at ${i}`);
    const s = stats(a);
    assert.ok(s.peak <= 1.0001, `${name}: peak ${s.peak}`);
    assert.ok(s.rms > 0.01, `${name}: too quiet (rms ${s.rms})`);
    assert.deepEqual(a, spec.make(SR, new Rng(`${name}:0`)));
  });

  if (spec.loop) {
    test(`${name}: loop seam is no bigger than normal sample-to-sample motion`, () => {
      const a = spec.make(SR, new Rng(`${name}:0`));
      let sum = 0;
      let max = 0;
      for (let i = 1; i < a.length; i++) {
        const d = Math.abs(a[i]! - a[i - 1]!);
        sum += d;
        max = Math.max(max, d);
      }
      const seam = Math.abs(a[0]! - a[a.length - 1]!);
      assert.ok(seam <= max, `${name}: seam ${seam} > max step ${max}`);
      assert.ok(seam <= (sum / (a.length - 1)) * 8, `${name}: seam ${seam} vs mean step ${sum / (a.length - 1)}`);
    });
  }
}

test('impulse response is finite and decays', () => {
  const [l, r] = impulseResponse(SR, 1.6, new Rng('ir'));
  for (const ch of [l, r]) {
    for (let i = 0; i < ch.length; i++) assert.ok(Number.isFinite(ch[i]));
    const head = stats(ch.subarray(0, SR * 0.2)).rms;
    const tail = stats(ch.subarray(ch.length - SR * 0.2)).rms;
    assert.ok(tail < head * 0.05, `tail ${tail} vs head ${head}`);
  }
});
