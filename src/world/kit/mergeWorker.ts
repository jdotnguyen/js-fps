import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { applyWorldUvs } from '../../render/uvTiling.ts';
import { CollisionWorld } from '../collision.ts';
import { colliderAo } from './colliderAo.ts';
import { bakeAoIntoBuffer, type AoFn } from './merge.ts';

export interface MergeWorkerPartIn {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  tint?: [number, number, number];
}

export interface MergeWorkerBucketIn {
  bake: boolean;
  flat: boolean;
  worldTile: boolean;
  worldTileMeters: number;
  parts: MergeWorkerPartIn[];
}

export interface MergeWorkerMeshOut {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  color: Float32Array | null;
  index: Uint16Array | Uint32Array | null;
}

export interface MergeWorkerBucketOut {
  meshes: MergeWorkerMeshOut[];
}

export type MergeWorkerRequest =
  | { type: 'init'; cellSize: number; boxes: Float32Array }
  | { type: 'merge'; id: number; buckets: MergeWorkerBucketIn[] };

export type MergeWorkerReply =
  | { type: 'merged'; id: number; buckets: MergeWorkerBucketOut[] }
  | { type: 'error'; id: number; error: string };

let ao: AoFn | null = null;
const p = new THREE.Vector3();
const n = new THREE.Vector3();
const tmpTint = new THREE.Color();

function extractMesh(g: THREE.BufferGeometry): { mesh: MergeWorkerMeshOut; transfers: ArrayBuffer[] } {
  const transfers: ArrayBuffer[] = [];
  const pos = g.getAttribute('position').array as Float32Array;
  const nor = g.getAttribute('normal').array as Float32Array;
  const uv = g.getAttribute('uv').array as Float32Array;
  const colAttr = g.getAttribute('color');
  const color = colAttr ? (colAttr.array as Float32Array) : null;
  const index = g.index ? (g.index.array as Uint16Array | Uint32Array) : null;
  transfers.push(pos.buffer as ArrayBuffer, nor.buffer as ArrayBuffer, uv.buffer as ArrayBuffer);
  if (color) transfers.push(color.buffer as ArrayBuffer);
  if (index) transfers.push(index.buffer as ArrayBuffer);
  return { mesh: { position: pos, normal: nor, uv, color, index }, transfers };
}

self.onmessage = (e: MessageEvent<MergeWorkerRequest>): void => {
  const msg = e.data;
  if (msg.type === 'init') {
    const world = new CollisionWorld(msg.cellSize);
    const b = msg.boxes;
    for (let i = 0; i < b.length; i += 6) {
      world.add({ min: [b[i]!, b[i + 1]!, b[i + 2]!], max: [b[i + 3]!, b[i + 4]!, b[i + 5]!] });
    }
    ao = colliderAo(world);
    return;
  }

  try {
    const bucketsOut: MergeWorkerBucketOut[] = [];
    const transfers: ArrayBuffer[] = [];
    for (const bucket of msg.buckets) {
      const list: THREE.BufferGeometry[] = [];
      for (const part of bucket.parts) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(part.position, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(part.normal, 3));
        g.setAttribute('uv', new THREE.BufferAttribute(part.uv, 2));
        if (bucket.worldTile) applyWorldUvs(g, bucket.worldTileMeters);
        if (bucket.bake || bucket.flat) {
          const tint = part.tint ? tmpTint.setRGB(part.tint[0], part.tint[1], part.tint[2]) : undefined;
          bakeAoIntoBuffer(g, bucket.bake ? ao : null, p, n, tint);
        }
        list.push(g);
      }
      const merged = mergeGeometries(list, false);
      let indexed: THREE.BufferGeometry | null = null;
      if (merged) {
        indexed = mergeVertices(merged);
        merged.dispose();
      }
      const finalGeoms = indexed ? [indexed] : list;
      const meshes: MergeWorkerMeshOut[] = [];
      for (const g of finalGeoms) {
        const extracted = extractMesh(g);
        meshes.push(extracted.mesh);
        transfers.push(...extracted.transfers);
        g.dispose();
      }
      if (indexed) for (const g of list) g.dispose();
      bucketsOut.push({ meshes });
    }
    self.postMessage({ type: 'merged', id: msg.id, buckets: bucketsOut } satisfies MergeWorkerReply, { transfer: transfers });
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, error: err instanceof Error ? err.message : String(err) } satisfies MergeWorkerReply);
  }
};
