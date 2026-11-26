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
import { COOKIE_KINDS } from '../../render/cookies.ts';

/**
 * Level JSON (ADR-0003). All positions are world metres; `cell` values are grid indices
 * (x and z in 4 m cells, y in 4 m decks). Additions to the ADR's abridged schema:
 * room `height`, piece `cells` (one entry for many cells), trigger `prompt` (for "use"
 * triggers), light `range`, door `unlockOn` (event name that unlocks it) and `params`.
 * ADR-0024 adds door/vent `access` (key items or sealed), `vents` and key-item `pickups`.
 */

/** What a dynamic prop sounds like when it hits something (adopt-physics-engine D16). */
export const PROP_SOUNDS = ['cart', 'glass', 'metal', 'thud', 'dish'] as const;
export type PropSound = (typeof PROP_SOUNDS)[number];

export const DOOR_KITS = ['pressure_slide', 'bulkhead', 'glass_slide'] as const;
export type DoorKit = (typeof DOOR_KITS)[number];
export const DOOR_STATES = ['open', 'closed', 'locked', 'jammed', 'sealed'] as const;
export type DoorState = (typeof DOOR_STATES)[number];
export const UNLOCK_SOURCES = ['player', 'engineer', 'medic', 'script'] as const;
export type UnlockSource = (typeof UNLOCK_SOURCES)[number];
/** A world [x, z] pair. */
const xz = (v: unknown, p: string): [number, number] => {
  if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => typeof n === 'number')) throw new ValidationError(p, 'expected [x, z]');
  return [v[0] as number, v[1] as number];
};

/** Things that float on standing water (standing-water spec, overhaul-flooded-tunnel). */
export const WATER_JUNK_KINDS = ['paper', 'hardhat', 'glove', 'cup', 'sheen'] as const;

export const AMBIENT_PRESETS = ['normal', 'emergency', 'flooded', 'dark', 'dock', 'commons', 'admin', 'hydro', 'gallery'] as const;
export type AmbientPreset = (typeof AMBIENT_PRESETS)[number];

/**
 * Activity spots (ADR-0029): where a body can sit or lean, each with a default base pose of the same name.
 * Kit props emit the `sit_*` kinds per seat; lean spots are authored for now.
 */
export const SPOT_KINDS = ['sit_chair', 'sit_stool', 'sit_sofa', 'lean_wall', 'lean_counter', 'work_crouch', 'work_clipboard', 'work_bench'] as const;
export type SpotKind = (typeof SPOT_KINDS)[number];
export const TRIGGER_KINDS = ['enter', 'exit', 'use'] as const;
export const SPAWN_KINDS = ['vent', 'floor', 'ceiling', 'door', 'corpse'] as const;
/** Enemy variants a spawn point can make (ADR-0007, `data/enemies.json`). */
export const SPAWN_VARIANTS = ['shambler', 'hero', 'playDead'] as const;
/** How a spawn point's enemies arrive when not the kind's default (enemy-encounters): `drop` falls from the point. */
export const SPAWN_STARTS = ['drop'] as const;
export const SPAWN_OUTFITS = ['security', 'engineer', 'medic', 'lab', 'crew'] as const;

export const SLOT_KINDS = ['auto', 'ceiling', 'wall', 'emergency', 'pendant'] as const;

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

const vec2: Validator<[number, number]> = (v, p) => {
  if (!Array.isArray(v) || v.length !== 2) throw new ValidationError(p, 'expected [x, z]');
  return [num(v[0], `${p}[0]`), num(v[1], `${p}[1]`)];
};

