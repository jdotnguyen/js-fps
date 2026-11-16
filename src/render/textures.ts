import * as THREE from 'three';
import type { Bytes, TexSet } from './tex/generators.ts';

export interface PbrTextures {
  map: THREE.DataTexture;
  orm: THREE.DataTexture;
  normalMap: THREE.DataTexture;
}

function dataTexture(data: Bytes, size: number, srgb: boolean, anisotropy: number): THREE.DataTexture {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Upload a generated set as GPU textures (row 0 = v 0, so flipY stays false). */
export function toPbrTextures(set: TexSet, anisotropy: number): PbrTextures {
  return {
    map: dataTexture(set.albedo, set.size, true, anisotropy),
    orm: dataTexture(set.orm, set.size, false, anisotropy),
    normalMap: dataTexture(set.normal, set.size, false, anisotropy),
  };
}
