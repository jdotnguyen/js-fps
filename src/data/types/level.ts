import {
  arr,
  bool,
  num,
  numRange,
  obj,
  oneOf,
  optional,
  record,
  scalar,
  str,
  vec3,
  ValidationError,
  type Infer,
  type Validator,
} from '../../core/validate.ts';
import { LIGHT_PATTERNS } from '../../render/lights.ts';

/**
 * Level JSON (ADR-0003). All positions are world metres; `cell` values are grid indices
 * (x and z in 4 m cells, y in 4 m decks). Additions to the ADR's abridged schema:
 * room `height`, piece `cells` (one entry for many cells), trigger `prompt` (for "use"
 * triggers), light `range`, door `unlockOn` (event name that unlocks it) and `params`.
 */

export const DOOR_KITS = ['pressure_slide', 'bulkhead', 'glass_slide'] as const;
export type DoorKit = (typeof DOOR_KITS)[number];
export const DOOR_STATES = ['open', 'closed', 'locked', 'jammed', 'sealed'] as const;
export type DoorState = (typeof DOOR_STATES)[number];
export const UNLOCK_SOURCES = ['player', 'engineer', 'medic', 'script'] as const;
export type UnlockSource = (typeof UNLOCK_SOURCES)[number];
export const AMBIENT_PRESETS = ['normal', 'emergency', 'flooded', 'dark'] as const;
export type AmbientPreset = (typeof AMBIENT_PRESETS)[number];
export const TRIGGER_KINDS = ['enter', 'exit', 'use'] as const;
export const SPAWN_KINDS = ['vent', 'floor', 'ceiling', 'door', 'corpse'] as const;
export const SLOT_KINDS = ['auto', 'ceiling', 'wall', 'emergency'] as const;

const id: Validator<string> = (v, p) => {
  const s = str(v, p);
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new ValidationError(p, `ids use letters, digits, _ and - only, got "${s}"`);
  return s;
};

const color: Validator<string> = (v, p) => {
  const s = str(v, p);
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) throw new ValidationError(p, `expected a colour like "#ff3b2f", got "${s}"`);
  return s;
};

const int: Validator<number> = (v, p) => {
  const n = num(v, p);
  if (!Number.isInteger(n)) throw new ValidationError(p, `expected a whole number, got ${n}`);
  return n;
};

const cell: Validator<[number, number, number]> = (v, p) => {
  if (!Array.isArray(v) || v.length !== 3) throw new ValidationError(p, 'expected [x, deck, z] grid cell');
  return [int(v[0], `${p}[0]`), int(v[1], `${p}[1]`), int(v[2], `${p}[2]`)];
};

const rot90: Validator<0 | 90 | 180 | 270> = (v, p) => {
  const n = num(v, p);
  if (n !== 0 && n !== 90 && n !== 180 && n !== 270) throw new ValidationError(p, `expected 0, 90, 180 or 270, got ${n}`);
  return n;
};

const box: Validator<[[number, number, number], [number, number, number]]> = (v, p) => {
  if (!Array.isArray(v) || v.length !== 2) throw new ValidationError(p, 'expected [[minX, minY, minZ], [maxX, maxY, maxZ]]');
  const a = vec3(v[0], `${p}[0]`);
  const b = vec3(v[1], `${p}[1]`);
  for (let i = 0; i < 3; i++) if (a[i]! >= b[i]!) throw new ValidationError(p, 'min must be below max on every axis');
  return [a, b];
};

const slot: Validator<number | (typeof SLOT_KINDS)[number]> = (v, p) => (typeof v === 'number' ? int(v, p) : oneOf(SLOT_KINDS)(v, p));

const params = record(scalar);

const pieceShape = {
  kit: str,
  cell: optional(cell),
  cells: optional(arr(cell)),
  rot: optional(rot90),
  params: optional(params),
};

const propShape = {
  kit: str,
  pos: vec3,
  /** Degrees around Y, any value. */
  rot: optional(num),
  params: optional(params),
};

const lightShape = {
  slot,
  pattern: oneOf(LIGHT_PATTERNS),
  color: optional(color),
  intensity: optional(numRange(0, 500)),
  range: optional(numRange(1, 40)),
};

const triggerShape = {
  id,
  box,
  on: oneOf(TRIGGER_KINDS),
  emit: str,
  once: optional(bool),
  prompt: optional(str),
};

const roomShape = {
  id,
  name: str,
  height: optional(numRange(2, 12)),
  atmosphere: optional(
    obj({
      fog: optional(color),
      fogDensity: optional(numRange(0, 0.3)),
      ambient: optional(oneOf(AMBIENT_PRESETS)),
      reverb: optional(str),
      ambience: optional(str),
    }),
  ),
  visibleFrom: optional(arr(id)),
  pieces: arr(obj(pieceShape)),
  props: optional(arr(obj(propShape))),
  lights: optional(arr(obj(lightShape))),
  triggers: optional(arr(obj(triggerShape))),
  spawns: optional(arr(obj({ id, pos: vec3, kind: oneOf(SPAWN_KINDS) }))),
};

