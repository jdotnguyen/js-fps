import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bodyModelsJson } from '../data/bodyModelFiles.ts';
import { validateBodyModelTable } from './bodyModelLibrary.ts';

test('body model table: the game table validates and every model has a gender', () => {
  const table = validateBodyModelTable(bodyModelsJson, 'data/bodyModelFiles.ts');
  for (const [id, def] of Object.entries(table)) assert.ok(def.gender === 'm' || def.gender === 'f', `${id} has a gender`);
  assert.equal(table['priya']!.gender, 'f');
  assert.equal(table['mechanic']!.gender, 'm');
});

test('body model table: a model without a gender is rejected', () => {
  const first = Object.entries(bodyModelsJson)[0]!;
  const { gender: _drop, ...rest } = first[1] as Record<string, unknown>;
  assert.throws(() => validateBodyModelTable({ [first[0]]: rest }, 'data/bodyModelFiles.ts'), /gender/);
  assert.throws(() => validateBodyModelTable({ [first[0]]: { ...rest, gender: 'x' } }, 'data/bodyModelFiles.ts'), /unknown value "x"/);
});
