import * as THREE from 'three';
import type { Rng } from '../../core/rng.ts';
import type { Materials } from '../../render/materials.ts';

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

export type Vec3 = [number, number, number];

export interface BoxSpec {
  min: Vec3;
  max: Vec3;
}

export const SURFACE_MATERIALS = ['metal', 'grate', 'rubber', 'water'] as const;
export type SurfaceMaterial = (typeof SURFACE_MATERIALS)[number];

export const LIGHT_SLOT_KINDS = ['ceiling', 'wall', 'emergency'] as const;
export type LightSlotKind = (typeof LIGHT_SLOT_KINDS)[number];

export interface Socket {
  name: string;
  pos: Vec3;
  dir: Vec3;
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
}

export type PieceParams = Record<string, string | number | boolean>;

export type PieceFamily = 'structure' | 'prop';

export interface PieceDef {
  id: string;
  family: PieceFamily;
  /** Cells covered in x and z. Props use [0, 0] (placed freely in metres). */
  footprint: [number, number];
  generate(params: PieceParams, rng: Rng, m: Materials): PieceOutput;
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
  private readonly ticks: Array<(t: number, dt: number) => void> = [];

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
  solid(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, surface?: SurfaceMaterial): void {
    const box: BoxSpec = { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
    this.colliders.push(box);
    if (surface) this.surfaces.push({ box, material: surface });
  }

  /** Collider from centre and size. */
  solidC(cx: number, cy: number, cz: number, w: number, h: number, d: number, surface?: SurfaceMaterial): void {
    this.solid(cx - w / 2, cy - h / 2, cz - d / 2, cx + w / 2, cy + h / 2, cz + d / 2, surface);
  }

  socket(name: string, pos: Vec3, dir: Vec3): void {
    this.sockets.push({ name, pos, dir });
  }

  light(pos: Vec3, kind: LightSlotKind, ry = 0): void {
    this.lightSlots.push({ pos, kind, ry });
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
    return out;
  }
}

/** Transform an axis-aligned box by a matrix and return the enclosing AABB. */
export function transformBox(box: BoxSpec, matrix: THREE.Matrix4): BoxSpec {
  const b = new THREE.Box3(new THREE.Vector3(...box.min), new THREE.Vector3(...box.max)).applyMatrix4(matrix);
  const r = (v: number): number => Math.round(v * 1e5) / 1e5;
  return { min: [r(b.min.x), r(b.min.y), r(b.min.z)], max: [r(b.max.x), r(b.max.y), r(b.max.z)] };
}
