import * as THREE from 'three';
import { checkCreaturePoses, type CreatureDef, type CreaturePoseFile, type Role } from '../../data/types/creatures.ts';
import { clampRotation, compileLimit, limitUse, swingTwist, type CompiledLimit } from './limits.ts';
import { LimbSolver, type LimbSide } from './limbIk.ts';
import { LookAt } from './lookAt.ts';

/**
 * A creature rig (openspec rig-juggernaut, spec `creature-rig`): the creature's own joints, outside the humanoid skeleton.
 * Build it on a model loaded in its neutral pose. Each `update` evaluates, in this order (design D7):
 *   neutral -> base pose (a named pose, or a blend into one) -> partial face poses (jaw, tongue) -> per-joint adjustments ->
 *   arm and leg IK -> look-at -> one matrix update.
 * Every step writes local rotations and clamps the joints it writes to their limits, and nothing carries over between frames
 * except the blend timer, so the same inputs always give the same pose.
 */

export interface RigJoint {
  /** Name as in the creature data (the model file's spelling). */
  readonly name: string;
  readonly bone: THREE.Object3D;
  readonly role: Role;
  readonly limit: CompiledLimit;
  readonly neutralQ: THREE.Quaternion;
  readonly neutralT: THREE.Vector3;
  readonly neutralS: THREE.Vector3;
}

/** A joint's pose relative to neutral. */
interface Delta {
  q: THREE.Quaternion;
  t: THREE.Vector3;
  s: THREE.Vector3;
}

type CompiledPose = Map<RigJoint, Delta>;

const D2R = Math.PI / 180;
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

function identity(): Delta {
  return { q: new THREE.Quaternion(), t: new THREE.Vector3(), s: new THREE.Vector3(1, 1, 1) };
}

/** Look a joint up by the data's name or three.js's sanitised one (dots removed). */
function findBone(model: THREE.Object3D, name: string): THREE.Object3D | undefined {
  return model.getObjectByName(name) ?? model.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
}

const smooth = (x: number): number => x * x * (3 - 2 * x);

export class CreatureRig {
  readonly model: THREE.Object3D;
  readonly def: CreatureDef;
  readonly joints: readonly RigJoint[];
  readonly aimMarker: THREE.Object3D;
  private readonly byName = new Map<string, RigJoint>();
  private readonly poses = new Map<string, CompiledPose>();
  private readonly partialPoses: { jaw: CompiledPose; tongueExtend: CompiledPose; tongueCurl: CompiledPose };

  private from = new Map<RigJoint, Delta>();
  private target: CompiledPose | null = null;
  private targetName: string | null = null;
  private blendTime = 0;
  private blendDuration = 0;
  private readonly face = { jaw: 0, tongueExtend: 0, tongueCurl: 0 };
  /** Per-joint adjustments on top of the base and face poses, before IK (the sandbox's chain rotation; later, motion layers). */
  private readonly adjust = new Map<RigJoint, THREE.Quaternion>();
  private readonly work = new Map<RigJoint, Delta>();
  private readonly limbs: Record<LimbSide, LimbSolver>;
  private readonly look: LookAt;
  private readonly limitHits = new Set<RigJoint>();

  constructor(model: THREE.Object3D, def: CreatureDef, poses: CreaturePoseFile, source = 'creature') {
    checkCreaturePoses(def, poses, `${source}/poses.json`);
    this.model = model;
    this.def = def;
    const joints: RigJoint[] = [];
    for (const [role, names] of Object.entries(def.chains) as [Role, string[]][]) {
      for (const name of names) {
        const bone = findBone(model, name);
        if (!bone) throw new Error(`${source}: the model has no joint "${name}" (chain ${role})`);
        const joint: RigJoint = {
          name,
          bone,
          role,
          limit: compileLimit(def.limits[name]!),
          neutralQ: bone.quaternion.clone(),
          neutralT: bone.position.clone(),
          neutralS: bone.scale.clone(),
        };
        joints.push(joint);
        this.byName.set(name, joint);
        this.work.set(joint, identity());
      }
    }
    this.joints = joints;
    const marker = findBone(model, def.aimMarker);
    if (!marker) throw new Error(`${source}: the model has no aim marker "${def.aimMarker}"`);
    this.aimMarker = marker;
    for (const [name, data] of Object.entries(poses.poses)) {
      const pose: CompiledPose = new Map();
      const names = new Set([...Object.keys(data.joints), ...Object.keys(data.offsets ?? {}), ...Object.keys(data.scales ?? {})]);
      for (const jn of names) {
        const joint = this.byName.get(jn);
        if (!joint) throw new Error(`${source}: pose "${name}" names joint "${jn}", which the rig does not have`);
        const d = identity();
        const r = data.joints[jn];
        if (r) d.q.setFromEuler(_e.set(r[0] * D2R, r[1] * D2R, r[2] * D2R, 'XYZ'));
        const o = data.offsets?.[jn];
        if (o) d.t.set(...o);
        const s = data.scales?.[jn];
        if (s) d.s.set(...s);
        pose.set(joint, d);
      }
      this.poses.set(name, pose);
    }
    this.partialPoses = {
      jaw: this.poses.get(def.face.jawOpen)!,
      tongueExtend: this.poses.get(def.face.tongueExtend)!,
      tongueCurl: this.poses.get(def.face.tongueCurl)!,
    };
    model.updateMatrixWorld(true);
    this.limbs = {
      'arm.L': new LimbSolver(this, 'arm.L'),
      'arm.R': new LimbSolver(this, 'arm.R'),
      'leg.L': new LimbSolver(this, 'leg.L'),
      'leg.R': new LimbSolver(this, 'leg.R'),
    };
    this.look = new LookAt(this);
  }

