/** Small generated sources for the import tests (no downloads needed). */
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Document } from '@gltf-transform/core';
import { gltfIO } from './readers.ts';

export function tempDir(prefix = 'props-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

type V3 = [number, number, number];

/** An axis-aligned box mesh from min to max, 12 triangles, with normals and UVs. */
export function addBox(doc: Document, name: string, min: V3, max: V3, material = doc.getRoot().listMaterials()[0]) {
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const faces: Array<[V3, V3, V3, V3]> = [];
  const [a, b, c] = min;
  const [d, e, f] = max;
  // +x, -x, +y, -y, +z, -z faces (counter-clockwise from outside)
  faces.push([[d, b, f], [d, b, c], [d, e, c], [d, e, f]]);
  faces.push([[a, b, c], [a, b, f], [a, e, f], [a, e, c]]);
  faces.push([[a, e, f], [d, e, f], [d, e, c], [a, e, c]]);
  faces.push([[a, b, c], [d, b, c], [d, b, f], [a, b, f]]);
  faces.push([[a, b, f], [d, b, f], [d, e, f], [a, e, f]]);
  faces.push([[d, b, c], [a, b, c], [a, e, c], [d, e, c]]);
  const normals: V3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  faces.forEach((q, i) => {
    const base = pos.length / 3;
    for (const p of q) pos.push(...p);
    for (let k = 0; k < 4; k++) nor.push(...normals[i]!);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  const acc = (arr: Float32Array | Uint32Array, type: 'SCALAR' | 'VEC2' | 'VEC3') => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', acc(new Float32Array(pos), 'VEC3'))
    .setAttribute('NORMAL', acc(new Float32Array(nor), 'VEC3'))
    .setAttribute('TEXCOORD_0', acc(new Float32Array(uv), 'VEC2'))
    .setIndices(acc(new Uint32Array(idx), 'SCALAR'));
  if (material) prim.setMaterial(material);
  return doc.createMesh(name).addPrimitive(prim);
}

/** A UV sphere with about 2*seg*seg triangles (for simplification tests). */
export function addSphere(doc: Document, name: string, radius: number, seg: number) {
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let y = 0; y <= seg; y++) {
    for (let x = 0; x <= seg; x++) {
      const u = x / seg;
      const v = y / seg;
      const th = u * Math.PI * 2;
      const ph = v * Math.PI;
      const n: V3 = [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)];
      nor.push(...n);
      pos.push(n[0] * radius, n[1] * radius + radius, n[2] * radius);
      uv.push(u, v);
    }
  }
  for (let y = 0; y < seg; y++) {
    for (let x = 0; x < seg; x++) {
      const i = y * (seg + 1) + x;
      idx.push(i, i + seg + 1, i + 1, i + 1, i + seg + 1, i + seg + 2);
    }
  }
  const acc = (arr: Float32Array | Uint32Array, type: 'SCALAR' | 'VEC2' | 'VEC3') => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', acc(new Float32Array(pos), 'VEC3'))
    .setAttribute('NORMAL', acc(new Float32Array(nor), 'VEC3'))
    .setAttribute('TEXCOORD_0', acc(new Float32Array(uv), 'VEC2'))
    .setIndices(acc(new Uint32Array(idx), 'SCALAR'));
  const m = doc.getRoot().listMaterials()[0];
  if (m) prim.setMaterial(m);
  return doc.createMesh(name).addPrimitive(prim);
}

/** Write a document as GLB into `dir` and return its path. */
export async function writeGlb(doc: Document, dir: string, file: string): Promise<string> {
  const path = join(dir, file);
  writeFileSync(path, await gltfIO().writeBinary(doc));
  return path;
}

/** Copy the CC0 water barrel FBX into a fresh temp dir; returns [dir, fbxPath]. */
export function fbxFixture(): [string, string] {
  const dir = tempDir('props-fbx-');
  const path = join(dir, 'Water_Barrel.fbx');
  copyFileSync(new URL('./fixtures/water_barrel.fbx', import.meta.url), path);
  return [dir, path];
}

/** A 1x1 PNG (enough for reader tests that only check which file was picked). */
export const PNG_1PX = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360f8cfc0f01f0005000201' + 'e5272ade0000000049454e44ae426082', 'hex');

export function writePng(dir: string, file: string): void {
  writeFileSync(join(dir, file), PNG_1PX);
}
