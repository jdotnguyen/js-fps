import * as THREE from 'three';
import type { Rng } from '../core/rng.ts';
import { blendPose, copyPose, emptyPose, type CompiledPose, type PoseLibrary } from './poses.ts';
import { JOINT_INDEX, JOINTS, type JointName } from './skeleton.ts';

/**
 * Procedural animation for one humanoid (ADR-0006): pose library blending (slerp), gait
 * cycles per locomotion style, head look-at, additive hit reactions and convulsions.
 * Writes local bone rotations; IK runs afterwards in Humanoid.
 */

export type GaitStyle = 'none' | 'walk' | 'shamble' | 'crawl' | 'drag' | 'flail';

const D2R = Math.PI / 180;
const J = JOINT_INDEX;
const N = JOINTS.length;

/** Full gait cycle length (two steps) in metres, and the speed it is tuned for. */
const STRIDE: Record<GaitStyle, number> = { none: 1, walk: 1.3, shamble: 1.05, crawl: 0.55, drag: 0.5, flail: 1.0 };
const REF_SPEED: Record<GaitStyle, number> = { none: 1, walk: 1.4, shamble: 1.3, crawl: 0.72, drag: 0.52, flail: 0.8 };

/** Spring stiffness/damping for additive hit reactions. */
const REACT_K = 140;
const REACT_C = 13;

const UP_CHAIN = new Set<JointName>(['pelvis', 'spine', 'chest', 'neck', 'head']);

interface SequenceState {
  steps: readonly { pose: string; blend: number; hold: number }[];
  index: number;
  timer: number;
  onDone: (() => void) | null;
}

export class Animator {
  gait: GaitStyle = 'none';
  /** Ground speed in m/s, set by the mover. */
  speed = 0;
  /** 0..1 strength of convulsion noise (transformation, writhing). */
  convulse = 0;
  /** Group-local look target (head/neck turn toward it), or null. */
  lookLocal: THREE.Vector3 | null = null;
  /** Joints that hang limp (Reduced gore severed limbs). */
  readonly limp = new Set<number>();

  readonly bones: THREE.Bone[];
  private readonly restPos: THREE.Vector3[];
  private readonly poses: PoseLibrary;
  private readonly current = emptyPose('current');
  private readonly from = emptyPose('from');
  private to: CompiledPose;
  private blendT = 1;
  private blendDur = 0;
  private seq: SequenceState | null = null;
  private phase = 0;
  private amp = 0;
  private time = 0;
  private readonly look = { yaw: 0, pitch: 0 };
  private readonly react = new Float32Array(N * 3);
  private readonly reactVel = new Float32Array(N * 3);
  private readonly off = new Float32Array(N * 3);
  /** Seeded asymmetry so no two shamblers move alike. */
  private readonly limpSide: 0 | 1;
  private readonly limpAmount: number;
  private readonly noiseSeed: number;

  constructor(bones: THREE.Bone[], poses: PoseLibrary, initialPose: string, rng: Rng) {
    this.bones = bones;
    this.restPos = bones.map((b) => b.position.clone());
    this.poses = poses;
    this.to = poses.get(initialPose);
    copyPose(this.to, this.current);
    this.limpSide = rng.chance(0.5) ? 0 : 1;
    this.limpAmount = rng.range(0.25, 0.75);
    this.noiseSeed = rng.range(0, 100);
    this.phase = rng.range(0, Math.PI * 2);
  }

  get poseName(): string {
    return this.to.name;
  }

  get sequencePlaying(): boolean {
    return this.seq !== null;
  }

  /** Blend to a pose from wherever the body is now. */
  setPose(name: string, blend = 0.4): void {
    if (this.to.name === name && !this.seq) return;
    this.seq = null;
    this.startBlend(this.poses.get(name), blend);
  }

  playSequence(name: string, onDone: (() => void) | null = null): void {
    const steps = this.poses.sequence(name);
    const first = steps[0];
    if (!first) return;
    this.seq = { steps, index: 0, timer: first.blend + first.hold, onDone };
    this.startBlend(this.poses.get(first.pose), first.blend);
  }

