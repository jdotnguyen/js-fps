import * as THREE from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Create a GLTFLoader configured with MeshoptDecoder for compressed GLB assets. */
export async function createGltfLoader(): Promise<GLTFLoader> {
  const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('three/examples/jsm/libs/meshopt_decoder.module.js'),
  ]);
  await MeshoptDecoder.ready;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

/**
 * Promote quantized (e.g. Int16/Int8 from KHR_mesh_quantization) transformable attributes
 * to Float32Array before calling `geometry.applyMatrix4(...)`, which otherwise writes
 * world-space floats back into normalized integer arrays and corrupts the mesh.
 */
export function dequantizeForTransform(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of ['position', 'normal', 'tangent']) {
    const attr = geometry.getAttribute(name);
    if (!attr) continue;
    if (attr instanceof THREE.BufferAttribute && attr.array instanceof Float32Array && !attr.normalized) continue;
    const count = attr.count;
    const itemSize = attr.itemSize;
    const out = new Float32Array(count * itemSize);
    for (let i = 0; i < count; i++) {
      const base = i * itemSize;
      out[base] = attr.getX(i);
      if (itemSize > 1) out[base + 1] = attr.getY(i);
      if (itemSize > 2) out[base + 2] = attr.getZ(i);
      if (itemSize > 3) out[base + 3] = attr.getW(i);
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(out, itemSize, false));
  }
  return geometry;
}

/** Which way the model's front faces in the file; normalizeGltf turns it to the kit's -Z. */
export type ModelFront = '-z' | '+z' | '-x' | '+x';

export interface NormalizeGltfOptions {
  /**
   * Size, pick at most one (checked in this order):
   * - `height`: uniform scale so the bounding box is this tall (m). Characters, doors, props with a known height.
   * - `maxSize`: uniform scale so the largest bounding-box side is this long (m).
   * - `scale`: fixed factor, e.g. 0.01 for a centimetre export. Use when the file's units are known.
   * None of them: the file's own size is kept (glTF is metres by spec).
   */
  height?: number;
  maxSize?: number;
  scale?: number;
  /** 'floor' (default): base centre at the origin, so y = 0 is the floor. 'center': box centre. 'none': keep. */
  pivot?: 'floor' | 'center' | 'none';
  /** Direction the model faces in the file (default '-z', the glTF/kit convention). */
  front?: ModelFront;
  /** castShadow / receiveShadow on every mesh (default true). */
  shadows?: boolean;
  /** Name for the returned pivot group (default: the scene's name or 'model'). */
  name?: string;
}

export interface NormalizedModel {
  /** Wrapper to position, rotate and parent. Origin = the chosen pivot, front = -Z, units = metres. */
  root: THREE.Group;
  /** Bounding-box size after normalising (m). */
  size: THREE.Vector3;
  /** Uniform scale that was applied to the file's geometry. */
  scale: number;
}

const FRONT_YAW: Record<ModelFront, number> = { '-z': 0, '+z': Math.PI, '+x': Math.PI / 2, '-x': -Math.PI / 2 };

/**
 * Put an imported glTF scene into the kit's conventions (metres, pivot on the floor centre,
 * facing -Z) without touching its own node transforms: the scene goes inside a `fit` group
 * that carries the scale, turn and offset, inside a clean `root` you place in the world.
 * `snapModelToSocket` (world/kit/modelSnap.ts) can then move `root` onto a socket.
 *
 * Also fixes the usual import problems: colour maps tagged sRGB, data maps linear, and
 * skinned meshes never frustum-culled (their bind-pose bounds don't follow the animation).
 */
export function normalizeGltf(scene: THREE.Object3D, options: NormalizeGltfOptions = {}): NormalizedModel {
  if (scene.parent) scene.removeFromParent();
  const root = new THREE.Group();
  root.name = options.name ?? (scene.name || 'model');
  const fit = new THREE.Group();
  fit.name = `${root.name}:fit`;
  root.add(fit);
  fit.add(scene);

  const shadows = options.shadows ?? true;
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.castShadow = shadows;
    o.receiveShadow = shadows;
    if (o instanceof THREE.SkinnedMesh) o.frustumCulled = false;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) fixColorSpaces(m);
  });

  fit.rotation.y = FRONT_YAW[options.front ?? '-z'];
  const raw = boxIn(root);
  if (raw.isEmpty()) throw new Error(`normalizeGltf: '${root.name}' has no geometry`);
  const rawSize = raw.getSize(new THREE.Vector3());

  let s = 1;
  if (options.height !== undefined) s = options.height / Math.max(rawSize.y, 1e-9);
  else if (options.maxSize !== undefined) s = options.maxSize / Math.max(rawSize.x, rawSize.y, rawSize.z, 1e-9);
  else if (options.scale !== undefined) s = options.scale;
  if (!(s > 0) || !Number.isFinite(s)) throw new Error(`normalizeGltf: bad scale ${s} for '${root.name}'`);
  fit.scale.setScalar(s);

  const box = boxIn(root);
  const pivot = options.pivot ?? 'floor';
  if (pivot !== 'none') {
    const c = box.getCenter(new THREE.Vector3());
    fit.position.set(-c.x, pivot === 'floor' ? -box.min.y : -c.y, -c.z);
  }
  return { root, size: boxIn(root).getSize(new THREE.Vector3()), scale: s };
}

/** Bounding box of a fresh, unparented `root` (identity transform), i.e. in the model's own space. */
function boxIn(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(root);
}

const SRGB_SLOTS = ['map', 'emissiveMap', 'specularColorMap', 'sheenColorMap'] as const;
const LINEAR_SLOTS = ['normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap', 'displacementMap', 'alphaMap'] as const;

function fixColorSpaces(m: THREE.Material): void {
  const rec = m as unknown as Record<string, THREE.Texture | null | undefined>;
  let changed = false;
  for (const k of SRGB_SLOTS) {
    const t = rec[k];
    if (t && t.colorSpace !== THREE.SRGBColorSpace) {
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      changed = true;
    }
  }
  for (const k of LINEAR_SLOTS) {
    const t = rec[k];
    if (t && t.colorSpace !== THREE.NoColorSpace && t !== rec.map) {
      t.colorSpace = THREE.NoColorSpace;
      t.needsUpdate = true;
      changed = true;
    }
  }
  if (changed) m.needsUpdate = true;
}
