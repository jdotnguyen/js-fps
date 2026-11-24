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
import { Squad, SQUAD_TUNING, type SquadEnemy, type SquadEnemySource, type SquadMate, type SquadPlayer } from './squad.ts';
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

test('Giles shows veins and sweat at stage 3 (no bandage/cast), and loses them when the flags go back (a restart)', () => {
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
  assert.deepEqual(body.tells, { bandage: false, veins: 0, sweat: 0 }, 'stage 2: no cast/bandage');
  flags = { 'giles.infectionStage': 3, 'giles.bandaged': true };
  run();
  assert.deepEqual(body.tells, { bandage: false, veins: 1, sweat: 1 }, 'stage 3: veins and sweat');
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

test('task threat: an enemy on the slab above Giles does not pause his bypass; one on his floor does', () => {
  const { list, source } = horde([[0, -30]]);
  const { squad } = setup({ enemies: source });
  const dt = 1 / 60;
  squad.update(dt, null);
  const task = squad.startTask('engineer', 'bypass_long', { at: { x: 1.5, y: 0, z: 2 }, panel: 'D2' });
  for (let t = 0; t < 12; t += dt) squad.update(dt, null);
  assert.equal(task.state, 'working');
  const e = list[0]!;
  e.hp = 1e9;
  // Standing on a ceiling slab right over him.
  const me = squad.mate('engineer').position;
  e.position.x = me.x;
  e.position.y = 4.12;
  e.position.z = me.z;
  const before = task.progress;
  for (let k = 0; k < 120; k++) squad.update(dt, null);
  assert.equal(task.state, 'working', 'above the ceiling: no threat');
  assert.ok(task.progress > before + 0.05, 'still progressing');
  // Down on his floor, within 3 m: pauses, progress kept.
  e.position.y = 0;
  e.position.z = me.z - 1.5;
  for (let k = 0; k < 60; k++) squad.update(dt, null);
  assert.equal(task.state, 'paused');
  const held = task.progress;
  for (let k = 0; k < 60; k++) squad.update(dt, null);
  assert.ok(Math.abs(task.progress - held) < 1e-6, 'held while threatened');
});

test('task arrival: with Jay standing on the panel spot, Giles starts within 1.5 m of it and finishes', () => {
  const { squad, player } = setup();
  const dt = 1 / 60;
  squad.update(dt, null);
  player.body.x = 0;
  player.body.z = 2;
  const task = squad.startTask('engineer', 'bypass_short', { at: { x: 0, y: 0, z: 2 }, panel: 'D2' });
  let startedAt: number | null = null;
  for (let t = 0; t < 30 && !task.done; t += dt) {
    squad.update(dt, null);
    if (startedAt === null && task.state !== 'walking') {
      const me = squad.mate('engineer').position;
      startedAt = Math.hypot(me.x - 0, me.z - 2);
    }
  }
  assert.ok(startedAt !== null, 'never started');
  assert.ok(startedAt! <= 1.5 + 1e-6, `started ${startedAt!.toFixed(2)} m from the spot`);
  assert.equal(task.done, true);
});

test('task arrival: a spot he cannot get to is worked from where he stands after about 3 s without progress', () => {
  const { squad } = setup();
  const dt = 1 / 60;
  squad.update(dt, null);
  // Beyond the demo room's east wall: there is no way to it.
  const device = { pos: { x: 8.5, y: 1.5, z: 2 }, normal: { x: -1, y: 0, z: 0 }, width: 0.2, height: 0.25 };
  const task = squad.startTask('engineer', 'bypass_short', { at: { x: 8, y: 0, z: 2 }, panel: 'D2', device });
  let t = 0;
  for (; t < 30 && task.state === 'walking'; t += dt) squad.update(dt, null);
  assert.notEqual(task.state, 'walking', 'still walking after 30 s');
  assert.ok(t < 15, `took ${t.toFixed(1)} s to give up`);
  const giles = squad.mate('engineer');
  for (let k = 0; k < 60 * 12 && !task.done; k++) {
    squad.update(dt, null);
    // Out of arm reach: never stretch hand IK across the room.
    assert.equal(giles.body.handTargets.L, null);
    assert.equal(giles.body.handTargets.R, null);
  }
  assert.equal(task.done, true);
});

test('door unlock arrival: walks within 0.30 m, turns smoothly without snapping, engages wall IK/gaze, resists Jay separation, and clears on pause/resume', () => {
  const { list, source } = horde([[0, -30]]);
  const { squad, player } = setup({ enemies: source });
  const dt = 1 / 60;
  player.body.x = 0;
  player.body.z = 5;
  squad.update(dt, null);
  const giles = squad.mate('engineer');
  giles.place({ x: 0, y: 0, z: 1 }, 0);
  const anchor = { x: 0, y: 0, z: -3.5 };
  const device = { pos: { x: -0.5, y: 1.35, z: -3.5 }, normal: { x: 1, y: 0, z: 0 }, width: 0.36, height: 0.38 };
  const task = squad.startTask('engineer', 'bypass', { at: anchor, yaw: Math.PI / 2, panel: 'D_R06_R07', device });

  let arrivalDist: number | null = null;
  let maxHeadingJump = 0;
  let prevHeading = giles.body.heading;
  for (let i = 0; i < 60 * 8 && task.state === 'walking'; i++) {
    squad.update(dt, null);
    prevHeading = giles.body.heading;
  }
  assert.equal(task.state, 'working', 'arrived and working');
  arrivalDist = Math.hypot(giles.position.x - anchor.x, giles.position.z - anchor.z);
  assert.ok(arrivalDist <= 0.3 + 1e-3, `unobstructed arrival reached ${arrivalDist.toFixed(2)} m (<= 0.30 m)`);

  // Step through smooth turn-in and verify no single-frame snap.
  for (let i = 0; i < 60; i++) {
    squad.update(dt, null);
    const jump = Math.abs(Math.atan2(Math.sin(giles.body.heading - prevHeading), Math.cos(giles.body.heading - prevHeading)));
    maxHeadingJump = Math.max(maxHeadingJump, jump);
    prevHeading = giles.body.heading;
  }
  assert.ok(maxHeadingJump < 0.25, `smooth turn-in without snap (max step ${maxHeadingJump.toFixed(3)} rad)`);
  assert.equal(giles.body.idlePose, 'panel_work');
  assert.equal(giles.body.plantFeet, true);
  assert.ok(giles.body.lookTarget && giles.body.lookTarget.distanceTo(new THREE.Vector3(-0.5, 1.35, -3.5)) < 0.05, 'looking at device');
  assert.ok(giles.body.handTargets.L && giles.body.handTargets.R, 'both hands on wall panel');
  assert.ok(giles.body.handTargetNormals.L && giles.body.handTargetNormals.R, 'wall normals supplied');

  // Jay walks right beside Giles to watch (step smoothly so we don't trigger the >4 m checkpoint-teleport guard):
  // soft separation must NOT slide Giles off the panel.
  const workPos = giles.position.clone();
  for (let i = 0; i < 60; i++) {
    player.body.x = THREE.MathUtils.lerp(player.body.x, workPos.x + 0.65, 0.12);
    player.body.z = THREE.MathUtils.lerp(player.body.z, workPos.z, 0.12);
    squad.update(dt, null);
  }
  player.body.x = workPos.x + 0.65;
  player.body.z = workPos.z;
  for (let i = 0; i < 120; i++) squad.update(dt, null);
  assert.ok(giles.position.distanceTo(workPos) < 0.05, `worker stayed planted (${giles.position.distanceTo(workPos).toFixed(3)} m drift)`);
  assert.equal(giles.body.idlePose, 'panel_work');

  // Enemy threat pauses task and clears IK/gaze; leaving resumes and re-engages IK.
  const e = list[0]!;
  e.hp = 1e9;
  e.position.x = workPos.x + 1.5;
  e.position.z = workPos.z;
  for (let i = 0; i < 30; i++) squad.update(dt, null);
  assert.equal(task.state, 'paused');
  assert.equal(giles.body.handTargets.L, null);
  assert.equal(giles.body.handTargets.R, null);
  assert.equal(giles.body.plantFeet, false);
  assert.equal(giles.body.idlePose, 'aim_pistol');

  e.position.z = -30;
  for (let i = 0; i < 90; i++) squad.update(dt, null);
  assert.equal(task.state, 'working');
  assert.equal(giles.body.idlePose, 'panel_work');
  assert.ok(giles.body.handTargets.L && giles.body.handTargets.R, 'hand IK restored on resume');
  assert.ok(giles.body.lookTarget !== null, 'device gaze restored on resume');
});

test('Okafor biometric door unlock uses biometric_scan with right palm IK on the vertical jamb screen and left hand free', () => {
  const { squad, player } = setup();
  const dt = 1 / 60;
  player.body.x = 0;
  player.body.z = 5;
  squad.update(dt, null);
  const okafor = squad.mate('medic');
  okafor.place({ x: 0, y: 0, z: 0 }, 0);
  const anchor = { x: 0, y: 0, z: -2 };
  const device = { pos: { x: 0.52, y: 1.5, z: -2 }, normal: { x: -1, y: 0, z: 0 }, width: 0.18, height: 0.22 };
  const task = squad.startTask('medic', 'biometric', { at: anchor, yaw: -Math.PI / 2, panel: 'D_R07_R09', device });
  for (let i = 0; i < 60 * 5 && task.state === 'walking'; i++) squad.update(dt, null);
  assert.equal(task.state, 'working');
  for (let i = 0; i < 90; i++) squad.update(dt, null);
  assert.equal(okafor.body.idlePose, 'biometric_scan');
  assert.equal(okafor.body.handTargets.L, null, 'left arm relaxed at side');
  assert.ok(okafor.body.handTargets.R !== null, 'right palm pressed onto jamb screen');
  assert.ok(okafor.body.handTargetNormals.R && okafor.body.handTargetNormals.R.x < -0.99, 'vertical wall normal supplied');
  for (let i = 0; i < 60 * 6 && !task.done; i++) squad.update(dt, null);
  assert.equal(task.done, true);
  assert.equal(okafor.body.handTargets.R, null, 'IK cleared when done');
  assert.equal(okafor.body.plantFeet, false, 'feet released when done');
});

test('task arrival: Jay physically blocking the anchor still allows starting within 1.5 m without Jay moving', () => {
  const { squad, player } = setup();
  const dt = 1 / 60;
  player.body.x = 0;
  player.body.z = -2;
  squad.update(dt, null);
  const giles = squad.mate('engineer');
  giles.place({ x: 0, y: 0, z: 2 }, 0);
  const task = squad.startTask('engineer', 'bypass_short', { at: { x: 0, y: 0, z: -2 }, panel: 'D2' });
  let startedAt: number | null = null;
  for (let i = 0; i < 60 * 15 && !task.done; i++) {
    squad.update(dt, null);
    // Simulate physical capsule contact with Jay standing squarely on the anchor (0.65 m combined radius).
    const dx = giles.motor.x - player.body.x;
    const dz = giles.motor.z - player.body.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.72 && d > 1e-4) {
      giles.motor.x = player.body.x + (dx / d) * 0.72;
      giles.motor.z = player.body.z + (dz / d) * 0.72;
      giles.body.group.position.set(giles.motor.x, giles.motor.y, giles.motor.z);
    }
    if (startedAt === null && task.state !== 'walking') {
      startedAt = Math.hypot(giles.position.x - 0, giles.position.z - -2);
    }
  }
  assert.ok(startedAt !== null && startedAt <= 1.5, `started at ${startedAt?.toFixed(2)} m despite Jay blocking the anchor`);
  assert.equal(task.done, true);
});

// ---------------------------------------------------------------- unify-checkpoint-restore

/** Jay at z, facing down the corridor toward -z; both squadmates placed at mateZ. */
function spread(jayZ: number, mateZ: number) {
  const s = setup();
  s.player.body.z = jayZ;
  s.player.yaw = 0;
  s.squad.update(1 / 60, null);
  s.squad.mates.forEach((m, i) => m.place({ x: i ? 1 : -1, y: 0, z: mateZ }, 0));
  return s;
}

test('requestPlacement: the next update puts unscripted squadmates beside Jay, a scripted one stays', () => {
  const { squad, player } = spread(-8, 8);
  const [a, b] = squad.mates as [SquadMate, SquadMate];
  b.scripted = true;
  squad.requestPlacement();
  squad.update(1 / 60, null);
  const near = (m: SquadMate) => Math.hypot(m.position.x - player.body.x, m.position.z - player.body.z);
  assert.ok(near(a) < 5, `${a.id} placed beside Jay (${near(a).toFixed(1)} m)`);
  assert.ok(Math.abs(b.position.z - 8) < 0.01, `${b.id} stays where the scene put him`);
});

test('regroup moves a far squadmate behind Jay, held or not', () => {
  const { squad, player } = spread(-8, 8);
  squad.mates[1]!.scripted = true;
  const moved = squad.regroup();
  assert.deepEqual([...moved].sort(), squad.mates.map((m) => m.id).sort());
  for (const m of squad.mates) assert.ok(Math.hypot(m.position.x - player.body.x, m.position.z - player.body.z) < 5, `${m.id} near Jay`);
});

test('regroup leaves a far squadmate Jay can see, and one within 12 m', () => {
  const ahead = spread(8, -8);
  assert.deepEqual(ahead.squad.regroup(), [], 'in view down the corridor');
  const close = spread(-8, 2);
  assert.deepEqual(close.squad.regroup(), [], 'within 12 m');
});

test('placeIn moves only the squadmates outside the room, to Jay', () => {
  const { squad } = spread(-5, 5);
  squad.mates[0]!.place({ x: -1, y: 0, z: -3 }, 0);
  const moved = squad.placeIn((p) => p.z < 0);
  assert.deepEqual(moved, [squad.mates[1]!.id]);
  for (const m of squad.mates) assert.ok(m.position.z < 0, `${m.id} inside`);
});

test('catchUpIn moves unseen squadmates outside the room inside without popping visible ones', () => {
  // Jay at z=-5 facing -Z (yaw 0); both squadmates behind him at z=+5 (outside z<0, unseen).
  const unseen = spread(-5, 5);
  const moved = unseen.squad.catchUpIn((p) => p.z < 0, { x: 0, y: 0, z: -1 });
  assert.equal(moved.length, 2, 'both unseen outside mates caught up');
  for (const m of unseen.squad.mates) assert.ok(m.position.z < 0, `${m.id} placed inside room`);

  // Jay at z=+5 facing -Z (yaw 0), looking straight at squadmates at z=-5 (visible): never pops them.
  const visible = spread(5, -5);
  const movedVis = visible.squad.catchUpIn((p) => p.z > 0, { x: 0, y: 0, z: 1 });
  assert.deepEqual(movedVis, [], 'visible squadmates are never popped');
  for (const m of visible.squad.mates) assert.ok(m.position.z < 0, `${m.id} stayed where it was`);
});

test('a revive is published as the medic\'s `revive` task for as long as it lasts, finished or cut off', () => {
  const { squad, player, events } = setup();
  const dt = 1 / 60;
  const reviveEvents = (): string[] =>
    events.filter((e) => (e.name === 'squad:taskStarted' || e.name === 'squad:taskDone') && (e.payload as { task: string }).task === 'revive').map((e) => e.name);
  for (let t = 0; t < 3; t += dt) squad.update(dt, null);
  assert.deepEqual(reviveEvents(), [], 'no revive, no task');
  player.downed = true;
  for (let t = 0; t < 15 && player.downed; t += dt) squad.update(dt, null);
  assert.equal(player.revived, 1);
  squad.update(dt, null);
  assert.deepEqual(reviveEvents(), ['squad:taskStarted', 'squad:taskDone'], 'started once, ended once');
  const started = events.find((e) => e.name === 'squad:taskStarted' && (e.payload as { task: string }).task === 'revive')!;
  assert.equal((started.payload as { id: string }).id, 'medic');

  // Cut off: the medic is knocked down mid-revive; the task still ends.
  player.downed = true;
  let t = 0;
  for (; t < 15 && !squad.mate('medic').revive; t += dt) squad.update(dt, null);
  for (let i = 0; i < 30; i++) squad.update(dt, null);
  squad.mate('medic').hurt(1e6, squad);
  squad.update(dt, null);
  assert.deepEqual(reviveEvents().slice(2), ['squad:taskStarted', 'squad:taskDone'], 'a revive cut short still ends its task');
});

// ------------------------------------------------------------------ squad-sidearms task 3.1: the shot comes from the pistol

/** A squad whose enemy source records each shot's damage and origin. */
function shootingRange() {
  const shots: Array<{ damage: number; origin: { x: number; y: number; z: number } }> = [];
  const enemy: SquadEnemy = { id: 'e0', position: { x: 0, y: 0, z: -4 }, alive: true, grabbing: null } as unknown as SquadEnemy;
  const source: SquadEnemySource = {
    list: () => [enemy],
    shoot(_id, _aim, damage, origin) {
      shots.push({ damage, origin: { ...origin! } });
      return false;
    },
  };
  const s = setup({ enemies: source });
  return { ...s, shots, enemy };
}

type Fired = { hit: boolean; muzzle: { x: number; y: number; z: number }; ejectPort: { x: number; y: number; z: number }; right: { x: number; y: number; z: number }; fromPistol: boolean };
const firedOf = (events: Array<{ name: string; payload: unknown }>): Fired[] => events.filter((e) => e.name === 'squad:fired').map((e) => e.payload as Fired);

test('squad shot without a pistol showing: from 1.4 m above the mate, as before (fallback)', () => {
  const { squad, events, shots, enemy } = shootingRange();
  squad.update(1 / 60, null);
  const m = squad.mates[0]!;
  assert.equal(m.body.pistol, null, 'idle: no pistol');
  squad.fire(m, enemy);
  const f = firedOf(events).at(-1)!;
  assert.equal(f.fromPistol, false);
  assert.deepEqual(f.muzzle, { x: m.position.x, y: m.position.y + 1.4, z: m.position.z });
  assert.deepEqual(f.ejectPort, f.muzzle);
  assert.ok(Math.abs(Math.hypot(f.right.x, f.right.y, f.right.z) - 1) < 1e-6);
  if (f.hit) assert.deepEqual(shots.at(-1)!.origin, f.muzzle, 'the hit origin is that point');
});

test('squad shot with the pistol up: muzzle, ejection port and right vector from the gun; the muzzle is the hit origin', () => {
  const { squad, events, shots, enemy } = shootingRange();
  const m = squad.mates[0]!;
  m.body.setPose('aim_pistol', 0.2);
  for (let i = 0; i < 40; i++) m.body.update(1 / 60);
  const gun = m.body.pistol;
  assert.ok(gun, 'aim pose: pistol showing');
  let hits = 0;
  for (let i = 0; i < 30; i++) {
    squad.fire(m, enemy);
    const f = firedOf(events).at(-1)!;
    assert.equal(f.fromPistol, true);
    m.body.group.updateMatrixWorld(true);
    const muzzle = gun.muzzle.getWorldPosition(new THREE.Vector3());
    assert.ok(muzzle.distanceTo(new THREE.Vector3(f.muzzle.x, f.muzzle.y, f.muzzle.z)) < 1e-6, 'muzzle from the marker');
    const port = new THREE.Vector3(f.ejectPort.x, f.ejectPort.y, f.ejectPort.z);
    assert.ok(port.distanceTo(muzzle) < 0.12 && port.distanceTo(muzzle) > 0.05, 'the ejection port is on the gun, behind the muzzle');
    assert.ok(Math.abs(new THREE.Vector3(f.right.x, f.right.y, f.right.z).length() - 1) < 1e-6);
    // Muzzle roughly at hand height, not the fallback point.
    assert.ok(f.muzzle.y > 0.9 && f.muzzle.y < 1.7);
    if (f.hit) {
      hits++;
      assert.deepEqual(shots.at(-1)!.origin, f.muzzle, 'the hit origin is the muzzle');
    }
  }
  assert.ok(hits > 0);
});

test('the pistol changes nothing about accuracy, damage or fire rate', () => {
  // Same seeds, one squad with the pistol up and one without: the same hit pattern and damage.
  const run = (aim: boolean) => {
    const r = shootingRange();
    const m = r.squad.mates[0]!;
    if (aim) {
      m.body.setPose('aim_pistol', 0.2);
      for (let i = 0; i < 40; i++) m.body.update(1 / 60);
      assert.ok(m.body.pistol);
    }
    for (let i = 0; i < 50; i++) r.squad.fire(m, r.enemy);
    return { hits: firedOf(r.events).map((f) => f.hit), damage: r.shots.map((s) => s.damage) };
  };
  assert.deepEqual(run(true), run(false));
});

test('catchUpIn force (a scene on rails): every mate goes to the entry, even one in view or already in the doorway (D41)', () => {
  // Jay at z=+5 facing -Z, looking at both squadmates at z=-5: a forced catch-up still brings them in.
  const visible = spread(5, -5);
  const moved = visible.squad.catchUpIn((p) => p.z > 0, { x: 0, y: 0, z: 1.5 }, true);
  assert.equal(moved.length, 2);
  for (const m of visible.squad.mates) assert.ok(m.position.z > 1, `${m.id} placed at the entry (z ${m.position.z.toFixed(2)})`);
  // One already just inside (a doorway at z 0): forced, it is moved to the entry too, off the threshold.
  const doorway = spread(5, -5);
  doorway.squad.mates[0]!.place({ x: 0, y: 0, z: 0.1 }, 0);
  doorway.squad.catchUpIn((p) => p.z > 0, { x: 0, y: 0, z: 1.5 }, true);
  assert.ok(doorway.squad.mates[0]!.position.z > 1, 'off the threshold');
});

test('squadmates lower their pistols to idle_pistol out of combat when gunDrawn is true', () => {
  const { squad } = setup({ flags: (() => ({ gunDrawn: true })) as unknown as () => Record<string, number> });
  const m = squad.mates[0]!;
  m.body.setPose('aim_pistol', 0);
  for (let i = 0; i < 40; i++) m.body.update(1 / 60);
  assert.ok(m.body.pistol, 'pistol shows while aiming');
  assert.equal(squad.restPose(), 'idle_pistol');
  for (let i = 0; i < 40; i++) squad.update(1 / 60, null);
  assert.equal(m.body.idlePose, 'idle_pistol', 'out of combat: mate lowers to idle_pistol');
  assert.ok(m.body.pistol, 'pistol stays in hand at idle_pistol');
});
