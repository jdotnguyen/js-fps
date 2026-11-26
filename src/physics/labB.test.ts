import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import type { GoreSystem } from '../actors/gore.ts';
import { PoseLibrary } from '../actors/poses.ts';
import { NpcDirector } from '../ai/npcs.ts';
import { validate } from '../core/validate.ts';
import { validateKillTable } from '../data/types/kills.ts';
import { loadPoseFile } from '../data/types/poses.ts';
import { loadSlice01 } from '../world/headlessSlice.ts';
import { impactSound } from '../audio/impacts.ts';
import { PhysicsProps, type PropImpact } from './interaction.ts';
import { createRapierEngine } from './rapierAdapter.ts';
import { PhysicsWorld } from './world.ts';

// physical-interaction spec, tasks 6.5, 6.8 and 6.9: the real Lab B, with the real Voss kill walking through it.
const STEP = 1 / 60;
/** Lab B's side face of the gallery glass (z), and its floor. */
const GLASS_Z = 22;
const json = (p: string): unknown => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));

/** `interact` off is a session with no `PhysicsProps`, so the kill has nothing to knock with. */
async function labB(interact = true) {
  const { level, events } = loadSlice01();
  const world = await PhysicsWorld.create(createRapierEngine, level.collision);
  /** Every impact loud enough to be heard. */
  const heard: PropImpact[] = [];
  const props = interact ? new PhysicsProps(world, level, (i) => void (impactSound(i.material, i.speed) && heard.push(i))) : null;
  const loose = level.physicsProps().filter((p) => p.loose);
  const noop = (): void => undefined;
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  const emit = (name: string, payload: unknown): void => void [...(handlers.get(name) ?? [])].forEach((fn) => fn(payload));
  const npcs = new NpcDirector({
    ctx: { poses: new PoseLibrary(loadPoseFile(json('poses.json'))), gore: new Proxy({}, { get: () => noop }) as unknown as GoreSystem },
    nav: level.navGraph(),
    colliders: level.collision,
    player: () => ({ feet: new THREE.Vector3(8, 0, 18), head: new THREE.Vector3(8, 1.62, 18) }),
    emit,
    listen: (name, fn) => {
      const set = handlers.get(name) ?? new Set();
      handlers.set(name, set);
      set.add(fn);
      return () => set.delete(fn);
    },
    sfx: () => true,
    warn: noop,
    knock: (from, travel, reach, strength, done) => void props?.knock(from, travel, reach, strength, done),
    kills: validate(validateKillTable, json('kills.json'), 'kills'),
  });
  npcs.setResolver((ref) => {
    const a = level.anchor(String(ref).replace('anchor:', ''));
    return a ? { pos: a.pos, yaw: a.yaw } : null;
  });
  npcs.spawnFromLevel(level.npcSpawns().filter((n) => n.id === 'researcher_b'));
  const camera = new THREE.Vector3(8, 1.62, 18);
  const run = (seconds: number, each?: (t: number) => void): void => {
    for (let i = 0; i < Math.round(seconds / STEP); i++) {
      each?.(i * STEP);
      npcs.update(STEP, camera);
      world.step(STEP);
      props?.sync();
    }
  };
  const poses = (): Map<string, { pos: THREE.Vector3; quat: THREE.Quaternion }> =>
    new Map(level.physicsProps().filter((p) => p.loose).map((p) => [p.id, { pos: p.object.position.clone(), quat: p.object.quaternion.clone() }]));
  const kill = (instant: boolean): void => {
    void npcs.command('kill', { npc: 'researcher_b', kind: 'grownInside', glass: 'anchor:labb_glass', lines: { scratch: 'drop_voss_01', glass: 'drop_voss_02' }, instant });
  };
  return { level, events, world, props: props!, heard, loose, npcs, run, poses, kill, say: (id: string) => emit('speech:ended', { id }) };
}

test('Lab B: the cart and its load are loose props that movement ignores, and they rest where the level put them', async () => {
  const g = await labB();
  const ids = g.loose.map((p) => p.id);
  assert.ok(ids.includes('labb_cart') && ids.length >= 8, `a cart and its load (${ids.length})`);
  for (const p of g.loose) assert.equal(p.colliders.length, 0, `${p.id} is no obstacle to motors or the navmesh`);
  const placed = g.poses();
  g.run(5);
  for (const [id, now] of g.poses()) {
    const was = placed.get(id)!;
    assert.ok(now.pos.distanceTo(was.pos) < 0.02, `${id} stayed put (${(now.pos.distanceTo(was.pos) * 100).toFixed(1)} cm)`);
    assert.ok(now.quat.angleTo(was.quat) < 0.05, `${id} stayed upright`);
  }
  g.world.destroy();
});

