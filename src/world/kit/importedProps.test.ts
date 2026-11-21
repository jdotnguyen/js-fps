import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import * as THREE from 'three';
import type { Rng } from '../../core/rng.ts';
import type { Materials } from '../../render/materials.ts';
import { KitRegistry } from '../registry.ts';
import { IMPORTED_PROPS, recordProblems, standInPieces, standInSize, type ImportedPropRecord } from './importedProps.ts';

const rng = {} as Rng;
const mats = {} as Materials;

const record = (size: [number, number, number]): ImportedPropRecord => ({
  url: 'assets/models/props/thing.glb', size, triangles: 100, materials: 1, transparentMaterials: 0, texturePixels: 0, bytes: 1, parts: ['door'],
  source: { title: 't', author: 'a', licence: 'CC0', url: 'u' },
});

/** A stand-in model as GLTFLoader would return it: a body mesh, a hinged door part and a glass pane. */
function model(): THREE.Group {
  const scene = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.3), new THREE.MeshStandardMaterial({ name: 'paint' }));
  body.name = 'body';
  const door = new THREE.Group();
  door.name = 'PART_door';
  door.position.set(0.2, 0, -0.15);
  door.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.02), new THREE.MeshStandardMaterial({ name: 'paint' })));
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshStandardMaterial({ name: 'glass', transparent: true }));
  body.add(door, glass);
  scene.add(body);
  return scene;
}

test('stand-in sizes are the recorded size rounded to 5 cm', () => {
  assert.deepEqual(standInSize([0.458, 0.5, 0.396]), [0.45, 0.5, 0.4]);
  assert.deepEqual(standInSize([0.01, 2.1, 1.849]), [0.05, 2.1, 1.85]);
});

test('every manifest id that is an imported prop has a stand-in of its recorded size', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../data/kit-manifest.json', import.meta.url), 'utf8')) as { glb: Record<string, string> };
  const pieces = new Map(standInPieces(IMPORTED_PROPS).map((p) => [p.id, p]));
  for (const [id, url] of Object.entries(manifest.glb)) {
    if (!url.startsWith('assets/models/props/')) continue;
    const piece = pieces.get(id);
    assert.ok(piece, `${id} has a stand-in`);
    const out = piece.generate({}, rng, mats);
    const [w, h, d] = standInSize(IMPORTED_PROPS[id]!.size);
    const lo = [0, 1, 2].map((k) => Math.min(...out.colliders.map((c) => c.min[k]!)));
    const hi = [0, 1, 2].map((k) => Math.max(...out.colliders.map((c) => c.max[k]!)));
    const got = [0, 1, 2].map((k) => Math.round((hi[k]! - lo[k]!) * 1000) / 1000);
    const want = [w, h, d].map((v) => Math.round(v * 1000) / 1000);
    assert.deepEqual([got[0], got[2]], [want[0], want[2]], `${id} footprint`);
    assert.ok(got[1]! >= want[1]!, `${id} collision at least as tall as the model`);
  }
});

test('Headless level build: no models loaded, the stand-in gives the colliders', () => {
  const reg = new KitRegistry({ glb: { thing: 'assets/models/props/thing.glb' } }, standInPieces({ thing: record([0.458, 0.5, 0.396]) }));
  assert.equal(reg.source('thing'), 'procedural');
  const out = reg.create('thing', {}, rng, mats);
  assert.deepEqual(out.colliders, [{ min: [-0.225, 0, -0.2], max: [0.225, 0.5, 0.2] }]);
  assert.equal(out.object.children.length, 1, 'one flat-painted stand-in box');
});

test('Collision matches in the browser: the model replaces only the visible meshes', async () => {
  const headless = new KitRegistry({ glb: {} }, standInPieces({ thing: record([0.458, 0.5, 0.396]) })).create('thing', {}, rng, mats);
  const reg = new KitRegistry({ glb: { thing: 'assets/models/props/thing.glb' } }, standInPieces({ thing: record([0.458, 0.5, 0.396]) }));
  await reg.preload(['thing'], async () => ({ scene: model() }));
  assert.equal(reg.source('thing'), 'glb');
  const out = reg.create('thing', {}, rng, mats);
  assert.deepEqual(out.colliders, headless.colliders);
  assert.deepEqual(out.surfaces, headless.surfaces);
  const names: string[] = [];
  out.object.traverse((o) => void (o instanceof THREE.Mesh && names.push((o.material as THREE.Material).name)));
  assert.ok(!names.includes('imported-stand-in'), 'stand-in boxes are gone');
  // The door part and the glass pane are direct, dynamic children; the body is left to merge.
  const direct = out.object.children;
  const door = direct.find((c) => c.name === 'PART_door')!;
  assert.ok(door?.userData['dynamic'], 'door is dynamic');
  assert.ok(direct.some((c) => c instanceof THREE.Mesh && (c.material as THREE.Material).transparent && c.userData['dynamic']), 'glass is dynamic');
  const body = direct.find((c) => !c.userData['dynamic'])!;
  let bodyMeshes = 0;
  body.traverse((o) => void (o instanceof THREE.Mesh && bodyMeshes++));
  assert.equal(bodyMeshes, 1, 'only the body mesh is left to merge');
  // The door keeps its hinge position.
  door.updateMatrixWorld(true);
  assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(door.matrixWorld).toArray().map((v) => Math.round(v * 100) / 100), [0.2, 0, -0.15]);
  // Its materials keep their own UVs.
  out.object.traverse((o) => {
    if (o instanceof THREE.Mesh) assert.equal((o.material as THREE.Material).userData['keepUvs'], true);
  });
});

