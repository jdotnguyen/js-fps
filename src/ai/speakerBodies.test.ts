import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../core/events.ts';
import { npcCandidatesForSpeaker, npcIdForSpeaker, wireListenLook, wireSpeechActing } from './speakerBodies.ts';
import type { Humanoid } from '../actors/humanoid.ts';
import '../dialogue/speech.ts';
import { readLevel } from '../data/levels/readLevel.ts';

test('speakers map to the NPCs that say their lines', () => {
  assert.equal(npcIdForSpeaker('engineer'), 'giles');
  assert.equal(npcIdForSpeaker('medic'), 'okafor');
  assert.equal(npcIdForSpeaker('nurse'), 'priya');
  assert.equal(npcIdForSpeaker('chief'), 'heins');
  assert.equal(npcIdForSpeaker('crew_cook'), 'cook');
  assert.equal(npcIdForSpeaker('crew_lab'), 'researcher_b', 'Voss says her own lines behind the Lab B glass (drop_voss_01)');
  assert.equal(npcIdForSpeaker('director'), 'hale', 'Hale says his office lines from his own head');
  assert.equal(npcIdForSpeaker('crew_maint'), 'maint_1');
  assert.deepEqual(npcCandidatesForSpeaker('crew_botanist'), ['botanist_1', 'botanist_2', 'botanist_3']);
  assert.deepEqual(npcCandidatesForSpeaker('crew_sung'), ['sung']);
  for (const s of ['player', 'pa', 'infected', 'crew']) assert.equal(npcIdForSpeaker(s), null, s);
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

test('every local line in slice01 has a body to speak from, or a deliberately disembodied speaker (voice-playback)', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const { DISEMBODIED } = await import('./speakerBodies.ts');
  const json = (rel: string): unknown => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
  const level = readLevel('slice01') as { rooms: Array<{ npcs?: Array<{ id: string }> }> };
  const npcIds = new Set(level.rooms.flatMap((r) => (r.npcs ?? []).map((n) => n.id)));
  const missing: string[] = [];
  for (const file of readdirSync(new URL('../data/dialogue/', import.meta.url))) {
    const data = json(`../data/dialogue/${file}`) as { lines?: Array<{ id: string; speaker: string; channel: string }> };
    for (const line of data.lines ?? []) {
      if (line.channel !== 'local' || DISEMBODIED.has(line.speaker)) continue;
      if (!npcCandidatesForSpeaker(line.speaker).some((id) => npcIds.has(id))) missing.push(`${line.id} (${line.speaker})`);
    }
  }
  assert.deepEqual(missing, [], `local lines whose speaker has no NPC in slice01: ${missing.join(', ')}`);
});

test('a background line turns no bystander, while its speaker still acts it', () => {
  const bus = new EventBus();
  const calls: string[] = [];
  const body = {
    speak: (text: string) => calls.push(`speak ${text}`),
    stopSpeaking: () => calls.push('stop'),
  } as unknown as Humanoid;
  wireSpeechActing(bus, () => body);
  const looks: string[] = [];
  wireListenLook(
    bus,
    { has: () => true, lineStarted: (s) => looks.push(`started ${s}`), lineEnded: (s) => looks.push(`ended ${s}`) },
    (speaker) => npcIdForSpeaker(speaker),
    () => null,
  );
  const line = { id: 'bg', speaker: 'crew_bar_1', name: 'Crew', text: 'So?', emote: 'neutral' as const, channel: 'local' as const, priority: 'background' as const, duration: 1 };
  bus.emit('speech:started', line);
  assert.deepEqual(looks, [], 'nobody is turned');
  assert.deepEqual(calls, ['speak So?']);
  bus.emit('speech:started', { ...line, id: 's', speaker: 'engineer', priority: 'story' });
  assert.deepEqual(looks, ['started giles'], 'other lines turn people as before');
});
