import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Rng } from '../../core/rng.ts';
import type { Materials } from '../../render/materials.ts';
import { PHOTO_SLOT_KEYS } from '../../render/tex/manifest.ts';
import { KitRegistry } from '../registry.ts';
import { STRUCTURE_PIECES } from './structure.ts';
import { TRANSIT_PROPS, TRANSIT_STRUCTURE } from './transit.ts';
import { BOARDING_STEP_RISE, RAIL_TOP, TRAIN_RIDE_HEIGHT } from './transitCommon.ts';

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
  // Open boarding doorway on +X side: no enabled collider blocks (x=1.45, y=1.0, z=0).
  const blockedDoor = out.colliders.some(
    (b) => b.enabled !== false && b.min[0] <= 1.45 && b.max[0] >= 1.45 && b.min[1] <= 1.0 && b.max[1] >= 1.0 && b.min[2] <= 0 && b.max[2] >= 0,
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

  // Matching gateId opens shutter upward into header pocket and disables shutter collider.
  const shutterCollider = gate.colliders.find((b) => b.min[0] > -1.8 && b.max[0] < 1.8 && b.min[1] <= 0.05 && b.max[1] >= 3.0);
  assert.ok(shutterCollider, 'blast gate has shutter collider');
  assert.notEqual(shutterCollider.enabled, false, 'shutter collider starts enabled');
  for (const l of gate.listeners ?? []) if (l.event === 'transit:blast_gate') l.fn({ gateId: 'r15a_south', open: true });
  for (let i = 0; i < 6; i++) gate.tick?.(0.3 + i * 0.4, 0.4);
  assert.ok(shutter.position.y > 3.0, `shutter retracts upward when open (${shutter.position.y})`);
  assert.equal(shutterCollider.enabled, false, 'shutter collider disables when open for train passage');

  // level:reset returns shutter to sealed and re-enables collider.
  for (const l of gate.listeners ?? []) if (l.event === 'level:reset') l.fn({});
  gate.tick?.(3.0, 1 / 60);
  assert.equal(shutter.position.y, 0, 'level:reset seals blast gate');
  assert.notEqual(shutterCollider.enabled, false, 'level:reset re-enables shutter collider');
});

test('transit_train_shell has clean cabin interior, animated boarding door, and doorway collider toggle', () => {
  const m = stubMaterials();
  const reg = new KitRegistry({ glb: {} });
  const train = reg.create('transit_train_shell', { area: 'transit', length: 10.4, width: 3, height: 2.9, id: 'r15a_train', carId: 'r15a_train' }, new Rng('cabin'), m);
  assert.ok(train.object.getObjectByName('prop:r15a_train')?.userData['propId'] === 'r15a_train', 'named train registers propId for Level.setPropTransform');
  // No rusty materials anywhere in the cabin.
  train.object.traverse((c) => {
    if (c instanceof THREE.Mesh) {
      const mat = Array.isArray(c.material) ? c.material[0] : c.material;
      assert.equal(mat?.name.toLowerCase().includes('rust'), false, `clean transit material (${mat?.name})`);
    }
  });
  // Central aisle >= 1.8 m clear at standing height inside the cabin length (apart from thin 0.06 m grab-rail stanchions).
  const aisleBlocked = train.colliders.some(
    (b) =>
      b.enabled !== false &&
      (b.max[0] - b.min[0] > 0.1 || b.max[2] - b.min[2] > 0.1) &&
      b.max[0] > -0.9 &&
      b.min[0] < 0.9 &&
      b.min[1] < 1.8 + TRAIN_RIDE_HEIGHT &&
      b.max[1] > 0.1 + TRAIN_RIDE_HEIGHT &&
      b.max[2] > -4.8 &&
      b.min[2] < 4.8,
  );
  assert.equal(aisleBlocked, false, 'central aisle >= 1.8 m clear');
  assert.ok(train.lightSlots.length >= 2, 'train cabin has interior ceiling light slots');

  const door = train.object.getObjectByName('train_boarding_door')!;
  assert.ok(door, 'train exposes animated boarding door');
  const openZ = door.position.z;
  assert.ok(openZ > 1.5, 'boarding door starts slid open');
  const doorCollider = train.colliders.find((b) => b.min[0] > 1.0 && b.min[1] <= 0.1 + TRAIN_RIDE_HEIGHT && b.max[1] >= 2.0 + TRAIN_RIDE_HEIGHT && b.min[2] <= 0 && b.max[2] >= 0);
  assert.ok(doorCollider, 'train has doorway collider');
  assert.equal(doorCollider.enabled, false, 'doorway collider starts disabled when open');

  for (const l of train.listeners ?? []) if (l.event === 'transit:train_door') l.fn({ carId: 'r15a_train', open: false });
  for (let i = 0; i < 6; i++) train.tick?.(i * 0.2, 0.2);
  assert.ok(Math.abs(door.position.z) < 0.1, 'boarding door slides closed');
  assert.equal(doorCollider.enabled, true, 'doorway collider enables when closed');

  for (const l of train.listeners ?? []) if (l.event === 'level:reset') l.fn({});
  assert.equal(door.position.z, openZ, 'level:reset reopens boarding door');
  assert.equal(doorCollider.enabled, false, 'level:reset disables doorway collider');
});

