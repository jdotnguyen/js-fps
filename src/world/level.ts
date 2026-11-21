import * as THREE from 'three';
import type { EventBus, EventName } from '../core/events.ts';
import { Rng } from '../core/rng.ts';
import { isKeyPickup, type SpotKind, type AmbientPreset, type DoorData, type DoorKit, type DoorState, type KeyPickupData, type LevelData, type RoomData, type TriggerData, type UnlockSource, type VentData } from '../data/types/level.ts';
import type { UiText } from '../data/types/uiText.ts';
import type { Inventory } from '../game/inventory.ts';
import { accessOpen, checkAccess, type AccessHint, type GateKind } from './access.ts';
import { createShaft } from '../render/fx/shafts.ts';
import { createOceanLife, type OceanZone } from '../render/fx/oceanLife.ts';
import { Particulates } from '../render/fx/particulates.ts';
import { LightController, type ControlledLight, type LightPattern, type ShaftUniforms } from '../render/lights.ts';
import { createDebugCheckerMaterial, fixtureMaterial, type Materials } from '../render/materials.ts';
import { CollisionWorld, type Collider } from './collision.ts';
import { at } from './kit/geom.ts';
import { grillePosition, selectPaSpeaker, type PaSpeaker } from './paSpeakers.ts';
import { buildDoor, type DoorVisual } from './kit/doors.ts';
import { GridOccupancy } from './kit/grid.ts';
import { HullBuilder, type ExteriorHull } from './kit/exteriorHull.ts';
import { AoMergeBuilder, applyWorldMeterUvs, withVertexColors, type AoFn } from './kit/merge.ts';
import { snapModelToSocket, type SnapOptions } from './kit/modelSnap.ts';
import { CELL, CORRIDOR_H, DECK_H, ROOM_H, WALL_MOUNTED_PROPS, transformBox, type BoxSpec, type LightSlotKind, type PieceOutput, type PieceParams, type Socket, type SocketKind } from './kit/types.ts';
import { LightPool, type PooledSlot } from './lightPool.ts';
import { flashingState } from '../render/flashing.ts';
import type { KitRegistry } from './registry.ts';
import type { Interactable, Interactions } from '../actors/interaction.ts';
import type { Aabb } from '../actors/motor.ts';
import { PLAYER_TUNING, type PlayerWorld } from '../actors/player.ts';
import type { World, WorldCheckpoint } from './world.ts';
import { gridNodes, NavGraph, type Navigator, type P3 } from '../ai/nav.ts';
import { NavMeshNav, navmeshReady } from '../ai/navmesh.ts';
import { buildExterior, type Exterior, type ExteriorWindow } from '../render/fx/exterior.ts';
import type { ExteriorLamp } from '../render/fx/exteriorLight.ts';

const EYE_HEIGHT = PLAYER_TUNING.eyeHeight;
/** Seconds an auto door stays open after reaching fully open while nobody is nearby. */
const AUTO_DOOR_HOLD = 5.0;
const AUTO_CLOSE_PLAYER_DIST = 3.6;
const AUTO_CLOSE_ACTOR_DIST = 2.8;

declare module '../core/events.ts' {
  interface EventMap {
    'room:entered': { id: string; name: string; reverb?: string | undefined; ambience?: string | undefined };
    'door:state': { id: string; state: DoorState };
    'door:opened': { id: string };
    'door:closed': { id: string };
    /** A door started opening or closing (or reversed mid-travel); drives spatial door foley. */
    'door:move': { id: string; kit: DoorKit; dir: 'open' | 'close'; progress: number; position: THREE.Vector3 };
    'door:unlocked': { id: string; by: UnlockSource };
    /** The player tried a door they cannot open; `reason` is shown to them. */
    'door:denied': { id: string; reason: string };
    /** A level trigger fired; `event` is its "emit" name, e.g. "trigger:r06_enter". */
    'trigger:fired': { id: string; event: string };
    /**
     * ADR-0024: the player tried a gated door or vent without what it needs. `hint` is the
     * text to show, with the item name marked for highlighting. The map uses id/requires/sealed.
     */
    'access:denied': { id: string; kind: GateKind; requires?: string | undefined; sealed?: boolean | undefined; hint: AccessHint };
    /** The player opened a gated door or vent with the item it needs (first time per session). */
    'access:granted': { id: string; kind: GateKind; requires: string };
    'vent:opened': { id: string };
    /** New game: the level went back to its authored state (blinds, screens, glass and camera feeds reset). */
    'level:reset': Record<string, never>;
  }
}

/** The Lab B outbreak: room R04's floor breaks when the glass partition `labb` cracks (drop.json). */
const LAB_B = { room: 'R04', glass: 'labb' } as const;

export interface LevelDeps {
  materials: Materials;
  registry: KitRegistry;
  events: EventBus;
  scene: THREE.Scene;
  /** Key items held, for access gating (ADR-0024). Without it gated doors never open. */
  inventory?: Inventory | null;
  /** data/dialogue/ui.json, for access hint text. */
  uiText?: UiText;
  /** Apply a uniform 1 m UV debug checkerboard to all procedural structural room geometry. */
  debugChecker?: boolean;
}

export const AMBIENT: Record<AmbientPreset, { sky: number; ground: number; intensity: number; keyColor: number; keyIntensity: number }> = {
  normal: { sky: 0x8fb0bd, ground: 0x0e1215, intensity: 0.22, keyColor: 0x88a9bd, keyIntensity: 0.28 },
  emergency: { sky: 0xb04a3a, ground: 0x120606, intensity: 0.16, keyColor: 0xa85040, keyIntensity: 0.22 },
  flooded: { sky: 0x2f7a80, ground: 0x031012, intensity: 0.24, keyColor: 0x4a9ca6, keyIntensity: 0.26 },
  dark: { sky: 0x4a5a64, ground: 0x050606, intensity: 0.07, keyColor: 0x566874, keyIntensity: 0.14 },
  dock: { sky: 0x9ec0d2, ground: 0x182128, intensity: 0.34, keyColor: 0x9ec2d4, keyIntensity: 0.32 },
  commons: { sky: 0xffe8cc, ground: 0x2a2018, intensity: 0.44, keyColor: 0xffdfba, keyIntensity: 0.34 },
  admin: { sky: 0xffebd6, ground: 0x241d17, intensity: 0.42, keyColor: 0xffe4c4, keyIntensity: 0.34 },
  hydro: { sky: 0xe6f2ea, ground: 0x1c2520, intensity: 0.42, keyColor: 0xf2faf4, keyIntensity: 0.34 },
  // Observation gallery (R03): dim and neutral, so its lamps and two ceiling pools carry the room and Lab B glows through the glass.
  gallery: { sky: 0x9ea6ab, ground: 0x0d0f11, intensity: 0.12, keyColor: 0xa4adb3, keyIntensity: 0.16 },
};
const DEFAULT_FOG = '#04080a';
const DEFAULT_FOG_DENSITY = 0.05;

const SLOT_DEFAULTS: Record<LightSlotKind, { color: string; intensity: number; range: number; emissive: number; drop: number }> = {
  ceiling: { color: '#dcefff', intensity: 10, range: 10, emissive: 3.2, drop: 0.22 },
  wall: { color: '#ffd9a8', intensity: 6, range: 7, emissive: 2.6, drop: 0.12 },
  emergency: { color: '#ff2a1a', intensity: 7, range: 8, emissive: 3, drop: -0.1 },
  // Hanging lamp bulb: warm, short range, the light just under the bulb so it pools on the table below.
  pendant: { color: '#ffcf99', intensity: 4, range: 4.5, emissive: 3, drop: 0.15 },
};

/** Distance from a point to a box (0 inside). */
function boxDistance(p: THREE.Vector3, c: Collider): number {
  const dx = Math.max(c.minX - p.x, 0, p.x - c.maxX);
  const dy = Math.max(c.minY - p.y, 0, p.y - c.maxY);
  const dz = Math.max(c.minZ - p.z, 0, p.z - c.maxZ);
  return Math.hypot(dx, dy, dz);
}

/**
 * Per-vertex AO from nearby colliders: a box darkens a vertex when it lies on the side
 * the vertex faces (so a wall never shades itself) and is close.
 */
function colliderAo(world: CollisionWorld): AoFn {
  const q = new THREE.Vector3();
  const list: Collider[] = [];
  const R = 0.9;
  return (p, n) => {
    q.copy(p).addScaledVector(n, 0.12);
    world.find(q.x - R, q.z - R, q.x + R, q.z + R, list);
    let ao = 1;
    for (const c of list) {
      if (q.y < c.minY - R || q.y > c.maxY + R) continue;
      const cx = (c.minX + c.maxX) / 2 - p.x;
      const cy = (c.minY + c.maxY) / 2 - p.y;
      const cz = (c.minZ + c.maxZ) / 2 - p.z;
      if (cx * n.x + cy * n.y + cz * n.z <= 0) continue;
      const d = boxDistance(q, c);
      if (d > R) continue;
      ao *= 1 - 0.5 * Math.exp(-d / 0.3);
    }
    return Math.max(0.32, ao);
  };
}

interface RoomRuntime {
  data: RoomData;
  index: number;
  height: number;
  group: THREE.Group;
  cells: THREE.Box3[];
  slots: Array<PooledSlot & { kind: LightSlotKind }>;
  ticks: Array<(t: number, dt: number) => void>;
  staticMeshes: THREE.Mesh[];
  merger: AoMergeBuilder;
  ambient: { sky: THREE.Color; ground: THREE.Color; intensity: number; keyColor: THREE.Color; keyIntensity: number };
  fog: THREE.Color;
  fogDensity: number;
  visible: boolean;
  stats: { drawCalls: number; triangles: number; materials: number };
}

