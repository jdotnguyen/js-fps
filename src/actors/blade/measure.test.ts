import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mapRig } from '../bodyModel.ts';
import { castSpec } from '../castLooks.ts';
import { JOINTS, REFERENCE_HEIGHT, type JointName } from '../skeleton.ts';
import { creatureBody, lowestPoint, necromorphModel, necromorphScene, stepBody } from './bladeTestKit.ts';

/**
 * Baseline measurements of the blade creature (openspec rig-necromorph, task 1.1). They print the figures the design rests
 * on, and hold the ones that stay true once the rig is fixed.
 */

function restWorld(offsets: Record<JointName, readonly [number, number, number]>): Record<JointName, THREE.Vector3> {
  const out = {} as Record<JointName, THREE.Vector3>;
  for (const j of JOINTS) out[j.name] = (j.parent ? out[j.parent]!.clone() : new THREE.Vector3()).add(new THREE.Vector3(...offsets[j.name]));
  return out;
}

test('blade creature: rest ankle height at the reference height', async () => {
  const m = await necromorphModel();
  const w = restWorld(m.jointOffsets);
  const ankle = (w.foot_L.y + w.foot_R.y) / 2;
  console.log(`[blade] rest ankle height ${ankle.toFixed(3)} m at 1.78 m (a human's is about 0.065)`);
  assert.ok(ankle > 0.12 && ankle < 0.22, `rest ankle ${ankle}`);
});

test('blade creature: how much skin the jaw joint carries', async () => {
  const s = await necromorphScene();
  const meshes: THREE.SkinnedMesh[] = [];
  s.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && meshes.push(o as THREE.SkinnedMesh));
  const bones = meshes[0]!.skeleton.bones;
  const rig = mapRig(bones, meshes);
  let jaw = 0;
  let total = 0;
  for (const mesh of meshes) {
    const si = mesh.geometry.getAttribute('skinIndex');
    const sw = mesh.geometry.getAttribute('skinWeight');
    for (let v = 0; v < si.count; v++) {
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(v, k);
        total += w;
        if (rig.jointOf[bones.indexOf(mesh.skeleton.bones[si.getComponent(v, k)]!)] === 'jaw') jaw += w;
      }
    }
  }
  console.log(`[blade] jaw joint carries ${((100 * jaw) / total).toFixed(2)}% of the skin weight`);
  assert.ok(total > 0);
});

// The design's cause for the sinking (D7): the feet are placed for a human ankle, not this one. If that holds, raising each
// measured frame's ankle to the creature's own rest ankle height brings its lowest point to the floor, within 3 cm.
for (const look of ['lab_creature', 'flood_elite'] as const) {
  for (const [speed, near] of [[0, false], [0, true], [3.2, false], [3.2, true]] as const) {
    test(`blade creature: ${look} at ${speed} m/s${near ? ', near the camera' : ''}, feet against the floor`, async () => {
      const h = await creatureBody(look);
      const m = await necromorphModel();
      const scale = (castSpec(look, 'x').height ?? REFERENCE_HEIGHT) / REFERENCE_HEIGHT;
      const restAnkle = ((restWorld(m.jointOffsets).foot_L.y + restWorld(m.jointOffsets).foot_R.y) / 2) * scale;
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      let worst = Infinity;
      let worstFixed = Infinity;
      let worstFixedHigh = -Infinity;
      stepBody(h, 150, {
        speed,
        near,
        each: (i) => {
          if (i < 90) return;
          const low = lowestPoint(h) - h.group.position.y;
          const ankle = Math.min(h.jointWorld('foot_L', a).y, h.jointWorld('foot_R', b).y) - h.group.position.y;
          const fixed = low + (restAnkle - ankle);
          worst = Math.min(worst, low);
          worstFixed = Math.min(worstFixed, fixed);
          worstFixedHigh = Math.max(worstFixedHigh, fixed);
        },
      });
      console.log(`[blade] ${look} ${speed} m/s near=${near}: lowest ${worst.toFixed(3)} m; with the ankle at its own height ${worstFixed.toFixed(3)}..${worstFixedHigh.toFixed(3)} m`);
      // Away from the camera the foot IK is off and the feet stand on the floor; near it, the IK plants a human ankle.
      if (near) assert.ok(worstFixed > -0.03 && worstFixedHigh < 0.03, `ankle-height cause: ${worstFixed}..${worstFixedHigh}`);
      else assert.ok(worst > -0.03, `far from the camera the feet stay on the floor: ${worst}`);
    });
  }
}

// blade-creature "Its feet meet the floor" (rig-necromorph task 4.4): the foot IK plants the creature's own ankle.
for (const look of ['lab_creature', 'flood_elite'] as const) {
  test(`blade creature: ${look} standing near the camera keeps its feet within 3 cm of the floor`, async () => {
    const h = await creatureBody(look);
    let lo = Infinity;
    let hi = -Infinity;
    stepBody(h, 150, {
      near: true,
      each: (i) => {
        if (i < 90) return;
        const low = lowestPoint(h) - h.group.position.y;
        lo = Math.min(lo, low);
        hi = Math.max(hi, low);
      },
    });
    assert.ok(lo > -0.03 && hi < 0.03, `lowest point ${lo.toFixed(3)}..${hi.toFixed(3)} m`);
  });
}

test('a human body plants its feet exactly as before (the default ankle height)', async () => {
  const { Humanoid } = await import('../humanoid.ts');
  const { ctx } = await import('../../ai/enemyTestKit.ts');
  const run = (): number[] => {
    const h = new Humanoid({ ...castSpec('crew', 'feet-check'), role: 'npc', pose: 'idle' }, ctx());
    assert.equal(h.blade, null);
    const out: number[] = [];
    const a = new THREE.Vector3();
    stepBody(h, 90, { speed: 1.2, near: true, each: () => out.push(...h.jointWorld('foot_L', a).toArray(), ...h.jointWorld('foot_R', a).toArray()) });
    return out;
  };
  const { ANKLE_CLEARANCE } = await import('../footIk.ts');
  assert.equal(ANKLE_CLEARANCE, 0.065);
  assert.deepEqual(run(), run());
});
