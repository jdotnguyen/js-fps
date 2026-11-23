import * as THREE from 'three';
import type { EventBus, EventName } from '../core/events.ts';
import { Rng } from '../core/rng.ts';
import { yieldFrame } from '../core/yieldFrame.ts';
import { isKeyPickup, type SpotKind, type AmbientPreset, type DoorData, type DoorKit, type DoorState, type KeyPickupData, type LevelData, type RoomData, type TriggerData, type UnlockSource, type VentData } from '../data/types/level.ts';
import type { UiText } from '../data/types/uiText.ts';
import type { Inventory } from '../game/inventory.ts';
import { accessOpen, checkAccess, type AccessHint, type GateKind } from './access.ts';
import { createShaft } from '../render/fx/shafts.ts';
import { createOceanLife, type OceanZone } from '../render/fx/oceanLife.ts';
import { Particulates } from '../render/fx/particulates.ts';
import { LightController, type ControlledLight, type LightPattern, type ShaftUniforms } from '../render/lights.ts';
import { createDebugCheckerMaterial, disposeTexture, fixtureMaterial, type Materials } from '../render/materials.ts';
import { CollisionWorld, type Collider, type ColliderSurface } from './collision.ts';
import { at } from './kit/geom.ts';
import { grillePosition, selectPaSpeaker, type PaSpeaker } from './paSpeakers.ts';
import { buildDoor, type DoorVisual } from './kit/doors.ts';
import { edgeDir, GridOccupancy, sharedEdgeKey } from './kit/grid.ts';
import {
  PortalCuller,
  makeVerticalQuad,
  quadBox,
  type FallbackLink,
  type OceanWindowPortal,
  type PortalQuad,
  type RoomLightSphere,
} from './portalCull.ts';
import { HullBuilder, type ExteriorHull } from './kit/exteriorHull.ts';
import { AoMergeBuilder, applyWorldMeterUvs, withVertexColors, type AoFn } from './kit/merge.ts';
import { snapModelToSocket, type SnapOptions } from './kit/modelSnap.ts';
import { CELL, CORRIDOR_H, DECK_H, ROOM_H, WALL_MOUNTED_PROPS, joltSwing, swingAngle, transformBox, type BoxSpec, type SwingJolt, type LightSlotKind, type PieceOutput, type PieceParams, type Socket, type SocketKind } from './kit/types.ts';
import { LightPool, type PooledSlot } from './lightPool.ts';
import { ShadowPool } from './shadowPool.ts';
import { doorCaster, RigidCaster, shadowCasters, type ShadowCasterSet } from '../render/shadowCasters.ts';
import type { LightBudget } from './world.ts';
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
import { VoiceGraph, type VoicePath, type VoicePortal } from '../audio/voicePath.ts';
import type { WorldSfxEvent, WorldSoundLoop } from '../audio/propAudio.ts';
import { WaterBodies, WaterBody } from './water.ts';
import { WaterSurface } from '../render/water/surface.ts';
import { addMurkTo } from '../render/water/murk.ts';
import { FloatingJunk } from '../render/water/junk.ts';

const EYE_HEIGHT = PLAYER_TUNING.eyeHeight;
/** Seconds an auto door stays open after reaching fully open while nobody is nearby. */
const AUTO_DOOR_HOLD = 5.0;
const AUTO_CLOSE_PLAYER_DIST = 3.6;
const AUTO_CLOSE_ACTOR_DIST = 2.8;

