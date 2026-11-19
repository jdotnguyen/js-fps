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
