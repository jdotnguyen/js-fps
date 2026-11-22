/**
 * One physics world per level (adopt-physics-engine Block 1; design D3, D8; spec physics-world).
 *
 * - Mirrors the level's player collision (`CollisionWorld`) as fixed cuboids, so bodies collide with exactly what
 *   the player does. `CollisionWorld` stays authoritative; physics never writes back to it.
 * - Every step it re-reads each mirrored collider's `enabled` flag (doors toggle theirs) and mirrors colliders
 *   added since, instead of hooking door code: one source of truth, a few hundred boolean reads per step.
 * - Stepped by the caller once per fixed simulation step, only while the game is in play, so a pause freezes it.
 * - `reset()` destroys the engine and rebuilds it from the mirror (level and checkpoint restarts), so nothing
 *   leaks across restarts.
 */
import type { ColliderHandle, Contact, PhysicsEngine, PhysicsEngineFactory } from './engine.ts';

/** The part of `CollisionWorld` the mirror reads. */
export interface MirrorSource {
  readonly colliders: ReadonlyArray<{
    readonly id: number;
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
    readonly enabled: boolean;
    /** Footstep surface (`ColliderSurface`); picks the friction pieces slide with. */
    readonly surface?: string | null;
    /** 'glass' for panes. */
    readonly acoustic?: string;
  }>;
}

interface Mirrored {
  index: number;
  handle: ColliderHandle;
  enabled: boolean;
}

/** How far past a re-enabled collider's face an overlapping body is moved (metres). */
const PUSH_OUT_MARGIN = 0.25;

/** Rolling step-time statistics over the last `STAT_WINDOW` steps. */
export interface StepStats {
  avgMs: number;
  peakMs: number;
  steps: number;
}
const STAT_WINDOW = 120;

/**
 * Level friction by surface (Block 2 task 3.5, recorded in docs/physics.md). Rapier averages the two colliders'
 * values, so with debris at 0.7 a limb grips concrete and rubber, skids a little on bare metal, catches on grating,
 * slides on wet floors and glass.
 */
export const SURFACE_FRICTION: Readonly<Record<string, number>> = { concrete: 0.8, metal: 0.45, grate: 0.95, rubber: 1, water: 0.2 };
export const GLASS_FRICTION = 0.25;
const DEFAULT_FRICTION = 0.8;

export function frictionOf(c: { surface?: string | null; acoustic?: string }): number {
  if (c.acoustic === 'glass') return GLASS_FRICTION;
  return (c.surface ? SURFACE_FRICTION[c.surface] : undefined) ?? DEFAULT_FRICTION;
}
const EPS = 1e-4;

export class PhysicsWorld {
  private readonly factory: PhysicsEngineFactory;
  private readonly source: MirrorSource;
  private current: PhysicsEngine;
  private mirrored: Mirrored[] = [];
  private readonly times: number[] = [];
  private stepCount = 0;
  private destroyed = false;
  private gen = 0;
  private lastContacts: Contact[] = [];

  private constructor(factory: PhysicsEngineFactory, source: MirrorSource, engine: PhysicsEngine) {
    this.factory = factory;
    this.source = source;
    this.current = engine;
    this.mirrorNew();
  }

  static async create(factory: PhysicsEngineFactory, source: MirrorSource): Promise<PhysicsWorld> {
    return new PhysicsWorld(factory, source, await factory());
  }

  get engine(): PhysicsEngine {
    return this.current;
  }

  /**
   * Bumped by every `reset()`. Handles from an earlier generation belong to a destroyed engine: owners compare this
   * before touching their bodies and drop them when it changed.
   */
  get generation(): number {
    return this.gen;
  }

  /**
   * Contacts that started during the last step. The world drains the engine once per step so several systems
   * (debris, later ragdolls) can each read them.
   */
  contacts(): readonly Contact[] {
    return this.lastContacts;
  }

  /** Static colliders currently mirrored (enabled or not). */
  get staticCount(): number {
    return this.mirrored.length;
  }

