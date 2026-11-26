import * as THREE from 'three';
import { Rng } from '../../core/rng.ts';
import type { JointName, Vec3T } from '../skeleton.ts';

/**
 * The blade creature's own motion (openspec rig-necromorph, design D6): what replaces the human layers on its body. The
 * animator calls it once a frame; it adds XYZ degrees to joints over the current pose (`add`), and reports foot contacts,
 * footfalls and the body's bob. Deterministic from the seed and the time.
 *
 * Idle: slow, deep breathing through the chest and back, a weight shift from leg to leg, the blades never quite still, and
 * the head jerking to a new angle, holding it, and jerking again.
 *
 * Gait: each foot follows a path in the body's frame. In stance it slides back at exactly the body's ground speed, so it
 * holds the floor; in swing it arcs forward. A two-bone solve in the leg's plane turns the path into hip, knee and ankle
 * angles over whatever the pose does. Stride length and the share of the cycle a foot is down change with speed: a prowl at
 * walking speeds (long contact, both feet down at times), a charge at running speeds (short contact, a flight phase).
 */

export type AddJoint = (joint: JointName, x: number, y: number, z: number) => void;

export interface BladeMotionInput {
  dt: number;
  time: number;
  /** Ground speed (m/s, world). */
  speed: number;
  /** The kill's step rate (1 = normal): below 1 the creature takes longer, slower strides at the same speed. */
  gaitRate: number;
  /** The current pose's X angle (degrees) of a joint, before this layer. */
  baseX: (joint: JointName) => number;
  /** The current pose's pelvis offset height (m, reference height). */
  pelvisY: number;
  /** How fast the body is turning (rad/s, either way). */
  turnRate: number;
  /** How far the body moved this frame, in its own frame (m, world: x right, z back), and how far it turned (rad, + left). */
  moved: { x: number; z: number; yaw: number };
  /** True while holding a world-contact pose (such as prying a door): keeps breathing alive, drops casual sway and blade drift. */
  locked?: boolean;
  /** 0..1 attack intensity (`animator.charge`), driving blade threat/windup without touching attack timings or reach. */
  charge?: number;
  /** Which blade arm is winding up for a swipe (`L` or `R`), or null when not winding up. */
  windupSide?: 'L' | 'R' | null;
  /** True while holding a grab on the player: spreads both blades wide out of the camera cone. */
  grabbing?: boolean;
  /** 0..1 tremor from an active performance (such as `scream`). */
  tremor?: number;
}

export interface BladeMotionOutput {
  /** Foot contact 0..1 (L, R) for the foot IK. */
  contacts: [number, number];
  /** True on the frame a foot lands. */
  footfall: boolean;
  /** Vertical bob of the pelvis (m, reference height). */
  bob: number;
  /** The pelvis shifted sideways over the planted leg, and forward with the surge (m, reference, body frame: x right, z back). */
  bobX: number;
  bobZ: number;
  /** Suggested jaw opening and belly-arm flare from combat windup/slash/grab (0..1). */
  jaw: number;
  flare: number;
}

/** The leg's geometry at the reference height, from the body's joint offsets. */
export interface LegGeometry {
  /** Hip height above the floor at rest (m). */
  hipY: number;
  thigh: number;
  shin: number;
  /** The ankle's height above the sole (m). */
  ankle: number;
}

export function legGeometry(offsets: Readonly<Record<JointName, Vec3T>>, ankle: number): LegGeometry {
  const len = (o: Vec3T): number => Math.hypot(o[0], o[1], o[2]);
  // root -> pelvis -> thigh
  const hipY = offsets.pelvis[1] + offsets.thigh_L[1];
  return { hipY, thigh: len(offsets.shin_L), shin: len(offsets.foot_L), ankle };
}

