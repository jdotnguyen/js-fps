import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// dock-checkpoint spec: the detector arch, its scan feedback, the line props and the CCTV wall.
// Headless: stub 2D canvases like world/headlessSlice.ts, without loading the level.
const noop = (): void => undefined;
const ctx = new Proxy({} as Record<string | symbol, unknown>, {
  get: (t, k) => (k in t ? t[k] : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop: noop }) : k === 'measureText' ? () => ({ width: 10 }) : noop),
  set: (t, k, v) => ((t[k] = v), true),
});
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ width: 1, height: 1, getContext: () => ctx, style: {} }) };

const { SLICE_PROPS, DETECTOR_ALARM, DETECTOR_IDLE, DETECTOR_PASS } = await import('./slice.ts');
const { Rng } = await import('../../core/rng.ts');

const mats = new Proxy({} as Record<string | symbol, THREE.Material>, {
  get: (t, k) => (t[k] ??= new THREE.MeshStandardMaterial()),
});

function make(kit: string, params: Record<string, unknown> = {}) {
  const def = SLICE_PROPS.find((d) => d.id === kit);
  assert.ok(def, `prop ${kit} is registered`);
  return def.generate(params as never, new Rng(7), mats as never);
}

function emit(out: ReturnType<typeof make>, event: string, payload: unknown): void {
  for (const l of out.listeners ?? []) if (l.event === event) l.fn(payload);
}

function named(out: ReturnType<typeof make>, name: string): THREE.Mesh {
  const o = out.object.getObjectByName(name);
  assert.ok(o, `mesh ${name}`);
  return o as THREE.Mesh;
}

test('detector arch: pass shows green for about a second, then idles', () => {
  const out = make('metal_detector', { id: 'dock_arch' });
  const bar = named(out, 'detector:dock_arch');
  const state = bar.userData['detectorState'] as () => string;
  const mat = bar.material as THREE.MeshStandardMaterial;
  out.tick!(0, 0);
  assert.equal(state(), 'idle');
  assert.equal(mat.emissive.getHex(), DETECTOR_IDLE);
  emit(out, 'detector:scan', { id: 'dock_arch', result: 'pass' });
  assert.equal(state(), 'pass');
  assert.equal(mat.emissive.getHex(), DETECTOR_PASS);
  out.tick!(0.8, 0.8);
  assert.equal(state(), 'pass');
  out.tick!(1.05, 0.25);
  assert.equal(state(), 'idle');
  assert.equal(mat.emissive.getHex(), DETECTOR_IDLE);
});

test('detector arch: alarm shows red for about 1.5 s, then idles', () => {
  const out = make('metal_detector', { id: 'dock_arch' });
  const bar = named(out, 'detector:dock_arch');
  const state = bar.userData['detectorState'] as () => string;
  out.tick!(10, 0);
  emit(out, 'detector:scan', { id: 'dock_arch', result: 'alarm' });
  assert.equal((bar.material as THREE.MeshStandardMaterial).emissive.getHex(), DETECTOR_ALARM);
  out.tick!(11.2, 1.2);
  assert.equal(state(), 'alarm');
  out.tick!(11.55, 0.35);
  assert.equal(state(), 'idle');
});

test('detector arch ignores scans for other arches and unknown results', () => {
  const out = make('metal_detector', { id: 'dock_arch' });
  const state = named(out, 'detector:dock_arch').userData['detectorState'] as () => string;
  emit(out, 'detector:scan', { id: 'other', result: 'alarm' });
  emit(out, 'detector:scan', { id: 'dock_arch', result: 'maybe' });
  emit(out, 'detector:scan', undefined);
  assert.equal(state(), 'idle');
});

test('detector arch has at least 1.0 m clear between its posts and a solid box per post', () => {
  const out = make('metal_detector', { id: 'a' });
  const posts = out.colliders.filter((c) => c.min[1] === 0);
  assert.equal(posts.length, 2);
  const [l, r] = [...posts].sort((a, b) => a.min[0] - b.min[0]);
  assert.ok(r!.min[0] - l!.max[0] >= 1.0 - 1e-9, `opening ${(r!.min[0] - l!.max[0]).toFixed(2)} m`);
});

test('rails, gate and tray stay under 1.2 m', () => {
  for (const [kit, params] of [['rail', { length: 2 }], ['staff_gate', {}], ['tray_table', {}]] as const) {
    const out = make(kit, params);
    for (const c of out.colliders) assert.ok(c.max[1] <= 1.2, `${kit} collider top ${c.max[1]}`);
    const box = new THREE.Box3().setFromObject(out.object);
    assert.ok(box.max.y <= 1.2, `${kit} height ${box.max.y.toFixed(2)}`);
  }
});

test('cctv wall: a camera:feed event drives the live tile', () => {
  const out = make('cctv_wall', { id: 'dock_post' });
  const state = named(out, 'cctv:dock_post').userData['feedState'] as () => string;
  assert.equal(state(), 'live');
  emit(out, 'camera:feed', { id: 'elsewhere', state: 'static' });
  assert.equal(state(), 'live');
  emit(out, 'camera:feed', { id: 'dock_post', state: 'static' });
  assert.equal(state(), 'static');
});

test('cctv wall: six feeds in at most two screen draw calls', () => {
  const out = make('cctv_wall', { id: 'dock_post' });
  const screens: THREE.Mesh[] = [];
  out.object.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if ((o as THREE.Mesh).isMesh && o.userData.dynamic && mat?.emissiveMap) screens.push(o as THREE.Mesh);
  });
  assert.ok(screens.length <= 2, `${screens.length} screen meshes`);
  const tiles = screens.reduce((n, s) => n + s.geometry.getAttribute('position').count / 4, 0);
  assert.equal(tiles, 6, 'six feed tiles in total');
});
