import type { ColliderQuery } from '../actors/motor.ts';
import { clearWalk, type P3 } from './nav.ts';

/**
 * Natural-looking walks (ADR-0028): authored curves through control points, nav paths with their
 * corners rounded, and a follower that eases speed into turns, doorways and the arrival instead of
 * chasing waypoints at a constant speed. Pure maths, shared by Jay's scripted walks and NPC moves.
 */

export const WALK_SHAPE = {
  /** Spacing of curve samples, metres. */
  step: 0.2,
  /** Longest corner cut when rounding a nav path, metres along each leg. */
  cornerCut: 0.7,
  /** Pure-pursuit lookahead on straights, metres (shrinks in turns so the walker doesn't cut in). */
  lookahead: 0.55,
  /** Lookahead in the tightest turn, metres. */
  lookaheadTurn: 0.2,
  /** Extra clearance a rounded corner must keep beyond the body radius, metres. */
  margin: 0.06,
  /** Slowest fraction of walking speed in the tightest turn. */
  turnFloor: 0.5,
  /** Window (metres) over which heading change is measured for the turn slow-down. */
  turnWindow: 1.0,
  /** Braking (m/s²) for the speed profile. */
  decel: 1.6,
  /** Speeding up (m/s²) from a stand. */
  accel: 1.8,
  /** Speed kept at the very end so the walker reaches the spot, m/s. */
  endSpeed: 0.25,
} as const;

const dist2 = (a: P3, b: P3): number => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Centripetal Catmull-Rom through `controls` (passes through every point, no loops or cusps),
 * sampled about every `step` metres. Heights are interpolated linearly per span.
 */
export function catmullRom(controls: P3[], step: number = WALK_SHAPE.step): P3[] {
  const c = controls.filter((p, i) => i === 0 || dist2(p, controls[i - 1]!) > 1e-3);
  if (c.length < 3) return c.map((p) => ({ ...p }));
  const ext: P3[] = [reflect(c[1]!, c[0]!), ...c, reflect(c[c.length - 2]!, c[c.length - 1]!)];
  const out: P3[] = [{ ...c[0]! }];
  for (let i = 1; i < ext.length - 2; i++) {
    const p0 = ext[i - 1]!;
    const p1 = ext[i]!;
    const p2 = ext[i + 1]!;
    const p3 = ext[i + 2]!;
    const t01 = Math.sqrt(Math.max(1e-6, dist2(p0, p1)));
    const t12 = Math.sqrt(Math.max(1e-6, dist2(p1, p2)));
    const t23 = Math.sqrt(Math.max(1e-6, dist2(p2, p3)));
    const n = Math.max(1, Math.ceil(dist2(p1, p2) / step));
    for (let k = 1; k <= n; k++) {
      const u = k / n;
      const t = t01 + u * t12;
      const t0 = 0;
      const t1 = t01;
      const t2 = t01 + t12;
      const t3 = t2 + t23;
      const lerp = (a: P3, b: P3, ta: number, tb: number): { x: number; z: number } => {
        const w = (t - ta) / (tb - ta);
        return { x: a.x + (b.x - a.x) * w, z: a.z + (b.z - a.z) * w };
      };
      const a1 = lerp(p0, p1, t0, t1);
      const a2 = lerp(p1, p2, t1, t2);
      const a3 = lerp(p2, p3, t2, t3);
      const b1 = { x: a1.x + (a2.x - a1.x) * ((t - t0) / (t2 - t0)), z: a1.z + (a2.z - a1.z) * ((t - t0) / (t2 - t0)) };
      const b2 = { x: a2.x + (a3.x - a2.x) * ((t - t1) / (t3 - t1)), z: a2.z + (a3.z - a2.z) * ((t - t1) / (t3 - t1)) };
      const w = (t - t1) / (t2 - t1);
      out.push({ x: b1.x + (b2.x - b1.x) * w, y: p1.y + (p2.y - p1.y) * u, z: b1.z + (b2.z - b1.z) * w });
    }
  }
  return out;
}

function reflect(p: P3, about: P3): P3 {
  return { x: 2 * about.x - p.x, y: about.y, z: 2 * about.z - p.z };
}

