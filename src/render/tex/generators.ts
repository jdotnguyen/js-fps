/**
 * Procedural PBR texture sets (ADR-0002). Pure pixel math (no canvas, no DOM), so it
 * runs in Node for tests and previews, and can move to a worker later.
 *
 * Conventions:
 * - Row 0 is v = 0 (bottom), matching DataTexture with flipY = false. +v is "up".
 * - albedo: sRGB RGBA. orm: R unused (255), G roughness, B metalness (three.js reads
 *   roughness from G and metalness from B). normal: OpenGL tangent space (+Y up).
 * - One texture tile = 1 m unless noted.
 */
import { Rng } from '../../core/rng.ts';
import { clamp01, fbm, fract, lerp, mod, smoothstep, valueNoise } from './noise.ts';

export type Bytes = Uint8Array<ArrayBuffer>;
export type RGB = readonly [number, number, number];

export interface TexSet {
  readonly name: string;
  readonly size: number;
  readonly albedo: Bytes;
  readonly orm: Bytes;
  readonly normal: Bytes;
}

const STEEL: RGB = [0.6, 0.61, 0.63];
const RUST: RGB = [0.34, 0.16, 0.07];
const GRIME: RGB = [0.07, 0.064, 0.055];

class Writer {
  readonly size: number;
  readonly albedo: Bytes;
  readonly orm: Bytes;
  readonly height: Float32Array<ArrayBuffer>;
  constructor(size: number) {
    this.size = size;
    this.albedo = new Uint8Array(size * size * 4);
    this.orm = new Uint8Array(size * size * 4);
    this.height = new Float32Array(size * size);
  }
  color(i: number, c: readonly number[], alpha = 1): void {
    const j = i * 4;
    this.albedo[j] = byte(c[0] ?? 0);
    this.albedo[j + 1] = byte(c[1] ?? 0);
    this.albedo[j + 2] = byte(c[2] ?? 0);
    this.albedo[j + 3] = byte(alpha);
  }
  surface(i: number, roughness: number, metalness: number): void {
    const j = i * 4;
    this.orm[j] = 255;
    this.orm[j + 1] = byte(roughness);
    this.orm[j + 2] = byte(metalness);
    this.orm[j + 3] = 255;
  }
  finish(name: string, normalStrength: number): TexSet {
    return {
      name,
      size: this.size,
      albedo: this.albedo,
      orm: this.orm,
      normal: normalFromHeight(this.height, this.size, normalStrength),
    };
  }
}

function byte(x: number): number {
  return (clamp01(x) * 255 + 0.5) | 0;
}

/** Mix colour `a` toward `b` by t, in place on `a`. */
function mixInto(a: number[], b: RGB, t: number): void {
  a[0] = lerp(a[0] ?? 0, b[0], t);
  a[1] = lerp(a[1] ?? 0, b[1], t);
  a[2] = lerp(a[2] ?? 0, b[2], t);
}

/** Sobel-free central differences with wrap-around, so tiling is seamless. */
export function normalFromHeight(h: Float32Array, size: number, strength: number): Bytes {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const yu = mod(y + 1, size) * size;
    const yd = mod(y - 1, size) * size;
    const row = y * size;
    for (let x = 0; x < size; x++) {
      const xl = mod(x - 1, size);
      const xr = mod(x + 1, size);
      const dx = (h[row + xr]! - h[row + xl]!) * 0.5 * strength;
      const dy = (h[yu + x]! - h[yd + x]!) * 0.5 * strength;
      const len = Math.hypot(dx, dy, 1);
      const j = (row + x) * 4;
      out[j] = byte((-dx / len) * 0.5 + 0.5);
      out[j + 1] = byte((-dy / len) * 0.5 + 0.5);
      out[j + 2] = byte((1 / len) * 0.5 + 0.5);
      out[j + 3] = 255;
    }
  }
  return out;
}

