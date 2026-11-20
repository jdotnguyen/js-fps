import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { AoMergeBuilder, applyWorldMeterUvs, isFlatColor, isFlatGlow, takesWorldUvs, worldTileMeters } from './merge.ts';

/** World-space box as non-indexed triangles, the shape AoMergeBuilder hands to applyWorldMeterUvs. */
function worldBox(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y, z);
  return g;
}

/** UV at the vertex closest to `p` among triangles facing `n`. */
function uvAt(g: THREE.BufferGeometry, p: THREE.Vector3, n: THREE.Vector3): [number, number] {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const uv = g.getAttribute('uv');
  let best = -1;
  let bestD = Infinity;
  const v = new THREE.Vector3();
  const vn = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    if (vn.fromBufferAttribute(nor, i).dot(n) < 0.99) continue;
    const dd = v.fromBufferAttribute(pos, i).distanceToSquared(p);
    if (dd < bestD) {
      bestD = dd;
      best = i;
    }
  }
  return [uv.getX(best), uv.getY(best)];
}

test('wall texture continues across two adjacent 4 m wall tiles', () => {
  const a = worldBox(4, 3.2, 0.25, 0, 1.6, 0);
  const b = worldBox(4, 3.2, 0.25, 4, 1.6, 0);
  applyWorldMeterUvs(a);
  applyWorldMeterUvs(b);
  const seam = new THREE.Vector3(2, 0, 0.125);
  const fz = new THREE.Vector3(0, 0, 1);
  assert.deepEqual(uvAt(a, seam, fz), uvAt(b, seam, fz));
});

test('U runs left-to-right from the viewer on every wall facing (no mirroring)', () => {
  const g = worldBox(2, 2, 2, 0, 1, 0);
  applyWorldMeterUvs(g);
  const cases: Array<[THREE.Vector3, THREE.Vector3]> = [
    // [outward normal, viewer's right when facing that wall]
    [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1)],
    [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1)],
    [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)],
    [new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0)],
  ];
  for (const [n, right] of cases) {
    const c = n.clone().add(new THREE.Vector3(0, 1, 0));
    const left = uvAt(g, c.clone().addScaledVector(right, -1), n)[0];
    const rightU = uvAt(g, c.clone().addScaledVector(right, 1), n)[0];
    assert.ok(rightU > left, `face ${n.toArray()} should increase U to the viewer's right`);
  }
});

test('bevelled box: every triangle uses one projection, so UV edge lengths match world lengths', () => {
  const g = new RoundedBoxGeometry(4, 0.24, 0.26, 2, 0.03).toNonIndexed();
  applyWorldMeterUvs(g);
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  const p = [new THREE.Vector3(), new THREE.Vector3()];
  for (let i = 0; i < pos.count; i += 3) {
    for (let k = 0; k < 3; k++) {
      const i0 = i + k;
      const i1 = i + ((k + 1) % 3);
      p[0]!.fromBufferAttribute(pos, i0);
      p[1]!.fromBufferAttribute(pos, i1);
      const du = Math.hypot(uv.getX(i0) - uv.getX(i1), uv.getY(i0) - uv.getY(i1));
      // A planar projection can shorten an edge but never stretch it beyond its world length.
      assert.ok(du <= p[0]!.distanceTo(p[1]!) + 1e-6, `triangle ${i / 3} stretched`);
    }
  }
});

test('only repeating textures take world UVs', () => {
  const tiled = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
  tiled.map!.wrapS = THREE.RepeatWrapping;
  const canvas = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
  const glass = new THREE.MeshStandardMaterial({ transparent: true });
  const plain = new THREE.MeshStandardMaterial();
  assert.equal(takesWorldUvs(tiled), true);
  assert.equal(takesWorldUvs(plain), true);
  assert.equal(takesWorldUvs(canvas), false);
  assert.equal(takesWorldUvs(glass), false);
});

test('procedural stripes and grating keep their 0.5 m tile under world UVs', () => {
  for (const name of ['hazardClean', 'grating']) {
    const m = new THREE.MeshStandardMaterial();
    m.name = name;
    assert.equal(worldTileMeters(m), 0.5);
  }
  const photo = new THREE.MeshStandardMaterial();
  photo.name = 'paintBone';
  assert.equal(worldTileMeters(photo), 1);
});

