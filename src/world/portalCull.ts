import * as THREE from 'three';

/** Screen-space NDC clip rectangle (`x, y in [-1, 1]`). */
export interface NdcRect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** A physical bidirectional portal quad joining two rooms (door opening, glass partition, or open boundary). */
export interface PortalQuad {
  readonly rooms: readonly [string, string];
  /** Four world-space corners in perimeter order (CCW or CW, non-self-intersecting). */
  readonly verts: readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3];
  /** Precomputed world-space AABB enclosing `verts`. */
  readonly box: THREE.Box3;
  /** Returns true when sightlines can pass through this portal right now. */
  readonly passable: () => boolean;
}

/**
 * Fallback directed visibility link for `visibleFrom` pairs that share no physical cell edge
 * (e.g. non-adjacent rooms). Tested against `targetBox` in the parent room's clipped window.
 */
export interface FallbackLink {
  readonly from: string;
  readonly to: string;
  readonly targetBox: THREE.Box3;
  readonly passable?: () => boolean;
}

/** An exterior window quad in `room` that can see across open water into `targets`. */
export interface OceanWindowPortal {
  readonly room: string;
  readonly verts: readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3];
  readonly box: THREE.Box3;
  readonly targets: readonly string[];
}

/** A pooled light's world sphere used by the 1-hop light-bleed guard. */
export interface RoomLightSphere {
  readonly position: THREE.Vector3;
  readonly range: number;
  readonly active: () => boolean;
}

export interface PortalGraphInput {
  readonly portals: readonly PortalQuad[];
  readonly fallbacks?: readonly FallbackLink[];
  readonly oceanWindows?: readonly OceanWindowPortal[];
  readonly roomLights?: ReadonlyMap<string, readonly RoomLightSphere[]>;
}

/** Distance (m) within which the camera is treated as straddling a portal (never near-plane culled). */
export const STRADDLE_MARGIN = 0.45;
/** Distance (m) within which a 1-hop open/glass portal stays visible to prevent light/shadow spill pop. */
export const LIGHT_BLEED_DIST = 4.5;
/** Safety depth cap for recursive portal traversal. */
export const MAX_PORTAL_DEPTH = 12;

interface DirectedPortal {
  readonly to: string;
  readonly portal: PortalQuad;
}

const FULL_NDC: NdcRect = { minX: -1, maxX: 1, minY: -1, maxY: 1 };

/** Compute a world-space AABB enclosing four portal corners. */
export function quadBox(verts: readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3]): THREE.Box3 {
  const box = new THREE.Box3();
  for (const v of verts) box.expandByPoint(v);
  return box;
}

/** Build a 4-corner vertical quad centred at `(x, z)` facing `(dx, dz)` with given `halfWidth`, `bottom`, and `top`. */
export function makeVerticalQuad(
  x: number,
  z: number,
  dx: number,
  dz: number,
  halfWidth: number,
  bottom: number,
  top: number,
): [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3] {
  // Right tangent perpendicular to (dx, dz) in XZ.
  const tx = -dz * halfWidth;
  const tz = dx * halfWidth;
  return [
    new THREE.Vector3(x - tx, bottom, z - tz),
    new THREE.Vector3(x + tx, bottom, z + tz),
    new THREE.Vector3(x + tx, top, z + tz),
    new THREE.Vector3(x - tx, top, z - tz),
  ];
}

// 12 edge index pairs for the 8 corners of an AABB (bit 0 = X, bit 1 = Y, bit 2 = Z).
const BOX_EDGES: readonly (readonly [number, number])[] = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

/**
 * Frustum-clipped multi-hop portal visibility solver.
 * Preallocates scratch buffers so per-frame culling performs zero heap allocations in the hot path.
 */
export class PortalCuller {
  private readonly outgoing = new Map<string, DirectedPortal[]>();
  private readonly fallbacksByRoom = new Map<string, FallbackLink[]>();
  private readonly oceanWindows: readonly OceanWindowPortal[];
  private readonly roomLights: ReadonlyMap<string, readonly RoomLightSphere[]>;

