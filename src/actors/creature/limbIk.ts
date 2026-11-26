import * as THREE from 'three';
import type { CreatureRig, RigJoint } from './rig.ts';

/**
 * Limb IK for a creature rig (openspec rig-juggernaut D12). A limb is a root ball joint (upper arm, thigh), one or two hinges
 * (elbow; knee and hock) and an end joint (hand, foot). The hinges stay pure hinges:
 *   1. their angle is found from the distance between the root and the target. A leg's two hinges turn together, the hock by
 *      the knee's angle plus a fixed offset, so the third segment keeps its angle to the thigh (the `hock` angle in the data):
 *      a pantograph;
 *   2. the root swings so the limb points at the target;
 *   3. the root rolls about that line so the elbow or knee lies on the pole's side.
 * Then everything is clamped to its limits. A foot target is the sole's contact point; the foot is laid on the ground normal.
 * `three`'s shortest-arc aim (as `solveTwoBone` uses) is not used here: it tilts the lower bone off its hinge.
 */

export type LimbSide = 'arm.L' | 'arm.R' | 'leg.L' | 'leg.R';

const UP = new THREE.Vector3(0, 1, 0);
const D2R = Math.PI / 180;
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

function signedAngle(a: THREE.Vector3, b: THREE.Vector3, n: THREE.Vector3): number {
  return Math.atan2(_v3.crossVectors(a, b).dot(n), a.dot(b));
}

export class LimbSolver {
  readonly side: LimbSide;
  readonly isLeg: boolean;
  readonly root: RigJoint;
  readonly hinges: readonly RigJoint[];
  readonly end: RigJoint;
  /** Added to the shared hinge angle per hinge (radians): 0 for the elbow and knee, the pantograph offset for the hock. */
  readonly hingeOffsets: readonly number[];
  /** Distance from the hip or shoulder to the target the last solve left (m), or 0 without a target. */
  lastError = 0;
  /** How much the solve wins over the base pose (0..1): 0 leaves the limb to its pose, 1 plants it on the target. */
  weight = 1;

  private readonly rig: CreatureRig;
  private readonly poleModel: THREE.Vector3;
  private target: THREE.Vector3 | null = null;
  private poleWorld: THREE.Vector3 | null = null;
  private groundNormal = UP.clone();
  // Feet, captured in the neutral pose.
  private readonly footNeutralModelQ = new THREE.Quaternion();
  private readonly footUpLocal = new THREE.Vector3();
  private readonly contactLocal = new THREE.Vector3();
  private readonly footVecModel = new THREE.Vector3();

  constructor(rig: CreatureRig, side: LimbSide) {
    this.rig = rig;
    this.side = side;
    this.isLeg = side.startsWith('leg');
    const chain = rig.chain(side);
    if (this.isLeg) {
      this.root = chain[0]!;
      this.hinges = [chain[1]!, chain[2]!];
      this.end = chain[3]!;
    } else {
      this.root = chain[1]!;
      this.hinges = [chain[2]!];
      this.end = chain[3]!;
    }
    for (const h of this.hinges) {
      if (h.limit.kind !== 'hinge') throw new Error(`${side}: ${h.name} must be a hinge`);
    }
    const ik = rig.def.ik[side];
    this.poleModel = new THREE.Vector3(...ik.pole).normalize();
    const modelInv = new THREE.Matrix4().copy(rig.model.matrixWorld).invert();
    const modelQ = rig.model.getWorldQuaternion(new THREE.Quaternion());
    if (this.isLeg) {
      // Pantograph offset: the hock turns by the knee's angle plus this, so the third segment keeps `hock` to the thigh.
      const neutralAngle = this.thighToThird(0, 0);
      const slope = (this.thighToThird(0, 0.01) - neutralAngle) / 0.01;
      const want = 'hock' in ik ? ik.hock * D2R : neutralAngle;
      this.hingeOffsets = [0, (want - neutralAngle) / slope];
      // Foot: neutral orientation in the model frame, its "up", and the contact point under the toe on the lowest skin.
      const footQ = this.end.bone.getWorldQuaternion(new THREE.Quaternion());
      this.footNeutralModelQ.copy(modelQ).invert().multiply(footQ);
      this.footUpLocal.copy(UP).applyQuaternion(modelQ).applyQuaternion(footQ.clone().invert());
      const toe = this.end.bone.children.find((c) => (c as THREE.Bone).isBone);
      const toeModel = (toe ?? this.end.bone).getWorldPosition(new THREE.Vector3()).applyMatrix4(modelInv);
      const contactModel = new THREE.Vector3(toeModel.x, lowestSkinY(rig.model, modelInv), toeModel.z);
      const ankleModel = this.end.bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(modelInv);
      this.footVecModel.subVectors(ankleModel, contactModel);
      this.contactLocal.copy(contactModel).applyMatrix4(rig.model.matrixWorld).applyMatrix4(_m.copy(this.end.bone.matrixWorld).invert());
    } else {
      this.hingeOffsets = [0];
    }
  }

