import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { Humanoid } from '../humanoid.ts';
import { creatureBody, lowestPoint, necromorphModel, stepBody } from './bladeTestKit.ts';

/** rig-necromorph task 5.1: the blade creature's stance (spec blade-creature "It stands in its own stance"). */

async function bladeTips(h: Humanoid): Promise<THREE.Vector3[]> {
  const tips = (await necromorphModel()).bladeTips!;
  h.group.updateMatrixWorld(true);
  return (['L', 'R'] as const).map((s) => h.group.getObjectByName(`hand_${s}`)!.localToWorld(new THREE.Vector3(...tips[s])));
}

function highestPoint(h: Humanoid): number {
  h.group.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  let max = -Infinity;
  h.group.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || !m.visible) return;
    const n = m.geometry.getAttribute('position').count;
    for (let k = 0; k < n; k++) max = Math.max(max, m.localToWorld(m.getVertexPosition(k, v)).y);
  });
  return max;
}

for (const look of ['lab_creature', 'flood_elite'] as const) {
  test(`${look} standing still: hunched on bent knees, blades raised ahead of it`, async () => {
    const h = await creatureBody(look, 'blade_stance');
    stepBody(h, 60);
    const w = (j: string): THREE.Vector3 => h.group.getObjectByName(j)!.getWorldPosition(new THREE.Vector3());
    // Upper back: from the chest joint to the neck, against straight up.
    const back = w('neck').sub(w('chest'));
    const lean = THREE.MathUtils.radToDeg(back.angleTo(new THREE.Vector3(0, 1, 0)));
    assert.ok(lean >= 20, `upper back leans ${lean.toFixed(0)} degrees`);
    for (const s of ['L', 'R']) {
      const knee = THREE.MathUtils.radToDeg(w(`thigh_${s}`).sub(w(`shin_${s}`)).angleTo(w(`foot_${s}`).sub(w(`shin_${s}`))));
      assert.ok(knee < 170, `knee ${s} at ${knee.toFixed(0)} degrees`);
    }
    // Body faces -Z: ahead of the hips is smaller z (heading 0).
    const hips = w('pelvis');
    const kneeY = Math.max(w('shin_L').y, w('shin_R').y);
    for (const tip of await bladeTips(h)) {
      assert.ok(tip.y > kneeY, `blade tip at ${tip.y.toFixed(2)} m, knees at ${kneeY.toFixed(2)} m`);
      assert.ok(tip.z < hips.z, `blade tip ${tip.z.toFixed(2)} not ahead of the hips ${hips.z.toFixed(2)}`);
    }
    const low = lowestPoint(h) - h.group.position.y;
    assert.ok(Math.abs(low) < 0.04, `feet ${low.toFixed(3)} m from the floor`);
  });
}

test('the tall creature\'s stance fits under a 3.2 m ceiling, blades and all', async () => {
  const h = await creatureBody('flood_elite', 'blade_stance');
  stepBody(h, 60);
  const top = highestPoint(h);
  assert.ok(top < 3.2, `top at ${top.toFixed(2)} m`);
});

test('every windup draws a blade back before the strike swings it through, and grab keeps blades wide of the view', async () => {
  const h = await creatureBody('lab_creature', 'blade_stance');
  // Static pose pairs: body faces -Z, so drawn back = larger Z (or higher Y) than the forward strike.
  for (const [windup, strike] of [
    ['kill_glass_1', 'kill_glass_0'],
    ['slamWindup', 'slamImpact'],
    ['attack_windup', 'attack_strike'],
  ] as const) {
    h.setPose(windup, 0.01);
    stepBody(h, 10);
    const tipW = (await bladeTips(h))[1]!;
    h.setPose(strike, 0.01);
    stepBody(h, 10);
    const tipS = (await bladeTips(h))[1]!;
    assert.ok(tipW.z > tipS.z + 0.15, `${windup} tip z (${tipW.z.toFixed(2)}) should draw back behind ${strike} (${tipS.z.toFixed(2)})`);
  }
  // Live combat windup -> slash (R06): right blade pulls back during windupSide='R', then whips forward on strike('R').
  h.setPose('idle', 0.01);
  h.charge = 1;
  h.windupSide = 'R';
  stepBody(h, 30);
  const liveWindup = (await bladeTips(h))[1]!.clone();
  h.windupSide = null;
  h.strike('R');
  stepBody(h, 6);
  const liveStrike = (await bladeTips(h))[1]!.clone();
  assert.ok(liveWindup.z > liveStrike.z + 0.2, `live windup tip z (${liveWindup.z.toFixed(2)}) should draw back behind slash (${liveStrike.z.toFixed(2)})`);
  // Grab keeps both blades spread wide to the sides so neither covers the player's camera view.
  h.grabbing = true;
  stepBody(h, 30);
  const [grabL, grabR] = await bladeTips(h);
  assert.ok(Math.abs(grabL!.x) > 0.45 && Math.abs(grabR!.x) > 0.45, `grab blades should sit wide (${grabL!.x.toFixed(2)}, ${grabR!.x.toFixed(2)})`);
});
