import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NodeIO, type Document, type Mesh } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer/meshopt_decoder.module.js';
import * as THREE from 'three';
// @ts-expect-error plain ES module without types
import { REPAIRS, SIZE, repairPixels } from './lib/pistolTextures.mjs';

/**
 * The first-person weapon models as `scripts/fix-just-weapons-glb.mjs` writes them (swap-viewmodels-to-just-models): the
 * clips and bones the viewmodel code names, no rig leftovers, the author's licence, a size budget, and above all that every
 * gun part sits on its bones in the rest pose. The Sketchfab files fail that last check by a factor of 17 or more. The test
 * reads the committed assets, since the sources live outside the repo.
 */

const ROOT = resolve(import.meta.dirname, '..');
const DIR = join(ROOT, 'public/assets/models/weapons');

const load = async (name: string): Promise<Document> => {
  await MeshoptDecoder.ready;
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder }).read(join(DIR, name));
};

/** The rest-pose world bounds of a skinned mesh: sum of weight * joint-world * inverse-bind, applied to each vertex. */
function restBounds(doc: Document, mesh: Mesh): THREE.Box3 {
  const skin = doc.getRoot().listSkins()[0]!;
  const joints = skin.listJoints();
  const ibm = skin.getInverseBindMatrices()!;
  const skinMat = joints.map((j, i) => new THREE.Matrix4().fromArray(j.getWorldMatrix()).multiply(new THREE.Matrix4().fromArray(ibm.getElement(i, []))));
  const prim = mesh.listPrimitives()[0]!;
  const pos = prim.getAttribute('POSITION')!;
  const jnt = prim.getAttribute('JOINTS_0')!;
  const wgt = prim.getAttribute('WEIGHTS_0')!;
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  const sum = new THREE.Matrix4();
  for (let i = 0; i < pos.getCount(); i++) {
    sum.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    const j = jnt.getElement(i, []);
    const w = wgt.getElement(i, []);
    for (let k = 0; k < 4; k++) for (let e = 0; e < 16; e++) sum.elements[e]! += skinMat[j[k]!]!.elements[e]! * w[k]!;
    box.expandByPoint(v.fromArray(pos.getElement(i, [])).applyMatrix4(sum));
  }
  return box;
}

const meshNamed = (doc: Document, name: string): Mesh => {
  const m = doc.getRoot().listMeshes().find((x) => x.getName() === name);
  assert.ok(m, `mesh ${name}`);
  return m;
};
const boneAt = (doc: Document, name: string): THREE.Vector3 => {
  const n = doc.getRoot().listNodes().find((x) => x.getName() === name);
  assert.ok(n, `bone ${name}`);
  return new THREE.Vector3(...(n.getWorldTranslation() as [number, number, number]));
};
const clipNames = (doc: Document): string[] => doc.getRoot().listAnimations().map((a) => a.getName().replace(/^.*\|/, ''));

const GUNS = {
  'pistol.glb': { clips: ['Take', 'Shoot', 'Reload', 'Hide'], bones: ['Base', 'Up', 'Mag'], maxMB: 3.0 },
  'shotgun.glb': { clips: ['Take', 'Watch', 'Shoot', 'ReloadStart', 'Reload', 'ReloadEnd', 'Hide'], bones: ['Base', 'Pump', 'Shell'], maxMB: 2.5 },
} as const;

for (const [file, want] of Object.entries(GUNS)) {
  test(`${file}: the clips and gun bones the viewmodel names, no rig leftovers, the author's licence`, async () => {
    const doc = await load(file);
    const have = clipNames(doc);
    for (const c of want.clips) assert.ok(have.includes(c), `clip ${c} in ${have.join(', ')}`);
    const names = doc.getRoot().listNodes().map((n) => n.getName());
    for (const b of want.bones) assert.ok(names.includes(b), `bone ${b}`);
    assert.ok(!names.some((n) => /^(Base|Up|Mag|Pump|Shell)_\d+$/.test(n)), 'gun bones are renamed');
    for (const junk of ['crosshair', 'Sun', 'shape_pose', 'Cube.005', 'Cube.002', 'Cylinder.001']) assert.ok(!names.includes(junk), `${junk} is gone`);
    assert.ok(!doc.getRoot().listMaterials().some((m) => m.getName() === 'crosshair'), 'the crosshair material is gone');
    const extras = doc.getRoot().getExtras() as { license?: string; author?: string };
    assert.equal(extras.license, 'CC-BY-4.0');
    assert.ok(extras.author?.includes('JUST'), 'credited to JUST');
    assert.ok(doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'EXT_texture_webp'), 'WebP textures');
    const mb = statSync(join(DIR, file)).size / 1e6;
    assert.ok(mb < want.maxMB, `${mb.toFixed(2)} MB`);
  });
}

