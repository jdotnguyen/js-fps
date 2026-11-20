import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { prepareBodyModel, type PreparedBodyModel } from './bodyModel.ts';
import { JOINT_NAMES, JOINTS, type JointName } from './skeleton.ts';

/**
 * Crowd variety bodies (ADR-0026, ADR-0029): three Renderpeople scans (office1-3, bones renamed by scripts/prep-crew-glb.py),
 * a security guard and an SCP scientist (Mixamo rigs). Each must map, stand straight facing -Z and keep its limbs.
 */

/** Node has no image decoding: drop textures from the GLB's JSON chunk before parsing. */
async function loadWithoutTextures(url: URL): Promise<THREE.Group> {
  const buf = readFileSync(url);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as {
    images?: unknown;
    textures?: unknown;
    samplers?: unknown;
    materials?: Array<{ pbrMetallicRoughness?: { baseColorTexture?: unknown }; normalTexture?: unknown; extensions?: unknown }>;
  };
  delete json.images;
  delete json.textures;
  delete json.samplers;
  for (const m of json.materials ?? []) {
    delete m.pbrMetallicRoughness?.baseColorTexture;
    delete m.normalTexture;
    delete m.extensions;
  }
  let text = Buffer.from(JSON.stringify(json));
  while (text.length % 4) text = Buffer.concat([text, Buffer.from(' ')]);
  const rest = buf.subarray(20 + jsonLen);
  const head = Buffer.alloc(20);
  head.write('glTF', 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + text.length + rest.length, 8);
  head.writeUInt32LE(text.length, 12);
  head.write('JSON', 16);
  const glb = Buffer.concat([head, text, rest]);
  const { createGltfLoader } = await import('../render/gltf.ts');
  return (await (await createGltfLoader()).parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '')).scene;
}

function worldJoints(m: PreparedBodyModel): Record<JointName, THREE.Vector3> {
  const out = {} as Record<JointName, THREE.Vector3>;
  for (const j of JOINTS) out[j.name] = (j.parent ? out[j.parent]!.clone() : new THREE.Vector3()).add(new THREE.Vector3(...m.jointOffsets[j.name]));
  return out;
}

const TABLE = JSON.parse(readFileSync(new URL('../data/body-models.json', import.meta.url), 'utf8')) as Record<string, { url: string; credit?: { license?: string } }>;
const NEW = ['office1', 'office2', 'office3', 'guard1', 'scientist1'];

for (const id of NEW) {
  test(`${id} model: rig maps, stands straight facing -Z, keeps every limb piece`, async () => {
    const entry = TABLE[id];
    assert.ok(entry, `${id} is in body-models.json`);
    assert.equal(entry.credit?.license, 'CC-BY-4.0');
    const m = prepareBodyModel(await loadWithoutTextures(new URL(`../../public/${entry.url}`, import.meta.url)));
    const w = worldJoints(m);
    for (const name of JOINT_NAMES) assert.ok(m.jointOffsets[name], name);
    assert.ok(w.head.y > 1.45 && w.head.y < 1.8, `head at ${w.head.y}`);
    assert.ok(w.pelvis.y > 0.85 && w.pelvis.y < 1.1, `pelvis at ${w.pelvis.y}`);
    for (const s of ['L', 'R'] as const) {
      const out = s === 'L' ? -1 : 1;
      assert.ok(w[`thigh_${s}`].x * out > 0.03, `thigh_${s} on its own side`);
      assert.ok(w[`upperArm_${s}`].x * out > 0.1, `upperArm_${s} on its own side`);
      for (const limb of ['foot', 'shin', 'thigh', 'foreArm', 'upperArm'] as const) assert.ok(m.parts.some((p) => p.joint === `${limb}_${s}`), `${limb}_${s} has pieces`);
    }
    assert.ok(m.parts.some((p) => p.joint === 'head'), 'head has pieces');
    assert.ok(m.triangles > 10_000 && m.triangles < 30_000, `${m.triangles} triangles, within the crowd budget`);
    for (const p of m.parts) {
      const s = new THREE.Box3().setFromBufferAttribute(p.geometry.getAttribute('position') as THREE.BufferAttribute).getSize(new THREE.Vector3());
      assert.ok(Math.max(s.x, s.y, s.z) < 0.7, `${p.joint}/${p.surface} is ${s.toArray().map((x) => x.toFixed(2)).join(' x ')} m`);
    }
  });
}

test('every model a level NPC names exists, and named characters keep their own bodies', () => {
  const level = JSON.parse(readFileSync(new URL('../data/levels/slice01.json', import.meta.url), 'utf8')) as { rooms: Array<{ npcs?: Array<{ id: string; model?: string }> }> };
  const NAMED = new Set(['mechanic', 'doctor', 'priya', 'heins', 'hale', 'ruiz', 'sung']);
  for (const r of level.rooms) {
    for (const n of r.npcs ?? []) {
      if (!n.model) continue;
      assert.ok(TABLE[n.model], `${n.id}: model "${n.model}" is in body-models.json`);
      assert.ok(!NAMED.has(n.model), `${n.id} does not wear a named character's body (${n.model})`);
    }
  }
});

test('exactly one NPC in slice01 wears the guard1 body: the dock guard (dock-checkpoint)', async () => {
  const { castSpec } = await import('./castLooks.ts');
  const level = JSON.parse(readFileSync(new URL('../data/levels/slice01.json', import.meta.url), 'utf8')) as { rooms: Array<{ npcs?: Array<{ id: string; look: string; model?: string }> }> };
  const wearers: string[] = [];
  for (const r of level.rooms) for (const n of r.npcs ?? []) if ((n.model ?? castSpec(n.look, n.id).model) === 'guard1') wearers.push(n.id);
  assert.deepEqual(wearers, ['dock_guard']);
});
