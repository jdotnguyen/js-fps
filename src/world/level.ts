import * as THREE from 'three';
import type { EventBus, EventName } from '../core/events.ts';
import { Rng } from '../core/rng.ts';
import { isKeyPickup, type AmbientPreset, type DoorData, type DoorState, type KeyPickupData, type LevelData, type RoomData, type TriggerData, type UnlockSource, type VentData } from '../data/types/level.ts';
import type { UiText } from '../data/types/uiText.ts';
import type { Inventory } from '../game/inventory.ts';
import { accessOpen, checkAccess, type AccessHint, type GateKind } from './access.ts';
import { createShaft } from '../render/fx/shafts.ts';
import { Particulates } from '../render/fx/particulates.ts';
import { LightController, type LightPattern, type ShaftUniforms } from '../render/lights.ts';
import { fixtureMaterial, type Materials } from '../render/materials.ts';
import { CollisionWorld, type Collider } from './collision.ts';
import { at } from './kit/geom.ts';
import { buildDoor, type DoorVisual } from './kit/doors.ts';
import { AoMergeBuilder, type AoFn } from './kit/merge.ts';
import { CELL, CORRIDOR_H, DECK_H, ROOM_H, transformBox, type BoxSpec, type LightSlotKind, type PieceOutput, type PieceParams } from './kit/types.ts';
import { LightPool, type PooledSlot } from './lightPool.ts';
import type { KitRegistry } from './registry.ts';
import type { Interactable, Interactions } from '../actors/interaction.ts';
import type { Aabb } from '../actors/motor.ts';
import { PLAYER_TUNING, type PlayerWorld } from '../actors/player.ts';
import type { World, WorldCheckpoint } from './world.ts';
import { gridNodes, NavGraph, type P3 } from '../ai/nav.ts';

const EYE_HEIGHT = PLAYER_TUNING.eyeHeight;

declare module '../core/events.ts' {
  interface EventMap {
    'room:entered': { id: string; name: string; reverb?: string | undefined };
    'door:state': { id: string; state: DoorState };
    'door:opened': { id: string };
    'door:closed': { id: string };
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

export interface LevelDeps {
  materials: Materials;
  registry: KitRegistry;
  events: EventBus;
  scene: THREE.Scene;
  /** Key items held, for access gating (ADR-0024). Without it gated doors never open. */
  inventory?: Inventory | null;
  /** data/dialogue/ui.json, for access hint text. */
  uiText?: UiText;
}

const AMBIENT: Record<AmbientPreset, { sky: number; ground: number; intensity: number }> = {
  normal: { sky: 0x8fb0bd, ground: 0x0e1215, intensity: 0.22 },
  emergency: { sky: 0xb04a3a, ground: 0x120606, intensity: 0.16 },
  flooded: { sky: 0x2f7a80, ground: 0x031012, intensity: 0.24 },
  dark: { sky: 0x4a5a64, ground: 0x050606, intensity: 0.07 },
};
const DEFAULT_FOG = '#04080a';
const DEFAULT_FOG_DENSITY = 0.05;

const SLOT_DEFAULTS: Record<LightSlotKind, { color: string; intensity: number; range: number; emissive: number; drop: number }> = {
  ceiling: { color: '#dcefff', intensity: 10, range: 10, emissive: 3.2, drop: 0.22 },
  wall: { color: '#ffd9a8', intensity: 6, range: 7, emissive: 2.6, drop: 0.12 },
  emergency: { color: '#ff2a1a', intensity: 7, range: 8, emissive: 3, drop: -0.1 },
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
  slots: PooledSlot[];
  ticks: Array<(t: number, dt: number) => void>;
  staticMeshes: THREE.Mesh[];
  merger: AoMergeBuilder;
  ambient: { sky: THREE.Color; ground: THREE.Color; intensity: number };
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
}

export interface RoomStats {
  id: string;
  name: string;
  drawCalls: number;
  triangles: number;
  materials: number;
}

const deg = THREE.MathUtils.degToRad;

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
  private readonly roomById = new Map<string, RoomRuntime>();
  private readonly doors: DoorRuntime[] = [];
  private readonly triggers: TriggerRuntime[] = [];
  private readonly vents: VentRuntime[] = [];
  private readonly pickups: PickupRuntime[] = [];
  /** Named positions from room `anchors` (yaw in radians). */
  private readonly anchors = new Map<string, { pos: THREE.Vector3; yaw: number; room: string }>();
  private readonly npcList: Array<{ id: string; look: string; pos: THREE.Vector3; yaw: number; pose?: string; transformable?: boolean; room: string }> = [];
  private readonly named = new Map<string, Set<() => void>>();
  private readonly hemi: THREE.HemisphereLight;
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

