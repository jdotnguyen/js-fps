import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Document } from '@gltf-transform/core';
import { findMaps, readSource } from './readers.ts';
import { addBox, fbxFixture, tempDir, writeGlb, writePng } from './testFixtures.ts';

test('reads a GLB and maps its metal-rough and occlusion channels', async () => {
  const doc = new Document();
  doc.createBuffer();
  const tex = doc.createTexture('mr').setImage(new Uint8Array([1, 2, 3])).setMimeType('image/png');
  const m = doc.createMaterial('paint').setMetallicRoughnessTexture(tex).setOcclusionTexture(tex);
  doc.createScene().addChild(doc.createNode('box').setMesh(addBox(doc, 'box', [0, 0, 0], [1, 1, 1], m)));
  const path = await writeGlb(doc, tempDir(), 'box.glb');
  const { doc: read, maps } = await readSource(path);
  const mat = read.getRoot().listMaterials()[0]!;
  const set = maps.get(mat)!;
  assert.equal(set.roughness?.channel, 'G');
  assert.equal(set.metalness?.channel, 'B');
  assert.equal(set.ao?.channel, 'R');
  assert.equal(set.normalDx, false);
});

test('finds FBX maps by suffix, including a DirectX normal', () => {
  const dir = tempDir();
  for (const f of ['Thing_Base_Color.png', 'Thing_Normal_DirectX.png', 'Thing_Roughness.png', 'Thing_Metallic.png', 'Thing_Height.png']) writePng(dir, f);
  assert.deepEqual(findMaps(dir), {
    color: 'Thing_Base_Color.png',
    normal: 'Thing_Normal_DirectX.png',
    normalDx: true,
    roughness: 'Thing_Roughness.png',
    metalness: 'Thing_Metallic.png',
  });
  const gl = tempDir();
  writePng(gl, 'Can_Normal.png');
  assert.deepEqual(findMaps(gl), { normal: 'Can_Normal.png', normalDx: false });
});

test('reads the CC0 water barrel FBX without a DOM, with its maps from the folder', async () => {
  const [dir, path] = fbxFixture();
  for (const f of ['Water_Barrel_Base_Color.png', 'Water_Barrel_Normal_DirectX.png', 'Water_Barrel_Roughness.png', 'Water_Barrel_Metallic.png']) writePng(dir, f);
  const { doc, maps } = await readSource(path);
  const root = doc.getRoot();
  const tris = root.listMeshes().flatMap((m) => m.listPrimitives()).reduce((n, p) => n + p.getIndices()!.getCount() / 3, 0);
  assert.equal(tris, 384);
  assert.ok(root.listNodes().some((n) => n.getName() === 'Water_Barrel'), root.listNodes().map((n) => n.getName()).join(','));
  const set = maps.get(root.listMaterials()[0]!)!;
  assert.equal(set.color?.getURI(), 'Water_Barrel_Base_Color.png');
  assert.equal(set.normalDx, true);
  assert.equal(set.roughness?.texture.getURI(), 'Water_Barrel_Roughness.png');
  assert.equal(set.ao, null);
});

test('an unsupported source type is an error', async () => {
  await assert.rejects(readSource('thing.obj'), /unsupported source type/);
});
