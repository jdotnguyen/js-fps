import * as THREE from 'three';
import { dequantizeForTransform } from '../gltf.ts';

/**
 * The supply sub (intro-sequence spec): the "Kilo-class Submarine" GLB (public/assets/models/vehicles/, CC BY 4.0, see
 * CREDITS.md; material converted by scripts/fix-kilo-glb.mjs).
 *
 * The source is a ~71 m boat in its own units, long axis Z, bow at +Z, Y up. `prepare` bakes the node
 * transforms into the geometry and re-frames it to match the procedural hull it replaces in
 * `supply_sub` (src/world/kit/slice.ts): long axis on X, bow at +X, origin at the centre of the hull
 * on its centreline, scaled to `SUB_LENGTH`. Callers get a clone that shares geometry and materials.
 */

const MODEL_URL = 'assets/models/vehicles/kilo_submarine.glb';

/** Size multiplier on the base fit (a 14.5 m boat that suited the dock cradle). 1 keeps the original proportions to the dock. */
export const SUB_SCALE = 1;
/** Hull length after scaling (m). The old procedural sub was 9 m. */
export const SUB_LENGTH = 14.5 * SUB_SCALE;

// Measured on the source (unscaled): length 71.23, hull centreline 5.05 above the keel, hull radius ~4.8, sail top 13.5 above the centreline.
const SRC_LENGTH = 71.23;
const SRC_AXIS_ABOVE_KEEL = 5.05;
const SCALE = SUB_LENGTH / SRC_LENGTH;
/** Hull radius (m). */
export const SUB_RADIUS = 4.8 * SCALE;
/** Top of the sail above the hull centreline (m). */
export const SUB_SAIL_TOP = 13.5 * SCALE;

let model: THREE.Group | null = null;
let loading: Promise<void> | null = null;

/** Load and prepare the model. Safe to call repeatedly; call before building rooms so the sub appears at once. */
export function preloadSubModel(baseUrl = '/'): Promise<void> {
  if (model) return Promise.resolve();
  loading ??= (async () => {
    const { createGltfLoader } = await import('../gltf.ts');
    const gltf = await (await createGltfLoader()).loadAsync(baseUrl + MODEL_URL);
    model = prepare(gltf.scene);
  })().catch((err: unknown) => {
    console.warn('[sub] model failed to load; the supply sub keeps its procedural hull', err);
    loading = null;
  });
  return loading;
}

/** Dispose cached supply-sub GLB geometries/materials/textures (session teardown). */
export function disposeSubModelCache(): void {
  if (model) {
    const geoms = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    model.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      geoms.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m instanceof THREE.Material) mats.add(m);
      }
    });
    for (const g of geoms) g.dispose();
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial;
      std.map?.dispose();
      std.normalMap?.dispose();
      std.roughnessMap?.dispose();
      std.metalnessMap?.dispose();
      std.emissiveMap?.dispose();
      m.dispose();
    }
    model = null;
  }
  loading = null;
}

function prepare(scene: THREE.Object3D): THREE.Group {
  scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(scene);
  const centre = bounds.getCenter(new THREE.Vector3());
  // Source frame -> sub frame: centre on x/z, put the hull centreline at y = 0, then turn +Z (bow) to +X.
  const frame = new THREE.Matrix4()
    .makeRotationY(Math.PI / 2)
    .multiply(new THREE.Matrix4().makeScale(SCALE, SCALE, SCALE))
    .multiply(new THREE.Matrix4().makeTranslation(-centre.x, -(bounds.min.y + SRC_AXIS_ABOVE_KEEL), -centre.z));
  const root = new THREE.Group();
  root.name = 'supply_sub:kilo';
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const geometry = dequantizeForTransform((o.geometry as THREE.BufferGeometry).clone()).applyMatrix4(o.matrixWorld).applyMatrix4(frame);
    const material = o.material as THREE.MeshStandardMaterial;
    material.side = THREE.DoubleSide;
    root.add(new THREE.Mesh(geometry, material));
  });
  return root;
}

/** A fresh instance of the prepared sub, or null when the model is not loaded (use the procedural hull). */
export function createSubModel(): THREE.Group | null {
  return model ? model.clone() : null;
}