declare module '../core/events.ts' {
  interface EventMap {
    /** A broken fixture threw sparks: its tube cut out (`strong`) or struck back on (flooded-tunnel spec). */
    'light:sparks': { x: number; y: number; z: number; strong: boolean };
    /** Station power switched (station-power spec). */
    'power:changed': { state: StationPower };
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
    /** Synchronized positional one-shot emitted by a level kit prop (misters, reactive equipment alarms). */
    'world:sfx': WorldSfxEvent;
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
  /** Light pool sizes for the active quality tier (render-lighting spec). Default: 8 fill lights, no shadow lights. */
  lightBudget?: LightBudget;
  /** Moving shadow casters the shadow pool watches (shadow-rich-rooms D4). Default: the shared set. */
  shadowCasters?: ShadowCasterSet;
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
/** Ambient under backup power (station-power spec): darker than `emergency`, with no red. */
export const BACKUP_AMBIENT = { sky: 0x3a3630, ground: 0x040404, intensity: 0.06, keyColor: 0x4a443c, keyIntensity: 0.08 };
/** The backup look (render-lighting spec "Backup lights"): dim warm white, shorter reach. */
export const BACKUP_LIGHT = { color: '#ffd9a8', scale: 0.25, range: 0.7 };
export type StationPower = 'mains' | 'backup';
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
  slots: Array<PooledSlot & { kind: LightSlotKind; backup?: boolean; ownColor?: boolean; backupScale?: number }>;
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
  /** Opened by a script: an auto door holds open until the next script state or a load. */
  held?: boolean;
  /**
   * Forced part-open by a script (`doorPry`, level-kit spec): the leaves head to `target` at `rate` (fraction per second)
   * whatever the door's state. The next state change drops it.
   */
  forced?: { target: number; rate: number } | null;
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
  /** Optional explicit list of room ids this NPC may roam between for work spots. */
  roam?: readonly string[];
  room: string;
}

/** Feet this deep (m) in standing water step on `water`. */
const WET_FEET = 0.02;

/** Placements may sit this far (m) above or below the walkable top they stand on. */
const PLACEMENT_SLACK = 0.05;
/** Pickups and item anchors may rest this far (m) above the top they lie on. */
const ITEM_HOVER = 0.15;

/**
 * Sunken rooms (level-kit spec): every spawn, anchor, pickup or prop of a room with `floorY` that is authored at or
 * below deck level must stand on a walkable top within 5 cm, so nothing is left at `y = 0` over the sunken floor.
 * Placements higher up (wall props, ceiling vents, items on crates) are not checked. A prop with `params.float` is
 * exempt (it floats on water). Returns one line per problem.
 */
export function sunkenPlacementProblems(data: LevelData, world: { query(minX: number, minZ: number, maxX: number, maxZ: number, out: Aabb[]): Aabb[] }): string[] {
  const problems: string[] = [];
  /** `hover`: how far above its top the placement may sit (items rest a little above what they lie on). */
  const check = (room: string, what: string, pos: readonly [number, number, number], hover = PLACEMENT_SLACK): void => {
    const [x, y, z] = pos;
    if (y > PLACEMENT_SLACK) return;
    const out = world.query(x - 0.01, z - 0.01, x + 0.01, z + 0.01, []);
    const onTop = out.some((b) => b.min[0] <= x && b.max[0] >= x && b.min[2] <= z && b.max[2] >= z && b.max[1] - y <= PLACEMENT_SLACK && y - b.max[1] <= hover);
    if (!onTop) problems.push(`${room} ${what} at [${pos.join(', ')}] has no walkable top within ${PLACEMENT_SLACK} m`);
  };
  const sunken = new Set(data.rooms.filter((r) => (r.floorY ?? 0) < 0).map((r) => r.id));
  for (const r of data.rooms) {
    if (!sunken.has(r.id)) continue;
    for (const s of r.spawns ?? []) if (s.float !== true) check(r.id, `spawn ${s.id}`, s.pos);
    // A point anchor (no facing) marks an item, which may rest up to ITEM_HOVER above its top.
    for (const a of r.anchors ?? []) check(r.id, `anchor ${a.id}`, a.pos, a.yaw === undefined ? ITEM_HOVER : PLACEMENT_SLACK);
    for (const p of r.props ?? []) if (p.params?.['float'] !== true) check(r.id, `prop ${p.kit}`, p.pos);
  }
  for (const pk of data.pickups ?? []) if (sunken.has(pk.room)) check(pk.room, `pickup ${pk.id}`, pk.pos, ITEM_HOVER);
  return problems;
}

/** A light slot in world space while a room is built (a swinging one carries its pivot). */
interface RawSlot {
  pos: THREE.Vector3;
  kind: LightSlotKind;
  ry: number;
  swing?: { pivot: THREE.Vector3; amp: number; period: number; jolt?: SwingJolt };
}

/** Placement matrix for a grid cell and a rotation in degrees. */
function cellMatrix(cell: [number, number, number], rot: number): THREE.Matrix4 {
  return at(cell[0] * CELL, cell[1] * DECK_H, cell[2] * CELL, 0, deg(rot), 0);
}

export interface LevelLoadOptions {
  /** Progress callback spanning GLB preload (0..0.35), room building (0.35..0.65), and AO/merge (0.65..1). */
  onProgress?: (fraction: number, label: string) => void;
}

/** Load every GLB the level needs, then build it asynchronously with frame yields between rooms and merges. */
export async function loadLevel(data: LevelData, deps: LevelDeps, opts?: LevelLoadOptions): Promise<Level> {
  const ids = data.rooms.flatMap((r) => [...r.pieces.map((p) => p.kit), ...(r.props ?? []).map((p) => p.kit)]);
  await deps.registry.preload(ids, undefined, (done, total) => {
    opts?.onProgress?.((done / Math.max(1, total)) * 0.35, `Loading station models (${done}/${total})…`);
  });
  return Level.buildAsync(data, deps, {
    onProgress: opts?.onProgress
      ? (f, label) => opts.onProgress!(0.35 + f * 0.65, label)
      : undefined,
  });
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
  /** Standing water, one body per room with a `water` block (standing-water spec). */
  readonly water = new WaterBodies();
  /** The visible surface of each room's water (standing-water spec). */
  readonly waterSurfaces = new Map<string, WaterSurface>();

  /** Footstep surface at feet height `y`: `water` wherever the feet are under a water body's surface, else the collider's. */
  surfaceAt(x: number, y: number, z: number): ColliderSurface | null {
    if (this.water.depthAt(x, y, z) > WET_FEET) return 'water';
    return this.collision.surfaceAt(x, y, z);
  }
  readonly spawn: { position: THREE.Vector3; yaw: number };
  readonly bounds = null;
  readonly playerWorld: PlayerWorld;
  checkpoints: WorldCheckpoint[] = [];
  readonly defaultLocation: string;
  readonly debug: LevelDebugData;
  readonly pool: LightPool;
  /** Shadow-casting room spots for slots with `shadow: true` (render-lighting spec). */
  readonly shadowPool: ShadowPool;
  private readonly deps: LevelDeps;
  private readonly rooms: RoomRuntime[] = [];
  private readonly paSpeakers: PaSpeaker[] = [];
  private readonly roomById = new Map<string, RoomRuntime>();
  private readonly doors: DoorRuntime[] = [];
  private portalCuller!: PortalCuller;
  private readonly visibleRoomIds = new Set<string>();
  private hull!: ExteriorHull;
  /** Everything outside the station, built once (openspec change overhaul-exterior-ocean). */
  private exterior!: Exterior;
  private readonly exteriorWindows: ExteriorWindow[] = [];
  /** Rooms with real windows: the exterior draws only while one of them is visible. */
  private readonly exteriorRooms = new Set<string>();
  /** Lamps carried by pieces (the supply sub's headlamps), lighting the exterior while shown. */
  private readonly exteriorLampMarkers: THREE.Object3D[] = [];
  private readonly movingLamps: ExteriorLamp[] = [];
  private readonly triggers: TriggerRuntime[] = [];
  private readonly vents: VentRuntime[] = [];
  private readonly soundLoopList: WorldSoundLoop[] = [];
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
  /** Props marked `dynamic` in the level data (a subset of `movableProps`), with their mass. */
  private readonly dynamicProps = new Map<string, { mass: number; room: string }>();
  private readonly npcList: LevelNpc[] = [];
  private readonly named = new Map<string, Set<() => void>>();
  /** Authored walks by id (ADR-0028). */
  private readonly walks = new Map<string, NonNullable<LevelData['rooms'][number]['walks']>[number]>();
  private readonly hemi: THREE.HemisphereLight;
  private readonly keyFill: THREE.DirectionalLight;
  private readonly dust: Particulates;
  private readonly visibleSlots: PooledSlot[] = [];
  private readonly fillSlots: PooledSlot[] = [];
  /** The player camera's frustum this frame, for ranking shadow lights by view (null without a camera). */
  private readonly viewFrustum = new THREE.Frustum();
  private readonly viewProj = new THREE.Matrix4();
  /** Swinging fixtures that knocks can set swinging harder (shadow-rich-rooms D6). */
  private readonly swingers: Array<{ room: string; swing: { amp: number; period: number; jolt?: SwingJolt }; rest: THREE.Vector3; along: THREE.Vector3 }> = [];

  /** Moving shadow casters the shadow pool watches. */
  get casters(): ShadowCasterSet {
    return this.deps.shadowCasters ?? shadowCasters;
  }
  private current: RoomRuntime | null = null;
  /** Light patterns as authored (resetToData), and the colours a tint replaced (tintRoomLights). */
  private initialPatterns: LightPattern[] = [];
  private lastTime = 0;
  private lastFlashing = false;
  /** Lights with an `id` (render-lighting spec: a single scripted light), with their authored colours. */
  private readonly namedLights = new Map<string, { slot: { item: ControlledLight; color: THREE.Color }; color: THREE.Color; glows: THREE.Color[] }>();
  private readonly tinted = new Map<string, { slots: THREE.Color[]; glows: THREE.Color[]; sky: THREE.Color; ground: THREE.Color; intensity: number }>();
  private atmosphereReady = false;
  /** Station power (station-power spec), and what the backup look replaced on each backup light. */
  private powerState: StationPower = 'mains';
  private readonly backupSaved = new Map<PooledSlot, { color: THREE.Color; glows: THREE.Color[]; range: number; pattern: LightPattern }>();
  private readonly backupAmbient = {
    sky: new THREE.Color(BACKUP_AMBIENT.sky),
    ground: new THREE.Color(BACKUP_AMBIENT.ground),
    intensity: BACKUP_AMBIENT.intensity,
    keyColor: new THREE.Color(BACKUP_AMBIENT.keyColor),
    keyIntensity: BACKUP_AMBIENT.keyIntensity,
  };
  private readonly scratch2 = new THREE.Vector3();
  private feetY = 0;
  /** Merged Lab B floor meshes (labTile) that swap to tileBroken after the outbreak. */
  private readonly labbFloor: THREE.Mesh[] = [];
  private readonly roomSockets: Array<Socket & { room: string }> = [];
  private readonly checkerTargets: Array<{ mesh: THREE.Mesh; origMat: THREE.Material; origUv: THREE.BufferAttribute | null }> = [];
  private checkerMat: THREE.Material | null = null;
  private checkerActive = false;
  private readonly offs: Array<() => void> = [];

  constructor(data: LevelData, deps: LevelDeps, deferBuild = false) {
    this.deps = deps;
    this.id = data.id;
    this.source = data;
    this.name = data.name ?? data.id;
    this.group.name = `level:${data.id}`;
    const rng = new Rng(`${data.id}:${data.seed}`);
    this.debug = { sockets: [], slots: [], nav: [], rooms: [], triggers: [], bounds: new THREE.Box3(), keepouts: [], wallProps: [] };
    const budget = deps.lightBudget ?? { fillLights: 8, shadowLights: 0, shadowMapSize: 1024 };
    this.pool = new LightPool(this.group, budget.fillLights);
    this.shadowPool = new ShadowPool(this.group, budget.shadowLights, budget.shadowMapSize, budget.cookieSpots ?? 0);
    this.hemi = new THREE.HemisphereLight(AMBIENT.normal.sky, AMBIENT.normal.ground, AMBIENT.normal.intensity);
    this.group.add(this.hemi);
    this.keyFill = new THREE.DirectionalLight(AMBIENT.normal.keyColor, AMBIENT.normal.keyIntensity);
    this.keyFill.name = 'level-key-fill';
    this.keyFill.position.set(12, 24, 16);
    this.keyFill.castShadow = false;
    this.group.add(this.keyFill);

    const start = data.playerStart;
    this.spawn = { position: new THREE.Vector3(start.pos[0], start.pos[1] + EYE_HEIGHT, start.pos[2]), yaw: deg(start.yaw) };
    const startRoomData = data.rooms.find((r) => r.id === start.room);
    this.defaultLocation = startRoomData?.name ?? this.name;
    this.playerWorld = {
      colliders: this.collision,
      surfaceAt: (x, z) => this.surfaceAt(x, this.feetY, z) ?? 'metal',
      waterDepth: (x, y, z) => this.water.depthAt(x, y, z),
    };
    this.dust = new Particulates(rng.fork('dust'), 1400, 6, 0, 4.5);
    this.group.add(this.dust.points);

    if (!deferBuild) this.buildAllSync(data, deps, rng);
  }

  /** Build a level asynchronously, yielding between room construction and per-room AO merges. */
  static async buildAsync(
    data: LevelData,
    deps: LevelDeps,
    opts?: { onProgress?: ((fraction: number, label: string) => void) | undefined },
  ): Promise<Level> {
    const level = new Level(data, deps, true);
    const rng = new Rng(`${data.id}:${data.seed}`);
    // Advance rng fork identically to constructor's dust fork so procedural seeds match sync builds.
    rng.fork('dust');
    await level.buildAllAsync(data, deps, rng, opts?.onProgress);
    return level;
  }

  private prepareOccupancy(data: LevelData): GridOccupancy {
    const occupancy = new GridOccupancy();
    for (const d of data.doors) {
      const claim = occupancy.claimDoor(d.id, d.cell, d.rot);
      if (!claim.ok) console.warn(`[level] ${claim.reason}`);
    }
    return occupancy;
  }

  private buildExteriorAndDoors(data: LevelData, deps: LevelDeps, rng: Rng, hull: HullBuilder): void {
    this.hull = hull.build(data.doors, deps.materials);
    this.group.add(this.hull.group);
    this.exterior = buildExterior({ columns: this.hull.columns, windows: this.exteriorWindows, steel: deps.materials.paintDark, rng: rng.fork('exterior') });
    this.group.add(this.exterior.group);
    this.group.traverse((o) => {
      if (o.name === 'exterior-lamp') this.exteriorLampMarkers.push(o);
    });
    for (const d of data.doors) this.buildDoor(d, rng);
    const misplaced = sunkenPlacementProblems(data, this.collision);
    if (misplaced.length) throw new Error(`[level] ${data.id}: placements off a sunken floor:\n  ${misplaced.join('\n  ')}`);
    this.filterWorkSpots();
    this.initialPatterns = this.lights.items.map((it) => it.pattern);
  }

  private mergeRoom(room: RoomRuntime, ao: AoFn): void {
    for (const mesh of room.staticMeshes) room.merger.addMesh(mesh);
    room.staticMeshes.length = 0;
    room.stats.materials = room.merger.materialCount;
    room.group.add(room.merger.build(`room:${room.data.id}`, ao));
    // What stands in standing water fades into it with depth (standing-water spec, D5).
    if (room.data.water) addMurkTo(room.group);
    room.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        room.stats.drawCalls++;
        const g = o.geometry;
        room.stats.triangles += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      }
    });
    this.addImportedCost(room);
  }

  private finalizeBuild(data: LevelData, deps: LevelDeps, ao: AoFn): void {
    this.collectLabBFloor();
    this.offs.push(
      this.deps.events.on('glass:set' as EventName, ((e: { id?: string; state?: string } | undefined) => {
        if (e?.id === LAB_B.glass && (e.state === 'cracked' || e.state === 'shattered')) this.breakLabBFloor(true);
      }) as never),
    );
    this.offs.push(
      this.deps.events.on('level:reset', () => {
        this.breakLabBFloor(false);
        for (const [id, mp] of this.movableProps) {
          this.setPropTransform(id, mp.initialPos, mp.initialYaw);
          this.setPropVisible(id, mp.initialVisible);
        }
      }),
    );
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
          ...(n.roam?.length ? { roam: n.roam } : {}),
          room: r.id,
        });
      }
    }
    this.checkpoints = data.checkpoints.map((cp) => {
      const room = this.roomById.get(cp.room)!;
      return { id: cp.id, label: room.data.name, reached: (feet: THREE.Vector3) => this.roomAt(this.scratch2.copy(feet).setY(feet.y + 0.5)) === room };
    });
    for (const r of this.rooms) this.debug.rooms.push({ id: r.data.id, name: r.data.name, cells: r.cells });
    for (const r of this.rooms) for (const c of r.cells) this.debug.bounds.union(c);
    this.portalCuller = this.buildPortalCuller();
  }

  /** Extract the world-space portal graph from doors, glass partitions, open `visibleFrom` edges and ocean windows. */
  private buildPortalCuller(): PortalCuller {
    const ALWAYS_OPEN = (): boolean => true;
    const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

    const portals: PortalQuad[] = [];
    const fallbacks: FallbackLink[] = [];
    const oceanWindows: OceanWindowPortal[] = [];
    const roomLights = new Map<string, readonly RoomLightSphere[]>();

    // Map grid cells to their owning rooms and compute each room's union world AABB.
    const cellOwner = new Map<string, RoomRuntime>();
    const cellOwnerXZ = new Map<string, RoomRuntime>();
    const roomCells = new Map<string, Array<readonly [number, number, number]>>();
    const roomBounds = new Map<string, THREE.Box3>();
    for (const r of this.rooms) {
      const seen = new Set<string>();
      const list: Array<readonly [number, number, number]> = [];
      for (const p of r.data.pieces) {
        const cells = p.cells ?? (p.cell ? [p.cell] : []);
        for (const c of cells) {
          const key = `${c[0]},${c[1]},${c[2]}`;
          if (!seen.has(key)) {
            seen.add(key);
            list.push(c);
          }
          cellOwner.set(key, r);
          cellOwnerXZ.set(`${c[0]},${c[2]}`, r);
        }
      }
      roomCells.set(r.data.id, list);
      const box = new THREE.Box3();
      for (const c of r.cells) box.union(c);
      roomBounds.set(r.data.id, box);

      roomLights.set(
        r.data.id,
        r.slots.map((s) => ({
          position: s.position,
          range: s.range,
          active: () => s.pooled !== false && s.item.power !== 0 && s.item.pattern !== 'off',
        })),
      );
    }

    // 1. Door portals (dynamic open / see-through / porthole predicate).
    const doorEdgeKeys = new Set<string>();
    for (const d of this.doors) {
      doorEdgeKeys.add(sharedEdgeKey(d.data.cell, d.data.rot));
      const matrix = cellMatrix(d.data.cell, d.data.rot);
      const cb = d.visual.closedBox;
      const zMid = (cb.min[2] + cb.max[2]) * 0.5;
      const verts: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
        new THREE.Vector3(cb.min[0], cb.min[1], zMid).applyMatrix4(matrix),
        new THREE.Vector3(cb.max[0], cb.min[1], zMid).applyMatrix4(matrix),
        new THREE.Vector3(cb.max[0], cb.max[1], zMid).applyMatrix4(matrix),
        new THREE.Vector3(cb.min[0], cb.max[1], zMid).applyMatrix4(matrix),
      ];
      portals.push({
        rooms: [d.rooms[0].data.id, d.rooms[1].data.id],
        verts,
        box: quadBox(verts),
        passable: () => d.open > 0.001 || d.visual.seeThrough || d.visual.porthole,
      });
    }

    // 2. Glass partition portals (`wall_glass_partition` cell edges).
    const alwaysLinked = new Set<string>();
    const seenGlassEdges = new Set<string>();
    for (const r of this.rooms) {
      const floorY = r.data.floorY ?? 0;
      for (const p of r.data.pieces) {
        if (p.kit !== 'wall_glass_partition') continue;
        const rot = p.rot ?? 0;
        const [dx, dz] = edgeDir(rot);
        const cells = p.cells ?? (p.cell ? [p.cell] : []);
        for (const cell of cells) {
          const edgeKey = sharedEdgeKey(cell, rot);
          if (seenGlassEdges.has(edgeKey)) continue;
          const other =
            cellOwner.get(`${cell[0] + dx},${cell[1]},${cell[2] + dz}`) ??
            cellOwnerXZ.get(`${cell[0] + dx},${cell[2] + dz}`);
          if (!other || other === r) continue;
          seenGlassEdges.add(edgeKey);
          const baseY = cell[1] * DECK_H + floorY;
          const ex = cell[0] * CELL + dx * (CELL / 2);
          const ez = cell[2] * CELL + dz * (CELL / 2);
          const verts = makeVerticalQuad(ex, ez, dx, dz, 3.9 / 2, baseY + 0.35, baseY + 2.54);
          portals.push({
            rooms: [r.data.id, other.data.id],
            verts,
            box: quadBox(verts),
            passable: ALWAYS_OPEN,
          });
          alwaysLinked.add(pairKey(r.data.id, other.data.id));
        }
      }
    }

    // 3. Open `visibleFrom` boundaries (shared non-door edges -> full quad; otherwise AABB fallback).
    for (const toRoom of this.rooms) {
      for (const fromId of toRoom.data.visibleFrom ?? []) {
        const fromRoom = this.roomById.get(fromId);
        if (!fromRoom || fromRoom === toRoom) continue;
        const pk = pairKey(fromId, toRoom.data.id);
        if (alwaysLinked.has(pk)) continue;

        const mutual = fromRoom.data.visibleFrom?.includes(toRoom.data.id) ?? false;
        let sharedEdgesFound = 0;
        if (mutual) {
          const fromFloor = fromRoom.data.floorY ?? 0;
          const toFloor = toRoom.data.floorY ?? 0;
          const minFloor = Math.min(fromFloor, toFloor);
          const maxHeight = Math.max(fromRoom.height, toRoom.height);
          for (const cell of roomCells.get(fromId) ?? []) {
            for (const rot of [0, 90, 180, 270] as const) {
              const [dx, dz] = edgeDir(rot);
              const neighbor = cellOwner.get(`${cell[0] + dx},${cell[1]},${cell[2] + dz}`);
              if (neighbor !== toRoom) continue;
              const edgeKey = sharedEdgeKey(cell, rot);
              if (doorEdgeKeys.has(edgeKey)) continue;
              const ex = cell[0] * CELL + dx * (CELL / 2);
              const ez = cell[2] * CELL + dz * (CELL / 2);
              const baseY = cell[1] * DECK_H;
              const verts = makeVerticalQuad(ex, ez, dx, dz, CELL / 2, baseY + minFloor, baseY + maxHeight);
              portals.push({
                rooms: [fromId, toRoom.data.id],
                verts,
                box: quadBox(verts),
                passable: ALWAYS_OPEN,
              });
              sharedEdgesFound++;
            }
          }
          if (sharedEdgesFound > 0) {
            alwaysLinked.add(pk);
            continue;
          }
        }

        const targetBox = roomBounds.get(toRoom.data.id);
        if (targetBox && !targetBox.isEmpty()) {
          fallbacks.push({ from: fromId, to: toRoom.data.id, targetBox });
        }
      }
    }

    // 4. Exterior ocean windows (`hull.windows` -> `hull.windowViews`).
    for (const w of this.hull.windows) {
      const views = this.hull.windowViews.get(w.room);
      if (!views?.size) continue;
      const verts = makeVerticalQuad(w.x, w.z, w.dx, w.dz, w.halfWidth, w.sill, w.head);
      oceanWindows.push({
        room: w.room,
        verts,
        box: quadBox(verts),
        targets: [...views],
      });
    }

    return new PortalCuller({ portals, fallbacks, oceanWindows, roomLights });
  }

  private buildAllSync(data: LevelData, deps: LevelDeps, rng: Rng): void {
    const occupancy = this.prepareOccupancy(data);
    const hull = new HullBuilder();
    for (const [index, r] of data.rooms.entries()) this.buildRoom(r, index, rng, occupancy, hull);
    this.buildExteriorAndDoors(data, deps, rng, hull);
    const ao = colliderAo(this.collision);
    for (const room of this.rooms) this.mergeRoom(room, ao);
    this.finalizeBuild(data, deps, ao);
  }

  private async buildAllAsync(
    data: LevelData,
    deps: LevelDeps,
    rng: Rng,
    onProgress?: (fraction: number, label: string) => void,
  ): Promise<void> {
    const occupancy = this.prepareOccupancy(data);
    const hull = new HullBuilder();
    const totalRooms = Math.max(1, data.rooms.length);
    for (const [index, r] of data.rooms.entries()) {
      onProgress?.((index / totalRooms) * 0.45, `Building ${r.name}…`);
      this.buildRoom(r, index, rng, occupancy, hull);
      await yieldFrame();
    }
    onProgress?.(0.48, 'Building exterior hull and doors…');
    this.buildExteriorAndDoors(data, deps, rng, hull);
    await yieldFrame();
    const ao = colliderAo(this.collision);
    for (let i = 0; i < this.rooms.length; i++) {
      const room = this.rooms[i]!;
      onProgress?.(0.5 + (i / totalRooms) * 0.45, `Baking lighting: ${room.data.name}…`);
      this.mergeRoom(room, ao);
      await yieldFrame();
    }
    onProgress?.(0.97, 'Finalizing station layout…');
    this.finalizeBuild(data, deps, ao);
    onProgress?.(1, 'Station built');
  }

  // ---------------------------------------------------------------- building

  private buildRoom(r: RoomData, index: number, rng: Rng, occupancy: GridOccupancy, hull: HullBuilder): void {
    const { materials: m, registry } = this.deps;
    const height = r.height ?? ROOM_H;
    const floorY = r.floorY ?? 0;
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
    const rawSlots: RawSlot[] = [];
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
        // A sunken room (level-kit spec) builds every piece from `floorY`, one ceiling-height taller, so the
        // ceiling stays at `height` and walls reach down to the floor without a seam at deck level.
        const matrix = floorY !== 0 ? new THREE.Matrix4().makeTranslation(0, floorY, 0).multiply(cellMatrix(cell, rot)) : cellMatrix(cell, rot);
        const params: PieceParams = { height: height - floorY, ...(r.area !== undefined ? { area: r.area } : {}), ...(piece.params ?? {}) };
        const out = registry.create(piece.kit, params, rng.fork(`${r.id}:${piece.kit}:${cell.join(',')}`), m);
        const hullHeight = (piece.kit.startsWith('wall_') || piece.kit.startsWith('ceiling')) && typeof params.height === 'number' ? params.height : height - floorY;
        hull.addPiece(r.id, cell, piece.kit, rot, hullHeight, out.sockets, floorY);
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
          room.cells.push(new THREE.Box3(new THREE.Vector3(x - 2, y + floorY - 0.5, z - 2), new THREE.Vector3(x + 2, y + Math.max(height, CORRIDOR_H), z + 2)));
        }
      }
    }
    if (r.water) {
      const cells = [...cellKeys].map((k) => {
        const [cx, , cz] = k.split(',').map(Number) as [number, number, number];
        return { minX: cx * CELL - 2, maxX: cx * CELL + 2, minZ: cz * CELL - 2, maxZ: cz * CELL + 2 };
      });
      const body = new WaterBody({ room: r.id, level: r.water.level, floor: r.water.floor ?? floorY, cells });
      this.water.add(body);
      const surface = new WaterSurface(body);
      this.waterSurfaces.set(r.id, surface);
      room.group.add(surface.mesh);
      room.ticks.push((t) => surface.update(t));
      if (r.water.junk?.length) {
        const junk = new FloatingJunk(r.water.junk, surface.uniforms);
        room.group.add(junk.group);
        room.ticks.push(() => junk.update(body.level));
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
      if (prop.dynamic) {
        // A physics prop (adopt-physics-engine D11): keep the whole piece as one movable group, out of the room merge,
        // so its meshes and collision boxes follow its rigid body.
        const id = typeof prop.params?.['id'] === 'string' ? prop.params['id'] : `${r.id}:${prop.kit}:${pi}`;
        const grp = new THREE.Group();
        grp.name = `prop:${id}`;
        grp.userData['propId'] = id;
        grp.userData.dynamic = true;
        for (const child of [...out.object.children]) grp.add(child);
        out.object.add(grp);
        this.dynamicProps.set(id, { mass: prop.dynamic.mass, room: r.id });
        this.offs.push(this.casters.add(new RigidCaster(grp)));
      }
      this.integrate(room, out, matrix, ry, rawSlots);
    }

    // Claim light slots.
    const claimed = new Set<number>();
    const swingRefs: Array<{ ref: null | { position: THREE.Vector3 } }> = [];
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
      if (slot.swing) {
        // A swinging fixture: its glow rides a pivot and its pooled light follows (flooded-tunnel spec).
        const sw = slot.swing;
        const pivot = new THREE.Group();
        pivot.position.copy(sw.pivot);
        pivot.rotation.order = 'YXZ';
        pivot.rotation.y = slot.ry;
        room.group.add(pivot);
        pivot.attach(mesh);
        const swingSlot = { ref: null as null | { position: THREE.Vector3 } };
        room.ticks.push((t) => {
          pivot.rotation.x = swingAngle(sw, t);
          pivot.updateMatrixWorld(true);
          if (swingSlot.ref) mesh.getWorldPosition(swingSlot.ref.position).y -= drop;
        });
        swingRefs.push(swingSlot);
        // Knockable (shadow-rich-rooms D6): its rest point, and the direction a positive knock swings it.
        if (sw.jolt) this.swingers.push({ room: r.id, swing: sw, rest: slot.pos.clone(), along: new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), slot.ry) });
      }
      const shafts: ShaftUniforms[] = [];
      if (slot.kind === 'ceiling' && shaftBase > 0) {
        // A shaft stops at the floor, or at the surface of standing water (standing-water spec: murk hides what is under it).
        const len = Math.min(slot.pos.y - 0.15 - (r.water ? Math.max(r.water.level, floorY) : floorY), 3.2);
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
        ...(light.shadow === true ? { shadow: true } : {}),
        ...(light.cookie ? { cookie: light.cookie } : {}),
        ...(light.backup === true ? { backup: true } : {}),
        ...(light.ownColor === true ? { ownColor: true } : {}),
        ...(light.backupScale !== undefined ? { backupScale: light.backupScale, backup: true } : {}),
        score: 0,
      });
      if (slot.swing) swingRefs.at(-1)!.ref = room.slots[room.slots.length - 1]!;
      if (light.sparks) this.sparkers.push({ room, position: room.slots[room.slots.length - 1]!.position, light: item, prev: 1 });
      if (light.id) {
        if (this.namedLights.has(light.id)) console.warn(`[level] light id "${light.id}" is used twice`);
        const s = room.slots[room.slots.length - 1]!;
        this.namedLights.set(light.id, { slot: s, color: s.color.clone(), glows: s.item.emissives.map((m) => m.emissive.clone()) });
      }
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

  /** Discard work_* spots that fall outside their room cells or clip walls/props (minimum 0.28 m clearance). */
  private filterWorkSpots(): void {
    const clearR = 0.28;
    const hits: Collider[] = [];
    let write = 0;
    for (let i = 0; i < this.spotList.length; i++) {
      const s = this.spotList[i]!;
      if (!s.kind.startsWith('work_')) {
        this.spotList[write++] = s;
        continue;
      }
      const room = this.roomById.get(s.room);
      if (!room) continue;
      const probe = new THREE.Vector3(s.pos.x, s.pos.y + 0.5, s.pos.z);
      if (!room.cells.some((c) => c.containsPoint(probe))) continue;
      hits.length = 0;
      this.collision.find(s.pos.x - clearR, s.pos.z - clearR, s.pos.x + clearR, s.pos.z + clearR, hits);
      let blocked = false;
      for (const c of hits) {
        if (c.maxY <= s.pos.y + 0.12 || c.minY >= s.pos.y + 1.75) continue;
        const cx = Math.max(c.minX, Math.min(s.pos.x, c.maxX));
        const cz = Math.max(c.minZ, Math.min(s.pos.z, c.maxZ));
        if (Math.hypot(s.pos.x - cx, s.pos.z - cz) < clearR) {
          blocked = true;
          break;
        }
      }
      if (!blocked) this.spotList[write++] = s;
    }
    this.spotList.length = write;
  }

  /** Positional looping sound emitters declared by level props, in world space. */
  soundLoops(): readonly WorldSoundLoop[] {
    return this.soundLoopList;
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
  private integrate(room: RoomRuntime, out: PieceOutput, matrix: THREE.Matrix4, ry: number, slots: RawSlot[]): void {
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
    for (const s of out.lightSlots) {
      const pos = new THREE.Vector3(...s.pos).applyMatrix4(matrix);
      slots.push(s.swing ? { pos, kind: s.kind, ry: s.ry + ry, swing: { ...s.swing, pivot: new THREE.Vector3(...s.swing.pivot).applyMatrix4(matrix) } } : { pos, kind: s.kind, ry: s.ry + ry });
    }
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
      this.offs.push(this.deps.events.on(l.event as EventName, l.fn as never));
      this.onNamed(l.event, () => l.fn(undefined));
    }
    for (const sl of out.soundLoops ?? []) {
      this.soundLoopList.push({
        room: room.data.id,
        sound: sl.sound,
        position: new THREE.Vector3(...sl.pos).applyMatrix4(matrix),
        gain: sl.gain,
        maxDist: sl.maxDist ?? 16,
        bus: sl.bus ?? 'ambience',
        ...(sl.rate !== undefined ? { rate: sl.rate } : {}),
        ...(sl.cutoff !== undefined ? { cutoff: sl.cutoff } : {}),
        ...(sl.reverb !== undefined ? { reverb: sl.reverb } : {}),
        ...(sl.active ? { active: sl.active } : {}),
      });
    }
    out.onSound?.((ev) => {
      const position = new THREE.Vector3(...ev.pos).applyMatrix4(matrix);
      this.deps.events.emit('world:sfx', {
        sound: ev.sound,
        position,
        ...(ev.gain !== undefined ? { gain: ev.gain } : {}),
        ...(ev.rate !== undefined ? { rate: ev.rate } : {}),
        ...(ev.reverb !== undefined ? { reverb: ev.reverb } : {}),
        ...(ev.bus !== undefined ? { bus: ev.bus } : {}),
        ...(ev.maxDist !== undefined ? { maxDist: ev.maxDist } : {}),
      });
    });
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

  /**
   * Props the level data marks `dynamic` (adopt-physics-engine D11): their group, mass, collision boxes in the prop's
   * own frame, and the live `CollisionWorld` colliders that follow it. Empty for a level with none.
   */
  physicsProps(): Array<{ id: string; mass: number; object: THREE.Object3D; localColliders: readonly BoxSpec[]; colliders: readonly Collider[] }> {
    const out = [];
    for (const [id, d] of this.dynamicProps) {
      const mp = this.movableProps.get(id);
      if (mp) out.push({ id, mass: d.mass, object: mp.object, localColliders: mp.localColliders, colliders: mp.colliders });
    }
    return out;
  }

  /**
   * Put a movable prop at a full pose (a physics prop that slid or tipped over). Its collision boxes become the
   * axis-aligned bounds of the turned boxes, so the player and enemies still collide with it where it lies.
   */
  setPropPose(id: string, pos: { x: number; y: number; z: number }, rotation: { x: number; y: number; z: number; w: number }): boolean {
    const mp = this.movableProps.get(id);
    if (!mp) return false;
    mp.object.position.set(pos.x, pos.y, pos.z);
    mp.object.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    mp.object.updateMatrixWorld(true);
    const e = new THREE.Euler().setFromQuaternion(mp.object.quaternion, 'YXZ');
    mp.yaw = e.y;
    const mat = new THREE.Matrix4().compose(mp.object.position, mp.object.quaternion, new THREE.Vector3(1, 1, 1));
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
      { porthole: d.params?.['porthole'] === true },
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
    // A moving door leaf redraws the cached shadow maps it falls in (shadow-rich-rooms D4); the version follows the
    // leaves' pose, so every way a door moves (auto, scripted, pried) counts.
    this.offs.push(this.casters.add(doorCaster(visual.leaves, group, center)));
    if (d.unlockOn) {
      const name = d.unlockOn;
      this.onNamed(name, () => this.unlockDoor(door, 'script'));
      // A sequence `emit` of the same name unlocks it too (e.g. `drop:done`, ADR-0014 beat 2).
      this.offs.push(this.deps.events.on(name as EventName, (() => this.unlockDoor(door, 'script')) as never));
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
  /** Does something solid stand through a water surface at height `y` here (a wall, a step above it, a case)? */
  solidThroughSurface(x: number, z: number, y: number): boolean {
    const out = this.collision.query(x, z, x, z, this.solidScratch);
    const hit = out.some((b) => b.min[0] <= x && b.max[0] >= x && b.min[2] <= z && b.max[2] >= z && b.min[1] < y - 0.01 && b.max[1] > y + 0.01);
    out.length = 0;
    return hit;
  }

  private readonly solidScratch: Aabb[] = [];

  /**
   * Floor height for gore and pools at (x, z): deck level (0), except over a sunken room (level-kit spec), where it is
   * the highest walkable top at or below deck level there (the sunken floor, a submerged step, a landing).
   */
  floorAt(x: number, z: number): number {
    const sunken = this.rooms.find((r) => (r.data.floorY ?? 0) < 0 && r.cells.some((c) => x >= c.min.x && x <= c.max.x && z >= c.min.z && z <= c.max.z));
    if (!sunken) return 0;
    const out = this.collision.query(x, z, x, z, this.solidScratch);
    let top = sunken.data.floorY ?? 0;
    for (const b of out) if (b.min[0] <= x && b.max[0] >= x && b.min[2] <= z && b.max[2] >= z && b.max[1] <= 0.05 && b.max[1] > top) top = b.max[1];
    out.length = 0;
    return top;
  }

  /** Is this room drawn this frame (it, or what its open doors and windows show)? */
  roomVisible(id: string): boolean {
    return this.roomById.get(id)?.visible ?? false;
  }

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

  /**
   * How a voice at `from` reaches a listener at `to` through rooms, doorways and glass (voice-playback: Voices carry
   * through the station), or null when it is too many rooms away to hear. Door states are read live.
   */
  voicePath(from: THREE.Vector3, to: THREE.Vector3): VoicePath | null {
    return this.voiceGraph().path(from, this.roomAt(from)?.data.id ?? null, to, this.roomAt(to)?.data.id ?? null);
  }

  private voiceGraphCache: VoiceGraph | null = null;

  private voiceGraph(): VoiceGraph {
    if (this.voiceGraphCache) return this.voiceGraphCache;
    const portals: VoicePortal[] = this.doors.map((d) => ({
      rooms: [d.rooms[0].data.id, d.rooms[1].data.id] as const,
      at: d.center,
      // Half open is open enough to talk through; a closed glass door lets a voice through as glass does.
      state: () => (d.open > 0.3 ? 'open' : d.visual.seeThrough ? 'glass' : 'closed'),
    }));
    // Windows and glass partitions: rooms declared visible from each other share a glass portal at their boundary.
    const seen = new Set<string>();
    for (const r of this.rooms) {
      for (const other of r.data.visibleFrom ?? []) {
        const o = this.roomById.get(other);
        const key = [r.data.id, other].sort().join('|');
        if (!o || seen.has(key)) continue;
        seen.add(key);
        portals.push({ rooms: [r.data.id, other] as const, at: roomBoundaryPoint(r.cells, o.cells), state: () => 'glass' });
      }
    }
    this.voiceGraphCache = new VoiceGraph(portals);
    return this.voiceGraphCache;
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

  /** Build the Recast navmesh asynchronously (off-thread in browsers via navmeshWorker) and cache it. */
  async buildNavAsync(): Promise<Navigator> {
    if (this.nav) return this.nav;
    const t0 = performance.now();
    const navDoors = this.doors.map((d) => ({ id: d.data.id, box: d.collider as Aabb, isOpen: () => !d.collider.enabled || this.opensForActors(d) }));
    const leaves = new Set<unknown>(this.doors.map((d) => d.collider));
    const mesh = await NavMeshNav.buildAsync({
      world: this.collision,
      boxes: this.collision.colliders.filter((c) => !leaves.has(c)),
      doors: navDoors,
    });
    const missing = mesh.unmarkedDoors();
    if (missing.length) console.warn(`[nav] doorways with no navmesh: ${missing.join(', ')}`);
    console.info(`[nav] navmesh: ${mesh.edgeCount()} polygons in ${(performance.now() - t0).toFixed(0)} ms`);
    this.nav = mesh;
    return mesh;
  }

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
    d.held = state === 'open';
    d.forced = null;
    return true;
  }

  /**
   * Force a door's leaves to `open` (0..1) over `seconds` without changing its state (`doorPry`, level-kit spec): a sealed
   * door stays sealed while something pries it. The next `setDoor` closes or opens it from there. False for unknown ids.
   */
  pryDoor(id: string, open: number, seconds: number): boolean {
    const d = this.doors.find((x) => x.data.id === id);
    if (!d) return false;
    const target = Math.min(1, Math.max(0, open));
    if (seconds <= 0) {
      d.open = target;
      d.visual.setOpen(target * target * (3 - 2 * target));
      d.collider.enabled = d.open < 0.6;
    }
    d.forced = { target, rate: seconds > 0 ? Math.max(1e-3, Math.abs(target - d.open) / seconds) : Infinity };
    d.target = target;
    return true;
  }

  /** How far each door's leaves are open (0..1), by id: for tests and the debug overlay. */
  doorOpenness(id: string): number | null {
    return this.doors.find((x) => x.data.id === id)?.open ?? null;
  }

  /**
   * Back to the level as authored (new game, load; ADR-0016/0023): door states, trigger
   * `once` latches, vents, light patterns and tints, and key pickups the player does not hold.
   * Sequences then re-apply story state from the flags (`quiet_restore`).
   */
  resetToData(): void {
    for (const d of this.doors) {
      d.granted = false;
      d.held = false;
      d.forced = null;
      this.setDoorState(d, d.data.state);
      d.target = d.state === 'open' ? 1 : 0;
      d.open = d.target;
      d.visual.setOpen(d.open);
      d.away = 0;
      d.moving = null;
      d.collider.enabled = d.open < 0.6;
    }
    for (const t of this.triggers) t.fired = false;
    this.setPower('mains');
    this.lights.items.forEach((it, i) => {
      it.pattern = this.initialPatterns[i] ?? it.pattern;
    });
    for (const room of [...this.tinted.keys()]) this.tintRoomLights(room, 'none');
    for (const id of this.namedLights.keys()) this.setLight(id, this.namedLights.get(id)!.slot.item.pattern, 'none');
    for (const v of this.vents) {
      v.open = false;
      v.granted = false;
    }
    for (const pk of this.pickups) pk.mesh.visible = !this.deps.inventory?.has(pk.data.item);
    for (const r of this.source.rooms) if (r.water) this.water.room(r.id)?.setLevel(r.water.level);
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
  /**
   * Switch one named light (render-lighting spec: a single scripted light): its pattern, and a tint ("emergency", a
   * "#rrggbb" colour, or "none" for its own colour). Every other light in its room keeps its pattern and colour.
   */
  setLight(id: string, pattern: LightPattern, tint?: string): boolean {
    const named = this.namedLights.get(id);
    if (!named) return false;
    named.slot.item.pattern = pattern;
    if (tint !== undefined) {
      const color = tint === 'none' ? named.color : new THREE.Color(tint === 'emergency' ? '#ff2a1a' : tint);
      named.slot.color.copy(color);
      named.slot.item.emissives.forEach((m, i) => m.emissive.copy(tint === 'none' ? named.glows[i] ?? m.emissive : color));
    }
    return true;
  }

  /** Current station power (station-power spec). */
  get power(): StationPower {
    return this.powerState;
  }

  /**
   * Station power (station-power spec, render-lighting "Backup lights"). Under `backup` every room's main lights go
   * out and only its backup lights glow: `emergency` slots and lights marked `backup`, or the room's first claimed
   * light when it has neither. Patterns and tints stay stored per light, so `mains` puts every light back as it was.
   */
  setPower(state: StationPower): void {
    if (state === this.powerState) return;
    this.powerState = state;
    for (const room of this.rooms) {
      const marked = room.slots.filter((s) => s.kind === 'emergency' || s.backup === true);
      const backups = new Set(marked.length > 0 ? marked : room.slots.slice(0, 1));
      for (const s of room.slots) {
        const isBackup = backups.has(s);
        if (state === 'mains') {
          s.item.power = 1;
          const saved = this.backupSaved.get(s);
          if (saved) {
            s.color.copy(saved.color);
            s.item.emissives.forEach((m, i) => m.emissive.copy(saved.glows[i] ?? m.emissive));
            s.range = saved.range;
            // A standby beacon goes dark again, unless a script has switched it meanwhile.
            if (s.kind === 'emergency' && saved.pattern === 'off' && s.item.pattern === 'steady') s.item.pattern = 'off';
            this.backupSaved.delete(s);
          }
          continue;
        }
        s.item.power = isBackup ? (s.backupScale ?? BACKUP_LIGHT.scale) : 0;
        if (!isBackup) continue;
        this.backupSaved.set(s, { color: s.color.clone(), glows: s.item.emissives.map((m) => m.emissive.clone()), range: s.range, pattern: s.item.pattern });
        // An emergency beacon on standby (`off` on main power) comes on when the mains fail.
        if (s.kind === 'emergency' && s.item.pattern === 'off') s.item.pattern = 'steady';
        if (!s.ownColor) {
          s.color.set(BACKUP_LIGHT.color);
          for (const m of s.item.emissives) m.emissive.set(BACKUP_LIGHT.color);
        }
        if (s.backupScale === undefined) s.range *= BACKUP_LIGHT.range;
      }
    }
    this.deps.events.emit('power:changed', { state });
  }

  setRoomLights(room: string, pattern: LightPattern): boolean {
    let any = false;
    for (const it of this.lights.items) {
      if (!it.name.startsWith(`${room} `)) continue;
      it.pattern = pattern;
      any = true;
    }
    return any;
  }

  /** Broken fixtures (`sparks: true`) of the visible rooms, with their last brightness. */
  private readonly sparkers: Array<{ room: RoomRuntime; position: THREE.Vector3; light: ControlledLight; prev: number }> = [];

  /** A broken fixture throws sparks when its tube cuts out or strikes back on (flooded-tunnel spec). */
  private updateSparks(): void {
    for (const s of this.sparkers) {
      const now = s.light.level;
      const strike = s.prev < 0.4 && now > 0.75;
      const cut = s.prev > 0.75 && now < 0.3;
      if ((strike || cut) && s.room.visible) this.deps.events.emit('light:sparks', { x: s.position.x, y: s.position.y, z: s.position.z, strong: cut });
      s.prev = now;
    }
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

  /**
   * What lights each claimed slot of the visible rooms this frame, for the ?debug lighting overlay (shadow-rich-rooms D9):
   * a shadow spot, a fill light, or nothing (the pool was full, or the light is out).
   */
  lightingState(): {
    slots: Array<{ slot: PooledSlot; by: 'shadow' | 'fill' | 'none' }>;
    claimed: number;
    room: string | null;
  } {
    const slots: Array<{ slot: PooledSlot; by: 'shadow' | 'fill' | 'none' }> = [];
    for (const r of this.rooms) {
      if (!r.visible) continue;
      for (const s of r.slots) {
        const l = s.item.light;
        slots.push({ slot: s, by: l instanceof THREE.SpotLight ? 'shadow' : l ? 'fill' : 'none' });
      }
    }
    return { slots, claimed: slots.length, room: this.current?.data.id ?? null };
  }

  /**
   * Knock swinging lamps within `radius` of `at` (a shotgun blast): each gains up to `strength` rad/s of swing, less
   * with distance, away from the blast. Returns how many were knocked (render-lighting "Swaying lights").
   */
  joltLightsNear(at: THREE.Vector3, radius: number, strength: number): number {
    let n = 0;
    for (const s of this.swingers) {
      const d = s.rest.distanceTo(at);
      if (d > radius) continue;
      const side = Math.sign(this.scratch2.copy(s.rest).sub(at).dot(s.along)) || 1;
      joltSwing(s.swing.jolt!, side * strength * (1 - d / radius));
      n++;
    }
    return n;
  }

  /** Knock swinging lamps whose bulb a shot's ray (from `from` along `dir`, `length` m) passes within `reach` m of. */
  joltLightsAlong(from: THREE.Vector3, dir: THREE.Vector3, length: number, strength: number, reach = 0.3): number {
    let n = 0;
    for (const s of this.swingers) {
      const t = this.scratch2.copy(s.rest).sub(from).dot(dir);
      if (t < 0 || t > length) continue;
      const closest = this.scratch2.copy(from).addScaledVector(dir, t);
      if (closest.distanceTo(s.rest) > reach) continue;
      joltSwing(s.swing.jolt!, (Math.sign(dir.dot(s.along)) || 1) * strength);
      n++;
    }
    return n;
  }

  /** Knock every swinging lamp in a room (the `lightJolt` sequence action). False when the room has none. */
  joltRoomLights(roomId: string, strength: number): boolean {
    let any = false;
    for (const s of this.swingers) {
      if (s.room !== roomId) continue;
      joltSwing(s.swing.jolt!, strength);
      any = true;
    }
    return any;
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
        else if (d.state === 'open' && !d.held) {
          // Hold open until the leaves finish opening and nobody is nearby for AUTO_DOOR_HOLD seconds.
          d.away = d.open >= 1 && dist > AUTO_CLOSE_PLAYER_DIST && actor > AUTO_CLOSE_ACTOR_DIST ? d.away + dt : 0;
          if (d.away >= AUTO_DOOR_HOLD) {
            this.setDoorState(d, 'closed');
            d.target = 0;
          }
        }
      }
      if (d.state !== 'open' && d.target > 0) d.target = 0;
      // A pried door holds its forced opening whatever its state.
      if (d.forced) d.target = d.forced.target;
      // Never close on the player standing in the doorway: auto doors smoothly re-open, sealed/manual doors pause.
      if (d.target === 0 && d.open > 0 && dist < 0.9) {
        if (d.auto && this.doorAccessOpen(d)) this.openDoor(d);
        else d.target = d.open;
      }
      const speed = d.forced ? dt * d.forced.rate : dt / d.visual.travelTime;
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

  update(t: number, dt: number, eye: THREE.Vector3, reducedFlashing: boolean, camera?: THREE.Camera): void {
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
    this.water.update(dt);

    // Frustum-clipped multi-hop portal culling.
    const cur = this.current;
    this.cull(cur, room ? undefined : eye, camera);

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
      const amb = this.powerState === 'backup' ? this.backupAmbient : cur.ambient;
      this.hemi.color.lerp(amb.sky, k);
      this.hemi.groundColor.lerp(amb.ground, k);
      this.hemi.intensity += (amb.intensity - this.hemi.intensity) * k;
      this.keyFill.color.lerp(amb.keyColor, k);
      this.keyFill.intensity += (amb.keyIntensity - this.keyFill.intensity) * k;
    }

    // Light pool: slots of visible rooms, current room first; shadow lights to what is in view.
    let frustum: THREE.Frustum | null = null;
    if (camera) {
      camera.updateMatrixWorld();
      this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum = this.viewFrustum.setFromProjectionMatrix(this.viewProj);
    }
    this.bindLights(cur, eye, true, dt, frustum);
    this.lastTime = t;
    this.lastFlashing = reducedFlashing;
    flashingState.reduced = reducedFlashing;
    this.lights.update(t, reducedFlashing);
    this.updateSparks();
    this.pool.finish();
    this.shadowPool.finish();

    for (const r of this.rooms) if (r.visible) for (const tick of r.ticks) tick(t, dt);
    const outside = this.rooms.some((r) => r.visible && this.exteriorRooms.has(r.data.id));
    this.exterior.update(t, eye, outside, reducedFlashing, outside ? this.pieceLamps() : undefined);
    for (const d of this.doors) if (d.group.visible) d.visual.tick(t);
    // Taken pickups stay gone, also after loading a save that holds the item.
    const inv = this.deps.inventory;
    for (const pk of this.pickups) pk.mesh.visible = !inv?.has(pk.data.item);
    this.dust.update(eye, t, dt);
  }

  /**
   * Which rooms (and doors) draw when the view is in `cur`: recursive frustum-clipped portal traversal
   * across open/see-through doors, glass partitions, open `visibleFrom` boundaries, and ocean windows,
   * with a 1-hop light-bleed guard and a 360-degree transitive fallback when `camera` is omitted.
   */
  private cull(cur: RoomRuntime | null, exteriorEye?: THREE.Vector3, camera?: THREE.Camera): void {
    if (!cur) {
      for (const r of this.rooms) {
        r.visible = true;
        r.group.visible = true;
      }
      for (const d of this.doors) d.group.visible = true;
      return;
    }
    this.portalCuller.computeVisible(cur.data.id, this.visibleRoomIds, camera, exteriorEye);
    // An exterior camera can see directly into a seaward-facing pane without a source window.
    if (exteriorEye) {
      for (const w of this.hull.windows) {
        if ((exteriorEye.x - w.x) * w.dx + (exteriorEye.z - w.z) * w.dz > 0) this.visibleRoomIds.add(w.room);
      }
    }
    for (const r of this.rooms) {
      r.visible = this.visibleRoomIds.has(r.data.id);
      r.group.visible = r.visible;
    }
    for (const d of this.doors) d.group.visible = d.rooms[0].visible || d.rooms[1].visible;
  }

  /**
   * Give the visible rooms' light slots to the pooled lights, nearest `eye` first, `cur` first of all.
   * Opted-in slots take the shadow spots first, ranked by `frustum` and held across frames (render-lighting); the
   * rest share the fill pool. With `shadows` false (a side view) the shadow pool is suspended, not re-bound.
   */
  private bindLights(cur: RoomRuntime | null, eye: THREE.Vector3, shadows = true, dt = 0, frustum: THREE.Frustum | null = null): void {
    const slots = this.visibleSlots;
    const fill = this.fillSlots;
    slots.length = 0;
    fill.length = 0;
    for (const r of this.rooms) {
      if (!r.visible) {
        for (const s of r.slots) s.item.light = null;
        continue;
      }
      for (const s of r.slots) {
        if (s.pooled === false || s.item.power === 0 || s.item.pattern === 'off') {
          // Glow-only, switched off, or out under backup power: patterns and tints still drive its fixture.
          s.item.light = null;
          continue;
        }
        s.priority = r === cur ? 1 : 0;
        slots.push(s);
      }
    }
    if (shadows) this.shadowPool.assign(slots, eye, { dt, frustum, casters: this.casters });
    else this.shadowPool.suspend();
    for (const s of slots) if (!this.shadowPool.holds(s)) fill.push(s);
    this.pool.assign(fill, eye);
  }

  /** Resize the light pools for a quality tier (render-lighting spec). Materials recompile once, on the next frame. */
  setLightBudget(budget: LightBudget): void {
    this.pool.resize(budget.fillLights);
    this.shadowPool.resize(budget.shadowLights, budget.shadowMapSize, budget.cookieSpots ?? 0);
  }

  /**
   * Run `draw` as if the view were at `eye` (a security camera feed, ADR-0023): the rooms it can
   * see are visible and the pooled lights are bound around it. The player's own view is set up
   * again by the next `update`, so call this before it each frame, never between `update` and the
   * main render. Light patterns are not advanced (`update` does that).
   */
  renderFromEye(eye: THREE.Vector3, draw: () => void, camera?: THREE.Camera): void {
    const room = this.roomAt(eye);
    this.cull(room, undefined, camera);
    // Feeds light their rooms unshadowed: the frame's one shadow pass belongs to the player's view.
    this.bindLights(room, eye, false);
    this.lights.update(this.lastTime, this.lastFlashing); // sets the bound lights' intensities for these slots
    this.pool.finish();
    this.shadowPool.finish();
    draw();
  }

  attract(t: number, camera: THREE.PerspectiveCamera): void {
    camera.position.copy(this.spawn.position);
    camera.position.y += Math.sin(t * 0.3) * 0.03;
    camera.rotation.set(-0.06 + Math.sin(t * 0.07) * 0.05, this.spawn.yaw + Math.sin(t * 0.09) * 0.45, 0);
  }

  /** Release geometries, non-shared materials/textures, light pools, water surfaces, navmesh and listeners. */
  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.pool.resize(0);
    this.shadowPool.resize(0);
    this.hemi.dispose();
    this.keyFill.dispose();
    this.dust.dispose();
    for (const surface of this.waterSurfaces.values()) surface.dispose();
    this.waterSurfaces.clear();
    if (this.nav instanceof NavMeshNav) this.nav.destroy();
    this.nav = null;
    if (this.checkerMat) {
      const map = (this.checkerMat as THREE.MeshStandardMaterial).map;
      if (map) disposeTexture(map);
      this.checkerMat.dispose();
      this.checkerMat = null;
    }
    const sharedMats = new Set<THREE.Material>();
    for (const m of Object.values(this.deps.materials)) {
      if (m instanceof THREE.Material) sharedMats.add(m);
    }
    const sharedTex = new Set<THREE.Texture>();
    const texSlots = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'displacementMap'] as const;
    for (const m of sharedMats) {
      const rec = m as unknown as Record<string, unknown>;
      for (const slot of texSlots) {
        const t = rec[slot];
        if (t instanceof THREE.Texture) sharedTex.add(t);
      }
    }
    const geoms = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Line) {
        if (o.geometry) geoms.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (!(m instanceof THREE.Material) || sharedMats.has(m)) continue;
          mats.add(m);
          const rec = m as unknown as Record<string, unknown>;
          for (const slot of texSlots) {
            const t = rec[slot];
            if (t instanceof THREE.Texture && !sharedTex.has(t)) textures.add(t);
          }
        }
      }
    });
    for (const g of geoms) g.dispose();
    for (const t of textures) disposeTexture(t);
    for (const m of mats) m.dispose();
    this.group.clear();
  }
}

