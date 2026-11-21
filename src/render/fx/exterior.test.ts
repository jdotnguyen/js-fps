import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Rng } from '../../core/rng.ts';
import { buildExterior, createBeamConeGeometry, createExteriorBeamMaterial, lampCount, legColumns, placeFloodlights, windowRuns, type ExteriorColumn, type ExteriorWindow } from './exterior.ts';

/** A window tile on a north wall (outward -Z) centred at x, glass centre height 1.65. */
const north = (room: string, x: number, flicker = false): ExteriorWindow => ({
  room,
  matrix: new THREE.Matrix4().makeTranslation(x, 1.65, -1.79),
  width: 4,
  flicker,
});

test('lamp count follows the glass: 1 per ~7 m, at least one', () => {
  assert.equal(lampCount(4), 1);
  assert.equal(lampCount(8), 1);
  assert.equal(lampCount(12), 2);
  assert.equal(lampCount(16), 2);
  assert.equal(lampCount(24), 3);
});

test('adjacent tiles merge into one run; other walls and rooms stay separate', () => {
  const runs = windowRuns([north('A', 4), north('A', 8), north('A', 12), north('A', 24), north('B', 16)]);
  const lens = runs.map((r) => `${r.room}:${(r.end - r.start).toFixed(0)}`).sort();
  assert.deepEqual(lens, ['A:12', 'A:4', 'B:4']);
});

test('floodlights sit above and outside the glass, aimed out and down, and only the first of a flicker run flickers', () => {
  const lamps = placeFloodlights(windowRuns([north('A', 4, true), north('A', 8), north('A', 12)]));
  assert.equal(lamps.length, 2);
  for (const l of lamps) {
    assert.ok(l.position.y > 2.4, 'above the window head');
    assert.ok(l.position.z < -1.79, 'outside the glass');
    assert.ok(l.direction.z < -0.5 && l.direction.y < -0.5, 'out and down');
  }
  assert.deepEqual(lamps.map((l) => l.flicker), [true, false]);
  assert.ok(Math.abs(lamps[1]!.position.x - lamps[0]!.position.x - 6) < 1e-6, 'evenly spaced along the run');
});

const columns = (): ExteriorColumn[] => {
  const out: ExteriorColumn[] = [];
  for (let gx = 0; gx < 4; gx++) for (let gz = 0; gz < 2; gz++) out.push({ gx, gz, x: gx * 4, z: gz * 4, bottom: -0.85 });
  out.push({ gx: 4, gz: 0, x: 16, z: 0, bottom: -0.85 }); // a one-cell corridor stub
  return out;
};

test('legs stand under the footprint, at column centres, on every wing', () => {
  const cols = columns();
  const legs = legColumns(cols);
  assert.ok(legs.length >= 4);
  for (const l of legs) assert.ok(cols.some((c) => c.x === l.x && c.z === l.z));
  assert.ok(legs.some((l) => l.gx === 4), 'the corridor stub has a leg');
});

test('the exterior builds headless, flickers only flagged lamps, and hides on request', () => {
  const ext = buildExterior({ columns: columns(), windows: [north('A', 4, true), north('A', 8), north('A', 12)], steel: new THREE.MeshStandardMaterial(), rng: new Rng('t') });
  for (const name of ['exterior-water-dome', 'seabed-ground', 'exterior-legs', 'exterior-floodlight-housings', 'exterior-floodlight-beams']) {
    assert.ok(ext.group.getObjectByName(name), name);
  }
  const eye = new THREE.Vector3(4, 1.7, 2);
  let dipped = false;
  for (let t = 0; t < 30; t += 1 / 30) {
    ext.update(t, eye, true, false);
    const [a, b] = ext.floodlights;
    if (a!.intensity < a!.base) dipped = true;
    assert.equal(b!.intensity, b!.base, 'the other lamp stays steady');
  }
  assert.ok(dipped, 'the flicker lamp dips within 30 s');
  for (let t = 30; t < 60; t += 1 / 30) {
    ext.update(t, eye, true, true);
    assert.equal(ext.floodlights[0]!.intensity, ext.floodlights[0]!.base, 'reduced flashing holds it steady');
  }
  ext.update(61, eye, false, false);
  assert.equal(ext.group.visible, false);
  assert.ok(ext.group.getObjectByName('exterior-water-dome')!.position.equals(eye), 'dome follows the eye');
});

test('shared exterior beam helpers produce water-fogged volumetric shader and aAlong cone', () => {
  const mat = createExteriorBeamMaterial(1, 0.24);
  assert.equal(mat.uniforms['uLevel']?.value, 1);
  assert.equal(mat.uniforms['uBody']?.value, 0.24);
  assert.equal(mat.uniforms['uTime']?.value, 0);
  assert.ok(mat.fragmentShader.includes('waterFog('));
  const cone = createBeamConeGeometry(3, 10);
  const along = cone.getAttribute('aAlong');
  assert.ok(along && along.count > 0, 'aAlong attribute present');
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < along.count; i++) {
    const v = along.getX(i);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  assert.ok(Math.abs(min) < 1e-4 && Math.abs(max - 1) < 1e-4, `aAlong spans [0, 1], got [${min}, ${max}]`);
});
