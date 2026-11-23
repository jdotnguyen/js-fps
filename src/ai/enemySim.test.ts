import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { validate } from '../core/validate.ts';
import type { Level } from '../world/level.ts';
import { levelValidator } from '../data/types/level.ts';
import { EnemyDirector } from './enemyDirector.ts';
import { ctx, director, kitTest, room, run, stubTarget, TABLE } from './enemyTestKit.ts';
import { spawnPointsOf } from './spawner.ts';
import { SequenceManager } from '../script/runtime.ts';
import { validateSequences } from '../script/schema.ts';

/** Headless kit_test (ADR-0003 level, real colliders, doors and navgraph). */
async function setup() {
  const { level, events } = await kitTest();
  const dir = new EnemyDirector({ ctx: ctx(), nav: level.navGraph(), colliders: level.collision, events, table: TABLE, difficulty: () => ({ enemyHp: 1, enemyLurchInterval: 1 }), seed: 'sim' });
  return { level, events, dir };
}

/** Level update with the "eye" at a door, so it is held open (auto doors close when nobody is near). */
function holdOpen(level: Level, id: string): () => void {
  const at = level.anchorPosition('door', id)!;
  const eye = new THREE.Vector3(at.x, 1.62, at.z);
  let t = 0;
  return () => {
    t += 1 / 60;
    level.update(t, 1 / 60, eye, true);
  };
}

test('kit_test: a shambler in the corridor paths through the open door to the player and attacks', async () => {
  const { level, dir } = await setup();
  level.setDoor('D1', 'open');
  const hold = holdOpen(level, 'D1');
  for (let i = 0; i < 90; i++) hold();
  const player = stubTarget('player', [0, 0, 14], { grabbable: false });
  dir.addTarget(player);
  // R02 corridor, facing the prep room. The player is in R01 behind the door.
  const e = dir.spawn('shambler', { x: 0, y: 0, z: 6 }, Math.PI);
  dir.noise('gunshot', player.pos, 'player');
  const t = run(dir, 30, () => player.hits.length > 0, hold);
  assert.ok(player.hits.length > 0, `attacked (state ${e.state}, at ${e.motor.x.toFixed(1)}, ${e.motor.z.toFixed(1)}, ${e.note})`);
  assert.ok(t < 20, `took ${t.toFixed(1)} s`);
  assert.ok(Math.hypot(e.motor.x - 0, e.motor.z - 14) < 2, 'it is beside the player');
});

test('kit_test: a closed door stops it; opening the door makes it repath and come through', async () => {
  const { level, dir } = await setup();
  const player = stubTarget('player', [2, 0, 15], { grabbable: false });
  dir.addTarget(player);
  const e = dir.spawn('shambler', { x: 0, y: 0, z: 6 }, Math.PI);
  e.sense(player.pos, 'sound', 'player', dir);
  run(dir, 6, () => player.hits.length > 0);
  assert.equal(player.hits.length, 0, 'the closed door holds it');
  assert.ok(e.motor.z < 10.2, 'still on its side of the door');
  level.setDoor('D1', 'open');
  const hold = holdOpen(level, 'D1');
  // Keep it interested (it would otherwise give up searching after a while).
  run(dir, 30, () => player.hits.length > 0, () => {
    hold();
    if (e.memory.age > 3) e.sense(player.pos, 'sound', 'player', dir);
  });
  assert.ok(player.hits.length > 0, `came through (state ${e.state}, z ${e.motor.z.toFixed(1)}, ${e.note})`);
});