interface DoorRuntime {
  data: DoorData;
  visual: DoorVisual;
  group: THREE.Group;
  collider: Collider;
  rooms: [RoomRuntime, RoomRuntime];
  state: DoorState;
  open: number;
  target: number;
  center: THREE.Vector3;
  /** Seconds the player has been away from an open auto door. */
  away: number;
  /** Current leaf motion direction, for emitting `door:move` only on starts and reversals. */
  moving: 'open' | 'close' | null;
  auto: boolean;
  staticMeshes: THREE.Mesh[];
  /** Box the interact ray tests (the closed leaves, a little proud on both sides). */
  useBox: Aabb;
  /** `access:granted` already sent this session. */
  granted: boolean;
}

interface VentRuntime {
  data: VentData;
  box: Aabb;
  open: boolean;
  granted: boolean;
}

interface PickupRuntime {
  data: KeyPickupData;
  mesh: THREE.Group;
  box: Aabb;
}

interface TriggerRuntime {
  data: TriggerData;
  room: RoomRuntime;
  box: THREE.Box3;
  inside: boolean;
  fired: boolean;
}

export interface LevelDebugData {
  sockets: Array<{ pos: THREE.Vector3; dir: THREE.Vector3 }>;
  slots: Array<{ pos: THREE.Vector3; kind: LightSlotKind; claimed: boolean }>;
  nav: THREE.Vector3[];
  rooms: Array<{ id: string; name: string; cells: THREE.Box3[] }>;
  triggers: THREE.Box3[];
  bounds: THREE.Box3;
  /** Protruding wall structure, in world space: `source` is `<kit>@<cell>`. */
  keepouts: Array<{ room: string; source: string; box: THREE.Box3 }>;
  /** Mesh bounds of wall-mounted props (`WALL_MOUNTED_PROPS`), in world space: `source` is `<kit>[:<id>]@<pos>`. */
  wallProps: Array<{ room: string; source: string; boxes: THREE.Box3[] }>;
}

export interface RoomStats {
  id: string;
  name: string;
  drawCalls: number;
  triangles: number;
  materials: number;
}

const deg = THREE.MathUtils.degToRad;

/** How far (m) a level NPC's `at` may be from the spot it claims (ADR-0029). */
export const SPOT_REACH = 1.5;

/** An activity spot in world space (ADR-0029). */
export interface WorldSpot {
  /** `<room>:<prop index>:<n>`. */
  id: string;
  room: string;
  /** The prop it belongs to (`<room>:<prop index>`): a table's seats share one. */
  group: string;
  kind: SpotKind;
  /** The body's feet. */
  pos: THREE.Vector3;
  /** Facing, radians (0 faces -Z). */
  yaw: number;
  /** Seat surface height (m, world y) for seated kinds. */
  seat?: number;
  /** The NPC holding it, if any. */
  taken: string | null;
}

/** A level-placed NPC, resolved (`Level.npcSpawns()`). */
export interface LevelNpc {
  id: string;
  look: string;
  pos: THREE.Vector3;
  yaw: number;
  pose?: string;
  transformable?: boolean;
  /** The activity spot it holds (ADR-0029) and that spot's seat height. */
  spot?: string;
  seat?: number;
  /** Conversation group (ADR-0029). */
  chat?: string;
  /** Imported body id, overriding the look's pick. */
  model?: string;
  room: string;
}

/** Placement matrix for a grid cell and a rotation in degrees. */
function cellMatrix(cell: [number, number, number], rot: number): THREE.Matrix4 {
  return at(cell[0] * CELL, cell[1] * DECK_H, cell[2] * CELL, 0, deg(rot), 0);
}

/** Load every GLB the level needs, then build it. */
export async function loadLevel(data: LevelData, deps: LevelDeps): Promise<Level> {
  const ids = data.rooms.flatMap((r) => [...r.pieces.map((p) => p.kit), ...(r.props ?? []).map((p) => p.kit)]);
  await deps.registry.preload(ids);
  return new Level(data, deps);
}

/**
 * A data-driven kit level (ADR-0003): rooms built from pieces, merged per room and
 * material with baked AO, doors and triggers that emit events, portal-by-adjacency
 * culling and a fixed light pool shared by the visible rooms.
 */
export class Level implements World {
  readonly id: string;
  /** The validated level data (the map, ADR-0024, and supply pickups read it). */
  readonly source: LevelData;
  readonly name: string;
  readonly group = new THREE.Group();
  readonly lights = new LightController();
  readonly collision = new CollisionWorld(2);
  readonly spawn: { position: THREE.Vector3; yaw: number };
  readonly bounds = null;
  readonly playerWorld: PlayerWorld;
  readonly checkpoints: WorldCheckpoint[];
  readonly defaultLocation: string;
  readonly debug: LevelDebugData;
  readonly pool: LightPool;
  private readonly deps: LevelDeps;
  private readonly rooms: RoomRuntime[] = [];
  private readonly paSpeakers: PaSpeaker[] = [];
  private readonly roomById = new Map<string, RoomRuntime>();
  private readonly doors: DoorRuntime[] = [];
  private readonly hull: ExteriorHull;
  /** Everything outside the station, built once (openspec change overhaul-exterior-ocean). */
  private readonly exterior: Exterior;
  private readonly exteriorWindows: ExteriorWindow[] = [];
  /** Rooms with real windows: the exterior draws only while one of them is visible. */
  private readonly exteriorRooms = new Set<string>();
  /** Lamps carried by pieces (the supply sub's headlamps), lighting the exterior while shown. */
  private readonly exteriorLampMarkers: THREE.Object3D[] = [];
  private readonly movingLamps: ExteriorLamp[] = [];
  private readonly triggers: TriggerRuntime[] = [];
  private readonly vents: VentRuntime[] = [];
  private readonly pickups: PickupRuntime[] = [];
  /** Activity spots (ADR-0029) from kit props, in world space. `group` is the prop (a table's seats share it). */
  private readonly spotList: WorldSpot[] = [];
  /** Named positions from room `anchors` (yaw in radians). */
  private readonly anchors = new Map<string, { pos: THREE.Vector3; yaw: number; room: string }>();
  /** Controllable named props (e.g. dock_chair, dock_wand) whose transform/visibility and colliders stay in sync. */
  private readonly movableProps = new Map<
    string,
    {
      object: THREE.Object3D;
      yaw: number;
      initialPos: THREE.Vector3;
      initialYaw: number;
      initialVisible: boolean;
      localColliders: BoxSpec[];
      colliders: Collider[];
    }
  >();
  private readonly npcList: LevelNpc[] = [];
  private readonly named = new Map<string, Set<() => void>>();
  /** Authored walks by id (ADR-0028). */
  private readonly walks = new Map<string, NonNullable<LevelData['rooms'][number]['walks']>[number]>();
  private readonly hemi: THREE.HemisphereLight;
  private readonly keyFill: THREE.DirectionalLight;
  private readonly dust: Particulates;
  private readonly visibleSlots: PooledSlot[] = [];
  private current: RoomRuntime | null = null;
  /** Light patterns as authored (resetToData), and the colours a tint replaced (tintRoomLights). */
  private initialPatterns: LightPattern[] = [];
  private lastTime = 0;
  private lastFlashing = false;
  private readonly tinted = new Map<string, { slots: THREE.Color[]; glows: THREE.Color[]; sky: THREE.Color; ground: THREE.Color; intensity: number }>();
  private atmosphereReady = false;
  private readonly scratch2 = new THREE.Vector3();
  private feetY = 0;
  /** Merged Lab B floor meshes (labTile) that swap to tileBroken after the outbreak. */
  private readonly labbFloor: THREE.Mesh[] = [];
  private readonly roomSockets: Array<Socket & { room: string }> = [];
  private readonly checkerTargets: Array<{ mesh: THREE.Mesh; origMat: THREE.Material; origUv: THREE.BufferAttribute | null }> = [];
  private checkerMat: THREE.Material | null = null;
  private checkerActive = false;

