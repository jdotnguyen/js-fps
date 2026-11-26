/**
 * A level stored as a folder (spec content-layout, split-level-data D1/D2):
 *
 *   data/levels/<id>/level.json        the whole-level data, with `rooms` listing room ids in level order
 *   data/levels/<id>/doors.json        `doors` and `vents`, which span two rooms
 *   data/levels/<id>/rooms/<room>.json one file per room
 *
 * This module is pure: the browser (`<id>/<id>.level.ts`) and Node (`readLevel.ts`) read the files, it puts them
 * together into the level data the validator, the game and the tests see.
 */
import { ValidationError } from '../../core/validate.ts';
import type { LevelData } from '../types/level.ts';

/** A level folder's files as parsed JSON. */
export interface LevelParts {
  level: unknown;
  doors: unknown;
  /** Each `rooms/<id>.json`, keyed by file name without `.json`. */
  rooms: Record<string, unknown>;
}

const DOORS_KEYS: readonly string[] = ['doors', 'vents'];

/** Which folder and room files an assembled level came from, so validation errors can name the file. */
const origins = new WeakMap<object, { folder: string; rooms: readonly string[] }>();

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ValidationError(path, 'expected an object');
  return value as Record<string, unknown>;
}

/** The parts of one level, from its files keyed by path relative to the level folder (`rooms/R01.json`). */
export function levelPartsFromFiles(files: Readonly<Record<string, unknown>>): LevelParts {
  const parts: LevelParts = { level: undefined, doors: undefined, rooms: {} };
  for (const [path, json] of Object.entries(files)) {
    const name = path.replace(/^\.\//, '');
    const room = /^rooms\/([^/]+)\.json$/.exec(name);
    if (room) parts.rooms[room[1]!] = json;
    else if (name === 'level.json') parts.level = json;
    else if (name === 'doors.json') parts.doors = json;
    else throw new ValidationError(name, 'not a level file (expected level.json, doors.json or rooms/<id>.json)');
  }
  return parts;
}

/**
 * Put a level's parts together, with the rooms in the order `level.json` lists them (numeric light slots and tests
 * depend on it). The result is unvalidated, like a parsed level file: `levelValidator` checks it.
 */
export function assembleLevel(parts: LevelParts): LevelData {
  const id = (parts.level as { id?: unknown } | undefined)?.id;
  const folder = `data/levels/${typeof id === 'string' ? id : '?'}`;
  const levelFile = `${folder}/level.json`;
  const doorsFile = `${folder}/doors.json`;
  const level = record(parts.level, levelFile);
  const doors = record(parts.doors, doorsFile);
  if (typeof id !== 'string') throw new ValidationError(`${levelFile} > id`, 'expected the level id');
  for (const key of DOORS_KEYS) if (key in level) throw new ValidationError(`${levelFile} > ${key}`, `belongs in ${doorsFile}`);
  for (const key of Object.keys(doors)) {
    if (!DOORS_KEYS.includes(key)) throw new ValidationError(`${doorsFile} > ${key}`, `unknown field (allowed: ${DOORS_KEYS.join(', ')})`);
  }

  const order = level['rooms'];
  if (!Array.isArray(order) || !order.every((r): r is string => typeof r === 'string')) {
    throw new ValidationError(`${levelFile} > rooms`, 'expected a list of room ids');
  }
  const seen = new Set<string>();
  const rooms = order.map((roomId, i) => {
    const listed = `${levelFile} > rooms[${i}]`;
    const file = `${folder}/rooms/${roomId}.json`;
    if (seen.has(roomId)) throw new ValidationError(listed, `room "${roomId}" is listed twice`);
    seen.add(roomId);
    if (!Object.hasOwn(parts.rooms, roomId)) throw new ValidationError(listed, `lists room "${roomId}", but there is no ${file}`);
    const room = record(parts.rooms[roomId], file);
    if (room['id'] !== roomId) throw new ValidationError(`${file} > id`, `expected "${roomId}" to match the file name, got ${JSON.stringify(room['id'])}`);
    return room;
  });
  const unlisted = Object.keys(parts.rooms).filter((r) => !seen.has(r));
  if (unlisted.length) {
    throw new ValidationError(
      unlisted.map((r) => `${folder}/rooms/${r}.json`).join(', '),
      `not listed in ${levelFile} > rooms`,
    );
  }

  const assembled = { ...level, ...doors, rooms } as unknown as LevelData;
  origins.set(assembled, { folder, rooms: order });
  return assembled;
}

/**
 * For a level `assembleLevel` built, a validation error about it, renamed from `<source> > rooms[3] > ...` to the part
 * file the field is authored in. Any other error, or an error about any other value, comes back unchanged.
 */
export function inLevelFile(error: unknown, level: unknown, source: string): unknown {
  const origin = typeof level === 'object' && level !== null ? origins.get(level) : undefined;
  if (!origin || !(error instanceof ValidationError) || !error.path.startsWith(source)) return error;
  const { folder, rooms } = origin;
  const rest = error.path.slice(source.length);
  const room = /^ > rooms\[(\d+)\](.*)$/.exec(rest);
  let path: string;
  if (room) path = `${folder}/rooms/${rooms[Number(room[1])]}.json${room[2]}`;
  // Cross-room checks (duplicate anchor ids and the like) have no single file.
  else if (rest === ' > rooms') path = `${folder}/rooms`;
  else if (rest === ' > vents/pickups') path = `${folder}${rest}`;
  else if (/^ > (doors|vents)(\[|$| )/.test(rest)) path = `${folder}/doors.json${rest}`;
  else path = `${folder}/level.json${rest}`;
  return new ValidationError(path, error.message.slice(error.path.length + 2));
}
