import type { WaterBodies, WaterBody } from './water.ts';

declare module '../core/events.ts' {
  interface EventMap {
    /** A scripted camera shake (`cameraShake` step): hull groans. Water shudders with it (standing-water spec). */
    'camera:shake': { amount: number; seconds: number };
  }
}

/**
 * What disturbs standing water (standing-water spec "The water ripples from what disturbs it", overhaul-flooded-tunnel
 * D6): turns game events (footsteps, wading, shots, things landing, hull groans) and authored emitters (drips, a
 * pouring pipe) into stamps on the water bodies. Pure game-side code: the ripple simulation consumes the stamps.
 */

export type StepKind = 'walk' | 'sprint' | 'land' | 'shamble' | 'heavy' | 'jog' | 'pivot' | 'lift';

/** An authored disturbance that repeats: a drip (rare, sharp) or a pouring pipe (constant churn). */
export interface WaterEmitter {
  x: number;
  z: number;
  /** Stamps per second (on average for drips). */
  rate: number;
  radius: number;
  strength: number;
  /** Drips fire at random intervals; a pour fires steadily with jitter. */
  kind: 'drip' | 'pour';
}

/** A splash this module wants shown and heard (the splash particles and sounds take these). */
export interface SplashEvent {
  x: number;
  y: number;
  z: number;
  kind: 'step' | 'takeoff' | 'land' | 'bullet' | 'body' | 'part' | 'drip' | 'spark' | 'stomp' | 'kick';
  /** 0..1 */
  size: number;
}

const STEP_STRENGTH: Record<StepKind, number> = { pivot: 0.5, walk: 1, jog: 1.3, shamble: 1.1, sprint: 1.6, heavy: 2.2, land: 3, lift: 1.4 };
/** Metres a wading body moves between wake stamps. */
const WAKE_SPACING = 0.22;

export class WaterDisturbances {
  private readonly water: WaterBodies;
  private readonly lastStep = new Map<string, { x: number; z: number }>();
  private readonly wakeTravel = new Map<string, { x: number; z: number; acc: number }>();
  private readonly emitters: Array<WaterEmitter & { t: number }> = [];
  private readonly random: () => number;
  /** Called for every splash (particles and sound hook in here). */
  onSplash: ((s: SplashEvent) => void) | null = null;

  constructor(water: WaterBodies, random: () => number = Math.random) {
    this.water = water;
    this.random = random;
  }

  private bodyUnder(x: number, y: number, z: number): { body: WaterBody; depth: number } | null {
    const body = this.water.at(x, z);
    if (!body) return null;
    const depth = body.depthAt(x, y, z);
    return depth > 0.02 ? { body, depth } : null;
  }

  /**
   * A foot coming down (or tearing out on `'lift'`) at (x, y, z): a ring, and a short wake back to this actor's last step.
   * When `splash > 0` (rig-necromorph design D6c), the surface churns harder and throws a large `stomp` (landing) or `kick`
   * (lift) spray at any water depth.
   */
  footstep(x: number, y: number, z: number, kind: StepKind, actor: string, splash = 0): void {
    const heavy = Math.max(0, Math.min(1, splash));
    if (kind === 'lift') {
      const hit = this.bodyUnder(x, y, z);
      if (!hit || heavy <= 0) return;
      const { body, depth } = hit;
      const d = Math.min(depth, 0.9);
      body.disturb(x, z, 0.22 + d * 0.16, (0.03 + d * 0.035) * (0.6 + 0.8 * heavy));
      this.onSplash?.({ x, y: body.level, z, kind: 'kick', size: heavy });
      return;
    }
    const hit = this.bodyUnder(x, y, z);
    const last = this.lastStep.get(actor);
    this.lastStep.set(actor, { x, z });
    if (!hit) return;
    const { body, depth } = hit;
    const k = STEP_STRENGTH[kind];
    const d = Math.min(depth, 0.9);
    const boost = 1 + heavy * 1.6;
    body.disturb(x, z, (0.14 + d * 0.16) * (1 + heavy * 0.65), -(0.012 + d * 0.02) * k * boost);
    // The leg dragged through the water since the last step leaves a wake along the way.
    if (last) {
      const dist = Math.hypot(x - last.x, z - last.z);
      if (dist > 0.1 && dist < 2.5) {
        for (const u of [0.25, 0.5, 0.75]) {
          body.disturb(last.x + (x - last.x) * u, last.z + (z - last.z) * u, (0.12 + d * 0.12) * (1 + heavy * 0.5), -0.008 * k * boost * Math.max(d, 0.2));
        }
      }
    }
    if (heavy > 0) {
      this.onSplash?.({ x, y: body.level, z, kind: 'stomp', size: heavy });
    } else if (kind === 'land' || depth < 0.35) {
      this.onSplash?.({ x, y: body.level, z, kind: kind === 'land' ? 'land' : 'step', size: kind === 'land' ? 1 : 0.3 });
    }
  }