function glowGeometry(kind: LightSlotKind): THREE.BufferGeometry {
  if (kind === 'ceiling') return new THREE.BoxGeometry(1.2, 0.02, 0.24);
  if (kind === 'emergency') return new THREE.SphereGeometry(0.075, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  if (kind === 'pendant') return new THREE.SphereGeometry(0.06, 12, 8); // the bulb inside the pendant_light shade
  return new THREE.SphereGeometry(0.07, 12, 8);
}

/** The point where two rooms' cells come closest: the middle of their shared wall, for a glass portal. */
function roomBoundaryPoint(a: readonly THREE.Box3[], b: readonly THREE.Box3[]): THREE.Vector3 {
  let best = new THREE.Vector3();
  let bestD = Infinity;
  const ca = new THREE.Vector3();
  const pa = new THREE.Vector3();
  const pb = new THREE.Vector3();
  for (const x of a) {
    for (const y of b) {
      y.getCenter(ca);
      x.clampPoint(ca, pa);
      y.clampPoint(pa, pb);
      const d = pa.distanceToSquared(pb);
      if (d < bestD) {
        bestD = d;
        best = pa.clone().add(pb).multiplyScalar(0.5);
      }
    }
  }
  best.y = Math.min(best.y, (a[0]?.min.y ?? 0) + 1.6);
  return best;
}
