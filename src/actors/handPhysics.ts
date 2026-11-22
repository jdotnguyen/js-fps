import * as THREE from 'three';
import type { Emote } from '../data/types/dialogue.ts';
import type { HandContact } from './limbContact.ts';
import type { JointName, Side, Vec3T } from './skeleton.ts';
import { Spring1D, Spring3D } from './springs.ts';
import { detailPass } from './detailPass.ts';
import { actingFor } from './speechActing.ts';
import { EASE_GUARD, HELD_THUMB_REACH, type HeldGrip } from './heldGrip.ts';

/** Scratch for the held grip (zero per-frame allocation). */
const HELD_TARGETS = [0, 0, 0];
const HELD_ANGLES = [0, 0, 0];

/**
 * Biomechanical wrist and individual-finger physics for humanoids.
 *
 * Layered on top of base pose/mocap + 2-bone IK:
 * - Inertial wrist springs (`Spring3D` per hand) react to forearm angular velocity, body
 *   acceleration, speech beats, and hit impulses with anatomically bounded lag and settle.
 * - Forearm pronation/supination twist sharing distributes wrist Y-roll along preserved
 *   forearm twist bones (`doctor`, `priya`, `hale`) to prevent wrist-crease pinching.
 * - Optional per-finger biomechanical solver (for GLBs that carry finger rigs):
 *   natural resting cascade, tenodesis coupling (wrist extension curls fingers; flexion opens),
 *   adjacent-finger sympathetic tendon coupling, staggered MCP -> PIP -> DIP second-order springs,
 *   pose/speech/IK hand shapes, per-character hand personalities, and distance LOD.
 */

export const FINGER_NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;
export type FingerName = (typeof FINGER_NAMES)[number];
export type PhalanxIndex = 1 | 2 | 3;

export type FingerBoneName = `finger_${Side}_${FingerName}_${PhalanxIndex}`;
export type TwistBoneName = `twist_foreArm_${Side}_${number}`;

export interface FingerBoneDef {
  kind: 'finger';
  name: FingerBoneName;
  parent: JointName | FingerBoneName;
  offset: Vec3T;
  side: Side;
  finger: FingerName;
  phalanx: PhalanxIndex;
  /** Unit axis in bone-rest space where +angle curls the phalanx inward into the palm. */
  curlAxis: Vec3T;
  /** Unit axis in bone-rest space where +angle splays the finger toward the index side. */
  splayAxis: Vec3T;
  /** Bind-pose bend already present on this phalanx (radians, >= 0) to avoid over-curling. */
  restCurl: number;
}

export interface TwistBoneDef {
  kind: 'twist';
  name: TwistBoneName;
  parent: JointName;
  offset: Vec3T;
  side: Side;
  /** Fractional distance from elbow (0) to wrist (1) along the forearm. */
  fraction: number;
}

export type HandDetailBone = FingerBoneDef | TwistBoneDef;

