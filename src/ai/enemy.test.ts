import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SLAM, slamFalloff } from '../actors/slam.ts';
import { GRAB_BREAK_DAMAGE } from './enemy.ts';
import { director, room, run, stubTarget } from './enemyTestKit.ts';

const kinds = (log: Array<[string, unknown]>, name: string): unknown[] => log.filter(([n]) => n === name).map(([, p]) => p);

test('dormant -> alerted -> chase -> windup -> swipe -> recover, damaging the target', () => {
  const { dir, log } = director();
  const p = stubTarget('player', [0, 0, 0], { grabbable: false });
  dir.addTarget(p);
  const e = dir.spawn('shambler', { x: 0, y: 0, z: -6 }, 0); // heading 0 faces -Z: back to the player
  run(dir, 1);
  assert.equal(e.state, 'dormant', 'behind it, 6 m: not seen');
  // Step into view.
  e.body.setHeading(Math.PI);
  const seen: string[] = [];
  run(dir, 12, () => p.hits.length > 0, () => {
    if (seen.at(-1) !== e.state) seen.push(e.state);
  });
  assert.deepEqual(seen.slice(0, 4), ['dormant', 'alerted', 'chase', 'windup']);
  assert.equal(p.hits[0]!.kind, 'swipe');
  assert.equal(p.hits[0]!.amount, 15);
  assert.equal(e.state, 'recover');
  assert.equal(kinds(log, 'combat:first').length, 1);
  assert.equal(kinds(log, 'enemy:alerted').length, 1);
  assert.equal(kinds(log, 'enemy:attack').length, 1);
});

test('a staggered body does not start an attack; stagger then resumes the chase', () => {
  const { dir } = director();
  const p = stubTarget('player', [0, 0, 0], { grabbable: false });
  dir.addTarget(p);
  const e = dir.spawn('shambler', { x: 0, y: 0, z: -1.2 }, Math.PI);
  run(dir, 2, () => e.state === 'chase');
  dir.staggerEnemy(e, 0.9);
  assert.equal(e.state, 'stagger');
  assert.ok(e.body.staggered);
  run(dir, 0.8);
  assert.equal(e.state, 'stagger');
  assert.equal(p.hits.length, 0);
  run(dir, 3, () => e.state === 'windup');
  assert.equal(e.state, 'windup');
});

test('hearing a gunshot alerts a dormant enemy facing away; alert spreads within 6 m', () => {
  const { dir } = director();
  const p = stubTarget('player', [0, 0, 6], { grabbable: false });
  p.light = false;
  dir.addTarget(p);
  const a = dir.spawn('shambler', { x: 0, y: 0, z: -4 }, 0);
  const b = dir.spawn('shambler', { x: 4, y: 0, z: -7 }, 0);
  const far = dir.spawn('shambler', { x: -9, y: 0, z: -9 }, 0);
  far.body.setHeading(0);
  run(dir, 0.5);
  assert.equal(a.state, 'dormant');
  dir.noise('footstep', p.pos, 'player');
  run(dir, 0.1);
  assert.equal(a.state, 'dormant', 'footsteps carry 4 m');
  dir.noise('gunshot', p.pos, 'player');
  assert.equal(a.state, 'alerted');
  assert.equal(a.memory.targetId, 'player');
  assert.equal(b.state, 'alerted', 'heard it too (or was told)');
  run(dir, 3);
  assert.ok(a.state === 'chase' || a.state === 'windup');
});

test('grab: the player is held and hurt, mashing free staggers the grabber', () => {
  const { dir, log } = director();
  const p = stubTarget('player', [0, 0, 0]);
  dir.addTarget(p);
  const e = dir.spawn('shambler', { x: 0, y: 0, z: -1.2 }, Math.PI);
  dir.rng.chance = () => true; // always grab
  run(dir, 4, () => e.state === 'grab');
  assert.equal(e.state, 'grab');
  assert.ok(p.grabbed);
  assert.equal(dir.grabber, e);
  run(dir, 1);
  const held = p.hits.filter((h) => h.kind === 'grab').reduce((s, h) => s + h.amount, 0);
  assert.ok(Math.abs(held - 8) < 2.1, `8 damage per second while held (got ${held})`);
  // The player mashes free.
  p.grabbed = false;
  run(dir, 0.1);
  assert.equal(e.state, 'stagger');
  assert.equal(dir.grabber, null);
  assert.deepEqual(kinds(log, 'enemy:grabReleased'), [{ id: e.id, reason: 'escaped' }]);
});

