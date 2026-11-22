import { NavMesh, NavMeshQuery, UnsignedCharArray } from 'recast-navigation';
import type { Aabb, ColliderQuery } from '../actors/motor.ts';
import { clearWalk, segmentBox, type NavDoor, type Navigator, type P3 } from './nav.ts';
import {
  buildNavMeshBytes,
  FLAG_WALK,
  initNavmesh,
  NAVMESH,
  navmeshReady,
  type NavmeshWorkerReply,
  type NavmeshWorkerRequest,
} from './navmeshBuild.ts';

export { buildNavMeshBytes, initNavmesh, NAVMESH, navmeshReady, type NavmeshWorkerReply, type NavmeshWorkerRequest };

export interface NavmeshBuildOptions {
  world: ColliderQuery;
  /** Every solid box (statics and door frames). Door leaves are given separately. */
  boxes: readonly Aabb[];
  doors?: NavDoor[];
  /** Optional pre-built Detour binary (e.g. from navmeshWorker) to skip main-thread voxelization. */
  bytes?: Uint8Array;
  /** Optional pre-sampled walkable points (flat x,y,z Float32Array from navmeshWorker) to avoid a frame-1 stall. */
  sampleNodes?: Float32Array;
}

function navMeshFromBytes(bytes: Uint8Array): NavMesh {
  const raw = new UnsignedCharArray();
  raw.copy(bytes);
  const navMesh = new NavMesh();
  if (!navMesh.initSolo(raw)) {
    raw.destroy();
    throw new Error('navmesh: init');
  }
  return navMesh;
}

function buildNavMesh(boxes: readonly Aabb[], doors: NavDoor[]): NavMesh {
  return navMeshFromBytes(buildNavMeshBytes(boxes, doors));
}

/** Search box for snapping a point onto the mesh. */
const SNAP = { x: 1.2, y: 0.6, z: 1.2 };
/** A goal this close to the walkable floor ends the route exactly (an anchor by a counter sits inside the eroded edge). */
const END_SLACK = 0.45;
/** Furthest a goal may be off the walkable floor and still be walked to (nooks, furniture), metres. */
const GOAL_SNAP = 1.6;
/** Height of the bands `nodes` samples per column (m). Below the 1.5 m+ gap between a floor and a slab top. */
const NODE_LAYER = 1.0;

export class NavMeshNav implements Navigator {
  readonly world: ColliderQuery;
  readonly doors: NavDoor[];
  readonly navMesh: NavMesh;
  readonly query: NavMeshQuery;
  private readonly doorBoxes: Set<Aabb>;
  /** Polygons of each door's strip, by door index. */
  private readonly doorPolys: number[][];
  private readonly doorOpen: boolean[];
  private readonly polyCount: number;
  private sampleNodes: P3[] | null = null;

  constructor(opts: NavmeshBuildOptions) {
    if (!navmeshReady()) throw new Error('navmesh: call initNavmesh() first');
    this.world = opts.world;
    this.doors = opts.doors ?? [];
    this.doorBoxes = new Set(this.doors.map((d) => d.box));
    this.navMesh = opts.bytes ? navMeshFromBytes(opts.bytes) : buildNavMesh(opts.boxes, this.doors);
    this.query = new NavMeshQuery(this.navMesh);
    this.query.defaultQueryHalfExtents = { ...SNAP };
    const tile = this.navMesh.getTile(0);
    const base = this.navMesh.getPolyRefBase(tile);
    this.polyCount = tile.header()?.polyCount() ?? 0;
    this.doorPolys = this.doors.map(() => []);
    for (let i = 0; i < this.polyCount; i++) {
      const area = tile.polys(i).areaAndType() & 0x3f;
      if (area >= 1 && area <= this.doors.length) this.doorPolys[area - 1]!.push(base + i);
    }
    this.doorOpen = this.doors.map(() => true);
    if (opts.sampleNodes) {
      const a = opts.sampleNodes;
      const out: P3[] = [];
      for (let i = 0; i + 2 < a.length; i += 3) out.push({ x: a[i]!, y: a[i + 1]!, z: a[i + 2]! });
      this.sampleNodes = out;
    }
  }

  /** Polygons in the mesh (log line and debug). */
  edgeCount(): number {
    return this.polyCount;
  }

  /** Doors whose strip has no polygons (blocked or not on the mesh): for tests and warnings. */
  unmarkedDoors(): string[] {
    return this.doors.filter((_, i) => this.doorPolys[i]!.length === 0).map((d) => d.id);
  }

  /** Switch closed doors' polygons off (cheap: only changed doors are touched). */
  private syncDoors(): void {
    for (let i = 0; i < this.doors.length; i++) {
      const open = this.doors[i]!.isOpen();
      if (open === this.doorOpen[i]) continue;
      this.doorOpen[i] = open;
      for (const ref of this.doorPolys[i]!) this.navMesh.setPolyFlags(ref, open ? FLAG_WALK : 0);
    }
  }