/** Thin random scratches as a [0,1] field, rasterised by stepping along bent lines. */
export function scratchField(size: number, count: number, seed: number, minLen: number, maxLen: number): Float32Array<ArrayBuffer> {
  const f = new Float32Array(size * size);
  const rng = new Rng(seed);
  for (let k = 0; k < count; k++) {
    let x = rng.next() * size;
    let y = rng.next() * size;
    let ang = rng.next() * Math.PI;
    const len = lerp(minLen, maxLen, rng.next());
    const strength = 0.4 + 0.6 * rng.next();
    const bend = (rng.next() - 0.5) * 0.01;
    for (let s = 0; s < len; s++) {
      x += Math.cos(ang);
      y += Math.sin(ang);
      ang += bend;
      const i = mod(Math.round(y), size) * size + mod(Math.round(x), size);
      f[i] = Math.max(f[i]!, strength * (1 - (s / len) * 0.6));
    }
  }
  return f;
}

export interface PaintOptions {
  seed: number;
  paint: RGB;
  /** Sub-panels per side inside one panel texture. */
  subdiv: number;
  wear: number;
  grime: number;
  rivets: boolean;
}

/**
 * Painted metal panel: seams, bevels, rivets, dents, edge wear to bare steel, rust in
 * the wear, grime streaks running down from upper seams and pooling at lower ones.
 * One texture = one wall panel (mapped 0..1 onto a panel face).
 */
export function paintedMetal(size: number, o: PaintOptions): TexSet {
  const w = new Writer(size);
  const cell = size / o.subdiv;
  const px = size / 512; // feature sizes are authored at 512 px
  const rivetR = 4.6 * px;
  const inset = cell * 0.075;
  const rivets: Array<[number, number]> = [];
  for (const rx of [inset, cell / 2, cell - inset]) {
    for (const ry of [inset, cell / 2, cell - inset]) {
      if (rx !== cell / 2 || ry !== cell / 2) rivets.push([rx, ry]);
    }
  }
  const scratch = scratchField(size, 30, o.seed + 91, 6 * px, 40 * px);
  const c: number[] = [0, 0, 0];

  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = (x + 0.5) / size;
      const cx = (x + 0.5) % cell;
      const cy = (y + 0.5) % cell;
      const de = Math.min(cx, cell - cx, cy, cell - cy) / px; // px@512 to nearest seam
      const lv = cy / cell;

      let rd = Infinity;
      if (o.rivets) {
        for (const [rx, ry] of rivets) rd = Math.min(rd, Math.hypot(cx - rx, cy - ry));
      }
      const rivet = rd < rivetR ? Math.sqrt(1 - (rd / rivetR) ** 2) : 0;
      const rivetNear = rd < rivetR * 2.4 ? 1 - rd / (rivetR * 2.4) : 0;

      const groove = 1 - smoothstep(0, 2.5, de);
      const bevel = smoothstep(2.5, 8, de);
      const dents = fbm(u, v, 3, 3, 4, o.seed) - 0.5;
      const sc = scratch[i]!;

      const wearN = fbm(u, v, 8, 8, 5, o.seed + 11);
      const edge = 1 - smoothstep(0, 10, de);
      const wear = smoothstep(0.6, 0.7, wearN * 0.8 + (edge * 0.5 + rivetNear * 0.35) * o.wear + sc * 0.22);
      const rust = wear * smoothstep(0.5, 0.72, fbm(u, v, 6, 6, 4, o.seed + 41));

      const blotch = fbm(u, v, 4, 4, 5, o.seed + 31);
      const streak = valueNoise(u * 64, v * 3, 64, 3, o.seed + 23);
      const drip = smoothstep(0.55, 0.92, streak) * smoothstep(0.25, 1, lv);
      const pool = Math.pow(1 - lv, 7);
      const grime = clamp01(((blotch - 0.42) * 1.8 + drip * 0.75 + pool * 0.6) * o.grime + groove * 0.7);
      const fine = valueNoise(u * 256, v * 256, 256, 256, o.seed + 5);

      w.height[i] = bevel * 0.25 - groove * 0.55 + rivet * 0.5 + dents * 0.12 - wear * 0.06 - sc * 0.05;

      const k = 0.86 + 0.22 * blotch + 0.05 * fine;
      c[0] = o.paint[0] * k;
      c[1] = o.paint[1] * k;
      c[2] = o.paint[2] * k;
      const steelK = 0.85 + 0.3 * fine;
      mixInto(c, [STEEL[0] * steelK, STEEL[1] * steelK, STEEL[2] * steelK], wear);
      mixInto(c, RUST, rust * 0.85);
      mixInto(c, GRIME, grime * 0.78);
      w.color(i, c);

      let rough = lerp(0.52 + 0.1 * fine, 0.3, wear);
      rough = lerp(rough, 0.88, rust * 0.85);
      rough = lerp(rough, 0.86, grime * 0.6);
      w.surface(i, rough, wear * (1 - rust));
    }
  }
  return w.finish('painted-' + o.seed, 3);
}

