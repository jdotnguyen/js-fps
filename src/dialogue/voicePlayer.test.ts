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

// voice-playback "Announcement aboard the train" (fix-r13d-r16-finale).
test('a following PA travels with the listener, across a jump, while a wall PA stays on its grille', t => {
  t.after(installFakeWebAudio());
  const audio = new AudioEngine();
  const ctx = audio.ctx as unknown as FakeAudioContext;
  const speakers = JSON.parse(readFileSync(new URL('../data/dialogue/speakers.json', import.meta.url), 'utf8'));
  // Two speakers, so the overlapping line does not cut the first one off.
  const lines = [['aboard', 'pa'], ['wall', 'engineer']].map(([id, speaker]) => ({
    id, channel: 'pa', speaker, priority: 'story', emote: 'neutral', audio: null, choices: [], minDuration: 4, text: 'Testing.',
  }));
  const library = new DialogueLibrary(speakers, { test: { chapter: 'test', lines } });
  const player = new WebAudioVoicePlayer({ ctx: audio.ctx, master: audio.buses.voice, reverbIn: audio.voiceReverbIn });
  const speech = new SpeechManager(new EventBus(), library, player);
  const listener = { x: 128, y: 2.4, z: 40 };
  const at = () => ({ ...listener });
  speech.say('aboard', { at, follow: true });
  speech.say('wall', { at, overlap: true });
  speech.update(0.1);
  const [aboard, wall] = ctx.nodes.filter(n => n instanceof FakePanner);
  Object.assign(listener, { x: 88, z: 20 });
  speech.update(0.1);
  assert.deepEqual([aboard!.positionX.value, aboard!.positionZ.value], [88, 20], 'overhead after the jump');
  assert.deepEqual([wall!.positionX.value, wall!.positionZ.value], [128, 40], 'the grille does not move');
  speech.stopAll();
});

test('WebAudioVoicePlayer.loadLines prioritizes matching lines, caps concurrency, and stops on dispose', async (t) => {
  t.after(installFakeWebAudio());
  const audio = new AudioEngine();
  const ctx = audio.ctx as unknown as FakeAudioContext;
  (ctx as unknown as { decodeAudioData: (buf: ArrayBuffer) => Promise<AudioBuffer> }).decodeAudioData = async () =>
    ctx.createBuffer(1, 32, ctx.sampleRate) as unknown as AudioBuffer;

  const order: string[] = [];
  let active = 0;
  let maxActive = 0;
  const origFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = origFetch;
  });
  globalThis.fetch = (async (url: string | URL | Request) => {
    active++;
    maxActive = Math.max(maxActive, active);
    order.push(String(url));
    await Promise.resolve();
    active--;
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) } as Response;
  }) as typeof fetch;

  const player = new WebAudioVoicePlayer({ ctx: audio.ctx, master: audio.buses.voice, reverbIn: audio.voiceReverbIn }, { baseUrl: '/' });
  const lines = [
    { id: 'late_01', channel: 'local' as const, speaker: 'engineer', priority: 'story' as const, emote: 'neutral' as const, audio: 'assets/vo/late_01.mp3', choices: [], minDuration: 0, text: 'Late.' },
    { id: 'intro_01', channel: 'local' as const, speaker: 'engineer', priority: 'story' as const, emote: 'neutral' as const, audio: 'assets/vo/intro_01.mp3', choices: [], minDuration: 0, text: 'Intro.' },
    { id: 'intro_02', channel: 'local' as const, speaker: 'engineer', priority: 'story' as const, emote: 'neutral' as const, audio: 'assets/vo/intro_02.mp3', choices: [], minDuration: 0, text: 'Intro 2.' },
  ];

  const count = await player.loadLines(lines, { concurrency: 1, idle: true, priority: (l) => l.id.startsWith('intro_') });
  assert.equal(count, 3);
  assert.equal(maxActive, 1);
  assert.deepEqual(order, ['/assets/vo/intro_01.mp3', '/assets/vo/intro_02.mp3', '/assets/vo/late_01.mp3']);
  assert.ok(player.hasRecorded(lines[1]!));

  player.dispose();
  assert.equal(player.hasRecorded(lines[1]!), false, 'dispose releases recorded VO buffers');
});
