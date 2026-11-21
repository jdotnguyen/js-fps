import * as THREE from 'three';
import type { DoorData } from '../../data/types/level.ts';
import type { Materials } from '../../render/materials.ts';
import { exteriorize } from '../../render/fx/exteriorLight.ts';
import { at } from './geom.ts';
import { edgeDir, sharedEdgeKey, type GridCell } from './grid.ts';
import { AoMergeBuilder } from './merge.ts';
import { CELL, CORRIDOR_H, CORRIDOR_W, DECK_H, DOOR_H, DOOR_W, MOONPOOL_WIDTH, TRUNK_DEPTH, WINDOW_HEAD, WINDOW_SILL, type Socket } from './types.ts';

const HALF = CELL / 2;
const SKIN = 0.06;
const WINDOW = { width: CELL - 0.14, sill: WINDOW_SILL, head: WINDOW_HEAD, window: true };
/** A sanity screen sits over real glass: the hull keeps the hole, but nothing is seen through it. */
const SCREEN = { ...WINDOW, window: false };
const DOOR = { width: DOOR_W, sill: 0, head: DOOR_H, window: false };
type Opening = typeof WINDOW;

interface HullCell {
  grid: GridCell;
  room: string;
  floor: number;
  bottom: number;
  top: number;
  pool: boolean;
  openings: Map<number, Opening>;
}

interface HullWindow {
  room: string;
  x: number;
  z: number;
  dx: number;
  dz: number;
  halfWidth: number;
}

type Plating = Pick<Materials, 'hullPlate' | 'boltPanel'>;

/** Coated steel in diffuse seawater light. Reuse the existing PBR maps, including for the dim ambient fill. */
function exteriorFinish(base: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const paint = base.clone();
  paint.color.setHex(0xb2c0c5);
  paint.metalness = 0.38;
  paint.emissive.setHex(0x607e8b);
  // Barely self-lit: outside, only lamps light the hull (exterior-ocean spec).
  paint.emissiveIntensity = 0.04;
  paint.emissiveMap = base.map;
  return paint;
}

/** Could any point of b's pane lie on the water side of a's plane? */
function faces(a: HullWindow, b: HullWindow): boolean {
  return (b.x - a.x) * a.dx + (b.z - a.z) * a.dz
    + Math.abs(a.dx * b.dz - a.dz * b.dx) * b.halfWidth > 0;
}

export interface ExteriorHull {
  group: THREE.Group;
  windows: readonly HullWindow[];
  /** Rooms potentially seen through two ocean-facing panes across open water. */
  windowViews: Map<string, Set<string>>;
  /** One entry per occupied grid column: its centre and the lowest hull bottom (m). */
  columns: ReadonlyArray<{ gx: number; gz: number; x: number; z: number; bottom: number }>;
}

/** The water-facing skin belongs to the station, independently of any furnished room. */
export class HullBuilder {
  private readonly cells = new Map<string, HullCell>();

  addPiece(room: string, grid: GridCell, kit: string, rot: number, height: number, sockets: readonly Socket[]): void {
    const key = grid.join(',');
    const floor = grid[1] * DECK_H;
    let cell = this.cells.get(key);
    if (!cell) {
      cell = { grid, room, floor, bottom: floor - 0.85, top: floor + height + 0.18, pool: false, openings: new Map() };
      this.cells.set(key, cell);
    }
    cell.top = Math.max(cell.top, floor + height + 0.18);
    if (kit === 'floor_moonpool') cell.pool = true;
    if (kit === 'wall_window') cell.openings.set(rot, WINDOW);
    if (kit === 'wall_sanity_screen') cell.openings.set(rot, SCREEN);
    if (kit === 'wall_glass_partition') cell.openings.set(rot, { width: 3.9, sill: 0.35, head: 2.54, window: true });
    if (kit === 'door_frame') cell.openings.set(rot, DOOR);
    if (kit.startsWith('corridor_')) {
      if (kit === 'corridor_window') cell.openings.set((rot + 270) % 360, WINDOW);
      for (const socket of sockets) {
        if (socket.kind !== 'door') continue;
        const yaw = Math.round(Math.atan2(-socket.dir[0], -socket.dir[2]) / (Math.PI / 2)) * 90;
        cell.openings.set((rot + yaw + 360) % 360, { width: CORRIDOR_W, sill: 0, head: CORRIDOR_H, window: false });
      }
    }
  }

