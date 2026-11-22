import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeWebAudio, pathGain, reaches, type FakeAudioContext, type FakeNode } from '../audio/testing/fakeWebAudio.ts';
import { DialogueLibrary } from './library.ts';
import { WebAudioVoicePlayer } from './voicePlayer.ts';

const speakers = JSON.parse(readFileSync(new URL('../data/dialogue/speakers.json', import.meta.url), 'utf8'));
const lineOf = (id: string, channel: string, speaker: string) => ({ id, channel, speaker, priority: 'story', emote: 'neutral', audio: null, choices: [], minDuration: 0, text: 'Testing.' });

/** A fake context with a dry voice bus and a room reverb input, as the engine gives dialogue. */
function rig(lines: unknown[]) {
  const ctx = new AudioContext() as unknown as FakeAudioContext;
  const dry = new GainNode(ctx as unknown as AudioContext);
  const wet = new GainNode(ctx as unknown as AudioContext);
  const library = new DialogueLibrary(speakers, { test: { chapter: 'test', lines } });
  const player = new WebAudioVoicePlayer({ ctx: ctx as unknown as AudioContext, master: dry, reverbIn: wet });
  return { ctx, dry: dry as unknown as FakeNode, wet: wet as unknown as FakeNode, library, player };
}

test('a local voice takes its propagation gain and tone, and a muted voice sends no reverb (voice-playback)', (t) => {
  t.after(installFakeWebAudio());
  const { ctx, dry, wet, library, player } = rig([lineOf('l', 'local', 'engineer')]);
  const before = ctx.nodes.length;
  const playback = player.play({ line: library.line('l'), profile: library.speaker('engineer'), at: () => ({ x: 30, y: 1.6, z: 0 }), rasp: null, babble: false });
  const src = ctx.nodes.slice(before).find((n) => n.kind === 'source')!;
  const lowpass = ctx.nodes.slice(before).filter((n) => n.kind === 'biquad').at(-1) as unknown as { frequency: { value: number } };
  assert.ok(reaches(src, dry) && reaches(src, wet));
  assert.equal(pathGain(src, dry), 1, 'nothing in the way: full level');
  assert.equal(lowpass.frequency.value, 20000);

  playback.setAudibility!(0.25, 520);
  assert.equal(pathGain(src, dry), 0.25);
  assert.equal(lowpass.frequency.value, 520);

  playback.setAudibility!(0, 520);
  assert.equal(pathGain(src, dry), 0);
  assert.equal(pathGain(src, wet), 0, 'a silent voice puts nothing into the room reverb');

  playback.setAudibility!(1, Infinity);
  assert.equal(lowpass.frequency.value, 20000, 'an open path clears the tone');
  playback.stop(false);
});

test('radio lines ignore propagation: comms reach the player wherever they are', (t) => {
  t.after(installFakeWebAudio());
  const { library, player } = rig([lineOf('radio', 'radio', 'director')]);
  const line = library.line('radio');
  const playback = player.play({ line, profile: library.speaker(line.speaker), at: () => ({ x: 3, y: 2, z: 0 }), rasp: null, babble: false });
  assert.doesNotThrow(() => playback.setAudibility?.(0, 520));
  playback.stop(false);
});
