import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventBus } from '../core/events.ts';
import { DialogueLibrary } from './library.ts';
import { SpeechManager, type Hearing, type VoicePlayer } from './speech.ts';

// Lines of 3 words -> 1.85 s each (no recordings in these tests).
const speakers: unknown = JSON.parse(readFileSync(new URL('../data/dialogue/speakers.json', import.meta.url), 'utf8'));
const L = (id: string, speaker: string, priority = 'story', channel = 'local'): Record<string, unknown> => ({
  id, speaker, text: 'One two three.', emote: 'neutral', channel, priority, audio: null, minDuration: 1, choices: [],
});
const library = new DialogueLibrary(speakers, {
  't.json': {
    chapter: 't',
    lines: [
      L('hale_1', 'director'), L('hale_2', 'director'), L('jay_hale', 'player'),
      L('sung_1', 'crew_sung'), L('sung_2', 'crew_sung'), L('sung_stow', 'crew_sung'), L('jay_sung', 'player'),
      L('jay_alone', 'player'), L('bark', 'medic', 'idle'), L('hint', 'medic', 'hint'),
      L('brief', 'director', 'story', 'radio'),
    ],
  },
});

/** Where each speaker is, as the hearing function sees it: metres away and whether audible. */
type Spot = { distance: number; audible: boolean };

function setup(spots: Record<string, Spot> = {}) {
  const bus = new EventBus();
  const log: string[] = [];
  const subs = new Set<string>();
  const levels: Array<[string, number]> = [];
  const player: VoicePlayer = {
    play: (req) => ({ stop: () => undefined, setAudibility: (g) => levels.push([req.line.id, g]) }),
  };
  const hearing = (line: { speaker: string; channel: string }): Hearing => {
    const s = spots[line.speaker];
    if (line.channel !== 'local' || line.speaker === 'player' || !s) return 'everywhere';
    return { gain: s.audible ? 0.5 : 0, cutoffHz: 2500, distance: s.distance, audible: s.audible };
  };
  bus.on('speech:started', (e) => log.push(`start ${e.id}`));
  bus.on('speech:ended', (e) => log.push(`end ${e.id} ${e.reason}`));
  bus.on('speech:dropped', (e) => log.push(`drop ${e.id}`));
  bus.on('subtitle:show', (e) => subs.add(e.id));
  bus.on('subtitle:hide', (e) => subs.delete(e.id));
  const sm = new SpeechManager(bus, library, player, { hearing: (line) => hearing(line) });
  return { sm, log, subs, levels, spots };
}
const run = (sm: SpeechManager, seconds: number, step = 0.05): void => {
  for (let t = 0; t < seconds - 1e-9; t += step) sm.update(step);
};

test('two conversations play at once: Sung starts on cue while Hale is mid-scene elsewhere', () => {
  const { sm, log } = setup({ director: { distance: 60, audible: false }, crew_sung: { distance: 3, audible: true } });
  sm.say('hale_1', { channel: 'admin' });
  sm.say('sung_1', { channel: 'dive' });
  assert.deepEqual(log, ['start hale_1', 'start sung_1']);
});

test('one channel keeps its order with a short breath between lines', () => {
  const { sm, log } = setup();
  sm.say('sung_1', { channel: 'dive' });
  sm.say('jay_sung', { channel: 'dive' });
  run(sm, 1.9);
  assert.deepEqual(log, ['start sung_1', 'end sung_1 finished']);
  run(sm, 0.15);
  assert.deepEqual(log.at(-1), 'start jay_sung');
});

test('a speaker never talks over themself: the stow line waits for Sung, then his scene carries on', () => {
  const { sm, log } = setup();
  sm.say('sung_1', { channel: 'dive' });
  run(sm, 0.5);
  sm.say('sung_stow', { channel: 'stow' });
  assert.deepEqual(log, ['start sung_1'], 'waits for his current line');
  run(sm, 1.4);
  assert.deepEqual(log, ['start sung_1', 'end sung_1 finished', 'start sung_stow']);
  sm.say('sung_2', { channel: 'dive' });
  run(sm, 1);
  assert.equal(log.at(-1), 'start sung_stow', 'his scene waits while he speaks the stow line');
  run(sm, 1.2);
  assert.ok(log.includes('start sung_2'));
});

test('Jay answers the conversation he can hear: far away his line is dropped and the scene carries on', async () => {
  const { sm, log } = setup({ director: { distance: 40, audible: false } });
  sm.say('hale_1', { channel: 'admin' });
  run(sm, 2.1);
  const jay = sm.say('jay_hale', { channel: 'admin' });
  assert.equal(await jay.done, 'dropped');
  sm.say('hale_2', { channel: 'admin' });
  run(sm, 0.2);
  assert.equal(log.at(-1), 'start hale_2');
});