test('Missing model file: the stand-in is shown and one warning names the prop id', async () => {
  const reg = new KitRegistry({ glb: { thing: 'assets/models/props/thing.glb' } }, standInPieces({ thing: record([1, 1, 1]) }));
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (m: string) => void warnings.push(m);
  try {
    await reg.preload(['thing'], async () => {
      throw new Error('404');
    });
  } finally {
    console.warn = warn;
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /imported prop "thing"/);
  assert.equal(reg.source('thing'), 'procedural');
  assert.equal(reg.create('thing', {}, rng, mats).colliders.length, 1);
});

test('a kit GLB that is not an imported prop still fails loudly', async () => {
  const reg = new KitRegistry({ glb: { crate: 'x.glb' } }, [{ id: 'crate', family: 'prop', footprint: [0, 0], generate: () => { throw new Error('unused'); } }]);
  await assert.rejects(reg.preload(['crate'], async () => { throw new Error('404'); }), /404/);
});


const publicFile = (url: string) => new URL(`../../../public/${url}`, import.meta.url);
const realBytes = (url: string) => (existsSync(publicFile(url)) ? statSync(publicFile(url)).size : null);
const credits = () => readFileSync(new URL('../../../CREDITS.md', import.meta.url), 'utf8');

test('every imported prop record matches its model file and has a CREDITS.md entry', () => {
  assert.deepEqual(recordProblems(IMPORTED_PROPS, realBytes, credits()), []);
});

test('Stale record: a model re-imported without its record fails and names the prop', () => {
  const recs = { thing: record([1, 1, 1]) };
  const ok = recordProblems(recs, () => 1, 'Thing (`public/assets/models/props/thing.glb`)');
  assert.deepEqual(ok, []);
  const stale = recordProblems(recs, () => 2, 'Thing (`public/assets/models/props/thing.glb`)');
  assert.equal(stale.length, 1);
  assert.match(stale[0]!, /^thing: .* is 2 bytes but its record says 1/);
  assert.match(recordProblems(recs, () => null, 'props/thing.glb')[0]!, /^thing: model file .* is missing/);
});

test('Missing credit: a prop with no CREDITS.md row fails and names the prop', () => {
  const problems = recordProblems({ thing: record([1, 1, 1]) }, () => 1, '# Credits\n');
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /^thing: no CREDITS.md entry/);
});

test('the platform trolley stand-in is a low deck plus its handle, not one solid block', () => {
  const piece = standInPieces({ platform_trolley: record([1.628, 0.98, 0.829]) })[0]!;
  const out = piece.generate({}, rng, mats);
  assert.equal(out.colliders.length, 2);
  const [deck, handle] = out.colliders;
  assert.equal(Math.round(deck!.max[1] * 100) / 100, 0.3);
  assert.equal(Math.round((handle!.max[0] - handle!.min[0]) * 100) / 100, 0.2);
  assert.equal(handle!.min[0], deck!.min[0], 'handle at the -X end');
  assert.equal(piece.importedCost!.standInTriangles, 24);
});

test('material param: imported props drawn with a palette slot share one material and keep their own UVs', async () => {
  const map = new THREE.Texture();
  const bloom = new THREE.MeshStandardMaterial({ name: 'bloom', map });
  const slotMats = { bloom } as unknown as Materials;
  const reg = new KitRegistry(
    { glb: { growth_a: 'a.glb', growth_b: 'b.glb' } },
    standInPieces({ growth_a: record([1, 0.3, 1]), growth_b: record([1, 0.3, 1]) }),
  );
  const growth = (): THREE.Group => {
    const g = new THREE.Group();
    const geo = new THREE.PlaneGeometry(1, 1);
    g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ name: 'mat_biomass', map: new THREE.Texture() })));
    return g;
  };
  await reg.preload(['growth_a', 'growth_b'], async () => ({ scene: growth() }));
  const meshes = (id: string) => {
    const out: THREE.Mesh[] = [];
    reg.create(id, { material: 'bloom' }, rng, slotMats).object.traverse((o) => void (o instanceof THREE.Mesh && out.push(o)));
    return out;
  };
  const [a] = meshes('growth_a');
  const [b] = meshes('growth_b');
  assert.equal(a!.material, b!.material, 'one shared material');
  const m = a!.material as THREE.MeshStandardMaterial;
  assert.equal(m.map, map, 'the slot texture, not the model texture');
  assert.equal(m.userData['keepUvs'], true);
  assert.notEqual(m, bloom, 'a clone: the slot itself keeps world UVs for kit surfaces');
  assert.deepEqual(Array.from(a!.geometry.getAttribute('uv').array).slice(0, 4), [0, 1, 1, 1], 'source UVs untouched');
});

test('bloom masses are solid but never a perch; solid: false props are visual only', () => {
  const [mass] = standInPieces({ bloom_growth_c: record([0.8, 0.8, 0.8]) });
  assert.ok(mass!.generate({}, rng, mats).colliders[0]!.max[1] > 1.006, 'above jump reach');
  const [cyl] = standInPieces({ gas_cylinder: record([0.39, 0.71, 0.39]) });
  assert.equal(cyl!.generate({ solid: false }, rng, mats).colliders.length, 0);
  assert.equal(cyl!.generate({}, rng, mats).colliders.length, 1);
});
