/**
 * Test helper (not a test file): the real Lab B kill (`kills.json` `grownInside`) on Voss's imported body, in the headless
 * slice01, so a test can sample her body against the room's furniture (voss-death-scene §4). The kill starts with the drop's
 * own step; `ask()` ends Okafor's question, which starts the fixed clock.
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import type { GoreSystem } from '../actors/gore.ts';
import type { FootstepEvent, Humanoid } from '../actors/humanoid.ts';
import { PoseLibrary } from '../actors/poses.ts';
import { JOINT_NAMES, type JointName } from '../actors/skeleton.ts';
import { sharedMocapLibrary, type RawMocapFile } from '../actors/mocap.ts';
import { loadMainCast } from '../actors/castModelTestKit.ts';
import { NECROMORPH_DEF, necromorphModel } from '../actors/blade/bladeTestKit.ts';
import type { BodyModelLibrary } from '../actors/bodyModelLibrary.ts';
import { validate } from '../core/validate.ts';
import { validateKillTable } from '../data/types/kills.ts';
import { loadPoseFile } from '../data/types/poses.ts';
import { loadSlice01 } from '../world/headlessSlice.ts';
import { NpcDirector } from './npcs.ts';

const json = (p: string): unknown => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));

/** The drop's kill step (`drop.json`), and Okafor's question that ends the wait. */
export const LAB_B_KILL = { npc: 'researcher_b', kind: 'grownInside', glass: 'anchor:labb_glass', lines: { scratch: 'drop_okafor_01', glass: 'drop_voss_02' } } as const;

/** An axis-aligned box (a collider), or the cart's turned box. */
export interface Solid {
  id: string;
  /** World to the box's own frame, and its half sizes there (centred on its middle). */
  inv: THREE.Matrix4;
  half: THREE.Vector3;
  /** Top surface height (m). */
  top: number;
}

/** One of her hit capsules in the world: a segment with a radius. */
export interface WorldCapsule {
  joint: JointName;
  a: THREE.Vector3;
  b: THREE.Vector3;
  r: number;
}

const tmp = new THREE.Vector3();

/** How far (m) a capsule sinks into a solid: its radius less its segment's nearest distance to the box (0 when clear). */
export function sinkInto(c: WorldCapsule, s: Solid): number {
  let worst = 0;
  for (let i = 0; i <= 8; i++) {
    tmp.lerpVectors(c.a, c.b, i / 8).applyMatrix4(s.inv);
    const dx = Math.max(Math.abs(tmp.x) - s.half.x, 0);
    const dy = Math.max(Math.abs(tmp.y) - s.half.y, 0);
    const dz = Math.max(Math.abs(tmp.z) - s.half.z, 0);
    const out = Math.hypot(dx, dy, dz);
    // Inside the box: as deep as its nearest face, plus the radius.
    const inside = out === 0 ? Math.min(s.half.x - Math.abs(tmp.x), s.half.y - Math.abs(tmp.y), s.half.z - Math.abs(tmp.z)) : 0;
    worst = Math.max(worst, out === 0 ? c.r + inside : c.r - out);
  }
  return worst;
}

/** A capsule's surface distance to a solid (m): its segment's nearest distance less its radius, negative when it sinks in. */
export function clearance(c: WorldCapsule, s: Solid): number {
  return -sinkInto(c, s) || outside(c, s);
}

function outside(c: WorldCapsule, s: Solid): number {
  let best = Infinity;
  for (let i = 0; i <= 8; i++) {
    tmp.lerpVectors(c.a, c.b, i / 8).applyMatrix4(s.inv);
    best = Math.min(best, Math.hypot(Math.max(Math.abs(tmp.x) - s.half.x, 0), Math.max(Math.abs(tmp.y) - s.half.y, 0), Math.max(Math.abs(tmp.z) - s.half.z, 0)) - c.r);
  }
  return best;
}

/** Her body's hit capsules, placed in the world this frame. */
export function worldCapsules(body: Humanoid): WorldCapsule[] {
  const caps = (body as unknown as { capsules: Array<{ joint: JointName; bone: THREE.Bone; a: THREE.Vector3; b: THREE.Vector3; r: number }> }).capsules;
  const scale = new THREE.Vector3();
  return caps.map((c) => {
    const m = c.bone.matrixWorld;
    scale.setFromMatrixColumn(m, 0);
    return { joint: c.joint, a: c.a.clone().applyMatrix4(m), b: c.b.clone().applyMatrix4(m), r: c.r * scale.length() };
  });
}

/** Every joint of the body in the world. */
export function joints(body: Humanoid): Map<JointName, THREE.Vector3> {
  return new Map(JOINT_NAMES.map((j) => [j, body.jointWorld(j, new THREE.Vector3())]));
}

