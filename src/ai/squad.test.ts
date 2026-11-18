import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import posesJson from '../data/poses.json' with { type: 'json' };
import { DEFAULT_MOTOR, moveBody } from '../actors/motor.ts';
import type { GoreSystem } from '../actors/gore.ts';
import { PoseLibrary } from '../actors/poses.ts';
import { loadPoseFile } from '../data/types/poses.ts';
import { DEMO_COLLIDERS, demoRoomPlayerWorld } from '../world/demoRoomColliders.ts';
import { gridNodes, NavGraph } from './nav.ts';
import { Squad, SQUAD_TUNING, type SquadEnemy, type SquadEnemySource, type SquadPlayer } from './squad.ts';
import { TASKS } from './squadBrain.ts';

function setup(extra: { enemies?: SquadEnemySource; gameOver?: () => void; flags?: () => Record<string, number> } = {}) {
  const pw = demoRoomPlayerWorld();
  const nav = new NavGraph({ world: pw.colliders, nodes: gridNodes(pw.colliders, { minX: -2.5, maxX: 2.5, minZ: -9.5, maxZ: 9.5, maxY: 0.5 }, 1) });
  const events: Array<{ name: string; payload: unknown }> = [];
  const player = {
    downed: false,
    revived: 0,
    revive() {
      this.downed = false;
      this.revived++;
    },
    body: { x: 0, y: 0, z: 8, vy: 0, grounded: true },
    yaw: 0,
    aimBlend: 0,
    velocity: { x: 0, y: 0 },
    viewDirection(o = new THREE.Vector3()) {
      return o.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    },
    eyePosition(o = new THREE.Vector3()) {
      return o.set(this.body.x, this.body.y + 1.62, this.body.z);
    },
  };
  const squad = new Squad({ ctx: { poses: new PoseLibrary(loadPoseFile(posesJson)), gore: {} as GoreSystem /* gore needs a canvas; nothing here gets hurt */ }, nav, player: player as SquadPlayer, emit: (name, payload) => events.push({ name, payload }), ...extra });
  return { squad, player, colliders: pw.colliders, events };
}

test('squad follows Jay down the corridor, stays out of walls and out of his aim when he holds still', () => {
  const { squad, player, colliders } = setup();
  const dt = 1 / 60;
  let maxDist = 0;
  // Walk 14 m down the corridor.
  for (let t = 0; t < 7; t += dt) {
    if (player.body.z > -6) moveBody(player.body, 0, -3.2 * dt, dt, DEFAULT_MOTOR, colliders);
    squad.update(dt, null);
    for (const m of squad.mates) maxDist = Math.max(maxDist, Math.hypot(m.position.x - player.body.x, m.position.z - player.body.z));
  }
  assert.ok(maxDist < 14, `kept up (max ${maxDist.toFixed(1)} m)`);
  // Then stand still: they walk up and stop within 10 ft, and stay stopped.
  for (let t = 0; t < 8; t += dt) squad.update(dt, null);
  const settled = squad.mates.map((m) => m.position.clone());
  for (let t = 0; t < 3; t += dt) squad.update(dt, null);
  squad.mates.forEach((m, i) => assert.ok(m.position.distanceTo(settled[i]!) < 0.2, `${m.id} stays put once stopped`));
  for (const m of squad.mates) {
    const d = Math.hypot(m.position.x - player.body.x, m.position.z - player.body.z);
    assert.ok(d <= 4.6, `${m.id} came back within range (${d.toFixed(1)} m)`);
    for (const b of DEMO_COLLIDERS) {
      if (b.max[1] <= 0.36 || b.min[1] >= 1.5) continue; // floor and ceiling slabs
      const inside = m.position.x > b.min[0] && m.position.x < b.max[0] && m.position.z > b.min[2] && m.position.z < b.max[2];
      assert.ok(!inside, `${m.id} not inside a wall`);
    }
  }
  // Turning round without aiming: they don't move.
  const before = squad.mates.map((m) => m.position.clone());
  player.yaw = Math.PI;
  for (let t = 0; t < 2; t += dt) squad.update(dt, null);
  squad.mates.forEach((m, i) => assert.ok(m.position.distanceTo(before[i]!) < 0.2, `${m.id} doesn't scramble when Jay just turns`));
  // Aiming at them: within a couple of seconds both are out of the cone.
  player.aimBlend = 1;
  for (let t = 0; t < 2.5; t += dt) squad.update(dt, null);
  const view = new THREE.Vector3(0, 0, 1);
  let inCone = 0;
  for (let t = 0; t < 3; t += dt) {
    squad.update(dt, null);
    for (const m of squad.mates) if (squad.inAimCone(m.position, view)) inCone += dt;
  }
  assert.equal(inCone, 0, `nobody in the line of fire while Jay holds his aim (${inCone.toFixed(2)} s)`);
  assert.ok(SQUAD_TUNING.aimCone > 0.2);
});