export interface RoundOptions {
  /** Colliders to keep clear of; without them corners are rounded unchecked. */
  world?: ColliderQuery;
  /** Body radius the rounded corner must clear. */
  radius?: number;
  cut?: number;
  step?: number;
}

/**
 * Round the corners of a polyline (`from` then `pts`) with quadratic arcs, each shrunk until the
 * body clears the colliders (a corner stays sharp if even a small arc would clip). Returns the
 * dense walk, starting at `from`.
 */
export function roundCorners(from: P3, pts: P3[], opts: RoundOptions = {}): P3[] {
  const poly = [from, ...pts].filter((p, i, a) => i === 0 || dist2(p, a[i - 1]!) > 1e-3);
  const cutMax = opts.cut ?? WALK_SHAPE.cornerCut;
  const step = opts.step ?? WALK_SHAPE.step;
  const out: P3[] = [{ ...poly[0]! }];
  let prev = poly[0]!;
  for (let i = 1; i < poly.length; i++) {
    const v = poly[i]!;
    const next = poly[i + 1];
    if (!next) {
      pushLine(out, prev, v, step);
      break;
    }
    const lin = dist2(prev, v);
    const lout = dist2(v, next);
    const ax = (v.x - prev.x) / lin;
    const az = (v.z - prev.z) / lin;
    const bx = (next.x - v.x) / lout;
    const bz = (next.z - v.z) / lout;
    const turn = Math.acos(Math.max(-1, Math.min(1, ax * bx + az * bz)));
    let arc: P3[] | null = null;
    if (turn > 0.05) {
      // Never eat more than ~half of either leg, so neighbouring arcs don't overlap.
      let d = Math.min(cutMax, lin * 0.48, lout * 0.48);
      for (let tries = 0; tries < 4 && d > 0.08; tries++, d *= 0.5) {
        const p1 = { x: v.x - ax * d, y: v.y, z: v.z - az * d };
        const p2 = { x: v.x + bx * d, y: v.y, z: v.z + bz * d };
        const n = Math.max(3, Math.ceil((2 * d) / step));
        const cand: P3[] = [];
        for (let k = 0; k <= n; k++) {
          const t = k / n;
          const u = 1 - t;
          cand.push({ x: u * u * p1.x + 2 * u * t * v.x + t * t * p2.x, y: v.y, z: u * u * p1.z + 2 * u * t * v.z + t * t * p2.z });
        }
        if (!opts.world || clearChain(opts.world, cand, (opts.radius ?? 0.35) + WALK_SHAPE.margin)) {
          arc = cand;
          break;
        }
      }
    }
    if (arc) {
      pushLine(out, prev, arc[0]!, step);
      for (let k = 1; k < arc.length; k++) out.push(arc[k]!);
      prev = arc[arc.length - 1]!;
    } else {
      pushLine(out, prev, v, step);
      prev = v;
    }
  }
  return out;
}

function pushLine(out: P3[], a: P3, b: P3, step: number): void {
  const n = Math.max(1, Math.ceil(dist2(a, b) / step));
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
  }
}

/** Does a body of `radius` clear every leg of the chain? */
export function clearChain(world: ColliderQuery, pts: P3[], radius: number): boolean {
  for (let i = 1; i < pts.length; i++) if (!clearWalk(world, pts[i - 1]!, pts[i]!, radius)) return false;
  return true;
}

/** Legs of a chain a body of `radius` cannot walk (indices of the leg's end point). */
export function blockedLegs(world: ColliderQuery, pts: P3[], radius: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < pts.length; i++) if (!clearWalk(world, pts[i - 1]!, pts[i]!, radius)) out.push(i);
  return out;
}

export interface FollowOptions {
  /** Cruising speed, m/s. */
  speed: number;
  /** Speed the walker is already moving at (keeps a re-plan from stopping it dead). */
  v0?: number;
  lookahead?: number;
  /** Speed at the end of the walk; 0 eases to a stop exactly. */
  endSpeed?: number;
}

export interface FollowStep {
  /** Point to steer at (the carrot). */
  tx: number;
  tz: number;
  /** Speed this frame, m/s. */
  speed: number;
  /** Metres of walk left. */
  remaining: number;
  done: boolean;
}

/**
 * Walks a dense polyline: projects the walker onto it (never backwards), steers at a point a little
 * ahead, and runs a speed profile that slows into turns and the arrival and speeds up gently.
 */
