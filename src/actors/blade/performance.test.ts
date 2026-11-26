import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Humanoid } from '../humanoid.ts';
import { castSpec } from '../castLooks.ts';
import { ctx } from '../../ai/enemyTestKit.ts';
import { NpcActor } from '../../ai/npcActor.ts';
import { creatureBody, necromorphModel, stepBody } from './bladeTestKit.ts';

/** rig-necromorph task 5.6 (design D8, spec blade-creature "It screams where it can be seen"): performances and `scream`. */

async function screamMetrics(h: Humanoid): Promise<{ tipL: THREE.Vector3; tipR: THREE.Vector3; shL: THREE.Vector3; shR: THREE.Vector3; jawDeg: number }> {
  const tips = (await necromorphModel()).bladeTips!;
  h.group.updateMatrixWorld(true);
  const pos = (n: string): THREE.Vector3 => h.group.getObjectByName(n)!.getWorldPosition(new THREE.Vector3());
  const tipL = h.group.getObjectByName('hand_L')!.localToWorld(new THREE.Vector3(...tips.L));
  const tipR = h.group.getObjectByName('hand_R')!.localToWorld(new THREE.Vector3(...tips.R));
  const jawQ = h.group.getObjectByName('jaw')!.quaternion;
  const jawDeg = THREE.MathUtils.radToDeg(2 * Math.acos(THREE.MathUtils.clamp(Math.abs(jawQ.w), 0, 1)));
  return { tipL, tipR, shL: pos('upperArm_L'), shR: pos('upperArm_R'), jawDeg };
}

test('a full scream raises both blade tips above shoulders and opens jaw >= 30 deg within 0.8 s, holds >= 1 s, lasts >= 2 s', async () => {
  const h = await creatureBody('flood_elite', 'idle');
  stepBody(h, 30);
  let done = false;
  assert.equal(h.playPerformance('scream', { onDone: () => (done = true) }), true);
  assert.equal(h.performancePlaying, true);

  let firstPeak = -1;
  let peakFrames = 0;
  let finishedAt = -1;
  for (let i = 1; i <= 240; i++) {
    stepBody(h, 1);
    const t = i / 60;
    const m = await screamMetrics(h);
    const atPeak = m.tipL.y > m.shL.y && m.tipR.y > m.shR.y && m.jawDeg >= 30;
    if (atPeak) {
      if (firstPeak < 0) firstPeak = t;
      peakFrames++;
    }
    if (done && finishedAt < 0) finishedAt = t;
  }
  assert.ok(firstPeak > 0 && firstPeak <= 0.8, `reached peak at ${firstPeak.toFixed(2)} s (limit 0.8 s)`);
  assert.ok(peakFrames / 60 >= 1.0, `held peak for ${(peakFrames / 60).toFixed(2)} s (min 1.0 s)`);
  assert.ok(finishedAt >= 2.0, `performance lasted ${finishedAt.toFixed(2)} s (min 2.0 s)`);
  assert.equal(h.performancePlaying, false);
});

test('a stretched scream hold of 5 s keeps blades up and jaw open through the hold, then settles', async () => {
  const h = await creatureBody('flood_elite', 'idle');
  stepBody(h, 10);
  let done = false;
  h.playPerformance('scream', { hold: 5, onDone: () => (done = true) });
  // Step to t = 4.5 s (well inside the 5 s hold): still playing, still at peak.
  stepBody(h, 270);
  assert.equal(h.performancePlaying, true);
  assert.equal(done, false);
  const mid = await screamMetrics(h);
  assert.ok(mid.tipL.y > mid.shL.y && mid.tipR.y > mid.shR.y, 'blades stay above shoulders during 5 s hold');
  assert.ok(mid.jawDeg >= 30, `jaw at ${mid.jawDeg.toFixed(1)} deg during 5 s hold`);
  // Step past total duration (~6.08 s): finishes cleanly.
  stepBody(h, 150);
  assert.equal(h.performancePlaying, false);
  assert.equal(done, true);
});

test('setPose, moving, and skipping each end an active scream cleanly', async () => {
  // 1. setPose
  const a = await creatureBody('lab_creature', 'idle');
  let doneA = false;
  a.playPerformance('scream', { hold: 5, onDone: () => (doneA = true) });
  stepBody(a, 50);
  assert.equal(a.performancePlaying, true);
  a.setPose('stare', 0.1);
  assert.equal(a.performancePlaying, false);
  assert.equal(doneA, true);

  // 2. Move (speed > 0.25)
  const b = await creatureBody('flood_elite', 'idle');
  let doneB = false;
  b.playPerformance('scream', { hold: 5, onDone: () => (doneB = true) });
  stepBody(b, 50);
  assert.equal(b.performancePlaying, true);
  stepBody(b, 20, { speed: 3.2 });
  assert.equal(b.performancePlaying, false);
  assert.equal(doneB, true);

  // 3. Skip via NpcActor instant playAnim / moveTo
  const c = await creatureBody('flood_elite', 'idle');
  const npc = new NpcActor('test_elite', c, { x: 0, y: 0, z: 0, vy: 0, grounded: true });
  void npc.playAnim('scream', { hold: 5 });
  stepBody(c, 50);
  assert.equal(c.performancePlaying, true);
  await npc.playAnim('scream', { instant: true });
  assert.equal(c.performancePlaying, false);
  stepBody(c, 30);
  const settled = await screamMetrics(c);
  assert.ok(settled.jawDeg < 15, `jaw returned to rest (${settled.jawDeg.toFixed(1)} deg) after skip`);
});

test('asking a human body for a creature performance warns once and does nothing', () => {
  const human = new Humanoid({ ...castSpec('voss', 'voss'), role: 'npc', pose: 'idle' }, ctx());
  const warned: string[] = [];
  const orig = console.warn;
  console.warn = (m: string) => warned.push(m);
  try {
    assert.equal(human.playPerformance('scream'), false);
    assert.equal(human.playPerformance('scream'), false);
  } finally {
    console.warn = orig;
  }
  assert.equal(human.performancePlaying, false);
  assert.equal(warned.filter((m) => m.includes('scream')).length, 1, 'warned once');
});
