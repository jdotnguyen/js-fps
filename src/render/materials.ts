import * as THREE from 'three';
import { TEXTURE_SPECS, type TextureKey } from './tex/generators.ts';
import { toPbrTextures } from './textures.ts';

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

export function createMaterials(textureSize: number, anisotropy: number): Materials {
  const pbr = (key: TextureKey, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial => {
    const t = toPbrTextures(TEXTURE_SPECS[key](textureSize), anisotropy);
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

/** Emissive material for a light fixture; one instance per fixture so it can flicker alone. */
export function fixtureMaterial(color: THREE.ColorRepresentation, intensity: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
}