/** Supply pickups (ADR-0005 step 6, ADR-0008). Key items use `item` instead. */
/** `weapon_*` are weapon pickups (ADR-0005: the shotgun on the R07a armory rack), collected the same way. */
export const SUPPLY_KINDS = ['ammo_pistol', 'ammo_shotgun', 'medkit', 'weapon_shotgun'] as const;
export type SupplyKind = (typeof SUPPLY_KINDS)[number];

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
  /**
   * Opt in to physics (adopt-physics-engine D11, spec physical-interaction "Only named props move"): the prop's
   * collision boxes become one rigid body of this mass (kg) that the player, blasts and kills can push. Unmarked props
   * never move.
   *
   * `loose` (design D14): small dressing that physics moves but movement ignores. Its boxes shape the rigid body and
   * never enter `CollisionWorld`, so the player, enemies and the navmesh pass it standing or fallen.
   *
   * `sound` (design D16): what it sounds like when it hits something; without one it is silent.
   *
   * `kinematic` (livelier-cart-slam D3): a scripted body. Physics never moves it; a kill does, and what rests on it
   * rides along or is shoved. Its collision follows it for movement too. Without physics it moves the same way.
   */
  dynamic: optional(obj({ mass: numRange(0.05, 500), loose: optional(bool), sound: optional(oneOf(PROP_SOUNDS)), kinematic: optional(bool) })),
  /**
   * Where a skipped or restored kill leaves this prop (livelier-cart-slam D11): the kill's `layout` event for `group`
   * puts it at `pos`, turned by `quat` [x, y, z, w] (default: its placed yaw). Needs `params.id` or `dynamic`.
   */
  after: optional(obj({ group: str, pos: vec3, quat: optional(arr(num)) })),
};

const lightShape = {
  /** Name for the `light` sequence step, which switches this light alone (render-lighting spec). Unique per level. */
  id: optional(id),
  slot,
  pattern: oneOf(LIGHT_PATTERNS),
  color: optional(color),
  intensity: optional(numRange(0, 500)),
  range: optional(numRange(1, 40)),
  /** Volumetric shaft intensity for ceiling lights (0 disables the shaft mesh). */
  shaft: optional(numRange(0, 0.3)),
  /** Fixture diffuser emissive intensity override. */
  emissive: optional(numRange(0, 8)),
  /** Vertical drop (m) of the point light below its fixture origin (e.g. pendant-height pools). */
  drop: optional(numRange(-0.5, 2.5)),
  /** false: glow-only. The fixture glows and follows patterns and tints but never takes a pooled real light. */
  pool: optional(bool),
  /** true: casts shadows as a downward cone while the tier's shadow pool has room; otherwise lights the room unshadowed (render-lighting spec). */
  shadow: optional(bool),
  /**
   * A pattern this shadow light projects while it holds one of the tier's patterned shadow spots: a grille, a turning
   * vent fan or a cracked lens (render-lighting "Light patterns"). Without a patterned spot it lights evenly.
   */
  cookie: optional(oneOf(COOKIE_KINDS)),
  /** A broken fixture: it throws sparks each time its tube cuts out or strikes back on (flooded-tunnel spec). */
  sparks: optional(bool),
  /** true: stays lit, dimmed, under backup power (render-lighting spec "Backup lights"). `emergency` slots always do. */
  backup: optional(bool),
  /** Keeps its own colour under backup power instead of the warm backup white (a red alarm beacon stays red). */
  ownColor: optional(bool),
  /** Strength on backup power instead of the usual dim share (a room on its own circuit, such as the pump room). Implies `backup`. */
  backupScale: optional(numRange(0, 1)),
};

const triggerShape = {
  id,
  box,
  on: oneOf(TRIGGER_KINDS),
  emit: str,
  once: optional(bool),
  prompt: optional(str),
};

/** A named position: feet (or look-target) point in world metres, `yaw` in degrees around Y. */
const anchorShape = {
  id,
  pos: vec3,
  yaw: optional(num),
};

const anchorRef: Validator<string | [number, number, number]> = (v, p) => (typeof v === 'string' ? id(v, p) : vec3(v, p));

/**
 * An authored walk (ADR-0028): a smooth curve through `points` (anchor ids or feet positions) for
 * scripted beats where the route matters (cutscenes, framed shots). Sequences use it with `via`
 * on npcMoveTo/playerWalkTo, or `attachToTrack`. `speed` (m/s) is the default cruising speed.
 */
