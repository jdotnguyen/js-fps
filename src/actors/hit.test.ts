/** A hit on the player (player-hit-feedback): what the `player:damaged` event says about it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EventBus, type EventMap } from '../core/events.ts';
import { describeHit } from './hit.ts';
import { Player, type PlayerDeps } from './player.ts';

const EYE = { x: 0, y: 1.7, z: 0 };
/** A head 1.2 m ahead (-Z) or behind (+Z) at eye height. */
const ahead = new THREE.Vector3(0, 1.7, -1.2);
const behind = new THREE.Vector3(0, 1.7, 1.2);

function makePlayer(playerDamageTaken = 1): { player: Player; hits: Array<EventMap['player:damaged']> } {
  const events = new EventBus();
  const deps = {
    camera: new THREE.PerspectiveCamera(),
    input: { consumeLook: () => ({ x: 0, y: 0 }), isDown: () => false, wasPressed: () => false, axis: () => 0 },
    events,
    settings: () => ({ reducedMotion: false, mouseSensitivity: 1, invertY: false, fov: 75 }),
    flashlight: { on: false, toggle: () => undefined },
    interactions: { update: () => null },
    difficulty: () => ({ playerDamageTaken, bleedOutTime: 20, reviveHp: 40, revivesPerCheckpoint: 1, grabMashCount: 6 }),
    world: { colliders: { query: () => [] }, surfaceAt: () => 'metal' },
  } as unknown as PlayerDeps;
  const hits: Array<EventMap['player:damaged']> = [];
  events.on('player:damaged', (h) => hits.push(h));
  return { player: new Player(deps), hits };
}

test('a facing attacker\'s right arm comes from the left of the view; from behind it stays on the right', () => {
  const side = (from: THREE.Vector3, arm: 'L' | 'R', yaw = 0): string | null => describeHit({ kind: 'swipe', side: arm }, 10, from, EYE, yaw, 0).side;
  assert.equal(side(ahead, 'R'), 'L');
  assert.equal(side(ahead, 'L'), 'R');
  assert.equal(side(behind, 'R'), 'R');
  assert.equal(side(behind, 'L'), 'L');
  // An attacker well off to one side is on that side whichever arm it uses.
  assert.equal(side(new THREE.Vector3(1.2, 1.7, 0), 'L'), 'R');
  assert.equal(side(new THREE.Vector3(1.2, 1.7, 0), 'R'), 'R');
  // Turned to face it, the arms split again.
  assert.equal(side(new THREE.Vector3(1.2, 1.7, 0), 'R', -Math.PI / 2), 'L');
});

test('dir is where the attacker is seen from the view', () => {
  const right = describeHit({ kind: 'bite' }, 10, new THREE.Vector3(1, 1.7, 0), EYE, 0, 0);
  assert.ok(right.dir.x > 0.99 && Math.abs(right.dir.y) < 1e-6);
  const low = describeHit({ kind: 'bite' }, 10, new THREE.Vector3(0, 0.7, -1), EYE, 0, 0);
  assert.ok(low.dir.y < -0.6 && Math.abs(low.dir.x) < 1e-6);
  // Looking down at it, it is no longer below the view.
  const looked = describeHit({ kind: 'bite' }, 10, new THREE.Vector3(0, 0.7, -1), EYE, 0, -Math.PI / 4);
  assert.ok(Math.abs(looked.dir.y) < 1e-6, `y ${looked.dir.y}`);
  assert.equal(right.side, null, 'no arm, no side');
});

test('a scripted hit is generic, with no side or direction', () => {
  const { player, hits } = makePlayer();
  player.damage(10);
  assert.equal(hits[0]!.kind, 'generic');
  assert.equal(hits[0]!.side, null);
  assert.deepEqual(hits[0]!.dir, { x: 0, y: 0 });
  assert.equal(hits[0]!.amount, 10);
});

