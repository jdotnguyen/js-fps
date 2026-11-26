import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { EventBus } from '../core/events.ts';
import { roomContains } from '../data/types/level.ts';
import { DialogueLibrary } from '../dialogue/library.ts';
import { SpeechManager, type VoicePlayer } from '../dialogue/speech.ts';
import type { SequenceHost } from './host.ts';
import { SequenceManager } from './runtime.ts';
import { validateSequences } from './schema.ts';
import type { Flags } from './types.ts';
import { readLevel } from '../data/levels/readLevel.ts';

// scene-presence spec: a scene tied to a room ends for everyone when the player leaves it.

const speakers: unknown = JSON.parse(readFileSync(new URL('../data/dialogue/speakers.json', import.meta.url), 'utf8'));
const L = (id: string, speaker: string): Record<string, unknown> => ({
  id, speaker, text: 'One two three.', emote: 'neutral', channel: 'local', priority: 'story', audio: null, minDuration: 1, choices: [],
});
const library = new DialogueLibrary(speakers, {
  't.json': { chapter: 't', lines: [L('hale_1', 'director'), L('jay_1', 'player'), L('hale_2', 'director'), L('sung_1', 'crew_sung')] },
});

const SCENE = [
  { do: 'npcAnim', npc: 'hale', anim: 'talk_gesture', wait: false },
  { do: 'npcLookAt', npc: 'hale', target: 'player' },
  { do: 'say', line: 'hale_1' },
  { do: 'say', line: 'jay_1' },
  { do: 'say', line: 'hale_2' },
  { do: 'setFlag', flag: 'scene_finished', value: true },
];

function setup(def: Record<string, unknown> = {}) {
  const speechBus = new EventBus();
  const log: string[] = [];
  const subs = new Set<string>();
  const voice: VoicePlayer = { play: () => ({ stop: () => undefined }) };
  speechBus.on('speech:started', (e) => log.push(`start ${e.id}`));
  speechBus.on('speech:ended', (e) => log.push(`end ${e.id} ${e.reason}`));
  speechBus.on('subtitle:show', (e) => subs.add(e.id));
  speechBus.on('subtitle:hide', (e) => subs.delete(e.id));
  const speech = new SpeechManager(speechBus, library, voice);

  // `at` set: the player stands in that room (a scene bound to several rooms); otherwise `inside` answers for R14c.
  const state: { inside: boolean; at: string | null } = { inside: true, at: null };
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  const ended: Array<{ id: string; cancelled: boolean }> = [];
  const released: string[][] = [];
  const events: SequenceHost['events'] = {
    on(name, fn) {
      const set = handlers.get(name) ?? new Set();
      handlers.set(name, set);
      set.add(fn);
      return () => set.delete(fn);
    },
    emit(name, payload) {
      for (const fn of [...(handlers.get(name) ?? [])]) fn(payload);
    },
  };
  events.on('sequence:ended', (p) => {
    const e = p as { id: string; cancelled: boolean };
    ended.push({ id: e.id, cancelled: e.cancelled });
  });
  const host: SequenceHost = {
    events,
    flags: {} as Flags,
    resolve: () => ({ x: 0, y: 0, z: 0 }),
    warn: (m) => log.push(`warn ${m}`),
    npc: () => undefined,
    say: (line, opts) => speech.say(line, opts),
    stopSpeech: () => speech.stopAll(),
    stopSceneSpeech: (id) => speech.stopChannels((c) => c === `seq:${id}` || c.startsWith(`seq:${id}:`), true),
    releaseNpcs: (ids) => void released.push([...ids]),
    inRoom: (who, room) => {
      assert.equal(who, 'player');
      if (state.at !== null) return room === state.at;
      assert.equal(room, 'R14c');
      return state.inside;
    },
  };
  const defs = validateSequences({ 'test.json': [{ id: 'scene', steps: SCENE, ...def }] });
  const m = new SequenceManager(host, defs);
  const tick = async (s: number): Promise<void> => {
    for (let t = 0; t < s - 1e-9; t += 0.05) {
      speech.update(0.05);
      m.update(0.05);
      await Promise.resolve();
      await Promise.resolve();
    }
  };
  return { m, host, state, log, subs, ended, released, tick, fire: (name: string) => events.emit(name, {}) };
}

