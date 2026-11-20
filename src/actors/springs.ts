/**
 * Second-order spring dynamics and pose inertialization for procedural character physics.
 * Pure math (no three.js) so it runs in fast deterministic Node tests.
 *
 * Uses the pole-clamped semi-implicit second-order system (t3ssel8r formulation):
 *   y'' = (x + k3 * x' - y - k1 * y') / k2_stable
 * parameterized intuitively by natural frequency `f` (Hz), damping ratio `z`
 * (z < 1 underdamped bounce, z = 1 critically damped, z > 1 overdamped),
 * and initial response `r` (0 = smooth start, 1 = immediate, >1 = anticipation overshoot).
 */

const TWO_PI = Math.PI * 2;

export interface SpringParams {
  /** Natural frequency in Hz (higher = snappier). */
  f: number;
  /** Damping ratio (0..1 underdamped, 1 critically damped, >1 overdamped). */
  z: number;
  /** Initial response (-1..2; 0 smooth ease, 1 direct, <0 anticipation dip). */
  r?: number;
}

export class Spring1D {
  value: number;
  vel = 0;
  private xp: number;
  private k1: number;
  private k2: number;
  private k3: number;

  constructor(params: SpringParams, initial = 0) {
    this.value = initial;
    this.xp = initial;
    const { f, z, r = 0 } = params;
    const w = Math.max(0.05, f) * TWO_PI;
    this.k1 = z / (Math.PI * Math.max(0.05, f));
    this.k2 = 1 / (w * w);
    this.k3 = (r * z) / w;
  }

  /** Reconfigure spring dynamics on the fly without resetting state. */
  tune(params: SpringParams): void {
    const { f, z, r = 0 } = params;
    const w = Math.max(0.05, f) * TWO_PI;
    this.k1 = z / (Math.PI * Math.max(0.05, f));
    this.k2 = 1 / (w * w);
    this.k3 = (r * z) / w;
  }

  /** Snap immediately to a target with zero velocity (teleports, resets). */
  reset(v = 0): void {
    this.value = v;
    this.xp = v;
    this.vel = 0;
  }

  /** Add an instantaneous velocity impulse (bumps, footsteps, shoves). */
  impulse(dv: number): void {
    this.vel += dv;
  }

  /** Advance toward `target` over `dt` seconds; returns the new value. */
  step(target: number, dt: number): number {
    if (dt <= 0) return this.value;
    const h = Math.min(dt, 0.05);
    const xd = (target - this.xp) / h;
    this.xp = target;
    // Clamp k2 to guarantee stability at any frame rate (no oscillation blowup).
    const k2Stable = Math.max(this.k2, (h * h) / 2 + (h * this.k1) / 2, h * this.k1);
    this.value += h * this.vel;
    this.vel += (h * (target + this.k3 * xd - this.value - this.k1 * this.vel)) / k2Stable;
    return this.value;
  }
}

export class Spring2D {
  readonly x: Spring1D;
  readonly y: Spring1D;

  constructor(params: SpringParams, x0 = 0, y0 = 0) {
    this.x = new Spring1D(params, x0);
    this.y = new Spring1D(params, y0);
  }

  reset(x = 0, y = 0): void {
    this.x.reset(x);
    this.y.reset(y);
  }

  impulse(dx: number, dy: number): void {
    this.x.impulse(dx);
    this.y.impulse(dy);
  }

  step(tx: number, ty: number, dt: number): void {
    this.x.step(tx, dt);
    this.y.step(ty, dt);
  }
}

export class Spring3D {
  readonly x: Spring1D;
  readonly y: Spring1D;
  readonly z: Spring1D;

  constructor(params: SpringParams, x0 = 0, y0 = 0, z0 = 0) {
    this.x = new Spring1D(params, x0);
    this.y = new Spring1D(params, y0);
    this.z = new Spring1D(params, z0);
  }

  reset(x = 0, y = 0, z = 0): void {
    this.x.reset(x);
    this.y.reset(y);
    this.z.reset(z);
  }

  step(tx: number, ty: number, tz: number, dt: number): void {
    this.x.step(tx, dt);
    this.y.step(ty, dt);
    this.z.step(tz, dt);
  }
}

/**
 * Shortest signed angular difference wrapped to [-pi, pi].
 */
export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * Critically damped exponential decay step for inertialization offsets (x, v -> 0).
 * Exact closed-form solution to x'' + 2*w*x' + w^2*x = 0, unconditionally stable for any dt.
 */
export function decayCriticallyDamped(x: number, v: number, omega: number, dt: number): [number, number] {
  if (dt <= 0 || (Math.abs(x) < 1e-6 && Math.abs(v) < 1e-6)) return [0, 0];
  const e = Math.exp(-omega * dt);
  const c1 = x;
  const c2 = v + omega * x;
  const nx = (c1 + c2 * dt) * e;
  const nv = (v - omega * c2 * dt) * e;
  return [nx, nv];
}

/**
 * Upright angular steering with smooth acceleration/deceleration inertia.
 * Replaces hard linear heading clamps with an eased angular velocity that starts and stops
 * smoothly while reporting live `vel` (rad/s) and `error` (rad) for turn-in-place and banking.
 */
export interface UprightTurnState {
  vel: number;
  error: number;
}

export function stepUprightTurn(
  s: UprightTurnState,
  diff: number,
  maxRate: number,
  dt: number,
  accel?: number,
): number {
  const err = wrapAngle(diff);
  s.error = err;
  if (dt <= 0) return 0;
  // Scale responsiveness with requested maxRate so calm turns ease smoothly and urgent give-way turns stay crisp.
  const gain = Math.max(5.5, maxRate * 2.4);
  const ramp = accel ?? Math.max(14, maxRate * 4.5);
  const want = Math.max(-maxRate, Math.min(maxRate, err * gain));
  const k = 1 - Math.exp(-ramp * dt);
  s.vel += (want - s.vel) * k;
  let d = s.vel * dt;
  // Never overshoot past the target heading.
  if (Math.abs(err) < 1e-5) {
    s.vel = 0;
    return err;
  }
  if (Math.abs(d) > Math.abs(err) && Math.sign(d) === Math.sign(err)) {
    d = err;
    s.vel = 0;
  }
  return d;
}

export function settleUprightTurn(s: UprightTurnState, dt: number, damping = 12): number {
  s.error = 0;
  if (dt <= 0) return 0;
  s.vel *= Math.exp(-damping * dt);
  if (Math.abs(s.vel) < 1e-3) s.vel = 0;
  return s.vel * dt;
}