  // Scratch state reused across frames.
  private readonly viewMatrix = new THREE.Matrix4();
  private readonly projMatrix = new THREE.Matrix4();
  private readonly viewProjMatrix = new THREE.Matrix4();
  private readonly frustum = new THREE.Frustum();
  private readonly scratchSphere = new THREE.Sphere();
  private readonly scratchEye = new THREE.Vector3();
  private readonly viewVerts: THREE.Vector3[] = Array.from({ length: 8 }, () => new THREE.Vector3());
  private readonly clippedVerts: THREE.Vector3[] = Array.from({ length: 8 }, () => new THREE.Vector3());
  private readonly projScratch = new THREE.Vector3();
  private readonly boxCorners: THREE.Vector3[] = Array.from({ length: 8 }, () => new THREE.Vector3());
  private readonly scratchRect: NdcRect = { minX: 0, maxX: 0, minY: 0, maxY: 0 };

  // Per-frame accumulated visible screen rect per room (only for rooms reached through frustum sightlines).
  private readonly roomRects = new Map<string, NdcRect>();
  private readonly rectPool: NdcRect[] = [];
  private rectPoolUsed = 0;

  // Depth-indexed scratch maps for merging sibling portals per (room -> nextRoom) at each recursion frame.
  private readonly levelUnions: Array<Map<string, NdcRect>> = Array.from(
    { length: MAX_PORTAL_DEPTH + 1 },
    () => new Map<string, NdcRect>(),
  );
  private readonly visitedPath = new Set<string>();
  private readonly bfsQueue: string[] = [];
  private readonly oceanSnapshot: string[] = [];

  constructor(input: PortalGraphInput) {
    for (const portal of input.portals) {
      const [a, b] = portal.rooms;
      this.addEdge(a, b, portal);
      this.addEdge(b, a, portal);
    }
    for (const fb of input.fallbacks ?? []) {
      let list = this.fallbacksByRoom.get(fb.from);
      if (!list) {
        list = [];
        this.fallbacksByRoom.set(fb.from, list);
      }
      list.push(fb);
    }
    this.oceanWindows = input.oceanWindows ?? [];
    this.roomLights = input.roomLights ?? new Map();
  }

  private addEdge(from: string, to: string, portal: PortalQuad): void {
    let list = this.outgoing.get(from);
    if (!list) {
      list = [];
      this.outgoing.set(from, list);
    }
    list.push({ to, portal });
  }

  private allocRect(minX: number, maxX: number, minY: number, maxY: number): NdcRect {
    let r = this.rectPool[this.rectPoolUsed];
    if (!r) {
      r = { minX, maxX, minY, maxY };
      this.rectPool.push(r);
    } else {
      r.minX = minX;
      r.maxX = maxX;
      r.minY = minY;
      r.maxY = maxY;
    }
    this.rectPoolUsed++;
    return r;
  }

