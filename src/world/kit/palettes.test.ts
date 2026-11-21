import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import type { Materials } from '../../render/materials.ts';
import { PHOTO_SLOT_KEYS } from '../../render/tex/manifest.ts';
import { AREA_PALETTES, DEFAULT_PALETTE, PALETTE_MATERIAL_KEYS, isPaletteMaterialKey, paletteFor, resolvePalette } from './palettes.ts';
import { Rng } from '../../core/rng.ts';
import { STRUCTURE_PIECES } from './structure.ts';

// Area palettes (openspec adopt-photoscanned-textures, group 5): every slice01 area has one, every entry names a
// real Materials key, hazard stripes are rusty only in the tunnel (the dive bay went clean in rebuild-dive-bay), and `params.material` overrides.

const MATERIAL_KEYS = [...PHOTO_SLOT_KEYS, 'steel', 'hazardClean', 'glass', 'black', 'cable', 'glowCyan'];

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

test('rusty photo hazard stripes are only used in the tunnel', () => {
  const rusty = Object.entries(AREA_PALETTES).filter(([, p]) => p.hazard === 'hazard').map(([a]) => a);
  assert.deepEqual(rusty.sort(), ['tunnel']);
});

test('resolvePalette follows the area and falls back to the default for unknown or missing areas', () => {
  const m = stubMaterials();
  const tunnel = resolvePalette({ area: 'tunnel' }, m);
  assert.equal(tunnel.wallMain, m.rustHeavy);
  assert.equal(tunnel.wallAlt, m.concrete);
  assert.equal(tunnel.ceiling, m.paintDark, 'ceiling defaults to paintDark');
  assert.equal(tunnel.trim, m.steel, 'trim defaults to steel');
  assert.equal(tunnel.floor, m.concreteFloor);
  assert.equal(tunnel.floorAlt, m.diamondRusty);
  assert.equal(tunnel.hazard, m.hazard);
  const dock = resolvePalette({ area: 'dock' }, m);
  assert.equal(dock.wallMain, m.cleanSlate);
  assert.equal(dock.wallAlt, m.boltPanel);
  assert.equal(dock.ceiling, m.steelDark);
  assert.equal(dock.trim, m.steelBrushed);
  assert.equal(dock.doorSurround, m.cleanSlate);
  assert.equal(dock.doorPanel, m.steelDark);
  assert.equal(dock.pipeAccent, m.cleanTeal);
  assert.equal(dock.pipeMain, m.steelDark);
  const commons = resolvePalette({ area: 'commons' }, m);
  assert.equal(commons.wallMain, m.vinylPanel);
  assert.equal(commons.wallAlt, m.cleanWall);
  assert.equal(commons.ceiling, m.officeCeiling);
  assert.equal(commons.trim, m.steelBrushed);
  assert.equal(commons.doorSurround, m.vinylPanel);
  assert.equal(commons.doorPanel, m.steelDark);
  assert.equal(commons.doorGlassBar, m.cleanWall);
  const admin = resolvePalette({ area: 'admin' }, m);
  assert.equal(admin.ceiling, m.officeCeiling);
  assert.equal(admin.trim, m.steelBrushed);
  assert.equal(admin.doorSurround, m.woodPanel);
  assert.equal(admin.doorPanel, m.steelDark);
  assert.equal(admin.doorGlassBar, m.steelBrushed);
  const med = resolvePalette({ area: 'medbay' }, m);
  assert.equal(med.wallMain, m.paintBone);
  assert.equal(med.floor, m.labTile);
  assert.equal(med.wallAlt, m.paintBone, 'wallAlt defaults to wallMain');
  assert.equal(med.ceiling, m.paintDark, 'ceiling defaults to paintDark');
  assert.equal(med.trim, m.steel, 'trim defaults to steel');
  assert.equal(med.floorAlt, m.steel, 'floorAlt defaults to steel');
  assert.equal(med.hazard, m.hazardClean);
  assert.equal(paletteFor('nowhere'), DEFAULT_PALETTE);
  assert.equal(resolvePalette({}, m).wallMain, m[DEFAULT_PALETTE.wallMain]);
});

