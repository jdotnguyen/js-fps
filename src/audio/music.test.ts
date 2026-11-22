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

// adaptive-music spec: the Lab B score's layers loop together, are generated identically everywhere, and stay finite.
import { LAB_B_LOOP } from './scores/labB.ts';
import { SCORE_RENDERS } from './scores/index.ts';
import scoresJson from '../data/scores.json' with { type: 'json' };

const labB = SCORE_RENDERS['labB']!.render(SR, new Rng('score:labB'));

test('labB: every layer in scores.json is rendered, 20.8 s long, finite and audible', () => {
  assert.equal(LAB_B_LOOP, 20.8);
  for (const name of scoresJson.labB.layers) {
    const p = labB.layers[name];
    assert.ok(p, `layer ${name}`);
    assert.equal(p.left.length, Math.round(SR * LAB_B_LOOP), name);
    assert.equal(p.right.length, p.left.length, name);
    for (const ch of [p.left, p.right]) {
      for (let i = 0; i < ch.length; i++) assert.ok(Number.isFinite(ch[i]), `${name}: NaN at ${i}`);
      const s = stats(ch);
      assert.ok(s.peak <= 1, `${name}: peak ${s.peak}`);
      assert.ok(s.rms > 0.01, `${name}: too quiet (rms ${s.rms})`);
    }
  }
});

test('labB: every stinger in scores.json is rendered', () => {
  for (const name of Object.keys(scoresJson.labB.stingers)) assert.ok(labB.stingers[name]?.length, name);
  assert.equal(labB.stingers['stab']!.length, 2, 'two stab variants');
});

test('labB: layers loop with no click at the seam', () => {
  for (const [name, p] of Object.entries(labB.layers)) {
    for (const ch of [p.left, p.right]) {
      let max = 0;
      for (let i = 1; i < ch.length; i++) max = Math.max(max, Math.abs(ch[i]! - ch[i - 1]!));
      assert.ok(Math.abs(ch[0]! - ch[ch.length - 1]!) <= max, name);
    }
  }
});

test('labB: deterministic', () => {
  const again = SCORE_RENDERS['labB']!.render(SR, new Rng('score:labB'));
  assert.deepEqual(again.layers['rise']!.left, labB.layers['rise']!.left);
  assert.deepEqual(again.stingers['slam']![0]!.left, labB.stingers['slam']![0]!.left);
});

test('labB: every cue that plays layers comes out at the same loudness (within 1 dB)', () => {
  const n = labB.layers['drone']!.left.length;
  const levels: Record<string, number> = {};
  for (const [name, cue] of Object.entries(scoresJson.labB.cues) as Array<[string, { layers?: Record<string, number> }]>) {
    if (!cue.layers) continue;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      let l = 0;
      let r = 0;
      for (const [k, g] of Object.entries(cue.layers)) {
        l += labB.layers[k]!.left[i]! * g;
        r += labB.layers[k]!.right[i]! * g;
      }
      sum += l * l + r * r;
    }
    levels[name] = 20 * Math.log10(Math.sqrt(sum / (2 * n)));
  }
  const v = Object.values(levels);
  assert.ok(Math.max(...v) - Math.min(...v) <= 1, JSON.stringify(levels));
});
