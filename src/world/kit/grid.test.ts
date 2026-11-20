import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PLAYER_TUNING } from '../../actors/player.ts';
import { EventBus } from '../../core/events.ts';
import { Rng } from '../../core/rng.ts';
import type { LevelData } from '../../data/types/level.ts';
import type { Materials } from '../../render/materials.ts';
import { Level } from '../level.ts';
import { LightPool } from '../lightPool.ts';
import { KitRegistry } from '../registry.ts';
import { createMaterials, createProceduralBrickMaterial } from '../../render/materials.ts';
import { rounded } from './geom.ts';
import { AoMergeBuilder } from './merge.ts';
import { GridOccupancy } from './grid.ts';
import { HullBuilder } from './exteriorHull.ts';
import { snapModelToSocket } from './modelSnap.ts';
import { STRUCTURE_PIECES } from './structure.ts';
import { WALL_INSET, WALL_T } from './types.ts';

function fakeMaterials(): Materials {
  const s = (color: number): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color });
  return {
    paintTeal: s(0x2f6f70), paintDark: s(0x222222), paintBone: s(0xccccbb), steel: s(0x888888), diamond: s(0x777777),
    grating: s(0x666666), rubber: s(0x111111), hazard: s(0xccaa00),
    labTile: s(0x889096), labPanel: s(0xb2b8bc), concrete: s(0x55585a),
    diamondHazard: s(0x886622), diamondRusty: s(0x775544), hazardClean: s(0xccaa00), rustHeavy: s(0x664433),
    rustDrip: s(0x775533), rustBlotch: s(0x887766), concreteFloor: s(0x55585a), concretePainted: s(0x333537),
    tileBroken: s(0x889096), tileWall: s(0xaaaaaa), tileWashroom: s(0x667777), signDanger: s(0xaa4422),
    servicePaint: s(0x777879), hullPlate: s(0x667076), boltPanel: s(0x778088), steelBrushed: s(0x88929a), deckCorrugated: s(0x444a50),
    acousticCeiling: s(0x9a9e9a), vinylPanel: s(0xb8b0a0), officeCeiling: s(0xccccca), woodPanel: s(0x6a4a30), carpet: s(0x2e3440),
    steelDark: s(0x465058), cleanWall: s(0xb8b6ac), cleanSlate: s(0x62707a), cleanTeal: s(0x3b787c),
    glass: new THREE.MeshPhysicalMaterial({ transparent: true }),
    black: s(0x000000), cable: s(0x111111), glowCyan: s(0x00ffff),
  };
}

test('PLAYER_TUNING.eyeHeight is true-to-life FPS 1.70 m', () => {
  assert.equal(PLAYER_TUNING.eyeHeight, 1.7);
});

test('the exterior preserves rotated openings, internal boundaries and the exposed side of a taller room', () => {
  const builder = new HullBuilder();
  builder.addPiece('left', [0, 0, 0], 'floor', 0, 3.2, []);
  builder.addPiece('left', [0, 0, 0], 'corridor_window', 0, 3.2, []);
  builder.addPiece('right', [2, 0, 0], 'wall_window', 90, 3.2, []);
  builder.addPiece('tall', [0, 0, 1], 'door_frame', 180, 5, []);
  builder.addPiece('upper', [2, 1, 0], 'floor', 0, 3.2, []);
  const { group, windowViews } = builder.build([], fakeMaterials());
  group.updateMatrixWorld(true);
  assert.deepEqual([...windowViews.get('left')!], ['right']);
  assert.deepEqual([...windowViews.get('right')!], ['left']);
  const hits = (from: number[], dir: number[], far: number): number => new THREE.Raycaster(
    new THREE.Vector3().fromArray(from), new THREE.Vector3().fromArray(dir), 0, far,
  ).intersectObject(group).length;
  assert.equal(hits([0, 1.6, 0], [1, 0, 0], 7), 0, 'both facing windows are open');
  assert.ok(hits([4, 0.5, 0], [-1, 0, 0], 3), 'plate below the corridor sill');
  assert.equal(hits([0, 1.6, 0], [0, 0, 1], 4), 0, 'shared cell edge');
  assert.ok(hits([0, 4.3, 0], [0, 0, 1], 4), 'exposed upper wall');
  assert.equal(hits([0, 1.6, 4], [0, 0, 1], 3), 0, 'exterior door aperture');
  assert.ok(hits([0, 3, 7], [0, 0, -1], 2), 'plating above the door');
  assert.equal(hits([8, 5, 0], [0, -1, 0], 4), 0, 'no internal roof between stacked decks');
});

