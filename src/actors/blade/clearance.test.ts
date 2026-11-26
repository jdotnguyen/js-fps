import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EventBus } from '../../core/events.ts';
import type { LevelData } from '../../data/types/level.ts';
import { createMaterials, disposeMaterials } from '../../render/materials.ts';
import { CollisionWorld } from '../../world/collision.ts';
import { NpcActor } from '../../ai/npcActor.ts';
import { measureBladePenetration } from './clearance.ts';
import { creatureBody, stepBody } from './bladeTestKit.ts';
import { readLevel } from '../../data/levels/readLevel.ts';

// Headless canvas stub for door status screens in Node (matches src/world/doorPry.test.ts).
const noop = (): void => undefined;
const ctx2d = new Proxy({} as Record<string | symbol, unknown>, {
  get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 10 }) : noop),
});
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ width: 1, height: 1, getContext: () => ctx2d, style: {} }) };
(globalThis as { Path2D?: unknown }).Path2D ??= class {
  moveTo = noop;
  lineTo = noop;
  closePath = noop;
  arc = noop;
  rect = noop;
  bezierCurveTo = noop;
  quadraticCurveTo = noop;
};

const { KitRegistry } = await import('../../world/registry.ts');
const { Level } = await import('../../world/level.ts');

/** rig-necromorph tasks 7.2, 7.4, 7.5 (design D9, spec "Its blades stay out of the world"): blade clearance against colliders. */

function buildSubset(roomIds: readonly string[], doorIds: readonly string[]): { lvl: InstanceType<typeof Level>; cleanup: () => void } {
  const full = readLevel('slice01') as LevelData;
  const keepRooms = new Set(roomIds);
  const keepDoors = new Set(doorIds);
  const rooms = full.rooms.filter((r) => keepRooms.has(r.id)).map((r) => ({ ...r, props: [] }));
  const subset: LevelData = {
    id: full.id,
    name: full.name ?? 'slice01',
    seed: full.seed,
    playerStart: { room: rooms[0]!.id, pos: [0, 0, 0], yaw: 0 },
    checkpoints: [],
    rooms,
    doors: full.doors.filter((d) => keepDoors.has(d.id)),
  };
  const scene = new THREE.Scene();
  const materials = createMaterials(8, 4);
  const registry = new KitRegistry({ glb: {} });
  const events = new EventBus();
  const lvl = new Level(subset, { scene, materials, registry, events });
  return {
    lvl,
    cleanup: () => {
      lvl.dispose();
      registry.dispose();
      disposeMaterials(materials);
    },
  };
}

test('clearance helper catches a blade driven into a wall and reports 0 when standing clear', async () => {
  const world = new CollisionWorld();
  // Solid wall along z = -1.0 (thickness 0.3 m: -1.3 .. -1.0).
  world.add({ min: [-4, 0, -1.3], max: [4, 3.2, -1.0] }, 'wall');
  const h = await creatureBody('lab_creature', 'blade_stance');
  // Standing well back (z = 1.0, facing -Z): completely clear.
  h.group.position.set(0, 0, 1.0);
  h.setHeading(0);
  stepBody(h, 20);
  const clear = measureBladePenetration(h, world);
  assert.equal(clear.depth, 0, 'standing back has 0 penetration');

  // Driven into the wall (z = -0.3, thrust pose reaches -1.56 m -> well inside -1.3..-1.0): caught (> 5 cm).
  h.group.position.set(0, 0, -0.3);
  h.setPose('blade_pound_hit', 0.01);
  stepBody(h, 20);
  const hit = measureBladePenetration(h, world);
  assert.ok(hit.depth > 0.05, `expected helper to catch wall penetration > 0.05 m, got ${hit.depth.toFixed(3)} m`);
  assert.equal(hit.collider?.tag, 'wall');
});

