import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelFromSamples, traceClips, tracedEntries, type TraceClip, type TraceWav } from './voTrace.ts';

const T0 = Date.parse('2026-11-19T22:00:00Z');
const min = (m: number): number => T0 + m * 60_000;
/** A sample count with the given model's signature. */
const samples = (mod: number): number => 480 * 1000 + mod;

// One 11-19 run: 2.5-flash until its quota ran out, then 3.1.
const wavs: TraceWav[] = [
  { name: 'vo_engineer_01', mtimeMs: min(16), samples: samples(263), speakers: ['engineer'] },
  { name: 'vo_medic_03', mtimeMs: min(27), samples: samples(263), speakers: ['medic'] },
  { name: 'vo_player_01', mtimeMs: min(58), samples: samples(0), speakers: ['player'] },
  { name: 'vo_medic_01', mtimeMs: min(60), samples: samples(0), speakers: ['medic'] },
];

test('trace: signatures map to models', () => {
  assert.equal(modelFromSamples(768263), 'gemini-2.5-flash-preview-tts');
  assert.equal(modelFromSamples(1010880), 'gemini-3.1-flash-tts-preview');
  assert.equal(modelFromSamples(89294), 'gemini-3.8-flash-tts');
  assert.equal(modelFromSamples(481), null);
});

test('trace: a clip written just after its batch WAV is a direct match on that WAV\'s model', () => {
  const clips: TraceClip[] = [
    { id: 'bark_spotted_01', speaker: 'engineer', mtimeMs: min(16) + 100 },
    { id: 'bark_reload_01', speaker: 'engineer', mtimeMs: min(16) + 300 },
    { id: 'contact_okafor_01', speaker: 'medic', mtimeMs: min(60) + 200 },
  ];
  const traced = traceClips(wavs, clips);
  assert.deepEqual(traced.map((t) => [t.id, t.batch, t.model, t.confidence]), [
    ['bark_spotted_01', 'vo_engineer_01', 'gemini-2.5-flash-preview-tts', 'direct'],
    ['bark_reload_01', 'vo_engineer_01', 'gemini-2.5-flash-preview-tts', 'direct'],
    ['contact_okafor_01', 'vo_medic_01', 'gemini-3.1-flash-tts-preview', 'direct'],
  ]);
});

test('trace: a WAV for another speaker is never a direct match', () => {
  const [t] = traceClips(wavs, [{ id: 'intro_jay_01', speaker: 'player', mtimeMs: min(60) + 200 }]);
  assert.notEqual(t!.batch, 'vo_medic_01');
});

test('trace: a clip whose WAV was overwritten takes its neighbours\' model when they agree', () => {
  // Okafor's barks from the first vo_medic_01, whose WAV the 3.1 rerun overwrote.
  const [t] = traceClips(wavs, [{ id: 'bark_spotted_02', speaker: 'medic', mtimeMs: min(26) }]);
  assert.equal(t!.confidence, 'inferred');
  assert.equal(t!.model, 'gemini-2.5-flash-preview-tts');
});

test('trace: a clip between WAVs on different models is flagged, not guessed', () => {
  const [t] = traceClips(wavs, [{ id: 'mystery_01', speaker: 'medic', mtimeMs: min(40) }]);
  assert.equal(t!.confidence, 'flagged');
  assert.equal(t!.model, null);
  assert.match(t!.reason, /disagree/);
});

test('trace: a clip with no WAV on one side is flagged', () => {
  const [t] = traceClips(wavs, [{ id: 'late_01', speaker: 'medic', mtimeMs: min(200) }]);
  assert.equal(t!.confidence, 'flagged');
});

test('trace: entries group a direct batch and a run of inferred clips, and skip flagged ones', () => {
  const clips: TraceClip[] = [
    { id: 'bark_spotted_01', speaker: 'engineer', mtimeMs: min(16) + 100 },
    { id: 'bark_reload_01', speaker: 'engineer', mtimeMs: min(16) + 300 },
    { id: 'bark_spotted_02', speaker: 'medic', mtimeMs: min(26) },
    { id: 'bark_spotted_04', speaker: 'medic', mtimeMs: min(26) + 200 },
    { id: 'mystery_01', speaker: 'medic', mtimeMs: min(40) },
  ];
  const entries = tracedEntries(traceClips(wavs, clips), clips, (sp) => (sp === 'medic' ? 'Charon' : 'Algenib'));
  assert.deepEqual(entries.map((e) => [e.batch.startsWith('unknown@') ? 'unknown' : e.batch, e.lines, e.model, e.confidence]), [
    ['vo_engineer_01', ['bark_spotted_01', 'bark_reload_01'], 'gemini-2.5-flash-preview-tts', 'direct'],
    ['unknown', ['bark_spotted_02', 'bark_spotted_04'], 'gemini-2.5-flash-preview-tts', 'inferred'],
  ]);
  assert.deepEqual(entries[1]!.voices, ['Charon']);
});
