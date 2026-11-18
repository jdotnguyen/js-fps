import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CastTells, NO_TELLS, tellsFor } from './castTells.ts';

function rig(): { tells: CastTells; bones: Record<string, THREE.Object3D> } {
  const bones: Record<string, THREE.Object3D> = {};
  const tells = new CastTells((n) => (bones[n] ??= new THREE.Bone()));
  return { tells, bones };
}

test('the ladder maps stage and bandage to tells: bandage from stage 2, veins and sweat from 3', () => {
  assert.deepEqual(tellsFor(0, false), NO_TELLS);
  assert.deepEqual(tellsFor(2, true), { bandage: true, veins: 0, sweat: 0 });
  assert.deepEqual(tellsFor(3, true), { bandage: true, veins: 1, sweat: 1 });
  assert.deepEqual(tellsFor(4, true), { bandage: true, veins: 1, sweat: 1 });
});

test('overlays hang on the forearm, head and neck bones and toggle by visibility', () => {
  const { tells, bones } = rig();
  assert.ok(bones['foreArm_L']!.children.includes(tells.bandage));
  assert.ok(bones['head']!.children.includes(tells.sweat));
  assert.equal(tells.bandage.visible, false);
  assert.equal(tells.veins.visible, false);
  assert.equal(tells.sweat.visible, false);
  tells.set({ bandage: true, veins: 0, sweat: 0 });
  assert.equal(tells.bandage.visible, true);
  assert.equal(tells.veins.visible, false);
  tells.set({ bandage: true, veins: 1, sweat: 1 });
  assert.equal(tells.veins.visible && tells.sweat.visible, true);
  assert.ok(bones['head']!.children.some((c) => c.name === 'tell:faceVeins' && c.visible));
  assert.ok(bones['neck']!.children.some((c) => c.name === 'tell:neckVeins' && c.visible));
  tells.set({ ...NO_TELLS });
  assert.equal(tells.bandage.visible || tells.veins.visible || tells.sweat.visible, false);
  tells.dispose();
  assert.equal(bones['foreArm_L']!.children.length, 0);
});

test('every overlay vertex is finite and near its bone (nothing floats off the body)', () => {
  const { tells } = rig();
  tells.bandage.updateWorldMatrix(true, true);
  for (const group of [tells.bandage, tells.veins, tells.sweat]) {
    group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const pos = (o.geometry as THREE.BufferGeometry).getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrix);
        assert.ok(Number.isFinite(v.x + v.y + v.z));
        assert.ok(v.length() < 0.5, `${group.name} vertex at ${v.toArray()}`);
      }
    });
  }
});