  constructor(data: LevelData, deps: LevelDeps) {
    this.deps = deps;
    this.id = data.id;
    this.source = data;
    this.name = data.name ?? data.id;
    this.group.name = `level:${data.id}`;
    const rng = new Rng(`${data.id}:${data.seed}`);
    this.debug = { sockets: [], slots: [], nav: [], rooms: [], triggers: [], bounds: new THREE.Box3(), keepouts: [], wallProps: [] };
    this.pool = new LightPool(this.group, 8);
    this.hemi = new THREE.HemisphereLight(AMBIENT.normal.sky, AMBIENT.normal.ground, AMBIENT.normal.intensity);
    this.group.add(this.hemi);
    this.keyFill = new THREE.DirectionalLight(AMBIENT.normal.keyColor, AMBIENT.normal.keyIntensity);
    this.keyFill.name = 'level-key-fill';
    this.keyFill.position.set(12, 24, 16);
    this.keyFill.castShadow = false;
    this.group.add(this.keyFill);

    const occupancy = new GridOccupancy();
    for (const d of data.doors) {
      const claim = occupancy.claimDoor(d.id, d.cell, d.rot);
      if (!claim.ok) console.warn(`[level] ${claim.reason}`);
    }
    const hull = new HullBuilder();
    for (const [index, r] of data.rooms.entries()) this.buildRoom(r, index, rng, occupancy, hull);
    this.hull = hull.build(data.doors, deps.materials);
    this.group.add(this.hull.group);
    this.exterior = buildExterior({ columns: this.hull.columns, windows: this.exteriorWindows, steel: deps.materials.paintDark, rng: rng.fork('exterior') });
    this.group.add(this.exterior.group);
    this.group.traverse((o) => {
      if (o.name === 'exterior-lamp') this.exteriorLampMarkers.push(o);
    });
    for (const d of data.doors) this.buildDoor(d, rng);
    this.initialPatterns = this.lights.items.map((it) => it.pattern);
    // Bake AO and merge once every collider exists, so walls shade across room seams.
    const ao = colliderAo(this.collision);
    for (const room of this.rooms) {
      for (const mesh of room.staticMeshes) room.merger.addMesh(mesh);
      room.staticMeshes.length = 0;
      room.stats.materials = room.merger.materialCount;
      room.group.add(room.merger.build(`room:${room.data.id}`, ao));
      room.group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          room.stats.drawCalls++;
          const g = o.geometry;
          room.stats.triangles += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
        }
      });
      this.addImportedCost(room);
    }
    this.collectLabBFloor();
    this.deps.events.on('glass:set' as EventName, ((e: { id?: string; state?: string } | undefined) => {
      if (e?.id === LAB_B.glass && (e.state === 'cracked' || e.state === 'shattered')) this.breakLabBFloor(true);
    }) as never);
    this.deps.events.on('level:reset', () => {
      this.breakLabBFloor(false);
      for (const [id, mp] of this.movableProps) {
        this.setPropTransform(id, mp.initialPos, mp.initialYaw);
        this.setPropVisible(id, mp.initialVisible);
      }
    });
    for (const door of this.doors) {
      const mb = new AoMergeBuilder();
      for (const mesh of door.staticMeshes) mb.addMesh(mesh);
      door.staticMeshes.length = 0;
      door.group.add(mb.build(`door:${door.data.id}`, ao));
    }
    if (deps.debugChecker) this.setDebugChecker(true);
    for (const v of data.vents ?? []) {
      const [min, max] = v.box;
      this.vents.push({ data: v, box: { min, max }, open: false, granted: false });
    }
    // Key items only; supply pickups (ammo, medkits) live in game/pickups.ts.
    for (const pk of data.pickups ?? []) if (isKeyPickup(pk)) this.buildPickup(pk);
    for (const r of data.rooms) for (const w of r.walks ?? []) this.walks.set(w.id, w);
    for (const r of data.rooms) for (const a of r.anchors ?? []) this.anchors.set(a.id, { pos: new THREE.Vector3(...a.pos), yaw: deg(a.yaw ?? 0), room: r.id });
    for (const r of data.rooms) {
      for (const n of r.npcs ?? []) {
        const a = typeof n.at === 'string' ? this.anchors.get(n.at) : null;
        let pos = a ? a.pos.clone() : new THREE.Vector3(...(n.at as [number, number, number]));
        let yaw = n.yaw !== undefined ? deg(n.yaw) : (a?.yaw ?? 0);
        let pose = n.pose;
        let spot: WorldSpot | null = null;
        if (n.spot) {
          // ADR-0029: claim the nearest free spot of the kind (seats come from kit props); lean kinds are just a pose.
          pose ??= n.spot;
          if (n.spot.startsWith('sit_')) {
            spot = this.claimSpot(r.id, n.spot, pos, n.id);
            if (spot) {
              pos = spot.pos.clone();
              if (n.yaw === undefined) yaw = spot.yaw;
            } else console.warn(`[level] npc ${n.id}: no free ${n.spot} spot within ${SPOT_REACH} m of its "at"`);
          }
        }
        this.npcList.push({
          id: n.id,
          look: n.look,
          pos,
          yaw,
          ...(pose !== undefined ? { pose } : {}),
          ...(n.transformable ? { transformable: true } : {}),
          ...(spot ? { spot: spot.id, ...(spot.seat !== undefined ? { seat: spot.seat } : {}) } : {}),
          ...(n.chat ? { chat: n.chat } : {}),
          ...(n.model ? { model: n.model } : {}),
          room: r.id,
        });
      }
    }

    const start = data.playerStart;
    this.spawn = { position: new THREE.Vector3(start.pos[0], start.pos[1] + EYE_HEIGHT, start.pos[2]), yaw: deg(start.yaw) };
    const startRoom = this.roomById.get(start.room);
    this.defaultLocation = startRoom?.data.name ?? this.name;
    this.checkpoints = data.checkpoints.map((cp) => {
      const room = this.roomById.get(cp.room)!;
      return { id: cp.id, label: room.data.name, reached: (feet: THREE.Vector3) => this.roomAt(this.scratch2.copy(feet).setY(feet.y + 0.5)) === room };
    });
    this.playerWorld = {
      colliders: this.collision,
      surfaceAt: (x, z) => this.collision.surfaceAt(x, this.feetY, z) ?? 'metal',
    };

    this.dust = new Particulates(rng.fork('dust'), 1400, 6, 0, 4.5);
    this.group.add(this.dust.points);
    for (const r of this.rooms) this.debug.rooms.push({ id: r.data.id, name: r.data.name, cells: r.cells });
    for (const r of this.rooms) for (const c of r.cells) this.debug.bounds.union(c);
  }

  // ---------------------------------------------------------------- building

  private buildRoom(r: RoomData, index: number, rng: Rng, occupancy: GridOccupancy, hull: HullBuilder): void {
    const { materials: m, registry } = this.deps;
    const height = r.height ?? ROOM_H;
    const preset = AMBIENT[r.atmosphere?.ambient ?? 'normal'];
    const room: RoomRuntime = {
      data: r,
      index,
      height,
      group: new THREE.Group(),
      cells: [],
      slots: [],
      ticks: [],
      staticMeshes: [],
      merger: new AoMergeBuilder(),
      ambient: {
        sky: new THREE.Color(preset.sky),
        ground: new THREE.Color(preset.ground),
        intensity: preset.intensity,
        keyColor: new THREE.Color(preset.keyColor),
        keyIntensity: preset.keyIntensity,
      },
      fog: new THREE.Color(r.atmosphere?.fog ?? DEFAULT_FOG),
      fogDensity: r.atmosphere?.fogDensity ?? DEFAULT_FOG_DENSITY,
      visible: true,
      stats: { drawCalls: 0, triangles: 0, materials: 0 },
    };
    room.group.name = `room:${r.id}`;
    this.group.add(room.group);
    this.rooms.push(room);
    this.roomById.set(r.id, room);

    const cellKeys = new Set<string>();
    const rawSlots: Array<{ pos: THREE.Vector3; kind: LightSlotKind; ry: number }> = [];
    for (const piece of r.pieces) {
      const cells = piece.cells ?? (piece.cell ? [piece.cell] : []);
      for (const cell of cells) {
        const rot = piece.rot ?? 0;
        if (piece.kit.startsWith('wall_')) {
          const claim = occupancy.claimWall(r.id, piece.kit, cell, rot);
          if (!claim.ok) {
            console.warn(`[level] skipping overlapping wall: ${claim.reason}`);
            continue;
          }
        }
        const matrix = cellMatrix(cell, rot);
        const params: PieceParams = { height, ...(r.area !== undefined ? { area: r.area } : {}), ...(piece.params ?? {}) };
        const out = registry.create(piece.kit, params, rng.fork(`${r.id}:${piece.kit}:${cell.join(',')}`), m);
        const hullHeight = (piece.kit.startsWith('wall_') || piece.kit.startsWith('ceiling')) && typeof params.height === 'number' ? params.height : height;
        hull.addPiece(r.id, cell, piece.kit, rot, hullHeight, out.sockets);
        for (const k of out.keepouts ?? []) {
          const box = new THREE.Box3(new THREE.Vector3(...k.min), new THREE.Vector3(...k.max)).applyMatrix4(matrix);
          this.debug.keepouts.push({ room: r.id, source: `${piece.kit}@${cell.join(',')}`, box });
        }
        this.integrate(room, out, matrix, deg(rot), rawSlots);
        const key = cell.join(',');
        if (!cellKeys.has(key)) {
          cellKeys.add(key);
          const x = cell[0] * CELL;
          const y = cell[1] * DECK_H;
          const z = cell[2] * CELL;
          room.cells.push(new THREE.Box3(new THREE.Vector3(x - 2, y - 0.5, z - 2), new THREE.Vector3(x + 2, y + Math.max(height, CORRIDOR_H), z + 2)));
        }
      }
    }
    for (const [pi, prop] of (r.props ?? []).entries()) {
      const ry = deg(prop.rot ?? 0);
      const matrix = at(prop.pos[0], prop.pos[1], prop.pos[2], 0, ry, 0);
      if (prop.kit === 'pa_speaker' && typeof prop.params?.id === 'string') {
        const adjacentRoom = prop.params.serves;
        this.paSpeakers.push({ id: prop.params.id, room: r.id, position: grillePosition(matrix),
          ...(typeof adjacentRoom === 'string' ? { adjacentRoom } : {}) });
      }
      const params: PieceParams = { ceiling: height - prop.pos[1], ...(r.area !== undefined ? { area: r.area } : {}), ...(prop.params ?? {}) };
      const out = registry.create(prop.kit, params, rng.fork(`${r.id}:${prop.kit}:${prop.pos.join(',')}`), m);
      if (WALL_MOUNTED_PROPS.includes(prop.kit)) {
        // One box per mesh: a prop's overall bounds would join its wall bracket to its face and flag trim it only sits in front of.
        out.object.updateMatrixWorld(true);
        const boxes: THREE.Box3[] = [];
        out.object.traverse((c) => {
          if (c instanceof THREE.Mesh) boxes.push(new THREE.Box3().setFromObject(c).applyMatrix4(matrix));
        });
        const id = typeof prop.params?.['id'] === 'string' ? `:${prop.params['id']}` : '';
        this.debug.wallProps.push({ room: r.id, source: `${prop.kit}${id}@${prop.pos.join(',')}`, boxes });
      }
      (out.spots ?? []).forEach((s, i) => {
        this.spotList.push({
          id: `${r.id}:${pi}:${i}`,
          room: r.id,
          group: `${r.id}:${pi}`,
          kind: s.kind,
          pos: new THREE.Vector3(...s.pos).applyMatrix4(matrix),
          yaw: Math.atan2(Math.sin(s.yaw + ry), Math.cos(s.yaw + ry)),
          ...(s.seat !== undefined ? { seat: s.seat + prop.pos[1] } : {}),
          taken: null,
        });
      });
      this.integrate(room, out, matrix, ry, rawSlots);
    }

    // Claim light slots.
    const claimed = new Set<number>();
    for (const [li, light] of (r.lights ?? []).entries()) {
      let idx = -1;
      if (typeof light.slot === 'number') idx = light.slot < rawSlots.length && !claimed.has(light.slot) ? light.slot : -1;
      else {
        const kind = light.slot;
        idx = rawSlots.findIndex((s, i) => !claimed.has(i) && (kind === 'auto' || s.kind === kind));
      }
      if (idx < 0) {
        console.warn(`[level] ${r.id} lights[${li}]: no free slot for "${light.slot}" (room has ${rawSlots.length})`);
        continue;
      }
      claimed.add(idx);
      const slot = rawSlots[idx]!;
      const def = SLOT_DEFAULTS[slot.kind];
      const color = new THREE.Color(light.color ?? def.color);
      const emissiveBase = light.emissive ?? def.emissive;
      const shaftBase = light.shaft ?? (slot.kind === 'ceiling' ? 0.05 : 0);
      const drop = light.drop ?? def.drop;
      const glow = fixtureMaterial(color, emissiveBase);
      const mesh = new THREE.Mesh(glowGeometry(slot.kind), glow);
      mesh.position.copy(slot.pos);
      mesh.rotation.y = slot.ry;
      room.group.add(mesh);
      const shafts: ShaftUniforms[] = [];
      if (slot.kind === 'ceiling' && shaftBase > 0) {
        const len = Math.min(slot.pos.y - 0.15, 3.2);
        const shaft = createShaft(0.55, 1.6, len, color);
        shaft.mesh.position.set(slot.pos.x, slot.pos.y - 0.04 - len / 2, slot.pos.z);
        shaft.mesh.rotation.y = slot.ry;
        room.group.add(shaft.mesh);
        room.ticks.push((t) => {
          shaft.uniforms.uTime.value = t;
        });
        shafts.push(shaft.uniforms);
      }
      const item = this.lights.add({
        name: `${r.id} #${idx} ${slot.kind}`,
        light: null,
        base: light.intensity ?? def.intensity,
        pattern: light.pattern,
        seed: 17 + index * 101 + idx * 31,
        emissives: [glow],
        emissiveBase,
        shafts,
        shaftBase,
      });
      room.slots.push({
        item,
        position: slot.pos.clone().setY(slot.pos.y - drop),
        color,
        range: light.range ?? def.range,
        priority: 0,
        kind: slot.kind,
        ...(light.pool === false ? { pooled: false } : {}),
        score: 0,
      });
    }
    rawSlots.forEach((s, i) => {
      this.debug.slots.push({ pos: s.pos.clone(), kind: s.kind, claimed: claimed.has(i) });
      if (!claimed.has(i)) {
        // A dead fixture: dark diffuser, merged with the room.
        const dead = glowGeometry(s.kind);
        room.merger.add(dead, this.deps.materials.black, at(s.pos.x, s.pos.y, s.pos.z, 0, s.ry, 0));
      }
    });

    for (const t of r.triggers ?? []) {
      const box = new THREE.Box3(new THREE.Vector3(...t.box[0]), new THREE.Vector3(...t.box[1]));
      this.triggers.push({ data: t, room, box, inside: false, fired: false });
      this.debug.triggers.push(box);
    }

    // Batch 3D exterior ocean life (fish + bubbles/plankton) once per windowed room (1 Mesh + 1 Points).
    const oceanMarkers: THREE.Object3D[] = [];
    const oceanZones: OceanZone[] = [];
    room.group.updateMatrixWorld(true);
    for (const child of room.group.children) {
      const meta = child.userData['oceanZone'] as { width: number; depth: number; flicker?: boolean } | undefined;
      if (!meta) continue;
      oceanMarkers.push(child);
      this.exteriorWindows.push({ room: r.id, matrix: child.matrixWorld.clone(), width: meta.width, flicker: meta.flicker === true });
      this.exteriorRooms.add(r.id);
      oceanZones.push({ matrix: child.matrixWorld.clone(), width: meta.width, depth: meta.depth });
    }
    for (const mk of oceanMarkers) room.group.remove(mk);
    if (oceanZones.length) {
      const ocean = createOceanLife(oceanZones, rng.fork(`${r.id}:ocean`));
      room.group.add(ocean.group);
      room.ticks.push((t) => ocean.update(t));
    }
  }

  /** Activity spots (ADR-0029) in world space, optionally for one room. Read-only views: `taken` names the NPC holding it. */
  spots(roomId?: string): readonly Readonly<WorldSpot>[] {
    return roomId ? this.spotList.filter((s) => s.room === roomId) : this.spotList;
  }

  /** The nearest free spot of `kind` in the room within SPOT_REACH of `near` (XZ), marked as taken by `by`. */
  private claimSpot(room: string, kind: SpotKind, near: THREE.Vector3, by: string): WorldSpot | null {
    let best: WorldSpot | null = null;
    let bestD = SPOT_REACH;
    for (const s of this.spotList) {
      if (s.room !== room || s.kind !== kind || s.taken) continue;
      const d = Math.hypot(s.pos.x - near.x, s.pos.z - near.z);
      if (d <= bestD) {
        bestD = d;
        best = s;
      }
    }
    if (best) best.taken = by;
    return best;
  }

  /** World-space floor, wall, and door sockets collected from built kit pieces. */
  sockets(roomId?: string, kind?: SocketKind): Array<Socket & { room: string }> {
    return this.roomSockets.filter((s) => (!roomId || s.room === roomId) && (!kind || s.kind === kind));
  }

  /**
   * Snap a 3D model onto a named room socket at true-to-life FPS scale and attach it to the room.
   * Returns true when the socket and room exist.
   */
  snapModelToSocket(model: THREE.Object3D, roomId: string, socketName: string, options?: SnapOptions): boolean {
    const room = this.roomById.get(roomId);
    const socket = this.roomSockets.find((s) => s.room === roomId && s.name === socketName);
    if (!room || !socket) return false;
    snapModelToSocket(model, socket, options);
    room.group.add(model);
    return true;
  }

  get debugCheckerEnabled(): boolean {
    return this.checkerActive;
  }

  /** Toggle the uniform 1 m UV debug checkerboard material across all static procedural room & doorframe geometry. */
  setDebugChecker(enabled: boolean): void {
    if (enabled === this.checkerActive) return;
    if (!this.checkerTargets.length) {
      const collect = (group: THREE.Group): void => {
        group.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return;
          const mat = Array.isArray(o.material) ? o.material[0] : o.material;
          if (!mat || mat.transparent) return;
          if (mat instanceof THREE.MeshStandardMaterial && mat.emissiveIntensity > 0.5 && mat.color.getHex() === 0) return;
          const uv = o.geometry.getAttribute('uv');
          const origUv = uv instanceof THREE.BufferAttribute ? uv.clone() : null;
          this.checkerTargets.push({ mesh: o, origMat: mat, origUv });
        });
      };
      for (const room of this.rooms) collect(room.group);
      for (const door of this.doors) collect(door.group);
      collect(this.hull.group);
    }
    this.checkerMat ??= withVertexColors(createDebugCheckerMaterial());
    this.checkerActive = enabled;
    for (const t of this.checkerTargets) {
      if (enabled) {
        applyWorldMeterUvs(t.mesh.geometry, 1);
        t.mesh.material = this.checkerMat;
      } else {
        if (t.origUv) t.mesh.geometry.setAttribute('uv', t.origUv.clone());
        t.mesh.material = t.origMat;
      }
    }
  }

  /** Find the merged labTile meshes of Lab B once the rooms are built. */
  private collectLabBFloor(): void {
    const room = this.roomById.get(LAB_B.room);
    const { labTile } = this.deps.materials;
    if (!room) return;
    room.group.traverse((o) => {
      if (o instanceof THREE.Mesh && (o.material === labTile || o.material === withVertexColors(labTile))) this.labbFloor.push(o);
    });
  }

  /**
   * Lab B outbreak (the `glass labb cracked` beat of the drop sequence): the floor swaps from clean
   * `labTile` to `tileBroken` (same tile grid, tiles missing). `false` restores it (new game).
   */
  breakLabBFloor(broken = true): void {
    const { labTile, tileBroken } = this.deps.materials;
    const to = broken ? tileBroken : labTile;
    for (const mesh of this.labbFloor) {
      const baked = mesh.material !== labTile && mesh.material !== tileBroken;
      mesh.material = baked ? withVertexColors(to) : to;
    }
  }

  /** Place a piece: dynamic parts join the room group, static meshes wait for merging. */
  private integrate(room: RoomRuntime, out: PieceOutput, matrix: THREE.Matrix4, ry: number, slots: Array<{ pos: THREE.Vector3; kind: LightSlotKind; ry: number }>): void {
    const obj = out.object;
    obj.applyMatrix4(matrix);
    obj.updateMatrixWorld(true);
    let movableObj: { id: string; object: THREE.Object3D } | null = null;
    for (const child of [...obj.children]) {
      if (child.userData.dynamic) {
        room.group.attach(child);
        if (typeof child.userData['propId'] === 'string') movableObj = { id: child.userData['propId'], object: child };
        child.traverse((c) => {
          if (c instanceof THREE.Mesh) {
            const mat = Array.isArray(c.material) ? c.material[0] : c.material;
            if (c.name.startsWith('seabed')) return; // far outside the glass: no shadow pass
            c.castShadow = !!mat && !mat.transparent && !(mat instanceof THREE.MeshStandardMaterial && mat.emissiveIntensity > 0.5 && mat.color.getHex() === 0);
            c.receiveShadow = true;
          }
        });
      } else if (child instanceof THREE.Mesh) {
        room.staticMeshes.push(child);
      } else {
        // GLB subtree: merge its meshes.
        child.traverse((c) => {
          if (c instanceof THREE.Mesh) room.staticMeshes.push(c);
        });
      }
    }
    const addedColliders = this.addColliders(out, matrix, `room:${room.data.id}`);
    if (movableObj) {
      movableObj.object.rotation.order = 'YXZ';
      movableObj.object.rotation.set(0, ry, 0);
      movableObj.object.updateMatrixWorld(true);
      this.movableProps.set(movableObj.id, {
        object: movableObj.object,
        yaw: ry,
        initialPos: movableObj.object.position.clone(),
        initialYaw: ry,
        initialVisible: movableObj.object.visible,
        localColliders: out.colliders.map((c) => ({ min: [...c.min], max: [...c.max], ...(c.acoustic ? { acoustic: c.acoustic } : {}) })),
        colliders: addedColliders.slice(0, out.colliders.length),
      });
    }
    for (const s of out.lightSlots) slots.push({ pos: new THREE.Vector3(...s.pos).applyMatrix4(matrix), kind: s.kind, ry: s.ry + ry });
    for (const s of out.sockets) {
      const pos = new THREE.Vector3(...s.pos).applyMatrix4(matrix);
      const dir = new THREE.Vector3(...s.dir).transformDirection(matrix);
      this.debug.sockets.push({ pos, dir });
      this.roomSockets.push({
        room: room.data.id,
        name: s.name,
        pos: [pos.x, pos.y, pos.z],
        dir: [dir.x, dir.y, dir.z],
        ...(s.kind ? { kind: s.kind } : {}),
      });
    }
    for (const n of out.navNodes) this.debug.nav.push(new THREE.Vector3(...n.pos).applyMatrix4(matrix));
    if (out.tick) room.ticks.push(out.tick);
    for (const l of out.listeners ?? []) {
      this.deps.events.on(l.event as EventName, l.fn as never);
      this.onNamed(l.event, () => l.fn(undefined));
    }
  }

  /** Move a controllable named prop (e.g. dock_chair) and keep its collision boxes aligned. */
  setPropTransform(id: string, pos: { x: number; y: number; z: number }, yaw: number): boolean {
    const mp = this.movableProps.get(id);
    if (!mp) return false;
    mp.yaw = yaw;
    mp.object.position.set(pos.x, pos.y, pos.z);
    mp.object.rotation.set(0, yaw, 0);
    mp.object.updateMatrixWorld(true);
    const mat = at(pos.x, pos.y, pos.z, 0, yaw, 0);
    for (let i = 0; i < mp.colliders.length; i++) {
      const col = mp.colliders[i];
      const local = mp.localColliders[i];
      if (col && local) this.collision.move(col, transformBox(local, mat));
    }
    return true;
  }

  /** Show or hide a controllable named prop (e.g. dock_wand). */
  setPropVisible(id: string, visible: boolean): boolean {
    const mp = this.movableProps.get(id);
    if (!mp) return false;
    mp.object.visible = visible;
    return true;
  }

  /** Current transform, visibility and colliders of a controllable named prop (tests and choreography). */
  propState(id: string): { pos: THREE.Vector3; yaw: number; visible: boolean; colliders: readonly Collider[] } | null {
    const mp = this.movableProps.get(id);
    if (!mp) return null;
    return { pos: mp.object.position.clone(), yaw: mp.yaw, visible: mp.object.visible, colliders: mp.colliders };
  }

  private addColliders(out: PieceOutput, matrix: THREE.Matrix4, tag: string): Collider[] {
    const surfaceOf = new Map<BoxSpec, PieceOutput['surfaces'][number]['material']>();
    const added: Collider[] = [];
    for (const s of out.surfaces) surfaceOf.set(s.box, s.material);
    for (const c of out.colliders) {
      added.push(this.collision.add(transformBox(c, matrix), tag, surfaceOf.get(c) ?? null));
      surfaceOf.delete(c);
    }
    // Surface-only boxes (e.g. gratings inside a larger floor collider).
    for (const [box, material] of surfaceOf) added.push(this.collision.add(transformBox(box, matrix), tag, material));
    return added;
  }

  private buildDoor(d: DoorData, rng: Rng): void {
    const a = this.roomById.get(d.between[0])!;
    const b = this.roomById.get(d.between[1])!;
    const height = Math.max(a.height, b.height);
    const cellPt = new THREE.Vector3(d.cell[0] * CELL, d.cell[1] * DECK_H + 1, d.cell[2] * CELL);
    const aIsFront = a.cells.some((box) => box.containsPoint(cellPt));
    const frontArea = aIsFront ? a.data.area : b.data.area;
    const backArea = aIsFront ? b.data.area : a.data.area;
    let ref: DoorRuntime | null = null;
    const visual = buildDoor(
      d.kit,
      height,
      () => ref?.state ?? d.state,
      rng.fork(d.id),
      this.deps.materials,
      { ...(frontArea !== undefined ? { front: frontArea } : {}), ...(backArea !== undefined ? { back: backArea } : {}) },
    );
    const matrix = cellMatrix(d.cell, d.rot);
    const group = new THREE.Group();
    group.name = `door:${d.id}`;
    this.group.add(group);
    const frame = visual.frame.object;
    frame.applyMatrix4(matrix);
    frame.updateMatrixWorld(true);
    const staticMeshes: THREE.Mesh[] = [];
    for (const child of frame.children) if (child instanceof THREE.Mesh) staticMeshes.push(child);
    this.addColliders(visual.frame, matrix, `door:${d.id}`);
    visual.leaves.applyMatrix4(matrix);
    group.add(visual.leaves);
    visual.leaves.traverse((c) => {
      if (c instanceof THREE.Mesh) {
        c.castShadow = c.material !== this.deps.materials.glass;
        c.receiveShadow = true;
      }
    });
    const collider = this.collision.add(transformBox(visual.closedBox, matrix), `door:${d.id}`, null);
    const cb = visual.closedBox;
    const useBox = transformBox({ min: [cb.min[0], cb.min[1], cb.min[2] - 0.3], max: [cb.max[0], cb.max[1], cb.max[2] + 0.3] }, matrix);
    const center = new THREE.Vector3(0, 1.2, -2).applyMatrix4(matrix);
    const open = d.state === 'open' ? 1 : 0;
    collider.enabled = open === 0;
    visual.setOpen(open);
    const door: DoorRuntime = {
      data: d,
      visual,
      group,
      collider,
      rooms: [a, b],
      state: d.state,
      open,
      target: open,
      center,
      away: 0,
      moving: null,
      auto: d.kit !== 'bulkhead',
      staticMeshes,
      useBox,
      granted: false,
    };
    ref = door;
    this.doors.push(door);
    if (d.unlockOn) {
      const name = d.unlockOn;
      this.onNamed(name, () => this.unlockDoor(door, 'script'));
      // A sequence `emit` of the same name unlocks it too (e.g. `drop:done`, ADR-0014 beat 2).
      this.deps.events.on(name as EventName, (() => this.unlockDoor(door, 'script')) as never);
    }
    for (const s of visual.frame.sockets) {
      this.debug.sockets.push({ pos: new THREE.Vector3(...s.pos).applyMatrix4(matrix), dir: new THREE.Vector3(...s.dir).transformDirection(matrix) });
    }
  }

  /** A key item lying in the world: a small card (or tool case) with an accent stripe. */
  private buildPickup(pk: KeyPickupData): void {
    const room = this.roomById.get(pk.room)!;
    const kind = this.deps.inventory?.def(pk.item)?.kind ?? 'card';
    const mesh = new THREE.Group();
    mesh.name = `pickup:${pk.id}`;
    const [w, h, d] = kind === 'card' ? [0.16, 0.006, 0.1] : [0.32, 0.08, 0.14];
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.deps.materials.paintBone);
    body.position.y = h / 2;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(w * 1.01, h * 1.2, d * 0.25), fixtureMaterial('#39ff9e', 2.5));
    stripe.position.set(0, h / 2, -d * 0.3);
    mesh.add(body, stripe);
    mesh.position.set(pk.pos[0], pk.pos[1], pk.pos[2]);
    mesh.rotation.y = deg(pk.rot ?? 0);
    room.group.add(mesh);
    const r = 0.25;
    this.pickups.push({ data: pk, mesh, box: { min: [pk.pos[0] - r, pk.pos[1] - 0.05, pk.pos[2] - r], max: [pk.pos[0] + r, pk.pos[1] + 0.3, pk.pos[2] + r] } });
  }

  // ---------------------------------------------------------------- queries

  /** Does the level have a room with this id? */
  hasRoom(id: string): boolean {
    return this.roomById.has(id);
  }

  roomAt(p: THREE.Vector3): RoomRuntime | null {
    if (this.current && this.current.cells.some((c) => c.containsPoint(p))) return this.current;
    for (const r of this.rooms) if (r.cells.some((c) => c.containsPoint(p))) return r;
    return null;
  }

  locationAt(eye: THREE.Vector3): string | null {
    return this.roomAt(eye)?.data.name ?? null;
  }

  paSpeakerAt(listener: THREE.Vector3, fixture?: string): THREE.Vector3 | null {
    const room = this.roomAt(listener)?.data.id ?? this.currentRoomId();
    return selectPaSpeaker(this.paSpeakers, room, listener, fixture);
  }

  currentRoomId(): string | null {
    return this.current?.data.id ?? null;
  }

  /**
   * Imported props whose model is not loaded (headless builds, the level tests) still count against the room
   * budgets at their recorded cost (spec imported-props): materials once per prop type, triangles per copy, minus
   * the stand-ins already counted (their boxes, and the one draw call all stand-ins in a room share). A loaded model
   * is counted by the traversal like any other mesh.
   */
  private addImportedCost(room: RoomRuntime): void {
    const { registry } = this.deps;
    const copies = new Map<string, number>();
    for (const p of room.data.props ?? []) if (registry.importedCost(p.kit)) copies.set(p.kit, (copies.get(p.kit) ?? 0) + 1);
    let standIns = false;
    for (const [id, n] of copies) {
      if (registry.source(id) === 'glb') continue;
      const cost = registry.importedCost(id)!;
      room.stats.drawCalls += cost.materials;
      room.stats.triangles += (cost.triangles - cost.standInTriangles) * n;
      standIns = true;
    }
    if (standIns) room.stats.drawCalls -= 1;
  }

  /** World-space lamps of shown `exterior-lamp` markers (userData.exteriorLamp: local dir, colour, intensity, range, cone). */
  private pieceLamps(): ExteriorLamp[] {
    this.movingLamps.length = 0;
    for (const o of this.exteriorLampMarkers) {
      let shown = true;
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) shown = false;
      const d = o.userData['exteriorLamp'] as { dir: [number, number, number]; color: number; intensity: number; range: number; inner: number; outer: number } | undefined;
      if (!shown || !d) continue;
      o.updateWorldMatrix(true, false);
      this.movingLamps.push({
        position: new THREE.Vector3().setFromMatrixPosition(o.matrixWorld),
        direction: new THREE.Vector3(...d.dir).transformDirection(o.matrixWorld),
        color: new THREE.Color(d.color),
        intensity: d.intensity,
        range: d.range,
        inner: d.inner,
        outer: d.outer,
      });
    }
    return this.movingLamps;
  }

  /** Exterior floodlights (tests and tools). */
  floodlights(): ReadonlyArray<{ room: string; flicker: boolean }> {
    return this.exterior.floodlights;
  }

  roomStats(): RoomStats[] {
    return this.rooms.map((r) => ({ id: r.data.id, name: r.data.name, ...r.stats }));
  }

  /** Draw calls of visible rooms, doors and the shared exterior, before post. */
  visibleDrawCalls(): number {
    let n = this.hull.group.children.length;
    if (this.exterior.group.visible) this.exterior.group.traverse((o) => void (o instanceof THREE.Mesh && o.visible && n++));
    for (const r of this.rooms) if (r.visible) n += r.stats.drawCalls;
    for (const d of this.doors) if (d.group.visible) d.group.traverse((o) => void (o instanceof THREE.Mesh && n++));
    return n;
  }

  /** Subscribe to a level event name, e.g. "trigger:r03_console_used". */
  onNamed(name: string, fn: () => void): () => void {
    let set = this.named.get(name);
    if (!set) {
      set = new Set();
      this.named.set(name, set);
    }
    const s = set;
    s.add(fn);
    return () => s.delete(fn);
  }

  /** Doors and "use" triggers as ADR-0004 interactables. */
  private nav: Navigator | null = null;

  /**
   * AI navigation. A Recast navmesh over the collision boxes once the WASM is loaded (ADR-0028,
   * `initNavmesh()` at boot); otherwise the ADR-0007 navgraph: kit nav nodes, a node either side
   * of every door, and a 1.5 m grid fill. Either way doors are passable while open.
   */
  navGraph(): Navigator {
    if (this.nav) return this.nav;
    const t0 = performance.now();
    // Unlocked auto doors count as passable: they open for any body that walks up (setActors).
    const navDoors = this.doors.map((d) => ({ id: d.data.id, box: d.collider as Aabb, isOpen: () => !d.collider.enabled || this.opensForActors(d) }));
    if (navmeshReady()) {
      const leaves = new Set<unknown>(this.doors.map((d) => d.collider));
      const mesh = new NavMeshNav({ world: this.collision, boxes: this.collision.colliders.filter((c) => !leaves.has(c)), doors: navDoors });
      const missing = mesh.unmarkedDoors();
      if (missing.length) console.warn(`[nav] doorways with no navmesh: ${missing.join(', ')}`);
      console.info(`[nav] navmesh: ${mesh.edgeCount()} polygons in ${(performance.now() - t0).toFixed(0)} ms`);
      this.nav = mesh;
      return mesh;
    }
    const nodes: P3[] = this.debug.nav.map((v) => ({ x: v.x, y: v.y, z: v.z }));
    for (const door of this.doors) {
      const c = door.collider;
      const cx = (c.minX + c.maxX) / 2;
      const cz = (c.minZ + c.maxZ) / 2;
      // The door's thin axis is its normal.
      const alongX = c.maxX - c.minX < c.maxZ - c.minZ;
      for (const s of [-1.2, 1.2]) nodes.push({ x: cx + (alongX ? s : 0), y: c.minY, z: cz + (alongX ? 0 : s) });
    }
    const b = this.debug.bounds;
    if (!b.isEmpty()) nodes.push(...gridNodes(this.collision, { minX: b.min.x + 0.75, maxX: b.max.x - 0.75, minZ: b.min.z + 0.75, maxZ: b.max.z - 0.75, maxY: this.spawn.position.y - EYE_HEIGHT + 0.36 }, 1.5));
    const graph = new NavGraph({ world: this.collision, nodes, doors: navDoors });
    console.info(`[nav] ${graph.nodes.length} nodes, ${graph.edgeCount()} edges in ${(performance.now() - t0).toFixed(0)} ms`);
    this.nav = graph;
    return graph;
  }

  registerInteractions(interactions: Interactions): () => void {
    const offs: Array<() => void> = [];
    for (const t of this.triggers) {
      if (t.data.on !== 'use') continue;
      const trig = t;
      offs.push(
        interactions.add({
          id: `trigger:${t.data.id}`,
          prompt: t.data.prompt ?? 'Use',
          box: { min: t.box.min.toArray(), max: t.box.max.toArray() },
          enabled: () => !(trig.fired && trig.data.once !== false),
          use: () => this.fire(trig),
        }),
      );
    }
    const level = this;
    for (const d of this.doors) {
      const door = d;
      const item: Interactable = {
        id: `door:${d.data.id}`,
        get prompt() {
          return level.doorPrompt(door);
        },
        box: door.useBox,
        enabled: () => door.state !== 'open' && !(door.auto && door.state === 'closed' && level.doorAccessOpen(door)),
        use: () => this.useDoor(door),
        // A gated door answers a tap with its hint; bulkheads take a hold to open.
        get hold() {
          return door.auto || !level.doorAccessOpen(door) ? undefined : 0.8;
        },
      };
      offs.push(interactions.add(item));
    }
    for (const v of this.vents) {
      const vent = v;
      const item: Interactable = {
        id: `vent:${v.data.id}`,
        get prompt() {
          return level.ventOpen(vent) ? 'Open vent' : 'Check vent';
        },
        box: vent.box,
        enabled: () => !vent.open,
        use: () => this.useVent(vent),
        get hold() {
          return level.ventOpen(vent) ? 1.0 : undefined;
        },
      };
      offs.push(interactions.add(item));
    }
    for (const pk of this.pickups) {
      const pickup = pk;
      const inv = this.deps.inventory;
      offs.push(
        interactions.add({
          id: `pickup:${pk.data.id}`,
          prompt: `Take ${inv?.name(pk.data.item) ?? pk.data.item}`,
          box: pickup.box,
          enabled: () => !!inv && !inv.has(pickup.data.item),
          use: () => {
            inv?.give(pickup.data.item, 'pickup');
            pickup.mesh.visible = false;
          },
        }),
      );
    }
    return () => {
      for (const off of offs) off();
    };
  }

  /**
   * Other bodies that open unlocked auto doors (enemies, squad, NPCs) [Assumed 2026-11-17:
   * shamblers push through auto doors; locked, sealed and card doors still stop them].
   */
  setActors(points: (() => Iterable<{ x: number; y: number; z: number }>) | null): void {
    this.actorPoints = points;
  }

  private actorPoints: (() => Iterable<{ x: number; y: number; z: number }>) | null = null;

  private opensForActors(d: DoorRuntime): boolean {
    return d.auto && !d.data.access && d.state !== 'locked';
  }

  /** Distance from the door to the nearest actor (Infinity if none). */
  private nearestActor(d: DoorRuntime): number {
    if (!this.actorPoints || !this.opensForActors(d)) return Infinity;
    let best = Infinity;
    for (const p of this.actorPoints()) {
      if (Math.abs(p.y - (d.center.y - 1.2)) > 2) continue;
      best = Math.min(best, Math.hypot(p.x - d.center.x, p.z - d.center.z));
    }
    return best;
  }

  private doorAccessOpen(door: DoorRuntime): boolean {
    return accessOpen(door.data.access, this.deps.inventory ?? null);
  }

  private ventOpen(vent: VentRuntime): boolean {
    return accessOpen(vent.data.access, this.deps.inventory ?? null);
  }

  /** ADR-0024: check a gate; on denial emit `access:denied` with the hint. True if the player may pass. */
  private gate(kind: GateKind, id: string, access: DoorData['access'], runtime: { granted: boolean }): boolean {
    const result = checkAccess(access, kind, this.deps.inventory ?? null, this.deps.uiText);
    if (!result.ok) {
      this.deps.events.emit('access:denied', { id, kind, requires: access?.requires, sealed: access?.sealed, hint: result.hint });
      return false;
    }
    if (access?.requires !== undefined && !runtime.granted) {
      runtime.granted = true;
      this.deps.events.emit('access:granted', { id, kind, requires: access.requires });
    }
    return true;
  }

  private useVent(vent: VentRuntime): void {
    if (vent.open || !this.gate('vent', vent.data.id, vent.data.access, vent)) return;
    // Crawling through comes with later chapters; for now the vent opens and says so.
    vent.open = true;
    this.deps.events.emit('vent:opened', { id: vent.data.id });
  }

  private doorPrompt(door: DoorRuntime): string {
    const a = door.data.access;
    if (a && door.state !== 'open' && !this.doorAccessOpen(door)) {
      if (a.sealed) return 'Check door';
      return this.deps.inventory?.def(a.requires ?? '')?.kind === 'card' ? 'Check card reader' : 'Check door';
    }
    switch (door.state) {
      case 'locked':
        return (door.data.unlockBy ?? 'player') === 'player' ? 'Unlock door' : 'Check locked door';
      case 'jammed':
        return 'Check jammed door';
      case 'sealed':
        return 'Check sealed door';
      default:
        return door.auto ? 'Open door' : 'Open bulkhead';
    }
  }

  private useDoor(door: DoorRuntime): void {
    const id = door.data.id;
    // ADR-0024 gating comes first: a sealed or carded door answers with its hint.
    if (door.data.access && door.state !== 'open' && !this.gate('door', id, door.data.access, door)) return;
    if (door.state === 'locked') {
      const by = door.data.unlockBy ?? 'player';
      if (by === 'player') {
        if (this.unlockDoor(door, 'player')) this.openDoor(door);
        return;
      }
      // A script-locked door may say why in ui.json (`door_locked_<id>`), e.g. the hubs before the briefing.
      const custom = by === 'script' ? this.deps.uiText?.[`door_locked_${id}`] : undefined;
      const reason = custom ?? (by === 'engineer' ? 'Locked. The engineer could bypass this.' : by === 'medic' ? 'Locked. Needs medical clearance.' : 'Locked. Lockdown override required.');
      this.deps.events.emit('door:denied', { id, reason });
    } else if (door.state === 'jammed') {
      this.deps.events.emit('door:denied', { id, reason: 'Jammed. It will not budge.' });
    } else if (door.state === 'sealed') {
      this.deps.events.emit('door:denied', { id, reason: 'Sealed from the other side.' });
    } else {
      this.openDoor(door);
    }
  }

  /** Unlock a door by id (squad specialists and scripts will call this). */
  unlock(id: string, by: UnlockSource): boolean {
    const d = this.doors.find((x) => x.data.id === id);
    return d ? this.unlockDoor(d, by) : false;
  }

  // ---------------------------------------------------------------- script control (ADR-0009)

  /** Force a door into a state (sequences, checkpoint restore). False for unknown ids. */
  setDoor(id: string, state: DoorState): boolean {
    const d = this.doors.find((x) => x.data.id === id);
    if (!d) return false;
    this.setDoorState(d, state);
    d.target = state === 'open' ? 1 : 0;
    d.away = 0;
    return true;
  }

  /**
   * Back to the level as authored (new game, load; ADR-0016/0023): door states, trigger
   * `once` latches, vents, light patterns and tints, and key pickups the player does not hold.
   * Sequences then re-apply story state from the flags (`quiet_restore`).
   */
  resetToData(): void {
    for (const d of this.doors) {
      d.granted = false;
      this.setDoorState(d, d.data.state);
      d.target = d.state === 'open' ? 1 : 0;
      d.open = d.target;
      d.visual.setOpen(d.open);
      d.away = 0;
      d.moving = null;
      d.collider.enabled = d.open < 0.6;
    }
    for (const t of this.triggers) t.fired = false;
    this.lights.items.forEach((it, i) => {
      it.pattern = this.initialPatterns[i] ?? it.pattern;
    });
    for (const room of [...this.tinted.keys()]) this.tintRoomLights(room, 'none');
    for (const v of this.vents) {
      v.open = false;
      v.granted = false;
    }
    for (const pk of this.pickups) pk.mesh.visible = !this.deps.inventory?.has(pk.data.item);
    // Props that hold story state (blinds, screens, camera feeds) go back to their authored look.
    this.deps.events.emit('level:reset', {});
  }

  /**
   * Recolour a room's lights and ambient (ADR-0014 beat 2 emergency red): "emergency", a
   * "#rrggbb" colour, or "none" to restore the authored colours. False for unknown rooms.
   */
  tintRoomLights(roomId: string, tint: string): boolean {
    const room = this.roomById.get(roomId);
    if (!room) return false;
    const glowsOf = (): THREE.Color[] => room.slots.flatMap((s) => s.item.emissives.map((m) => m.emissive));
    let saved = this.tinted.get(roomId);
    if (tint === 'none') {
      if (!saved) return true;
      room.slots.forEach((s, i) => s.color.copy(saved!.slots[i] ?? s.color));
      glowsOf().forEach((c, i) => c.copy(saved!.glows[i] ?? c));
      room.ambient.sky.copy(saved.sky);
      room.ambient.ground.copy(saved.ground);
      room.ambient.intensity = saved.intensity;
      this.tinted.delete(roomId);
      return true;
    }
    if (!saved) {
      saved = {
        slots: room.slots.map((s) => s.color.clone()),
        glows: glowsOf().map((c) => c.clone()),
        sky: room.ambient.sky.clone(),
        ground: room.ambient.ground.clone(),
        intensity: room.ambient.intensity,
      };
      this.tinted.set(roomId, saved);
    }
    const emergency = tint === 'emergency';
    const color = new THREE.Color(emergency ? '#ff2a1a' : tint);
    for (const s of room.slots) s.color.copy(color);
    for (const c of glowsOf()) c.copy(color);
    if (emergency) {
      room.ambient.sky.set(AMBIENT.emergency.sky);
      room.ambient.ground.set(AMBIENT.emergency.ground);
      room.ambient.intensity = AMBIENT.emergency.intensity;
    }
    return true;
  }

  doorStates(): Record<string, DoorState> {
    return Object.fromEntries(this.doors.map((d) => [d.data.id, d.state]));
  }

  /** Set the pattern of every light in a room. False if the room has none. */
  setRoomLights(room: string, pattern: LightPattern): boolean {
    let any = false;
    for (const it of this.lights.items) {
      if (!it.name.startsWith(`${room} `)) continue;
      it.pattern = pattern;
      any = true;
    }
    return any;
  }

  /** Pattern of each room's first light, enough to snapshot and restore. */
  roomLightPatterns(): Record<string, LightPattern> {
    const out: Record<string, LightPattern> = {};
    for (const r of this.rooms) {
      const first = this.lights.items.find((it) => it.name.startsWith(`${r.data.id} `));
      if (first) out[r.data.id] = first.pattern;
    }
    return out;
  }

  /** A named anchor from the level data (`anchor:<id>` in sequences). Yaw in radians. Copies. */
  anchor(id: string): { pos: THREE.Vector3; yaw: number } | null {
    const a = this.anchors.get(id);
    return a ? { pos: a.pos.clone(), yaw: a.yaw } : null;
  }

  /**
   * An authored walk (ADR-0028): its control points (anchors resolved to feet positions) and
   * default speed, or null if no room has it.
   */
  walk(id: string): { points: P3[]; speed?: number } | null {
    const w = this.walks.get(id);
    if (w) {
      const points: P3[] = [];
      for (const pt of w.points) {
        const a = typeof pt === 'string' ? this.anchors.get(pt) : null;
        if (typeof pt === 'string' && !a) return null;
        const v = a ? a.pos : { x: (pt as number[])[0]!, y: (pt as number[])[1]!, z: (pt as number[])[2]! };
        points.push({ x: v.x, y: v.y, z: v.z });
      }
      return { points, ...(w.speed !== undefined ? { speed: w.speed } : {}) };
    }
    return null;
  }

  /** Every authored walk id (ADR-0028), for tests and debug overlays. */
  walkIds(): string[] {
    return [...this.walks.keys()];
  }

  /** Every anchor id, for tests and debug overlays. */
  anchorIds(): string[] {
    return [...this.anchors.keys()];
  }

  /** NPCs placed by room `npcs` entries, resolved to positions (yaw in radians). Copies. */
  npcSpawns(): LevelNpc[] {
    return this.npcList.map((n) => ({ ...n, pos: n.pos.clone() }));
  }

  /** World position of a door or a room's centre, for look-at and sound targets. */
  anchorPosition(kind: 'door' | 'room', id: string): THREE.Vector3 | null {
    if (kind === 'door') return this.doors.find((d) => d.data.id === id)?.center.clone() ?? null;
    const room = this.rooms.find((r) => r.data.id === id);
    if (!room || room.cells.length === 0) return null;
    const box = new THREE.Box3();
    for (const c of room.cells) box.union(c);
    return box.getCenter(new THREE.Vector3());
  }

  /** Controlled light fixtures in a room (for positional fluorescent buzz and flicker arcs), with their slot kind. */
  roomLights(roomId: string): ReadonlyArray<{ position: THREE.Vector3; light: ControlledLight; kind: LightSlotKind }> {
    const room = this.rooms.find((r) => r.data.id === roomId);
    if (!room) return [];
    return room.slots.map((s) => ({ position: s.position, light: s.item, kind: s.kind }));
  }

  // ---------------------------------------------------------------- door + trigger logic

  private setDoorState(door: DoorRuntime, state: DoorState): void {
    if (door.state === state) return;
    door.state = state;
    this.deps.events.emit('door:state', { id: door.data.id, state });
    if (state === 'open') this.deps.events.emit('door:opened', { id: door.data.id });
    if (state === 'closed') this.deps.events.emit('door:closed', { id: door.data.id });
  }

  private unlockDoor(door: DoorRuntime, by: UnlockSource): boolean {
    if (door.state !== 'locked') return false;
    const need = door.data.unlockBy ?? 'player';
    if (by !== 'script' && by !== need) return false;
    this.setDoorState(door, 'closed');
    this.deps.events.emit('door:unlocked', { id: door.data.id, by });
    return true;
  }

  private openDoor(door: DoorRuntime): boolean {
    if (door.state !== 'closed' && door.state !== 'open') return false;
    this.setDoorState(door, 'open');
    door.target = 1;
    door.away = 0;
    return true;
  }

  private fire(t: TriggerRuntime): void {
    if (t.fired && t.data.once !== false) return;
    t.fired = true;
    this.deps.events.emit('trigger:fired', { id: t.data.id, event: t.data.emit });
    // The emit name is a bus event too (spawn points' `on`, `area:dark`, sequence triggers).
    (this.deps.events.emit as (name: string, payload: unknown) => void)(t.data.emit, { id: t.data.id });
    const set = this.named.get(t.data.emit);
    if (set) for (const fn of [...set]) fn();
  }

  private updateDoors(dt: number, eye: THREE.Vector3): void {
    for (const d of this.doors) {
      const dx = eye.x - d.center.x;
      const dz = eye.z - d.center.z;
      const dist = Math.hypot(dx, dz);
      const nearY = Math.abs(eye.y - EYE_HEIGHT - (d.center.y - 1.2)) < 1.5;
      if (d.auto) {
        const actor = this.nearestActor(d);
        if (d.state === 'closed' && dist < 2.6 && nearY && this.doorAccessOpen(d)) {
          if (d.data.access) this.gate('door', d.data.id, d.data.access, d);
          this.openDoor(d);
        }
        else if (d.state === 'closed' && actor < 1.8) this.openDoor(d);
        else if (d.state === 'open') {
          // Hold open until the leaves finish opening and nobody is nearby for AUTO_DOOR_HOLD seconds.
          d.away = d.open >= 1 && dist > AUTO_CLOSE_PLAYER_DIST && actor > AUTO_CLOSE_ACTOR_DIST ? d.away + dt : 0;
          if (d.away >= AUTO_DOOR_HOLD) {
            this.setDoorState(d, 'closed');
            d.target = 0;
          }
        }
      }
      if (d.state !== 'open' && d.target > 0) d.target = 0;
      // Never close on the player standing in the doorway: auto doors smoothly re-open, sealed/manual doors pause.
      if (d.target === 0 && d.open > 0 && dist < 0.9) {
        if (d.auto && this.doorAccessOpen(d)) this.openDoor(d);
        else d.target = d.open;
      }
      const speed = dt / d.visual.travelTime;
      if (d.open !== d.target) {
        const dir: 'open' | 'close' = d.open < d.target ? 'open' : 'close';
        if (d.moving !== dir) {
          d.moving = dir;
          this.deps.events.emit('door:move', { id: d.data.id, kit: d.data.kit, dir, progress: d.open, position: d.center.clone() });
        }
        d.open = dir === 'open' ? Math.min(d.target, d.open + speed) : Math.max(d.target, d.open - speed);
        const e = d.open * d.open * (3 - 2 * d.open);
        d.visual.setOpen(e);
        if (d.open === d.target) d.moving = null;
      } else {
        d.moving = null;
      }
      d.collider.enabled = d.open < 0.6;
    }
  }

  private updateTriggers(eye: THREE.Vector3): void {
    const feet = this.scratch2.set(eye.x, eye.y - EYE_HEIGHT + 0.1, eye.z);
    for (const t of this.triggers) {
      const inside = t.box.containsPoint(feet) || t.box.containsPoint(eye);
      if (inside !== t.inside) {
        t.inside = inside;
        if ((inside && t.data.on === 'enter') || (!inside && t.data.on === 'exit')) this.fire(t);
      }
    }
  }

  // ---------------------------------------------------------------- per frame

  update(t: number, dt: number, eye: THREE.Vector3, reducedFlashing: boolean): void {
    this.feetY = eye.y - EYE_HEIGHT;
    const room = this.roomAt(eye);
    if (room && room !== this.current) {
      this.current = room;
      this.deps.events.emit('room:entered', {
        id: room.data.id,
        name: room.data.name,
        reverb: room.data.atmosphere?.reverb,
        ambience: room.data.atmosphere?.ambience,
      });
    }
    this.updateDoors(dt, eye);
    this.updateTriggers(eye);

    // Portal-by-adjacency culling.
    const cur = this.current;
    this.cull(cur, room ? undefined : eye);

    // Atmosphere follows the current room.
    if (cur) {
      const scene = this.deps.scene;
      const fog = scene.fog;
      const k = this.atmosphereReady ? 1 - Math.exp(-dt * 1.5) : 1;
      this.atmosphereReady = true;
      if (fog instanceof THREE.FogExp2) {
        fog.color.lerp(cur.fog, k);
        fog.density += (cur.fogDensity - fog.density) * k;
        if (scene.background instanceof THREE.Color) scene.background.copy(fog.color);
      }
      this.hemi.color.lerp(cur.ambient.sky, k);
      this.hemi.groundColor.lerp(cur.ambient.ground, k);
      this.hemi.intensity += (cur.ambient.intensity - this.hemi.intensity) * k;
      this.keyFill.color.lerp(cur.ambient.keyColor, k);
      this.keyFill.intensity += (cur.ambient.keyIntensity - this.keyFill.intensity) * k;
    }

    // Light pool: slots of visible rooms, current room first.
    this.bindLights(cur, eye);
    this.lastTime = t;
    this.lastFlashing = reducedFlashing;
    flashingState.reduced = reducedFlashing;
    this.lights.update(t, reducedFlashing);
    this.pool.finish();

    for (const r of this.rooms) if (r.visible) for (const tick of r.ticks) tick(t, dt);
    const outside = this.rooms.some((r) => r.visible && this.exteriorRooms.has(r.data.id));
    this.exterior.update(t, eye, outside, reducedFlashing, outside ? this.pieceLamps() : undefined);
    for (const d of this.doors) if (d.group.visible) d.visual.tick(t);
    // Taken pickups stay gone, also after loading a save that holds the item.
    const inv = this.deps.inventory;
    for (const pk of this.pickups) pk.mesh.visible = !inv?.has(pk.data.item);
    this.dust.update(eye, t, dt);
  }

  /** Which rooms (and doors) draw when the view is in `cur`: it, what its open or see-through doors show, and its `visibleFrom` windows. */
  private cull(cur: RoomRuntime | null, exteriorEye?: THREE.Vector3): void {
    for (const r of this.rooms) r.visible = cur === null;
    if (cur) {
      cur.visible = true;
      for (const d of this.doors) {
        if (d.open <= 0.001 && !d.visual.seeThrough) continue;
        if (d.rooms[0] === cur) d.rooms[1].visible = true;
        else if (d.rooms[1] === cur) d.rooms[0].visible = true;
      }
      for (const r of this.rooms) if (r.data.visibleFrom?.includes(cur.data.id)) r.visible = true;
      // Start at every room already drawn through a door or authored opening. Take a snapshot
      // so a distant room's other windows don't recursively enable unrelated interiors.
      const oceanViews = [];
      for (const [id, views] of this.hull.windowViews) if (this.roomById.get(id)!.visible) oceanViews.push(views);
      for (const views of oceanViews) for (const id of views) this.roomById.get(id)!.visible = true;
      // An exterior camera can see directly into a seaward-facing pane without a source window.
      if (exteriorEye) for (const w of this.hull.windows) {
        if ((exteriorEye.x - w.x) * w.dx + (exteriorEye.z - w.z) * w.dz > 0) this.roomById.get(w.room)!.visible = true;
      }
    }
    for (const r of this.rooms) r.group.visible = r.visible;
    for (const d of this.doors) d.group.visible = d.rooms[0].visible || d.rooms[1].visible;
  }

  /** Give the visible rooms' light slots to the pooled lights, nearest `eye` first, `cur` first of all. */
  private bindLights(cur: RoomRuntime | null, eye: THREE.Vector3): void {
    const slots = this.visibleSlots;
    slots.length = 0;
    for (const r of this.rooms) {
      if (!r.visible) {
        for (const s of r.slots) s.item.light = null;
        continue;
      }
      for (const s of r.slots) {
        if (s.pooled === false) {
          s.item.light = null; // glow-only: patterns and tints still drive its fixture
          continue;
        }
        s.priority = r === cur ? 1 : 0;
        slots.push(s);
      }
    }
    this.pool.assign(slots, eye);
  }

  /**
   * Run `draw` as if the view were at `eye` (a security camera feed, ADR-0023): the rooms it can
   * see are visible and the pooled lights are bound around it. The player's own view is set up
   * again by the next `update`, so call this before it each frame, never between `update` and the
   * main render. Light patterns are not advanced (`update` does that).
   */
  renderFromEye(eye: THREE.Vector3, draw: () => void): void {
    const room = this.roomAt(eye);
    this.cull(room);
    this.bindLights(room, eye);
    this.lights.update(this.lastTime, this.lastFlashing); // sets the bound lights' intensities for these slots
    this.pool.finish();
    draw();
  }

  attract(t: number, camera: THREE.PerspectiveCamera): void {
    camera.position.copy(this.spawn.position);
    camera.position.y += Math.sin(t * 0.3) * 0.03;
    camera.rotation.set(-0.06 + Math.sin(t * 0.07) * 0.05, this.spawn.yaw + Math.sin(t * 0.09) * 0.45, 0);
  }
}

function glowGeometry(kind: LightSlotKind): THREE.BufferGeometry {
  if (kind === 'ceiling') return new THREE.BoxGeometry(1.2, 0.02, 0.24);
  if (kind === 'emergency') return new THREE.SphereGeometry(0.075, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  if (kind === 'pendant') return new THREE.SphereGeometry(0.06, 12, 8); // the bulb inside the pendant_light shade
  return new THREE.SphereGeometry(0.07, 12, 8);
}
