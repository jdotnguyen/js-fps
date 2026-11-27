/**
 * A kill beat's route across the floor (voss-death-scene D3, infection-kills "A clip beat can carry the victim along a
 * route"): where she is and which way she faces at each moment of the beat. Pure geometry and timing, in world x/z.
 *
 * The path is a centripetal Catmull-Rom curve from where the beat finds her through each mark. She reaches every mark at
 * its time. Along each leg she goes at a steady cruise speed, the way a walk does, with short smooth ramps at its ends
 * (`EASE_S`): up from rest at a stop (the start, a mark she stays on) and down to rest at one (the last mark), or from the
 * speed she passes a mark at (the average of the cruises either side) to this leg's own. A plain ease over the whole leg
 * would peak at 1.5 times its average speed, outrunning the take her feet step to.
 */

/** How long she takes to get going from a stop, or to come to one (s; at most a third of the leg). */
export const EASE_S = 0.4;

export interface RoutePoint {
  x: number;
  z: number;
}

/** Which way she faces at a mark: a yaw (radians; 0 faces -Z), or a point she turns to. */
export type RouteFace = { yaw: number } | { at: RoutePoint };

export interface RouteKnot extends RoutePoint {
  /** Seconds into the beat she reaches it. */
  t: number;
  face?: RouteFace | undefined;
}

/** One leg of the route: from one knot to the next, how far along the path and over what time. */
export interface RouteLeg {
  from: number;
  to: number;
  t0: number;
  t1: number;
  length: number;
  /** Her steady speed along the leg, between its ramps (m/s). */
  speed: number;
}

/** The integral of smoothstep from 0 to x (x in 0..1). */
const smoothArea = (x: number): number => x * x * x - (x * x * x * x) / 2;

/** Points per curve span in the arc-length tables. */
const SAMPLES = 32;
/** Marks closer than this (m) are the same spot: she stops there. */
const SAME_SPOT = 0.01;
/** The yaw she turns to as she nears a mark with a facing, over the last share of the leg (and away from it over the first). */
const FACE_IN = 0.45;
const FACE_OUT = 0.35;

interface Span {
  /** Catmull-Rom control points and knot parameters (Barry-Goldman form). */
  p: [RoutePoint, RoutePoint, RoutePoint, RoutePoint];
  k: [number, number, number, number];
  /** Cumulative arc length at each sample (SAMPLES + 1 entries), and the total. */
  arc: Float64Array;
  length: number;
  /** Leg end speeds (m/s), the ramps at each end (s), the cruise between them (m/s), and the leg's times. */
  v0: number;
  v1: number;
  a: number;
  b: number;
  c: number;
  t0: number;
  t1: number;
}

const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
const smoothstep = (e0: number, e1: number, x: number): number => {
  const u = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return u * u * (3 - 2 * u);
};

/** Shortest turn from `a` to `b`, by `u`. */
export function lerpYaw(a: number, b: number, u: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * u;
}

