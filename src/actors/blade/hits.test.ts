import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { Humanoid } from '../humanoid.ts';
import { creatureBody, necromorphModel, stepBody } from './bladeTestKit.ts';

/** rig-necromorph task 4.5 (design D7): the blade creature's hit shapes follow its drawn body (spec "Shots hit what is drawn"). */

function skinPoints(h: Humanoid): THREE.Vector3[] {
  h.group.updateMatrixWorld(true);
  const out: THREE.Vector3[] = [];
  h.group.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || !m.visible) return;
    m.skeleton.update();
    const n = m.geometry.getAttribute('position').count;
    for (let k = 0; k < n; k++) out.push(m.localToWorld(m.getVertexPosition(k, new THREE.Vector3())));
  });
  return out;
}

/** A point on a blade, `f` of the way from the wrist to the tip, in world space. */
async function bladePoint(h: Humanoid, side: 'L' | 'R', f: number): Promise<THREE.Vector3> {
  const tip = (await necromorphModel()).bladeTips![side];
  h.group.updateMatrixWorld(true);
  return h.group.getObjectByName(`hand_${side}`)!.localToWorld(new THREE.Vector3(...tip).multiplyScalar(f));
}

for (const look of ['lab_creature', 'flood_elite'] as const) {
  test(`${look}: a shot through the middle of either blade registers on that arm`, async () => {
    const h = await creatureBody(look);
    stepBody(h, 30);
    for (const side of ['L', 'R'] as const) {
      for (const f of [0.35, 0.5, 0.75]) {
        const at = await bladePoint(h, side, f);
        // From the side the blade is on, aimed straight at it.
        const from = at.clone().add(new THREE.Vector3(side === 'L' ? -2 : 2, 0.1, 0));
        const dir = at.clone().sub(from).normalize();
        const hit = h.raycast(from, dir, 5);
        assert.ok(hit, `${side} blade at ${f}: no hit`);
        assert.equal(hit.region, `foreArm_${side}`, `${side} blade at ${f}: hit ${hit.region}`);
      }
    }
  });

  test(`${look}: a shot more than 15 cm clear of everything drawn misses`, async () => {
    const h = await creatureBody(look);
    stepBody(h, 30);
    const pts = skinPoints(h);
    const box = new THREE.Box3().setFromPoints(pts);
    const ray = new THREE.Ray();
    let clear = 0;
    for (let x = box.min.x - 0.4; x <= box.max.x + 0.4; x += 0.05) {
      for (let y = box.min.y; y <= box.max.y + 0.3; y += 0.05) {
        ray.set(new THREE.Vector3(x, y, box.max.z + 2), new THREE.Vector3(0, 0, -1));
        const near = pts.reduce((d, p) => Math.min(d, ray.distanceSqToPoint(p)), Infinity);
        if (near < 0.15 * 0.15) continue;
        clear++;
        const hit = h.raycast(ray.origin, ray.direction, 10);
        assert.equal(hit, null, `ray at x ${x.toFixed(2)}, y ${y.toFixed(2)} passes ${Math.sqrt(near).toFixed(2)} m from the skin but hit ${hit?.region}`);
      }
    }
    assert.ok(clear > 100, `${clear} clear rays checked`);
  });
}

test('a severed forearm takes its whole blade with it', async () => {
  const h = await creatureBody('flood_elite');
  stepBody(h, 10);
  h.cut('foreArm_L', new THREE.Vector3(1, 0.3, 0));
  stepBody(h, 2);
  const hand = h.group.getObjectByName('hand_L')!;
  const s = new THREE.Vector3();
  hand.getWorldScale(s);
  assert.ok(s.x < 0.01, 'the blade is gone from the body');
  const at = await bladePoint(h, 'R', 0.5);
  const from = at.clone().add(new THREE.Vector3(2, 0.1, 0));
  assert.ok(h.raycast(from, at.clone().sub(from).normalize(), 5), 'the other blade is still there');
});