  /**
   * Populate `visibleOut` with the IDs of every room visible from `curRoom`.
   * When `camera` is supplied, clips portals recursively against the camera frustum and narrowed NDC bounds,
   * applying the 1-hop light-bleed guard around `curRoom`.
   * When `camera` is omitted (headless tests), performs 360-degree transitive traversal over passable portals.
   */
  computeVisible(curRoom: string, visibleOut: Set<string>, camera?: THREE.Camera, eyeOverride?: THREE.Vector3): void {
    visibleOut.clear();
    this.roomRects.clear();
    this.rectPoolUsed = 0;

    if (!camera) {
      this.computeHeadlessBfs(curRoom, visibleOut);
      return;
    }

    camera.updateMatrixWorld();
    this.viewMatrix.copy(camera.matrixWorldInverse);
    this.projMatrix.copy(camera.projectionMatrix);
    this.viewProjMatrix.multiplyMatrices(this.projMatrix, this.viewMatrix);
    this.frustum.setFromProjectionMatrix(this.viewProjMatrix);

    const eye = eyeOverride ?? this.scratchEye.setFromMatrixPosition(camera.matrixWorld);
    const near = Math.max('near' in camera && typeof camera.near === 'number' ? camera.near : 0.05, 0.01);

    visibleOut.add(curRoom);
    this.roomRects.set(curRoom, this.allocRect(-1, 1, -1, 1));

    this.visitedPath.clear();
    this.visitedPath.add(curRoom);
    this.traverse(curRoom, FULL_NDC, 0, eye, near, visibleOut);
    this.visitedPath.clear();

    // 1-hop light-bleed guard: keep immediately adjacent open/glass rooms active when close enough
    // for light or shadow spill across the threshold, without recursing into their own portals.
    this.applyLightBleedGuard(curRoom, eye, visibleOut);

    // Ocean windows: only pull cross-water rooms for windows visible inside their owning room's clip rect.
    // Non-recursive: a distant room's other windows do not cascade into unrelated interiors.
    this.oceanSnapshot.length = 0;
    for (const w of this.oceanWindows) {
      const rect = this.roomRects.get(w.room);
      if (!rect) continue;
      if (this.projectQuadToNdc(w.verts, w.box, eye, near, rect, this.scratchRect)) {
        for (const t of w.targets) this.oceanSnapshot.push(t);
      }
    }
    for (const id of this.oceanSnapshot) visibleOut.add(id);
  }

  /**
   * Rooms one hop from `room` through portals that are passable right now (open or see-through doors, glass,
   * open boundaries) and passable fallback links. Room captures queue these after the camera's room.
   */
  neighbours(room: string, out: string[] = []): string[] {
    out.length = 0;
    for (const e of this.outgoing.get(room) ?? []) if (e.portal.passable() && !out.includes(e.to)) out.push(e.to);
    for (const fb of this.fallbacksByRoom.get(room) ?? []) if ((!fb.passable || fb.passable()) && !out.includes(fb.to)) out.push(fb.to);
    return out;
  }

  private computeHeadlessBfs(curRoom: string, visibleOut: Set<string>): void {
    const q = this.bfsQueue;
    q.length = 0;
    visibleOut.add(curRoom);
    q.push(curRoom);

    let head = 0;
    while (head < q.length) {
      const room = q[head++]!;
      const edges = this.outgoing.get(room);
      if (edges) {
        for (const e of edges) {
          if (visibleOut.has(e.to) || !e.portal.passable()) continue;
          visibleOut.add(e.to);
          q.push(e.to);
        }
      }
      const fbs = this.fallbacksByRoom.get(room);
      if (fbs) {
        for (const fb of fbs) {
          if (visibleOut.has(fb.to)) continue;
          if (fb.passable && !fb.passable()) continue;
          visibleOut.add(fb.to);
          q.push(fb.to);
        }
      }
    }

    this.oceanSnapshot.length = 0;
    for (const w of this.oceanWindows) {
      if (!visibleOut.has(w.room)) continue;
      for (const t of w.targets) this.oceanSnapshot.push(t);
    }
    for (const id of this.oceanSnapshot) visibleOut.add(id);
  }

