/**
 * How far each visor panel sits from rest, in screen pixels, x right and y down (visor-hud design D8): a lag behind
 * camera turns and head bob, plus a jolt when Jay is hit. Both ride critically damped springs solved exactly over each
 * step, so the frame rate does not change the motion.
 */
import type { HitSide } from '../../../actors/hit.ts';

export type PanelId = 'bio' | 'ammo';
export interface Offset {
  x: number;
  y: number;
}

export interface MotionInput {
  /** The camera's turn and tilt, radians. */
  yaw: number;
  pitch: number;
  /** The eye's height above its rest height, metres. */
  bob: number;
  /** The HUD scale setting. */
  scale: number;
  reduced: boolean;
}

/** What a hit tells the visor; every part is optional, so a hit nobody described still jolts. */
export interface Strike {
  side?: HitSide | null;
  dir?: { x?: number; y?: number };
  severity?: number;
}

/** The furthest a panel may sit from rest, at HUD scale 1. */
export const MAX_OFFSET = 12;
const OMEGA = 2 * Math.PI * 6;
/** Pixels of lag per radian a second of turn, and per metre of head bob. */
const TURN_PX = 3;
const BOB_PX = 100;
/** The furthest a jolt throws a panel: the lightest hit and a full one. */
const JOLT_MIN = 4;
const JOLT_MAX = 11;
/** The share each panel takes: the one on the struck side, the other, and both when the hit has no side. */
const NEAR = 1;
const FAR = 0.15;
const BOTH = 0.5;

interface Spring {
  x: number;
  v: number;
}

const still = (): Spring => ({ x: 0, v: 0 });

function settle(s: Spring, target: number, dt: number): void {
  const decay = Math.exp(-OMEGA * dt);
  const y = s.x - target;
  const drive = (s.v + OMEGA * y) * dt;
  s.x = target + (y + drive) * decay;
  s.v = (s.v - OMEGA * drive) * decay;
}

/** How much of a hit lands on `panel`. */
export function joltShare(side: HitSide | null | undefined, panel: PanelId): number {
  if (side !== 'L' && side !== 'R') return BOTH;
  return (side === 'L') === (panel === 'bio') ? NEAR : FAR;
}

function wrap(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export class VisorSpring {
  readonly bio: Offset = { x: 0, y: 0 };
  readonly ammo: Offset = { x: 0, y: 0 };
  private readonly lag = { x: still(), y: still() };
  private readonly jolt = { bio: { x: still(), y: still() }, ammo: { x: still(), y: still() } };
  private last: { yaw: number; pitch: number } | null = null;

  /** At rest, with no memory of where the camera was: a load or a restore moves it without a turn. */
  reset(): void {
    this.last = null;
    for (const s of this.springs()) s.x = s.v = 0;
    this.bio.x = this.bio.y = this.ammo.x = this.ammo.y = 0;
  }

  /** A blow pushes the panels away from where it came from; one from straight ahead or from nowhere dips them. */
  hit(strike: Strike): void {
    const side = strike.side;
    const from = side === 'L' ? -1 : side === 'R' ? 1 : Math.min(1, Math.max(-1, strike.dir?.x ?? 0));
    const severity = Math.min(1, Math.max(0, strike.severity ?? 0.5));
    // The speed that carries a critically damped spring this far.
    const speed = (JOLT_MIN + (JOLT_MAX - JOLT_MIN) * severity) * OMEGA * Math.E;
    for (const panel of ['bio', 'ammo'] as const) {
      const share = joltShare(side, panel);
      this.jolt[panel].x.v += -from * speed * share;
      this.jolt[panel].y.v += (1 - Math.abs(from)) * speed * share * BOTH;
    }
  }

  /** Advance by `dt` seconds and set `bio` and `ammo`. */
  step(input: MotionInput, dt: number): void {
    if (input.reduced) {
      this.reset();
      return;
    }
    if (dt <= 0) return;
    const max = MAX_OFFSET * input.scale;
    const yawRate = this.last ? wrap(input.yaw - this.last.yaw) / dt : 0;
    const pitchRate = this.last ? (input.pitch - this.last.pitch) / dt : 0;
    this.last = { yaw: input.yaw, pitch: input.pitch };
    const bound = (v: number): number => Math.min(max, Math.max(-max, v));
    // Yaw grows turning left and pitch looking up; the panels trail the view, left of a right turn and below a look up.
    settle(this.lag.x, bound(yawRate * TURN_PX), dt);
    settle(this.lag.y, bound(pitchRate * TURN_PX + input.bob * BOB_PX), dt);
    for (const panel of ['bio', 'ammo'] as const) {
      const j = this.jolt[panel];
      settle(j.x, 0, dt);
      settle(j.y, 0, dt);
      const x = this.lag.x.x + j.x.x;
      const y = this.lag.y.x + j.y.x;
      const length = Math.hypot(x, y);
      const k = length > max ? max / length : 1;
      this[panel].x = x * k;
      this[panel].y = y * k;
    }
  }

  private springs(): Spring[] {
    return [this.lag.x, this.lag.y, this.jolt.bio.x, this.jolt.bio.y, this.jolt.ammo.x, this.jolt.ammo.y];
  }
}
