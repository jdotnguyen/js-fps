/**
 * A room's layout (spec content-layout "Room shells are built from the layout", split-level-data D3): the cells and
 * finishes its floors, walls and ceilings are built from when the level loads (`world/shell.ts`). The structure
 * piece shape lives here too, since a layout's `extraPieces` are pieces placed by hand.
 */
import { arr, num, obj, optional, record, scalar, str, ValidationError, type Infer, type Validator } from '../../core/validate.ts';

export const int: Validator<number> = (v, p) => {
  const n = num(v, p);
  if (!Number.isInteger(n)) throw new ValidationError(p, `expected a whole number, got ${n}`);
  return n;
};

export const cell: Validator<[number, number, number]> = (v, p) => {
  if (!Array.isArray(v) || v.length !== 3) throw new ValidationError(p, 'expected [x, deck, z] grid cell');
  return [int(v[0], `${p}[0]`), int(v[1], `${p}[1]`), int(v[2], `${p}[2]`)];
};

export const rot90: Validator<0 | 90 | 180 | 270> = (v, p) => {
  const n = num(v, p);
  if (n !== 0 && n !== 90 && n !== 180 && n !== 270) throw new ValidationError(p, `expected 0, 90, 180 or 270, got ${n}`);
  return n;
};

export const params = record(scalar);

export const pieceShape = {
  kit: str,
  cell: optional(cell),
  cells: optional(arr(cell)),
  rot: optional(rot90),
  params: optional(params),
};

/** A deck-0 grid cell as [x, z]. */
const cellXZ: Validator<[number, number]> = (v, p) => {
  if (!Array.isArray(v) || v.length !== 2) throw new ValidationError(p, 'expected [x, z] grid cell');
  return [int(v[0], `${p}[0]`), int(v[1], `${p}[1]`)];
};

/** `"x,z,side"`: one side (n, e, s, w) of a cell. */
const EDGE = /^(-?\d+),(-?\d+),([nesw])$/;
/** `"x,z"`: a cell. */
const CELL = /^(-?\d+),(-?\d+)$/;
const edge: Validator<string> = (v, p) => {
  const s = str(v, p);
  if (!EDGE.test(s)) throw new ValidationError(p, `expected a cell side like "4,3,n", got "${s}"`);
  return s;
};

export const layoutShape = {
  /** The room's cells, in order: ceilings are built one per cell in this order, so numeric light slots follow it. */
  cells: arr(cellXZ),
  /** Floor tile kit (default `floor`), per-cell kits keyed `"x,z"`, per-cell params, and `params.material` for the rest. */
  floor: optional(str),
  floorOverride: optional(record(str)),
  floorParams: optional(record(params)),
  floorMaterial: optional(str),
  /** Ceiling tile kit (default `ceiling`; `ceiling_pipes` alternates with plain `ceiling`) and its `params.material`. */
  ceiling: optional(str),
  ceilingMaterial: optional(str),
  /** Wall finishes, picked per cell side by a hash (default `wall_panel`, `wall_plain`). */
  walls: optional(arr(str)),
  /** Per-side wall kits and params keyed `"x,z,side"` (a window, a glass partition), and `params.material` for the rest. */
  wallOverride: optional(record(str)),
  wallParams: optional(record(params)),
  wallMaterial: optional(str),
  /** Outer sides with no wall that no door explains: an open seam to the next room, or the far side of its glass. */
  open: optional(arr(edge)),
  /** When given, only these cells' ceilings carry a light housing; numeric light slots count only them. */
  fixtures: optional(arr(cellXZ)),
  /** Structure placed by hand on top of the built tiles (stairs, landings, a hatch). */
  extraPieces: optional(arr(obj(pieceShape))),
};

export type RoomLayout = Infer<typeof layoutShape>;

/** Shape check plus the cross-checks the builder relies on: every cell, key and fixture names one of the room's cells. */
export const layoutValidator: Validator<RoomLayout> = (v, p) => {
  const layout = obj(layoutShape)(v, p);
  const cells = new Set<string>();
  layout.cells.forEach(([x, z], i) => {
    const k = `${x},${z}`;
    if (cells.has(k)) throw new ValidationError(`${p} > cells[${i}]`, `cell ${k} is listed twice`);
    cells.add(k);
  });
  const inRoom = (key: string, path: string, pattern: RegExp, what: string): void => {
    const m = pattern.exec(key);
    if (!m) throw new ValidationError(path, `expected a ${what} key like "${what === 'cell' ? '4,3' : '4,3,n'}", got "${key}"`);
    if (!cells.has(`${m[1]},${m[2]}`)) throw new ValidationError(path, `cell ${m[1]},${m[2]} is not one of the room's cells`);
  };
  for (const field of ['floorOverride', 'floorParams'] as const) for (const k of Object.keys(layout[field] ?? {})) inRoom(k, `${p} > ${field} > ${k}`, CELL, 'cell');
  for (const field of ['wallOverride', 'wallParams'] as const) for (const k of Object.keys(layout[field] ?? {})) inRoom(k, `${p} > ${field} > ${k}`, EDGE, 'cell side');
  (layout.open ?? []).forEach((k, i) => inRoom(k, `${p} > open[${i}]`, EDGE, 'cell side'));
  (layout.fixtures ?? []).forEach(([x, z], i) => inRoom(`${x},${z}`, `${p} > fixtures[${i}]`, CELL, 'cell'));
  if (layout.walls && layout.walls.length === 0) throw new ValidationError(`${p} > walls`, 'list at least one wall kit');
  (layout.extraPieces ?? []).forEach((pc, k) => {
    if ((pc.cell ? 1 : 0) + (pc.cells ? 1 : 0) !== 1) throw new ValidationError(`${p} > extraPieces[${k}]`, 'give exactly one of "cell" or "cells"');
  });
  return layout;
};