const walkShape = {
  id,
  points: arr(anchorRef),
  speed: optional(numRange(0.1, 10)),
};

const npcShape = {
  id,
  /** Look id (outfit/seed) for the humanoid builder, e.g. "giles", "botanist_2". */
  look: id,
  at: anchorRef,
  /** Degrees; overrides the anchor's yaw. */
  yaw: optional(num),
  /** Pose name from data/poses.json, e.g. "idle", "sit". */
  pose: optional(str),
  /** Build the body so a `transform` action can infect it (the researcher behind the Lab B glass, ADR-0014). */
  transformable: optional(bool),
  /**
   * ADR-0029: take the nearest free activity spot of this kind to `at` (within 1.5 m): its position, facing and
   * default pose (`pose` still wins). Lean kinds just set the pose at `at`.
   */
  spot: optional(oneOf(SPOT_KINDS)),
  /** ADR-0029: NPCs sharing a chat id talk to each other (turn-taking, looking at the speaker). */
  chat: optional(id),
  /** Imported body (a `data/body-models.json` id) instead of the look's pick by NPC id, to spread faces across a room. */
  model: optional(id),
  /** Explicit list of room ids this NPC may roam between for ambient work spots (overrides single-room/pose locks). */
  roam: optional(arr(id)),
  /** Static fallen corpse: frozen in its dead pose with zero AI, idle-life, or standing collision. */
  dead: optional(bool),
  /** Stamp dark-crimson blood splatters onto this NPC's body materials. */
  blood: optional(bool),
};

/**
 * Enemy spawn point (ADR-0007). Without `active: false` it spawns when the level starts; otherwise
 * when its `group` is triggered (`spawnGroup` action) or its `on` event fires. `count` enemies come
 * `interval` s apart, within the 8-active cap. `corpse` spawns default to play-deads.
 */
const spawnShape = {
  id,
  pos: vec3,
  kind: oneOf(SPAWN_KINDS),
  group: optional(id),
  active: optional(bool),
  variant: optional(oneOf(SPAWN_VARIANTS)),
  count: optional(numRange(1, 50)),
  interval: optional(numRange(0, 120)),
  /** Degrees around Y. */
  yaw: optional(num),
  outfit: optional(oneOf(SPAWN_OUTFITS)),
  infection: optional(numRange(0, 3)),
  /** Imported body (a `data/body-models.json` id) for this point's enemies, e.g. the creature that came out of Voss. */
  model: optional(id),
  /** A cast look (castLooks) for this point's enemies: its body, height and build, e.g. `lab_creature` (infection-kills). */
  look: optional(id),
  /** Health in place of the variant's base health, before the difficulty multiplier (enemy-encounters). */
  hp: optional(numRange(1, 5000)),
  /** `drop`: appear at the point and fall to the floor below, landing hard, instead of emerging on the floor. */
  start: optional(oneOf(SPAWN_STARTS)),
  on: optional(str),
  /** Floats in standing water (a play-dead corpse face down in the flooded tunnel): exempt from the sunken-floor check. */
  float: optional(bool),
};

