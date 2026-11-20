import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// dive-bay spec (rebuild-dive-bay): the launch trunk and the dive bay props, built headlessly.
const noop = (): void => undefined;
const ctx = new Proxy({} as Record<string | symbol, unknown>, {
  get: (t, k) => (k in t ? t[k] : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop: noop }) : k === 'measureText' ? () => ({ width: 10 }) : noop),
  set: (t, k, v) => ((t[k] = v), true),
});
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ width: 1, height: 1, getContext: () => ctx, style: {} }) };

const { SLICE_PROPS, SLICE_STRUCTURE } = await import('./slice.ts');
const { DIVE_BAY_PROPS } = await import('./diveBay.ts');
const { Rng } = await import('../../core/rng.ts');
const { MOONPOOL_WIDTH } = await import('./types.ts');

const mats = new Proxy({} as Record<string | symbol, THREE.Material>, {
  get: (t, k) => (t[k] ??= new THREE.MeshStandardMaterial()),
});

function make(kit: string, params: Record<string, unknown> = {}) {
  const def = [...SLICE_PROPS, ...SLICE_STRUCTURE, ...DIVE_BAY_PROPS].find((d) => d.id === kit);
  assert.ok(def, `piece ${kit} is registered`);
  return def.generate({ area: 'dive_bay', ...params } as never, new Rng(7), mats as never);
}

function emit(out: ReturnType<typeof make>, event: string, payload: unknown): void {
  for (const l of out.listeners ?? []) if (l.event === event) l.fn(payload);
}

function run(out: ReturnType<typeof make>, seconds: number): void {
  for (let t = 0; t < seconds; t += 0.05) out.tick?.(t, 0.05);
}

const hatchOpen = (out: ReturnType<typeof make>): number => out.object.getObjectByName('trunk-hatch')!.userData['open'] as number;

test('the trunk has no water at deck level, only standing water at the foot of the shaft', () => {
  const out = make('floor_moonpool');
  out.object.updateMatrixWorld(true);
  const water = out.object.getObjectByName('trunk-water');
  assert.ok(water, 'standing water mesh');
  assert.ok(water.position.y < -2, `water at ${water.position.y}`);
  out.object.traverse((o) => {
    if (o instanceof THREE.Mesh && o.material instanceof THREE.ShaderMaterial && o.name !== 'trunk-water') {
      assert.ok(new THREE.Box3().setFromObject(o).max.y < -2 || !/water/i.test(o.material.name), 'no other water surface');
    }
  });
});

test('the trunk rail is closed on all four sides and nothing walkable covers the shaft', () => {
  const out = make('floor_moonpool');
  const h = MOONPOOL_WIDTH / 2;
  const blocks = (x: number, z: number): boolean => out.colliders.some((b) => b.max[1] >= 1 && x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2]);
  for (const [x, z] of [[0, -h - 0.25], [0, h + 0.25], [-h - 0.25, 0], [h + 0.25, 0], [h + 0.25, 0.5]] as const) assert.ok(blocks(x, z), `rail at ${x},${z}`);
  const overShaft = out.colliders.filter((b) => b.max[1] > -0.5 && b.min[0] < h - 0.01 && b.max[0] > -h + 0.01 && b.min[2] < h - 0.01 && b.max[2] > -h + 0.01);
  assert.equal(overShaft.length, 0, 'no collider inside the shaft opening (the hatch is not walkable)');
});

test('the inner hatch starts open, closes over about 4 s on trunk:state, snaps when instant, and resets open', () => {
  const out = make('floor_moonpool');
  assert.equal(hatchOpen(out), 1);
  emit(out, 'trunk:state', { state: 'closed' });
  run(out, 2);
  const mid = hatchOpen(out);
  assert.ok(mid > 0.2 && mid < 0.8, `half way after 2 s: ${mid}`);
  run(out, 2.5);
  assert.equal(hatchOpen(out), 0);
  emit(out, 'trunk:state', { state: 'open', instant: true });
  assert.equal(hatchOpen(out), 1, 'restore snaps open');
  emit(out, 'trunk:state', { state: 'closed', instant: true });
  assert.equal(hatchOpen(out), 0, 'restore snaps closed');
  emit(out, 'level:reset', undefined);
  assert.equal(hatchOpen(out), 1, 'level reset reopens');
  emit(out, 'trunk:state', { state: 'sideways' });
  run(out, 1);
  assert.equal(hatchOpen(out), 1, 'unknown states are ignored');
});

test('every dive bay prop builds, and the gantry hangs from the ceiling with no floor colliders', () => {
  for (const kit of ['gantry_crane', 'rov', 'tether_winch', 'wet_bench', 'core_rack', 'eyewash_station', 'shadow_board', 'whiteboard', 'pilot_console']) {
    const out = make(kit);
    let meshes = 0;
    out.object.traverse((o) => {
      if (o instanceof THREE.Mesh) meshes++;
    });
    assert.ok(meshes > 0, `${kit} has geometry`);
  }
  const gantry = make('gantry_crane', { ceiling: 5 });
  assert.equal(gantry.colliders.length, 0, 'no gantry colliders');
});