test('flat colours share a roughness bucket draw call and carry their albedo (times AO) in vertex colours', () => {
  const flat = (color: number, roughness: number, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, ...extra });
    m.userData['flat'] = true;
    return m;
  };
  const red = flat(0xff0000, 0.62);
  const green = flat(0x00ff00, 0.6);
  const leaf = flat(0x00ff00, 0.65, { side: THREE.DoubleSide });
  const rough = flat(0x0000ff, 0.97);
  const textured = flat(0xffffff, 0.6);
  textured.map = new THREE.Texture();
  const optedOut = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
  assert.ok(isFlatColor(red) && !isFlatColor(textured) && !isFlatColor(optedOut));
  assert.ok(!isFlatColor(flat(0xffffff, 0.5, { transparent: true, opacity: 0.5 })), 'transparent stays its own material');
  assert.ok(!isFlatColor(flat(0x000000, 0.5, { emissive: 0xffffff, emissiveIntensity: 1 })), 'glows stay their own material');

  const mb = new AoMergeBuilder();
  for (const [i, m] of [red, green, leaf, rough, textured, optedOut].entries()) mb.add(new THREE.BoxGeometry(1, 1, 1), m, new THREE.Matrix4().makeTranslation(i * 2, 0.5, 0));
  const group = mb.build('t', () => 0.5);
  const meshes = group.children as THREE.Mesh[];
  // red + green (0.62 / 0.6 -> 0.65), leaf (0.65, double-sided), rough (0.95), textured, optedOut.
  assert.equal(meshes.length, 5);
  const bucket = meshes.find((m) => (m.material as THREE.Material).name === `flat:r0.65:m0:s${THREE.FrontSide}`)!;
  assert.ok(bucket, 'shared 0.65 bucket');
  const bm = bucket.material as THREE.MeshStandardMaterial;
  assert.ok(bm.vertexColors && bm.color.getHex() === 0xffffff && bm.roughness === 0.65);
  const col = bucket.geometry.getAttribute('color');
  const pos = bucket.geometry.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const expect = pos.getX(i) < 1 ? [0.5, 0, 0] : [0, 0.5, 0];
    assert.deepEqual([col.getX(i), col.getY(i), col.getZ(i)].map((v) => Math.round(v * 1000) / 1000), expect, `vertex ${i}`);
  }
  // Without an AO function the colour is the plain albedo.
  const mb2 = new AoMergeBuilder();
  mb2.add(new THREE.BoxGeometry(1, 1, 1), red);
  const c2 = (mb2.build('t2', null).children[0] as THREE.Mesh).geometry.getAttribute('color');
  assert.equal(c2.getX(0), 1);
  assert.equal(c2.getY(0), 0);
});

test('static glows share one emissive draw call; their colour x intensity rides in the vertex colour', () => {
  const glow = (color: number, intensity: number): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity });
    m.userData['glow'] = true;
    return m;
  };
  const amber = glow(0xff0000, 2);
  const cyan = glow(0x00ffff, 0.5);
  const animated = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveIntensity: 1 });
  assert.ok(isFlatGlow(amber) && !isFlatGlow(animated) && !isFlatColor(amber));
  const mb = new AoMergeBuilder();
  mb.add(new THREE.BoxGeometry(0.1, 0.1, 0.1), amber, new THREE.Matrix4().makeTranslation(0, 0, 0));
  mb.add(new THREE.BoxGeometry(0.1, 0.1, 0.1), cyan, new THREE.Matrix4().makeTranslation(5, 0, 0));
  mb.add(new THREE.BoxGeometry(0.1, 0.1, 0.1), animated, new THREE.Matrix4().makeTranslation(9, 0, 0));
  const meshes = mb.build('g', () => 0.25).children as THREE.Mesh[];
  assert.equal(meshes.length, 2, 'two static glows -> one call, the animated one keeps its own');
  const merged = meshes.find((m) => (m.material as THREE.Material).name === 'flat:glow')!;
  const col = merged.geometry.getAttribute('color');
  const pos = merged.geometry.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const expect = pos.getX(i) < 1 ? [2, 0, 0] : [0, 0.5, 0.5];
    assert.deepEqual([col.getX(i), col.getY(i), col.getZ(i)], expect, 'no AO darkening on emitters');
  }
});