test('transit_sea_tunnel_rig builds clean glass tunnel rings and scrolls when active', () => {
  const m = stubMaterials();
  const reg = new KitRegistry({ glb: {} });
  const rig = reg.create('transit_sea_tunnel_rig', { area: 'transit' }, new Rng('tunnel'), m);
  const ring0 = rig.object.getObjectByName('sea_tunnel_ring_0')!;
  assert.ok(ring0, 'sea-tunnel rig creates modular tunnel rings');
  const z0 = ring0.position.z;
  for (const l of rig.listeners ?? []) if (l.event === 'transit:tunnel_scroll') l.fn({ active: true, speed: 20 });
  rig.tick?.(0.1, 0.1);
  assert.notEqual(ring0.position.z, z0, 'tunnel ring scrolls along track when active');
  for (const l of rig.listeners ?? []) if (l.event === 'level:reset') l.fn({});
  assert.equal(ring0.position.z, z0, 'level:reset restores ring position');
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

const railTops = (o: THREE.Object3D): number[] => {
  const tops: number[] = [];
  o.updateMatrixWorld(true);
  o.traverse((c) => {
    if (c instanceof THREE.Mesh && !Array.isArray(c.material) && c.material.name === 'transit-rail') tops.push(new THREE.Box3().setFromObject(c).max.y);
  });
  return tops;
};

test('car body rides above the rails: no rail intersects the floor and the bogies show below it', () => {
  const m = stubMaterials();
  const reg = new KitRegistry({ glb: {} });
  const car = reg.create('transit_train_shell', { area: 'transit', length: 10.4, id: 'r15a_train', carId: 'r15a_train' }, new Rng('lift'), m);
  const floors = car.colliders.filter((b) => b.max[0] - b.min[0] >= 2.9 && b.max[1] - b.min[1] < 0.2 && b.min[1] < 1);
  assert.ok(floors.length > 0, 'car has a floor collider');
  const underside = Math.min(...floors.map((b) => b.min[1]));
  assert.ok(underside >= RAIL_TOP + 0.2 - 1e-6, `floor underside ${underside} clears the rail head (${RAIL_TOP}) by >= 0.2 m`);
  assert.equal(railTops(car.object).length, 0, 'the car itself contains no rail geometry');
  let wheels = 0;
  car.object.traverse((c) => {
    if (c instanceof THREE.Mesh && !Array.isArray(c.material) && c.material.name === 'transit-bogie-wheel') wheels++;
  });
  assert.equal(wheels, 8, 'two bogies with two axles of two wheels');
  assert.ok(car.object.getObjectByName('train_underglow'), 'car lights the track bed beneath it');
  for (const id of ['track_bed', 'transit_tunnel_shroud', 'transit_sea_tunnel_rig']) {
    const piece = reg.create(id, { area: 'transit', length: 12 }, new Rng(id), m);
    const tops = railTops(piece.object);
    assert.ok(tops.length >= 2, `${id} lays polished rails`);
    for (const t of tops) assert.ok(t <= RAIL_TOP + 1e-6 && t <= underside - 0.2 + 1e-6, `${id} rail top ${t} stays under the car floor`);
  }
});

test('boarding steps bridge the lifted threshold in steps the motor can climb', () => {
  const m = stubMaterials();
  const reg = new KitRegistry({ glb: {} });
  const step = reg.create('transit_boarding_step', { area: 'transit' }, new Rng('step'), m);
  const tops = step.colliders.map((b) => b.max[1]).sort((a, b) => a - b);
  assert.equal(tops.length, 2);
  assert.ok(Math.abs(tops[0]! - BOARDING_STEP_RISE) < 1e-6, 'first riser');
  assert.ok(Math.abs(tops[1]! - (0.08 + TRAIN_RIDE_HEIGHT)) < 1e-6, 'last step meets the car floor');
  assert.ok(tops[0]! <= 0.35 && tops[1]! - tops[0]! <= 0.35, 'each riser is within the 0.35 m step height');
});

test('the open boarding door leaf stays inside its pocket, clear of windows, benches and the wall', () => {
  const m = stubMaterials();
  const reg = new KitRegistry({ glb: {} });
  const car = reg.create('transit_train_shell', { area: 'transit', length: 10.4, width: 3, height: 2.9, id: 'r15a_train', carId: 'r15a_train' }, new Rng('pocket'), m);
  car.object.updateMatrixWorld(true);
  const door = car.object.getObjectByName('train_boarding_door')!;
  const leaf = new THREE.Box3().setFromObject(door).expandByScalar(-0.002); // resting on the floor is not a collision
  assert.ok(leaf.min.x >= 1.5 - 0.14 - 1e-6 && leaf.max.x <= 1.5 + 1e-6, 'leaf sits inside the 0.14 m wall');
  car.object.traverse((c) => {
    if (c instanceof THREE.Mesh && c.name === 'train_window_glass') {
      assert.equal(leaf.intersectsBox(new THREE.Box3().setFromObject(c).expandByScalar(0.001)), false, 'open leaf never overlaps a window pane');
    }
  });
  for (const b of car.colliders) {
    const box = new THREE.Box3(new THREE.Vector3(...b.min), new THREE.Vector3(...b.max));
    if (!box.intersectsBox(leaf)) continue;
    assert.ok(box.containsBox(leaf), 'the only solid the open leaf touches is the pocket that contains it ');
  }
  // Closed: the leaf fills the doorway centred on z = 0.
  for (const l of car.listeners ?? []) if (l.event === 'transit:train_door') l.fn({ carId: 'r15a_train', open: false, instant: true });
  car.object.updateMatrixWorld(true);
  const closed = new THREE.Box3().setFromObject(door);
  assert.ok(closed.min.z <= -1.05 && closed.max.z >= 1.05, 'closed leaf spans the doorway');
});

test('car headlights are unlit shader beams that follow ride speed, add no scene lights, and never outrun clear track', () => {
  const m = stubMaterials();
  const reg = new KitRegistry({ glb: {} });
  const car = reg.create('transit_train_shell', { area: 'transit', length: 10.4, id: 'r16a_train', carId: 'r16a_train' }, new Rng('lamp'), m);
  let lights = 0;
  car.object.traverse((c) => {
    if (c instanceof THREE.Light) lights++;
  });
  assert.equal(lights, 0, 'no SpotLight or PointLight in the car group, so the LightPool count never changes');
  const beams: THREE.Mesh[] = [];
  car.object.traverse((c) => {
    if (c instanceof THREE.Mesh && c.name === 'train_headlight_beam') beams.push(c);
  });
  assert.equal(beams.length, 2, 'twin beams');
  const pool = car.object.getObjectByName('train_headlight_pool')!;
  assert.ok(beams.every((b) => !b.visible) && !pool.visible, 'parked: lens glow only, no beam or pool');
  assert.ok(car.object.getObjectByName('train_headlight_glow'), 'parked lamps keep a soft lens glow');
  car.object.updateMatrixWorld(true);
  const beamBox = new THREE.Box3().setFromObject(beams[0]!);
  assert.ok(beamBox.max.z - beamBox.min.z <= 8.5, 'beam is at most 8 m long');
  assert.ok(Math.max(Math.abs(beamBox.min.x), Math.abs(beamBox.max.x)) <= 1.65, 'beam stays inside a 3.3 m blast-gate bore');

  const motion = (speed: number, clear: number, carId = 'r16a_train'): void => {
    for (const l of car.listeners ?? []) if (l.event === 'transit:car_motion') l.fn({ carId, speed, clear });
  };
  motion(9, 8, 'other_car');
  for (let i = 0; i < 30; i++) car.tick?.(i / 30, 1 / 30);
  assert.ok(beams.every((b) => !b.visible), "another car's motion is ignored");
  motion(9, 9);
  for (let i = 0; i < 30; i++) car.tick?.(i / 30, 1 / 30);
  assert.ok(beams.every((b) => b.visible) && pool.visible, 'moving: beams and pool are on');
  assert.ok(Math.abs(beams[0]!.scale.z - 1) < 1e-6, 'full length with free track ahead');
  motion(3, 2.5);
  car.tick?.(2, 1 / 30);
  assert.ok(beams[0]!.scale.z < 0.3, 'beam shortens to the clear distance ahead of the nose');
  motion(0, 2);
  for (let i = 0; i < 90; i++) car.tick?.(3 + i / 30, 1 / 30);
  assert.ok(beams.every((b) => !b.visible) && !pool.visible, 'docked: beam fades out, parking lamps only');
});

test('an opened blast gate leaves the whole bore clear: nothing static crosses the path of a car or the player', () => {
  const m = stubMaterials();
  const reg = new KitRegistry({ glb: {} });
  const gate = reg.create('transit_blast_gate', { area: 'transit', height: 5, gateId: 'r15a_south' }, new Rng('bore'), m);
  gate.object.updateMatrixWorld(true);
  // The car is 3.1 m wide and (lifted) 3.3 m tall; the bore runs through the wall toward -Z in the piece frame.
  const path = new THREE.Box3(new THREE.Vector3(-1.55, 0.4, -4), new THREE.Vector3(1.55, 3.35, -1.0));
  gate.object.traverse((c) => {
    if (!(c instanceof THREE.Mesh)) return;
    let p: THREE.Object3D | null = c;
    while (p) {
      if (p.name === 'blast_gate_shutter') return; // the shutter retracts into the header
      p = p.parent;
    }
    const b = new THREE.Box3().setFromObject(c);
    assert.equal(b.intersectsBox(path), false, `static gate mesh ${(Array.isArray(c.material) ? c.material[0] : c.material)?.name} box ${b.min.toArray().map((n) => n.toFixed(2))}..${b.max.toArray().map((n) => n.toFixed(2))} does not cross the bore`);
  });
  const crossing = gate.colliders.filter((b) => b.enabled !== false && b.min[0] < 1.55 && b.max[0] > -1.55 && b.min[1] < 3.35 && b.max[1] > 0.4 && b.min[2] < -1.0 && b.max[2] > -4);
  assert.equal(crossing.length, 1, 'only the shutter collider (disabled when open) can cross the bore');
});

test('the cabin has a faint cold emissive fill of its own and a roof strip that does not blow out', () => {
  const m = stubMaterials();
  const reg = new KitRegistry({ glb: {} });
  const car = reg.create('transit_train_shell', { area: 'transit', length: 10.4, id: 'r15a_train', carId: 'r15a_train' }, new Rng('fill'), m);
  let filled = 0;
  let strip: THREE.MeshStandardMaterial | null = null;
  car.object.traverse((c) => {
    if (!(c instanceof THREE.Mesh) || Array.isArray(c.material)) return;
    const mat = c.material;
    if (mat instanceof THREE.MeshStandardMaterial && mat.emissiveIntensity > 0.3 && mat.emissiveIntensity < 1 && mat.emissive.getHex() === 0x0b2a33) filled++;
    if (mat.name === 'cabin-ceiling-led') strip = mat as THREE.MeshStandardMaterial;
  });
  assert.ok(filled > 20, `cabin surfaces carry the fill (${filled} meshes)`);
  assert.ok(strip, 'roof LED strip exists');
  assert.ok((strip as THREE.MeshStandardMaterial).emissiveIntensity <= 1.2, 'roof strip is calm enough not to blow out close to the camera');
  // The shared palette materials are untouched by the fill.
  assert.notEqual(m['steel' as keyof typeof m], undefined);
});

test('the ride tunnel is one closed, lit hallway: wall texture between the lights, no windows, no ocean', () => {
  const m = stubMaterials();
  const reg = new KitRegistry({ glb: {} });
  for (const id of ['transit_sea_tunnel_rig', 'transit_tunnel_shroud']) {
    const out = reg.create(id, { area: 'transit', length: 18 }, new Rng(id), m);
    out.object.updateMatrixWorld(true);
    const names = new Set<string>();
    let glassPanes = 0;
    let lights = 0;
    out.object.traverse((c) => {
      if (!(c instanceof THREE.Mesh) || Array.isArray(c.material)) return;
      for (let a: THREE.Object3D | null = c; a; a = a.parent) if (a.name === 'rig_gate_root') return; // the approaching gate is its own piece
      names.add(c.material.name);
      if (c.name === 'shroud_window_glass' || c.material.name === 'ocean-glass') glassPanes++;
      if (c.material.name.endsWith('guide-light') || c.material.name.endsWith('roof-light')) lights++;
      if (c.material instanceof THREE.ShaderMaterial) assert.fail(id + ' draws no shader effects outside the hallway');
    });
    assert.equal(glassPanes, 0, id + ' has no windows');
    assert.equal(names.has('black'), false, id + ' uses no unlit black slab');
    for (const need of ['transit-tunnel-steel', 'transit-rail']) assert.ok(names.has(need), id + ' has ' + need);
    assert.ok(lights >= 6, id + ' has lit roof, guide and rib bars (' + lights + ')');
    assert.equal(out.object.getObjectByName('abyss_marine_snow'), undefined, id + ' draws no ocean');
    // The wall texture sits between the lit rib bars on both sides: a wall slab whose inner face is at x = +/-2.1.
    let wallsOnBothSides = 0;
    out.object.traverse((c) => {
      if (!(c instanceof THREE.Mesh) || Array.isArray(c.material)) return;
      const b = new THREE.Box3().setFromObject(c);
      if (Math.abs(Math.abs(b.min.x) - 2.17) < 0.1 && b.max.y - b.min.y > 3.9 && b.max.z - b.min.z > 5.9) wallsOnBothSides++;
    });
    assert.ok(wallsOnBothSides >= 2, id + ' has full-height wall panels on both sides');
  }
});

test('the hallway fades to black at its open ends, and the rig brings a closed gate to where the R16a gate will be', () => {
  const m = stubMaterials();
  const reg = new KitRegistry({ glb: {} });
  // Fog planes: thicker toward the end, solid at the end.
  for (const [params, ends] of [[{ fog: 'south' }, 1], [{ fog: 'north' }, 1], [{ fog: 'both' }, 2], [{}, 0]] as const) {
    const sh = reg.create('transit_tunnel_shroud', { area: 'transit', length: 18, ...params }, new Rng('fog'), m);
    const fogs = sh.object.children.filter((c) => c.name === 'hall_fog');
    assert.equal(fogs.length, ends, 'shroud fog ' + JSON.stringify(params));
    for (const g of fogs) {
      const ops = g.children.map((c) => ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity).sort((a, b) => b - a);
      assert.equal(ops[0], 1, 'solid black at the end');
      assert.ok(ops.every((o, i) => i === 0 || o < ops[i - 1]!), 'thinner away from the end');
      for (const c of g.children) assert.ok(Math.abs(c.position.z) > 5.9, 'fog starts well beyond a car at the end of the pull-out');
    }
  }
  const rig = reg.create('transit_sea_tunnel_rig', { area: 'transit' }, new Rng('rigfog'), m);
  assert.equal(rig.object.children.filter((c) => c.name === 'hall_fog').length, 2, 'the rig fades to black at both ends');

  // The approaching gate: hidden until armed, then rides the scroll toward the car and stops 10.125 m ahead.
  const holder = rig.object.getObjectByName('rig_gate_holder')!;
  const gate = holder.getObjectByName('rig_gate_root')!;
  assert.equal(gate.visible, false, 'no gate before the slow-down');
  for (const l of rig.listeners ?? []) if (l.event === 'transit:tunnel_scroll') l.fn({ active: true, speed: 20 });
  for (const l of rig.listeners ?? []) if (l.event === 'transit:rig_gate') l.fn({ arm: true });
  assert.equal(gate.visible, true);
  assert.ok(Math.abs(gate.position.z - (27 + 1.875)) < 1e-6, 'it starts in the fog, 27 m ahead');
  rig.tick?.(0.1, 0.5);
  assert.ok(Math.abs(gate.position.z - (27 - 10 + 1.875)) < 1e-6, 'it rides the scroll toward the car');
  for (let i = 0; i < 20; i++) rig.tick?.(1 + i * 0.5, 0.5);
  assert.ok(Math.abs(gate.position.z - (10.125 + 1.875)) < 1e-6, 'it stops exactly where R16a\'s closed gate is, 10.125 m ahead');
  for (const l of rig.listeners ?? []) if (l.event === 'transit:rig_gate') l.fn({ arm: false });
  assert.equal(gate.visible, false, 'released at the hand-off');

  // Analytical wallZ mode: honors explicit wallZ without render-tick drift and clamps to RIG_GATE_FINAL_Z (10.125).
  for (const l of rig.listeners ?? []) if (l.event === 'transit:rig_gate') l.fn({ arm: true, wallZ: 15.5 });
  assert.equal(gate.visible, true);
  assert.ok(Math.abs(gate.position.z - (15.5 + 1.875)) < 1e-6, 'explicit wallZ sets gate position directly');
  rig.tick?.(10, 0.5);
  assert.ok(Math.abs(gate.position.z - (15.5 + 1.875)) < 1e-6, 'render tick does not drift an analytically driven gate');
  for (const l of rig.listeners ?? []) if (l.event === 'transit:rig_gate') l.fn({ arm: true, wallZ: 9.0 });
  assert.ok(Math.abs(gate.position.z - (10.125 + 1.875)) < 1e-6, 'explicit wallZ clamps at RIG_GATE_FINAL_Z');
  for (const l of rig.listeners ?? []) if (l.event === 'transit:rig_gate') l.fn({ arm: false });
});

test('the dark bore past the R16a car is the ride tunnel switched off: unlit steel, black fog that thickens to the back, and a solid liner', () => {
  const m = stubMaterials();
  const reg = new KitRegistry({ glb: {} });
  const bore = reg.create('transit_dark_bore', { area: 'transit', width: 3.4, height: 3.4, length: 6, wallHeight: 5 }, new Rng('dark'), m);
  let liners = 0;
  bore.object.traverse((c) => {
    if (!(c instanceof THREE.Mesh) || Array.isArray(c.material)) return;
    const mat = c.material as THREE.MeshStandardMaterial;
    if (mat.name === 'transit-dark-bore-steel') {
      liners++;
      assert.equal(mat.emissive.getHex(), 0, 'the liner is not emissive');
    }
    assert.ok(!(mat.name.includes('light') || mat.name.includes('guide') || mat.name.includes('led')), 'no lit strip or guide bar in the dark bore: ' + mat.name);
    assert.ok(!(c instanceof THREE.Light), 'no scene light');
  });
  assert.ok(liners > 0, 'steel liner exists');
  const fog = bore.object.getObjectByName('dark_bore_fog')!;
  const planes = fog.children as THREE.Mesh[];
  assert.equal(planes.length, 4, 'four fog planes');
  const ops = planes.map((c) => (c.material as THREE.MeshBasicMaterial).opacity);
  assert.equal(ops[0], 1, 'solid black at the back wall');
  assert.ok(ops.every((o, i) => i === 0 || o < ops[i - 1]!), 'thinner toward the mouth');
  for (const c of planes) assert.ok(c.position.z > 2 && c.position.z < 6, 'every fog plane is inside the bore, away from the portal (z ' + c.position.z + ')');
  assert.ok(planes[0]!.position.z > planes[3]!.position.z, 'the opaque plane is at the far end');
  // The liner is solid: its side walls and roof block a capsule.
  const solids = bore.colliders ?? [];
  assert.ok(solids.length >= 8, 'wall piers, header, liner side walls, roof, end cap and floor are colliders');
  // The portal is open: nothing solid crosses the bore's axis between the wall plane and the end cap.
  for (const col of solids) {
    const crossesAxis = col.min[0] < 0 && col.max[0] > 0 && col.min[1] < 1.7 && col.max[1] > 1.7;
    if (crossesAxis) assert.ok(col.min[2] >= 5.6, 'only the end cap crosses the axis');
  }
});

test('a blast gate can be asked to open fast, lifts clear of a car roof, and is bright enough to see coming', () => {
  const m = stubMaterials();
  const reg = new KitRegistry({ glb: {} });
  const gate = reg.create('transit_blast_gate', { area: 'transit', height: 5, gateId: 'r16a_north' }, new Rng('fast'), m);
  const shutter = gate.object.getObjectByName('blast_gate_shutter')!;
  for (const l of gate.listeners ?? []) if (l.event === 'transit:blast_gate') l.fn({ gateId: 'r16a_north', open: true, seconds: 0.8 });
  for (let i = 0; i < 9; i++) gate.tick?.(i * 0.1, 0.1); // 0.9 s
  assert.ok(shutter.position.y >= 3.45 + 0.05, 'a 0.8 s open is complete in 0.9 s and the shutter is clear of the 3.3 m car roof (' + shutter.position.y + ')');
  // Default speed still takes the full 1.8 s.
  const slow = reg.create('transit_blast_gate', { area: 'transit', height: 5, gateId: 'r15a_south' }, new Rng('slow'), m);
  const s2 = slow.object.getObjectByName('blast_gate_shutter')!;
  for (const l of slow.listeners ?? []) if (l.event === 'transit:blast_gate') l.fn({ gateId: 'r15a_south', open: true });
  for (let i = 0; i < 9; i++) slow.tick?.(i * 0.1, 0.1);
  assert.ok(s2.position.y < 3.0, 'default open speed is unchanged');
  // The shutter leaves are bright and self-lit.
  let bright = 0;
  shutter.traverse((c) => {
    if (c instanceof THREE.Mesh && !Array.isArray(c.material) && c.material.name === 'gate-shutter') {
      const mat = c.material as THREE.MeshStandardMaterial;
      assert.ok(mat.emissiveIntensity > 0 && mat.color.getHex() > 0x808080, 'bright, self-lit leaf');
      bright++;
    }
  });
  assert.equal(bright, 2, 'both leaves');
});

test('transit_train_shell mounts a centred rear-bulkhead comms terminal and a door-pocket info sign clear of glass and door travel', () => {
  const m = stubMaterials();
  const def = TRANSIT_PROPS.find((d) => d.id === 'transit_train_shell')!;
  const out = def.generate({ area: 'transit', length: 9, width: 3, height: 2.9, doorSide: 'right', id: 'r16a_train' }, new Rng('r16a'), m);
  out.object.updateMatrixWorld(true);

  const comms = out.object.getObjectByName('train_comms_terminal');
  assert.ok(comms, 'rear-bulkhead comms terminal exists');
  const cb = new THREE.Box3().setFromObject(comms);
  const commsCenterX = (cb.min.x + cb.max.x) / 2;
  assert.ok(Math.abs(commsCenterX) < 0.05, `comms terminal is centred on x (${commsCenterX})`);
  assert.ok(cb.min.z > 4.0 && cb.max.z <= 4.5 - 0.14 + 0.01, `comms terminal sits on interior face of rear bulkhead (z ${cb.min.z}..${cb.max.z})`);
  assert.ok(cb.min.y > TRAIN_RIDE_HEIGHT + 1.0 && cb.max.y < TRAIN_RIDE_HEIGHT + 2.28, 'comms terminal sits between sill and head trim');

  const sign = out.object.getObjectByName('train_pocket_info_sign');
  assert.ok(sign, 'door-pocket info sign exists');
  const sb = new THREE.Box3().setFromObject(sign);
  // Door pocket on +X (doorSide='right') spans z in [1.05, 3.31]; inner wall surface is x = 1.36.
  assert.ok(sb.min.z >= 1.05 && sb.max.z <= 3.31, `info sign stays inside the windowless door pocket (z ${sb.min.z}..${sb.max.z})`);
  assert.ok(sb.max.x <= 1.36 + 0.005 && sb.min.x >= 1.3, `info sign sits flush on the interior pocket skin (x ${sb.min.x}..${sb.max.x})`);
  assert.ok(sb.min.y > TRAIN_RIDE_HEIGHT + 1.05 && sb.max.y < TRAIN_RIDE_HEIGHT + 2.28, 'info sign sits between sill and head trim');

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const px = sx * 0.54;
      const pz = sz * (1.05 + 0.24);
      const hit = out.colliders.some(
        (b) => b.enabled !== false && b.min[0] <= px && b.max[0] >= px && b.min[2] <= pz && b.max[2] >= pz && b.min[1] <= TRAIN_RIDE_HEIGHT + 1 && b.max[1] >= TRAIN_RIDE_HEIGHT + 1,
      );
      assert.ok(hit, `stanchion pole at (${px}, ${pz}) has a solid collider`);
    }
  }
});