test('R10 scream and charge down R09 keep both blades within 5 cm of floors, walls, ceiling and frames', async () => {
  const { lvl, cleanup } = buildSubset(['R09', 'R10'], ['D_R09_R10']);
  try {
    lvl.setDoor('D_R09_R10', 'open');
    for (let i = 0; i < 120; i++) lvl.update(i / 60, 1 / 60, new THREE.Vector3(32, 1.6, 48), false);
    const start = lvl.anchor('r09_charge_start')!;
    const end = lvl.anchor('r09_flood_behind')!;
    const h = await creatureBody('flood_elite', 'idle');
    const npc = new NpcActor('r09_flood_shambler', h, { x: start.pos.x, y: start.pos.y, z: start.pos.z, vy: 0, grounded: true });
    npc.place(start.pos, start.yaw ?? 0);

    let worst = 0;
    let worstInfo = '';
    const check = (phase: string): void => {
      const p = measureBladePenetration(h, lvl.collision);
      if (p.depth > worst) {
        worst = p.depth;
        worstInfo = `${phase} ${p.side}@${p.fraction.toFixed(2)} depth=${p.depth.toFixed(3)}m pt=${p.point?.toArray().map((n) => n.toFixed(2)).join(',')} tag=${p.collider?.tag}`;
      }
    };
    const cam = new THREE.Vector3(32, 1.6, 48);
    const env = { nav: null, colliders: lvl.collision, playerHead: cam, playerFeet: new THREE.Vector3(32, 0, 48), camera: cam };

    // Scream down the hall, then cut into the 3.2 m/s charge up the stairs.
    void npc.playAnim('scream', { hold: 6 });
    for (let i = 0; i < 90; i++) {
      npc.update(1 / 60, env);
      check('scream');
    }
    assert.equal(h.performancePlaying, true, 'scream is active while waiting');
    void npc.moveTo(end.pos, { speed: 3.2 });
    assert.equal(h.performancePlaying, false, 'charge cuts the scream immediately');
    for (let i = 0; i < 360; i++) {
      npc.update(1 / 60, env);
      check('charge');
      if (!npc.busy) break;
    }
    assert.ok(worst <= 0.05, `R10 blade penetration ${worst.toFixed(3)} m > 0.05 m (${worstInfo})`);
  } finally {
    cleanup();
  }
});

test('R08 creature passing through the surgery doorway keeps both blades clear of frames and ceiling', async () => {
  const { lvl, cleanup } = buildSubset(['R08', 'R08b'], ['D_R08_R08b']);
  try {
    lvl.setDoor('D_R08_R08b', 'open');
    for (let i = 0; i < 120; i++) lvl.update(i / 60, 1 / 60, new THREE.Vector3(0, 1.6, 44), false);
    const lurk = lvl.anchor('r08_lurk')!;
    const sOut = lvl.anchor('r08_surgery_out')!;
    const sIn = lvl.anchor('r08_surgery_in')!;
    const back = lvl.anchor('r08_back')!;
    const slamSpot = lvl.anchor('r08_slam_spot')!;
    const h = await creatureBody('lab_creature', 'maul_grip');
    const npc = new NpcActor('r08_thing', h, { x: lurk.pos.x, y: lurk.pos.y, z: lurk.pos.z, vy: 0, grounded: true });
    npc.place(lurk.pos, lurk.yaw ?? 0);
    const cam = new THREE.Vector3(0, 1.6, 44);
    const env = { nav: null, colliders: lvl.collision, playerHead: cam, playerFeet: new THREE.Vector3(0, 0, 44), camera: cam };

    let worst = 0;
    let worstInfo = '';
    const check = (phase: string): void => {
      const p = measureBladePenetration(h, lvl.collision);
      if (p.depth > worst) {
        worst = p.depth;
        worstInfo = `${phase} ${p.side}@${p.fraction.toFixed(2)} depth=${p.depth.toFixed(3)}m pt=${p.point?.toArray().map((n) => n.toFixed(2)).join(',')} tag=${p.collider?.tag}`;
      }
    };
    void npc.moveTo(back.pos, { speed: 7.2, track: [sOut.pos, sIn.pos, back.pos] });
    for (let i = 0; i < 240 && npc.busy; i++) {
      npc.update(1 / 60, env);
      check('r08-in');
    }
    // Walk back to the surgery from the cart along the real kills.json path (`surgeryIn -> surgeryOut -> surgery`).
    npc.place(slamSpot.pos, 0);
    void npc.moveTo(lurk.pos, { speed: 7.2, track: [sIn.pos, sOut.pos, lurk.pos] });
    for (let i = 0; i < 240 && npc.busy; i++) {
      npc.update(1 / 60, env);
      check('r08-out');
    }
    assert.ok(worst <= 0.05, `R08 surgery doorway blade penetration ${worst.toFixed(3)} m > 0.05 m (${worstInfo})`);
  } finally {
    cleanup();
  }
});
