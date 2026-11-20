import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../core/events.ts';
import { npcIdForSpeaker, wireSpeechActing } from './speakerBodies.ts';
import type { Humanoid } from '../actors/humanoid.ts';
import '../dialogue/speech.ts';

test('speakers map to the NPCs that say their lines', () => {
  assert.equal(npcIdForSpeaker('engineer'), 'giles');
  assert.equal(npcIdForSpeaker('medic'), 'okafor');
  assert.equal(npcIdForSpeaker('nurse'), 'priya');
  assert.equal(npcIdForSpeaker('chief'), 'heins');
  assert.equal(npcIdForSpeaker('crew_cook'), 'cook');
  assert.equal(npcIdForSpeaker('crew_lab'), 'researcher_b', 'Voss says her own lines behind the Lab B glass (drop_voss_01)');
  for (const s of ['player', 'pa', 'director', 'infected', 'crew']) assert.equal(npcIdForSpeaker(s), null, s);
});

test('a started line makes its speaker act it, and any ending stops it', () => {
  const bus = new EventBus();
  const calls: string[] = [];
  const body = {
    speak: (text: string, emote: string | null, duration: number, seed: string) => calls.push(`speak ${text}|${emote}|${duration}|${seed}`),
    stopSpeaking: () => calls.push('stop'),
  } as unknown as Humanoid;
  const off = wireSpeechActing(bus, (speaker) => (speaker === 'engineer' ? body : null));
  bus.emit('speech:started', { id: 'l1', speaker: 'engineer', name: 'Giles', text: 'Cover me!', emote: 'urgent', channel: 'local', priority: 'story', duration: 2 });
  bus.emit('speech:started', { id: 'l2', speaker: 'player', name: 'Jay', text: 'Fine.', emote: 'neutral', channel: 'local', priority: 'story', duration: 1 });
  bus.emit('speech:ended', { id: 'l1', speaker: 'engineer', reason: 'interrupted' });
  bus.emit('speech:ended', { id: 'l2', speaker: 'player', reason: 'finished' });
  assert.deepEqual(calls, ['speak Cover me!|urgent|2|l1', 'stop']);
  off();
  bus.emit('speech:started', { id: 'l3', speaker: 'engineer', name: 'Giles', text: 'x', emote: null, channel: 'local', priority: 'story', duration: 1 });
  assert.equal(calls.length, 2, 'unsubscribed');
});
