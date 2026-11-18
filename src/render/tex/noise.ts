/** Tileable noise helpers for procedural textures. Pure functions, no DOM. */

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const fract = (x: number): number => x - Math.floor(x);
export const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** Hermite smoothstep; works with reversed edges (e0 > e1). */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Integer lattice hash -> [0, 1). */
export function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Value noise in lattice units that tiles with integer periods px, py:
 * valueNoise(x + px, y, px, py) === valueNoise(x, y, px, py).
 */
export function valueNoise(x: number, y: number, px: number, py: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const fx = tx * tx * (3 - 2 * tx);
  const fy = ty * ty * (3 - 2 * ty);
  const ax = mod(x0, px);
  const bx = mod(x0 + 1, px);
  const ay = mod(y0, py);
  const by = mod(y0 + 1, py);
  const a = hash2(ax, ay, seed);
  const b = hash2(bx, ay, seed);
  const c = hash2(ax, by, seed);
  const d = hash2(bx, by, seed);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}

/**
 * Fractal value noise over u, v in [0, 1), tiling across the texture.
 * px/py are the base lattice periods; unequal values give streaks.
 */
export function fbm(u: number, v: number, px: number, py: number, octaves: number, seed: number, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let fx = px;
  let fy = py;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(u * fx, v * fy, fx, fy, seed + o * 1013);
    norm += amp;
    amp *= gain;
    fx *= 2;
    fy *= 2;
  }
  return sum / norm;
}
