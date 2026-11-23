import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadSlice01 } from './headlessSlice.ts';
import { RENDER_TIERS } from '../render/tiers.ts';
import { LightingOverlay } from './lightingOverlay.ts';
import type { Level } from './level.ts';

// shadow-rich-rooms D9: the ?debug lighting overlay reports the shadow and fill pools in R03.

const { level: headless } = loadSlice01();
const level = headless as unknown as Level;
const eye = new THREE.Vector3(8, 1.62, 17);
const tier = (q: keyof typeof RENDER_TIERS): void => {
  const t = RENDER_TIERS[q];
  level.setLightBudget({ fillLights: t.fillLights, shadowLights: t.shadowLights, shadowMapSize: t.shadowMapSize });
  for (let i = 0; i < 3; i++) level.update(i / 60, 1 / 60, eye, false);
};

test('the overlay sees R03 four opted-in lights: 2 of 2 shadow spots on Medium, 4 of 6 on High', () => {
  const overlay = new LightingOverlay(level);
  overlay.visible = true;
  const opted = level.lightingState().slots.filter((s) => s.slot.shadow === true && level.roomLights('R03').some((r) => r.light === s.slot.item));
  assert.equal(opted.length, 4, "R03's four opted-in lights");

  tier('medium');
  overlay.update();
  assert.match(overlay.summary(), /room R03 \| shadow 2\/2/);
  const shadowed = level.lightingState().slots.filter((s) => s.by === 'shadow').length;
  assert.equal(shadowed, 2);

  tier('high');
  overlay.update();
  assert.match(overlay.summary(), /shadow 4\/6/);
  assert.ok(overlay.group.children.length > 0);
  overlay.dispose();
});