/** Per-character biomechanical hand personality. */
export interface HandPersonality {
  /** 0..1 baseline neuromuscular tension (higher = tighter grip, snappier curls, slight tremor). */
  tension: number;
  /** Natural frequency multiplier for wrist & finger springs (~0.75 loose .. 1.35 crisp). */
  stiffness: number;
  /** 0..1 subtle asynchronous micro-drift in fingers while standing idle or talking. */
  fidget: number;
  /** 0..1 resting curl tightness multiplier. */
  restCurl: number;
  /** 0..1 involuntary finger twitch, scaled by `HandPhysicsSolver.twitchStage` (Giles's infection). */
  twitch?: number;
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

/** Seeded hands for characters without their own (named characters' hands live in their motion profile). */
export function handPersonalityFor(seed: string): HandPersonality {
  const h1 = hashSeed(`${seed}:t`);
  const h2 = hashSeed(`${seed}:s`);
  const h3 = hashSeed(`${seed}:f`);
  return {
    tension: 0.28 + h1 * 0.35,
    stiffness: 0.9 + h2 * 0.25,
    fidget: 0.22 + h3 * 0.35,
    restCurl: 0.4 + h1 * 0.18,
  };
}

// ---------------------------------------------------------------- hand shapes

export type HandShapeId =
  | 'relaxed'
  | 'open'
  | 'point'
  | 'tense'
  | 'grip'
  | 'cup'
  | 'pinch'
  | 'typing'
  | 'flex'
  | 'fist'
  | 'claw'
  | 'surface'
  | 'slack';

/** Normalized targets for [thumb, index, middle, ring, pinky]. Curl 0 = straight, 1 = full fist; splay + = toward index. */
interface HandShape {
  readonly curl: readonly [number, number, number, number, number];
  readonly splay: readonly [number, number, number, number, number];
  /** Sympathetic coupling strength (0..1; lower when a single finger isolates, e.g. pointing). */
  readonly sympathy: number;
}

const SHAPES: Readonly<Record<HandShapeId, HandShape>> = {
  // Natural anatomical resting cascade: index loosest -> pinky curled most, thumb softly opposed.
  relaxed: { curl: [0.22, 0.24, 0.34, 0.44, 0.54], splay: [0.12, 0.05, 0, -0.05, -0.10], sympathy: 1.0 },
  // Open expressive palm (question, relieved, conversational emphasis).
  open: { curl: [0.06, 0.08, 0.11, 0.15, 0.19], splay: [0.34, 0.16, 0.02, -0.10, -0.22], sympathy: 0.85 },
  // Pointing / directive chop (urgent speech beat): index extended, lower fingers tucked.
  point: { curl: [0.46, 0.04, 0.72, 0.80, 0.86], splay: [0.05, 0.04, 0, -0.04, -0.08], sympathy: 0.25 },
  // High-adrenaline splayed tension (alarmed, dread, pained, scream).
  tense: { curl: [0.30, 0.36, 0.42, 0.48, 0.55], splay: [0.42, 0.24, 0.04, -0.16, -0.32], sympathy: 0.8 },
  // Pistol / tool grip: index lightly curved on trigger, middle/ring/pinky wrapped firmly, thumb high.
  grip: { curl: [0.52, 0.34, 0.84, 0.88, 0.90], splay: [0.18, 0.08, 0, -0.03, -0.06], sympathy: 0.35 },
  // Cylindrical mug / cup wrap.
  cup: { curl: [0.48, 0.64, 0.68, 0.72, 0.74], splay: [0.26, 0.06, 0, -0.04, -0.08], sympathy: 0.9 },
  // Precision clipboard / panel / medical work grip.
  pinch: { curl: [0.56, 0.52, 0.42, 0.48, 0.54], splay: [0.14, 0.02, 0, -0.06, -0.12], sympathy: 0.65 },
  // Hovering arched typing posture (per-finger keystroke taps layer on top).
  typing: { curl: [0.24, 0.34, 0.36, 0.40, 0.44], splay: [0.22, 0.10, 0, -0.08, -0.16], sympathy: 0.4 },
  // Hand-flexing base (modulated by slow clench-and-open wave in solver).
  flex: { curl: [0.35, 0.42, 0.48, 0.54, 0.60], splay: [0.25, 0.12, 0, -0.10, -0.20], sympathy: 0.9 },
  // Closed fist (slam, hulk).
  fist: { curl: [0.78, 0.94, 0.96, 0.98, 1.0], splay: [-0.08, -0.04, 0, 0.04, 0.08], sympathy: 1.0 },
  // Crooked grasping claw (infected / shamble / crawl / flail).
  claw: { curl: [0.44, 0.58, 0.64, 0.74, 0.82], splay: [0.36, 0.22, 0.04, -0.14, -0.28], sympathy: 0.6 },
  // Surface conformation (hand placed on console/panel via IK): arched palm, soft pads down.
  surface: { curl: [0.16, 0.20, 0.24, 0.28, 0.32], splay: [0.24, 0.11, 0.01, -0.09, -0.18], sympathy: 0.75 },
  // Slack limp/dead hand.
  slack: { curl: [0.18, 0.22, 0.28, 0.34, 0.40], splay: [0.06, 0.02, 0, -0.02, -0.04], sympathy: 1.0 },
};

/** The target finger curls of each hand shape (0 = straight, 1 = the joint's full curl), thumb first. */
export const HAND_SHAPE_CURLS: Readonly<Record<HandShapeId, readonly number[]>> = (() => {
  const out = {} as Record<HandShapeId, readonly number[]>;
  for (const id of Object.keys(SHAPES) as HandShapeId[]) out[id] = SHAPES[id].curl;
  return out;
})();

/** Distance (metres) beyond which individual finger springs pause to save CPU. */
export const FINGER_LOD_DISTANCE = 10;

/** Base staggered natural frequencies (Hz) from thumb/index (fastest) down to pinky (slowest). */
const FINGER_BASE_HZ: readonly [number, number, number, number, number] = [6.4, 6.0, 5.4, 4.9, 4.5];

/** Max anatomical curl (radians) per phalanx [phalanx1, phalanx2, phalanx3] for non-thumb fingers. */
export const FINGER_MAX_CURL: readonly [number, number, number] = [1.22, 1.52, 1.02];
/** Max anatomical curl (radians) per phalanx for the thumb. */
export const THUMB_MAX_CURL: readonly [number, number, number] = [0.60, 0.72, 0.82];
/**
 * A phalanx's bend (radians, about its curl axis) for a curl of 0..1, as the hand solver writes it (HandPhysicsSolver's finger loop):
 * a share of the joint's full curl, less part of the curl already baked into the model's rest pose.
 */
export function phalanxCurlAngle(def: FingerBoneDef, curl: number): number {
  const max = (def.finger === 'thumb' ? THUMB_MAX_CURL : FINGER_MAX_CURL)[def.phalanx - 1]!;
  return THREE.MathUtils.clamp(curl * max - def.restCurl * 0.65, -0.25, max);
}
/** Max splay (radians) on the proximal phalanx (MCP). */
export const MAX_SPLAY = 0.28;
export const THUMB_MAX_SPLAY = 0.42;

/** Anatomical wrist spring clamps (radians). */
const MAX_WRIST_PITCH = 0.42;
const MAX_WRIST_TWIST = 0.35;
const MAX_WRIST_DEV = 0.26;
/** Anatomical forearm pronation/supination twist clamp (radians, ~±88°). */
const MAX_FOREARM_TWIST = 1.54;

export interface HandPhysicsInput {
  group: THREE.Group;
  bones: Readonly<Record<JointName, THREE.Bone>>;
  dt: number;
  alive: boolean;
  /** True when the body is a static corpse (suppresses ambient wrist/finger motion). */
  corpse: boolean;
  poseName: string;
  speed: number;
  /** Character-local accelerations (m/s²): +fwd forward (-Z), +lat right (+X). */
  accelFwd: number;
  accelLat: number;
  /** 0..1 infection level (normalized). */
  infect: number;
  twitchy: boolean;
  /** Active speech acting state from Animator. */
  speechEmote: Emote | null;
  speechWeight: number;
  speechPulse: number;
  speechPrimarySide: Side;
  /** Per-side flags: true if that arm/hand is detached or limp. */
  limpL: boolean;
  limpR: boolean;
  /** Per-side world-space IK targets (non-null when handTargets IK is active). */
  ikTargetL: THREE.Vector3 | null;
  ikTargetR: THREE.Vector3 | null;
  /** Per-side smoothed contact surface info from LimbContactSolver (lap, tabletop, counter, wall). */
  contactL?: Readonly<HandContact> | null;
  contactR?: Readonly<HandContact> | null;
  /** Distance to active camera (metres), or null in headless tests (always full detail). */
  cameraDist: number | null;
  /** Finger motion of the playing clip: offsets from its average curl (12: left then right, thumb..pinky in radians, thumb spread). */
  clipFingers?: Float32Array | null;
  /** 0..1 how much the clip's fingers drive relaxed and open hands. */
  clipFingerWeight?: number;
  /** Radius of what the right hand holds (HELD_GRIP_RADIUS), or null when empty. */
  heldRadiusR?: number | null;
  /** The solved wrap of a mug in the right hand (heldGrip.ts, upright-mug-grip D5), or null: each phalanx bends to it and never past. */
  heldGripR?: Readonly<HeldGrip> | null;
}

/** Splay targets [thumb..pinky] of a hand shape (the held-grip solve uses the cup's). */
export function shapeSplay(id: HandShapeId): readonly number[] {
  return SHAPES[id].splay;
}

/** Summed phalanx flexion at full curl (radians), fingers and thumb (FINGER_MAX_CURL, THUMB_MAX_CURL phalanges 2..3). */
const FULL_CURL_RAD = 1.22 + 1.52 + 1.02;
const THUMB_FULL_RAD = 0.72 + 0.82;
/** Finger lengths (m, base to tip) for wrapping a held cylinder: thumb, index, middle, ring, pinky. */
const FINGER_LEN = [0.06, 0.08, 0.088, 0.082, 0.065] as const;
/** Half a finger's thickness: the finger's centre line wraps a cylinder this much wider. */
const FINGER_HALF = 0.009;

/** Curl (solver units) that wraps a finger around a cylinder of radius `r` without entering it. */
export function wrapCurl(fi: number, r: number): number {
  const arc = (FINGER_LEN[fi] ?? 0.08) / (r + FINGER_HALF);
  return THREE.MathUtils.clamp(arc / (fi === 0 ? THUMB_FULL_RAD * 1.6 : FULL_CURL_RAD), 0, 1.05);
}

interface FingerSpringState {
  readonly mcp: Spring1D;
  readonly pip: Spring1D;
  readonly dip: Spring1D;
  readonly splay: Spring1D;
  /** Bound scene bones for phalanges 1, 2, 3 (null if missing). */
  readonly bones: [THREE.Bone | null, THREE.Bone | null, THREE.Bone | null];
  readonly defs: [FingerBoneDef | null, FingerBoneDef | null, FingerBoneDef | null];
  readonly curlAxes: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  readonly splayAxes: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
}

interface SideState {
  readonly wristSpring: Spring3D;
  readonly prevForeArmQuat: THREE.Quaternion;
  readonly prevWristPos: THREE.Vector3;
  readonly prevWristVel: THREE.Vector3;
  primed: boolean;
  /** Latest signed wrist extension (+ = extended back, - = flexed inward toward palm) in radians. */
  wristExtension: number;
  /** Latest extracted forearm pronation/supination twist angle in radians. */
  foreArmTwist: number;
  /** Calibrated palm-inward normal in hand-rest space (+X on L, -X on R). */
  readonly palmNormal: THREE.Vector3;
  readonly fingers: FingerSpringState[];
  readonly twists: Array<{ bone: THREE.Bone; fraction: number }>;
  /** Scratch per-finger target arrays (zero per-frame alloc). */
  readonly targetCurl: Float32Array;
  readonly coupledCurl: Float32Array;
  readonly targetSplay: Float32Array;
  /** Smoothed IK palm-alignment weight (0..1). */
  ikAlignW: number;
}

// Module-level scratch objects (zero allocations per frame).
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const qCurFA = new THREE.Quaternion();
const qDelta = new THREE.Quaternion();
const qHandWorld = new THREE.Quaternion();
const qInv = new THREE.Quaternion();
const qSplay = new THREE.Quaternion();
const qCurl = new THREE.Quaternion();
const qIkWant = new THREE.Quaternion();
const qIkLocal = new THREE.Quaternion();
const eScratch = new THREE.Euler(0, 0, 0, 'XYZ');
const vCurPos = new THREE.Vector3();
const vVel = new THREE.Vector3();
const vAcc = new THREE.Vector3();
const vOmega = new THREE.Vector3();
const vDown = new THREE.Vector3();
const vPalmW = new THREE.Vector3();
const vWantPalmW = new THREE.Vector3();
const qAlign = new THREE.Quaternion();

/**
 * Pure helper: compute signed tenodesis curl delta from wrist extension angle (rad)
 * and wrist extension angular velocity (rad/s).
 * Positive extension (wrist bent back) curls fingers inward (+delta);
 * negative extension (wrist flexed toward palm) relaxes fingers open (-delta).
 */
export function tenodesisDelta(wristExtensionRad: number, wristExtVel = 0): number {
  const staticTerm = wristExtensionRad >= 0 ? wristExtensionRad * 0.32 : wristExtensionRad * 0.22;
  const dynamicTerm = THREE.MathUtils.clamp(wristExtVel * 0.025, -0.14, 0.14);
  return THREE.MathUtils.clamp(staticTerm + dynamicTerm, -0.24, 0.34);
}

/**
 * Pure helper: apply anatomical adjacent-finger sympathetic tendon coupling
 * to a 5-element finger array `[thumb, index, middle, ring, pinky]`.
 * Thumb stays mostly independent; ring finger has the strongest bilateral tendon linkage.
 */
export function applySympatheticCoupling(
  raw: ArrayLike<number>,
  sympathy: number,
  out: Float32Array,
): void {
  const s = THREE.MathUtils.clamp(sympathy, 0, 1);
  const t = raw[0] ?? 0;
  const i = raw[1] ?? 0;
  const m = raw[2] ?? 0;
  const r = raw[3] ?? 0;
  const p = raw[4] ?? 0;
  out[0] = t;
  out[1] = i + (m - i) * 0.09 * s;
  out[2] = m + ((i - m) * 0.10 + (r - m) * 0.14) * s;
  out[3] = r + ((m - r) * 0.18 + (p - r) * 0.16) * s;
  out[4] = p + (r - p) * 0.15 * s;
}

/**
 * Pure helper: exact swing-twist extraction of signed rotation around local Y axis (0, 1, 0).
 * Returns angle in [-pi, pi].
 */
export function extractTwistY(q: THREE.Quaternion): number {
  const len = Math.hypot(q.y, q.w);
  if (len < 1e-8) return 0;
  let ang = 2 * Math.atan2(q.y / len, q.w / len);
  if (ang > Math.PI) ang -= Math.PI * 2;
  if (ang < -Math.PI) ang += Math.PI * 2;
  return ang;
}

/** Choose the semantic hand shape for one hand from the current pose, speech emote, IK, and infection. */
export function chooseHandShape(
  side: Side,
  poseName: string,
  speechEmote: Emote | null,
  speechWeight: number,
  speechPrimarySide: Side,
  ikActive: boolean,
  infect: number,
  twitchy: boolean,
  alive: boolean,
  limp: boolean,
): HandShapeId {
  if (!alive || limp) return 'slack';
  if (twitchy || infect >= 0.45) {
    if (poseName === 'slamWindup' || poseName === 'slamImpact' || poseName === 'hulk') return 'fist';
    return 'claw';
  }
  if (poseName === 'typing' || poseName === 'sit_typing' || poseName.startsWith('sit_typing_')) return 'typing';
  if (ikActive) return 'surface';
  if (poseName === 'flex_hand') return side === 'R' ? 'flex' : 'relaxed';
  if (poseName === 'aim_pistol') return side === 'R' ? 'grip' : 'cup';
  if (/(^|_)(mug|drink)(_|$)/.test(poseName)) {
    return side === 'R' ? 'cup' : 'relaxed';
  }
  if (poseName === 'clipboard') return side === 'L' ? 'pinch' : 'relaxed';
  if (poseName === 'kneel_revive' || poseName === 'crouchWork' || poseName === 'rub_forearm') return 'pinch';
  if (poseName === 'slamWindup' || poseName === 'slamImpact' || poseName === 'hulk') return 'fist';

  if (speechWeight > 0.25 && speechEmote) {
    const primary = side === speechPrimarySide;
    switch (speechEmote) {
      case 'urgent':
        return primary ? 'point' : 'tense';
      case 'question':
      case 'relieved':
        return primary ? 'open' : 'relaxed';
      case 'alarmed':
      case 'dread':
      case 'pained':
      case 'scream':
        return 'tense';
      case 'whisper':
        return primary ? 'open' : 'relaxed';
      case 'laugh':
        return 'open';
      case 'neutral':
        return primary ? 'open' : 'relaxed';
    }
  }
  if (poseName === 'talk_gesture' || poseName.endsWith('_talk')) return 'open';
  return 'relaxed';
}

export class HandPhysicsSolver {
  personality: HandPersonality;
  /** Infection stage 0..4 driving `personality.twitch` (more often and sharper each stage). */
  twitchStage = 0;
  readonly hasFingerRig: boolean;
  readonly hasForeArmTwists: boolean;
  private readonly sides: Record<Side, SideState>;
  private readonly seedPhase: number;
  private time = 0;

