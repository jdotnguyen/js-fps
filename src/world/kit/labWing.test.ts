import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// lab-wing spec (rebuild-lab-wing): the lab wing's kit pieces and placement effects, built headlessly.
const noop = (): void => undefined;
const ctx = new Proxy({} as Record<string | symbol, unknown>, {
  get: (t, k) => (k in t ? t[k] : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop: noop }) : k === 'measureText' ? () => ({ width: 10 }) : noop),
  set: (t, k, v) => ((t[k] = v), true),
});
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ width: 1, height: 1, getContext: () => ctx, style: {} }) };

const { LAB_WING_PROPS, bracketsOn } = await import('./labWing.ts');
const { applyPlacementFx } = await import('./placementFx.ts');
const { WALL_MOUNTED_PROPS } = await import('./types.ts');
const { Rng } = await import('../../core/rng.ts');

const mats = new Proxy({} as Record<string | symbol, THREE.Material>, {
  get: (t, k) => (t[k] ??= new THREE.MeshStandardMaterial({ map: new THREE.Texture() })),
});

function make(kit: string, params: Record<string, unknown> = {}) {
  const def = LAB_WING_PROPS.find((d) => d.id === kit);
  assert.ok(def, `piece ${kit} is registered`);
  return def.generate({ area: 'labs', ...params } as never, new Rng(7), mats as never);
}
const top = (out: ReturnType<typeof make>) => Math.max(...out.colliders.map((c) => c.max[1]));
const emit = (out: ReturnType<typeof make>, event: string, payload: unknown) => {
  for (const l of out.listeners ?? []) if (l.event === event) l.fn(payload);
};

test('coolant_line: length and brackets follow the waypoints; collars sit on the crossings; low runs collide', () => {
  const out = make('coolant_line', { path: '0,2.9,0;4,2.9,0;4,2.9,3', collars: '1' });
  assert.equal(out.object.userData['length'], 7);
  assert.equal(out.object.userData['brackets'], bracketsOn(4) + bracketsOn(3));
  assert.equal(bracketsOn(4), 3);
  assert.equal(out.colliders.length, 0, 'an overhead run has no collider');
  // A collar: a mesh centred on waypoint 1, wider than the pipe.
  out.object.updateMatrixWorld(true);
  const collar = out.object.children.some((c) => {
    const b = new THREE.Box3().setFromObject(c);
    const centre = b.getCenter(new THREE.Vector3());
    const size = b.getSize(new THREE.Vector3());
    return centre.distanceTo(new THREE.Vector3(4, 2.9, 0)) < 0.05 && Math.min(size.y, Math.max(size.x, size.z)) > 0.2 && Math.min(size.x, size.z) < 0.12;
  });
  assert.ok(collar, 'collar at the wall crossing');
  const low = make('coolant_line', { path: '0,2.9,0;0,1.3,0' });
  assert.equal(low.colliders.length, 1, 'a run down the wall to the panel collides');
});

test('Lab B pieces: heights, colliders and wall-mounted keep-outs', () => {
  assert.ok(Math.abs(top(make('culture_column')) - 2.7) < 1e-6);
  assert.ok(Math.abs(top(make('biosafety_cabinet')) - 1.94) < 1e-6);
  assert.ok(Math.abs(top(make('freezer_ultra')) - 1.95) < 1e-6);
  assert.ok(Math.abs(top(make('incubator_stack')) - 2.08) < 1e-6);
  for (const w of ['pressure_gauge', 'service_panel']) {
    assert.ok(WALL_MOUNTED_PROPS.includes(w), `${w} is checked against wall structure`);
    assert.equal(make(w).colliders.length, 0, `${w} is flat on the wall`);
  }
  // The column's glass is its own (dynamic) mesh; the medium glows.
  assert.ok(make('culture_column').object.children.some((c) => c.userData['dynamic']));
});

test('R05 pieces: shower is a thin post; the tipped cart is a step, not a perch; the drain is walkable', () => {
  const shower = make('emergency_shower').colliders[0]!;
  assert.ok(shower.max[0] - shower.min[0] <= 0.1 + 1e-9 && shower.max[1] > 2.3);
  assert.ok(top(make('sample_cart', { tipped: true })) < 0.35);
  assert.ok(top(make('sample_cart')) > 0.8);
  assert.equal(make('floor_drain').colliders.length, 0);
  assert.ok(Math.abs(top(make('ppe_locker')) - 1.9) < 1e-6 && Math.abs(top(make('ppe_locker', { open: true })) - 1.9) < 1e-6);
  assert.ok(WALL_MOUNTED_PROPS.includes('directory_sign'));
});

