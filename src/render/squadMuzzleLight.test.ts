import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MUZZLE_FLASH_TIME } from '../actors/squadPistol.ts';
import { FLASH_AHEAD, SQUAD_FLASH_LIGHT, SquadMuzzleLight } from './squadMuzzleLight.ts';

/** The squad's muzzle-flash light (squad-sidearms D7). */

test('a squad shot lights the room at the muzzle, then fades to dark within the flash time', () => {
  const scene = new THREE.Scene();
  const l = new SquadMuzzleLight(scene);
  assert.equal(l.lit, false, 'dark before a shot');
  l.fire({ x: 1, y: 1.4, z: -2 }, { x: 0, y: 0, z: -1 });
  assert.equal(l.light.intensity, SQUAD_FLASH_LIGHT.intensity);
  assert.ok(l.light.position.distanceTo(new THREE.Vector3(1, 1.4, -2 - FLASH_AHEAD)) < 1e-9, 'just ahead of the muzzle');
  let last = l.light.intensity;
  for (let t = 0; t < MUZZLE_FLASH_TIME - 0.01; t += 0.01) {
    l.update(0.01);
    assert.ok(l.light.intensity < last, 'fading');
    last = l.light.intensity;
  }
  l.update(0.02);
  assert.equal(l.light.intensity, 0, 'dark again');
  assert.equal(l.light.castShadow, false);
});

test('the light never leaves the scene: the light count every material is keyed by stays the same', () => {
  const scene = new THREE.Scene();
  const l = new SquadMuzzleLight(scene);
  const count = () => {
    let n = 0;
    scene.traverseVisible((o) => void ((o as THREE.Light).isLight && n++));
    return n;
  };
  assert.equal(count(), 1);
  l.fire({ x: 0, y: 1, z: 0 });
  l.update(0.2);
  assert.equal(count(), 1);
  l.dispose();
  assert.equal(count(), 0);
});

test('a newer shot takes the light over', () => {
  const l = new SquadMuzzleLight(new THREE.Scene());
  l.fire({ x: 0, y: 1, z: 0 });
  l.update(0.04);
  l.fire({ x: 3, y: 1, z: 0 });
  assert.equal(l.light.intensity, SQUAD_FLASH_LIGHT.intensity);
  assert.equal(l.light.position.x, 3);
});
