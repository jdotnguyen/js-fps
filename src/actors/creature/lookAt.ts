import * as THREE from 'three';
import type { CreatureRig, RigJoint } from './rig.ts';

/**
 * Head and eye look-at for a creature rig (openspec rig-juggernaut, spec `creature-rig` "Head and eyes look at targets").
 * The neck takes `lookNeckShare` of the turn and the head the rest; then each eye aims at the target. Every joint is clamped,
 * so past the head's limit the head stops and the eyes carry on to theirs. "Forward" for the head and each eye is the model's
 * `forward` as it is in the neutral pose.
 */
export class LookAt {
  private readonly rig: CreatureRig;
  readonly neck: RigJoint;
  readonly head: RigJoint;
  readonly eyes: readonly RigJoint[];
  private readonly forwardLocal = new Map<RigJoint, THREE.Vector3>();
  private target: THREE.Vector3 | null = null;
  /** How much the look wins over the pose (0..1). */
  weight = 1;

  constructor(rig: CreatureRig) {
    this.rig = rig;
    const neck = rig.chain('neck');
    this.neck = neck[neck.length - 1]!;
    this.head = rig.chain('head')[0]!;
    this.eyes = rig.chain('eyes');
    const modelQ = rig.model.getWorldQuaternion(new THREE.Quaternion());
    const forward = new THREE.Vector3(...rig.def.forward).normalize().applyQuaternion(modelQ);
    for (const j of [this.head, ...this.eyes]) {
      const q = j.bone.getWorldQuaternion(new THREE.Quaternion()).invert();
      this.forwardLocal.set(j, forward.clone().applyQuaternion(q));
    }
  }

  setTarget(target: THREE.Vector3 | null): void {
    this.target = target ? target.clone() : null;
  }

  get hasTarget(): boolean {
    return this.target !== null;
  }

  /** A joint's forward direction in the world (the head's or an eye's). */
  forward(j: RigJoint, out: THREE.Vector3): THREE.Vector3 {
    const local = this.forwardLocal.get(j);
    if (!local) throw new Error(`${j.name} has no forward`);
    return out.copy(local).applyQuaternion(j.bone.getWorldQuaternion(_q)).normalize();
  }

  /** Angle (radians) between a joint's forward and the direction from it to the target. */
  error(j: RigJoint): number {
    if (!this.target) return 0;
    const to = _to.subVectors(this.target, j.bone.getWorldPosition(_p)).normalize();
    return this.forward(j, _f).angleTo(to);
  }

  solve(): void {
    if (!this.target || this.weight <= 0) return;
    const joints = [this.neck, this.head, ...this.eyes];
    const before = this.weight < 1 ? joints.map((j) => j.bone.quaternion.clone()) : null;
    this.turn(this.neck, this.head, this.rig.def.lookNeckShare);
    this.turn(this.head, this.head, 1);
    for (const eye of this.eyes) this.turn(eye, eye, 1);
    if (before) {
      joints.forEach((j, i) => this.rig.writeLocal(j, before[i]!.clone().slerp(j.bone.quaternion, this.weight)));
      this.neck.bone.updateMatrixWorld(true);
    }
  }

  /** Rotate `joint` so `facer`'s forward turns `share` of the way toward the target. */
  private turn(joint: RigJoint, facer: RigJoint, share: number): void {
    if (share <= 0) return;
    const from = this.forward(facer, _f);
    const to = _to.subVectors(this.target!, facer.bone.getWorldPosition(_p));
    if (to.lengthSq() < 1e-12) return;
    to.normalize();
    const full = _turn.setFromUnitVectors(from, to);
    const part = _part.identity().slerp(full, share);
    const world = joint.bone.getWorldQuaternion(_w);
    const parent = joint.bone.parent!.getWorldQuaternion(_pq);
    this.rig.writeLocal(joint, parent.invert().multiply(part.multiply(world)));
    joint.bone.updateMatrixWorld(true);
  }
}

const _q = new THREE.Quaternion();
const _w = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _turn = new THREE.Quaternion();
const _part = new THREE.Quaternion();
const _f = new THREE.Vector3();
const _to = new THREE.Vector3();
const _p = new THREE.Vector3();
