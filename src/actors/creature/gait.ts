import * as THREE from 'three';
import type { LimbSide } from './limbIk.ts';
import type { CreatureRig } from './rig.ts';

/**
 * A creature's walk (openspec juggernaut-walk-and-roar D1-D4, spec `creature-motion`). The gait owns a root object (the
 * creature's ground point and facing) and the rig's four limb targets:
 *   - the root moves along a path at a speed, facing along it, and bobs and rolls with the steps;
 *   - the limbs step in a diagonal sequence (left leg, right hand, right leg, left hand): each is planted for `duty` of the
 *     cycle, holding its world point, then swings on an arc to where its standing place will be half way through its next
 *     stance;
 *   - the phase follows the distance walked, so a plant never slides when the speed changes;
 *   - a walk starts with every limb planted and ends standing: swings in flight finish, then any limb left far from its
 *     standing place takes one settling step.
 * Call `update(dt)` before `rig.update(dt)` each frame.
 */

export type LimbKind = 'foot' | 'hand';

export interface GaitParams {
  /** Distance the root covers per gait cycle (m); each limb moves this far per step. */
  stride: number;
  /** Share of the cycle each limb is planted. */
  duty: number;
  footLift: number;
  handLift: number;
  /** Body bob amplitude (m) and roll amplitude (degrees) at full walk. */
  bob: number;
  roll: number;
  /** A planted limb further than this from its standing place when the walk ends takes a settling step (m). */
  settle: number;
  /** Seconds to reach full speed and to fade the bob and roll in and out. */
  ease: number;
}

export const DEFAULT_GAIT: GaitParams = { stride: 1.2, duty: 0.7, footLift: 0.25, handLift: 0.3, bob: 0.04, roll: 2, settle: 0.15, ease: 0.5 };

/** Lift-off order and phase offsets: a diagonal-sequence walk. */
const ORDER: ReadonlyArray<[LimbSide, number]> = [
  ['leg.L', 0],
  ['arm.R', 0.25],
  ['leg.R', 0.5],
  ['arm.L', 0.75],
];

interface LimbState {
  side: LimbSide;
  kind: LimbKind;
  offset: number;
  /** Standing place in the root's frame (m, the root at the ground). */
  home: THREE.Vector3;
  planted: THREE.Vector3;
  swinging: boolean;
  liftFrom: THREE.Vector3;
  landAt: THREE.Vector3;
  /** Swing progress 0..1 when the swing runs on time (settling), else derived from the phase. */
  swingT: number;
  lastPhase: number;
}

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const smooth = (x: number) => x * x * (3 - 2 * x);

export class CreatureGait {
  readonly params: GaitParams;
  /** Called once per landing, at the landing point. */
  onTouchdown: ((side: LimbSide, point: THREE.Vector3, kind: LimbKind) => void) | null = null;

  private readonly rig: CreatureRig;
  private readonly root: THREE.Object3D;
  private readonly limbs: LimbState[];
  /** Height the root sits above the ground so the neutral stance just reaches it (m). */
  private readonly lift: number;
  private path: THREE.Vector3[] = [];
  private lengths: number[] = [];
  private total = 0;
  private s = 0;
  private speed = 0;
  private walkTime = 0;
  private mode: 'standing' | 'walking' | 'settling' = 'standing';
  private weight = 0;
  private ground = 0;
  private yaw = 0;
  private settleQueue: LimbState[] = [];

  /**
   * `root` is the creature's ground point and facing (its children hold the model); the rig must be in the pose it walks in
   * (normally neutral), with no limb targets, when the gait is built: the standing places are measured from it.
   */
  constructor(rig: CreatureRig, root: THREE.Object3D, params: Partial<GaitParams> = {}) {
    this.rig = rig;
    this.root = root;
    this.params = { ...DEFAULT_GAIT, ...params };
    root.updateMatrixWorld(true);
    const yaw = root.rotation.y;
    this.limbs = ORDER.map(([side, offset]) => {
      // Standing place relative to the root's ground point, unrotated by its facing (metres).
      const home = rig.limb(side).contactPoint(new THREE.Vector3()).sub(root.position).applyAxisAngle(UP, -yaw);
      return { side, kind: side.startsWith('leg') ? 'foot' : 'hand', offset, home, planted: new THREE.Vector3(), swinging: false, liftFrom: new THREE.Vector3(), landAt: new THREE.Vector3(), swingT: 0, lastPhase: 0 } as LimbState;
    });
    // Lift the root so the feet's standing places sit on the ground; hands keep their height above it.
    this.lift = -Math.min(...this.limbs.filter((l) => l.kind === 'foot').map((l) => l.home.y));
    for (const l of this.limbs) l.home.y += this.lift;
    this.yaw = root.rotation.y;
    this.ground = root.position.y;
    this.placeAt(root.position.clone(), this.yaw);
  }

