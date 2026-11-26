import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DEFAULT_MOTOR, moveBody, type MotorState } from '../actors/motor.ts';
import { loadSlice01 } from '../world/headlessSlice.ts';
import { createRapierEngine } from './rapierAdapter.ts';
import { PhysicsWorld } from './world.ts';
import { PhysicsProps, PlayerPusher } from './interaction.ts';

// physical-interaction "Trolley pushed into a doorway" (Block 5 task 6.4): the ROV Workshop's platform trolley,
// shoved across the workshop's only doorway (D_R13b_R13c, the x = 18 wall at z = 32), never shuts the player in or
// out: walking at the doorway pushes it through or aside.

const STEP = 1 / 60;
const WALK = 3.2;
const DOOR = { x: 18, z: 32 };

const { level, doors } = loadSlice01();

test('slice01 places the ROV Workshop trolley as the only physics prop that movement collides with', () => {
  // Lab B's cart and its load are loose (labB.test.ts): movement ignores them. The R08 instrument cart is a scripted
  // (kinematic) body that physics never moves (livelier-cart-slam, r08.test.ts).
  const props = level.physicsProps().filter((p) => !p.loose && !p.kinematic);
  assert.deepEqual(props.map((p) => p.id), ['rov_trolley']);
  assert.equal(props[0]!.mass, 45);
  assert.ok(props[0]!.colliders.length >= 2, 'deck and handle');
});

/**
 * Lodge the trolley at `pose` with the doorway open, then walk the player from `from` straight at `to` for up to
 * 6 s with the pusher on. Returns the player's end position.
 */
async function pushThrough(pose: { x: number; z: number; yawDeg: number }, from: [number, number], to: [number, number]): Promise<{ feet: MotorState; trolley: THREE.Vector3 }> {
  const door = doors.find((d) => d.data.id === 'D_R13b_R13c')!;
  const wasOpen = !door.collider.enabled;
  door.collider.enabled = false;
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (pose.yawDeg * Math.PI) / 180);
  level.setPropPose('rov_trolley', { x: pose.x, y: 0, z: pose.z }, q);
  const world = await PhysicsWorld.create(createRapierEngine, level.collision);
  const props = new PhysicsProps(world, level);
  const pusher = new PlayerPusher(world, DEFAULT_MOTOR.radius);
  const feet: MotorState = { x: from[0], y: 0, z: from[1], vy: 0, grounded: true };
  try {
    for (let i = 0; i < 6 / STEP; i++) {
      const dx = to[0] - feet.x;
      const dz = to[1] - feet.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.2) break;
      pusher.update(feet);
      world.step(STEP);
      props.sync();
      moveBody(feet, (dx / d) * WALK * STEP, (dz / d) * WALK * STEP, STEP, DEFAULT_MOTOR, level.collision);
    }
    return { feet, trolley: level.propState('rov_trolley')!.pos };
  } finally {
    pusher.destroy();
    world.destroy();
    level.setPropTransform('rov_trolley', { x: 16.4, y: 0, z: 34.9 }, 0);
    door.collider.enabled = !wasOpen;
  }
}

for (const yawDeg of [90, 0, 45]) {
  test(`walking out of the workshop gets past the trolley lodged in front of the doorway (turned ${yawDeg} degrees)`, async () => {
    const { feet, trolley } = await pushThrough({ x: DOOR.x - 0.75, z: DOOR.z, yawDeg }, [15.4, DOOR.z], [21, DOOR.z]);
    assert.ok(trolley.distanceTo(new THREE.Vector3(DOOR.x - 0.75, 0, DOOR.z)) > 0.3, `it was in the way and got pushed (${trolley.x.toFixed(2)}, ${trolley.z.toFixed(2)})`);
    assert.ok(feet.x > 19.5, `the player got out (feet x ${feet.x.toFixed(2)}, trolley at ${trolley.x.toFixed(2)}, ${trolley.z.toFixed(2)})`);
  });

  test(`walking into the workshop gets past the trolley lodged in front of the doorway (turned ${yawDeg} degrees)`, async () => {
    const { feet, trolley } = await pushThrough({ x: DOOR.x + 0.75, z: DOOR.z, yawDeg }, [21, DOOR.z], [15.4, DOOR.z]);
    assert.ok(trolley.distanceTo(new THREE.Vector3(DOOR.x + 0.75, 0, DOOR.z)) > 0.3, `it was in the way and got pushed (${trolley.x.toFixed(2)}, ${trolley.z.toFixed(2)})`);
    assert.ok(feet.x < 16.5, `the player got in (feet x ${feet.x.toFixed(2)}, trolley at ${trolley.x.toFixed(2)}, ${trolley.z.toFixed(2)})`);
  });
}
