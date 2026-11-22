import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DialogueChapter } from '../../src/data/types/dialogue.ts';
import { idsBatches } from './voBatches.ts';
import { batchModel, CAST, castFor, promptProfile } from './voCast.ts';

const DIALOGUE_DIR = join(import.meta.dirname, '../../src/data/dialogue');
const chapterLines = readdirSync(DIALOGUE_DIR)
  .filter((f) => f.endsWith('.json') && f !== 'speakers.json' && f !== 'ui.json')
  .flatMap((f) => (JSON.parse(readFileSync(join(DIALOGUE_DIR, f), 'utf8')) as DialogueChapter).lines);

test('cast: every speaker in the dialogue has a voice and a pinned model', () => {
  const speakers = new Set(chapterLines.map((l) => l.speaker));
  for (const sp of speakers) {
    const c = CAST[sp];
    assert.ok(c, `no cast entry for ${sp}`);
    assert.ok(c.voice.length > 0, `${sp} has no voice`);
    assert.match(c.model, /^gemini-[\d.]+-flash(-preview)?-tts|^gemini-[\d.]+-flash-tts(-preview)?$/, `${sp} has no valid model`);
  }
});

test('cast: reference models are the ones decided in pin-tts-model-per-speaker', () => {
  assert.equal(castFor('engineer').model, 'gemini-2.5-flash-preview-tts');
  assert.equal(castFor('medic').model, 'gemini-2.5-flash-preview-tts');
  for (const sp of ['player', 'nurse', 'crew_cook', 'crew_dock_guard']) assert.equal(castFor(sp).model, 'gemini-3.1-flash-tts-preview', sp);
  for (const sp of ['crew_mess', 'crew_maint', 'crew_assistant', 'crew_lab']) assert.equal(castFor(sp).model, 'gemini-3.8-flash-tts', sp);
});

test('cast: a speaker with no cast entry fails with an error naming them, before any batch is planned', () => {
  assert.throws(() => castFor('crew_new_guy'), /crew_new_guy/);
  const byId = new Map([['new_01', { id: 'new_01', speaker: 'crew_new_guy', text: 'Hello.', emote: 'neutral' as const }]]);
  assert.throws(() => idsBatches(byId as never, ['new_01'], 14), /crew_new_guy/);
});

test('cast: one batch cannot mix models', () => {
  assert.equal(batchModel(['engineer', 'medic']), 'gemini-2.5-flash-preview-tts');
  assert.throws(() => batchModel(['crew_ruiz', 'crew_assistant']), /different models/);
});

test('cast: a pinned accent goes into the prompt profile; speakers without one are unchanged', () => {
  assert.equal(castFor('chief').accent, 'General American');
  assert.match(promptProfile('chief'), /General American accent on every line/);
  assert.ok(promptProfile('chief').startsWith(castFor('chief').profile));
  assert.equal(promptProfile('crew_mess'), castFor('crew_mess').profile);
});
