import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import barksJson from '../data/dialogue/barks01.json' with { type: 'json' };
import { DialogueLibrary } from './library.ts';
import { BarkSystem, GLOBAL_COOLDOWN, whoOf, type BarkLine, type LooseBus } from './barks.ts';

function bus(): LooseBus {
  const h = new Map<string, Set<(p: unknown) => void>>();
  return {
    on(n, fn) {
      const s = h.get(n) ?? new Set();
      s.add(fn);
      h.set(n, s);
      return () => s.delete(fn);
    },
    emit(n, p) {
      for (const fn of [...(h.get(n) ?? [])]) fn(p);
    },
  };
}

const lines = barksJson.lines as BarkLine[];

function setup() {
  const b = bus();
  const said: Array<[string, string]> = [];
  let speaking: { priority: string } | null = null;
  let blocked = false;
  const sys = new BarkSystem({
    lines,
    bus: b,
    speech: { speaking: () => speaking, say: (id, sp) => said.push([id, sp]) },
    random: () => 0,
    blocked: () => blocked,
    idleAfter: 30,
  });
  return { b, sys, said, speak: (p: string | null) => (speaking = p ? { priority: p } : null), block: (v: boolean) => (blocked = v) };
}

test('barks01.json loads with the shipped speakers; ~50 barks and ~20 hints', () => {
  const speakers = JSON.parse(readFileSync(new URL('../data/dialogue/speakers.json', import.meta.url), 'utf8'));
  const lib = new DialogueLibrary(speakers, { 'barks01.json': barksJson });
  const all = lib.allLines();
  assert.ok(all.filter((l) => l.id.startsWith('bark_')).length >= 40);
  assert.ok(all.filter((l) => l.id.startsWith('hint_')).length >= 20);
  // Jay only makes short reaction sounds outside on-rails scenes.
  for (const l of all.filter((x) => x.speaker === 'player')) assert.ok(l.text.length <= 6, l.text);
  // Giles hints are questions, Okafor's statements of fact (ADR-0022).
  for (const l of all.filter((x) => x.priority === 'hint')) {
    if (l.speaker === 'engineer') assert.match(l.text, /\?/, l.id);
    if (l.speaker === 'medic') assert.doesNotMatch(l.text, /\?/, l.id);
  }
  for (const l of all.filter((x) => x.id.startsWith('bark_'))) assert.ok(l.priority === 'combat' || l.priority === 'idle', l.id);
});

test('squad events pick the right speaker', () => {
  const s = setup();
  s.b.emit('squad:reloading', { id: 'engineer' });
  assert.equal(s.said[0]![1], 'engineer');
  s.sys.update(GLOBAL_COOLDOWN + 0.1);
  s.b.emit('squad:downed', { id: 'medic' });
  assert.equal(s.said[1]![1], 'engineer', 'the other one calls it');
  assert.equal(whoOf({ id: 'okafor' }), 'medic');
  assert.equal(whoOf({ id: 'e12' }), null);
});

test('Giles barks about a panel only while he is the one working it', () => {
  const s = setup();
  s.b.emit('squad:taskProgress', { id: 'medic', task: 'biometric', panel: null, progress: 0.5 });
  assert.deepEqual(s.said, [], 'quiet while Okafor works');
  s.b.emit('squad:taskProgress', { id: 'engineer', task: 'bypass', panel: null, progress: 0.5 });
  assert.deepEqual(s.said, [['bark_task_01', 'engineer']]);
});

test('per-bark cooldown and global cooldown', () => {
  const s = setup();
  s.b.emit('enemy:died', { id: 'e1', x: 0, y: 0, z: 0 });
  assert.equal(s.said.length, 1);
  s.b.emit('group:cleared', { group: 'g' });
  assert.equal(s.said.length, 1, 'global cooldown holds the next bark');
  s.sys.update(GLOBAL_COOLDOWN + 0.1);
  s.b.emit('enemy:died', { id: 'e2', x: 0, y: 0, z: 0 });
  assert.equal(s.said.length, 1, 'per-bark cooldown (9 s) still running');
  s.b.emit('group:cleared', { group: 'g' });
  assert.equal(s.said.length, 2);
  s.sys.update(9);
  s.b.emit('enemy:died', { id: 'e3', x: 0, y: 0, z: 0 });
  assert.equal(s.said.length, 3);
  assert.notEqual(s.said[2]![0], s.said[0]![0], 'never the same line twice in a row');
});