export async function labBKill(opts: { fps?: number; creature?: boolean } = {}) {
  const fps = opts.fps ?? 60;
  sharedMocapLibrary().addPack('voss', json('mocap/voss.json') as RawMocapFile);
  sharedMocapLibrary().retainPack('voss');
  const models: Record<string, Awaited<ReturnType<typeof loadMainCast>>> = { office3: await loadMainCast('office_3') };
  if (opts.creature) models['necromorph'] = await necromorphModel();
  const { level } = loadSlice01();
  const noop = (): void => undefined;
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  const emitted: Array<{ name: string; at: number; payload: unknown }> = [];
  const sounds: Array<{ ids: readonly string[]; at: number }> = [];
  const steps: Array<FootstepEvent & { at: number }> = [];
  const warnings: string[] = [];
  let now = 0;
  const emit = (name: string, payload: unknown): void => {
    emitted.push({ name, at: now, payload });
    for (const fn of [...(handlers.get(name) ?? [])]) fn(payload);
  };
  const npcs = new NpcDirector({
    ctx: {
      poses: new PoseLibrary(loadPoseFile(json('poses.json'))),
      gore: new Proxy({}, { get: () => noop }) as unknown as GoreSystem,
      // Voss's imported body, and (with `creature`) the blade creature that comes out of her.
      bodyModels: { table: opts.creature ? { necromorph: NECROMORPH_DEF } : {}, get: (id: string) => models[id], pick: () => null } as unknown as BodyModelLibrary,
      onFootstep: (s) => void steps.push({ ...s, at: now }),
    },
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
    sfx: (ids) => {
      sounds.push({ ids, at: now });
      return true;
    },
    warn: (m) => warnings.push(m),
    kills: validate(validateKillTable, json('kills.json'), 'kills'),
  });
  npcs.setResolver((ref) => {
    const a = level.anchor(String(ref).replace('anchor:', ''));
    return a ? { pos: a.pos, yaw: a.yaw } : null;
  });
  npcs.spawnFromLevel(level.npcSpawns().filter((n) => n.id === 'researcher_b'));
  const voss = npcs.actor('researcher_b')!;
  const camera = new THREE.Vector3(8, 1.62, 19.6);
  const run = (seconds: number, each?: () => void): void => {
    for (let i = 0; i < Math.round(seconds * fps); i++) {
      now += 1 / fps;
      npcs.update(1 / fps, camera);
      each?.();
    }
  };
  const start = (instant = false): void => void npcs.command('kill', { ...LAB_B_KILL, ...(instant ? { instant: true } : {}) });
  const ask = (): void => emit('speech:ended', { id: LAB_B_KILL.lines.scratch });
  const beatAt = (b: string): number => emitted.find((e) => e.name === `kill:${b}`)?.at ?? -1;

  // Lab B's furniture as solids: its static colliders by where they stand, and the cart (this kit never moves it) as its
  // turned box.
  const box = (id: string, near: [number, number]): Solid => {
    const c = level.collision.find(near[0] - 0.05, near[1] - 0.05, near[0] + 0.05, near[1] + 0.05).filter((k) => k.maxY > 0.5 && k.maxY < 1.5 && k.enabled !== false)[0];
    if (!c) throw new Error(`no collider at ${near.join(', ')}`);
    const mid = new THREE.Vector3((c.minX + c.maxX) / 2, (c.minY + c.maxY) / 2, (c.minZ + c.maxZ) / 2);
    return { id, inv: new THREE.Matrix4().makeTranslation(-mid.x, -mid.y, -mid.z), half: new THREE.Vector3((c.maxX - c.minX) / 2, (c.maxY - c.minY) / 2, (c.maxZ - c.minZ) / 2), top: c.maxY };
  };
  const cartProp = level.physicsProps().find((p) => p.id === 'labb_cart')!;
  const cartSolid = (): Solid => {
    const o = cartProp.object;
    o.updateMatrixWorld(true);
    // PREP_CART: 0.9 x 0.5 m, its top 0.9 m up (the handles stand 3 cm above it).
    const m = new THREE.Matrix4().compose(o.getWorldPosition(new THREE.Vector3()).setY(0.465), o.getWorldQuaternion(new THREE.Quaternion()), new THREE.Vector3(1, 1, 1));
    return { id: 'cart', inv: m.invert(), half: new THREE.Vector3(0.45, 0.465, 0.25), top: 0.93 };
  };
  /** The pane she pounds on: its plane (z), the side she is on facing +z. */
  const glassZ = level.anchor('labb_glass')!.pos.z + 0.06;
  // The partition's frame on her side (structure.ts glassPartition): a 0.35 m sill and the mullions, 0.1 m proud of the
  // glass. The gallery's south wall runs x 2-14, one 4 m tile per cell.
  const aabb = (id: string, min: [number, number, number], max: [number, number, number]): Solid => {
    const mid = new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    return { id, inv: new THREE.Matrix4().makeTranslation(-mid.x, -mid.y, -mid.z), half: new THREE.Vector3((max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2), top: max[1] };
  };
  const frame: Solid[] = [aabb('sill', [2, 0, glassZ - 0.11], [14, 0.35, glassZ + 0.09])];
  for (const cell of [4, 8, 12]) for (const dx of [-1.95, -0.65, 0.65, 1.95]) frame.push(aabb('mullion', [cell + dx - 0.05, 0.35, glassZ - 0.12], [cell + dx + 0.05, 2.6, glassZ + 0.1]));
  /** The cart's near handle (the rail at its south-west end, 3 cm over its top), where her hand takes hold. */
  const cartHandle = (): Solid => {
    const o = cartProp.object;
    o.updateMatrixWorld(true);
    const q = o.getWorldQuaternion(new THREE.Quaternion());
    const at = new THREE.Vector3(-0.425, 0, 0).applyQuaternion(q).add(o.getWorldPosition(new THREE.Vector3())).setY(0.93);
    return { id: 'cartHandle', inv: new THREE.Matrix4().compose(at, q, new THREE.Vector3(1, 1, 1)).invert(), half: new THREE.Vector3(0.01, 0.01, 0.22), top: 0.94 };
  };
  const furniture = (): Solid[] => [box('bench', [5.5, 26.8]), box('gurney', [8, 25.2]), box('chair', [7.4, 27.2]), cartSolid(), ...frame];
  const anchor = (id: string): THREE.Vector3 => level.anchor(id)!.pos.clone();
  const creature = (): ReturnType<typeof npcs.actor> => npcs.actor('researcher_b_creature', false);
  return { level, npcs, voss, run, start, ask, beatAt, emitted, sounds, steps, warnings, furniture, cartHandle, glassZ, anchor, creature, time: () => now };
}
