import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ctx } from '../ai/enemyTestKit.ts';
import { Humanoid } from './humanoid.ts';
import { InjuryExposure, injuryWeight, inView } from './injury.ts';
import { GILES } from './squadLooks.ts';

const step = (e: InjuryExposure, s: number, input: { watched?: boolean; talking?: boolean; spike?: boolean }): number => {
  let x = e.exposure;
  for (let i = 0; i < s * 60; i++) x = e.update(1 / 60, { watched: false, talking: false, spike: false, ...input });
  return x;
};

test('injury: watched at stage 0 shows no favouring', () => {
  const e = new InjuryExposure();
  const x = step(e, 10, { watched: true });
  assert.equal(injuryWeight(0, x), 0);
});

test('injury: 4 s unwatched lets it show; a look hides it again within 1 s', () => {
  const e = new InjuryExposure();
  assert.equal(step(e, 3.9, {}), 0, 'still hiding before 4 s');
  const shown = step(e, 1.6, {});
  assert.ok(shown > 0.95, `showing after 4 s + 1.5 s (${shown.toFixed(2)})`);
  assert.ok(injuryWeight(0, shown) > 0.25);
  const hidden = step(e, 1.0, { watched: true });
  assert.equal(hidden, 0, 'hidden within 1 s of being looked at');
  assert.ok(step(e, 0.3, { spike: true }) > 0.95, 'a tell or arm-loading task shows it at once');
});

test('injury: weights rise with each stage and are full at the reveal whoever watches', () => {
  for (let s = 1; s <= 4; s++) {
    assert.ok(injuryWeight(s, 0) >= injuryWeight(s - 1, 0), `concealed rises at stage ${s}`);
    assert.ok(injuryWeight(s, 1) > injuryWeight(s - 1, 1) || s === 4, `unhidden rises at stage ${s}`);
  }
  assert.equal(injuryWeight(4, 0), 1);
});

test('injury: view check', () => {
  const eye = new THREE.Vector3(0, 1.6, 0);
  const fwd = new THREE.Vector3(0, 0, -1);
  assert.ok(inView(eye, fwd, new THREE.Vector3(0.5, 1.5, -4), 10, (35 * Math.PI) / 180));
  assert.ok(!inView(eye, fwd, new THREE.Vector3(0, 1.5, 4), 10, (35 * Math.PI) / 180), 'behind');
  assert.ok(!inView(eye, fwd, new THREE.Vector3(0, 1.5, -12), 10, (35 * Math.PI) / 180), 'too far');
});

test('injury: the body carries the left arm in at full weight and moves normally at zero', () => {
  const make = (): Humanoid => new Humanoid({ ...GILES, role: 'npc', pose: 'idle' }, ctx());
  const plain = make();
  const hurt = make();
  hurt.setInjury(1);
  const bones = (h: Humanoid): Record<string, THREE.Object3D> => h['bones'] as Record<string, THREE.Object3D>;
  for (let i = 0; i < 120; i++) {
    plain.update(1 / 60);
    hurt.update(1 / 60);
  }
  const fore = (h: Humanoid): number => bones(h)['foreArm_L']!.quaternion.angleTo(new THREE.Quaternion());
  assert.ok(hurt.injuryWeight > 0.95);
  assert.ok(fore(hurt) - fore(plain) > (20 * Math.PI) / 180, 'elbow held bent');
  const r = (h: Humanoid): THREE.Quaternion => bones(h)['foreArm_R']!.quaternion;
  assert.ok(r(hurt).angleTo(r(plain)) < (3 * Math.PI) / 180, 'the other arm is unaffected');
});

test('injury at the panel: favouring, Giles works mostly with his right hand and the left moves less and more slowly', async () => {
  const { motionScene } = await import('./motionScene.ts');
  motionScene.setTask('giles', 'bypass_short');
  const run = (w: number): { L: number; R: number; jerkL: number } => {
    const h = new Humanoid({ ...GILES, role: 'npc', pose: 'crouchWork' }, ctx());
    h.setInjury(w);
    const bones = h['bones'] as Record<string, THREE.Object3D>;
    const path = { L: 0, R: 0, jerkL: 0 };
    const last = { L: new THREE.Vector3(), R: new THREE.Vector3() };
    let lastStepL = 0;
    for (let i = 0; i < 400; i++) {
      h.update(1 / 60);
      for (const s of ['L', 'R'] as const) {
        const p = bones[`hand_${s}`]!.getWorldPosition(new THREE.Vector3());
        const step = p.distanceTo(last[s]);
        if (i > 120) {
          path[s] += step;
          if (s === 'L') path.jerkL = Math.max(path.jerkL, Math.abs(step - lastStepL));
        }
        if (s === 'L') lastStepL = step;
        last[s].copy(p);
      }
    }
    h.dispose();
    return path;
  };
  try {
    const plain = run(0);
    // What the game gives him at the R06 bypass: stage 2, the left arm loaded (exposure held at 1).
    const hurt = run(injuryWeight(2, 1));
    console.log(`panel: unhurt L ${(plain.L * 100).toFixed(1)} R ${(plain.R * 100).toFixed(1)}; favouring L ${(hurt.L * 100).toFixed(1)} R ${(hurt.R * 100).toFixed(1)} cm`);
    assert.ok(hurt.L < hurt.R * 0.8, `the left hand moves less than the right (${(hurt.L * 100).toFixed(1)} vs ${(hurt.R * 100).toFixed(1)} cm)`);
    assert.ok(hurt.L < plain.L * 0.85, `favouring quiets the left hand (${(hurt.L * 100).toFixed(1)} vs ${(plain.L * 100).toFixed(1)} cm)`);
    assert.ok(hurt.jerkL <= plain.jerkL, 'and slows it (no sharper changes than unhurt)');
    assert.ok(Math.abs(hurt.R - plain.R) < plain.R * 0.25, 'the right hand works as before');
  } finally {
    motionScene.reset();
  }
});
