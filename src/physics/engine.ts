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
}

export interface Contact {
  a: ColliderHandle;
  b: ColliderHandle;
  tagA: number | undefined;
  tagB: number | undefined;
  /** First contact point and normal (from a toward b), world space. */
  point: V3;
  normal: V3;
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
  setBodyKind(body: BodyHandle, kind: BodyKind): void;
  transform(body: BodyHandle, out?: Transform): Transform;
  linvel(body: BodyHandle, out?: V3): V3;
  isSleeping(body: BodyHandle): boolean;
  step(dt: number): void;
  /** Contacts that started since the last call. */
  drainContacts(): Contact[];
  raycast(origin: V3, dir: V3, maxDistance: number, exclude?: BodyHandle): RayHit | null;
  liveCounts(): LiveCounts;
  /** Free every engine object; the engine is unusable afterwards. */
  destroy(): void;
}

/** Creates an engine with gravity; async because engines load WebAssembly on first use. */
export type PhysicsEngineFactory = (gravity?: V3) => Promise<PhysicsEngine>;