/** The yaw that faces along (dx, dz) (the body faces -Z). */
export function yawAlong(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

function crPoint(s: Span, u: number, out: RoutePoint): RoutePoint {
  const [p0, p1, p2, p3] = s.p;
  const [k0, k1, k2, k3] = s.k;
  const t = lerp(k1, k2, u);
  const blend = (a: RoutePoint, b: RoutePoint, ka: number, kb: number): RoutePoint => {
    const w = kb - ka < 1e-9 ? 0 : (t - ka) / (kb - ka);
    return { x: lerp(a.x, b.x, w), z: lerp(a.z, b.z, w) };
  };
  const a1 = blend(p0, p1, k0, k1);
  const a2 = blend(p1, p2, k1, k2);
  const a3 = blend(p2, p3, k2, k3);
  const b1 = blend(a1, a2, k0, k2);
  const b2 = blend(a2, a3, k1, k3);
  const c = blend(b1, b2, k1, k2);
  out.x = c.x;
  out.z = c.z;
  return out;
}

export class KillRoute {
  private readonly knots: RouteKnot[];
  private readonly spans: Span[] = [];
  private readonly startYaw: number;
  /** The legs, in order (the speed check, tests). */
  readonly legs: RouteLeg[] = [];

  /** `start` is where the beat finds her (beat time 0) and `startYaw` her heading then; `marks` in time order, each after 0. */
  constructor(start: RoutePoint, startYaw: number, marks: readonly RouteKnot[]) {
    this.startYaw = startYaw;
    this.knots = [{ x: start.x, z: start.z, t: 0 }, ...marks.map((m) => ({ ...m }))];
    const n = this.knots.length;
    const same = (i: number, j: number): boolean => Math.hypot(this.knots[i]!.x - this.knots[j]!.x, this.knots[i]!.z - this.knots[j]!.z) < SAME_SPOT;
    // A stop: the start, the last mark, and a mark she stays on (the next is the same spot) or arrives at having stood.
    const stop = (i: number): boolean => i === 0 || i === n - 1 || same(i, i + 1) || same(i - 1, i);
    const pt = (i: number): RoutePoint => this.knots[Math.max(0, Math.min(n - 1, i))]!;
    for (let i = 0; i + 1 < n; i++) {
      const p1 = pt(i);
      const p2 = pt(i + 1);
      // The neighbours shape the curve through a mark she passes; at a stop the curve leaves (or arrives) straight.
      const p0 = stop(i) ? { x: 2 * p1.x - p2.x, z: 2 * p1.z - p2.z } : pt(i - 1);
      const p3 = stop(i + 1) ? { x: 2 * p2.x - p1.x, z: 2 * p2.z - p1.z } : pt(i + 2);
      const knot = (a: RoutePoint, b: RoutePoint): number => Math.max(1e-4, Math.sqrt(Math.hypot(b.x - a.x, b.z - a.z)));
      const k0 = 0;
      const k1 = k0 + knot(p0, p1);
      const k2 = k1 + knot(p1, p2);
      const k3 = k2 + knot(p2, p3);
      const span: Span = { p: [p0, p1, p2, p3], k: [k0, k1, k2, k3], arc: new Float64Array(SAMPLES + 1), length: 0, v0: 0, v1: 0, a: 0, b: 0, c: 0, t0: this.knots[i]!.t, t1: this.knots[i + 1]!.t };
      if (same(i, i + 1)) {
        span.length = 0;
      } else {
        const a = { x: 0, z: 0 };
        const b = { x: 0, z: 0 };
        crPoint(span, 0, a);
        for (let s = 1; s <= SAMPLES; s++) {
          crPoint(span, s / SAMPLES, b);
          span.arc[s] = span.arc[s - 1]! + Math.hypot(b.x - a.x, b.z - a.z);
          a.x = b.x;
          a.z = b.z;
        }
        span.length = span.arc[SAMPLES]!;
      }
      this.spans.push(span);
    }
    // Ramps at every end that is not a hold; the speed at a mark she passes is the average of the cruises either side
    // (settled over a few passes, since each cruise depends on its ends).
    this.spans.forEach((s) => {
      const ease = s.length > 0 ? Math.min(EASE_S, (s.t1 - s.t0) / 3) : 0;
      s.a = ease;
      s.b = ease;
      s.c = s.length / Math.max(1e-6, s.t1 - s.t0);
    });
    for (let pass = 0; pass < 6; pass++) {
      for (let i = 1; i < n - 1; i++) {
        if (stop(i)) continue;
        const v = (this.spans[i - 1]!.c + this.spans[i]!.c) / 2;
        this.spans[i - 1]!.v1 = v;
        this.spans[i]!.v0 = v;
      }
      for (const s of this.spans) {
        const dt = s.t1 - s.t0;
        s.c = Math.max(0, (s.length - (s.a * s.v0) / 2 - (s.b * s.v1) / 2) / Math.max(1e-6, dt - s.a / 2 - s.b / 2));
      }
    }
    this.spans.forEach((s, i) => this.legs.push({ from: i, to: i + 1, t0: s.t0, t1: s.t1, length: s.length, speed: s.c }));
  }

  /** The last mark (where a skipped or restored kill puts her). */
  get end(): RouteKnot {
    return this.knots[this.knots.length - 1]!;
  }

  /** Total length of the path (m). */
  get length(): number {
    return this.spans.reduce((sum, s) => sum + s.length, 0);
  }

  /** Where she is `t` s into the beat (on the start before it, on the last mark after it). */
  pointAt(t: number, out: RoutePoint = { x: 0, z: 0 }): RoutePoint {
    const { span, u } = this.locate(t);
    if (!span) {
      const k = t <= 0 ? this.knots[0]! : this.end;
      out.x = k.x;
      out.z = k.z;
      return out;
    }
    return crPoint(span, this.paramAt(span, this.distanceAt(span, u)), out);
  }

  /** How fast she goes along the path at `t` (m/s). */
  speedAt(t: number): number {
    const { span, u } = this.locate(t);
    if (!span || span.length <= 0) return 0;
    const dt = span.t1 - span.t0;
    const h = Math.min(1e-3, dt / 4);
    const t0 = Math.max(0, u * dt - h);
    const t1 = Math.min(dt, u * dt + h);
    return ((this.distanceAt(span, t1 / dt) - this.distanceAt(span, t0 / dt)) / Math.max(1e-9, t1 - t0));
  }

  /**
   * The yaw she should face `t` s into the beat, given where she is now (`at`, for a facing toward a point): along the
   * path while she moves, turning to a mark's facing as she reaches it and holding it while she stays.
   */
  yawAt(t: number, at: RoutePoint, current: number): number {
    const { span, u, index } = this.locate(t);
    const faceOf = (k: RouteKnot | undefined): number | null => {
      const f = k?.face;
      if (!f) return null;
      if ('yaw' in f) return f.yaw;
      const dx = f.at.x - at.x;
      const dz = f.at.z - at.z;
      return Math.hypot(dx, dz) < 1e-3 ? null : yawAlong(dx, dz);
    };
    if (!span || span.length <= 0) {
      // Standing: on a mark (its facing, else as she arrived), or at the start before she moves.
      const k = !span ? (t <= 0 ? this.knots[0] : this.end) : this.knots[index];
      return faceOf(k) ?? (t <= 0 && !span ? this.startYaw : this.travelYaw(index, current));
    }
    let yaw = this.tangentYaw(span, u) ?? current;
    const leave = faceOf(this.knots[index]);
    if (leave !== null) yaw = lerpYaw(leave, yaw, smoothstep(0, FACE_OUT, u));
    const arrive = faceOf(this.knots[index + 1]);
    if (arrive !== null) yaw = lerpYaw(yaw, arrive, smoothstep(1 - FACE_IN, 1, u));
    return yaw;
  }

  /** The way she was last travelling before knot `index` (for a hold with no facing). */
  private travelYaw(index: number, fallback: number): number {
    for (let i = Math.min(index, this.spans.length) - 1; i >= 0; i--) {
      const s = this.spans[i]!;
      if (s.length > 0) return this.tangentYaw(s, 1) ?? fallback;
    }
    return index === 0 ? this.startYaw : fallback;
  }

  private tangentYaw(s: Span, u: number): number | null {
    const a = crPoint(s, Math.max(0, u - 0.02), { x: 0, z: 0 });
    const b = crPoint(s, Math.min(1, u + 0.02), { x: 0, z: 0 });
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    return Math.hypot(dx, dz) < 1e-6 ? null : yawAlong(dx, dz);
  }

  private locate(t: number): { span: Span | null; u: number; index: number } {
    if (t <= 0 || this.spans.length === 0) return { span: null, u: 0, index: 0 };
    for (let i = 0; i < this.spans.length; i++) {
      const s = this.spans[i]!;
      if (t <= s.t1) return { span: s, u: (t - s.t0) / Math.max(1e-6, s.t1 - s.t0), index: i };
    }
    return { span: null, u: 1, index: this.knots.length - 1 };
  }

  /**
   * Distance along a leg `tau` s into it, unscaled: a ramp from `v0` to the cruise over `a`, the cruise, and a ramp to
   * `v1` over the last `b`, each ramp a smoothstep in speed.
   */
  private static rawDistance(s: Span, tau: number): number {
    const dt = s.t1 - s.t0;
    const { a, b, c, v0, v1 } = s;
    if (tau <= a) return a > 0 ? v0 * tau + (c - v0) * a * smoothArea(tau / a) : 0;
    const atA = v0 * a + ((c - v0) * a) / 2;
    const endStart = dt - b;
    if (tau <= endStart) return atA + c * (tau - a);
    const atB = atA + c * (endStart - a);
    const x = Math.min(tau, dt) - endStart;
    return atB + c * x + (v1 - c) * b * smoothArea(x / b);
  }

  /** Distance along a leg at progress `u` of its time, scaled so the leg ends exactly at its length. */
  private distanceAt(s: Span, u: number): number {
    if (s.length <= 0) return 0;
    const dt = s.t1 - s.t0;
    const total = KillRoute.rawDistance(s, dt);
    const d = KillRoute.rawDistance(s, u * dt) * (total > 1e-9 ? s.length / total : 0);
    return Math.min(s.length, Math.max(0, d));
  }

  /** The curve parameter at a distance along a leg (from its arc-length table). */
  private paramAt(s: Span, d: number): number {
    if (s.length <= 0) return 0;
    const arc = s.arc;
    let lo = 0;
    let hi = SAMPLES;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (arc[mid]! < d) lo = mid;
      else hi = mid;
    }
    const a = arc[lo]!;
    const b = arc[hi]!;
    return (lo + (b - a > 1e-9 ? (d - a) / (b - a) : 0)) / SAMPLES;
  }
}