test('transit_depart_board supports departure (default) and arrival modes', () => {
  const m = stubMaterials();
  const def = TRANSIT_PROPS.find((d) => d.id === 'transit_depart_board')!;
  const dep = def.generate({ area: 'transit' }, new Rng('dep'), m);
  const arr = def.generate({ area: 'transit', mode: 'arrival' }, new Rng('arr'), m);
  assert.equal(dep.object.getObjectByName('transit_board_face')?.userData['boardMode'], 'departure');
  assert.equal(arr.object.getObjectByName('transit_board_face')?.userData['boardMode'], 'arrival');
});

test('transit_rotating_beacon spins when enabled, obeys reducedFlashing, and resets cleanly', async () => {
  const { flashingState } = await import('../../render/flashing.ts');
  const m = stubMaterials();
  const def = TRANSIT_PROPS.find((d) => d.id === 'transit_rotating_beacon')!;
  const out = def.generate({ area: 'transit', phase: 0.5 }, new Rng('beacon'), m);
  const rotor = out.object.getObjectByName('r16_beacon_rotor')!;
  const steady = out.object.getObjectByName('r16_beacon_steady')!;
  assert.ok(rotor && steady, 'rotor and steady lens meshes exist');
  assert.equal(out.lightSlots?.length, 1, 'claims one emergency light slot by default');
  assert.equal(out.lightSlots?.[0]!.kind, 'emergency');

  const emit = (ev: string, payload?: unknown) => {
    for (const l of out.listeners ?? []) if (l.event === ev) l.fn(payload);
  };

  out.tick?.(0, 0.016);
  assert.equal(rotor.visible, false);
  assert.equal(steady.visible, false);

  flashingState.reduced = false;
  emit('transit:r16_beacons', { on: true });
  out.tick?.(1, 0.016);
  const r1 = rotor.rotation.y;
  out.tick?.(2, 0.016);
  assert.equal(rotor.visible, true);
  assert.equal(steady.visible, false);
  assert.notEqual(rotor.rotation.y, r1, 'rotor turns over time');

  flashingState.reduced = true;
  out.tick?.(3, 0.016);
  assert.equal(rotor.visible, false, 'no rotating beam under reducedFlashing');
  assert.equal(steady.visible, true, 'steady red lens shown under reducedFlashing');

  flashingState.reduced = false;
  emit('level:reset');
  out.tick?.(4, 0.016);
  assert.equal(rotor.visible, false);
  assert.equal(steady.visible, false);
});

