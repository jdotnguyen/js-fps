/** Scripted walks follow nav paths; people are solid to Jay (walk, sprint, scripted). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EventBus } from '../core/events.ts';
import { gridNodes, NavGraph } from '../ai/nav.ts';
import { BoxColliders, type Aabb } from './motor.ts';
import { Player, type PlayerDeps } from './player.ts';
import type { Circle } from './bodyPush.ts';

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Aabb => ({ min: [x0, y0, z0], max: [x1, y1, z1] });
const DT = 1 / 60;
const SEP = 0.35 + 0.3;

function make(boxes: Aabb[], keys: { forward: boolean; sprint: boolean } = { forward: false, sprint: false }): Player {
  const input = {
    consumeLook: () => ({ x: 0, y: 0 }),
    isDown: (a: string) => a === 'sprint' && keys.sprint,
    wasPressed: () => false,
    axis: (_neg: string, pos: string) => (pos === 'moveForward' && keys.forward ? 1 : 0),
  };
  const deps = {
    camera: new THREE.PerspectiveCamera(),
    input,
    events: new EventBus(),
    settings: () => ({ reducedMotion: false, mouseSensitivity: 1, invertY: false, fov: 75 }),
    flashlight: { on: false, toggle: () => undefined },
    interactions: { update: () => null },
    difficulty: () => ({ grabMashCount: 6 }),
    world: { colliders: new BoxColliders(boxes), surfaceAt: () => 'metal' },
  } as unknown as PlayerDeps;
  return new Player(deps);
}

const place = (p: Player, x: number, z: number): void => p.placeAtEye(new THREE.Vector3(x, 1.62, z), 0);

/** L-shaped corridor: east along z 0..2 from x 0, then south along x 8..10 to z 12. Inside corner at (8, 2). */
function lWorld(): Aabb[] {
  return [
    box(-1, -0.3, -1, 11, 0, 13), // floor
    box(-1, 0, -1, 11, 3, 0), // north wall
    box(-1, 0, -1, 0, 3, 2), // west end
    box(-1, 0, 2, 8, 3, 13), // inside block
    box(10, 0, -1, 11, 3, 13), // east wall
    box(8, 0, 12, 11, 3, 13), // south end
  ];
}

test('a nav walk goes round the inside corner of an L corridor and arrives', () => {
  const boxes = lWorld();
  const p = make(boxes);
  p.setNav(new NavGraph({ world: new BoxColliders(boxes), nodes: gridNodes(new BoxColliders(boxes), { minX: 0.5, maxX: 9.5, minZ: 0.5, maxZ: 11.5, maxY: 0.5 }, 1) }));
  place(p, 1, 1);
  void p.walkTo(new THREE.Vector3(9, 0, 11));
  let minCorner = Infinity;
  let t = 0;
  for (; t < 30 && p.onRails; t += DT) {
    p.update(DT);
    // Distance from Jay to the inside-corner box (x<=8, z>=2).
    minCorner = Math.min(minCorner, Math.hypot(Math.max(0, p.body.x - 8), Math.max(0, 2 - p.body.z)));
  }
  assert.equal(p.onRails, false, 'walk finished');
  assert.ok(Math.hypot(p.body.x - 9, p.body.z - 11) < 0.2, `ended at ${p.body.x}, ${p.body.z}`);
  assert.ok(minCorner > 0.25, `min corner distance ${minCorner}`);
  // Path length is ~ 8 + 10 = 18 m at 1.92 m/s: well under the 30 s cap.
  assert.ok(t < 16, `took ${t}s`);
});

test('a camera-height anchor still paths on the feet', () => {
  const boxes = lWorld();
  const p = make(boxes);
  p.setNav(new NavGraph({ world: new BoxColliders(boxes), nodes: gridNodes(new BoxColliders(boxes), { minX: 0.5, maxX: 9.5, minZ: 0.5, maxZ: 11.5, maxY: 0.5 }, 1) }));
  place(p, 1, 1);
  void p.walkTo(new THREE.Vector3(9, 1.2, 11));
  for (let t = 0; t < 25 && p.onRails; t += DT) p.update(DT);
  assert.ok(Math.hypot(p.body.x - 9, p.body.z - 11) < 0.2);
});

const room = (): Aabb[] => [box(-20, -0.3, -20, 20, 0, 20)];

function overlapRun(keys: { forward: boolean; sprint: boolean }, body: Circle, moveBody?: (t: number) => void): number {
  const p = make(room(), keys);
  p.setBodies(() => [body]);
  place(p, 0, 0);
  let worst = 0;
  for (let t = 0; t < 4; t += DT) {
    moveBody?.(t);
    p.update(DT);
    worst = Math.max(worst, SEP - Math.hypot(p.body.x - body.x, p.body.z - body.z));
  }
  return worst;
}

test('Jay never overlaps a body by more than 2 cm walking or sprinting into it', () => {
  assert.ok(overlapRun({ forward: true, sprint: false }, { x: 0, z: -3, r: 0.3 }) < 0.02);
  assert.ok(overlapRun({ forward: true, sprint: true }, { x: 0, z: -3, r: 0.3 }) < 0.02);
  assert.ok(overlapRun({ forward: true, sprint: true }, { x: 0.1, z: -3, r: 0.3 }) < 0.02);
  // A body walking into Jay is pushed out of too.
  const b = { x: 0, z: -4, r: 0.3 };
  assert.ok(overlapRun({ forward: false, sprint: false }, b, () => (b.z += DT * 2)) < 0.02);
});

test('a scripted walk into a body waits instead of passing through', () => {
  const body = { x: 0, z: -3, r: 0.3 };
  const p = make(room());
  p.setBodies(() => [body]);
  place(p, 0, 0);
  let arrived = false;
  void p.walkTo(new THREE.Vector3(0, 0, -6)).then(() => (arrived = true));
  let worst = 0;
  for (let t = 0; t < 8; t += DT) {
    p.update(DT);
    worst = Math.max(worst, SEP - Math.hypot(p.body.x - body.x, p.body.z - body.z));
  }
  assert.ok(worst < 0.02, `overlap ${worst}`);
  assert.equal(arrived, false);
  assert.ok(p.wish.z < -0.9, 'still trying to go on');
});

test('wish stays non-zero while blocked by a body and is zero when idle', () => {
  const body = { x: 0, z: -2, r: 0.3 };
  const keys = { forward: true, sprint: false };
  const p = make(room(), keys);
  p.setBodies(() => [body]);
  place(p, 0, 0);
  for (let t = 0; t < 3; t += DT) p.update(DT);
  assert.ok(Math.abs(Math.hypot(p.body.x - body.x, p.body.z - body.z) - SEP) < 0.03, 'pressed against it');
  assert.ok(Math.hypot(p.wish.x, p.wish.z) > 0.99);
  keys.forward = false;
  p.update(DT);
  assert.deepEqual({ x: p.wish.x, z: p.wish.z }, { x: 0, z: 0 });
});

test('walkTo still resolves on arrival and on cancelWalk', async () => {
  const p = make(room());
  place(p, 0, 0);
  let n = 0;
  const a = p.walkTo(new THREE.Vector3(2, 0, 0)).then(() => n++);
  for (let t = 0; t < 4 && p.onRails; t += DT) p.update(DT);
  await a;
  assert.equal(n, 1);
  assert.ok(Math.abs(p.body.x - 2) < 0.15);
  const b = p.walkTo(new THREE.Vector3(9, 0, 0)).then(() => n++);
  p.update(DT);
  p.cancelWalk();
  await b;
  assert.equal(n, 2);
  assert.equal(p.onRails, false);
});