test('the room field validates: a level room id, nothing else', () => {
  assert.equal(validateSequences({ 'a.json': [{ id: 'a', room: 'R14c', steps: [] }] })[0]!.room, 'R14c');
  assert.equal(validateSequences({ 'a.json': [{ id: 'a', steps: [] }] })[0]!.room, undefined);
  assert.throws(() => validateSequences({ 'a.json': [{ id: 'a', room: 14, steps: [] }] }), /room/);
  assert.throws(() => validateSequences({ 'a.json': [{ id: 'a', room: 'R 14c!', steps: [] }] }), /room/);
});

test('the room field also takes a list of level room ids', () => {
  assert.deepEqual(validateSequences({ 'a.json': [{ id: 'a', room: ['R12a', 'R12b'], steps: [] }] })[0]!.room, ['R12a', 'R12b']);
  assert.throws(() => validateSequences({ 'a.json': [{ id: 'a', room: [], steps: [] }] }), /room/);
  assert.throws(() => validateSequences({ 'a.json': [{ id: 'a', room: ['R12a', 'R 12b!'], steps: [] }] }), /room/);
});

const TWO = { room: ['R12a', 'R12b'] };

test('runningIn names the rooms of the running scenes only', async () => {
  const { m, state, tick } = setup(TWO);
  state.at = 'R12a';
  assert.equal(m.runningIn('R12a'), false);
  m.start('scene');
  assert.deepEqual(['R12a', 'R12b', 'R02'].map((r) => m.runningIn(r)), [true, true, false]);
  await tick(12);
  assert.equal(m.runningIn('R12a'), false);
});

test('a scene bound to two rooms carries on while the player walks from one into the other', async () => {
  const { m, state, host, log, ended, tick } = setup(TWO);
  state.at = 'R12a';
  m.start('scene');
  await tick(0.5);
  state.at = 'R12b';
  await tick(12);
  assert.deepEqual(log.filter((l) => l.startsWith('start')), ['start hale_1', 'start jay_1', 'start hale_2']);
  assert.equal(host.flags['scene_finished'], true);
  assert.deepEqual(ended, [{ id: 'scene', cancelled: false }]);
});

test('a scene bound to two rooms ends when the player is in neither', async () => {
  const { m, state, log, ended, released, tick } = setup(TWO);
  state.at = 'R12b';
  m.start('scene');
  await tick(0.5);
  state.at = 'R12c';
  await tick(12);
  assert.ok(!log.includes('start jay_1'), 'Jay never says his line');
  assert.equal(m.isRunning('scene'), false);
  assert.deepEqual(ended, [{ id: 'scene', cancelled: true }]);
  assert.deepEqual(released, [['hale']]);
});

test('a scene bound to two rooms starts when the player is only in the second one', async () => {
  const { m, state, fire, tick } = setup({ ...TWO, once: true, trigger: { event: 'enter' } });
  state.at = 'R12c';
  fire('enter');
  assert.equal(m.isRunning('scene'), false);
  state.at = 'R12b';
  fire('enter');
  assert.equal(m.isRunning('scene'), true);
  await tick(0.1);
});

test('a scene with a room list warns at load for each id that is not a room of the level', () => {
  const warnings: string[] = [];
  const host: SequenceHost = {
    events: { on: () => () => undefined, emit: () => undefined },
    flags: {} as Flags,
    resolve: () => null,
    warn: (m) => warnings.push(m),
    hasRoom: (room) => room === 'R12a',
  };
  new SequenceManager(host, validateSequences({ 'a.json': [{ id: 'hall', room: ['R12a', 'R12x'], steps: [] }] }));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /"hall".*"R12x"/);
});

test('a room scene plays through while the player stays in its room', async () => {
  const { m, host, log, ended, tick } = setup({ room: 'R14c' });
  m.start('scene');
  await tick(12);
  assert.deepEqual(log.filter((l) => l.startsWith('start')), ['start hale_1', 'start jay_1', 'start hale_2']);
  assert.equal(host.flags['scene_finished'], true);
  assert.deepEqual(ended, [{ id: 'scene', cancelled: false }]);
});

