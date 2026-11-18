import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valueNoise } from './noise.ts';
import { grating, TEXTURE_SPECS, type TexSet } from './generators.ts';

const SIZE = 64;

test('value noise tiles with its period', () => {
  for (let i = 0; i < 50; i++) {
    const x = i * 0.37;
    const y = i * 0.71;
    assert.ok(Math.abs(valueNoise(x, y, 8, 4, 3) - valueNoise(x + 8, y + 4, 8, 4, 3)) < 1e-12);
  }
});

function checkSet(t: TexSet): void {
  const n = t.size * t.size;
  assert.equal(t.albedo.length, n * 4);
  assert.equal(t.orm.length, n * 4);
  assert.equal(t.normal.length, n * 4);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const nx = t.normal[j]! / 127.5 - 1;
    const ny = t.normal[j + 1]! / 127.5 - 1;
    const nz = t.normal[j + 2]! / 127.5 - 1;
    assert.ok(Math.abs(Math.hypot(nx, ny, nz) - 1) < 0.03, `${t.name}: normal ${i} not unit`);
    assert.ok(nz > 0, `${t.name}: normal ${i} faces into the surface`);
  }
}

for (const [key, make] of Object.entries(TEXTURE_SPECS)) {
  test(`${key}: valid maps and deterministic`, () => {
    const a = make(SIZE);
    checkSet(a);
    assert.deepEqual(a.albedo, make(SIZE).albedo);
  });
}

test('paint variants actually differ', () => {
  assert.notDeepEqual(TEXTURE_SPECS.paintTeal(SIZE).albedo, TEXTURE_SPECS.paintDark(SIZE).albedo);
});

test('grating has both holes and solid bars', () => {
  const g = grating(256, 1);
  let holes = 0;
  let solid = 0;
  for (let i = 3; i < g.albedo.length; i += 4) {
    if (g.albedo[i]! < 10) holes++;
    if (g.albedo[i]! > 245) solid++;
  }
  assert.ok(holes > 0 && solid > 0);
});
