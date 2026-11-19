import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEXTURE_SPECS } from './generators.ts';
import { PHOTO_SLOTS, PHOTO_SLOT_KEYS } from './manifest.ts';

const EXPECTED = [
  'paintBone', 'paintDark', 'paintTeal', 'labPanel', 'diamond', 'diamondHazard', 'diamondRusty', 'hazard', 'rubber',
  'rustHeavy', 'rustDrip', 'rustBlotch', 'concrete', 'concreteFloor', 'concretePainted', 'labTile', 'tileBroken',
  'tileWall', 'tileWashroom', 'signDanger',
];

test('photo slot list matches the design', () => {
  assert.deepEqual([...PHOTO_SLOT_KEYS].sort(), [...EXPECTED].sort());
});

test('every photo slot has a valid fallback, positive scale and sane tint', () => {
  for (const key of PHOTO_SLOT_KEYS) {
    const s = PHOTO_SLOTS[key];
    assert.ok(s.fallback in TEXTURE_SPECS, `${key} fallback ${s.fallback}`);
    assert.ok(s.metersPerTile > 0, `${key} metersPerTile`);
    assert.ok(s.roughnessScale > 0, `${key} roughnessScale`);
    assert.ok(Number.isInteger(s.tint) && s.tint >= 0 && s.tint <= 0xffffff, `${key} tint`);
    assert.equal(s.dir, key);
  }
});

test('procedural-only slots stay out of the photo manifest', () => {
  for (const k of ['steel', 'grating', 'hazardClean']) assert.ok(!(k in PHOTO_SLOTS));
  assert.equal(PHOTO_SLOTS.signDanger.tiling, false);
});
