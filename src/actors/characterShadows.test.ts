import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Humanoid, setCharacterShadowDistance } from './humanoid.ts';
import { ctx } from '../ai/enemyTestKit.ts';
import { RENDER_TIERS } from '../render/tiers.ts';

// render-quality spec: characters cast shadows up to 40 m on High and 15 m on Low and Medium.

const casting = (h: Humanoid): boolean[] => {
  const out: boolean[] = [];
  h.group.traverse((o) => void (o instanceof THREE.SkinnedMesh && out.push(o.castShadow)));
  return out;
};

test('a character 20 m away casts a shadow on High but not on Medium', () => {
  const h = new Humanoid({ seed: 'shadow-dist', outfit: 'crew', role: 'npc' }, ctx());
  const camera = new THREE.Vector3(0, 1.6, 20);
  assert.ok(casting(h).length > 0);

  setCharacterShadowDistance(RENDER_TIERS.medium.characterShadowDistance);
  h.update(1 / 60, camera);
  assert.ok(casting(h).every((c) => !c), 'Medium: no shadow at 20 m');

  setCharacterShadowDistance(RENDER_TIERS.high.characterShadowDistance);
  h.update(1 / 60, camera);
  assert.ok(casting(h).every((c) => c), 'High: shadow at 20 m');

  h.update(1 / 60, new THREE.Vector3(0, 1.6, 45));
  assert.ok(casting(h).every((c) => !c), 'High: none past 40 m');
  setCharacterShadowDistance(15);
});
