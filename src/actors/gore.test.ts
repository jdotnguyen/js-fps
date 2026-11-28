import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// Glass marks (infection-kills spec "Glass marks follow contact"): the crack and the pulled streak, headless (a stub
// 2D canvas: textures draw nothing, geometry and placement are real).
const noop = (): void => undefined;
const ctx = new Proxy({} as Record<string | symbol, unknown>, {
  get: (t, k) => (k in t ? t[k] : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop: noop }) : noop),
  set: (t, k, v) => ((t[k] = v), true),
});
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ width: 1, height: 1, getContext: () => ctx, style: {} }) };

const { GoreSystem } = await import('./gore.ts');
const { Rng } = await import('../core/rng.ts');

const marksOf = (g: InstanceType<typeof GoreSystem>): THREE.Mesh[] => g.group.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh && (c as THREE.Mesh).renderOrder === 2);

test('a crack sits centred on its point, on the pane face, with its own crack decal and a random turn', () => {
  const gore = new GoreSystem(new Rng('crack'));
  const n = new THREE.Vector3(0, 0, 1);
  const at = new THREE.Vector3(0.3, 1.5, 45.78);
  gore.glassMark(at, n, 'crack', 0.6);
  gore.glassMark(at.clone().setX(-0.4), n, 'crack', 0.6);
  gore.glassMark(at.clone().setX(1.1), n, 'splat', 0.4);
  gore.update(1);
  const [a, b, splat] = marksOf(gore);
  assert.ok(a && b && splat);
  assert.ok(a.position.distanceTo(at) < 0.15, `centred within 0.15 m (${a.position.distanceTo(at).toFixed(3)})`);
  assert.ok(Math.abs(a.position.z - at.z - 0.004) < 1e-6, 'on the pane face, just proud of it');
  const alpha = (m: THREE.Mesh): unknown => (m.material as THREE.MeshStandardMaterial).alphaMap;
  assert.notEqual(alpha(a), alpha(splat), 'a crack decal, not the blood blob');
  assert.ok(Math.abs(a.scale.x - 0.6) < 1e-6 && Math.abs(a.scale.y - 0.6) < 1e-6, 'full size once grown');
  const turn = (m: THREE.Mesh): number => new THREE.Euler().setFromQuaternion(m.quaternion, 'ZYX').z;
  assert.notEqual(turn(a).toFixed(3), turn(b).toFixed(3), 'each crack is turned differently');
});

test('a streak pulled along the pane runs from its start the way it is pulled, and stays on the pane', () => {
  const gore = new GoreSystem(new Rng('pull'));
  const n = new THREE.Vector3(0, 0, 1);
  const start = new THREE.Vector3(0.2, 0.9, 45.78);
  gore.glassMark(start, n, 'streak', 0.9, { along: new THREE.Vector3(1, 0, 0.3), run: 1 });
  gore.update(2);
  const [m] = marksOf(gore);
  assert.ok(m);
  m.updateMatrixWorld(true);
  const top = new THREE.Vector3(0, 0, 0).applyMatrix4(m.matrixWorld);
  const end = new THREE.Vector3(0, -1, 0).applyMatrix4(m.matrixWorld);
  assert.ok(top.distanceTo(start) < 0.01, 'it starts at the hand');
  assert.ok(Math.abs(end.x - (start.x + 0.9)) < 0.02 && Math.abs(end.y - start.y) < 0.02, `it ends 0.9 m along +x (${end.x.toFixed(2)}, ${end.y.toFixed(2)})`);
  assert.ok(Math.abs(end.z - top.z) < 1e-6, 'flat on the pane (the pull into the glass is dropped)');
});

test('a plain streak still runs straight down', () => {
  const gore = new GoreSystem(new Rng('down'));
  const start = new THREE.Vector3(0, 1.2, 0);
  gore.glassMark(start, new THREE.Vector3(0, 0, 1), 'streak', 0.6, { run: 1 });
  gore.update(2);
  const [m] = marksOf(gore);
  m!.updateMatrixWorld(true);
  const end = new THREE.Vector3(0, -1, 0).applyMatrix4(m!.matrixWorld);
  assert.ok(end.y < start.y - 0.55 && Math.abs(end.x - start.x) < 0.05);
});

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

// infection-kills "Blood reads as liquid" (overhaul-priya-r08-death 10.1, 10.2): droplets, not square points, and drops
// that leave marks where they land.
const { MAX_DROP_MARKS, DROP_SIZE } = await import('./gore.ts');

