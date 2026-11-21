import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BodyHandle, PhysicsEngine, Quat } from './engine.ts';
import { createRapierEngine } from './rapierAdapter.ts';

// adopt-physics-engine Block 0, task 1.3: the adapter behaves as the engine interface promises.

const STEP = 1 / 60;
const run = (e: PhysicsEngine, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds / STEP); i++) e.step(STEP);
};

/** A 10 x 10 m floor whose top is at y = 0. */
function floor(e: PhysicsEngine): void {
  e.createCollider({ shape: { kind: 'cuboid', halfExtents: { x: 5, y: 0.1, z: 5 } }, offset: { x: 0, y: -0.1, z: 0 }, tag: 1 }, null);
}

/** Rotation angle (radians) of the relative rotation between two quaternions. */
function angleBetween(a: Quat, b: Quat): number {
  const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  return 2 * Math.acos(Math.min(1, dot));
}

test('a dropped box lands on a fixed box and goes to sleep', async () => {
  const e = await createRapierEngine();
  floor(e);
  const box = e.createBody({ kind: 'dynamic', position: { x: 0, y: 2, z: 0 } });
  e.createCollider({ shape: { kind: 'cuboid', halfExtents: { x: 0.25, y: 0.25, z: 0.25 } } }, box);
  run(e, 3);
  const y = e.transform(box).position.y;
  assert.ok(Math.abs(y - 0.25) < 0.02, `box rests on the floor (y = ${y.toFixed(3)})`);
  assert.equal(e.isSleeping(box), true);
  e.destroy();
});

test('destroying everything leaves zero live bodies, colliders and joints', async () => {
  const e = await createRapierEngine();
  floor(e);
  const bodies: BodyHandle[] = [];
  for (let i = 0; i < 3; i++) {
    const b = e.createBody({ kind: 'dynamic', position: { x: i, y: 1, z: 0 } });
    e.createCollider({ shape: { kind: 'ball', radius: 0.1 } }, b);
    bodies.push(b);
  }
  const j = e.createJoint({ kind: 'spherical', anchorA: { x: 0.5, y: 0, z: 0 }, anchorB: { x: -0.5, y: 0, z: 0 } }, bodies[0]!, bodies[1]!);
  assert.deepEqual(e.liveCounts(), { bodies: 3, colliders: 4, joints: 1 });
  e.destroyJoint(j);
  for (const b of bodies) e.destroyBody(b);
  assert.deepEqual(e.liveCounts(), { bodies: 0, colliders: 1, joints: 0 }, 'only the floor is left');
  e.destroy();
  assert.deepEqual(e.liveCounts(), { bodies: 0, colliders: 0, joints: 0 });
});

test('a fast body with CCD reports its first contact on a thin wall and stays on its side', async () => {
  const e = await createRapierEngine({ x: 0, y: 0, z: 0 });
  e.createCollider({ shape: { kind: 'cuboid', halfExtents: { x: 0.05, y: 2, z: 2 } }, offset: { x: 2, y: 0, z: 0 }, tag: 7 }, null);
  const limb = e.createBody({ kind: 'dynamic', position: { x: 0, y: 0, z: 0 }, linvel: { x: 60, y: 0, z: 0 }, ccd: true });
  e.createCollider({ shape: { kind: 'capsule', halfHeight: 0.2, radius: 0.06 }, contactEvents: true, tag: 9 }, limb);
  run(e, 0.25);
  const contacts = e.drainContacts();
  assert.ok(contacts.length >= 1, 'contact reported');
  const c = contacts[0]!;
  assert.deepEqual(new Set([c.tagA, c.tagB]), new Set([7, 9]));
  assert.ok(Math.abs(c.point.x - 1.95) < 0.15, `contact on the wall face (x = ${c.point.x.toFixed(2)})`);
  assert.ok(e.transform(limb).position.x < 2, 'did not tunnel through');
  e.destroy();
});