const DEG = 180 / Math.PI;
const smooth = (a: number, b: number, x: number): number => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Stride (one full cycle, two steps; m) at a ground speed (m/s), both at the reference height. */
export function strideFor(v: number): number {
  return THREE.MathUtils.clamp(1.0 + 0.5 * v - 0.022 * v * v, 1.1, 3.0);
}

/**
 * How much the body moves with its steps (design D6b), each as [prowl, charge]: bob half-height, surge and sideways shift
 * (m, reference height), swing-foot lift (m), hip roll and turn, trunk pitch on landing, blade swing and landing jolt
 * (degrees), and the toes' drop in the air (degrees).
 */
export const BODY = {
  bob: [0.032, 0.056] as const,
  surge: [0.025, 0.055] as const,
  shift: [0.035, 0.02] as const,
  lift: [0.17, 0.24] as const,
  roll: [7, 8] as const,
  yaw: [9, 13] as const,
  pitch: [4, 7] as const,
  armSwing: [12, 26] as const,
  armJolt: [6, 20] as const,
  toeDrop: 14,
};

/** The fastest a leg joint turns (degrees a second). */
const LEG_RATE = 900;

/** How long a corrective step takes (s). */
const CORRECTIVE_STEP = 0.22;

/** The longest stride (one full cycle, m at the reference height): a bounding leap. */
export const MAX_STRIDE = 3.6;

/** Share of the cycle each foot is down. */
export function dutyFor(v: number): number {
  return THREE.MathUtils.lerp(0.64, 0.34, smooth(1.4, 5, v));
}

export class BladeMotion {
  private readonly rng: Rng;
  private readonly phaseSeed: number[];
  private snapTimer = 0;
  private readonly snap = { x: 0, y: 0, z: 0 };
  private readonly snapCur = { x: 0, y: 0, z: 0 };
  /** Gait cycle 0..1 (left foot's), and how much of the gait is showing 0..1. */
  private cycle = 0;
  private gaitW = 0;
  private charge = 0;
  private readonly wasDown: [boolean, boolean] = [true, true];
  /** Stopping: cycle left until both feet have stepped and landed, its length when it began, and the cycle rate to finish at. */
  private settle = 0;
  private settleLen = 0;
  private settleRate = 1.2;
  /** Stepped in the last frame (walking, turning or settling). */
  private stepping = false;
  /** Settled and blending out: both feet down. */
  private settled = true;
  /** The stride's travel in the last walking frame (m, reference). */
  private lastExcursion = 0;
  /** Each planted foot where it landed, carried back each frame by the body's own movement (body frame, m, reference). */
  private readonly pins: [THREE.Vector2 | null, THREE.Vector2 | null] = [null, null];
  /** The leg offsets last frame (thigh, shin, foot, thigh out; degrees), per leg. */
  private readonly legAngles: [[number, number, number, number], [number, number, number, number]] = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  /** Where each foot was last frame (body frame, m, reference), and where its swing began. */
  private readonly lastZ: [number, number] = [0, 0];
  private readonly lastLateral: [number, number] = [0, 0];
  private readonly liftFrom: [THREE.Vector2 | null, THREE.Vector2 | null] = [null, null];
  /** A corrective step in progress per foot: how far through (0..1) and where the foot left from (body frame). */
  private readonly steps: [{ t: number; from: THREE.Vector2 } | null, { t: number; from: THREE.Vector2 } | null] = [null, null];
  /** Eased combat attack weights: approach charge, directional swipe windup, active grab, and active slash arc. */
  private attackCharge = 0;
  private windupW = 0;
  private windupArm: 'L' | 'R' = 'R';
  private grabW = 0;
  private slash: { side: 'L' | 'R'; t: number } | null = null;
  readonly out: BladeMotionOutput = { contacts: [1, 1], footfall: false, bob: 0, bobX: 0, bobZ: 0, jaw: 0, flare: 0 };

  private readonly leg: LegGeometry | null;
  /** Body height over the reference height: world speeds are divided by it. */
  private readonly scale: number;