test('leaving mid-line lets that line finish by itself, drops the rest, and ends the scene for everyone', async () => {
  const { m, state, log, subs, ended, released, tick } = setup({ room: 'R14c' });
  m.start('scene');
  await tick(0.5);
  assert.ok(subs.has('hale_1'));
  state.inside = false;
  await tick(0.05);
  assert.ok(!log.includes('end hale_1 stopped'), 'the line is not cut off');
  assert.ok(subs.has('hale_1'), 'its subtitle stays while it plays');
  await tick(12);
  assert.ok(log.includes('end hale_1 finished'), 'it ends on its own');
  assert.ok(!subs.has('hale_1'), 'and its subtitle hides then');
  assert.ok(!log.includes('start jay_1'), 'Jay never says his line');
  assert.ok(!log.includes('start hale_2'), 'Hale says nothing more');
  assert.equal(m.isRunning('scene'), false);
  assert.deepEqual(ended, [{ id: 'scene', cancelled: true }]);
  assert.deepEqual(released, [['hale']], 'the NPCs the scene directed are released');
});

test('leaving in the pause before Jay answers: he never says it, nobody continues', async () => {
  const { m, state, log, tick } = setup({ room: 'R14c' });
  m.start('scene');
  await tick(1.9);
  assert.ok(log.includes('end hale_1 finished'));
  state.inside = false;
  await tick(12);
  assert.ok(!log.includes('start jay_1'));
  assert.ok(!log.includes('start hale_2'));
});

test('a scene that names no room carries on when the player leaves, as before', async () => {
  const { m, state, log, tick } = setup();
  state.inside = false;
  m.start('scene');
  await tick(12);
  assert.deepEqual(log.filter((l) => l.startsWith('start')), ['start hale_1', 'start jay_1', 'start hale_2']);
});

test('other conversations are untouched when a room scene ends', async () => {
  const { m, host, state, log, tick } = setup({ room: 'R14c' });
  m.start('scene');
  host.say!('sung_1', { channel: 'seq:other' });
  await tick(0.3);
  state.inside = false;
  await tick(3);
  assert.ok(log.includes('end sung_1 finished'), 'the other scene finishes its line');
});

test('an event that reaches a room scene while the player is outside does not start it or spend its once', async () => {
  const { m, state, host, fire, tick } = setup({ room: 'R14c', once: true, trigger: { event: 'enter_office' } });
  state.inside = false;
  fire('enter_office');
  assert.equal(m.isRunning('scene'), false);
  assert.equal(host.flags['seq:scene'], undefined);
  state.inside = true;
  fire('enter_office');
  assert.equal(m.isRunning('scene'), true);
  await tick(0.1);
});

test('an ended room scene stays finished: coming back does not restart it', async () => {
  const { m, state, log, host, fire, tick } = setup({ room: 'R14c', once: true, trigger: { event: 'enter_office' } });
  fire('enter_office');
  await tick(0.5);
  state.inside = false;
  await tick(0.2);
  assert.equal(m.isRunning('scene'), false);
  const started = log.filter((l) => l.startsWith('start')).length;
  state.inside = true;
  fire('enter_office');
  await tick(12);
  assert.equal(m.isRunning('scene'), false, 'the once flag holds');
  assert.equal(log.filter((l) => l.startsWith('start')).length, started, 'no line plays again');
  assert.equal(host.flags['scene_finished'], true, 'what was left of the scene landed on its end state');
});

test('leaving after the scene has finished changes nothing', async () => {
  const { m, state, host, ended, released, tick } = setup({ room: 'R14c' });
  m.start('scene');
  await tick(12);
  assert.equal(host.flags['scene_finished'], true);
  state.inside = false;
  await tick(1);
  assert.deepEqual(ended, [{ id: 'scene', cancelled: false }]);
  assert.deepEqual(released, []);
  assert.equal(m.isRunning('scene'), false);
});

