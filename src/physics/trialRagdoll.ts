/**
 * Block 0 trial ragdoll (adopt-physics-engine, design D6 prototype): 14 rigid bodies built from a humanoid's
 * shared skeleton bones, joined with limited joints, written back onto the bones every frame. Engine-agnostic
 * (talks only to `PhysicsEngine`). Block 3's `ragdoll.ts` replaces it; the trial uses it to judge the engine.
 *
 * Assumes the procedural rig, whose rest pose has identity bone rotations, so a joint's zero angle is the rest
 * pose. Imported body models (bind poses with rotated bones) need joint frames from their rest pose (Block 3).
 */
import * as THREE from 'three';
import type { JointName } from '../actors/skeleton.ts';
import type { AngularLimits, BodyHandle, ColliderDesc, JointHandle, PhysicsEngine, Quat, V3 } from './engine.ts';

export interface RagdollPart {
  bone: JointName;
  /** Nearest ancestor with a body; null for the pelvis. */
  parent: JointName | null;
  shapes: ColliderDesc[];
  /** Ball joint with per-axis limits, or a hinge about the bone's local X (elbows, knees). */
  joint: { kind: 'spherical'; limits: AngularLimits } | { kind: 'revolute'; limits: [number, number] } | null;
}

const cap = (y0: number, y1: number, r: number): ColliderDesc => {
  const len = Math.abs(y1 - y0);
  return { shape: { kind: 'capsule', halfHeight: Math.max(0.01, len / 2 - r), radius: r }, offset: { x: 0, y: (y0 + y1) / 2, z: 0 } };
};
const box = (hx: number, hy: number, hz: number, y: number, z = 0): ColliderDesc => ({
  shape: { kind: 'cuboid', halfExtents: { x: hx, y: hy, z: hz } },
  offset: { x: 0, y, z },
});
const deg = (d: number): number => (d * Math.PI) / 180;
const range = (a: number, b: number): [number, number] => [deg(a), deg(b)];

/**
 * Body list for the reference 1.78 m body, sized from `skeleton.ts` segments (shrunk a little so neighbours
 * overlap less). Axes follow the skeleton's conventions: +x swings a limb forward, +x bends an elbow, -x bends
 * a knee, -z raises the left arm (and leg) sideways, +y twists left.
 */
export const RAGDOLL_PARTS: readonly RagdollPart[] = [
  { bone: 'pelvis', parent: null, shapes: [box(0.16, 0.09, 0.11, 0.01)], joint: null },
  { bone: 'spine', parent: 'pelvis', shapes: [box(0.14, 0.09, 0.095, 0.09)], joint: { kind: 'spherical', limits: { x: range(-30, 20), y: range(-25, 25), z: range(-20, 20) } } },
  { bone: 'chest', parent: 'spine', shapes: [box(0.17, 0.12, 0.1, 0.12)], joint: { kind: 'spherical', limits: { x: range(-25, 15), y: range(-20, 20), z: range(-15, 15) } } },
  { bone: 'head', parent: 'chest', shapes: [{ shape: { kind: 'ball', radius: 0.1 }, offset: { x: 0, y: 0.09, z: -0.01 } }], joint: { kind: 'spherical', limits: { x: range(-45, 30), y: range(-60, 60), z: range(-30, 30) } } },
  ...(['L', 'R'] as const).flatMap((s): RagdollPart[] => {
    const side = s === 'L' ? -1 : 1;
    // Raising sideways is -z on the left and +z on the right, for arms and legs alike.
    const out = (deg0: number, deg1: number): [number, number] => (side < 0 ? range(-deg1, deg0) : range(-deg0, deg1));
    return [
      { bone: `upperArm_${s}`, parent: 'chest', shapes: [cap(0.02, -0.28, 0.05)], joint: { kind: 'spherical', limits: { x: range(-50, 150), y: range(-70, 70), z: out(30, 150) } } },
      // Elbow: bends on x; the ball joint also lets the forearm twist (y) and lean a little (z), as the animation does.
      { bone: `foreArm_${s}`, parent: `upperArm_${s}`, shapes: [cap(0.01, -0.4, 0.04)], joint: { kind: 'spherical', limits: { x: range(0, 145), y: range(-80, 80), z: range(-20, 20) } } },
      { bone: `thigh_${s}`, parent: 'pelvis', shapes: [cap(0.03, -0.43, 0.07)], joint: { kind: 'spherical', limits: { x: range(-30, 110), y: range(-35, 35), z: out(15, 50) } } },
      { bone: `shin_${s}`, parent: `thigh_${s}`, shapes: [cap(0, -0.42, 0.05)], joint: { kind: 'revolute', limits: range(-140, 0) } },
      // The foot is its own body: fixed to the shin, it turned with the knee and dug into the floor.
      { bone: `foot_${s}`, parent: `shin_${s}`, shapes: [box(0.045, 0.03, 0.1, -0.028, -0.055)], joint: { kind: 'spherical', limits: { x: range(-30, 40), y: range(-15, 15), z: range(-15, 15) } } },
    ];
  }),
];

