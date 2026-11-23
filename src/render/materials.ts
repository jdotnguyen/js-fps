import * as THREE from 'three';
import { TEXTURE_SPECS, type TextureKey, type TexSet } from './tex/generators.ts';
import type { TexWorkerRequest, TexWorkerResponse } from './tex/texWorker.ts';
import { loadPhotoTextures, toPbrTextures, type PbrTextures, type PhotoTextures } from './textures.ts';
import { PHOTO_SLOTS, PHOTO_SLOT_KEYS, type PhotoSlotKey } from './tex/manifest.ts';
import { trackAnisotropy } from './anisotropy.ts';

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
      aoMap: t.orm,
      aoMapIntensity: 0.85,
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

  photoMats.grating.alphaTest = 0.5;
  photoMats.grating.side = THREE.DoubleSide;

  return {
    ...photoMats,
    steel: photoMats.steelBrushed,
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

/** Procedural industrial brick PBR material (DataTexture albedo, normal, roughness/AO) tiled at 1 m. */
export function createProceduralBrickMaterial(anisotropy = 4): THREE.MeshStandardMaterial {
  const size = 128;
  const albedo = new Uint8Array(new ArrayBuffer(size * size * 4));
  const normal = new Uint8Array(new ArrayBuffer(size * size * 4));
  const orm = new Uint8Array(new ArrayBuffer(size * size * 4));
  const rows = 4;
  const cols = 2;
  const rowH = size / rows;
  const colW = size / cols;
  for (let y = 0; y < size; y++) {
    const row = Math.floor(y / rowH);
    const ry = y % rowH;
    const mortarY = ry < 3 || ry >= rowH - 2;
    const xShift = (row % 2) * (colW / 2);
    for (let x = 0; x < size; x++) {
      const sx = (x + xShift) % size;
      const rx = sx % colW;
      const mortarX = rx < 3 || rx >= colW - 2;
      const mortar = mortarY || mortarX;
      const hash = (((x * 73856093) ^ (y * 19349663)) >>> 0) & 255;
      const n = (hash / 255 - 0.5) * 18;
      const idx = (y * size + x) * 4;
      if (mortar) {
        albedo[idx] = 88 + n * 0.5;
        albedo[idx + 1] = 86 + n * 0.5;
        albedo[idx + 2] = 82 + n * 0.5;
        orm[idx] = 175; // AO
        orm[idx + 1] = 235; // roughness
      } else {
        const brickTone = ((row * 3 + Math.floor(sx / colW)) % 3) * 8;
        albedo[idx] = Math.min(255, Math.max(0, 118 + brickTone + n));
        albedo[idx + 1] = Math.min(255, Math.max(0, 62 + brickTone * 0.5 + n * 0.6));
        albedo[idx + 2] = Math.min(255, Math.max(0, 52 + brickTone * 0.4 + n * 0.5));
        orm[idx] = 235; // AO
        orm[idx + 1] = 205; // roughness
      }
      albedo[idx + 3] = 255;
      orm[idx + 2] = 0; // metalness
      orm[idx + 3] = 255;
      normal[idx] = mortar ? 128 : 128 + (rx < 6 ? -18 : rx > colW - 6 ? 18 : 0);
      normal[idx + 1] = mortar ? 128 : 128 + (ry < 5 ? -18 : ry > rowH - 5 ? 18 : 0);
      normal[idx + 2] = 248;
      normal[idx + 3] = 255;
    }
  }
  const makeTex = (data: Uint8Array<ArrayBuffer>, srgb: boolean): THREE.DataTexture => {
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
  };
  const ormTex = makeTex(orm, false);
  const m = new THREE.MeshStandardMaterial({
    map: makeTex(albedo, true),
    normalMap: makeTex(normal, false),
    roughnessMap: ormTex,
    metalnessMap: ormTex,
    aoMap: ormTex,
    aoMapIntensity: 0.85,
    roughness: 1,
    metalness: 1,
  });
  m.name = 'brick';
  return m;
}

/** Procedural texture size for a graphics quality (the Low tier halves it). */
export function textureSizeFor(quality: string): number {
  return quality === 'low' ? 256 : 512;
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

const MATERIAL_TEX_SLOTS = [
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

/** Close an ImageBitmap backing a texture (if present) before disposing the GPU texture. */
export function disposeTexture(tex: THREE.Texture): void {
  const img = (tex.image ?? tex.source?.data) as { close?: () => void } | null | undefined;
  if (img && typeof img.close === 'function') {
    try {
      img.close();
    } catch {
      /* already closed */
    }
  }
  tex.dispose();
}

/** Dispose every unique material and texture in a `Materials` table (session teardown). */
export function disposeMaterials(materials: Materials): void {
  const mats = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  for (const m of Object.values(materials)) {
    if (!(m instanceof THREE.Material)) continue;
    mats.add(m);
    const rec = m as unknown as Record<string, unknown>;
    for (const slot of MATERIAL_TEX_SLOTS) {
      const t = rec[slot];
      if (t instanceof THREE.Texture) textures.add(t);
    }
  }
  for (const t of textures) disposeTexture(t);
  for (const m of mats) m.dispose();
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

/**
 * Uniform 1 m UV debug checkerboard material for verifying modular grid scale, sightlines,
 * and zero wall overlap. Headless-safe when `document` is absent or stubbed.
 */
export function createDebugCheckerMaterial(anisotropy = 4): THREE.MeshStandardMaterial {
  if (typeof document === 'undefined') {
    const fallback = new THREE.MeshStandardMaterial({ color: 0x808a94, roughness: 0.78, metalness: 0.08 });
    fallback.name = 'debugChecker';
    return fallback;
  }
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const half = size / 2;
    const q = size / 4;
    // 0.5 m primary checker squares
    ctx.fillStyle = '#6f7780';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#9aa4ae';
    ctx.fillRect(0, 0, half, half);
    ctx.fillRect(half, half, half, half);
    // 0.25 m subtle sub-grid
    ctx.strokeStyle = 'rgba(20, 26, 32, 0.22)';
    ctx.lineWidth = 2;
    for (let i = 1; i < 4; i++) {
      const p = i * q;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, size);
      ctx.moveTo(0, p);
      ctx.lineTo(size, p);
      ctx.stroke();
    }
    // 1.0 m major border
    ctx.strokeStyle = '#1f262d';
    ctx.lineWidth = 6;
    ctx.strokeRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  trackAnisotropy(tex, anisotropy);
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.78,
    metalness: 0.08,
  });
  mat.name = 'debugChecker';
  return mat;
}
