import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEFAULT_MOTOR, moveBody, type MotorState } from '../actors/motor.ts';
import { CollisionWorld } from './collision.ts';

/** Checks the baked lab sandbox (scripts/fix-lab-glb.mjs -> public/assets/models/lab/) without a browser. */
const DIR = new URL('../../public/assets/models/lab/', import.meta.url);
const meta = JSON.parse(fs.readFileSync(new URL('underground_lab.json', DIR), 'utf8')) as {
  colliders: { count: number; origin: [number, number, number]; unit: number };
  bounds: { min: [number, number, number]; max: [number, number, number] };
  spawn: { x: number; y: number; z: number };
  mainFloorY: number;
  floors: Array<{ y: number; area: number }>;
  lamps: unknown[];
};
const q = new Int16Array(new Uint8Array(fs.readFileSync(new URL('underground_lab.colliders.bin', DIR))).buffer);

function build(): CollisionWorld {
  const w = new CollisionWorld();
  const [ox, oy, oz] = meta.colliders.origin;
  const u = meta.colliders.unit;
  for (let i = 0; i < q.length; i += 6) {
    w.add({ min: [ox + q[i]! * u, oy + q[i + 1]! * u, oz + q[i + 2]! * u], max: [ox + q[i + 3]! * u, oy + q[i + 4]! * u, oz + q[i + 5]! * u] }, 'static', 'metal');
  }
  return w;
}

test('collider file matches its sidecar', () => {
  assert.equal(q.length, meta.colliders.count * 6);
  assert.ok(meta.lamps.length > 10);
});

test('the GLB is a valid merged scene', () => {
  const d = fs.readFileSync(new URL('underground_lab.glb', DIR));
  assert.equal(d.toString('ascii', 0, 4), 'glTF');
  const j = JSON.parse(d.subarray(20, 20 + d.readUInt32LE(12)).toString('utf8')) as {
    meshes: Array<{ primitives: Array<{ attributes: Record<string, number> }> }>;
    materials: Array<{ name: string }>;
    textures?: unknown[];
    extensionsRequired?: string[];
  };
  assert.ok(j.meshes.length < 60, 'meshes merged into tiles');
  assert.ok(
    !j.extensionsRequired?.includes('KHR_materials_pbrSpecularGlossiness'),
    'no spec/gloss extension left for GLTFLoader to choke on',
  );
  assert.ok(
    j.meshes.every((m) => m.primitives.every((p) => p.attributes.TEXCOORD_0 !== undefined)),
    'every primitive has baked TEXCOORD_0 UVs',
  );
  const matNames = new Set(j.materials.map((m) => m.name));
  for (const name of [
    'lab_hub_floor',
    'lab_hub_wall',
    'lab_east_floor',
    'lab_east_upper_floor',
    'lab_west_floor',
    'lab_west_wall',
    'lab_north_floor',
    'glass',
    'Material_44',
  ]) {
    assert.ok(matNames.has(name), `material ${name} present`);
  }
});

test('the player stands on the hub floor at the spawn point and can walk around', () => {
  const w = build();
  const s: MotorState = { x: meta.spawn.x, y: meta.spawn.y + 0.5, z: meta.spawn.z, vy: 0, grounded: false };
  for (let i = 0; i < 60; i++) moveBody(s, 0, 0, 1 / 60, DEFAULT_MOTOR, w);
  assert.ok(s.grounded, 'settles onto the floor');
  assert.ok(Math.abs(s.y - meta.spawn.y) < 0.15, `feet ${s.y.toFixed(2)} vs spawn ${meta.spawn.y}`);
  const dirs: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let farthest = 0;
  for (const [dx, dz] of dirs) {
    const p: MotorState = { ...s };
    for (let i = 0; i < 600; i++) moveBody(p, dx * 0.05, dz * 0.05, 1 / 60, DEFAULT_MOTOR, w); // 30 m at 3 m/s
    farthest = Math.max(farthest, Math.hypot(p.x - s.x, p.z - s.z));
    assert.ok(p.x > meta.bounds.min[0] && p.x < meta.bounds.max[0] && p.z > meta.bounds.min[2] && p.z < meta.bounds.max[2], 'walls hold: stayed inside the map');
    assert.ok(p.y > meta.bounds.min[1] - 0.1, 'did not fall out of the world');
  }
  assert.ok(farthest > 4, `can walk at least 4 m in some direction (got ${farthest.toFixed(1)})`);
});

test('every floor level lists a real height and the spawn level is among them', () => {
  assert.ok(meta.floors.length >= 2);
  assert.ok(meta.floors.some((f) => Math.abs(f.y - meta.spawn.y) < 0.2));
});
