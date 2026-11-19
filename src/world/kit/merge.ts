import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Ambient occlusion in [0, 1] (1 = fully lit) at a world point with its normal. */
export type AoFn = (p: THREE.Vector3, n: THREE.Vector3) => number;

const vertexColorVariants = new WeakMap<THREE.Material, THREE.Material>();

/** Shared clone of a material that multiplies by vertex colours (the baked AO). */
function withVertexColors(material: THREE.Material): THREE.Material {
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
      if (bake) for (const g of list) this.bakeAo(g, ao);
      else for (const g of list) g.deleteAttribute('color');
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
