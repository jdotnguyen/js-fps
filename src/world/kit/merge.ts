import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { applyWorldUvs } from '../../render/uvTiling.ts';
import { runSteps, runStepsSliced, type TimeSlicer } from '../../core/timeSlice.ts';

/** Ambient occlusion in [0, 1] (1 = fully lit) at a world point with its normal. */
export type AoFn = (p: THREE.Vector3, n: THREE.Vector3) => number;

const vertexColorVariants = new Map<THREE.Material, THREE.Material>();

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

/** Dispose and clear module-level merged material caches (session teardown). */
export function disposeMergeCaches(): void {
  for (const v of vertexColorVariants.values()) v.dispose();
  vertexColorVariants.clear();
  for (const b of flatBuckets.values()) b.dispose();
  flatBuckets.clear();
  glowBucket = null;
}

function takesAo(material: THREE.Material): boolean {
  return material instanceof THREE.MeshStandardMaterial && !material.transparent;
}

/**
 * Flat-colour merging: untextured, opaque, non-emissive materials that opt in with
 * `userData.flat = true` (the kit's `plain()` colours: wood, fabric, ceramics, leaves...) do not
 * get a draw call each. Their albedo moves into the vertex colour (times the baked AO) and they
 * share one white material per roughness / metalness / side bucket, so a dressed room pays for
 * a handful of buckets instead of one call per paint colour.
 */
const FLAT_ROUGHNESS = [0.2, 0.35, 0.5, 0.65, 0.8, 0.95] as const;
const FLAT_METALNESS = [0, 0.5] as const;
const flatBuckets = new Map<string, THREE.MeshStandardMaterial>();
const BLACK = new THREE.Color(0, 0, 0);

const nearest = (v: number, steps: readonly number[]): number => steps.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));

/** True when `material` opted into flat-colour merging and has nothing a vertex colour can't carry. */
export function isFlatColor(material: THREE.Material): material is THREE.MeshStandardMaterial {
  if (!(material instanceof THREE.MeshStandardMaterial) || material instanceof THREE.MeshPhysicalMaterial) return false;
  if (material.userData['flat'] !== true || material.transparent || material.opacity < 1 || material.vertexColors) return false;
  if (material.map || material.normalMap || material.roughnessMap || material.metalnessMap || material.aoMap || material.emissiveMap || material.alphaMap || material.bumpMap) return false;
  return material.emissiveIntensity === 0 || material.emissive.equals(BLACK);
}

/**
 * Static glows (`userData.glow = true`: non-animated emissive strips, LEDs, bulbs) merge the same
 * way: their emissive colour times intensity goes into the vertex colour and one shared material
 * emits `vColor`. Animated or flickering glows never opt in (they keep their own material).
 */
export function isFlatGlow(material: THREE.Material): material is THREE.MeshStandardMaterial {
  if (!(material instanceof THREE.MeshStandardMaterial) || material instanceof THREE.MeshPhysicalMaterial) return false;
  if (material.userData['glow'] !== true || material.transparent || material.opacity < 1 || material.vertexColors) return false;
  return !material.map && !material.emissiveMap && !material.alphaMap;
}

let glowBucket: THREE.MeshStandardMaterial | null = null;
/** The one material every static glow merges into: black albedo, emissive = vertex colour. */
export function flatGlowBucket(): THREE.MeshStandardMaterial {
  if (!glowBucket) {
    const b = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveIntensity: 1, roughness: 0.4, vertexColors: true });
    b.name = 'flat:glow';
    b.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vColor.rgb;');
    };
    b.customProgramCacheKey = () => 'flat-glow';
    flatBuckets.set(b.name, b);
    glowBucket = b;
  }
  return glowBucket;
}

/** Linear emissive radiance (colour x intensity) a static glow carries into its vertex colour. */
function glowTint(material: THREE.MeshStandardMaterial): THREE.Color {
  return material.emissive.clone().multiplyScalar(material.emissiveIntensity);
}

/** The shared vertex-coloured material a flat colour merges into. */
export function flatBucket(material: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const r = nearest(material.roughness, FLAT_ROUGHNESS);
  const mt = nearest(material.metalness, FLAT_METALNESS);
  const side = material.side;
  const key = `flat:r${r}:m${mt}:s${side}`;
  let b = flatBuckets.get(key);
  if (!b) {
    b = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: r, metalness: mt, side, vertexColors: true });
    b.name = key;
    flatBuckets.set(key, b);
  }
  return b;
}

