import * as THREE from 'three';

/**
 * Room-coloured bounce light (openspec change room-light-response, design D5): one `LightProbe` per level whose
 * spherical harmonics come from the camera room's capture, normalised so the room's authored ambient preset still
 * sets the overall level. The probe carries a share `w` of the ambient; the hemisphere keeps `1 - w`.
 */

/** Share of the room's ambient carried by the probe (design D5; tuned in task 4.3). */
export const BOUNCE_SHARE = 0.6;

/** The L0 band's average irradiance factor in three's `shGetIrradianceAt` (the other bands average to zero). */
const L0_IRRADIANCE = 0.886227;

const luminance = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Project six cube faces (RGBA floats, `size` × `size`, in WebGL face order +X −X +Y −Y +Z −Z) onto 9 spherical
 * harmonic coefficients of radiance. Same texel directions and solid-angle weights as three's
 * `LightProbeGenerator.fromCubeRenderTarget`; `flip` is −1 for the WebGL coordinate system.
 */
export function projectCubeSh(faces: readonly Float32Array[], size: number, flip = -1): THREE.SphericalHarmonics3 {
  const sh = new THREE.SphericalHarmonics3();
  const c = sh.coefficients;
  const basis = new Array<number>(9).fill(0);
  const coord = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const pixel = 2 / size;
  let total = 0;
  for (let face = 0; face < 6; face++) {
    const data = faces[face]!;
    for (let i = 0; i < size * size; i++) {
      const r = data[i * 4]!;
      const g = data[i * 4 + 1]!;
      const b = data[i * 4 + 2]!;
      const col = (1 - ((i % size) + 0.5) * pixel) * flip;
      const row = 1 - (Math.floor(i / size) + 0.5) * pixel;
      switch (face) {
        case 0:
          coord.set(-1 * flip, row, col * flip);
          break;
        case 1:
          coord.set(1 * flip, row, -col * flip);
          break;
        case 2:
          coord.set(col, 1, -row);
          break;
        case 3:
          coord.set(col, -1, row);
          break;
        case 4:
          coord.set(col, row, 1);
          break;
        default:
          coord.set(-col, row, -1);
      }
      const lengthSq = coord.lengthSq();
      const weight = 4 / (Math.sqrt(lengthSq) * lengthSq);
      total += weight;
      dir.copy(coord).normalize();
      THREE.SphericalHarmonics3.getBasisAt(dir, basis);
      for (let j = 0; j < 9; j++) {
        c[j]!.x += basis[j]! * r * weight;
        c[j]!.y += basis[j]! * g * weight;
        c[j]!.z += basis[j]! * b * weight;
      }
    }
  }
  const norm = (4 * Math.PI) / total;
  for (const v of c) v.multiplyScalar(norm);
  return sh;
}

/** An ambient preset as the level holds it (`AMBIENT`, `BACKUP_AMBIENT`, or a recoloured `room.ambient`). */
export interface AmbientLevel {
  sky: THREE.Color;
  ground: THREE.Color;
  intensity: number;
}

/** A hemisphere light's irradiance averaged over every normal: the mean of its two colours times its intensity. */
export function hemisphereAverage(a: AmbientLevel): number {
  return 0.5 * (luminance(a.sky.r, a.sky.g, a.sky.b) + luminance(a.ground.r, a.ground.g, a.ground.b)) * a.intensity;
}

/** A probe's irradiance averaged over every normal (luminance of its L0 band), at intensity 1. */
export function probeAverage(sh: THREE.SphericalHarmonics3): number {
  const c0 = sh.coefficients[0]!;
  return luminance(c0.x, c0.y, c0.z) * L0_IRRADIANCE;
}

/**
 * Scale a capture's raw coefficients so the probe's average irradiance is `w` times the preset's (design D5). The
 * colour and direction come from the capture; the strength from the preset. A black capture (a room with every
 * light out) gives a flat probe in the preset's own colours, so the total still matches.
 */
export function normaliseProbe(raw: THREE.SphericalHarmonics3, preset: AmbientLevel, w: number, out: THREE.SphericalHarmonics3): THREE.SphericalHarmonics3 {
  const target = w * hemisphereAverage(preset);
  const have = probeAverage(raw);
  if (have > 1e-6) {
    const k = target / have;
    for (let j = 0; j < 9; j++) out.coefficients[j]!.copy(raw.coefficients[j]!).multiplyScalar(k);
    return out;
  }
  for (const v of out.coefficients) v.set(0, 0, 0);
  const mean = new THREE.Color().copy(preset.sky).add(preset.ground).multiplyScalar(0.5);
  const lum = luminance(mean.r, mean.g, mean.b);
  if (lum > 1e-6) {
    const k = target / (lum * L0_IRRADIANCE);
    out.coefficients[0]!.set(mean.r * k, mean.g * k, mean.b * k);
  }
  return out;
}

/** Move `probe` toward `target` by fraction `k` (the same rate as the hemisphere). */
export function lerpSh(probe: THREE.SphericalHarmonics3, target: THREE.SphericalHarmonics3, k: number): void {
  for (let j = 0; j < 9; j++) probe.coefficients[j]!.lerp(target.coefficients[j]!, k);
}
