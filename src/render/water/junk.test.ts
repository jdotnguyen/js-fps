import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FloatingJunk, JUNK_ANCHORS, patchJunkShader } from './junk.ts';
import { waterSurfaceUniforms } from './surface.ts';

// flooded-tunnel spec "The tunnel looks long-flooded": floating junk bobs on the water (overhaul-flooded-tunnel 3.9).

test('the junk patch anchors exist in the installed three.js standard and physical shaders', () => {
  for (const lib of [THREE.ShaderLib.standard, THREE.ShaderLib.physical]) for (const a of Object.values(JUNK_ANCHORS)) assert.ok(lib.vertexShader.includes(a), a);
});

test('junk rides the ripple heights of its water (shared uniforms)', () => {
  const u = waterSurfaceUniforms();
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader, uniforms: {} as Record<string, THREE.IUniform> };
  patchJunkShader(shader, u);
  assert.equal(shader.uniforms['uRipple'], u.uRipple, 'the same texture the surface reads');
  assert.match(shader.vertexShader, /transformed\.y \+= junkRipple\(jc\)/);
});

test('junk sits at the water level and follows it, one material per kind', () => {
  const junk = new FloatingJunk(
    [
      { kind: 'paper', at: [1, 2] },
      { kind: 'paper', at: [3, 2], rot: 40 },
      { kind: 'hardhat', at: [2, 3] },
      { kind: 'sheen', at: [4, 1], scale: 1.5 },
    ],
    waterSurfaceUniforms(),
  );
  junk.update(-0.45);
  assert.equal(junk.group.position.y, -0.45);
  const meshes = junk.group.children as THREE.Mesh[];
  assert.equal(meshes.length, 4);
  assert.equal(meshes[0]!.material, meshes[1]!.material);
  assert.notEqual(meshes[0]!.material, meshes[2]!.material);
  assert.deepEqual([meshes[1]!.position.x, meshes[1]!.position.z], [3, 2]);
  junk.update(2.2);
  assert.equal(junk.group.position.y, 2.2, 'rises with a flood');
});
