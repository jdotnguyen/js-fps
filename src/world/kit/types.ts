import * as THREE from 'three';
import type { SampleName } from '../../audio/sounds.ts';
import type { Rng } from '../../core/rng.ts';
import type { Materials } from '../../render/materials.ts';
import type { SpotKind } from '../../data/types/level.ts';
import type { ColliderAcoustic } from '../collision.ts';

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
export const WINDOW_SILL = 0.9;
export const WINDOW_HEAD = 2.4;
export const MOONPOOL_WIDTH = 2.4;
/** Depth of the launch trunk below the deck, down to the outer hatch (rebuild-dive-bay). */
export const TRUNK_DEPTH = 3.0;
/** Depth of a room wall tile, measured inward from the cell edge. */
export const WALL_T = 0.25;
/** Outer back-face inset (m) so back-to-back walls on shared cell edges never z-fight. */
export const WALL_INSET = 0.002;

export type Vec3 = [number, number, number];

export interface BoxSpec {
  min: Vec3;
  max: Vec3;
  /** Marks a see-through partition and how hard it muffles sound (collision.ts `ColliderAcoustic`). */
  acoustic?: ColliderAcoustic;
  /** Initial enabled state for the collider (default true). */
  enabled?: boolean;
}

/** Handle returned by `PieceBuilder.solid` to toggle a collider's enabled state at runtime. */
export interface SolidRef {
  enabled: boolean;
  setEnabled(on: boolean): void;
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
  /** A fixture swinging on a pendulum (flooded-tunnel spec: a tube hanging loose): its glow and light follow the swing. */
  swing?: SlotSwing;
  /** Optional aim direction (piece space, unit vector) for a shadow spot; defaults to straight down (0, -1, 0). */
  aim?: Vec3;
  /** Optional dynamic Object3D (under the piece's object) whose world position this light follows each frame (no static diffuser). */
  follow?: THREE.Object3D;
}

/** Pendulum swing about the X axis through `pivot` (piece space): `amp` radians, `period` seconds. */
export interface SlotSwing {
  pivot: Vec3;
  amp: number;
  period: number;
  /**
   * Extra swing from knocks (a shot nearby, a scripted jolt; shadow-rich-rooms D6). The piece and the level share
   * this object (the level copies the swing with a spread), so both see the same knock.
   */
  jolt?: SwingJolt;
}

/** A damped pendulum added on top of the authored swing: angle (rad), angular velocity (rad/s), last advanced time (s). */
export interface SwingJolt {
  angle: number;
  vel: number;
  t: number;
}

/** A knock decays to a third in about this long (s). */
export const JOLT_DECAY = 1.6;
/** Largest extra swing a knock can build up (rad). */
export const JOLT_MAX = 0.5;

export function newJolt(): SwingJolt {
  return { angle: 0, vel: 0, t: -Infinity };
}

/** Knock a swing: add angular velocity (rad/s). */
export function joltSwing(j: SwingJolt, vel: number): void {
  j.vel += vel;
}

/** Advance a jolt to time t and return its angle. Calling it again at the same t changes nothing. */
export function advanceJolt(j: SwingJolt, t: number, period: number): number {
  if (!Number.isFinite(j.t) || t < j.t) {
    j.t = t;
    return j.angle;
  }
  let dt = Math.min(t - j.t, 0.25);
  j.t = t;
  const w = (2 * Math.PI) / period;
  const damp = 1 / JOLT_DECAY;
  while (dt > 1e-6) {
    const h = Math.min(dt, 1 / 120);
    j.vel += (-w * w * j.angle - 2 * damp * j.vel) * h;
    j.angle += j.vel * h;
    dt -= h;
  }
  if (Math.abs(j.angle) > JOLT_MAX) {
    j.angle = Math.sign(j.angle) * JOLT_MAX;
    j.vel = 0;
  }
  return j.angle;
}

/** Angle of a swinging slot at time t (the prop and the level both use it, so housing and glow stay together). */
export function swingAngle(s: Pick<SlotSwing, 'amp' | 'period' | 'jolt'>, t: number): number {
  const base = s.amp * Math.sin((2 * Math.PI * t) / s.period) + s.amp * 0.18 * Math.sin((2 * Math.PI * t) / (s.period * 2.7) + 1.1);
  return s.jolt ? base + advanceJolt(s.jolt, t, s.period) : base;
}

/** Positional looping sound declared by a kit prop (in piece space). */
export interface SoundLoopSlot {
  sound: SampleName;
  pos: Vec3;
  gain: number;
  /** Audible distance (m) beyond which the positional loop fades out and stops. Default 16. */
  maxDist?: number;
  rate?: number;
  cutoff?: number;
  reverb?: number;
  bus?: 'ambience' | 'sfx';
  /** Optional live gate (e.g. an active equipment fault); false fades the loop out. */
  active?: () => boolean;
}

