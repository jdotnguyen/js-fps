/**
 * Turn-then-move steering for slow, heavy movers (ADR-0020): crawlers and draggers. Pure, no three.js.
 *
 * Instead of rotating the whole body at a fixed rate while it slides forward, the body turns in place
 * when the target is well off its heading (speed 0, limbs pivoting), then moves once it faces the
 * target, steering gently on the way. Turn speed is eased, so it starts and stops without a snap.
 */

export interface TurnState {
  /** Current turn speed in rad/s, + turns left (matches the body's +y). */
  vel: number;
  /** True while the body is pivoting on the spot and must not move forward. */
  inPlace: boolean;
}

export interface TurnParams {
  /** Heading error (rad) above which the body stops and turns in place. */
  start: number;
  /** Heading error (rad) below which it moves off again (hysteresis, so it does not flicker). */
  end: number;
  /** Top turn speed while pivoting, rad/s. */
  rate: number;
  /** Top turn speed while walking forward, rad/s. */
  steerRate: number;
  /** Turn speed wanted per radian of error, 1/s. */
  gain: number;
  /** How fast turn speed eases toward what is wanted, 1/s. */
  smooth: number;
}

export const CRAWL_TURN: TurnParams = { start: 0.7, end: 0.2, rate: 1.6, steerRate: 0.6, gain: 3, smooth: 8 };
export const DRAG_TURN: TurnParams = { start: 0.6, end: 0.2, rate: 1.2, steerRate: 0.45, gain: 3, smooth: 8 };

export const newTurnState = (): TurnState => ({ vel: 0, inPlace: false });

export interface TurnStep {
  /** Heading change to apply this step, radians. */
  dHeading: number;
  /** 0..1 share of top speed the body may move at (0 while pivoting). */
  speedFactor: number;
}

/** Advance the turn toward a heading error `diff` (radians, wrapped to ±pi, + means the target is to the left). */
export function stepTurn(s: TurnState, diff: number, dt: number, p: TurnParams): TurnStep {
  const abs = Math.abs(diff);
  if (!s.inPlace && abs > p.start) s.inPlace = true;
  else if (s.inPlace && abs < p.end) s.inPlace = false;
  const top = s.inPlace ? p.rate : p.steerRate;
  const want = Math.max(-top, Math.min(top, diff * p.gain));
  s.vel += (want - s.vel) * Math.min(1, dt * p.smooth);
  let dHeading = s.vel * dt;
  // Never turn past the target.
  if (Math.abs(dHeading) > abs && Math.sign(dHeading) === Math.sign(diff)) dHeading = diff;
  return { dHeading, speedFactor: s.inPlace ? 0 : 1 - 0.5 * Math.min(1, abs / p.start) };
}

/** No target: let any turn die away and stop pivoting. */
export function settleTurn(s: TurnState, dt: number, p: TurnParams): number {
  s.inPlace = false;
  s.vel -= s.vel * Math.min(1, dt * p.smooth);
  if (Math.abs(s.vel) < 1e-3) s.vel = 0;
  return s.vel * dt;
}
