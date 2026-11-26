import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Humanoid } from '../actors/humanoid.ts';
import { castSpec } from '../actors/castLooks.ts';
import { NpcActor } from './npcActor.ts';
import { ctx } from './enemyTestKit.ts';

// openspec juggernaut-walk-and-roar: Giles and Okafor back away from the Juggernaut while facing it (npcMoveTo `face`), so
// their weapon lights stay on its face.

const far = new THREE.Vector3(50, 0, 50);
const env = { nav: null, colliders: null, playerHead: far.clone().setY(1.6), playerFeet: far, camera: null };

function facingError(body: Humanoid, at: THREE.Vector3): number {
  const want = Math.atan2(-(at.x - body.group.position.x), -(at.z - body.group.position.z));
  return Math.abs(Math.atan2(Math.sin(want - body.heading), Math.cos(want - body.heading))) * (180 / Math.PI);
}

async function walk(face: boolean) {
  const body = new Humanoid({ ...castSpec('engineer', 'giles'), role: 'npc', pose: 'aim_pistol' }, ctx());
  const a = new NpcActor('giles', body);
  a.ambient = false;
  a.place({ x: 0, y: 0, z: 0 }, 0); // heading 0 faces -Z
  const creature = new THREE.Vector3(0, 4, -8); // ahead
  let arrived = false;
  void a.moveTo({ x: 0, y: 0, z: 1.6 }, { speed: 0.3, ...(face ? { face: () => creature } : {}) }).then(() => void (arrived = true));
  let worstFacing = 0;
  let backwardFrames = 0;
  let movingFrames = 0;
  for (let i = 0; i < 60 * 15 && !arrived; i++) {
    a.update(1 / 60, env);
    await Promise.resolve();
    if (body.speed > 0.05) {
      movingFrames++;
      if (body.backward) backwardFrames++;
      worstFacing = Math.max(worstFacing, facingError(body, creature));
    }
  }
  return { body, arrived, worstFacing, backwardFrames, movingFrames };
}

test('backing away with `face`: the body keeps facing the point, walks backward and arrives', async () => {
  const r = await walk(true);
  assert.ok(r.arrived, 'it arrives');
  assert.ok(Math.abs(r.body.group.position.z - 1.6) < 0.35, `ends ${r.body.group.position.z.toFixed(2)} m back`);
  assert.ok(r.movingFrames > 60, 'it walked');
  assert.ok(r.worstFacing <= 10, `faces the point within ${r.worstFacing.toFixed(1)} deg while walking`);
  assert.ok(r.backwardFrames >= r.movingFrames * 0.9, `walks backward (${r.backwardFrames}/${r.movingFrames} frames)`);
});

test('without `face` the same move turns round and walks forward', async () => {
  const r = await walk(false);
  assert.ok(r.arrived);
  assert.ok(r.worstFacing > 90, 'it turns its back');
  assert.ok(r.backwardFrames < r.movingFrames * 0.1, 'and walks forward');
});
