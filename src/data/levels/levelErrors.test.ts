import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ValidationError, validate } from '../../core/validate.ts';
import { levelValidator, type KitIds } from '../types/level.ts';
import { assembleLevel, type LevelParts } from './assembleLevel.ts';

const kits: KitIds = { structure: new Set(['floor', 'ceiling', 'wall_plain']), prop: new Set(['crate']) };
// R01 at cell 0,0 and R16b north of it, through the door.
const CELL: Record<string, [number, number]> = { R01: [0, 0], R16b: [0, -1] };
const room = (id: string, more: Record<string, unknown> = {}): Record<string, unknown> => ({ id, name: id, layout: { cells: [CELL[id]], walls: ['wall_plain'] }, ...more });

function parts(): LevelParts {
  return {
    level: { id: 'deck', seed: 1, playerStart: { room: 'R01', pos: [0, 0, 0], yaw: 0 }, rooms: ['R01', 'R16b'], checkpoints: [] },
    doors: { doors: [{ id: 'D', kit: 'bulkhead', between: ['R01', 'R16b'], cell: [0, 0, 0], rot: 0, state: 'closed' }] },
    rooms: { R01: room('R01'), R16b: room('R16b') },
  };
}

/** The message validation fails with after `edit` spoils the parts. */
function failure(edit: (p: LevelParts) => void): string {
  const p = parts();
  edit(p);
  try {
    validate(levelValidator(kits), assembleLevel(p), 'data/levels/deck.json');
  } catch (err) {
    assert.ok(err instanceof ValidationError);
    return err.message;
  }
  assert.fail('expected the level to be refused');
}

test('the unspoiled parts validate', () => {
  validate(levelValidator(kits), assembleLevel(parts()), 'deck');
});

test('a bad kit id in a room file names that file and the field in it', () => {
  const message = failure((p) => (p.rooms['R16b'] = room('R16b', { props: [{ kit: 'crate', pos: [0, 0, 0] }, { kit: 'crat', pos: [0, 0, 0] }] })));
  assert.match(message, /^data\/levels\/deck\/rooms\/R16b\.json > props\[1\] > kit: unknown prop "crat"/);
});

test('a bad kit id in a room layout names that file and the layout field', () => {
  const message = failure((p) => (p.rooms['R16b'] = room('R16b', { layout: { cells: [[0, -1]], walls: ['wall_plain', 'wall_plian'] } })));
  assert.match(message, /^data\/levels\/deck\/rooms\/R16b\.json > layout > walls\[1\]: unknown structure piece "wall_plian"/);
});

test('a bad field shape in a room file names that file too', () => {
  const message = failure((p) => (p.rooms['R01'] = room('R01', { heigth: 4 })));
  assert.match(message, /^data\/levels\/deck\/rooms\/R01\.json > heigth: unknown field/);
});

test('errors about doors name the doors file, and the rest the level file', () => {
  assert.match(
    failure((p) => ((p.doors as { doors: Array<{ state: string }> }).doors[0]!.state = 'ajar')),
    /^data\/levels\/deck\/doors\.json > doors\[0\] > state: unknown value "ajar"/,
  );
  assert.match(
    failure((p) => ((p.level as { playerStart: { room: string } }).playerStart.room = 'R9')),
    /^data\/levels\/deck\/level\.json > playerStart > room: unknown room "R9"/,
  );
});

test('a single-file level keeps the source the caller gave', () => {
  assert.throws(
    () => validate(levelValidator(kits), { ...assembleLevel(parts()), seed: undefined }, 'data/levels/kit_test.json'),
    { message: /^data\/levels\/kit_test\.json > seed: missing required field/ },
  );
});
