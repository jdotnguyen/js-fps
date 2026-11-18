import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import posesJson from '../data/poses.json' with { type: 'json' };
import type { GoreSystem } from '../actors/gore.ts';
import { PoseLibrary } from '../actors/poses.ts';
import { loadPoseFile } from '../data/types/poses.ts';
import { demoRoomPlayerWorld } from '../world/demoRoomColliders.ts';
import { gridNodes, NavGraph, type NavDoor } from './nav.ts';
import { GIVE_WAY, pickSpot } from './giveWay.ts';
import { NpcDirector } from './npcs.ts';
import { Squad, type SquadPlayer } from './squad.ts';

const ctx = { poses: new PoseLibrary(loadPoseFile(posesJson)), gore: {} as GoreSystem };
const DT = 1 / 60;
const JAY_R = 0.35;

/** A doorway across the corridor at z = 0 (open), normal along z. */
const DOOR: NavDoor = { id: 'door', box: { min: [-1.4, 0, -0.1], max: [1.4, 2.8, 0.1] }, isOpen: () => true };

function setup(opts: { squad?: boolean; door?: boolean } = {}) {
  const pw = demoRoomPlayerWorld();
  const nav = new NavGraph({
    world: pw.colliders,
    nodes: gridNodes(pw.colliders, { minX: -2.5, maxX: 2.5, minZ: -9.5, maxZ: 9.5, maxY: 0.5 }, 1),
    ...(opts.door ? { doors: [DOOR] } : {}),
  });
  // Jay: a circle body that is blocked by every solid body (what Player.setBodies does) and reports his wish.
  const jay = { x: 0, z: 3, wish: { x: 0, z: 0 }, speed: 1.9 };
  const squadPlayer = {
    body: { x: 0, y: 0, z: 0, vy: 0, grounded: true },
    yaw: 0,
    aimBlend: 0,
    velocity: { x: 0, y: 0 },
    wish: { x: 0, z: 0 },
    viewDirection: (o = new THREE.Vector3()) => o.set(0, 0, -1),
    eyePosition(o = new THREE.Vector3()) {
      return o.set(this.body.x, this.body.y + 1.62, this.body.z);
    },
  };
  const squad = opts.squad ? new Squad({ ctx, nav, player: squadPlayer as SquadPlayer }) : null;
  const npcs = new NpcDirector({
    ctx,
    nav,
    colliders: pw.colliders,
    squad,
    player: () => ({ feet: new THREE.Vector3(jay.x, 0, jay.z), head: new THREE.Vector3(jay.x, 1.62, jay.z), wish: jay.wish }),
  });
  npcs.setResolver((ref) => (Array.isArray(ref) ? { pos: { x: ref[0], y: ref[1], z: ref[2] } } : null));
  const step = (): void => {
    const nx = jay.x + jay.wish.x * jay.speed * DT;
    const nz = jay.z + jay.wish.z * jay.speed * DT;
    jay.x = nx;
    jay.z = nz;
    for (const b of npcs.solidBodies()) {
      const dx = jay.x - b.x;
      const dz = jay.z - b.z;
      const d = Math.hypot(dx, dz);
      const min = b.r + JAY_R;
      if (d < min && d > 1e-6) {
        jay.x = b.x + (dx / d) * min;
        jay.z = b.z + (dz / d) * min;
      }
    }
    squadPlayer.body.x = jay.x;
    squadPlayer.body.z = jay.z;
    squadPlayer.wish = jay.wish;
    squad?.update(DT, null);
    npcs.update(DT, null);
  };
  return { npcs, squad, jay, step };
}

const spawn = (npcs: NpcDirector, id: string, x: number, z: number, pose?: string) =>
  npcs.spawnFromLevel([{ id, look: id, pos: new THREE.Vector3(x, 0, z), yaw: 0, ...(pose ? { pose } : {}) }]);