  build(doors: readonly DoorData[], materials: Plating): ExteriorHull {
    const m = { hullPlate: exteriorFinish(materials.hullPlate), boltPanel: exteriorFinish(materials.boltPanel) };
    const plates = new AoMergeBuilder();
    const windows: HullWindow[] = [];
    const doorEdges = new Set(doors.map(d => sharedEdgeKey(d.cell, d.rot)));
    const columns = new Map<string, HullCell[]>();
    for (const cell of this.cells.values()) {
      const key = `${cell.grid[0]},${cell.grid[2]}`;
      const column = columns.get(key) ?? [];
      column.push(cell);
      columns.set(key, column);
    }
    for (const column of columns.values()) {
      column.sort((a, b) => a.floor - b.floor);
      for (let i = 1; i < column.length; i++) {
        const below = column[i - 1]!;
        below.top = Math.min(below.top, column[i]!.bottom);
      }
    }
    for (const column of columns.values()) {
      for (const [i, cell] of column.entries()) {
        const [gx, , gz] = cell.grid;
        const x = gx * CELL;
        const z = gz * CELL;
        if (column[i + 1]?.bottom !== cell.top) {
          plates.add(new THREE.PlaneGeometry(CELL, CELL), m.hullPlate, at(x, cell.top, z, -Math.PI / 2));
        }
        if (column[i - 1]?.top !== cell.bottom) {
          const bottomPlate = (w: number, d: number, ox: number, oz: number): void =>
            plates.add(new THREE.PlaneGeometry(w, d), m.hullPlate, at(x + ox, cell.bottom, z + oz, Math.PI / 2));
          if (cell.pool) {
            const rim = (CELL - MOONPOOL_WIDTH) / 2;
            for (const sign of [-1, 1]) {
              bottomPlate(CELL, rim, 0, sign * (HALF - rim / 2));
              bottomPlate(rim, MOONPOOL_WIDTH, sign * (HALF - rim / 2), 0);
            }
            // The launch trunk's skirt hangs below the hull, closed by the outer hatch (rebuild-dive-bay).
            const foot = cell.floor - TRUNK_DEPTH - 0.12;
            const w = MOONPOOL_WIDTH + 0.2;
            const skirtH = cell.bottom - foot;
            if (skirtH > 0) {
              for (const sign of [-1, 1]) {
                plates.add(new THREE.BoxGeometry(w, skirtH, SKIN), m.hullPlate, at(x, foot + skirtH / 2, z + sign * (w / 2 - SKIN / 2)));
                plates.add(new THREE.BoxGeometry(SKIN, skirtH, w), m.hullPlate, at(x + sign * (w / 2 - SKIN / 2), foot + skirtH / 2, z));
              }
              plates.add(new THREE.BoxGeometry(w, 0.16, w), m.boltPanel, at(x, foot - 0.08, z));
            }
          } else bottomPlate(CELL, CELL, 0, 0);
        }
        for (const rot of [0, 90, 180, 270]) {
          const [dx, dz] = edgeDir(rot);
          const neighbours = columns.get(`${gx + dx},${gz + dz}`) ?? [];
          const opening = doorEdges.has(sharedEdgeKey(cell.grid, rot)) ? DOOR : cell.openings.get(rot);
          const frame = at(x + dx * HALF, 0, z + dz * HALF, 0, THREE.MathUtils.degToRad(rot), 0);
          // Emit only height intervals exposed to water, including steps between unequal roofs.
          let low = cell.bottom;
          const side = (high: number): void => {
            if (high <= low) return;
            addSide(plates, m, frame, low, high, cell.floor, opening);
            if (opening?.window && low < cell.floor + opening.head && high > cell.floor + opening.sill) {
              windows.push({ room: cell.room, x: x + dx * HALF, z: z + dz * HALF, dx, dz, halfWidth: opening.width / 2 });
            }
          };
          for (const neighbour of neighbours) {
            if (neighbour.bottom >= cell.top) break;
            side(neighbour.bottom);
            low = Math.max(low, neighbour.top);
          }
          side(cell.top);
        }
      }
    }
    const windowViews = new Map<string, Set<string>>();
    for (const a of windows) {
      for (const b of windows) {
        if (a.room === b.room || !faces(a, b) || !faces(b, a)) continue;
        const views = windowViews.get(a.room) ?? new Set<string>();
        views.add(b.room);
        windowViews.set(a.room, views);
      }
    }
    const group = plates.build('station-hull', null);
    for (const mesh of group.children) mesh.castShadow = false;
    exteriorize(group);
    const footprint = [...columns.values()].map((column) => {
      const [gx, , gz] = column[0]!.grid;
      return { gx, gz, x: gx * CELL, z: gz * CELL, bottom: Math.min(...column.map((c) => c.bottom)) };
    });
    return { group, windows, windowViews, columns: footprint };
  }
}

/** The exposed faces sit outside the grid boundary. A raised seam marks each four-metre bay. */
function addSide(plates: AoMergeBuilder, m: Plating, frame: THREE.Matrix4, low: number, high: number, floor: number, opening?: Opening): void {
  const panel = (left: number, right: number, bottom: number, top: number, depth = SKIN, material = m.hullPlate): void => {
    bottom = Math.max(bottom, low);
    top = Math.min(top, high);
    if (top <= bottom || right <= left) return;
    const back = material === m.boltPanel ? SKIN : 0;
    const matrix = frame.clone().multiply(at((left + right) / 2, (top + bottom) / 2, -(depth + back) / 2));
    plates.add(new THREE.BoxGeometry(right - left, top - bottom, depth - back), material, matrix);
  };
  if (opening) {
    const half = opening.width / 2;
    const sill = floor + opening.sill;
    const head = floor + opening.head;
    panel(-HALF, HALF, low, sill);
    panel(-HALF, HALF, head, high);
    panel(-HALF, -half, sill, head);
    panel(half, HALF, sill, head);
    panel(-half, half, head, head + 0.09, 0.1, m.boltPanel);
    panel(-half, half, sill - 0.09, sill, 0.1, m.boltPanel);
  } else {
    panel(-HALF, HALF, low, high);
    panel(-HALF + 0.07, HALF, floor + 0.32, floor + 0.48, 0.14, m.boltPanel);
  }
  panel(-HALF, -HALF + 0.07, low, high, 0.14, m.boltPanel);
}
