import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WaterBody } from '../../world/water.ts';
import { MURK, MURK_ANCHORS, addMurk, murkAmount, murkBoxes, murkRows, patchMurkShader, updateMurk } from './murk.ts';

// standing-water spec "Depth makes the water murky" (overhaul-flooded-tunnel D5).

test('every anchor the murk patch needs exists in the installed three.js standard shader', () => {
  for (const [name, anchor] of Object.entries(MURK_ANCHORS)) {
    const src = name.startsWith('vertex') ? THREE.ShaderLib.standard.vertexShader : THREE.ShaderLib.standard.fragmentShader;
    assert.ok(src.includes(anchor), `${name}: ${anchor}`);
  }
});

test('submerged stairs: the first step is clear and each lower one is fainter', () => {
  const eye = { x: 0, y: 1.2, z: 0 };
  // Steps 24 cm apart going down under a surface at -0.45, seen from the landing.
  const steps = [-0.48, -0.72, -0.96, -1.2].map((y, i) => murkAmount(eye, { x: 0, y, z: -1.2 - i * 0.48 }, -0.45));
  assert.ok(steps[0]! < 0.15, `first submerged step barely tinted (${steps[0]})`);
  for (let i = 1; i < steps.length; i++) assert.ok(steps[i]! > steps[i - 1]!, 'each lower step is fainter');
  assert.ok(steps.at(-1)! > 0.6, `the sump floor is mostly lost (${steps.at(-1)})`);
  assert.equal(murkAmount(eye, { x: 0, y: 0, z: -2 }, -0.45), 0, 'nothing above the water is tinted');
});

test('an L-shaped footprint: one murk box per cell, stopping 0.2 m short of the walls but not between cells', () => {
  const body = new WaterBody({
    room: 'R09',
    level: -0.45,
    floor: -1.2,
    cells: [
      { minX: 6, maxX: 10, minZ: 42, maxZ: 46 },
      { minX: 10, maxX: 14, minZ: 42, maxZ: 46 },
      { minX: 14, maxX: 18, minZ: 42, maxZ: 46 },
      { minX: 14, maxX: 18, minZ: 46, maxZ: 50 },
      { minX: 18, maxX: 22, minZ: 46, maxZ: 50 },
    ],
  });
  assert.deepEqual(murkRows(body).sort((a, b) => a[1] - b[1]), [[6, 42, 18, 46], [14, 46, 22, 50]]);
  const boxes = murkBoxes(body);
  assert.equal(boxes.length, 5);
  // First cell (6..10, 42..46): walls west, north and south; its east side is shared with the next cell.
  assert.deepEqual(boxes[0], [6.2, 42.2, 10, 45.8]);
  // The bend cell (14..18, 42..46) opens south into (14..18, 46..50).
  assert.deepEqual(boxes[2], [14, 42.2, 17.8, 46]);
  updateMurk([body]);
  assert.equal(MURK.uMurkCount.value, 5);
  assert.equal(MURK.uMurkLevel.value[0], -0.45);
  updateMurk([]);
  assert.equal(MURK.uMurkCount.value, 0, 'no water visible: the patch does nothing');
});

test('the patch keeps a material\'s own patch, shares the uniforms, and skips the water surface', () => {
  const m = new THREE.MeshStandardMaterial();
  let priorRan = false;
  m.onBeforeCompile = () => {
    priorRan = true;
  };
  addMurk(m);
  addMurk(m);
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} as Record<string, THREE.IUniform> };
  m.onBeforeCompile(shader as never, {} as never);
  assert.equal(priorRan, true);
  assert.equal(shader.uniforms['uMurkCount'], MURK.uMurkCount, 'shared, so one update reaches every material');
  assert.equal(shader.fragmentShader.split('uMurkAbsorb * under').length, 2, 'patched once');
  assert.match(m.customProgramCacheKey(), /priorRan = true[\s\S]*\|murk$/);
  const water = new THREE.MeshStandardMaterial({ name: 'standing-water' });
  const before = water.onBeforeCompile;
  addMurk(water);
  assert.equal(water.onBeforeCompile, before);
});

test('patchMurkShader puts the tint before fog', () => {
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} as Record<string, THREE.IUniform> };
  patchMurkShader(shader);
  assert.match(shader.fragmentShader, /uMurkColor, 1\.0 - exp[\s\S]*#include <fog_fragment>/);
  assert.match(shader.vertexShader, /vMurkWorld = \(modelMatrix \* murkP\)\.xyz/);
});