  get standing(): boolean {
    return this.mode === 'standing';
  }

  get walking(): boolean {
    return this.mode !== 'standing';
  }

  /** Distance walked along the current path (m). */
  get distance(): number {
    return this.s;
  }

  /** Stand at `ground` (a point on the floor) facing `yaw`, every limb planted at its standing place. */
  placeAt(ground: THREE.Vector3, yaw: number): void {
    this.mode = 'standing';
    this.ground = ground.y;
    this.yaw = yaw;
    this.weight = 0;
    this.setRoot(ground.x, ground.z, 0);
    for (const l of this.limbs) {
      this.homeWorld(l, l.planted);
      l.swinging = false;
      l.swingT = 0;
    }
    this.pushTargets();
  }

  /** Walk along `path` (world points on the floor, starting at or near the creature) at `speed` m/s. */
  walk(path: THREE.Vector3[], speed: number): void {
    if (path.length < 2) throw new Error('a walk needs at least two points');
    this.path = path.map((p) => p.clone());
    this.lengths = [0];
    for (let i = 1; i < path.length; i++) this.lengths.push(this.lengths[i - 1]! + path[i]!.distanceTo(path[i - 1]!));
    this.total = this.lengths[this.lengths.length - 1]!;
    this.s = 0;
    this.speed = Math.max(0.01, speed);
    this.walkTime = 0;
    this.ground = path[0]!.y;
    this.mode = 'walking';
    // A limb whose phase starts on its lift-off point lifts on the first frame.
    for (const l of this.limbs) l.lastPhase = this.phaseOf(l) === 0 ? 1 : this.phaseOf(l);
  }

  /** Stop where it is and settle. */
  stop(): void {
    if (this.mode !== 'walking') return;
    this.total = this.s;
    this.beginSettle();
  }

  update(dt: number): void {
    const p = this.params;
    if (this.mode === 'walking') {
      this.walkTime += dt;
      // Ease in from standing; ease out over the last stretch so the path ends exactly.
      const remaining = this.total - this.s;
      const v = this.speed * Math.min(1, this.walkTime / p.ease) * Math.min(1, 0.25 + remaining / (this.speed * p.ease * 1.5));
      this.s = Math.min(this.total, this.s + v * dt);
      this.weight = Math.min(1, this.weight + dt / p.ease);
      const at = this.pointAt(this.s, new THREE.Vector3());
      const dir = this.dirAt(this.s, new THREE.Vector3());
      const want = Math.atan2(dir.x, dir.z);
      this.yaw += wrap(want - this.yaw) * Math.min(1, dt * 6);
      this.setRoot(at.x, at.z, this.phase());
      this.stepLimbs();
      if (this.s >= this.total - 1e-6) this.beginSettle();
    } else if (this.mode === 'settling') {
      this.weight = Math.max(0, this.weight - dt / p.ease);
      this.setRoot(this.root.position.x, this.root.position.z, this.phase());
      this.settleLimbs(dt);
    }
    this.pushTargets();
  }

  /** Where a limb's standing place is in the world now. */
  homeWorld(l: { home: THREE.Vector3 } | LimbSide, out: THREE.Vector3): THREE.Vector3 {
    const limb = typeof l === 'string' ? this.limbs.find((x) => x.side === l)! : l;
    out.copy(limb.home).applyAxisAngle(UP, this.yaw);
    out.x += this.root.position.x;
    out.z += this.root.position.z;
    out.y += this.ground;
    return out;
  }

  /** Whether a limb is planted, and where. */
  plant(side: LimbSide): { planted: boolean; point: THREE.Vector3 } {
    const l = this.limbs.find((x) => x.side === side)!;
    return { planted: !l.swinging, point: l.swinging ? this.swingPoint(l, new THREE.Vector3()) : l.planted.clone() };
  }

  private phase(): number {
    return this.s / this.params.stride;
  }

  private phaseOf(l: LimbState): number {
    const x = this.phase() - l.offset;
    return x - Math.floor(x);
  }

  private get swingShare(): number {
    return 1 - this.params.duty;
  }

  private stepLimbs(): void {
    const sw = this.swingShare;
    for (const l of this.limbs) {
      const ph = this.phaseOf(l);
      if (!l.swinging) {
        // Lift off when the phase wraps through 0 (its swing starts there).
        if (ph < l.lastPhase && ph < sw) this.liftOff(l);
      } else if (ph >= sw || ph < l.lastPhase) {
        this.land(l, this.landingPoint(l, 0, l.landAt));
      } else {
        l.swingT = ph / sw;
        this.landingPoint(l, sw - ph, l.landAt);
      }
      l.lastPhase = ph;
    }
  }