test('raycasts hit the nearest collider and skip disabled ones', async () => {
  const e = await createRapierEngine();
  const near = e.createCollider({ shape: { kind: 'cuboid', halfExtents: { x: 0.1, y: 1, z: 1 } }, offset: { x: 2, y: 0, z: 0 }, tag: 2 }, null);
  e.createCollider({ shape: { kind: 'cuboid', halfExtents: { x: 0.1, y: 1, z: 1 } }, offset: { x: 5, y: 0, z: 0 }, tag: 5 }, null);
  e.step(STEP);
  const hit = e.raycast({ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, 10);
  assert.equal(hit?.tag, 2);
  assert.ok(Math.abs(hit!.distance - 1.9) < 1e-3);
  assert.ok(Math.abs(hit!.normal.x + 1) < 1e-3, 'normal faces the ray');
  e.setColliderEnabled(near, false);
  e.step(STEP);
  assert.equal(e.raycast({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 10)?.tag, 5, 'open door lets the ray through');
  e.destroy();
});

test('joint limits hold: a hinge stops at its limit, a ball joint at its per-axis limits', async () => {
  const e = await createRapierEngine();
  const anchor = e.createBody({ kind: 'fixed', position: { x: 0, y: 3, z: 0 } });
  // Hinge about z, limited to +-30 degrees; the arm hangs sideways and gravity swings it down.
  const arm = e.createBody({ kind: 'dynamic', position: { x: 0.5, y: 3, z: 0 }, angularDamping: 3 });
  e.createCollider({ shape: { kind: 'cuboid', halfExtents: { x: 0.5, y: 0.05, z: 0.05 } } }, arm);
  e.createJoint({ kind: 'revolute', anchorA: { x: 0, y: 0, z: 0 }, anchorB: { x: -0.5, y: 0, z: 0 }, axis: { x: 0, y: 0, z: 1 }, limits: [-Math.PI / 6, Math.PI / 6] }, anchor, arm);
  // Ball joint limited to +-20 degrees on every axis, same setup.
  const anchor2 = e.createBody({ kind: 'fixed', position: { x: 0, y: 3, z: 3 } });
  const arm2 = e.createBody({ kind: 'dynamic', position: { x: 0.5, y: 3, z: 3 }, angularDamping: 3 });
  e.createCollider({ shape: { kind: 'cuboid', halfExtents: { x: 0.5, y: 0.05, z: 0.05 } } }, arm2);
  const lim: [number, number] = [-Math.PI / 9, Math.PI / 9];
  e.createJoint({ kind: 'spherical', anchorA: { x: 0, y: 0, z: 0 }, anchorB: { x: -0.5, y: 0, z: 0 }, limits: { x: lim, y: lim, z: lim } }, anchor2, arm2);
  const id: Quat = { x: 0, y: 0, z: 0, w: 1 };
  let hingeMax = 0;
  let ballMax = 0;
  for (let i = 0; i < 180; i++) {
    e.step(STEP);
    hingeMax = Math.max(hingeMax, angleBetween(e.transform(arm).rotation, id));
    ballMax = Math.max(ballMax, angleBetween(e.transform(arm2).rotation, id));
  }
  const deg = (r: number): string => ((r * 180) / Math.PI).toFixed(1);
  const hinge = angleBetween(e.transform(arm).rotation, id);
  const ball = angleBetween(e.transform(arm2).rotation, id);
  // A little give past the limit is the solver's softness; a broken limit would swing to 90 degrees.
  assert.ok(hingeMax < Math.PI / 6 + 0.1, `hinge never passes ~30 degrees (max ${deg(hingeMax)})`);
  assert.ok(Math.abs(hinge - Math.PI / 6) < 0.08, `hinge settles at its limit (${deg(hinge)})`);
  assert.ok(ballMax < Math.PI / 9 + 0.12, `ball joint never passes ~20 degrees (max ${deg(ballMax)})`);
  assert.ok(Math.abs(ball - Math.PI / 9) < 0.1, `ball joint settles at its limit (${deg(ball)})`);
  e.destroy();
});

test('a ball-joint motor holds a target pose against gravity, and releasing it lets the arm fall', async () => {
  const e = await createRapierEngine();
  const anchor = e.createBody({ kind: 'fixed', position: { x: 0, y: 3, z: 0 } });
  const arm = e.createBody({ kind: 'dynamic', position: { x: 0.3, y: 3, z: 0 }, angularDamping: 0.5 });
  e.createCollider({ shape: { kind: 'capsule', halfHeight: 0.2, radius: 0.05 }, rotation: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }, density: 1000 }, arm);
  const j = e.createJoint({ kind: 'spherical', anchorA: { x: 0, y: 0, z: 0 }, anchorB: { x: -0.3, y: 0, z: 0 } }, anchor, arm);
  e.setMotor(j, { angles: { x: 0, y: 0, z: 0 }, stiffness: 2000, damping: 120 });
  run(e, 1.5);
  const held = e.transform(arm).position.y;
  assert.ok(held > 2.95, `motor holds the arm out (y = ${held.toFixed(3)})`);
  e.setMotor(j, null);
  // Released, the arm swings down like a pendulum: check the lowest point it reaches.
  let fallen = held;
  for (let i = 0; i < 90; i++) {
    e.step(STEP);
    fallen = Math.min(fallen, e.transform(arm).position.y);
  }
  assert.ok(fallen < held - 0.2, `released arm falls (y ${held.toFixed(2)} -> lowest ${fallen.toFixed(2)})`);
  e.destroy();
});
