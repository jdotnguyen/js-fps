import * as THREE from 'three';
import type { Rng } from '../core/rng.ts';
import {
  sampleClip,
  sampleLocomotion,
  sampleZombieLocomotion,
  sharedMocapLibrary,
  resolveMotions,
  DEFAULT_MOTIONS,
  type LocomotionSample,
  type MocapLibrary,
  type MotionSet,
} from './mocap.ts';
import { blendPose, copyPose, emptyPose, type CompiledPose, type PoseLibrary } from './poses.ts';
import type { Emote } from '../data/types/dialogue.ts';
import { JOINT_INDEX, JOINTS, type JointName, type Side } from './skeleton.ts';
import { gesture, hash01, mouthOpenAt, type SpeechPlan } from './speechActing.ts';
import { Spring1D } from './springs.ts';

/**
 * Hybrid mocap + procedural-physics animation for one humanoid (ADR-0006 + Tier B upgrade):
 * - Living upright NPCs blend retargeted CC0 mocap clips (idle, idle_talk, walk, walk_formal,
 *   jog, pistol_idle, kneel_fix, crouch_idle) with phase-synchronized locomotion and foot-contact
 *   curves for world-space foot-locking IK.
 * - Layered on top: second-order spring dynamics for acceleration lean, turn banking, lateral
 *   nudge recoil, turn-in-place pivot stepping, multi-segment spring look-at (spine->chest->neck->head),
 *   per-chain staggered pose transitions (overlapping action), speech acting, and hit reactions.
 * - Enemies/infected/corpses keep their procedural horror gaits, spasms, and convulsions intact.
 */

export type GaitStyle = 'none' | 'walk' | 'shamble' | 'heavy' | 'crawl' | 'drag' | 'flail';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const J = JOINT_INDEX;
/** Joints the arm-damped layers scale (shoulder to hand, both sides). */
const ARM_JOINTS: ReadonlySet<JointName> = new Set(['shoulder_L', 'upperArm_L', 'foreArm_L', 'hand_L', 'shoulder_R', 'upperArm_R', 'foreArm_R', 'hand_R']);
const N = JOINTS.length;

/** Full gait cycle length (two steps) in metres, and the speed it is tuned for. */
const STRIDE: Record<GaitStyle, number> = { none: 1, walk: 1.3, shamble: 0.9, heavy: 1.6, crawl: 0.45, drag: 0.4, flail: 0.85 };
/** Ground speed (m/s) a crawler's limbs act as if they were making per rad/s of turn while pivoting. */
const PIVOT_DRIVE_CRAWL = 0.24;
const PIVOT_DRIVE_DRAG = 0.2;
const REF_SPEED: Record<GaitStyle, number> = { none: 1, walk: 1.4, shamble: 0.78, heavy: 0.62, crawl: 0.42, drag: 0.34, flail: 0.65 };

/** Spring stiffness/damping for additive hit reactions. */
const REACT_K = 140;
const REACT_C = 13;

const UP_CHAIN = new Set<JointName>(['pelvis', 'spine', 'chest', 'neck', 'head']);

/**
 * Per-joint transition speed multiplier for overlapping action (hierarchical follow-through):
 * core (pelvis/spine) leads pose changes, upper limbs follow, forearms/hands/head settle last.
 */
const CHAIN_SPEED: Float32Array = (() => {
  const arr = new Float32Array(N).fill(1);
  const set = (name: JointName, v: number) => {
    arr[J[name]] = v;
  };
  set('pelvis', 1.25);
  set('spine', 1.2);
  set('chest', 1.05);
  set('neck', 0.9);
  set('head', 0.78);
  set('jaw', 1.4);
  for (const s of ['L', 'R'] as const) {
    set(`shoulder_${s}`, 0.92);
    set(`upperArm_${s}`, 0.88);
    set(`foreArm_${s}`, 0.76);
    set(`hand_${s}`, 0.66);
    set(`thigh_${s}`, 1.1);
    set(`shin_${s}`, 1.0);
    set(`foot_${s}`, 0.95);
  }
  return arr;
})();

/** Upper-body joints that blend mocap with the authored horror posture (`shamble` / `blindFlail`) on enemies. */
const UPPER_BODY: ReadonlySet<JointName> = new Set([
  'spine', 'chest', 'neck', 'head',
  'shoulder_L', 'upperArm_L', 'foreArm_L', 'hand_L',
  'shoulder_R', 'upperArm_R', 'foreArm_R', 'hand_R',
]);

