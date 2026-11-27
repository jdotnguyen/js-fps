import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { posesJson } from '../data/poseFiles.ts';
import type { GoreSystem } from '../actors/gore.ts';
import { PoseLibrary } from '../actors/poses.ts';
import { loadPoseFile } from '../data/types/poses.ts';
import { demoRoomPlayerWorld } from '../world/demoRoomColliders.ts';
import type { AmbientSpot } from './ambientLife.ts';
import { gridNodes, NavGraph } from './nav.ts';
import { NpcDirector, type NpcSpawn } from './npcs.ts';

/** in-world-audio: the overheard pairs stay at their places, and a held pair says nothing of its own. */

const ctx = { poses: new PoseLibrary(loadPoseFile(posesJson)), gore: {} as GoreSystem };

function setup() {
  const pw = demoRoomPlayerWorld();
  const nav = new NavGraph({ world: pw.colliders, nodes: gridNodes(pw.colliders, { minX: -2.5, maxX: 2.5, minZ: -9.5, maxZ: 9.5, maxY: 0.5 }, 1) });
  const npcs = new NpcDirector({
    ctx,
    nav,
    colliders: pw.colliders,
    squad: null,
    player: () => ({ feet: new THREE.Vector3(0, 0, 9), head: new THREE.Vector3(0, 1.6, 9) }),
    emit: () => undefined,
    warn: () => undefined,
  });
  const spot = (id: string, x: number, z: number): AmbientSpot => ({ id, room: 'R02', group: id, kind: 'lean_wall', pos: { x, y: 0, z }, yaw: 0, taken: null });
  const spots = [spot('s_a', -1, -4), spot('s_b', 0, -4), spot('s_c', 1, 3), spot('s_free1', -1.5, 0), spot('s_free2', 1.5, -1), spot('s_free3', -1.5, 5)];
  const npc = (id: string, at: string, chat?: string): NpcSpawn => {
    const s = spots.find((x) => x.id === at)!;
    return { id, look: 'crew', pos: new THREE.Vector3(s.pos.x, 0, s.pos.z), yaw: 0, spot: at, room: 'R02', ...(chat ? { chat } : {}) };
  };
  npcs.spawnFromLevel([npc('bar_1', 's_a', 'commons_bar'), npc('crew_2', 's_b', 'commons_bar'), npc('loner', 's_c')]);
  npcs.enableAmbientLife(spots);
  /** Async: a finished walk is reported through a promise, which only runs between updates if the loop yields. */
  const run = async (seconds: number, each?: () => void): Promise<void> => {
    for (let t = 0; t < seconds; t += 0.1) {
      npcs.update(0.1, null);
      await Promise.resolve();
      each?.();
    }
  };
  const at = (id: string): THREE.Vector3 => npcs.actor(id)!.position.clone();
  return { npcs, run, at };
}

test('a kept pair is still together at its places after five minutes, while others change places', async () => {
  const g = setup();
  g.npcs.keepInPlace(['commons_bar'], () => true);
  const home = [g.at('bar_1'), g.at('crew_2')];
  const loner = g.at('loner');
  let wandered = 0;
  await g.run(300, () => (wandered = Math.max(wandered, g.at('loner').distanceTo(loner))));
  for (const [i, id] of ['bar_1', 'crew_2'].entries()) assert.ok(g.at(id).distanceTo(home[i]!) < 0.2, `${id} stayed`);
  assert.ok(wandered > 1, 'ambient life still moves everyone else');
  assert.ok(g.npcs.chatGroup('commons_bar')?.free);
  assert.deepEqual(g.npcs.conversations('R02').map((c) => c.id), ['commons_bar']);
  assert.deepEqual(g.npcs.conversations('R03'), []);
});

test('once the hold ends the pair may wander again', async () => {
  const g = setup();
  let dropped = false;
  g.npcs.keepInPlace(['commons_bar'], () => !dropped);
  const home = g.at('bar_1');
  await g.run(60);
  assert.ok(g.at('bar_1').distanceTo(home) < 0.2);
  dropped = true;
  let moved = 0;
  await g.run(300, () => (moved = Math.max(moved, g.at('bar_1').distanceTo(home))));
  assert.ok(moved > 1);
});

test('a suspended pair says no filler of its own, keeps a real line going, and takes its turns up again', async () => {
  const g = setup();
  g.npcs.keepInPlace(['commons_bar'], () => true);
  await g.run(1);
  g.npcs.suspendChat('commons_bar', true);
  const speaking = (): number => ['bar_1', 'crew_2'].filter((id) => g.npcs.actor(id)!.body.speaking).length;
  let filler = 0;
  await g.run(20, () => (filler += speaking()));
  assert.equal(filler, 0, 'silent while held');

  g.npcs.actor('bar_1')!.body.speak('So? Maybe they packed their own.', 'question', 3, 'real');
  await g.run(1);
  assert.ok(g.npcs.actor('bar_1')!.body.speaking, 'the held group does not shut a real line');

  g.npcs.actor('bar_1')!.body.stopSpeaking();
  g.npcs.suspendChat('commons_bar', false);
  let again = 0;
  await g.run(20, () => (again += speaking()));
  assert.ok(again > 0);
});
