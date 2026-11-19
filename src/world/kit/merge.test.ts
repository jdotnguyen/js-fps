import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { applyWorldMeterUvs, takesWorldUvs, worldTileMeters } from './merge.ts';

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
