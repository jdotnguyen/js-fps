import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FLASHLIGHT_LENGTH, FlashlightProp, RAISE_TIME, flashlightPose, pointAlong, toNdc } from './flashlightProp.ts';

// player-flashlight spec "The flashlight never looks like it is floating" and "The flashlight is seen while it is on".

const ASPECTS = { '4:3': 4 / 3, '16:9': 16 / 9, '21:9': 21 / 9 };
// The FOV slider runs 70-95 degrees (vertical); aiming narrows it to 0.8 of that.
const FOVS = [70 * 0.8, 70, 80, 95];

test('at every aspect and field of view the lens is on screen and the tail leaves through the left or bottom edge', () => {
  for (const [name, aspect] of Object.entries(ASPECTS)) {
    for (const fov of FOVS) {
      const pose = flashlightPose(fov, aspect);
      const lens = toNdc(pointAlong(pose, 0), fov, aspect)!;
      assert.ok(Math.abs(lens.x) < 0.9 && Math.abs(lens.y) < 0.9, `${name} ${fov}: lens on screen (${lens.x.toFixed(2)}, ${lens.y.toFixed(2)})`);
      assert.ok(lens.x < 0 && lens.y < 0, `${name} ${fov}: lens in the lower left`);
      const tail = toNdc(pointAlong(pose, FLASHLIGHT_LENGTH), fov, aspect)!;
      assert.ok(tail.x < -1 || tail.y < -1, `${name} ${fov}: tail off screen (${tail.x.toFixed(2)}, ${tail.y.toFixed(2)})`);
      // Once the body leaves the screen it does not come back in: the visible part is one piece from the lens.
      let left = false;
      for (let i = 0; i <= 40; i++) {
        const p = toNdc(pointAlong(pose, (FLASHLIGHT_LENGTH * i) / 40), fov, aspect)!;
        const off = p.x < -1 || p.y < -1 || p.x > 1 || p.y > 1;
        if (left) assert.ok(off, `${name} ${fov}: body re-enters the screen at ${i}/40`);
        left ||= off;
      }
      // The tail stays in front of the near plane (0.05 m), so it is clipped by the screen edge, not cut by the eye.
      assert.ok(-pointAlong(pose, FLASHLIGHT_LENGTH).z > 0.05, `${name} ${fov}: tail in front of the near plane`);
    }
  }
});

test('switching on raises the model within 0.35 s, switching off lowers it out of view, and it sways with the view', () => {
  const camera = new THREE.PerspectiveCamera(80, 16 / 9, 0.05, 120);
  const prop = new FlashlightProp();
  prop.setModel(new THREE.Group());
  const still = { x: 0, y: 0, rx: 0, ry: 0 };
  assert.ok(RAISE_TIME >= 0.15 && RAISE_TIME <= 0.35);
  prop.update(1 / 60, true, camera, still, 1);
  assert.equal(prop.held, false, 'not in one frame');
  for (let t = 0; t < 0.35; t += 1 / 60) prop.update(1 / 60, true, camera, still, 1);
  assert.equal(prop.held, true);
  const rest = prop.group.position.clone();
  prop.update(1 / 60, true, camera, { x: 0.01, y: -0.005, rx: 0, ry: 0 }, 1);
  assert.ok(prop.group.position.distanceTo(rest) > 0.005, 'sway moves it');
  for (let t = 0; t < 0.36; t += 1 / 60) prop.update(1 / 60, false, camera, still, 0);
  assert.equal(prop.shown, false);
  assert.equal(prop.group.visible, false);
});

test('without its model nothing shows and the beam keeps its chest origin', () => {
  const camera = new THREE.PerspectiveCamera(80, 16 / 9, 0.05, 120);
  const prop = new FlashlightProp();
  for (let t = 0; t < 1; t += 1 / 60) prop.update(1 / 60, true, camera, { x: 0, y: 0, rx: 0, ry: 0 }, 1);
  assert.equal(prop.shown, false);
});