test('solidBodies: cast, spawned and every squadmate; not towed, lying, downed or hidden bodies', async () => {
  const { npcs, squad, step } = setup({ squad: true });
  step();
  spawn(npcs, 'ruiz', 0, -4);
  spawn(npcs, 'sung', 1, -4);
  spawn(npcs, 'bram', -1, -4, 'corpseSupine');
  spawn(npcs, 'heins', 2, -6);
  spawn(npcs, 'hale', -2, -6);
  await npcs.command('spawn', { npc: 'cook', kind: 'cook', at: [0, 0, -7] });
  const count = (): number => [...npcs.solidBodies()].length;
  // ruiz, sung, heins, hale, cook + 2 squadmates (bram lies down).
  assert.equal(count(), 7);
  for (const b of npcs.solidBodies()) assert.ok(b.r > 0.2 && b.r < 0.5);
  // A towed body, a downed squadmate and a hidden body drop out.
  await npcs.command('npcDrag', { npc: 'heins', by: 'hale', distance: 0.5 });
  assert.equal(count(), 6, 'towed body');
  squad!.mate('medic').behaviour = 'downed';
  assert.equal(count(), 5, 'downed squadmate');
  npcs.actor('hale')!.body.group.visible = false;
  assert.equal(count(), 4, 'hidden body');
  // Scripted squadmates (lent to a sequence) are still bodies.
  squad!.mate('engineer').scripted = true;
  assert.equal(count(), 4);
});

test('a standing NPC steps out of Jay\'s line within 0.5 s and returns home once he has moved on', () => {
  const { npcs, jay, step } = setup();
  spawn(npcs, 'ruiz', 0, 0);
  const a = npcs.actor('ruiz')!;
  step();
  jay.z = 3;
  jay.wish = { x: 0, z: -1 };
  let contactAt = -1;
  let t = 0;
  let clearAt = -1;
  for (let i = 0; i < 600 && clearAt < 0; i++, t += DT) {
    step();
    const d = Math.hypot(a.position.x - jay.x, a.position.z - jay.z);
    if (contactAt < 0 && d < a.body.footprint.r + JAY_R + GIVE_WAY.reach) contactAt = t;
    // Out of his line: lateral offset enough for his body to slip past.
    if (contactAt >= 0 && Math.abs(a.position.x) >= a.body.footprint.r + JAY_R - 0.1) clearAt = t;
  }
  assert.ok(contactAt >= 0 && clearAt >= 0, 'made room');
  assert.ok(clearAt - contactAt <= 0.5, `cleared the line ${(clearAt - contactAt).toFixed(2)} s after first contact`);
  // Jay walks through and on to the far end, then stands: the NPC walks back home and faces as before.
  for (let i = 0; i < 60 * 5 && jay.z > -3; i++) step();
  assert.ok(jay.z <= -3, 'Jay got past');
  jay.wish = { x: 0, z: 0 };
  for (let i = 0; i < 60 * 8; i++) step();
  assert.ok(Math.hypot(a.position.x, a.position.z) < 0.2, `back home (${a.position.x.toFixed(2)}, ${a.position.z.toFixed(2)})`);
  assert.ok(!a.givingWay);
});

test('a script command during a give-way wins: the NPC does not walk back home afterwards', async () => {
  const { npcs, jay, step } = setup();
  spawn(npcs, 'ruiz', 0, 0);
  const a = npcs.actor('ruiz')!;
  jay.wish = { x: 0, z: -1 };
  for (let i = 0; i < 90; i++) step();
  assert.ok(a.givingWay, 'stepping aside');
  jay.wish = { x: 0, z: 0 };
  const moved = npcs.command('npcMoveTo', { npc: 'ruiz', to: [1.5, 0, -5] });
  for (let i = 0; i < 60 * 15; i++) step();
  await moved;
  assert.ok(Math.hypot(a.position.x - 1.5, a.position.z + 5) < 0.4, 'went where the script said');
});