  constructor(seed: string, leg: LegGeometry | null = null, scale = 1) {
    this.leg = leg;
    this.scale = scale;
    this.rng = new Rng(`blade-motion:${seed}`);
    this.phaseSeed = Array.from({ length: 8 }, () => this.rng.range(0, Math.PI * 2));
  }

  /** Trigger a blade slash follow-through on `side` when an enemy swipe lands (design D6). */
  triggerSlash(side: 'L' | 'R'): void {
    this.slash = { side, t: 0 };
  }

  /** Add this frame's motion over the pose. */
  update(add: AddJoint, input: BladeMotionInput): BladeMotionOutput {
    this.out.footfall = false;
    this.out.contacts[0] = 1;
    this.out.contacts[1] = 1;
    this.out.bob = 0;
    this.out.bobX = 0;
    this.out.bobZ = 0;
    this.out.jaw = 0;
    this.out.flare = 0;
    this.gait(add, input);
    this.idle(add, input);
    this.attack(add, input);
    return this.out;
  }

  private attack(add: AddJoint, input: BladeMotionInput): void {
    const dt = input.dt;
    const locked = input.locked === true;
    const targetCharge = locked ? 0 : THREE.MathUtils.clamp(input.charge ?? 0, 0, 1);
    this.attackCharge += (targetCharge - this.attackCharge) * Math.min(1, dt * 7);
    if (input.windupSide) this.windupArm = input.windupSide;
    const targetWindup = !locked && input.windupSide && !input.grabbing ? 1 : 0;
    this.windupW += (targetWindup - this.windupW) * Math.min(1, dt * 8);
    const targetGrab = !locked && input.grabbing ? 1 : 0;
    this.grabW += (targetGrab - this.grabW) * Math.min(1, dt * 10);

    // Grab: throw both blade arms wide out to the flanks so neither blade covers the player's camera view.
    if (this.grabW > 0.005) {
      const g = this.grabW;
      add('spine', -4 * g, 0, 0);
      add('upperArm_L', -48 * g, 0, -68 * g);
      add('foreArm_L', -48 * g, 0, 0);
      add('upperArm_R', -48 * g, 0, 68 * g);
      add('foreArm_R', -48 * g, 0, 0);
      this.out.jaw = Math.max(this.out.jaw, 0.85 * g);
      this.out.flare = Math.max(this.out.flare, 0.9 * g);
    }

    // Windup: draw the striking blade unmistakably back & wide before the blow lands (stays inside D5 shoulder envelope).
    if (this.windupW > 0.005) {
      const w = this.windupW * (1 - this.grabW);
      const s = this.windupArm;
      const k = s === 'R' ? 1 : -1;
      const off = s === 'R' ? 'L' : 'R';
      add('spine', 6 * w, -16 * k * w, 0);
      add('chest', 6 * w, -12 * k * w, 0);
      add('neck', 4 * w, 12 * k * w, 0);
      add('head', 6 * w, 14 * k * w, 0);
      add(`shoulder_${s}`, 0, 0, 6 * k * w);
      add(`upperArm_${s}`, -54 * w, 0, 84 * k * w);
      add(`foreArm_${s}`, -24 * w, 0, 0);
      add(`hand_${s}`, 18 * w, 0, 0);
      add(`upperArm_${off}`, -16 * w, 0, -18 * k * w);
      this.out.jaw = Math.max(this.out.jaw, 0.8 * w);
      this.out.flare = Math.max(this.out.flare, 0.85 * w);
    } else if (this.attackCharge > 0.01 && this.grabW < 0.5) {
      // Closing in with charge > 0: mild blade spread and jaw threat.
      const c = this.attackCharge * (1 - this.grabW);
      add('spine', -4 * c, 0, 0);
      add('upperArm_L', -10 * c, 0, -16 * c);
      add('upperArm_R', -10 * c, 0, 16 * c);
      this.out.jaw = Math.max(this.out.jaw, 0.45 * c);
      this.out.flare = Math.max(this.out.flare, 0.4 * c);
    }

    // Slash follow-through when a swipe fires.
    if (this.slash) {
      this.slash.t += dt;
      const dur = 0.36;
      if (this.slash.t >= dur) {
        this.slash = null;
      } else {
        const u = this.slash.t / dur;
        // Sharp whip forward peaking at u = 0.28, then easing back.
        const a = u < 0.28 ? Math.sin((u / 0.28) * Math.PI * 0.5) : Math.cos(((u - 0.28) / 0.72) * Math.PI * 0.5);
        const s = this.slash.side;
        const k = s === 'R' ? 1 : -1;
        add('spine', -8 * a, 18 * k * a, 0);
        add('chest', -6 * a, 14 * k * a, 0);
        add('neck', 4 * a, -12 * k * a, 0);
        add('head', 4 * a, -14 * k * a, 0);
        add(`upperArm_${s}`, 6 * a, -18 * k * a, -14 * k * a);
        add(`foreArm_${s}`, -74 * a, 0, 0);
        add(`hand_${s}`, -8 * a, 0, 0);
        this.out.jaw = Math.max(this.out.jaw, 0.9 * a);
        this.out.flare = Math.max(this.out.flare, 0.9 * a);
      }
    }

    // Performance tremor (e.g. held scream shake, design D8).
    const tr = THREE.MathUtils.clamp(input.tremor ?? 0, 0, 1);
    if (tr > 0.005) {
      const t = input.time;
      const sh1 = Math.sin(t * 29.0 + this.phaseSeed[0]!);
      const sh2 = Math.sin(t * 37.3 + this.phaseSeed[1]!);
      const sh3 = Math.cos(t * 23.7 + this.phaseSeed[2]!);
      add('spine', 1.8 * sh1 * tr, 1.4 * sh2 * tr, 1.2 * sh3 * tr);
      add('chest', 2.2 * sh2 * tr, 1.8 * sh3 * tr, 1.6 * sh1 * tr);
      add('neck', 2.4 * sh3 * tr, 2.2 * sh1 * tr, 2.0 * sh2 * tr);
      add('head', 3.0 * sh1 * tr, 2.8 * sh2 * tr, 2.5 * sh3 * tr);
      add('upperArm_L', 2.4 * sh2 * tr, 0, -2.6 * sh1 * tr);
      add('upperArm_R', 2.4 * sh3 * tr, 0, 2.6 * sh2 * tr);
      add('foreArm_L', 3.2 * sh1 * tr, 0, 0);
      add('foreArm_R', 3.2 * sh2 * tr, 0, 0);
    }
  }