const REFERENCE_PELVIS_TO_CHEST = 0.12 + 0.18;

export interface RagdollOptions {
  /** 1..15, unique per live ragdoll, so its own parts never collide. */
  group: number;
  /** Initial velocity for every body (the body's motion when it died). */
  velocity?: V3;
  density?: number;
  /** Pelvis follows the animation (powered hit reactions) instead of falling. */
  kinematicPelvis?: boolean;
}

interface Body {
  part: RagdollPart;
  handle: BodyHandle;
  joint: JointHandle | null;
}

const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpM2 = new THREE.Matrix4();
const q3 = (q: THREE.Quaternion): Quat => ({ x: q.x, y: q.y, z: q.z, w: q.w });

export class TrialRagdoll {
  readonly bodies: Body[] = [];
  private readonly byBone = new Map<JointName, Body>();
  private readonly engine: PhysicsEngine;
  private readonly bones: Readonly<Record<JointName, THREE.Bone>>;
  private readonly kinematicPelvis: boolean;
  private readonly prevTarget = new Map<JointName, V3>();

  constructor(engine: PhysicsEngine, bones: Readonly<Record<JointName, THREE.Bone>>, opts: RagdollOptions) {
    this.engine = engine;
    this.bones = bones;
    this.kinematicPelvis = opts.kinematicPelvis ?? false;
    const root = bones.pelvis.parent ?? bones.pelvis;
    root.updateMatrixWorld(true);
    const scale = bones.pelvis.getWorldPosition(new THREE.Vector3()).distanceTo(bones.chest.getWorldPosition(new THREE.Vector3())) / REFERENCE_PELVIS_TO_CHEST;
    for (const part of RAGDOLL_PARTS) {
      const bone = bones[part.bone];
      bone.matrixWorld.decompose(tmpV, tmpQ, tmpS);
      const kinematic = part.bone === 'pelvis' && opts.kinematicPelvis;
      const handle = engine.createBody({
        kind: kinematic ? 'kinematic' : 'dynamic',
        position: { x: tmpV.x, y: tmpV.y, z: tmpV.z },
        rotation: q3(tmpQ),
        ...(opts.velocity ? { linvel: opts.velocity } : {}),
        linearDamping: 0.1,
        angularDamping: 0.9,
      });
      for (const s of part.shapes) engine.createCollider(scaled(s, scale, opts.group, opts.density ?? 1000), handle);
      let joint: JointHandle | null = null;
      if (part.parent && part.joint) {
        const parent = this.byBone.get(part.parent);
        if (!parent) throw new Error(`ragdoll: ${part.bone} before its parent ${part.parent}`);
        // Anchor: this bone's origin, in the parent body's frame.
        const parentBone = bones[part.parent];
        parentBone.matrixWorld.decompose(tmpS, tmpQ2, new THREE.Vector3());
        const anchorA = bone.getWorldPosition(new THREE.Vector3()).sub(tmpS).applyQuaternion(tmpQ2.invert());
        const a = { x: anchorA.x, y: anchorA.y, z: anchorA.z };
        joint =
          part.joint.kind === 'spherical'
            ? engine.createJoint({ kind: 'spherical', anchorA: a, anchorB: { x: 0, y: 0, z: 0 }, limits: part.joint.limits }, parent.handle, handle)
            : engine.createJoint({ kind: 'revolute', anchorA: a, anchorB: { x: 0, y: 0, z: 0 }, axis: { x: 1, y: 0, z: 0 }, limits: part.joint.limits }, parent.handle, handle);
      }
      const body: Body = { part, handle, joint };
      this.bodies.push(body);
      this.byBone.set(part.bone, body);
    }
  }