test('blood_decal shares cached materials with zero colliders, and fallen_body is grounded and uncollided', () => {
  const m = stubMaterials();
  const bloodDef = TRANSIT_PROPS.find((d) => d.id === 'blood_decal')!;
  const a = bloodDef.generate({ surface: 'floor', variant: 'pool', seed: 'r16_a' }, new Rng('a'), m);
  const b = bloodDef.generate({ surface: 'floor', variant: 'pool', seed: 'r16_a' }, new Rng('b'), m);
  assert.equal(a.colliders.length, 0, 'blood decals have no colliders');
  const matA = (a.object.children[0] as THREE.Mesh).material;
  const matB = (b.object.children[0] as THREE.Mesh).material;
  assert.equal(matA, matB, 'same variant + seed bucket shares one cached material');

  const bodyDef = TRANSIT_PROPS.find((d) => d.id === 'fallen_body')!;
  const body = bodyDef.generate({ area: 'transit' }, new Rng('body'), m);
  assert.equal(body.colliders.length, 0, 'fallen body does not block movement');
  const box = new THREE.Box3().setFromObject(body.object);
  assert.ok(box.min.y >= -0.02 && box.max.y <= 0.35, `fallen body lies low on the floor (y ${box.min.y}..${box.max.y})`);
});

test('R16b concourse dressing pieces (truss, monument sign, bench, stanchion, luggage) have valid bounds and collision', () => {
  const m = stubMaterials();
  const boxOf = (o: THREE.Object3D): THREE.Box3 => new THREE.Box3().setFromObject(o);

  const truss = TRANSIT_PROPS.find((d) => d.id === 'concourse_truss')!.generate({ area: 'transit', span: 19.4, height: 8 }, new Rng('tr'), m);
  const tb = boxOf(truss.object);
  assert.equal(truss.colliders.length, 0, 'overhead concourse truss has no floor colliders');
  assert.ok(tb.min.y >= 6.5 && tb.max.y <= 8.05, `truss hangs in upper ceiling volume (${tb.min.y}..${tb.max.y})`);

  const sign = TRANSIT_PROPS.find((d) => d.id === 'concourse_monument_sign')!.generate({ area: 'transit', width: 8.6, height: 2.1, y: 5.1 }, new Rng('sg'), m);
  const sb = boxOf(sign.object);
  assert.equal(sign.colliders.length, 0, 'wall monument sign has no blocking colliders');
  assert.ok(sb.min.y >= 3.5 && sb.max.x - sb.min.x >= 8.4, `monument sign spans focal header (${sb.max.x - sb.min.x} m)`);

  const bench = TRANSIT_PROPS.find((d) => d.id === 'concourse_bench')!.generate({ area: 'transit', width: 2.6 }, new Rng('bn'), m);
  assert.ok(bench.colliders.length > 0, 'bench has solid collision');

  const stanchion = TRANSIT_PROPS.find((d) => d.id === 'stanchion_barrier')!.generate({ area: 'transit', length: 5.2, posts: 4 }, new Rng('st'), m);
  assert.ok(stanchion.colliders.length > 0, 'stanchion barrier has solid collision');

  const luggage = TRANSIT_PROPS.find((d) => d.id === 'luggage_cluster')!.generate({ area: 'transit', tipped: true }, new Rng('lg'), m);
  assert.equal(luggage.colliders.length, 0, 'abandoned luggage cluster is uncollided');
});
