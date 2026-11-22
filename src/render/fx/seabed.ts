import * as THREE from 'three';
import { dequantizeForTransform } from '../gltf.ts';
import { applyExterior } from './exteriorLight.ts';

/**
 * The sea floor under and around the station (openspec change overhaul-exterior-ocean): one
 * procedural heightfield for the whole level, so neighbouring windows look onto the same ground,
 * plus the rock clusters of the "Ocean floor scene" GLB (public/assets/models/seabed/, CC BY 4.0,
 * see CREDITS.md) scattered as instances. It is not self-lit and has no caustics: it shows only
 * where exterior lamps reach, and fades into the water with distance (exteriorLight.ts).
 */

const MODEL_URL = 'assets/models/seabed/ocean_floor_scene.glb';
/** Seabed level under the station, relative to deck 0 (m). */
export const SEABED_BASE_Y = -4.5;
/** How much deeper the ground gets far from the station (m). */
const FALLOFF_DEPTH = 4;
const TEXTURE_TILE = 6;

interface SeabedSource {
  /** Each rock mesh, re-centred on its own footprint with its lowest point at y = 0. */
  rocks: THREE.BufferGeometry[];
  rockMaterials: THREE.Material[];
  groundMap: THREE.Texture | null;
}

let source: SeabedSource | null = null;
let loading: Promise<void> | null = null;
const waiting: Array<() => void> = [];

/** Load and prepare the model. Safe to call repeatedly; rocks and texture appear once it is ready. */
export function preloadSeabed(baseUrl = '/'): Promise<void> {
  if (source) return Promise.resolve();
  loading ??= (async () => {
    const { createGltfLoader } = await import('../gltf.ts');
    const gltf = await (await createGltfLoader()).loadAsync(baseUrl + MODEL_URL);
    source = prepare(gltf.scene);
    for (const fn of waiting.splice(0)) fn();
  })().catch((err: unknown) => {
    console.warn('[seabed] model failed to load; the seabed stays untextured and without rocks', err);
    loading = null;
  });
  return loading;
}

/** Dispose cached seabed GLB geometries/materials/textures (session teardown). */
export function disposeSeabedCache(): void {
  if (source) {
    for (const g of source.rocks) g.dispose();
    for (const m of source.rockMaterials) {
      const std = m as THREE.MeshStandardMaterial;
      std.map?.dispose();
      std.normalMap?.dispose();
      std.roughnessMap?.dispose();
      m.dispose();
    }
    source.groundMap?.dispose();
    source = null;
  }
  loading = null;
  waiting.length = 0;
}

function prepare(scene: THREE.Object3D): SeabedSource {
  scene.updateMatrixWorld(true);
  const baked: Array<{ geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial; area: number }> = [];
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const geometry = dequantizeForTransform((o.geometry as THREE.BufferGeometry).clone()).applyMatrix4(o.matrixWorld);
    for (const name of ['tangent', 'uv2', 'uv3', 'uv4']) geometry.deleteAttribute(name);
    geometry.computeBoundingBox();
    const s = geometry.boundingBox!.getSize(new THREE.Vector3());
    baked.push({ geometry, material: o.material as THREE.MeshStandardMaterial, area: s.x * s.z });
  });
  // The ground is by far the widest mesh; only its colour map is kept.
  const groundIdx = baked.reduce((best, b, i) => (b.area > baked[best]!.area ? i : best), 0);
  const ground = baked[groundIdx];
  const rocks = baked.filter((_, i) => i !== groundIdx);
  for (const r of rocks) {
    const box = r.geometry.boundingBox!;
    const c = box.getCenter(new THREE.Vector3());
    r.geometry.translate(-c.x, -box.min.y, -c.z);
  }
  const groundMap = ground?.material.map ?? null;
  if (groundMap) {
    groundMap.wrapS = groundMap.wrapT = THREE.RepeatWrapping;
    groundMap.needsUpdate = true;
  }
  return {
    rocks: rocks.map((r) => r.geometry),
    rockMaterials: rocks.map((r) => applyExterior(rockFinish(r.material))),
    groundMap,
  };
}

function rockFinish(src: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const m = src.clone();
  m.metalness = 0;
  m.metalnessMap = null;
  m.roughness = 0.95;
  m.emissive.set(0x000000);
  m.emissiveMap = null;
  m.emissiveIntensity = 0;
  return m;
}

