import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Ambient occlusion in [0, 1] (1 = fully lit) at a world point with its normal. */
export type AoFn = (p: THREE.Vector3, n: THREE.Vector3) => number;

const vertexColorVariants = new WeakMap<THREE.Material, THREE.Material>();

/** Shared clone of a material that multiplies by vertex colours (the baked AO). */
export function withVertexColors(material: THREE.Material): THREE.Material {
  let v = vertexColorVariants.get(material);
  if (!v) {
    v = material.clone();
    v.vertexColors = true;
    v.name = `${material.name || material.type}+ao`;
    vertexColorVariants.set(material, v);
  }
  return v;
}

function takesAo(material: THREE.Material): boolean {
  return material instanceof THREE.MeshStandardMaterial && !material.transparent;
}

/**
 * Box-project world-space UVs so 1 UV unit = `tileMeters` metres and a texture runs
 * continuously across neighbouring kit pieces (no restart at every tile or trim edge).
 *
 * - Projection axis is chosen once per triangle from its face normal, so bevelled
 *   `rounded()` edges never mix two projections inside one triangle (no smearing).
 * - U is signed by facing so the texture reads left-to-right from in front of every
 *   face: opposite walls are not mirrored, floors read the right way up from above.
 * - Indexed geometry (shared vertices) falls back to per-vertex normals.
 */
export function applyWorldMeterUvs(g: THREE.BufferGeometry, tileMeters = 1): void {
  const pos = g.getAttribute('position');
  if (!pos) return;
  const nor = g.getAttribute('normal');
  let uv = g.getAttribute('uv');
  if (!uv || uv.count !== pos.count) {
    uv = new THREE.Float32BufferAttribute(new Float32Array(pos.count * 2), 2);
    g.setAttribute('uv', uv);
  }
  const inv = 1 / tileMeters;
  const project = (i: number, nx: number, ny: number, nz: number): void => {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const az = Math.abs(nz);
    if (ay >= ax && ay >= az) uv.setXY(i, x * inv, (ny >= 0 ? -z : z) * inv);
    else if (ax >= az) uv.setXY(i, (nx >= 0 ? -z : z) * inv, y * inv);
    else uv.setXY(i, (nz >= 0 ? x : -x) * inv, y * inv);
  };
  if (g.index || pos.count % 3 !== 0) {
    if (!nor) return;
    for (let i = 0; i < pos.count; i++) project(i, nor.getX(i), nor.getY(i), nor.getZ(i));
  } else {
    for (let i = 0; i < pos.count; i += 3) {
      _a.fromBufferAttribute(pos, i);
      _b.fromBufferAttribute(pos, i + 1).sub(_a);
      _c.fromBufferAttribute(pos, i + 2).sub(_a);
      _b.cross(_c);
      if (_b.lengthSq() < 1e-14) {
        if (nor) _b.fromBufferAttribute(nor, i);
        else _b.set(0, 1, 0);
      }
      for (let k = 0; k < 3; k++) project(i + k, _b.x, _b.y, _b.z);
    }
  }
  uv.needsUpdate = true;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

/**
 * World-UV scale (metres per UV unit) for the procedural materials that were authored at a
 * finer tile than 1 m. Photo slots stay at 1: their loader applies `1 / metersPerTile`.
 */
const WORLD_TILE_METERS: Record<string, number> = { hazardClean: 0.5, grating: 0.5 };

export function worldTileMeters(material: THREE.Material): number {
  return WORLD_TILE_METERS[material.name] ?? 1;
}

/** True when a material's textures repeat (photo/procedural tiling sets), so world UVs suit it. */
export function takesWorldUvs(material: THREE.Material): boolean {
  if (material.transparent || material.name.startsWith('signDanger')) return false;
  const map = (material as THREE.MeshStandardMaterial).map;
  return !map || map.wrapS === THREE.RepeatWrapping;
}

/**
 * Merges static kit geometry per material for one room (ADR-0003), baking per-vertex
 * ambient occlusion into a colour attribute so corners and contact points darken
 * without extra draw calls.
 */
export class AoMergeBuilder {
  private readonly parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private readonly p = new THREE.Vector3();
  private readonly n = new THREE.Vector3();

  get materialCount(): number {
    return this.parts.size;
  }

  /** Add geometry in world space (the geometry is consumed). */
  add(geometry: THREE.BufferGeometry, material: THREE.Material, matrix?: THREE.Matrix4): void {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    geometry.dispose();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    g.morphAttributes = {};
    g.clearGroups();
    if (matrix) g.applyMatrix4(matrix);
    let list = this.parts.get(material);
    if (!list) {
      list = [];
      this.parts.set(material, list);
    }
    list.push(g);
  }

  /** Add a mesh using its world matrix. */
  addMesh(mesh: THREE.Mesh): void {
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (!material) return;
    mesh.updateWorldMatrix(true, false);
    this.add(mesh.geometry, material, mesh.matrixWorld);
  }

  build(name: string, ao: AoFn | null): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    for (const [material, list] of this.parts) {
      const bake = ao !== null && takesAo(material);
      const worldTile = takesWorldUvs(material);
      for (const g of list) {
        if (worldTile) applyWorldMeterUvs(g, worldTileMeters(material));
        if (bake) this.bakeAo(g, ao);
        else g.deleteAttribute('color');
      }
      const merged = mergeGeometries(list, false);
      let indexed: THREE.BufferGeometry | null = null;
      if (merged) {
        indexed = mergeVertices(merged);
        merged.dispose();
      }
      const meshes = indexed ? [indexed] : list;
      for (const g of meshes) {
        const mesh = new THREE.Mesh(g, bake ? withVertexColors(material) : material);
        mesh.castShadow = !material.transparent;
        mesh.receiveShadow = true;
        mesh.name = `${name}:${material.name || material.type}`;
        group.add(mesh);
      }
      if (indexed) for (const g of list) g.dispose();
    }
    this.parts.clear();
    return group;
  }

  private bakeAo(g: THREE.BufferGeometry, ao: AoFn): void {
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      this.p.fromBufferAttribute(pos, i);
      this.n.fromBufferAttribute(nor, i);
      const v = ao(this.p, this.n);
      colors[i * 3] = v;
      colors[i * 3 + 1] = v;
      colors[i * 3 + 2] = v;
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  }
}
