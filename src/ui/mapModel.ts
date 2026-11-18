import type { AccessData, DoorData, DoorState, LevelData, RoomData } from '../data/types/level.ts';

/**
 * Map model (ADR-0024), the pure part: room outlines derived from the kit cells (or a room's
 * `outline` override), doors as gaps, gates and vents as icons, map stations, and the
 * seen / revealed state that saves with the game. No DOM or three.js here, so it runs in
 * Node tests; `mapScreen.ts` draws it.
 */

/** Kit grid (mirrors world/kit/types.ts, which imports three.js). */
export const MAP_CELL = 4;
export const MAP_DECK_H = 4;
/** Raster resolution for outlines, metres. Corridor walls sit on 0.5 m multiples. */
export const MAP_RES = 0.5;
/** Door opening width (world/kit/types.ts DOOR_W). */
const DOOR_GAP = 2;
/** Corridor half width and cell half size (world/kit/structure.ts). */
const CORRIDOR_HW = 1.5;
const HALF = MAP_CELL / 2;

export type P2 = [number, number];
export interface Seg {
  a: P2;
  b: P2;
}
export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface MapRoom {
  id: string;
  name: string;
  area: string;
  hidden: boolean;
  deck: number;
  /** Floor fill, row-merged rectangles in world metres (x, z). */
  fill: Rect[];
  /** Outline with door openings left out. */
  edges: Seg[];
  center: P2;
  bounds: Rect;
}

/** What a gate needs, for its icon and label. */
export type GateKind = 'sealed' | 'item' | 'locked' | null;

export interface MapDoor {
  id: string;
  rooms: [string, string];
  deck: number;
  /** The gap in the wall: segment along the wall line. */
  gap: Seg;
  center: P2;
  gate: GateKind;
  requires?: string | undefined;
  /** `access.text` variant of a sealed door ("lockdown"). */
  text?: string | undefined;
  state: DoorState;
}

export interface MapVent {
  id: string;
  room: string;
  center: P2;
  requires?: string | undefined;
  sealed: boolean;
}

export interface MapStation {
  id: string;
  room: string | null;
  reveals: string;
  pos: P2;
}

export interface MapModel {
  rooms: MapRoom[];
  doors: MapDoor[];
  vents: MapVent[];
  stations: MapStation[];
  bounds: Rect;
  areas: string[];
}

type Dir = 'n' | 's' | 'e' | 'w';
const DIRS: Record<Dir, P2> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
/** Open sides of each corridor piece in its own frame (world/kit/structure.ts). */
const CORRIDOR_OPEN: Record<string, Dir[]> = {
  corridor_straight: ['n', 's'],
  corridor_window: ['n', 's'],
  corridor_corner: ['s', 'e'],
  corridor_t: ['n', 's', 'e'],
  corridor_end: ['n'],
};

/** Rotate a local (x, z) offset by `deg` around Y, the way the kit's placement matrix does. */
export function rotY([x, z]: P2, deg: number): P2 {
  const r = (deg * Math.PI) / 180;
  const c = Math.round(Math.cos(r) * 1e9) / 1e9;
  const s = Math.round(Math.sin(r) * 1e9) / 1e9;
  return [x * c + z * s, -x * s + z * c];
}

const key = (ix: number, iz: number): string => `${ix},${iz}`;

/** Mark every raster square whose centre lies inside the rect. */
function stamp(set: Set<string>, r: Rect): void {
  const ix0 = Math.round(Math.min(r.x0, r.x1) / MAP_RES);
  const ix1 = Math.round(Math.max(r.x0, r.x1) / MAP_RES);
  const iz0 = Math.round(Math.min(r.z0, r.z1) / MAP_RES);
  const iz1 = Math.round(Math.max(r.z0, r.z1) / MAP_RES);
  for (let ix = ix0; ix < ix1; ix++) for (let iz = iz0; iz < iz1; iz++) set.add(key(ix, iz));
}