export class PathFollower {
  readonly points: P3[];
  private readonly s: Float64Array;
  private readonly vmax: Float64Array;
  private at = 0;
  private seg = 0;
  speed: number;
  private readonly lookahead: number;
  readonly length: number;
  private readonly opts: FollowOptions;

  constructor(points: P3[], opts: FollowOptions) {
    this.opts = opts;
    this.points = points.length ? points : [{ x: 0, y: 0, z: 0 }];
    const n = this.points.length;
    this.s = new Float64Array(n);
    for (let i = 1; i < n; i++) this.s[i] = this.s[i - 1]! + dist2(this.points[i]!, this.points[i - 1]!);
    this.length = this.s[n - 1]!;
    this.lookahead = opts.lookahead ?? WALK_SHAPE.lookahead;
    this.speed = opts.v0 ?? 0;
    this.vmax = speedProfile(this.points, this.s, opts.speed, opts.endSpeed ?? WALK_SHAPE.endSpeed);
  }

  /** Progress along the walk, metres. */
  get progress(): number {
    return this.at;
  }

  /** Cap on speed at arc length `s` from the turn/arrival profile. */
  capAt(s: number): number {
    return this.sample(s, this.vmax);
  }

  update(x: number, z: number, dt: number): FollowStep {
    const n = this.points.length;
    // Project onto the walk near the current progress (ahead up to 2.5 m, never back).
    let best = Infinity;
    let bestS = this.at;
    let bestSeg = this.seg;
    for (let i = this.seg; i < n - 1; i++) {
      if (this.s[i]! > this.at + 2.5) break;
      const a = this.points[i]!;
      const b = this.points[i + 1]!;
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const len2 = ex * ex + ez * ez;
      const t = len2 > 1e-9 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / len2)) : 0;
      const px = a.x + ex * t;
      const pz = a.z + ez * t;
      const d = Math.hypot(px - x, pz - z);
      if (d < best) {
        best = d;
        bestS = this.s[i]! + Math.sqrt(len2) * t;
        bestSeg = i;
      }
    }
    if (bestS > this.at) {
      this.at = bestS;
      this.seg = bestSeg;
    }
    const remaining = Math.max(0, this.length - this.at);
    const end = this.points[n - 1]!;
    const toEnd = Math.hypot(end.x - x, end.z - z);
    // Tighter lookahead where the profile slows for a turn, so the walker tracks the curve.
    const turnK = Math.min(1, this.capAt(Math.min(this.length, this.at + 0.4)) / Math.max(1e-3, this.opts.speed));
    const look = WALK_SHAPE.lookaheadTurn + (this.lookahead - WALK_SHAPE.lookaheadTurn) * Math.max(0, (turnK - WALK_SHAPE.turnFloor) / (1 - WALK_SHAPE.turnFloor));
    const carrot = this.pointAt(Math.min(this.length, this.at + look + Math.min(best, 1)));
    // Close to the end: steer straight at the spot.
    const tx = remaining < this.lookahead ? end.x : carrot.x;
    const tz = remaining < this.lookahead ? end.z : carrot.z;
    const cap = Math.min(this.capAt(this.at), this.capAt(Math.min(this.length, this.at + 0.3)));
    // Far off the line (shoved, stepped round someone): don't sprint back, just walk.
    const target = Math.min(cap, this.opts.speed);
    const accel = target > this.speed ? WALK_SHAPE.accel : WALK_SHAPE.decel * 2;
    const dv = target - this.speed;
    this.speed += Math.sign(dv) * Math.min(Math.abs(dv), accel * dt);
    // Never overshoot the spot in one frame.
    const speed = Math.min(this.speed, toEnd / Math.max(dt, 1e-4));
    return { tx, tz, speed, remaining: Math.max(remaining, toEnd), done: remaining < 0.05 && toEnd < 0.2 };
  }

  pointAt(s: number): P3 {
    const n = this.points.length;
    if (s <= 0) return this.points[0]!;
    if (s >= this.length) return this.points[n - 1]!;
    let i = Math.max(0, Math.min(this.seg, n - 2));
    while (i > 0 && this.s[i]! > s) i--;
    while (i < n - 2 && this.s[i + 1]! < s) i++;
    const a = this.points[i]!;
    const b = this.points[i + 1]!;
    const span = this.s[i + 1]! - this.s[i]!;
    const t = span > 1e-9 ? (s - this.s[i]!) / span : 0;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
  }

  private sample(s: number, arr: Float64Array): number {
    const n = this.points.length;
    if (n === 1 || s >= this.length) return arr[n - 1]!;
    let i = Math.max(0, Math.min(this.seg, n - 2));
    while (i > 0 && this.s[i]! > s) i--;
    while (i < n - 2 && this.s[i + 1]! < s) i++;
    const span = this.s[i + 1]! - this.s[i]!;
    const t = span > 1e-9 ? (s - this.s[i]!) / span : 0;
    return arr[i]! + (arr[i + 1]! - arr[i]!) * t;
  }
}