test('a big jump (restart) brings the squad along', () => {
  const { squad, player } = setup();
  squad.update(1 / 60, null);
  player.body.z = -7;
  squad.update(1 / 60, null);
  for (const m of squad.mates) assert.ok(Math.hypot(m.position.x, m.position.z + 7) < 6, `${m.id} placed near Jay`);
});

// ------------------------------------------------------------------ ADR-0011 steps 3-7

interface FakeEnemy extends SquadEnemy {
  position: { x: number; y: number; z: number };
  alive: boolean;
  hp: number;
  grabbing: string | null;
  hits: string[];
}

function horde(spots: Array<[number, number]>, hp = 100) {
  const list: FakeEnemy[] = spots.map(([x, z], i) => ({ id: `e${i}`, position: { x, y: 0, z }, alive: true, hp, grabbing: null, hits: [] }));
  const source: SquadEnemySource & { list(): FakeEnemy[] } = {
    list: () => list,
    shoot(id, aim, damage) {
      const e = list.find((x) => x.id === id);
      if (!e || !e.alive) return false;
      e.hits.push(aim);
      e.hp -= damage;
      if (e.hp <= 0) e.alive = false;
      return !e.alive;
    },
  };
  return { list, source };
}

test('in a fight the squad shoots, as support, and the player gets most of the kills (kill-share guard)', () => {
  // Six shamblers walk down the corridor at Jay; Jay fires his pistol at the nearest one.
  const { list, source } = horde([[-1.5, -6], [0, -7], [1.5, -6], [-1, -8.5], [1, -8.5], [0, -9]]);
  const { squad } = setup({ enemies: source });
  const dt = 1 / 60;
  let playerKills = 0;
  let shotT = 0;
  let shotN = 0;
  for (let t = 0; t < 60 && list.some((e) => e.alive); t += dt) {
    for (const e of list) if (e.alive && e.position.z < 5.5) e.position.z += 0.35 * dt;
    shotT -= dt;
    const live = list.filter((e) => e.alive).sort((a, b) => b.position.z - a.position.z);
    if (shotT <= 0 && live[0]) {
      shotT = 0.45;
      // ~70 % of Jay's shots land (deterministic pattern).
      if (shotN++ % 10 < 7) {
        live[0].hp -= 18 * (live[0].hits.length ? 1 : 1);
        if (live[0].hp <= 0) {
          live[0].alive = false;
          playerKills++;
          squad.recordKill('player');
        }
      }
    }
    squad.update(dt, null);
  }
  const squadKills = list.filter((e) => !e.alive).length - playerKills;
  const total = playerKills + squadKills;
  assert.equal(total, 6, 'the fight ends');
  assert.ok(list.some((e) => e.hits.length > 0), 'the squad hit something');
  assert.ok(playerKills / total >= 0.65, `player kill share ${playerKills}/${total}`);
  const hits = list.flatMap((e) => e.hits);
  assert.ok(hits.includes('legs') && hits.includes('arms'), 'Giles cripples legs, Okafor goes for arms');
  assert.ok(!hits.includes('torso'));
});

test('Jay goes down: Okafor comes and revives him in about 3 s', () => {
  const { squad, player, events } = setup();
  const dt = 1 / 60;
  for (let t = 0; t < 3; t += dt) squad.update(dt, null);
  player.downed = true;
  let t = 0;
  for (; t < 15 && player.downed; t += dt) squad.update(dt, null);
  assert.equal(player.revived, 1, 'revived');
  assert.ok(t >= 3 && t < 10, `took ${t.toFixed(1)} s`);
  assert.ok(events.some((e) => e.name === 'squad:reviveProgress'));
  assert.ok(events.some((e) => e.name === 'squad:revived'));
  assert.ok(!events.some((e) => e.name === 'squad:gameOver'));
});