test('grab: a teammate shooting the grabber off releases the player', () => {
  const { dir, log } = director();
  const p = stubTarget('player', [0, 0, 0]);
  const mate = stubTarget('engineer', [3, 0, 3]);
  dir.addTarget(p);
  dir.addTarget(mate);
  const e = dir.spawn('shambler', { x: 0, y: 0, z: -1.2 }, Math.PI);
  dir.rng.chance = () => true;
  run(dir, 4, () => e.state === 'grab');
  assert.ok(dir.list.some((x) => x.grabbing));
  // Squad API: find the grabber, shoot its arm.
  const grabber = dir.list.find((x) => x.grabbing)!;
  grabber.body.group.updateMatrixWorld(true);
  const arm = grabber.body.jointWorld('foreArm_R');
  const from = new THREE.Vector3(arm.x + 3, arm.y, arm.z);
  const rayDir = arm.clone().sub(from).normalize();
  let freed = false;
  for (let i = 0; i < 6 && !freed; i++) {
    const hit = dir.raycast(from, rayDir, 10);
    assert.ok(hit, 'the arm is hittable');
    dir.applyHit(hit, 18, rayDir, 'engineer');
    freed = !p.grabbed;
  }
  assert.ok(freed);
  assert.equal(dir.grabber, null);
  assert.ok(kinds(log, 'enemy:grabReleased').some((r) => (r as { reason: string }).reason === 'shot'));
  assert.ok(GRAB_BREAK_DAMAGE > 0);
});

test('play-dead: lies still, wakes when the player comes within 3 m', () => {
  const { dir } = director();
  const p = stubTarget('player', [0, 0, 8], { grabbable: false });
  dir.addTarget(p);
  const e = dir.spawn('playDead', { x: 0, y: 0, z: 0 }, 0);
  assert.equal(e.body.state, 'playingDead');
  run(dir, 2);
  assert.equal(e.state, 'playDead', 'in plain view 8 m away it stays down');
  p.pos.set(0, 0, 2.5);
  run(dir, 0.3);
  assert.equal(e.state, 'waking');
  run(dir, 3, () => e.state === 'chase');
  assert.equal(e.body.state, 'alive');
  assert.ok(e.state === 'chase' || e.state === 'windup');
});

test('play-dead: wakes behind a player who walks past and looks away', () => {
  const { dir } = director();
  const p = stubTarget('player', [0, 0, 5], { grabbable: false });
  p.facing.set(0, 0, -1); // looking at it
  dir.addTarget(p);
  const e = dir.spawn('playDead', { x: 0, y: 0, z: 0 }, 0);
  run(dir, 1);
  assert.equal(e.state, 'playDead');
  p.facing.set(0, 0, 1); // turned away, still 5 m off
  run(dir, 0.3);
  assert.equal(e.state, 'waking');
});

test('play-dead: being shot wakes it', () => {
  const { dir } = director();
  dir.addTarget(stubTarget('player', [0, 0, 12], { grabbable: false }));
  const e = dir.spawn('playDead', { x: 0, y: 0, z: 0 }, 0);
  run(dir, 0.5);
  e.body.group.updateMatrixWorld(true);
  const chest = e.body.jointWorld('chest');
  const from = chest.clone().add(new THREE.Vector3(0, 2, 0));
  const hit = dir.raycast(from, new THREE.Vector3(0, -1, 0), 5);
  assert.ok(hit);
  dir.applyHit(hit, 18, new THREE.Vector3(0, -1, 0), 'player');
  assert.equal(e.state, 'waking');
});

test('hero: walks in, slams through tryAttack; falloff damage and knockback to player and squad', () => {
  const { dir, log } = director();
  const p = stubTarget('player', [0, 0, 0], { grabbable: false });
  const mate = stubTarget('medic', [0.9, 0, 0.3]);
  dir.addTarget(p);
  dir.addTarget(mate);
  const h = dir.spawn('hero', { x: 0, y: 0, z: -4 }, Math.PI);
  run(dir, 10, () => kinds(log, 'enemy:slam').length > 0);
  assert.equal(kinds(log, 'enemy:slam').length, 1);
  assert.ok(p.hits.some((x) => x.kind === 'slam'), 'player hit');
  const ph = p.hits.find((x) => x.kind === 'slam')!;
  assert.ok(ph.amount > 0 && ph.amount <= SLAM.damage);
  assert.ok(p.knocked.length === 1 && p.knocked[0]!.speed > 0);
  const at = kinds(log, 'enemy:slam')[0] as { x: number; z: number };
  const mateFalloff = slamFalloff(Math.hypot(mate.pos.x - at.x, mate.pos.z - at.z));
  assert.equal(mate.hits.some((x) => x.kind === 'slam'), mateFalloff > 0, 'squad in reach takes it too');
  assert.equal(h.hero, true);
});

