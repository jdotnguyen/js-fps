import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { Humanoid } from '../humanoid.ts';
import { creatureBody, stepBody } from './bladeTestKit.ts';

/** rig-necromorph task 5.3 (design D6): the creature never moves like a person (spec "It never moves like a person"). */

interface AnimView {
  mocapW: number;
  amp: number;
  idleLife: number;
  creature: unknown;
}
const anim = (h: Humanoid): AnimView => (h as unknown as { animator: AnimView }).animator;

/** Over `frames`, the largest captured-motion weight and human gait amplitude seen. */
function watch(h: Humanoid, frames: number, opts: { speed?: number } = {}): { mocap: number; gait: number; life: number } {
  let mocap = 0;
  let gait = 0;
  let life = 0;
  stepBody(h, frames, {
    ...opts,
    near: true,
    each: () => {
      const a = anim(h);
      mocap = Math.max(mocap, a.mocapW);
      gait = Math.max(gait, a.amp);
      life = Math.max(life, a.idleLife);
    },
  });
  return { mocap, gait, life };
}

for (const look of ['lab_creature', 'flood_elite'] as const) {
  test(`${look}: standing, no captured motion, no human gait and no human idle life`, async () => {
    const h = await creatureBody(look);
    assert.ok(anim(h).creature, 'it has its own motion');
    assert.deepEqual(watch(h, 120), { mocap: 0, gait: 0, life: 0 });
  });

  test(`${look}: walked by a script, no captured motion and no human walk cycle`, async () => {
    const h = await creatureBody(look);
    const seen = watch(h, 120, { speed: 1.2 });
    assert.equal(seen.mocap, 0);
    assert.equal(seen.gait, 0, 'the human gait never runs');
  });
}

test('getting up, no captured motion and no human gait', async () => {
  const h = await creatureBody('lab_creature');
  h.playDead('getUp_0');
  h.getUp();
  const seen = watch(h, 120);
  assert.equal(seen.mocap, 0);
  assert.equal(seen.gait, 0);
});

test('at rest its own idle keeps it alive: it breathes and its head moves', async () => {
  const h = await creatureBody('lab_creature');
  const chest = h.group.getObjectByName('chest')!;
  const head = h.group.getObjectByName('head')!;
  const chestQ: THREE.Quaternion[] = [];
  const headQ: THREE.Quaternion[] = [];
  stepBody(h, 300, { each: () => (chestQ.push(chest.quaternion.clone()), headQ.push(head.quaternion.clone())) });
  const spread = (qs: THREE.Quaternion[]): number => Math.max(...qs.map((q) => q.angleTo(qs[0]!)));
  assert.ok(THREE.MathUtils.radToDeg(spread(chestQ)) > 2, 'the chest moves with its breathing');
  assert.ok(THREE.MathUtils.radToDeg(spread(headQ)) > 8, 'the head snaps to new angles');
});