test('Jay goes down while the medic is down: game over', () => {
  let over = 0;
  const { squad, player, events } = setup({ gameOver: () => over++ });
  const dt = 1 / 60;
  squad.update(dt, null);
  squad.damageMate('medic', 1000);
  assert.equal(squad.mate('medic').downed, true);
  assert.ok(events.some((e) => e.name === 'squad:noSafetyNet'));
  player.downed = true;
  squad.update(dt, null);
  assert.equal(over, 1);
  assert.ok(events.some((e) => e.name === 'squad:gameOver'));
  assert.equal(player.revived, 0);
});

test('Giles goes down and gets up after 6 s at half health, or sooner when Okafor revives him', () => {
  const { squad, events } = setup();
  const dt = 1 / 60;
  squad.update(dt, null);
  const giles = squad.mate('engineer');
  // Okafor busy elsewhere? No: he revives Giles when it is safe, so the revive is quicker than 6 s.
  squad.damageMate('engineer', 1000);
  assert.equal(giles.downed, true);
  let t = 0;
  for (; t < 8 && giles.downed; t += dt) squad.update(dt, null);
  assert.equal(giles.downed, false);
  assert.ok(t < 6, `revived in ${t.toFixed(1)} s`);
  assert.ok(events.some((e) => e.name === 'squad:revived' && (e.payload as { target: string }).target === 'engineer'));
  assert.equal(giles.hp, 50);
  // With the medic down too, Giles gets up on his own at 6 s.
  squad.damageMate('medic', 1000);
  squad.damageMate('engineer', 1000);
  for (t = 0; t < 8 && giles.downed; t += dt) squad.update(dt, null);
  assert.ok(Math.abs(t - 6) < 0.1, `up on his own after ${t.toFixed(2)} s`);
});

test('a cover-me task pauses when an enemy reaches Giles and resumes; it completes', () => {
  const { list, source } = horde([[0, -30]]);
  const { squad, events } = setup({ enemies: source });
  const dt = 1 / 60;
  squad.update(dt, null);
  let done = false;
  const task = squad.startTask('engineer', 'bypass_long', { at: { x: 1.5, y: 0, z: 2 }, panel: 'D2' });
  task.whenDone(() => (done = true));
  let t = 0;
  for (; t < 12; t += dt) squad.update(dt, null);
  assert.equal(task.state, 'working');
  const before = task.progress;
  assert.ok(before > 0.2);
  // An enemy steps up to him (and nobody shoots it in this test: it has huge HP).
  const e = list[0]!;
  e.hp = 1e9;
  e.position.x = 1.5;
  e.position.z = 0;
  for (let k = 0; k < 120; k++) squad.update(dt, null);
  assert.equal(task.state, 'paused');
  assert.ok(Math.abs(task.progress - before) < 0.05, 'held while threatened');
  assert.ok(events.some((x) => x.name === 'squad:taskPaused'));
  e.position.z = -30;
  for (t = 0; t < 30 && !done; t += dt) squad.update(dt, null);
  assert.equal(done, true);
  assert.ok(events.some((x) => x.name === 'squad:taskResumed'));
  assert.ok(events.some((x) => x.name === 'squad:taskDone'));
  assert.ok(events.filter((x) => x.name === 'squad:taskProgress').length >= 9);
  assert.equal(squad.mate('engineer').task, null);
});

test('Okafor opens a biometric lock in 5 s', () => {
  const { squad } = setup();
  squad.update(1 / 60, null);
  const m = squad.mate('medic');
  const task = squad.startTask('medic', 'biometric', {});
  let t = 0;
  for (; t < 10 && !task.done; t += 1 / 60) squad.update(1 / 60, null);
  assert.equal(task.done, true);
  assert.ok(Math.abs(t - TASKS['biometric']!.duration) < 0.6, `${t.toFixed(2)} s`);
  assert.equal(m.task, null);
});

test('the reveal ladder follows the giles.infectionStage flag: rasp, then the laugh goes', () => {
  const rasp: Array<number | null> = [];
  const laugh: boolean[] = [];
  let stage = 0;
  const { squad, events } = setup({ flags: () => ({ 'giles.infectionStage': stage }) });
  (squad as unknown as { deps: { speech: unknown } }).deps.speech = { setRasp: (_s: string, a: number | null) => rasp.push(a), setLaugh: (_s: string, on: boolean) => laugh.push(on) };
  const dt = 1 / 60;
  squad.update(dt, null);
  stage = 2;
  for (let t = 0; t < 1; t += dt) squad.update(dt, null);
  assert.equal(squad.infectionStage, 2);
  assert.ok((rasp.at(-1) ?? 0) > 0);
  stage = 4;
  for (let t = 0; t < 1; t += dt) squad.update(dt, null);
  assert.equal(laugh.at(-1), false);
  assert.ok(events.some((e) => e.name === 'squad:infectionStage'));
});