test('a sequence room that is not a room of the level warns at load', () => {
  const warnings: string[] = [];
  const host: SequenceHost = {
    events: { on: () => () => undefined, emit: () => undefined },
    flags: {} as Flags,
    resolve: () => null,
    warn: (m) => warnings.push(m),
    hasRoom: (room) => room === 'R14c',
  };
  new SequenceManager(host, validateSequences({ 'a.json': [{ id: 'good', room: 'R14c', steps: [] }, { id: 'typo', room: 'R14x', steps: [] }, { id: 'none', steps: [] }] }));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /"typo".*"R14x"/);
});

// ---- the shipped scene, against the shipped level: Hale's office (R14c) and rounds.json's `admin_hale`

const readJson = (rel: string): unknown => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const level = readLevel('slice01') as { rooms: Array<Record<string, unknown> & { id: string; pieces: never; anchors?: Array<{ id: string; pos: [number, number, number] }> }> };
const room = (id: string) => level.rooms.find((r) => r.id === id)!;
const anchor = (id: string): [number, number, number] => level.rooms.flatMap((r) => r.anchors ?? []).find((a) => a.id === id)!.pos;
/** Feet raised half a metre, as the game host tests rooms. */
const inRoom = (id: string, [x, y, z]: readonly [number, number, number]): boolean => roomContains(room(id) as never, [x, y + 0.5, z]);

test('Hale scene: it is bound to his office, and every shipped sequence room exists in the level', () => {
  const sequences = readdirSync(new URL('../data/sequences/', import.meta.url))
    .filter((n) => n.endsWith('.json'))
    .flatMap((n) => readJson(`../data/sequences/${n}`) as Array<{ id: string; room?: string | string[] }>);
  const bound = sequences.filter((s) => s.room !== undefined);
  const byId = Object.fromEntries(bound.map((s) => [s.id, s.room]));
  assert.deepEqual(byId['admin_hale'], 'R14c');
  assert.deepEqual(byId['researcher_walkby'], 'R02');
  // The round conversations (room-bound-round-scenes): a vestibule and the hall beyond it for the two that straddle one.
  assert.deepEqual(byId['hydro_moment'], ['R12a', 'R12b']);
  assert.deepEqual(byId['dive_moment'], ['R13a', 'R13b']);
  assert.equal(byId['admin_moment'], 'R14a');
  assert.equal(byId['hydro_store_moment'], 'R12e');
  for (const s of bound) for (const r of [s.room!].flat()) assert.ok(level.rooms.some((x) => x.id === r), `${s.id}: room ${r}`);
});

test('Hale office presence: his desk and standing spot are inside, the open office and corridor are outside', () => {
  for (const a of ['hale_desk', 'hale_stand']) assert.ok(inRoom('R14c', anchor(a)), a);
  const trigger = (room('R14c') as unknown as { triggers: Array<{ id: string; box: [number[], number[]] }> }).triggers.find((t) => t.id === 'trig_hale_office')!;
  const [lo, hi] = trigger.box as [[number, number, number], [number, number, number]];
  for (const x of [lo[0], hi[0]]) for (const z of [lo[2], hi[2]]) assert.ok(inRoom('R14c', [x, 0, z]), `the trigger box corner ${x},${z} is inside the office`);
  assert.ok(!inRoom('R14c', [49.5, 0, 4]), 'one step out through the glass door, in the open office');
  assert.ok(inRoom('R14b', [49.5, 0, 4]), 'which is the open office');
  assert.ok(!inRoom('R14c', [44, 0, 4]) && !inRoom('R14c', [36, 0, 8]), 'further away');
});

/** Play the shipped scene; Jay steps outside at `leaveAt` seconds, or the moment that text shows up in the log. */
interface ShippedScene {
  event: string;
  flags: Flags;
  start: [number, number, number];
  out: [number, number, number];
}
const HALE: ShippedScene = { event: 'trigger:hale_office', flags: { briefingSeen: true } as Flags, start: anchor('hale_desk'), out: [47, 0, 4] };
const WALKBY: ShippedScene = { event: 'trigger:commons_enter', flags: { commons_changed_1: true } as Flags, start: anchor('priya_enter'), out: [10, 0, 25] };