  body(bone: JointName): BodyHandle | undefined {
    return this.byBone.get(bone)?.handle;
  }

  /** Write every body's pose onto its bone (parents first); bones without a body keep their animated local pose. */
  writeBones(): void {
    for (const b of this.bodies) {
      const bone = this.bones[b.part.bone];
      const t = this.engine.transform(b.handle);
      bone.matrixWorld.decompose(tmpV, tmpQ, tmpS);
      tmpM.compose(tmpV.set(t.position.x, t.position.y, t.position.z), tmpQ.set(t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w), tmpS);
      const parent = bone.parent;
      if (parent) {
        parent.updateMatrixWorld(true);
        tmpM2.copy(parent.matrixWorld).invert().multiply(tmpM);
      } else {
        tmpM2.copy(tmpM);
      }
      tmpM2.decompose(bone.position, bone.quaternion, tmpS);
      bone.updateMatrixWorld(true);
    }
  }

  /**
   * Drive every joint toward the bones' current (animated) pose: call after the animator ran and before
   * `writeBones`. Ball joints get per-axis targets from the relative rotation's scaled vector part; hinges get
   * their angle about X. The kinematic pelvis (if any) follows its bone.
   */
  driveToBones(stiffness: number, damping: number, model: 'acceleration' | 'force' = 'acceleration'): void {
    for (const b of this.bodies) {
      const bone = this.bones[b.part.bone];
      if (!b.joint || !b.part.parent) {
        bone.matrixWorld.decompose(tmpV, tmpQ, tmpS);
        this.engine.setTransform(b.handle, { position: { x: tmpV.x, y: tmpV.y, z: tmpV.z }, rotation: q3(tmpQ) });
        continue;
      }
      this.bones[b.part.parent].matrixWorld.decompose(tmpV, tmpQ2, tmpS);
      bone.matrixWorld.decompose(tmpV, tmpQ, tmpS);
      const rel = tmpQ2.invert().multiply(tmpQ);
      if (rel.w < 0) rel.set(-rel.x, -rel.y, -rel.z, -rel.w);
      const angles =
        b.part.joint?.kind === 'revolute'
          ? { x: 2 * Math.atan2(rel.x, rel.w) }
          : { x: 2 * Math.asin(THREE.MathUtils.clamp(rel.x, -1, 1)), y: 2 * Math.asin(THREE.MathUtils.clamp(rel.y, -1, 1)), z: 2 * Math.asin(THREE.MathUtils.clamp(rel.z, -1, 1)) };
      this.engine.setMotor(b.joint, { angles, stiffness, damping, model });
    }
  }