/** Authoring poses that can be driven or enriched by mocap clips for living human NPCs. */
const MOCAP_LOCO_POSES = new Set<string>(['idle', 'walk']);

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
  /** Turn speed in rad/s (+ = left) and heading error to the target (rad). Used by crawlers AND upright turning/banking. */
  turnRate = 0;
  turnError = 0;
  /** Character-local linear acceleration (m/s²): +fwd = accelerating forward (-Z), +lat = accelerating right (+X). */
  accelFwd = 0;
  accelLat = 0;
  /** True on the frame a heavy foot lands (hero stomp). */
  footfall = false;
  /** 0..1 strength of convulsion noise (transformation, writhing). */
  convulse = 0;
  /** Group-local look target (head/neck/chest turn toward it), or null. */
  lookLocal: THREE.Vector3 | null = null;
  /**
   * 0..1: how much ambient idle life (breathing, weight shift, arm fidgets, gaze wandering) to layer on a standing body.
   * The body sets it for living non-enemies; it fades out while walking, in a sequence, or at 0.
   */
  idleLife = 0;
  /** Enable Tier B hybrid mocap base layer for this body (living upright human NPCs). */
  useMocap = false;
  /** The clips this body idles, talks and moves with (set once by the body, see `setMotions`). */
  motions: MotionSet = DEFAULT_MOTIONS;
  /**
   * 0..1 scale on the procedural arm layers (speech gestures, idle fidgets and breathing, balance flare). A body with its own
   * motion set runs at `Animator.OWN_MOTION_ARMS`, so its captured arm motion is not buried under generated motion.
   */
  armLayer = 1;
  /** Scale `add` applies to arm joints while an arm-damped layer runs. */
  private armScale = 1;
  /** Joints that hang limp (Reduced gore severed limbs). */
  readonly limp = new Set<number>();
  /** Infection 0..1: drives the twisted posture, broken joints, jaw and twitching. */
  infect = 0;
  /** Infected movement layer on (enemies; not scripted npcs until they turn). */
  twitchy = false;
  /** 0..1 lunge: lean in, arms out, jaw wide (AI lurch bursts, attacks). */
  charge = 0;
  /** Seconds of post-mortem twitching left. */
  deathTwitch = 0;
  /** Output foot stance contacts [left, right] in 0..1 for world-space FootIkSolver. */
  readonly footContacts: [number, number] = [1, 1];

  readonly bones: THREE.Bone[];
  private readonly restPos: THREE.Vector3[];
  private readonly poses: PoseLibrary;
  private readonly mocap: MocapLibrary;
  private readonly current = emptyPose('current');
  private readonly from = emptyPose('from');
  private readonly mocapPose = emptyPose('mocap');
  private readonly finalPose = emptyPose('final');
  private readonly locoInfo: LocomotionSample = { stride: 1.25, moveWeight: 0, jogWeight: 0, contactL: 1, contactR: 1 };
  private to: CompiledPose;
  private blendT = 1;
  private blendDur = 0;
  private seq: SequenceState | null = null;
  private phase = 0;
  /** Normalized 0..1 mocap locomotion cycle phase (phase-synced walk <-> jog). */
  private locoPhase = 0;
  /** Normalized 0..1 mocap idle/action clip phase. */
  private idlePhase = 0;
  /** Smoothed 0..1 weight of the mocap base layer over authored poses. */
  private mocapW = 0;
  /** Turn-in-place stepping phase and activity weight (0..1) for upright stationary turns. */
  private pivotPhase = 0;
  private pivotW = 0;
  private amp = 0;
  private time = 0;
  private lifeW = 0;
  private readonly gaze = { yaw: 0, pitch: 0, tYaw: 0, tPitch: 0, left: 1.5 };
  private gazeState = 1;
  /** Coupled two-tier spring look-at: fast head/neck + slower chest/spine follow. */
  private readonly lookHeadYaw = new Spring1D({ f: 2.8, z: 0.88, r: 0.2 }, 0);
  private readonly lookHeadPitch = new Spring1D({ f: 2.8, z: 0.88, r: 0.2 }, 0);
  private readonly lookTorsoYaw = new Spring1D({ f: 1.4, z: 0.95, r: 0 }, 0);
  private readonly lookTorsoPitch = new Spring1D({ f: 1.4, z: 0.95, r: 0 }, 0);
  /** Second-order springs for inertial locomotion physics (lean, bank, turn lead). */
  private readonly leanFwdSpring = new Spring1D({ f: 2.4, z: 0.72, r: 0 }, 0);
  private readonly leanLatSpring = new Spring1D({ f: 2.6, z: 0.7, r: 0 }, 0);
  private readonly bankSpring = new Spring1D({ f: 2.2, z: 0.78, r: 0 }, 0);
  private readonly turnLeadSpring = new Spring1D({ f: 3.0, z: 0.85, r: 0.2 }, 0);
  private readonly speechNodSpring = new Spring1D({ f: 3.2, z: 0.85, r: 0 }, 0);
  private readonly react = new Float32Array(N * 3);
  private readonly reactVel = new Float32Array(N * 3);
  private readonly off = new Float32Array(N * 3);
  /** Seeded asymmetry so no two shamblers move alike. */
  private readonly limpSide: 0 | 1;
  private readonly limpAmount: number;
  private readonly noiseSeed: number;
  private readonly rng: Rng;
  /** Seeded deformities: head lolled to one side, a hunched shoulder, one broken limb. */
  private readonly skew: { neckRoll: number; neckYaw: number; hunch: number; broken: JointName; brokenAngle: [number, number, number] };
  private spasmTimer = 1;
  private snapTimer = 0.5;
  private readonly snap = { x: 0, y: 0, z: 0 };
  private readonly snapCur = { x: 0, y: 0, z: 0 };
  private stumble = 0;
  private stumbleTimer = 4;
  /** Limp from a wounded leg (ADR-0019): overrides the seeded lame leg while it lasts. */
  private woundSide: 0 | 1 = 0;
  private woundAmount = 0;
  private chargeCur = 0;
  /** The line being acted (ADR-0027): mouth, hands and body. Kept while it fades out after the line ends. */
  private speech: SpeechPlan | null = null;
  private speechT = 0;
  private speechW = 0;
  private speechBeat = 0;
  private speechEnding = false;
  private readonly speechSink = (joint: JointName, x: number, y: number, z: number): void => {
    this.add(joint, x, y, z);
    // Couple clavicle motion to gesturing upper arms so shoulders don't look frozen in sockets.
    if (joint === 'upperArm_L') this.add('shoulder_L', x * 0.14, y * 0.12, z * 0.18);
    else if (joint === 'upperArm_R') this.add('shoulder_R', x * 0.14, y * 0.12, z * 0.18);
  };

  constructor(bones: THREE.Bone[], poses: PoseLibrary, initialPose: string, rng: Rng, mocap?: MocapLibrary) {
    this.bones = bones;
    this.restPos = bones.map((b) => b.position.clone());
    this.poses = poses;
    this.mocap = mocap ?? sharedMocapLibrary();
    this.to = poses.get(initialPose);
    copyPose(this.to, this.current);
    copyPose(this.to, this.finalPose);
    this.limpSide = rng.chance(0.5) ? 0 : 1;
    this.limpAmount = rng.range(0.25, 0.75);
    this.noiseSeed = rng.range(0, 100);
    this.gazeState = Math.floor(this.noiseSeed * 1000) + 1;
    this.rng = rng.fork('spasm');
    const brokenOptions: Array<[JointName, [number, number, number]]> = [
      ['foreArm_L', [-28, 0, 0]], ['foreArm_R', [-28, 0, 0]],
      ['hand_L', [-70, 0, 20]], ['hand_R', [-70, 0, -20]],
      ['shin_L', [14, 0, 0]], ['shin_R', [14, 0, 0]],
      ['upperArm_L', [0, 40, -25]], ['upperArm_R', [0, -40, 25]],
    ];
    const [broken, brokenAngle] = rng.pick(brokenOptions);
    this.skew = {
      neckRoll: (rng.chance(0.5) ? -1 : 1) * rng.range(22, 48),
      neckYaw: rng.range(-18, 18),
      hunch: (rng.chance(0.5) ? -1 : 1) * rng.range(8, 20),
      broken,
      brokenAngle,
    };
    this.phase = rng.range(0, Math.PI * 2);
    this.locoPhase = rng.range(0, 1);
    this.idlePhase = rng.range(0, 1);
  }

  get poseName(): string {
    return this.to.name;
  }

  get sequencePlaying(): boolean {
    return this.seq !== null;
  }

  /** 0..1 turn-in-place shuffle activity weight (stationary pivot steps). */
  get pivotWeight(): number {
    return this.pivotW;
  }

  /** 0..1 jog share of the current upright locomotion blend. */
  get jogWeight(): number {
    return this.locoInfo.jogWeight;
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

  /** Impulse from an external shove or separation nudge in character-local XZ (m/s). */
  nudgeImpulse(localX: number, localZ: number): void {
    this.leanLatSpring.impulse(THREE.MathUtils.clamp(-localX * 48, -140, 140));
    this.leanFwdSpring.impulse(THREE.MathUtils.clamp(localZ * 38, -110, 110));
  }

  update(dt: number): void {
    this.time += dt;
    this.updateBlend(dt);
    this.off.fill(0);
    this.bob.set(0, 0, 0);
    this.rootEuler.set(0, 0, 0);
    this.footContacts[0] = 1;
    this.footContacts[1] = 1;

    const mocapActive = this.updateMocapBase(dt);
    this.updateGait(dt, mocapActive);
    this.armScale = this.armLayer;
    this.updateInertialPhysics(dt);
    this.armScale = 1;
    this.updateTurnInPlace(dt);
    this.armScale = this.armLayer;
    this.updateIdleLife(dt);
    this.updateSpeech(dt);
    this.armScale = 1;
    this.updateLook(dt);
    this.updateInfected(dt);
    this.updateReactions(dt);
    this.addConvulsions();
    this.write();
  }

  // ---------------------------------------------------------------- base pose + staggered follow-through

  private startBlend(target: CompiledPose, dur: number): void {
    copyPose(this.current, this.from);
    this.to = target;
    this.blendT = 0;
    this.blendDur = Math.max(1e-3, dur);
  }

  private updateBlend(dt: number): void {
    if (this.blendT < 1) {
      // Advance normalized timer; fastest chains finish early, distal chains settle smoothly at 1.0.
      this.blendT = Math.min(1, this.blendT + dt / this.blendDur);
      const t = this.blendT;
      const smooth = (u: number) => {
        const c = THREE.MathUtils.clamp(u, 0, 1);
        return c * c * (3 - 2 * c);
      };
      const baseS = smooth(t);
      this.current.rootRot.slerpQuaternions(this.from.rootRot, this.to.rootRot, baseS);
      this.current.rootPos.lerpVectors(this.from.rootPos, this.to.rootPos, baseS);
      this.current.pelvis.lerpVectors(this.from.pelvis, this.to.pelvis, smooth(t * 1.15));
      for (let i = 0; i < N; i++) {
        const oq = this.current.joints[i];
        const qa = this.from.joints[i];
        const qb = this.to.joints[i];
        if (!oq || !qa || !qb) continue;
        // Overlapping action: core leads, wrists/hands/head trail slightly, all land cleanly by t = 1.
        const rate = CHAIN_SPEED[i] ?? 1;
        const u = rate >= 1 ? Math.min(1, t * rate) : Math.max(0, (t - (1 - rate) * 0.35) / (1 - (1 - rate) * 0.35));
        oq.slerpQuaternions(qa, qb, smooth(u));
      }
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

  // ---------------------------------------------------------------- Tier B mocap base layer

  /**
   * Drives living upright humanoids (both human cast/NPCs and upright infected enemies) with retargeted
   * CC0 mocap clips (`idle`, `idle_talk`, `walk`, `walk_formal`, `jog`, `pistol_idle`, `kneel_fix`, `crouch_idle`),
   * blending seamlessly with authored poses (`poses.json`) when scripts, horror postures, or slams request them.
   * Returns true when mocap owns the locomotion cycle (so legacy sine-wave walk/shamble legs stay off).
   */
  private updateMocapBase(dt: number): boolean {
    const poseName = this.to.name;
    let targetW = 0;
    let mode: 'loco' | 'shamble' | 'heavy' | 'pistol' | 'kneel' | 'crouch' | 'none' = 'none';

    if (this.useMocap && !this.seq && this.convulse <= 0.01) {
      if (this.twitchy) {
        if (this.gait === 'shamble' || this.gait === 'flail') {
          mode = 'shamble';
          targetW = 1;
        } else if (this.gait === 'heavy' && poseName !== 'slamWindup' && poseName !== 'slamImpact') {
          mode = 'heavy';
          targetW = 0.4;
        }
      } else if (MOCAP_LOCO_POSES.has(poseName) || this.speed > 0.08) {
        mode = 'loco';
        targetW = 1;
      } else if (poseName === 'aim_pistol') {
        mode = 'pistol';
        targetW = 1;
      } else if (poseName === 'kneel_revive') {
        mode = 'kneel';
        targetW = 0.85;
      } else if (poseName === 'crouchWork') {
        mode = 'crouch';
        targetW = 0.3;
      }
    }

    // Smoothly fade mocap weight in/out so switching between mocap and authored poses never snaps.
    const fadeRate = targetW > this.mocapW ? 5.5 : 6.5;
    if (this.time <= dt * 1.5 && targetW > 0.35) {
      // Start directly in mocap on frame 1 so freshly spawned bodies don't visibly lerp out of rest pose.
      this.mocapW = targetW;
    } else {
      this.mocapW += (targetW - this.mocapW) * (1 - Math.exp(-fadeRate * dt));
    }
    if (this.mocapW < 0.005) {
      this.mocapW = 0;
      copyPose(this.current, this.finalPose);
      return false;
    }

    // Advance clip phases cleanly.
    const idleClip = this.mocap.get(
      mode === 'shamble' || mode === 'heavy'
        ? 'zombie_idle'
        : mode === 'pistol'
          ? 'pistol_idle'
          : mode === 'kneel'
            ? 'kneel_fix'
            : mode === 'crouch'
              ? 'crouch_idle'
              : this.motions.idle,
    );
    this.idlePhase = (this.idlePhase + dt / Math.max(0.1, idleClip.duration)) % 1;

    if (mode === 'shamble' || mode === 'heavy') {
      const zStride = Math.max(0.9, this.mocap.get('zombie_walk').stride || 1.5);
      if (this.speed > 0.02) {
        // Slower, heavier zombie step progression: limp speed matches ground travel without frantic leg spin.
        const strideMul = mode === 'heavy' ? 1.45 : 1.05;
        this.locoPhase = (this.locoPhase + (this.speed / (zStride * strideMul)) * dt) % 1;
      }
      // Subtle lurching time warp makes every zombie stride feel uneven and dragging.
      const samplePhase =
        mode === 'shamble'
          ? (this.locoPhase + 0.04 * Math.sin(this.locoPhase * Math.PI * 4) + 1) % 1
          : this.locoPhase;
      sampleZombieLocomotion(this.mocap, this.speed, samplePhase, this.idlePhase, this.mocapPose, this.locoInfo);
      if (mode !== 'heavy') {
        this.footContacts[0] = this.locoInfo.contactL;
        this.footContacts[1] = this.locoInfo.contactR;
      }
    } else if (mode === 'loco') {
      const stride = Math.max(0.6, this.locoInfo.stride);
      if (this.speed > 0.02) {
        this.locoPhase = (this.locoPhase + (this.speed / stride) * dt) % 1;
      }
      sampleLocomotion(
        this.mocap,
        this.speed,
        this.locoPhase,
        this.idlePhase,
        { motions: this.motions, talking: false },
        this.mocapPose,
        this.locoInfo,
      );
      // When speaking while standing still, subtly blend in the natural weight-shift/torso motion from idle_talk
      // without overriding the speechActing emote arm gestures (keep idle_talk subtle on arms).
      if (this.speechW > 0.01 && this.speed < 0.15 && !Animator.ARMS_BUSY.has(poseName)) {
        const talkClip = this.mocap.get(this.motions.talk);
        const talkPhase = (this.idlePhase * (idleClip.duration / talkClip.duration)) % 1;
        sampleClip(talkClip, talkPhase, this.talkPose);
        const tw = this.speechW * (1 - this.locoInfo.moveWeight) * 0.35;
        this.mocapPose.pelvis.lerp(this.talkPose.pelvis, tw);
        for (const jName of ['pelvis', 'spine', 'chest', 'shoulder_L', 'shoulder_R'] as const) {
          const idx = J[jName];
          const a = this.mocapPose.joints[idx];
          const b = this.talkPose.joints[idx];
          if (a && b) a.slerp(b, tw);
        }
      }
      this.footContacts[0] = this.locoInfo.contactL;
      this.footContacts[1] = this.locoInfo.contactR;
    } else if (mode !== 'none') {
      sampleClip(idleClip, this.idlePhase, this.mocapPose);
      this.locoInfo.moveWeight = 0;
      this.locoInfo.jogWeight = 0;
      this.footContacts[0] = 1;
      this.footContacts[1] = 1;
    }

    if (mode === 'shamble') {
      // Shamblers use the real zombie_walk/zombie_idle mocap at full strength (blind flailers blend 40% blindFlail on upper body).
      const w = this.mocapW;
      const upperW = this.gait === 'flail' ? w * 0.6 : w * 0.9;
      this.finalPose.rootRot.slerpQuaternions(this.current.rootRot, this.mocapPose.rootRot, w);
      this.finalPose.rootPos.lerpVectors(this.current.rootPos, this.mocapPose.rootPos, w);
      this.finalPose.pelvis.lerpVectors(this.current.pelvis, this.mocapPose.pelvis, w);
      for (let i = 0; i < N; i++) {
        const oq = this.finalPose.joints[i];
        const qa = this.current.joints[i];
        const qb = this.mocapPose.joints[i];
        if (!oq || !qa || !qb) continue;
        const jName = JOINTS[i]?.name;
        oq.slerpQuaternions(qa, qb, jName && UPPER_BODY.has(jName) ? upperW : w);
      }
      return this.mocapW > 0.4;
    }

    if (this.mocapW >= 0.995) {
      copyPose(this.mocapPose, this.finalPose);
    } else {
      blendPose(this.current, this.mocapPose, this.mocapW, this.finalPose);
    }

    return mode === 'loco' && this.mocapW > 0.4;
  }

  private readonly talkPose = emptyPose('mocap_talk');

  // ---------------------------------------------------------------- speech

  /** Start acting a line; replaces any line in progress. */
  speak(plan: SpeechPlan): void {
    this.speech = plan;
    this.speechT = 0;
    this.speechEnding = false;
  }

  /** The line ended or was cut off: close the mouth and let the gestures fade. */
  stopSpeaking(): void {
    this.speechEnding = true;
  }

  get speaking(): boolean {
    return this.speech !== null && !this.speechEnding;
  }

  /** Speech telemetry for HandPhysicsSolver (biomechanical wrist & finger gestures). */
  get speechEmote(): Emote | null {
    return this.speech?.emote ?? null;
  }

  get speechWeight(): number {
    return this.speechW;
  }

  get speechPulse(): number {
    return this.speechBeat;
  }

  get speechPrimarySide(): Side {
    return this.speech?.side === 1 ? 'L' : 'R';
  }

  /**
   * Speech layer: the jaw follows the line's syllables and the emote's gestures ride on top of the current pose. The infected
   * do not talk; arms gesture less while walking or busy with a task, and not at all on the ground.
   */
  private updateSpeech(dt: number): void {
    const plan = this.speech;
    if (!plan) {
      this.speechBeat = 0;
      this.speechNodSpring.step(0, dt);
      return;
    }
    if (this.twitchy || this.infect > 0.35 || this.convulse > 0.01) {
      this.speech = null;
      this.speechW = 0;
      this.speechBeat = 0;
      this.speechNodSpring.reset(0);
      return;
    }
    this.speechT += dt;
    if (this.speechT > plan.duration) this.speechEnding = true;
    const target = this.speechEnding ? 0 : 1;
    this.speechW += (target - this.speechW) * Math.min(1, dt * (target ? 9 : 5));
    if (this.speechEnding && this.speechW < 0.01) {
      this.speech = null;
      this.speechW = 0;
      this.speechBeat = 0;
      this.speechNodSpring.step(0, dt);
      return;
    }
    const w = this.speechW;
    const open = mouthOpenAt(plan.cues, this.speechT);
    const beatP = this.speechT * plan.style.beatHz + hash01(plan.seed, 5);
    const beatIdx = Math.floor(beatP);
    const beatFrac = beatP - beatIdx;
    this.speechBeat =
      Math.pow(Math.sin(Math.PI * beatFrac), plan.style.beatSharp) *
      (0.55 + 0.45 * hash01(plan.seed, 100 + beatIdx));
    this.add('jaw', -plan.style.jaw * open * w, 0, 0);
    // Subtle spring-damped head/chest emphasis synced to syllable openings (organic talking life without thrashing).
    const nod = this.speechNodSpring.step(open * w, dt);
    const upright = this.gait === 'none' || this.gait === 'walk' || this.gait === 'shamble' || this.gait === 'heavy';
    if (!upright) return;
    this.add('head', -2.4 * nod, 0, 0);
    this.add('neck', -0.9 * nod, 0, 0);
    this.add('chest', -0.7 * nod, 0, 0);

    const busy = Animator.ARMS_BUSY.has(this.to.name) ? 0.25 : 1;
    const moveFactor = this.useMocap ? this.locoInfo.moveWeight : Math.min(1, this.amp * 1.4);
    const armsK = busy * (1 - moveFactor * 0.85);
    gesture(plan, this.speechT, w, armsK, this.speechSink);
  }

  // ---------------------------------------------------------------- procedural layers

  private add(name: JointName, x: number, y: number, z: number): void {
    const i = J[name] * 3;
    const k = this.armScale !== 1 && ARM_JOINTS.has(name) ? this.armScale * D2R : D2R;
    this.off[i] = (this.off[i] ?? 0) + x * k;
    this.off[i + 1] = (this.off[i + 1] ?? 0) + y * k;
    this.off[i + 2] = (this.off[i + 2] ?? 0) + z * k;
  }

  /**
   * Pick the body's clips: `own` (a main character's motion set) over the default or formal set. A body with its own set gets
   * its procedural arm layers turned down to `Animator.OWN_MOTION_ARMS`.
   */
  setMotions(own: Partial<MotionSet> | undefined, formal: boolean): void {
    this.motions = resolveMotions(this.mocap, own, formal);
    this.armLayer = own ? Animator.OWN_MOTION_ARMS : 1;
  }

  /** Procedural arm-layer strength for characters with their own motion set. */
  static readonly OWN_MOTION_ARMS = 0.35;

  private n(t: number, k: number): number {
    const s = this.noiseSeed + k * 7.3;
    return Math.sin(t * 1.7 + s) * 0.6 + Math.sin(t * 2.9 + s * 2.1) * 0.4;
  }

  /** Set by the body each frame from its leg damage: `amount` 0 = sound, 1 = about to lose the leg. */
  setWound(side: 'L' | 'R' | null, amount: number): void {
    if (side) this.woundSide = side === 'L' ? 0 : 1;
    this.woundAmount = side ? amount : 0;
  }

  private readonly bob = new THREE.Vector3();
  private readonly rootEuler = new THREE.Vector3();

  /**
   * Second-order inertial locomotion physics for upright humanoids:
   * - Acceleration pitches torso forward; braking carries momentum forward then springs back.
   * - Turning while moving banks pelvis/spine into the curve while head counter-rolls level.
   * - Lateral acceleration / separation nudges produce a reactive hip counter-lean.
   */
  private updateInertialPhysics(dt: number): void {
    const upright = this.gait === 'none' || this.gait === 'walk' || this.gait === 'shamble' || this.gait === 'heavy';
    if (!upright || this.convulse > 0.1) {
      this.leanFwdSpring.step(0, dt);
      this.leanLatSpring.step(0, dt);
      this.bankSpring.step(0, dt);
      return;
    }

    // Target forward pitch (degrees): lean slightly into speed + react to forward/braking acceleration.
    const speedLean = this.useMocap ? THREE.MathUtils.clamp(this.speed * 1.4, 0, 5.5) : 0;
    const accelLean = THREE.MathUtils.clamp(this.accelFwd * 1.6, -7, 7);
    const fwd = this.leanFwdSpring.step(speedLean + accelLean, dt);

    // Cornering centripetal bank: speed * turnRate (+turnRate = left -> bank left = -Z roll).
    const bankTarget = THREE.MathUtils.clamp(-this.speed * this.turnRate * 2.8, -9, 9);
    const bank = this.bankSpring.step(bankTarget, dt);

    // Lateral acceleration / nudge recoil: push right (+accelLat) tilts upper body slightly left (-Z).
    const latTarget = THREE.MathUtils.clamp(-this.accelLat * 1.4, -7, 7);
    const lat = this.leanLatSpring.step(latTarget, dt);

    const roll = bank + lat;
    if (Math.abs(fwd) > 0.02) {
      this.add('pelvis', -fwd * 0.28, 0, 0);
      this.add('spine', -fwd * 0.42, 0, 0);
      this.add('chest', -fwd * 0.3, 0, 0);
      // Head counter-pitches to keep the gaze steady on the horizon.
      this.add('neck', fwd * 0.35, 0, 0);
      this.add('head', fwd * 0.45, 0, 0);
    }
    if (Math.abs(roll) > 0.02) {
      this.add('pelvis', 0, 0, roll * 0.35);
      this.add('spine', 0, 0, roll * 0.45);
      this.add('chest', 0, 0, roll * 0.2);
      this.add('neck', 0, 0, -roll * 0.35);
      this.add('head', 0, 0, -roll * 0.45);
      // Slight lateral pelvis shift and arm balance flare during strong cornering/bumps.
      this.bob.x += THREE.MathUtils.clamp(roll * 0.0022, -0.025, 0.025);
      this.add('upperArm_L', 0, 0, -Math.max(0, -roll) * 0.45);
      this.add('upperArm_R', 0, 0, Math.max(0, roll) * 0.45);
    }
  }

  /**
   * Turn-in-place stepping + head-leads-torso for upright stationary turns (both NPCs and enemies).
   * Prevents characters from spinning like a statue on a turntable when turning to face a target.
   */
  private updateTurnInPlace(dt: number): void {
    const upright = this.gait === 'none' || this.gait === 'walk' || this.gait === 'shamble' || this.gait === 'heavy';
    const stationary = upright && this.speed < 0.25 && this.convulse <= 0.01;
    const turning = stationary && (Math.abs(this.turnRate) > 0.1 || Math.abs(this.turnError) > 0.18);

    // Lead-in anticipation: head and shoulders turn toward the desired heading ahead of the hips.
    const leadTarget = upright
      ? THREE.MathUtils.clamp(this.turnError * R2D * 0.55 + this.turnRate * R2D * 0.12, -38, 38)
      : 0;
    const lead = this.turnLeadSpring.step(leadTarget, dt);
    if (Math.abs(lead) > 0.05) {
      this.add('spine', 0, lead * 0.14, 0);
      this.add('chest', 0, lead * 0.22, 0);
      this.add('neck', 0, lead * 0.26, 0);
      this.add('head', 0, lead * 0.38, 0);
    }

    // Pivot foot-shuffle stepping while turning on the spot.
    const wantPivot = turning ? THREE.MathUtils.clamp(Math.abs(this.turnRate) / 0.85, 0, 1) : 0;
    this.pivotW += (wantPivot - this.pivotW) * (1 - Math.exp(-(wantPivot > this.pivotW ? 10 : 7) * dt));
    if (this.pivotW < 0.01) {
      this.pivotW = 0;
      return;
    }

    const dir = Math.sign(this.turnRate || this.turnError || 1);
    this.pivotPhase = (this.pivotPhase + Math.max(0.55, Math.abs(this.turnRate) * 1.1) * dt) % 1;
    const p = this.pivotPhase * Math.PI * 2;
    const w = this.pivotW;

    // Left steps on first half [0..pi], right steps on second half [pi..2pi].
    const liftL = Math.max(0, Math.sin(p));
    const liftR = Math.max(0, -Math.sin(p));
    const swingL = liftL * liftL;
    const swingR = liftR * liftR;

    this.add('thigh_L', 18 * w * swingL, dir * 10 * w * swingL, -3 * w * swingL);
    this.add('shin_L', -34 * w * swingL, 0, 0);
    this.add('foot_L', 14 * w * swingL, 0, 0);

    this.add('thigh_R', 18 * w * swingR, dir * 10 * w * swingR, 3 * w * swingR);
    this.add('shin_R', -34 * w * swingR, 0, 0);
    this.add('foot_R', 14 * w * swingR, 0, 0);

    // Shift weight laterally over whichever foot is currently planted.
    const shift = (liftL - liftR) * w; // + when lifting L -> weight shifts right (+X)
    this.bob.x += 0.028 * shift;
    this.bob.y -= 0.012 * w * (swingL + swingR);
    this.add('pelvis', 0, -dir * 4 * w * Math.cos(p), 3.2 * shift);
    this.add('spine', 0, dir * 3 * w * Math.cos(p), -2.2 * shift);

    // Drive alternating foot contacts for FootIkSolver so the planted foot locks to the deck!
    if (this.speed < 0.15) {
      this.footContacts[0] = THREE.MathUtils.clamp(1 - swingL * 1.25 * w, 0, 1);
      this.footContacts[1] = THREE.MathUtils.clamp(1 - swingR * 1.25 * w, 0, 1);
    }
  }

  private updateGait(dt: number, mocapActive: boolean): void {
    const style = this.gait;
    // Pivoting crawlers pull themselves around: the turn speed drives the limbs as if it were ground speed.
    const pivot = style === 'crawl' ? PIVOT_DRIVE_CRAWL : style === 'drag' ? PIVOT_DRIVE_DRAG : 0;
    const drive = style === 'none' ? 0 : Math.max(this.speed, pivot * Math.abs(this.turnRate));
    const targetAmp = style === 'none' ? 0 : Math.min(1.25, drive / REF_SPEED[style]);
    this.amp += (targetAmp - this.amp) * Math.min(1, dt * 5);
    if (style !== 'none') this.phase += (drive / STRIDE[style]) * Math.PI * 2 * dt;
    const A = this.amp;
    const t = this.time;
    if (style === 'flail') this.flail(t);
    this.footfall = false;

    // When Tier B mocap owns the upright locomotion cycle, skip the legacy sine-wave leg/arm generator
    // while layering heavy zombie limp asymmetry, dragging feet, and head drift on top of zombie_walk!
    if (mocapActive && (style === 'walk' || style === 'shamble' || style === 'flail')) {
      const sham = style !== 'walk';
      const wounded = this.woundAmount > 0.01;
      if ((sham || wounded) && A > 0.05) {
        const p = this.locoPhase * Math.PI * 4; // two full limping steps per zombie_walk loop
        const lameSide = wounded ? this.woundSide : this.limpSide;
        const lameAmt = wounded ? Math.max(this.limpAmount, 0.6 + 0.4 * this.woundAmount) : Math.max(0.45, this.limpAmount);
        const lame = lameSide === 0 ? 'L' : 'R';
        const lean = lameSide === 0 ? -1 : 1;
        const phLame = p + lameSide * Math.PI;
        const limpPulse = Math.max(0, Math.sin(phLame));
        // Heavy asymmetric hip drop and torso lurch over the crippled side.
        this.add('pelvis', -4 * A * limpPulse, lean * 6 * A * lameAmt * limpPulse, lean * A * 9 * lameAmt * limpPulse);
        this.add('spine', -6 * A * lameAmt, -lean * 4 * A * lameAmt * limpPulse, -lean * 5 * A * lameAmt * limpPulse);
        this.add('chest', -4 * A * lameAmt, 0, lean * 4 * A * lameAmt * limpPulse);
        this.bob.y -= 0.032 * A * lameAmt * limpPulse;
        this.bob.x += lean * 0.025 * A * lameAmt * limpPulse;
        // Dragging stiff lame leg: drags behind slightly, knee locks/hyperextends when taking weight.
        this.add(`thigh_${lame}`, -8 * A * lameAmt * Math.max(0, -Math.sin(phLame)), 0, lean * 5 * A * lameAmt);
        this.add(`shin_${lame}`, A * (14 * lameAmt + 12 * this.infect) * Math.max(0, -Math.sin(phLame)), 0, 0);
        this.add(`foot_${lame}`, -12 * A * lameAmt * limpPulse, 0, 0);
        if (sham) {
          this.add('neck', A * 7 * Math.cos(2 * p), 0, 0);
          this.add('head', -5 * A * limpPulse, A * 8 * this.n(t * 0.45, 9), A * 7 * this.n(t * 0.35, 10));
        }
      }
      return;
    }

    if (A < 1e-3) return;

    if (style === 'heavy') {
      this.heavyGait(A, dt);
      return;
    }

    if (style === 'walk' || style === 'shamble' || style === 'flail') {
      const sham = style !== 'walk';
      // Lurching time warp for shamblers.
      const p = sham ? this.phase + 0.35 * Math.sin(this.phase) : this.phase;
      // A wounded leg limps whatever the gait; otherwise shamblers keep their seeded lame leg.
      const wounded = this.woundAmount > 0.01;
      const lameSide = wounded ? this.woundSide : this.limpSide;
      const lameAmt = wounded ? Math.max(this.limpAmount, 0.5 + 0.5 * this.woundAmount) : this.limpAmount;
      for (const side of [0, 1] as const) {
        const s = side === 0 ? 'L' : 'R';
        const ph = p + side * Math.PI;
        const lame = (sham || wounded) && side === lameSide;
        const stride = lame ? 1 - 0.5 * lameAmt : 1;
        const knee = lame ? 1 - 0.7 * lameAmt : 1;
        const sinp = Math.sin(ph);
        this.add(`thigh_${s}`, A * 24 * stride * sinp, 0, 0);
        this.add(`shin_${s}`, -A * (6 + 44 * Math.max(0, Math.cos(ph))) * knee, 0, 0);
        this.add(`foot_${s}`, A * 12 * Math.sin(ph - 0.6), 0, 0);
        if (sham) {
          const swing = side === 0 ? 0.3 : 0.6;
          this.add(`upperArm_${s}`, -A * 16 * swing * sinp, 0, 0);
          this.add(`foreArm_${s}`, A * 8 * swing * (1 + sinp), 0, 0);
        } else {
          this.walkArm(s, side, ph, A);
        }
      }
      const sp = Math.sin(p);
      this.add('pelvis', 0, A * 5 * sp, A * 3.5 * sp);
      if (sham) {
        this.add('spine', 0, -A * 4 * sp, 0);
        this.add('chest', 0, -A * 2 * sp, -A * 2 * sp);
      } else {
        // Shoulders counter-rotate against the hips (net about -6 deg against +5), the head stays on the road.
        this.add('spine', 0, -A * 6 * sp, A * 1.5 * sp);
        this.add('chest', 0, -A * 5 * sp, -A * 2 * sp);
        this.add('head', 0, A * 6 * sp, 0);
      }
      if (sham || wounded) {
        const lean = lameSide === 0 ? -1 : 1;
        this.add('pelvis', 0, 0, lean * A * 5 * lameAmt * Math.max(0, Math.sin(p + lameSide * Math.PI)));
        if (sham) {
          this.add('neck', A * 6 * Math.cos(2 * p), 0, 0);
          this.add('head', 0, A * 6 * this.n(t * 0.5, 9), A * 5 * this.n(t * 0.4, 10));
        }
      }
      this.bob.y += A * 0.022 * Math.cos(2 * p) - A * 0.012;
      if (sham) {
        // Hyperextending knee on the lame leg as it takes weight.
        const lame = lameSide === 0 ? 'L' : 'R';
        this.add(`shin_${lame}`, A * 16 * this.infect * Math.max(0, -Math.sin(p + lameSide * Math.PI)), 0, 0);
      }
      return;
    }

    if (style === 'crawl') {
      // Labored zombie floor crawl: asymmetric reach -> claw plant -> heavy shoulder/chest heave -> drag pause,
      // with the remaining leg frog-pushing sideways and the pelvis rolling heavily with each haul.
      const p = this.phase + 0.42 * Math.sin(this.phase); // non-sinusoidal surge-and-drag timing
      for (const side of [0, 1] as const) {
        const s = side === 0 ? 'L' : 'R';
        const out = side === 0 ? -1 : 1;
        const ph = p + side * Math.PI;
        const sinp = Math.sin(ph);
        const reach = Math.max(0, sinp);
        const pull = Math.max(0, -sinp);
        const pullSurge = pull * pull;
        // Turning: outside arm reaches wide and hauls hard, inside arm anchors.
        const tf = THREE.MathUtils.clamp(this.turnRate / 1.1, -1, 1);
        const arm = side === 0 ? 1 - 0.55 * tf : 1 + 0.55 * tf;
        this.add(`shoulder_${s}`, A * 10 * arm * (reach - pullSurge), out * A * 14 * arm * (reach - pull), out * A * 8 * arm * reach);
        this.add(`upperArm_${s}`, A * (44 * reach - 36 * pullSurge) * arm, out * A * 12 * arm * reach, out * A * (14 * Math.cos(ph) + 8 * pull));
        this.add(`foreArm_${s}`, A * (58 * pullSurge + 10 * reach) * arm, 0, 0);
        // Fingers/wrists dig and claw into the deck during the heavy pull.
        this.add(`hand_${s}`, A * (54 * pullSurge - 14 * reach) * arm, 0, out * A * 12 * pull);
        // Remaining leg does a low bent-knee frog-push instead of a stiff scissor.
        const push = Math.max(0, Math.sin(ph + 0.9));
        this.add(`thigh_${s}`, A * 28 * push, out * A * 10 * push, out * A * (14 * push + 4));
        this.add(`shin_${s}`, -A * 48 * push, 0, 0);
        this.add(`foot_${s}`, A * 20 * push, 0, 0);
      }
      this.leadTurn();
      const sp = Math.sin(p);
      const haul = Math.abs(sp);
      // Heavy body roll, ribcage heave on each arm pull, and head scraping low then jerking up.
      this.rootEuler.z = A * 11 * sp;
      this.add('pelvis', 0, -A * 10 * sp, A * 8 * sp);
      this.add('spine', A * 7 * haul, A * 10 * sp, -A * 6 * sp);
      this.add('chest', A * 9 * haul, A * 11 * sp, -A * 5 * sp);
      this.add('neck', A * (8 * haul + 8 * this.n(t * 2.4, 21)), A * 14 * this.n(t * 2.0, 22), 0);
      this.add('head', A * (10 * haul - 4), -A * 9 * sp, A * 6 * this.n(t * 1.8, 25));
      this.bob.y += A * 0.035 * haul * haul;
      this.bob.x += A * 0.03 * sp;
      return;
    }

    if (style === 'drag') {
      // Desperate double-arm floor haul (both legs lost): slow reach forward, hard double-arm pull that lifts
      // the chest off the deck, then collapses back down exhausted before the next reach.
      const p = this.phase + 0.48 * Math.sin(this.phase);
      const sp = Math.sin(p);
      const reach = Math.max(0, sp);
      const pull = Math.max(0, -sp);
      const surge = pull * pull;
      for (const side of [0, 1] as const) {
        const s = side === 0 ? 'L' : 'R';
        const out = side === 0 ? -1 : 1;
        // Slight left/right stagger so it feels broken and uneven instead of mechanical symmetry.
        const stag = side === 0 ? 1 : 0.88;
        this.add(`shoulder_${s}`, A * 12 * (reach - surge) * stag, out * A * 10 * reach, out * A * 8 * reach);
        this.add(`upperArm_${s}`, A * (48 * reach - 42 * surge) * stag, 0, out * A * (10 * reach + 6 * surge));
        this.add(`foreArm_${s}`, A * (64 * surge + 8 * reach) * stag, 0, 0);
        this.add(`hand_${s}`, A * (58 * surge - 12 * reach) * stag, 0, out * A * 10 * surge);
      }
      this.add('spine', A * 10 * surge, A * 5 * Math.sin(p * 0.5), A * 4 * this.n(t * 1.4, 26));
      this.add('chest', A * 14 * surge, 0, 0);
      this.add('neck', A * (10 * surge + 7 * this.n(t * 2.3, 23)), A * 16 * this.n(t * 1.9, 24), 0);
      this.add('head', A * (12 * surge - 5 * reach), 0, A * 6 * this.n(t * 1.6, 27));
      this.bob.y += A * 0.048 * surge;
      this.leadTurn();
    }
  }

  /**
   * A walking arm: it trails the opposite leg by a beat, swings further back than forward, bends at the elbow as it
   * comes forward, drifts out a little at the extremes, and the wrist and forearm roll follow the swing.
   */
  private walkArm(s: 'L' | 'R', side: 0 | 1, ph: number, A: number): void {
    const out = side === 0 ? -1 : 1;
    const a = Math.sin(ph - 0.3);
    const fwd = Math.max(0, -a);
    this.add(`upperArm_${s}`, -A * (a > 0 ? 21 : 14) * a, out * A * 4 * a, out * A * (2 + 3 * Math.abs(a)));
    this.add(`foreArm_${s}`, A * (9 + 20 * fwd * fwd), 0, 0);
    this.add(`hand_${s}`, -A * 7 * Math.sin(ph - 0.9), 0, 0);
    this.add(`shoulder_${s}`, 0, out * A * 3 * a, 0);
  }

  private lastStep = 0;

  /**
   * Hero stomp (ADR-0021): long slow strides, the knee lifted high and the foot driven down, the whole
   * weight rolling over onto each leg, the body dropping on every footfall, arms swinging low and late.
   */
  private heavyGait(A: number, _dt: number): void {
    const p = this.phase;
    const wounded = this.woundAmount > 0.01;
    for (const side of [0, 1] as const) {
      const s = side === 0 ? 'L' : 'R';
      const ph = p + side * Math.PI;
      const sinp = Math.sin(ph);
      const lame = wounded && side === this.woundSide ? 1 - 0.45 * (0.5 + 0.5 * this.woundAmount) : 1;
      // Swing forward slowly, then plant hard: a lift (knee up) through the swing.
      const swing = Math.max(0, Math.cos(ph));
      this.add(`thigh_${s}`, A * (20 * sinp + 16 * swing * swing) * lame, 0, 0);
      this.add(`shin_${s}`, -A * (8 + 58 * swing * swing) * lame, 0, 0);
      this.add(`foot_${s}`, A * 14 * Math.sin(ph - 0.8), 0, 0);
      // Arms hang heavy and swing late, the far arm wider.
      const arm = side === 0 ? 1 : 0.7;
      this.add(`upperArm_${s}`, -A * 14 * arm * Math.sin(ph - 0.5), 0, (side === 0 ? -1 : 1) * A * 6 * Math.abs(Math.sin(ph)));
      this.add(`foreArm_${s}`, A * 10 * arm * (1 + Math.sin(ph - 0.7)), 0, 0);
    }
    // Weight rolls over the planted leg: big pelvis roll and yaw, shoulders counter-rotate.
    const sp = Math.sin(p);
    this.add('pelvis', 0, A * 7 * sp, A * 7 * sp);
    this.add('spine', A * 3 * Math.cos(2 * p), -A * 6 * sp, -A * 4 * sp);
    this.add('chest', 0, -A * 5 * sp, -A * 3 * sp);
    this.add('neck', -A * 4 * Math.cos(2 * p), 0, 0);
    this.add('head', A * 5 * Math.cos(2 * p), A * 3 * sp, A * 2 * sp);
    // The body drops sharply as each foot lands (twice per cycle) and rises slowly through the stride.
    const step = ((p % Math.PI) + Math.PI) % Math.PI; // 0..pi per step
    const land = Math.PI * 0.5;
    const since = ((step - land) + Math.PI) % Math.PI; // 0 just after landing
    this.bob.y += -A * 0.045 * Math.exp(-since * 6) + A * 0.015 * Math.sin(since);
    // Feed crisp alternating stomp contacts to FootIkSolver so each heavy foot plants solidly onto the deck.
    const swingL = Math.max(0, Math.cos(p));
    const swingR = Math.max(0, -Math.cos(p));
    this.footContacts[0] = THREE.MathUtils.clamp(1 - swingL * 1.6 * Math.min(1, A), 0, 1);
    this.footContacts[1] = THREE.MathUtils.clamp(1 - swingR * 1.6 * Math.min(1, A), 0, 1);
    const stepIndex = Math.floor((p - land) / Math.PI);
    if (stepIndex !== this.lastStep) {
      this.footfall = this.lastStep !== 0 || stepIndex > 0;
      this.lastStep = stepIndex;
    }
  }

  /** The head turns toward the target first, the chest and spine follow, and the body comes round after them. */
  private leadTurn(): void {
    const deg = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(this.turnError), -60, 60);
    this.add('head', 0, deg * 0.55, 0);
    this.add('neck', 0, deg * 0.2, 0);
    this.add('chest', 0, deg * 0.2, 0);
    this.add('spine', 0, deg * 0.1, 0);
  }

  /**
   * The bloom's movement: a skewed, broken posture, sudden spasms, head snaps that hold at
   * wrong angles, a slack chattering jaw that gapes on a lunge, stumbles, twitching fingers.
   */
  private updateInfected(dt: number): void {
    const t = this.time;
    const inf = this.twitchy ? this.infect : 0;
    this.chargeCur += (this.charge - this.chargeCur) * Math.min(1, dt * 6);
    const c = this.chargeCur;
    const k = this.skew;

    // Jaw: closed on the living; slack and chattering on the infected; wide on a lunge.
    const chatter = inf * (0.5 + 0.5 * Math.sin(t * 0.9 + this.noiseSeed)) * 9 * Math.sin(t * 38 + this.noiseSeed);
    this.add('jaw', -(inf * (10 + 14 * (0.5 + 0.5 * this.n(t * 0.6, 30))) + chatter + c * 38), 0, this.n(t, 31) * 4 * inf);

    if (inf > 0) {
      // Head lolled and wrong; one shoulder hiked up; one limb bent the wrong way.
      this.add('neck', 0, k.neckYaw * inf * 0.5, k.neckRoll * inf * 0.55);
      this.add('head', 0, k.neckYaw * inf * 0.5, k.neckRoll * inf * 0.45);
      this.add(k.hunch < 0 ? 'upperArm_L' : 'upperArm_R', 0, 0, k.hunch * inf);
      this.add('chest', 0, 0, k.hunch * 0.4 * inf);
      const b = k.brokenAngle;
      const bi = Math.min(1, inf * 1.4 - 0.2);
      if (bi > 0) this.add(k.broken, b[0] * bi, b[1] * bi, b[2] * bi);
      // Fingers and hands never still.
      for (const s of ['L', 'R'] as const) {
        this.add(`hand_${s}`, 18 * inf * this.n(t * 4.3, s === 'L' ? 32 : 33), 0, 12 * inf * this.n(t * 3.7, s === 'L' ? 34 : 35));
      }

      // Head snaps: jump to a new wrong angle, hold it, jump again.
      this.snapTimer -= dt;
      if (this.snapTimer <= 0) {
        this.snapTimer = this.rng.range(0.35, 2.2) / (0.5 + inf);
        const big = this.rng.chance(0.3);
        this.snap.x = this.rng.range(-25, 20) * (big ? 1.6 : 1);
        this.snap.y = this.rng.range(-45, 45) * (big ? 1.4 : 1);
        this.snap.z = this.rng.range(-35, 35);
      }
      const ks = Math.min(1, dt * 22);
      this.snapCur.x += (this.snap.x - this.snapCur.x) * ks;
      this.snapCur.y += (this.snap.y - this.snapCur.y) * ks;
      this.snapCur.z += (this.snap.z - this.snapCur.z) * ks;
      this.add('head', this.snapCur.x * inf, this.snapCur.y * inf * 0.6, this.snapCur.z * inf * 0.6);
      this.add('neck', 0, this.snapCur.y * inf * 0.4, this.snapCur.z * inf * 0.3);

      // Spasms: violent kicks through a random joint.
      this.spasmTimer -= dt;
      if (this.spasmTimer <= 0) {
        this.spasmTimer = this.rng.range(0.25, 1.8) / (0.4 + inf);
        this.spasm(0.35 + 0.65 * inf);
      }

      // Stumble: the body pitches forward and catches itself.
      if (this.gait === 'shamble' && this.speed > 0.3) {
        this.stumbleTimer -= dt;
        if (this.stumbleTimer <= 0) {
          this.stumbleTimer = this.rng.range(3, 8);
          this.stumble = 1;
        }
      }
      if (this.stumble > 0) {
        this.stumble = Math.max(0, this.stumble - dt * 1.8);
        const s = Math.sin(this.stumble * Math.PI);
        this.add('spine', -22 * s, 0, 8 * s);
        this.add('chest', -10 * s, 0, 0);
        this.add('upperArm_L', 45 * s, 0, -20 * s);
        this.add('upperArm_R', 45 * s, 0, 20 * s);
        this.bob.y -= 0.07 * s;
      }
    }

    if (c > 0.01) {
      // Lunge: low and forward, arms thrown out grasping, head jutting.
      this.add('spine', -20 * c, 0, 0);
      this.add('chest', -12 * c, 0, 0);
      this.add('neck', 18 * c, 0, 0);
      this.add('head', 14 * c, 0, 0);
      for (const s of ['L', 'R'] as const) {
        const ph = this.phase * 1.3 + (s === 'L' ? 0 : Math.PI);
        this.add(`upperArm_${s}`, (70 + 25 * Math.sin(ph)) * c, 0, (s === 'L' ? -1 : 1) * 15 * c);
        this.add(`foreArm_${s}`, (-10 + 30 * Math.max(0, Math.sin(ph))) * c, 0, 0);
        this.add(`hand_${s}`, -30 * c, 0, 0);
      }
    }

    // Twitching after death, fading out.
    if (this.deathTwitch > 0) {
      this.deathTwitch -= dt;
      if (this.rng.chance(dt * 6 * Math.min(1, this.deathTwitch / 2))) this.spasm(0.5 * Math.min(1, this.deathTwitch / 3));
    }
  }

  private static readonly SPASM_JOINTS: readonly JointName[] = [
    'head', 'head', 'neck', 'neck', 'chest', 'spine',
    'upperArm_L', 'upperArm_R', 'foreArm_L', 'foreArm_R', 'hand_L', 'hand_R', 'thigh_L', 'thigh_R',
  ];

  private spasm(strength: number): void {
    const name = this.rng.pick(Animator.SPASM_JOINTS);
    const i = J[name] * 3;
    const s = strength * this.rng.range(9, 18);
    this.reactVel[i] = (this.reactVel[i] ?? 0) + this.rng.range(-1, 1) * s;
    this.reactVel[i + 1] = (this.reactVel[i + 1] ?? 0) + this.rng.range(-1, 1) * s * 0.7;
    this.reactVel[i + 2] = (this.reactVel[i + 2] ?? 0) + this.rng.range(-1, 1) * s;
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

  private gazeRand(): number {
    this.gazeState = (this.gazeState * 48271) % 2147483647;
    return this.gazeState / 2147483647;
  }

  /** Sitting or leaning on something (ADR-0029 seats and lean spots). */
  private static readonly PLACED = /^(sit_|lean_)/;

  /** Poses where the arms are doing a job: their idle fidgets shrink. */
  private static readonly ARMS_BUSY: ReadonlySet<string> = new Set(['aim_pistol', 'typing', 'sit_typing', 'clipboard', 'crouchWork', 'kneel_revive', 'drink', 'offer_mug']);

  /**
   * Ambient life for standing bodies: slow breathing with clavicle lift, lateral weight shift
   * (with FootIk keeping soles pinned), and loose arms. Scaled down gently when mocap idle already
   * supplies primary breathing/sway so the two layers complement instead of doubling up.
   */
  private updateIdleLife(dt: number): void {
    const moveFade = this.useMocap ? Math.max(0, 1 - this.locoInfo.moveWeight * 3) : Math.max(0, 1 - this.amp * 4);
    const target = this.idleLife > 0 && !this.seq ? this.idleLife * moveFade : 0;
    this.lifeW += (target - this.lifeW) * Math.min(1, dt * 2);
    const w = this.lifeW;
    if (w < 1e-3) return;
    const t = this.time;
    const s = this.noiseSeed;
    // Mocap idle already provides subtle breathing/sway; layer lighter individualized variation on top.
    const k = 1 - this.mocapW * 0.55;
    const breath = Math.sin(t * 1.5 + s) * (1 + 0.25 * Math.sin(t * 0.37 + s * 1.7)) * w * k;
    this.add('spine', 0.5 * breath, 0, 0);
    this.add('chest', 1.1 * breath, 0, 0);
    this.add('neck', -0.4 * breath, 0, 0);
    this.add('head', -0.5 * breath, 0, 0);
    // Subtle clavicle rise on inhale.
    this.add('shoulder_L', 0, 0, -0.7 * breath);
    this.add('shoulder_R', 0, 0, 0.7 * breath);
    this.add('upperArm_L', 0, 0, 0.5 * breath);
    this.add('upperArm_R', 0, 0, -0.5 * breath);
    // Weight shift: pelvis translates laterally + rolls, spine counters so the head stays level.
    // Not for a body sitting or leaning on something (ADR-0029): it would slide across the seat.
    const placed = Animator.PLACED.test(this.to.name) ? 0 : 1;
    const sh = (Math.sin(t * 0.42 + s * 1.3) * 0.6 + Math.sin(t * 0.17 + s * 0.7) * 0.4) * w * k * placed;
    this.bob.x += 0.016 * sh;
    this.add('pelvis', 0, 1.2 * sh, 1.6 * sh);
    this.add('spine', 0, -0.6 * sh, -1.2 * sh);
    this.add('chest', 0, -0.4 * sh, -0.6 * sh);
    this.add('head', 0, 0, 0.2 * sh);
    const f = Animator.ARMS_BUSY.has(this.to.name) ? 0.25 : 1;
    const a = w * f * k;
    this.add('upperArm_L', 0, 0, 0.8 * sh * f);
    this.add('upperArm_R', 0, 0, 0.8 * sh * f);
    this.add('foreArm_L', 1.0 * this.n(t * 0.5, 7) * a, 0, 0);
    this.add('foreArm_R', 1.0 * this.n(t * 0.5, 8) * a, 0, 0);
    this.add('hand_L', 1.5 * this.n(t * 0.5, 9) * a, 0, 0);
    this.add('hand_R', 1.5 * this.n(t * 0.5, 10) * a, 0, 0);
  }

  /**
   * Multi-segment spring look-at: fast head/neck spring locks onto the target first,
   * while a slower chest/spine spring follows a beat behind for organic shoulder recruitment.
   */
  private updateLook(dt: number): void {
    let yaw = 0;
    let pitch = 0;
    const upright = this.gait === 'none' || this.gait === 'walk' || this.gait === 'shamble' || this.gait === 'heavy';
    if (this.lookLocal && upright) {
      const d = this.lookLocal;
      // Eye height follows the pose's pelvis drop (seated ~1.2 m, a bar stool ~1.5 m; ADR-0029).
      const eyeY = 1.55 + Math.min(0, this.to.pelvis.y);
      yaw = THREE.MathUtils.clamp(Math.atan2(-d.x, -d.z), -1.25, 1.25);
      pitch = THREE.MathUtils.clamp(Math.atan2(d.y - eyeY, Math.hypot(d.x, d.z)), -0.6, 0.6);
    }
    const w = this.lifeW;
    if (w > 1e-3) {
      // Idle gaze: look off to one side or down for a moment, then back, unless something is being looked at.
      const g = this.gaze;
      g.left -= dt;
      if (g.left <= 0) {
        const away = this.gazeRand() < 0.55;
        g.tYaw = away ? (this.gazeRand() - 0.5) * 0.45 : 0;
        g.tPitch = away ? (this.gazeRand() - 0.6) * 0.16 : 0;
        g.left = 1.5 + this.gazeRand() * 3.5;
      }
      const gk = Math.min(1, dt * 2.2);
      g.yaw += (g.tYaw - g.yaw) * gk;
      g.pitch += (g.tPitch - g.pitch) * gk;
      const free = this.lookLocal ? 0 : 1;
      yaw += free * g.yaw * w + 0.03 * this.n(this.time, 1) * w;
      pitch += free * g.pitch * w + 0.015 * this.n(this.time, 2) * w;
    }

    const headYaw = this.lookHeadYaw.step(yaw, dt);
    const headPitch = this.lookHeadPitch.step(pitch, dt);
    // Chest/spine recruit gently when looking at a real target (less when arms are aiming a weapon).
    const torsoShare = this.lookLocal && !Animator.ARMS_BUSY.has(this.to.name) ? 1 : 0.25;
    const torsoYaw = this.lookTorsoYaw.step(yaw * torsoShare, dt);
    const torsoPitch = this.lookTorsoPitch.step(pitch * torsoShare * 0.6, dt);

    this.add('spine', torsoPitch * 0.1 * R2D, torsoYaw * 0.1 * R2D, 0);
    this.add('chest', torsoPitch * 0.18 * R2D, torsoYaw * 0.18 * R2D, 0);
    this.add('neck', headPitch * 0.3 * R2D, headYaw * 0.28 * R2D, 0);
    this.add('head', headPitch * 0.46 * R2D, headYaw * 0.44 * R2D, 0);
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
    const cur = this.finalPose;
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
