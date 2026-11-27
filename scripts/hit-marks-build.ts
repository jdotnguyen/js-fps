/**
 * Builds the claw mark atlas the grade draws when the player is hit (player-hit-feedback D4):
 * `public/assets/textures/fx/hit-marks.webp`, 2048x1024, lossless. Needs ImageMagick (`magick`) on PATH.
 *
 * The cuts are drawn here from a fixed seed, so the same sources give the same atlas; their wet detail comes from the
 * CC0 Texture Ninja blood decals in `public/assets/textures/blood/` (CREDITS.md).
 *
 * Cells (512 px, row 0 at the top; `src/render/hitMarks.ts` MARK_CELLS): four swipes along row 0, then two bites,
 * the slam and a spare. Channels: R the cut, G wet blood, B height (the grade bends the frame along its slope),
 * A the order the stroke is drawn in (0 first, 1 last). Art stays inside MARK_REACH of its cell.
 *
 * Usage: node --experimental-strip-types scripts/hit-marks-build.ts [--preview <png>]
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Rng } from '../src/core/rng.ts';
import { MARK_ATLAS, MARK_CELLS, MARK_REACH } from '../src/render/hitMarks.ts';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'public/assets/textures/fx/hit-marks.webp');
const CELL = 512;
/** The draw order never reaches 0: browsers may drop the colour under a fully clear texel. */
const FIRST = 8 / 255;

type Field = Float32Array;
type P = [number, number];
const field = (): Field => new Float32Array(CELL * CELL);
const clamp = (v: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, v));
const smooth = (a: number, b: number, v: number): number => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Value noise on a seeded lattice, -1..1. */
function noise(rng: Rng): (x: number, y: number) => number {
  const N = 256;
  const lattice = Float32Array.from({ length: N * N }, () => rng.range(-1, 1));
  const at = (x: number, y: number): number => lattice[(y & (N - 1)) * N + (x & (N - 1))]!;
  return (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = smooth(0, 1, x - ix);
    const fy = smooth(0, 1, y - iy);
    const top = at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx;
    const bottom = at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx;
    return top * (1 - fy) + bottom * fy;
  };
}

/** Stamp a soft disc, keeping the strongest value. */
function disc(f: Field, x: number, y: number, r: number, value = 1): void {
  const edge = 1.2;
  for (let py = Math.max(0, Math.floor(y - r - edge)); py <= Math.min(CELL - 1, Math.ceil(y + r + edge)); py++) {
    for (let px = Math.max(0, Math.floor(x - r - edge)); px <= Math.min(CELL - 1, Math.ceil(x + r + edge)); px++) {
      const v = value * clamp((r + edge - Math.hypot(px - x, py - y)) / (2 * edge));
      if (v > f[py * CELL + px]!) f[py * CELL + px] = v;
    }
  }
}

/** A tapered gash along a quadratic curve: thin start, a swelling torn middle, a fine flick. */
function gash(f: Field, a: P, bend: P, b: P, width: number, rng: Rng): void {
  const steps = 700;
  const torn = noise(rng);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const x = u * u * a[0] + 2 * u * t * bend[0] + t * t * b[0];
    const y = u * u * a[1] + 2 * u * t * bend[1] + t * t * b[1];
    const swell = Math.sin(Math.PI * t ** 0.72) ** 1.35;
    const ragged = 1 + 0.45 * torn(t * 38, 1.5) + 0.25 * torn(t * 110, 7.5);
    disc(f, x + 2.5 * torn(t * 26, 20), y + 2.5 * torn(t * 26, 40), Math.max(0.2, width * swell * ragged));
  }
}

/** Tear the edges: read the field through a small noise displacement. */
function roughen(f: Field, rng: Rng, amount: number): Field {
  const nx = noise(rng);
  const ny = noise(rng);
  const out = field();
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const sx = Math.round(clamp(x + amount * (nx(x / 7, y / 7) + 0.5 * nx(x / 2.5, y / 2.5)), 0, CELL - 1));
      const sy = Math.round(clamp(y + amount * (ny(x / 7, y / 7) + 0.5 * ny(x / 2.5, y / 2.5)), 0, CELL - 1));
      out[y * CELL + x] = f[sy * CELL + sx]!;
    }
  }
  return out;
}

