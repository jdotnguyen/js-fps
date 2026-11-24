import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Rng } from '../../core/rng.ts';
import type { Materials } from '../../render/materials.ts';
import { PHOTO_SLOT_KEYS } from '../../render/tex/manifest.ts';
import { KitRegistry } from '../registry.ts';
import { STRUCTURE_PIECES } from './structure.ts';
import { TRANSIT_PROPS, TRANSIT_STRUCTURE } from './transit.ts';

const MATERIAL_KEYS = [...PHOTO_SLOT_KEYS, 'steel', 'hazardClean', 'glass', 'black', 'cable', 'glowCyan'];

function stubMaterials(): Materials {
  const out: Record<string, THREE.Material> = {};
  for (const k of MATERIAL_KEYS) {
    out[k] = k === 'glass' ? new THREE.MeshPhysicalMaterial({ transparent: true }) : new THREE.MeshStandardMaterial();
    out[k]!.name = k;
  }
  return out as unknown as Materials;
}

test('all transit structural greybox pieces are registered and produce meshes with valid materials', () => {
  const m = stubMaterials();
  const reg = new KitRegistry({ glb: {} });
  const ids = reg.ids();
  for (const def of [...TRANSIT_STRUCTURE, ...TRANSIT_PROPS]) {
    assert.ok(ids[def.family].has(def.id), `${def.id} registered as ${def.family}`);
    const out = reg.create(def.id, { area: 'transit' }, new Rng(def.id), m);
    let meshes = 0;
    out.object.traverse((c) => {
      if (c instanceof THREE.Mesh) {
        meshes++;
        const mat = Array.isArray(c.material) ? c.material[0] : c.material;
        assert.ok(mat && mat.name, `${def.id} mesh has named material`);
      }
    });
    assert.ok(meshes > 0, `${def.id} produces geometry`);
  }
});

test('transit_train_shell has walkable interior floor, open boarding doorway, and nav nodes', () => {
  const m = stubMaterials();
  const def = TRANSIT_PROPS.find((d) => d.id === 'transit_train_shell')!;
  const out = def.generate({ area: 'transit', length: 10, width: 3, height: 2.9 }, new Rng('train'), m);
  assert.ok(out.surfaces.some((s) => s.material === 'metal'), 'train deck has metal footstep surface');
  assert.ok(out.navNodes.length >= 4, 'train provides interior and doorway nav nodes');
  // Open boarding doorway on +X side: no collider blocks (x=1.45, y=1.0, z=0).
  const blockedDoor = out.colliders.some(
    (b) => b.min[0] <= 1.45 && b.max[0] >= 1.45 && b.min[1] <= 1.0 && b.max[1] >= 1.0 && b.min[2] <= 0 && b.max[2] >= 0,
  );
  assert.equal(blockedDoor, false, 'boarding doorway on +X is unobstructed at player height');
  // Opposite -X wall is closed at (x=-1.45, y=1.0, z=0).
  const closedOpposite = out.colliders.some(
    (b) => b.min[0] <= -1.45 && b.max[0] >= -1.45 && b.min[1] <= 1.0 && b.max[1] >= 1.0 && b.min[2] <= 0 && b.max[2] >= 0,
  );
  assert.equal(closedOpposite, true, 'opposite -X side wall is solid');
});

test('concourse_pillar, checkin_booth, and seam_header match their target architectural envelopes', () => {
  const m = stubMaterials();
  const boxOf = (o: THREE.Object3D): THREE.Box3 => new THREE.Box3().setFromObject(o);

  const pillar = TRANSIT_PROPS.find((d) => d.id === 'concourse_pillar')!.generate({ area: 'transit', height: 8 }, new Rng('p'), m);
  const pb = boxOf(pillar.object);
  assert.ok(pb.max.y >= 7.95 && pb.max.y <= 8.05, `pillar reaches 8 m (${pb.max.y})`);
  assert.ok(pb.max.x - pb.min.x >= 1.4, 'pillar is wide enough to conceal a large figure');

  const booth = TRANSIT_PROPS.find((d) => d.id === 'checkin_booth')!.generate({ area: 'transit' }, new Rng('b'), m);
  const bb = boxOf(booth.object);
  assert.ok(bb.max.y >= 3.1 && bb.max.x - bb.min.x >= 3.5, 'check-in booth spans expected envelope');

  const header = TRANSIT_PROPS.find((d) => d.id === 'seam_header')!.generate({ area: 'transit', bottom: 5, top: 8 }, new Rng('h'), m);
  const hb = boxOf(header.object);
  assert.ok(hb.min.y >= 4.95 && hb.max.y >= 7.95, `seam header spans 5..8 m (${hb.min.y}..${hb.max.y})`);
  assert.ok(header.colliders.every((c) => c.min[1] >= 5), 'seam header never blocks walkable floor below 5 m');
});

test('wall_plain and wall_panel scale cleanly up to 8.0 m height without gaps above 3.85 m', () => {
  const m = stubMaterials();
  for (const id of ['wall_plain', 'wall_panel'] as const) {
    const def = STRUCTURE_PIECES.find((d) => d.id === id)!;
    const out = def.generate({ area: 'transit', height: 8 }, new Rng(id), m);
    const b = new THREE.Box3().setFromObject(out.object);
    assert.ok(b.max.y >= 7.95, `${id} reaches 8.0 m`);
    // Verify raised front panels extend into the upper half (above y = 5.5 m), not leaving black backing.
    let upperFrontPanel = false;
    out.object.traverse((c) => {
      if (!(c instanceof THREE.Mesh)) return;
      const mat = Array.isArray(c.material) ? c.material[0] : c.material;
      if (mat?.name === 'black') return;
      const mb = new THREE.Box3().setFromObject(c);
      if (mb.max.y > 6.5 && mb.min.y > 4.0) upperFrontPanel = true;
    });
    assert.ok(upperFrontPanel, `${id} has architectural panelling above 6.5 m at height=8`);
    assert.ok(out.colliders.some((c) => c.max[1] >= 7.99), `${id} collider reaches 8.0 m`);
  }
});