const roomShape = {
  id,
  name: str,
  height: optional(numRange(2, 12)),
  /**
   * Sunken floor (level-kit spec, overhaul-flooded-tunnel): the room's pieces build from this height (m, relative
   * to its deck) instead of the deck, while the ceiling stays at `height` and doors stay at deck level.
   */
  floorY: optional(numRange(-3, 0)),
  /**
   * Standing water over the room's whole footprint (standing-water spec): `level` is the surface height (world y, m),
   * `floor` the bottom of the water (default the room's `floorY`).
   */
  water: optional(
    obj({
      level: numRange(-3, 6),
      floor: optional(numRange(-3, 6)),
      /** Junk floating on it (world x, z; yaw in degrees). */
      /** Drips and a pouring pipe that keep disturbing it (standing-water spec: ripples from drips and pouring water). */
      emitters: optional(arr(obj({ kind: oneOf(['drip', 'pour'] as const), at: xz, rate: numRange(0.01, 60), radius: numRange(0.01, 2), strength: numRange(-1, 1) }))),
      junk: optional(arr(obj({ kind: oneOf(WATER_JUNK_KINDS), at: (v: unknown, p: string): [number, number] => {
        if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => typeof n === 'number')) throw new ValidationError(p, 'expected [x, z]');
        return [v[0] as number, v[1] as number];
      }, rot: optional(num), scale: optional(numRange(0.2, 4)) }))),
    }),
  ),
  atmosphere: optional(
    obj({
      fog: optional(color),
      fogDensity: optional(numRange(0, 0.3)),
      ambient: optional(oneOf(AMBIENT_PRESETS)),
      reverb: optional(str),
      ambience: optional(str),
      /**
       * Where the room's reflections and bounce light are captured from (environment-lighting spec), world metres.
       * Must lie inside the room. Default: the centre of the room's area, 1.6 m above its deck.
       */
      capture: optional(vec3),
    }),
  ),
  visibleFrom: optional(arr(id)),
  pieces: arr(obj(pieceShape)),
  props: optional(arr(obj(propShape))),
  lights: optional(arr(obj(lightShape))),
  triggers: optional(arr(obj(triggerShape))),
  spawns: optional(arr(obj(spawnShape))),
  /** Named positions for sequences (`anchor:<id>`) and NPC placement. Ids are unique per level. */
  anchors: optional(arr(obj(anchorShape))),
  /** NPCs standing in the level at load (`at`: an anchor id or a feet position). */
  npcs: optional(arr(obj(npcShape))),
  /** Authored curve walks for scripted beats (ADR-0028). Ids are unique per level. */
  walks: optional(arr(obj(walkShape))),
  /** Map area this room belongs to (ADR-0024), e.g. "hydroponics". Map stations reveal a whole area. */
  area: optional(id),
  /** Never revealed by a map station; only drawn once walked (ADR-0024). */
  hidden: optional(bool),
  /** Map outline override: [[x, z], ...] world metres (>= 3 points). Default: derived from the kit cells. */
  outline: optional(arr(vec2)),
};

/**
 * Access gating (ADR-0024): `{ "requires": "card_l2" }` needs a key item from
 * data/items.json; `{ "sealed": true, "text"?: "lockdown" }` never opens for the player
 * (`text` picks the ui.json variant `access_sealed_<text>`).
 */
const accessShape = {
  requires: optional(id),
  sealed: optional(bool),
  text: optional(id),
};
const access: Validator<Infer<typeof accessShape>> = (v, p) => {
  const a = obj(accessShape)(v, p);
  if ((a.requires !== undefined ? 1 : 0) + (a.sealed ? 1 : 0) !== 1) throw new ValidationError(p, 'give exactly one of "requires" or "sealed": true');
  if (a.text !== undefined && !a.sealed) throw new ValidationError(`${p} > text`, '"text" is only for sealed doors and vents');
  return a;
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
  access: optional(access),
};

/** A vent the player can open with a tool (ADR-0024). Visuals are a separate prop or piece. */
const ventShape = {
  id,
  room: id,
  /** Box the interact ray tests, in world metres. */
  box,
  access: optional(access),
};

/** A key item lying in the world (ADR-0024); taking it gives the item. */
const pickupShape = {
  id,
  room: id,
  /** A key item (ADR-0024). Give exactly one of `item` or `kind`. */
  item: optional(id),
  /** A supply pickup (ADR-0005 step 6 / ADR-0008): ammo or a medkit, auto-collected within 1 m. */
  kind: optional(oneOf(SUPPLY_KINDS)),
  /** Supply amount at Standard (rounds, shells or heal points); scaled by difficulty. Default per kind. */
  amount: optional(numRange(1, 999)),
  pos: vec3,
  /** Degrees around Y. */
  rot: optional(num),
};