async function playShippedScene(leaveAt: string | number | null, seconds: number, scene: ShippedScene = HALE) {
  const dir = new URL('../data/dialogue/', import.meta.url);
  const chapters = Object.fromEntries(
    readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'speakers.json' && f !== 'ui.json').map((f) => [`data/dialogue/${f}`, readJson(`../data/dialogue/${f}`)]),
  );
  const real = new DialogueLibrary(speakers, chapters);
  const bus = new EventBus();
  const log: string[] = [];
  bus.on('speech:started', (e) => log.push(`start ${e.id}`));
  bus.on('speech:ended', (e) => log.push(`end ${e.id} ${e.reason}`));
  const speech = new SpeechManager(bus, real, { play: () => ({ stop: () => undefined }) });
  let jay: [number, number, number] = scene.start;
  const npcCalls: string[] = [];
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  const events: SequenceHost['events'] = {
    on: (name, fn) => {
      const set = handlers.get(name) ?? new Set();
      handlers.set(name, set);
      set.add(fn);
      return () => set.delete(fn);
    },
    emit: (name, payload) => void [...(handlers.get(name) ?? [])].forEach((fn) => fn(payload)),
  };
  const released: string[][] = [];
  const host: SequenceHost = {
    events,
    flags: { ...scene.flags },
    resolve: () => ({ x: 0, y: 0, z: 0 }),
    warn: (m) => log.push(`warn ${m}`),
    npc: (action, step) => void npcCalls.push(`${action} ${String(step['npc'])}`),
    say: (line, opts) => speech.say(line, opts),
    stopSpeech: () => speech.stopAll(),
    stopSceneSpeech: (id) => speech.stopChannels((c) => c === `seq:${id}` || c.startsWith(`seq:${id}:`), true),
    releaseNpcs: (ids) => void released.push([...ids]),
    hasRoom: (r) => level.rooms.some((x) => x.id === r),
    inRoom: (_who, r) => inRoom(r, jay),
  };
  const files = readdirSync(new URL('../data/sequences/', import.meta.url)).filter((n) => n.endsWith('.json'));
  const m = new SequenceManager(host, validateSequences(Object.fromEntries(files.map((n) => [n, readJson(`../data/sequences/${n}`)]))));
  events.emit('trigger:fired', { event: scene.event });
  for (let t = 0; t < seconds - 1e-9; t += 0.05) {
    if (leaveAt !== null && (typeof leaveAt === 'number' ? t >= leaveAt : log.includes(leaveAt))) jay = scene.out;
    speech.update(0.05);
    m.update(0.05);
    await Promise.resolve();
    await Promise.resolve();
  }
  const comeBack = async (seconds: number): Promise<void> => {
    jay = scene.start;
    events.emit('trigger:fired', { event: scene.event });
    for (let t = 0; t < seconds; t += 0.05) {
      speech.update(0.05);
      m.update(0.05);
      await Promise.resolve();
      await Promise.resolve();
    }
  };
  return { log, released, m, host, events, comeBack, npcCalls };
}

test('shipped admin_hale, staying in the office: Hale, Jay and Hale again all speak', async () => {
  const { log } = await playShippedScene(null, 25);
  const started = log.filter((l) => l.startsWith('start'));
  assert.ok(started.includes('start admin_jay_01'), 'Jay answers');
  assert.equal(started.at(-1), 'start admin_hale_04');
});

test('shipped admin_hale, Jay walks out through the glass door before answering: he never says it, Hale says nothing more', async () => {
  // Jay steps out into the open office as Hale starts his second line, before Jay's answer is due.
  const { log, released, m } = await playShippedScene('start admin_hale_02', 25);
  assert.ok(log.includes('start admin_hale_02'));
  assert.ok(!log.includes('start admin_jay_01'), 'Jay does not speak');
  assert.ok(!log.includes('start admin_hale_03') && !log.includes('start admin_hale_04'), 'Hale does not go on');
  assert.ok(log.some((l) => /^end admin_hale_02 finished/.test(l)));
  assert.equal(m.isRunning('admin_hale'), false);
  assert.ok(released.length === 1 && released[0]!.includes('hale'), 'Hale is released');
});

