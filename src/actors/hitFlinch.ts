/**
 * How the view takes a hit (player-hit-feedback D2): its own springs, apart from the recoil kick, with a motion
 * per attack kind. Most of it only moves the camera (`view`); a share also knocks the aim off, and its spring
 * takes that back, so a hit leaves no lasting turn. Pure.
 */
import { struckFrom, type HitInfo, type HitKind } from './hit.ts';

const DEG = Math.PI / 180;

interface Motion {
  /** Peak angles at full strength, radians; positive pitches up. `yaw` and `roll` are away from the struck side. */
  pitch: number;
  yaw: number;
  roll: number;
  /** Peak camera travel forward and down, metres. */
  push: number;
  dip: number;
  /** A noise shake: its size at full strength (radians) and how long it takes to die. */
  shake: number;
  shakeTime: number;
  /** Share of the pitch and yaw that also moves the aim. */
  aim: number;
}

const still: Motion = { pitch: 0, yaw: 0, roll: 0, push: 0, dip: 0, shake: 0, shakeTime: 0, aim: 0 };

export const FLINCH: Record<HitKind, Motion> = {
  swipe: { ...still, pitch: -1.2 * DEG, yaw: 3.2 * DEG, roll: 4.5 * DEG, aim: 0.35 },
  bite: { ...still, pitch: -4.5 * DEG, push: 0.07, aim: 0.35 },
  slam: { ...still, pitch: -3.5 * DEG, dip: 0.12, shake: 1.4 * DEG, shakeTime: 0.25, aim: 0.35 },
  // A tremor only: the grab is already turning the view to whatever holds him.
  grab: { ...still, shake: 0.9 * DEG, shakeTime: 0.3 },
  generic: { ...still, pitch: 1.5 * DEG, aim: 0.35 },
};

/** The smallest hit still moves the view by this share of the full motion. */
const FLOOR = 0.4;
const REDUCED = 0.3;

/** How much of its full motion a hit gets, from its size and the Reduced motion setting. */
export function hitStrength(severity: number, reducedMotion: boolean): number {
  return (FLOOR + (1 - FLOOR) * severity) * (reducedMotion ? REDUCED : 1);
}
/** Spring rates, 1/s: critically damped, a peak after 1/rate s and settled within about 0.4 s. */
const VIEW_RATE = 18;
const AIM_RATE = 16;
const REST = 1e-5;

/** A critically damped spring, stepped exactly, so it moves the same at any frame rate. */
export class CriticalSpring {
  x = 0;
  private v = 0;
  private readonly w: number;
  constructor(w: number) {
    this.w = w;
  }
  /** Send it out to about `peak`, from wherever it is. */
  kick(peak: number): void {
    this.v += peak * Math.E * this.w;
  }
  step(dt: number): void {
    const c = this.v + this.w * this.x;
    const e = Math.exp(-this.w * dt);
    this.x = (this.x + c * dt) * e;
    this.v = (this.v - this.w * c * dt) * e;
    if (Math.abs(this.x) < REST && Math.abs(this.v) < REST * this.w) this.x = this.v = 0;
  }
  clear(): void {
    this.x = this.v = 0;
  }
}

export class HitFlinch {
  /** The camera's offset this frame: radians, and metres forward and down. The aim is not in it. */
  readonly view = { pitch: 0, yaw: 0, roll: 0, push: 0, dip: 0 };
  private readonly pitch = new CriticalSpring(VIEW_RATE);
  private readonly yaw = new CriticalSpring(VIEW_RATE);
  private readonly roll = new CriticalSpring(VIEW_RATE);
  private readonly push = new CriticalSpring(VIEW_RATE);
  private readonly dip = new CriticalSpring(VIEW_RATE);
  private readonly aimYaw = new CriticalSpring(AIM_RATE);
  private readonly aimPitch = new CriticalSpring(AIM_RATE);
  /** How far the aim has actually been moved by the punch. */
  private movedYaw = 0;
  private movedPitch = 0;
  private shake = 0;
  private shakeTime = 0;
  private shakeLeft = 0;
  private time = 0;

  hit(info: Pick<HitInfo, 'kind' | 'side' | 'dir' | 'severity'>, reducedMotion: boolean): void {
    const m = FLINCH[info.kind];
    const k = hitStrength(info.severity, reducedMotion);
    // Away from the blow: a strike from the left turns and rolls the view right (both negative).
    const side = Math.sign(struckFrom(info).x);
    this.pitch.kick(m.pitch * k);
    this.yaw.kick(m.yaw * side * k);
    this.roll.kick(m.roll * side * k);
    this.push.kick(m.push * k);
    this.dip.kick(m.dip * k);
    this.aimPitch.kick(m.pitch * m.aim * k);
    this.aimYaw.kick(m.yaw * m.aim * side * k);
    if (m.shake * k > this.shakeNow()) {
      this.shake = m.shake * k;
      this.shakeTime = this.shakeLeft = m.shakeTime;
    }
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;
    for (const s of [this.pitch, this.yaw, this.roll, this.push, this.dip, this.aimYaw, this.aimPitch]) s.step(dt);
    this.shakeLeft = Math.max(0, this.shakeLeft - dt);
    const a = this.shakeNow();
    const t = this.time * Math.PI * 2;
    const v = this.view;
    v.pitch = this.pitch.x + a * Math.sin(t * 17.3);
    v.yaw = this.yaw.x + a * 0.7 * Math.sin(t * 22.9 + 1.3);
    v.roll = this.roll.x + a * 0.8 * Math.sin(t * 13.7 + 4.1);
    v.push = this.push.x;
    v.dip = this.dip.x;
  }

  /** The turn still owed to the aim this frame; report what was applied with `aimMoved`. */
  aimStep(): { yaw: number; pitch: number } {
    return { yaw: this.aimYaw.x - this.movedYaw, pitch: this.aimPitch.x - this.movedPitch };
  }

  /** What the aim actually moved (the pitch limit can hold some back), so the same amount comes off again. */
  aimMoved(yaw: number, pitch: number): void {
    this.movedYaw += yaw;
    this.movedPitch += pitch;
  }

  /** Something else took the aim (a scripted shot, a grab): give up the punch where it is. */
  dropAim(): void {
    this.aimYaw.clear();
    this.aimPitch.clear();
    this.movedYaw = this.movedPitch = 0;
  }

  reset(): void {
    this.dropAim();
    for (const s of [this.pitch, this.yaw, this.roll, this.push, this.dip]) s.clear();
    this.shake = this.shakeTime = this.shakeLeft = 0;
    const v = this.view;
    v.pitch = v.yaw = v.roll = v.push = v.dip = 0;
  }

  private shakeNow(): number {
    return this.shakeLeft > 0 ? this.shake * (this.shakeLeft / this.shakeTime) : 0;
  }
}