  /**
   * Set the target in world metres (a hand's root, or a foot's sole contact point), or null to release the limb to its base
   * pose. `pole` is a world direction for the elbow or knee (default: the data's pole, turned with the model); `groundNormal`
   * the floor's normal under a foot (default: up).
   */
  setTarget(target: THREE.Vector3 | null, options: { pole?: THREE.Vector3; groundNormal?: THREE.Vector3 } = {}): void {
    this.target = target ? target.clone() : null;
    this.poleWorld = options.pole ? options.pole.clone().normalize() : null;
    this.groundNormal = (options.groundNormal ?? UP).clone().normalize();
    if (!target) this.lastError = 0;
  }

  get hasTarget(): boolean {
    return this.target !== null;
  }

  /** The point that meets the target: the hand's root, or the foot's sole contact point (world). */
  contactPoint(out: THREE.Vector3): THREE.Vector3 {
    if (!this.isLeg) return this.end.bone.getWorldPosition(out);
    return out.copy(this.contactLocal).applyMatrix4(this.end.bone.matrixWorld);
  }

  /** The foot's up direction (world), which lies along the ground normal when the foot is planted. */
  soleUp(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.footUpLocal).applyQuaternion(this.end.bone.getWorldQuaternion(_q2)).normalize();
  }

  /** Lengths of the limb's segments in metres at the current scale (root to first hinge, ..., last hinge to end). */
  segmentLengths(): number[] {
    const pts = [this.root, ...this.hinges, this.end].map((j) => j.bone.getWorldPosition(new THREE.Vector3()));
    return pts.slice(1).map((p, i) => p.distanceTo(pts[i]!));
  }

  solve(): void {
    if (!this.target || this.weight <= 0) return;
    const chain = [this.root, ...this.hinges, this.end];
    const before = this.weight < 1 ? chain.map((j) => j.bone.quaternion.clone()) : null;
    const rig = this.rig;
    const modelQ = rig.model.getWorldQuaternion(new THREE.Quaternion());
    const scale = rig.worldScale();
    // Where the end joint has to go.
    const endTarget = new THREE.Vector3().copy(this.target);
    const footQ = new THREE.Quaternion();
    if (this.isLeg) {
      const align = new THREE.Quaternion().setFromUnitVectors(UP, this.groundNormal);
      footQ.copy(align).multiply(modelQ).multiply(this.footNeutralModelQ);
      endTarget.add(_v.copy(this.footVecModel).multiplyScalar(scale).applyQuaternion(modelQ).applyQuaternion(align));
    }
    const rootPos = this.root.bone.getWorldPosition(new THREE.Vector3());
    const rootScale = new THREE.Vector3().setFromMatrixScale(this.root.bone.matrixWorld).x;
    const want = endTarget.distanceTo(rootPos);

    // 1. Hinge angle from the distance.
    const theta = this.solveHinge(want / rootScale);
    this.hinges.forEach((h, i) => rig.write(h, _q.setFromAxisAngle(h.limit.axis, theta + this.hingeOffsets[i]!)));
    this.root.bone.updateMatrixWorld(true);

    // 2. Aim the root at the target, 3. roll the elbow or knee toward the pole.
    const endPos = this.end.bone.getWorldPosition(new THREE.Vector3());
    const toEnd = endPos.sub(rootPos).normalize();
    const toTarget = new THREE.Vector3().subVectors(endTarget, rootPos);
    if (toTarget.lengthSq() > 1e-12) {
      toTarget.normalize();
      const aim = new THREE.Quaternion().setFromUnitVectors(toEnd, toTarget);
      const mid = this.hinges[0]!.bone.getWorldPosition(new THREE.Vector3()).sub(rootPos).applyQuaternion(aim);
      const pole = this.poleWorld ? _v.copy(this.poleWorld) : _v.copy(this.poleModel).applyQuaternion(modelQ);
      mid.addScaledVector(toTarget, -mid.dot(toTarget));
      pole.addScaledVector(toTarget, -pole.dot(toTarget));
      const roll = new THREE.Quaternion();
      if (mid.lengthSq() > 1e-12 && pole.lengthSq() > 1e-12) roll.setFromAxisAngle(toTarget, signedAngle(mid.normalize(), pole.normalize(), toTarget));
      const rootWorld = this.root.bone.getWorldQuaternion(new THREE.Quaternion());
      const parentWorld = this.root.bone.parent!.getWorldQuaternion(new THREE.Quaternion());
      rig.writeLocal(this.root, parentWorld.invert().multiply(roll.multiply(aim).multiply(rootWorld)));
      this.root.bone.updateMatrixWorld(true);
    }

    // The foot lies on the ground.
    if (this.isLeg) {
      const parentWorld = this.end.bone.parent!.getWorldQuaternion(new THREE.Quaternion());
      rig.writeLocal(this.end, parentWorld.invert().multiply(footQ));
      this.end.bone.updateMatrixWorld(true);
    }
    // Part weight: each joint goes that far from its pose toward the solve (clamped, as every write is).
    if (before) {
      chain.forEach((j, i) => this.rig.writeLocal(j, before[i]!.clone().slerp(j.bone.quaternion, this.weight)));
      this.root.bone.updateMatrixWorld(true);
    }
    this.lastError = this.contactPoint(_v2).distanceTo(this.target);
  }

  /** The shared hinge angle (radians, relative to neutral) that puts the end `units` (root's local units) from the root. */
  private solveHinge(units: number): number {
    let lo = -Infinity;
    let hi = Infinity;
    this.hinges.forEach((h, i) => {
      lo = Math.max(lo, h.limit.twist[0] - this.hingeOffsets[i]!);
      hi = Math.min(hi, h.limit.twist[1] - this.hingeOffsets[i]!);
    });
    if (!(lo <= hi)) return 0;
    const f = (t: number) => this.reach(t) - units;
    // Bracket by sampling, then bisect. Bending further shortens the limb, so f falls as t grows.
    const n = 32;
    let best = lo;
    let bestErr = Infinity;
    let prevT = lo;
    let prevF = f(lo);
    for (let i = 0; i <= n; i++) {
      const t = lo + ((hi - lo) * i) / n;
      const ft = i === 0 ? prevF : f(t);
      if (Math.abs(ft) < bestErr) {
        bestErr = Math.abs(ft);
        best = t;
      }
      if (i > 0 && Math.sign(ft) !== Math.sign(prevF)) {
        let a = prevT;
        let b = t;
        let fa = prevF;
        for (let k = 0; k < 40; k++) {
          const m = (a + b) / 2;
          const fm = f(m);
          if (Math.sign(fm) === Math.sign(fa)) {
            a = m;
            fa = fm;
          } else b = m;
        }
        return (a + b) / 2;
      }
      prevT = t;
      prevF = ft;
    }
    return best;
  }

  /** Distance from the root to the end, in the root's local units, with the hinges at angle t (+ offsets). */
  private reach(t: number): number {
    _m.identity();
    let link: THREE.Object3D = this.root.bone;
    for (let i = 0; i < this.hinges.length; i++) {
      const h = this.hinges[i]!;
      void link;
      _q.copy(h.neutralQ).multiply(_q2.setFromAxisAngle(h.limit.axis, t + this.hingeOffsets[i]!));
      _m.multiply(_m2.compose(h.bone.position, _q, h.bone.scale));
      link = h.bone;
    }
    return _v.copy(this.end.bone.position).applyMatrix4(_m).length();
  }

  /** Signed angle (radians) between the thigh and the third segment in the leg's bend plane, with hinge angles k and h. */
  private thighToThird(k: number, h: number): number {
    const [knee, hock] = this.hinges as [RigJoint, RigJoint];
    // Positions in the thigh's local frame.
    const mKnee = new THREE.Matrix4().compose(knee.bone.position, knee.neutralQ.clone().multiply(new THREE.Quaternion().setFromAxisAngle(knee.limit.axis, k)), knee.bone.scale);
    const mHock = new THREE.Matrix4().compose(hock.bone.position, hock.neutralQ.clone().multiply(new THREE.Quaternion().setFromAxisAngle(hock.limit.axis, h)), hock.bone.scale);
    const pKnee = knee.bone.position.clone();
    const pHock = hock.bone.position.clone().applyMatrix4(mKnee);
    const pAnkle = this.end.bone.position.clone().applyMatrix4(mKnee.clone().multiply(mHock));
    const thigh = pKnee.clone().normalize();
    const third = pAnkle.clone().sub(pHock).normalize();
    const normal = new THREE.Vector3().crossVectors(pKnee, pHock.clone().sub(pKnee)).normalize();
    return signedAngle(thigh, third, normal);
  }
}

/** Lowest skinned vertex of the model's meshes, in the model's frame. */
function lowestSkinY(model: THREE.Object3D, modelInv: THREE.Matrix4): number {
  let y = Infinity;
  const v = new THREE.Vector3();
  model.traverse((o) => {
    if (!(o instanceof THREE.SkinnedMesh)) return;
    const n = o.geometry.attributes.position!.count;
    for (let i = 0; i < n; i++) {
      o.getVertexPosition(i, v);
      v.applyMatrix4(o.matrixWorld).applyMatrix4(modelInv);
      if (v.y < y) y = v.y;
    }
  });
  return Number.isFinite(y) ? y : 0;
}
