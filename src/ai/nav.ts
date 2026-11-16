import { DEFAULT_MOTOR, floorHeight, type Aabb, type ColliderQuery } from '../actors/motor.ts';

/**
 * Shared navigation for all AI (ADR-0007): a graph of walkable points linked by clear lines of
 * sight, A* over it, and direct paths when the goal is in plain view. Doors gate the edges that
 * pass through them. Pure maths over the ADR-0004 ColliderQuery, so it runs in Node tests and
 * works for both kit levels (CollisionWorld) and the hand-built demo room (BoxColliders).
 */

export interface P3 {
  x: number;
  y: number;
  z: number;
}

export interface NavDoor {
  id: string;
  /** The closed-door collider. */
  box: Aabb;
  isOpen(): boolean;
}

export interface NavEdge {
  to: number;
  cost: number;
  door: NavDoor | null;
}

/** Ray heights above the feet used for line-of-sight: shins and chest. */
const LOS_HEIGHTS = [0.45, 1.25];
const scratch: Aabb[] = [];

/** First box crossed by the segment a->b (both points in world space), or null. */
export function segmentHit(world: ColliderQuery, ax: number, ay: number, az: number, bx: number, by: number, bz: number, ignore?: (b: Aabb) => boolean): Aabb | null {
  scratch.length = 0;
  const boxes = world.query(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), scratch);
  for (const b of boxes) {
    if (ignore?.(b)) continue;
    if (segmentBox(ax, ay, az, bx, by, bz, b)) return b;
  }
  return null;
}

/** Slab test of the segment a->b against a box. */
export function segmentBox(ax: number, ay: number, az: number, bx: number, by: number, bz: number, b: Aabb): boolean {
  let t0 = 0;
  let t1 = 1;
  const o = [ax, ay, az];
  const d = [bx - ax, by - ay, bz - az];
  for (let k = 0; k < 3; k++) {
    const lo = b.min[k]!;
    const hi = b.max[k]!;
    if (Math.abs(d[k]!) < 1e-12) {
      if (o[k]! < lo || o[k]! > hi) return false;
      continue;
    }
    let ta = (lo - o[k]!) / d[k]!;
    let tb = (hi - o[k]!) / d[k]!;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * True if a body of `radius` can walk straight from a to b (feet positions): rays at shin and
 * chest height, down the middle and along both shoulders, cross nothing.
 */
export function clearWalk(world: ColliderQuery, a: P3, b: P3, radius: number, ignore?: (b: Aabb) => boolean): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  const px = len > 1e-6 ? (-dz / len) * radius : 0;
  const pz = len > 1e-6 ? (dx / len) * radius : 0;
  for (const h of LOS_HEIGHTS) {
    for (const s of radius > 0 ? [-1, 0, 1] : [0]) {
      if (segmentHit(world, a.x + px * s, a.y + h, a.z + pz * s, b.x + px * s, b.y + h, b.z + pz * s, ignore)) return false;
    }
  }
  return true;
}

export interface BuildOptions {
  world: ColliderQuery;
  nodes: P3[];
  doors?: NavDoor[];
  /** Longest edge, metres (ADR-0007: 6). */
  maxLink?: number;
  /** Clearance checked along each edge. */
  radius?: number;
}

export interface PathOptions {
  /** Body clearance for direct lines. */
  radius?: number;
}

export class NavGraph {
  readonly nodes: P3[];
  readonly edges: NavEdge[][];
  readonly doors: NavDoor[];
  readonly world: ColliderQuery;
  private readonly doorBoxes: Set<Aabb>;

  constructor(opts: BuildOptions) {
    const maxLink = opts.maxLink ?? 6;
    const radius = opts.radius ?? 0.3;
    this.world = opts.world;
    this.doors = opts.doors ?? [];
    this.doorBoxes = new Set(this.doors.map((d) => d.box));
    // Merge nodes closer than half a metre.
    const nodes: P3[] = [];
    for (const n of opts.nodes) if (!nodes.some((m) => Math.hypot(m.x - n.x, m.z - n.z) < 0.5 && Math.abs(m.y - n.y) < 0.3)) nodes.push({ x: n.x, y: n.y, z: n.z });
    this.nodes = nodes;
    this.edges = nodes.map(() => []);
    const ignoreDoors = (b: Aabb): boolean => this.doorBoxes.has(b);
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d > maxLink || Math.abs(a.y - b.y) > 0.4) continue;
        if (!clearWalk(this.world, a, b, radius, ignoreDoors)) continue;
        const door = this.doorOn(a, b);
        this.edges[i]!.push({ to: j, cost: d, door });
        this.edges[j]!.push({ to: i, cost: d, door });
      }
    }
  }

  /** The door whose closed box the segment a->b passes through, if any. */
  doorOn(a: P3, b: P3): NavDoor | null {
    for (const door of this.doors) {
      if (segmentBox(a.x, a.y + 1, a.z, b.x, b.y + 1, b.z, door.box)) return door;
    }
    return null;
  }

  edgeCount(): number {
    return this.edges.reduce((n, e) => n + e.length, 0) / 2;
  }

  /** Can a body walk straight from a to b right now (statics clear and no closed door in the way)? */
  direct(a: P3, b: P3, radius: number): boolean {
    if (!clearWalk(this.world, a, b, radius, (box) => this.doorBoxes.has(box))) return false;
    const door = this.doorOn(a, b);
    return !door || door.isOpen();
  }

  /** Nearest node that can be walked to straight from p, or -1. */
  nearest(p: P3, maxDist = 10): number {
    const order = this.nodes
      .map((n, i) => ({ i, d: Math.hypot(n.x - p.x, n.z - p.z) + Math.abs(n.y - p.y) * 2 }))
      .filter((o) => o.d <= maxDist)
      .sort((a, b) => a.d - b.d);
    for (const o of order) if (this.direct(p, this.nodes[o.i]!, 0)) return o.i;
    return -1;
  }

  /**
   * Waypoints from `from` to `to` (feet positions), ending at `to`. Straight there when the way
   * is clear; otherwise A* through the graph. Null when no route exists (e.g. a closed door).
   */
  findPath(from: P3, to: P3, opts: PathOptions = {}): P3[] | null {
    const radius = opts.radius ?? 0.25;
    if (this.direct(from, to, radius)) return [{ ...to }];
    const s = this.nearest(from);
    const g = this.nearest(to);
    if (s < 0 || g < 0) return null;
    const route = this.astar(s, g);
    if (!route) return null;
    const pts: P3[] = route.map((i) => ({ ...this.nodes[i]! }));
    pts.push({ ...to });
    return smooth(this, from, pts, radius);
  }

  private astar(s: number, g: number): number[] | null {
    const n = this.nodes.length;
    const gScore = new Float64Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const goal = this.nodes[g]!;
    const h = (i: number): number => Math.hypot(this.nodes[i]!.x - goal.x, this.nodes[i]!.z - goal.z);
    gScore[s] = 0;
    const open: Array<[number, number]> = [[h(s), s]];
    while (open.length) {
      // Small graphs: a sorted array is fast enough and simple.
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (open[k]![0] < open[bi]![0]) bi = k;
      const [, cur] = open.splice(bi, 1)[0]!;
      if (cur === g) {
        const out = [cur];
        let c = cur;
        while (came[c]! >= 0) out.push((c = came[c]!));
        return out.reverse();
      }
      if (closed[cur]) continue;
      closed[cur] = 1;
      for (const e of this.edges[cur]!) {
        if (closed[e.to]) continue;
        if (e.door && !e.door.isOpen()) continue;
        const t = gScore[cur]! + e.cost;
        if (t < gScore[e.to]!) {
          gScore[e.to] = t;
          came[e.to] = cur;
          open.push([t + h(e.to), e.to]);
        }
      }
    }
    return null;
  }
}

