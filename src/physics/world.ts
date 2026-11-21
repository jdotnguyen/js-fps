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
import type { ColliderHandle, PhysicsEngine, PhysicsEngineFactory } from './engine.ts';

/** The part of `CollisionWorld` the mirror reads. */
export interface MirrorSource {
  readonly colliders: ReadonlyArray<{
    readonly id: number;
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
    readonly enabled: boolean;
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
const EPS = 1e-4;

export class PhysicsWorld {
  private readonly factory: PhysicsEngineFactory;
  private readonly source: MirrorSource;
  private current: PhysicsEngine;
  private mirrored: Mirrored[] = [];
  private readonly times: number[] = [];
  private stepCount = 0;
  private destroyed = false;

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
          friction: 0.8,
          tag: c.id,
        },
        null,
      );
      if (!c.enabled) this.current.setColliderEnabled(handle, false);
      this.mirrored.push({ index: i, handle, enabled: c.enabled });
    }
  }
}
