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
