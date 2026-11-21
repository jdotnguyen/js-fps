import {
  allocCompactHeightfield,
  allocContourSet,
  allocHeightfield,
  allocPolyMesh,
  allocPolyMeshDetail,
  buildCompactHeightfield,
  buildContours,
  buildDistanceField,
  buildPolyMesh,
  buildPolyMeshDetail,
  buildRegions,
  calcGridSize,
  createHeightfield,
  createNavMeshData,
  createRcConfig,
  erodeWalkableArea,
  filterLedgeSpans,
  filterLowHangingWalkableObstacles,
  filterWalkableLowHeightSpans,
  freeCompactHeightfield,
  freeContourSet,
  freeHeightfield,
  freePolyMesh,
  freePolyMeshDetail,
  init,
  markBoxArea,
  markWalkableTriangles,
  NavMesh,
  NavMeshCreateParams,
  NavMeshQuery,
  rasterizeTriangles,
  Recast,
  RecastBuildContext,
  TriangleAreasArray,
  TrianglesArray,
  VerticesArray,
  type Vector3Tuple,
} from 'recast-navigation';
import type { Aabb, ColliderQuery } from '../actors/motor.ts';
import { clearWalk, segmentBox, type NavDoor, type Navigator, type P3 } from './nav.ts';

/**
 * Navmesh navigation (ADR-0028): Recast builds a walkable surface from the level's collision boxes,
 * shrunk by the agent radius so every route keeps bodies off the walls; Detour finds shortest
 * routes over it. Each doorway is its own area, so a closed door switches its polygons off.
 * Implements the same Navigator interface as the ADR-0007 navgraph, so every AI switches together.
 */

export const NAVMESH = {
  /** Voxel size across / up, metres. */
  cs: 0.1,
  ch: 0.05,
  /** Agent radius the walkable area is shrunk by: the 0.35 m body plus 5 cm. */
  radius: 0.4,
  /** Headroom needed, metres. */
  height: 1.75,
  /** Highest step, metres (the motor's step height). */
  climb: 0.35,
  /** Doorway strip marked as the door's area, metres either side of the leaf. */
  doorDepth: 0.6,
} as const;

let ready = false;
let loading: Promise<void> | null = null;

/** Load the Recast/Detour WASM once (about 50 ms). Call before building a navmesh. */
export function initNavmesh(): Promise<void> {
  loading ??= init().then(() => {
    ready = true;
  });
  return loading;
}

/** True once initNavmesh() has finished. */
export function navmeshReady(): boolean {
  return ready;
}

export interface NavmeshBuildOptions {
  world: ColliderQuery;
  /** Every solid box (statics and door frames). Door leaves are given separately. */
  boxes: readonly Aabb[];
  doors?: NavDoor[];
}

/** Box triangles with outward-facing winding (Recast wants floors facing +y). */
function pushBox(b: Aabb, pos: number[], idx: number[]): void {
  const [x0, y0, z0] = b.min;
  const [x1, y1, z1] = b.max;
  const base = pos.length / 3;
  // 0..3 bottom, 4..7 top: (x0,z0) (x1,z0) (x1,z1) (x0,z1)
  pos.push(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1);
  const quads: Array<[number, number, number, number, [number, number, number]]> = [
    [4, 5, 6, 7, [0, 1, 0]],
    [0, 1, 2, 3, [0, -1, 0]],
    [0, 1, 5, 4, [0, 0, -1]],
    [3, 2, 6, 7, [0, 0, 1]],
    [0, 3, 7, 4, [-1, 0, 0]],
    [1, 2, 6, 5, [1, 0, 0]],
  ];
  const v = (i: number): [number, number, number] => [pos[(base + i) * 3]!, pos[(base + i) * 3 + 1]!, pos[(base + i) * 3 + 2]!];
  for (const [a, bq, c, d, n] of quads) {
    const pa = v(a);
    const pb = v(bq);
    const pc = v(c);
    const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const cr = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    const ok = cr[0]! * n[0] + cr[1]! * n[1] + cr[2]! * n[2] > 0;
    if (ok) idx.push(base + a, base + bq, base + c, base + a, base + c, base + d);
    else idx.push(base + a, base + c, base + bq, base + a, base + d, base + c);
  }
}