test('R06 pieces: skid and cage are too tall to perch on; the status board turns green for its own door only', () => {
  assert.ok(Math.abs(top(make('pump_skid')) - 1.2) < 1e-6);
  assert.ok(Math.abs(top(make('cylinder_cage')) - 1.4) < 1e-6);
  for (const w of ['bulkhead_wheel', 'pressure_manifold', 'status_board']) assert.ok(WALL_MOUNTED_PROPS.includes(w), w);
  const board = make('status_board', { door: 'D_R06_R07' });
  const screen = board.object.getObjectByName('status_board:screen') as THREE.Mesh;
  const red = screen.material;
  emit(board, 'door:opened', { id: 'D_R05_R06' });
  assert.equal(screen.material, red, 'another door does nothing');
  emit(board, 'door:opened', undefined);
  assert.equal(screen.material, red, 'a bare trigger emit does nothing');
  emit(board, 'door:opened', { id: 'D_R06_R07' });
  assert.notEqual(screen.material, red, 'green when the bulkhead opens');
  emit(board, 'level:reset', undefined);
  assert.equal(screen.material, red, 'reset to red');
});

test('reveal: hidden pieces show nothing until bloom:spread, and hide again on level:reset', () => {
  const out = applyPlacementFx(make('bloom_decal', { seed: 1 }), { reveal: 'spread' });
  const holder = out.object.children[0]!;
  assert.equal(out.object.children.length, 1);
  assert.equal(holder.userData['dynamic'], true);
  let visibleMeshes = 0;
  const count = () => {
    visibleMeshes = 0;
    out.object.traverseVisible((o) => void (o instanceof THREE.Mesh && visibleMeshes++));
    return visibleMeshes;
  };
  assert.equal(count(), 0);
  emit(out, 'bloom:spread', undefined);
  assert.ok(count() > 0);
  emit(out, 'level:reset', undefined);
  assert.equal(count(), 0);
});

test('breathe: the piece scales slowly about its origin, within 2-3 %', () => {
  const out = applyPlacementFx(make('bloom_decal'), { breathe: true, w: 1 });
  const holder = out.object.children[0]!;
  const ys: number[] = [];
  for (let t = 0; t < 6; t += 0.25) {
    out.tick!(t, 0.25);
    ys.push(holder.scale.y);
  }
  assert.ok(Math.max(...ys) - Math.min(...ys) > 0.03, 'it moves');
  assert.ok(Math.max(...ys) <= 1.031 && Math.min(...ys) >= 0.969, 'gently');
});

// livelier-cart-slam D1, D2: the R08 cart's loose instruments, and the cart's collision following its frame.
test('cart_item: every instrument builds with at most two materials and a box at least 1 cm thick, standing on its base', async () => {
  const { CART_ITEMS } = await import('./labWing.ts');
  for (const type of Object.keys(CART_ITEMS)) {
    const out = make('cart_item', { type });
    const materials = new Set<THREE.Material>();
    out.object.traverse((o) => {
      if (o instanceof THREE.Mesh) materials.add(o.material as THREE.Material);
    });
    assert.ok(materials.size >= 1 && materials.size <= 2, `${type}: ${materials.size} materials`);
    assert.equal(out.colliders.length, 1, `${type} has one box`);
    const c = out.colliders[0]!;
    assert.equal(c.min[1], 0, `${type} stands on its base`);
    for (const i of [0, 1, 2]) assert.ok(c.max[i]! - c.min[i]! >= 0.0099, `${type} box is at least 1 cm on axis ${i}`);
  }
});

test('instrument_cart: its boxes are the tray, lips, shelf and posts, with the tray and shelf faces where they are drawn', async () => {
  const { SLICE_PROPS, INSTRUMENT_CART } = await import('./slice.ts');
  const build = (params: Record<string, unknown>) => SLICE_PROPS.find((d) => d.id === 'instrument_cart')!.generate(params as never, new Rng(7), mats as never);
  const bare = build({ instruments: false });
  const dressed = build({});
  assert.ok(bare.object.children.length < dressed.object.children.length, 'instruments: false leaves them off');
  const { top, shelf, w, d } = INSTRUMENT_CART;
  const tops = bare.colliders.map((c) => c.max[1]);
  assert.ok(tops.some((y) => Math.abs(y - top) < 0.002), 'the tray face is at the drawn top');
  assert.ok(tops.some((y) => Math.abs(y - shelf) < 0.002), 'the shelf face is at the drawn shelf');
  // The drawn tray and shelf slabs: their top faces match the boxes.
  const drawn = new THREE.Box3();
  bare.object.updateMatrixWorld(true);
  const faces: number[] = [];
  bare.object.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    drawn.setFromObject(o);
    const size = drawn.getSize(new THREE.Vector3());
    if (size.x > w - 0.05 && size.z > d - 0.05 && size.y < 0.03) faces.push(drawn.max.y);
  });
  for (const y of [top, shelf]) assert.ok(faces.some((f) => Math.abs(f - y) < 0.002), `a drawn slab tops out at ${y} (${faces.map((f) => f.toFixed(3)).join(', ')})`);
  // Open between the shelf and the tray, except the posts at the corners: a shelf item can fall out at the side.
  for (const c of bare.colliders) {
    if (c.min[1] >= top - 0.03 || c.max[1] <= shelf + 0.001) continue;
    assert.ok(c.max[0] - c.min[0] <= 0.06 && c.max[2] - c.min[2] <= 0.06, `only thin posts span the gap (${c.min.join(',')} .. ${c.max.join(',')})`);
  }
});
