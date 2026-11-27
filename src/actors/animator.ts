import * as THREE from 'three';
import type { Rng } from '../core/rng.ts';
import {
  clipTravelAt,
  sampleClip,
  sampleClipContacts,
  sampleLocomotion,
  sampleZombieLocomotion,
  sharedMocapLibrary,
  sampleFingers,
  FINGER_CHANNELS,
  type CompiledMocapClip,
  type LocomotionSample,
  type MocapLibrary,
  type MotionSet,
} from './mocap.ts';
import { locomotionSet, postureFamily, poseTreatment, resolveProfile, sharedMotionProfiles, type PostureFamily, type ResolvedMotion } from './motionProfiles.ts';
import { blendPose, copyPose, emptyPose, type CompiledPose, type PoseLibrary } from './poses.ts';
import type { Emote } from '../data/types/dialogue.ts';
import { JOINT_INDEX, JOINTS, type JointName, type Side } from './skeleton.ts';
import { gesture, hash01, mouthOpenAt, type SpeechPlan } from './speechActing.ts';
import { solveTwoBone } from './ik.ts';
import { detailPass } from './detailPass.ts';
import { Spring1D } from './springs.ts';
import type { BladeMotion } from './blade/motion.ts';
import type { BladePerformance, BladePerformancePhase } from '../data/types/bladeCreature.ts';

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

type StandingOverlayKind = 'arms' | 'head' | 'idle';

const STANDING_ARMS_OVERLAY: ReadonlySet<string> = new Set([
  'offer_mug',
  'drink',
  'idle_mug',
  'idle_wand',
  'idle_pistol',
  'talk_gesture',
  'wave',
  'point',
  'rub_forearm',
  'flex_hand',
  'cough',
]);
const STANDING_HEAD_OVERLAY: ReadonlySet<string> = new Set(['glance', 'glance_other', 'look_down', 'look_up', 'head_tilt']);
const STANDING_IDLE_OVERLAY: ReadonlySet<string> = new Set(['idle_weight', 'idle_shift']);

const OVERLAY_ARMS_JOINTS: readonly JointName[] = [
  'shoulder_L', 'upperArm_L', 'foreArm_L', 'hand_L',
  'shoulder_R', 'upperArm_R', 'foreArm_R', 'hand_R',
  'neck', 'head',
];
const OVERLAY_HEAD_JOINTS: readonly JointName[] = ['neck', 'head'];

type PlacedArms = 'crossed' | 'hips';

/**
 * Which placed-arms family a pose is in: the resting pose (`idle_crossed`, `idle_hips`) or one of its head gestures
 * (`idle_crossed_glance`), with or without a character prefix. The whole family keeps its arms where they are.
 */
function placedArms(poseName: string): PlacedArms | null {
  return (/(?:^|_)idle_(crossed|hips)(?:_|$)/.exec(poseName)?.[1] as PlacedArms | undefined) ?? null;
}

/**
 * Standing upper-body actions and ambient fidgets keep the mocap trunk/legs active instead of dropping
 * `mocapW` to 0 (standing-posture-stability spec). Seated/leaning poses never match.
 */
