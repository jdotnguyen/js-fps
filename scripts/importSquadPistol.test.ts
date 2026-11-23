import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NodeIO, type Node as GNode } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as THREE from 'three';

/**
 * The squad pistol as `scripts/import-squad-pistol.mjs` writes it (squad-sidearms task 1.1, design D1): its size and
 * axes, its two meshes and three markers, and its triangle, texture and file budgets. It reads the committed asset, since
 * the raw download lives outside the repo.
 */

const ROOT = resolve(import.meta.dirname, '..');
const GLB = join(ROOT, 'public/assets/models/weapons/squad_pistol.glb');

const load = async () => new NodeIO().registerExtensions(ALL_EXTENSIONS).read(GLB);
const named = (nodes: GNode[], name: string): GNode => {
  const n = nodes.find((x) => x.getName() === name);
  assert.ok(n, `node ${name}`);
  return n;
};

test('squad pistol: 0.19-0.20 m long, barrel along -Z, every marker on the gun', async () => {
  const doc = await load();
  const nodes = doc.getRoot().listNodes();
  const box = new THREE.Box3();
  for (const n of nodes) {
    for (const p of n.getMesh()?.listPrimitives() ?? []) {
      const a = p.getAttribute('POSITION')!;
      box.expandByPoint(new THREE.Vector3(...(a.getMin([]) as [number, number, number])));
      box.expandByPoint(new THREE.Vector3(...(a.getMax([]) as [number, number, number])));
    }
  }
  const size = box.getSize(new THREE.Vector3());
  assert.ok(size.z >= 0.19 && size.z <= 0.2, `length ${size.z.toFixed(4)} m`);
  assert.ok(size.z > size.y && size.z > size.x * 4, 'the gun runs along Z');
  const at = (name: string) => new THREE.Vector3(...(named(nodes, name).getTranslation() as [number, number, number]));
  const muzzle = at('muzzle');
  const grip = at('grip');
  const port = at('ejectPort');
  // The muzzle is the gun's front: at its -Z end, ahead of the grip and above it.
  assert.ok(Math.abs(muzzle.z - box.min.z) < 0.003, `muzzle z ${muzzle.z.toFixed(4)} at the front (${box.min.z.toFixed(4)})`);
  assert.ok(muzzle.z < grip.z - 0.1 && muzzle.y > grip.y, 'the barrel points -Z from the grip');
  // The ejection port: on the slide's right (+X) side, between the grip and the muzzle.
  assert.ok(port.x > 0.008 && port.z < grip.z && port.z > muzzle.z && port.y > grip.y, `ejectPort ${port.toArray()}`);
  // The grip marker is inside the grip, its +Y up the grip axis (leaning forward at the top, 10-25° off the barrel's normal).
  assert.ok(box.containsPoint(grip));
  const q = new THREE.Quaternion(...(named(nodes, 'grip').getRotation() as [number, number, number, number]));
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  const lean = THREE.MathUtils.radToDeg(up.angleTo(new THREE.Vector3(0, 1, 0)));
  assert.ok(up.z < 0 && lean > 10 && lean < 25, `grip axis leans ${lean.toFixed(1)}°`);
  assert.ok(fwd.z < -0.9 && Math.abs(fwd.dot(up)) < 1e-4, 'grip -Z is forward, square to the axis');
});

test('squad pistol: `slide` and `frame` meshes, at most about 3,200 triangles in all', async () => {
  const doc = await load();
  const nodes = doc.getRoot().listNodes();
  let tris = 0;
  for (const name of ['slide', 'frame']) {
    const mesh = named(nodes, name).getMesh();
    assert.ok(mesh, `${name} has a mesh`);
    assert.equal(mesh.listPrimitives().length, 1, `${name}: one material`);
    for (const p of mesh.listPrimitives()) tris += p.getIndices()!.getCount() / 3;
  }
  assert.equal(nodes.filter((n) => n.getMesh()).length, 2, 'no other meshes');
  assert.ok(tris <= 3200, `${tris} triangles`);
});

test('squad pistol: WebP textures of 512 px or less, the file under 0.6 MB', async () => {
  const doc = await load();
  const texs = doc.getRoot().listTextures();
  assert.ok(texs.length > 0);
  for (const t of texs) {
    assert.equal(t.getMimeType(), 'image/webp', t.getName());
    const [w, h] = t.getSize() ?? [Infinity, Infinity];
    assert.ok(w <= 512 && h <= 512, `${t.getName()} ${w}x${h}`);
  }
  const bytes = statSync(GLB).size;
  assert.ok(bytes < 0.6 * 1024 * 1024, `${(bytes / 1024).toFixed(0)} KB`);
  // The credit travels with the file.
  const json = JSON.parse(Buffer.from(readFileSync(GLB)).subarray(20, 20 + readFileSync(GLB).readUInt32LE(12)).toString('utf8')) as { asset: { extras?: { author?: string } } };
  assert.match(json.asset.extras?.author ?? '', /Urpo/);
});
