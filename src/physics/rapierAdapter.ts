/**
 * Rapier implementation of `PhysicsEngine` (adopt-physics-engine, design D2). The only file that imports
 * `@dimforge/rapier3d-compat`; it is loaded lazily, so the engine's WebAssembly is its own bundle chunk.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import type {
  AngularLimits,
  BodyDesc,
  BodyHandle,
  BodyKind,
  ColliderDesc,
  ColliderHandle,
  Contact,
  JointDesc,
  JointHandle,
  LiveCounts,
  MotorTarget,
  PhysicsEngine,
  PhysicsEngineFactory,
  Quat,
  RayHit,
  Transform,
  V3,
} from './engine.ts';

let ready: Promise<void> | null = null;
/** Load Rapier's WebAssembly once per page (or Node process). */
export function initRapier(): Promise<void> {
  ready ??= RAPIER.init();
  return ready;
}

const KIND: Record<BodyKind, RAPIER.RigidBodyType> = {
  dynamic: RAPIER.RigidBodyType.Dynamic,
  fixed: RAPIER.RigidBodyType.Fixed,
  kinematic: RAPIER.RigidBodyType.KinematicPositionBased,
};
const ANG_AXES = [
  ['x', RAPIER.JointAxis.AngX],
  ['y', RAPIER.JointAxis.AngY],
  ['z', RAPIER.JointAxis.AngZ],
] as const;
const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
/** Rapier's default motor force cap (f32::MAX). */
const UNCAPPED = 3.4028234663852886e38;

/**
 * Rapier's raw joint set. Its typed wrapper only offers limits on single-axis joints and returns joints from
 * `getImpulseJoint` without their per-kind motor methods, so limits and motors go through the raw calls.
 */
interface RawJointSet {
  jointSetLimits(handle: number, axis: RAPIER.JointAxis, min: number, max: number): void;
  jointConfigureMotorPosition(handle: number, axis: RAPIER.JointAxis, targetPos: number, stiffness: number, damping: number): void;
  jointSetMotorMaxForce(handle: number, axis: RAPIER.JointAxis, maxForce: number): void;
  jointConfigureMotorModel(handle: number, axis: RAPIER.JointAxis, model: RAPIER.MotorModel): void;
}
const rawJoints = (j: RAPIER.ImpulseJoint): RawJointSet => (j as unknown as { rawSet: RawJointSet }).rawSet;