test('Giles shows a bandage once bandaged and veins and sweat at stage 3, and loses them when the flags go back (a restart)', () => {
  let flags: Record<string, unknown> = {};
  const { squad } = setup({ flags: () => flags as never });
  const dt = 1 / 60;
  const run = (): void => {
    for (let t = 0; t < 0.7; t += dt) squad.update(dt, null);
  };
  const body = squad.mate('engineer').body;
  run();
  assert.deepEqual(body.tells, { bandage: false, veins: 0, sweat: 0 });
  flags = { 'giles.infectionStage': 2, 'giles.bandaged': true };
  run();
  assert.deepEqual(body.tells, { bandage: true, veins: 0, sweat: 0 }, 'stage 2: bandage only');
  flags = { 'giles.infectionStage': 3, 'giles.bandaged': true };
  run();
  assert.deepEqual(body.tells, { bandage: true, veins: 1, sweat: 1 }, 'stage 3: veins and sweat');
  // A load or restart from before the beat: flags come back empty.
  flags = {};
  run();
  assert.deepEqual(body.tells, { bandage: false, veins: 0, sweat: 0 });
  assert.equal(squad.infectionStage, 0);
  // The other squadmate never gets any.
  assert.deepEqual(squad.mate('medic').body.tells, { bandage: false, veins: 0, sweat: 0 });
});

test('a scripted squadmate is left alone by the follow AI and by restart placement', () => {
  const { squad, player } = setup();
  const dt = 1 / 60;
  squad.update(dt, null);
  const giles = squad.mate('engineer');
  giles.scripted = true;
  const at = giles.position.clone();
  player.body.z = -7; // a big jump would normally bring the squad along
  for (let t = 0; t < 2; t += dt) squad.update(dt, null);
  assert.ok(giles.position.distanceTo(at) < 1e-6);
});

test('a standing squadmate steps out of Jay\'s line when he walks at him, and Jay then passes', () => {
  const { squad, player } = setup();
  const dt = 1 / 60;
  const wish = { x: 0, z: 0 };
  (player as { wish?: { x: number; z: number } }).wish = wish;
  for (let t = 0; t < 8; t += dt) squad.update(dt, null);
  const mate = squad.mate('engineer');
  // Stand him still in the corridor, put Jay 2.5 m short of him (well inside his stop distance) and walk Jay straight at him.
  mate.motor.x = 0;
  mate.motor.z = 4;
  mate.body.group.position.set(0, 0, 4);
  player.body.x = 0;
  player.body.z = 1.5;
  for (let t = 0; t < 3; t += dt) squad.update(dt, null);
  player.body.x = mate.position.x;
  player.body.z = mate.position.z - 2.5;
  const restZ = mate.position.z;
  wish.z = 1;
  let contact = -1;
  let clear = -1;
  let t = 0;
  for (let i = 0; i < 60 * 6; i++, t += dt) {
    // Jay walks at 1.9 m/s and is blocked by both bodies (what Player.setBodies does).
    player.body.z += wish.z * 1.9 * dt;
    for (const m of squad.mates) {
      const dx = player.body.x - m.position.x;
      const dz = player.body.z - m.position.z;
      const d = Math.hypot(dx, dz);
      const min = m.body.footprint.r + 0.35;
      if (d < min && d > 1e-6) {
        player.body.x = m.position.x + (dx / d) * min;
        player.body.z = m.position.z + (dz / d) * min;
      }
    }
    squad.update(dt, null);
    const d = Math.hypot(mate.position.x - player.body.x, mate.position.z - player.body.z);
    if (contact < 0 && d < mate.body.footprint.r + 0.35 + 0.35) contact = t;
    if (contact >= 0 && clear < 0 && Math.abs(mate.position.x - player.body.x) >= mate.body.footprint.r + 0.35 - 0.15) clear = t;
    if (player.body.z > restZ + 0.8) break;
  }
  assert.ok(contact >= 0, 'Jay reached him');
  assert.ok(clear >= 0 && clear - contact <= 0.6, `out of his line ${(clear - contact).toFixed(2)} s after contact`);
  assert.ok(player.body.z > restZ + 0.8, 'Jay walked past without being stopped for long');
});