test('kit_test spawns: level-start and grouped spawn points, spawnGroup waits for group:cleared', async () => {
  const raw = JSON.parse(readFileSync(new URL('../data/levels/kit_test.json', import.meta.url), 'utf8')) as { rooms: Array<{ id: string; spawns?: unknown[] }> };
  const r02 = raw.rooms.find((r) => r.id === 'R02')!;
  r02.spawns = [
    { id: 'sp_idle', pos: [0, 0, 5], kind: 'floor' },
    { id: 'sp_wave', pos: [0, 0, 7], kind: 'vent', group: 'wave', active: false, count: 3, interval: 0.5 },
    { id: 'sp_dead', pos: [1, 0, 8], kind: 'corpse', group: 'wave', active: false },
  ];
  const { level, events, dir } = await setup();
  const { KitRegistry, validateKitManifest } = await import('../world/registry.ts');
  const manifest = JSON.parse(readFileSync(new URL('../data/kit-manifest.json', import.meta.url), 'utf8'));
  const data = validate(levelValidator(new KitRegistry(validate(validateKitManifest, manifest, 'm'), undefined).ids()), raw, 'kit_test+spawns');
  assert.throws(() => validate(levelValidator(new KitRegistry(validate(validateKitManifest, manifest, 'm'), undefined).ids()), { ...raw, rooms: raw.rooms.map((r) => (r.id === 'R02' ? { ...r, spawns: [{ id: 'x', pos: [0, 0, 0], kind: 'floor', variant: 'dragon' }] } : r)) }, 'bad'), /variant/);
  dir.setSpawns(spawnPointsOf(data));
  dir.addTarget(stubTarget('player', [0, 0, 14], { grabbable: false }));
  dir.reset();
  run(dir, 0.5);
  assert.deepEqual(dir.list.map((e) => e.id), ['sp_idle']);

  // A sequence spawns the wave and waits for it to be cleared.
  const seqs = validateSequences({ 'wave.json': { id: 'wave', steps: [{ do: 'spawnGroup', group: 'wave', wait: true }, { do: 'setFlag', flag: 'wave_done' }] } });
  const flags: Record<string, string | number | boolean> = {};
  const host = {
    events: { on: (n: string, fn: (p: unknown) => void) => events.on(n as never, fn as never), emit: (n: string, p?: unknown) => events.emit(n as never, (p ?? {}) as never) },
    get flags() {
      return flags;
    },
    resolve: () => null,
    warn: (m: string) => assert.fail(m),
    spawnGroup: (g: string) => dir.spawnGroup(g),
    despawnGroup: (g: string) => dir.despawnGroup(g),
    groupCleared: (g: string) => dir.groupCleared(g),
  };
  const mgr = new SequenceManager(host, seqs);
  mgr.start('wave');
  for (let i = 0; i < 120; i++) {
    mgr.update(1 / 60);
    dir.update(1 / 60, null);
  }
  const wave = dir.list.filter((e) => e.group === 'wave');
  assert.equal(wave.length, 4, '3 from the vent and the play-dead');
  assert.equal(wave.filter((e) => e.state === 'playDead').length, 1);
  assert.equal(flags['wave_done'], undefined);
  const cleared: string[] = [];
  events.on('group:cleared', ({ group }) => cleared.push(group));
  for (const e of wave) e.body.hurt('torso', 1e6);
  for (let i = 0; i < 5; i++) {
    dir.update(1 / 60, null);
    mgr.update(1 / 60);
  }
  assert.deepEqual(cleared, ['wave']);
  assert.equal(flags['wave_done'], true);
  assert.ok(level);
});

test('emerging spawns come out on the floor, not on the ceiling slab within step height above them', () => {
  // A 4 m room like R06: the ceiling slab spans 4.00-4.12, so a point at 3.8 is within step height of its top.
  const world = room([{ min: [-10, 4, -10], max: [10, 4.12, 10] }]);
  const { dir } = director(world);
  const ceiling = dir.spawn('shambler', { x: -2, y: 3.8, z: 0 }, 0, { start: 'emerge' });
  const vent = dir.spawn('shambler', { x: 4, y: 2.7, z: 0 }, 0, { start: 'emerge' });
  run(dir, 3);
  assert.ok(Math.abs(ceiling.motor.y) < 1e-3, `ceiling spawn at y ${ceiling.motor.y}`);
  assert.ok(Math.abs(vent.motor.y) < 1e-3, `vent spawn at y ${vent.motor.y}`);
});

