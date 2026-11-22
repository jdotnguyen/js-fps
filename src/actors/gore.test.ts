import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// GoreSystem, headless (a stub 2D canvas: textures draw nothing, geometry and placement are real).
const noop = (): void => undefined;
const ctx = new Proxy({} as Record<string | symbol, unknown>, {
  get: (t, k) => (k in t ? t[k] : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop: noop }) : noop),
  set: (t, k, v) => ((t[k] = v), true),
});
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ width: 1, height: 1, getContext: () => ctx, style: {} }) };

const { GoreSystem } = await import('./gore.ts');
const { Rng } = await import('../core/rng.ts');

// standing-water spec "Blood clouds in water" (overhaul-flooded-tunnel D7).
test('under standing water a pool becomes a spreading cloud just under the surface, and fades', () => {
  const g = new GoreSystem(new Rng('cloud'), () => -1.2);
  g.waterLevelAt = (x) => (x < 5 ? -0.45 : null);
  g.pool(new THREE.Vector3(1, -1.2, 0), 0.6);
  assert.equal(g.cloudCount(), 1);
  const cloud = g.group.getObjectByName('gore-blood-cloud')!;
  assert.ok(Math.abs(cloud.position.y - (-0.45 - 0.03)) < 1e-9, 'just under the surface');
  assert.equal(g.group.children.filter((c) => c.name !== 'gore-blood-cloud' && (c as THREE.Mesh).geometry instanceof THREE.PlaneGeometry && c.position.y < -1).length, 0, 'no floor pool under the water');
  const s0 = cloud.scale.x;
  g.update(5);
  assert.ok(cloud.scale.x > s0, 'it spreads');
  g.update(20);
  assert.equal(g.cloudCount(), 0, 'gone after its life');
  g.pool(new THREE.Vector3(8, -1.2, 0), 0.6);
  assert.equal(g.cloudCount(), 0, 'on dry ground it pools as before');
});
