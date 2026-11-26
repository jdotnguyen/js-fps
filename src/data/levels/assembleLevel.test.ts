import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleLevel, levelPartsFromFiles, type LevelParts } from './assembleLevel.ts';

const room = (id: string, layout: unknown = { cells: [] }): Record<string, unknown> => ({ id, name: id, layout });
/** A room as assembled: its pieces built from its layout. */
const built = (id: string): Record<string, unknown> => ({ ...room(id), pieces: [] });
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
    rooms: [built('R02'), built('R01w'), built('R01')],
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

test('each room gets the pieces its layout and the doors build (spec content-layout: room shells)', () => {
  const p = parts(['R01', 'R02']);
  p.rooms['R01'] = room('R01', { cells: [[0, 0]], walls: ['wall_plain'] });
  p.rooms['R02'] = room('R02', { cells: [[1, 0]], walls: ['wall_plain'], extraPieces: [{ kit: 'stairs', cell: [1, 0, 0] }] });
  // A door on R01's east side, into R02.
  p.doors = { doors: [{ id: 'D', between: ['R01', 'R02'], cell: [0, 0, 0], rot: 270 }] };
  const [r01, r02] = assembleLevel(p).rooms;
  assert.deepStrictEqual(r01!.pieces, [
    { kit: 'ceiling', cell: [0, 0, 0] },
    { kit: 'floor', cells: [[0, 0, 0]] },
    { kit: 'wall_plain', cells: [[0, 0, 0]] },
    { kit: 'wall_plain', cells: [[0, 0, 0]], rot: 180 },
    { kit: 'wall_plain', cells: [[0, 0, 0]], rot: 90 },
  ]);
  assert.ok(!r02!.pieces.some((pc) => pc.rot === 90), 'no wall on R02 behind the door either');
  assert.deepStrictEqual(r02!.pieces.at(-1), { kit: 'stairs', cell: [1, 0, 0] });
  assert.deepStrictEqual(r01!.layout, { cells: [[0, 0]], walls: ['wall_plain'] }, 'the layout stays on the room');
});

test('a room file stores a layout, never pieces', () => {
  const stored = parts(['R01']);
  stored.rooms['R01'] = { ...room('R01'), pieces: [] };
  assert.throws(() => assembleLevel(stored), /rooms\/R01\.json > pieces: room files store a "layout"; the pieces are built from it/);
  const none = parts(['R01']);
  none.rooms['R01'] = { id: 'R01', name: 'R01' };
  assert.throws(() => assembleLevel(none), /rooms\/R01\.json: missing "layout"/);
});

test('a bad layout names its room file and the field', () => {
  const p = parts(['R01']);
  p.rooms['R01'] = room('R01', { cells: [[0, 0]], wallOverride: { '3,3,n': 'wall_window' } });
  assert.throws(() => assembleLevel(p), { message: "data/levels/deck/rooms/R01.json > layout > wallOverride > 3,3,n: cell 3,3 is not one of the room's cells" });
});
