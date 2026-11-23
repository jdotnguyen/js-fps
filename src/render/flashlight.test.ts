import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Flashlight } from './flashlight.ts';

// player-flashlight spec: "The beam follows the view with no delay" and "The beam leaves the chest whatever is drawn".

function setup(): { flashlight: Flashlight; camera: THREE.PerspectiveCamera } {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(2, 1.6, -3);
  camera.updateMatrixWorld(true);
  const flashlight = new Flashlight(new THREE.Scene(), camera);
  flashlight.update(1 / 60);
  return { flashlight, camera };
}

const beam = (f: Flashlight): THREE.Vector3 => f.light.target.position.clone().sub(f.light.position).normalize();
const look = (c: THREE.Camera): THREE.Vector3 => c.getWorldDirection(new THREE.Vector3());

test('a 90 degree turn in one frame points the beam along the new view on that same frame', () => {
  const { flashlight, camera } = setup();
  camera.rotation.set(0, Math.PI / 2, 0);
  camera.updateMatrixWorld(true);
  flashlight.update(1 / 60);
  assert.ok(beam(flashlight).distanceTo(look(camera)) < 1e-9, `beam ${beam(flashlight).toArray()} vs view ${look(camera).toArray()}`);
});

test('every frame of a turn, looking up and down included, the beam equals the view', () => {
  const { flashlight, camera } = setup();
  for (let i = 0; i < 60; i++) {
    camera.rotation.set(Math.sin(i / 7) * 1.2, i * 0.11, 0, 'YXZ');
    camera.updateMatrixWorld(true);
    flashlight.update(1 / 60);
    assert.ok(beam(flashlight).distanceTo(look(camera)) < 1e-9, `frame ${i}`);
  }
});

test('when the turn stops the beam stops and does not drift on', () => {
  const { flashlight, camera } = setup();
  camera.rotation.set(0.3, 2, 0, 'YXZ');
  camera.updateMatrixWorld(true);
  flashlight.update(1 / 60);
  const first = beam(flashlight);
  for (let i = 0; i < 30; i++) flashlight.update(1 / 60);
  assert.ok(beam(flashlight).distanceTo(first) < 1e-9, 'no overshoot, no settling');
});

test('the beam is carried low and to the left of the camera, the same wherever it looks', () => {
  const { flashlight, camera } = setup();
  const offset = (): THREE.Vector3 => flashlight.light.position.clone().sub(camera.position);
  for (const yaw of [0, 1, 2.5]) {
    camera.rotation.set(0, yaw, 0);
    camera.updateMatrixWorld(true);
    flashlight.update(1 / 60);
    const local = offset().applyQuaternion(camera.quaternion.clone().invert());
    assert.ok(Math.abs(local.x - -0.22) < 1e-9 && Math.abs(local.y - -0.32) < 1e-9 && Math.abs(local.z) < 1e-9, `yaw ${yaw}: ${local.toArray()}`);
  }
});
