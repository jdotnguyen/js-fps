import { test } from 'node:test';
import assert from 'node:assert/strict';
import kitTest from '../levels/kit_test.json' with { type: 'json' };
import { validate } from '../../core/validate.ts';
import { levelValidator, roomContains, type KitIds, type LevelData } from './level.ts';

const level = kitTest as unknown as LevelData;
const kits: KitIds = {
  structure: new Set(level.rooms.flatMap((r) => r.pieces.map((p) => p.kit))),
  prop: new Set(level.rooms.flatMap((r) => (r.props ?? []).map((p) => p.kit))),
};
const check = (raw: unknown): LevelData => validate(levelValidator(kits, { items: new Set(['card_l2', 'vent_driver']) }), raw, 'kit_test');

/** kit_test with R01's capture point set to `p`. R01 holds cell [0, 0, 3]: x -2..2, z 10..14. */
const withCapture = (p: [number, number, number]): Record<string, any> => {
  const c = structuredClone(kitTest) as Record<string, any>;
  const r01 = c['rooms'].find((r: { id: string }) => r.id === 'R01');
  r01.atmosphere = { ...(r01.atmosphere ?? {}), capture: p };
  return c;
};

test('atmosphere.capture: a point inside the room validates (environment-lighting spec)', () => {
  const lv = check(withCapture([0.5, 1.6, 12]));
  assert.deepEqual(lv.rooms.find((r) => r.id === 'R01')!.atmosphere?.capture, [0.5, 1.6, 12]);
});

test('atmosphere.capture: a point outside the room is rejected', () => {
  assert.throws(() => check(withCapture([30, 1.6, 12])), /capture.*outside the room/);
  assert.throws(() => check(withCapture([0.5, 9, 12])), /outside the room/); // above the ceiling
  assert.throws(() => check(withCapture([0.5, 1.6] as unknown as [number, number, number])), /capture/);
});

test('roomContains follows the cell boxes, the room height and a sunken floor', () => {
  const room = { pieces: [{ cell: [1, 0, 2] }], height: 4 } as unknown as Parameters<typeof roomContains>[0];
  assert.ok(roomContains(room, [4, 1.6, 8]));
  assert.ok(roomContains(room, [5.9, 3.9, 9.9]));
  assert.ok(!roomContains(room, [6.1, 1.6, 8]));
  assert.ok(!roomContains(room, [4, 4.1, 8]));
  const sunken = { pieces: [{ cell: [1, 0, 2] }], floorY: -2 } as unknown as Parameters<typeof roomContains>[0];
  assert.ok(roomContains(sunken, [4, -1.5, 8]));
});