test('severity is the damage after difficulty over 25, held within 0..1', () => {
  const normal = makePlayer();
  normal.player.damage(10);
  normal.player.damage(80);
  assert.equal(normal.hits[0]!.severity, 0.4);
  assert.equal(normal.hits[1]!.severity, 1);
  const hard = makePlayer(1.5);
  hard.player.damage(10);
  assert.ok(Math.abs(hard.hits[0]!.severity - 0.6) < 1e-9);
  assert.equal(describeHit({ kind: 'generic' }, -5, undefined, EYE, 0, 0).severity, 0);
});

test('a swipe jolts the camera, throws the aim off and gives it back', () => {
  const { player } = makePlayer();
  const cam = (player as unknown as { d: PlayerDeps }).d.camera;
  player.applyCamera(1 / 60);
  const yaw = player.yaw;
  // A facing attacker's right arm: from the left of the view, so the view goes right (yaw falls).
  player.damage(15, new THREE.Vector3(0, player.eyePosition().y, -1.2), { kind: 'swipe', side: 'R' });
  assert.equal(player.yaw, yaw, 'nothing moves before the frame');
  let off = 0;
  let roll = 0;
  for (let i = 0; i < 24; i++) {
    player.applyCamera(1 / 60);
    off = Math.min(off, player.yaw - yaw);
    roll = Math.min(roll, cam.rotation.z);
  }
  assert.ok(off < -0.005, `aim thrown ${off} rad`);
  assert.ok(roll < -0.02, `rolled ${roll} rad`);
  assert.ok(Math.abs(player.yaw - yaw) < THREE.MathUtils.degToRad(0.3), 'and back within 0.4 s');
});

test('a framed shot keeps the aim: no punch, the camera still jolts', () => {
  const { player } = makePlayer();
  player.frameView(new THREE.Vector3(0, 1.7, -10), { duration: 0 });
  const cam = (player as unknown as { d: PlayerDeps }).d.camera;
  const yaw = player.yaw;
  player.damage(15, new THREE.Vector3(0, player.eyePosition().y, -1.2), { kind: 'swipe', side: 'R' });
  for (let i = 0; i < 4; i++) player.applyCamera(1 / 60);
  assert.equal(player.yaw, yaw);
  assert.ok(Math.abs(cam.rotation.z) > 0.01);
});

test('a hit flashes towards its side and fades, apart from the low-health state', () => {
  const { player } = makePlayer();
  player.damage(15, new THREE.Vector3(0, player.eyePosition().y, -1.2), { kind: 'swipe', side: 'R' });
  assert.ok(player.hitFlash > 0.7);
  assert.deepEqual(player.hitDir.toArray(), [-1, 0]);
  player.applyCamera(0);
  const held = player.hitFlash;
  player.applyCamera(0);
  assert.equal(player.hitFlash, held, 'a frozen scene holds it');
  for (let i = 0; i < 24; i++) player.applyCamera(1 / 60);
  assert.equal(player.hitFlash, 0, 'gone within 0.4 s');
  assert.equal(player.damageFx, 0, 'and a healthy view keeps its colour');
  player.damage(70);
  for (let i = 0; i < 60; i++) player.applyCamera(1 / 60);
  assert.ok(player.damageFx > 0.2, 'low health stays');
});

test('a restart or death leaves no flash', () => {
  const { player } = makePlayer();
  player.damage(10);
  player.reset();
  assert.equal(player.hitFlash, 0);
  player.vitals.revivesUsed = 1; // no revive left: this one kills
  player.damage(1000);
  assert.equal(player.vitals.state, 'dead');
  assert.equal(player.hitFlash, 0);
});

test('an enemy hit carries its kind and the side of its arm', () => {
  const { player, hits } = makePlayer();
  player.damage(15, new THREE.Vector3(0, player.eyePosition().y, -1.2), { kind: 'swipe', side: 'R' });
  assert.equal(hits[0]!.kind, 'swipe');
  assert.equal(hits[0]!.side, 'L');
});