  private gait(add: AddJoint, input: BladeMotionInput): void {
    const leg = this.leg;
    if (!leg) return;
    const v = input.speed / this.scale;
    const moving = v > 0.05;
    // Turning on the spot steps the feet round (design D6a): the planted foot is pinned by the foot IK, the other lifts.
    const turning = smooth(0.5, 1.0, Math.abs(input.turnRate)) * (1 - smooth(0.25, 0.7, v));
    const walking = moving || turning > 0.05;
    const rate = THREE.MathUtils.clamp(input.gaitRate, 0.3, 2);
    // A slowed step rate lengthens the stride: the feet keep up with the ground (design D6a).
    // ...up to a bounding leap: past MAX_STRIDE a foot would hang in the air across a whole room.
    const stride = Math.min(strideFor(v) / rate, Math.max(strideFor(v), MAX_STRIDE));
    let duty = dutyFor(v);
    if (walking) {
      this.settle = 0;
      this.settled = false;
    } else if (this.stepping && !this.settled && this.settle <= 0 && this.gaitW > 0.05) {
      // Stopping: finish the stride and take one more step, so both feet step and land (no foot left mid-stride).
      this.settle = Math.max(1 - this.cycle, 1 - ((this.cycle + 0.5) % 1)) || 1;
      this.settleLen = this.settle;
    }
    const settling = this.settle > 0;
    this.stepping = walking || settling;
    this.gaitW += ((this.stepping || !this.settled ? 1 : 0) - this.gaitW) * Math.min(1, input.dt * (this.stepping ? 6 : 4));
    this.charge += (smooth(1.9, 2.8, v) - this.charge) * Math.min(1, input.dt * 4);
    if (this.gaitW < 0.002) return;
    let travel = 1;
    if (moving) {
      const step = (v * input.dt) / stride;
      this.cycle = (this.cycle + step) % 1;
      this.settleRate = Math.max(1.4, v / stride);
    } else if (turning > 0.05) {
      this.cycle = (this.cycle + 2.6 * turning * input.dt) % 1;
      duty = 0.45;
      travel = 0;
    } else if (settling) {
      const step = Math.min(this.settle, this.settleRate * input.dt);
      this.cycle = (this.cycle + step) % 1;
      this.settle -= step;
      travel = this.settle / Math.max(1e-6, this.settleLen);
      if (this.settle <= 1e-6) {
        this.settle = 0;
        this.settled = true;
      }
    } else {
      this.settled = true;
    }
    const w = this.gaitW;
    const c = this.charge;
    const reach = (leg.thigh + leg.shin) * 0.985;
    const pelvisDrop = -0.045 * c;
    // The body moves with its steps (design D6b). `act`: how much of it shows (walking fully, turning and settling less).
    const act = w * (moving ? 1 : turning > 0.05 ? 0.45 : settling ? travel : 0);
    const sPh = (this.cycle * 2) % 1; // 0 at each landing
    const bobAmp = THREE.MathUtils.lerp(BODY.bob[0], BODY.bob[1], c);
    // Low just after the landing (the weight taken on a bent knee), high at push-off, or through the flight in the charge.
    const bobY = bobAmp * Math.cos(2 * Math.PI * (sPh - THREE.MathUtils.lerp(0.62, 0.82, c))) * act;
    // Pushed forward after each push-off, held back on the landing (forward is -Z).
    const surge = THREE.MathUtils.lerp(BODY.surge[0], BODY.surge[1], c) * Math.sin(2 * Math.PI * (sPh - 0.35)) * act;
    const hip = leg.hipY + input.pelvisY + pelvisDrop + bobY;
    // In the charge the creature drives its legs further behind the hips than ahead of them (a predator sprint, and it keeps
    // both forward thigh flexion and push-off ankle dorsiflexion inside the skin's 2.5x limit). Forward is -Z, so +backBias shifts behind.
    const backBias = 0.1 * c * act;
    // The foot travels duty * stride while down. Where the leg cannot reach that far, the foot is down for less of the cycle,
    // so it still moves at exactly the ground's speed (a planted foot never slides). Reckoned at the top of the bob.
    const halfReach = Math.sqrt(Math.max(0, reach * reach - (hip - bobY + bobAmp - leg.ankle - 0.02) ** 2)) * 0.96;
    const maxTravel = Math.max(0.2, 2 * (halfReach - backBias));
    // Over the planted leg: left while the left foot is down (its mid-stance at duty / 2), right half a cycle later.
    const plantedSide = Math.cos(2 * Math.PI * (this.cycle - dutyFor(v) / 2));
    const shiftX = -THREE.MathUtils.lerp(BODY.shift[0], BODY.shift[1], c) * plantedSide * act;
    duty = Math.min(duty, maxTravel / stride);
    let excursion = duty * stride;
    if (moving) this.lastExcursion = excursion;
    else excursion = this.lastExcursion * travel;
    const still = this.settled && !walking;
    (['L', 'R'] as const).forEach((s, i) => {
      const p = (this.cycle + (i === 0 ? 0 : 0.5)) % 1;
      // Stance first: the foot lands ahead (forward is -Z) and slides back under the body.
      let z = 0;
      let lift = 0;
      let swingLateral = 0;
      let swingU = -1;
      const down = still || p < duty;
      if (still) {
        z = 0;
      } else if (down) {
        const u = p / duty;
        z = backBias - excursion / 2 + excursion * u;
      } else {
        const u = (p - duty) / (1 - duty);
        const e = u * u * (3 - 2 * u);
        // From wherever the foot really left the ground (a tracked foot may not be where the cycle planned), to the landing.
        if (this.wasDown[i] || !this.liftFrom[i]) this.liftFrom[i] = new THREE.Vector2(this.lastLateral[i], this.lastZ[i]);
        const from = this.liftFrom[i]!;
        z = THREE.MathUtils.lerp(from.y, backBias - excursion / 2, e);
        swingLateral = from.x * (1 - e);
        // A high, deliberate step in the prowl; a tucked heel recovery in the charge that drops toward the floor as it reaches ahead.
        lift = THREE.MathUtils.lerp(BODY.lift[0], BODY.lift[1], c) * Math.sin(Math.PI * Math.pow(u, THREE.MathUtils.lerp(0.8, 0.62, c))) * (moving ? 1 : 0.6);
        swingU = u;
      }
      let downNow = down;
      let lateral = swingLateral;
      const step = this.steps[i];
      if (step) {
        // A corrective step: lift the foot that fell out of reach and put it back under the hip.
        step.t += input.dt / CORRECTIVE_STEP;
        const u = Math.min(1, step.t);
        const e = u * u * (3 - 2 * u);
        z = step.from.y * (1 - e);
        lateral = step.from.x * (1 - e);
        lift = 0.09 * Math.sin(Math.PI * u);
        downNow = false;
        if (u >= 1) {
          this.steps[i] = null;
          this.pins[i] = new THREE.Vector2(0, 0);
          lift = 0;
          downNow = down;
          // Landed: track it from here (not from where the cycle would have put it).
          if (down) this.wasDown[i] = false;
        }
      } else if (down && !still) {
        // A planted foot stays where it landed, whatever the body does (braking, cornering): track it from the body's movement.
        const fresh = !this.pins[i];
        const pin = this.pins[i] ?? (this.pins[i] = new THREE.Vector2(0, z));
        if (this.wasDown[i] && !fresh) {
          const m = input.moved;
          const mx = m.x / this.scale;
          const mz = m.z / this.scale;
          const cy = Math.cos(m.yaw);
          const sy = Math.sin(m.yaw);
          const px = pin.x - mx;
          const pz = pin.y - mz;
          // The body turned left by yaw: the foot turns right by it in the body's frame.
          pin.set(px * cy - pz * sy, px * sy + pz * cy);
        } else if (fresh) pin.set(0, z);
        const minZ = -(halfReach - backBias);
        const maxZ = halfReach;
        if (pin.y < minZ || pin.y > maxZ || Math.abs(pin.x) > 0.25) {
          // Out of reach (the body braked, turned back or was pushed): step it back in rather than drag it.
          this.steps[i] = { t: 0, from: new THREE.Vector2(THREE.MathUtils.clamp(pin.x, -0.25, 0.25), THREE.MathUtils.clamp(pin.y, minZ, maxZ)) };
          this.pins[i] = null;
          z = this.steps[i]!.from.y;
          lateral = this.steps[i]!.from.x;
          downNow = false;
        } else {
          z = pin.y;
          lateral = pin.x;
        }
      } else this.pins[i] = null;
      this.lastZ[i] = z;
      this.lastLateral[i] = lateral;
      this.out.contacts[i] = downNow ? 1 : 0;
      if (downNow && !this.wasDown[i] && this.stepping) this.out.footfall = true;
      this.wasDown[i] = downNow;
      // Two-bone solve in the leg's plane: hip to ankle. The hip has bobbed and surged; the foot is where it is.
      const dy = -(hip - leg.ankle - lift);
      const fwd = -(z + surge);
      const d = THREE.MathUtils.clamp(Math.hypot(dy, fwd), 0.2, reach);
      const knee = Math.acos(THREE.MathUtils.clamp((leg.thigh ** 2 + leg.shin ** 2 - d * d) / (2 * leg.thigh * leg.shin), -1, 1));
      const hipIn = Math.acos(THREE.MathUtils.clamp((leg.thigh ** 2 + d * d - leg.shin ** 2) / (2 * leg.thigh * d), -1, 1));
      const toAnkle = Math.atan2(fwd, -dy);
      const thighWorld = (toAnkle + hipIn) * DEG; // the knee bends forward
      const shinRel = -(Math.PI - knee) * DEG;
      const pelvisX = input.baseX('pelvis');
      const thigh = thighWorld - pelvisX;
      // The sole stays level on the ground; in the air the ankle relaxes along the shin and the toes drop instead of cranking upward.
      const swingArc = swingU >= 0 ? Math.sin(Math.PI * swingU) : 0;
      const foot = THREE.MathUtils.clamp(-(thighWorld + shinRel) * (1 - 0.2 * swingArc) - BODY.toeDrop * swingArc, -26, 48);
      // A foot carried sideways by a turn, or the hips shifted over the other leg: the leg swings out or in to it.
      const out = Math.atan2(lateral - shiftX, hip - leg.ankle) * DEG;
      // No leg joint turns faster than a running leg can (a lift-off or a settle never snaps).
      const lim = LEG_RATE * input.dt;
      const a = this.legAngles[i]!;
      const ease = (k: 0 | 1 | 2 | 3, want: number): number => (a[k] += THREE.MathUtils.clamp(want - a[k], -lim, lim));
      add(`thigh_${s}`, ease(0, (thigh - input.baseX(`thigh_${s}`)) * w), 0, ease(3, out * w));
      add(`shin_${s}`, ease(1, (shinRel - input.baseX(`shin_${s}`)) * w), 0, 0);
      add(`foot_${s}`, ease(2, (foot - input.baseX(`foot_${s}`)) * w), 0, 0);
    });
    // The body over the legs (design D6b): bob, surge and weight shift move the pelvis; low and long in the charge.
    this.out.bob = bobY + pelvisDrop * w;
    this.out.bobX = shiftX;
    this.out.bobZ = -surge;
    // A jolt through the body just after each landing.
    const impact = Math.exp(-(((sPh - 0.1) / 0.09) ** 2)) * act;
    const lerpC = (r: readonly [number, number]): number => THREE.MathUtils.lerp(r[0], r[1], c);
    // The hips drop on the swinging side and turn its hip forward; the back and shoulders turn against them.
    const roll = -lerpC(BODY.roll) * plantedSide * act;
    const yaw = lerpC(BODY.yaw) * plantedSide * act;
    add('pelvis', 0, yaw, roll);
    // The lean and the landing pitch go in the spine: past about 19 degrees forward (plus twist) the chest stretches at its top.
    add('spine', -19 * c * w - lerpC(BODY.pitch) * impact, -0.55 * yaw, -0.5 * roll);
    add('chest', 2 * c * w, -0.45 * yaw, -0.3 * roll);
    // Head: up and ahead in the charge, steadied against the landing jolt.
    add('neck', 6 * c * w + 0.4 * lerpC(BODY.pitch) * impact, 0.25 * yaw, 0);
    add('head', 8 * c * w + 0.6 * lerpC(BODY.pitch) * impact, 0.3 * yaw, 0.3 * roll);
    // Blades: swung against the legs, a beat behind them; jolted on each landing. In the charge they are held out ahead,
    // spear-like, and pump hard: each reaches forward (the elbow opening) and cocks back (the elbow closing) in turn,
    // while keeping the upper arm inside design D5's 100-degree shoulder envelope.
    const swing = lerpC(BODY.armSwing) * act;
    for (const [s, k] of [['L', 1], ['R', -1]] as const) {
      const a = k * Math.cos(2 * Math.PI * (this.cycle - dutyFor(v) / 2) - 0.6);
      // In the charge the blade flares out on its backswing and the shoulder heaves with it.
      add(`upperArm_${s}`, -14 * c * w + swing * a, 0, k * (4 * impact + 12 * c * act * Math.max(0, -a)));
      add(`shoulder_${s}`, 0, 0, -k * 7 * c * act * a);
      add(`foreArm_${s}`, -34 * c * w + lerpC(BODY.armJolt) * impact + (0.35 * (1 - c) * Math.max(0, a) - 0.9 * c * a) * swing, 0, 0);
      add(`hand_${s}`, -0.4 * swing * a + 6 * impact, 0, 0);
    }
  }

