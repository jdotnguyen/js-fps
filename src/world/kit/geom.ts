import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/** Geometry helpers for procedural kit pieces (ADR-0003). */

const KEEP = new Set(['position', 'normal', 'uv']);

/** Transform matrix from position + Euler (radians, YXZ). */
export function at(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
    new THREE.Vector3(1, 1, 1),
  );
}

/** Box whose UVs are scaled to world metres (1 texture tile = `tile` m) on every face. */
export function boxUv(w: number, h: number, d: number, tile = 1): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv');
  // Face order: +x, -x, +y, -y, +z, -z; 4 vertices per face (1 segment).
  const dims: Array<[number, number]> = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = dims[f]!;
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, (uv.getX(i) * su) / tile, (uv.getY(i) * sv) / tile);
    }
  }
  return g;
}

/** Bevelled box; each face gets the full 0..1 texture (good for panels). */
export function rounded(w: number, h: number, d: number, radius = 0.02, segments = 2): THREE.BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, segments, Math.min(radius, w / 2, h / 2, d / 2));
}

/** Tube along a smooth curve through points; UV u runs along the length in `tile` m. */
export function pipe(points: THREE.Vector3[], radius: number, tile = 1, radial = 12): THREE.TubeGeometry {
  const curve = new THREE.CatmullRomCurve3(points);
  const length = curve.getLength();
  const g = new THREE.TubeGeometry(curve, Math.max(4, Math.ceil(length * 6)), radius, radial, false);
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setX(i, (uv.getX(i) * length) / tile);
  return g;
}

/** Straight cylinder from a to b. */
export function cylinderBetween(a: THREE.Vector3, b: THREE.Vector3, radius: number, radial = 10): THREE.BufferGeometry {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(radius, radius, len, radial, 1, false);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(a.clone().lerp(b, 0.5), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

/**
 * Collects static geometry by material and merges it, so a detailed room costs one
 * draw call per material instead of one per part.
 */
export class MergeBuilder {
  private readonly parts = new Map<THREE.Material, THREE.BufferGeometry[]>();

  add(geometry: THREE.BufferGeometry, material: THREE.Material, matrix?: THREE.Matrix4): void {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    geometry.dispose();
    for (const name of Object.keys(g.attributes)) if (!KEEP.has(name)) g.deleteAttribute(name);
    g.clearGroups();
    if (matrix) g.applyMatrix4(matrix);
    let list = this.parts.get(material);
    if (!list) {
      list = [];
      this.parts.set(material, list);
    }
    list.push(g);
  }

  build(name: string): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    for (const [material, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      const meshes = merged ? [merged] : list; // fall back to separate meshes if attributes differ
      for (const g of meshes) {
        const mesh = new THREE.Mesh(g, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.name = `${name}:${material.name || material.type}`;
        group.add(mesh);
      }
      if (merged) for (const g of list) g.dispose();
    }
    this.parts.clear();
    return group;
  }
}