  /**
   * Waypoints from `from` to `to` (feet positions); null when there is no route (e.g. through a
   * closed door). A goal off the walkable floor (an anchor in a nook, against or inside furniture)
   * is routed to the nearest walkable spot, plus a last straight step towards it when that line is
   * clear, so the walker ends as close as its body allows. `radius` is accepted for the navgraph
   * interface; the mesh is already shrunk by the agent radius.
   */
  findPath(from: P3, to: P3, _opts: { radius?: number } = {}): P3[] | null {
    this.syncDoors();
    const goal = this.snap(to, GOAL_SNAP);
    if (!goal) return null;
    const r = this.query.computePath(from, goal, { halfExtents: SNAP });
    if (!r.success || r.path.length === 0) return null;
    const last = r.path[r.path.length - 1]!;
    // Detour returns a partial route towards an unreachable goal: that is no route.
    if (Math.hypot(last.x - goal.x, last.z - goal.z) > 0.3) return null;
    const out: P3[] = r.path.slice(1).map((p) => ({ x: p.x, y: p.y, z: p.z }));
    if (!out.length) out.push({ ...goal });
    const off = Math.hypot(goal.x - to.x, goal.z - to.z);
    if (off < END_SLACK) out[out.length - 1] = { x: to.x, y: to.y, z: to.z };
    else if (off <= GOAL_SNAP && clearWalk(this.world, goal, to, 0, (box) => this.doorBoxes.has(box))) out.push({ x: to.x, y: to.y, z: to.z });
    return out;
  }

  /** Nearest walkable point within `reach` metres across of p. */
  private snap(p: P3, reach: number): P3 | null {
    const r = this.query.findClosestPoint(p, { halfExtents: { x: reach, y: SNAP.y, z: reach } });
    return r.success && r.polyRef ? { x: r.point.x, y: r.point.y, z: r.point.z } : null;
  }

  /** Can a body walk straight from a to b right now (statics clear and no closed door in the way)? */
  direct(a: P3, b: P3, radius: number): boolean {
    if (!clearWalk(this.world, a, b, radius, (box) => this.doorBoxes.has(box))) return false;
    for (const door of this.doors) if (!door.isOpen() && segmentBox(a.x, a.y + 1, a.z, b.x, b.y + 1, b.z, door.box)) return false;
    return true;
  }

  /** Closest point on the walkable mesh to p within `reach` metres across, or null. */
  closest(p: P3, reach: number = SNAP.x): P3 | null {
    return this.snap(p, reach);
  }

  /** Walkable points about a metre apart over the mesh, one per walkable level in each column (squad spot search,
   *  enemy spawn search, the director's reachability check). */
  get nodes(): P3[] {
    if (this.sampleNodes) return this.sampleNodes;
    const out: P3[] = [];
    const tile = this.navMesh.getTile(0);
    const h = tile.header();
    if (h) {
      const min = { x: h.bmin(0), y: h.bmin(1), z: h.bmin(2) };
      const max = { x: h.bmax(0), y: h.bmax(1), z: h.bmax(2) };
      for (let x = min.x + 0.5; x <= max.x; x += 1)
        for (let z = min.z + 0.5; z <= max.z; z += 1) {
          const column: P3[] = [];
          for (let y = min.y + NODE_LAYER / 2; y < max.y + NODE_LAYER / 2; y += NODE_LAYER) {
            const r = this.query.findClosestPoint({ x, y, z }, { halfExtents: { x: 0.05, y: NODE_LAYER / 2, z: 0.05 } });
            if (!r.success || !r.polyRef || !r.isPointOverPoly) continue;
            const p = { x: r.point.x, y: r.point.y, z: r.point.z };
            if (!column.some((c) => Math.abs(c.y - p.y) < 0.3)) column.push(p);
          }
          out.push(...column);
        }
    }
    this.sampleNodes = out;
    return out;
  }

  /**
   * Build the Detour navmesh binary inside a Web Worker when available so loading stays smooth,
   * falling back to synchronous main-thread build in Node/tests or if the worker fails.
   */
  static async buildAsync(opts: NavmeshBuildOptions): Promise<NavMeshNav> {
    if (typeof Worker !== 'undefined' && !opts.bytes) {
      try {
        const req: NavmeshWorkerRequest = {
          boxes: opts.boxes.map((b) => ({ min: [b.min[0], b.min[1], b.min[2]], max: [b.max[0], b.max[1], b.max[2]] })),
          doors: (opts.doors ?? []).map((d) => ({ box: { min: [d.box.min[0], d.box.min[1], d.box.min[2]], max: [d.box.max[0], d.box.max[1], d.box.max[2]] } })),
        };
        const [result] = await Promise.all([
          new Promise<{ bytes: Uint8Array; sampleNodes: Float32Array }>((resolve, reject) => {
            const worker = new Worker(new URL('./navmeshWorker.ts', import.meta.url), { type: 'module' });
            worker.onmessage = (e: MessageEvent<NavmeshWorkerReply>): void => {
              worker.terminate();
              if ('error' in e.data) reject(new Error(e.data.error));
              else resolve({ bytes: e.data.bytes, sampleNodes: e.data.sampleNodes });
            };
            worker.onerror = (e): void => {
              worker.terminate();
              reject(new Error(e.message || 'navmesh worker error'));
            };
            worker.postMessage(req);
          }),
          initNavmesh(),
        ]);
        return new NavMeshNav({ ...opts, bytes: result.bytes, sampleNodes: result.sampleNodes });
      } catch (err) {
        console.warn('[nav] worker build failed; falling back to main thread', err);
      }
    }
    await initNavmesh();
    return new NavMeshNav(opts);
  }

  destroy(): void {
    this.query.destroy();
    this.navMesh.destroy();
  }
}