/** Brushed steel with smudges and scratches. */
export function brushedSteel(size: number, seed: number): TexSet {
  const w = new Writer(size);
  const px = size / 512;
  const scratch = scratchField(size, 120, seed + 3, 10 * px, 90 * px);
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = (x + 0.5) / size;
      const brush = fbm(u, v, 2, 160, 4, seed);
      const smudge = fbm(u, v, 3, 3, 5, seed + 7);
      const fine = valueNoise(u * 256, v * 256, 256, 256, seed + 9);
      const sc = scratch[i]!;
      const smear = smoothstep(0.55, 0.78, smudge);
      w.height[i] = brush * 0.12 + fine * 0.04 - sc * 0.1;
      const g = 0.5 + brush * 0.16 - smear * 0.12 + sc * 0.12;
      w.color(i, [g * 0.98, g, g * 1.03]);
      w.surface(i, 0.26 + brush * 0.14 + smear * 0.28 - sc * 0.1, 1);
    }
  }
  return w.finish('brushed-steel', 2);
}

/** Classic diamond-tread floor plate; tops polished, dirt in the valleys. */
export function diamondPlate(size: number, seed: number, tiles = 12): TexSet {
  const w = new Writer(size);
  const px = size / 512;
  const scratch = scratchField(size, 90, seed + 5, 12 * px, 80 * px);
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = (x + 0.5) / size;
      const a = (u + v) * tiles;
      const b = (u - v) * tiles;
      const fa = fract(a) - 0.5;
      const fb = fract(b) - 0.5;
      const checker = mod(Math.floor(a) + Math.floor(b), 2) === 1;
      const along = checker ? fa : fb;
      const across = checker ? fb : fa;
      const e = (along / 0.36) ** 2 + (across / 0.11) ** 2;
      const bump = e < 1 ? Math.sqrt(1 - e) : 0;
      const dirtN = fbm(u, v, 16, 16, 4, seed + 13, 0.6);
      const valley = 1 - smoothstep(0, 0.4, bump);
      const dirt = valley * (0.25 + 0.75 * smoothstep(0.5, 0.66, dirtN));
      const fine = valueNoise(u * 256, v * 256, 256, 256, seed + 17);
      const sc = scratch[i]!;
      w.height[i] = bump * 0.65 + fine * 0.03 - sc * 0.08;
      const g = 0.4 + bump * 0.14 + fine * 0.05 + sc * 0.1;
      const c = [g * 0.97, g, g * 1.02];
      mixInto(c, GRIME, dirt * 0.6);
      mixInto(c, RUST, dirt * smoothstep(0.62, 0.8, dirtN) * 0.25);
      w.color(i, c);
      w.surface(i, clamp01(0.46 - bump * 0.24 + dirt * 0.3 - sc * 0.1), 1 - dirt * 0.5);
    }
  }
  return w.finish('diamond-plate', 4);
}

/** Square floor grating with cut-out holes in albedo alpha (use alphaTest). */
export function grating(size: number, seed: number, cells = 12, barWidth = 0.22): TexSet {
  const w = new Writer(size);
  const half = barWidth / 2;
  const aa = cells / size; // one pixel in cell units
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = (x + 0.5) / size;
      const gx = fract(u * cells);
      const gy = fract(v * cells);
      const dx = Math.min(gx, 1 - gx);
      const dy = Math.min(gy, 1 - gy);
      const solid = Math.max(1 - smoothstep(half - aa, half + aa, dx), 1 - smoothstep(half - aa, half + aa, dy));
      const crown = Math.max(1 - dx / half, 1 - dy / half, 0);
      const joint = (1 - smoothstep(0, half, dx)) * (1 - smoothstep(0, half, dy));
      const n = fbm(u, v, 6, 6, 4, seed);
      const rust = clamp01(joint * 0.8 + smoothstep(0.6, 0.8, n) * 0.6);
      w.height[i] = solid * (0.4 + crown * 0.3);
      const g = 0.34 + crown * 0.1 + n * 0.08;
      const c = [g, g * 1.01, g * 1.03];
      mixInto(c, RUST, rust * 0.7);
      w.color(i, c, solid);
      w.surface(i, 0.55 + rust * 0.3 - crown * 0.15, 0.9 - rust * 0.5);
    }
  }
  return w.finish('grating', 3);
}