test('the pilot console shows the trunk state and goes to TRUNK SECURED after the hatch closes', () => {
  const out = make('pilot_console');
  const screens: THREE.Mesh[] = [];
  out.object.traverse((o) => {
    if (o instanceof THREE.Mesh && (o.material as THREE.MeshStandardMaterial).emissiveMap) screens.push(o);
  });
  assert.equal(screens.length, 1, 'three monitors share one screen mesh (one draw call)');
  const display = out.object.getObjectByName('pilot-screens')!;
  assert.equal(display.userData['trunk'], 'open');
  run(out, 0.1);
  emit(out, 'trunk:state', { state: 'closed' });
  assert.equal(display.userData['trunk'], 'closing');
  run(out, 4.5);
  assert.equal(display.userData['trunk'], 'closed', 'reads TRUNK SECURED');
  emit(out, 'level:reset', undefined);
  assert.equal(display.userData['trunk'], 'open');
  emit(out, 'trunk:state', { state: 'closed', instant: true });
  assert.equal(display.userData['trunk'], 'closed', 'a restore goes straight to secured');
});

test('a room sign (plate and life-support panel) is one canvas plane; pipe labels are one merged mesh', () => {
  const textured = (kit: string, params: Record<string, unknown> = {}): number => {
    let n = 0;
    make(kit, params).object.traverse((o) => {
      if (o instanceof THREE.Mesh && (o.material as THREE.MeshStandardMaterial).map) n++;
    });
    return n;
  };
  assert.equal(textured('room_sign', { code: 'R13B', name: 'LAUNCH TRUNK 1' }), 1);
  assert.equal(textured('room_sign', { code: 'R13D', panel: false }), 1);
  assert.equal(textured('pipe_labels', { length: 11, labels: 'A:#000|B:#111|C:#222' }), 1);
});

test('floor wear of one kind shares one material, so repeats merge into one draw call', () => {
  const mat = (kind: string): THREE.Material => (make('floor_wear', { kind }).object.children[0] as THREE.Mesh).material as THREE.Material;
  assert.equal(mat('puddle'), mat('puddle'));
  assert.notEqual(mat('puddle'), mat('salt'));
});

test('the trunk caustics and up-shaft fade out as the inner hatch closes', () => {
  const out = make('floor_moonpool', { height: 5 });
  const caustics = out.object.getObjectByName('trunk-caustics') as THREE.Mesh;
  const gain = (caustics.material as THREE.ShaderMaterial).uniforms['uGain']!;
  run(out, 0.1);
  assert.equal(gain.value, 1);
  assert.ok(caustics.position.y > 4.9, 'caustics sit under the 5 m ceiling');
  emit(out, 'trunk:state', { state: 'closed', instant: true });
  run(out, 0.1);
  assert.equal(gain.value, 0);
  assert.equal(caustics.visible, false);
  assert.equal(out.object.getObjectByName('trunk-upshaft')!.visible, false);
});

test('the gantry beacon rotates when on, and is a steady glow under reduced flashing', async () => {
  const { flashingState } = await import('../../render/flashing.ts');
  const out = make('gantry_crane', { ceiling: 5 });
  const beacon = out.object.getObjectByName('gantry-beacon')!;
  const steady = out.object.getObjectByName('gantry-beacon-steady')!;
  run(out, 0.1);
  assert.equal(beacon.visible || steady.visible, false, 'dark until switched on');
  emit(out, 'trunk:beacon', { on: true });
  out.tick?.(1, 0.05);
  const r1 = beacon.rotation.y;
  out.tick?.(1.5, 0.05);
  assert.ok(beacon.visible && beacon.rotation.y !== r1, 'rotating');
  flashingState.reduced = true;
  out.tick?.(2, 0.05);
  assert.equal(beacon.visible, false, 'no rotating beam with reduced flashing');
  assert.equal(steady.visible, true, 'steady glow instead');
  flashingState.reduced = false;
  emit(out, 'trunk:beacon', { on: false });
  out.tick?.(2.5, 0.05);
  assert.equal(beacon.visible || steady.visible, false);
});

test('the ROV drips: points fall from the frame to the deck', () => {
  const out = make('rov');
  const pts = out.object.getObjectByName('rov-drips') as THREE.Points;
  run(out, 1);
  const a = pts.geometry.getAttribute('position') as THREE.BufferAttribute;
  let falling = 0;
  for (let i = 0; i < a.count; i++) if (a.getY(i) >= 0 && a.getY(i) < 0.5) falling++;
  assert.ok(falling > 0, 'some drops in the air');
});