const doorShape = {
  id,
  kit: oneOf(DOOR_KITS),
  between: (v: unknown, p: string): [string, string] => {
    if (!Array.isArray(v) || v.length !== 2) throw new ValidationError(p, 'expected ["R01", "R02"]');
    return [id(v[0], `${p}[0]`), id(v[1], `${p}[1]`)];
  },
  cell,
  rot: rot90,
  state: oneOf(DOOR_STATES),
  unlockBy: optional(oneOf(UNLOCK_SOURCES)),
  task: optional(str),
  unlockOn: optional(str),
  params: optional(params),
};

const levelShape = {
  id,
  name: optional(str),
  seed: scalar,
  playerStart: obj({ room: id, pos: vec3, yaw: num }),
  squadStart: optional(record(vec3)),
  rooms: arr(obj(roomShape)),
  doors: arr(obj(doorShape)),
  checkpoints: arr(obj({ id, room: id, pos: vec3, yaw: num })),
};

export type LevelData = Infer<typeof levelShape>;
export type RoomData = LevelData['rooms'][number];
export type PieceData = RoomData['pieces'][number];
export type PropData = NonNullable<RoomData['props']>[number];
export type LightData = NonNullable<RoomData['lights']>[number];
export type TriggerData = NonNullable<RoomData['triggers']>[number];
export type DoorData = LevelData['doors'][number];

export interface KitIds {
  structure: ReadonlySet<string>;
  prop: ReadonlySet<string>;
}

function unique(ids: string[], path: string, what: string): void {
  const seen = new Set<string>();
  for (const x of ids) {
    if (seen.has(x)) throw new ValidationError(path, `duplicate ${what} id "${x}"`);
    seen.add(x);
  }
}

function suggest(name: string, known: ReadonlySet<string>): string {
  const list = [...known];
  const close = list.filter((k) => k.startsWith(name.slice(0, 4)));
  return (close.length ? close : list).slice(0, 8).join(', ');
}

/** Shape check plus cross-references (room ids, kit ids, unique ids). */
export function levelValidator(kits: KitIds): Validator<LevelData> {
  const shape = obj(levelShape);
  return (v, p) => {
    const level = shape(v, p);
    const roomIds = new Set(level.rooms.map((r) => r.id));
    unique(
      level.rooms.map((r) => r.id),
      `${p} > rooms`,
      'room',
    );
    unique(
      level.doors.map((d) => d.id),
      `${p} > doors`,
      'door',
    );
    unique(
      level.rooms.flatMap((r) => (r.triggers ?? []).map((t) => t.id)),
      `${p} > rooms`,
      'trigger',
    );
    const room = (rid: string, path: string): void => {
      if (!roomIds.has(rid)) throw new ValidationError(path, `unknown room "${rid}"`);
    };
    room(level.playerStart.room, `${p} > playerStart > room`);
    level.checkpoints.forEach((c, i) => room(c.room, `${p} > checkpoints[${i}] > room`));
    level.doors.forEach((d, i) => {
      d.between.forEach((r, k) => room(r, `${p} > doors[${i}] > between[${k}]`));
      if (d.between[0] === d.between[1]) throw new ValidationError(`${p} > doors[${i}] > between`, 'a door joins two different rooms');
    });
    level.rooms.forEach((r, ri) => {
      const rp = `${p} > rooms[${ri}]`;
      (r.visibleFrom ?? []).forEach((x, k) => room(x, `${rp} > visibleFrom[${k}]`));
      r.pieces.forEach((pc, k) => {
        const pp = `${rp} > pieces[${k}]`;
        if ((pc.cell ? 1 : 0) + (pc.cells ? 1 : 0) !== 1) throw new ValidationError(pp, 'give exactly one of "cell" or "cells"');
        if (!kits.structure.has(pc.kit)) throw new ValidationError(`${pp} > kit`, `unknown structure piece "${pc.kit}" (known: ${suggest(pc.kit, kits.structure)})`);
      });
      (r.props ?? []).forEach((pr, k) => {
        if (!kits.prop.has(pr.kit)) throw new ValidationError(`${rp} > props[${k}] > kit`, `unknown prop "${pr.kit}" (known: ${suggest(pr.kit, kits.prop)})`);
      });
      (r.triggers ?? []).forEach((t, k) => {
        if (t.on === 'use' && !t.prompt) throw new ValidationError(`${rp} > triggers[${k}]`, '"use" triggers need a "prompt"');
      });
    });
    return level;
  };
}
