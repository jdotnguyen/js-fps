/**
 * Test helper (not a test file): the real Lab B with the real Voss kill (`kills.json` `grownInside`), its props wired the
 * way `session.ts` wires them (voss-death-scene §5): the sweep and the cart's load thrown by physics, the cart driven on
 * its scripted tip, the `after` groups laid out. `physics: false` is a session with every physics feature off: no
 * physics world at all.
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import type { GoreSystem } from '../actors/gore.ts';
import { PoseLibrary } from '../actors/poses.ts';
import { sharedMocapLibrary, type RawMocapFile } from '../actors/mocap.ts';
import { impactSound } from '../audio/impacts.ts';
import { NpcDirector } from '../ai/npcs.ts';
import { validate } from '../core/validate.ts';
import { validateKillTable } from '../data/types/kills.ts';
import { loadPoseFile } from '../data/types/poses.ts';
import { readLevel } from '../data/levels/readLevel.ts';
import { loadSlice01 } from '../world/headlessSlice.ts';
import { PhysicsProps, type PropImpact } from './interaction.ts';
import { createRapierEngine } from './rapierAdapter.ts';
import { PhysicsWorld } from './world.ts';

export const STEP = 1 / 60;
const json = (p: string): unknown => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));

export interface Pose {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
}

export async function labBProps(opts: { physics?: boolean; fps?: number } = {}) {
  const physics = opts.physics ?? true;
  // Her takes, as the game streams them (labBKillTestKit.ts does the same).
  sharedMocapLibrary().addPack('voss', json('mocap/voss.json') as RawMocapFile);
  sharedMocapLibrary().retainPack('voss');
  const dt = 1 / (opts.fps ?? 60);
  const { level, events } = loadSlice01();
  const world = physics ? await PhysicsWorld.create(createRapierEngine, level.collision) : null;
  /** Every impact loud enough to be heard, with the time it was heard. */
  const heard: Array<PropImpact & { at: number }> = [];
  let now = 0;
  const props = world ? new PhysicsProps(world, level, (i) => void (impactSound(i.material, i.speed) && heard.push({ ...i, at: now }))) : null;
  /** What a sweep or tip threw (its impacts are ducked in the game), with the time. */
  const ducked: Array<{ id: string; at: number }> = [];
  const all = level.physicsProps().filter((p) => p.id.startsWith('labb_'));
  const loose = all.filter((p) => p.loose);
  const noop = (): void => undefined;
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  const emitted: Array<{ name: string; at: number }> = [];
  const emit = (name: string, payload: unknown): void => {
    emitted.push({ name, at: now });
    for (const fn of [...(handlers.get(name) ?? [])]) fn(payload);
  };
  const npcs = new NpcDirector({
    ctx: { poses: new PoseLibrary(loadPoseFile(json('poses.json'))), gore: new Proxy({}, { get: () => noop }) as unknown as GoreSystem },
    nav: level.navGraph(),
    colliders: level.collision,
    player: () => ({ feet: new THREE.Vector3(8, 0, 19.6), head: new THREE.Vector3(8, 1.62, 19.6) }),
    emit,
    listen: (name, fn) => {
      const set = handlers.get(name) ?? new Set();
      handlers.set(name, set);
      set.add(fn);
      return () => set.delete(fn);
    },
    sfx: () => true,
    warn: noop,
    kills: validate(validateKillTable, json('kills.json'), 'kills'),
    // As session.ts.
    knock: (from, travel, reach, strength, done) => void props?.knock(from, travel, reach, strength, done),
    burst: (at, reach, strength, o) => {
      if (!props) return false;
      const { duck, ...rest } = o;
      const out: string[] = [];
      props.burst(at, reach, strength, { ...rest, out });
      if (duck) for (const id of out) ducked.push({ id, at: now });
      return true;
    },
    propPose: (id) => level.propPose(id),
    afterPose: (id) => level.afterPose(id),
    moveProp: (id, pos, rotation) => {
      level.setPropPose(id, pos, rotation);
      props?.drive(id, pos, rotation);
    },
    layOut: (group) => {
      for (const a of level.layOut(group)) props?.place(a.id, a.pos, a.rotation);
    },
  });
  npcs.setResolver((ref) => {
    const a = level.anchor(String(ref).replace('anchor:', ''));
    return a ? { pos: a.pos, yaw: a.yaw } : null;
  });
  npcs.spawnFromLevel(level.npcSpawns().filter((n) => n.id === 'researcher_b'));
  const camera = new THREE.Vector3(8, 1.62, 19.6);
  const run = (seconds: number, each?: (t: number) => void): void => {
    for (let i = 0; i < Math.round(seconds / dt); i++) {
      now += dt;
      npcs.update(dt, camera);
      world?.step(dt);
      props?.sync(dt);
      each?.(now);
    }
  };
  const poses = (): Map<string, Pose> => new Map(all.map((p) => [p.id, { pos: p.object.position.clone(), quat: p.object.quaternion.clone() }]));
  const kill = (instant = false): void => {
    void npcs.command('kill', { npc: 'researcher_b', kind: 'grownInside', glass: 'anchor:labb_glass', lines: { scratch: 'drop_okafor_01', glass: 'drop_voss_02' }, ...(instant ? { instant: true } : {}) });
  };
  /** Okafor's question ends: the fixed clock starts. */
  const ask = (): void => emit('speech:ended', { id: 'drop_okafor_01' });
  /** A full restart before the kill, as the session does it. */
  const restart = async (): Promise<void> => {
    const reset = world?.reset();
    events.emit('level:reset', {});
    await reset;
  };
  return { level, world, props, heard, ducked, all, loose, npcs, run, poses, kill, ask, restart, emitted, time: () => now, dt };
}

/** The `after` groups the kill lays out. */
export const GROUPS = { bench: 'labb_bench', cart: 'labb_cart', load: 'labb_cart_load' } as const;

/** The ids in an `after` group, and each one's pose there, read from the level data. */
export function afterGroup(name: string): Map<string, Pose> {
  const data = readLevel('slice01') as { rooms: Array<{ props?: Array<{ params?: { id?: unknown }; after?: { group: string; pos: number[]; quat?: number[] } }> }> };
  const out = new Map<string, Pose>();
  for (const r of data.rooms) for (const p of r.props ?? []) {
    if (p.after?.group !== name || typeof p.params?.id !== 'string') continue;
    const q = p.after.quat ?? [0, 0, 0, 1];
    out.set(p.params.id, { pos: new THREE.Vector3(...(p.after.pos as [number, number, number])), quat: new THREE.Quaternion(q[0], q[1], q[2], q[3]).normalize() });
  }
  return out;
}