/** World-space metre UVs; implementation lives in render/uvTiling.ts (kept here under its old name). */
export const applyWorldMeterUvs = applyWorldUvs;

/**
 * World-UV scale (metres per UV unit) for the procedural materials that were authored at a
 * finer tile than 1 m. Photo slots stay at 1: their loader applies `1 / metersPerTile`.
 */
const WORLD_TILE_METERS: Record<string, number> = { hazardClean: 0.5 };

export function worldTileMeters(material: THREE.Material): number {
  if (material.name === 'grating' && (material as THREE.MeshStandardMaterial).map instanceof THREE.DataTexture) return 0.5;
  return WORLD_TILE_METERS[material.name] ?? 1;
}

/**
 * True when a material's textures repeat (photo/procedural tiling sets), so world UVs suit it. Imported props
 * (`userData.keepUvs`, set by the kit registry) keep the UVs they were authored with, even though glTF samplers
 * repeat by default.
 */
export function takesWorldUvs(material: THREE.Material): boolean {
  if (material.transparent || material.name.startsWith('signDanger') || material.userData['keepUvs'] === true) return false;
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
  /** Albedo (linear) of each geometry that merged into a flat bucket. */
  private readonly tints = new WeakMap<THREE.BufferGeometry, THREE.Color>();
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
    // Drop morph targets (three r175 types morphAttributes with fixed keys, so clear them rather than assign {}).
    for (const key of Object.keys(g.morphAttributes) as Array<keyof THREE.BufferGeometry['morphAttributes']>) delete g.morphAttributes[key];
    g.clearGroups();
    if (matrix) g.applyMatrix4(matrix);
    if (isFlatColor(material)) {
      this.tints.set(g, material.color);
      material = flatBucket(material);
    } else if (isFlatGlow(material)) {
      this.tints.set(g, glowTint(material));
      material = flatGlowBucket();
    }
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

  /** Merge everything added so far into one group, all at once. */
  build(name: string, ao: AoFn | null): THREE.Group {
    return runSteps(this.buildSteps(name, ao));
  }

  /** The same merge in small steps, handing the thread back through `slicer` between them (the title's preload). */
  buildAsync(name: string, ao: AoFn | null, slicer: TimeSlicer): Promise<THREE.Group> {
    return runStepsSliced(this.buildSteps(name, ao), slicer);
  }

  /** One path for both: a step ends after each geometry's AO bake and each merge, the points a caller may pause at. */
  *buildSteps(name: string, ao: AoFn | null): Generator<void, THREE.Group, void> {
    const group = new THREE.Group();
    group.name = name;
    for (const [material, list] of this.parts) {
      const flat = flatBuckets.get(material.name) === material;
      const bake = ao !== null && takesAo(material) && material !== glowBucket;
      const worldTile = takesWorldUvs(material);
      for (const g of list) {
        if (worldTile) applyWorldMeterUvs(g, worldTileMeters(material));
        if (bake || flat) this.bakeAo(g, bake ? ao : null, this.tints.get(g));
        else g.deleteAttribute('color');
        yield;
      }
      const merged = mergeGeometries(list, false);
      yield;
      let indexed: THREE.BufferGeometry | null = null;
      if (merged) {
        indexed = mergeVertices(merged);
        merged.dispose();
        yield;
      }
      const meshes = indexed ? [indexed] : list;
      for (const g of meshes) {
        const mesh = new THREE.Mesh(g, flat ? material : bake ? withVertexColors(material) : material);
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

  /** Vertex colour = AO (1 without an AO function) times the flat albedo, if any. */
  private bakeAo(g: THREE.BufferGeometry, ao: AoFn | null, tint?: THREE.Color): void {
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const colors = new Float32Array(pos.count * 3);
    const tr = tint?.r ?? 1;
    const tg = tint?.g ?? 1;
    const tb = tint?.b ?? 1;
    for (let i = 0; i < pos.count; i++) {
      let v = 1;
      if (ao) {
        this.p.fromBufferAttribute(pos, i);
        this.n.fromBufferAttribute(nor, i);
        v = ao(this.p, this.n);
      }
      colors[i * 3] = v * tr;
      colors[i * 3 + 1] = v * tg;
      colors[i * 3 + 2] = v * tb;
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  }
}
