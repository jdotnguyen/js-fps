import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { posesJson } from '../data/poseFiles.ts';
import { loadPoseFile } from '../data/types/poses.ts';
import { contactBodies } from '../render/contactShadows.ts';
import { ShadowCasterSet } from '../render/shadowCasters.ts';
import type { BodyModelLibrary } from './bodyModelLibrary.ts';
import { loadMainCast, makeLib } from './castModelTestKit.ts';
import type { GoreSystem } from './gore.ts';
import { PoseLibrary } from './poses.ts';
import { WarmBodies } from './warmBodies.ts';

// session-loading "Warmed shader programs last the session" (openspec stop-midgame-shader-stalls D3).

async function setup() {
  const doctor = await loadMainCast('doctor');
  const ruiz = await loadMainCast('ruiz');
  const library = { ...makeLib({ doctor, ruiz }), table: { doctor: {}, ruiz: {}, missing: {} } } as unknown as BodyModelLibrary;
  const casters = new ShadowCasterSet();
  const ctx = { poses: new PoseLibrary(loadPoseFile(posesJson)), gore: {} as GoreSystem, bodyModels: library, shadowCasters: casters };
  return { doctor, ruiz, library, casters, ctx };
}

const meshes = (root: THREE.Object3D): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => void (o instanceof THREE.Mesh && out.push(o)));
  return out;
};

test('every loaded model and the procedural body is sampled, each material skinned where play skins it and as a severed piece', async () => {
  const { doctor, ruiz, library, ctx } = await setup();
  const warm = new WarmBodies(ctx, library);
  const bodies = warm.group.children.filter((c) => c.name.startsWith('humanoid:'));
  assert.equal(bodies.length, 3, 'procedural, doctor, ruiz; a model that did not load is left out');
  for (const name of ['held_mug', 'held_wand', 'held_pistol', 'muzzle_flash']) assert.ok(warm.group.getObjectByName(name), name);

  const all = meshes(warm.group);
  const loose = new Set(all.filter((m) => !(m instanceof THREE.SkinnedMesh)).map((m) => m.material as THREE.Material));
  const skinned = new Set(all.filter((m) => m instanceof THREE.SkinnedMesh).map((m) => m.material as THREE.Material));
  for (const m of skinned) assert.ok(loose.has(m), `${m.name}: also drawn unskinned`);
  const names = (set: Set<THREE.Material>): Set<string> => new Set([...set].map((m) => m.name));
  for (const model of [doctor, ruiz]) {
    for (const key of Object.keys(model.surfaces)) {
      assert.ok(names(skinned).has(`humanoid-surface:${key}`), `${key} skinned`);
      assert.ok(names(loose).has(`humanoid-surface:${key}`), `${key} severed`);
    }
  }
  assert.ok(names(skinned).has('humanoid-body') && names(skinned).has('humanoid-wet'), 'the procedural body, dry and wet');
  assert.equal([...loose].filter((m) => m.name === 'humanoid-wet').length, 3, 'every body sheds wet cut faces');
  warm.dispose();
});

test('samples register no shadow caster or contact shadow; release keeps the materials, dispose ends them', async () => {
  const { library, casters, ctx } = await setup();
  const contacts = contactBodies.size;
  const warm = new WarmBodies(ctx, library);
  assert.equal(casters.size, 0);
  assert.equal(contactBodies.size, contacts);

  // The bodies' own: held items share materials and geometry that outlive the session.
  const ofBodies = warm.group.children.filter((c) => c.name.startsWith('humanoid:')).flatMap(meshes).filter((m) => !m.name.startsWith('held_') && m.name !== 'muzzle_flash');
  const materials = new Set(ofBodies.map((m) => m.material as THREE.Material));
  const geometries = new Set(ofBodies.map((m) => m.geometry));
  let materialsDisposed = 0;
  let geometriesDisposed = 0;
  for (const m of materials) m.addEventListener('dispose', () => materialsDisposed++);
  for (const g of geometries) g.addEventListener('dispose', () => geometriesDisposed++);
  const scene = new THREE.Scene();
  scene.add(warm.group);

  warm.release();
  assert.equal(warm.group.parent, null);
  assert.equal(geometriesDisposed, geometries.size);
  assert.equal(materialsDisposed, 0, 'a disposed material would take its shader program with it');

  warm.dispose();
  assert.equal(materialsDisposed, materials.size);
});
