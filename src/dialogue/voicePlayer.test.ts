import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AudioEngine } from '../audio/engine.ts';
import { FakePanner, installFakeWebAudio, reaches, type FakeAudioContext, type FakeNode } from '../audio/testing/fakeWebAudio.ts';
import { EventBus } from '../core/events.ts';
import { DialogueLibrary } from './library.ts';
import { SpeechManager } from './speech.ts';
import { WebAudioVoicePlayer } from './voicePlayer.ts';

test('a queued PA resolves its grille once at audible start while local voices track their speakers', t => {
  t.after(installFakeWebAudio());
  const audio = new AudioEngine();
  const ctx = audio.ctx as unknown as FakeAudioContext;
  const wet = audio.voiceReverbIn as unknown as FakeNode;
  const dry = audio.buses.voice as unknown as FakeNode;
  const speakers = JSON.parse(readFileSync(new URL('../data/dialogue/speakers.json', import.meta.url), 'utf8'));
  const lines = ['local', 'pa', 'radio'].map(channel => ({
    id: channel, channel, speaker: channel === 'pa' ? 'pa' : 'engineer', priority: 'story',
    emote: 'neutral', audio: null, choices: [], minDuration: 0, text: 'Testing.',
  }));
  const library = new DialogueLibrary(speakers, { test: { chapter: 'test', lines } });
  const player = new WebAudioVoicePlayer({ ctx: audio.ctx, master: audio.buses.voice, reverbIn: audio.voiceReverbIn });
  const speech = new SpeechManager(new EventBus(), library, player);
  const panners = () => ctx.nodes.filter(n => n instanceof FakePanner);
  let x = 1;
  const at = () => ({ x, y: 2.3, z: 3 });
  speech.say('local', { at });
  let reads = 0;
  speech.say('pa', { at: () => { reads++; return at(); } });
  assert.equal(reads, 0);
  x = 4;
  speech.update(0.2);
  assert.equal(panners()[0]!.positionX.value, 4);
  speech.update(2);
  speech.update(0.3);
  const grille = panners()[1]!;
  assert.equal(grille.positionX.value, 4);
  x = 20;
  speech.update(0.2);
  assert.equal(reads, 1);
  assert.equal(grille.positionX.value, 4);
  assert.ok(reaches(grille, dry) && reaches(grille, wet));
  speech.stopAll();
  const beforeRadio = ctx.nodes.length;
  speech.say('radio', { at });
  speech.update(0.3);
  const radio = ctx.nodes.slice(beforeRadio).find(n => n.kind === 'source')!;
  assert.ok(reaches(radio, dry));
  assert.equal(reaches(radio, wet), false);
  assert.equal(panners().length, 2);
  speech.stopAll();
  const beforeMissing = ctx.nodes.length;
  const missing = speech.say('pa', { at: () => null });
  speech.update(0.3);
  assert.equal(speech.speaking()?.id, missing.id);
  assert.equal(ctx.nodes.length, beforeMissing, 'missing fixture keeps the subtitle without a centred audio source');
});