/** Deterministic value noise in [0, 1] (JS twin of the GLSL vnoise). */
function hash2(x: number, z: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  let fx = x - ix;
  let fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Ground height at (x, z), given the distance from the station footprint there. */
export function seabedHeight(x: number, z: number, footprintDistance: number, seed = 1): number {
  const broad = vnoise(x * 0.07, z * 0.07, seed) * 0.65 + vnoise(x * 0.15, z * 0.15, seed + 7) * 0.35;
  const fine = vnoise(x * 0.4, z * 0.4, seed + 13);
  return SEABED_BASE_Y + (broad - 0.5) * 1.2 + (fine - 0.5) * 0.08 - FALLOFF_DEPTH * smooth(10, 60, footprintDistance);
}

export interface SeabedOptions {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Distance (m) from (x, z) to the station footprint; 0 under the station. */
  distance: (x: number, z: number) => number;
  /** Grid spacing (m). */
  step?: number;
  seed?: number;
}

export interface Seabed {
  group: THREE.Group;
  /** Ground height at a world (x, z) inside the covered area. */
  heightAt(x: number, z: number): number;
  /** Rock placements (x, z, yaw, scale); added as instances once the model is loaded. */
  addRocks(placements: ReadonlyArray<{ x: number; z: number; yaw: number; scale: number }>): void;
}

/** One heightfield over the given area. Builds at once, with or without the GLB. */
export function createSeabed(o: SeabedOptions): Seabed {
  const group = new THREE.Group();
  group.name = 'seabed';
  const step = o.step ?? 1;
  const seed = o.seed ?? 1;
  const nx = Math.max(1, Math.ceil((o.maxX - o.minX) / step));
  const nz = Math.max(1, Math.ceil((o.maxZ - o.minZ) / step));
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
  const uv = new Float32Array((nx + 1) * (nz + 1) * 2);
  const heights = new Float32Array((nx + 1) * (nz + 1));
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const k = j * (nx + 1) + i;
      const x = o.minX + i * step;
      const z = o.minZ + j * step;
      const y = seabedHeight(x, z, o.distance(x, z), seed);
      heights[k] = y;
      pos.set([x, y, z], k * 3);
      uv.set([x / TEXTURE_TILE, z / TEXTURE_TILE], k * 2);
    }
  }
  const index: number[] = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const b = a + 1;
      const c = a + nx + 1;
      const d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const groundMat = new THREE.MeshStandardMaterial({ color: 0x8a8a7c, roughness: 1, metalness: 0 });
  groundMat.name = 'seabed-ground';
  const ground = new THREE.Mesh(geometry, applyExterior(groundMat));
  ground.name = 'seabed-ground';
  ground.castShadow = false;
  ground.receiveShadow = false;
  ground.userData['skipGtao'] = true;
  group.add(ground);

  const heightAt = (x: number, z: number): number => {
    const fi = Math.min(nx, Math.max(0, (x - o.minX) / step));
    const fj = Math.min(nz, Math.max(0, (z - o.minZ) / step));
    const i = Math.min(nx - 1, Math.floor(fi));
    const j = Math.min(nz - 1, Math.floor(fj));
    const u = fi - i;
    const v = fj - j;
    const h = (ii: number, jj: number): number => heights[jj * (nx + 1) + ii]!;
    return h(i, j) * (1 - u) * (1 - v) + h(i + 1, j) * u * (1 - v) + h(i, j + 1) * (1 - u) * v + h(i + 1, j + 1) * u * v;
  };

  const rockPlacements: Array<{ x: number; z: number; yaw: number; scale: number }> = [];
  const buildRocks = (): void => {
    if (!source || !rockPlacements.length) return;
    const src = source;
    if (src.groundMap) {
      const mat = (ground.material as THREE.MeshStandardMaterial);
      mat.map = src.groundMap;
      mat.color.set(0x9a9c92);
      mat.needsUpdate = true;
    }
    if (!src.rocks.length) return;
    const buckets = src.rocks.map(() => [] as THREE.Matrix4[]);
    rockPlacements.forEach((p, n) => {
      const k = n % src.rocks.length;
      buckets[k]!.push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(p.x, heightAt(p.x, p.z) - 0.15 * p.scale, p.z),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw),
          new THREE.Vector3(p.scale, p.scale, p.scale),
        ),
      );
    });
    buckets.forEach((list, k) => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(src.rocks[k]!, src.rockMaterials[k]!, list.length);
      list.forEach((m, n) => mesh.setMatrixAt(n, m));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.name = `seabed-rocks-${k}`;
      mesh.userData['skipGtao'] = true;
      group.add(mesh);
    });
    rockPlacements.length = 0;
  };

  return {
    group,
    heightAt,
    addRocks(placements) {
      rockPlacements.push(...placements);
      if (source) buildRocks();
      else waiting.push(buildRocks);
    },
  };
}
