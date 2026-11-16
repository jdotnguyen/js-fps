import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BODY_ATTRIBUTES, buildBodyGeometry, OUTFITS, triangleCount } from './bodyGeometry.ts';
import { loadPoseFile } from '../data/types/poses.ts';
import { PoseLibrary } from './poses.ts';
import { JOINT_NAMES, JOINTS, subtree } from './skeleton.ts';

test('every outfit stays inside the 8-15k triangle budget (ADR-0006, raised for gore detail)', () => {
  for (const outfit of OUTFITS) {
    for (const infectable of [false, true]) {
      const g = buildBodyGeometry({ outfit, height: 1.78, build: 1, infectable, seed: `t-${outfit}` });
      const tris = triangleCount(g.parts);
      assert.ok(tris >= 8000 && tris <= 15000, `${outfit} infectable=${infectable}: ${tris} triangles`);
    }
  }
});

test('all pieces share one attribute layout so they merge into one skinned mesh', () => {
  const g = buildBodyGeometry({ outfit: 'lab', height: 1.78, build: 1, infectable: true, seed: 'attrs' });
  for (const p of g.parts) {
    const names = Object.keys(p.geometry.attributes).sort().join(',');
    assert.equal(names, [...BODY_ATTRIBUTES].join(','), `${p.bone}: ${names}`);
    assert.ok(p.geometry.getIndex(), `${p.bone} is not indexed`);
  }
});

test('same seed, same body', () => {
  const a = buildBodyGeometry({ outfit: 'crew', height: 1.78, build: 1, infectable: true, seed: 'same' });
  const b = buildBodyGeometry({ outfit: 'crew', height: 1.78, build: 1, infectable: true, seed: 'same' });
  assert.equal(triangleCount(a.parts), triangleCount(b.parts));
  const pa = a.parts[5]?.geometry.getAttribute('position').array;
  const pb = b.parts[5]?.geometry.getAttribute('position').array;
  assert.deepEqual(pa, pb);
});

test('shipped poses.json is valid and compiles', () => {
  const raw: unknown = JSON.parse(readFileSync(new URL('../data/poses.json', import.meta.url), 'utf8'));
  const lib = new PoseLibrary(loadPoseFile(raw));
  for (const name of ['idle', 'shamble', 'crawl', 'dragging', 'corpseProne', 'corpseSupine', 'corpseSide', 'blindFlail', 'typing', 'crouchWork', 'corpseSlumped']) {
    assert.ok(lib.has(name), `missing pose ${name}`);
  }
  assert.ok(lib.sequence('getUp').length >= 3);
});

test('a typo in a joint name is rejected with a path', () => {
  assert.throws(() => loadPoseFile({ poses: { bad: { joints: { thigh_X: [0, 0, 0] } } }, sequences: {} }), /poses > bad > joints > thigh_X: unknown joint/);
});

test('severing a thigh takes the shin and foot', () => {
  assert.deepEqual(subtree('thigh_L'), ['thigh_L', 'shin_L', 'foot_L']);
  assert.equal(JOINTS[0]?.name, 'root');
});

test('JOINT_NAMES and JOINTS list joints in the same order (pose data is indexed by it)', () => {
  assert.deepEqual([...JOINT_NAMES], JOINTS.map((j) => j.name));
});

test('a pose rotates the joint it names', () => {
  const lib = new PoseLibrary(loadPoseFile({ poses: { p: { joints: { thigh_L: [90, 0, 0] } } }, sequences: {} }));
  const pose = lib.get('p');
  JOINTS.forEach((j, i) => {
    const w = pose.joints[i]?.w ?? 1;
    if (j.name === 'thigh_L') assert.ok(Math.abs(w - Math.cos(Math.PI / 4)) < 1e-6);
    else assert.ok(Math.abs(w - 1) < 1e-9, `${j.name} moved`);
  });
});

test('an infectable body fits the bone budget and every extra bone has a built parent', () => {
  const g = buildBodyGeometry({ outfit: 'crew', height: 1.78, build: 1, infectable: true, seed: 'bones' });
  assert.ok(JOINTS.length + g.extraBones.length <= 64, `${JOINTS.length + g.extraBones.length} bones`);
  const built = new Set<string>(JOINTS.map((j) => j.name));
  for (const e of g.extraBones) {
    assert.ok(built.has(e.parent), `${e.name} parent ${e.parent} comes later`);
    built.add(e.name);
  }
});