test('Jay reacts on a grab without waiting for the global cooldown', () => {
  const s = setup();
  s.b.emit('enemy:died', { id: 'e1', x: 0, y: 0, z: 0 });
  s.b.emit('player:grabbed', {});
  const jay = s.said.filter(([, sp]) => sp === 'player');
  assert.equal(jay.length, 1);
  assert.match(jay[0]![0], /^bark_grab_jay_/);
});

test('barks are dropped, not queued, while a story or hint line plays, or blocked', () => {
  const s = setup();
  s.speak('story');
  s.b.emit('group:cleared', { group: 'g' });
  s.speak('hint');
  s.b.emit('group:cleared', { group: 'g' });
  s.speak(null);
  s.block(true);
  s.b.emit('group:cleared', { group: 'g' });
  assert.deepEqual(s.said, []);
  s.block(false);
  s.b.emit('group:cleared', { group: 'g' });
  assert.equal(s.said.length, 1, 'a skipped bark sets no cooldown');
});

test('torso hits teach "Legs!" after three in a row; a severed limb gets its own bark', () => {
  const s = setup();
  for (let i = 0; i < 2; i++) s.b.emit('enemy:hit', { id: 'e', region: 'torso', severed: null, killed: false });
  assert.equal(s.said.length, 0);
  s.b.emit('enemy:hit', { id: 'e', region: 'torso', severed: null, killed: false });
  assert.match(s.said[0]![0], /^bark_legs_/);
  assert.equal(s.said[0]![1], 'medic');
  s.sys.update(GLOBAL_COOLDOWN + 0.1);
  s.b.emit('enemy:hit', { id: 'e', region: 'leg_l', severed: 'leg_l', killed: false });
  assert.match(s.said[1]![0], /^bark_limb_/);
  assert.ok(s.sys.inCombat);
});

test('idle bark after a quiet stretch, never in combat', () => {
  const s = setup();
  s.b.emit('enemy:alerted', { id: 'e' });
  s.sys.update(10);
  assert.equal(s.said.length, 1, 'only the spotted bark');
  for (let i = 0; i < 70; i++) s.sys.update(0.5);
  assert.match(s.said[1]![0], /^bark_idle_/);
});

test('phase-gated idle barks never play morning jokes post-drop and contextual room commentary plays once', () => {
  const roomComm = JSON.parse(readFileSync(new URL('../data/dialogue/room_commentary.json', import.meta.url), 'utf8')) as { lines: BarkLine[] };
  const b = bus();
  const said: Array<[string, string]> = [];
  const flags = new Set<string>(['briefingSeen']);
  let phase: 'morning' | 'post_drop' = 'post_drop';
  let room: string | null = 'R07a';
  let scene = false;
  const sys = new BarkSystem({
    lines: [...lines, ...roomComm.lines],
    bus: b,
    speech: { speaking: () => null, say: (id, sp) => said.push([id, sp]) },
    random: () => 0,
    idleAfter: 20,
    phase: () => phase,
    playerRoom: () => room,
    sceneRunning: () => scene,
    flag: (n) => flags.has(n),
    setFlag: (n) => void flags.add(n),
  });

  // While a scripted scene runs in R07a, room commentary waits.
  scene = true;
  for (let i = 0; i < 10; i++) sys.update(0.5);
  assert.equal(said.length, 0);

  // Scene ends: after 3 s dwell, one-time Armory remark plays from Okafor.
  scene = false;
  for (let i = 0; i < 8; i++) sys.update(0.5);
  assert.deepEqual(said, [['room_comm_r07a_01', 'medic']]);
  assert.ok(flags.has('heard_room_comm_r07a_01'));

  // Re-entering R07a does not repeat the remark; quiet stretch plays only idle_dark post-drop.
  room = 'R07';
  sys.update(0.5);
  room = 'R07a';
  for (let i = 0; i < 50; i++) sys.update(0.5);
  assert.equal(said.length, 2);
  assert.match(said[1]![0], /^bark_idle_dark_/, 'post-drop uses dark idle pool, never morning jokes');

  // Switching to morning in R14b triggers the morning Admin remark once.
  phase = 'morning';
  room = 'R14b';
  for (let i = 0; i < 8; i++) sys.update(0.5);
  assert.equal(said[2]![0], 'room_comm_r14_01');
});