test('an NPC standing in a doorway backs out along the door normal, away from Jay', () => {
  const { npcs, jay, step } = setup({ door: true });
  spawn(npcs, 'ruiz', 0.2, 0.1);
  const a = npcs.actor('ruiz')!;
  jay.z = 3;
  jay.wish = { x: 0, z: -1 };
  let minZ = 1;
  let xAtMin = 0;
  for (let i = 0; i < 60 * 2.2; i++) {
    step();
    if (a.position.z < minZ) {
      minZ = a.position.z;
      xAtMin = a.position.x;
    }
  }
  assert.ok(minZ < -1.0, `backed out to the far side (z ${minZ.toFixed(2)})`);
  assert.ok(Math.abs(xAtMin - 0.2) < 0.5, 'straight back along the normal, not sideways');
  // And from the other side: Jay coming from -z, the NPC backs out to +z.
  const b = setup({ door: true });
  spawn(b.npcs, 'sung', -0.3, -0.1);
  b.jay.z = -3;
  b.jay.wish = { x: 0, z: 1 };
  let maxZ = 0;
  for (let i = 0; i < 60 * 2.2; i++) {
    b.step();
    maxZ = Math.max(maxZ, b.npcs.actor('sung')!.position.z);
  }
  assert.ok(maxZ > 1.0, 'backed out to +z');
});

test('someone working in place stays put unless they stand in a doorway', async () => {
  const { npcs, jay, step } = setup({ door: true });
  spawn(npcs, 'ruiz', 0, -4);
  spawn(npcs, 'sung', 0, 0);
  await npcs.command('npcAnim', { npc: 'ruiz', anim: 'typing' });
  await npcs.command('npcAnim', { npc: 'sung', anim: 'typing' });
  const [r, s] = [npcs.actor('ruiz')!, npcs.actor('sung')!];
  jay.z = -2;
  jay.wish = { x: 0, z: -1 };
  for (let i = 0; i < 60; i++) step();
  assert.ok(Math.abs(r.position.z + 4) < 1e-6 && Math.abs(r.position.x) < 1e-6, 'a typist stays solid at the desk');
  jay.z = 2;
  for (let i = 0; i < 90; i++) step();
  assert.ok(s.position.z < -1, 'a typist in a doorway backs out');
});

test('an offering NPC stays put (but stays solid)', async () => {
  const { npcs, jay, step } = setup();
  spawn(npcs, 'priya', 0, 0);
  await npcs.command('npcOffer', { npc: 'priya', item: 'mug' });
  jay.wish = { x: 0, z: -1 };
  for (let i = 0; i < 90; i++) step();
  const a = npcs.actor('priya')!;
  assert.ok(Math.hypot(a.position.x, a.position.z) < 0.05, 'did not step aside');
  assert.ok(jay.z > 0.5, 'Jay is blocked by the body');
});

test('a scripted walker with Jay in its path never overlaps him and still arrives', async () => {
  const { npcs, jay, step } = setup();
  spawn(npcs, 'ruiz', 0, -4);
  const a = npcs.actor('ruiz')!;
  jay.x = 0;
  jay.z = 0;
  jay.wish = { x: 0, z: 0 };
  let arrived = false;
  void npcs.command('npcMoveTo', { npc: 'ruiz', to: [0, 0, 4] }).then(() => (arrived = true));
  let worst = 0;
  for (let i = 0; i < 60 * 25 && !arrived; i++) {
    step();
    await Promise.resolve();
    worst = Math.max(worst, a.body.footprint.r + JAY_R - Math.hypot(a.position.x - jay.x, a.position.z - jay.z));
  }
  assert.ok(arrived, 'the walk resolved');
  assert.ok(Math.hypot(a.position.x, a.position.z - 4) < 0.5, `stood at the goal (${a.position.x.toFixed(2)}, ${a.position.z.toFixed(2)})`);
  assert.ok(worst < 0.02, `never overlapped Jay (worst ${worst.toFixed(3)} m)`);
});