  private idle(add: AddJoint, { dt, time: t, speed, locked }: BladeMotionInput): void {
    const still = Math.max(0, 1 - speed / (0.6 * this.scale));
    const drift = locked ? 0 : still;
    const p = this.phaseSeed;
    // Breathing: about one breath every 2.6 s, the chest rising and the back rounding with it (stays calm on the chest in a charge so it never crosses the skin's forward limit).
    const breath = Math.sin(t * 2.4 + p[0]!);
    add('chest', -2.2 * breath * (1 - 0.35 * this.charge), 0, 0);
    add('spine', -1.2 * breath * (1 + 0.5 * this.charge), 0, 0);
    add('neck', 1.5 * breath * (1 + 0.5 * this.charge), 0, 0);
    // A slow weight shift from leg to leg while standing (off while anchored to a door).
    const shift = Math.sin(t * 0.55 + p[1]!) * drift;
    add('pelvis', 0, 3 * shift, 4 * shift);
    add('spine', 0, -2 * shift, -3 * shift);
    add('thigh_L', 0, 0, -2 * shift);
    add('thigh_R', 0, 0, -2 * shift);
    // The blades drift and flex, each on its own beat (off while gripping a door).
    for (const [s, k] of [['L', 2], ['R', 3]] as const) {
      const a = Math.sin(t * 0.9 + p[k]!) * drift;
      const b = Math.sin(t * 1.7 + p[k + 2]!) * drift;
      add(`upperArm_${s}`, 3 * a, 0, (s === 'L' ? -1 : 1) * 2 * b);
      add(`foreArm_${s}`, 4 * b, 0, 0);
      add(`hand_${s}`, 5 * a, 0, 0);
    }
    // Head snaps: jump to a new angle, hold it, jump again (smaller on the move or when locked on a doorway).
    this.snapTimer -= dt;
    if (this.snapTimer <= 0) {
      this.snapTimer = this.rng.range(0.6, 2.4);
      const big = this.rng.chance(0.25);
      this.snap.x = this.rng.range(-14, 10) * (big ? 1.6 : 1);
      this.snap.y = this.rng.range(-28, 28) * (big ? 1.4 : 1);
      this.snap.z = this.rng.range(-18, 18);
    }
    const k = Math.min(1, dt * 20);
    const calm = (locked ? 0.35 : 1) * (0.4 + 0.6 * still);
    this.snapCur.x += (this.snap.x * calm - this.snapCur.x) * k;
    this.snapCur.y += (this.snap.y * calm - this.snapCur.y) * k;
    this.snapCur.z += (this.snap.z * calm - this.snapCur.z) * k;
    add('head', this.snapCur.x * 0.7, this.snapCur.y * 0.6, this.snapCur.z * 0.6);
    add('neck', this.snapCur.x * 0.3, this.snapCur.y * 0.4, this.snapCur.z * 0.4);
  }
}