  constructor(data: LevelData, deps: LevelDeps) {
    this.deps = deps;
    this.id = data.id;
    this.source = data;
    this.name = data.name ?? data.id;
    this.group.name = `level:${data.id}`;
    const rng = new Rng(`${data.id}:${data.seed}`);
    this.debug = { sockets: [], slots: [], nav: [], rooms: [], triggers: [], bounds: new THREE.Box3() };
    this.pool = new LightPool(this.group, 8);
    this.hemi = new THREE.HemisphereLight(AMBIENT.normal.sky, AMBIENT.normal.ground, AMBIENT.normal.intensity);
    this.group.add(this.hemi);

    for (const [index, r] of data.rooms.entries()) this.buildRoom(r, index, rng);
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
    }
    for (const door of this.doors) {
      const mb = new AoMergeBuilder();
      for (const mesh of door.staticMeshes) mb.addMesh(mesh);
      door.staticMeshes.length = 0;
      door.group.add(mb.build(`door:${door.data.id}`, ao));
    }
    for (const v of data.vents ?? []) {
      const [min, max] = v.box;
      this.vents.push({ data: v, box: { min, max }, open: false, granted: false });
    }
    // Key items only; supply pickups (ammo, medkits) live in game/pickups.ts.
    for (const pk of data.pickups ?? []) if (isKeyPickup(pk)) this.buildPickup(pk);
    for (const r of data.rooms) for (const a of r.anchors ?? []) this.anchors.set(a.id, { pos: new THREE.Vector3(...a.pos), yaw: deg(a.yaw ?? 0), room: r.id });
    for (const r of data.rooms) {
      for (const n of r.npcs ?? []) {
        const a = typeof n.at === 'string' ? this.anchors.get(n.at) : null;
        const pos = a ? a.pos.clone() : new THREE.Vector3(...(n.at as [number, number, number]));
        const yaw = n.yaw !== undefined ? deg(n.yaw) : (a?.yaw ?? 0);
        this.npcList.push({ id: n.id, look: n.look, pos, yaw, ...(n.pose !== undefined ? { pose: n.pose } : {}), ...(n.transformable ? { transformable: true } : {}), room: r.id });
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

  private buildRoom(r: RoomData, index: number, rng: Rng): void {
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
      ambient: { sky: new THREE.Color(preset.sky), ground: new THREE.Color(preset.ground), intensity: preset.intensity },
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
        const matrix = cellMatrix(cell, rot);
        const params: PieceParams = { height, ...(piece.params ?? {}) };
        const out = registry.create(piece.kit, params, rng.fork(`${r.id}:${piece.kit}:${cell.join(',')}`), m);
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
    for (const prop of r.props ?? []) {
      const ry = deg(prop.rot ?? 0);
      const matrix = at(prop.pos[0], prop.pos[1], prop.pos[2], 0, ry, 0);
      const params: PieceParams = { ceiling: height - prop.pos[1], ...(prop.params ?? {}) };
      const out = registry.create(prop.kit, params, rng.fork(`${r.id}:${prop.kit}:${prop.pos.join(',')}`), m);
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
      const glow = fixtureMaterial(color, def.emissive);
      const mesh = new THREE.Mesh(glowGeometry(slot.kind), glow);
      mesh.position.copy(slot.pos);
      mesh.rotation.y = slot.ry;
      room.group.add(mesh);
      const shafts: ShaftUniforms[] = [];
      if (slot.kind === 'ceiling') {
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
        emissiveBase: def.emissive,
        shafts,
        shaftBase: 0.05,
      });
      room.slots.push({
        item,
        position: slot.pos.clone().setY(slot.pos.y - def.drop),
        color,
        range: light.range ?? def.range,
        priority: 0,
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
  }

  /** Place a piece: dynamic parts join the room group, static meshes wait for merging. */
  private integrate(room: RoomRuntime, out: PieceOutput, matrix: THREE.Matrix4, ry: number, slots: Array<{ pos: THREE.Vector3; kind: LightSlotKind; ry: number }>): void {
    const obj = out.object;
    obj.applyMatrix4(matrix);
    obj.updateMatrixWorld(true);
    for (const child of [...obj.children]) {
      if (child.userData.dynamic) {
        room.group.attach(child);
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
    this.addColliders(out, matrix, `room:${room.data.id}`);
    for (const s of out.lightSlots) slots.push({ pos: new THREE.Vector3(...s.pos).applyMatrix4(matrix), kind: s.kind, ry: s.ry + ry });
    for (const s of out.sockets) {
      this.debug.sockets.push({
        pos: new THREE.Vector3(...s.pos).applyMatrix4(matrix),
        dir: new THREE.Vector3(...s.dir).transformDirection(matrix),
      });
    }
    for (const n of out.navNodes) this.debug.nav.push(new THREE.Vector3(...n.pos).applyMatrix4(matrix));
    if (out.tick) room.ticks.push(out.tick);
    for (const l of out.listeners ?? []) {
      this.deps.events.on(l.event as EventName, l.fn as never);
      this.onNamed(l.event, () => l.fn(undefined));
    }
  }

  private addColliders(out: PieceOutput, matrix: THREE.Matrix4, tag: string): void {
    const surfaceOf = new Map<BoxSpec, PieceOutput['surfaces'][number]['material']>();
    for (const s of out.surfaces) surfaceOf.set(s.box, s.material);
    for (const c of out.colliders) {
      this.collision.add(transformBox(c, matrix), tag, surfaceOf.get(c) ?? null);
      surfaceOf.delete(c);
    }
    // Surface-only boxes (e.g. gratings inside a larger floor collider).
    for (const [box, material] of surfaceOf) this.collision.add(transformBox(box, matrix), tag, material);
  }

  private buildDoor(d: DoorData, rng: Rng): void {
    const a = this.roomById.get(d.between[0])!;
    const b = this.roomById.get(d.between[1])!;
    const height = Math.max(a.height, b.height);
    let ref: DoorRuntime | null = null;
    const visual = buildDoor(d.kit, height, () => ref?.state ?? d.state, rng.fork(d.id), this.deps.materials);
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

  roomAt(p: THREE.Vector3): RoomRuntime | null {
    if (this.current && this.current.cells.some((c) => c.containsPoint(p))) return this.current;
    for (const r of this.rooms) if (r.cells.some((c) => c.containsPoint(p))) return r;
    return null;
  }

  locationAt(eye: THREE.Vector3): string | null {
    return this.roomAt(eye)?.data.name ?? null;
  }

  currentRoomId(): string | null {
    return this.current?.data.id ?? null;
  }

  roomStats(): RoomStats[] {
    return this.rooms.map((r) => ({ id: r.data.id, name: r.data.name, ...r.stats }));
  }

  /** Draw calls of everything currently visible (rooms + doors), before post. */
  visibleDrawCalls(): number {
    let n = 0;
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
  private nav: NavGraph | null = null;

  /**
   * AI navigation (ADR-0007): kit nav nodes, a node either side of every door, and a 1.5 m grid
   * fill so open rooms are covered too. Door edges are passable while the door is open.
   */
  navGraph(): NavGraph {
    if (this.nav) return this.nav;
    const t0 = performance.now();
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
    this.nav = new NavGraph({
      world: this.collision,
      nodes,
      // Unlocked auto doors count as passable: they open for any body that walks up (setActors).
      doors: this.doors.map((d) => ({ id: d.data.id, box: d.collider, isOpen: () => !d.collider.enabled || this.opensForActors(d) })),
    });
    console.info(`[nav] ${this.nav.nodes.length} nodes, ${this.nav.edgeCount()} edges in ${(performance.now() - t0).toFixed(0)} ms`);
    return this.nav;
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

  /** Every anchor id, for tests and debug overlays. */
  anchorIds(): string[] {
    return [...this.anchors.keys()];
  }

  /** NPCs placed by room `npcs` entries, resolved to positions (yaw in radians). Copies. */
  npcSpawns(): Array<{ id: string; look: string; pos: THREE.Vector3; yaw: number; pose?: string; transformable?: boolean; room: string }> {
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
          d.away = dist > 3.4 && actor > 2.4 ? d.away + dt : 0;
          if (d.away > 1.2) {
            this.setDoorState(d, 'closed');
            d.target = 0;
          }
        }
      }
      if (d.state !== 'open' && d.target > 0) d.target = 0;
      // Never close on the player standing in the doorway.
      if (d.target === 0 && d.open > 0 && dist < 0.9) d.target = d.open;
      const speed = dt / d.visual.travelTime;
      if (d.open !== d.target) {
        d.open = d.open < d.target ? Math.min(d.target, d.open + speed) : Math.max(d.target, d.open - speed);
        const e = d.open * d.open * (3 - 2 * d.open);
        d.visual.setOpen(e);
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
      this.deps.events.emit('room:entered', { id: room.data.id, name: room.data.name, reverb: room.data.atmosphere?.reverb });
    }
    this.updateDoors(dt, eye);
    this.updateTriggers(eye);

    // Portal-by-adjacency culling.
    const cur = this.current;
    this.cull(cur);

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
    }

    // Light pool: slots of visible rooms, current room first.
    this.bindLights(cur, eye);
    this.lastTime = t;
    this.lastFlashing = reducedFlashing;
    this.lights.update(t, reducedFlashing);
    this.pool.finish();

    for (const r of this.rooms) if (r.visible) for (const tick of r.ticks) tick(t, dt);
    for (const d of this.doors) if (d.group.visible) d.visual.tick(t);
    // Taken pickups stay gone, also after loading a save that holds the item.
    const inv = this.deps.inventory;
    for (const pk of this.pickups) pk.mesh.visible = !inv?.has(pk.data.item);
    this.dust.update(eye, t, dt);
  }

  /** Which rooms (and doors) draw when the view is in `cur`: it, what its open or see-through doors show, and its `visibleFrom` windows. */
  private cull(cur: RoomRuntime | null): void {
    for (const r of this.rooms) r.visible = cur === null;
    if (cur) {
      cur.visible = true;
      for (const d of this.doors) {
        if (d.open <= 0.001 && !d.visual.seeThrough) continue;
        if (d.rooms[0] === cur) d.rooms[1].visible = true;
        else if (d.rooms[1] === cur) d.rooms[0].visible = true;
      }
      for (const r of this.rooms) if (r.data.visibleFrom?.includes(cur.data.id)) r.visible = true;
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
  return new THREE.SphereGeometry(0.07, 12, 8);
}
