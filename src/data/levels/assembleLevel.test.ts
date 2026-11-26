import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleLevel, levelPartsFromFiles, type LevelParts } from './assembleLevel.ts';

const room = (id: string): Record<string, unknown> => ({ id, name: id, pieces: [] });
const parts = (order: string[], ids: string[] = order): LevelParts => ({
  level: { id: 'deck', seed: 1, rooms: order },
  doors: { doors: [{ id: 'D' }], vents: [] },
  rooms: Object.fromEntries(ids.map((id) => [id, room(id)])),
});

test('rooms come in the order level.json lists them, with the doors and vents alongside', () => {
  // Files arrive in directory order; the level's own list decides.
  const level = assembleLevel(parts(['R02', 'R01w', 'R01'], ['R01', 'R01w', 'R02']));
  assert.deepStrictEqual(level, {
    id: 'deck',
    seed: 1,
    rooms: [room('R02'), room('R01w'), room('R01')],
    doors: [{ id: 'D' }],
    vents: [],
  });
});

test('a listed room with no file fails, naming the list entry and the missing file', () => {
  assert.throws(
    () => assembleLevel(parts(['R01', 'R02'], ['R01'])),
    { message: 'data/levels/deck/level.json > rooms[1]: lists room "R02", but there is no data/levels/deck/rooms/R02.json' },
  );
});

test('a room file level.json does not list fails, naming the file and the list', () => {
  assert.throws(
    () => assembleLevel(parts(['R01'], ['R01', 'R99'])),
    { message: 'data/levels/deck/rooms/R99.json: not listed in data/levels/deck/level.json > rooms' },
  );
});

test('a room file whose id differs from its name fails', () => {
  const p = parts(['R01']);
  p.rooms['R01'] = room('R02');
  assert.throws(() => assembleLevel(p), /rooms\/R01\.json > id: expected "R01" to match the file name, got "R02"/);
});

test('a room listed twice fails', () => {
  assert.throws(() => assembleLevel(parts(['R01', 'R01'])), /level\.json > rooms\[1\]: room "R01" is listed twice/);
});

test('doors and vents are authored in doors.json only, and it holds nothing else', () => {
  const inLevel = parts(['R01']);
  inLevel.level = { id: 'deck', rooms: ['R01'], doors: [] };
  assert.throws(() => assembleLevel(inLevel), /level\.json > doors: belongs in data\/levels\/deck\/doors\.json/);
  const extra = parts(['R01']);
  extra.doors = { doors: [], pickups: [] };
  assert.throws(() => assembleLevel(extra), /doors\.json > pickups: unknown field/);
});

test('parts are read from the level folder file names, and a stray file fails', () => {
  const p = levelPartsFromFiles({ './level.json': 1, './doors.json': 2, './rooms/R01.json': 3 });
  assert.deepStrictEqual(p, { level: 1, doors: 2, rooms: { R01: 3 } });
  assert.throws(() => levelPartsFromFiles({ './level.json': 1, './R01.json': 3 }), /R01\.json: not a level file/);
});
