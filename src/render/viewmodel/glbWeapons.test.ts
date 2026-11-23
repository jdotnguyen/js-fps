import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { skipsAo } from '../post.ts';
import { GlbWeapon, MODEL_SCALE, WEAPON_MODELS, type WeaponModelSpec } from './glbWeapons.ts';

/**
 * `GlbWeapon` with hand-made clips: the rest pose held from `Take`'s last frame (the new models have no idle clip), the
 * metre scale and half turn, and a muzzle carried by the gun bone.
 */

/** A rig with the gun bone under a scaled parent (like the real models' 1142x Armature), and a Take clip that moves it. */
function make(spec: Partial<WeaponModelSpec> = {}): GlbWeapon {
  const scene = new THREE.Group();
  const armature = new THREE.Object3D();
  armature.scale.setScalar(100);
  const bone = new THREE.Object3D();
  bone.name = 'Base';
  armature.add(bone);
  scene.add(armature);
  const take = new THREE.AnimationClip('Armature|Take', 0.5, [new THREE.VectorKeyframeTrack('Base.position', [0, 0.5], [0, 0, 0, 0.3, 0.2, 0.1])]);
  const shoot = new THREE.AnimationClip('Armature|Shoot', 0.3, [new THREE.VectorKeyframeTrack('Base.position', [0, 0.3], [0.3, 0.2, 0.1, 0.35, 0.2, 0.1])]);
  return new GlbWeapon('pistol', { scene, animations: [take, shoot] }, { url: '', scale: 0.024, ref: [0, 0, 0], bone: 'Base', muzzle: [0, 0, 0], ...spec });
}

const bonePos = (w: GlbWeapon): THREE.Vector3 => w.model.getObjectByName('Base')!.position.clone();

test('the rest pose is the last frame of Take, and it holds', () => {
  const w = make();
  assert.ok(w.has('Rest'));
  w.update(0);
  assert.ok(bonePos(w).distanceTo(new THREE.Vector3(0.3, 0.2, 0.1)) < 1e-6, 'starts at rest, not at the first frame of Take');
  w.update(5);
  assert.ok(bonePos(w).distanceTo(new THREE.Vector3(0.3, 0.2, 0.1)) < 1e-6, 'and stays');
});

test('playing a clip leaves the rest pose and playRest returns to it', () => {
  const w = make();
  w.play('Take', { fade: 0 });
  w.update(0.25);
  assert.ok(Math.abs(bonePos(w).x - 0.15) < 1e-6, 'mid-Take');
  w.playRest(0);
  w.update(0.05);
  assert.ok(Math.abs(bonePos(w).x - 0.3) < 1e-6, 'back at rest');
  assert.equal(w.clip, 'Rest');
});

test('the model is in metres, faces -Z, and the reference point is the root origin', () => {
  const w = make({ ref: [1, 2, 3] });
  w.root.updateMatrixWorld(true);
  const at = (x: number, y: number, z: number): THREE.Vector3 => w.model.localToWorld(new THREE.Vector3(x, y, z));
  const ref = at(1, 2, 3);
  assert.ok(ref.length() < 1e-9, `the reference point is at the origin, not ${ref.toArray()}`);
  const ahead = at(1, 2, 3 + 10);
  assert.ok(Math.abs(ahead.z - -10 * 0.024) < 1e-9, `10 model units forward are ${(10 * 0.024).toFixed(3)} m along -Z, not ${ahead.z}`);
  const right = at(1 - 5, 2, 3);
  assert.ok(Math.abs(right.x - 5 * 0.024) < 1e-9, 'model -X is game +X (right)');
});

test('the muzzle follows the gun bone', () => {
  const w = make({ muzzle: [0, 0, 10] });
  const world = (): THREE.Vector3 => w.muzzle.getWorldPosition(new THREE.Vector3());
  w.update(0);
  w.root.updateMatrixWorld(true);
  const rest = world();
  assert.ok(Math.abs(rest.z - -10 * 0.024) < 1e-6, `10 units ahead of the origin (${rest.z})`);
  w.play('Shoot', { fade: 0 });
  w.update(0.3);
  w.root.updateMatrixWorld(true);
  const kicked = world();
  // Shoot moves Base by +0.05 in x in a parent scaled 100x: 5 model units, which is game -X (left) by 5 * 0.024... only the
  // bone's own motion matters here: the muzzle must have moved with it.
  assert.ok(kicked.distanceTo(rest) > 1e-3, 'the muzzle moved with the bone');
});

test('both weapons share one scale and name a gun bone', () => {
  assert.equal(WEAPON_MODELS.pistol.scale, MODEL_SCALE);
  assert.equal(WEAPON_MODELS.shotgun.scale, MODEL_SCALE);
  assert.equal(WEAPON_MODELS.pistol.bone, 'Base');
  assert.equal(WEAPON_MODELS.shotgun.bone, 'Base');
});

test('every mesh of a weapon is left out of ambient occlusion (weapon-viewmodels: AO never shades the weapons)', () => {
  const scene = new THREE.Group();
  const bone = new THREE.Object3D();
  bone.name = 'Base';
  scene.add(bone);
  // An opaque, depth-writing material: the kind the AO pass would otherwise draw into its scene and shade.
  const gun = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  const glove = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  bone.add(gun, glove);
  assert.equal(skipsAo(gun), false, 'a plain solid mesh is shaded by AO (the premise)');
  const w = new GlbWeapon('pistol', { scene, animations: [] }, { url: '', scale: 0.024, ref: [0, 0, 0], bone: 'Base', muzzle: [0, 0, 0] });
  const meshes: THREE.Mesh[] = [];
  w.model.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  assert.equal(meshes.length, 2);
  for (const m of meshes) assert.equal(skipsAo(m), true, 'flagged to skip AO');
});