  /** Additive reaction: `dir` is the hit direction in group space, `strength` in radians. */
  kick(joint: JointName, dir: THREE.Vector3, strength: number): void {
    let name: JointName | null = joint;
    let s = strength;
    for (let depth = 0; name && depth < 3; depth++) {
      const i: number = J[name];
      const up = UP_CHAIN.has(name);
      // Limbs hang down (-Y), torso/head point up (+Y): the same push needs opposite signs.
      this.reactVel[i * 3] = (this.reactVel[i * 3] ?? 0) + (up ? dir.z : -dir.z) * s * 14;
      this.reactVel[i * 3 + 2] = (this.reactVel[i * 3 + 2] ?? 0) + (up ? -dir.x : dir.x) * s * 14;
      const parent: JointName | null = JOINTS[i]?.parent ?? null;
      name = parent;
      if (name === 'root') break;
      s *= 0.45;
    }
  }

  update(dt: number): void {
    this.time += dt;
    this.updateBlend(dt);
    this.off.fill(0);
    this.updateGait(dt);
    this.updateLook(dt);
    this.updateReactions(dt);
    this.addConvulsions();
    this.write();
  }

  // ---------------------------------------------------------------- base pose

  private startBlend(target: CompiledPose, dur: number): void {
    copyPose(this.current, this.from);
    this.to = target;
    this.blendT = 0;
    this.blendDur = Math.max(1e-3, dur);
  }

  private updateBlend(dt: number): void {
    if (this.blendT < 1) {
      this.blendT = Math.min(1, this.blendT + dt / this.blendDur);
      const s = this.blendT * this.blendT * (3 - 2 * this.blendT);
      blendPose(this.from, this.to, s, this.current);
    }
    const seq = this.seq;
    if (!seq) return;
    seq.timer -= dt;
    if (seq.timer > 0) return;
    seq.index++;
    const step = seq.steps[seq.index];
    if (!step) {
      this.seq = null;
      seq.onDone?.();
      return;
    }
    seq.timer = step.blend + step.hold;
    this.startBlend(this.poses.get(step.pose), step.blend);
  }

  // ---------------------------------------------------------------- procedural layers

  private add(name: JointName, x: number, y: number, z: number): void {
    const i = J[name] * 3;
    this.off[i] = (this.off[i] ?? 0) + x * D2R;
    this.off[i + 1] = (this.off[i + 1] ?? 0) + y * D2R;
    this.off[i + 2] = (this.off[i + 2] ?? 0) + z * D2R;
  }

  private n(t: number, k: number): number {
    const s = this.noiseSeed + k * 7.3;
    return Math.sin(t * 1.7 + s) * 0.6 + Math.sin(t * 2.9 + s * 2.1) * 0.4;
  }

  private readonly bob = new THREE.Vector3();
  private readonly rootEuler = new THREE.Vector3();

