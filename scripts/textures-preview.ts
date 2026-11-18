/**
 * Writes contact sheets of every procedural texture to previews/<key>.png:
 * [albedo | normal | roughness | metalness]. Run: npm run textures:preview
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { TEXTURE_SPECS, type TexSet } from '../src/render/tex/generators.ts';
import { encodePng } from './png.ts';

const SIZE = Number(process.argv[2] ?? 512);
const OUT = new URL('../previews/', import.meta.url);
mkdirSync(OUT, { recursive: true });

function sheet(t: TexSet): Uint8Array {
  const s = t.size;
  const W = s * 4;
  const out = new Uint8Array(W * s * 4);
  for (let y = 0; y < s; y++) {
    const src = (s - 1 - y) * s; // flip: texture row 0 is the bottom
    for (let x = 0; x < s; x++) {
      const i = (src + x) * 4;
      const a = t.albedo[i + 3]! / 255;
      // Composite cut-outs over dark grey so holes read in the preview.
      const bg = 40;
      const tiles: Array<[number, number, number]> = [
        [t.albedo[i]! * a + bg * (1 - a), t.albedo[i + 1]! * a + bg * (1 - a), t.albedo[i + 2]! * a + bg * (1 - a)],
        [t.normal[i]!, t.normal[i + 1]!, t.normal[i + 2]!],
        [t.orm[i + 1]!, t.orm[i + 1]!, t.orm[i + 1]!],
        [t.orm[i + 2]!, t.orm[i + 2]!, t.orm[i + 2]!],
      ];
      tiles.forEach(([r, g, b], k) => {
        const o = (y * W + k * s + x) * 4;
        out[o] = r;
        out[o + 1] = g;
        out[o + 2] = b;
        out[o + 3] = 255;
      });
    }
  }
  return out;
}

for (const [key, make] of Object.entries(TEXTURE_SPECS)) {
  const t0 = performance.now();
  const t = make(SIZE);
  const ms = (performance.now() - t0).toFixed(0);
  writeFileSync(new URL(`${key}.png`, OUT), encodePng(SIZE * 4, SIZE, sheet(t)));
  console.log(`${key.padEnd(10)} ${ms} ms`);
}

// Overview: every albedo in a 4 x 2 grid -> previews/all-albedo.png
{
  const entries = Object.entries(TEXTURE_SPECS);
  const cols = 4;
  const rows = Math.ceil(entries.length / cols);
  const W = SIZE * cols;
  const out = new Uint8Array(W * SIZE * rows * 4);
  entries.forEach(([, make], k) => {
    const t = make(SIZE);
    const ox = (k % cols) * SIZE;
    const oy = Math.floor(k / cols) * SIZE;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const i = ((SIZE - 1 - y) * SIZE + x) * 4;
        const a = t.albedo[i + 3]! / 255;
        const o = ((oy + y) * W + ox + x) * 4;
        for (let c = 0; c < 3; c++) out[o + c] = t.albedo[i + c]! * a + 40 * (1 - a);
        out[o + 3] = 255;
      }
    }
  });
  writeFileSync(new URL('all-albedo.png', OUT), encodePng(W, SIZE * rows, out));
  console.log('all-albedo.png written');
}