function buildNavMesh(boxes: readonly Aabb[], doors: NavDoor[]): NavMesh {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const b of boxes) pushBox(b, pos, idx);
  const bmin: Vector3Tuple = [Infinity, Infinity, Infinity];
  const bmax: Vector3Tuple = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3)
    for (let k = 0; k < 3; k++) {
      bmin[k] = Math.min(bmin[k]!, pos[i + k]!);
      bmax[k] = Math.max(bmax[k]!, pos[i + k]!);
    }
  const C = NAVMESH;
  const cfg = createRcConfig({
    cs: C.cs,
    ch: C.ch,
    walkableSlopeAngle: 45,
    walkableHeight: Math.ceil(C.height / C.ch),
    walkableClimb: Math.floor(C.climb / C.ch),
    walkableRadius: Math.ceil(C.radius / C.cs),
    maxEdgeLen: Math.round(8 / C.cs),
    maxSimplificationError: 1.1,
    minRegionArea: 8,
    mergeRegionArea: 20,
    maxVertsPerPoly: 6,
    detailSampleDist: 6,
    detailSampleMaxError: 1,
  });
  cfg.minRegionArea = cfg.minRegionArea * cfg.minRegionArea;
  cfg.mergeRegionArea = cfg.mergeRegionArea * cfg.mergeRegionArea;
  cfg.detailSampleDist = cfg.cs * cfg.detailSampleDist;
  cfg.detailSampleMaxError = cfg.ch * cfg.detailSampleMaxError;
  const grid = calcGridSize(bmin, bmax, cfg.cs);
  cfg.width = grid.width;
  cfg.height = grid.height;

  const ctx = new RecastBuildContext();
  const hf = allocHeightfield();
  const chf = allocCompactHeightfield();
  const cset = allocContourSet();
  const pmesh = allocPolyMesh();
  const dmesh = allocPolyMeshDetail();
  const verts = new VerticesArray();
  const tris = new TrianglesArray();
  const areas = new TriangleAreasArray();
  try {
    verts.copy(pos);
    tris.copy(idx);
    const nt = idx.length / 3;
    if (!createHeightfield(ctx, hf, cfg.width, cfg.height, bmin, bmax, cfg.cs, cfg.ch)) throw new Error('navmesh: heightfield');
    areas.resize(nt);
    markWalkableTriangles(ctx, cfg.walkableSlopeAngle, verts, idx.length, tris, nt, areas);
    if (!rasterizeTriangles(ctx, verts, idx.length, tris, areas, nt, hf, cfg.walkableClimb)) throw new Error('navmesh: rasterize');
    filterLowHangingWalkableObstacles(ctx, cfg.walkableClimb, hf);
    filterLedgeSpans(ctx, cfg.walkableHeight, cfg.walkableClimb, hf);
    filterWalkableLowHeightSpans(ctx, cfg.walkableHeight, hf);
    if (!buildCompactHeightfield(ctx, cfg.walkableHeight, cfg.walkableClimb, hf, chf)) throw new Error('navmesh: compact');
    // Floor inside a solid box (under a wall, a counter, a crate) is not floor: boxes are rasterised
    // as shells, so clear any surface strictly inside each one (its own top stays walkable).
    for (const b of boxes) markBoxArea(ctx, [b.min[0], b.min[1] - C.ch, b.min[2]], [b.max[0], b.max[1] - C.ch * 0.5, b.max[2]], Recast.RC_NULL_AREA, chf);
    if (!erodeWalkableArea(ctx, cfg.walkableRadius, chf)) throw new Error('navmesh: erode');
    // Each doorway its own area (1 + door index), so its polygons can be switched off when closed.
    doors.forEach((d, i) => {
      const b = d.box;
      const alongX = b.max[0] - b.min[0] >= b.max[2] - b.min[2];
      const dx = alongX ? 0 : C.doorDepth;
      const dz = alongX ? C.doorDepth : 0;
      markBoxArea(ctx, [b.min[0] - dx, b.min[1] - 0.3, b.min[2] - dz], [b.max[0] + dx, b.min[1] + 0.6, b.max[2] + dz], 1 + i, chf);
    });
    if (!buildDistanceField(ctx, chf)) throw new Error('navmesh: distance field');
    if (!buildRegions(ctx, chf, 0, cfg.minRegionArea, cfg.mergeRegionArea)) throw new Error('navmesh: regions');
    if (!buildContours(ctx, chf, cfg.maxSimplificationError, cfg.maxEdgeLen, cset, Recast.RC_CONTOUR_TESS_WALL_EDGES)) throw new Error('navmesh: contours');
    if (!buildPolyMesh(ctx, cset, cfg.maxVertsPerPoly, pmesh)) throw new Error('navmesh: poly mesh');
    if (!buildPolyMeshDetail(ctx, pmesh, chf, cfg.detailSampleDist, cfg.detailSampleMaxError, dmesh)) throw new Error('navmesh: detail mesh');
    for (let i = 0; i < pmesh.npolys(); i++) {
      if (pmesh.areas(i) === Recast.RC_WALKABLE_AREA) pmesh.setAreas(i, 0);
      pmesh.setFlags(i, FLAG_WALK);
    }
    const params = new NavMeshCreateParams();
    params.setPolyMeshCreateParams(pmesh);
    params.setPolyMeshDetailCreateParams(dmesh);
    params.setWalkableHeight(cfg.walkableHeight * cfg.ch);
    params.setWalkableRadius(cfg.walkableRadius * cfg.cs);
    params.setWalkableClimb(cfg.walkableClimb * cfg.ch);
    params.setCellSize(cfg.cs);
    params.setCellHeight(cfg.ch);
    params.setBuildBvTree(true);
    const data = createNavMeshData(params);
    params.destroy();
    if (!data.success) throw new Error('navmesh: detour data');
    const navMesh = new NavMesh();
    if (!navMesh.initSolo(data.navMeshData)) throw new Error('navmesh: init');
    return navMesh;
  } finally {
    verts.destroy();
    tris.destroy();
    areas.destroy();
    freeHeightfield(hf);
    freeCompactHeightfield(chf);
    freeContourSet(cset);
    freePolyMesh(pmesh);
    freePolyMeshDetail(dmesh);
    ctx.destroy();
  }
}

const FLAG_WALK = 1;
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
    if (!ready) throw new Error('navmesh: call initNavmesh() first');
    this.world = opts.world;
    this.doors = opts.doors ?? [];
    this.doorBoxes = new Set(this.doors.map((d) => d.box));
    this.navMesh = buildNavMesh(opts.boxes, this.doors);
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
      // One query spanning the whole height returns a single poly per column, usually a ceiling-slab top, which
      // hid the floors from `reachable()`. Query in NODE_LAYER bands instead so every walkable level is kept.
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

  destroy(): void {
    this.query.destroy();
    this.navMesh.destroy();
  }
}
