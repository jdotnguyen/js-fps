/** Jay in standing water (player-movement spec, overhaul-flooded-tunnel D8): depth slows him, jumps get heavier. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EventBus } from '../core/events.ts';
import { BoxColliders, type Aabb } from './motor.ts';
import { Player, type PlayerDeps } from './player.ts';
import { WADING, canSprintAt, downedEye, wadeScale } from './wading.ts';

const DT = 1 / 60;
const FLOOR = -1.2;
const LEVEL = -0.45;
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Aabb => ({ min: [x0, y0, z0], max: [x1, y1, z1] });

interface Rig {
  p: Player;
  keys: { forward: boolean; sprint: boolean; jump: boolean };
  events: EventBus;
}

/** A sump floor at -1.2 with water to -0.45; `extra` boxes stand in it. Jay starts at z = 1 facing -Z. */
function rig(extra: Aabb[] = [], level = LEVEL): Rig {
  const keys = { forward: false, sprint: false, jump: false };
  const input = {
    consumeLook: () => ({ x: 0, y: 0 }),
    isDown: (a: string) => (a === 'sprint' ? keys.sprint : false),
    wasPressed: (a: string) => {
      if (a !== 'jump' || !keys.jump) return false;
      keys.jump = false;
      return true;
    },
    axis: (_neg: string, pos: string) => (pos === 'moveForward' && keys.forward ? 1 : 0),
  };
  const events = new EventBus();
  const deps = {
    camera: new THREE.PerspectiveCamera(),
    input,
    events,
    settings: () => ({ reducedMotion: false, mouseSensitivity: 1, invertY: false, fov: 75 }),
    flashlight: { on: false, toggle: () => undefined },
    interactions: { update: () => null },
    difficulty: () => ({ grabMashCount: 6 }),
    world: {
      colliders: new BoxColliders([box(-5, FLOOR - 0.3, -30, 5, FLOOR, 5), ...extra, box(-5, 3.2, -30, 5, 3.4, 5)]),
      surfaceAt: () => 'water',
      waterDepth: (_x: number, y: number) => Math.max(0, level - y),
    },
  } as unknown as PlayerDeps;
  const p = new Player(deps);
  p.placeAtEye(new THREE.Vector3(0, FLOOR + 1.7, 1), 0);
  return { p, keys, events };
}

test('depth slows Jay gradually: almost free at the ankle, half speed at the thigh', () => {
  assert.ok(wadeScale(0) === 1 && wadeScale(0.05) > 0.99);
  assert.ok(wadeScale(0.3) < wadeScale(0.2) && wadeScale(0.3) > 0.5, 'a step deeper is a little slower');
  assert.ok(Math.abs(wadeScale(0.75) - WADING.deepScale) < 1e-9);
});

test('no sprinting deeper than the knees', () => {
  assert.equal(canSprintAt(0.3), true);
  assert.equal(canSprintAt(0.75), false);
  const r = rig();
  r.keys.forward = true;
  r.keys.sprint = true;
  for (let i = 0; i < 90; i++) r.p.update(DT);
  assert.equal(r.p.sprinting, false);
  assert.ok(r.p.velocity.length() < 3.2 * WADING.deepScale + 0.05, `wading speed ${r.p.velocity.length()}`);
});

test('Jay can jump while wading', () => {
  const r = rig();
  for (let i = 0; i < 10; i++) r.p.update(DT);
  r.keys.jump = true;
  let top = r.p.body.y;
  for (let i = 0; i < 60; i++) {
    r.p.update(DT);
    top = Math.max(top, r.p.body.y);
  }
  assert.ok(top > FLOOR + 0.2, `rose to ${top}`);
});

/** Walk at the case (front edge z = -3) and jump at `jumpAt`; true if Jay ends on its top. */
function mounts(top: number, jumpAt: number): boolean {
  const r = rig([box(-0.4, FLOOR, -3.6, 0.4, FLOOR + top, -3)]);
  r.keys.forward = true;
  let jumped = false;
  for (let i = 0; i < 240; i++) {
    if (!jumped && r.p.body.z <= jumpAt) {
      r.keys.jump = true;
      jumped = true;
    }
    r.p.update(DT);
    if (jumped && r.p.body.grounded && !r.p.body.jumping) r.keys.forward = false;
  }
  return Math.abs(r.p.body.y - (FLOOR + top)) < 1e-6;
}

test('from the water Jay gets onto a case 0.85 m above the floor under it, but not one 0.95 m', () => {
  const timings: number[] = [];
  for (let z = -1.6; z >= -2.7; z -= 0.02) timings.push(z);
  assert.ok(timings.some((z) => mounts(0.85, z)), 'some jump timing gets onto the 0.85 m case');
  assert.ok(!timings.some((z) => mounts(0.95, z)), 'no jump timing gets onto the 0.95 m case');
});

test('hopping across the water is never faster than wading across it', () => {
  const cross = (hop: boolean): number => {
    const r = rig();
    r.keys.forward = true;
    for (let i = 1; i < 60 * 20; i++) {
      if (hop && r.p.body.grounded) r.keys.jump = true;
      r.p.update(DT);
      if (r.p.body.z <= -7) return i * DT;
    }
    return Infinity;
  };
  const wade = cross(false);
  const hop = cross(true);
  assert.ok(hop >= wade * 0.98, `hopping ${hop.toFixed(2)} s vs wading ${wade.toFixed(2)} s`);
});

test('a jump from the water is followed by a short recovery before the next', () => {
  const r = rig();
  for (let i = 0; i < 10; i++) r.p.update(DT);
  r.keys.jump = true;
  let landedAt = -1;
  let wasAir = false;
  for (let i = 0; i < 120 && landedAt < 0; i++) {
    r.p.update(DT);
    if (!r.p.body.grounded) wasAir = true;
    if (wasAir && r.p.body.grounded) landedAt = i;
  }
  assert.ok(landedAt > 0, 'landed');
  r.keys.jump = true;
  r.p.update(DT);
  assert.equal(r.p.body.grounded, true, 'no second jump straight away');
  for (let i = 0; i < Math.ceil(WADING.jumpRecovery / DT) + 2; i++) r.p.update(DT);
  r.keys.jump = true;
  r.p.update(DT);
  assert.equal(r.p.body.grounded, false, 'jumps again after the recovery');
});

test('downed in 0.75 m of water, the view stays just above the surface', () => {
  assert.ok(Math.abs(downedEye(0.35, 0.75) - 0.87) < 1e-9);
  assert.equal(downedEye(0.35, 0), 0.35, 'dry: as before');
});