  private updateGait(dt: number): void {
    const style = this.gait;
    const targetAmp = style === 'none' ? 0 : Math.min(1.25, this.speed / REF_SPEED[style]);
    this.amp += (targetAmp - this.amp) * Math.min(1, dt * 5);
    if (style !== 'none') this.phase += (this.speed / STRIDE[style]) * Math.PI * 2 * dt;
    const A = this.amp;
    const t = this.time;
    this.bob.set(0, 0, 0);
    this.rootEuler.set(0, 0, 0);
    if (style === 'flail') this.flail(t);
    if (A < 1e-3) return;

    if (style === 'walk' || style === 'shamble' || style === 'flail') {
      const sham = style !== 'walk';
      // Lurching time warp for shamblers.
      const p = sham ? this.phase + 0.35 * Math.sin(this.phase) : this.phase;
      for (const side of [0, 1] as const) {
        const s = side === 0 ? 'L' : 'R';
        const ph = p + side * Math.PI;
        const lame = sham && side === this.limpSide;
        const stride = lame ? 1 - 0.5 * this.limpAmount : 1;
        const knee = lame ? 1 - 0.7 * this.limpAmount : 1;
        const sinp = Math.sin(ph);
        this.add(`thigh_${s}`, A * 24 * stride * sinp, 0, 0);
        this.add(`shin_${s}`, -A * (6 + 44 * Math.max(0, Math.cos(ph))) * knee, 0, 0);
        this.add(`foot_${s}`, A * 12 * Math.sin(ph - 0.6), 0, 0);
        const swing = sham ? (side === 0 ? 0.3 : 0.6) : 1;
        this.add(`upperArm_${s}`, -A * 16 * swing * sinp, 0, 0);
        this.add(`foreArm_${s}`, A * 8 * swing * (1 + sinp), 0, 0);
      }
      const sp = Math.sin(p);
      this.add('pelvis', 0, A * 5 * sp, A * 3.5 * sp);
      this.add('spine', 0, -A * 4 * sp, 0);
      this.add('chest', 0, -A * 2 * sp, -A * 2 * sp);
      if (sham) {
        const lean = this.limpSide === 0 ? -1 : 1;
        this.add('pelvis', 0, 0, lean * A * 5 * this.limpAmount * Math.max(0, Math.sin(p + this.limpSide * Math.PI)));
        this.add('neck', A * 6 * Math.cos(2 * p), 0, 0);
        this.add('head', 0, A * 6 * this.n(t * 0.5, 9), A * 5 * this.n(t * 0.4, 10));
      }
      this.bob.y = A * 0.022 * Math.cos(2 * p) - A * 0.012;
      return;
    }

    if (style === 'crawl') {
      // Prone: arms alternate reach and pull, the remaining leg pushes.
      for (const side of [0, 1] as const) {
        const s = side === 0 ? 'L' : 'R';
        const ph = this.phase + side * Math.PI;
        const sinp = Math.sin(ph);
        this.add(`upperArm_${s}`, A * 35 * sinp, 0, (side === 0 ? -1 : 1) * A * 10 * Math.cos(ph));
        this.add(`foreArm_${s}`, A * 40 * Math.max(0, -sinp), 0, 0);
        this.add(`thigh_${s}`, A * 22 * Math.sin(ph + Math.PI / 2), 0, 0);
        this.add(`shin_${s}`, -A * 30 * Math.max(0, sinp), 0, 0);
      }
      const sp = Math.sin(this.phase);
      this.rootEuler.z = A * 7 * sp;
      this.add('chest', 0, A * 6 * sp, 0);
      this.add('head', 0, -A * 6 * sp, 0);
      this.bob.y = A * 0.02 * Math.abs(sp);
      return;
    }

    if (style === 'drag') {
      // Both arms reach together and haul the body forward.
      const sp = Math.sin(this.phase);
      for (const s of ['L', 'R'] as const) {
        this.add(`upperArm_${s}`, A * 40 * sp, 0, 0);
        this.add(`foreArm_${s}`, A * 45 * Math.max(0, -sp), 0, 0);
      }
      this.add('chest', A * 9 * Math.max(0, sp), 0, 0);
      this.add('head', A * 6 * Math.max(0, sp), 0, 0);
      this.bob.y = A * 0.025 * Math.max(0, sp);
    }
  }

  /** Headless flailing: arms grope, torso sways (ADR-0006 blind state). */
  private flail(t: number): void {
    this.add('upperArm_L', 35 * this.n(t * 1.3, 1), 0, 22 * this.n(t * 1.1, 2));
    this.add('upperArm_R', 35 * this.n(t * 1.2, 3), 0, 22 * this.n(t * 1.4, 4));
    this.add('foreArm_L', 30 * Math.abs(this.n(t * 1.6, 5)), 0, 0);
    this.add('foreArm_R', 30 * Math.abs(this.n(t * 1.5, 6)), 0, 0);
    this.add('spine', 4 * this.n(t * 0.7, 7), 6 * this.n(t * 0.6, 8), 8 * this.n(t * 0.8, 9));
    this.add('neck', 18 * this.n(t * 1.9, 11), 14 * this.n(t * 2.3, 12), 0);
  }

