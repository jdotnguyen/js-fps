import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WaterBody } from '../../world/water.ts';
import { WATER_ANCHORS, WaterSurface, patchWaterShader, waterSurfaceUniforms } from './surface.ts';

// standing-water spec (overhaul-flooded-tunnel D3): the surface is a lit standard material patched for water.

const body = (): WaterBody =>
  new WaterBody({ room: 'R09', level: -0.45, floor: -1.2, cells: [{ minX: -2, maxX: 2, minZ: -2, maxZ: 2 }, { minX: 2, maxX: 6, minZ: -2, maxZ: 2 }] });

test('every shader anchor the water patch needs exists in the installed three.js standard shader', () => {
  const lib = THREE.ShaderLib.standard;
  const vertex = lib.vertexShader;
  const fragment = lib.fragmentShader;
  for (const [name, anchor] of Object.entries(WATER_ANCHORS)) {
    const src = name.startsWith('vertex') ? vertex : fragment;
    assert.ok(src.includes(anchor), `${name}: ${anchor}`);
  }
});

test('the patch adds the water uniforms and code at each anchor', () => {
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} as Record<string, THREE.IUniform> };
  const u = waterSurfaceUniforms();
  patchWaterShader(shader, u);
  assert.equal(shader.uniforms['uTime'], u.uTime);
  assert.match(shader.vertexShader, /vWaterWorld = \(modelMatrix/);
  assert.match(shader.fragmentShader, /waterSlope\(vWaterWorld\.xz\)/);
  assert.match(shader.fragmentShader, /outgoingLight \+= refl \* fres;[\s\S]*#include <opaque_fragment>/);
});

test('the surface is lit by the scene lights (a standard material), covers the footprint and follows the level', () => {
  const b = body();
  const s = new WaterSurface(b);
  assert.ok(s.mesh.material instanceof THREE.MeshStandardMaterial, 'lit by the light pool, not an unlit shader');
  assert.equal((s.mesh.material as THREE.Material).transparent, true);
  s.mesh.geometry.computeBoundingBox();
  const bb = s.mesh.geometry.boundingBox!;
  // Stops 0.2 m short of the walls, so it never shows through to the far side of one.
  assert.deepEqual([bb.min.x, bb.max.x, bb.min.z, bb.max.z].map((v) => Math.round(v * 100) / 100), [-1.8, 5.8, -1.8, 1.8]);
  assert.equal(s.mesh.position.y, -0.45);
  b.setLevel(0.55, 2);
  b.update(2);
  s.update(1);
  assert.equal(s.mesh.position.y, 0.55);
  assert.equal(s.uniforms.uTime.value, 1);
});