  /** Advance one fixed step: sync the mirror, then simulate. Call only while the game is in play. */
  step(dt: number): void {
    if (this.destroyed) return;
    this.syncMirror();
    const t0 = performance.now();
    this.current.step(dt);
    this.lastContacts = this.current.drainContacts();
    this.times.push(performance.now() - t0);
    if (this.times.length > STAT_WINDOW) this.times.shift();
    this.stepCount++;
  }

  stats(): StepStats {
    if (this.times.length === 0) return { avgMs: 0, peakMs: 0, steps: this.stepCount };
    let sum = 0;
    let peak = 0;
    for (const t of this.times) {
      sum += t;
      peak = Math.max(peak, t);
    }
    return { avgMs: sum / this.times.length, peakMs: peak, steps: this.stepCount };
  }

  /** Throw away every body and rebuild the static mirror in a fresh engine (level or checkpoint restart). */
  async reset(): Promise<void> {
    if (this.destroyed) return;
    const next = await this.factory();
    if (this.destroyed) {
      next.destroy();
      return;
    }
    this.current.destroy();
    this.current = next;
    this.gen++;
    this.lastContacts = [];
    this.mirrored = [];
    this.times.length = 0;
    this.mirrorNew();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.current.destroy();
    this.mirrored = [];
  }

  /** Mirror any colliders added since the last call, then follow every mirrored collider's `enabled` flag. */
  private syncMirror(): void {
    this.mirrorNew();
    const src = this.source.colliders;
    for (const m of this.mirrored) {
      const enabled = src[m.index]!.enabled;
      if (enabled !== m.enabled) {
        if (enabled) this.pushOutOf(src[m.index]!);
        this.current.setColliderEnabled(m.handle, enabled);
        m.enabled = enabled;
      }
    }
  }

  /**
   * A collider coming back (a door closing) must not trap a body inside it: the solver would push the body out
   * along the shortest way, often down through the floor. Move each overlapping body out through the box's
   * thinnest horizontal side instead, to whichever side its centre is on (physics-world "Door closes on a body").
   */
  private pushOutOf(c: MirrorSource['colliders'][number]): void {
    const center = { x: (c.min[0] + c.max[0]) / 2, y: (c.min[1] + c.max[1]) / 2, z: (c.min[2] + c.max[2]) / 2 };
    const half = { x: (c.max[0] - c.min[0]) / 2, y: (c.max[1] - c.min[1]) / 2, z: (c.max[2] - c.min[2]) / 2 };
    const axis: 'x' | 'z' = half.x <= half.z ? 'x' : 'z';
    for (const body of this.current.overlappingBodies(center, half)) {
      const t = this.current.transform(body);
      const side = t.position[axis] >= center[axis] ? 1 : -1;
      t.position[axis] = center[axis] + side * (half[axis] + PUSH_OUT_MARGIN);
      this.current.setTransform(body, t);
    }
  }

  private mirrorNew(): void {
    const src = this.source.colliders;
    for (let i = this.mirrored.length; i < src.length; i++) {
      const c = src[i]!;
      const hx = Math.max((c.max[0] - c.min[0]) / 2, EPS);
      const hy = Math.max((c.max[1] - c.min[1]) / 2, EPS);
      const hz = Math.max((c.max[2] - c.min[2]) / 2, EPS);
      const handle = this.current.createCollider(
        {
          shape: { kind: 'cuboid', halfExtents: { x: hx, y: hy, z: hz } },
          offset: { x: (c.min[0] + c.max[0]) / 2, y: (c.min[1] + c.max[1]) / 2, z: (c.min[2] + c.max[2]) / 2 },
          friction: frictionOf(c),
          tag: c.id,
        },
        null,
      );
      if (!c.enabled) this.current.setColliderEnabled(handle, false);
      this.mirrored.push({ index: i, handle, enabled: c.enabled });
    }
  }
}
