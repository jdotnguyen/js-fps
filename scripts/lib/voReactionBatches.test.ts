import { test } from 'node:test';
import assert from 'node:assert/strict';
import { castFor } from './voCast.ts';
import { CREDITED_REACTION_CLIPS, REACTION_BATCHES, reactionVoice } from './voReactionBatches.ts';

test('reactions: each batch takes its voice and model from its speaker', () => {
  for (const b of REACTION_BATCHES) {
    const c = castFor(b.speaker);
    assert.deepEqual(reactionVoice(b), { voice: c.voice, model: c.model }, b.name);
  }
  const voss = REACTION_BATCHES.find((b) => b.name === 'react_voss_panic')!;
  assert.deepEqual(reactionVoice(voss), { voice: 'Leda', model: 'gemini-3.8-flash-tts' });
  const jay = REACTION_BATCHES.find((b) => b.speaker === 'player')!;
  assert.equal(reactionVoice(jay).model, 'gemini-3.1-flash-tts-preview');
});

test('reactions: no batch writes over a credited recording', () => {
  const written = new Set(REACTION_BATCHES.flatMap((b) => b.takes.map((t) => t.id)));
  for (const id of CREDITED_REACTION_CLIPS) assert.ok(!written.has(id), `${id} is a credited recording`);
});

test('reactions: batch names and take ids are unique', () => {
  const names = REACTION_BATCHES.map((b) => b.name);
  assert.equal(new Set(names).size, names.length);
  const takes = REACTION_BATCHES.flatMap((b) => b.takes.map((t) => t.id));
  assert.equal(new Set(takes).size, takes.length);
});

test('reactions: screams and cries have no TTS batch (TTS does not do screams)', () => {
  assert.ok(!REACTION_BATCHES.some((b) => b.takes.some((t) => /scream|cry|cutoff|scare/.test(t.id))));
  for (const id of ['react_giles_cry_01', 'react_giles_cry_02', 'react_giles_cry_03']) assert.ok(CREDITED_REACTION_CLIPS.includes(id), id);
});
