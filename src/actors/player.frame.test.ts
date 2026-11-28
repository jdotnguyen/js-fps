/** Scripted shots (intro-sequence spec): the sequence owns the aim, the mouse gets a small give that springs back. */
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

test('a magnified shot eases in, doubles what is in the middle, and eases back out on the next shot', () => {
  const { player } = makePlayer();
  const camera = (player as unknown as { d: PlayerDeps }).d.camera;
  const frames = (s: number): void => {
    for (let t = 0; t < s; t += 1 / 60) player.applyCamera(1 / 60);
  };
  const size = (): number => 1 / Math.tan((camera.fov * DEG) / 2);
  frames(0.1);
  const plain = size();
  player.frameView(ahead, { duration: 0, zoom: 2 });
  frames(1 / 60);
  assert.ok(size() > plain && size() < 1.5 * plain, 'it eases rather than snapping');
  frames(1.5);
  assert.ok(Math.abs(size() / plain - 2) < 0.01, `magnified ${(size() / plain).toFixed(2)}x`);
  player.frameView(right, { duration: 0 });
  frames(1.5);
  assert.ok(Math.abs(size() / plain - 1) < 0.01, 'the next shot is unmagnified');
  player.frameView(ahead, { duration: 0, zoom: 2 });
  frames(1.5);
  player.frameView(null);
  frames(1.5);
  assert.ok(Math.abs(camera.fov - 75) < 0.1, 'released with the shot');
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

// ---- intro-sequence spec, "Heading shot on the walk": the view faces along the rails with wide mouse leeway.

function makeWalker(reducedMotion = false): { player: Player; push: (x: number, y: number) => void } {
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
  const floor = { min: [-20, -0.3, -20] as const, max: [20, 0, 20] as const };
  const deps = {
    camera: new THREE.PerspectiveCamera(),
    input,
    events: new EventBus(),
    settings: () => ({ reducedMotion, mouseSensitivity: 1, invertY: false, fov: 75 }),
    flashlight: { on: false, toggle: () => undefined },
    interactions: { update: () => null },
    difficulty: () => ({ grabMashCount: 6 }),
    world: { colliders: { query: (_a: number, _b: number, _c: number, _d: number, out: unknown[]) => (out.push(floor), out) }, surfaceAt: () => 'metal' },
  } as unknown as PlayerDeps;
  const player = new Player(deps);
  player.placeAtEye(new THREE.Vector3(0, 1.62, 0), 0);
  return { player, push: (x, y) => (look = { x, y }) };
}

const step = (p: Player, s: number): void => {
  for (let t = 0; t < s; t += 1 / 60) {
    p.update(1 / 60);
    p.look(1 / 60);
  }
};

/** North 6 m, then a 90 degree turn east: the shape of the walk out of the booth into the Commons. */
const L_CURVE = [
  { x: 0, y: 0, z: 0 },
  { x: 0, y: 0, z: -6 },
  { x: 6, y: 0, z: -6 },
];

test('heading shot: with the mouse still, the view faces along the walk and turns with the route', () => {
  const { player } = makeWalker();
  player.frameHeading();
  void player.walkTo(new THREE.Vector3(6, 0, -6), 1.3, L_CURVE);
  step(player, 2.5);
  assert.ok(Math.abs(player.yaw) < 12 * DEG, `walking north, yaw ${(player.yaw / DEG).toFixed(1)} deg`);
  assert.ok(Math.abs(player.pitch) < 2 * DEG, 'level');
  step(player, 7);
  assert.ok(Math.abs(player.yaw - -Math.PI / 2) < 12 * DEG, `after the turn east, yaw ${(player.yaw / DEG).toFixed(1)} deg`);
});

test('heading shot: the mouse gets about 35 degrees sideways and 26 vertically, never more', () => {
  const { player, push } = makeWalker();
  player.frameHeading({ duration: 0 });
  for (let i = 0; i < 40; i++) {
    push(500, 0);
    player.look(1 / 60);
  }
  assert.ok(Math.abs(player.yaw) <= 35 * DEG + 1e-6, `yaw ${(player.yaw / DEG).toFixed(1)} deg`);
  assert.ok(Math.abs(player.yaw) > 33 * DEG, 'the leeway is reachable');
  const { player: p2, push: push2 } = makeWalker();
  p2.frameHeading({ duration: 0 });
  for (let i = 0; i < 40; i++) {
    push2(0, 500);
    p2.look(1 / 60);
  }
  assert.ok(Math.abs(p2.pitch) <= 26.25 * DEG + 1e-6, `pitch ${(p2.pitch / DEG).toFixed(1)} deg`);
  assert.ok(Math.abs(p2.pitch) > 24 * DEG);
});

test('heading shot: looking aside holds for about half a second, then settles back over about a second', () => {
  const { player, push } = makeWalker();
  player.frameHeading({ duration: 0 });
  for (let i = 0; i < 20; i++) {
    push(80, 0);
    player.look(1 / 60);
  }
  const aside = player.yaw;
  assert.ok(Math.abs(aside) > 20 * DEG, `looked aside ${(aside / DEG).toFixed(1)} deg`);
  run(player, 0.35);
  assert.ok(Math.abs(player.yaw - aside) < 1 * DEG, 'still held where the mouse left it');
  run(player, 0.25 + 1.2);
  assert.ok(Math.abs(player.yaw) < 2 * DEG, `settled back, yaw ${(player.yaw / DEG).toFixed(1)} deg`);
});

test('heading shot: with reduced motion the view follows the route turn more slowly', () => {
  const yawAfterTurn = (reduced: boolean): number => {
    const { player } = makeWalker(reduced);
    player.frameHeading();
    void player.walkTo(new THREE.Vector3(6, 0, -6), 1.3, L_CURVE);
    // Walk until the route has turned east, then a moment more.
    let turned = -1;
    for (let t = 0; t < 12 && turned < 0.25; t += 1 / 60) {
      player.update(1 / 60);
      player.look(1 / 60);
      if (turned >= 0) turned += 1 / 60;
      else if (player.body.x > 1) turned = 0;
    }
    return player.yaw;
  };
  const normal = yawAfterTurn(false);
  const reduced = yawAfterTurn(true);
  // Both are turning from 0 toward -90 deg; reduced motion lags behind.
  assert.ok(reduced > normal + 1 * DEG, `reduced ${(reduced / DEG).toFixed(1)} vs normal ${(normal / DEG).toFixed(1)} deg`);
});

test('a sweep pans steadily from the aim across to its second point over the shot', () => {
  const { player } = makePlayer();
  const eye = player.eyePosition(new THREE.Vector3());
  const left = new THREE.Vector3(eye.x - 5, eye.y, eye.z - 5);
  const right = new THREE.Vector3(eye.x + 5, eye.y, eye.z - 5);
  player.frameView(left, { duration: 0 });
  player.frameView(left, { duration: 3, sweep: right });
  const yaws: number[] = [];
  for (let i = 0; i < 240; i++) {
    player.look(1 / 60);
    if (i % 30 === 29) yaws.push(player.yaw / DEG);
  }
  assert.ok(yaws.every((y, k) => k === 0 || y <= yaws[k - 1]! + 1e-6), `one way: ${yaws.map((y) => y.toFixed(0)).join(' ')}`);
  assert.ok(Math.abs(yaws[2]!) < 20, `about half way across at half time, ${yaws[2]!.toFixed(1)}`);
  assert.ok(Math.abs(yaws.at(-1)! - -45) < 1, `ends on the second point, ${yaws.at(-1)!.toFixed(1)}`);
});
