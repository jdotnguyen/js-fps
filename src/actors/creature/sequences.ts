import * as THREE from 'three';
import type { CreaturePoseFile, SequenceStep } from '../../data/types/creatures.ts';
import type { CreatureRig, RigJoint } from './rig.ts';

/**
 * Plays a creature's key-pose sequences (openspec juggernaut-walk-and-roar D5, spec creature-motion "Key-pose sequences play
 * over the walk"). Each step blends the rig's base pose into its pose, ramps the jaw and tongue to its amounts over the blend,
 * and fades a tremble (summed sines on the neck, head and jaw, seeded so a replay is identical) to its amplitude; then it
 * holds. The limbs are left to the gait's IK, so a sequence plays over a walk. When the last hold ends the sequence is
 * finished: its last pose and face stay, its tremble stops. Call `update(dt)` before `rig.update(dt)`.
 */
export class SequencePlayer {
  private readonly rig: CreatureRig;
  private readonly sequences: Record<string, SequenceStep[]>;
  private readonly trembleJoints: RigJoint[];
  private readonly phases: number[];
  private steps: SequenceStep[] = [];
  private name: string | null = null;
  private index = -1;
  private stepStart = 0;
  private t = 0;
  private face0 = { jaw: 0, tongueExtend: 0, tongueCurl: 0 };
  private hands = 1;
  private hands0 = 1;
  private look = 1;
  private look0 = 1;
  private tremble0 = 0;
  private tremble = 0;
  private done = true;

  constructor(rig: CreatureRig, file: CreaturePoseFile, seed = 1) {
    this.rig = rig;
    this.sequences = file.sequences ?? {};
    const neck = rig.chain('neck');
    this.trembleJoints = [neck[neck.length - 1]!, rig.chain('head')[0]!, rig.chain('jaw')[0]!];
    // Three phases per joint per axis, from the seed.
    let a = seed >>> 0;
    const rnd = () => {
      a = (a * 1664525 + 1013904223) >>> 0;
      return a / 4294967296;
    };
    this.phases = Array.from({ length: this.trembleJoints.length * 3 * 3 }, () => rnd() * Math.PI * 2);
  }

  /** The sequence playing (or last played, once finished), or null. */
  get playing(): string | null {
    return this.done ? null : this.name;
  }

  get finished(): boolean {
    return this.done;
  }

  /** Seconds since the sequence started. */
  get elapsed(): number {
    return this.t;
  }

  /** Total length of a sequence (s). */
  duration(name: string): number {
    const steps = this.sequences[name];
    if (!steps) throw new Error(`unknown sequence "${name}"`);
    return steps.reduce((s, x) => s + x.blend + x.hold, 0);
  }

  names(): string[] {
    return Object.keys(this.sequences);
  }

  play(name: string): void {
    const steps = this.sequences[name];
    if (!steps) throw new Error(`unknown sequence "${name}"`);
    this.steps = steps;
    this.name = name;
    this.t = 0;
    this.done = false;
    this.index = -1;
    this.stepStart = 0;
    this.begin(0);
  }

  /** Stop now: the pose and face stay where they are, the tremble stops. */
  stop(): void {
    this.done = true;
    this.clearTremble();
  }

  update(dt: number): void {
    if (this.done) return;
    this.t += Math.max(0, dt);
    while (!this.done) {
      const s = this.steps[this.index]!;
      const end = this.stepStart + s.blend + s.hold;
      if (this.t + 1e-9 < end) break;
      if (this.index + 1 < this.steps.length) this.begin(this.index + 1);
      else {
        this.applyStep(s, 1);
        this.done = true;
        this.clearTremble();
        return;
      }
    }
    const s = this.steps[this.index]!;
    const k = s.blend > 0 ? THREE.MathUtils.clamp((this.t - this.stepStart) / s.blend, 0, 1) : 1;
    this.applyStep(s, k * k * (3 - 2 * k));
  }

  private begin(i: number): void {
    const prev = this.index >= 0 ? this.steps[this.index]! : null;
    this.stepStart = prev ? this.stepStart + prev.blend + prev.hold : 0;
    this.index = i;
    const s = this.steps[i]!;
    this.face0 = { ...this.rig.getFace() };
    this.tremble0 = this.tremble;
    this.hands0 = this.hands;
    this.look0 = this.look;
    this.rig.setPose(s.pose, s.blend);
  }

  private applyStep(s: SequenceStep, k: number): void {
    const lerp = (a: number, b: number | undefined) => (b === undefined ? a : a + (b - a) * k);
    this.rig.setFace({ jaw: lerp(this.face0.jaw, s.jaw), tongueExtend: lerp(this.face0.tongueExtend, s.tongueExtend), tongueCurl: lerp(this.face0.tongueCurl, s.tongueCurl) });
    this.tremble = this.tremble0 + ((s.tremble ?? 0) - this.tremble0) * k;
    this.hands = lerp(this.hands0, s.hands);
    this.rig.setLimbWeight('arm.L', this.hands);
    this.rig.setLimbWeight('arm.R', this.hands);
    this.look = lerp(this.look0, s.look);
    this.rig.setLookWeight(this.look);
    this.applyTremble();
  }

  private applyTremble(): void {
    if (this.tremble <= 1e-6) {
      this.clearTremble();
      return;
    }
    const amp = THREE.MathUtils.degToRad(this.tremble);
    const f = [7.3, 11.9, 17.1];
    this.trembleJoints.forEach((j, ji) => {
      const ang = [0, 1, 2].map((axis) => {
        let v = 0;
        for (let h = 0; h < 3; h++) v += Math.sin(f[h]! * Math.PI * 2 * this.t + this.phases[(ji * 3 + axis) * 3 + h]!) / 3;
        return v * amp;
      });
      this.rig.setAdjustment(j.name, _q.setFromEuler(_e.set(ang[0]!, ang[1]!, ang[2]!, 'XYZ')));
    });
  }

  private clearTremble(): void {
    this.tremble = 0;
    for (const j of this.trembleJoints) this.rig.setAdjustment(j.name, null);
  }
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
