import * as THREE from 'three';
import type { Bytes, TexSet } from './tex/generators.ts';
import type { PhotoSlot } from './tex/manifest.ts';

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

const loader = new THREE.TextureLoader();

function setupImageTexture(t: THREE.Texture, srgb: boolean, slot: PhotoSlot, anisotropy: number): THREE.Texture {
  // TextureLoader default flipY = true is correct for images (unlike the DataTexture path above).
  const wrap = slot.tiling ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.wrapS = wrap;
  t.wrapT = wrap;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  // Repeat contract: kit UVs are metres at tile = 1, so one image covers metersPerTile metres.
  const r = slot.tiling ? 1 / slot.metersPerTile : 1;
  t.repeat.set(r, r);
  t.needsUpdate = true;
  return t;
}

export interface PhotoTextures {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  /** R = AO, G = roughness, B = metalness. Shared by aoMap, roughnessMap and metalnessMap. */
  orm: THREE.Texture;
}

/** Load `<baseUrl>assets/textures/<dir>/{color,normal,orm}.webp`; rejects if any file fails. */
export async function loadPhotoTextures(slot: PhotoSlot, baseUrl: string, anisotropy: number): Promise<PhotoTextures> {
  const dir = `${baseUrl}assets/textures/${slot.dir}/`;
  const [map, normalMap, orm] = await Promise.all([
    loader.loadAsync(`${dir}color.webp`),
    loader.loadAsync(`${dir}normal.webp`),
    loader.loadAsync(`${dir}orm.webp`),
  ]);
  return {
    map: setupImageTexture(map, true, slot, anisotropy),
    normalMap: setupImageTexture(normalMap, false, slot, anisotropy),
    orm: setupImageTexture(orm, false, slot, anisotropy),
  };
}
