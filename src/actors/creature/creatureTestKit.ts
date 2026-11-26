import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { loadWithoutTextures } from '../castModelTestKit.ts';
import { createJuggernautRig } from './juggernaut.ts';
import type { CreatureRig } from './rig.ts';

/**
 * Test helpers for creature rigs: the shipped Juggernaut model, headless (textures stripped), scaled to the game's metres
 * (5.1 m tall in its exported pose, as `scripts/fix-juggernaut-glb.mjs` measured it) with its rig built.
 */

const MODEL = new URL('../../../public/assets/models/infected/monster_juggernaut.glb', import.meta.url);
const FIXTURE = new URL('../../../scripts/fixtures/juggernaut-source.json', import.meta.url);

export const juggernautFixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
  metresPerUnit: number;
  weighted: string[];
  exportedWorld: Record<string, number[]>;
};

/** Metres per model unit at game scale. */
export const METRES_PER_UNIT = juggernautFixture.metresPerUnit;

export interface LoadedCreature {
  scene: THREE.Group;
  rig: CreatureRig;
}

/** A fresh Juggernaut at game scale with its rig, standing at the origin. */
export async function loadJuggernaut(): Promise<LoadedCreature> {
  const scene = await loadWithoutTextures(MODEL);
  scene.scale.setScalar(METRES_PER_UNIT);
  scene.updateMatrixWorld(true);
  return { scene, rig: createJuggernautRig(scene) };
}

/** The scene's skinned meshes by their material name. */
export function skinnedMeshes(scene: THREE.Object3D): Map<string, THREE.SkinnedMesh[]> {
  const out = new Map<string, THREE.SkinnedMesh[]>();
  scene.traverse((o) => {
    if (!(o instanceof THREE.SkinnedMesh)) return;
    const name = (o.material as THREE.Material).name;
    out.set(name, [...(out.get(name) ?? []), o]);
  });
  return out;
}

/** World positions of a skinned mesh's vertices in its current pose. */
export function skinnedWorld(mesh: THREE.SkinnedMesh): THREE.Vector3[] {
  const n = mesh.geometry.attributes.position!.count;
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) out.push(mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
  return out;
}

/**
 * World positions of a mesh's stored (modelled) vertices, where the neutral pose should put them. The GLB binds its meshes in
 * the scene's own frame (joint-world times inverse-bind is the identity in the bind pose), and three.js's GLTFLoader binds
 * before the meshes are placed (bind matrix = identity), so a modelled vertex sits at the scene root's transform times its
 * stored position.
 */
export function modelledWorld(mesh: THREE.SkinnedMesh, root: THREE.Object3D): THREE.Vector3[] {
  const pos = mesh.geometry.attributes.position!;
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i++) out.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(root.matrixWorld));
  return out;
}

export const angleBetween = (a: THREE.Quaternion, b: THREE.Quaternion): number => a.angleTo(b);
