import * as THREE from 'three';
import type { Rng } from '../../core/rng.ts';
import type { Materials } from '../../render/materials.ts';
import type { SpotKind } from '../../data/types/level.ts';

/**
 * Kit contract (ADR-0003). Every piece has one ID, one pivot convention (origin at the
 * floor centre of its first cell, facing -Z) and a procedural generator. A GLB with the
 * same ID can replace the generator later (see world/registry.ts).
 */

/** Grid cell footprint in metres (x and z). */
export const CELL = 4;
/** Metres per step of `cell[1]` (one deck). */
export const DECK_H = 4;
export const CORRIDOR_W = 3;
export const CORRIDOR_H = 3.2;
export const ROOM_H = 3.2;
export const DOOR_W = 2;
export const DOOR_H = 2.4;
/** Depth of a room wall tile, measured inward from the cell edge. */
export const WALL_T = 0.25;
/** Outer back-face inset (m) so back-to-back walls on shared cell edges never z-fight. */
export const WALL_INSET = 0.002;

export type Vec3 = [number, number, number];

export interface BoxSpec {
  min: Vec3;
  max: Vec3;
  /** `'glass'` marks a see-through partition, which muffles sound only lightly (in-world-audio: Glass muffles lightly). */
  acoustic?: 'glass';
}

export const SURFACE_MATERIALS = ['concrete', 'metal', 'grate', 'rubber', 'water'] as const;
export type SurfaceMaterial = (typeof SURFACE_MATERIALS)[number];

/** `pendant`: a hanging lamp bulb (warm, short range, the light sits just under the bulb); see `pendant_light` `slots`. */
export const LIGHT_SLOT_KINDS = ['ceiling', 'wall', 'emergency', 'pendant'] as const;
export type LightSlotKind = (typeof LIGHT_SLOT_KINDS)[number];

export type SocketKind = 'door' | 'floor' | 'wall';

export interface Socket {
  name: string;
  pos: Vec3;
  dir: Vec3;
  kind?: SocketKind;
}

/** Where a body can sit or lean (ADR-0029), in piece space: `pos` is the body's feet on the floor, `yaw` its facing (radians, 0 faces -Z). */
export interface SpotSlot {
  kind: SpotKind;
  pos: Vec3;
  yaw: number;
  /** Seat surface height (m) for seated kinds. */
  seat?: number;
}

export interface LightSlot {
  pos: Vec3;
  kind: LightSlotKind;
  /** Yaw of the fixture (radians), so the glowing diffuser lines up with its housing. */
  ry: number;
}

export interface PieceOutput {
  /** Origin at floor centre, facing -Z. Meshes with userData.dynamic stay unmerged. */
  object: THREE.Group;
  /** Simplified axis-aligned boxes, in piece space. */
  colliders: BoxSpec[];
  sockets: Socket[];
  lightSlots: LightSlot[];
  navNodes: Array<{ pos: Vec3 }>;
  surfaces: Array<{ box: BoxSpec; material: SurfaceMaterial }>;
  /** Per-frame animation (screens, fans, abyss shader). */
  tick?: (t: number, dt: number) => void;
  /**
   * Named events the piece reacts to (blinds, wall screens, the supply sub). The loader
   * subscribes each to the game event bus and to level trigger emits of the same name.
   */
  listeners?: Array<{ event: string; fn: (payload: unknown) => void }>;
  /** Activity spots (ADR-0029): seats and lean places for ambient crew. */
  spots?: SpotSlot[];
  /** Protruding wall structure (pilasters, trim rails, cable trays) that wall-mounted props must stay clear of, in piece space. */
  keepouts?: BoxSpec[];
}

/** Props hung on a wall (back on their local z = 0): they must not overlap any wall piece's `keepouts`. */
export const WALL_MOUNTED_PROPS: readonly string[] = ['wall_screen', 'tag_poster', 'notice_board', 'wall_clock', 'menu_board', 'cctv_wall', 'pressure_gauge', 'service_panel', 'directory_sign', 'bulkhead_wheel', 'pressure_manifold', 'status_board'];

export type PieceParams = Record<string, string | number | boolean>;

export type PieceFamily = 'structure' | 'prop';

export interface PieceDef {
  id: string;
  family: PieceFamily;
  /** Cells covered in x and z. Props use [0, 0] (placed freely in metres). */
  footprint: [number, number];
  generate(params: PieceParams, rng: Rng, m: Materials): PieceOutput;
  /**
   * A stand-in for an imported model (spec imported-props): when the registry has the model, it replaces only the
   * stand-in's visible meshes; colliders, surfaces, spots and keep-outs stay the stand-in's.
   */
  importedProp?: boolean;
  /** For imported props: the model's recorded cost, and the stand-in's own triangles, for the room budgets. */
  importedCost?: { materials: number; triangles: number; standInTriangles: number };
}