  joint(name: string): RigJoint {
    const j = this.byName.get(name);
    if (!j) throw new Error(`no rig joint "${name}"`);
    return j;
  }

  chain(role: Role): RigJoint[] {
    return (this.def.chains[role] ?? []).map((n) => this.joint(n));
  }

  /** The named poses this rig knows. */
  poseNames(): string[] {
    return [...this.poses.keys()];
  }

  /** The base pose and how far its blend has run (0..1). */
  get basePose(): { name: string | null; progress: number } {
    return { name: this.targetName, progress: this.blendDuration > 0 ? Math.min(1, this.blendTime / this.blendDuration) : 1 };
  }

  /** Blend the base pose into a named pose (null: neutral) over `seconds`, starting from wherever it is now. */
  setPose(name: string | null, seconds = 0): void {
    const pose = name === null ? new Map<RigJoint, Delta>() : this.poses.get(name);
    if (!pose) throw new Error(`unknown pose "${name}"`);
    const from = new Map<RigJoint, Delta>();
    for (const j of this.joints) from.set(j, this.baseDelta(j, identity()));
    this.from = from;
    this.target = pose;
    this.targetName = name;
    this.blendTime = 0;
    this.blendDuration = Math.max(0, seconds);
  }

  /** Jaw opening and tongue extension and curl, each 0..1 (design D8). */
  setFace(face: { jaw?: number; tongueExtend?: number; tongueCurl?: number }): void {
    const c = (x: number | undefined, prev: number) => (x === undefined ? prev : THREE.MathUtils.clamp(x, 0, 1));
    this.face.jaw = c(face.jaw, this.face.jaw);
    this.face.tongueExtend = c(face.tongueExtend, this.face.tongueExtend);
    this.face.tongueCurl = c(face.tongueCurl, this.face.tongueCurl);
  }

  getFace(): Readonly<{ jaw: number; tongueExtend: number; tongueCurl: number }> {
    return this.face;
  }

  /** Rotate a joint by `q` (in its own frame) on top of the base and face poses; null removes the adjustment. */
  setAdjustment(name: string, q: THREE.Quaternion | null): void {
    const j = this.joint(name);
    if (q) this.adjust.set(j, q.clone());
    else this.adjust.delete(j);
  }

  getAdjustment(name: string): THREE.Quaternion | null {
    return this.adjust.get(this.joint(name))?.clone() ?? null;
  }

  clearAdjustments(): void {
    this.adjust.clear();
  }

  /** IK target for a hand (its root) or a foot (its sole contact point), in world metres; null releases it. */
  setLimbTarget(side: LimbSide, target: THREE.Vector3 | null, options: { pole?: THREE.Vector3; groundNormal?: THREE.Vector3 } = {}): void {
    this.limbs[side].setTarget(target, options);
  }

  /** How much a limb's IK wins over the base pose (0..1); 0 lets a pose lift a planted hand off its target. */
  setLimbWeight(side: LimbSide, weight: number): void {
    this.limbs[side].weight = THREE.MathUtils.clamp(weight, 0, 1);
  }

  limb(side: LimbSide): LimbSolver {
    return this.limbs[side];
  }

  /** World point for the head and eyes to look at; null releases it. */
  setLookTarget(target: THREE.Vector3 | null): void {
    this.look.setTarget(target);
  }

  /** How much the look-at wins over the pose (0..1); a roar lowers it so its head movement shows. */
  setLookWeight(weight: number): void {
    this.look.weight = THREE.MathUtils.clamp(weight, 0, 1);
  }

  get lookAt(): LookAt {
    return this.look;
  }