test('blood is one instanced droplet mesh (one draw call) over the same buffer, with no square points', () => {
  const gore = new GoreSystem(new Rng('drops'));
  assert.equal(gore.group.children.filter((c) => (c as THREE.Points).isPoints).length, 0, 'no THREE.Points');
  const { mesh, capacity } = gore.droplets;
  assert.equal(capacity, 1400, 'the old particle budget');
  const geo = mesh.geometry as THREE.InstancedBufferGeometry;
  assert.ok(geo.isInstancedBufferGeometry, 'instanced');
  assert.equal(geo.instanceCount, 1400);
  assert.equal(gore.group.children.filter((c) => c.name === 'gore-droplets').length, 1, 'one mesh');
  gore.burst(new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(0, 0.5, 1), 80);
  const sizes = Array.from((geo.getAttribute('iSize') as THREE.InstancedBufferAttribute).array).filter((s) => s > 0);
  assert.equal(sizes.length, 80);
  assert.ok(sizes.every((s) => s >= DROP_SIZE.min - 1e-9 && s <= DROP_SIZE.max + 1e-9), 'sizes 4-18 mm');
  assert.ok(Math.max(...sizes) - Math.min(...sizes) > 0.005, 'a range of sizes');
  const mat = mesh.material as THREE.ShaderMaterial;
  assert.ok(mat.premultipliedAlpha && mat.transparent && !mat.depthWrite);
  assert.match(mat.fragmentShader, /discard/, 'a soft round drop, not a square');
});

test('reduced gore keeps the shape: dark drops, half as many', () => {
  const gore = new GoreSystem(new Rng('reduced'));
  gore.mode = 'reduced';
  gore.burst(new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(0, 0.5, 1), 80);
  const geo = gore.droplets.mesh.geometry as THREE.InstancedBufferGeometry;
  const live = Array.from((geo.getAttribute('iSize') as THREE.InstancedBufferAttribute).array).filter((s) => s > 0).length;
  assert.equal(live, 40);
  const col = (geo.getAttribute('iColor') as THREE.InstancedBufferAttribute).array;
  for (let i = 0; i < 40; i++) assert.ok(col[i * 3]! < 0.1, 'dark, not red');
});

test('Drops leave marks: on the floor where they land, and on the glass plane where they strike it, within a fixed budget', () => {
  const gore = new GoreSystem(new Rng('land'));
  gore.burst(new THREE.Vector3(0, 0.6, 0), new THREE.Vector3(0, -1, 0), 90);
  gore.update(1.5);
  const onFloor = gore.dropMarkTotal;
  assert.ok(onFloor > 10, `${onFloor} marks on the floor`);
  const marks = gore.group.getObjectByName('gore-drop-marks') as THREE.InstancedMesh;
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  for (let i = 0; i < onFloor; i++) {
    marks.getMatrixAt(i, m);
    p.setFromMatrixPosition(m);
    assert.ok(Math.abs(p.y - 0.008) < 1e-3, `floor mark at y ${p.y.toFixed(4)}`);
  }
  const live = Array.from((gore.droplets.mesh.geometry.getAttribute('iSize') as THREE.InstancedBufferAttribute).array).filter((s) => s > 0).length;
  assert.equal(live, 0, 'every drop that landed is gone');
  // Into a pane at z = 1 (blood kept on the z < 1 side).
  const glass = new GoreSystem(new Rng('pane'));
  glass.burst(new THREE.Vector3(0, 1.4, 0.4), new THREE.Vector3(0, 0.3, 3), 90, false, { axis: 'z', at: 1, keep: 'below' });
  glass.update(0.6);
  const gm = glass.group.getObjectByName('gore-drop-marks') as THREE.InstancedMesh;
  let onPane = 0;
  for (let i = 0; i < glass.dropMarkTotal; i++) {
    gm.getMatrixAt(i, m);
    p.setFromMatrixPosition(m);
    if (Math.abs(p.z - (1 - 0.003)) < 1e-4) onPane++;
  }
  assert.ok(onPane > 5, `${onPane} marks on the pane's face`);
  // Bounded: a long spray never grows past the budget.
  for (let i = 0; i < 30; i++) {
    gore.burst(new THREE.Vector3(0, 0.6, 0), new THREE.Vector3(0, -1, 0), 90);
    gore.update(1.5);
  }
  assert.equal(gore.dropMarkTotal, MAX_DROP_MARKS);
});

test('Clear view band: drops striking a pane leave no mark in its band, and none below the floor', () => {
  const band = { min: 1.1, max: 1.8 };
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  let onPane = 0;
  for (let k = 0; k < 6; k++) {
    const gore = new GoreSystem(new Rng(`band${k}`));
    // A spray across the whole pane face, from the floor to above head height.
    for (const y of [0.2, 0.9, 1.3, 1.6, 2.0]) gore.burst(new THREE.Vector3(0, y, 0.6), new THREE.Vector3(0, 0.2, 3), 60, false, { axis: 'z', at: 1, keep: 'below', band });
    gore.update(0.8);
    const gm = gore.group.getObjectByName('gore-drop-marks') as THREE.InstancedMesh;
    for (let i = 0; i < gore.dropMarkTotal; i++) {
      gm.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      if (Math.abs(p.z - (1 - 0.003)) > 1e-4) continue;
      onPane++;
      assert.ok(p.y >= 0, `a mark below the floor at y ${p.y.toFixed(3)}`);
      assert.ok(p.y <= band.min || p.y >= band.max, `a mark in the clear band at y ${p.y.toFixed(3)}`);
    }
  }
  assert.ok(onPane > 10, `${onPane} marks on the pane outside the band`);
});

