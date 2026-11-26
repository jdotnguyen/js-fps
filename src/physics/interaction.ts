/**
 * Physical interaction (adopt-physics-engine Block 5, design D11; spec physical-interaction).
 *
 * - `PlayerPusher`: a kinematic capsule that follows the player's feet and shoves dynamic bodies (severed pieces,
 *   physics props, later ragdolls) out of the way. Nothing flows back: the player motor never sees it, so loose
 *   bodies cannot slow, block or lift the player. It is a little wider than the motor, so it reaches a physics prop
 *   before the motor's own collision with that prop does, and the player pushes the prop instead of stopping at it.
 * - `PhysicsProps`: one rigid body per prop the level data marks `dynamic`, built from the prop's own collision
 *   boxes. The body's pose is written back to the level every step, which moves the prop's meshes and its
 *   `CollisionWorld` boxes together, so the player and enemies collide with it where it now stands. Its static
 *   mirror entries are excluded, so the body is the only physics copy.
 *
 * Both rebuild after a `PhysicsWorld.reset()` (a new generation): the pusher at the player, the props from the poses
 * the level has just restored.
 */
import * as THREE from 'three';
import { Rng } from '../core/rng.ts';
import type { PropSound } from '../data/types/level.ts';
import type { BoxSpec } from '../world/kit/types.ts';
import type { BodyHandle, Quat, Transform, V3 } from './engine.ts';
import type { PhysicsWorld } from './world.ts';

/** How much wider the pusher is than the player motor (m), so it meets a prop first. */
export const PUSHER_MARGIN = 0.12;
/** Pusher height (m): knee-to-shoulder bodies and props get pushed, not only things on the floor. */
export const PUSHER_HEIGHT = 1.7;
/** A move longer than this in one step is a teleport (respawn, scripted placement): rebuild instead of sweeping. */
const TELEPORT = 1;

export class PlayerPusher {
  private readonly world: PhysicsWorld;
  private readonly radius: number;
  private body: BodyHandle | null = null;
  private generation = -1;
  private readonly last = new THREE.Vector3();
  private readonly t: Transform = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };

  /** `motorRadius`: the player motor's radius; the capsule adds `PUSHER_MARGIN`. */
  constructor(world: PhysicsWorld, motorRadius: number) {
    this.world = world;
    this.radius = motorRadius + PUSHER_MARGIN;
  }

  /** Follow the player's feet. Call once per fixed step, before the physics step, so this step's pushes use it. */
  update(feet: { x: number; y: number; z: number }): void {
    const e = this.world.engine;
    const center = { x: feet.x, y: feet.y + PUSHER_HEIGHT / 2, z: feet.z };
    const stale = this.generation !== this.world.generation;
    if (this.body !== null && !stale && this.last.distanceTo(center as THREE.Vector3Like) > TELEPORT) {
      e.destroyBody(this.body);
      this.body = null;
    }
    if (this.body === null || stale) {
      this.generation = this.world.generation;
      this.body = e.createBody({ kind: 'kinematic', position: center });
      const halfHeight = Math.max(0.05, PUSHER_HEIGHT / 2 - this.radius);
      e.createCollider({ shape: { kind: 'capsule', halfHeight, radius: this.radius }, friction: 0.4 }, this.body);
    } else {
      this.t.position = center;
      e.setTransform(this.body, this.t);
    }
    this.last.set(center.x, center.y, center.z);
  }

  destroy(): void {
    if (this.body !== null && this.generation === this.world.generation) this.world.engine.destroyBody(this.body);
    this.body = null;
  }
}

/** What `PhysicsProps` needs from the level (`Level.physicsProps` and `Level.setPropPose`). */
export interface PropSource {
  physicsProps(): ReadonlyArray<{
    id: string;
    mass: number;
    /** No `CollisionWorld` boxes (design D14); small and fast when knocked, and what a scripted kill knocks over. */
    loose?: boolean;
    /** What it sounds like when it hits something (design D16); silent without one. */
    sound?: PropSound | null;
    /** A scripted body (livelier-cart-slam D3): physics never moves it, `drive` does. */
    kinematic?: boolean;
    object: THREE.Object3D;
    localColliders: readonly BoxSpec[];
    colliders: ReadonlyArray<{ readonly id: number }>;
  }>;
  setPropPose(id: string, pos: V3, rotation: Quat): boolean;
}

/** Friction of a physics prop's boxes: metal and plastic on station floors. */
export const PROP_FRICTION = 0.5;