  constructor(
    seed: string,
    detailBones: readonly HandDetailBone[],
    extraLookup: ReadonlyMap<string, THREE.Bone>,
    personality?: HandPersonality | null,
  ) {
    this.personality = personality ?? handPersonalityFor(seed);
    this.seedPhase = hashSeed(`${seed}:handPhase`) * Math.PI * 2;
    const stiff = this.personality.stiffness;

    const makeSide = (side: Side): SideState => {
      const fingers: FingerSpringState[] = FINGER_NAMES.map((fName, fi) => {
        const hz = FINGER_BASE_HZ[fi]! * stiff;
        const rest = SHAPES.relaxed.curl[fi]! * (0.65 + 0.7 * this.personality.restCurl);
        const splay0 = SHAPES.relaxed.splay[fi]!;
        const bones: [THREE.Bone | null, THREE.Bone | null, THREE.Bone | null] = [null, null, null];
        const defs: [FingerBoneDef | null, FingerBoneDef | null, FingerBoneDef | null] = [null, null, null];
        const curlAxes: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
          new THREE.Vector3(0, 0, side === 'L' ? 1 : -1),
          new THREE.Vector3(0, 0, side === 'L' ? 1 : -1),
          new THREE.Vector3(0, 0, side === 'L' ? 1 : -1),
        ];
        const splayAxes: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
          new THREE.Vector3(1, 0, 0),
          new THREE.Vector3(1, 0, 0),
          new THREE.Vector3(1, 0, 0),
        ];
        for (const d of detailBones) {
          if (d.kind !== 'finger' || d.side !== side || d.finger !== fName) continue;
          const idx = d.phalanx - 1;
          const b = extraLookup.get(d.name) ?? null;
          bones[idx] = b;
          defs[idx] = d;
          curlAxes[idx]!.set(d.curlAxis[0], d.curlAxis[1], d.curlAxis[2]).normalize();
          splayAxes[idx]!.set(d.splayAxis[0], d.splayAxis[1], d.splayAxis[2]).normalize();
        }
        return {
          mcp: new Spring1D({ f: hz, z: 0.78, r: 0.15 }, rest),
          pip: new Spring1D({ f: hz * 1.15, z: 0.85, r: 0 }, rest),
          dip: new Spring1D({ f: hz * 1.25, z: 0.88, r: 0 }, rest),
          splay: new Spring1D({ f: 4.5 * stiff, z: 0.85, r: 0 }, splay0),
          bones,
          defs,
          curlAxes,
          splayAxes,
        };
      });

