import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { Humanoid } from '../humanoid.ts';
import { creatureBody, stepBody } from './bladeTestKit.ts';

/** rig-necromorph task 4.3: the blade creature's jaw and belly-arm layer (spec blade-creature "Its belly arms and spine are alive"). */

/** Each belly arm's wrist bone, in the chest's frame (so the body's own sway does not count). */
function wrists(h: Humanoid): THREE.Vector3[] {
  h.group.updateMatrixWorld(true);
  const chest = h.group.getObjectByName('chest')!;
  const inv = chest.matrixWorld.clone().invert();
  const out: THREE.Vector3[] = [];
  for (const def of h.blade ? (h as unknown as { geo: { creatureBones: Array<{ kind: string; name: string; source?: string }> } }).geo.creatureBones : []) {
    if (def.kind === 'limb' && /wrist/i.test(def.source ?? '')) out.push(h.group.getObjectByName(def.name)!.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv));
  }
  return out;
}

test('only the blade creature has the layer', async () => {
  const h = await creatureBody('lab_creature');
  assert.ok(h.blade, 'the creature has it');
  assert.equal(wrists(h).length, 2, 'two belly hands');
});

test('at rest each belly hand moves at least 2 cm against the torso over 5 s, and stays rooted', async () => {
  const h = await creatureBody('lab_creature');
  const scale = h.group.scale.y || 1;
  const boxes = [new THREE.Box3(), new THREE.Box3()];
  stepBody(h, 300, { near: true, each: () => wrists(h).forEach((p, i) => boxes[i]!.expandByPoint(p)) });
  for (const b of boxes) {
    const span = b.getSize(new THREE.Vector3()).length() / scale;
    assert.ok(span >= 0.02, `a belly hand moved ${(span * 100).toFixed(1)} cm`);
    assert.ok(span < 0.4, `a belly hand flailed ${(span * 100).toFixed(1)} cm`);
  }
});

test('flared, the belly arms spread wider than at rest', async () => {
  const h = await creatureBody('flood_elite');
  stepBody(h, 60);
  const rest = wrists(h).map((p) => Math.abs(p.x));
  h.blade!.amounts.flare = 1;
  stepBody(h, 60);
  const wide = wrists(h).map((p) => Math.abs(p.x));
  wide.forEach((x, i) => assert.ok(x > rest[i]! + 0.02, `belly hand ${i}: ${rest[i]!.toFixed(3)} -> ${x.toFixed(3)}`));
});

test('the jaw opens with the amount, past 30 degrees fully open', async () => {
  const h = await creatureBody('lab_creature');
  const jaw = h.group.getObjectByName('jaw')!;
  const head = h.group.getObjectByName('head')!;
  const angle = (): number => {
    h.group.updateMatrixWorld(true);
    const qh = head.getWorldQuaternion(new THREE.Quaternion());
    return jaw.getWorldQuaternion(new THREE.Quaternion()).angleTo(qh);
  };
  stepBody(h, 30);
  const shut = angle();
  h.blade!.amounts.jaw = 1;
  stepBody(h, 30);
  const open = angle();
  assert.ok(THREE.MathUtils.radToDeg(open - shut) >= 25 && THREE.MathUtils.radToDeg(open) >= 30, `jaw ${THREE.MathUtils.radToDeg(shut).toFixed(1)} -> ${THREE.MathUtils.radToDeg(open).toFixed(1)} degrees`);
});

test('the same seed gives the same layer pose', async () => {
  const run = async (): Promise<number[]> => {
    const h = await creatureBody('lab_creature');
    stepBody(h, 120);
    return wrists(h).flatMap((p) => p.toArray());
  };
  assert.deepEqual(await run(), await run());
});