/**
 * A knock (design D15): the speed (m/s) it gives a prop at strength 1, how much it carries along the mover's travel
 * and upward (against 1 out to the side), and how far above the prop's centre it lands (as a share of the prop's
 * height), so things topple and tumble instead of sliding.
 */
export const KNOCK = { speed: 1.6, along: 0.4, up: 0.25, above: 0.45 } as const;

/**
 * Changes of velocity in one step smaller than this (m/s) are not reported: it clears the step of gravity a resting
 * prop cancels. What is loud enough to hear is the audio's choice (`IMPACT_MIN_SPEED`).
 */
export const IMPACT_NOISE = 0.35;
const GRAVITY = 9.81;

/**
 * A slam's burst (livelier-cart-slam D4): the speed (m/s) it gives a prop at strength 1, how much of the outward throw
 * goes along the surface's long axis and across it, the share bent toward the glass, how far above the prop's centre
 * the push lands (a share of its height, so it tumbles), how much speed is lost at the edge of the reach, and the
 * upward share for things below the impact (the shelf: thrown out, not up into the top).
 */
export const BURST = { speed: 2.5, along: 1, across: 0.45, toward: 0.8, above: 0.3, falloff: 0.5, below: 0.12 } as const;
/** Steps after a `place` during which a prop reports no impacts (a restored kill is silent). */
const PLACE_QUIET_STEPS = 30;

/** A sounding prop's motion changed sharply: it struck something or was struck (design D16). */
export interface PropImpact {
  id: string;
  material: PropSound;
  /** The prop's centre. */
  x: number;
  y: number;
  z: number;
  /** Size of the change in velocity, gravity apart (m/s). */
  speed: number;
}

interface LiveProp {
  id: string;
  body: BodyHandle;
  mass: number;
  loose: boolean;
  /** Centre and height of the prop's boxes, in its own frame. */
  center: THREE.Vector3;
  height: number;
  sound: PropSound | null;
  /** Velocity after the last step, to measure the change over the next one. */
  velocity: V3;
  kinematic: boolean;
  /** Steps left with no impact reports (just placed). */
  quiet: number;
}

export interface BurstOptions {
  /** Upward share of the throw, 0..1 (default 0.5). */
  up?: number;
  /** The surface's long axis (horizontal): most of the throw goes along it. */
  along?: V3;
  /** A point some of the throw bends toward (the glass). */
  toward?: V3;
  /** Seeds the spin, so a run is repeatable. */
  seed?: string;
}

export class PhysicsProps {
  private readonly world: PhysicsWorld;
  private readonly source: PropSource;
  private live: LiveProp[] = [];
  private generation = -1;
  private readonly t: Transform = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
  private readonly v: V3 = { x: 0, y: 0, z: 0 };
  private readonly onImpact: ((impact: PropImpact) => void) | undefined;

  constructor(world: PhysicsWorld, source: PropSource, onImpact?: (impact: PropImpact) => void) {
    this.world = world;
    this.source = source;
    this.onImpact = onImpact;
    const ids: number[] = [];
    for (const p of source.physicsProps()) for (const c of p.colliders) ids.push(c.id);
    world.exclude(ids);
    this.build();
  }

  /** Prop ids with a body. */
  get ids(): string[] {
    return this.live.map((p) => p.id);
  }

  /** Body of a prop (tests, kill beats that knock props over). */
  bodyOf(id: string): BodyHandle | null {
    return this.live.find((p) => p.id === id)?.body ?? null;
  }

  /** Physics props whose origin is within `radius` of `center`. */
  near(center: V3, radius: number): BodyHandle[] {
    const out: BodyHandle[] = [];
    for (const p of this.live) {
      const t = this.world.engine.transform(p.body, this.t);
      if (Math.hypot(t.position.x - center.x, t.position.y - center.y, t.position.z - center.z) <= radius) out.push(p.body);
    }
    return out;
  }

