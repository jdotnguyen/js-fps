import { test } from 'node:test';
import assert from 'node:assert/strict';
import difficultyJson from '../data/difficulty.json' with { type: 'json' };
import { validate } from '../core/validate.ts';
import { validateDifficultyTable } from '../data/types/difficulty.ts';
import { inReach, rollDrop, supplyAmount } from './pickups.ts';

const table = validate(validateDifficultyTable, difficultyJson, 'data/difficulty.json');
const seq = (...v: number[]) => {
  let i = 0;
  return () => v[i++ % v.length]!;
};

test('placed supply amounts scale with difficulty', () => {
  assert.deepEqual(
    (['story', 'standard', 'survival'] as const).map((d) => supplyAmount('ammo_pistol', table[d], table)),
    [16, 12, 8],
  );
  assert.deepEqual(
    (['story', 'standard', 'survival'] as const).map((d) => supplyAmount('ammo_shotgun', table[d], table)),
    [6, 4, 2],
  );
  assert.deepEqual(
    (['story', 'standard', 'survival'] as const).map((d) => supplyAmount('medkit', table[d], table)),
    [50, 40, 30],
  );
  assert.equal(supplyAmount('ammo_pistol', table.survival, table, 24), 16, 'a level amount is the Standard figure');
});

test('drops follow dropChance with need weighting', () => {
  const healthy = { hp: 100, ammo: { pistol: { reserve: 36, mag: 12 } } };
  // Standard: health 0.15, ammo 0.55.
  assert.equal(rollDrop(table.standard, table, healthy, seq(0.2, 0.6)), null);
  assert.deepEqual(rollDrop(table.standard, table, healthy, seq(0.2, 0.5)), { kind: 'ammo_pistol', amount: 6 });
  assert.equal(rollDrop(table.standard, table, healthy, seq(0.1))!.kind, 'medkit');
  // Below 40 HP the health chance doubles (0.3); under one magazine ammo x1.5 (0.825).
  const needy = { hp: 30, ammo: { pistol: { reserve: 4, mag: 12 } } };
  assert.equal(rollDrop(table.standard, table, needy, seq(0.25))!.kind, 'medkit');
  assert.equal(rollDrop(table.standard, table, needy, seq(0.5, 0.8))!.kind, 'ammo_pistol');
  // Survival is stingier.
  assert.equal(rollDrop(table.survival, table, healthy, seq(0.5, 0.4)), null);
  assert.deepEqual(rollDrop(table.survival, table, healthy, seq(0.5, 0.3)), { kind: 'ammo_pistol', amount: 4 });
});

test('never ammo for a weapon not owned; the emptier weapon gets it', () => {
  assert.equal(rollDrop(table.story, table, { hp: 100, ammo: {} }, seq(0.9, 0)), null);
  const both = { hp: 100, ammo: { pistol: { reserve: 30, mag: 12 }, shotgun: { reserve: 2, mag: 6 } } };
  assert.equal(rollDrop(table.story, table, both, seq(0.9, 0))!.kind, 'ammo_shotgun');
});

test('pickup reach is 1 m flat', () => {
  assert.equal(inReach({ x: 0, y: 0, z: 0 }, [0.9, 0.3, 0]), true);
  assert.equal(inReach({ x: 0, y: 0, z: 0 }, [1.1, 0, 0]), false);
  assert.equal(inReach({ x: 0, y: 0, z: 0 }, [0, 2, 0]), false);
});
