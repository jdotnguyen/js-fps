/**
 * Engine-agnostic physics interface (adopt-physics-engine, design D2). Gameplay code talks only to this,
 * so the engine chosen in Block 0 never leaks out of `src/physics/`. Plain data in and out, numeric handles,
 * no engine objects. One `PhysicsEngine` is one simulation world; `destroy()` frees everything it made.
 */

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export type BodyHandle = number & { readonly __body: unique symbol };
export type ColliderHandle = number & { readonly __collider: unique symbol };
export type JointHandle = number & { readonly __joint: unique symbol };

export type BodyKind = 'fixed' | 'dynamic' | 'kinematic';

export interface BodyDesc {
  kind: BodyKind;
  position: V3;
  rotation?: Quat;
  linvel?: V3;
  angvel?: V3;
  /** Continuous collision detection, for fast pieces (severed limbs at shotgun speed). */
  ccd?: boolean;
  linearDamping?: number;
  angularDamping?: number;
  /** Defaults to true. */
  canSleep?: boolean;
}

/** Capsules run along the collider's local Y axis; `halfHeight` excludes the end caps. */
export type ShapeDesc =
  | { kind: 'cuboid'; halfExtents: V3 }
  | { kind: 'ball'; radius: number }
  | { kind: 'capsule'; halfHeight: number; radius: number };

export interface ColliderDesc {
  shape: ShapeDesc;
  /** Offset and rotation relative to the body (or the world, for a collider with no body). */
  offset?: V3;
  rotation?: Quat;
  density?: number;
  friction?: number;
  restitution?: number;
  /** Report this collider's contacts through `drainContacts()`. */
  contactEvents?: boolean;
  /** Free-form tag returned with contacts and ray hits, e.g. the `CollisionWorld` collider id. */
  tag?: number;
  /**
   * Colliders sharing a group (1..15) never collide with each other, but still collide with everything else.
   * One group per ragdoll keeps its overlapping limb and torso shapes from pushing each other apart.
   */
  noCollideGroup?: number;
}

/** Angle limits in radians, per joint-local axis. Omitted axes are free. */
export interface AngularLimits {
  x?: [number, number];
  y?: [number, number];
  z?: [number, number];
}

/** Anchors are in each body's local space; `frame` rotates the joint axes relative to body A and B. */
export type JointDesc =
  | { kind: 'spherical'; anchorA: V3; anchorB: V3; limits?: AngularLimits }
  | { kind: 'revolute'; anchorA: V3; anchorB: V3; axis: V3; limits?: [number, number] }
  | { kind: 'fixed'; anchorA: V3; anchorB: V3; frameA?: Quat; frameB?: Quat };

/** Drive a joint toward target angles (radians, joint-local axes) like a damped spring. */
export interface MotorTarget {
  /** Spherical joints: target angle per axis. Revolute joints: `x` is the hinge angle. */
  angles: Partial<V3>;
  stiffness: number;
  damping: number;
  /** Cap on the motor's torque; omitted means uncapped. */
  maxForce?: number;
  /**
   * 'acceleration' (default): stiffness and damping ignore the bodies' mass, so the same numbers suit any limb.
   * 'force': stiffness and damping are real torque gains, so heavy chains need larger numbers.
   */
  model?: 'acceleration' | 'force';
}

export interface Contact {
  a: ColliderHandle;
  b: ColliderHandle;
  tagA: number | undefined;
  tagB: number | undefined;
  /** First contact point and normal (from a toward b), world space. */
  point: V3;
  normal: V3;
  /**
   * False when the engine had no solved contact point yet and `point`/`normal` are a rough guess (the colliders'
   * midpoint, straight up): place marks from a raycast instead.
   */
  exact: boolean;
}

export interface RayHit {
  collider: ColliderHandle;
  tag: number | undefined;
  distance: number;
  point: V3;
  normal: V3;
}

export interface Transform {
  position: V3;
  rotation: Quat;
}

/** One collider as the debug view draws it (world space). */
export interface ColliderInfo {
  collider: ColliderHandle;
  /** Null for a fixed world collider (the level mirror). */
  body: BodyHandle | null;
  bodyKind: BodyKind | null;
  sleeping: boolean;
  enabled: boolean;
  shape: ShapeDesc;
  position: V3;
  rotation: Quat;
}

export interface LiveCounts {
  bodies: number;
  colliders: number;
  joints: number;
}

export interface PhysicsEngine {
  readonly name: string;
  createBody(desc: BodyDesc): BodyHandle;
  /** A collider attached to `body`, or a fixed world collider when `body` is null. */
  createCollider(desc: ColliderDesc, body: BodyHandle | null): ColliderHandle;
  createJoint(desc: JointDesc, a: BodyHandle, b: BodyHandle): JointHandle;
  destroyBody(body: BodyHandle): void;
  destroyCollider(collider: ColliderHandle): void;
  destroyJoint(joint: JointHandle): void;
  /** Disabled colliders take part in nothing (door colliders follow their door). */
  setColliderEnabled(collider: ColliderHandle, enabled: boolean): void;
  setMotor(joint: JointHandle, target: MotorTarget | null): void;
  /** Kinematic bodies: the pose reached by the end of the next step. Others: teleport. */
  setTransform(body: BodyHandle, t: Transform): void;
  applyImpulse(body: BodyHandle, impulse: V3, at?: V3): void;
  /** Set a dynamic body's linear and angular velocity (world space; angular in rad/s). */
  setVelocity(body: BodyHandle, linvel: V3, angvel: V3): void;
  angvel(body: BodyHandle, out?: V3): V3;
  setBodyKind(body: BodyHandle, kind: BodyKind): void;
  transform(body: BodyHandle, out?: Transform): Transform;
  linvel(body: BodyHandle, out?: V3): V3;
  isSleeping(body: BodyHandle): boolean;
  step(dt: number): void;
  /** Contacts that started since the last call. */
  drainContacts(): Contact[];
  /** Queries (raycasts, overlaps) see colliders as of the last `step()`: create or move them, then step. */
  raycast(origin: V3, dir: V3, maxDistance: number, exclude?: BodyHandle): RayHit | null;
  /** Dynamic bodies with a collider overlapping an axis-aligned box (as of the last step). */
  overlappingBodies(center: V3, halfExtents: V3): BodyHandle[];
  /** Visit every collider (debug view; allocates, so not for per-frame gameplay). */
  forEachCollider(visit: (info: ColliderInfo) => void): void;
  liveCounts(): LiveCounts;
  /** Free every engine object; the engine is unusable afterwards. */
  destroy(): void;
}

export interface EngineOptions {
  gravity?: V3;
  /**
   * Constraint solver iterations per step. More iterations hold long joint chains (a ragdoll's spine under the
   * weight of its upper body) closer to their targets, at a proportional step-time cost.
   */
  solverIterations?: number;
}

/** Creates an engine; async because engines load WebAssembly on first use. */
export type PhysicsEngineFactory = (opts?: EngineOptions) => Promise<PhysicsEngine>;