  /**
   * Knock over the loose props within `reach` m (over the floor) of `from`, off to whichever side of `travel` they
   * stand and a little along it. Each prop is hit once per `done` set, so a caller can sweep a moving body past them
   * step by step. Returns how many it hit.
   */
  knock(from: V3, travel: V3, reach: number, strength: number, done: Set<string>): number {
    if (this.world.resetting || this.generation !== this.world.generation) return 0;
    const e = this.world.engine;
    let hits = 0;
    for (const p of this.live) {
      if (!p.loose || done.has(p.id)) continue;
      const t = e.transform(p.body, this.t);
      const q = new THREE.Quaternion(t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w);
      const c = p.center.clone().applyQuaternion(q).add(t.position as THREE.Vector3Like);
      const away = new THREE.Vector3(c.x - from.x, 0, c.z - from.z);
      if (away.length() > reach) continue;
      done.add(p.id);
      hits++;
      const ahead = new THREE.Vector3(travel.x, 0, travel.z).normalize();
      // Sideways, not straight ahead: a prop is first in reach while still in front of a walker.
      const side = away.clone().addScaledVector(ahead, -away.dot(ahead));
      const dir = (side.lengthSq() > 1e-4 ? side.normalize() : away.normalize()).addScaledVector(ahead, KNOCK.along);
      dir.y = KNOCK.up;
      const j = dir.multiplyScalar(p.mass * KNOCK.speed * strength);
      e.applyImpulse(p.body, { x: j.x, y: j.y, z: j.z }, { x: c.x, y: c.y + p.height * KNOCK.above, z: c.z });
    }
    return hits;
  }

  /**
   * Throw the loose props whose centre is within `reach` m of `at` up and away from it (a slam landing,
   * livelier-cart-slam D4), harder the nearer they are. Returns how many it threw.
   */
  burst(at: V3, reach: number, strength: number, opts: BurstOptions = {}): number {
    if (this.world.resetting || this.generation !== this.world.generation) return 0;
    const e = this.world.engine;
    const rng = new Rng(opts.seed ?? 'burst');
    const along = opts.along ? new THREE.Vector3(opts.along.x, 0, opts.along.z).normalize() : null;
    let thrown = 0;
    for (const p of this.live) {
      if (!p.loose) continue;
      const t = e.transform(p.body, this.t);
      const q = new THREE.Quaternion(t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w);
      const c = p.center.clone().applyQuaternion(q).add(t.position as THREE.Vector3Like);
      const d = Math.hypot(c.x - at.x, c.y - at.y, c.z - at.z);
      if (d > reach) continue;
      thrown++;
      const out = new THREE.Vector3(c.x - at.x, 0, c.z - at.z);
      if (out.lengthSq() < 4e-4) out.set(Math.cos(rng.range(0, Math.PI * 2)), 0, Math.sin(rng.range(0, Math.PI * 2)));
      out.normalize();
      if (along) {
        const a = out.dot(along);
        const across = out.clone().addScaledVector(along, -a);
        const side = Math.abs(a) > 0.05 ? Math.sign(a) : rng.next() < 0.5 ? -1 : 1;
        out.copy(along).multiplyScalar(side * Math.max(Math.abs(a), 0.5) * BURST.along).addScaledVector(across, BURST.across);
      }
      if (opts.toward) out.add(new THREE.Vector3(opts.toward.x - at.x, 0, opts.toward.z - at.z).normalize().multiplyScalar(BURST.toward));
      out.normalize();
      const up = c.y < at.y - 0.3 ? BURST.below : THREE.MathUtils.clamp(opts.up ?? 0.5, 0, 1);
      const dir = out.multiplyScalar(Math.sqrt(1 - up * up));
      dir.y = up;
      const speed = BURST.speed * strength * (1 - (BURST.falloff * d) / reach);
      const j = dir.multiplyScalar(p.mass * speed);
      const r = Math.max(0.01, p.height);
      e.applyImpulse(p.body, { x: j.x, y: j.y, z: j.z }, { x: c.x + rng.range(-r, r), y: c.y + p.height * BURST.above, z: c.z + rng.range(-r, r) });
    }
    return thrown;
  }

  /** Move a kinematic prop's body to a pose by the end of the next step (the level's copy is the caller's). */
  drive(id: string, pos: V3, rotation: Quat): boolean {
    if (this.world.resetting || this.generation !== this.world.generation) return false;
    const p = this.live.find((l) => l.id === id && l.kinematic);
    if (!p) return false;
    this.t.position = { x: pos.x, y: pos.y, z: pos.z };
    this.t.rotation = { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w };
    this.world.engine.setTransform(p.body, this.t);
    return true;
  }