test('difficulty scales enemy HP at spawn', () => {
  const { dir } = director(room(), { enemyHp: 1.25 });
  const e = dir.spawn('shambler', { x: 0, y: 0, z: 0 }, 0);
  assert.equal(e.body.damage.baseHp, 56.25);
  const h = dir.spawn('hero', { x: 3, y: 0, z: 0 }, 0);
  assert.equal(h.body.damage.baseHp, 225);
});

test('shove pushes and staggers enemies in the cone; shotgun blasts knock back', () => {
  const { dir } = director();
  dir.addTarget(stubTarget('player', [0, 0, 0], { grabbable: false }));
  const e = dir.spawn('shambler', { x: 0, y: 0, z: -1.1 }, Math.PI);
  const off = dir.spawn('shambler', { x: 3, y: 0, z: 2 }, Math.PI);
  run(dir, 0.2);
  const z0 = e.motor.z;
  assert.equal(dir.shove([0, 1.6, 0], [0, 0, -1], 1.4, 70, 5, 1.5), 1);
  assert.equal(e.state, 'stagger');
  assert.ok(e.motor.z < z0, 'pushed away');
  assert.notEqual(off.state, 'stagger');
  // Shotgun at point blank, aimed at the chest.
  run(dir, 2);
  e.body.group.updateMatrixWorld(true);
  const eye = new THREE.Vector3(0, 1.6, 1);
  const chest = e.body.jointWorld('chest');
  const view = chest.clone().sub(eye).normalize();
  let k = 0;
  const report = dir.playerShot('shotgun', eye, view, 1, () => ((k = (k * 9301 + 49297) % 233280) / 233280));
  assert.ok(report.bodyHits >= 3, `pellets on the body: ${report.bodyHits}`);
  assert.equal(e.state, 'stagger');
});

test('dead enemies report enemy:died; corpses are capped', () => {
  const { dir, log } = director();
  const e = dir.spawn('shambler', { x: 0, y: 0, z: 0 }, 0);
  e.body.hurt('torso', 1e6);
  run(dir, 0.1);
  assert.equal(e.state, 'dead');
  assert.equal(e.body.state, 'dead');
  assert.equal(kinds(log, 'enemy:died').length, 1);
  for (let i = 0; i < 20; i++) dir.spawn('shambler', { x: -8 + (i % 8) * 2, y: 0, z: -8 + Math.floor(i / 8) * 2 }, 0).body.hurt('torso', 1e6);
  run(dir, 0.1);
  assert.equal(dir.list.filter((x) => !x.alive).length, 16);
});

/** Shoot a joint of an enemy from the side until `done`. */
function shootJoint(dir: ReturnType<typeof director>['dir'], e: ReturnType<ReturnType<typeof director>['dir']['spawn']>, joint: Parameters<typeof e.body.jointWorld>[0], done: () => boolean): void {
  for (let i = 0; i < 12 && !done(); i++) {
    e.body.group.updateMatrixWorld(true);
    const at = e.body.jointWorld(joint);
    if (joint === 'head') at.y += 0.09;
    // Heads from above (the hunch puts the chest beside the head), limbs from the side.
    const from = at.clone().add(joint === 'head' ? new THREE.Vector3(0, 2, 0) : new THREE.Vector3(3, 0.05, 0));
    const ray = at.clone().sub(from).normalize();
    const hit = dir.raycast(from, ray, 6);
    if (hit) dir.applyHit(hit, 18, ray, 'player');
    run(dir, 0.05);
  }
}

test('crawl: a lost leg drops it into a crawl; it still comes on and bites low and close', () => {
  const { dir } = director();
  const p = stubTarget('player', [0, 0, 0]);
  dir.addTarget(p);
  const e = dir.spawn('shambler', { x: 0, y: 0, z: -5 }, Math.PI);
  run(dir, 0.3);
  shootJoint(dir, e, 'shin_L', () => e.body.locomotion.mode !== 'walk');
  assert.equal(e.body.locomotion.mode, 'crawl');
  dir.rng.chance = () => true; // would grab if it could
  run(dir, 25, () => p.hits.length > 0);
  assert.ok(p.hits.length > 0, 'reached and attacked');
  assert.equal(p.hits[0]!.kind, 'bite');
  assert.equal(p.grabbed, false, 'crawlers never grab');
});