/** Studded rubber matting with dust in the valleys. */
export function rubberStuds(size: number, seed: number, studs = 10): TexSet {
  const w = new Writer(size);
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = (x + 0.5) / size;
      const fx = fract(u * studs) - 0.5;
      const fy = fract(v * studs) - 0.5;
      const d = Math.hypot(fx, fy) / 0.27;
      const stud = smoothstep(1, 0.82, d);
      const dust = smoothstep(0.45, 0.75, fbm(u, v, 4, 4, 5, seed)) * (1 - stud);
      const fine = valueNoise(u * 256, v * 256, 256, 256, seed + 1);
      w.height[i] = stud * 0.5 + fine * 0.05;
      const g = 0.075 + fine * 0.02 - stud * 0.01;
      const c = [g, g, g * 1.05];
      mixInto(c, [0.2, 0.19, 0.17], dust * 0.6);
      w.color(i, c);
      w.surface(i, 0.86 - stud * 0.18 + dust * 0.08, 0);
    }
  }
  return w.finish('rubber', 3);
}

/** Solid yellow hazard paint (diagonal stripes removed), chipped to steel, with grime. */
export function hazardStripes(size: number, seed: number): TexSet {
  const w = new Writer(size);
  const px = size / 512;
  const scratch = scratchField(size, 80, seed + 8, 6 * px, 50 * px);
  const YELLOW: RGB = [0.8, 0.58, 0.05];
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = (x + 0.5) / size;
      const wearN = fbm(u, v, 8, 8, 5, seed);
      const sc = scratch[i]!;
      const wear = smoothstep(0.66, 0.74, wearN + sc * 0.35);
      const grime = smoothstep(0.4, 0.8, fbm(u, v, 3, 3, 5, seed + 4)) * 0.7;
      const fine = valueNoise(u * 256, v * 256, 256, 256, seed + 2);
      w.height[i] = -wear * 0.3 - sc * 0.05 + fine * 0.03;
      const c = [YELLOW[0], YELLOW[1], YELLOW[2]];
      mixInto(c, STEEL, wear);
      mixInto(c, GRIME, grime);
      w.color(i, c);
      w.surface(i, lerp(0.58, 0.34, wear) + grime * 0.25, wear);
    }
  }
  return w.finish('hazard', 3);
}

/**
 * Clean satin safety-yellow industrial coating with subtle micro-grain and zero grime or wear.
 */
export function hazardClean(size: number, seed: number): TexSet {
  const w = new Writer(size);
  const YELLOW: RGB = [0.86, 0.65, 0.08];
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = (x + 0.5) / size;
      const fine = valueNoise(u * 256, v * 256, 256, 256, seed + 2);
      const grain = (fine - 0.5) * 0.025;
      w.height[i] = grain;
      w.color(i, [YELLOW[0] + grain, YELLOW[1] + grain * 0.8, YELLOW[2]]);
      w.surface(i, 0.42 + (fine - 0.5) * 0.04, 0.05);
    }
  }
  return w.finish('hazardClean', 2);
}

/**
 * 0.5 m x 0.5 m laboratory epoxy/ceramic floor tiles with grout seams, subtle per-tile
 * tint variation, and light scuffing.
 */
