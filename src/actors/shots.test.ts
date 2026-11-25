import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { fireShot, WEAPON_HITS, type ShotTargets } from './shots.ts';
import type { ColliderQuery } from './motor.ts';

const EMPTY_WORLD: ColliderQuery = {
  query: () => [],
};

function captureRays(spreadRad?: number, aimBlend = 0): THREE.Vector3[] {
  const dirs: THREE.Vector3[] = [];
  const targets: ShotTargets = {
    raycast(_o, dir) {
      dirs.push(dir.clone());
      return null;
    },
    applyHit: () => null,
  };
  let seed = 0;
  const seq = [0.25, 1.0, 0.75, 1.0];
  const random = (): number => seq[seed++ % seq.length]!;
  fireShot(WEAPON_HITS.pistol, new THREE.Vector3(0, 1.7, 0), new THREE.Vector3(0, 0, -1), aimBlend, EMPTY_WORLD, targets, random, 'player', spreadRad);
  return dirs;
}

test('fireShot uses explicit spreadRad override when provided', () => {
  const view = new THREE.Vector3(0, 0, -1);

  const [zeroDir] = captureRays(0, 0);
  assert.ok(zeroDir!.angleTo(view) < 1e-9, 'explicit 0 spread fires dead-center even at aimBlend 0');

  const [wideDir] = captureRays(0.08, 1);
  assert.ok(Math.abs(wideDir!.angleTo(view) - 0.08) < 1e-4, 'explicit wide spread overrides aimBlend 1');
});

test('fireShot preserves default aimBlend interpolation when spreadRad is omitted', () => {
  const view = new THREE.Vector3(0, 0, -1);

  const [hipDir] = captureRays(undefined, 0);
  assert.ok(Math.abs(hipDir!.angleTo(view) - WEAPON_HITS.pistol.hip) < 1e-4);

  const [aimDir] = captureRays(undefined, 1);
  assert.ok(Math.abs(aimDir!.angleTo(view) - WEAPON_HITS.pistol.aim) < 1e-4);
});