test('the Voss kill crashes through the cart: it topples, its load scatters inside the room, and she reaches the glass', async () => {
  const g = await labB();
  g.run(1);
  const before = g.poses();
  g.kill(false);
  g.run(2.5);
  for (const [id, now] of g.poses()) assert.ok(now.pos.distanceTo(before.get(id)!.pos) < 0.02, `${id} is untouched while she scratches`);
  g.say('drop_voss_01');
  g.run(10);
  const after = g.poses();
  const moved = [...after].filter(([id, now]) => now.pos.distanceTo(before.get(id)!.pos) > 0.15).map(([id]) => id);
  const cart = after.get('labb_cart')!;
  assert.ok(moved.includes('labb_cart'), 'the cart is shoved');
  assert.ok(cart.quat.angleTo(before.get('labb_cart')!.quat) > 0.8, `and goes over (${cart.quat.angleTo(before.get('labb_cart')!.quat).toFixed(2)} rad)`);
  assert.ok(moved.length >= 6, `most of the load is thrown (${moved.join(', ')})`);
  for (const [id, now] of after) {
    assert.ok(now.pos.y > -0.05, `${id} is not through the floor (${now.pos.y.toFixed(2)})`);
    assert.ok(now.pos.z > GLASS_Z && now.pos.x > 2 && now.pos.x < 14 && now.pos.z < 30, `${id} stays in Lab B (${now.pos.x.toFixed(2)}, ${now.pos.z.toFixed(2)})`);
  }
  const voss = g.npcs.actor('researcher_b')!;
  assert.ok(Math.hypot(voss.position.x - 8, voss.position.z - 22.5) < 0.3, `she is at the glass (${voss.position.x.toFixed(2)}, ${voss.position.z.toFixed(2)})`);
  g.world.destroy();
});

test('a restored kill moves nothing, and a restart stands the knocked objects up again', async () => {
  const g = await labB();
  g.run(1);
  const before = g.poses();
  g.kill(true);
  g.run(3);
  assert.equal(g.heard.length, 0, 'a restored kill is silent');
  for (const [id, now] of g.poses()) assert.ok(now.pos.distanceTo(before.get(id)!.pos) < 0.02, `${id} untouched by a restored kill`);

  const done = new Set<string>();
  assert.ok(g.props.knock({ x: 7.3, y: 0, z: 23.7 }, { x: 0.5, y: 0, z: -0.87 }, 0.9, 1, done) >= 8, 'the sweep reaches the cart and its load');
  assert.equal(g.props.knock({ x: 7.3, y: 0, z: 23.7 }, { x: 0.5, y: 0, z: -0.87 }, 0.9, 1, done), 0, 'and hits each thing once');
  g.run(2);
  const reset = g.world.reset();
  g.events.emit('level:reset', {});
  await reset;
  g.run(2);
  for (const [id, now] of g.poses()) {
    assert.ok(now.pos.distanceTo(before.get(id)!.pos) < 0.02, `${id} is back`);
    assert.ok(now.quat.angleTo(before.get(id)!.quat) < 0.05, `${id} is upright again`);
  }
  g.world.destroy();
});

test('the crash is heard: nothing while the room settles, the cart crashes and glass sounds as she goes through', async () => {
  const g = await labB();
  for (const p of g.loose) assert.ok(p.sound, `${p.id} has a sound`);
  g.run(5);
  assert.equal(g.heard.length, 0, 'a settling room is silent');
  g.kill(false);
  g.run(2.5);
  g.say('drop_voss_01');
  g.run(10);
  const sounds = g.heard.map((i) => impactSound(i.material, i.speed)!.sound);
  assert.ok(sounds.includes('propCartCrash'), `the cart crashes (${sounds.join(', ')})`);
  assert.ok(sounds.some((s) => s.startsWith('propGlass')), 'glassware is heard');
  for (const i of g.heard) assert.ok(i.speed < 12, `${i.id} at a believable speed (${i.speed.toFixed(1)})`);
  const count = g.heard.length;
  g.run(5);
  assert.equal(g.heard.length, count, 'and it falls quiet');
  const reset = g.world.reset();
  g.events.emit('level:reset', {});
  await reset;
  g.run(3);
  assert.equal(g.heard.length, count, 'standing the objects up again is silent');
  g.world.destroy();
});

test('with physical interaction off the kill leaves every object standing', async () => {
  const g = await labB(false);
  const before = g.poses();
  g.kill(false);
  g.run(2.5);
  g.say('drop_voss_01');
  g.run(6);
  assert.ok(g.npcs.actor('researcher_b')!.position.z < 23, 'she walked to the glass');
  for (const [id, now] of g.poses()) assert.ok(now.pos.equals(before.get(id)!.pos), `${id} never moved`);
  g.world.destroy();
});