export function labTile(size: number, seed: number): TexSet {
  const w = new Writer(size);
  const cell = size / 2;
  const px = size / 512;
  const scratch = scratchField(size, 45, seed + 17, 6 * px, 36 * px);
  const GROUT: RGB = [0.18, 0.19, 0.2];

  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    const ty = Math.floor(((y + 0.5) / size) * 2);
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = (x + 0.5) / size;
      const tx = Math.floor(((x + 0.5) / size) * 2);
      const cx = (x + 0.5) % cell;
      const cy = (y + 0.5) % cell;
      const de = Math.min(cx, cell - cx, cy, cell - cy) / px;

      const grout = 1 - smoothstep(1.5, 4.5, de);
      const bevel = smoothstep(4.5, 9, de);
      const tileTint = (((tx * 37 + ty * 91 + seed) & 7) - 3.5) * 0.012;
      const blotch = fbm(u, v, 4, 4, 4, seed + 5);
      const fine = valueNoise(u * 256, v * 256, 256, 256, seed + 9);
      const sc = scratch[i]!;
      const grime = smoothstep(0.45, 0.85, fbm(u, v, 3, 3, 4, seed + 29)) * 0.38;

      w.height[i] = bevel * 0.2 - grout * 0.5 - sc * 0.06 + fine * 0.02;

      const k = 0.94 + tileTint + (blotch - 0.5) * 0.1 + fine * 0.04;
      const c = [0.56 * k, 0.59 * k, 0.61 * k];
      mixInto(c, [0.42, 0.44, 0.46], sc * 0.45);
      mixInto(c, GROUT, grout);
      mixInto(c, GRIME, grime * 0.5);
      w.color(i, c);

      const rough = lerp(0.36 + fine * 0.08 + sc * 0.25 + grime * 0.35, 0.88, grout);
      w.surface(i, rough, 0);
    }
  }
  return w.finish('labTile', 2.5);
}

/** Poured underground concrete with aggregate grain, subtle pour seams, and dampness. */
export function concrete(size: number, seed: number): TexSet {
  const w = new Writer(size);
  const px = size / 512;

  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    const seamDist = Math.min(y + 0.5, size - (y + 0.5)) / px;
    const seam = 1 - smoothstep(0, 3.5, seamDist);
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = (x + 0.5) / size;
      const macro = fbm(u, v, 3, 3, 4, seed);
      const mid = fbm(u, v, 12, 12, 4, seed + 13);
      const grain = valueNoise(u * 256, v * 256, 256, 256, seed + 29);
      const damp = smoothstep(0.55, 0.85, macro);

      w.height[i] = (mid - 0.5) * 0.25 + (grain - 0.5) * 0.12 - seam * 0.4;

      const base = 0.34 + (macro - 0.5) * 0.1 + (mid - 0.5) * 0.08 + (grain - 0.5) * 0.06;
      const c = [base, base * 1.01, base * 1.03];
      mixInto(c, GRIME, damp * 0.35 + seam * 0.5);
      w.color(i, c);
      w.surface(i, lerp(0.92, 0.72, damp * 0.6), 0);
    }
  }
  return w.finish('concrete', 3.5);
}

/** Every texture the demo room and lab use, keyed for the material library and previews. */
export const TEXTURE_SPECS = {
  paintTeal: (s: number) => paintedMetal(s, { seed: 101, paint: [0.3, 0.4, 0.41], subdiv: 2, wear: 0.7, grime: 0.7, rivets: true }),
  paintDark: (s: number) => paintedMetal(s, { seed: 202, paint: [0.16, 0.18, 0.19], subdiv: 2, wear: 0.9, grime: 0.8, rivets: true }),
  paintBone: (s: number) => paintedMetal(s, { seed: 303, paint: [0.64, 0.61, 0.53], subdiv: 1, wear: 0.5, grime: 0.9, rivets: false }),
  steel: (s: number) => brushedSteel(s, 404),
  diamond: (s: number) => diamondPlate(s, 505),
  grating: (s: number) => grating(s, 606),
  rubber: (s: number) => rubberStuds(s, 707),
  hazard: (s: number) => hazardStripes(s, 808),
  /** Clean satin safety-yellow coating (no grime or wear). */
  hazardClean: (s: number) => hazardClean(s, 808),
  labTile: (s: number) => labTile(s, 909),
  labPanel: (s: number) => paintedMetal(s, { seed: 1010, paint: [0.7, 0.73, 0.75], subdiv: 2, wear: 0.25, grime: 0.35, rivets: false }),
  concrete: (s: number) => concrete(s, 1111),
} as const satisfies Record<string, (size: number) => TexSet>;

export type TextureKey = keyof typeof TEXTURE_SPECS;