test('pistol: every Colt part sits on its bones at rest, at the size of a pistol next to a hand', async () => {
  const doc = await load('pistol.glb');
  const slide = restBounds(doc, meshNamed(doc, 'Cube.002_Colt_0'));
  const frame = restBounds(doc, meshNamed(doc, 'Cylinder.001_Colt_0'));
  const mag = restBounds(doc, meshNamed(doc, 'Cube.005_Colt_0'));
  const centre = (b: THREE.Box3): THREE.Vector3 => b.getCenter(new THREE.Vector3());
  assert.ok(centre(slide).distanceTo(boneAt(doc, 'Up')) < 3.5, `slide ${centre(slide).distanceTo(boneAt(doc, 'Up')).toFixed(2)} units from the Up bone`);
  assert.ok(centre(frame).distanceTo(boneAt(doc, 'Base')) < 4, `frame ${centre(frame).distanceTo(boneAt(doc, 'Base')).toFixed(2)} units from the Base bone`);
  assert.ok(centre(mag).distanceTo(boneAt(doc, 'Mag')) < 3, `magazine ${centre(mag).distanceTo(boneAt(doc, 'Mag')).toFixed(2)} units from the Mag bone`);
  // A hand is 8 units long (0.19 m); a Colt is about 1.1 hands, and the slide is slimmer than the frame.
  const s = slide.getSize(new THREE.Vector3());
  const f = frame.getSize(new THREE.Vector3());
  assert.ok(s.z > 9 && s.z < 10.2, `slide length ${s.z.toFixed(2)}`);
  assert.ok(f.z > 10 && f.z < 12, `frame length ${f.z.toFixed(2)}`);
  assert.ok(s.x < 1.6 && s.x < f.x * 1.5, `slide width ${s.x.toFixed(2)} (the Sketchfab file doubles it)`);
});

test('pistol: the gun textures are the 2048 px ones (remove-pistol-decals)', async () => {
  const doc = await load('pistol.glb');
  const gun = doc.getRoot().listMaterials().find((m) => m.getName() === 'Colt');
  assert.ok(gun, 'material Colt');
  const maps = { colour: gun.getBaseColorTexture(), roughnessMetalness: gun.getMetallicRoughnessTexture(), normal: gun.getNormalTexture() };
  for (const [name, tex] of Object.entries(maps)) {
    assert.ok(tex, `${name} texture`);
    const [w, h] = tex.getSize() ?? [0, 0];
    assert.ok(w! >= 2048 && h! >= 2048, `${name} is ${w} x ${h}`);
  }
});

const noMagick = spawnSync('magick', ['-version']).status !== 0 && 'needs ImageMagick';

test('pistol: no decal colour where decals were painted out (remove-pistol-decals)', { skip: noMagick }, async () => {
  const doc = await load('pistol.glb');
  const tex = doc.getRoot().listMaterials().find((m) => m.getName() === 'Colt')!.getBaseColorTexture()!;
  const [w, h] = tex.getSize()!;
  const r = spawnSync('magick', ['-', '-depth', '8', 'rgb:-'], { input: tex.getImage()!, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, String(r.stderr));
  const rgb = r.stdout;
  // Only inside the repairs: the wooden grip is orange-brown.
  const repairs = (REPAIRS as { name: string; maps: string[] }[]).filter((x) => x.maps.includes('base'));
  assert.ok(repairs.length > 0);
  for (const repair of repairs) {
    let coloured = 0;
    for (const [x, y] of repairPixels(repair) as [number, number][]) {
      const i = (Math.floor((y * h!) / (SIZE as number)) * w! + Math.floor((x * w!) / (SIZE as number))) * 3;
      const [red, blue] = [rgb[i]!, rgb[i + 2]!];
      if (blue - red > 45 || red - blue > 60) coloured++;
    }
    // The metal is grey; a few pixels are allowed for WebP's colour noise.
    assert.ok(coloured <= 4, `${repair.name}: ${coloured} blue, orange or yellow pixels`);
  }
});

test('shotgun: the body lies along the barrel between the Base and Pump bones, about a metre long next to a hand', async () => {
  const doc = await load('shotgun.glb');
  const body = restBounds(doc, meshNamed(doc, 'Remington870_Material.001_0'));
  const sight = restBounds(doc, meshNamed(doc, 'Remington870.001_Material.001_0'));
  const shell = restBounds(doc, meshNamed(doc, 'Cylinder_Material.005_0'));
  const base = boneAt(doc, 'Base');
  const pump = boneAt(doc, 'Pump');
  const size = body.getSize(new THREE.Vector3());
  assert.ok(size.z > 40 && size.z < 44, `body length ${size.z.toFixed(1)} units (a hand is 8)`);
  const c = body.getCenter(new THREE.Vector3());
  assert.ok(c.z > base.z && c.z < pump.z, `body centre z ${c.z.toFixed(1)} between Base ${base.z.toFixed(1)} and Pump ${pump.z.toFixed(1)}`);
  assert.ok(Math.abs(c.x - base.x) < 3 && Math.abs(c.y - base.y) < 4, 'and on the gun, not beside it');
  // The sight sits on top of the barrel: inside the body's footprint along its length, above its middle.
  const sc = sight.getCenter(new THREE.Vector3());
  assert.ok(sc.z > body.min.z && sc.z < body.max.z, 'the sight is on the body');
  assert.ok(sc.y > c.y, 'on top');
  assert.ok(sight.getSize(new THREE.Vector3()).length() < 12, 'and small');
  // The shell is held at the Shell bone.
  assert.ok(shell.getCenter(new THREE.Vector3()).distanceTo(boneAt(doc, 'Shell')) < 4, 'the shell is at the Shell bone');
});