test('shipped admin_hale, Jay comes back: the scene does not restart, and the card exchange still completes the Admin round', async () => {
  const { log, m, host, events, comeBack } = await playShippedScene('start admin_hale_02', 12);
  const before = log.length;
  await comeBack(15);
  assert.equal(log.length, before, 'nothing plays again');
  assert.equal(m.isRunning('admin_hale'), false);
  events.emit('item:given', { id: 'card_l2' });
  m.update(0.05);
  assert.equal(host.flags['round_admin_done'], true);
});

test('walk-by researcher, Jay stays in the Commons: both greetings play and the researcher leaves as before', async () => {
  const out = await playShippedScene(null, 20, WALKBY);
  assert.deepEqual(out.log.filter((l) => l.startsWith('start')), ['start walkby_jay_01', 'start walkby_jay_02']);
  assert.equal(out.host.flags['researcher_walkby_seen'], true);
  assert.ok(out.npcCalls.includes('despawn researcher_a'));
});

test('walk-by researcher, Jay leaves the Commons first: he greets nobody, and the researcher is despawned and the scene marked seen', async () => {
  const early = await playShippedScene(1, 20, WALKBY);
  assert.deepEqual(early.log.filter((l) => l.startsWith('start')), [], 'leaving before the greeting: Jay says nothing');
  assert.equal(early.m.isRunning('researcher_walkby'), false);
  assert.ok(early.npcCalls.includes('despawn researcher_a'), 'nobody is left standing in the Commons');
  assert.equal(early.host.flags['researcher_walkby_seen'], true);

  const between = await playShippedScene('start walkby_jay_01', 20, WALKBY);
  assert.ok(!between.log.includes('start walkby_jay_02'), 'leaving after the first greeting: no second line');
  assert.ok(between.npcCalls.includes('despawn researcher_a'));
});

test('walk-by researcher: an event that reaches it while Jay is outside the Commons does not start it or spend its once', async () => {
  const out = await playShippedScene(null, 0.2, { ...WALKBY, start: WALKBY.out });
  assert.equal(out.m.isRunning('researcher_walkby'), false);
  assert.equal(out.host.flags['seq:researcher_walkby'], undefined);
});

// ---- the round conversations (room-bound-round-scenes): hydroponics, dive bay, reception, storeroom

const COMMONS: [number, number, number] = [20, 0, 18];
const HYDRO: ShippedScene = { event: 'trigger:hydro_enter', flags: { briefingSeen: true } as Flags, start: [36, 0, 20], out: COMMONS };
const HYDRO_HALL = anchor('botanist_1_spot');
const DIVE: ShippedScene = { event: 'trigger:dive_enter', flags: { briefingSeen: true } as Flags, start: [24, 0, 28], out: COMMONS };
const ADMIN: ShippedScene = { event: 'trigger:admin_enter', flags: { briefingSeen: true } as Flags, start: [36, 0, 12], out: COMMONS };
const STORE: ShippedScene = { event: 'trigger:hydro_store_enter', flags: {} as Flags, start: anchor('hydro_store_moment'), out: COMMONS };
const said = (log: string[]): string[] => log.filter((l) => l.startsWith('start')).map((l) => l.slice(6));

test('round scene rooms: each trigger and each speaker spot is inside the scene rooms, the Commons is outside all of them', () => {
  assert.ok(inRoom('R12a', HYDRO.start) && inRoom('R12b', HYDRO_HALL), 'hydroponics: the vestibule trigger, the botanist in the hall');
  assert.ok(inRoom('R13a', DIVE.start) && inRoom('R13b', anchor('diver_1_spot')), 'dive bay: the vestibule trigger, Sung in the launch hall');
  assert.ok(inRoom('R14a', ADMIN.start), 'reception');
  assert.ok(inRoom('R12e', STORE.start), 'storeroom');
  for (const r of ['R12a', 'R12b', 'R12e', 'R13a', 'R13b', 'R14a']) assert.ok(!inRoom(r, COMMONS), `the Commons is not ${r}`);
});

