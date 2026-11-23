import { MAP_DECK_H, type MapDoor } from './mapModel.ts';

/**
 * Pure wayfinding math (hud-wayfinding spec): minimal N/E/S/W compass bearings,
 * active objective compass pips with distance clamping, room-door adjacency graph,
 * and adjacent-room-only world marker resolution. No DOM or three.js.
 */

export interface P3 {
  x: number;
  y: number;
  z: number;
}

export interface CompassObjectiveInput {
  id: string;
  pos: P3;
  required: boolean;
}

export interface CompassCardinal {
  label: 'N' | 'E' | 'S' | 'W';
  /** Normalized position across the compass strip in [-1, 1] (0 = dead ahead). */
  x: number;
}

export interface CompassObjectiveMark {
  id: string;
  required: boolean;
  /** Normalized position across the compass strip, clamped to [-1, 1]. */
  x: number;
  /** True when the bearing is outside the visible strip FOV and clamped to an edge. */
  clamped: boolean;
  /** Rounded horizontal distance in metres. */
  distance: number;
}

/** Half-FOV spanned by the top compass strip (~100 deg each side). */
export const COMPASS_HALF_FOV = (100 * Math.PI) / 180;

const CARDINALS: ReadonlyArray<{ label: 'N' | 'E' | 'S' | 'W'; dx: number; dz: number }> = [
  { label: 'N', dx: 0, dz: -1 },
  { label: 'E', dx: 1, dz: 0 },
  { label: 'S', dx: 0, dz: 1 },
  { label: 'W', dx: -1, dz: 0 },
];

/** Signed angle in [-PI, PI] from Jay's forward (-sin(yaw), -cos(yaw)) to vector (dx, dz); positive = right. */
export function relativeBearing(yaw: number, dx: number, dz: number): number {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  const fwd = dx * fx + dz * fz;
  const right = dx * rx + dz * rz;
  return Math.atan2(right, fwd);
}

/** Compute visible N/E/S/W cardinal ticks and clamped objective pips for the top compass strip. */
export function computeCompass(
  playerPos: P3,
  playerYaw: number,
  objectives: readonly CompassObjectiveInput[],
  halfFov = COMPASS_HALF_FOV,
): { cardinals: CompassCardinal[]; objectives: CompassObjectiveMark[] } {
  const cardinals: CompassCardinal[] = [];
  for (const c of CARDINALS) {
    const angle = relativeBearing(playerYaw, c.dx, c.dz);
    const x = angle / halfFov;
    if (Math.abs(x) <= 1.02) cardinals.push({ label: c.label, x });
  }
  const marks: CompassObjectiveMark[] = [];
  for (const o of objectives) {
    const dx = o.pos.x - playerPos.x;
    const dz = o.pos.z - playerPos.z;
    const dist = Math.hypot(dx, dz);
    const angle = dist > 1e-4 ? relativeBearing(playerYaw, dx, dz) : 0;
    const raw = angle / halfFov;
    const clamped = Math.abs(raw) > 1;
    const x = Math.max(-1, Math.min(1, raw));
    marks.push({
      id: o.id,
      required: o.required,
      x,
      clamped,
      distance: dist < 0.5 ? 0 : Math.round(dist),
    });
  }
  return { cardinals, objectives: marks };
}

/** Undirected room-to-doors adjacency index built from `MapModel.doors`. */
export type RoomAdjacency = ReadonlyMap<string, readonly MapDoor[]>;

export function buildRoomAdjacency(doors: readonly MapDoor[]): RoomAdjacency {
  const map = new Map<string, MapDoor[]>();
  const add = (room: string, door: MapDoor): void => {
    let list = map.get(room);
    if (!list) map.set(room, (list = []));
    list.push(door);
  };
  for (const d of doors) {
    add(d.rooms[0], d);
    if (d.rooms[1] !== d.rooms[0]) add(d.rooms[1], d);
  }
  return map;
}

export interface WorldMarkerResult {
  id: string;
  required: boolean;
  /** 'target' when Jay is in the objective's room; 'door' (next door on the route) otherwise. */
  kind: 'target' | 'door';
  doorId?: string;
  pos: P3;
  distance: number;
}

/**
 * Resolve an in-world marker for an objective (hud-wayfinding spec):
 * - Same room: points directly at the objective target position (lifted to chest height if floor-level).
 * - Any other room: points at the door that starts the shortest door route to the target room
 *   (the nearest such door when several tie).
 * - Unknown room or no route: returns null.
 */
export function resolveWorldMarker(
  id: string,
  required: boolean,
  playerRoom: string | null,
  playerPos: P3,
  targetRooms: readonly string[],
  targetPos: P3,
  adjacency: RoomAdjacency,
): WorldMarkerResult | null {
  if (!playerRoom || targetRooms.length === 0) return null;
  if (targetRooms.includes(playerRoom)) {
    const deckOffset = ((targetPos.y % MAP_DECK_H) + MAP_DECK_H) % MAP_DECK_H;
    const y = deckOffset < 0.45 ? targetPos.y + 1.25 : targetPos.y + 0.25;
    const dist = Math.hypot(targetPos.x - playerPos.x, targetPos.z - playerPos.z);
    return {
      id,
      required,
      kind: 'target',
      pos: { x: targetPos.x, y, z: targetPos.z },
      distance: dist < 0.5 ? 0 : Math.round(dist),
    };
  }
  const doors = adjacency.get(playerRoom);
  if (!doors?.length) return null;
  // Door hops from every room to the nearest target room (multi-source BFS), so the marker
  // leads through the door that starts the shortest route, however many rooms away.
  const hops = new Map<string, number>(targetRooms.map((r) => [r, 0]));
  const queue = [...targetRooms];
  for (let i = 0; i < queue.length; i++) {
    const room = queue[i]!;
    const next = hops.get(room)! + 1;
    for (const d of adjacency.get(room) ?? []) {
      const other = d.rooms[0] === room ? d.rooms[1] : d.rooms[0];
      if (hops.has(other)) continue;
      hops.set(other, next);
      queue.push(other);
    }
  }
  const here = hops.get(playerRoom);
  let best: MapDoor | null = null;
  let bestDist = Infinity;
  let bestHops = Infinity;
  for (const d of doors) {
    const other = d.rooms[0] === playerRoom ? d.rooms[1] : d.rooms[0];
    const h = hops.get(other);
    if (h === undefined || (here !== undefined && h >= here)) continue;
    const dist = Math.hypot(d.center[0] - playerPos.x, d.center[1] - playerPos.z);
    if (h < bestHops || (h === bestHops && dist < bestDist)) {
      bestHops = h;
      bestDist = dist;
      best = d;
    }
  }
  if (!best) return null;
  return {
    id,
    required,
    kind: 'door',
    doorId: best.id,
    pos: { x: best.center[0], y: best.deck * MAP_DECK_H + 1.45, z: best.center[1] },
    distance: bestDist < 0.5 ? 0 : Math.round(bestDist),
  };
}