      const twists: Array<{ bone: THREE.Bone; fraction: number }> = [];
      for (const d of detailBones) {
        if (d.kind !== 'twist' || d.side !== side) continue;
        const b = extraLookup.get(d.name);
        if (b) twists.push({ bone: b, fraction: d.fraction });
      }

      // Derive calibrated palm normal from middle finger's curlAxis if present (curlAxis x down = palmNormal).
      const palmNormal = new THREE.Vector3(side === 'L' ? 1 : -1, 0, 0);
      const midDef = fingers[2]?.defs[0];
      if (midDef) {
        const ax = fingers[2]!.curlAxes[0];
        palmNormal.crossVectors(ax, DOWN);
        if (palmNormal.lengthSq() > 1e-4) palmNormal.normalize();
        else palmNormal.set(side === 'L' ? 1 : -1, 0, 0);
      }

      return {
        wristSpring: new Spring3D({ f: 4.6 * stiff, z: 0.68, r: 0 }, 0, 0, 0),
        prevForeArmQuat: new THREE.Quaternion(),
        prevWristPos: new THREE.Vector3(),
        prevWristVel: new THREE.Vector3(),
        primed: false,
        wristExtension: 0,
        foreArmTwist: 0,
        palmNormal,
        fingers,
        twists,
        targetCurl: new Float32Array(5),
        coupledCurl: new Float32Array(5),
        targetSplay: new Float32Array(5),
        ikAlignW: 0,
      };
    };

