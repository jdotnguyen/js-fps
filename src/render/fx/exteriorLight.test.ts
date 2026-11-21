import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ShaderLib } from 'three';
import { EXTERIOR_HOOKS, MAX_EXTERIOR_LAMPS, applyExterior, domeLift, exteriorUniforms, packLamps, patchExteriorShader, type ExteriorLamp } from './exteriorLight.ts';

const lamp = (x: number): ExteriorLamp => ({
  position: new THREE.Vector3(x, 0, 0),
  direction: new THREE.Vector3(0, -1, 0),
  color: new THREE.Color(1, 1, 1),
  intensity: 2,
  range: 10,
  inner: 0.3,
  outer: 0.5,
});

test('three.js standard shader still has every hook the exterior patch needs', () => {
  const { vertexShader, fragmentShader } = ShaderLib.physical;
  // ShaderLib holds the templates before #include expansion, as onBeforeCompile sees them.
  for (const h of EXTERIOR_HOOKS.vertex) assert.ok(vertexShader.includes(h), `vertex hook ${h}`);
  for (const h of EXTERIOR_HOOKS.fragment) assert.ok(fragmentShader.includes(h), `fragment hook ${h}`);
});

test('patched shader adds lamp lighting and water fog and drops scene fog', () => {
  const shader = { vertexShader: ShaderLib.physical.vertexShader, fragmentShader: ShaderLib.physical.fragmentShader, uniforms: {} as Record<string, THREE.IUniform> };
  patchExteriorShader(shader);
  assert.ok(shader.fragmentShader.includes('extLamps(vExtWorld, extN)'));
  assert.ok(shader.fragmentShader.includes('extLampsSpec(vExtWorld, extN, extV, roughnessFactor)'));
  assert.ok(shader.fragmentShader.includes('waterFog('));
  assert.ok(!shader.fragmentShader.includes('#include <fog_fragment>'));
  assert.ok(shader.vertexShader.includes('vExtWorld ='));
  assert.equal(shader.uniforms['uWaterColor'], exteriorUniforms.uWaterColor, 'shares the uniform objects');
});

test('lamp packing caps at the limit and keeps the nearest', () => {
  const lamps = Array.from({ length: 12 }, (_, i) => lamp(i * 10));
  const n = packLamps(lamps, new THREE.Vector3(0, 0, 0));
  assert.equal(n, MAX_EXTERIOR_LAMPS);
  const xs = exteriorUniforms.uLampPos.value.slice(0, n).map((v) => v.x);
  assert.deepEqual(xs, [0, 10, 20, 30, 40, 50, 60, 70]);
  assert.equal(exteriorUniforms.uLampCount.value, n);
  assert.equal(packLamps([{ ...lamp(0), intensity: 0 }], new THREE.Vector3()), 0, 'dark lamps are skipped');
});

test('dome matches the water fog colour at and below the horizon', () => {
  assert.equal(domeLift(0), 1);
  assert.equal(domeLift(-0.7), 1);
  assert.ok(domeLift(1) > 1.5);
});

test('applyExterior shares one copy per source material and leaves other materials alone', () => {
  const src = new THREE.MeshStandardMaterial();
  const a = applyExterior(src);
  assert.notEqual(a, src);
  assert.equal(applyExterior(src), a);
  assert.equal(applyExterior(a), a);
  const basic = new THREE.MeshBasicMaterial();
  assert.equal(applyExterior(basic), basic);
});
