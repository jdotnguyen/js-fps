import * as THREE from 'three';
import { prepareBodyModel, type PreparedBodyModel } from '../bodyModel.ts';
import { castSpec } from '../castLooks.ts';
import { loadWithoutTextures } from '../castModelTestKit.ts';
import { prepareOptionsFor, validateBodyModelTable, type BodyModelLibrary } from '../bodyModelLibrary.ts';
import { readFileSync } from 'node:fs';
import { validate } from '../../core/validate.ts';
import { Humanoid, type FootstepEvent } from '../humanoid.ts';
import { ctx as enemyCtx } from '../../ai/enemyTestKit.ts';

/**
 * Test helpers for the blade creature (openspec rig-necromorph): its model loaded headless once per process, its bodies as
 * the scenes build them, and the measurements the tests share. Not a test file itself.
 */

/** The shipped model, or a candidate named by NECROMORPH_MODEL (a path from the repository root). */
export const NECROMORPH_URL = new URL(`../../../${process.env['NECROMORPH_MODEL'] ?? 'public/assets/models/infected/necromorph_slasher.glb'}`, import.meta.url);

/** The creature's entry in data/body-models.json. */
export const NECROMORPH_DEF = validate(validateBodyModelTable, JSON.parse(readFileSync(new URL('../../data/body-models.json', import.meta.url), 'utf8')), 'body-models.json')['necromorph']!;

let scene: Promise<THREE.Group> | null = null;
let prepared: Promise<PreparedBodyModel> | null = null;

/** The shipped model's scene, textures stripped (a fresh clone per call). */
export async function necromorphScene(): Promise<THREE.Group> {
  scene ??= loadWithoutTextures(NECROMORPH_URL);
  const { clone } = await import('three/examples/jsm/utils/SkeletonUtils.js');
  return clone(await scene) as THREE.Group;
}

/** The shipped model prepared as the game prepares it, once per process. */
export function necromorphModel(): Promise<PreparedBodyModel> {
  prepared ??= necromorphScene().then((s) => prepareBodyModel(s, prepareOptionsFor(NECROMORPH_DEF)));
  return prepared;
}

/** A body wearing `look` (`lab_creature`, `flood_elite`), as `NpcDirector` builds it. */
export async function creatureBody(look: string, pose = 'idle', opts: { onFootstep?: (step: FootstepEvent) => void } = {}): Promise<Humanoid> {
  const model = await necromorphModel();
  const spec = castSpec(look, `test-${look}`);
  return new Humanoid({ ...spec, role: 'npc', pose }, { ...enemyCtx(), bodyModels: creatureLib(model), ...(opts.onFootstep ? { onFootstep: opts.onFootstep } : {}) });
}

const FAR_CAMERA = new THREE.Vector3(0, 1.6, 1000);

/**
 * Step a body `frames` frames at 60 fps, optionally walking it straight along -Z at `speed` m/s. `near` puts the camera
 * beside it (foot IK and other near-only layers run only for a body near the camera).
 */
export function stepBody(h: Humanoid, frames: number, opts: { speed?: number; near?: boolean; each?: (i: number) => void } = {}): void {
  const dt = 1 / 60;
  const fwd = new THREE.Vector3(0, 0, -1);
  const cam = new THREE.Vector3();
  for (let i = 0; i < frames; i++) {
    if (opts.speed !== undefined) {
      h.group.position.addScaledVector(h.steer(fwd, dt, { maxSpeed: opts.speed, accel: 20 }), dt);
    }
    if (opts.near) cam.copy(h.group.position).add(new THREE.Vector3(0, 1.6, 3));
    h.update(dt, opts.near ? cam : FAR_CAMERA);
    opts.each?.(i);
  }
}

/** A body-model library holding only the creature; crowd spawns stay procedural. */
export function creatureLib(model: PreparedBodyModel): BodyModelLibrary {
  return { table: { necromorph: NECROMORPH_DEF }, get: (id: string) => (id === 'necromorph' ? model : undefined), pick: () => null } as unknown as BodyModelLibrary;
}

/** What one simulated fight came to (rig-necromorph task 1.2). */
export interface FightFigures {
  resolved: boolean;
  /** Seconds from the first shot to its death, or the time limit. */
  seconds: number;
  shots: number;
  hits: number;
  /** Shots fired up to its first severed limb, or null. */
  shotsToSever: number | null;
  /** Shots fired up to its death, or null. */
  shotsToKill: number | null;
  /** Damage it dealt to Jay and the squadmate. */
  dealt: number;
}