test('a scripted walker blocked by Jay on its goal waits instead of abandoning the move, and arrives once he steps off', async () => {
  const { npcs, jay, step } = setup();
  spawn(npcs, 'ruiz', 0, -4);
  const a = npcs.actor('ruiz')!;
  jay.x = 0;
  jay.z = 3.7;
  jay.wish = { x: 0, z: 0 };
  let done = false;
  void npcs.command('npcMoveTo', { npc: 'ruiz', to: [0, 0, 4] }).then(() => (done = true));
  let worst = 0;
  for (let i = 0; i < 60 * 7; i++) {
    step();
    await Promise.resolve();
    worst = Math.max(worst, a.body.footprint.r + JAY_R - Math.hypot(a.position.x - jay.x, a.position.z - jay.z));
  }
  assert.equal(done, false, 'still waiting after 7 s');
  assert.ok(a.moving);
  assert.ok(worst < 0.02, `no shoving (worst ${worst.toFixed(3)} m)`);
  // Jay steps off: it arrives.
  jay.z = 0;
  for (let i = 0; i < 60 * 8 && !done; i++) {
    step();
    await Promise.resolve();
  }
  assert.equal(done, true);
});

test('separation never skips a pair with the player: walkers at their goal and AI squadmates are pushed clear', () => {
  const { npcs, squad, jay, step } = setup({ squad: true });
  step();
  // A walker 0.6 m from its goal (inside ARRIVE_LOCK) with Jay standing on it.
  spawn(npcs, 'ruiz', 0, -2);
  void npcs.command('npcMoveTo', { npc: 'ruiz', to: [0, 0, -2.6] });
  jay.x = 0;
  jay.z = -2.1;
  jay.wish = { x: 0, z: 0 };
  // An AI squadmate (not lent) dropped right on Jay.
  const giles = squad!.mate('engineer');
  giles.motor.x = jay.x + 0.05;
  giles.motor.z = jay.z + 0.4 + 0.3;
  giles.body.group.position.set(giles.motor.x, 0, giles.motor.z);
  const ruiz = npcs.actor('ruiz')!;
  const overlap = (b: { x: number; z: number; r: number }): number => b.r + JAY_R - Math.hypot(b.x - jay.x, b.z - jay.z);
  for (let i = 0; i < 90; i++) npcs.update(DT, null); // Jay and the squad AI held still: separation alone
  for (const b of npcs.solidBodies()) assert.ok(overlap(b) < 0.03, `clear of Jay (${overlap(b).toFixed(3)})`);
  assert.ok(ruiz.body.footprint.r > 0);
  // Exactly on top of Jay: still pushed out.
  giles.motor.x = jay.x;
  giles.motor.z = jay.z;
  for (let i = 0; i < 60; i++) npcs.update(DT, null);
  assert.ok(Math.hypot(giles.motor.x - jay.x, giles.motor.z - jay.z) > 0.55, 'pushed off Jay');
});

test('pickSpot prefers the side the body is on and falls back to the other when blocked', () => {
  const { npcs } = setup();
  void npcs;
  const pw = demoRoomPlayerWorld();
  const env = { nav: null, colliders: pw.colliders };
  const left = pickSpot({ x: -0.2, y: 0, z: 0 }, 0.3, { x: 0, z: 2 }, { x: 0, z: -1 }, env, false)!;
  assert.ok(left.x < -0.8, 'sidestepped to the side it was already on');
  // Against the left wall (x = -2.94): goes right instead.
  const wall = pickSpot({ x: -2.4, y: 0, z: 0 }, 0.3, { x: -2.4, z: 2 }, { x: 0, z: -1 }, env, false)!;
  assert.ok(wall.x > -2.4, 'the wall side is blocked, so the other side');
});
