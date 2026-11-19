import * as THREE from 'three';
import { TEXTURE_SPECS, type TextureKey, type TexSet } from './tex/generators.ts';
import type { TexWorkerRequest, TexWorkerResponse } from './tex/texWorker.ts';
import { loadPhotoTextures, toPbrTextures, type PbrTextures, type PhotoTextures } from './textures.ts';
import { PHOTO_SLOTS, PHOTO_SLOT_KEYS, type PhotoSlotKey } from './tex/manifest.ts';

const TEXTURE_KEYS: TextureKey[] = [
  'paintTeal',
  'paintDark',
  'paintBone',
  'steel',
  'diamond',
  'grating',
  'rubber',
  'hazard',
  'hazardClean',
  'labTile',
  'labPanel',
  'concrete',
];

/** Shared material instances (ADR-0002). Per-object variants are cloned from these. */
export interface Materials extends Record<PhotoSlotKey, THREE.MeshStandardMaterial> {
  steel: THREE.MeshStandardMaterial;
  grating: THREE.MeshStandardMaterial;
  hazardClean: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  black: THREE.MeshStandardMaterial;
  cable: THREE.MeshStandardMaterial;
  glowCyan: THREE.MeshStandardMaterial;
}

/** Photo slot textures by slot; a missing entry (load failure or sync path) uses the procedural fallback. */
type PhotoLoads = Partial<Record<PhotoSlotKey, PhotoTextures>>;

function buildMaterialsFromSets(sets: Record<TextureKey, TexSet>, anisotropy: number, photos: PhotoLoads = {}): Materials {
  const procCache = new Map<TextureKey, PbrTextures>();
  const procTextures = (key: TextureKey): PbrTextures => {
    let t = procCache.get(key);
    if (!t) {
      t = toPbrTextures(sets[key], anisotropy);
      procCache.set(key, t);
    }
    return t;
  };
  const pbr = (name: string, key: TextureKey, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial => {
    const t = procTextures(key);
    const m = new THREE.MeshStandardMaterial({
      map: t.map,
      normalMap: t.normalMap,
      roughnessMap: t.orm,
      metalnessMap: t.orm,
      roughness: 1,
      metalness: 1,
      ...extra,
    });
    m.name = name;
    return m;
  };
  const photo = (slot: PhotoSlotKey): THREE.MeshStandardMaterial => {
    const spec = PHOTO_SLOTS[slot];
    const t = photos[slot];
    if (!t) return pbr(slot, spec.fallback);
    // aoMap reads the R channel of the ORM on uv channel 0 (texture.channel default), so no uv1 is needed.
    const m = new THREE.MeshStandardMaterial({
      map: t.map,
      normalMap: t.normalMap,
      roughnessMap: t.orm,
      metalnessMap: t.orm,
      aoMap: t.orm,
      color: spec.tint,
      roughness: spec.roughnessScale,
      metalness: 1,
    });
    if (spec.normalScale !== undefined) m.normalScale.set(spec.normalScale, spec.normalScale);
    m.name = slot;
    return m;
  };

  const photoMats = {} as Record<PhotoSlotKey, THREE.MeshStandardMaterial>;
  for (const k of PHOTO_SLOT_KEYS) photoMats[k] = photo(k);

  return {
    ...photoMats,
    steel: pbr('steel', 'steel'),
    grating: pbr('grating', 'grating', { alphaTest: 0.5, side: THREE.DoubleSide }),
    hazardClean: pbr('hazardClean', 'hazardClean'),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x9fbac2,
      roughness: 0.04,
      metalness: 0,
      transparent: true,
      opacity: 0.16,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      envMapIntensity: 2,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    black: new THREE.MeshStandardMaterial({ color: 0x030405, roughness: 0.9, metalness: 0 }),
    cable: new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.55, metalness: 0 }),
    glowCyan: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x2fd3ff, emissiveIntensity: 2.2 }),
  };
}

export function createMaterials(textureSize: number, anisotropy: number): Materials {
  const sets = {} as Record<TextureKey, TexSet>;
  for (const key of TEXTURE_KEYS) sets[key] = TEXTURE_SPECS[key](textureSize);
  return buildMaterialsFromSets(sets, anisotropy);
}

/** Load all photo slots in parallel; a failing slot logs once and is left out (procedural fallback). */
async function loadPhotos(anisotropy: number, baseUrl: string): Promise<PhotoLoads> {
  const out: PhotoLoads = {};
  // ?proctex: skip photo textures for a before/after comparison with the procedural set.
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('proctex')) return out;
  await Promise.all(
    PHOTO_SLOT_KEYS.map(async (key) => {
      try {
        out[key] = await loadPhotoTextures(PHOTO_SLOTS[key], baseUrl, anisotropy);
      } catch (err) {
        console.warn(`[textures] slot '${key}' failed to load; using procedural '${PHOTO_SLOTS[key].fallback}'`, err);
      }
    }),
  );
  return out;
}

function generateSetsAsync(textureSize: number): Promise<Record<TextureKey, TexSet>> {
  const sync = (): Record<TextureKey, TexSet> => {
    const sets = {} as Record<TextureKey, TexSet>;
    for (const key of TEXTURE_KEYS) sets[key] = TEXTURE_SPECS[key](textureSize);
    return sets;
  };
  if (typeof Worker === 'undefined') return Promise.resolve(sync());
  return new Promise((resolve) => {
    const worker = new Worker(new URL('./tex/texWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<TexWorkerResponse>) => {
      worker.terminate();
      const sets = {} as Record<TextureKey, TexSet>;
      for (let i = 0; i < TEXTURE_KEYS.length; i++) sets[TEXTURE_KEYS[i]!] = e.data.sets[i]!;
      resolve(sets);
    };
    worker.onerror = () => {
      worker.terminate();
      resolve(sync());
    };
    const req: TexWorkerRequest = { keys: TEXTURE_KEYS, size: textureSize };
    worker.postMessage(req);
  });
}

/**
 * Procedural sets (worker) and photo textures (images) load in parallel; resolves when both settle.
 * Slots whose images fail use their manifest fallback generator.
 */
export async function createMaterialsAsync(textureSize: number, anisotropy: number, baseUrl: string = import.meta.env.BASE_URL): Promise<Materials> {
  const [sets, photos] = await Promise.all([generateSetsAsync(textureSize), loadPhotos(anisotropy, baseUrl)]);
  return buildMaterialsFromSets(sets, anisotropy, photos);
}

/** Emissive material for a light fixture; one instance per fixture so it can flicker alone. */
export function fixtureMaterial(color: THREE.ColorRepresentation, intensity: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
}
