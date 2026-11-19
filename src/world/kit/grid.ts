/**
 * Strict modular grid occupancy & zero-overlap guard (docs/modular-grid-standard.md).
 * Ensures door edges and wall tiles never overlap on the same cell edge, and
 * duplicate same-facing wall tiles are caught and skipped before geometry merges.
 */

export type GridCell = readonly [number, number, number];

function rotStep(rot: number): 0 | 90 | 180 | 270 {
  const r = (((rot % 360) + 360) % 360);
  if (r === 0 || r === 90 || r === 180 || r === 270) return r;
  return (Math.round(r / 90) * 90) % 360 as 0 | 90 | 180 | 270;
}

/** Unit [dx, dz] direction of a piece's -Z edge after rotating by `rot` degrees around Y. */
export function edgeDir(rot: number): [number, number] {
  const r = rotStep(rot);
  if (r === 0) return [0, -1];
  if (r === 90) return [-1, 0];
  if (r === 180) return [0, 1];
  return [1, 0];
}

/** Shared cell-edge key (same for both sides of a boundary) in half-cell integer coordinates. */
export function sharedEdgeKey(cell: GridCell, rot: number): string {
  const [dx, dz] = edgeDir(rot);
  return `${cell[0] * 2 + dx},${cell[1]},${cell[2] * 2 + dz}`;
}

/** Directed cell-edge key (unique per cell + inward-facing wall side). */
export function directedEdgeKey(cell: GridCell, rot: number): string {
  return `${cell[0]},${cell[1]},${cell[2]}:${rotStep(rot)}`;
}

export interface ClaimResult {
  ok: boolean;
  reason?: string;
}

export class GridOccupancy {
  private readonly doors = new Map<string, string>();
  private readonly walls = new Map<string, string>();

  /** Register a door frame straddling `cell`'s rotated -Z edge. */
  claimDoor(doorId: string, cell: GridCell, rot: number): ClaimResult {
    const edge = sharedEdgeKey(cell, rot);
    const prev = this.doors.get(edge);
    if (prev) return { ok: false, reason: `door "${doorId}" overlaps door "${prev}" at edge ${edge}` };
    this.doors.set(edge, doorId);
    return { ok: true };
  }

  /**
   * Claim a wall tile on `cell`'s rotated -Z edge. Rejects walls that overlap a door
   * frame or duplicate an existing same-facing wall in the same cell.
   */
  claimWall(roomId: string, kit: string, cell: GridCell, rot: number): ClaimResult {
    const edge = sharedEdgeKey(cell, rot);
    const door = this.doors.get(edge);
    if (door) {
      return { ok: false, reason: `${roomId}:${kit} at [${cell.join(',')}] rot=${rot} overlaps door "${door}"` };
    }
    const dir = directedEdgeKey(cell, rot);
    const prev = this.walls.get(dir);
    if (prev) {
      return { ok: false, reason: `${roomId}:${kit} duplicates ${prev} at ${dir}` };
    }
    this.walls.set(dir, `${roomId}:${kit}`);
    return { ok: true };
  }
}