function blur(f: Field, radius: number): Field {
  const pass = (src: Field, across: boolean): Field => {
    const out = field();
    const span = 2 * radius + 1;
    for (let line = 0; line < CELL; line++) {
      const index = (i: number): number => (across ? line * CELL + i : i * CELL + line);
      let sum = 0;
      for (let i = -radius; i <= radius; i++) sum += src[index(clamp(i, 0, CELL - 1))]!;
      for (let i = 0; i < CELL; i++) {
        out[index(i)] = sum / span;
        sum += src[index(clamp(i + radius + 1, 0, CELL - 1))]! - src[index(clamp(i - radius, 0, CELL - 1))]!;
      }
    }
    return out;
  };
  let out = f;
  for (let k = 0; k < 3; k++) out = pass(pass(out, true), false);
  return out;
}

/** The coverage of a CC0 blood decal, drawn `size` px square at the centre, turned by `turn`. */
const decals = new Map<string, Uint8Array>();
function decal(name: string, size: number, turn: number, cx = CELL / 2, cy = CELL / 2): Field {
  let raw = decals.get(name);
  if (!raw) {
    raw = execFileSync('magick', [join(ROOT, `public/assets/textures/blood/${name}.webp`), '-resize', '512x512!', '-alpha', 'extract', '-depth', '8', 'gray:-'], { maxBuffer: 1 << 24 });
    decals.set(name, raw);
  }
  const out = field();
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const u = Math.round(((c * dx + s * dy) / size + 0.5) * 511);
      const v = Math.round(((-s * dx + c * dy) / size + 0.5) * 511);
      if (u >= 0 && u < 512 && v >= 0 && v < 512) out[y * CELL + x] = raw[v * 512 + u]! / 255;
    }
  }
  return out;
}

const merge = (...fields: Array<[Field, number]>): Field => {
  const out = field();
  for (const [f, k] of fields) for (let i = 0; i < out.length; i++) out[i] = Math.max(out[i]!, f[i]! * k);
  return out;
};

interface Art {
  cut: Field;
  wet: Field;
  /** Draw order at a pixel, before it is stretched to 0..1 over the art. */
  order: (x: number, y: number) => number;
}

/** Four rakes from upper left to lower right, each its own spread, bend and count. */
function swipe(variant: number): Art {
  const rng = new Rng(`hit-marks swipe ${variant}`);
  const shape = [
    { count: 3, gap: 58, bend: 46, angle: 0.78, width: 13 },
    { count: 4, gap: 46, bend: -34, angle: 0.62, width: 10 },
    { count: 3, gap: 72, bend: 20, angle: 0.98, width: 15 },
    { count: 4, gap: 40, bend: 66, angle: 0.74, width: 9 },
  ][variant]!;
  const f = field();
  const dir: P = [Math.cos(shape.angle), Math.sin(shape.angle)];
  const side: P = [-dir[1], dir[0]];
  const at = (along: number, across: number): P => [CELL / 2 + dir[0] * along + side[0] * across, CELL / 2 + dir[1] * along + side[1] * across];
  for (let i = 0; i < shape.count; i++) {
    const across = (i - (shape.count - 1) / 2) * shape.gap + rng.range(-9, 9);
    const middle = i > 0 && i < shape.count - 1;
    const half = (middle ? 182 : 148) + rng.range(-24, 14);
    const slide = rng.range(-22, 22);
    const width = shape.width * (middle ? 1.1 : 0.82) * rng.range(0.85, 1.15);
    gash(f, at(slide - half, across - rng.range(0, 12)), at(slide, across + shape.bend + rng.range(-8, 8)), at(slide + half, across + rng.range(0, 14)), width, rng);
    // Slivers torn loose beside the gash.
    for (let k = 0; k < 3; k++) {
      const s = slide + rng.range(-half * 0.7, half * 0.5);
      const off = across + shape.bend * 0.5 * (1 - (s / half) ** 2) + rng.range(12, 24) * (rng.chance(0.5) ? 1 : -1);
      gash(f, at(s, off), at(s + 18, off + rng.range(-3, 6)), at(s + rng.range(30, 62), off + rng.range(-2, 8)), rng.range(1.2, 3), rng);
    }
  }
  const cut = roughen(f, rng, 3.5);
  const spatter = decal(`spatter_0${[1, 4, 5, 1][variant]}`, 400, shape.angle - Math.PI * 0.35, ...at(30, shape.bend * 0.4));
  const halo = blur(cut, 7);
  const grain = noise(rng);
  const wet = field();
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const i = y * CELL + x;
      wet[i] = Math.max(clamp(halo[i]! * 2.2 * (0.7 + 0.5 * grain(x / 18, y / 18))), spatter[i]! * 0.8);
    }
  }
  return { cut, wet, order: (x, y) => x * dir[0] + y * dir[1] };
}