test('the launch trunk cell hangs a closed skirt and outer hatch under the hull (rebuild-dive-bay)', () => {
  const builder = new HullBuilder();
  builder.addPiece('pool', [0, 0, 0], 'floor_moonpool', 0, 5, []);
  const { group } = builder.build([], fakeMaterials());
  group.updateMatrixWorld(true);
  const hits = (from: number[], dir: number[], far: number): number => new THREE.Raycaster(
    new THREE.Vector3().fromArray(from), new THREE.Vector3().fromArray(dir), 0, far,
  ).intersectObject(group).length;
  assert.ok(hits([0, -6, 0], [0, 1, 0], 3), 'the trunk opening is capped from below');
  assert.ok(hits([3, -2, 0], [-1, 0, 0], 3), 'skirt side under the hull');
  assert.ok(hits([1.8, -6, 1.8], [0, 1, 0], 6), 'hull bottom plate around the trunk');
});

test('GridOccupancy rejects duplicate same-side walls and walls overlapping door edges', () => {
  const g = new GridOccupancy();
  assert.equal(g.claimDoor('D1', [0, 0, 1], 0).ok, true);
  assert.equal(g.claimWall('R01', 'wall_panel', [0, 0, 1], 0).ok, false);
  // Opposite cell sharing the same edge (0,0,0 facing +Z = 180) also overlaps D1.
  assert.equal(g.claimWall('R02', 'wall_plain', [0, 0, 0], 180).ok, false);
  // Non-door edge: first claim succeeds, duplicate same-side claim fails.
  assert.equal(g.claimWall('R01', 'wall_panel', [0, 0, 1], 90).ok, true);
  assert.equal(g.claimWall('R01', 'wall_plain', [0, 0, 1], 90).ok, false);
});

test('structural kit pieces emit floor, wall, and door sockets with non-coplanar wall inset', () => {
  const m = fakeMaterials();
  const rng = new Rng('grid-test');
  const floor = STRUCTURE_PIECES.find((p) => p.id === 'floor')!.generate({}, rng, m);
  assert.ok(floor.sockets.some((s) => s.name === 'floor_center' && s.kind === 'floor' && s.pos[1] === 0));

  const wall = STRUCTURE_PIECES.find((p) => p.id === 'wall_panel')!.generate({}, rng, m);
  const ws = wall.sockets.find((s) => s.name === 'wall_center' && s.kind === 'wall');
  assert.ok(ws);
  assert.ok(Math.abs(ws.pos[2] - (-2 + WALL_T)) < 1e-6);

  const box = new THREE.Box3().setFromObject(wall.object);
  assert.ok(box.min.z >= -2 + WALL_INSET - 1e-5, `wall back face inset from -2 (${box.min.z})`);
});

test('wall tiles report pilasters and trim rails as keep-outs for wall-mounted props', () => {
  const m = fakeMaterials();
  const posts = (id: string): number[] => {
    const out = STRUCTURE_PIECES.find((p) => p.id === id)!.generate({ height: 3.6 }, new Rng('keepout'), m);
    const boxes = out.keepouts ?? [];
    // Every keep-out sits on the room side of the wall face and stays within the tile.
    for (const b of boxes) {
      assert.ok(b.min[2] >= -2 + WALL_T - 1e-6, `${id} keep-out starts at the wall face (${b.min[2]})`);
      assert.ok(b.min[0] >= -2 - 1e-6 && b.max[0] <= 2 + 1e-6, `${id} keep-out inside the tile`);
    }
    assert.ok(boxes.some((b) => b.max[0] - b.min[0] > 3.9), `${id} has a full-width trim rail keep-out`);
    return boxes.filter((b) => b.max[0] - b.min[0] < 0.5).map((b) => Math.round(((b.min[0] + b.max[0]) / 2) * 100) / 100).sort((a, b) => a - b);
  };
  assert.deepEqual(posts('wall_panel'), [-1.89, 0], 'panel wall: tile-end pilaster and mid-bay rib');
  assert.deepEqual(posts('wall_plain'), [-1.89], 'plain wall: tile-end pilaster only');
});

