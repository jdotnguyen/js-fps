import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { AudioEngine } from '../audio/engine.ts';
import { installFakeWebAudio, pathGain, reaches, type FakeAudioContext, type FakeNode } from '../audio/testing/fakeWebAudio.ts';
import { EventBus } from '../core/events.ts';
import { DialogueLibrary } from './library.ts';
import { LOCAL_VOICE_REF_M, MAX_PROJECTION_GAIN, projectionGain } from './projection.ts';
import { SpeechManager, SUBTITLE_RANGE_M, type Hearing } from './speech.ts';
import { WebAudioVoicePlayer } from './voicePlayer.ts';

// voice-playback: "A scene can project a voice", "Voices on a live intercom" (overhaul-priya-r08-death D25, D28).

const speakers = JSON.parse(readFileSync(new URL('../data/dialogue/speakers.json', import.meta.url), 'utf8'));
const line = (id: string, speaker: string) => ({ id, channel: 'local', speaker, priority: 'story', emote: 'neutral', audio: null, choices: [], minDuration: 0, text: 'Testing.' });

/** The level a local voice reaches the player at `d` m with nothing in the way (inverse model, ref 1.5 m, rolloff 1). */
const fall = (d: number): number => (d <= LOCAL_VOICE_REF_M ? 1 : LOCAL_VOICE_REF_M / d);

test('Across the room: a voice projected at 3.5 m is as loud 7 m away as an ordinary voice at 3.5 m', () => {
  assert.ok(Math.abs(fall(7) * projectionGain(7, 3.5) - fall(3.5)) < 1e-9);
  assert.ok(Math.abs(fall(12) * projectionGain(12, 3.5) - fall(3.5)) < 1e-9);
  assert.ok(projectionGain(200, 3.5) <= MAX_PROJECTION_GAIN, 'capped');
});

test('Nearer than the set distance: a projected voice 1 m away plays as an ordinary line from 1 m', () => {
  assert.equal(projectionGain(1, 3.5), 1);
  assert.equal(projectionGain(3.5, 3.5), 1);
  assert.equal(projectionGain(5, 0), 1, 'no projection');
});

test('a projected voice above unity reaches the voice bus at that gain (the player lets audibility exceed 1)', (t) => {
  t.after(installFakeWebAudio());
  const audio = new AudioEngine();
  const ctx = audio.ctx as unknown as FakeAudioContext;
  const library = new DialogueLibrary(speakers, { test: { chapter: 'test', lines: [line('ok', 'medic')] } });
  const player = new WebAudioVoicePlayer({ ctx: audio.ctx, master: audio.buses.voice, reverbIn: audio.voiceReverbIn });
  const before = ctx.nodes.length;
  const pb = player.play({ line: library.line('ok'), profile: library.speaker('medic'), at: () => ({ x: 7, y: 1.7, z: 0 }), rasp: null, babble: false });
  const src = ctx.nodes.slice(before).find((n) => n.kind === 'source')!;
  pb.setAudibility!(projectionGain(7, 3.5), 20000);
  assert.ok(Math.abs(pathGain(src, audio.buses.voice as unknown as FakeNode) - 2) < 1e-9);
});

test('Priya over the intercom: a local voice in a live intercom room is also played into the intercom', (t) => {
  t.after(installFakeWebAudio());
  const audio = new AudioEngine();
  const ctx = audio.ctx as unknown as FakeAudioContext;
  audio.addIntercom('medbay', new THREE.Vector3(-1.4, 1.9, 38.3), (p) => p.z > 46);
  const library = new DialogueLibrary(speakers, { test: { chapter: 'test', lines: [line('p', 'nurse')] } });
  const player = new WebAudioVoicePlayer({ ctx: audio.ctx, master: audio.buses.voice, reverbIn: audio.voiceReverbIn });
  const tap = new THREE.Vector3();
  player.setIntercomTap((p) => audio.intercomInputs(tap.set(p.x, p.y, p.z)));
  const input = audio.intercom('medbay')!.input as unknown as FakeNode;
  const say = (): FakeNode => {
    const before = ctx.nodes.length;
    player.play({ line: library.line('p'), profile: library.speaker('nurse'), at: () => ({ x: -4, y: 1.5, z: 49.5 }), rasp: null, babble: false });
    return ctx.nodes.slice(before).find((n) => n.kind === 'source')!;
  };
  assert.equal(reaches(say(), input), false, 'before the switch: only through the glass');
  audio.setIntercom('medbay', true);
  const live = say();
  assert.ok(reaches(live, input), 'after the switch: also on the intercom');
  assert.ok(reaches(live, audio.buses.voice as unknown as FakeNode), 'and still heard directly');
});

test('From the armory doorway: a relayed line shows its subtitle and counts as heard, however far the speaker is', () => {
  const bus = new EventBus();
  const library = new DialogueLibrary(speakers, { test: { chapter: 'test', lines: [line('p', 'nurse')] } });
  let relayed = false;
  const hearing = (): Hearing => ({ gain: 0.1, cutoffHz: 900, distance: SUBTITLE_RANGE_M + 5, audible: false, ...(relayed ? { relayed } : {}) });
  const shown: string[] = [];
  bus.on('subtitle:show', ({ id }) => shown.push(id));
  const sm = new SpeechManager(bus, library, { play: () => ({ duration: 2, stop: () => {} }) }, { hearing });
  sm.say('p', { at: () => ({ x: 0, y: 0, z: 0 }) });
  sm.update(0.1);
  assert.deepEqual(shown, [], 'out of earshot and not relayed: no subtitle');
  sm.stopAll();
  relayed = true;
  sm.say('p', { at: () => ({ x: 0, y: 0, z: 0 }) });
  sm.update(0.1);
  assert.deepEqual(shown, ['p']);
});
