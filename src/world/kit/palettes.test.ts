import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import type { Materials } from '../../render/materials.ts';
import { PHOTO_SLOT_KEYS } from '../../render/tex/manifest.ts';
import { AREA_PALETTES, DEFAULT_PALETTE, PALETTE_MATERIAL_KEYS, isPaletteMaterialKey, paletteFor, resolvePalette } from './palettes.ts';

// Area palettes (openspec adopt-photoscanned-textures, group 5): every slice01 area has one, every entry names a
// real Materials key, hazard stripes are rusty only in the tunnel and dive bay, and `params.material` overrides.

const MATERIAL_KEYS = [...PHOTO_SLOT_KEYS, 'steel', 'grating', 'hazardClean', 'glass', 'black', 'cable', 'glowCyan'];

function stubMaterials(): Materials {
  const out: Record<string, THREE.MeshStandardMaterial> = {};
  for (const k of MATERIAL_KEYS) {
    out[k] = new THREE.MeshStandardMaterial();
    out[k]!.name = k;
  }
  return out as unknown as Materials;
}

const level = JSON.parse(readFileSync(new URL('../../data/levels/slice01.json', import.meta.url), 'utf8')) as {
  rooms: Array<{ id: string; area?: string; pieces: Array<{ kit: string; params?: Record<string, unknown> }> }>;
};

test('every area in slice01 has a palette, and every palette entry is a valid Materials key', () => {
  const areas = new Set(level.rooms.map((r) => r.area).filter((a): a is string => a !== undefined));
  assert.ok(areas.size >= 11);
  for (const a of areas) assert.ok(AREA_PALETTES[a], `palette for area ${a}`);
  for (const [area, pal] of Object.entries(AREA_PALETTES)) {
    for (const [field, key] of Object.entries(pal)) {
      assert.ok(MATERIAL_KEYS.includes(key as string), `${area}.${field} = ${String(key)} is not a Materials key`);
      assert.ok(isPaletteMaterialKey(key as string), `${area}.${field} = ${String(key)} is not a palette material`);
    }
    assert.ok(pal.hazard === 'hazard' || pal.hazard === 'hazardClean', `${area}.hazard`);
  }
  for (const k of PALETTE_MATERIAL_KEYS) assert.ok(MATERIAL_KEYS.includes(k), k);
});

test('rusty photo hazard stripes are only used in the tunnel and dive bay', () => {
  const rusty = Object.entries(AREA_PALETTES).filter(([, p]) => p.hazard === 'hazard').map(([a]) => a);
  assert.deepEqual(rusty.sort(), ['dive_bay', 'tunnel']);
});

test('resolvePalette follows the area and falls back to the default for unknown or missing areas', () => {
  const m = stubMaterials();
  const tunnel = resolvePalette({ area: 'tunnel' }, m);
  assert.equal(tunnel.wallMain, m.rustHeavy);
  assert.equal(tunnel.wallAlt, m.concrete);
  assert.equal(tunnel.floor, m.concreteFloor);
  assert.equal(tunnel.floorAlt, m.diamondRusty);
  assert.equal(tunnel.hazard, m.hazard);
  assert.equal(tunnel.hazardTile, 1, 'photo hazard needs metre UVs');
  const labs = resolvePalette({ area: 'labs' }, m);
  assert.equal(labs.wallMain, m.labPanel);
  assert.equal(labs.floor, m.labTile);
  assert.equal(labs.wallAlt, m.labPanel, 'wallAlt defaults to wallMain');
  assert.equal(labs.floorAlt, m.steel, 'floorAlt defaults to steel');
  assert.equal(labs.hazard, m.hazardClean);
  assert.equal(labs.hazardTile, 0.5);
  assert.equal(paletteFor('nowhere'), DEFAULT_PALETTE);
  assert.equal(resolvePalette({}, m).wallMain, m[DEFAULT_PALETTE.wallMain]);
});

test('params.material overrides the main surfaces but not hazard or trim', () => {
  const m = stubMaterials();
  const p = resolvePalette({ area: 'hydroponics', material: 'tileWashroom' }, m);
  assert.equal(p.wallMain, m.tileWashroom);
  assert.equal(p.wallAlt, m.tileWashroom);
  assert.equal(p.floor, m.tileWashroom);
  assert.equal(p.hazard, m.hazardClean);
  assert.equal(p.overridden, true);
  assert.equal(resolvePalette({ area: 'hydroponics' }, m).overridden, false);
  assert.throws(() => resolvePalette({ material: 'glass' }, m), /not a palette material/);
  assert.throws(() => resolvePalette({ material: 'nope' }, m), /not a palette material/);
  assert.throws(() => resolvePalette({ material: 5 }, m), /not a palette material/);
});

test('slice01 piece overrides name valid palette materials; the nutrient room uses tileWashroom', () => {
  for (const r of level.rooms) {
    for (const pc of r.pieces) {
      const ov = pc.params?.material;
      if (ov !== undefined) assert.ok(typeof ov === 'string' && isPaletteMaterialKey(ov), `${r.id} ${pc.kit} material ${String(ov)}`);
    }
  }
  const walls = level.rooms.find((r) => r.id === 'R12d')!.pieces.filter((p) => p.kit.startsWith('wall_'));
  assert.ok(walls.length > 0);
  for (const w of walls) assert.equal(w.params?.material, 'tileWashroom');
});