/** A wall map (ADR-0024): using it fills in every non-hidden room of `reveals`. */
const mapStationShape = {
  id,
  /** Feet-level position of the panel, world metres. */
  pos: vec3,
  /** Area name the station reveals (a room `area`). */
  reveals: id,
  /** Degrees around Y; 0 faces +Z. */
  rot: optional(num),
  /** Room it hangs in; default: the room whose cells contain `pos`. */
  room: optional(id),
};

const levelShape = {
  id,
  name: optional(str),
  seed: scalar,
  playerStart: obj({ room: id, pos: vec3, yaw: num }),
  squadStart: optional(record(vec3)),
  rooms: arr(obj(roomShape)),
  doors: arr(obj(doorShape)),
  vents: optional(arr(obj(ventShape))),
  pickups: optional(arr(obj(pickupShape))),
  mapStations: optional(arr(obj(mapStationShape))),
  checkpoints: arr(obj({ id, room: id, pos: vec3, yaw: num })),
};

export type LevelData = Infer<typeof levelShape>;
export type RoomData = LevelData['rooms'][number];

/**
 * Whether world point `p` lies inside one of the room's cells: the same boxes the level builds for `roomAt`
 * (4 m cells and decks, from 0.5 m under the floor to the room's height, at least the 3.2 m corridor height).
 */
export function roomContains(room: Pick<RoomData, 'pieces' | 'height' | 'floorY'>, p: readonly [number, number, number]): boolean {
  const height = Math.max(room.height ?? 3.2, 3.2);
  const floorY = room.floorY ?? 0;
  for (const piece of room.pieces) {
    for (const [cx, deck, cz] of piece.cells ?? (piece.cell ? [piece.cell] : [])) {
      const x = cx * 4;
      const y = deck * 4;
      const z = cz * 4;
      if (Math.abs(p[0] - x) <= 2 && Math.abs(p[2] - z) <= 2 && p[1] >= y + floorY - 0.5 && p[1] <= y + height) return true;
    }
  }
  return false;
}
export type PieceData = RoomData['pieces'][number];
export type PropData = NonNullable<RoomData['props']>[number];
export type LightData = NonNullable<RoomData['lights']>[number];
export type TriggerData = NonNullable<RoomData['triggers']>[number];
export type DoorData = LevelData['doors'][number];
export type AccessData = Infer<typeof accessShape>;
export type VentData = NonNullable<LevelData['vents']>[number];
export type PickupData = NonNullable<LevelData['pickups']>[number];
export type KeyPickupData = PickupData & { item: string };
export type MapStationData = NonNullable<LevelData['mapStations']>[number];
/** True for key-item pickups (the rest are supplies, see `game/pickups.ts`). */
export const isKeyPickup = (p: PickupData): p is KeyPickupData => p.item !== undefined;
export type AnchorData = NonNullable<RoomData['anchors']>[number];
export type NpcData = NonNullable<RoomData['npcs']>[number];

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

/** Optional cross-reference tables; checks are skipped for any that are not given. */
export interface LevelRefs {
  /** Key item ids from data/items.json (ADR-0024). */
  items?: ReadonlySet<string>;
  /** ui.json keys, to check sealed `text` variants. */
  uiText?: ReadonlySet<string>;
}

