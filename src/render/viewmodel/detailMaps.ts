import * as THREE from 'three';

/** Small tileable detail textures for first-person hands and gear (generated at boot). */

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Tileable value noise: `period` lattice cells across the texture. */
function valueNoise(u: number, v: number, period: number, seed: number): number {
  const x = u * period;
  const y = v * period;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const w = (i: number): number => ((i % period) + period) % period;
  const a = hash2(w(x0), w(y0), seed);
  const b = hash2(w(x0 + 1), w(y0), seed);
  const c = hash2(w(x0), w(y0 + 1), seed);
  const d = hash2(w(x0 + 1), w(y0 + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export type HeightFn = (u: number, v: number) => number;

/** Convert a height function over [0,1)^2 into a tileable tangent-space normal map. */
export function normalMapFromHeight(size: number, height: HeightFn, strength: number): THREE.DataTexture {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[x + y * size] = height(x / size, y / size);
  const data = new Uint8Array(size * size * 4);
  const at = (x: number, y: number): number => h[((x + size) % size) + ((y + size) % size) * size]!;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const o = (x + y * size) * 4;
      data[o] = Math.round((-dx / l * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round((-dy / l * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Skin micro-relief: fine pores over soft mottling and faint dermal ridges. */
export function skinNormalMap(size = 256): THREE.DataTexture {
  return normalMapFromHeight(
    size,
    (u, v) => {
      const soft = valueNoise(u, v, 6, 1) * 0.5 + valueNoise(u, v, 12, 2) * 0.25;
      const pores = Math.pow(1 - Math.abs(valueNoise(u, v, 48, 3) * 2 - 1), 4) * 0.35 + Math.pow(valueNoise(u, v, 96, 4), 3) * 0.25;
      const ridge = Math.sin((u * 3 + valueNoise(u, v, 8, 5) * 0.6) * Math.PI * 2 * 14) * 0.06;
      return soft * 0.6 + pores - ridge;
    },
    2.4,
  );
}

/** Woven uniform cloth: twill weave over low-frequency noise. */
export function fabricNormalMap(size = 256): THREE.DataTexture {
  return normalMapFromHeight(
    size,
    (u, v) => {
      const t = 48;
      const a = Math.sin((u + v) * Math.PI * 2 * t);
      const b = Math.sin((u - v) * Math.PI * 2 * t);
      return (Math.abs(a) * 0.5 + Math.abs(b) * 0.5) * 0.35 + valueNoise(u, v, 24, 7) * 0.25;
    },
    1.6,
  );
}

/** Grippy stipple used on the pistol grip and the shotgun pump. */
export function stippleNormalMap(size = 256): THREE.DataTexture {
  return normalMapFromHeight(
    size,
    (u, v) => {
      const g = 24;
      const x = (u * g) % 1 - 0.5;
      const y = (v * g) % 1 - 0.5;
      const cell = Math.max(0, 1 - Math.hypot(x, y) * 2.3);
      return cell * cell * 0.9 + valueNoise(u, v, 64, 9) * 0.12;
    },
    3.2,
  );
}

/** Brushed/machined steel streaks along u. */
export function brushedNormalMap(size = 256): THREE.DataTexture {
  return normalMapFromHeight(size, (u, v) => valueNoise(u * 0.1, v, 64, 11) * 0.5 + valueNoise(u * 0.2, v, 128, 12) * 0.3, 1.2);
}

export { valueNoise };
