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
  UnsignedCharArray,
  VerticesArray,
  type Vector3Tuple,
} from 'recast-navigation';
import type { Aabb } from '../actors/motor.ts';

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

export const FLAG_WALK = 1;

export interface NavmeshWorkerRequest {
  boxes: Aabb[];
  doors: Array<{ box: Aabb }>;
}

export type NavmeshWorkerReply = { bytes: Uint8Array; sampleNodes: Float32Array } | { error: string };

/** Height of the bands `nodes` samples per column (m). Below the 1.5 m+ gap between a floor and a slab top. */
export const NODE_LAYER = 1.0;

/** Sample walkable points ~1 m apart over a built Detour navmesh binary (runs off-thread in navmeshWorker). */
export function sampleNavMeshNodes(bytes: Uint8Array): Float32Array {
  const raw = new UnsignedCharArray();
  raw.copy(bytes);
  const navMesh = new NavMesh();
  if (!navMesh.initSolo(raw)) {
    raw.destroy();
    return new Float32Array(0);
  }
  const query = new NavMeshQuery(navMesh);
  const coords: number[] = [];
  try {
    const tile = navMesh.getTile(0);
    const h = tile.header();
    if (h) {
      const min = { x: h.bmin(0), y: h.bmin(1), z: h.bmin(2) };
      const max = { x: h.bmax(0), y: h.bmax(1), z: h.bmax(2) };
      for (let x = min.x + 0.5; x <= max.x; x += 1) {
        for (let z = min.z + 0.5; z <= max.z; z += 1) {
          const columnY: number[] = [];
          for (let y = min.y + NODE_LAYER / 2; y < max.y + NODE_LAYER / 2; y += NODE_LAYER) {
            const r = query.findClosestPoint({ x, y, z }, { halfExtents: { x: 0.05, y: NODE_LAYER / 2, z: 0.05 } });
            if (!r.success || !r.polyRef || !r.isPointOverPoly) continue;
            if (!columnY.some((cy) => Math.abs(cy - r.point.y) < 0.3)) {
              columnY.push(r.point.y);
              coords.push(r.point.x, r.point.y, r.point.z);
            }
          }
        }
      }
    }
  } finally {
    query.destroy();
    navMesh.destroy();
  }
  return new Float32Array(coords);
}

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

/** Box triangles with outward-facing winding (Recast wants floors facing +y). */
function pushBox(b: Aabb, pos: number[], idx: number[]): void {
  const [x0, y0, z0] = b.min;
  const [x1, y1, z1] = b.max;
  const base = pos.length / 3;
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

/**
 * Voxelize `boxes` and doorway strips into a serialized Detour navmesh binary. Runs identically in
 * a Web Worker or synchronously on the main thread; caller transfers/copies the returned bytes.
 */
export function buildNavMeshBytes(boxes: readonly Aabb[], doors: ReadonlyArray<{ box: Aabb }>): Uint8Array {
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
    for (const b of boxes) markBoxArea(ctx, [b.min[0], b.min[1] - C.ch, b.min[2]], [b.max[0], b.max[1] - C.ch * 0.5, b.max[2]], Recast.RC_NULL_AREA, chf);
    if (!erodeWalkableArea(ctx, cfg.walkableRadius, chf)) throw new Error('navmesh: erode');
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
    const bytes = data.navMeshData.toTypedArray().slice();
    data.navMeshData.destroy();
    return bytes;
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