    this.sides = { L: makeSide('L'), R: makeSide('R') };
    this.hasFingerRig = (['L', 'R'] as const).some((s) =>
      this.sides[s].fingers.some((f) => f.bones[0] !== null || f.bones[1] !== null),
    );
    this.hasForeArmTwists = this.sides.L.twists.length > 0 || this.sides.R.twists.length > 0;
  }

  /** Reset kinematic history cleanly on teleports or spawns. */
  reset(): void {
    for (const s of ['L', 'R'] as const) {
      const st = this.sides[s];
      st.primed = false;
      st.wristSpring.reset(0, 0, 0);
      st.prevWristVel.set(0, 0, 0);
      st.wristExtension = 0;
      st.foreArmTwist = 0;
      st.ikAlignW = 0;
    }
  }

  /** Deliver an instantaneous rotational impulse (rad/s) to a wrist spring (e.g. hit reaction or gesture snap). */
  impulseWrist(side: Side, dx: number, dy: number, dz: number): void {
    const ws = this.sides[side].wristSpring;
    ws.x.impulse(THREE.MathUtils.clamp(dx, -12, 12));
    ws.y.impulse(THREE.MathUtils.clamp(dy, -10, 10));
    ws.z.impulse(THREE.MathUtils.clamp(dz, -10, 10));
  }

  /** Diagnostic getter for tests: current MCP curl (0..1+) of one finger. */
  fingerCurl(side: Side, finger: FingerName): number {
    const idx = FINGER_NAMES.indexOf(finger);
    return this.sides[side].fingers[idx]?.mcp.value ?? 0;
  }

  /** Diagnostic getter for tests: current phalanx curls [mcp, pip, dip] of one finger. */
  fingerPhalanxCurls(side: Side, finger: FingerName): [number, number, number] {
    const idx = FINGER_NAMES.indexOf(finger);
    const f = this.sides[side].fingers[idx];
    if (!f) return [0, 0, 0];
    return [f.mcp.value, f.pip.value, f.dip.value];
  }

  /** Diagnostic getter for tests: magnitude of the inertial wrist spring offset (radians). */
  wristSpringMagnitude(side: Side): number {
    const ws = this.sides[side].wristSpring;
    return Math.hypot(ws.x.value, ws.y.value, ws.z.value);
  }

  /** Diagnostic getter for tests: latest extracted wrist extension angle (radians). */
  wristExtension(side: Side): number {
    return this.sides[side].wristExtension;
  }

  /** Diagnostic getter for tests: latest extracted forearm pronation/supination twist (radians). */
  foreArmTwist(side: Side): number {
    return this.sides[side].foreArmTwist;
  }

  /**
   * Fingers on a held mug: each phalanx spring eases toward its own contact target (not the MCP -> PIP -> DIP chain), fidget and
   * the infection twitch open the grip by at most ~0.06 rad, and the written angle is clamped at the contact angle, so a spring's
   * overshoot can never push a finger into the mug.
   */
  private stepHeldGrip(st: SideState, held: Readonly<HeldGrip>, h: number, sideSeed: number): void {
    const p = this.personality;
    const tw = (p.twitch ?? 0) * Math.min(1, this.twitchStage / 3);
    for (let fi = 0; fi < 5; fi++) {
      const fs = st.fingers[fi]!;
      const name = FINGER_NAMES[fi]!;
      const contact = held.contact[name];
      const maxArr = fi === 0 ? THUMB_MAX_CURL : FINGER_MAX_CURL;
      // Opening only: a slow fidget breath, and the infection twitch as a brief release.
      const fRate = 0.75 + fi * 0.23;
      let open = (0.5 + 0.5 * Math.sin(this.time * fRate + sideSeed + fi * 1.7)) * (0.006 + 0.02 * p.fidget);
      if (tw > 0) {
        const rate = (0.9 + fi * 0.37) * (1 + this.twitchStage * 0.6);
        open += Math.pow(Math.max(0, Math.sin(this.time * rate + sideSeed * 2.3 + fi * 2.9)), 10 + this.twitchStage * 6) * 0.05 * tw;
      }
      const springs = [fs.mcp, fs.pip, fs.dip] as const;
      const targets = HELD_TARGETS;
      const spMax = fi === 0 ? THUMB_MAX_SPLAY : MAX_SPLAY;
      let sp = fs.splay.step(held.splay[name] / spMax, h);
      // The thumb swings out before it curls in: while its opposition is still well short of the grip's, its bends hold open, so a
      // thumb that starts across the palm comes round the mug instead of through it.
      const swinging = fi === 0 && Math.abs(sp - held.splay[name] / spMax) > 0.3;
      for (let pi = 0; pi < 3; pi++) {
        const rest = (fs.defs[pi]?.restCurl ?? 0) * 0.65;
        const want = swinging ? Math.min(contact[pi]!, -0.1) : contact[pi]! - Math.min(0.06, open);
        targets[pi] = (want + rest) / maxArr[pi]!;
        springs[pi]!.step(targets[pi]!, h);
      }
      // Easing in from an open hand: a finger whose pose on the way would pass into the mug goes straight to its contact pose.
      for (let pi = 0; pi < 3; pi++) {
        const raw = springs[pi]!.value * maxArr[pi]! - (fs.defs[pi]?.restCurl ?? 0) * 0.65;
        HELD_ANGLES[pi] = Math.min(THREE.MathUtils.clamp(raw, -0.25, maxArr[pi]! * (fi === 0 ? HELD_THUMB_REACH : 1)), contact[pi]!);
      }
      if (held.clearanceAt(name, HELD_ANGLES, sp * spMax) < EASE_GUARD) {
        for (let pi = 0; pi < 3; pi++) springs[pi]!.reset(targets[pi]!);
        fs.splay.reset(held.splay[name] / spMax);
        sp = fs.splay.value;
      }
      for (let pi = 0; pi < 3; pi++) {
        const bone = fs.bones[pi];
        const def = fs.defs[pi];
        if (!bone || !def) continue;
        const raw = springs[pi]!.value * maxArr[pi]! - def.restCurl * 0.65;
        // A held thumb may reach past its usual limit (HELD_THUMB_REACH); the contact angle still caps it.
        const angle = Math.min(THREE.MathUtils.clamp(raw, -0.25, maxArr[pi]! * (fi === 0 ? HELD_THUMB_REACH : 1)), contact[pi]!);
        qCurl.setFromAxisAngle(fs.curlAxes[pi]!, angle);
        if (pi === 0 && Math.abs(sp) > 1e-4) {
          qSplay.setFromAxisAngle(fs.splayAxes[0], sp * spMax);
          bone.quaternion.copy(qSplay).multiply(qCurl);
        } else {
          bone.quaternion.copy(qCurl);
        }
      }
    }
  }

  /** Advance wrist springs, forearm twist sharing, IK palm alignment, and finger biomechanics. */
  update(input: HandPhysicsInput): boolean {
    const dt = input.dt;
    if (dt <= 0 || !detailPass.enabled) return false;
    const h = Math.min(dt, 0.05);
    this.time += h;

    // Static corpses keep their posed hands completely still.
    if (input.corpse && !input.alive) return false;

    const fingerDetailOn =
      this.hasFingerRig && (input.cameraDist === null || input.cameraDist <= FINGER_LOD_DISTANCE);

    input.group.updateMatrixWorld(true);
    let dirty = false;

    for (const side of ['L', 'R'] as const) {
      const st = this.sides[side];
      const foreArm = input.bones[`foreArm_${side}`];
      const hand = input.bones[`hand_${side}`];
      const limp = side === 'L' ? input.limpL : input.limpR;
      const ikTarget = side === 'L' ? input.ikTargetL : input.ikTargetR;
      const contact = side === 'L' ? input.contactL : input.contactR;
      const contactW = contact && input.alive && !limp ? contact.weight : 0;

      // 1. Sample forearm orientation & wrist world position to compute inertial lag targets.
      foreArm.getWorldQuaternion(qCurFA);
      hand.getWorldPosition(vCurPos);

      let targetPitch = 0;
      let targetTwist = 0;
      let targetDev = 0;

      if (!st.primed) {
        st.prevForeArmQuat.copy(qCurFA);
        st.prevWristPos.copy(vCurPos);
        st.prevWristVel.set(0, 0, 0);
        st.primed = true;
      } else {
        const dist = vCurPos.distanceTo(st.prevWristPos);
        if (dist > 0.9) {
          // Teleport: reset history without a whip spike.
          st.prevForeArmQuat.copy(qCurFA);
          st.prevWristPos.copy(vCurPos);
          st.prevWristVel.set(0, 0, 0);
        } else if (input.alive && !limp) {
          // Forearm angular velocity in forearm-local frame: qDelta = prev^-1 * cur.
          qDelta.copy(st.prevForeArmQuat).invert().multiply(qCurFA);
          if (qDelta.w < 0) {
            qDelta.x = -qDelta.x;
            qDelta.y = -qDelta.y;
            qDelta.z = -qDelta.z;
            qDelta.w = -qDelta.w;
          }
          const sinHalf = Math.hypot(qDelta.x, qDelta.y, qDelta.z);
          if (sinHalf > 1e-5) {
            const ang = (2 * Math.atan2(sinHalf, qDelta.w)) / h;
            const inv = 1 / sinHalf;
            vOmega.set(qDelta.x * inv * ang, qDelta.y * inv * ang, qDelta.z * inv * ang);
          } else {
            vOmega.set(0, 0, 0);
          }

          // Wrist world linear acceleration, projected into hand-local frame.
          vVel.subVectors(vCurPos, st.prevWristPos).divideScalar(h);
          vAcc.subVectors(vVel, st.prevWristVel).divideScalar(h);
          st.prevWristVel.lerp(vVel, 1 - Math.exp(-16 * h));
          vAcc.clampLength(0, 22);
          hand.getWorldQuaternion(qHandWorld);
          qInv.copy(qHandWorld).invert();
          vAcc.applyQuaternion(qInv);

          // Inertial lag: hand trails opposite to forearm angular velocity & linear acceleration.
          const lagGain = 0.052 * (1.15 - 0.3 * this.personality.tension);
          targetPitch = THREE.MathUtils.clamp(-vOmega.x * lagGain + vAcc.z * 0.008, -MAX_WRIST_PITCH, MAX_WRIST_PITCH);
          targetTwist = THREE.MathUtils.clamp(-vOmega.y * lagGain * 0.75, -MAX_WRIST_TWIST, MAX_WRIST_TWIST);
          targetDev = THREE.MathUtils.clamp(-vOmega.z * lagGain * 0.75 - vAcc.x * 0.006, -MAX_WRIST_DEV, MAX_WRIST_DEV);

          // Subtle expressive wrist supination/extension accents during speech beats.
          if (input.speechWeight > 0.05 && input.speechEmote) {
            const sign = side === 'R' ? 1 : -1;
            // A calm line gestures with one hand only (spec speech-acting): the other wrist keeps still.
            const share = side === input.speechPrimarySide ? 1 : actingFor(input.speechEmote).forearmOnly ? 0 : 0.28;
            const w = input.speechWeight * share;
            if (input.speechEmote === 'question' || input.speechEmote === 'relieved') {
              // Palm turns gently upward (supination) and extends slightly on open beats.
              targetTwist += sign * (0.18 + 0.14 * input.speechPulse) * w;
              targetDev += -sign * (0.08 + 0.06 * input.speechPulse) * w;
            } else if (input.speechEmote === 'urgent') {
              // Crisp directive wrist chop.
              targetPitch += (0.10 - 0.18 * input.speechPulse) * w;
            } else if (input.speechEmote === 'neutral') {
              targetTwist += sign * 0.10 * input.speechPulse * w;
            }
          }

          // Subtle body acceleration inertia when starting/stopping.
          targetPitch += THREE.MathUtils.clamp(-input.accelFwd * 0.012, -0.09, 0.09);
          targetDev += THREE.MathUtils.clamp(-input.accelLat * 0.010, -0.07, 0.07);
        }
        st.prevForeArmQuat.copy(qCurFA);
        st.prevWristPos.copy(vCurPos);
      }

      st.wristSpring.step(targetPitch, targetTwist, targetDev, h);

      // 2. Apply bounded inertial wrist offset (skipped when IK fully locks the palm, scaled gently otherwise).
      const ikTargetW = ikTarget && input.alive && !limp ? 1 : 0;
      st.ikAlignW += (ikTargetW - st.ikAlignW) * (1 - Math.exp(-12 * h));

      const wx = THREE.MathUtils.clamp(st.wristSpring.x.value, -MAX_WRIST_PITCH, MAX_WRIST_PITCH) * (1 - Math.max(st.ikAlignW, contactW) * 0.65);
      const wy = THREE.MathUtils.clamp(st.wristSpring.y.value, -MAX_WRIST_TWIST, MAX_WRIST_TWIST) * (1 - Math.max(st.ikAlignW, contactW) * 0.65);
      const wz = THREE.MathUtils.clamp(st.wristSpring.z.value, -MAX_WRIST_DEV, MAX_WRIST_DEV) * (1 - Math.max(st.ikAlignW, contactW) * 0.65);
      if (Math.abs(wx) > 1e-5 || Math.abs(wy) > 1e-5 || Math.abs(wz) > 1e-5) {
        eScratch.set(wx, wy, wz, 'XYZ');
        qDelta.setFromEuler(eScratch);
        hand.quaternion.multiply(qDelta);
        dirty = true;
      }

      // 3. Lightweight IK / contact palm alignment:
      //    - Explicit handTargets IK aligns palm naturally onto the console/panel.
      //    - LimbContactSolver surface contacts (tabletops, counters, laps, walls) align the
      //      calibrated palmNormal smoothly toward -contact.normal so the palm rests flush.
      if (st.ikAlignW > 0.01 && hand.parent) {
        const sign = side === 'R' ? 1 : -1;
        eScratch.set(0.35, -sign * 0.55, sign * 0.12, 'XYZ');
        qIkWant.copy(input.group.quaternion).multiply(qDelta.setFromEuler(eScratch));
        hand.parent.getWorldQuaternion(qInv).invert();
        qIkLocal.copy(qInv).multiply(qIkWant);
        hand.quaternion.slerp(qIkLocal, st.ikAlignW * 0.65);
        dirty = true;
      } else if (contact && contactW > 0.02 && hand.parent) {
        hand.getWorldQuaternion(qHandWorld);
        vPalmW.copy(st.palmNormal).applyQuaternion(qHandWorld).normalize();
        vWantPalmW.copy(contact.normal).negate().normalize();
        const dot = THREE.MathUtils.clamp(vPalmW.dot(vWantPalmW), -1, 1);
        // Only rotate up to ~55 deg so wrists stay inside natural anatomical ROM (never twisting backwards).
        if (dot > -0.75 && dot < 0.999) {
          qAlign.setFromUnitVectors(vPalmW, vWantPalmW);
          const ang = 2 * Math.acos(THREE.MathUtils.clamp(Math.abs(qAlign.w), 0, 1));
          const maxAng = 0.96;
          const share = (ang > maxAng ? maxAng / ang : 1) * contactW * 0.68;
          qIkWant.copy(qAlign).multiply(qHandWorld);
          hand.parent.getWorldQuaternion(qInv).invert();
          qIkLocal.copy(qInv).multiply(qIkWant);
          hand.quaternion.slerp(qIkLocal, share);
          dirty = true;
        }
      }

      // 4. Extract wrist extension (for tenodesis) and Y-twist (for forearm twist sharing).
      vDown.copy(DOWN).applyQuaternion(hand.quaternion);
      const prevExt = st.wristExtension;
      // Moving finger-down direction away from palmNormal = extension (+); toward palmNormal = flexion (-).
      st.wristExtension = THREE.MathUtils.clamp(-vDown.dot(st.palmNormal), -0.95, 0.95);
      const wristExtVel = (st.wristExtension - prevExt) / h;

      const twistY = THREE.MathUtils.clamp(extractTwistY(hand.quaternion), -MAX_FOREARM_TWIST, MAX_FOREARM_TWIST);
      st.foreArmTwist = twistY;
      if (st.twists.length > 0) {
        for (const tw of st.twists) {
          tw.bone.quaternion.setFromAxisAngle(UP, twistY * tw.fraction);
        }
        dirty = true;
      }

      // 5. Individual finger biomechanics (LOD-gated).
      if (!fingerDetailOn) continue;

      // A held mug (upright-mug-grip D5): each phalanx eases to its solved contact angle and never past it; fidget and twitch may
      // only open the grip a little.
      const held = side === 'R' && input.heldGripR && input.alive && !limp ? input.heldGripR : null;
      if (held) {
        this.stepHeldGrip(st, held, h, side === 'L' ? this.seedPhase : this.seedPhase + 3.7);
        dirty = true;
        continue;
      }

      const surfaceResting = st.ikAlignW > 0.25 || contactW > 0.35;
      const shapeId = chooseHandShape(
        side,
        input.poseName,
        input.speechEmote,
        input.speechWeight,
        input.speechPrimarySide,
        surfaceResting,
        input.infect,
        input.twitchy,
        input.alive,
        limp,
      );
      const shape = SHAPES[shapeId];
      const teno = input.alive && !limp ? tenodesisDelta(st.wristExtension, wristExtVel) : 0;
      const sideSeed = this.seedPhase + (side === 'L' ? 0 : 3.7);
      const p = this.personality;

      for (let fi = 0; fi < 5; fi++) {
        let c = shape.curl[fi]!;
        let sp = shape.splay[fi]!;

        // Personality shaping on relaxed/idle hands.
        if (shapeId === 'relaxed') {
          c *= 0.65 + 0.7 * p.restCurl;
          c += p.tension * 0.10;
        } else if (shapeId === 'tense') {
          c += p.tension * 0.12;
        }

        // The playing clip's captured finger motion moves relaxed and open hands (per-character-motion: finger tracks), on top of
        // the character's own resting shape, so captured gestures come through without flattening their hands into the performer's.
        const cw = input.clipFingerWeight ?? 0;
        if (cw > 0 && input.clipFingers && (shapeId === 'relaxed' || shapeId === 'open')) {
          const d = input.clipFingers[(side === 'L' ? 0 : 6) + fi] ?? 0;
          c += (d / (fi === 0 ? THUMB_FULL_RAD : FULL_CURL_RAD)) * cw;
        }
        // A held item: wrap it, no tighter than its surface.
        if (side === 'R' && input.heldRadiusR && (shapeId === 'cup' || shapeId === 'grip' || shapeId === 'relaxed')) c = wrapCurl(fi, input.heldRadiusR);

        // Tenodesis coupling (stronger on the 4 fingers, gentler on the thumb).
        c += fi === 0 ? teno * 0.45 : teno;

        // Pose-specific dynamic life: typing keystrokes, hand flex, speech beats, infected twitches, idle micro-fidgets.
        if (shapeId === 'typing') {
          const rate = 4.2 + fi * 0.85 + (side === 'L' ? 0 : 0.4);
          const tap = Math.pow(Math.max(0, Math.sin(this.time * rate + sideSeed + fi * 1.9)), 4);
          c += tap * 0.34;
        } else if (shapeId === 'flex') {
          const wave = 0.5 - 0.5 * Math.cos(this.time * 1.6 + sideSeed);
          c = THREE.MathUtils.lerp(0.06, 0.86, wave) + fi * 0.03;
          sp *= 1.4 - wave;
        } else if (shapeId === 'claw' && input.alive) {
          const twitch = Math.sin(this.time * (5.2 + fi * 1.3) + sideSeed + fi * 2.1);
          c += twitch * 0.16 * Math.max(0.35, input.infect);
          sp += Math.cos(this.time * (3.8 + fi * 0.9) + sideSeed) * 0.12 * Math.max(0.35, input.infect);
        } else if (input.alive && !limp) {
          // Subtle asynchronous micro-fidgets (slower when calm, brisker for high-fidget characters like Hale).
          const fRate = 0.75 + fi * 0.23;
          const drift =
            (Math.sin(this.time * fRate + sideSeed + fi * 1.7) * 0.65 +
              Math.sin(this.time * (fRate * 1.9) + sideSeed * 1.3 + fi) * 0.35) *
            (0.025 + 0.055 * p.fidget);
          c += drift;
          // Involuntary twitches (Giles: "fingers twitch while he works", rising with each infection stage).
          const tw = (p.twitch ?? 0) * Math.min(1, this.twitchStage / 3);
          if (tw > 0) {
            const rate = (0.9 + fi * 0.37) * (1 + this.twitchStage * 0.6);
            const jerk = Math.pow(Math.max(0, Math.sin(this.time * rate + sideSeed * 2.3 + fi * 2.9)), 10 + this.twitchStage * 6);
            c += jerk * 0.32 * tw;
          }
          // Speech beat opening/emphasis accent on the gesturing hand.
          if (input.speechWeight > 0.05 && side === input.speechPrimarySide) {
            const beatAccent =
              input.speechEmote === 'urgent'
                ? fi === 1
                  ? -0.08 * input.speechPulse
                  : 0.12 * input.speechPulse
                : -0.10 * input.speechPulse;
            c += beatAccent * input.speechWeight;
            sp += (fi === 0 ? 0.14 : (2 - fi) * 0.04) * input.speechPulse * input.speechWeight;
          }
        }

        st.targetCurl[fi] = THREE.MathUtils.clamp(c, -0.14, side === 'R' && input.heldRadiusR ? Math.min(1.1, wrapCurl(fi, input.heldRadiusR)) : 1.1);
        st.targetSplay[fi] = THREE.MathUtils.clamp(sp, -0.8, 0.8);
      }

      // Sympathetic tendon coupling across adjacent fingers.
      applySympatheticCoupling(st.targetCurl, shape.sympathy, st.coupledCurl);

      // Step staggered MCP -> PIP -> DIP springs and write bone quaternions.
      for (let fi = 0; fi < 5; fi++) {
        const fs = st.fingers[fi]!;
        const cMcp = fs.mcp.step(st.coupledCurl[fi]!, h);
        const cPip = fs.pip.step(cMcp, h);
        const cDip = fs.dip.step(cPip, h);
        const sp = fs.splay.step(st.targetSplay[fi]!, h);

        const maxArr = fi === 0 ? THUMB_MAX_CURL : FINGER_MAX_CURL;
        const curls = [cMcp, cPip, cDip] as const;

        for (let pi = 0; pi < 3; pi++) {
          const bone = fs.bones[pi];
          const def = fs.defs[pi];
          if (!bone || !def) continue;
          // Compensate gently for curl already baked into the GLB rest pose.
          const rawAngle = curls[pi]! * maxArr[pi]! - def.restCurl * 0.65;
          const angle = THREE.MathUtils.clamp(rawAngle, -0.25, maxArr[pi]!);
          qCurl.setFromAxisAngle(fs.curlAxes[pi]!, angle);
          if (pi === 0 && Math.abs(sp) > 1e-4) {
            const spAngle = sp * (fi === 0 ? THUMB_MAX_SPLAY : MAX_SPLAY);
            qSplay.setFromAxisAngle(fs.splayAxes[0], spAngle);
            bone.quaternion.copy(qSplay).multiply(qCurl);
          } else {
            bone.quaternion.copy(qCurl);
          }
        }
        dirty = true;
      }
    }

    if (dirty) input.group.updateMatrixWorld(true);
    return dirty;
  }
}
