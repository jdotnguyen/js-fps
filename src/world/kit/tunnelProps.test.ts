import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Rng } from '../../core/rng.ts';
import type { Materials } from '../../render/materials.ts';
import { KitRegistry } from '../registry.ts';

// flooded-tunnel spec (overhaul-flooded-tunnel): the flood cutscene's props.

// Headless canvas for painted decals (they draw when a test builds them).
const noop = (): void => undefined;
const ctx2d = new Proxy({} as Record<string | symbol, unknown>, {
  get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 10 }) : k === 'getImageData' ? (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }) : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop: noop }) : noop),
  set: (t, k, v) => ((t[k] = v), true),
});
(globalThis as { Path2D?: unknown }).Path2D ??= function Path2D(): unknown {
  return new Proxy({}, { get: () => noop });
};
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ width: 1, height: 1, getContext: () => ctx2d, style: {} }) };

const mats = new Proxy({} as Record<string, THREE.Material>, {
  get: (t, k: string) => (t[k] ??= Object.assign(new THREE.MeshStandardMaterial(), { name: k })),
}) as unknown as Materials;
const reg = new KitRegistry({ glb: {} });

function fire(out: ReturnType<KitRegistry['create']>, event: string): void {
  for (const l of out.listeners ?? []) if (l.event === event) l.fn(undefined);
}

test('the porthole hand is hidden until the slap, slides down the glass, then is gone; a reset hides it', () => {
  const out = reg.create('porthole_hand', {}, new Rng(1), mats);
  const hand = out.object.getObjectByName('porthole-hand')!;
  assert.equal(hand.visible, false);
  out.tick?.(10, 0);
  fire(out, 'flood:handslap');
  out.tick?.(10.2, 0.2);
  assert.equal(hand.visible, true);
  assert.equal(hand.position.z, -0, 'against the glass');
  out.tick?.(11.0, 0.8);
  assert.ok(hand.position.y < -0.1, `dragged down the glass (${hand.position.y})`);
  out.tick?.(12.6, 1.6);
  assert.equal(hand.visible, false, 'sunk away');
  fire(out, 'flood:handslap');
  out.tick?.(12.7, 0.1);
  fire(out, 'level:reset');
  assert.equal(hand.visible, false);
});

test('a gated loop stays silent until its event and again after a level reset', () => {
  const out = reg.create('ambient_loop', { sound: 'klaxon', on: 'flood:klaxon' }, new Rng(1), mats);
  const loop = out.soundLoops![0]!;
  assert.equal(loop.active?.(), false);
  fire(out, 'flood:klaxon');
  assert.equal(loop.active?.(), true);
  fire(out, 'level:reset');
  assert.equal(loop.active?.(), false);
});

// Industrial tunnel surfaces (overhaul-flooded-tunnel group 11).
const usesMaterial = (o: THREE.Object3D, name: string): boolean => {
  let hit = false;
  o.traverse((c) => {
    const mat = (c as THREE.Mesh).material as THREE.Material | undefined;
    if (mat && mat.name === name) hit = true;
  });
  return hit;
};

test('grated landings and treads use open grating and keep the solid colliders', () => {
  for (const kit of ['floor_landing', 'stairs'] as const) {
    const params = kit === 'stairs' ? { rise: 1.2, run: 2.4, offset: 0.6 } : { rise: 1.2, depth: 1.4 };
    const solid = reg.create(kit, params, new Rng(1), mats);
    const grated = reg.create(kit, { ...params, grate: true }, new Rng(1), mats);
    assert.equal(usesMaterial(grated.object, 'grating'), true, `${kit}: grating`);
    assert.equal(usesMaterial(grated.object, 'diamond'), false, `${kit}: no solid plate`);
    assert.deepEqual(grated.colliders, solid.colliders, `${kit}: same colliders`);
  }
});

test('the TAG stencil is a wall decal; the depth gauge hangs from its zero mark', () => {
  const logo = reg.create('tag_stencil', { y: 1.2 }, new Rng(1), mats);
  const plane = logo.object.children.find((c) => (c as THREE.Mesh).geometry instanceof THREE.PlaneGeometry) as THREE.Mesh;
  assert.ok(plane);
  assert.ok(Math.abs(plane.position.y - 1.2) < 1e-9);
  assert.equal(logo.colliders.length, 0, 'paint, not a solid');
  const gauge = reg.create('tag_stencil', { kind: 'depth', y: -0.4 }, new Rng(1), mats);
  const g = gauge.object.children[0] as THREE.Mesh;
  g.geometry.computeBoundingBox();
  assert.ok(Math.abs(g.position.y + g.geometry.boundingBox!.max.y - -0.4) < 0.03, 'top (0.0) at the zero mark');
});

test('a cable tray hangs from the ceiling on rods and never blocks the way', () => {
  const tray = reg.create('cable_tray', { length: 4, ceiling: 4.4, drop: 0.4 }, new Rng(3), mats);
  const box = new THREE.Box3().setFromObject(tray.object);
  assert.ok(Math.abs(box.max.y - 4.4) < 0.02, `rods reach the ceiling (${box.max.y})`);
  assert.ok(box.min.y > 3.4, `nothing hangs into head height (${box.min.y})`);
  assert.equal(tray.colliders.length, 0);
});
