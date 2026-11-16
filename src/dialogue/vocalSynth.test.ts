import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Rng } from '../core/rng.ts';
import { stats } from '../audio/dsp.ts';
import { validate } from '../core/validate.ts';
import { EMOTES, validateSpeakers } from '../data/types/dialogue.ts';
import { babbleTrack, EMOTE_MAX_S, EMOTE_MIN_S, emoteTrack, renderUtterance } from './vocalSynth.ts';

const SR = 24000;
const speakers = validate(validateSpeakers, JSON.parse(readFileSync(new URL('../data/dialogue/speakers.json', import.meta.url), 'utf8')), 'speakers.json');
const giles = speakers['engineer']!;
const okafor = speakers['medic']!;

test('every emote renders a clean, audible buffer for every voice', () => {
  for (const id of ['engineer', 'medic', 'crew', 'infected']) {
    for (const emote of EMOTES) {
      const buf = renderUtterance(SR, speakers[id]!, emote, `t:${id}:${emote}`);
      const st = stats(buf);
      assert.ok(Number.isFinite(st.rms), `${id}/${emote} has NaN`);
      assert.ok(st.peak <= 1 && st.peak > 0.3, `${id}/${emote} peak ${st.peak}`);
      assert.ok(st.rms > 0.03, `${id}/${emote} too quiet (rms ${st.rms})`);
    }
  }
});

test('emote durations stay within 0.2-0.9 s', () => {
  for (const p of [giles, okafor, speakers['infected']!]) {
    for (const emote of EMOTES) {
      for (let k = 0; k < 5; k++) {
        const d = emoteTrack(p, emote, new Rng(`d${k}`)).duration;
        assert.ok(d >= EMOTE_MIN_S && d <= EMOTE_MAX_S, `${emote} ${d}`);
      }
    }
  }
});

test('same seed is identical; different line ids vary', () => {
  const a = renderUtterance(SR, giles, 'urgent', 'giles_cover_01');
  const b = renderUtterance(SR, giles, 'urgent', 'giles_cover_01');
  const c = renderUtterance(SR, giles, 'urgent', 'giles_cover_02');
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('pitch contours carry the mood', () => {
  const contour = (emote: (typeof EMOTES)[number]): [number, number] => {
    const t = emoteTrack(giles, emote, new Rng('contour'));
    return [t.pitch(0.1, 0.1 * t.duration), t.pitch(0.95, 0.95 * t.duration)];
  };
  const [qs, qe] = contour('question');
  assert.ok(qe > qs * 1.3, 'question rises');
  const [ns, ne] = contour('neutral');
  assert.ok(ne < ns, 'neutral falls slightly');
  assert.ok(contour('scream')[0] > 1.7, 'scream is high');
  assert.ok(contour('pained')[0] < 1, 'grunt is low');
  assert.equal(emoteTrack(giles, 'whisper', new Rng('w')).voicing(0.5, 0.3), 0, 'whisper is unvoiced');
});

test('squadmates have distinct voices: Giles higher and brighter than Okafor', () => {
  assert.ok(giles.f0 > okafor.f0 * 1.5);
  assert.ok(giles.formants > okafor.formants);
});

test('babble: syllable count tracks text length, questions rise at the end', () => {
  const short = babbleTrack(giles, 'neutral', 'Go.', new Rng('b'));
  const long = babbleTrack(giles, 'neutral', 'Cover me while I get this door open', new Rng('b'));
  assert.ok(long.duration > short.duration * 3);
  const q = babbleTrack(giles, 'neutral', 'Are you okay?', new Rng('q'));
  const flat = babbleTrack(giles, 'neutral', 'Are you okay.', new Rng('q'));
  const end = q.duration - 0.1;
  assert.ok(q.pitch(1, end) > flat.pitch(1, end));
});

test('raised rasp changes the sound (Giles foreshadowing hook)', () => {
  const clean = renderUtterance(SR, giles, 'neutral', 'giles_x');
  const rough = renderUtterance(SR, giles, 'neutral', 'giles_x', { rasp: 0.6 });
  assert.notDeepEqual(clean, rough);
});

test('PA renders a chime regardless of emote', () => {
  const a = renderUtterance(SR, speakers['pa']!, 'urgent', 'pa_1');
  assert.ok(a.length / SR > 1);
});