/** Per-point speed cap: slower through turns (heading change over a window), braking into each. */
function speedProfile(pts: P3[], s: Float64Array, vCruise: number, vEnd: number): Float64Array {
  const n = pts.length;
  const v = new Float64Array(n).fill(vCruise);
  const head = new Float64Array(n);
  for (let i = 0; i < n - 1; i++) head[i] = Math.atan2(pts[i + 1]!.z - pts[i]!.z, pts[i + 1]!.x - pts[i]!.x);
  head[n - 1] = n > 1 ? head[n - 2]! : 0;
  const half = WALK_SHAPE.turnWindow / 2;
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < n; i++) {
    while (s[i]! - s[lo]! > half) lo++;
    while (hi < n - 1 && s[hi + 1]! - s[i]! <= half) hi++;
    let turn = Math.abs(wrap(head[Math.max(lo, Math.min(hi, n - 2))]! - head[Math.max(0, Math.min(lo, n - 2))]!));
    turn = Math.min(Math.PI / 2, turn);
    v[i] = vCruise * (1 - (1 - WALK_SHAPE.turnFloor) * (turn / (Math.PI / 2)));
  }
  v[n - 1] = Math.min(v[n - 1]!, vEnd);
  // Brake into slow spots: v_i <= sqrt(v_{i+1}^2 + 2 a ds).
  for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i]!, Math.sqrt(v[i + 1]! ** 2 + 2 * WALK_SHAPE.decel * (s[i + 1]! - s[i]!)));
  return v;
}

function wrap(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** What `planWalk` needs: something that finds routes, and the colliders to round corners against. */
export interface PlanDeps {
  nav: { findPath(from: P3, to: P3, opts?: { radius?: number }): P3[] | null } | null;
  world: ColliderQuery | null;
  /** Body radius corners must clear. */
  radius?: number;
}

export interface WalkPlan {
  /** Dense walk from the walker's feet to the goal. */
  points: P3[];
  /** False if some leg had no route and is a straight line (walls may be in the way). */
  routed: boolean;
}

/** Further than this from an authored walk's first point, the walker is routed onto it first. */
const JOIN_DIST = 0.75;

/**
 * Plan a natural walk from `from` to `to`. With `controls` (an authored walk) the walker is routed
 * to its start if needed, follows the curve, then is routed on to `to` if that is somewhere else.
 * Without, it is the nav route with its corners rounded.
 */
export function planWalk(from: P3, to: P3, deps: PlanDeps, controls?: P3[]): WalkPlan {
  const radius = deps.radius ?? 0.35;
  let routed = true;
  const leg = (a: P3, b: P3): P3[] => {
    if (dist2(a, b) < 0.05) return [{ ...b }];
    const p = deps.nav?.findPath(a, b, { radius }) ?? null;
    if (!p) routed = false;
    return roundCorners(a, p ?? [{ ...b }], deps.world ? { world: deps.world, radius } : {});
  };
  if (!controls?.length) return { points: leg(from, to), routed };
  const curve = [...controls];
  const out: P3[] = [];
  if (dist2(from, curve[0]!) > JOIN_DIST) out.push(...leg(from, curve[0]!));
  else curve[0] = { ...from };
  const last = curve[curve.length - 1]!;
  const tail = dist2(last, to) > 0.3;
  if (!tail) curve[curve.length - 1] = { ...to };
  const sampled = catmullRom(curve);
  if (out.length) sampled.shift();
  out.push(...sampled);
  if (tail) out.push(...leg(last, to).slice(1));
  return { points: out, routed };
}
