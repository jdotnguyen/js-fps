import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type * as THREE from 'three';
import { loadBladeCreature } from './bladeCreature.ts';
import { necromorphScene } from '../../actors/blade/bladeTestKit.ts';
import { posesJson } from '../poseFiles.ts';
import { bodyModelsJson } from '../bodyModelFiles.ts';

const json = (rel: string): unknown => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const raw = json('../creatures/blade/creature.json') as Record<string, unknown>;
const poses = Object.keys(posesJson.poses);

async function modelBones(): Promise<string[]> {
  const scene = await necromorphScene();
  const names: string[] = [];
  scene.traverse((o) => (o as THREE.Bone).isBone && names.push(o.name));
  return names;
}

test('the blade creature profile validates, and every bone and pose it names exists', async () => {
  const p = loadBladeCreature(raw, { bones: await modelBones(), poses });
  assert.equal(p.model, 'necromorph');
  const models = bodyModelsJson as Record<string, { rig?: string }>;
  assert.equal(models[p.model]?.rig, 'blade', 'its body model names the profile');
});

test('the profile rejects an unknown bone, naming it', async () => {
  const bones = await modelBones();
  const bad = structuredClone(raw) as { limbs: Array<{ name: string; root: string }> };
  bad.limbs[0]!.root = 'Tail_099';
  assert.throws(() => loadBladeCreature(bad, { bones }), /limbs\[0\] \(belly_L\) > root.*Tail_099/);
});

test('the profile rejects an unknown joint and an unknown pose, naming them', () => {
  const badJoint = structuredClone(raw) as { segments: Array<{ joint: string }> };
  badJoint.segments[0]!.joint = 'tail';
  assert.throws(() => loadBladeCreature(badJoint), /segments.*joint.*unknown joint "tail"/);
  const badPose = { ...structuredClone(raw), poseMap: { idle: 'blade_nonsense' } };
  assert.throws(() => loadBladeCreature(badPose, { poses }), /poseMap > idle.*unknown pose "blade_nonsense"/);
});
