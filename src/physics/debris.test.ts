import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../world/collision.ts';
import { createRapierEngine } from './rapierAdapter.ts';
import { PhysicsWorld } from './world.ts';
import { debrisShape, physicsDebris, STATIC_AFTER } from './debris.ts';

// severed-debris spec, Block 2 tasks 3.1-3.4: pieces as rigid bodies in a test room, headless (a stub 2D canvas for
// the gore system's textures; geometry and placement are real).
const noop = (): void => undefined;
const ctx = new Proxy({} as Record<string | symbol, unknown>, {
  get: (t, k) => (k in t ? t[k] : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop: noop }) : noop),
  set: (t, k, v) => ((t[k] = v), true),
});
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ width: 1, height: 1, getContext: () => ctx, style: {} }) };

const { GoreSystem, MAX_DEBRIS } = await import('../actors/gore.ts');
const { Rng } = await import('../core/rng.ts');
type Gore = InstanceType<typeof GoreSystem>;

const STEP = 1 / 60;

/** A 10 m room: floor at y = 0, a wall whose face is at x = 1, and a bench (top at 0.8 m) at x = -3. */
function room(): CollisionWorld {
  const c = new CollisionWorld();
  c.add({ min: [-10, -0.2, -10], max: [10, 0, 10] }, 'floor', 'concrete');
  c.add({ min: [1, 0, -10], max: [1.2, 3, 10] }, 'wall');
  c.add({ min: [-3.5, 0, -0.3], max: [-2.5, 0.8, 0.3] }, 'prop:bench');
  return c;
}

async function setup(colliders = room()): Promise<{ world: PhysicsWorld; gore: Gore }> {
  const world = await PhysicsWorld.create(createRapierEngine, colliders);
  const gore = new GoreSystem(new Rng('debris-test'));
  gore.setDebrisBackend(physicsDebris(world));
  world.step(STEP);
  return { world, gore };
}

/** A limb-like piece: origin at one end, probes along +X to `length`. A head is one probe. */
function sever(gore: Gore, at: THREE.Vector3, velocity: THREE.Vector3, length: number, radius: number): THREE.Object3D {
  const o = new THREE.Group();
  o.position.copy(at);
  o.updateMatrixWorld(true);
  const probes = length > 0 ? [new THREE.Vector3(0, 0, 0), new THREE.Vector3(length / 2, 0, 0), new THREE.Vector3(length, 0, 0)] : [new THREE.Vector3()];
  gore.addDebris(o, velocity, probes, radius, noop);
  return o;
}

function run(world: PhysicsWorld, gore: Gore, seconds: number, each?: () => void): void {
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    world.step(STEP);
    gore.update(STEP);
    each?.();
  }
}

/** World positions of a piece's two ends. */
function ends(o: THREE.Object3D, length: number): [THREE.Vector3, THREE.Vector3] {
  o.updateMatrixWorld(true);
  return [new THREE.Vector3().applyMatrix4(o.matrixWorld), new THREE.Vector3(length, 0, 0).applyMatrix4(o.matrixWorld)];
}

test('a piece gets a capsule along its probes with mass from its length', () => {
  const s = debrisShape([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.7, 0, 0)], 0.05, 1);
  assert.ok(Math.abs(s.halfHeight - 0.35) < 1e-9);
  assert.ok(Math.abs(s.center.x - 0.35) < 1e-9);
  const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(s.rotation);
  assert.ok(Math.abs(axis.x - 1) < 1e-6, 'capsule axis runs along the probes');
  assert.ok(s.mass > 4 && s.mass < 7, `arm mass ${s.mass.toFixed(2)} kg`);
  const head = debrisShape([new THREE.Vector3()], 0.11, 1);
  assert.equal(head.halfHeight, 0, 'one probe makes a ball');
});

test('the default backend is the floor model, and a piece lands on the floor height', () => {
  const gore = new GoreSystem(new Rng('floor'), () => 0.5);
  assert.equal(gore.debrisBackendName, 'floor');
  const o = sever(gore, new THREE.Vector3(0, 2, 0), new THREE.Vector3(1, 0, 0), 0.6, 0.05);
  for (let i = 0; i < 300; i++) gore.update(STEP);
  const [a, b] = ends(o, 0.6);
  assert.ok(Math.min(a.y, b.y) >= 0.5 + 0.05 - 1e-3, 'rests on the floor height plus its radius');
  assert.ok(Math.min(a.y, b.y) < 0.5 + 0.2, 'and not above it');
});