/** Synchronized positional one-shot emitted by a kit prop (in piece space). */
export interface PropSoundEvent {
  sound: SampleName;
  pos: Vec3;
  gain?: number;
  rate?: number;
  reverb?: number;
  bus?: 'sfx' | 'ambience';
  maxDist?: number;
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
  /** Positional looping sounds owned by this prop (transformed into world space by Level). */
  soundLoops?: SoundLoopSlot[];
  /** Subscribe to synchronized positional one-shot sounds triggered by this prop. */
  onSound?: (fn: (ev: PropSoundEvent) => void) => void;
  /** Bind runtime collider handles back to `SolidRef`s created by `PieceBuilder.solid`. */
  bindCollider?: (index: number, collider: { enabled: boolean }) => void;
}

/** Props hung on a wall (back on their local z = 0): they must not overlap any wall piece's `keepouts`. */
export const WALL_MOUNTED_PROPS: readonly string[] = ['pa_speaker', 'wall_screen', 'tag_poster', 'notice_board', 'wall_clock', 'menu_board', 'cctv_wall', 'whiteboard', 'shadow_board', 'eyewash_station', 'room_sign', 'pressure_gauge', 'service_panel', 'directory_sign', 'bulkhead_wheel', 'pressure_manifold', 'status_board', 'tag_stencil'];

export type PieceParams = Record<string, string | number | boolean>;

export type PieceFamily = 'structure' | 'prop';

export interface PieceDef {
  id: string;
  family: PieceFamily;
  /** Cells covered in x and z. Props use [0, 0] (placed freely in metres). */
  footprint: [number, number];
  /**
   * A stand-in for an imported model (spec imported-props): when the registry has the model, it replaces only the
   * stand-in's visible meshes; colliders, surfaces, spots and keep-outs stay the stand-in's.
   */
  importedProp?: boolean;
  /** For imported props: the model's recorded cost, and the stand-in's own triangles, for the room budgets. */
  importedCost?: { materials: number; triangles: number; standInTriangles: number };
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
  readonly spots: SpotSlot[] = [];
  readonly keepouts: BoxSpec[] = [];
  readonly soundLoops: SoundLoopSlot[] = [];
  private readonly soundListeners: Array<(ev: PropSoundEvent) => void> = [];
  private readonly ticks: Array<(t: number, dt: number) => void> = [];
  private readonly listeners: Array<{ event: string; fn: (payload: unknown) => void }> = [];
  private readonly colliderRefs: Array<{ index: number; ref: SolidRef; bound: { enabled: boolean } | null }> = [];

  /** React to a named event (bus event or level trigger emit). Payload is unknown: check it. */
  on(event: string, fn: (payload: unknown) => void): void {
    this.listeners.push({ event, fn });
  }

  /** Declare a positional looping sound owned by this piece (in piece space). */
  soundLoop(slot: SoundLoopSlot): void {
    this.soundLoops.push(slot);
  }

  /** Trigger a synchronized positional one-shot sound from this piece (in piece space). */
  soundAt(sound: SampleName, pos: Vec3, opts: Omit<PropSoundEvent, 'sound' | 'pos'> = {}): void {
    const ev: PropSoundEvent = { sound, pos, ...opts };
    for (const fn of this.soundListeners) fn(ev);
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
  solid(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, surface?: SurfaceMaterial, acoustic?: ColliderAcoustic, enabled = true): SolidRef {
    const box: BoxSpec = { min: [minX, minY, minZ], max: [maxX, maxY, maxZ], ...(acoustic ? { acoustic } : {}), ...(enabled ? {} : { enabled: false }) };
    const index = this.colliders.length;
    this.colliders.push(box);
    if (surface) this.surfaces.push({ box, material: surface });
    const entry: { index: number; ref: SolidRef; bound: { enabled: boolean } | null } = {
      index,
      bound: null,
      ref: {
        enabled,
        setEnabled(on: boolean) {
          entry.ref.enabled = on;
          box.enabled = on;
          if (entry.bound) entry.bound.enabled = on;
        },
      },
    };
    this.colliderRefs.push(entry);
    return entry.ref;
  }

  /** Collider from centre and size. */
  solidC(cx: number, cy: number, cz: number, w: number, h: number, d: number, surface?: SurfaceMaterial): SolidRef {
    return this.solid(cx - w / 2, cy - h / 2, cz - d / 2, cx + w / 2, cy + h / 2, cz + d / 2, surface);
  }

  socket(name: string, pos: Vec3, dir: Vec3, kind?: SocketKind): void {
    this.sockets.push(kind ? { name, pos, dir, kind } : { name, pos, dir });
  }

  light(pos: Vec3, kind: LightSlotKind, ry = 0, swing?: SlotSwing, opts?: { aim?: Vec3; follow?: THREE.Object3D }): void {
    this.lightSlots.push({
      pos,
      kind,
      ry,
      ...(swing ? { swing } : {}),
      ...(opts?.aim ? { aim: opts.aim } : {}),
      ...(opts?.follow ? { follow: opts.follow } : {}),
    });
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
    if (this.soundLoops.length) out.soundLoops = this.soundLoops;
    if (this.colliderRefs.length) {
      const refs = this.colliderRefs;
      out.bindCollider = (index, collider) => {
        for (const r of refs) {
          if (r.index === index) {
            r.bound = collider;
            collider.enabled = r.ref.enabled;
          }
        }
      };
    }
    const soundListeners = this.soundListeners;
    out.onSound = (fn) => {
      soundListeners.push(fn);
    };
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
