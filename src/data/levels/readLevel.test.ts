import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LevelData } from '../types/level.ts';
import { levelFileIds, readLevel, readLevelParts } from './readLevel.ts';

test('a level is found whether it is one file or a folder', () => {
  assert.deepStrictEqual(levelFileIds(), ['kit_test', 'slice01']);
});

test("slice01 assembles every room file, in the level's order, with its doors and level lists", () => {
  const level = readLevel('slice01') as LevelData;
  const ids = [
    'R01', 'R01w', 'R01a', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07', 'R07a', 'R08', 'R08b', 'R09', 'R10', 'R11',
    'R15a', 'R15b', 'R16a', 'R16b', 'R16c', 'R12a', 'R12b', 'R12c', 'R12d', 'R12e', 'R13a', 'R13b', 'R13c', 'R13d',
    'R13e', 'R14a', 'R14b', 'R14c', 'R14d', 'R14e',
  ];
  assert.deepStrictEqual(level.rooms.map((r) => r.id), ids);
  assert.deepStrictEqual(Object.keys(readLevelParts('slice01').rooms).sort(), [...ids].sort());
  assert.deepStrictEqual(
    [level.doors.length, level.vents?.length, level.pickups?.length, level.mapStations?.length, level.checkpoints.length],
    [30, 1, 10, 4, 5],
  );
});