test('a dropping spawn falls from the point to the floor, lands once, gets up and hunts the player', () => {
  // R06-like: ceiling slab 4.00-4.12, the vent point at 3.3 just under it.
  const { dir, log } = director(room([{ min: [-10, 4, -10], max: [10, 4.12, 10] }]));
  const player = stubTarget('player', [0, 0, 6], { grabbable: false });
  dir.addTarget(player);
  dir.setSpawns([{ id: 'r06_duct', pos: [-2.6, 3.3, 0], kind: 'ceiling', group: 'r06_cover', active: false, look: 'lab_creature', hp: 90, start: 'drop' }]);
  dir.spawnGroup('r06_cover');
  run(dir, 1 / 60);
  const e = dir.list.find((x) => x.id === 'r06_duct')!;
  assert.equal(e.state, 'dropping');
  assert.ok(Math.abs(e.motor.y - 3.3) < 0.05, `first seen at the vent, y ${e.motor.y}`);
  assert.equal(e.mobile, false, 'falls straight down, no walking');
  const t = run(dir, 3, () => e.state !== 'dropping');
  // Free fall from 3.3 m takes sqrt(2h/g) = 0.82 s.
  assert.ok(t > 0.7 && t < 0.95, `fell for ${t.toFixed(2)} s`);
  assert.ok(Math.abs(e.motor.y) < 1e-3, `on the floor, not the slab: y ${e.motor.y}`);
  const landed = log.filter(([n]) => n === 'enemy:landed');
  assert.equal(landed.length, 1);
  const l = landed[0]![1] as { id: string; x: number; y: number; z: number; height: number };
  assert.equal(l.id, 'r06_duct');
  assert.ok(Math.abs(l.x + 2.6) < 1e-6 && Math.abs(l.y) < 1e-6, 'heard at its feet');
  assert.ok(Math.abs(l.height - 3.3) < 1e-6);
  assert.equal(e.target?.id, 'player', 'comes down already hunting Jay');
  const state = (): string => e.state;
  run(dir, 4, () => state() === 'chase' || state() === 'windup');
  assert.ok(state() === 'chase' || state() === 'windup', `then goes for Jay (${state()})`);
  assert.equal(log.filter(([n]) => n === 'enemy:landed').length, 1, 'lands only once');
});

test('a spawn point hp replaces the base health and still scales with difficulty; emerge is unchanged', () => {
  const at = (hp?: number, enemyHp = 1) => {
    const { dir } = director(room(), { enemyHp });
    return dir.spawn('shambler', { x: 0, y: 0, z: 0 }, 0, hp === undefined ? {} : { hp }).body.damage.baseHp;
  };
  assert.equal(at(90), 90);
  assert.equal(at(90, 0.75), 67.5);
  assert.equal(at(), TABLE.shambler.baseHp);
  const { dir } = director(room());
  dir.setSpawns([{ id: 'v', pos: [0, 2.7, 0], kind: 'vent', group: 'g', active: false, hp: 90 }]);
  dir.spawnGroup('g');
  run(dir, 1 / 60);
  const e = dir.list[0]!;
  assert.equal(e.state, 'waking', 'a vent spawn without start: drop still emerges');
  assert.ok(Math.abs(e.motor.y) < 1e-3);
  assert.equal(e.body.damage.baseHp, 90);
});

/** A room roofed by a slab at 4.00-4.12, and a two-enemy group: one on the floor, one standing on the slab. */
function strandedGroup(opts: { jaySees?: boolean } = {}) {
  const { dir, events } = director(room([{ min: [-10, 4, -10], max: [10, 4.12, 10] }]));
  const player = stubTarget('player', [0, 0, 0], { grabbable: false });
  // Without a view direction the director has to assume Jay can see it (the 30 s rule).
  if (opts.jaySees) delete (player as { view?: unknown }).view;
  dir.addTarget(player);
  dir.setSpawns([
    { id: 'g_floor', pos: [3, 0, 3], kind: 'floor', group: 'g', active: false },
    { id: 'g_roof', pos: [-5, 4.12, -5], kind: 'floor', group: 'g', active: false },
  ]);
  const culled: string[] = [];
  const cleared: string[] = [];
  events.on('enemy:culled', (p) => culled.push(p.id));
  events.on('group:cleared', (p) => cleared.push(p.group));
  dir.spawnGroup('g');
  run(dir, 0.5);
  dir.list.find((e) => e.id === 'g_floor')!.body.hurt('torso', 1e6);
  return { dir, culled, cleared, roof: dir.list.find((e) => e.id === 'g_roof')! };
}