function pointInPolygon(x: number, z: number, poly: readonly P2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!;
    const [xj, zj] = poly[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Cells of a room with the corridor piece (if any) in each, keyed "x,deck,z". */
function roomCells(r: RoomData): Map<string, { cell: [number, number, number]; corridor: { kit: string; rot: number } | null }> {
  const out = new Map<string, { cell: [number, number, number]; corridor: { kit: string; rot: number } | null }>();
  for (const piece of r.pieces) {
    const cells = piece.cells ?? (piece.cell ? [piece.cell] : []);
    for (const cell of cells) {
      const k = cell.join(',');
      const entry = out.get(k) ?? { cell, corridor: null };
      if (piece.kit in CORRIDOR_OPEN) entry.corridor = { kit: piece.kit, rot: piece.rot ?? 0 };
      out.set(k, entry);
    }
  }
  return out;
}

/** Raster squares of a room's floor plus its deck (the most common deck of its cells). */
export function roomRaster(r: RoomData): { squares: Set<string>; deck: number } {
  const squares = new Set<string>();
  const cells = roomCells(r);
  const decks = new Map<number, number>();
  for (const { cell } of cells.values()) decks.set(cell[1], (decks.get(cell[1]) ?? 0) + 1);
  const deck = [...decks.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
  if (r.outline && r.outline.length >= 3) {
    const xs = r.outline.map((p) => p[0]);
    const zs = r.outline.map((p) => p[1]);
    const ix0 = Math.floor(Math.min(...xs) / MAP_RES);
    const ix1 = Math.ceil(Math.max(...xs) / MAP_RES);
    const iz0 = Math.floor(Math.min(...zs) / MAP_RES);
    const iz1 = Math.ceil(Math.max(...zs) / MAP_RES);
    for (let ix = ix0; ix < ix1; ix++) {
      for (let iz = iz0; iz < iz1; iz++) {
        if (pointInPolygon((ix + 0.5) * MAP_RES, (iz + 0.5) * MAP_RES, r.outline)) squares.add(key(ix, iz));
      }
    }
    return { squares, deck };
  }
  for (const { cell, corridor } of cells.values()) {
    if (cell[1] !== deck) continue;
    const cx = cell[0] * MAP_CELL;
    const cz = cell[2] * MAP_CELL;
    if (!corridor) {
      stamp(squares, { x0: cx - HALF, z0: cz - HALF, x1: cx + HALF, z1: cz + HALF });
      continue;
    }
    // A corridor piece: the centre square plus an arm per open side (rotated with the piece).
    stamp(squares, { x0: cx - CORRIDOR_HW, z0: cz - CORRIDOR_HW, x1: cx + CORRIDOR_HW, z1: cz + CORRIDOR_HW });
    for (const side of CORRIDOR_OPEN[corridor.kit] ?? []) {
      const [dx, dz] = rotY(DIRS[side], corridor.rot);
      const [px, pz] = [Math.abs(dz), Math.abs(dx)];
      const near: P2 = [cx + dx * CORRIDOR_HW, cz + dz * CORRIDOR_HW];
      const far: P2 = [cx + dx * HALF, cz + dz * HALF];
      stamp(squares, {
        x0: Math.min(near[0], far[0]) - px * CORRIDOR_HW,
        x1: Math.max(near[0], far[0]) + px * CORRIDOR_HW,
        z0: Math.min(near[1], far[1]) - pz * CORRIDOR_HW,
        z1: Math.max(near[1], far[1]) + pz * CORRIDOR_HW,
      });
    }
  }
  return { squares, deck };
}

const parse = (k: string): P2 => {
  const i = k.indexOf(',');
  return [Number(k.slice(0, i)), Number(k.slice(i + 1))];
};

/** Row-merged rectangles covering the squares. */
export function fillRects(squares: ReadonlySet<string>): Rect[] {
  const rows = new Map<number, number[]>();
  for (const k of squares) {
    const [ix, iz] = parse(k);
    const row = rows.get(iz) ?? [];
    row.push(ix);
    rows.set(iz, row);
  }
  const out: Rect[] = [];
  for (const [iz, xs] of [...rows.entries()].sort((a, b) => a[0] - b[0])) {
    xs.sort((a, b) => a - b);
    let start = xs[0]!;
    let prev = start;
    for (let i = 1; i <= xs.length; i++) {
      const x = xs[i];
      if (x === prev + 1) {
        prev = x;
        continue;
      }
      out.push({ x0: start * MAP_RES, z0: iz * MAP_RES, x1: (prev + 1) * MAP_RES, z1: (iz + 1) * MAP_RES });
      if (x !== undefined) start = prev = x;
    }
  }
  return out;
}

/** True if the unit edge's midpoint lies inside one of the door gaps. */
function inGap(mx: number, mz: number, gaps: readonly Seg[]): boolean {
  for (const g of gaps) {
    const vertical = Math.abs(g.a[0] - g.b[0]) < 1e-6;
    if (vertical) {
      if (Math.abs(mx - g.a[0]) < 1e-3 && mz > Math.min(g.a[1], g.b[1]) - 1e-6 && mz < Math.max(g.a[1], g.b[1]) + 1e-6) return true;
    } else if (Math.abs(mz - g.a[1]) < 1e-3 && mx > Math.min(g.a[0], g.b[0]) - 1e-6 && mx < Math.max(g.a[0], g.b[0]) + 1e-6) return true;
  }
  return false;
}

/**
 * Boundary of the squares as merged segments, leaving out any stretch inside a door gap.
 * Each boundary edge is found once (a square side with no square on the other side).
 */
export function outlineEdges(squares: ReadonlySet<string>, gaps: readonly Seg[] = []): Seg[] {
  // Horizontal edges keyed by z line, vertical by x line; values are unit start indices.
  const horiz = new Map<string, number[]>();
  const vert = new Map<string, number[]>();
  const push = (m: Map<string, number[]>, k: string, i: number): void => {
    const list = m.get(k) ?? [];
    list.push(i);
    m.set(k, list);
  };
  for (const k of squares) {
    const [ix, iz] = parse(k);
    const x0 = ix * MAP_RES;
    const z0 = iz * MAP_RES;
    const h = MAP_RES / 2;
    // north (z0) / south (z0+res) sides: tag with the side so a 1-square-thick wall stays two lines.
    if (!squares.has(key(ix, iz - 1)) && !inGap(x0 + h, z0, gaps)) push(horiz, `${iz}:n`, ix);
    if (!squares.has(key(ix, iz + 1)) && !inGap(x0 + h, z0 + MAP_RES, gaps)) push(horiz, `${iz + 1}:s`, ix);
    if (!squares.has(key(ix - 1, iz)) && !inGap(x0, z0 + h, gaps)) push(vert, `${ix}:w`, iz);
    if (!squares.has(key(ix + 1, iz)) && !inGap(x0 + MAP_RES, z0 + h, gaps)) push(vert, `${ix + 1}:e`, iz);
  }
  const out: Seg[] = [];
  const merge = (m: Map<string, number[]>, make: (line: number, a: number, b: number) => Seg): void => {
    for (const [k, list] of m) {
      const line = Number(k.slice(0, k.indexOf(':')));
      list.sort((a, b) => a - b);
      let start = list[0]!;
      let prev = start;
      for (let i = 1; i <= list.length; i++) {
        const v = list[i];
        if (v === prev + 1) {
          prev = v;
          continue;
        }
        out.push(make(line, start, prev + 1));
        if (v !== undefined) start = prev = v;
      }
    }
  };
  merge(horiz, (line, a, b) => ({ a: [a * MAP_RES, line * MAP_RES], b: [b * MAP_RES, line * MAP_RES] }));
  merge(vert, (line, a, b) => ({ a: [line * MAP_RES, a * MAP_RES], b: [line * MAP_RES, b * MAP_RES] }));
  return out;
}

/** The door's opening: on the -Z edge of its cell in the door's own frame (world/level.ts). */
export function doorGap(d: Pick<DoorData, 'cell' | 'rot'>): { gap: Seg; center: P2 } {
  const cx = d.cell[0] * MAP_CELL;
  const cz = d.cell[2] * MAP_CELL;
  const [ox, oz] = rotY([0, -HALF], d.rot);
  const [tx, tz] = rotY([DOOR_GAP / 2, 0], d.rot);
  const center: P2 = [cx + ox, cz + oz];
  return { center, gap: { a: [center[0] - tx, center[1] - tz], b: [center[0] + tx, center[1] + tz] } };
}

function gateOf(access: AccessData | undefined, state: DoorState): { gate: GateKind; requires?: string | undefined; text?: string | undefined } {
  if (access?.sealed) return { gate: 'sealed', text: access.text };
  if (access?.requires !== undefined) return { gate: 'item', requires: access.requires };
  if (state === 'sealed' || state === 'jammed') return { gate: 'sealed' };
  if (state === 'locked') return { gate: 'locked' };
  return { gate: null };
}

function bounds(rects: readonly Rect[]): Rect {
  const b: Rect = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
  for (const r of rects) {
    b.x0 = Math.min(b.x0, r.x0);
    b.z0 = Math.min(b.z0, r.z0);
    b.x1 = Math.max(b.x1, r.x1);
    b.z1 = Math.max(b.z1, r.z1);
  }
  return Number.isFinite(b.x0) ? b : { x0: 0, z0: 0, x1: 0, z1: 0 };
}

/** Build the whole map from level data. Rooms without `area` use the level id as their area. */
export function buildMapModel(data: LevelData): MapModel {
  const doors: MapDoor[] = data.doors.map((d) => {
    const { gap, center } = doorGap(d);
    return { id: d.id, rooms: d.between, deck: d.cell[1], gap, center, state: d.state, ...gateOf(d.access, d.state) };
  });
  const rasters = new Map<string, { squares: Set<string>; deck: number }>();
  const rooms: MapRoom[] = data.rooms.map((r) => {
    const raster = roomRaster(r);
    rasters.set(r.id, raster);
    const gaps = doors.filter((d) => d.rooms.includes(r.id)).map((d) => d.gap);
    const fill = fillRects(raster.squares);
    const b = bounds(fill);
    return {
      id: r.id,
      name: r.name,
      area: r.area ?? data.id,
      hidden: r.hidden ?? false,
      deck: raster.deck,
      fill,
      edges: outlineEdges(raster.squares, gaps),
      center: [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2],
      bounds: b,
    };
  });
  const roomAt = (x: number, z: number): string | null => {
    const k = key(Math.floor(x / MAP_RES), Math.floor(z / MAP_RES));
    for (const [id, r] of rasters) if (r.squares.has(k)) return id;
    return null;
  };
  const vents: MapVent[] = (data.vents ?? []).map((v) => ({
    id: v.id,
    room: v.room,
    center: [(v.box[0][0] + v.box[1][0]) / 2, (v.box[0][2] + v.box[1][2]) / 2],
    requires: v.access?.requires,
    sealed: v.access?.sealed ?? false,
  }));
  const stations: MapStation[] = (data.mapStations ?? []).map((s) => ({
    id: s.id,
    room: s.room ?? roomAt(s.pos[0], s.pos[2]),
    reveals: s.reveals,
    pos: [s.pos[0], s.pos[2]],
  }));
  const areas = [...new Set(rooms.map((r) => r.area))];
  return { rooms, doors, vents, stations, bounds: bounds(rooms.map((r) => r.bounds)), areas };
}

export type RoomKnowledge = 'seen' | 'revealed' | null;

/** Saved map state (ADR-0016 save v3 `map`). */
export interface MapSave {
  seen: string[];
  revealed: string[];
}

/**
 * What the player knows: rooms walked (`seen`) and areas filled in by a map station
 * (`revealed`). Hidden rooms only ever show once seen.
 */
export class MapState {
  private readonly model: MapModel;
  private readonly byId: Map<string, MapRoom>;
  private readonly seen = new Set<string>();
  private readonly revealed = new Set<string>();

  constructor(model: MapModel) {
    this.model = model;
    this.byId = new Map(model.rooms.map((r) => [r.id, r]));
  }

  /** Mark a room seen. True the first time. Unknown ids are ignored. */
  enter(roomId: string): boolean {
    if (!this.byId.has(roomId) || this.seen.has(roomId)) return false;
    this.seen.add(roomId);
    return true;
  }

  /** Reveal an area; returns the room ids that became known by it (hidden rooms excluded). */
  reveal(area: string): string[] {
    const before = new Set(this.model.rooms.filter((r) => this.knows(r.id)).map((r) => r.id));
    this.revealed.add(area);
    return this.model.rooms.filter((r) => !before.has(r.id) && this.knows(r.id)).map((r) => r.id);
  }

  isRevealed(area: string): boolean {
    return this.revealed.has(area);
  }

  knowledge(roomId: string): RoomKnowledge {
    if (this.seen.has(roomId)) return 'seen';
    const r = this.byId.get(roomId);
    if (r && !r.hidden && this.revealed.has(r.area)) return 'revealed';
    return null;
  }

  knows(roomId: string): boolean {
    return this.knowledge(roomId) !== null;
  }

  /** Doors, vents and stations are drawn once a room they touch is known. */
  doorKnown(d: MapDoor): boolean {
    return this.knows(d.rooms[0]) || this.knows(d.rooms[1]);
  }

  save(): MapSave {
    return { seen: [...this.seen], revealed: [...this.revealed] };
  }

  /** Replace from a save; ids this level does not have are kept harmlessly (other levels). */
  restore(s: MapSave | null | undefined): void {
    this.clear();
    for (const id of s?.seen ?? []) this.seen.add(id);
    for (const a of s?.revealed ?? []) this.revealed.add(a);
  }

  clear(): void {
    this.seen.clear();
    this.revealed.clear();
  }
}

/** Short label for a gate icon, e.g. "Needs Level 2 Card" / "Unlocked: Level 2 Card" / "Lockdown". */
export function gateLabel(g: { gate: GateKind; requires?: string | undefined; text?: string | undefined }, itemName: (id: string) => string, holds: (id: string) => boolean): string {
  switch (g.gate) {
    case 'sealed':
      return g.text === 'lockdown' ? 'Lockdown: won’t open' : 'Won’t open';
    case 'item':
      return holds(g.requires!) ? `Unlocked: ${itemName(g.requires!)}` : `Needs ${itemName(g.requires!)}`;
    case 'locked':
      return 'Locked';
    default:
      return '';
  }
}