test('snapModelToSocket normalizes scale and snaps cleanly onto floor and wall sockets', () => {
  // Centimeter-scale humanoid mesh (180 units tall, centered at origin)
  const human = new THREE.Mesh(new THREE.BoxGeometry(60, 180, 40), new THREE.MeshBasicMaterial());
  const floorBounds = snapModelToSocket(
    human,
    { name: 'floor_center', pos: [4, 0, 8], dir: [0, 0, -1], kind: 'floor' },
    { targetHeight: 1.78 },
  );
  assert.ok(Math.abs(floorBounds.box.min.y - 0) < 1e-4, 'feet sit flush at y = 0');
  assert.ok(Math.abs(floorBounds.size.y - 1.78) < 1e-4, 'scaled to 1.78 m');
  assert.ok(Math.abs(floorBounds.center.x - 4) < 1e-4);
  assert.ok(Math.abs(floorBounds.center.z - 8) < 1e-4);

  // Wall-mounted prop (e.g. weapon rack)
  const rack = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 0.2), new THREE.MeshBasicMaterial());
  const wallBounds = snapModelToSocket(
    rack,
    { name: 'wall_center', pos: [0, 1.4, -1.75], dir: [0, 0, 1], kind: 'wall' },
    { inset: 0.004 },
  );
  assert.ok(Math.abs(wallBounds.box.min.z - (-1.75 + 0.004)) < 1e-4, 'back sits flush + 4 mm inset');
  assert.ok(Math.abs(wallBounds.center.y - 1.4) < 1e-4);
});

test('Level applies debugChecker with 1 m world UVs and toggles back to PBR cleanly', () => {
  const data: LevelData = {
    id: 'checker_test',
    seed: 1,
    playerStart: { room: 'R01', pos: [0, 0, 0], yaw: 0 },
    rooms: [
      {
        id: 'R01',
        name: 'Test Room',
        pieces: [
          { kit: 'floor', cell: [0, 0, 0] },
          { kit: 'ceiling', cell: [0, 0, 0] },
          { kit: 'wall_panel', cell: [0, 0, 0], rot: 0 },
          { kit: 'wall_glass_partition', cell: [0, 0, 0], rot: 90 },
        ],
      },
    ],
    doors: [],
    checkpoints: [],
  };
  const mats = fakeMaterials();
  const registry = new KitRegistry({ glb: {} });
  const level = new Level(data, { materials: mats, registry, events: new EventBus(), scene: new THREE.Scene(), debugChecker: true });
  assert.equal(level.debugCheckerEnabled, true);

  let checkerMeshes = 0;
  let glassPreserved = false;
  level.group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    if (mat === mats.glass) glassPreserved = true;
    else if (mat?.name?.startsWith('debugChecker')) checkerMeshes++;
  });
  assert.ok(checkerMeshes > 0, 'procedural room meshes use debugChecker');
  assert.ok(glassPreserved, 'transparent glass stays transparent');

  // Snapping a model onto R01's floor_center socket works via Level API
  const prop = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
  assert.equal(level.snapModelToSocket(prop, 'R01', 'floor_center', { targetHeight: 1.0 }), true);

  level.setDebugChecker(false);
  assert.equal(level.debugCheckerEnabled, false);
});

test('centralized PBR materials have albedo/normal/roughness/AO maps, world-meter UVs, and shadow-casting practical light', () => {
  const mats = createMaterials(32, 4);
  const brick = createProceduralBrickMaterial(4);
  for (const m of [mats.concrete, mats.steel, mats.paintDark, brick]) {
    assert.ok(m instanceof THREE.MeshStandardMaterial);
    assert.ok(m.map && m.normalMap && m.roughnessMap && m.metalnessMap && m.aoMap, `${m.name} has full PBR maps`);
  }

  // RoundedBoxGeometry (4 m wide vs 1 m wide) gets world-meter UVs in AoMergeBuilder (not stretched 0..1)
  const mb = new AoMergeBuilder();
  mb.add(rounded(4, 3, 0.2), mats.concrete);
  const group = mb.build('uv-check', null);
  const mesh = group.children[0] as THREE.Mesh;
  const uv = mesh.geometry.getAttribute('uv');
  let maxU = -Infinity;
  let minU = Infinity;
  for (let i = 0; i < uv.count; i++) {
    maxU = Math.max(maxU, uv.getX(i));
    minU = Math.min(minU, uv.getX(i));
  }
  assert.ok(maxU - minU >= 3.9, `expected ~4 m UV span, got ${maxU - minU}`);

  // LightPool keeps pooled fill lights non-shadow-casting (ADR-0002)
  const pool = new LightPool(new THREE.Group(), 4);
  assert.equal(pool.lights.length, 4);
  assert.ok(pool.lights.every((l) => !l.castShadow));
});