  /**
   * Put a prop's body at a pose, at rest (a skipped or restored kill's aftermath, livelier-cart-slam D11). It makes no
   * impact sound while it settles. A body not built yet is built from the level's pose instead, which needs nothing.
   */
  place(id: string, pos: V3, rotation: Quat): boolean {
    if (this.world.resetting || this.generation !== this.world.generation) return false;
    const p = this.live.find((l) => l.id === id);
    if (!p) return false;
    const e = this.world.engine;
    this.t.position = { x: pos.x, y: pos.y, z: pos.z };
    this.t.rotation = { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w };
    if (p.kinematic) {
      e.setBodyKind(p.body, 'dynamic');
      e.setTransform(p.body, this.t);
      e.setBodyKind(p.body, 'kinematic');
    } else {
      e.setTransform(p.body, this.t);
      e.setVelocity(p.body, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    }
    p.velocity.x = p.velocity.y = p.velocity.z = 0;
    p.quiet = PLACE_QUIET_STEPS;
    return true;
  }

  /**
   * Write each moving prop's pose back to the level and report impacts. Call once per fixed step, after the physics
   * step, with that step's length.
   */
  sync(dt = 1 / 60): void {
    if (this.world.resetting) return; // the level has just restored its props; the old bodies must not overwrite them
    if (this.generation !== this.world.generation) this.build();
    const e = this.world.engine;
    for (const p of this.live) {
      if (p.kinematic) continue; // `drive` moves it, and its caller moves the level's copy
      if (e.isSleeping(p.body)) {
        p.velocity.x = p.velocity.y = p.velocity.z = 0;
        continue;
      }
      e.transform(p.body, this.t);
      this.source.setPropPose(p.id, this.t.position, this.t.rotation);
      this.listen(p, dt);
    }
  }

  /** `this.t` holds the prop's pose. */
  private listen(p: LiveProp, dt: number): void {
    if (!p.sound || !this.onImpact) return;
    const v = this.world.engine.linvel(p.body, this.v);
    const speed = Math.hypot(v.x - p.velocity.x, v.y - p.velocity.y + GRAVITY * dt, v.z - p.velocity.z);
    p.velocity.x = v.x;
    p.velocity.y = v.y;
    p.velocity.z = v.z;
    if (p.quiet > 0) {
      p.quiet--;
      return;
    }
    if (speed < IMPACT_NOISE) return;
    const r = this.t.rotation;
    const c = p.center.clone().applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w)).add(this.t.position as THREE.Vector3Like);
    this.onImpact({ id: p.id, material: p.sound, x: c.x, y: c.y, z: c.z, speed });
  }

  /** One body per physics prop, at the pose its group has now. */
  private build(): void {
    this.generation = this.world.generation;
    const e = this.world.engine;
    this.live = [];
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (const p of this.source.physicsProps()) {
      if (p.localColliders.length === 0) continue;
      p.object.updateWorldMatrix(true, false);
      p.object.matrixWorld.decompose(pos, quat, scale);
      const body = e.createBody({
        kind: p.kinematic ? 'kinematic' : 'dynamic',
        position: { x: pos.x, y: pos.y, z: pos.z },
        rotation: { x: quat.x, y: quat.y, z: quat.z, w: quat.w },
        linearDamping: 0.3,
        angularDamping: 0.4,
        // Small things thrown by a knock must not pass through the glass or a bench top.
        ccd: p.loose === true,
      });
      let volume = 0;
      const bounds = new THREE.Box3();
      for (const b of p.localColliders) {
        bounds.expandByPoint(new THREE.Vector3(...b.min));
        bounds.expandByPoint(new THREE.Vector3(...b.max));
      }
      for (const b of p.localColliders) volume += (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]);
      const density = p.mass / Math.max(volume, 1e-4);
      for (const b of p.localColliders) {
        e.createCollider(
          {
            shape: { kind: 'cuboid', halfExtents: { x: Math.max((b.max[0] - b.min[0]) / 2, 0.005), y: Math.max((b.max[1] - b.min[1]) / 2, 0.005), z: Math.max((b.max[2] - b.min[2]) / 2, 0.005) } },
            offset: { x: (b.min[0] + b.max[0]) / 2, y: (b.min[1] + b.max[1]) / 2, z: (b.min[2] + b.max[2]) / 2 },
            density,
            friction: PROP_FRICTION,
            restitution: 0.05,
          },
          body,
        );
      }
      this.live.push({
        id: p.id,
        body,
        mass: p.mass,
        loose: p.loose === true,
        center: bounds.getCenter(new THREE.Vector3()),
        height: bounds.max.y - bounds.min.y,
        sound: p.sound ?? null,
        velocity: { x: 0, y: 0, z: 0 },
        kinematic: p.kinematic === true,
        quiet: 0,
      });
    }
  }
}