  private updateLook(dt: number): void {
    let yaw = 0;
    let pitch = 0;
    if (this.lookLocal && (this.gait === 'none' || this.gait === 'walk' || this.gait === 'shamble')) {
      const d = this.lookLocal;
      yaw = THREE.MathUtils.clamp(Math.atan2(-d.x, -d.z), -1.2, 1.2);
      pitch = THREE.MathUtils.clamp(Math.atan2(d.y - 1.55, Math.hypot(d.x, d.z)), -0.6, 0.6);
    }
    const k = Math.min(1, dt * 4);
    this.look.yaw += (yaw - this.look.yaw) * k;
    this.look.pitch += (pitch - this.look.pitch) * k;
    const R = 180 / Math.PI;
    this.add('neck', this.look.pitch * 0.4 * R, this.look.yaw * 0.4 * R, 0);
    this.add('head', this.look.pitch * 0.6 * R, this.look.yaw * 0.6 * R, 0);
  }

  private updateReactions(dt: number): void {
    const h = Math.min(dt, 1 / 30);
    for (let i = 0; i < N * 3; i++) {
      let a = this.react[i] ?? 0;
      let v = this.reactVel[i] ?? 0;
      v += (-REACT_K * a - REACT_C * v) * h;
      a = THREE.MathUtils.clamp(a + v * h, -1, 1);
      this.react[i] = a;
      this.reactVel[i] = v;
      this.off[i] = (this.off[i] ?? 0) + a;
    }
  }

  private addConvulsions(): void {
    const c = this.convulse;
    if (c <= 0) return;
    const t = this.time;
    for (let i = 1; i < N; i++) {
      const name = JOINTS[i]?.name ?? 'root';
      const amp = (UP_CHAIN.has(name) ? 16 : name.startsWith('hand') ? 32 : 24) * c;
      // Jerky: fast sines plus a gated spike.
      const jerk = Math.sin(t * 5.3 + i * 2.1) > 0.75 ? 1.8 : 1;
      this.add(name, amp * jerk * Math.sin(t * 31 + i * 1.7) * 0.5, amp * 0.6 * Math.sin(t * 23 + i * 2.9) * 0.5, amp * jerk * Math.sin(t * 17.3 + i * 3.1) * 0.5);
    }
  }

  // ---------------------------------------------------------------- output

  private readonly e = new THREE.Euler();
  private readonly q = new THREE.Quaternion();

  private write(): void {
    const cur = this.current;
    for (let i = 0; i < N; i++) {
      const bone = this.bones[i];
      const base = cur.joints[i];
      if (!bone || !base) continue;
      const k = i * 3;
      if (this.limp.has(i)) {
        // Hang slack, swaying a little with the body; feet flop flat instead of digging in.
        const slack = JOINTS[i]?.name.startsWith('foot') ? -1.2 : 0;
        this.e.set(slack + 0.08 * Math.sin(this.time * 1.3 + i), 0, 0.06 * Math.sin(this.time * 1.7 + i));
        bone.quaternion.slerp(this.q.setFromEuler(this.e), 0.2);
        continue;
      }
      if (i === 0) {
        this.e.set(this.rootEuler.x * D2R, this.rootEuler.y * D2R, this.rootEuler.z * D2R, 'XYZ');
        bone.quaternion.copy(cur.rootRot).multiply(this.q.setFromEuler(this.e));
        bone.position.copy(cur.rootPos);
        // Prone styles bob in world up; upright ones bob the pelvis.
        if (this.gait === 'crawl' || this.gait === 'drag') bone.position.add(this.bob);
        continue;
      }
      this.e.set(this.off[k] ?? 0, this.off[k + 1] ?? 0, this.off[k + 2] ?? 0, 'XYZ');
      bone.quaternion.copy(base).multiply(this.q.setFromEuler(this.e));
    }
    const pelvis = this.bones[J.pelvis];
    const rest = this.restPos[J.pelvis];
    if (pelvis && rest) {
      pelvis.position.copy(rest).add(cur.pelvis);
      if (this.gait !== 'crawl' && this.gait !== 'drag') pelvis.position.add(this.bob);
    }
  }
}
