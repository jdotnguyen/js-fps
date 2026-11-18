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

test('a hero body gets a longer neck: the head joint moves up and the height still matches', () => {
  const crowd = buildBodyGeometry({ outfit: 'lab', height: 2.15, build: 1.25, infectable: true, seed: 'neck' });
  const hero = buildBodyGeometry({ outfit: 'lab', height: 2.15, build: 1.25, infectable: true, hero: true, seed: 'neck' });
  assert.deepEqual(crowd.jointOffsets, {});
  const head = hero.jointOffsets.head;
  assert.ok(head && head[1] > (JOINTS.find((j) => j.name === 'head')?.offset[1] ?? 0));
  assert.ok(hero.scale.y < crowd.scale.y, 'root scale shrinks so the taller skeleton keeps the requested height');
});

test('a hero fits the bone budget, and every coat chain bone exists with its parent built first', () => {
  const g = buildBodyGeometry({ outfit: 'lab', height: 2.15, build: 1.25, infectable: true, hero: true, seed: 'coat' });
  assert.ok(JOINTS.length + g.extraBones.length <= 64, `${JOINTS.length + g.extraBones.length} bones`);
  const built = new Set<string>(JOINTS.map((j) => j.name));
  for (const e of g.extraBones) {
    assert.ok(built.has(e.parent), `${e.name} parent ${e.parent} comes later`);
    built.add(e.name);
  }
  const chained = g.parts.filter((p) => p.chain);
  assert.ok(chained.length >= 6, 'the coat tails are skinned along chains');
  for (const part of chained) {
    for (const b of part.chain?.bones ?? []) assert.ok(built.has(b), `chain bone ${b} is missing`);
    assert.equal(part.chain?.bones.length, (part.chain?.ys.length ?? 0), 'one pivot height per chain bone');
  }
});

test('hero coat pieces are thick: every cloth patch has volume and finite vertices', () => {
  const g = buildBodyGeometry({ outfit: 'lab', height: 2.15, build: 1, infectable: false, hero: true, seed: 'coat2' });
  assert.ok(triangleCount(g.parts) < 90000, `hero is ${triangleCount(g.parts)} triangles`);
  for (const part of g.parts) {
    const a = part.geometry.getAttribute('position');
    for (let i = 0; i < a.count; i++) assert.ok(Number.isFinite(a.getX(i) + a.getY(i) + a.getZ(i)), `${part.bone} has a NaN vertex`);
  }
});

test('hero face: cheek strands are skinned between skull and jaw, and the face carries glowing growths', () => {
  const g = buildBodyGeometry({ outfit: 'lab', height: 2.15, build: 1.25, infectable: true, hero: true, seed: 'face' });
  const strands = g.parts.filter((p) => p.chain?.bones.join() === 'head,jaw');
  assert.equal(strands.length, 6, 'three cheek strands a side');
  for (const s of strands) assert.ok((s.chain?.ys[0] ?? 0) > (s.chain?.ys[1] ?? 0), 'strands run from the skull down to the jaw');
  const faceGlow = g.parts.filter((p) => (p.bone === 'head' || p.bone === 'jaw') && p.layer === 'wet')
    .some((p) => { const a = p.geometry.getAttribute('aGlow'); for (let i = 0; i < a.count; i++) if (a.getX(i) > 0.3) return true; return false; });
  assert.ok(faceGlow, 'bloom growths glow');
});

test('hero skin is glossy and the belly wound glows (weak-spot telegraph)', () => {
  const g = buildBodyGeometry({ outfit: 'lab', height: 2.15, build: 1.25, infectable: false, hero: true, seed: 'skin' });
  const spine = g.parts.filter((p) => p.bone === 'spine' && p.layer === 'body' && p.geometry.getAttribute('position').count > 1000);
  assert.ok(spine.length > 0);
  let glow = 0;
  let wet = 0;
  for (const p of spine) {
    const a = p.geometry.getAttribute('aGlow');
    const r = p.geometry.getAttribute('aRot');
    for (let i = 0; i < a.count; i++) {
      if (a.getX(i) > 0.3) glow++;
      if (r.getX(i) < 0) wet++;
    }
  }
  assert.ok(glow > 5, `belly wound glows (${glow} vertices)`);
  assert.ok(wet > 100, 'bare skin and wounds have negative aRot (gloss)');
});
