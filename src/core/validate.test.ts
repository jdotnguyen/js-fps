import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arr, num, obj, oneOf, optional, str, validate, ValidationError, vec3 } from './validate.ts';

const piece = obj({ kit: oneOf(['corridor_straight', 'corridor_corner'] as const), cell: vec3, rot: optional(num) });
const level = obj({ id: str, rooms: arr(obj({ id: str, pieces: arr(piece) })) });

test('valid data passes and keeps optional fields optional', () => {
  const out = validate(level, { id: 'l', rooms: [{ id: 'R01', pieces: [{ kit: 'corridor_straight', cell: [0, 0, 1] }] }] }, 'lvl.json');
  assert.equal(out.rooms[0]?.pieces[0]?.rot, undefined);
});

test('a typo in an enum value gives a readable path', () => {
  assert.throws(
    () => validate(level, { id: 'l', rooms: [{ id: 'R01', pieces: [{ kit: 'corrdor_straight', cell: [0, 0, 1] }] }] }, 'data/levels/slice01.json'),
    (e: unknown) => e instanceof ValidationError &&
      e.message === 'data/levels/slice01.json > rooms[0] > pieces[0] > kit: unknown value "corrdor_straight", expected one of: corridor_straight, corridor_corner',
  );
});

test('unknown fields are rejected', () => {
  assert.throws(() => validate(obj({ fog: num }), { fog: 1, fogDensty: 2 }, 'x'), /x > fogDensty: unknown field/);
});

test('missing required fields are rejected', () => {
  assert.throws(() => validate(obj({ id: str }), {}, 'x'), /x > id: missing required field/);
});

test('non-finite numbers and bad vectors are rejected', () => {
  assert.throws(() => num(Number.NaN, 'n'), /finite number/);
  assert.throws(() => vec3([1, 2], 'v'), /expected \[x, y, z\]/);
});
