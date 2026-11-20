import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyWorldUvs, metersPerRepeat, tileMaterial, tileRepeat, tileTexture } from './uvTiling.ts';
import { cornerBoxes } from '../world/cornerLayout.ts';

const near = (a: number, b: number, eps = 1e-5): boolean => Math.abs(a - b) < eps;
const sameUv = (a: [number, number], b: [number, number], msg?: string): void =>
  assert.ok(near(a[0], b[0]) && near(a[1], b[1]), `${msg ?? 'uv'}: ${a} vs ${b}`);

test('tileRepeat is width / tile by height / tile', () => {
  assert.deepEqual(tileRepeat(6, 3.2, 2), [3, 1.6]);
  assert.throws(() => tileRepeat(1, 1, 0));
});

test('tileTexture clones with RepeatWrapping, sets repeat, and shares the image', () => {
  const base = new THREE.Texture();
  const t = tileTexture(base, 5.3, 3.2, 1);
  assert.notEqual(t, base);
  assert.equal(t.source, base.source);
  assert.equal(t.wrapS, THREE.RepeatWrapping);
  assert.equal(t.wrapT, THREE.RepeatWrapping);
  assert.ok(near(t.repeat.x, 5.3) && near(t.repeat.y, 3.2));
  assert.equal(base.repeat.x, 1, 'base texture untouched');
});

test('tileMaterial keeps the photo-slot size and keeps the shared ORM map shared', () => {
  const map = new THREE.Texture();
  map.repeat.set(1 / 3, 1 / 3); // photo slot with metersPerTile = 3
  const orm = new THREE.Texture();
  const base = new THREE.MeshStandardMaterial({ map, roughnessMap: orm, metalnessMap: orm, aoMap: orm });
  assert.ok(near(metersPerRepeat(base), 3));
  const m = tileMaterial(base, 6, 3);
  assert.ok(near(m.map!.repeat.x, 2) && near(m.map!.repeat.y, 1));
  assert.equal(m.roughnessMap, m.aoMap);
  assert.equal(m.metalnessMap, m.aoMap);
  assert.notEqual(m.aoMap, orm);
});

/** World-UV geometry for one corner-room box, as AoMergeBuilder would produce it. */
function worldBox(name: string): THREE.BufferGeometry {
  const b = cornerBoxes().find((x) => x.name === name)!;
  const g = new THREE.BoxGeometry(...b.size).toNonIndexed();
  g.translate(...b.center);
  applyWorldUvs(g);
  return g;
}

/** UV of the vertex nearest `p` on faces whose normal matches `n`. */
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
    const d = v.fromBufferAttribute(pos, i).distanceToSquared(p);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  assert.ok(best >= 0 && bestD < 1e-6, `no vertex at ${p.toArray()} facing ${n.toArray()}`);
  return [uv.getX(best), uv.getY(best)];
}

const PZ = new THREE.Vector3(0, 0, 1);
const PX = new THREE.Vector3(1, 0, 0);
const NX = new THREE.Vector3(-1, 0, 0);
const NZ = new THREE.Vector3(0, 0, -1);

test('L-corner: uneven wall cuts meet with no seam (2.7 m + 3.1 m pieces)', () => {
  const a = worldBox('south.0');
  const b = worldBox('south.1');
  const seam = new THREE.Vector3(2.7, 0, 0);
  sameUv(uvAt(a, seam, PZ), uvAt(b, seam, PZ));
});

test('L-corner: 1 UV unit = 1 m along every wall and up every wall', () => {
  const g = worldBox('south.1'); // x 2.7..5.8, face z = 0
  const [u0, v0] = uvAt(g, new THREE.Vector3(2.7, 0, 0), PZ);
  const [u1, v1] = uvAt(g, new THREE.Vector3(5.8, 3.2, 0), PZ);
  assert.ok(near(u1 - u0, 3.1));
  assert.ok(near(v1 - v0, 3.2));
});

test('L-corner: inside corner (0,0) lines up on both walls at the same height', () => {
  const south = worldBox('south.0');
  const west = worldBox('west.0');
  for (const y of [0, 3.2]) {
    const p = new THREE.Vector3(0, y, 0);
    sameUv(uvAt(south, p, PZ), uvAt(west, p, PX), `y=${y}`);
  }
});

test('L-corner: outside corner (4,4) keeps the same scale and height on both walls', () => {
  const northA = worldBox('northA.0'); // faces -Z, x 4..5.9
  const eastB = worldBox('eastB.0'); // faces -X, z 4..7.3
  const p = new THREE.Vector3(4, 3.2, 4);
  const [uA, vA] = uvAt(northA, p, NZ);
  const [uB, vB] = uvAt(eastB, p, NX);
  assert.ok(near(vA, vB), 'rows line up across the corner');
  // Both U values are whole metres here, so a 1, 2 or 4 m texture lines up exactly too.
  assert.ok(near(uA, Math.round(uA)) && near(uB, Math.round(uB)));
});

test('floor pieces of both arms continue across the arm seam at z = 4', () => {
  const fa = worldBox('floorA'); // top corners at x 0 and 8, z 0 and 4
  const fb = worldBox('floorB'); // top corners at x 0 and 4, z 4 and 10
  const up = new THREE.Vector3(0, 1, 0);
  const shared = new THREE.Vector3(0, 0, 4);
  sameUv(uvAt(fa, shared, up), uvAt(fb, shared, up));
  // Same metre scale on both sides of the seam: 4 m along x on each slab = 4 UV units.
  const duA = uvAt(fa, new THREE.Vector3(8, 0, 4), up)[0] - uvAt(fa, shared, up)[0];
  const duB = uvAt(fb, new THREE.Vector3(4, 0, 4), up)[0] - uvAt(fb, shared, up)[0];
  assert.ok(near(duA, 8) && near(duB, 4));
});
