import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Document, type Document as Doc } from '@gltf-transform/core';
import { KHRLightsPunctual } from '@gltf-transform/extensions';
import type { PropSource } from './config.ts';
import { applyConventions } from './convention.ts';
import { readSource } from './readers.ts';
import { addBox, addSphere, fbxFixture } from './testFixtures.ts';

const entry = (over: Partial<PropSource>): PropSource => ({
  id: 'thing', source: 'thing.glb', licence: 'CC0', author: 'a', title: 't', url: 'u', height: 1, triBudget: 100000, ...over,
});

function bounds(doc: Doc): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const n of doc.getRoot().listNodes()) {
    const t = n.getWorldMatrix();
    for (const p of n.getMesh()?.listPrimitives() ?? []) {
      const a = p.getAttribute('POSITION')!;
      const e: number[] = [];
      for (let i = 0; i < a.getCount(); i++) {
        a.getElement(i, e);
        const w = [0, 1, 2].map((k) => t[k]! * e[0]! + t[4 + k]! * e[1]! + t[8 + k]! * e[2]! + t[12 + k]!);
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k]!, w[k]!);
          max[k] = Math.max(max[k]!, w[k]!);
        }
      }
    }
  }
  return { min, max };
}

test('Centimetre FBX: scaled to its configured height and standing on y = 0', async () => {
  const [, path] = fbxFixture();
  const { doc } = await readSource(path);
  const r = await applyConventions(doc, entry({ source: 'Water_Barrel.fbx', height: 1.2 }));
  const b = bounds(doc);
  assert.ok(Math.abs(b.max[1]! - b.min[1]! - 1.2) <= 0.01, `height ${b.max[1]! - b.min[1]!}`);
  assert.ok(Math.abs(b.min[1]!) < 1e-4, `min y ${b.min[1]}`);
  assert.ok(Math.abs(b.min[0]! + b.max[0]!) < 1e-3 && Math.abs(b.min[2]! + b.max[2]!) < 1e-3, 'centred on x and z');
  assert.ok(Math.abs(r.size[1] - 1.2) <= 0.01);
});

test('Demo scene source: camera, light and dropped wall are gone; only the configured meshes stay', async () => {
  const doc = new Document();
  doc.createBuffer();
  doc.createMaterial('mat_biomass');
  const scene = doc.createScene();
  scene.addChild(doc.createNode('Camera').setCamera(doc.createCamera('cam')));
  const lights = doc.createExtension(KHRLightsPunctual);
  scene.addChild(doc.createNode('Light').setExtension('KHR_lights_punctual', lights.createLight('sun')));
  scene.addChild(doc.createNode('wall').setMesh(addBox(doc, 'wall', [-3, 0, 0], [3, 3, 0.1])));
  scene.addChild(doc.createNode('blob').setMesh(addSphere(doc, 'blob', 0.5, 12)));
  doc.createAnimation('preview');
  await applyConventions(doc, entry({ drop: ['wall'] }));
  const root = doc.getRoot();
  assert.deepEqual(root.listNodes().map((n) => n.getName()), ['body']);
  assert.equal(root.listCameras().length, 0);
  assert.equal(root.listAnimations().length, 0);
  assert.equal(root.listExtensionsUsed().some((e) => e.extensionName === 'KHR_lights_punctual'), false);
  const b = bounds(doc);
  assert.ok(b.max[0]! - b.min[0]! < 1.01, 'the 6 m wall is not in the bounds');
});

test('Over budget: a 21k-triangle source comes out at or under a 4,000 budget', async () => {
  const doc = new Document();
  doc.createBuffer();
  doc.createMaterial('m');
  doc.createScene().addChild(doc.createNode('ball').setMesh(addSphere(doc, 'ball', 1, 103)));
  const r = await applyConventions(doc, entry({ triBudget: 4000 }));
  assert.ok(r.triangles <= 4000 && r.triangles > 2000, `${r.triangles} triangles`);
});

test('keeps only POSITION, NORMAL and TEXCOORD_0, as unquantized floats', async () => {
  const doc = new Document();
  doc.createBuffer();
  doc.createMaterial('m');
  const mesh = addBox(doc, 'b', [0, 0, 0], [1, 1, 1]);
  const prim = mesh.listPrimitives()[0]!;
  prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC4').setArray(new Float32Array(24 * 4)));
  prim.setAttribute('TEXCOORD_1', doc.createAccessor().setType('VEC2').setArray(new Float32Array(24 * 2)));
  doc.createScene().addChild(doc.createNode('b').setMesh(mesh));
  await applyConventions(doc, entry({}));
  for (const p of doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives())) {
    assert.deepEqual(p.listSemantics().sort(), ['NORMAL', 'POSITION', 'TEXCOORD_0']);
    for (const s of p.listSemantics()) assert.ok(p.getAttribute(s)!.getArray() instanceof Float32Array, s);
  }
});

