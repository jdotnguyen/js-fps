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
    object: THREE.Object3D;
    localColliders: readonly BoxSpec[];
    colliders: ReadonlyArray<{ readonly id: number }>;
  }>;
  setPropPose(id: string, pos: V3, rotation: Quat): boolean;
}

/** Friction of a physics prop's boxes: metal and plastic on station floors. */
export const PROP_FRICTION = 0.5;

interface LiveProp {
  id: string;
  body: BodyHandle;
}

export class PhysicsProps {
  private readonly world: PhysicsWorld;
  private readonly source: PropSource;
  private live: LiveProp[] = [];
  private generation = -1;
  private readonly t: Transform = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };

  constructor(world: PhysicsWorld, source: PropSource) {
    this.world = world;
    this.source = source;
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

  /** Write each moving prop's pose back to the level. Call once per fixed step, after the physics step. */
  sync(): void {
    if (this.world.resetting) return; // the level has just restored its props; the old bodies must not overwrite them
    if (this.generation !== this.world.generation) this.build();
    const e = this.world.engine;
    for (const p of this.live) {
      if (e.isSleeping(p.body)) continue;
      e.transform(p.body, this.t);
      this.source.setPropPose(p.id, this.t.position, this.t.rotation);
    }
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
        kind: 'dynamic',
        position: { x: pos.x, y: pos.y, z: pos.z },
        rotation: { x: quat.x, y: quat.y, z: quat.z, w: quat.w },
        linearDamping: 0.3,
        angularDamping: 0.4,
      });
      let volume = 0;
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
      this.live.push({ id: p.id, body });
    }
  }
}
