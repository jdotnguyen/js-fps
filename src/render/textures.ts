import * as THREE from 'three';
import type { Bytes, TexSet } from './tex/generators.ts';
import type { PhotoSlot } from './tex/manifest.ts';
import { trackAnisotropy } from './anisotropy.ts';

export interface PbrTextures {
  map: THREE.DataTexture;
  orm: THREE.DataTexture;
  normalMap: THREE.DataTexture;
}

const TEXTURE_SLOTS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
  'alphaMap',
  'bumpMap',
  'displacementMap',
  'envMap',
] as const;

function dataTexture(data: Bytes, size: number, srgb: boolean, anisotropy: number): THREE.DataTexture {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  trackAnisotropy(t, anisotropy);
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

function setupImageTexture(t: THREE.Texture, srgb: boolean, slot: PhotoSlot, anisotropy: number, fromBitmap = false): THREE.Texture {
  // ImageBitmap already has flipY applied at decode time; TextureLoader images keep flipY = true.
  if (fromBitmap) t.flipY = false;
  const wrap = slot.tiling ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.wrapS = wrap;
  t.wrapT = wrap;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  trackAnisotropy(t, anisotropy);
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

export interface ImageLoadDeps {
  fetchFn?: typeof fetch;
  createBitmap?: typeof createImageBitmap | null;
  fallbackLoad?: (url: string) => Promise<THREE.Texture>;
}

/** Decode an image off the main thread with createImageBitmap when available, else fall back to TextureLoader. */
async function loadImageTexture(url: string, deps: ImageLoadDeps = {}): Promise<{ texture: THREE.Texture; fromBitmap: boolean }> {
  const createBitmap = deps.createBitmap === undefined ? (typeof createImageBitmap === 'function' ? createImageBitmap : null) : deps.createBitmap;
  const fetchFn = deps.fetchFn ?? (typeof fetch === 'function' ? fetch : undefined);
  if (createBitmap && fetchFn) {
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} loading ${url}`);
    const blob = await res.blob();
    const bitmap = await createBitmap(blob, { imageOrientation: 'flipY', colorSpaceConversion: 'none' });
    return { texture: new THREE.Texture(bitmap), fromBitmap: true };
  }
  const fallback = deps.fallbackLoad ?? ((u: string) => loader.loadAsync(u));
  return { texture: await fallback(url), fromBitmap: false };
}

/** Load `<baseUrl>assets/textures/<dir>/{color,normal,orm}.webp`; rejects if any file fails. */
export async function loadPhotoTextures(slot: PhotoSlot, baseUrl: string, anisotropy: number, deps?: ImageLoadDeps): Promise<PhotoTextures> {
  const dir = `${baseUrl}assets/textures/${slot.dir}/`;
  const [map, normalMap, orm] = await Promise.all([
    loadImageTexture(`${dir}color.webp`, deps),
    loadImageTexture(`${dir}normal.webp`, deps),
    loadImageTexture(`${dir}orm.webp`, deps),
  ]);
  return {
    map: setupImageTexture(map.texture, true, slot, anisotropy, map.fromBitmap),
    normalMap: setupImageTexture(normalMap.texture, false, slot, anisotropy, normalMap.fromBitmap),
    orm: setupImageTexture(orm.texture, false, slot, anisotropy, orm.fromBitmap),
  };
}

/** Collect every unique texture referenced by scenes, objects, materials, or texture lists for GPU pre-upload. */
export function collectTextures(sources: Iterable<THREE.Object3D | THREE.Material | THREE.Texture | null | undefined>): THREE.Texture[] {
  const seen = new Set<THREE.Texture>();
  const addMaterial = (m: THREE.Material): void => {
    const rec = m as unknown as Record<string, unknown>;
    for (const slot of TEXTURE_SLOTS) {
      const t = rec[slot];
      if (t instanceof THREE.Texture) seen.add(t);
    }
  };
  for (const src of sources) {
    if (!src) continue;
    if (src instanceof THREE.Texture) {
      seen.add(src);
    } else if (src instanceof THREE.Material) {
      addMaterial(src);
    } else if (src instanceof THREE.Object3D) {
      src.traverse((o) => {
        if (!(o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Sprite)) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (m instanceof THREE.Material) addMaterial(m);
        }
      });
    }
  }
  return [...seen];
}
