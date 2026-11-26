import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import posesJson from '../data/poses.json' with { type: 'json' };
import type { GoreSystem } from '../actors/gore.ts';
import { PoseLibrary } from '../actors/poses.ts';
import { loadPoseFile } from '../data/types/poses.ts';
import { demoRoomPlayerWorld } from '../world/demoRoomColliders.ts';
import { CookBrew } from './cookBrew.ts';
import { gridNodes, NavGraph } from './nav.ts';
import { NpcDirector } from './npcs.ts';

/** in-world-audio: Bram makes a brew, with the real director walking and posing him. */

const ctx = { poses: new PoseLibrary(loadPoseFile(posesJson)), gore: {} as GoreSystem };
const STATION = { pos: { x: -1.5, y: 0, z: 0 }, yaw: 0 };
const MACHINE = { pos: { x: 1.5, y: 0, z: -1 }, yaw: 0 };
/** How close (m) a finished walk leaves a body to its target. */
const ARRIVED = 0.3;

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
  npcs.setResolver((ref) => (ref === 'anchor:cook_stand' ? { pos: STATION.pos, yaw: STATION.yaw } : null));
  npcs.spawnFromLevel([{ id: 'cook', look: 'crew', pos: new THREE.Vector3(STATION.pos.x, 0, STATION.pos.z), yaw: 0, pose: 'idle', room: 'R02' }]);
  const sound = { playing: 0, stopped: 0 };
  const brew = new CookBrew(
    {
      cook: npcs.routineBody('cook'),
      introOver: () => true,
      over: () => false,
      playerFree: () => true,
      talking: () => false,
      sceneRunning: () => false,
      soundReady: () => true,
      playSound: () => {
        sound.playing++;
        return { setGain: () => {}, stop: () => void sound.stopped++ };
      },
    },
    STATION,
    MACHINE,
  );
  npcs.onScripted((npc) => brew.interrupt(npc));
  /** Async: a finished walk is reported through a promise, which only runs between updates if the loop yields. */
  const until = async (done: () => boolean, limit: number, what: string): Promise<void> => {
    for (let t = 0; !done(); t += 0.1) {
      assert.ok(t < limit, `${what} within ${limit} s`);
      npcs.update(0.1, null);
      await Promise.resolve();
      brew.update(0.1);
    }
  };
  const run = async (seconds: number): Promise<void> => {
    let t = 0;
    await until(() => (t += 0.1) > seconds, seconds + 1, 'run');
  };
  const cook = () => npcs.actor('cook')!;
  const from = (p: { x: number; z: number }): number => Math.hypot(cook().position.x - p.x, cook().position.z - p.z);
  return { npcs, brew, sound, until, run, cook, from };
}

test('Bram walks to the machine, works it, and comes back to stand idle facing as before', async () => {
  const g = setup();
  await g.until(() => g.brew.state === 'brewing', 75, 'he reaches the machine');
  assert.ok(g.from(MACHINE.pos) <= 0.6, `at the machine, ${g.from(MACHINE.pos).toFixed(2)} m off`);
  assert.equal(g.cook().body.idlePose, 'typing');
  assert.equal(g.sound.playing, 1);
  await g.until(() => g.brew.state === 'waiting', 30, 'he gets back');
  await g.run(2);
  assert.ok(g.from(STATION.pos) <= ARRIVED, `at his station, ${g.from(STATION.pos).toFixed(2)} m off`);
  assert.equal(g.cook().body.idlePose, 'idle');
  assert.ok(Math.abs(g.cook().body.heading - STATION.yaw) < 0.2, `faces as before, heading ${g.cook().body.heading.toFixed(2)}`);
  assert.equal(g.brew.atStation(), true);
});

test("the rounds' move to cook_stand mid-brew leaves him there, idle, with the sound stopped", async () => {
  const g = setup();
  await g.until(() => g.brew.state === 'brewing', 75, 'brewing');
  await g.run(1);
  await g.npcs.command('npcMoveTo', { npc: 'cook', to: 'anchor:cook_stand', instant: true });
  await g.npcs.command('npcAnim', { npc: 'cook', anim: 'idle', instant: true });
  assert.equal(g.sound.stopped, 1);
  assert.equal(g.brew.state, 'waiting');
  await g.run(90);
  assert.ok(g.from(STATION.pos) <= 0.1, 'still where the script put him');
  assert.equal(g.cook().body.idlePose, 'idle');
  assert.equal(g.sound.playing, 1);
});

test('a script moving him mid-walk wins over the brew', async () => {
  const g = setup();
  await g.until(() => g.brew.state === 'out', 75, 'on his way');
  await g.run(0.5);
  let arrived = false;
  void g.npcs.command('npcMoveTo', { npc: 'cook', to: 'anchor:cook_stand' }).then(() => (arrived = true));
  await g.until(() => arrived, 15, 'he walks where the script says');
  await g.run(30);
  assert.ok(g.from(STATION.pos) <= ARRIVED, `${g.from(STATION.pos).toFixed(2)} m off`);
  assert.equal(g.sound.playing, 0);
});

test("another NPC's command leaves the brew alone", async () => {
  const g = setup();
  await g.until(() => g.brew.state === 'out', 75, 'on his way');
  await g.npcs.command('npcLookAt', { npc: 'nobody', target: 'none' });
  assert.equal(g.brew.state, 'out');
});
