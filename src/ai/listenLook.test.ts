import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { posesJson } from '../data/poseFiles.ts';
import type { GoreSystem } from '../actors/gore.ts';
import { PoseLibrary } from '../actors/poses.ts';
import { loadPoseFile } from '../data/types/poses.ts';
import { LISTEN_RANGE, NpcDirector } from './npcs.ts';

/** ADR-0029 listen-look: people near a story speaker turn their heads to them; the speaker looks at whoever they answer. */
const poses = new PoseLibrary(loadPoseFile(posesJson));

function setup(player = new THREE.Vector3(0, 0, 3), extra: Array<{ id: string; look: string; pos: { x: number; y: number; z: number }; yaw: number }> = []) {
  const npcs = new NpcDirector({
    ctx: { poses, gore: {} as GoreSystem },
    nav: null,
    colliders: null,
    player: () => ({ feet: player.clone(), head: player.clone().setY(1.62) }),
  });
  npcs.spawnFromLevel([
    { id: 'bram', look: 'crew', pos: { x: 0, y: 0, z: 0 }, yaw: 0 },
    { id: 'ana', look: 'crew', pos: { x: 1.2, y: 0, z: 0 }, yaw: 0 },
    { id: 'far', look: 'crew', pos: { x: LISTEN_RANGE + 3, y: 0, z: 0 }, yaw: 0 },
    ...extra,
  ]);
  const step = (s: number): void => {
    for (let t = 0; t < s; t += 1 / 30) npcs.update(1 / 30, null);
  };
  const looking = (id: string): THREE.Vector3 | null => npcs.actor(id, false)!.body.lookTarget;
  return { npcs, step, looking, player };
}

test('listeners in range look at the speaker; someone across the room does not', () => {
  const { npcs, step, looking } = setup();
  step(0.2);
  npcs.lineStarted('bram');
  step(0.2);
  const head = npcs.head('bram')!;
  const ana = looking('ana');
  assert.ok(ana && ana.distanceTo(head) < 1e-6, 'ana looks at bram');
  assert.notDeepEqual(looking('far')?.toArray(), head.toArray(), 'far keeps to himself');
});

test('the speaker looks at the person they answer, or at Jay when he is close', () => {
  const { npcs, step, looking, player } = setup();
  npcs.lineStarted('bram');
  step(0.1);
  const bramAtJay = looking('bram');
  assert.ok(bramAtJay && Math.abs(bramAtJay.x - player.x) < 1e-6 && Math.abs(bramAtJay.z - player.z) < 1e-6, 'first line: bram talks to Jay');
  npcs.lineEnded('bram');
  npcs.lineStarted('ana');
  step(0.1);
  const anaAt = looking('ana');
  assert.ok(anaAt && anaAt.distanceTo(npcs.head('bram')!) < 1e-6, 'ana answers bram, so she looks at him');
  npcs.lineStarted('player');
  step(0.1);
  const bram = looking('bram');
  assert.ok(bram && Math.abs(bram.x - player.x) < 1e-6, 'Jay speaks: bram looks at him');
});

test('looks linger a beat after the line, then let go; the PA ending does not cut a line short', () => {
  const { npcs, step, looking } = setup();
  npcs.lineStarted('bram');
  step(0.1);
  npcs.lineEnded('pa');
  step(2);
  assert.ok(looking('ana'), 'still listening: only the PA stopped');
  npcs.lineEnded('bram');
  step(0.5);
  assert.ok(looking('ana'), 'lingers for a moment');
  step(1.5);
  const head = npcs.head('bram')!;
  const ana = looking('ana');
  assert.ok(!ana || ana.distanceTo(head) > 1e-3, 'then lets go');
});

test('explicit addressee overrides lastTalker for both NPC and player targets while listeners still watch the speaker', () => {
  const { npcs, step, looking, player } = setup(new THREE.Vector3(0, 0, 3), [
    { id: 'carl', look: 'crew', pos: { x: -1.2, y: 0, z: 0 }, yaw: 0 },
  ]);

  // Bram talks, then Carl explicitly addresses the player instead of staring at Bram.
  npcs.lineStarted('bram');
  step(0.1);
  npcs.lineStarted('carl', 'player');
  step(0.1);
  const carlAtJay = looking('carl');
  assert.ok(carlAtJay && Math.abs(carlAtJay.x - player.x) < 1e-6 && Math.abs(carlAtJay.z - player.z) < 1e-6, 'carl addresses player, not lastTalker bram');
  const anaAtCarl = looking('ana');
  assert.ok(anaAtCarl && anaAtCarl.distanceTo(npcs.head('carl')!) < 0.05, 'nearby listener ana still watches active speaker carl');

  // Player talks, then Bram explicitly addresses Ana instead of staring at the player.
  npcs.lineStarted('player');
  step(0.1);
  npcs.lineStarted('bram', 'ana');
  step(0.1);
  const bramAtAna = looking('bram');
  assert.ok(bramAtAna && bramAtAna.distanceTo(npcs.head('ana')!) < 0.05, 'bram addresses ana, not lastTalker player');
  const carlAtBram = looking('carl');
  assert.ok(carlAtBram && carlAtBram.distanceTo(npcs.head('bram')!) < 0.05, 'nearby listener carl watches active speaker bram');
});