export function numParam(p: PieceParams, key: string, fallback: number): number {
  const v = p[key];
  return typeof v === 'number' ? v : fallback;
}

export function strParam(p: PieceParams, key: string, fallback: string): string {
  const v = p[key];
  return typeof v === 'string' ? v : fallback;
}

export function boolParam(p: PieceParams, key: string, fallback: boolean): boolean {
  const v = p[key];
  return typeof v === 'boolean' ? v : fallback;
}

/**
 * Collects a piece's meshes and metadata. Generators call add() for static detail (the
 * loader merges it per room and material) and dynamic() for anything that animates or
 * needs its own material (screens, glows).
 */
export class PieceBuilder {
  readonly object = new THREE.Group();
  readonly colliders: BoxSpec[] = [];
  readonly sockets: Socket[] = [];
  readonly lightSlots: LightSlot[] = [];
  readonly navNodes: Array<{ pos: Vec3 }> = [];
  readonly surfaces: Array<{ box: BoxSpec; material: SurfaceMaterial }> = [];
  readonly spots: SpotSlot[] = [];
  readonly keepouts: BoxSpec[] = [];
  private readonly ticks: Array<(t: number, dt: number) => void> = [];
  private readonly listeners: Array<{ event: string; fn: (payload: unknown) => void }> = [];

  /** React to a named event (bus event or level trigger emit). Payload is unknown: check it. */
  on(event: string, fn: (payload: unknown) => void): void {
    this.listeners.push({ event, fn });
  }

  add(geometry: THREE.BufferGeometry, material: THREE.Material, matrix?: THREE.Matrix4): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    if (matrix) mesh.applyMatrix4(matrix);
    this.object.add(mesh);
    return mesh;
  }

  dynamic<T extends THREE.Object3D>(object: T): T {
    object.userData.dynamic = true;
    this.object.add(object);
    return object;
  }

  /** Collider from min/max corners. */
  solid(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, surface?: SurfaceMaterial, acoustic?: 'glass'): void {
    const box: BoxSpec = { min: [minX, minY, minZ], max: [maxX, maxY, maxZ], ...(acoustic ? { acoustic } : {}) };
    this.colliders.push(box);
    if (surface) this.surfaces.push({ box, material: surface });
  }

  /** Collider from centre and size. */
  solidC(cx: number, cy: number, cz: number, w: number, h: number, d: number, surface?: SurfaceMaterial): void {
    this.solid(cx - w / 2, cy - h / 2, cz - d / 2, cx + w / 2, cy + h / 2, cz + d / 2, surface);
  }

  socket(name: string, pos: Vec3, dir: Vec3, kind?: SocketKind): void {
    this.sockets.push(kind ? { name, pos, dir, kind } : { name, pos, dir });
  }

  light(pos: Vec3, kind: LightSlotKind, ry = 0): void {
    this.lightSlots.push({ pos, kind, ry });
  }

  /** An activity spot (ADR-0029): feet at (x, y, z), facing `yaw` (radians, 0 faces -Z); `seat` is the seat surface height. */
  spot(kind: SpotKind, x: number, y: number, z: number, yaw: number, seat?: number): void {
    this.spots.push(seat !== undefined ? { kind, pos: [x, y, z], yaw, seat } : { kind, pos: [x, y, z], yaw });
  }

  /** Mark protruding wall structure that wall-mounted props must not overlap (piece space). */
  keepout(box: BoxSpec): void {
    this.keepouts.push(box);
  }

  nav(x: number, y: number, z: number): void {
    this.navNodes.push({ pos: [x, y, z] });
  }

  tick(fn: (t: number, dt: number) => void): void {
    this.ticks.push(fn);
  }

  build(): PieceOutput {
    const ticks = this.ticks;
    const out: PieceOutput = {
      object: this.object,
      colliders: this.colliders,
      sockets: this.sockets,
      lightSlots: this.lightSlots,
      navNodes: this.navNodes,
      surfaces: this.surfaces,
    };
    if (ticks.length) {
      out.tick = (t, dt) => {
        for (const f of ticks) f(t, dt);
      };
    }
    if (this.listeners.length) out.listeners = this.listeners;
    if (this.spots.length) out.spots = this.spots;
    if (this.keepouts.length) out.keepouts = this.keepouts;
    return out;
  }
}

/** Transform an axis-aligned box by a matrix and return the enclosing AABB. */
export function transformBox(box: BoxSpec, matrix: THREE.Matrix4): BoxSpec {
  const b = new THREE.Box3(new THREE.Vector3(...box.min), new THREE.Vector3(...box.max)).applyMatrix4(matrix);
  const r = (v: number): number => Math.round(v * 1e5) / 1e5;
  return {
    min: [r(b.min.x), r(b.min.y), r(b.min.z)],
    max: [r(b.max.x), r(b.max.y), r(b.max.z)],
    ...(box.acoustic ? { acoustic: box.acoustic } : {}),
  };
}