test('a safety-glass crack has a second copy on the pane\'s far face, and is still centred on its point', () => {
  const gore = new GoreSystem(new Rng('crack2'));
  const n = new THREE.Vector3(0, 0, 1);
  const at = new THREE.Vector3(0.3, 1.5, 45.78);
  gore.glassMark(at, n, 'crack', 0.7);
  gore.update(1);
  const [crack] = marksOf(gore);
  const back = crack!.getObjectByName('gore-crack-back') as THREE.Mesh;
  assert.ok(back && back.visible, 'a far-face copy');
  crack!.updateMatrixWorld(true);
  const bp = back.getWorldPosition(new THREE.Vector3());
  assert.ok(bp.z < crack!.position.z - 0.005 && bp.z > crack!.position.z - 0.03, `behind the near face (${(crack!.position.z - bp.z).toFixed(3)} m)`);
  assert.ok(crack!.position.distanceTo(at) < 0.15);
  gore.glassMark(at, n, 'splat', 0.3);
  assert.equal(marksOf(gore).filter((m) => m.getObjectByName('gore-crack-back')?.visible).length, 1, 'only the crack has one');
});

test('the warm samples hold every material a mark or pool is drawn with, before any blood has flown', () => {
  const gore = new GoreSystem(new Rng('warm'));
  const warm = new Set((gore.warmSamples().children as THREE.Mesh[]).map((m) => m.material as THREE.MeshStandardMaterial));
  assert.equal(gore.group.children.some((c) => c.name === 'warm-gore-sample'), false, 'samples are not part of play');

  const n = new THREE.Vector3(0, 0, 1);
  let x = 0;
  for (const kind of ['print', 'splat', 'streak', 'crack', 'crack'] as const) gore.glassMark(new THREE.Vector3(x++, 1, 0), n, kind, 0.4);
  for (const kind of ['splat', 'streak'] as const) gore.glassMark(new THREE.Vector3(x++, 1, 0), n, kind, 0.4, { dark: true });
  gore.pool(new THREE.Vector3(0, 0, 2), 0.5, false);
  gore.pool(new THREE.Vector3(1, 0, 2), 0.5, true);
  gore.waterLevelAt = () => 0.5;
  gore.pool(new THREE.Vector3(2, 0, 2), 0.5, false);

  // A program is chosen by what a material has, not which object it is: compare those features (clones included).
  const features = (m: THREE.MeshStandardMaterial): string => [!!m.map, !!m.alphaMap, !!m.normalMap, m.transparent, m.side].join();
  const warmed = new Set([...warm].map(features));
  const drawn = gore.group.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh && !(c as THREE.InstancedMesh).isInstancedMesh && (c as THREE.Mesh).material instanceof THREE.MeshStandardMaterial);
  assert.ok(drawn.length >= 10, `marks and pools were made (${drawn.length})`);
  for (const mesh of drawn) assert.ok(warmed.has(features(mesh.material as THREE.MeshStandardMaterial)), `${mesh.name} ${features(mesh.material as THREE.MeshStandardMaterial)}`);
});

test('a drip falls nearly straight down from its anchor wherever it goes, leaving a trail of drops behind someone walking', () => {
  const gore = new GoreSystem(new Rng('drip'));
  // A head bone 1.2 m up, pitched forward and scaled like an imported rig's, walking 1 m/s along x for 3 s.
  const holder = new THREE.Group();
  const head = new THREE.Object3D();
  holder.add(head);
  head.position.set(0, 1.2, 0);
  head.rotation.set(-0.9, 0.4, 0);
  head.scale.setScalar(0.01);
  gore.drip(head, new THREE.Vector3(0, -5, 9), 3, 16);
  for (let t = 0; t < 4; t += 1 / 60) {
    head.position.x = Math.min(t, 3);
    head.updateMatrixWorld(true);
    gore.update(1 / 60);
  }
  const marks = gore.group.getObjectByName('gore-drop-marks') as THREE.InstancedMesh;
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const mouthZ = head.localToWorld(new THREE.Vector3(0, -5, 9)).z;
  const xs: number[] = [];
  for (let i = 0; i < gore.dropMarkTotal; i++) {
    marks.getMatrixAt(i, m);
    p.setFromMatrixPosition(m);
    xs.push(p.x);
    assert.ok(Math.abs(p.z - mouthZ) < 0.08, `a drop lands under her mouth's path (${(p.z - mouthZ).toFixed(3)} m off)`);
  }
  assert.ok(xs.length >= 10, `${xs.length} drops on the floor`);
  assert.ok(Math.min(...xs) < 0.5 && Math.max(...xs) > 2.4, `along the whole walk (${Math.min(...xs).toFixed(2)} to ${Math.max(...xs).toFixed(2)} m)`);
  const before = gore.dropMarkTotal;
  gore.update(1);
  assert.equal(gore.dropMarkTotal, before, 'and it stops when its time is up');
});