test('params.material overrides the main surfaces but not hazard or trim', () => {
  const m = stubMaterials();
  const p = resolvePalette({ area: 'admin', material: 'boltPanel' }, m);
  assert.equal(p.wallMain, m.boltPanel);
  assert.equal(p.wallAlt, m.boltPanel);
  assert.equal(p.ceiling, m.boltPanel);
  assert.equal(p.floor, m.boltPanel);
  assert.equal(p.trim, m.steelBrushed, 'trim is not overridden by params.material');
  assert.equal(p.hazard, m.hazardClean);
  assert.equal(p.overridden, true);
  assert.equal(resolvePalette({ area: 'hydroponics' }, m).overridden, false);
  assert.throws(() => resolvePalette({ material: 'glass' }, m), /not a palette material/);
  assert.throws(() => resolvePalette({ material: 'nope' }, m), /not a palette material/);
  assert.throws(() => resolvePalette({ material: 5 }, m), /not a palette material/);
});

test('slice01 piece overrides name valid palette materials; the nutrient room uses clean tileWall', () => {
  for (const r of level.rooms) {
    for (const pc of r.pieces) {
      const ov = pc.params?.material;
      if (ov !== undefined) assert.ok(typeof ov === 'string' && isPaletteMaterialKey(ov), `${r.id} ${pc.kit} material ${String(ov)}`);
    }
  }
  const walls = level.rooms.find((r) => r.id === 'R12d')!.pieces.filter((p) => p.kit.startsWith('wall_'));
  assert.ok(walls.length > 0);
  for (const w of walls) assert.equal(w.params?.material, 'tileWall');
});

test('the observation gallery palette is clean: no rusty paintDark on its walls, ceiling or glass partition, and its console is the clean variant', () => {
  const m = stubMaterials();
  const used = (kit: string, pieces: typeof STRUCTURE_PIECES): Set<string> => {
    const out = pieces.find((p) => p.id === kit)!.generate({ area: 'gallery', height: 3.6 }, new Rng(kit), m);
    const names = new Set<string>();
    out.object.traverse((c) => {
      if (c instanceof THREE.Mesh) names.add((Array.isArray(c.material) ? c.material[0] : c.material).name);
    });
    return names;
  };
  for (const kit of ['wall_plain', 'wall_panel', 'wall_glass_partition', 'ceiling']) {
    const names = used(kit, STRUCTURE_PIECES);
    assert.ok(!names.has('paintDark'), `${kit} in the gallery uses no paintDark (${[...names].join(', ')})`);
  }
  assert.ok(used('wall_plain', STRUCTURE_PIECES).has('cleanSlate'), 'gallery walls are clean slate');
  assert.ok(used('wall_panel', STRUCTURE_PIECES).has('cleanTeal'), 'gallery upper panels are clean teal');
  assert.ok(used('wall_glass_partition', STRUCTURE_PIECES).has('cleanSlate'), 'glass partition sill and header are clean slate');
  assert.ok(used('ceiling', STRUCTURE_PIECES).has('officeCeiling'), 'gallery ceiling is the office ceiling');
  const pal = resolvePalette({ area: 'gallery' }, m);
  // props.ts `console` builds its clean variant (cleanWall base) whenever the area's doorPanel is not paintDark.
  assert.notEqual(pal.doorPanel, m.paintDark, 'gallery console is the clean variant');
  assert.equal(pal.floorAlt, m.steelBrushed, 'bare strip material');
});

/** Photo slots that show rust or peeling paint (surface-textures: the lab wing keeps them out of its base). */
const WORN_SLOTS = ['rustHeavy', 'rustDrip', 'rustBlotch', 'diamondRusty', 'hazard', 'servicePaint', 'labPanel', 'paintBone', 'paintTeal', 'paintDark'] as const;

test('Lab wing walls: the labs palette is clean, with a slate band and no worn slot anywhere in it', () => {
  const m = stubMaterials();
  const labs = resolvePalette({ area: 'labs' }, m);
  assert.equal(labs.wallMain, m.cleanWall);
  assert.equal(labs.wallAlt, m.cleanSlate);
  for (const [k, v] of Object.entries(labs)) {
    if (k === 'overridden') continue;
    for (const w of WORN_SLOTS) assert.notEqual(v, m[w], `labs.${k} is ${w}`);
  }
});
