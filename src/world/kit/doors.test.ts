import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Rng } from '../../core/rng.ts';
import type { Materials } from '../../render/materials.ts';

// level-kit spec (overhaul-flooded-tunnel): the pressure door with a porthole.

// Headless canvas for the jamb status screen.
const noop = (): void => undefined;
const ctx = new Proxy({} as Record<string | symbol, unknown>, {
  get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 10 }) : noop),
  set: (t, k, v) => ((t[k] = v), true),
});
(globalThis as { Path2D?: unknown }).Path2D ??= function Path2D(): unknown {
  return new Proxy({}, { get: () => noop });
};
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ width: 1, height: 1, getContext: () => ctx, style: {} }) };

const { buildDoor, PORTHOLE } = await import('./doors.ts');

const mats = new Proxy({} as Record<string, THREE.Material>, {
  get: (t, k: string) => (t[k] ??= k === 'glass' ? new THREE.MeshPhysicalMaterial({ transparent: true, side: THREE.DoubleSide, name: k }) : Object.assign(new THREE.MeshStandardMaterial(), { name: k })),
}) as unknown as Materials;

const build = (porthole: boolean, kit: 'pressure_slide' | 'bulkhead' = 'pressure_slide') => buildDoor(kit, 3.2, () => 'closed', new Rng(1), mats, undefined, { porthole });

/** World-space hit of a ray through the door's -Z plane at the porthole centre, shot from the +Z side. */
function hitsAtPorthole(leaves: THREE.Group, x: number): THREE.Intersection[] {
  leaves.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(x, PORTHOLE.y, 0), new THREE.Vector3(0, 0, -1), 0, 4);
  return ray.intersectObject(leaves, true);
}

test('a porthole door shows the room beyond when shut, and a plain one does not', () => {
  assert.equal(build(true).porthole, true);
  assert.equal(build(false).porthole, false);
  assert.equal(build(true).seeThrough, false, 'a porthole is not a glass door: sound is blocked as by any door');
});

test('the porthole is a real hole with glass in it, seen through from both sides', () => {
  const door = build(true);
  door.setOpen(0);
  // The +X leaf is closed at x = 0.5; its porthole is at the leaf centre.
  const hits = hitsAtPorthole(door.leaves, 0.5);
  assert.ok(hits.length > 0, 'something at the porthole');
  const first = hits[0]!.object as THREE.Mesh;
  assert.equal(first.name, 'door-porthole-glass', `first hit is the glass, not the leaf (got "${first.name}")`);
  assert.equal((first.material as THREE.Material).side, (mats.glass as THREE.Material).side);
  // From the far side too.
  const back = new THREE.Raycaster(new THREE.Vector3(0.5, PORTHOLE.y, -4), new THREE.Vector3(0, 0, 1), 0, 4).intersectObject(door.leaves, true);
  assert.equal(back[0]?.object.name, 'door-porthole-glass');
});

test('a plain pressure door is solid where the porthole would be', () => {
  const hits = hitsAtPorthole(build(false).leaves, 0.5);
  assert.notEqual(hits[0]?.object.name, 'door-porthole-glass');
  assert.ok(hits.length > 0);
});

test('the jamb status screens stay on the jamb while the leaves slide', () => {
  const door = build(false);
  const screens = door.leaves.children.filter((c) => c instanceof THREE.Mesh);
  assert.equal(screens.length, 2);
  for (const f of [0, 0.5, 1]) {
    door.setOpen(f);
    for (const s of screens) assert.equal(s.position.x, 1.16);
  }
});

test('porthole is ignored on kits other than the pressure door', () => {
  assert.equal(build(true, 'bulkhead').porthole, false);
});
