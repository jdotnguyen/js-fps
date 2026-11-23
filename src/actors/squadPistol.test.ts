import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as THREE from 'three';
import { makeHeldPistol, PISTOL_MARKERS, PISTOL_SHAPE, pistolDistance, pistolParts, SLIDE_CYCLE, SLIDE_TRAVEL, slideOffset } from './squadPistol.ts';

/** The squad pistol's constants against its model, and the slide kick (squad-sidearms D1, D2, D4). */

const GLB = join(resolve(import.meta.dirname, '../..'), 'public/assets/models/weapons/squad_pistol.glb');

test('marker constants match the model\'s markers', async () => {
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(GLB);
  const node = (name: string) => doc.getRoot().listNodes().find((n) => n.getName() === name)!;
  for (const name of ['muzzle', 'ejectPort', 'grip'] as const) {
    const t = new THREE.Vector3(...(node(name).getTranslation() as [number, number, number]));
    assert.ok(t.distanceTo(PISTOL_MARKERS[name]) < 1e-4, `${name} ${t.toArray()} vs ${PISTOL_MARKERS[name].toArray()}`);
  }
  const q = new THREE.Quaternion(...(node('grip').getRotation() as [number, number, number, number]));
  assert.ok(q.angleTo(PISTOL_MARKERS.gripRotation) < 1e-3, 'grip rotation');
});

test('the shape boxes cover the model: most frame vertices within 4 mm of the solid, none of them 1 cm outside the grip box below the frame', async () => {
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(GLB);
  const inv = new THREE.Matrix4().compose(PISTOL_MARKERS.grip, PISTOL_MARKERS.gripRotation, new THREE.Vector3(1, 1, 1)).invert();
  let near = 0;
  let total = 0;
  let worstGrip = 0;
  for (const n of doc.getRoot().listNodes()) {
    const a = n.getMesh()?.listPrimitives()[0]?.getAttribute('POSITION');
    if (!a) continue;
    const v: number[] = [];
    for (let i = 0; i < a.getCount(); i++) {
      a.getElement(i, v);
      const p = new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(inv);
      total++;
      if (pistolDistance(p) < 0.004) near++;
      if (p.y < PISTOL_SHAPE.upper.centre.y - PISTOL_SHAPE.upper.half.y - 0.003 && p.y > -0.045) worstGrip = Math.max(worstGrip, pistolDistance(p));
    }
  }
  assert.ok(near / total > 0.95, `${((near / total) * 100).toFixed(1)}% of vertices on the shape`);
  assert.ok(worstGrip < 0.01, `a grip vertex ${(worstGrip * 1000).toFixed(1)} mm outside the grip box`);
});

test('a held pistol has its markers before the model loads, with its grip marker on the given frame', () => {
  const frame = { position: new THREE.Vector3(0.01, -0.07, 0.02), quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.2, 1.1)) };
  const held = makeHeldPistol(frame);
  const parts = pistolParts(held);
  held.updateMatrixWorld(true);
  const p = parts.grip.getWorldPosition(new THREE.Vector3());
  const q = parts.grip.getWorldQuaternion(new THREE.Quaternion());
  assert.ok(p.distanceTo(frame.position) < 1e-6, 'grip marker at the frame');
  assert.ok(q.angleTo(frame.quaternion) < 1e-5, 'grip marker turned to the frame');
  assert.ok(parts.muzzle.position.distanceTo(PISTOL_MARKERS.muzzle) < 1e-9);
});

test('slide kick: back on the shot, closed again within 0.15 s, at rest otherwise', () => {
  assert.equal(slideOffset(-0.01), 0);
  assert.equal(slideOffset(Number.NaN), 0);
  let peak = 0;
  for (let t = 0; t <= 0.3; t += 0.001) {
    const x = slideOffset(t);
    assert.ok(x >= 0 && x <= SLIDE_TRAVEL + 1e-9, `within the travel at ${t}`);
    peak = Math.max(peak, x);
    if (t >= 0.15) assert.equal(x, 0, `closed at ${t.toFixed(3)} s`);
  }
  assert.ok(peak > SLIDE_TRAVEL * 0.95, 'reaches full travel');
  assert.ok(SLIDE_CYCLE <= 0.15);
});