test('a shotgun-speed limb thrown at a wall 1 m away stays on the room side of it', async () => {
  const { world, gore } = await setup();
  const o = sever(gore, new THREE.Vector3(-0.2, 1.2, 0), new THREE.Vector3(40, 3, 0), 0.6, 0.05);
  let maxX = -Infinity;
  run(world, gore, 3, () => {
    for (const p of ends(o, 0.6)) maxX = Math.max(maxX, p.x);
  });
  assert.ok(maxX < 1, `never past the wall face (furthest x ${maxX.toFixed(3)})`);
  const [a, b] = ends(o, 0.6);
  assert.ok(Math.min(a.y, b.y) < 0.2, 'and fell to the floor');
  world.destroy();
});

test('a leg dropped on a bench comes to rest on the bench top', async () => {
  const { world, gore } = await setup();
  const o = sever(gore, new THREE.Vector3(-3.4, 1.6, 0), new THREE.Vector3(0, 0, 0), 0.8, 0.07);
  run(world, gore, 4);
  const [a, b] = ends(o, 0.8);
  assert.ok(Math.min(a.y, b.y) > 0.8, `on top of the bench (${Math.min(a.y, b.y).toFixed(3)} m)`);
  world.destroy();
});

test('a leg on a ramp slides or rolls down it', async () => {
  const { world, gore } = await setup();
  // A 25 degree ramp rising toward -z, its low edge at z = 3, built straight into the engine (levels are boxes).
  const angle = (25 * Math.PI) / 180;
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle);
  world.engine.createCollider(
    { shape: { kind: 'cuboid', halfExtents: { x: 1, y: 0.05, z: 2 } }, offset: { x: -6, y: Math.sin(angle) * 2, z: 3 - Math.cos(angle) * 2 }, rotation: { x: q.x, y: q.y, z: q.z, w: q.w }, friction: 0.8 },
    null,
  );
  world.step(STEP);
  const o = sever(gore, new THREE.Vector3(-6.4, 1.9, 1.2), new THREE.Vector3(0, 0, 0), 0.8, 0.07);
  const z0 = ends(o, 0.8)[0].z;
  run(world, gore, 5);
  const [a, b] = ends(o, 0.8);
  assert.ok(a.z - z0 > 1, `moved down the ramp (${(a.z - z0).toFixed(2)} m)`);
  assert.ok(Math.min(a.y, b.y) < 0.5, 'ending at the bottom');
  world.destroy();
});

test('every piece is at rest and asleep within 6 s of being severed', async () => {
  const { world, gore } = await setup();
  const pieces: THREE.Object3D[] = [];
  for (let i = 0; i < 8; i++) {
    const v = new THREE.Vector3(Math.cos(i) * 6, 3 + i * 0.3, Math.sin(i) * 6);
    pieces.push(sever(gore, new THREE.Vector3(-1, 1.4, 0), v, i % 3 === 0 ? 0 : 0.5, i % 3 === 0 ? 0.11 : 0.05));
  }
  run(world, gore, STATIC_AFTER + 0.1);
  const before = pieces.map((p) => p.position.clone());
  const stepsBefore = world.stats().steps;
  run(world, gore, 1);
  pieces.forEach((p, i) => assert.ok(p.position.distanceTo(before[i]!) < 1e-6, `piece ${i} stays put`));
  let dynamicAwake = 0;
  world.engine.forEachCollider((c) => {
    if (c.bodyKind === 'dynamic' && !c.sleeping) dynamicAwake++;
  });
  assert.equal(dynamicAwake, 0, 'no piece is still simulating');
  assert.ok(world.stats().steps > stepsBefore);
  world.destroy();
});

test('a head striking a wall leaves a splat on the wall where it hit, and a limb landing leaves a pool', async () => {
  const { world, gore } = await setup();
  sever(gore, new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(9, 0.5, 0), 0, 0.11);
  run(world, gore, 0.5);
  assert.equal(gore.impactMarkCount, 1, 'one splat');
  const splat = gore.group.children.find((c) => (c as THREE.Mesh).isMesh && (c as THREE.Mesh).renderOrder === 2)!;
  assert.ok(Math.abs(splat.position.x - 1) < 0.01, `on the wall face (x ${splat.position.x.toFixed(3)})`);
  assert.ok(splat.position.y > 1.2 && splat.position.y < 1.8, `at the height it struck (${splat.position.y.toFixed(2)} m)`);
  const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(splat.quaternion);
  assert.ok(facing.x < -0.95, 'facing back into the room');

  const pools = (): THREE.Object3D[] => gore.group.children.filter((c) => (c as THREE.Mesh).isMesh && (c as THREE.Mesh).renderOrder === 1);
  const before = pools().length;
  sever(gore, new THREE.Vector3(-3.4, 2.2, 0), new THREE.Vector3(0, -2, 0), 0.6, 0.05);
  run(world, gore, 1);
  const added = pools().slice(before);
  assert.equal(added.length, 1, 'one pool');
  assert.ok(Math.abs(added[0]!.position.y - 0.804) < 0.01, `on the bench top, not the floor (${added[0]!.position.y.toFixed(3)} m)`);
  world.destroy();
});