/**
 * A fight against the creature in a plain room, headless and seeded: R06 (the escaped `lab_creature`, 90 health, pistol)
 * or R11 (the hero tier, shotgun). Jay stands still and fires at a fixed rate, each shot aimed at a random point of the
 * creature's drawn skin, so the figures follow how well its hit shapes cover what is drawn.
 */
export async function simulateFight(fight: 'r06' | 'r11', seed: string, limit = 40): Promise<FightFigures> {
  const { EnemyDirector } = await import('../../ai/enemyDirector.ts');
  const { ctx, room, stubTarget, TABLE } = await import('../../ai/enemyTestKit.ts');
  const { EventBus } = await import('../../core/events.ts');
  const { Rng } = await import('../../core/rng.ts');
  const world = room();
  const events = new EventBus();
  const dir = new EnemyDirector({
    ctx: { ...ctx(), bodyModels: creatureLib(await necromorphModel()) },
    nav: world.nav,
    colliders: world.colliders,
    events,
    table: TABLE,
    difficulty: () => ({ enemyHp: 1, enemyLurchInterval: 1 }),
    seed,
  });
  const player = stubTarget('player', [0, 0, 0], { grabbable: false });
  const mate = stubTarget('medic', [1.2, 0, 0.5]);
  dir.addTarget(player);
  dir.addTarget(mate);
  const e =
    fight === 'r06'
      ? dir.spawn('shambler', { x: 0, y: 0, z: -7 }, 0, { look: 'lab_creature', hp: 90, id: 'r06_duct' })
      : dir.spawn('hero', { x: 0, y: 0, z: -8 }, 0, { id: 'hero' });
  const weapon = fight === 'r06' ? 'pistol' : 'shotgun';
  const every = fight === 'r06' ? 0.45 : 0.9;
  const rng = new Rng(`${seed}:aim`);
  const random = (): number => rng.next();
  const figures: FightFigures = { resolved: false, seconds: limit, shots: 0, hits: 0, shotsToSever: null, shotsToKill: null, dealt: 0 };
  events.on('enemy:hit', (h) => {
    if (h.id !== e.id) return;
    figures.hits++;
    if (h.severed && figures.shotsToSever === null) figures.shotsToSever = figures.shots;
  });
  const eye = new THREE.Vector3(0, 1.62, 0);
  const aim = new THREE.Vector3();
  const view = new THREE.Vector3();
  const dt = 1 / 60;
  let next = 1;
  for (let t = 0; t < limit + 1; t += dt) {
    dir.update(dt, null);
    if (!e.alive) {
      figures.resolved = true;
      figures.seconds = t - 1;
      figures.shotsToKill = figures.shots;
      break;
    }
    if (t < next) continue;
    next += every;
    randomSkinPoint(e.body, rng, aim);
    view.copy(aim).sub(eye).normalize();
    dir.playerShot(weapon, eye, view, 1, random);
    figures.shots++;
  }
  figures.dealt = [...player.hits, ...mate.hits].reduce((s, h) => s + h.amount, 0);
  return figures;
}

/** A random vertex of the body's drawn skin, world space. */
export function randomSkinPoint(h: Humanoid, rng: { next(): number }, out: THREE.Vector3): THREE.Vector3 {
  h.group.updateMatrixWorld(true);
  const meshes: THREE.SkinnedMesh[] = [];
  h.group.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh && m.visible) meshes.push(m);
  });
  const total = meshes.reduce((s, m) => s + m.geometry.getAttribute('position').count, 0);
  let k = Math.floor(rng.next() * total);
  for (const m of meshes) {
    const n = m.geometry.getAttribute('position').count;
    if (k < n) return m.localToWorld(m.getVertexPosition(k, out));
    k -= n;
  }
  return out.copy(h.group.position);
}

/** The lowest skinned vertex of the body's visible meshes, world y. */
export function lowestPoint(h: Humanoid): number {
  h.group.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  let min = Infinity;
  h.group.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || !m.visible) return;
    const pos = m.geometry.getAttribute('position');
    for (let k = 0; k < pos.count; k++) {
      m.getVertexPosition(k, v);
      m.localToWorld(v);
      if (v.y < min) min = v.y;
    }
  });
  return min;
}