test('a group enemy stuck on a roof slab is removed after 10 s out of view, and its group clears', () => {
  const { dir, culled, cleared, roof } = strandedGroup();
  assert.ok(Math.abs(roof.motor.y - 4.12) < 1e-3, `on the slab (y ${roof.motor.y})`);
  run(dir, 8);
  assert.deepEqual(culled, [], 'not before 10 s');
  assert.equal(dir.groupCleared('g'), false);
  const t = run(dir, 6, () => culled.length > 0);
  assert.deepEqual(culled, ['g_roof']);
  assert.ok(t < 4, `culled ${t.toFixed(1)} s after the 8 s mark`);
  assert.deepEqual(cleared, ['g']);
  assert.equal(dir.groupCleared('g'), true);
  assert.ok(!dir.list.includes(roof), 'the body is gone');
});

test('the cover fight\'s creature stuck out of reach is removed after 10 s out of view, and r06_cover clears (trim-lab-wing-encounters)', () => {
  // The one r06_cover enemy, dropped onto the roof slab (a point above it) instead of the floor: no way down.
  const { dir, events } = director(room([{ min: [-10, 4, -10], max: [10, 4.12, 10] }]));
  const player = stubTarget('player', [3, 0, 3], { grabbable: false });
  player.facing.set(1, 0, 0); // looking away from it
  dir.addTarget(player);
  dir.setSpawns([{ id: 'r06_duct', pos: [-5, 5, -5], kind: 'ceiling', group: 'r06_cover', active: false, look: 'lab_creature', hp: 90, start: 'drop' }]);
  const culled: string[] = [];
  events.on('enemy:culled', (p) => culled.push(p.id));
  dir.spawnGroup('r06_cover');
  run(dir, 3);
  const e = dir.list.find((x) => x.id === 'r06_duct')!;
  assert.ok(Math.abs(e.motor.y - 4.12) < 1e-3, `landed on the slab (y ${e.motor.y})`);
  run(dir, 14, () => culled.length > 0);
  assert.deepEqual(culled, ['r06_duct']);
  assert.equal(dir.groupCleared('r06_cover'), true, 'cover_me carries on past waitGroup');
});

test('an unreachable group enemy Jay can see is removed only at 30 s', () => {
  const { dir, culled } = strandedGroup({ jaySees: true });
  run(dir, 25);
  assert.deepEqual(culled, [], 'kept while in view');
  run(dir, 8, () => culled.length > 0);
  assert.deepEqual(culled, ['g_roof']);
});

test('a group enemy with a route to Jay is never removed, however long it chases', () => {
  const { dir, events } = director();
  const culled: string[] = [];
  events.on('enemy:culled', (p) => culled.push(p.id));
  const player = stubTarget('player', [6, 0, 6], { grabbable: false });
  dir.addTarget(player);
  dir.setSpawns([{ id: 'chaser', pos: [-6, 0, -6], kind: 'door', group: 'c', active: false }]);
  dir.spawnGroup('c');
  // Jay keeps moving round the room, so the chase lasts.
  let k = 0;
  run(dir, 25, undefined, () => {
    if (++k % 120 === 0) player.pos.set(-player.pos.x, 0, player.pos.z);
  });
  assert.deepEqual(culled, []);
  assert.equal(dir.list.filter((e) => e.alive).length, 1);
});

// infection-kills "The fight is the creature": a group released from somewhere else starts there, with its look's body.
test('spawnGroup from a place: the enemy starts there, faces that way, and wears the cast look', () => {
  const { dir } = director();
  dir.addTarget(stubTarget('player', [6, 0, 6], { grabbable: false }));
  dir.setSpawns([{ id: 'r05_door', pos: [5, 0, 5], kind: 'door', group: 'contact', active: false, look: 'lab_creature' }]);
  assert.ok(dir.spawnGroup('contact', { pos: { x: -3, y: 0, z: 1 }, yaw: 1.2 }));
  run(dir, 1 / 60);
  const e = dir.list[0]!;
  assert.ok(e, 'it spawned');
  assert.ok(Math.hypot(e.motor.x + 3, e.motor.z - 1) < 0.05, `at the given place (${e.motor.x.toFixed(2)}, ${e.motor.z.toFixed(2)})`);
  assert.equal(e.body.spec.seed, 'lab-b-creature', "the creature's own body");
  assert.equal(e.body.spec.height, 1.85);
  assert.equal(e.group, 'contact');
  // A reset forgets where the group was released from.
  dir.reset();
  dir.spawnGroup('contact');
  run(dir, 1 / 60);
  assert.ok(Math.hypot(dir.list[0]!.motor.x - 5, dir.list[0]!.motor.z - 5) < 0.05, 'from its own point again');
});
