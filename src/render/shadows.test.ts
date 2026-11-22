import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SHADOW_MAP_TYPE } from './renderer.ts';
import { Flashlight, FLASHLIGHT_SHADOW } from './flashlight.ts';
import { pauseShadow } from './shadowMapKeep.ts';

// render-lighting: shadows have soft edges. r183 deprecates PCFSoftShadowMap (it warns and falls back);
// PCFShadowMap is soft there, with the filter width set per light by shadow.radius.

test('the renderer uses PCFShadowMap, not the deprecated PCFSoftShadowMap', () => {
  assert.equal(SHADOW_MAP_TYPE, THREE.PCFShadowMap);
  assert.notEqual(SHADOW_MAP_TYPE, THREE.PCFSoftShadowMap);
});

test('the flashlight shadow sets its biases and a soft-PCF radius above 1', () => {
  const light = new Flashlight(new THREE.Scene(), new THREE.PerspectiveCamera()).light;
  assert.ok(light.castShadow);
  assert.equal(light.shadow.bias, FLASHLIGHT_SHADOW.bias);
  assert.equal(light.shadow.normalBias, FLASHLIGHT_SHADOW.normalBias);
  assert.ok(light.shadow.radius > 1);
});

test('pauseShadow stops the pass, and asks for one pass when the light has no shadow map yet (r183 empty shadow sampler)', () => {
  const fresh = new THREE.SpotLight();
  pauseShadow(fresh.shadow);
  assert.equal(fresh.shadow.autoUpdate, false);
  assert.equal(fresh.shadow.needsUpdate, true, 'a light that never rendered gets one pass so its map exists');

  const rendered = new THREE.SpotLight();
  rendered.shadow.map = new THREE.WebGLRenderTarget(1, 1);
  pauseShadow(rendered.shadow);
  assert.equal(rendered.shadow.autoUpdate, false);
  assert.equal(rendered.shadow.needsUpdate, false, 'a light with a map stays paused');
});

test('the flashlight, off from the start, still gets its shadow map allocated', () => {
  const flashlight = new Flashlight(new THREE.Scene(), new THREE.PerspectiveCamera());
  flashlight.update(1 / 60);
  assert.equal(flashlight.light.shadow.autoUpdate, false);
  assert.equal(flashlight.light.shadow.needsUpdate, true);
});
