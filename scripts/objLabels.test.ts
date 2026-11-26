import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error plain ES module without types
import { UNREAL_BONE, matchPositions, objPositionIndex, readObjLabels, triangleLabels } from './lib/obj-labels.mjs';

/**
 * The OBJ label reader (openspec rebuild-heins-rig D1, D4) on a small synthetic export: two quads labelled by bone, one under an
 * object group (unlabelled), and a GLB-like copy that is triangulated, split at a seam, reordered and turned into another frame.
 */
const OBJ = `# Blender 3.6.3
mtllib x.mtl
g Body_Mesh
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v 2 0 0
v 2 1 0
v 5 5 5
v 6 5 5
v 6 6 5
vt 0 0
vn 0 0 1
s 1
g spine_01
g Body_Skin
usemtl Skin
g spine_01
f 1/1/1 2/1/1 3/1/1 4/1/1
g neck_02
f 2//1 5//1 6//1 3//1
g Plate.003_Skin
usemtl Metal
f -3 -2 -1
`;

test('obj labels: a face takes the bone group written before it, and object groups label nothing', () => {
  const obj = readObjLabels(OBJ);
  assert.equal(obj.pos.length / 3, 9);
  assert.deepEqual(Array.from(obj.faceStart), [0, 4, 8, 11]);
  assert.deepEqual(Array.from(obj.faceVerts), [0, 1, 2, 3, 1, 4, 5, 2, 6, 7, 8]);
  assert.deepEqual(Array.from(obj.faceLabel, (l: number) => (l < 0 ? null : obj.labels[l])), ['spine_01', 'neck_02', null]);
  // The object group is the latest group that is not a bone, kept across the bone groups inside it.
  assert.deepEqual(Array.from(obj.faceObject, (o: number) => obj.objects[o]), ['Body_Skin', 'Body_Skin', 'Plate.003_Skin']);
  assert.deepEqual(Array.from(obj.faceMaterial, (m: number) => obj.materials[m]), ['Skin', 'Skin', 'Metal']);
});

test('obj labels: GLB triangles find their face by position across a seam, a reorder and a change of frame', () => {
  const obj = readObjLabels(OBJ);
  const index = objPositionIndex(obj);
  // GLB frame: OBJ (x, y, z) is stored as (x, -z, y), so the reader is told OBJ = (x, z, -y). Vertex 1,0,0 (OBJ 2) is split in two
  // at a UV seam, the order is shuffled, and one stray vertex matches nothing.
  const glb = (x: number, y: number, z: number): number[] => [x, -z, y];
  const verts = [[1, 1, 0], [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 0, 0], [2, 0, 0], [2, 1, 0], [5, 5, 5], [6, 5, 5], [6, 6, 5], [9, 9, 9]];
  // A rounding error under the grid still matches.
  const positions = Float64Array.from(verts.flatMap(([x, y, z]) => glb(x! + 1e-7, y!, z!)));
  const keys = matchPositions(index, positions, { toObj: (x: number, y: number, z: number) => [x, z, -y] });
  assert.equal(keys[10], -1, 'stray vertex unmatched');
  assert.equal(keys[2], keys[4], 'both halves of a seam vertex find the same position');
  for (let v = 0; v < 10; v++) assert.ok(keys[v] >= 0, `vertex ${v} matched`);
  // Triangles: quad 1 as (1, 2, 0) and (1, 0, 3); quad 2 as (4, 5, 6) and (4, 6, 0), which shares the quads' common edge; the
  // metal plate; and one triangle spanning both quads, which no face holds.
  const tris = Uint32Array.from([1, 2, 0, 1, 0, 3, 4, 5, 6, 4, 6, 0, 7, 8, 9, 1, 5, 6]);
  const labels = triangleLabels(obj, index, keys, tris);
  assert.deepEqual(Array.from(labels, (l: number) => (l < 0 ? null : obj.labels[l])), ['spine_01', 'spine_01', 'neck_02', 'neck_02', null, null]);
});

test('obj labels: the Unreal-style bone names are labels, mesh and material groups are not', () => {
  for (const g of ['pelvis', 'spine_04', 'neck_01', 'head', 'clavicle_r', 'upperarm_twist_01_l', 'lowerarm_r', 'hand_l', 'thumb_03_l', 'pinky_metacarpal_l', 'thigh_twist_02_r', 'calf_twist_01_l', 'foot_r', 'ball_l']) {
    assert.ok(UNREAL_BONE.test(g), g);
  }
  for (const g of ['Body.006_Head', 'Face.002_Teeth', 'hair_Hair', 'Tips', 'cable.001_Cyber_Arm', 'Aver_Aver', 'headset']) assert.ok(!UNREAL_BONE.test(g), g);
});