/** Shape check plus cross-references (room ids, kit ids, unique ids, item ids). */
export function levelValidator(kits: KitIds, refs: LevelRefs = {}): Validator<LevelData> {
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
    unique(
      [...(level.vents ?? []).map((x) => x.id), ...(level.pickups ?? []).map((x) => x.id)],
      `${p} > vents/pickups`,
      'vent or pickup',
    );
    const item = (iid: string, path: string): void => {
      if (refs.items && !refs.items.has(iid)) throw new ValidationError(path, `unknown item "${iid}" (known: ${[...refs.items].join(', ')})`);
    };
    const gate = (a: AccessData | undefined, path: string): void => {
      if (!a) return;
      if (a.requires !== undefined) item(a.requires, `${path} > access > requires`);
      if (a.text !== undefined && refs.uiText && !refs.uiText.has(`access_sealed_${a.text}`)) {
        throw new ValidationError(`${path} > access > text`, `no ui text "access_sealed_${a.text}" in data/dialogue/ui.json`);
      }
    };
    level.doors.forEach((d, i) => gate(d.access, `${p} > doors[${i}]`));
    (level.vents ?? []).forEach((x, i) => {
      room(x.room, `${p} > vents[${i}] > room`);
      gate(x.access, `${p} > vents[${i}]`);
    });
    (level.pickups ?? []).forEach((x, i) => {
      room(x.room, `${p} > pickups[${i}] > room`);
      if ((x.item !== undefined ? 1 : 0) + (x.kind !== undefined ? 1 : 0) !== 1) throw new ValidationError(`${p} > pickups[${i}]`, 'give exactly one of "item" (key item) or "kind" (supply)');
      if (x.item !== undefined) item(x.item, `${p} > pickups[${i}] > item`);
      if (x.amount !== undefined && x.kind === undefined) throw new ValidationError(`${p} > pickups[${i}] > amount`, '"amount" is only for supply pickups');
    });
    // ADR-0024 map: outlines, areas and stations.
    level.rooms.forEach((r, ri) => {
      if (r.outline && r.outline.length < 3) throw new ValidationError(`${p} > rooms[${ri}] > outline`, 'an outline needs at least 3 points');
    });
    const areas = new Set(level.rooms.map((r) => r.area).filter((a): a is string => a !== undefined));
    unique(
      (level.mapStations ?? []).map((s) => s.id),
      `${p} > mapStations`,
      'map station',
    );
    (level.mapStations ?? []).forEach((s, i) => {
      if (!areas.has(s.reveals)) throw new ValidationError(`${p} > mapStations[${i}] > reveals`, `no room has area "${s.reveals}" (known: ${[...areas].join(', ') || 'none'})`);
      if (s.room !== undefined) room(s.room, `${p} > mapStations[${i}] > room`);
    });
    const anchorIds = level.rooms.flatMap((r) => (r.anchors ?? []).map((a) => a.id));
    unique(anchorIds, `${p} > rooms`, 'anchor');
    unique(
      level.rooms.flatMap((r) => (r.npcs ?? []).map((n) => n.id)),
      `${p} > rooms`,
      'npc',
    );
    const anchorSet = new Set(anchorIds);
    level.rooms.forEach((r, ri) =>
      (r.npcs ?? []).forEach((n, k) => {
        if (typeof n.at === 'string' && !anchorSet.has(n.at)) throw new ValidationError(`${p} > rooms[${ri}] > npcs[${k}] > at`, `unknown anchor "${n.at}"`);
      }),
    );
    unique(
      level.rooms.flatMap((r) => (r.walks ?? []).map((w) => w.id)),
      `${p} > rooms`,
      'walk',
    );
    level.rooms.forEach((r, ri) =>
      (r.walks ?? []).forEach((w, k) => {
        if (w.points.length < 2) throw new ValidationError(`${p} > rooms[${ri}] > walks[${k}] > points`, 'a walk needs at least 2 points');
        w.points.forEach((pt, j) => {
          if (typeof pt === 'string' && !anchorSet.has(pt)) throw new ValidationError(`${p} > rooms[${ri}] > walks[${k}] > points[${j}]`, `unknown anchor "${pt}"`);
        });
      }),
    );
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
      const capture = r.atmosphere?.capture;
      if (capture && !roomContains(r, capture)) throw new ValidationError(`${rp} > atmosphere > capture`, `[${capture.join(', ')}] is outside the room's cells`);
    });
    return level;
  };
}
