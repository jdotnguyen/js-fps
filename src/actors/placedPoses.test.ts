import { test } from 'node:test';
import assert from 'node:assert/strict';
import posesJson from '../data/poses.json' with { type: 'json' };
import { loadPoseFile } from '../data/types/poses.ts';
import { PoseLibrary } from './poses.ts';
import { JOINTS } from './skeleton.ts';

/** ADR-0029 seated and leaning poses: every base and its ambient gestures exist, and a gesture never moves the legs. */
const file = loadPoseFile(posesJson);
const poses = new PoseLibrary(file);
const BASES = ['sit_chair', 'sit_stool', 'sit_sofa', 'lean_wall', 'lean_counter', 'lean_back'];
/** Does `name` extend `base`, directly or through another pose (`lean_back_mug_drink` -> `lean_back_mug` -> `lean_back`)? */
const extendsFrom = (name: string, base: string): boolean => {
  for (let p = file.poses[name]?.extends; p; p = file.poses[p]?.extends) if (p === base) return true;
  return false;
};
const LEGS = new Set(['thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R', 'pelvis']);

test('every seated and leaning base pose has gestures that extend it (directly or through a mug variant)', () => {
  for (const base of BASES) {
    assert.ok(poses.has(base), base);
    const gestures = Object.keys(file.poses).filter((n) => n.startsWith(`${base}_`));
    assert.ok(gestures.length >= 3, `${base}: ${gestures.join(', ')}`);
    for (const g of gestures) assert.ok(extendsFrom(g, base), `${g} extends ${base}`);
  }
});

test('a gesture keeps its base pose legs and pelvis drop exactly', () => {
  for (const base of BASES) {
    const b = poses.get(base);
    for (const name of Object.keys(file.poses).filter((n) => n.startsWith(`${base}_`))) {
      const g = poses.get(name);
      assert.ok(g.pelvis.distanceTo(b.pelvis) < 1e-9, `${name} pelvis offset`);
      JOINTS.forEach((j, i) => {
        if (LEGS.has(j.name)) assert.ok(g.joints[i]!.angleTo(b.joints[i]!) < 1e-6, `${name} ${j.name}`);
      });
    }
  }
});

test('extends must name a real pose and cannot loop', () => {
  const bad = (poses: Record<string, unknown>): void => void loadPoseFile({ poses, sequences: {} });
  assert.throws(() => bad({ a: { joints: {}, extends: 'nope' } }), /unknown pose/);
  assert.throws(() => bad({ a: { joints: {}, extends: 'b' }, b: { joints: {}, extends: 'a' } }), /extends itself/);
});

test('mug poses put a mug in the hand; other seated and leaning poses do not', async () => {
  const { MUG_POSE } = await import('./heldProps.ts');
  for (const name of ['idle_mug', 'offer_mug', 'drink', 'lean_back_mug', 'lean_back_mug_drink', 'lean_back_mug_glance']) assert.ok(MUG_POSE.test(name), name);
  for (const name of ['lean_back', 'lean_back_glance', 'sit_chair', 'idle', 'typing']) assert.ok(!MUG_POSE.test(name), name);
});

test('wand poses put the wand in the hand, mug poses the mug, and the scan poses exist (dock-checkpoint)', async () => {
  const { heldItemFor } = await import('./heldProps.ts');
  for (const name of ['idle_wand', 'dock_guard_idle_wand', 'wand_attend', 'wand_up', 'dock_guard_wand_up', 'wand_down', 'dock_guard_wand_down']) {
    assert.ok(poses.has(name), name);
    assert.equal(heldItemFor(name), 'wand', name);
  }
  for (const name of ['idle_mug', 'offer_mug', 'drink', 'lean_back_mug_drink']) assert.equal(heldItemFor(name), 'mug', name);
  for (const name of ['arms_out', 'idle', 'typing', 'lean_back']) assert.equal(heldItemFor(name), null, name);
  assert.ok(poses.has('arms_out'));
});

test('a body switches between the wand and the mug with its pose, and drops both when it leaves those poses', async () => {
  const { Humanoid } = await import('./humanoid.ts');
  const { ctx } = await import('../ai/enemyTestKit.ts');
  const h = new Humanoid({ seed: 'dock-guard', outfit: 'crew', role: 'npc', pose: 'idle_wand' }, ctx());
  h.update(1 / 30);
  assert.equal(h.holding, 'wand');
  h.setPose('wand_down');
  h.update(1 / 30);
  assert.equal(h.holding, 'wand');
  h.setPose('idle_mug');
  h.update(1 / 30);
  assert.equal(h.holding, 'mug');
  assert.ok(h.holdingMug);
  h.setPose('idle');
  h.update(1 / 30);
  assert.equal(h.holding, null);
});