test('blind: with the head gone it no longer sees, but feels a target up close', () => {
  const { dir } = director();
  const p = stubTarget('player', [0, 0, 0], { grabbable: false });
  dir.addTarget(p);
  dir.ignorePlayer = true;
  const e = dir.spawn('shambler', { x: 0, y: 0, z: -4 }, Math.PI);
  run(dir, 0.2);
  shootJoint(dir, e, 'head', () => e.body.locomotion.blind || !e.alive);
  assert.ok(e.alive && e.body.locomotion.blind);
  e.memory.clear();
  e.setState('dormant');
  dir.ignorePlayer = false;
  run(dir, 1.5);
  assert.equal(e.state, 'dormant', 'cannot see the player 4 m ahead');
  p.pos.set(e.motor.x, 0, e.motor.z + 1.2);
  run(dir, 0.5);
  assert.notEqual(e.state, 'dormant');
});

test('player shots: walls stop the hitscan; the shot is heard', () => {
  const w = room([{ min: [-3, 0, -2.2], max: [3, 3, -2] }]);
  const { dir } = director(w);
  dir.addTarget(stubTarget('player', [0, 0, 0], { grabbable: false }));
  const e = dir.spawn('shambler', { x: 0, y: 0, z: -4 }, 0);
  run(dir, 0.2);
  e.body.group.updateMatrixWorld(true);
  const eye = new THREE.Vector3(0, 1.6, 0);
  const view = e.body.jointWorld('chest').sub(eye).normalize();
  const report = dir.playerShot('pistol', eye, view, 1, () => 0.5);
  assert.equal(report.bodyHits, 0);
  assert.ok(report.wall, 'hit the wall');
  assert.equal(e.body.damage.hpOf('torso'), e.body.damage.maxHp.torso);
  // No wall: it lands.
  const { dir: d2 } = director();
  d2.addTarget(stubTarget('player', [0, 0, 0], { grabbable: false }));
  const e2 = d2.spawn('shambler', { x: 0, y: 0, z: -4 }, 0);
  run(d2, 0.2);
  e2.body.group.updateMatrixWorld(true);
  const v2 = e2.body.jointWorld('chest').sub(eye).normalize();
  assert.equal(d2.playerShot('pistol', eye, v2, 1, () => 0.5).bodyHits, 1);
  assert.ok(e2.body.damage.hpOf('torso') < e2.body.damage.maxHp.torso);
  assert.equal(e2.state, 'alerted', 'shot from behind: it turns on the shooter');
});

test('reach: an enemy on a ceiling slab above Jay never winds up, hits or grabs him through it', () => {
  // A roof slab over the whole room at 4.00-4.12: the enemy stands on it, 1 m from Jay horizontally.
  const { dir } = director(room([{ min: [-10, 4, -10], max: [10, 4.12, 10] }]));
  const p = stubTarget('player', [0, 0, 0]);
  dir.addTarget(p);
  const e = dir.spawn('shambler', { x: 1, y: 4.12, z: 0 }, Math.PI / 2);
  e.sense(p.pos, 'sound', 'player', dir);
  const states = new Set<string>();
  run(dir, 10, undefined, () => {
    states.add(e.state);
    e.sense(p.pos, 'sound', 'player', dir);
  });
  assert.ok(Math.abs(e.motor.y - 4.12) < 1e-3, `stayed on the slab (y ${e.motor.y})`);
  assert.ok(!states.has('windup'), `states: ${[...states].join(', ')}`);
  assert.equal(p.hits.length, 0);
  assert.equal(p.grabbed, false);
});

test('reach: Jay on a 1 m crate is still in reach of an enemy beside it', () => {
  const { dir } = director(room([{ min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] }]));
  const p = stubTarget('player', [0, 1, 0], { grabbable: false });
  dir.addTarget(p);
  const e = dir.spawn('shambler', { x: 1.1, y: 0, z: 0 }, Math.PI / 2);
  e.sense(p.pos, 'sound', 'player', dir);
  run(dir, 10, () => p.hits.length > 0, () => e.sense(p.pos, 'sound', 'player', dir));
  assert.ok(p.hits.length > 0, `no hit (state ${e.state})`);
});