function standingOverlayKind(poseName: string): StandingOverlayKind | null {
  if (/^(sit_|lean_)/.test(poseName)) return null;
  // Before the glance suffix test: a head-only overlay would leave placed arms on the mocap idle.
  if (placedArms(poseName)) return 'arms';
  // A character's own arms-out scan pose (Ruiz's `ruiz_arms_out`) keeps their legs and trunk on their idle: restless, not frozen.
  if (STANDING_ARMS_OVERLAY.has(poseName) || poseName.endsWith('_offer_mug') || poseName.endsWith('_arms_out') || poseName.endsWith('_idle_pistol')) return 'arms';
  if (STANDING_HEAD_OVERLAY.has(poseName) || poseName.endsWith('_glance') || poseName.endsWith('_glance_other')) return 'head';
  if (STANDING_IDLE_OVERLAY.has(poseName)) return 'idle';
  return null;
}

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
  /** Scales how fast the locomotion cycle turns for a given ground speed (a scripted kill slows the rushing creature's steps). */
  gaitRate = 1;
  /** Turn speed in rad/s (+ = left) and heading error to the target (rad). Used by crawlers AND upright turning/banking. */
  turnRate = 0;
  /** The body is walking backward: the walk cycle runs in reverse so the feet step back (Humanoid.backward). */
  reverse = false;
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
  /** How fast the head and trunk turn to the look target (1 = normal; under 1 is slower). */
  lookPace = 1;
  /**
   * 0..1: how much ambient idle life (breathing, weight shift, arm fidgets, gaze wandering) to layer on a standing body.
   * The body sets it for living non-enemies; it fades out while walking, in a sequence, or at 0.
   */
  idleLife = 0;
  /** Enable Tier B hybrid mocap base layer for this body (living upright human NPCs). */
  useMocap = false;
  /** This body's resolved motion profile (set once by the body, see `setMotion`). */
  motion!: ResolvedMotion;
  /** The locomotion clips from `motion` (idle, talk, walk, jog) the blend space samples. */
  motions!: MotionSet;
  /**
   * 0..1 scale on the procedural arm layers (speech gestures, idle fidgets and breathing, balance flare). A body whose profile
   * names clips of its own runs at `Animator.OWN_MOTION_ARMS`, so its captured arm motion is not buried under generated motion.
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
  /** How far the body moved in the last frame, in its own frame (m; x right, z back) and turned (rad, + left); set by the body. */
  readonly moved = { x: 0, z: 0, yaw: 0 };
  /** A creature body's own motion (the blade creature, rig-necromorph), or null for every human body. */
  creature: BladeMotion | null = null;
  /** Which blade arm is winding up for a swipe (`L` | `R`), or null. */
  bladeWindupSide: 'L' | 'R' | null = null;
  /** True while this body is grabbing the player (spreads blades clear of the player camera). */
  bladeGrabbing = false;
  /** Latest combat jaw/flare amounts emitted by `BladeMotion` this frame (0..1). */
  bladeMotionJaw = 0;
  bladeMotionFlare = 0;
  /** Named performances from a creature's profile (`data/blade-creature.json`, design D8), or null for humans. */
  performances: Readonly<Record<string, BladePerformance>> | null = null;
  /** Active performance amounts (0..1) read by `Humanoid` / `BladeMotion` each frame. */
  bladePerfJaw = 0;
  bladePerfFlare = 0;
  bladePerfTremor = 0;
  private perf: {
    name: string;
    phases: readonly BladePerformancePhase[];
    index: number;
    timer: number;
    holdOverride: number | undefined;
    onDone: (() => void) | null;
  } | null = null;
  private static readonly warnedPerfs = new Set<string>();
  private readonly addJoint = (name: JointName, x: number, y: number, z: number): void => this.add(name, x, y, z);
  private readonly baseE = new THREE.Euler();
  /** A joint's X angle (degrees) in the current blended pose, before any layer. */
  private readonly baseX = (name: JointName): number => {
    const q = this.current.joints[J[name]];
    return q ? THREE.MathUtils.radToDeg(this.baseE.setFromQuaternion(q, 'XYZ').x) : 0;
  };
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
  /** The clip library this body samples. */
  get mocapLibrary(): MocapLibrary {
    return this.mocap;
  }
  private readonly current = emptyPose('current');
  private readonly from = emptyPose('from');
  private readonly mocapPose = emptyPose('mocap');
  private readonly finalPose = emptyPose('final');
  /** A captured clip played once as the base pose (`playClip`), its progress, and the pose it is sampled into. */
  private oneShot: { clip: CompiledMocapClip; u: number; pose: CompiledPose; inPlace: boolean } | null = null;
  /**
   * Where the last `playClip` wants the body's origin moved, on the floor, in the root bone's parent space (unscaled
   * skeleton units, the body's own facing). The caller moves the body by it; the pose already allows for it.
   */
  readonly clipShift = new THREE.Vector3();
  /** Clock the convulsion noise runs on (`update`). */
  private convulsePhase = 0;
  /** Convulsion runs at this share of its speed while a one-shot clip plays: tremor and spasm, not flicker at 30 fps. */
  static readonly CLIP_CONVULSE_RATE = 1 / 3;
  private readonly overlayEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly overlayYawQ = new THREE.Quaternion();
  private static readonly Y_AXIS = new THREE.Vector3(0, 1, 0);
  private overlayW = 0;
  private overlayKind: Exclude<StandingOverlayKind, 'idle'> | null = null;
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
  /** Share of generated arm gestures displaced by Giles's captured standing dialogue this frame. */
  private capturedSpeechArms = 0;
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
    this.setMotion(resolveProfile(this.mocap, sharedMotionProfiles(), undefined, 'm'));
  }

  get poseName(): string {
    return this.to.name;
  }

  /** How far (0..1) the blend into the current pose has come; 1 once it has landed. */
  get blendProgress(): number {
    return this.blendT;
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

  /** A one-shot clip is driving the base pose (a kill beat's `clip`). */
  get clipPlaying(): boolean {
    return this.oneShot !== null;
  }

  /**
   * Play a captured clip once as the base pose, blending in over `blend` s (infection-kills spec "A kill beat can play
   * a captured clip"). The caller moves it on with `clipPhase`; it holds its last frame at 1. Additive layers
   * (convulsion, kicks, reactions, look) stay on top. `setPose` or `playSequence` stops it. Returns the clip's length
   * in seconds, or null when this body's library has no such clip.
   */
  playClip(id: string, blend = 0.3, opts: { from?: number; inPlace?: boolean } = {}): number | null {
    if (!this.mocap.has(id)) return null;
    const clip = this.mocap.get(id);
    this.seq = null;
    const pose = this.oneShot?.pose ?? emptyPose(`clip:${id}`);
    pose.name = `clip:${id}`;
    const u0 = THREE.MathUtils.clamp((opts.from ?? 0) / Math.max(1e-6, clip.duration), 0, 1);
    const inPlace = opts.inPlace === true;
    sampleClip(clip, u0, pose);
    if (inPlace) this.removeTravel(clip, u0, pose);
    // A lying pose lies by tipping the root; a captured clip lies by turning the hips. Blending one into the other
    // sags through the floor halfway, so first rebuild the pose being left on the clip's root (same body, same place).
    this.rebaseRoot(this.current, pose);
    if (inPlace) {
      // A route moves the body (voss-death-scene D3): the origin stays where the route has it, and the hips blend from
      // where they are to the clip's own place over them.
      this.clipShift.set(0, 0, 0);
    } else {
      // The bake centres a clip's hips on their average over the take, so a get-up's lying first frame sits off where
      // the body actually lies (a prone pose lies by tipping the root, the clip by bending the joints). The body's
      // origin moves (`clipShift`) so the first frame's hips land where the hips are now, and the pose being left
      // moves back by as much so nothing jumps: it gets up from where it lay, and stands where the clip ends.
      const shift = this.hipsOnRoot(this.current, this.clipShift).sub(this.hipsOnRoot(pose, this.hipsB));
      shift.y = 0;
      this.current.rootPos.sub(shift);
    }
    this.oneShot = { clip, u: u0, pose, inPlace };
    this.startBlend(pose, blend);
    return clip.duration;
  }

  private readonly travelTmp = new THREE.Vector3();

  /** Take the clip's own travel across the floor out of a sampled pose: the hips keep their height and their sway. */
  private removeTravel(clip: CompiledMocapClip, u: number, pose: CompiledPose): void {
    const tr = clipTravelAt(clip, u, this.travelTmp);
    pose.pelvis.x -= tr.x;
    pose.pelvis.z -= tr.z;
  }

  /**
   * The playing clip's own foot contacts [left, right] (voss-death-scene D5), into `out`. False when no clip plays or the
   * take has no contact curves (the body then works them out from the feet).
   */
  clipContacts(out: [number, number]): boolean {
    const shot = this.oneShot;
    return shot ? sampleClipContacts(shot.clip, shot.u, out) : false;
  }

  private readonly hipsB = new THREE.Vector3();

  private readonly qA = new THREE.Quaternion();

  /**
   * Rewrite `pose` so its root bone matches `to`'s root, moving the difference into the hips (rotation and
   * position), which leaves every joint where it was. The root's only child is the pelvis.
   */
  private rebaseRoot(pose: CompiledPose, to: CompiledPose): void {
    const pelvisQ = pose.joints[J.pelvis];
    if (!pelvisQ) return;
    const hips = this.hipsOnRoot(pose, this.hipsA);
    const inv = this.qA.copy(to.rootRot).invert();
    pelvisQ.premultiply(pose.rootRot).premultiply(inv);
    pose.rootRot.copy(to.rootRot);
    pose.rootPos.copy(to.rootPos);
    // hipsOnRoot(pose) must stay put: rootPos + rootRot * (rest + pelvis) = hips.
    pose.pelvis.copy(hips.sub(to.rootPos).applyQuaternion(inv));
    const rest = this.restPos[J.pelvis];
    if (rest) pose.pelvis.sub(rest);
  }

  private readonly hipsA = new THREE.Vector3();

  /** Where a pose puts the hips, in the space the root bone sits in. */
  private hipsOnRoot(pose: CompiledPose, out: THREE.Vector3): THREE.Vector3 {
    const rest = this.restPos[J.pelvis];
    out.copy(pose.pelvis);
    if (rest) out.add(rest);
    return out.applyQuaternion(pose.rootRot).add(pose.rootPos);
  }

  /** How far through the one-shot clip the body is (0..1). */
  clipPhase(u: number): void {
    if (this.oneShot) this.oneShot.u = THREE.MathUtils.clamp(u, 0, 1);
  }

  /** A pose on some joints only (`setLayer`): which joints, the pose being blended to, and how the blend has come. */
  private layerJoints: number[] = [];
  private readonly layerFrom = emptyPose('layerFrom');
  private readonly layerCur = emptyPose('layerCur');
  private layerTo: CompiledPose | null = null;
  private layerT = 1;
  private layerDur = 0;
  /** The layer's weight over the base (eases in and out over `LAYER_FADE` s) and the weight it is easing to. */
  private layerW = 0;
  private layerWant = 0;
  /** Seconds the layer takes to come on or go off as a whole. */
  static readonly LAYER_FADE = 0.25;

  /**
   * Play `pose` on `joints` only (a kill beat's layer, voss-death-scene D6), blending from what the layer showed over
   * `blend` s, over whatever drives the rest of the body (a captured clip, a pose). Kicks, convulsion and look still
   * layer on top. `joints` null eases the layer off.
   */
  setLayer(joints: readonly JointName[] | null, pose?: string, blend = 0.15): void {
    if (!joints || !pose || joints.length === 0) {
      this.layerWant = 0;
      return;
    }
    const target = this.poses.get(this.ownPose(pose));
    const ids = joints.map((j) => J[j]);
    const fresh = this.layerW <= 1e-4 || !this.layerTo;
    if (fresh) {
      copyPose(target, this.layerCur);
      copyPose(target, this.layerFrom);
      this.layerT = 1;
    } else {
      copyPose(this.layerCur, this.layerFrom);
      this.layerT = 0;
    }
    this.layerDur = Math.max(1e-3, blend);
    this.layerTo = target;
    this.layerJoints = ids;
    this.layerWant = 1;
  }

  /** The layer's weight now (0..1; tests). */
  get layerWeight(): number {
    return this.layerW;
  }

  /** Blend the layer's joints of the pose being written toward the layer's pose (`setLayer`). */
  private applyLayer(dt: number): void {
    const step = dt / Animator.LAYER_FADE;
    this.layerW = THREE.MathUtils.clamp(this.layerW + Math.sign(this.layerWant - this.layerW) * step, Math.min(this.layerW, this.layerWant), Math.max(this.layerW, this.layerWant));
    if (this.layerW <= 1e-4 || !this.layerTo) {
      if (this.layerWant === 0) this.layerTo = null;
      return;
    }
    this.layerT = Math.min(1, this.layerT + dt / this.layerDur);
    const s = this.layerT * this.layerT * (3 - 2 * this.layerT);
    const w = this.layerW * this.layerW * (3 - 2 * this.layerW);
    for (const i of this.layerJoints) {
      const cur = this.layerCur.joints[i];
      const a = this.layerFrom.joints[i];
      const b = this.layerTo.joints[i];
      const out = this.finalPose.joints[i];
      if (!cur || !a || !b || !out) continue;
      cur.slerpQuaternions(a, b, s);
      out.slerp(cur, w);
    }
  }

  /** Blend to a pose from wherever the body is now. `blend <= 0` snaps immediately. */
  /**
   * A creature's own pose for the one asked for (rig-necromorph design D4): its pose map's entry, or the pose itself when it
   * maps nothing. A mapped pose that is missing falls back to the creature's stance, with one warning.
   */
  ownPose(name: string): string {
    const map = this.poseMap;
    const to = map?.[name];
    if (!to) return name;
    if (this.poses.has(to)) return to;
    const key = `${name}->${to}`;
    if (!Animator.warnedMaps.has(key)) {
      Animator.warnedMaps.add(key);
      console.warn(`[blade] pose map: "${name}" maps to "${to}", which is not in poses.json; using ${map['idle'] ?? 'idle'}`);
    }
    return map['idle'] && this.poses.has(map['idle']) ? map['idle'] : name;
  }

  /** The creature's pose map (data/blade-creature.json `poseMap`), or null for every human body. */
  poseMap: Readonly<Record<string, string>> | null = null;
  private static readonly warnedMaps = new Set<string>();

  setPose(asked: string, blend = 0.4): void {
    this.stopPerformance();
    const name = this.ownPose(asked);
    if (this.to.name === name && !this.seq) return;
    this.seq = null;
    this.oneShot = null;
    const target = this.poses.get(name);
    if (blend <= 0) {
      this.to = target;
      copyPose(target, this.current);
      copyPose(target, this.finalPose);
      this.blendT = 1;
      this.blendDur = 0;
      return;
    }
    this.startBlend(target, blend);
  }

  /** Whether this body's profile defines a performance by `name` (such as `scream`, design D8). */
  hasPerformance(name: string): boolean {
    return Boolean(this.performances?.[name]);
  }

  /** True while a timed creature performance is playing. */
  get performancePlaying(): boolean {
    return this.perf !== null;
  }

  /**
   * Play a named creature performance (`data/blade-creature.json` `performances`, design D8).
   * `hold` overrides the hold duration of any phase marked `stretch: true`. Returns false and warns once if missing.
   */
  playPerformance(name: string, opts: { hold?: number; onDone?: () => void } = {}): boolean {
    const def = this.performances?.[name];
    if (!def || def.phases.length === 0) {
      if (!Animator.warnedPerfs.has(name)) {
        Animator.warnedPerfs.add(name);
        console.warn(`[blade] performance "${name}" is not defined on this body`);
      }
      opts.onDone?.();
      return false;
    }
    this.stopPerformance();
    this.seq = null;
    this.oneShot = null;
    const first = def.phases[0]!;
    const hold = first.stretch && opts.hold !== undefined ? opts.hold : first.hold;
    this.perf = { name, phases: def.phases, index: 0, timer: first.blend + hold, holdOverride: opts.hold, onDone: opts.onDone ?? null };
    this.bladePerfJaw = first.jaw ?? 0;
    this.bladePerfFlare = first.flare ?? 0;
    this.bladePerfTremor = first.tremor ?? 0;
    this.startBlend(this.poses.get(this.ownPose(first.pose)), first.blend);
    return true;
  }

  /** End any active performance immediately, resetting its jaw, flare and tremor amounts. */
  stopPerformance(): void {
    const p = this.perf;
    this.perf = null;
    this.bladePerfJaw = 0;
    this.bladePerfFlare = 0;
    this.bladePerfTremor = 0;
    p?.onDone?.();
  }

  playSequence(name: string, onDone: (() => void) | null = null): void {
    const steps = this.poses.sequence(name);
    const first = steps[0];
    if (!first) return;
    this.oneShot = null;
    this.seq = { steps, index: 0, timer: first.blend + first.hold, onDone };
    this.startBlend(this.poses.get(this.ownPose(first.pose)), first.blend);
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
    // Convulsion runs on its own clock: slower while a captured clip plays, so it reads as spasm over the motion
    // rather than flicker (equal to `time` for a body that never plays one).
    this.convulsePhase += dt * (this.oneShot ? Animator.CLIP_CONVULSE_RATE : 1);
    const shot = this.oneShot;
    if (shot) {
      sampleClip(shot.clip, shot.u, shot.pose);
      if (shot.inPlace) this.removeTravel(shot.clip, shot.u, shot.pose);
    }
    this.updateBlend(dt);
    // Once blended in, the clip is the base pose every frame (the blend above only moves `current` while it runs).
    if (shot && this.to === shot.pose && this.blendT >= 1) copyPose(shot.pose, this.current);
    this.off.fill(0);
    this.bob.set(0, 0, 0);
    this.rootEuler.set(0, 0, 0);
    this.footContacts[0] = 1;
    this.footContacts[1] = 1;

    const mocapActive = this.updateMocapBase(dt);
    if (this.fadeT > 0) {
      this.fadeT = Math.max(0, this.fadeT - dt);
      const k = 1 - this.fadeT / this.fadeLen;
      blendPose(this.fadeFrom, this.finalPose, k * k * (3 - 2 * k), this.finalPose);
    }
    if (this.layerTo) this.applyLayer(dt);
    if (!this.creature) {
      this.distributeSpine();
      this.updateHold(dt);
    }
    this.updateGait(dt, mocapActive);
    if (this.perf) {
      if (this.speed > 0.25) {
        // Moving cuts a standing performance straight into the gait with no standing pause (design D8).
        this.stopPerformance();
      } else {
        const p = this.perf;
        const cur = p.phases[p.index]!;
        const k = Math.min(1, dt * 10);
        this.bladePerfJaw += ((cur.jaw ?? 0) - this.bladePerfJaw) * k;
        this.bladePerfFlare += ((cur.flare ?? 0) - this.bladePerfFlare) * k;
        this.bladePerfTremor += ((cur.tremor ?? 0) - this.bladePerfTremor) * k;
        p.timer -= dt;
        if (p.timer <= 0) {
          p.index++;
          const next = p.phases[p.index];
          if (!next) {
            this.stopPerformance();
          } else {
            const hold = next.stretch && p.holdOverride !== undefined ? p.holdOverride : next.hold;
            p.timer = next.blend + hold;
            this.startBlend(this.poses.get(this.ownPose(next.pose)), next.blend);
          }
        }
      }
    }
    if (this.creature) {
      // A creature body (rig-necromorph design D6): its own motion replaces the human layers (sway, turn steps, idle life, speech).
      const out = this.creature.update(this.addJoint, {
        dt,
        time: this.time,
        speed: this.speed,
        gaitRate: this.gaitRate,
        baseX: this.baseX,
        pelvisY: this.current.pelvis.y,
        turnRate: this.turnRate,
        moved: this.moved,
        locked: this.to.name.startsWith('blade_pry_') || this.perf !== null,
        charge: this.charge,
        windupSide: this.bladeWindupSide,
        grabbing: this.bladeGrabbing,
        tremor: this.bladePerfTremor,
      });
      this.bladeMotionJaw = out.jaw;
      this.bladeMotionFlare = out.flare;
      if (this.gait !== 'crawl' && this.gait !== 'drag') {
        this.footContacts[0] = out.contacts[0];
        this.footContacts[1] = out.contacts[1];
        this.footfall = out.footfall;
        this.bob.y += out.bob;
        this.bob.x += out.bobX;
        this.bob.z += out.bobZ;
      }
    } else {
      // Turned bodies ignore their living profile, including its damped arm layers.
      const arms = this.twitchy ? 1 : this.armLayer;
      this.armScale = arms;
      this.updateInertialPhysics(dt);
      this.armScale = 1;
      this.updateTurnInPlace(dt);
      this.armScale = arms;
      this.updateIdleLife(dt);
      // A calm line's forearm gesture is the only speech motion on the arms (its talk capture plays on the trunk), so it is not
      // damped under the body's own clips the way the whole-arm gestures of heightened lines are.
      if (this.speech?.style.forearmOnly && !this.twitchy) this.armScale = 1;
      this.updateSpeech(dt);
    }
    this.armScale = 1;
    this.updateLook(dt);
    this.updateInjury(dt);
    this.updateInfected(dt);
    this.updateReactions(dt);
    this.addConvulsions();
    if (this.holdW >= 0.005 && this.holdClip) this.writeWithHold();
    else this.write();
    this.anchorHandsOnHips(dt);
    this.anchorCrossedArms(dt);
  }

  /** How far the hands are pinned to the hips (0..1), easing in and out with `idle_hips`. */
  private hipW = 0;
  /**
   * The arms are placed against the body on purpose (hands on hips, arms crossed): the body's hand-contact solve keeps their
   * elbows (limbContact `keepElbows`) instead of swinging them to its own anatomical pole, which would roll the forearms and
   * carry the hands off the hips or out from round the other arm.
   */
  get armsPlaced(): boolean {
    return this.hipW > 0.5 || this.crossW > 0.5;
  }
  private readonly hipTarget = new THREE.Vector3();
  private readonly hipJoint = new THREE.Vector3();
  private readonly hipPelvis = new THREE.Vector3();
  private readonly hipOut = new THREE.Vector3();
  private readonly hipBack = new THREE.Vector3();
  private readonly hipElbow = new THREE.Vector3();
  private readonly hipRot = new THREE.Quaternion();
  /**
   * Where a hand rests on its hip, from the hip joint: out to the side of the pelvis, up onto the crest and a touch back, so the
   * body's contact push settles it on the side of the hip rather than shoving it forward (metres).
   */
  static readonly HIP_HAND_OUT = 0.11;
  static readonly HIP_HAND_UP = 0.16;
  static readonly HIP_HAND_BACK = 0.03;
  /** Where the elbow is drawn, from the hand: well out, up and a little back (the akimbo elbow). */
  static readonly HIP_ELBOW_OUT = 0.3;
  static readonly HIP_ELBOW_UP = 0.2;
  static readonly HIP_ELBOW_BACK = 0.08;

  /**
   * Hands on hips is a contact with the pelvis, not an arm shape: the arms hang off the chest, and under the standing arms overlay
   * the trunk plays the character's own idle (leaning, swaying, a big man's chest well ahead of his hips), so the authored angles
   * alone leave the hands off the hips on most bodies. After the pose is written, each hand is solved onto its own hip with the
   * elbow drawn out wide, keeping the hand's orientation; the body's hand-contact solve then settles it on the surface.
   */
  private anchorHandsOnHips(dt: number): void {
    const want = !this.twitchy && placedArms(this.to.name) === 'hips' ? 1 : 0;
    this.hipW += (want - this.hipW) * (1 - Math.exp(-6 * dt));
    if (this.hipW < 0.003 || !this.bones[0]) {
      if (!want) this.hipW = 0;
      return;
    }
    const w = THREE.MathUtils.smoothstep(this.hipW, 0, 1);
    const thighL = this.bones[J.thigh_L];
    const thighR = this.bones[J.thigh_R];
    if (!thighL || !thighR) return;
    this.bones[0].updateWorldMatrix(true, true);
    this.bones[J.pelvis]?.getWorldPosition(this.hipPelvis);
    // Backward along the body: up x (left hip - right hip), level.
    thighL.getWorldPosition(this.hipBack);
    this.hipBack.sub(thighR.getWorldPosition(this.hipJoint)).setY(0);
    if (this.hipBack.lengthSq() < 1e-6) return;
    this.hipBack.normalize().cross(Animator.Y_AXIS).negate();
    for (const s of ['L', 'R'] as const) {
      const up = this.bones[J[`upperArm_${s}`]];
      const lo = this.bones[J[`foreArm_${s}`]];
      const hand = this.bones[J[`hand_${s}`]];
      const thigh = s === 'L' ? thighL : thighR;
      if (!up || !lo || !hand || this.limp.has(J[`hand_${s}`])) continue;
      thigh.getWorldPosition(this.hipJoint);
      this.hipOut.subVectors(this.hipJoint, this.hipPelvis).setY(0);
      if (this.hipOut.lengthSq() < 1e-6) continue;
      this.hipOut.normalize();
      this.hipTarget.copy(this.hipJoint).addScaledVector(this.hipOut, Animator.HIP_HAND_OUT).addScaledVector(this.hipBack, Animator.HIP_HAND_BACK);
      this.hipTarget.y += Animator.HIP_HAND_UP;
      this.hipElbow.copy(this.hipTarget).addScaledVector(this.hipOut, Animator.HIP_ELBOW_OUT).addScaledVector(this.hipBack, Animator.HIP_ELBOW_BACK);
      this.hipElbow.y += Animator.HIP_ELBOW_UP;
      hand.getWorldPosition(this.hipJoint);
      this.hipTarget.lerp(this.hipJoint, 1 - w);
      hand.getWorldQuaternion(this.hipRot);
      solveTwoBone(up, lo, hand, this.hipTarget, this.hipElbow);
      const parentQ = lo.getWorldQuaternion(this.holdQ);
      hand.quaternion.copy(parentQ.invert().multiply(this.hipRot));
      hand.updateMatrixWorld(true);
    }
  }

  /** How far the wrists are pinned onto the other arm (0..1), easing in and out with `idle_crossed`. */
  private crossW = 0;
  private readonly crossOther = new THREE.Vector3();
  private readonly crossAlong = new THREE.Vector3();
  private readonly crossLat = new THREE.Vector3();
  private readonly crossTurn = new THREE.Quaternion();
  private readonly crossEuler = new THREE.Euler();
  /** Each hand's turn from the authored wrist once it is on the other arm (degrees, XYZ): flexed down over that arm. */
  static readonly CROSS_HAND = { L: [-30, 0, 0], R: [-30, 0, 0] } as const;
  /**
   * Where each wrist rests, from the other arm's elbow (metres): up that arm toward the shoulder, in from its outer edge, and in
   * front of it for the left (top) hand, which lies on the right biceps; behind it for the right one, tucked under the left arm.
   */
  static readonly CROSS_ALONG = { L: 0.1, R: 0.08 } as const;
  static readonly CROSS_IN = { L: 0.11, R: 0.11 } as const;
  static readonly CROSS_FRONT = { L: 0.05, R: -0.03 } as const;
  static readonly CROSS_UP = { L: 0.04, R: -0.02 } as const;

  /**
   * Crossed arms are a contact between the forearms and the other arm, and how far a forearm reaches across depends on the build
   * (shoulder width, forearm length, a coat's depth), so the authored angles alone leave some bodies' wrists short of the midline.
   * After the pose is written, each wrist is solved onto the other arm just above its elbow, keeping its own elbow direction: the
   * right first, tucked behind the left arm, then the left over it, lying on the right biceps. Each hand then flexes down over
   * the arm it rests on instead of sticking out past it.
   */
  private anchorCrossedArms(dt: number): void {
    const want = !this.twitchy && placedArms(this.to.name) === 'crossed' ? 1 : 0;
    this.crossW += (want - this.crossW) * (1 - Math.exp(-6 * dt));
    if (this.crossW < 0.003 || !this.bones[0]) {
      if (!want) this.crossW = 0;
      return;
    }
    const thighL = this.bones[J.thigh_L];
    const thighR = this.bones[J.thigh_R];
    if (!thighL || !thighR) return;
    const w = THREE.MathUtils.smoothstep(this.crossW, 0, 1);
    this.bones[0].updateWorldMatrix(true, true);
    // Forward along the body: (left hip - right hip) x up, level.
    thighL.getWorldPosition(this.hipBack);
    this.hipBack.sub(thighR.getWorldPosition(this.hipJoint)).setY(0);
    if (this.hipBack.lengthSq() < 1e-6) return;
    this.crossLat.copy(this.hipBack.normalize());
    this.hipBack.cross(Animator.Y_AXIS);
    for (const s of ['R', 'L'] as const) {
      const o = s === 'L' ? 'R' : 'L';
      const up = this.bones[J[`upperArm_${s}`]];
      const lo = this.bones[J[`foreArm_${s}`]];
      const hand = this.bones[J[`hand_${s}`]];
      const otherUp = this.bones[J[`upperArm_${o}`]];
      const otherLo = this.bones[J[`foreArm_${o}`]];
      if (!up || !lo || !hand || !otherUp || !otherLo || this.limp.has(J[`hand_${s}`])) continue;
      otherLo.getWorldPosition(this.crossOther);
      otherUp.getWorldPosition(this.crossAlong).sub(this.crossOther).normalize();
      this.hipTarget.copy(this.crossOther).addScaledVector(this.crossAlong, Animator.CROSS_ALONG[s]).addScaledVector(this.hipBack, Animator.CROSS_FRONT[s]);
      this.hipTarget.addScaledVector(this.crossLat, (s === 'L' ? 1 : -1) * Animator.CROSS_IN[s]);
      this.hipTarget.y += Animator.CROSS_UP[s];
      hand.getWorldPosition(this.hipJoint);
      this.hipTarget.lerp(this.hipJoint, 1 - w);
      lo.getWorldPosition(this.hipElbow);
      hand.getWorldQuaternion(this.hipRot);
      solveTwoBone(up, lo, hand, this.hipTarget, this.hipElbow);
      // Keep the authored wrist, then flex the hand down over the arm it rests on.
      const parentQ = lo.getWorldQuaternion(this.holdQ);
      hand.quaternion.copy(parentQ.invert().multiply(this.hipRot));
      const turn = Animator.CROSS_HAND[s];
      this.crossEuler.set(turn[0] * D2R * w, turn[1] * D2R * w, turn[2] * D2R * w, 'XYZ');
      hand.quaternion.multiply(this.crossTurn.setFromEuler(this.crossEuler));
      hand.updateMatrixWorld(true);
    }
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
    this.startBlend(this.poses.get(this.ownPose(step.pose)), step.blend);
  }

  // ---------------------------------------------------------------- Tier B mocap base layer

  /**
   * Drives living upright humanoids (both human cast/NPCs and upright infected enemies) with retargeted
   * CC0 mocap clips (`idle`, `idle_talk`, `walk`, `walk_formal`, `jog`, `pistol_idle`, `kneel_fix`, `crouch_idle`),
   * blending seamlessly with authored poses (`poses.json`) when scripts, horror postures, or slams request them.
   * Returns true when mocap owns the locomotion cycle (so legacy sine-wave walk/shamble legs stay off).
   */
  private updateMocapBase(dt: number): boolean {
    this.capturedSpeechArms = 0;
    const poseName = this.to.name;
    const overlay = !this.twitchy ? standingOverlayKind(poseName) : null;
    let targetW = 0;
    let mode: 'loco' | 'shamble' | 'heavy' | 'pistol' | 'kneel' | 'crouch' | 'none' = 'none';

    // A one-shot clip owns the body while it plays, even on the move (overhaul-priya-r08-death: Priya's stumble mid-run).
    if (this.useMocap && !this.seq && !this.oneShot && this.convulse <= 0.01) {
      if (this.twitchy) {
        if (this.gait === 'shamble' || this.gait === 'flail') {
          mode = 'shamble';
          targetW = 1;
        } else if (this.gait === 'heavy' && poseName !== 'slamWindup' && poseName !== 'slamImpact') {
          mode = 'heavy';
          targetW = 0.4;
        }
      } else if (MOCAP_LOCO_POSES.has(poseName) || overlay !== null || this.speed > 0.08) {
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
      this.clipFingerW = 0;
      copyPose(this.current, this.finalPose);
      return false;
    }

    // Advance clip phases cleanly.
    const idleClip = this.mocap.get(
      mode === 'shamble' || mode === 'heavy'
        ? 'zombie_idle'
        : mode === 'pistol'
          ? this.motion.clips.aimPistol
          : mode === 'kneel'
            ? this.motion.clips.kneel
            : mode === 'crouch'
              ? this.motion.clips.crouch
              : this.motions.idle,
    );
    // Living profile tempo only; infected bodies keep the infected timing (character-motion spec).
    this.idlePhase = (this.idlePhase + (dt * (this.twitchy ? 1 : this.tempo)) / Math.max(0.1, idleClip.duration)) % 1;

    if (mode === 'shamble' || mode === 'heavy') {
      const zStride = Math.max(0.9, this.mocap.get('zombie_walk').stride || 1.5);
      if (this.speed > 0.02) {
        // Slower, heavier zombie step progression: limp speed matches ground travel without frantic leg spin.
        const strideMul = mode === 'heavy' ? 1.45 : 1.05;
        this.locoPhase = (this.locoPhase + (this.speed / (zStride * strideMul)) * dt * this.gaitRate) % 1;
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
        const step = (this.speed / stride) * dt * this.gaitRate * (this.reverse ? -1 : 1);
        this.locoPhase = (((this.locoPhase + step) % 1) + 1) % 1;
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
      if (poseName === 'aim_pistol') {
        // Tactical walk with pistol drawn forward: legs follow locomotion while upper body holds aimPistol.
        const aimClip = this.mocap.get(this.motion.clips.aimPistol);
        const aimPhase = (this.idlePhase * (idleClip.duration / Math.max(0.1, aimClip.duration))) % 1;
        sampleClip(aimClip, aimPhase, this.talkPose);
        for (const jName of UPPER_BODY) {
          const idx = J[jName];
          const a = this.mocapPose.joints[idx];
          const b = this.talkPose.joints[idx];
          if (a && b) a.copy(b);
        }
      }
      // When speaking while standing still, subtly blend in the natural weight-shift/torso motion from idle_talk
      // without overriding the speechActing emote arm gestures (keep idle_talk subtle on arms).
      if (this.speechW > 0.01 && this.speed < 0.15 && !Animator.ARMS_BUSY.has(poseName)) {
        const talkClip = this.mocap.get(this.motions.talk);
        const talkPhase = (this.idlePhase * (idleClip.duration / talkClip.duration)) % 1;
        sampleClip(talkClip, talkPhase, this.talkPose);
        // A talk capture never drives the arms (spec speech-acting): the conversation takes they come from flail. A character
        // with one of its own plays it on the trunk and clavicles; everyone else keeps the shared clip subtle, on the trunk.
        // Giles's reviewed one-handed accent is the one capture that plays on the arms, below.
        const own = this.motion.ownClips && this.motions.talk !== this.motions.idle;
        const calmGiles = this.motions.talk === 'giles_talk';
        const ownW = calmGiles ? Animator.OWN_TALK_WEIGHT : Animator.OWN_TRUNK_TALK_WEIGHT;
        const tw = this.speechW * (1 - this.locoInfo.moveWeight) * (own ? ownW : 0.35);
        let joints = Animator.TALK_JOINTS;
        if (calmGiles) {
          // His one-handed accent plays over the standing idle, including its relaxed clavicles.
          joints = Animator.TALK_ARMS;
          this.capturedSpeechArms = this.speechW * (1 - this.locoInfo.moveWeight) * this.mocapW;
        } else {
          this.mocapPose.pelvis.lerp(this.talkPose.pelvis, tw);
        }
        for (const jName of joints) {
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

    // Layer standing upper-body actions/fidgets over the mocap trunk & legs so `mocapW` never drops to 0.
    const wantOverlay = mode === 'loco' && overlay !== null && overlay !== 'idle';
    if (wantOverlay) this.overlayKind = overlay;
    const overlayRate = Math.max(5.5, 3.2 / Math.max(0.12, this.blendDur));
    this.overlayW += ((wantOverlay ? 1 : 0) - this.overlayW) * (1 - Math.exp(-overlayRate * dt));
    if (this.overlayW < 0.005) {
      this.overlayW = 0;
      if (!wantOverlay) this.overlayKind = null;
    } else if (mode === 'loco' && this.overlayKind) {
      const joints = this.overlayKind === 'arms' ? OVERLAY_ARMS_JOINTS : OVERLAY_HEAD_JOINTS;
      for (const jName of joints) {
        const idx = J[jName];
        const dst = this.finalPose.joints[idx];
        const src = this.current.joints[idx];
        if (dst && src) dst.slerp(src, this.overlayW);
      }
      if (this.overlayKind === 'head') {
        const curChest = this.current.joints[J.chest];
        const dstChest = this.finalPose.joints[J.chest];
        if (curChest && dstChest) {
          this.overlayEuler.setFromQuaternion(curChest, 'YXZ');
          if (Math.abs(this.overlayEuler.y) > 1e-4) {
            this.overlayYawQ.setFromAxisAngle(Animator.Y_AXIS, this.overlayEuler.y * this.overlayW);
            dstChest.multiply(this.overlayYawQ).normalize();
          }
        }
      }
    }

    this.updateClipFingers(mode);
    if (this.overlayKind === 'arms' && this.overlayW > 0.25) this.clipFingerW = 0;
    return mode === 'loco' && this.mocapW > 0.4;
  }

  private readonly talkPose = emptyPose('mocap_talk');
  /** How much of his talk capture Giles plays on his arms (the rest stays his idle). */
  static readonly OWN_TALK_WEIGHT = 0.85;
  /**
   * How much of its own talk capture any other character plays, on the trunk only. Below 0.85 because the idle arms don't lean
   * with the captured trunk: at 0.85 Priya's lean carries her body into her resting left hand and the contact solver shoves the arm.
   */
  static readonly OWN_TRUNK_TALK_WEIGHT = 0.6;
  private static readonly TALK_JOINTS: readonly JointName[] = ['pelvis', 'spine', 'chest', 'shoulder_L', 'shoulder_R'];
  private static readonly TALK_ARMS: readonly JointName[] = [
    'upperArm_L', 'foreArm_L', 'hand_L', 'upperArm_R', 'foreArm_R', 'hand_R',
  ];

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

  /** How strongly speech drives the hands (wrist accents, hand shapes): it fades out as the body walks or jogs, like the arms. */
  get speechWeight(): number {
    return this.speechW * this.speechHandsK;
  }

  /** 1 standing, 0 at full walk or jog weight: the share of speech motion the arms and hands keep while moving. */
  private speechHandsK = 1;

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
    const talkArms = this.motion.style.talkArms;
    this.speechHandsK = (1 - moveFactor) * talkArms;
    // Speech adds nothing to the arms while walking or jogging, so the gait's own arm swing plays untouched. (A mug in the right
    // hand moves the gesture to the free left hand: Humanoid.speak, upright-mug-grip D3b.)
    const armsK = busy * (1 - moveFactor) * (1 - this.capturedSpeechArms) * talkArms;
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
   * Set the body's motion profile (character-motion spec). A profile with clips of its own gets its procedural arm layers turned
   * down to `Animator.OWN_MOTION_ARMS`.
   */
  setMotion(motion: ResolvedMotion, blend = 0): void {
    if (blend > 0 && this.motion) {
      // Cross-fade from the pose as it is now, so switching clips (a scene variant starting or ending) never pops.
      copyPose(this.finalPose, this.fadeFrom);
      this.fadeT = blend;
      this.fadeLen = blend;
    }
    this.motion = motion;
    this.motions = locomotionSet(motion);
    this.armLayer = motion.ownClips ? Animator.OWN_MOTION_ARMS : 1;
    // Crew on a shared default vary by body (character-motion spec): tempo within ±8%, posture within ±0.15. Derived from the
    // body's noise seed (not drawn from the rng), so adding it changes no other seeded value.
    const vary = motion.isDefault ? 1 : 0;
    this.tempo = motion.style.tempo * (1 + vary * 0.08 * Math.sin(this.noiseSeed * 12.9898 + 1.3));
    this.posture = motion.style.posture + vary * 0.15 * Math.sin(this.noiseSeed * 78.233 + 0.7);
  }

  private readonly fadeFrom = emptyPose('fade');
  private fadeT = 0;
  private fadeLen = 0;

  /** Finger motion of the clip playing now, as offsets from the clip's average (for the hand solver), and its weight (0 = none). */
  readonly clipFingers = new Float32Array(FINGER_CHANNELS);
  clipFingerW = 0;

  /** Sample the dominant playing clip's finger track (idle, talk or the walk/jog cycle). */
  private updateClipFingers(mode: string): void {
    let w = 0;
    if (this.mocapW > 0.05 && (mode === 'loco' || mode === 'pistol' || mode === 'kneel' || mode === 'crouch')) {
      const moving = this.locoInfo.moveWeight > 0.5;
      const id =
        mode === 'pistol' || this.to.name === 'aim_pistol' ? this.motion.clips.aimPistol : mode === 'kneel' ? this.motion.clips.kneel : mode === 'crouch' ? this.motion.clips.crouch
          : moving ? (this.locoInfo.jogWeight > 0.5 ? this.motions.jog : this.motions.walk)
            : this.speechW > 0.3 ? this.motions.talk : this.motions.idle;
      const clip = this.mocap.has(id) ? this.mocap.get(id) : null;
      if (clip && sampleFingers(clip, moving ? this.locoPhase : this.idlePhase, this.clipFingers, true)) w = this.mocapW;
    }
    this.clipFingerW = w;
  }

  /** 0..1 target and current weight of the injured-arm favouring (design D12; only Giles sets it). */
  injuryTarget = 0;
  injuryW = 0;
  /** Which arm the injury favours. */
  injurySide: Side = 'L';

  /**
   * Favour the injured arm: carried in against the body, elbow bent, shoulder raised a little, the head dipping toward it, and
   * less swing while walking. Procedural until the character's own injured clips are baked (task 6.1); weighted by `injuryW`.
   */
  private updateInjury(dt: number): void {
    this.injuryW += (this.injuryTarget - this.injuryW) * (1 - Math.exp(-6 * dt));
    const w = this.injuryW;
    if (w < 0.003 || this.twitchy) {
      this.guardFresh = false;
      return;
    }
    const s = this.injurySide;
    const sign = s === 'L' ? 1 : -1;
    // Hands on the job (a panel, the keyboard, a counter, a mug) stay there: the arm is not drawn in, only guarded (guardArm),
    // so at the panel he works mostly with the other hand instead of pulling this one off the work.
    if (!this.handsOnSomething()) {
      const up = this.finalPose.joints[J[`upperArm_${s}`]];
      const fo = this.finalPose.joints[J[`foreArm_${s}`]];
      if (up) up.slerp(Animator.IDENTITY, 0.55 * w);
      if (fo) fo.slerp(Animator.IDENTITY, 0.55 * w);
      // +X flexes forward here (a hanging limb rotated +X swings its end toward -Z).
      this.add(`upperArm_${s}`, 14 * w, 0, 10 * sign * w); // +Z on the left arm (-Z on the right) draws it in toward the body
      this.add(`foreArm_${s}`, 48 * w, 6 * sign * w, 0);
      this.add(`hand_${s}`, 8 * w, 0, 0);
    }
    this.add(`shoulder_${s}`, 0, 0, -6 * sign * w);
    this.add('head', -3 * w, 4 * sign * w, 0);
    this.add('chest', 0, 3 * sign * w, 2 * sign * w);
  }

  /** The injured hand's slow-following copy of its own world position (guarded motion). */
  private readonly guardHand = new THREE.Vector3();
  private readonly guardCur = new THREE.Vector3();
  private readonly guardElbow = new THREE.Vector3();
  private readonly guardRot = new THREE.Quaternion();
  private guardFresh = false;
  /** How far a fully favoured hand stays toward its slow copy (0..1), and how fast the copy follows (1/s). */
  static readonly GUARD_DAMP = 0.75;
  static readonly GUARD_RATE = 1.5;

  /**
   * A guarded arm moves less and more slowly (character-motion: working the panel, he works mostly with his right hand). After
   * the pose is written, the injured hand eases toward a slow-following copy of its own world path, more so the higher the
   * injury weight, and the arm is solved to reach it with the hand keeping its orientation. This quiets whatever moves the
   * hand: the arm's own motion, the trunk carrying the shoulder, a hold, or the hand being pushed off the body. The body calls it
   * after its hand-contact solve, so the slow copy follows positions already clear of the body. No allocation per frame.
   */
  guardArm(dt: number): void {
    const w = this.injuryW;
    if (w < 0.003 || this.twitchy || !this.bones[0]) {
      this.guardFresh = false;
      return;
    }
    const s = this.injurySide;
    const up = this.bones[J[`upperArm_${s}`]];
    const lo = this.bones[J[`foreArm_${s}`]];
    const hand = this.bones[J[`hand_${s}`]];
    if (!up || !lo || !hand || this.limp.has(J[`hand_${s}`]) || this.limp.has(J[`foreArm_${s}`])) return;
    this.bones[0].updateWorldMatrix(true, true);
    hand.getWorldPosition(this.guardCur);
    if (!this.guardFresh) this.guardHand.copy(this.guardCur);
    else this.guardHand.lerp(this.guardCur, 1 - Math.exp(-Animator.GUARD_RATE * dt));
    this.guardFresh = true;
    // Anatomical elbow pole: outward and behind the body (never in front, which would bend the elbow backwards).
    const xSign = s === 'L' ? -1 : 1;
    const root = this.bones[0].parent ?? this.bones[0];
    this.guardElbow.set(xSign * 0.65, 0.9, 0.78);
    root.localToWorld(this.guardElbow);
    hand.getWorldQuaternion(this.guardRot);
    // A favoured arm is guarded fully well before the favouring itself is: a half-drawn arm hovers at the body, where contact
    // pushes come and go, and needs steadying most.
    this.guardCur.lerp(this.guardHand, Animator.GUARD_DAMP * THREE.MathUtils.smoothstep(w, 0, 0.35));
    solveTwoBone(up, lo, hand, this.guardCur, this.guardElbow);
    const parentQ = lo.getWorldQuaternion(this.holdQ);
    hand.quaternion.copy(parentQ.invert().multiply(this.guardRot));
    hand.updateMatrixWorld(true);
  }

  /** Playback rate of idle clips and procedural idle life for this body (profile tempo, times crew variation). */
  tempo = 1;
  /** Upright (>0) or slumped (<0) chest for this body, -1..1 (profile posture plus crew variation). */
  posture = 0;

  /** Procedural arm-layer strength for characters whose profile names clips of its own. */
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

    // Scale locomotion lean gently on slow indoor walks so counter stops and tight serve turns stay upright.
    const locoScale = THREE.MathUtils.clamp(0.35 + (this.speed / 3.2) * 0.65, 0.35, 1);
    const speedLean = this.useMocap ? THREE.MathUtils.clamp(this.speed * 0.9 * locoScale, 0, 4.5) : 0;
    const accelLean = THREE.MathUtils.clamp(this.accelFwd * 0.85 * locoScale, -3.5, 3.5);
    const fwd = this.leanFwdSpring.step(speedLean + accelLean, dt);

    // Cornering centripetal bank: subtle on slow indoor turns, stronger at jog speeds.
    const bankTarget = THREE.MathUtils.clamp(-this.speed * this.turnRate * 1.15 * locoScale, -4.5, 4.5);
    const bank = this.bankSpring.step(bankTarget, dt);

    // Lateral nudge recoil is driven directly by `nudgeImpulse()` so turning centripetal accel never leans outward.
    const lat = this.leanLatSpring.step(0, dt);

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
    if (this.speed < 0.25) {
      this.footContacts[0] = THREE.MathUtils.clamp(1 - swingL * 1.25 * w, 0, 1);
      this.footContacts[1] = THREE.MathUtils.clamp(1 - swingR * 1.25 * w, 0, 1);
    }
  }

  private updateGait(dt: number, mocapActive: boolean): void {
    const style = this.gait;
    // A creature walks its own way (BladeMotion); only crawling and dragging are shared.
    if (this.creature && style !== 'crawl' && style !== 'drag') {
      this.footfall = false;
      return;
    }
    // Pivoting crawlers pull themselves around: the turn speed drives the limbs as if it were ground speed.
    const pivot = style === 'crawl' ? PIVOT_DRIVE_CRAWL : style === 'drag' ? PIVOT_DRIVE_DRAG : 0;
    const drive = style === 'none' ? 0 : Math.max(this.speed, pivot * Math.abs(this.turnRate));
    // No procedural stride under a one-shot clip: the clip has its own legs.
    const targetAmp = style === 'none' || this.oneShot ? 0 : Math.min(1.25, drive / REF_SPEED[style]);
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
    if (this.creature) {
      // A creature keeps the infected jaw and spasms; its posture, head and lunges are its own (BladeMotion, its poses).
      const inf = this.twitchy ? this.infect : 0;
      const chatter = inf * (0.5 + 0.5 * Math.sin(t * 0.9 + this.noiseSeed)) * 6 * Math.sin(t * 38 + this.noiseSeed);
      this.add('jaw', -chatter, 0, 0);
      if (inf > 0) {
        this.spasmTimer -= dt;
        if (this.spasmTimer <= 0) {
          this.spasmTimer = this.rng.range(0.6, 2.6) / (0.4 + inf);
          this.spasm(0.25 + 0.4 * inf);
        }
      }
      if (this.deathTwitch > 0) {
        this.deathTwitch -= dt;
        if (this.rng.chance(dt * 6 * Math.min(1, this.deathTwitch / 2))) this.spasm(0.5 * Math.min(1, this.deathTwitch / 3));
      }
      return;
    }
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
  private static readonly ARMS_BUSY: ReadonlySet<string> = new Set(['aim_pistol', 'typing', 'sit_typing', 'sit_typing_cctv', 'panel_work', 'biometric_scan', 'clipboard', 'crouchWork', 'kneel_revive', 'drink', 'offer_mug']);

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
    const t = this.time * (this.twitchy ? 1 : this.tempo);
    const s = this.noiseSeed;
    // Mocap idle already provides subtle breathing/sway; layer lighter individualized variation on top.
    const k = 1 - this.mocapW * 0.55;
    // Profile posture and head carriage (character-motion spec), on standing bodies.
    if (this.posture !== 0) {
      // +x extends (the inhale lifts the chest with +x): upright extends spine and chest, the head counters to stay level.
      // Shared evenly between spine and chest, so the trunk curves (imported-body-models: no segment carries most of the bend).
      this.add('spine', 3 * this.posture * w, 0, 0);
      this.add('chest', 3 * this.posture * w, 0, 0);
      this.add('head', -2 * this.posture * w, 0, 0);
    }
    // headPitch is + = down, and -x pitches the head down.
    if (this.motion.style.headPitch !== 0) this.add('head', -this.motion.style.headPitch * w, 0, 0);
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
    // Profile style (character-motion spec): fidget rate speeds and enlarges the arm fidgets, asymmetry favours one side.
    const st = this.motion.style;
    const fr = st.fidgetRate;
    const amp = a * (0.55 + 0.45 * fr);
    const aL = amp * (1 + 0.6 * st.asymmetry);
    const aR = amp * (1 - 0.6 * st.asymmetry);
    const ft = t * 0.5 * (0.6 + 0.4 * fr);
    this.add('foreArm_L', 1.0 * this.n(ft, 7) * aL, 0, 0);
    this.add('foreArm_R', 1.0 * this.n(ft, 8) * aR, 0, 0);
    this.add('hand_L', 1.5 * this.n(ft, 9) * aL, 0, 0);
    this.add('hand_R', 1.5 * this.n(ft, 10) * aR, 0, 0);
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

    // A slower pace stretches the springs' time: the same turn, unhurried (a laboured wait, voss-death-scene D6).
    const ldt = dt * this.lookPace;
    const headYaw = this.lookHeadYaw.step(yaw, ldt);
    const headPitch = this.lookHeadPitch.step(pitch, ldt);
    // Chest/spine recruit gently when looking at a real target (less when arms are aiming a weapon).
    const torsoShare = this.lookLocal && !Animator.ARMS_BUSY.has(this.to.name) ? 1 : 0.25;
    const torsoYaw = this.lookTorsoYaw.step(yaw * torsoShare, ldt);
    const torsoPitch = this.lookTorsoPitch.step(pitch * torsoShare * 0.6, ldt);

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
    const t = this.convulsePhase;
    for (let i = 1; i < N; i++) {
      const name = JOINTS[i]?.name ?? 'root';
      const amp = (UP_CHAIN.has(name) ? 16 : name.startsWith('hand') ? 32 : 24) * c;
      // Jerky: fast sines plus a gated spike.
      const jerk = Math.sin(t * 5.3 + i * 2.1) > 0.75 ? 1.8 : 1;
      this.add(name, amp * jerk * Math.sin(t * 31 + i * 1.7) * 0.5, amp * 0.6 * Math.sin(t * 23 + i * 2.9) * 0.5, amp * jerk * Math.sin(t * 17.3 + i * 3.1) * 0.5);
    }
  }

  // ---------------------------------------------------------------- spine distribution (imported-body-models)

  private readonly spineTotal = new THREE.Quaternion();
  private readonly spineHalf = new THREE.Quaternion();

  /**
   * Spread a bend over the trunk so the back and neck curve instead of kinking at one joint: spine+chest share their combined
   * rotation evenly and neck+head 45/55. The chest's and head's world orientations are unchanged (the product is kept), so arms,
   * look-at and held props are unaffected. Upright authored poses only (captured clips already curve naturally).
   */
  private distributeSpine(): void {
    if (!detailPass.enabled || this.mocapW > 0.5 || this.twitchy || this.seq) return;
    if (this.gait !== 'none' && this.gait !== 'walk') return;
    const pairs: [JointName, JointName, number][] = [['spine', 'chest', 0.5], ['neck', 'head', 0.45]];
    for (const [a, b, share] of pairs) {
      const qa = this.finalPose.joints[J[a]];
      const qb = this.finalPose.joints[J[b]];
      if (!qa || !qb) continue;
      this.spineTotal.copy(qa).multiply(qb);
      this.spineHalf.slerpQuaternions(Animator.IDENTITY, this.spineTotal, share);
      qa.copy(this.spineHalf);
      qb.copy(this.spineHalf.invert().multiply(this.spineTotal)).normalize();
    }
  }

  // ---------------------------------------------------------------- posture holds (character-motion: poses held in character)

  /** Strength of a profile's additive hold clip on top of an authored pose. */
  static readonly HOLD_WEIGHT = 0.85;
  /** 0..1 current weight of the hold layer. */
  holdW = 0;
  private holdClip: string | null = null;
  private holdPhase = 0;
  private readonly holdPose = emptyPose('hold');
  private readonly holdQ = new THREE.Quaternion();
  private static readonly IDENTITY = new THREE.Quaternion();

  /**
   * Layer the profile's hold clip for the current authored pose's posture family (an additive clip: offsets from its own mean
   * pose) over the pose, so a character holds `lean_counter` or `sit_stool` with their own breathing and weight shifts. Contact
   * solves (feet, hands on surfaces, held props) run after this and keep the pose's contact points where they are.
   * Poses that are an activity (`typing` is work, `drink` and `*_drink` are drinking) take the profile's clip for that activity
   * instead, when it is an additive clip: the character works or drinks in their own way with the hands kept on the job.
   */
  private updateHold(dt: number): void {
    const pose = this.to.name;
    const act = poseTreatment(pose);
    const actClip = act ? this.motion.clips[act] : undefined;
    const treat = actClip && this.mocap.has(actClip) && this.mocap.get(actClip).additive === true ? actClip : undefined;
    const fam = treat ? act : postureFamily(pose);
    const id = treat ?? (fam ? this.motion.holds[fam as PostureFamily] : undefined);
    const clip = id && this.mocap.has(id) ? this.mocap.get(id) : null;
    const active = clip?.additive === true && !this.seq && !this.oneShot && this.convulse <= 0.01 && !this.twitchy && this.mocapW < 0.5;
    if (active && id !== this.holdClip) {
      this.holdClip = id ?? null;
      this.holdPhase = this.idlePhase;
    }
    const target = active ? Animator.HOLD_WEIGHT : 0;
    this.holdW += (target - this.holdW) * (1 - Math.exp(-4 * dt));
    if (this.holdW < 0.005 || !this.holdClip) {
      this.holdW = active ? this.holdW : 0;
      return;
    }
    const hc = this.mocap.get(this.holdClip);
    this.holdPhase = (this.holdPhase + (dt * this.tempo) / Math.max(0.1, hc.duration)) % 1;
    sampleClip(hc, this.holdPhase, this.holdPose);
    this.holdFamily = fam;
    this.holdSeated = pose.startsWith('sit_');
  }

  /** Posture family (or treated activity) of the hold being played. */
  private holdFamily: string | null = null;
  private holdSeated = false;
  private readonly pinHand = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly pinElbow = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly pinRot = [new THREE.Quaternion(), new THREE.Quaternion()];

  /** Whether the current pose's hands rest on something (busy arms, or a posture whose hands rest on a surface or prop). */
  private handsOnSomething(): boolean {
    const pose = this.to.name;
    return Animator.ARMS_BUSY.has(pose) || poseTreatment(pose) !== null || Animator.pinsHands(postureFamily(pose));
  }

  /** Families whose hands rest on something (a counter, a seat, a held mug, the keyboard): the hold must not move them. */
  private static pinsHands(fam: string | null): boolean {
    return fam !== null && fam !== 'stand';
  }

  /**
   * Write the pose with the hold layered on. Where the posture's hands rest on something, the pose is written once without the
   * hold to record where the hands are, then the hold is applied and the arms are solved back onto those points (two-bone IK,
   * elbows on their own side, hands keeping their orientation), so breathing and weight shifts never slide a hand off the counter.
   */
  private writeWithHold(): void {
    const w = this.holdW;
    const pin = Animator.pinsHands(this.holdFamily);
    const root = this.bones[0];
    const B = (n: JointName): THREE.Bone | undefined => this.bones[J[n]];
    if (pin && root) {
      this.write();
      root.updateWorldMatrix(true, true);
      for (const [k, s] of (['L', 'R'] as const).entries()) {
        B(`hand_${s}`)?.getWorldPosition(this.pinHand[k]!);
        B(`foreArm_${s}`)?.getWorldPosition(this.pinElbow[k]!);
        B(`hand_${s}`)?.getWorldQuaternion(this.pinRot[k]!);
      }
    }
    for (let i = 0; i < N; i++) {
      const out = this.finalPose.joints[i];
      const add = this.holdPose.joints[i];
      if (!out || !add) continue;
      this.holdQ.slerpQuaternions(Animator.IDENTITY, add, w);
      out.multiply(this.holdQ);
    }
    // A captured hold bends the spine and chest by different amounts; share the trunk's bend again so it still curves.
    this.distributeSpine();
    // Seated bodies stay on the seat; the rest breathe with the clip's pelvis.
    if (!this.holdSeated) this.finalPose.pelvis.addScaledVector(this.holdPose.pelvis, w);
    this.write();
    if (!pin || !root) return;
    root.updateWorldMatrix(true, true);
    for (const [k, s] of (['L', 'R'] as const).entries()) {
      const up = B(`upperArm_${s}`);
      const lo = B(`foreArm_${s}`);
      const hand = B(`hand_${s}`);
      if (!up || !lo || !hand || this.limp.has(J[`hand_${s}`]) || this.limp.has(J[`foreArm_${s}`])) continue;
      solveTwoBone(up, lo, hand, this.pinHand[k]!, this.pinElbow[k]!);
      // Restore the hand's world orientation (palm on the counter, mug upright).
      const parentQ = lo.getWorldQuaternion(this.holdQ);
      hand.quaternion.copy(parentQ.invert().multiply(this.pinRot[k]!));
      hand.updateMatrixWorld(true);
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
      // Elbows are hinge joints: clamp negative X flexion so retargeted clips or blends never hyperextend them backwards.
      if ((i === J.foreArm_L || i === J.foreArm_R) && this.convulse <= 0.01) {
        this.e.setFromQuaternion(bone.quaternion, 'YXZ');
        if (this.e.x < 0) {
          this.e.x = 0;
          bone.quaternion.setFromEuler(this.e);
        }
      }
    }
    const pelvis = this.bones[J.pelvis];
    const rest = this.restPos[J.pelvis];
    if (pelvis && rest) {
      pelvis.position.copy(rest).add(cur.pelvis);
      if (this.gait !== 'crawl' && this.gait !== 'drag') pelvis.position.add(this.bob);
    }
  }
}
