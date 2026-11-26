/**
 * Room shells (spec content-layout "Room shells are built from the layout", split-level-data D3): a room's floors,
 * walls and ceilings, built from its layout and the level's doors when the level loads. These are the rules
 * retired slice01 generator wrote the pieces with, kept exactly, since light slots and tests depend on the order
 * and grouping of the pieces:
 *
 * - Ceilings come first, one piece per cell in `cells` order, so numeric light slots follow the cell order. With
 *   `fixtures`, the other cells' ceilings carry no light housing (`fixture: false`), and the slots count only the
 *   housings. A `ceiling_pipes` room alternates with plain `ceiling`, starting plain.
 * - Then floors and walls, cell by cell (floor, then the n, e, s, w sides), merged into one piece per kit, rotation
 *   and params, in the order each first appears.
 * - A side gets a wall unless the next cell is the room's own, a door joins the rooms there, or the layout lists the
 *   side as `open`. Its kit is the side's `wallOverride`, else one of `walls` chosen by a hash of cell and side.
 * - Last, the layout's `extraPieces`, as given.
 *
 * Grid: cell (x, z) is centred on world (4x, 0, 4z); +x east, +z south. Wall tiles: rot n=0, w=90, s=180, e=270.
 */
import type { RoomLayout } from '../data/types/layout.ts';

type Rot = 0 | 90 | 180 | 270;
type Cell = [number, number, number];
type Params = Record<string, string | number | boolean>;

/** A structure piece as the level data holds it (`PieceData`). */
export interface ShellPiece {
  kit: string;
  cell?: Cell;
  cells?: Cell[];
  rot?: Rot;
  params?: Params;
}

/** What a door needs to say for its edge: the cell it sits on and the side it faces, as a wall rotation. */
export interface ShellDoor {
  cell: readonly [number, number, number];
  rot: number;
}

const SIDES = ['n', 'e', 's', 'w'] as const;
type Side = (typeof SIDES)[number];
const STEP: Record<Side, [number, number]> = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
const OPP: Record<Side, Side> = { n: 's', s: 'n', e: 'w', w: 'e' };
const WALL_ROT: Record<Side, Rot> = { n: 0, w: 90, s: 180, e: 270 };
const ROT_SIDE: Record<number, Side> = { 0: 'n', 90: 'w', 180: 's', 270: 'e' };

export const DEFAULT_WALLS: readonly string[] = ['wall_panel', 'wall_plain'];

const edgeKey = (x: number, z: number, s: Side): string => `${x},${z},${s}`;

/** Both sides of every door's edge, as `"x,z,side"` keys. */
export function doorEdges(doors: readonly ShellDoor[]): Set<string> {
  const out = new Set<string>();
  for (const d of doors) {
    const s = ROT_SIDE[d.rot];
    if (!s) continue;
    const [x, , z] = d.cell;
    out.add(edgeKey(x, z, s));
    out.add(edgeKey(x + STEP[s][0], z + STEP[s][1], OPP[s]));
  }
  return out;
}

/** The wall finish for one side when the layout names none: a fixed hash of cell and side into `walls`. */
export function wallChoice(walls: readonly string[], x: number, z: number, s: Side): string {
  return walls[Math.abs(x * 7 + z * 3 + s.charCodeAt(0)) % walls.length]!;
}

/** The room's floor, wall and ceiling pieces, followed by its extra pieces. `doors` holds `doorEdges` keys. */
export function buildShell(layout: RoomLayout, doors: ReadonlySet<string>): ShellPiece[] {
  const floor = layout.floor ?? 'floor';
  const ceiling = layout.ceiling ?? 'ceiling';
  const walls = layout.walls ?? DEFAULT_WALLS;
  const floorOverride = layout.floorOverride ?? {};
  const floorParams = layout.floorParams ?? {};
  const wallOverride = layout.wallOverride ?? {};
  const wallParams = layout.wallParams ?? {};
  const open = new Set(layout.open ?? []);
  const lit = layout.fixtures ? new Set(layout.fixtures.map(([x, z]) => `${x},${z}`)) : null;
  const inRoom = new Set(layout.cells.map(([x, z]) => `${x},${z}`));
  const floorDefault: Params | undefined = layout.floorMaterial ? { material: layout.floorMaterial } : undefined;
  const wallDefault: Params | undefined = layout.wallMaterial ? { material: layout.wallMaterial } : undefined;

  const pieces: ShellPiece[] = [];
  layout.cells.forEach(([x, z], i) => {
    const c: ShellPiece = { kit: ceiling === 'ceiling_pipes' && i % 2 === 0 ? 'ceiling' : ceiling, cell: [x, 0, z] };
    const p: Params = layout.ceilingMaterial ? { material: layout.ceilingMaterial } : {};
    if (lit && !lit.has(`${x},${z}`)) p['fixture'] = false;
    if (Object.keys(p).length) c.params = p;
    pieces.push(c);
  });

  const groups = new Map<string, { kit: string; rot: Rot; params: Params | undefined; cells: Cell[] }>();
  const put = (kit: string, cell: Cell, rot: Rot, params: Params | undefined): void => {
    const key = `${kit}|${rot}|${params ? JSON.stringify(params) : ''}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { kit, rot, params, cells: [] }));
    g.cells.push(cell);
  };
  for (const [x, z] of layout.cells) {
    put(floorOverride[`${x},${z}`] ?? floor, [x, 0, z], 0, floorParams[`${x},${z}`] ?? floorDefault);
    for (const s of SIDES) {
      if (inRoom.has(`${x + STEP[s][0]},${z + STEP[s][1]}`)) continue;
      const ek = edgeKey(x, z, s);
      if (doors.has(ek) || open.has(ek)) continue;
      put(wallOverride[ek] ?? wallChoice(walls, x, z, s), [x, 0, z], WALL_ROT[s], wallParams[ek] ?? wallDefault);
    }
  }
  for (const g of groups.values()) {
    const p: ShellPiece = { kit: g.kit, cells: g.cells };
    if (g.params) p.params = { ...g.params };
    if (g.rot) p.rot = g.rot;
    pieces.push(p);
  }
  for (const p of layout.extraPieces ?? []) pieces.push(structuredClone(p));
  return pieces;
}