  private liftOff(l: LimbState): void {
    l.swinging = true;
    l.swingT = 0;
    l.liftFrom.copy(l.planted);
    this.landingPoint(l, this.swingShare, l.landAt);
  }

  private land(l: LimbState, at: THREE.Vector3): void {
    l.swinging = false;
    l.swingT = 0;
    l.planted.copy(at);
    this.onTouchdown?.(l.side, at.clone(), l.kind);
  }

  /** Landing point for a limb with `swingLeft` of the cycle still to swing: its standing place half way through the next stance. */
  private landingPoint(l: LimbState, swingLeft: number, out: THREE.Vector3): THREE.Vector3 {
    if (this.mode !== 'walking') return this.homeWorld(l, out);
    const ahead = Math.min(this.total, this.s + (swingLeft + this.params.duty / 2) * this.params.stride);
    const at = this.pointAt(ahead, new THREE.Vector3());
    const dir = this.dirAt(ahead, new THREE.Vector3());
    out.copy(l.home).applyAxisAngle(UP, Math.atan2(dir.x, dir.z));
    out.x += at.x;
    out.z += at.z;
    out.y += this.ground;
    return out;
  }

  private beginSettle(): void {
    this.mode = 'settling';
    this.s = this.total;
    this.settleQueue = [];
  }

  private settleLimbs(dt: number): void {
    const swingTime = (this.swingShare * this.params.stride) / Math.max(0.2, this.speed);
    const home = new THREE.Vector3();
    // Finish swings in flight (by time now), landing at the standing place.
    for (const l of this.limbs) {
      if (!l.swinging) continue;
      l.swingT = Math.min(1, l.swingT + dt / swingTime);
      this.homeWorld(l, l.landAt);
      if (l.swingT >= 1) this.land(l, l.landAt);
    }
    if (this.limbs.some((l) => l.swinging)) return;
    // Then one settling step at a time, in the gait's order, for limbs left far from their standing place.
    if (this.settleQueue.length === 0) {
      this.settleQueue = this.limbs.filter((l) => {
        this.homeWorld(l, home);
        return Math.hypot(l.planted.x - home.x, l.planted.z - home.z) > this.params.settle;
      });
      if (this.settleQueue.length === 0) {
        this.mode = 'standing';
        this.weight = 0;
        this.setRoot(this.root.position.x, this.root.position.z, 0);
        return;
      }
    }
    const next = this.settleQueue.shift()!;
    next.swinging = true;
    next.swingT = 0;
    next.liftFrom.copy(next.planted);
    this.homeWorld(next, next.landAt);
  }

  private swingPoint(l: LimbState, out: THREE.Vector3): THREE.Vector3 {
    const t = l.swingT;
    out.lerpVectors(l.liftFrom, l.landAt, smooth(t));
    out.y += (l.kind === 'foot' ? this.params.footLift : this.params.handLift) * Math.sin(Math.PI * t);
    return out;
  }

  private setRoot(x: number, z: number, phase: number): void {
    const w = this.weight;
    const bob = this.params.bob * w * Math.sin(2 * TAU * phase);
    const roll = THREE.MathUtils.degToRad(this.params.roll) * w * Math.sin(TAU * phase);
    this.root.position.set(x, this.ground + this.lift + bob, z);
    this.root.rotation.set(0, this.yaw, 0, 'YXZ');
    this.root.rotateZ(roll);
    this.root.updateMatrixWorld(true);
  }

  private pushTargets(): void {
    const p = new THREE.Vector3();
    for (const l of this.limbs) {
      const at = l.swinging ? this.swingPoint(l, p) : l.planted;
      this.rig.setLimbTarget(l.side, at);
    }
  }

  private pointAt(s: number, out: THREE.Vector3): THREE.Vector3 {
    const i = this.segment(s);
    const a = this.path[i]!;
    const b = this.path[i + 1]!;
    const len = this.lengths[i + 1]! - this.lengths[i]!;
    return out.lerpVectors(a, b, len > 0 ? (s - this.lengths[i]!) / len : 0);
  }

  private dirAt(s: number, out: THREE.Vector3): THREE.Vector3 {
    const i = this.segment(s);
    out.subVectors(this.path[i + 1]!, this.path[i]!);
    out.y = 0;
    return out.lengthSq() > 1e-12 ? out.normalize() : out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  private segment(s: number): number {
    let i = 0;
    while (i < this.lengths.length - 2 && s > this.lengths[i + 1]!) i++;
    return i;
  }
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