  /** Advance the blend timer by `dt` seconds and evaluate the pose. */
  update(dt: number): void {
    if (this.blendTime < this.blendDuration) this.blendTime = Math.min(this.blendDuration, this.blendTime + Math.max(0, dt));
    this.limitHits.clear();
    for (const j of this.joints) {
      const d = this.baseDelta(j, this.work.get(j)!);
      this.applyPartial(this.partialPoses.jaw, this.face.jaw, j, d);
      this.applyPartial(this.partialPoses.tongueExtend, this.face.tongueExtend, j, d);
      this.applyPartial(this.partialPoses.tongueCurl, this.face.tongueCurl, j, d);
      const a = this.adjust.get(j);
      if (a) d.q.multiply(a);
      this.write(j, d.q, d.t, d.s);
    }
    this.model.updateMatrixWorld(true);
    for (const side of ['arm.L', 'arm.R', 'leg.L', 'leg.R'] as const) this.limbs[side].solve();
    this.look.solve();
    this.model.updateMatrixWorld(true);
  }

  /**
   * Set a joint from a rotation relative to neutral (clamped to its limit) and optional offset and scale. Returns true when
   * the limit moved the rotation.
   */
  write(j: RigJoint, delta: THREE.Quaternion, offset?: THREE.Vector3, scale?: THREE.Vector3): boolean {
    _q.copy(delta);
    const clamped = clampRotation(_q, j.limit);
    if (clamped) this.limitHits.add(j);
    j.bone.quaternion.copy(j.neutralQ).multiply(_q);
    if (offset) j.bone.position.copy(j.neutralT).add(offset);
    if (scale) j.bone.scale.copy(j.neutralS).multiply(scale);
    return clamped;
  }

  /** Set a joint's local rotation (not relative to neutral), clamped to its limit. */
  writeLocal(j: RigJoint, local: THREE.Quaternion): boolean {
    return this.write(j, _qDelta.copy(j.neutralQ).invert().multiply(local));
  }

  /** A joint's current rotation relative to neutral. */
  delta(j: RigJoint, out = new THREE.Quaternion()): THREE.Quaternion {
    return out.copy(j.neutralQ).invert().multiply(j.bone.quaternion);
  }

  /**
   * Joints resting at a limit now: a twist end or the swing ellipse within `tolerance` (fraction of the bound), or clamped
   * in the last update.
   */
  jointsAtLimit(tolerance = 0.995): RigJoint[] {
    const out: RigJoint[] = [];
    const st = { twist: 0, su: 0, sv: 0 };
    for (const j of this.joints) {
      swingTwist(this.delta(j, _qDelta), j.limit, st);
      const use = limitUse(st, j.limit);
      if (this.limitHits.has(j) || use.twist >= tolerance || use.swing >= tolerance) out.push(j);
    }
    return out;
  }

  /** The aim point the squad tracks: the aim marker's world position. */
  aimPoint(out: THREE.Vector3): THREE.Vector3 {
    return this.aimMarker.getWorldPosition(out);
  }

  /** Metres per model unit at the model's current scale. */
  worldScale(): number {
    return new THREE.Vector3().setFromMatrixScale(this.model.matrixWorld).x;
  }

  private baseDelta(j: RigJoint, out: Delta): Delta {
    const from = this.from.get(j);
    const to = this.target?.get(j);
    const k = this.blendDuration > 0 ? smooth(Math.min(1, this.blendTime / this.blendDuration)) : 1;
    const a = from ?? IDENTITY;
    const b = this.target ? (to ?? IDENTITY) : a;
    out.q.copy(a.q).slerp(b.q, k);
    out.t.copy(a.t).lerp(b.t, k);
    out.s.copy(a.s).lerp(b.s, k);
    return out;
  }

  private applyPartial(pose: CompiledPose, amount: number, j: RigJoint, d: Delta): void {
    if (amount <= 0) return;
    const p = pose.get(j);
    if (!p) return;
    d.q.slerp(p.q, amount);
    d.t.lerp(p.t, amount);
    d.s.lerp(p.s, amount);
  }
}

const IDENTITY: Delta = identity();
const _qDelta = new THREE.Quaternion();

/** Pairs of mirrored joints (".L" / ".R" with the numeric suffix ignored). */
export function mirrorPairs(rig: CreatureRig): Array<[RigJoint, RigJoint]> {
  const key = (n: string) => n.replace(/_\d+$/, '');
  const byKey = new Map(rig.joints.map((j) => [key(j.name), j]));
  const out: Array<[RigJoint, RigJoint]> = [];
  for (const j of rig.joints) {
    const k = key(j.name);
    if (!k.includes('.L')) continue;
    const r = byKey.get(k.replace('.L', '.R'));
    if (r) out.push([j, r]);
  }
  return out;
}