/** Two ragged arcs of tooth punctures, dragged off towards the lower left with a smear. */
function bite(variant: number): Art {
  const rng = new Rng(`hit-marks bite ${variant}`);
  const f = field();
  const tilt = variant === 0 ? -0.35 : 0.2;
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  const at = (x: number, y: number): P => [CELL / 2 + 20 + x * c - y * s, CELL / 2 - 10 + x * s + y * c];
  const teeth = variant === 0 ? 8 : 6;
  for (const jaw of [-1, 1]) {
    for (let i = 0; i < teeth; i++) {
      const t = (i / (teeth - 1)) * 2 - 1;
      const x = t * (variant === 0 ? 126 : 112) + rng.range(-8, 8);
      const y = jaw * (92 - 54 * t * t) + rng.range(-7, 7);
      const long = rng.range(30, 62) * (1 - 0.35 * Math.abs(t)) * (variant === 0 ? 1 : 1.25);
      // A tooth goes in and is dragged: a puncture with a tail pulled the way the head wrenches.
      disc(f, ...at(x, y), rng.range(7, 13));
      gash(f, at(x + 8, y - jaw * 8), at(x - long * 0.3, y - jaw * long * 0.45), at(x - long, y - jaw * long * 0.35 + 14), rng.range(6, 11), rng);
    }
  }
  const cut = roughen(f, rng, 4);
  const drag = decal(variant === 0 ? 'spatter_01' : 'spatter_05', 390, variant === 0 ? 0.9 : 1.5, ...at(-40, 18));
  const halo = blur(cut, 12);
  const grain = noise(rng);
  const wet = field();
  const pull: P = variant === 0 ? [-0.94, 0.34] : [-0.82, 0.57];
  const LENGTH = 110;
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const i = y * CELL + x;
      // The smear: blood pulled from each wound along the drag, thinning and streaking as it goes.
      let smeared = 0;
      for (let k = 4; k < LENGTH; k += 3) {
        const sx = Math.round(x - pull[0] * k);
        const sy = Math.round(y - pull[1] * k);
        if (sx < 0 || sx >= CELL || sy < 0 || sy >= CELL) break;
        smeared = Math.max(smeared, cut[sy * CELL + sx]! * (1 - k / LENGTH));
      }
      const across = x * pull[1] - y * pull[0];
      const streaks = clamp(0.75 + 0.9 * grain(across / 4.5, 11));
      wet[i] = Math.max(clamp(halo[i]! * 2.4 * (0.65 + 0.6 * grain(x / 26 + y / 90, y / 14))), clamp(smeared * 1.25 * streaks), drag[i]!);
    }
  }
  return { cut, wet, order: (x, y) => -x + 0.4 * y };
}

/** A crush along an edge: a broken band with fractures and spatter thrown up from it. */
function slam(): Art {
  const rng = new Rng('hit-marks slam');
  const f = field();
  // Above the cell's middle: the mark is centred just under the screen, so only the upper half of its band shows.
  const mid = CELL / 2 - 40;
  const lumps = noise(rng);
  for (let x = 24; x < CELL - 24; x += 2) {
    const weight = Math.sin((Math.PI * (x - 24)) / (CELL - 48));
    const r = Math.max(0, weight * (24 + 20 * lumps(x / 31, 3) + 12 * lumps(x / 9, 9)));
    disc(f, x, mid + 10 * lumps(x / 44, 5) + 16, r);
  }
  for (let k = 0; k < 34; k++) {
    let x = rng.range(52, CELL - 52);
    let y = mid + rng.range(-4, 18);
    const weight = Math.sin((Math.PI * (x - 24)) / (CELL - 48));
    let angle = -Math.PI / 2 + ((x - CELL / 2) / CELL) * 1.8 + rng.range(-0.35, 0.35);
    let width = rng.range(2.5, 6.5) * weight;
    for (let step = 0; step < 4; step++) {
      const reach = rng.range(7, 16) * weight; // short enough to end inside the cell's reach
      const nx = x + Math.cos(angle) * reach;
      const ny = y + Math.sin(angle) * reach;
      gash(f, [x, y], [(x + nx) / 2 + rng.range(-5, 5), (y + ny) / 2], [nx, ny], width, rng);
      x = nx;
      y = ny;
      angle += rng.range(-0.7, 0.7);
      width *= 0.66;
    }
  }
  const cut = roughen(f, rng, 5);
  const splash = merge([decal('smear_03', 300, 0, 160, mid - 20), 1], [decal('spatter_03', 280, 0.5, 350, mid - 14), 1], [decal('smear_01', 260, 1.57, CELL / 2, mid - 24), 0.9]);
  const halo = blur(cut, 10);
  const wet = field();
  for (let i = 0; i < wet.length; i++) wet[i] = Math.max(clamp(halo[i]! * 1.8), splash[i]!);
  return { cut, wet, order: (x) => Math.abs(x - CELL / 2) };
}