test('Jay still speaks in a conversation he can hear, and alone', async () => {
  const { sm, log } = setup({ crew_sung: { distance: 3, audible: true } });
  sm.say('sung_1', { channel: 'dive' });
  run(sm, 2.1);
  sm.say('jay_sung', { channel: 'dive' });
  assert.equal(log.at(-1), 'start jay_sung');
  sm.say('jay_alone', { channel: 'thoughts' });
  run(sm, 2.1);
  assert.ok(log.includes('start jay_alone'), 'a monologue has nobody to be out of earshot');
});

test('a hint plays during a far-off scene; a bark waits for a nearby one and is dropped after 2 s', async () => {
  const far = setup({ director: { distance: 60, audible: false } });
  far.sm.say('hale_1', { channel: 'admin' });
  far.sm.say('hint', { channel: 'ambient' });
  assert.equal(far.log.at(-1), 'start hint');

  const near = setup({ crew_sung: { distance: 3, audible: true } });
  near.sm.say('sung_1', { channel: 'dive' });
  const bark = near.sm.say('bark', { channel: 'ambient' });
  run(near.sm, 1.9);
  assert.ok(!near.log.includes('start bark'), 'not even in the breath after his line');
  near.sm.say('sung_2', { channel: 'dive' });
  run(near.sm, 0.3);
  assert.equal(await bark.done, 'dropped');
  assert.ok(!near.log.includes('start bark'));
});

test('a story line starting in earshot cuts off a bark the player can hear', () => {
  const { sm, log } = setup({ crew_sung: { distance: 3, audible: true } });
  sm.say('bark', { channel: 'ambient' });
  sm.say('sung_1', { channel: 'dive' });
  assert.deepEqual(log, ['start bark', 'end bark interrupted', 'start sung_1']);
});

test('subtitles follow earshot: hidden far away, shown on walking in, hidden on walking out, hidden when sealed off', () => {
  const { sm, subs, spots, levels } = setup({ crew_sung: { distance: 25, audible: true } });
  sm.say('sung_1', { channel: 'dive' });
  assert.equal(subs.has('sung_1'), false, '25 m away: no subtitle');
  spots.crew_sung = { distance: 12, audible: true };
  run(sm, 0.1);
  assert.equal(subs.has('sung_1'), true, 'walked within 20 m');
  spots.crew_sung = { distance: 12, audible: false };
  run(sm, 0.1);
  assert.equal(subs.has('sung_1'), false, 'close but silent behind walls');
  assert.ok(levels.some(([id, g]) => id === 'sung_1' && g === 0), 'the voice was muted');
});

test('radio subtitles show wherever the player is', () => {
  const { sm, subs } = setup({ director: { distance: 200, audible: false } });
  sm.say('brief', { channel: 'briefing' });
  assert.equal(subs.has('brief'), true);
});

test('stopAll and onlySpeakers act on every channel', async () => {
  const { sm } = setup();
  const a = sm.say('hale_1', { channel: 'admin' });
  const b = sm.say('sung_1', { channel: 'dive' });
  const q = sm.say('sung_2', { channel: 'dive' });
  sm.onlySpeakers(['director']);
  assert.equal(await b.done, 'stopped');
  assert.equal(await q.done, 'stopped');
  sm.stopAll();
  assert.equal(await a.done, 'stopped');
  assert.equal(sm.speaking(), null);
});

test('stopChannel ends a conversation on the spot: the line stops, its subtitle hides, the queue is dropped, other scenes play on', async () => {
  const { sm, log, subs } = setup({ director: { distance: 3, audible: true }, crew_sung: { distance: 3, audible: true } });
  sm.say('hale_1', { channel: 'admin' });
  const jay = sm.say('jay_hale', { channel: 'admin' });
  const next = sm.say('hale_2', { channel: 'admin' });
  sm.say('sung_1', { channel: 'dive' });
  run(sm, 0.5);
  assert.ok(subs.has('hale_1'));
  sm.stopChannel('admin');
  assert.ok(!subs.has('hale_1'), 'the subtitle hides');
  assert.ok(log.includes('end hale_1 stopped'));
  assert.equal(await jay.done, 'stopped');
  assert.equal(await next.done, 'stopped');
  run(sm, 6);
  assert.ok(!log.includes('start jay_hale') && !log.includes('start hale_2'), 'nothing of the scene plays afterwards');
  assert.ok(log.includes('end sung_1 finished'), 'the other conversation carries on');
  sm.stopChannel('admin');
  sm.stopChannel('never_used');
});