test('power_generator, switchgear_bank, and power_terminal react to r11:power_state and reset cleanly', () => {
  const m = stubMaterials();
  const reg = new KitRegistry({ glb: {} });

  const gen = reg.create('power_generator', { area: 'transit', ceiling: 5 }, new Rng('gen'), m);
  assert.ok(gen.colliders.length > 0 && gen.surfaces.some((s) => s.material === 'metal'), 'generator has metal collider');
  const rotor = gen.object.getObjectByName('generator_rotor')!;
  assert.ok(rotor, 'generator exposes dynamic rotor');

  // Standby: rotor stays stationary.
  gen.tick?.(0.1, 1 / 60);
  const rotStandby = rotor.rotation.z;
  gen.tick?.(0.2, 1 / 60);
  assert.equal(rotor.rotation.z, rotStandby, 'rotor is stationary in standby');

  // Online instant: rotor spins on tick, and level:reset returns to standby.
  for (const l of gen.listeners ?? []) if (l.event === 'r11:power_state') l.fn({ state: 'online', instant: true });
  gen.tick?.(0.3, 1 / 60);
  assert.ok(rotor.rotation.z > rotStandby, 'rotor spins when online');

  for (const l of gen.listeners ?? []) if (l.event === 'level:reset') l.fn({});
  for (let i = 0; i < 60; i++) gen.tick?.(1 + i / 60, 1 / 30);
  const settled = rotor.rotation.z;
  gen.tick?.(3.5, 1 / 60);
  assert.ok(Math.abs(rotor.rotation.z - settled) < 0.01, 'rotor decelerates to stop on level:reset');

  // Switchgear & power terminal instantiate colliders and handle r11:power_state without error.
  for (const id of ['switchgear_bank', 'power_terminal'] as const) {
    const out = reg.create(id, { area: 'transit', ceiling: 5 }, new Rng(id), m);
    assert.ok(out.colliders.length > 0, `${id} has collider`);
    for (const l of out.listeners ?? []) if (l.event === 'r11:power_state') l.fn({ state: 'starting' });
    out.tick?.(0.5, 1 / 60);
    for (const l of out.listeners ?? []) if (l.event === 'r11:power_state') l.fn({ state: 'online' });
    out.tick?.(1.0, 1 / 60);
    for (const l of out.listeners ?? []) if (l.event === 'level:reset') l.fn({});
    out.tick?.(1.5, 1 / 60);
  }
});

test('transit_blast_gate starts sealed, opens via transit:blast_gate, and resets on level:reset', () => {
  const m = stubMaterials();
  const reg = new KitRegistry({ glb: {} });
  const gate = reg.create('transit_blast_gate', { area: 'transit', height: 5, gateId: 'r15a_south' }, new Rng('gate'), m);
  const shutter = gate.object.getObjectByName('blast_gate_shutter')!;
  assert.ok(shutter, 'blast gate exposes animated shutter group');
  assert.equal(shutter.position.y, 0, 'shutter starts sealed at y = 0');

  const box = new THREE.Box3().setFromObject(gate.object);
  assert.ok(box.min.x >= -2.05 && box.max.x <= 2.05, `portal fits 4 m cell width (${box.min.x}..${box.max.x})`);

  // Mismatched gateId is ignored.
  for (const l of gate.listeners ?? []) if (l.event === 'transit:blast_gate') l.fn({ gateId: 'r16a_north', open: true });
  gate.tick?.(0.2, 0.5);
  assert.equal(shutter.position.y, 0, 'mismatched gateId leaves shutter sealed');

  // Matching gateId opens shutter upward into header pocket.
  for (const l of gate.listeners ?? []) if (l.event === 'transit:blast_gate') l.fn({ gateId: 'r15a_south', open: true });
  for (let i = 0; i < 6; i++) gate.tick?.(0.3 + i * 0.4, 0.4);
  assert.ok(shutter.position.y > 3.0, `shutter retracts upward when open (${shutter.position.y})`);

  // level:reset returns shutter to sealed.
  for (const l of gate.listeners ?? []) if (l.event === 'level:reset') l.fn({});
  gate.tick?.(3.0, 1 / 60);
  assert.equal(shutter.position.y, 0, 'level:reset seals blast gate');
});

test('transit_depart_board and platform_railing build within expected envelopes', () => {
  const m = stubMaterials();
  const reg = new KitRegistry({ glb: {} });

  const board = reg.create('transit_depart_board', { area: 'transit' }, new Rng('board'), m);
  const bb = new THREE.Box3().setFromObject(board.object);
  assert.ok(bb.max.x - bb.min.x >= 2.2, 'departure board spans ~2.4 m width');

  const rail = reg.create('platform_railing', { area: 'transit', length: 5.6 }, new Rng('rail'), m);
  assert.ok(rail.colliders.length > 0 && rail.surfaces.some((s) => s.material === 'metal'), 'railing has metal collider');
  const rb = new THREE.Box3().setFromObject(rail.object);
  assert.ok(rb.max.z - rb.min.z >= 5.5 && rb.max.y >= 1.0, 'railing spans 5.6 m length at ~1.04 m height');
});
