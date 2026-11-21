import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Loop, SIM_STEP } from '../core/loop.ts';
import { CollisionWorld } from '../world/collision.ts';
import type { PhysicsEngine, PhysicsEngineFactory } from './engine.ts';
import { createRapierEngine } from './rapierAdapter.ts';
import { PhysicsWorld } from './world.ts';

// physics-world "Fixed simulation step" (task 2.3) and restarts without leaks (task 2.5).

function floorOnly(): CollisionWorld {
  const c = new CollisionWorld();
  c.add({ min: [-5, -0.2, -5], max: [5, 0, 5] }, 'floor', 'concrete');
  return c;
}

/** Seconds of simulated time until a ball dropped from 3 m lands, rendering at `fps`. */
async function fallTime(fps: number): Promise<number> {
  const world = await PhysicsWorld.create(createRapierEngine, floorOnly());
  const e = world.engine;
  const ball = e.createBody({ kind: 'dynamic', position: { x: 0, y: 3, z: 0 } });
  e.createCollider({ shape: { kind: 'ball', radius: 0.2 } }, ball);
  let landed = -1;
  const loop = new Loop({
    update: (dt) => {
      world.step(dt);
      if (landed < 0 && e.transform(ball).position.y < 0.25) landed = loop.clock.elapsed + dt;
    },
    render: () => {},
  });
  for (let i = 0; i < fps * 3 && landed < 0; i++) loop.advance(1 / fps);
  world.destroy();
  return landed;
}

test('a body falls at the same speed at 30 and 60 fps', async () => {
  const at60 = await fallTime(60);
  const at30 = await fallTime(30);
  assert.ok(at60 > 0 && at30 > 0, 'both land');
  assert.ok(Math.abs(at60 - at30) <= SIM_STEP + 1e-9, `same fall time within one step (60 fps ${at60.toFixed(3)} s, 30 fps ${at30.toFixed(3)} s)`);
});

test('while paused (time scale 0) no body moves', async () => {
  const world = await PhysicsWorld.create(createRapierEngine, floorOnly());
  const e = world.engine;
  const ball = e.createBody({ kind: 'dynamic', position: { x: 0, y: 3, z: 0 } });
  e.createCollider({ shape: { kind: 'ball', radius: 0.2 } }, ball);
  const loop = new Loop({ update: (dt) => world.step(dt), render: () => {} });
  loop.advance(0.1);
  const y = e.transform(ball).position.y;
  loop.clock.scale = 0;
  for (let i = 0; i < 60; i++) loop.advance(1 / 60);
  assert.equal(e.transform(ball).position.y, y);
  world.destroy();
});

test('five restarts leave no bodies, colliders or joints behind, and free every old engine', async () => {
  const live: PhysicsEngine[] = [];
  const factory: PhysicsEngineFactory = async (opts) => {
    const engine = await createRapierEngine(opts);
    const destroy = engine.destroy.bind(engine);
    live.push(engine);
    engine.destroy = () => {
      destroy();
      live.splice(live.indexOf(engine), 1);
    };
    return engine;
  };
  const world = await PhysicsWorld.create(factory, floorOnly());
  for (let restart = 0; restart < 5; restart++) {
    const e = world.engine;
    // A ragdoll-ish pair of bodies and a joint, as a fight would leave behind.
    const a = e.createBody({ kind: 'dynamic', position: { x: 0, y: 1, z: 0 } });
    const b = e.createBody({ kind: 'dynamic', position: { x: 0.5, y: 1, z: 0 } });
    e.createCollider({ shape: { kind: 'ball', radius: 0.1 } }, a);
    e.createCollider({ shape: { kind: 'ball', radius: 0.1 } }, b);
    e.createJoint({ kind: 'spherical', anchorA: { x: 0.25, y: 0, z: 0 }, anchorB: { x: -0.25, y: 0, z: 0 } }, a, b);
    for (let i = 0; i < 30; i++) world.step(SIM_STEP);
    await world.reset();
    assert.deepEqual(world.engine.liveCounts(), { bodies: 0, colliders: 1, joints: 0 }, `after restart ${restart + 1}: only the floor mirror`);
    assert.equal(live.length, 1, 'the previous engine was freed');
  }
  world.destroy();
  assert.equal(live.length, 0);
});
