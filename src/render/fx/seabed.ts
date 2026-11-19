import * as THREE from 'three';

/**
 * The sea floor outside the station windows: the "Ocean floor scene" GLB (public/assets/models/seabed/,
 * CC BY 4.0, see CREDITS.md) repeated along the window wall.
 *
 * The source is one ~12 m square of ground with two rock clusters. Each tile reuses that geometry
 * (three InstancedMeshes in total, however long the wall is), rotated 0 or 180 degrees on alternate
 * tiles, with a different width, vertical stretch and slight overlap so the repeat is hard to spot.
 * It is low-res by design: it sits behind glass, in fog, under marine snow.
 *
 * Frame: local +X runs along the wall, local -Z is outwards (into the water), local Y is up with
 * the floor of the station at 0. Callers place the group with `applyMatrix4(frame)`.
 */

const MODEL_URL = 'assets/models/seabed/ocean_floor_scene.glb';

interface SeabedSource {
  /** Ground first, then rocks. Centred on x/z, with the ground's lowest point at y = 0. */
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  /** Footprint of the source ground along X and Z. */
  size: number;
}

let source: SeabedSource | null = null;
let loading: Promise<void> | null = null;
const waiting: Array<() => void> = [];

export interface SeabedOptions {
  /** Wall length the seabed must cover (m). */
  length: number;
  /** Distance from the glass to the abyss backdrop (m); the seabed ends just in front of it. */
  depth: number;
  /** Height of the seabed's lowest point relative to the station floor (m). */
  floorY?: number;
  /** Extra coverage past each end of the wall (m). */
  pad?: number;
  /** Seeds the stretch and rotation, so the same wall always looks the same. */
  seed?: number;
}

/** Load and prepare the model. Safe to call repeatedly; call before building rooms so tiles appear at once. */
export function preloadSeabed(baseUrl = '/'): Promise<void> {
  if (source) return Promise.resolve();
  loading ??= (async () => {
    const { createGltfLoader } = await import('../gltf.ts');
    const gltf = await (await createGltfLoader()).loadAsync(baseUrl + MODEL_URL);
    source = prepare(gltf.scene);
    for (const fn of waiting.splice(0)) fn();
  })().catch((err: unknown) => {
    console.warn('[seabed] model failed to load; windows keep the plain abyss backdrop', err);
    loading = null;
  });
  return loading;
}

function prepare(scene: THREE.Object3D): SeabedSource {
  scene.updateMatrixWorld(true);
  const baked: Array<{ name: string; geometry: THREE.BufferGeometry; material: THREE.Material }> = [];
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const geometry = (o.geometry as THREE.BufferGeometry).clone().applyMatrix4(o.matrixWorld);
    // Only what the shader reads; the export carries five UV sets and tangents.
    for (const name of ['tangent', 'uv2', 'uv3', 'uv4']) geometry.deleteAttribute(name);
    baked.push({ name: `${o.parent?.parent?.name ?? ''}${o.name}`, geometry, material: o.material as THREE.Material });
  });
  // The ground is by far the widest mesh.
  const widths = baked.map((b) => {
    b.geometry.computeBoundingBox();
    const s = b.geometry.boundingBox!.getSize(new THREE.Vector3());
    return s.x * s.z;
  });
  const groundIdx = widths.indexOf(Math.max(...widths));
  const ground = baked[groundIdx]!;
  const box = ground.geometry.boundingBox!;
  const centre = box.getCenter(new THREE.Vector3());
  const shift = new THREE.Matrix4().makeTranslation(-centre.x, -box.min.y, -centre.z);
  const ordered = [ground, ...baked.filter((_, i) => i !== groundIdx)];
  for (const b of ordered) b.geometry.applyMatrix4(shift);

  const materials = new Map<THREE.Material, THREE.Material>();
  const out = ordered.map((b) => {
    let m = materials.get(b.material);
    if (!m) {
      m = tint(b.material as THREE.MeshStandardMaterial);
      materials.set(b.material, m);
    }
    return m;
  });
  return { geometries: ordered.map((b) => b.geometry), materials: out, size: Math.max(box.max.x - box.min.x, box.max.z - box.min.z) };
}

/** Deep water: the lights of the station don't reach out here, so the floor carries a faint glow of its own. */
function tint(src: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const m = src.clone();
  m.color.set(0x8fa9ad);
  m.metalness = 0;
  m.metalnessMap = null;
  m.roughness = 0.95;
  m.roughnessMap = null;
  m.emissive.set(0x1b5a66);
  m.emissiveMap = src.map;
  m.emissiveIntensity = 0.55;
  m.side = THREE.FrontSide;
  return m;
}

/** Small deterministic generator (mulberry32), so a wall looks the same every build. */
function rand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Returns a group right away; the tiles are added when the model is ready (immediately if
 * `preloadSeabed` already finished).
 */
export function createSeabed(o: SeabedOptions): THREE.Group {
  const group = new THREE.Group();
  group.name = 'seabed';
  const build = (): void => {
    if (!source) return;
    const src = source;
    const rng = rand(o.seed ?? 1);
    const pad = o.pad ?? 1;
    const floorY = o.floorY ?? -4.5;
    // One row of tiles filling the space between the glass and the backdrop.
    const tileDepth = Math.max(2, o.depth - 0.4);
    const zCentre = -(0.3 + tileDepth / 2);
    const sz = tileDepth / src.size;

    const placements: THREE.Matrix4[] = [];
    const overlap = 0.9;
    let x = -o.length / 2 - pad;
    const end = o.length / 2 + pad;
    let i = 0;
    while (x < end) {
      const widthScale = 0.8 + rng() * 0.45; // stretch along the wall
      const tileW = tileDepth * widthScale;
      const sy = 0.9 + rng() * 0.9; // vertical stretch
      const rot = i % 2 === 0 ? 0 : Math.PI;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(x + tileW / 2, floorY + (rng() - 0.5) * 0.5, zCentre),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot),
        new THREE.Vector3(tileW / src.size, sy, sz),
      );
      placements.push(m);
      x += tileW * overlap;
      i++;
    }
    src.geometries.forEach((geometry, k) => {
      const mesh = new THREE.InstancedMesh(geometry, src.materials[k]!, placements.length);
      placements.forEach((m, n) => mesh.setMatrixAt(n, m));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      mesh.name = k === 0 ? 'seabed-ground' : `seabed-rocks-${k}`;
      group.add(mesh);
    });
  };
  if (source) build();
  else waiting.push(build);
  return group;
}