  /**
   * Physical animation: pull every dynamic body toward its bone's current (animated) world pose with a damped
   * spring on its velocity, independently of the joint chain. `stiffness` is in 1/s^2, `damping` in 1/s; a hit
   * knocks a body off its pose and the spring brings it back. The kinematic pelvis (if any) follows its bone.
   */
  driveToBonesWorld(stiffness: number, damping: number, dt: number, gravity = -9.81): void {
    for (const b of this.bodies) {
      const bone = this.bones[b.part.bone];
      bone.matrixWorld.decompose(tmpV, tmpQ, tmpS);
      // Feed-forward: the animation's own velocity (so the spring does not lag a moving pose).
      const prev = this.prevTarget.get(b.part.bone);
      const tv = prev && dt > 0 ? { x: (tmpV.x - prev.x) / dt, y: (tmpV.y - prev.y) / dt, z: (tmpV.z - prev.z) / dt } : { x: 0, y: 0, z: 0 };
      this.prevTarget.set(b.part.bone, { x: tmpV.x, y: tmpV.y, z: tmpV.z });
      if (!b.joint || !b.part.parent) {
        if (b.part.bone === 'pelvis' && this.kinematicPelvis) {
          this.engine.setTransform(b.handle, { position: { x: tmpV.x, y: tmpV.y, z: tmpV.z }, rotation: q3(tmpQ) });
          continue;
        }
      }
      const t = this.engine.transform(b.handle);
      const v = this.engine.linvel(b.handle);
      const w = this.engine.angvel(b.handle);
      // Linear: v += (k * (target - p) + c * (targetVel - v)) * dt, plus cancelling this step's gravity.
      const lin = {
        x: v.x + (stiffness * (tmpV.x - t.position.x) + damping * (tv.x - v.x)) * dt,
        y: v.y + (stiffness * (tmpV.y - t.position.y) + damping * (tv.y - v.y)) * dt - gravity * dt,
        z: v.z + (stiffness * (tmpV.z - t.position.z) + damping * (tv.z - v.z)) * dt,
      };
      // Angular: the rotation from the body to the target as an axis-angle vector.
      tmpQ2.set(t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w).invert().premultiply(tmpQ);
      if (tmpQ2.w < 0) tmpQ2.set(-tmpQ2.x, -tmpQ2.y, -tmpQ2.z, -tmpQ2.w);
      const s = Math.sqrt(Math.max(0, 1 - tmpQ2.w * tmpQ2.w));
      const angle = 2 * Math.acos(Math.min(1, tmpQ2.w));
      const k = s < 1e-6 ? 0 : angle / s;
      const ang = {
        x: w.x + (stiffness * tmpQ2.x * k - damping * w.x) * dt,
        y: w.y + (stiffness * tmpQ2.y * k - damping * w.y) * dt,
        z: w.z + (stiffness * tmpQ2.z * k - damping * w.z) * dt,
      };
      this.engine.setVelocity(b.handle, lin, ang);
    }
  }

  /** Largest distance (m) between a body and its bone's current world position. */
  poseError(): number {
    let worst = 0;
    for (const b of this.bodies) {
      const p = this.engine.transform(b.handle).position;
      worst = Math.max(worst, this.bones[b.part.bone].getWorldPosition(tmpV).distanceTo(tmpS.set(p.x, p.y, p.z)));
    }
    return worst;
  }

  /** Fastest body speed (m/s); near zero once the ragdoll has settled. */
  maxSpeed(): number {
    let fastest = 0;
    for (const b of this.bodies) {
      const v = this.engine.linvel(b.handle);
      fastest = Math.max(fastest, Math.hypot(v.x, v.y, v.z));
    }
    return fastest;
  }

  asleep(): boolean {
    return this.bodies.every((b) => this.engine.isSleeping(b.handle));
  }

  destroy(): void {
    for (const b of this.bodies) if (b.joint !== null) this.engine.destroyJoint(b.joint);
    for (const b of this.bodies) this.engine.destroyBody(b.handle);
    this.bodies.length = 0;
    this.byBone.clear();
  }
}

function scaled(s: ColliderDesc, k: number, group: number, density: number): ColliderDesc {
  const o = s.offset ?? { x: 0, y: 0, z: 0 };
  const shape =
    s.shape.kind === 'cuboid'
      ? { kind: 'cuboid' as const, halfExtents: { x: s.shape.halfExtents.x * k, y: s.shape.halfExtents.y * k, z: s.shape.halfExtents.z * k } }
      : s.shape.kind === 'ball'
        ? { kind: 'ball' as const, radius: s.shape.radius * k }
        : { kind: 'capsule' as const, halfHeight: s.shape.halfHeight * k, radius: s.shape.radius * k };
  return { ...s, shape, offset: { x: o.x * k, y: o.y * k, z: o.z * k }, density, friction: 0.8, noCollideGroup: group };
}