test('an impact mark respects the gore clip plane', async () => {
  const { world, gore } = await setup();
  // A clip keeping gore at x <= 0.5: the splat on the wall at x = 1 is pulled back to the plane.
  gore.burst(new THREE.Vector3(), new THREE.Vector3(1, 0, 0), 1, false, { axis: 'x', at: 0.5, keep: 'below' });
  sever(gore, new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(9, 0.5, 0), 0, 0.11);
  run(world, gore, 0.5);
  const splat = gore.group.children.find((c) => (c as THREE.Mesh).isMesh && (c as THREE.Mesh).renderOrder === 2)!;
  assert.ok(splat.position.x <= 0.51, `kept on the allowed side (x ${splat.position.x.toFixed(3)})`);
  world.destroy();
});

test('over the cap the oldest piece fades and its body is freed; reduced mode makes no bodies', async () => {
  const { world, gore } = await setup();
  const bodies = (): number => world.engine.liveCounts().bodies;
  for (let i = 0; i < MAX_DEBRIS; i++) sever(gore, new THREE.Vector3(-1 + (i % 6) * 0.3, 1 + Math.floor(i / 6) * 0.4, 0), new THREE.Vector3(), 0.4, 0.05);
  assert.equal(bodies(), MAX_DEBRIS);
  sever(gore, new THREE.Vector3(-1, 3, 0), new THREE.Vector3(), 0.4, 0.05);
  assert.equal(bodies(), MAX_DEBRIS, 'the 25th piece replaces the oldest body');
  run(world, gore, 1);
  assert.equal(gore.activeDebris, MAX_DEBRIS, 'the oldest faded out and was removed');

  gore.mode = 'reduced';
  sever(gore, new THREE.Vector3(0, 2, 0), new THREE.Vector3(), 0.4, 0.05);
  assert.equal(bodies(), MAX_DEBRIS - 1, 'reduced mode adds no body (and pushed the next oldest out)');
  gore.clear();
  assert.equal(bodies(), 0, 'clearing frees every body');
  world.destroy();
});

test('each piece reports its landing once, for its sound', async () => {
  const world = await PhysicsWorld.create(createRapierEngine, room());
  const gore = new GoreSystem(new Rng('debris-landed'));
  const landed: Array<{ speed: number }> = [];
  gore.setDebrisBackend(physicsDebris(world, (hit) => void landed.push(hit)));
  world.step(STEP);
  sever(gore, new THREE.Vector3(-1, 1.5, 0), new THREE.Vector3(), 0.5, 0.05);
  run(world, gore, 3);
  assert.equal(landed.length, 1);
  assert.ok(landed[0]!.speed > 2, `it fell 1.5 m (${landed[0]!.speed.toFixed(1)} m/s)`);
  world.destroy();
});

test('a restart drops the old bodies, leaves their pieces lying, and new pieces simulate again', async () => {
  const { world, gore } = await setup();
  const old = sever(gore, new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 0.5, 0.05);
  run(world, gore, 0.2);
  await world.reset();
  const at = old.position.clone();
  run(world, gore, 0.5);
  assert.ok(old.position.distanceTo(at) < 1e-9, 'the old piece stays where it was');
  const fresh = sever(gore, new THREE.Vector3(0, 2, 0), new THREE.Vector3(), 0.5, 0.05);
  run(world, gore, 2);
  assert.ok(fresh.position.y < 0.3, 'a new piece falls in the new world');
  assert.equal(world.engine.liveCounts().bodies, 1);
  gore.clear();
  assert.equal(world.engine.liveCounts().bodies, 0);
  world.destroy();
});

test('level friction follows the surface: glass and wet floors are slick, grating catches', async () => {
  const { frictionOf } = await import('./world.ts');
  assert.ok(frictionOf({ acoustic: 'glass', surface: 'concrete' }) < 0.3);
  assert.ok(frictionOf({ surface: 'water' }) < frictionOf({ surface: 'metal' }));
  assert.ok(frictionOf({ surface: 'grate' }) > frictionOf({ surface: 'concrete' }));
  assert.equal(frictionOf({ surface: null }), frictionOf({ surface: 'concrete' }));
});
