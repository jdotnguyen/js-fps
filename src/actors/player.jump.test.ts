/** Jay's jump (player-movement spec): mounting a counter eases the camera and plays one landing footstep. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EventBus } from '../core/events.ts';
import { BoxColliders, type Aabb } from './motor.ts';
import { Player, type PlayerDeps } from './player.ts';

const DT = 1 / 60;
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Aabb => ({ min: [x0, y0, z0], max: [x1, y1, z1] });

interface JumpRun {
  /** Jay's feet at the end. */
  y: number;
  /** Largest one-frame rise of the camera, and of the body, during the run. */
  camRise: number;
  bodyRise: number;
  landings: number;
}

/**
 * Jay walks forward (-Z, yaw 0) toward a 0.90 m counter whose front edge is at z = -3, presses jump once his feet
 * pass `jumpAt`, and lets go of forward when he lands.
 */
function jumpRun(jumpAt: number): JumpRun {
  let jumpQueued = false;
  let forward = true;
  const input = {
    consumeLook: () => ({ x: 0, y: 0 }),
    isDown: () => false,
    wasPressed: (a: string) => {
      if (a !== 'jump' || !jumpQueued) return false;
      jumpQueued = false;
      return true;
    },
    axis: (_neg: string, pos: string) => (pos === 'moveForward' && forward ? 1 : 0),
  };
  const events = new EventBus();
  const camera = new THREE.PerspectiveCamera();
  const deps = {
    camera,
    input,
    events,
    settings: () => ({ reducedMotion: false, mouseSensitivity: 1, invertY: false, fov: 75 }),
    flashlight: { on: false, toggle: () => undefined },
    interactions: { update: () => null },
    difficulty: () => ({ grabMashCount: 6 }),
    world: {
      colliders: new BoxColliders([box(-5, -0.3, -10, 5, 0, 5), box(-2, 0, -5, 2, 0.9, -3), box(-5, 3.2, -10, 5, 3.4, 5)]),
      surfaceAt: () => 'metal',
    },
  } as unknown as PlayerDeps;
  const p = new Player(deps);
  p.placeAtEye(new THREE.Vector3(0, 1.62, 1), 0);
  let landings = 0;
  events.on('player:footstep', (e) => {
    if (e.landing) landings++;
  });
  let jumped = false;
  let camRise = 0;
  let bodyRise = 0;
  let camY = camera.position.y;
  let bodyY = p.body.y;
  for (let i = 0; i < 240; i++) {
    if (!jumped && p.body.z <= jumpAt) {
      jumpQueued = true;
      jumped = true;
    }
    p.update(DT);
    p.applyCamera(DT);
    camRise = Math.max(camRise, camera.position.y - camY);
    bodyRise = Math.max(bodyRise, p.body.y - bodyY);
    camY = camera.position.y;
    bodyY = p.body.y;
    // Let go of forward on landing so Jay stays where he came down.
    if (jumped && p.body.grounded && !p.body.jumping) forward = false;
    if (!forward && p.velocity.length() < 0.01) break;
  }
  return { y: p.body.y, camRise, bodyRise, landings };
}

test('Jay jumps onto a 0.90 m counter: the camera eases up and one landing footstep plays', () => {
  const runs: JumpRun[] = [];
  for (let z = -1.4; z >= -2.65; z -= 0.01) runs.push(jumpRun(z));
  const mounted = runs.filter((r) => Math.abs(r.y - 0.9) < 1e-6);
  assert.ok(mounted.length > 0, 'some jump gets Jay onto the counter');
  // The run with the biggest pop onto the counter is the hardest case for the camera.
  const worst = mounted.reduce((a, b) => (b.bodyRise > a.bodyRise ? b : a));
  assert.ok(worst.bodyRise > 0.2, `body popped ${worst.bodyRise.toFixed(3)} m in one step`);
  assert.ok(worst.camRise < worst.bodyRise * 0.5, `camera rose ${worst.camRise.toFixed(3)} m in one frame (body ${worst.bodyRise.toFixed(3)})`);
  for (const r of mounted) assert.equal(r.landings, 1, 'one landing footstep');
});
