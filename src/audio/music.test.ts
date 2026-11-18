import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../core/rng.ts';
import { stats } from './dsp.ts';
import { MUSIC_SPECS } from './music.ts';

const SR = 8000; // low rate keeps the test fast; the structure is rate-independent

for (const [name, spec] of Object.entries(MUSIC_SPECS)) {
  const a = spec.make(SR, new Rng(`music:${name}`));

  test(`${name}: stereo, finite, not clipping, audible, right length`, () => {
    assert.equal(a.left.length, SR * spec.seconds);
    assert.equal(a.right.length, a.left.length);
    for (const ch of [a.left, a.right]) {
      for (let i = 0; i < ch.length; i++) assert.ok(Number.isFinite(ch[i]), `${name}: NaN at ${i}`);
      const s = stats(ch);
      assert.ok(s.peak <= 1, `${name}: peak ${s.peak}`);
      assert.ok(s.rms > 0.02, `${name}: too quiet (rms ${s.rms})`);
    }
  });

  test(`${name}: deterministic`, () => {
    assert.deepEqual(a.left, spec.make(SR, new Rng(`music:${name}`)).left);
  });

  test(`${name}: loop seam is no bigger than normal sample-to-sample motion`, () => {
    for (const ch of [a.left, a.right]) {
      let max = 0;
      for (let i = 1; i < ch.length; i++) max = Math.max(max, Math.abs(ch[i]! - ch[i - 1]!));
      assert.ok(Math.abs(ch[0]! - ch[ch.length - 1]!) <= max);
    }
  });
}
