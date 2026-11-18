/** ADR-0017 scripted shots: the sequence owns the aim, the mouse gets a small give that springs back. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EventBus } from '../core/events.ts';
import { Player, type PlayerDeps } from './player.ts';

const DEG = Math.PI / 180;

function makePlayer(reducedMotion = false): { player: Player; push: (x: number, y: number) => void } {
  let look = { x: 0, y: 0 };
  const input = {
    consumeLook: () => {
      const l = look;
      look = { x: 0, y: 0 };
      return l;
    },
    isDown: () => false,
    wasPressed: () => false,
    axis: () => 0,
  };
  const deps = {
    camera: new THREE.PerspectiveCamera(),
    input,
    events: new EventBus(),
    settings: () => ({ reducedMotion, mouseSensitivity: 1, invertY: false, fov: 75 }),
    flashlight: { on: false, toggle: () => undefined },
    interactions: { update: () => null },
    difficulty: () => ({ grabMashCount: 6 }),
    world: { colliders: { query: () => [] }, surfaceAt: () => 'metal' },
  } as unknown as PlayerDeps;
  const player = new Player(deps);
  return { player, push: (x, y) => (look = { x, y }) };
}

const run = (p: Player, s: number): void => {
  for (let t = 0; t < s; t += 1 / 60) p.look(1 / 60);
};

// Eye is at (0, 1.62, 0); a target straight ahead along -Z at eye height.
const ahead = new THREE.Vector3(0, 1.62, -10);
const right = new THREE.Vector3(10, 1.62, 0);

test('a shot eases the view onto its target and holds it', () => {
  const { player } = makePlayer();
  player.frameView(right, { duration: 0.8 });
  run(player, 3);
  assert.ok(Math.abs(player.yaw - -Math.PI / 2) < 0.5 * DEG, `yaw ${player.yaw}`);
  assert.ok(player.framed);
});

test('the mouse pushes the view at most 6 degrees off the shot', () => {
  const { player, push } = makePlayer();
  player.frameView(ahead, { duration: 0 });
  for (let i = 0; i < 30; i++) {
    push(500, 0);
    player.look(1 / 60);
  }
  assert.ok(Math.abs(player.yaw) <= 6 * DEG + 1e-6, `yaw ${player.yaw / DEG} deg`);
  assert.ok(Math.abs(player.yaw) > 5 * DEG, 'the give is actually reachable');
});

test('the give springs back to the scripted aim when the mouse is still', () => {
  const { player, push } = makePlayer();
  player.frameView(ahead, { duration: 0 });
  push(500, 0);
  player.look(1 / 60);
  run(player, 0.5);
  assert.ok(Math.abs(player.yaw) < 0.2 * DEG, `yaw ${player.yaw / DEG} deg`);
});

test('duration 0 snaps at once, and releasing keeps the view where it is', () => {
  const { player } = makePlayer();
  player.frameView(right, { duration: 0 });
  assert.ok(Math.abs(player.yaw - -Math.PI / 2) < 1e-6);
  player.frameView(null);
  assert.equal(player.framed, false);
  run(player, 0.5);
  assert.ok(Math.abs(player.yaw - -Math.PI / 2) < 1e-6);
});

test('reduced motion turns more slowly', () => {
  const normal = makePlayer(false).player;
  const reduced = makePlayer(true).player;
  for (const p of [normal, reduced]) {
    p.frameView(right, { duration: 0.8 });
    run(p, 0.3);
  }
  assert.ok(Math.abs(reduced.yaw) < Math.abs(normal.yaw), `${reduced.yaw} vs ${normal.yaw}`);
});