  private traverse(
    roomId: string,
    clipRect: NdcRect,
    depth: number,
    eye: THREE.Vector3,
    near: number,
    visibleOut: Set<string>,
  ): void {
    if (depth >= MAX_PORTAL_DEPTH) return;
    const unions = this.levelUnions[depth]!;
    unions.clear();

    const edges = this.outgoing.get(roomId);
    if (edges) {
      for (const e of edges) {
        if (this.visitedPath.has(e.to)) continue;
        if (!e.portal.passable()) continue;
        if (!this.projectQuadToNdc(e.portal.verts, e.portal.box, eye, near, clipRect, this.scratchRect)) continue;
        this.mergeInto(unions, e.to, this.scratchRect);
      }
    }

    const fbs = this.fallbacksByRoom.get(roomId);
    if (fbs) {
      for (const fb of fbs) {
        if (this.visitedPath.has(fb.to)) continue;
        if (fb.passable && !fb.passable()) continue;
        if (!this.projectBoxToNdc(fb.targetBox, eye, near, clipRect, this.scratchRect)) continue;
        this.mergeInto(unions, fb.to, this.scratchRect);
      }
    }

    for (const [nextId, rect] of unions) {
      visibleOut.add(nextId);
      const prev = this.roomRects.get(nextId);
      if (prev) {
        // Already traversed `nextId` with a rect that completely contains this one.
        if (prev.minX <= rect.minX && prev.maxX >= rect.maxX && prev.minY <= rect.minY && prev.maxY >= rect.maxY) {
          continue;
        }
        prev.minX = Math.min(prev.minX, rect.minX);
        prev.maxX = Math.max(prev.maxX, rect.maxX);
        prev.minY = Math.min(prev.minY, rect.minY);
        prev.maxY = Math.max(prev.maxY, rect.maxY);
      } else {
        this.roomRects.set(nextId, this.allocRect(rect.minX, rect.maxX, rect.minY, rect.maxY));
      }

      this.visitedPath.add(nextId);
      this.traverse(nextId, rect, depth + 1, eye, near, visibleOut);
      this.visitedPath.delete(nextId);
    }
  }

  private mergeInto(unions: Map<string, NdcRect>, roomId: string, rect: NdcRect): void {
    const existing = unions.get(roomId);
    if (existing) {
      existing.minX = Math.min(existing.minX, rect.minX);
      existing.maxX = Math.max(existing.maxX, rect.maxX);
      existing.minY = Math.min(existing.minY, rect.minY);
      existing.maxY = Math.max(existing.maxY, rect.maxY);
    } else {
      unions.set(roomId, this.allocRect(rect.minX, rect.maxX, rect.minY, rect.maxY));
    }
  }

  private applyLightBleedGuard(curRoom: string, eye: THREE.Vector3, visibleOut: Set<string>): void {
    const edges = this.outgoing.get(curRoom);
    if (edges) {
      for (const e of edges) {
        if (visibleOut.has(e.to) || !e.portal.passable()) continue;
        if (e.portal.box.distanceToPoint(eye) <= LIGHT_BLEED_DIST || this.roomHasFrustumLight(e.to)) {
          visibleOut.add(e.to);
        }
      }
    }
    const fbs = this.fallbacksByRoom.get(curRoom);
    if (fbs) {
      for (const fb of fbs) {
        if (visibleOut.has(fb.to)) continue;
        if (fb.passable && !fb.passable()) continue;
        if (fb.targetBox.distanceToPoint(eye) <= LIGHT_BLEED_DIST || this.roomHasFrustumLight(fb.to)) {
          visibleOut.add(fb.to);
        }
      }
    }
  }

  private roomHasFrustumLight(roomId: string): boolean {
    const lights = this.roomLights.get(roomId);
    if (!lights) return false;
    for (const l of lights) {
      if (!l.active()) continue;
      this.scratchSphere.center.copy(l.position);
      this.scratchSphere.radius = l.range;
      if (this.frustum.intersectsSphere(this.scratchSphere)) return true;
    }
    return false;
  }

