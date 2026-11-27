/**
 * Prints the Necromorph Slasher's authored pose (the crouch with both blades raised that the model file holds in its node
 * transforms) as game joint angles, for authoring the blade creature's poses in src/data/creatures/blade/poses.json (openspec rig-necromorph,
 * design D4, task 5.1). The angles are swings only: each game joint is turned so its bone points where the model's does.
 *
 *   node --experimental-strip-types --no-warnings scripts/necromorph-pose.ts [public/assets/models/infected/necromorph_slasher.glb]
 *
 * It reads the shipped model; the authored pose is the same in the source and the repaired file.
 */
import * as THREE from 'three';
import { mapRig, prepareBodyModel } from '../src/actors/bodyModel.ts';
import { loadWithoutTextures } from '../src/actors/castModelTestKit.ts';
import { JOINTS, REFERENCE_HEIGHT, type JointName } from '../src/actors/skeleton.ts';

const file = process.argv[2] ?? 'public/assets/models/infected/necromorph_slasher.glb';
const url = new URL(`../${file}`, import.meta.url);

// Rest frame: what the game builds (joint offsets at the reference height, every joint at rest).
const model = prepareBodyModel(await loadWithoutTextures(url));
const rest = {} as Record<JointName, THREE.Vector3>;
for (const j of JOINTS) rest[j.name] = (j.parent ? rest[j.parent]!.clone() : new THREE.Vector3()).add(new THREE.Vector3(...model.jointOffsets[j.name]));

// Authored pose: the model's bones where its node transforms put them, in the skin's own space.
const scene = await loadWithoutTextures(url);
scene.updateMatrixWorld(true);
const meshes: THREE.SkinnedMesh[] = [];
scene.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && meshes.push(o as THREE.SkinnedMesh));
const mesh = meshes[0]!;
const bones = mesh.skeleton.bones;
const rig = mapRig(bones, meshes);
const toMesh = mesh.matrixWorld.clone().invert();
const at = (i: number): THREE.Vector3 => new THREE.Vector3().setFromMatrixPosition(bones[i]!.matrixWorld).applyMatrix4(toMesh);
const piv = (j: JointName): THREE.Vector3 => at(rig.pivot[j]!);

// Face -Z with the left side at -X, as preparation does, from this pose's own hips.
const right = piv('thigh_R').sub(piv('thigh_L'));
right.y = 0;
const forward = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), right.normalize());
const yaw = Math.atan2(-forward.x, -forward.z);
const face = new THREE.Matrix4().makeRotationY(-yaw);
// The skin's up may not be +Y in this space: take it from the bind pose's feet-to-head direction.
const posed = (j: JointName): THREE.Vector3 => piv(j).applyMatrix4(face);

// Lowest point of the posed skin (its soles), and the scale to the reference height of the rest body.
const v = new THREE.Vector3();
let low = Infinity;
for (let k = 0; k < mesh.geometry.getAttribute('position').count; k++) {
  mesh.getVertexPosition(k, v);
  low = Math.min(low, v.applyMatrix4(mesh.matrixWorld).applyMatrix4(toMesh).applyMatrix4(face).y);
}
// Metres per model unit, from the leg's length in the rest body and in the model.
const legRest = rest.thigh_L.distanceTo(rest.shin_L) + rest.shin_L.distanceTo(rest.foot_L);
const legModel = posed('thigh_L').distanceTo(posed('shin_L')) + posed('shin_L').distanceTo(posed('foot_L'));
const scale = legRest / legModel;

/** The child joint each joint is aimed at. */
const AIM: Partial<Record<JointName, JointName>> = {
  pelvis: 'spine', spine: 'chest', chest: 'neck', neck: 'head',
  shoulder_L: 'upperArm_L', upperArm_L: 'foreArm_L', foreArm_L: 'hand_L',
  shoulder_R: 'upperArm_R', upperArm_R: 'foreArm_R', foreArm_R: 'hand_R',
  thigh_L: 'shin_L', shin_L: 'foot_L', thigh_R: 'shin_R', shin_R: 'foot_R',
};
const world = new Map<JointName, THREE.Quaternion>();
const out: Record<string, [number, number, number]> = {};
const deg = (r: number): number => Math.round(THREE.MathUtils.radToDeg(r));
for (const j of JOINTS) {
  const parentW = j.parent ? (world.get(j.parent) ?? new THREE.Quaternion()) : new THREE.Quaternion();
  const child = AIM[j.name];
  let local = new THREE.Quaternion();
  if (child) {
    const dRest = rest[child]!.clone().sub(rest[j.name]!).normalize();
    const dPose = posed(child).sub(posed(j.name)).normalize();
    const inParent = dPose.applyQuaternion(parentW.clone().invert());
    local = new THREE.Quaternion().setFromUnitVectors(dRest, inParent);
  }
  world.set(j.name, parentW.clone().multiply(local));
  const e = new THREE.Euler().setFromQuaternion(local, 'XYZ');
  if (child && (Math.abs(e.x) + Math.abs(e.y) + Math.abs(e.z)) > 0.02) out[j.name] = [deg(e.x), deg(e.y), deg(e.z)];
}
const pelvisDrop = (posed('pelvis').y - low) * scale - rest.pelvis.y;
console.log(JSON.stringify({ joints: out, pelvis: [0, +pelvisDrop.toFixed(3), 0] }, null, 1));
console.log(`(model units to metres ${scale.toFixed(4)}; rest pelvis ${rest.pelvis.y.toFixed(3)} m at ${REFERENCE_HEIGHT} m)`);