  /** A body wading continuously (Jay, every frame): stamps every WAKE_SPACING metres moved. */
  wade(actor: string, x: number, y: number, z: number): void {
    const hit = this.bodyUnder(x, y, z);
    const prev = this.wakeTravel.get(actor);
    if (!hit) {
      this.wakeTravel.delete(actor);
      return;
    }
    if (!prev) {
      this.wakeTravel.set(actor, { x, z, acc: 0 });
      return;
    }
    prev.acc += Math.hypot(x - prev.x, z - prev.z);
    prev.x = x;
    prev.z = z;
    while (prev.acc >= WAKE_SPACING) {
      prev.acc -= WAKE_SPACING;
      hit.body.disturb(x, z, 0.22, -0.01 * Math.min(1, Math.max(hit.depth, 0.15) / 0.6));
    }
  }

  /**
   * A shot along `dir` (unit) from `origin`, hitting the world after `maxDist`: where it crosses a water surface
   * first, the water takes the hit. Returns the point, or null if it never reached water.
   */
  shot(origin: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, maxDist: number): { x: number; y: number; z: number } | null {
    if (dir.y > -1e-4) return null;
    let best: { x: number; y: number; z: number; t: number; body: WaterBody } | null = null;
    for (const body of this.water.all()) {
      if (origin.y <= body.level) continue;
      const t = (body.level - origin.y) / dir.y;
      if (t < 0 || t > maxDist || (best && t >= best.t)) continue;
      const x = origin.x + dir.x * t;
      const z = origin.z + dir.z * t;
      if (body.contains(x, z)) best = { x, y: body.level, z, t, body };
    }
    if (!best) return null;
    best.body.disturb(best.x, best.z, 0.1, -0.06);
    this.onSplash?.({ x: best.x, y: best.y, z: best.z, kind: 'bullet', size: 0.4 });
    return { x: best.x, y: best.y, z: best.z };
  }

  /** Something landed at (x, y, z) (a body, a severed part, a chunk): splash if it came down in water. */
  land(x: number, y: number, z: number, size: number, kind: 'body' | 'part' = size > 0.4 ? 'body' : 'part'): void {
    const body = this.water.at(x, z);
    if (!body || y > body.level + 0.05) return;
    body.disturb(x, z, 0.2 + size * 0.5, -(0.04 + size * 0.14));
    this.onSplash?.({ x, y: body.level, z, kind, size: Math.min(1, size) });
  }

  /** A jump starting in water (the takeoff spray). */
  takeoff(x: number, y: number, z: number): void {
    const hit = this.bodyUnder(x, y, z);
    if (!hit) return;
    hit.body.disturb(x, z, 0.3, 0.03);
    this.onSplash?.({ x, y: hit.body.level, z, kind: 'takeoff', size: 0.6 });
  }

  /** A spark came down in the water: a tiny ring and the hiss (flooded-tunnel spec). */
  spark(x: number, z: number): void {
    const body = this.water.at(x, z);
    if (!body) return;
    body.disturb(x, z, 0.05, -0.006);
    this.onSplash?.({ x, y: body.level, z, kind: 'spark', size: 0.1 });
  }

  /** A scripted camera shake (hull groan): every body near the camera shudders. */
  shake(amount: number): void {
    for (const b of this.water.all()) b.shudder = Math.max(b.shudder, Math.min(1, amount * 3));
  }

  addEmitter(e: WaterEmitter): void {
    this.emitters.push({ ...e, t: this.nextGap(e) });
  }

  private nextGap(e: WaterEmitter): number {
    // Drips: exponential gaps (random arrivals). Pours: steady with 30% jitter.
    return e.kind === 'drip' ? -Math.log(1 - this.random() * 0.999) / e.rate : (1 / e.rate) * (0.85 + this.random() * 0.3);
  }

  update(dt: number): void {
    for (const e of this.emitters) {
      e.t -= dt;
      while (e.t <= 0) {
        const body = this.water.at(e.x, e.z);
        if (body) {
          const jx = e.kind === 'pour' ? (this.random() - 0.5) * e.radius : 0;
          const jz = e.kind === 'pour' ? (this.random() - 0.5) * e.radius : 0;
          body.disturb(e.x + jx, e.z + jz, e.radius, e.strength);
          if (e.kind === 'drip') this.onSplash?.({ x: e.x, y: body.level, z: e.z, kind: 'drip', size: 0.1 });
        }
        e.t += this.nextGap(e);
      }
    }
  }

  /** Checkpoint restore / new game: forget per-actor history. */
  reset(): void {
    this.lastStep.clear();
    this.wakeTravel.clear();
  }
}