export const createRapierEngine: PhysicsEngineFactory = async (opts = {}) => {
  await initRapier();
  const world = new RAPIER.World(opts.gravity ?? { x: 0, y: -9.81, z: 0 });
  if (opts.solverIterations !== undefined) world.numSolverIterations = opts.solverIterations;
  const events = new RAPIER.EventQueue(true);
  const tags = new Map<number, number>();
  const jointKinds = new Map<number, JointDesc['kind']>();
  /** Contacts gathered after each step: an auto-draining queue clears itself at the start of the next step. */
  let pending: Contact[] = [];
  let destroyed = false;

  const body = (h: BodyHandle): RAPIER.RigidBody => {
    const b = world.getRigidBody(h);
    if (!b) throw new Error(`rapier: no body ${h}`);
    return b;
  };
  const collider = (h: ColliderHandle): RAPIER.Collider => {
    const c = world.getCollider(h);
    if (!c) throw new Error(`rapier: no collider ${h}`);
    return c;
  };
  const joint = (h: JointHandle): RAPIER.ImpulseJoint => {
    const j = world.getImpulseJoint(h);
    if (!j) throw new Error(`rapier: no joint ${h}`);
    return j;
  };

  function setSphericalLimits(j: RAPIER.ImpulseJoint, limits: AngularLimits): void {
    const raw = rawJoints(j);
    for (const [key, axis] of ANG_AXES) {
      const range = limits[key];
      if (range) raw.jointSetLimits(j.handle, axis, range[0], range[1]);
    }
  }

  function collectContacts(out: Contact[]): void {
    events.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const a = world.getCollider(h1);
      const b = world.getCollider(h2);
      if (!a || !b) return;
      let point: V3 | null = null;
      let normal: V3 | null = null;
      world.contactPair(a, b, (m, flipped) => {
        if (point || m.numSolverContacts() === 0) return;
        const p = m.solverContactPoint(0);
        if (!p) return;
        const n = m.normal();
        point = { x: p.x, y: p.y, z: p.z };
        normal = flipped ? { x: -n.x, y: -n.y, z: -n.z } : { x: n.x, y: n.y, z: n.z };
      });
      // No solver point yet (first touch this step): fall back to the midpoint of the two colliders.
      const ta = a.translation();
      const tb = b.translation();
      out.push({
        a: h1 as ColliderHandle,
        b: h2 as ColliderHandle,
        tagA: tags.get(h1),
        tagB: tags.get(h2),
        point: point ?? { x: (ta.x + tb.x) / 2, y: (ta.y + tb.y) / 2, z: (ta.z + tb.z) / 2 },
        normal: normal ?? { x: 0, y: 1, z: 0 },
      });
    });
  }

  const engine: PhysicsEngine = {
    name: `rapier ${RAPIER.version()}`,

    createBody(d: BodyDesc): BodyHandle {
      const desc = new RAPIER.RigidBodyDesc(KIND[d.kind])
        .setTranslation(d.position.x, d.position.y, d.position.z)
        .setRotation(d.rotation ?? IDENTITY)
        .setCcdEnabled(d.ccd ?? false)
        .setLinearDamping(d.linearDamping ?? 0)
        .setAngularDamping(d.angularDamping ?? 0)
        .setCanSleep(d.canSleep ?? true);
      if (d.linvel) desc.setLinvel(d.linvel.x, d.linvel.y, d.linvel.z);
      if (d.angvel) desc.setAngvel(d.angvel);
      return world.createRigidBody(desc).handle as BodyHandle;
    },

    createCollider(d: ColliderDesc, parent: BodyHandle | null): ColliderHandle {
      const s = d.shape;
      const desc =
        s.kind === 'cuboid'
          ? RAPIER.ColliderDesc.cuboid(s.halfExtents.x, s.halfExtents.y, s.halfExtents.z)
          : s.kind === 'ball'
            ? RAPIER.ColliderDesc.ball(s.radius)
            : RAPIER.ColliderDesc.capsule(s.halfHeight, s.radius);
      if (d.offset) desc.setTranslation(d.offset.x, d.offset.y, d.offset.z);
      if (d.rotation) desc.setRotation(d.rotation);
      if (d.density !== undefined) desc.setDensity(d.density);
      if (d.friction !== undefined) desc.setFriction(d.friction);
      if (d.restitution !== undefined) desc.setRestitution(d.restitution);
      if (d.contactEvents) desc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      if (d.noCollideGroup !== undefined) {
        const g = d.noCollideGroup;
        if (!Number.isInteger(g) || g < 1 || g > 15) throw new Error(`rapier: noCollideGroup ${g} is outside 1..15`);
        // Membership: group bit g. Filter: everything except group g. Bit 0 is the default group of everything else.
        const groups = (((1 << g) & 0xffff) << 16) | (0xffff & ~(1 << g));
        desc.setCollisionGroups(groups);
      }
      const c = world.createCollider(desc, parent === null ? undefined : body(parent));
      if (d.tag !== undefined) tags.set(c.handle, d.tag);
      return c.handle as ColliderHandle;
    },

    createJoint(d: JointDesc, a: BodyHandle, b: BodyHandle): JointHandle {
      const data =
        d.kind === 'spherical'
          ? RAPIER.JointData.spherical(d.anchorA, d.anchorB)
          : d.kind === 'revolute'
            ? RAPIER.JointData.revolute(d.anchorA, d.anchorB, d.axis)
            : RAPIER.JointData.fixed(d.anchorA, d.frameA ?? IDENTITY, d.anchorB, d.frameB ?? IDENTITY);
      const j = world.createImpulseJoint(data, body(a), body(b), true);
      // A revolute joint's free axis is its local AngX.
      if (d.kind === 'revolute' && d.limits) rawJoints(j).jointSetLimits(j.handle, RAPIER.JointAxis.AngX, d.limits[0], d.limits[1]);
      // Bodies joined into one ragdoll must not collide with each other at the joint.
      j.setContactsEnabled(false);
      if (d.kind === 'spherical' && d.limits) setSphericalLimits(j, d.limits);
      jointKinds.set(j.handle, d.kind);
      return j.handle as JointHandle;
    },

    destroyBody(h) {
      const b = world.getRigidBody(h);
      if (!b) return;
      for (let i = 0; i < b.numColliders(); i++) tags.delete(b.collider(i).handle);
      world.removeRigidBody(b);
    },
    destroyCollider(h) {
      const c = world.getCollider(h);
      if (!c) return;
      tags.delete(h);
      world.removeCollider(c, true);
    },
    destroyJoint(h) {
      const j = world.getImpulseJoint(h);
      if (!j) return;
      jointKinds.delete(h);
      world.removeImpulseJoint(j, true);
    },

    setColliderEnabled(h, enabled) {
      collider(h).setEnabled(enabled);
    },

    setMotor(h: JointHandle, target: MotorTarget | null) {
      const j = joint(h);
      const kind = jointKinds.get(h);
      if (kind !== 'spherical' && kind !== 'revolute') throw new Error(`rapier: joint ${h} (${kind}) has no motor`);
      const raw = rawJoints(j);
      // A revolute joint's free axis is its local AngX; a spherical joint drives all three.
      const axes = kind === 'revolute' ? ANG_AXES.slice(0, 1) : ANG_AXES;
      for (const [key, axis] of axes) {
        const angle = target?.angles[key];
        if (target && angle !== undefined) {
          raw.jointConfigureMotorModel(j.handle, axis, target.model === 'force' ? RAPIER.MotorModel.ForceBased : RAPIER.MotorModel.AccelerationBased);
          raw.jointConfigureMotorPosition(j.handle, axis, angle, target.stiffness, target.damping);
          raw.jointSetMotorMaxForce(j.handle, axis, target.maxForce ?? UNCAPPED);
        } else {
          // Zero stiffness and damping still leave drag on the axis (measured); a zero force cap frees it.
          raw.jointConfigureMotorPosition(j.handle, axis, 0, 0, 0);
          raw.jointSetMotorMaxForce(j.handle, axis, 0);
        }
      }
      // A new target must move bodies that have already fallen asleep.
      j.body1().wakeUp();
      j.body2().wakeUp();
    },

    setTransform(h, t: Transform) {
      const b = body(h);
      if (b.isKinematic()) {
        b.setNextKinematicTranslation(t.position);
        b.setNextKinematicRotation(t.rotation);
      } else {
        b.setTranslation(t.position, true);
        b.setRotation(t.rotation, true);
      }
    },
    applyImpulse(h, impulse: V3, at?: V3) {
      const b = body(h);
      if (at) b.applyImpulseAtPoint(impulse, at, true);
      else b.applyImpulse(impulse, true);
    },
    setVelocity(h, lin, ang) {
      const b = body(h);
      b.setLinvel(lin, true);
      b.setAngvel(ang, true);
    },
    angvel(h, out = { x: 0, y: 0, z: 0 }) {
      const v = body(h).angvel();
      out.x = v.x;
      out.y = v.y;
      out.z = v.z;
      return out;
    },
    setBodyKind(h, kind) {
      body(h).setBodyType(KIND[kind], true);
    },

    transform(h, out = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } }) {
      const b = body(h);
      const p = b.translation();
      const r = b.rotation();
      out.position.x = p.x;
      out.position.y = p.y;
      out.position.z = p.z;
      out.rotation.x = r.x;
      out.rotation.y = r.y;
      out.rotation.z = r.z;
      out.rotation.w = r.w;
      return out;
    },
    linvel(h, out = { x: 0, y: 0, z: 0 }) {
      const v = body(h).linvel();
      out.x = v.x;
      out.y = v.y;
      out.z = v.z;
      return out;
    },
    isSleeping(h) {
      return body(h).isSleeping();
    },

    step(dt) {
      world.timestep = dt;
      world.step(events);
      collectContacts(pending);
    },

    drainContacts(): Contact[] {
      const out = pending;
      pending = [];
      return out;
    },

    raycast(origin, dir, maxDistance, exclude): RayHit | null {
      const len = Math.hypot(dir.x, dir.y, dir.z);
      if (len < 1e-9) return null;
      const d = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
      const ray = new RAPIER.Ray(origin, d);
      const hit = world.castRayAndGetNormal(ray, maxDistance, true, undefined, undefined, undefined, exclude === undefined ? undefined : body(exclude));
      if (!hit) return null;
      const t = hit.timeOfImpact;
      return {
        collider: hit.collider.handle as ColliderHandle,
        tag: tags.get(hit.collider.handle),
        distance: t,
        point: { x: origin.x + d.x * t, y: origin.y + d.y * t, z: origin.z + d.z * t },
        normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
      };
    },

    liveCounts(): LiveCounts {
      if (destroyed) return { bodies: 0, colliders: 0, joints: 0 };
      return { bodies: world.bodies.len(), colliders: world.colliders.len(), joints: world.impulseJoints.len() };
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      tags.clear();
      jointKinds.clear();
      events.free();
      world.free();
    },
  };
  return engine;
};
