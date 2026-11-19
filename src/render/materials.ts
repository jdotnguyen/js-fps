import * as THREE from 'three';
import { TEXTURE_SPECS, type TextureKey, type TexSet } from './tex/generators.ts';
import type { TexWorkerRequest, TexWorkerResponse } from './tex/texWorker.ts';
import { toPbrTextures } from './textures.ts';

const TEXTURE_KEYS: TextureKey[] = ['paintTeal', 'paintDark', 'paintBone', 'steel', 'diamond', 'grating', 'rubber', 'hazard'];

/** Shared material instances (ADR-0002). Per-object variants are cloned from these. */
export interface Materials {
  paintTeal: THREE.MeshStandardMaterial;
  paintDark: THREE.MeshStandardMaterial;
  paintBone: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  diamond: THREE.MeshStandardMaterial;
  grating: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  hazard: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  black: THREE.MeshStandardMaterial;
  cable: THREE.MeshStandardMaterial;
  glowCyan: THREE.MeshStandardMaterial;
}

function buildMaterialsFromSets(sets: Record<TextureKey, TexSet>, anisotropy: number): Materials {
  const pbr = (key: TextureKey, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial => {
    const t = toPbrTextures(sets[key], anisotropy);
    const m = new THREE.MeshStandardMaterial({
      map: t.map,
      normalMap: t.normalMap,
      roughnessMap: t.orm,
      metalnessMap: t.orm,
      roughness: 1,
      metalness: 1,
      ...extra,
    });
    m.name = key;
    return m;
  };

  return {
    paintTeal: pbr('paintTeal'),
    paintDark: pbr('paintDark'),
    paintBone: pbr('paintBone'),
    steel: pbr('steel'),
    diamond: pbr('diamond'),
    grating: pbr('grating', { alphaTest: 0.5, side: THREE.DoubleSide }),
    rubber: pbr('rubber'),
    hazard: pbr('hazard'),
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

/** Generate procedural PBR textures in a Web Worker when available, falling back to sync. */
export function createMaterialsAsync(textureSize: number, anisotropy: number): Promise<Materials> {
  if (typeof Worker === 'undefined') return Promise.resolve(createMaterials(textureSize, anisotropy));
  return new Promise((resolve) => {
    const worker = new Worker(new URL('./tex/texWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<TexWorkerResponse>) => {
      worker.terminate();
      const sets = {} as Record<TextureKey, TexSet>;
      for (let i = 0; i < TEXTURE_KEYS.length; i++) sets[TEXTURE_KEYS[i]!] = e.data.sets[i]!;
      resolve(buildMaterialsFromSets(sets, anisotropy));
    };
    worker.onerror = () => {
      worker.terminate();
      resolve(createMaterials(textureSize, anisotropy));
    };
    const req: TexWorkerRequest = { keys: TEXTURE_KEYS, size: textureSize };
    worker.postMessage(req);
  });
}

/** Emissive material for a light fixture; one instance per fixture so it can flicker alone. */
export function fixtureMaterial(color: THREE.ColorRepresentation, intensity: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
}
