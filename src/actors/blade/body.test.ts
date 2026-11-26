import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { Humanoid } from '../humanoid.ts';
import { creatureBody, stepBody } from './bladeTestKit.ts';

/**
 * rig-necromorph task 5.4d (design D6b; spec blade-creature "Not gliding"): the body moves with its steps. Per step, the
 * pelvis rises and falls, each swinging foot clears the floor, and the hips roll over the planted leg.
 */

const anim = (h: Humanoid): { footContacts: [number, number]; footfall: boolean } =>
  (h as unknown as { animator: { footContacts: [number, number]; footfall: boolean } }).animator;

export interface StepMotion {
  /** The smallest rise-and-fall of the pelvis (m) over any one step. */
  bob: number;
  /** The lowest clearance (m) any swinging foot reached at its highest, over its planted height. */
  clearance: number;
  /** Hip roll from side to side (degrees, peak to peak). */
  roll: number;
  steps: number;
}

export function stepMotion(h: Humanoid, speed: number, frames = 300): StepMotion {
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  const pelvisY: number[] = [];
  const falls: number[] = [];
  const planted: number[] = [];
  const swingTop: [number, number] = [-Infinity, -Infinity];
  const swings: number[] = [];
  let rollMin = Infinity;
  let rollMax = -Infinity;
  const was: [boolean, boolean] = [true, true];
  const lifted: [boolean, boolean] = [false, false];
  stepBody(h, frames, {
    speed,
    near: true,
    each: (i) => {
      if (i < 90) return;
      const a = anim(h);
      h.jointWorld('pelvis', p);
      pelvisY.push(p.y);
      if (a.footfall) falls.push(pelvisY.length - 1);
      (['L', 'R'] as const).forEach((s, k) => {
        h.jointWorld(`foot_${s}`, q);
        const down = a.footContacts[k]! >= 0.5;
        // Only whole swings: one already in the air when measuring began is not counted.
        if (down) {
          planted.push(q.y);
          if (!was[k] && lifted[k]) swings.push(swingTop[k]!);
          swingTop[k] = -Infinity;
          lifted[k] = false;
        } else {
          if (was[k] && i > 90) lifted[k] = true;
          swingTop[k] = Math.max(swingTop[k]!, q.y);
        }
        was[k] = down;
      });
      h.jointWorld('thigh_L', p);
      h.jointWorld('thigh_R', q);
      const roll = Math.atan2(p.y - q.y, Math.hypot(p.x - q.x, p.z - q.z)) * THREE.MathUtils.RAD2DEG;
      rollMin = Math.min(rollMin, roll);
      rollMax = Math.max(rollMax, roll);
    },
  });
  let bob = Infinity;
  for (let k = 1; k < falls.length; k++) {
    const seg = pelvisY.slice(falls[k - 1], falls[k]! + 1);
    if (seg.length > 2) bob = Math.min(bob, Math.max(...seg) - Math.min(...seg));
  }
  const floor = planted.sort((x, y) => x - y)[Math.floor(planted.length / 2)] ?? 0;
  const clearance = swings.length ? Math.min(...swings) - floor : 0;
  return { bob: Number.isFinite(bob) ? bob : 0, clearance, roll: rollMax - rollMin, steps: falls.length };
}

const WANT = [
  { speed: 1.35, bob: 0.05, clearance: 0.1 },
  { speed: 3.2, bob: 0.08, clearance: 0.18 },
  { speed: 7.2, bob: 0.08, clearance: 0.18 },
];

for (const look of ['lab_creature', 'flood_elite'] as const) {
  for (const w of WANT) {
    test(`${look} at ${w.speed} m/s: its body moves with its steps (not gliding)`, async () => {
      const h = await creatureBody(look);
      const m = stepMotion(h, w.speed);
      const said = `bob ${(m.bob * 100).toFixed(1)} cm, clearance ${(m.clearance * 100).toFixed(1)} cm, roll ${m.roll.toFixed(1)} deg, ${m.steps} steps`;
      if (process.env['BLADE_BODY']) console.log(`  ${look} ${w.speed}: ${said}`);
      assert.ok(m.steps >= 3, said);
      assert.ok(m.bob >= w.bob, `the pelvis rose and fell too little: ${said}`);
      assert.ok(m.clearance >= w.clearance, `a swinging foot stayed too low: ${said}`);
      assert.ok(m.roll >= 6, `the hips barely rolled: ${said}`);
    });
  }
}
