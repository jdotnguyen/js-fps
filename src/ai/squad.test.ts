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
import { Squad, SQUAD_TUNING } from './squad.ts';

function setup() {
  const pw = demoRoomPlayerWorld();
  const nav = new NavGraph({ world: pw.colliders, nodes: gridNodes(pw.colliders, { minX: -2.5, maxX: 2.5, minZ: -9.5, maxZ: 9.5, maxY: 0.5 }, 1) });
  const player = {
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
  const squad = new Squad({ ctx: { poses: new PoseLibrary(loadPoseFile(posesJson)), gore: {} as GoreSystem /* gore needs a canvas; nothing here gets hurt */ }, nav, player });
  return { squad, player, colliders: pw.colliders };
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