test('hydroponics, Jay walks on from the vestibule into the hall: all five lines play', async () => {
  const out = await playShippedScene(null, 30, HYDRO);
  assert.deepEqual(said(out.log), ['hydro_botanist_01', 'hydro_jay_01', 'hydro_botanist_02', 'hydro_jay_02', 'hydro_botanist_03']);
  const hall = await playShippedScene(null, 0.1, HYDRO);
  assert.ok(hall.m.isRunning('hydro_moment'));
  assert.ok(inRoom('R12b', HYDRO_HALL));
});

test('hydroponics, Jay leaves while the botanist is speaking: his reply is never said and nobody goes on', async () => {
  const out = await playShippedScene('start hydro_botanist_01', 30, HYDRO);
  assert.deepEqual(said(out.log), ['hydro_botanist_01']);
  assert.ok(out.log.some((l) => /^end hydro_botanist_01 finished/.test(l)), 'her line finishes by itself');
  assert.equal(out.m.isRunning('hydro_moment'), false);
});

test('hydroponics, Jay comes back after leaving: the conversation does not start again', async () => {
  const out = await playShippedScene('start hydro_botanist_02', 12, HYDRO);
  const before = out.log.length;
  await out.comeBack(25);
  assert.equal(out.log.length, before, 'nothing plays again');
  assert.equal(out.m.isRunning('hydro_moment'), false);
});

test('an event that reaches the hydroponics scene while Jay is outside does not start it or spend its once', async () => {
  const out = await playShippedScene(null, 0.2, { ...HYDRO, start: COMMONS });
  assert.equal(out.m.isRunning('hydro_moment'), false);
  assert.equal(out.host.flags['seq:hydro_moment'], undefined);
});

test('dive bay, Jay stays: Sung, Jay, Sung and the maintenance worker all speak and the trunk is secured', async () => {
  const out = await playShippedScene(null, 30, DIVE);
  assert.deepEqual(said(out.log), ['dive_sung_01', 'dive_jay_01', 'dive_sung_02', 'dive_maint_01']);
  assert.equal(out.host.flags['dive_trunk_secured'], true);
});

test('dive bay, Jay leaves while Sung is speaking: the talk stops, the trunk is still secured, and Sung is released', async () => {
  const out = await playShippedScene('start dive_sung_01', 30, DIVE);
  assert.deepEqual(said(out.log), ['dive_sung_01']);
  assert.equal(out.m.isRunning('dive_moment'), false);
  assert.equal(out.host.flags['dive_trunk_secured'], true, 'what the scene left to do still lands');
  assert.ok(out.released.some((ids) => ids.includes('sung')), 'Sung returns to idle');
});

test('dive bay, Jay comes back after leaving: Sung does not repeat himself', async () => {
  const out = await playShippedScene('start dive_sung_01', 12, DIVE);
  const before = out.log.length;
  await out.comeBack(25);
  assert.equal(out.log.length, before);
});

test('reception, Jay leaves while the assistant is speaking: she stops and says nothing more', async () => {
  const stay = await playShippedScene(null, 12, ADMIN);
  assert.deepEqual(said(stay.log), ['admin_assistant_01']);
  const out = await playShippedScene('start admin_assistant_01', 12, ADMIN);
  assert.ok(out.log.some((l) => /^end admin_assistant_01 finished/.test(l)), 'her line finishes by itself');
  assert.equal(out.m.isRunning('admin_moment'), false);
});

test('storeroom, Jay stays: both of his remarks play; Jay leaves after the first: he does not make the second', async () => {
  const stay = await playShippedScene(null, 15, STORE);
  assert.deepEqual(said(stay.log), ['hydro_store_jay_01', 'hydro_store_jay_02']);
  assert.equal(stay.host.flags['hydro_store_seen'], true);
  const out = await playShippedScene('start hydro_store_jay_01', 15, STORE);
  assert.deepEqual(said(out.log), ['hydro_store_jay_01']);
  assert.equal(out.host.flags['hydro_store_seen'], true, 'the scene still counts as seen');
});