/** Pack one cell, fading anything outside the reach the picker keeps clear of the crosshair. */
function pack(atlas: Uint8Array, col: number, row: number, kind: keyof typeof MARK_REACH, art: Art): void {
  const reach = MARK_REACH[kind] * CELL;
  const window = (x: number, y: number): number => {
    const dx = x - CELL / 2;
    const dy = y - CELL / 2;
    const out = kind === 'slam' ? Math.abs(dy) : Math.hypot(dx, dy);
    return (1 - smooth(reach * 0.86, reach, out)) * smooth(0, 14, Math.min(x, y, CELL - 1 - x, CELL - 1 - y));
  };
  const height = blur(art.cut, 6);
  let lo = Infinity;
  let hi = -Infinity;
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      if (Math.max(art.cut[y * CELL + x]!, art.wet[y * CELL + x]!) * window(x, y) < 0.2) continue;
      lo = Math.min(lo, art.order(x, y));
      hi = Math.max(hi, art.order(x, y));
    }
  }
  const width = MARK_ATLAS.cols * CELL;
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const i = y * CELL + x;
      const w = window(x, y);
      const at = ((row * CELL + y) * width + col * CELL + x) * 4;
      atlas[at] = Math.round(255 * clamp(art.cut[i]! * w));
      atlas[at + 1] = Math.round(255 * clamp(art.wet[i]! * w));
      atlas[at + 2] = Math.round(255 * clamp(height[i]! * w));
      atlas[at + 3] = Math.round(255 * (FIRST + (1 - FIRST) * clamp((art.order(x, y) - lo) / (hi - lo))));
    }
  }
}

const width = MARK_ATLAS.cols * CELL;
const height = MARK_ATLAS.rows * CELL;
const atlas = new Uint8Array(width * height * 4);
for (let i = 3; i < atlas.length; i += 4) atlas[i] = 255;
MARK_CELLS.swipe.forEach(([c, r], v) => pack(atlas, c, r, 'swipe', swipe(v)));
MARK_CELLS.bite.forEach(([c, r], v) => pack(atlas, c, r, 'bite', bite(v)));
MARK_CELLS.slam.forEach(([c, r]) => pack(atlas, c, r, 'slam', slam()));

const raw = ['-size', `${width}x${height}`, '-depth', '8', 'rgba:-'];
mkdirSync(dirname(OUT), { recursive: true });
execFileSync('magick', [...raw, '-define', 'webp:lossless=true', '-define', 'webp:exact=true', '-define', 'webp:method=6', OUT], { input: atlas });
console.log(`wrote ${OUT}`);

const previewAt = process.argv.indexOf('--preview');
if (previewAt >= 0) {
  // The cuts and wet as the grade colours them, over a mid grey.
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const cut = atlas[i * 4]! / 255;
    const wet = atlas[i * 4 + 1]! / 255;
    let c = [118, 120, 124];
    c = c.map((v, k) => v + ([96, 8, 6][k]! - v) * wet * 0.65);
    c = c.map((v, k) => v + ([42, 3, 3][k]! - v) * cut);
    rgb.set(c.map(Math.round), i * 3);
  }
  execFileSync('magick', ['-size', `${width}x${height}`, '-depth', '8', 'rgb:-', '-resize', '1600x800', resolve(process.argv[previewAt + 1]!)], { input: rgb });
  console.log(`preview ${process.argv[previewAt + 1]}`);
}