  /**
   * Clip a 4-vertex portal quad against the camera near plane in view space, project it to NDC,
   * and intersect its bounding rect with `parentRect`. Returns false when completely clipped out.
   */
  private projectQuadToNdc(
    verts: readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3],
    box: THREE.Box3,
    eye: THREE.Vector3,
    near: number,
    parentRect: NdcRect,
    out: NdcRect,
  ): boolean {
    if (box.distanceToPoint(eye) <= STRADDLE_MARGIN) {
      out.minX = parentRect.minX;
      out.maxX = parentRect.maxX;
      out.minY = parentRect.minY;
      out.maxY = parentRect.maxY;
      return true;
    }

    const negNear = -near;
    let anyInFront = false;
    for (let i = 0; i < 4; i++) {
      const v = this.viewVerts[i]!.copy(verts[i]!).applyMatrix4(this.viewMatrix);
      if (v.z <= negNear) anyInFront = true;
    }
    if (!anyInFront) return false;

    // Sutherland-Hodgman clip against z <= -near in camera view space.
    let count = 0;
    for (let i = 0; i < 4; i++) {
      const a = this.viewVerts[i]!;
      const b = this.viewVerts[(i + 1) & 3]!;
      const aIn = a.z <= negNear;
      const bIn = b.z <= negNear;
      if (aIn && bIn) {
        this.clippedVerts[count++]!.copy(b);
      } else if (aIn && !bIn) {
        const t = (negNear - a.z) / (b.z - a.z);
        this.clippedVerts[count++]!.lerpVectors(a, b, t);
      } else if (!aIn && bIn) {
        const t = (negNear - a.z) / (b.z - a.z);
        this.clippedVerts[count++]!.lerpVectors(a, b, t);
        this.clippedVerts[count++]!.copy(b);
      }
    }
    if (count === 0) return false;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < count; i++) {
      const p = this.projScratch.copy(this.clippedVerts[i]!).applyMatrix4(this.projMatrix);
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    const ix0 = Math.max(parentRect.minX, minX);
    const ix1 = Math.min(parentRect.maxX, maxX);
    const iy0 = Math.max(parentRect.minY, minY);
    const iy1 = Math.min(parentRect.maxY, maxY);
    if (ix0 >= ix1 || iy0 >= iy1) return false;

    out.minX = ix0;
    out.maxX = ix1;
    out.minY = iy0;
    out.maxY = iy1;
    return true;
  }

  /** Project a world-space AABB into NDC (clipping edges against `z <= -near`) and intersect with `parentRect`. */
  private projectBoxToNdc(
    box: THREE.Box3,
    eye: THREE.Vector3,
    near: number,
    parentRect: NdcRect,
    out: NdcRect,
  ): boolean {
    if (box.distanceToPoint(eye) <= STRADDLE_MARGIN) {
      out.minX = parentRect.minX;
      out.maxX = parentRect.maxX;
      out.minY = parentRect.minY;
      out.maxY = parentRect.maxY;
      return true;
    }
    if (!this.frustum.intersectsBox(box)) return false;

    const { min, max } = box;
    const negNear = -near;
    let anyInFront = false;
    for (let i = 0; i < 8; i++) {
      const c = this.boxCorners[i]!.set(
        (i & 1) ? max.x : min.x,
        (i & 2) ? max.y : min.y,
        (i & 4) ? max.z : min.z,
      ).applyMatrix4(this.viewMatrix);
      if (c.z <= negNear) anyInFront = true;
    }
    if (!anyInFront) return false;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const include = (v: THREE.Vector3): void => {
      const p = this.projScratch.copy(v).applyMatrix4(this.projMatrix);
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    };

    for (let i = 0; i < 8; i++) {
      const c = this.boxCorners[i]!;
      if (c.z <= negNear) include(c);
    }
    const edgePt = this.clippedVerts[0]!;
    for (const [ia, ib] of BOX_EDGES) {
      const a = this.boxCorners[ia]!;
      const b = this.boxCorners[ib]!;
      const aIn = a.z <= negNear;
      const bIn = b.z <= negNear;
      if (aIn !== bIn) {
        const t = (negNear - a.z) / (b.z - a.z);
        include(edgePt.lerpVectors(a, b, t));
      }
    }

    const ix0 = Math.max(parentRect.minX, minX);
    const ix1 = Math.min(parentRect.maxX, maxX);
    const iy0 = Math.max(parentRect.minY, minY);
    const iy1 = Math.min(parentRect.maxY, maxY);
    if (ix0 >= ix1 || iy0 >= iy1) return false;

    out.minX = ix0;
    out.maxX = ix1;
    out.minY = iy0;
    out.maxY = iy1;
    return true;
  }
}
