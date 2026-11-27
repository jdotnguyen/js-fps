/**
 * Test helpers for the enemy AI (not a test file itself): a plain room world, a stub gore system,
 * stub targets, a director factory, and a headless kit_test build (canvas stubs).
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import type { GoreSystem } from '../actors/gore.ts';
import { BoxColliders, type Aabb } from '../actors/motor.ts';
import { PoseLibrary } from '../actors/poses.ts';
import { EventBus } from '../core/events.ts';
import { validate } from '../core/validate.ts';
import { loadPoseFile } from '../data/types/poses.ts';
import type { AttackKind, EnemyTarget } from './enemy.ts';
import { validateEnemyTable, type EnemyTable } from './enemyData.ts';
import { EnemyDirector } from './enemyDirector.ts';
import { gridNodes, NavGraph } from './nav.ts';

const json = (rel: string): unknown => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));

export const TABLE: EnemyTable = validate(validateEnemyTable, json('../data/enemies.json'), 'enemies.json');

/** Gore needs a canvas; nothing in these tests looks at it. */
export const STUB_GORE = { mode: 'full', burst() {}, chunks() {}, pool() {}, spurt() {}, addDebris() {}, update() {}, clear() {} } as unknown as GoreSystem;

let poses: PoseLibrary | null = null;
export function ctx(): { poses: PoseLibrary; gore: GoreSystem } {
  poses ??= new PoseLibrary(loadPoseFile(json('../data/poses.json')));
  return { poses, gore: STUB_GORE };
}

/** A 20 x 20 m room (floor at y 0), with optional extra boxes (walls). */
export function room(extra: Aabb[] = []): { colliders: BoxColliders; nav: NavGraph } {
  const boxes: Aabb[] = [
    { min: [-10, -0.2, -10], max: [10, 0, 10] },
    { min: [-10.2, 0, -10.2], max: [10.2, 3, -10] },
    { min: [-10.2, 0, 10], max: [10.2, 3, 10.2] },
    { min: [-10.2, 0, -10], max: [-10, 3, 10] },
    { min: [10, 0, -10], max: [10.2, 3, 10] },
    ...extra,
  ];
  const colliders = new BoxColliders(boxes);
  const nav = new NavGraph({ world: colliders, nodes: gridNodes(colliders, { minX: -9, maxX: 9, minZ: -9, maxZ: 9, maxY: 0.4 }, 1.5) });
  return { colliders, nav };
}

export interface StubTarget extends EnemyTarget {
  pos: THREE.Vector3;
  hp: number;
  hits: Array<{ amount: number; kind: AttackKind; side?: 'L' | 'R' }>;
  knocked: Array<{ dx: number; dz: number; speed: number }>;
  grabbed: boolean;
  facing: THREE.Vector3;
  light: boolean;
  dead: boolean;
}

export function stubTarget(id = 'player', at: [number, number, number] = [0, 0, 0], opts: { grabbable?: boolean; kind?: 'player' | 'squad' } = {}): StubTarget {
  const t: StubTarget = {
    id,
    kind: opts.kind ?? (id === 'player' ? 'player' : 'squad'),
    pos: new THREE.Vector3(...at),
    hp: 100,
    hits: [],
    knocked: [],
    grabbed: false,
    facing: new THREE.Vector3(0, 0, -1),
    light: true,
    dead: false,
    feet: (out) => out.copy(t.pos),
    alive: () => !t.dead,
    weight: () => (t.kind === 'player' ? 1 : 0.6),
    hurt: (amount, _from, kind, side) => {
      t.hp -= amount;
      t.hits.push({ amount, kind, ...(side ? { side } : {}) });
    },
    knock: (dx, dz, speed) => {
      t.knocked.push({ dx, dz, speed });
    },
    lit: () => t.light,
    view: (out) => out.copy(t.facing),
  };
  if (opts.grabbable ?? t.kind === 'player') {
    t.grab = () => {
      if (t.grabbed) return false;
      t.grabbed = true;
      return true;
    };
    t.isGrabbed = () => t.grabbed;
    t.releaseGrab = () => {
      t.grabbed = false;
    };
  }
  return t;
}

export function director(world = room(), opts: { enemyHp?: number; seed?: string } = {}): { dir: EnemyDirector; events: EventBus; log: Array<[string, unknown]> } {
  const events = new EventBus();
  const log: Array<[string, unknown]> = [];
  for (const name of ['enemy:spawned', 'enemy:alerted', 'enemy:died', 'enemy:attack', 'enemy:grab', 'enemy:grabReleased', 'enemy:slam', 'enemy:landed', 'combat:first', 'group:cleared'] as const) {
    events.on(name, (p: unknown) => log.push([name, p]));
  }
  const dir = new EnemyDirector({
    ctx: ctx(),
    nav: world.nav,
    colliders: world.colliders,
    events,
    table: TABLE,
    difficulty: () => ({ enemyHp: opts.enemyHp ?? 1, enemyLurchInterval: 1 }),
    seed: opts.seed ?? 'test',
  });
  return { dir, events, log };
}

/** Step the director `seconds` at 60 Hz; stops early when `until` returns true. Returns seconds run. */
export function run(dir: EnemyDirector, seconds: number, until?: () => boolean, each?: () => void): number {
  const dt = 1 / 60;
  let t = 0;
  for (; t < seconds; t += dt) {
    each?.();
    dir.update(dt, null);
    if (until?.()) break;
  }
  return t;
}

/** Build kit_test headless: canvas and Path2D stubs, one plain material for everything. */
export async function kitTest(): Promise<{ level: import('../world/level.ts').Level; events: EventBus }> {
  const g = globalThis as Record<string, unknown>;
  g.Path2D ??= class {
    addPath(): void {}
    moveTo(): void {}
    lineTo(): void {}
    arc(): void {}
    rect(): void {}
    closePath(): void {}
  };
  g.document ??= {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () =>
        new Proxy(
          {},
          {
            get: (_t, k) =>
              k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern'
                ? () => ({ addColorStop() {} })
                : k === 'getImageData' || k === 'createImageData'
                  ? () => ({ data: new Uint8ClampedArray(4 * 512 * 512) })
                  : k === 'measureText'
                    ? () => ({ width: 10 })
                    : () => undefined,
            set: () => true,
          },
        ),
    }),
  };
  const { Level } = await import('../world/level.ts');
  const { KitRegistry, validateKitManifest } = await import('../world/registry.ts');
  const { levelValidator } = await import('../data/types/level.ts');
  const registry = new KitRegistry(validate(validateKitManifest, json('../data/kit-manifest.json'), 'kit-manifest'), undefined);
  const data = validate(levelValidator(registry.ids()), json('../data/levels/kit_test.json'), 'kit_test');
  const mat = new THREE.MeshStandardMaterial();
  const materials = new Proxy({}, { get: () => mat }) as never;
  const events = new EventBus();
  const level = new Level(data, { materials, registry, events, scene: new THREE.Scene() });
  return { level, events };
}