test('front +z turns the model to face -Z', async () => {
  const doc = new Document();
  doc.createBuffer();
  doc.createMaterial('m');
  // A 1 m tall slab with a nose sticking out toward +Z (its front in the file).
  const scene = doc.createScene();
  scene.addChild(doc.createNode('slab').setMesh(addBox(doc, 'slab', [-0.5, 0, -0.1], [0.5, 1, 0.1])));
  scene.addChild(doc.createNode('nose').setMesh(addBox(doc, 'nose', [-0.1, 0.4, 0.1], [0.1, 0.6, 0.5])));
  await applyConventions(doc, entry({ front: '+z' }));
  // The nose's vertices (the only ones between y 0.39 and 0.61) must now lie on the -Z side.
  const zs: number[] = [];
  const e: number[] = [];
  for (const p of doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives())) {
    const a = p.getAttribute('POSITION')!;
    for (let i = 0; i < a.getCount(); i++) {
      a.getElement(i, e);
      if (e[1]! > 0.39 && e[1]! < 0.61) zs.push(e[2]!);
    }
  }
  assert.ok(zs.length > 0 && Math.max(...zs) < 0.11, `nose z ${Math.min(...zs)} .. ${Math.max(...zs)}`);
  assert.ok(Math.min(...zs) < -0.25, 'nose reaches toward -Z');
});

/** A cabinet like the Naked Singularity one: body plus two door nodes whose origins are their hinges. */
function cabinet(doorOpen: boolean): Document {
  const doc = new Document();
  doc.createBuffer();
  doc.createMaterial('metal');
  const scene = doc.createScene();
  scene.addChild(doc.createNode('body').setMesh(addBox(doc, 'body', [-0.6, 0, -0.2], [0.6, 1.8, 0.2])));
  // Doors hang off the +Z face (the front in the file); each door's geometry runs from its hinge toward the middle.
  const open = doorOpen ? [0, Math.sin(-Math.PI / 3), 0, Math.cos(-Math.PI / 3)] as [number, number, number, number] : [0, 0, 0, 1] as [number, number, number, number];
  scene.addChild(doc.createNode('door_l').setTranslation([0.6, 0.1, 0.2]).setRotation(open).setMesh(addBox(doc, 'dl', [-0.6, 0, 0], [0, 1.6, 0.03])));
  scene.addChild(doc.createNode('door_r').setTranslation([-0.6, 0.1, 0.2]).setMesh(addBox(doc, 'dr', [0, 0, 0], [0.6, 1.6, 0.03])));
  return doc;
}

test('Cabinet doors: two PART nodes on their hinges, body fixed, closed on request', async () => {
  const doc = cabinet(true);
  const r = await applyConventions(doc, entry({
    height: 1.8,
    front: '+z',
    parts: { door_l: { node: 'door_l', closed: true }, door_r: { node: 'door_r', closed: true } },
  }));
  assert.deepEqual(r.parts.sort(), ['door_l', 'door_r']);
  const nodes = doc.getRoot().listNodes();
  assert.deepEqual(nodes.map((n) => n.getName()).sort(), ['PART_door_l', 'PART_door_r', 'body']);
  for (const name of ['PART_door_l', 'PART_door_r']) {
    const n = nodes.find((x) => x.getName() === name)!;
    const [hx, , hz] = n.getTranslation();
    // After the +z -> -Z turn the doors are on the -Z face, hinges at the outer edges.
    assert.ok(Math.abs(Math.abs(hx) - 0.6) < 1e-3, `${name} hinge x ${hx}`);
    assert.ok(hz < -0.15, `${name} hinge z ${hz}`);
    // Closed: the door is flat across the front (thin in z) and one edge sits on the hinge line (x = 0 locally).
    const a = n.getMesh()!.listPrimitives()[0]!.getAttribute('POSITION')!;
    const min = a.getMin([]);
    const max = a.getMax([]);
    assert.ok(max[2]! - min[2]! < 0.05, `${name} is closed (depth ${max[2]! - min[2]!})`);
    assert.ok(Math.abs(min[0]!) < 1e-3 || Math.abs(max[0]!) < 1e-3, `${name} hinge edge at x 0 (${min[0]} .. ${max[0]})`);
    assert.ok(Math.abs(max[0]! - min[0]! - 0.6) < 1e-3, `${name} is 0.6 m wide`);
  }
});

test('A part without closed keeps its source pose', async () => {
  const doc = cabinet(true);
  await applyConventions(doc, entry({ height: 1.8, front: '+z', parts: { door_l: { node: 'door_l' } } }));
  const n = doc.getRoot().listNodes().find((x) => x.getName() === 'PART_door_l')!;
  const a = n.getMesh()!.listPrimitives()[0]!.getAttribute('POSITION')!;
  assert.ok(a.getMax([])[2]! - a.getMin([])[2]! > 0.4, 'the open door sticks out of the front');
});

test('A part naming a missing node is an error', async () => {
  await assert.rejects(applyConventions(cabinet(false), entry({ parts: { lid: { node: 'nope' } } })), /part lid: node "nope" not found/);
});

test('materials of dropped meshes are pruned', async () => {
  const doc = new Document();
  doc.createBuffer();
  const keep = doc.createMaterial('mat_biomass');
  const wall = doc.createMaterial('mat_concrete');
  const scene = doc.createScene();
  scene.addChild(doc.createNode('blob').setMesh(addBox(doc, 'blob', [0, 0, 0], [1, 1, 1], keep)));
  scene.addChild(doc.createNode('wall').setMesh(addBox(doc, 'wall', [2, 0, 0], [3, 3, 0.1], wall)));
  await applyConventions(doc, entry({ keep: ['mat:mat_biomass'] }));
  assert.deepEqual(doc.getRoot().listMaterials().map((m) => m.getName()), ['mat_biomass']);
});