/** Drop waypoints that can be skipped with a clear straight line (string pulling). */
function smooth(graph: NavGraph, from: P3, pts: P3[], radius: number): P3[] {
  const out: P3[] = [];
  let cur = from;
  let i = 0;
  while (i < pts.length) {
    let far = i;
    for (let k = pts.length - 1; k > i; k--) {
      if (graph.direct(cur, pts[k]!, radius)) {
        far = k;
        break;
      }
    }
    out.push(pts[far]!);
    cur = pts[far]!;
    i = far + 1;
  }
  return out;
}

/**
 * Walkable points on a grid over an area, for worlds without authored nav nodes (the demo
 * room). A point is kept when there is a floor under it and nothing at body height around it.
 */
export function gridNodes(world: ColliderQuery, area: { minX: number; maxX: number; minZ: number; maxZ: number; maxY: number }, step = 1, radius = 0.4): P3[] {
  const out: P3[] = [];
  const cfg = DEFAULT_MOTOR;
  for (let x = area.minX; x <= area.maxX + 1e-6; x += step) {
    for (let z = area.minZ; z <= area.maxZ + 1e-6; z += step) {
      const y = floorHeight(x, z, area.maxY, cfg, world);
      if (!Number.isFinite(y)) continue;
      scratch.length = 0;
      const boxes = world.query(x - radius, z - radius, x + radius, z + radius, scratch);
      const blocked = boxes.some((b) => b.max[1] > y + cfg.stepHeight && b.min[1] < y + 1.7);
      if (!blocked) out.push({ x, y, z });
    }
  }
  return out;
}
