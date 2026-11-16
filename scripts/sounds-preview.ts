/**
 * Renders every procedural sound to previews/sounds/<name>.wav (variant 0; loops
 * repeated 3x so you can hear the seam), prints levels, and writes a spectrogram
 * sheet previews/sounds/spectrograms.png. Run: npm run sounds:preview
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { Rng } from '../src/core/rng.ts';
import { stats } from '../src/audio/dsp.ts';
import { SOUND_SPECS } from '../src/audio/sounds.ts';
import { encodePng } from './png.ts';

const SR = 48000;
const OUT = new URL('../previews/sounds/', import.meta.url);
mkdirSync(OUT, { recursive: true });

function wav(samples: Float32Array, sr: number): Buffer {
  const out = Buffer.alloc(44 + samples.length * 2);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(36 + samples.length * 2, 4);
  out.write('WAVEfmt ', 8, 'ascii');
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20); // PCM
  out.writeUInt16LE(1, 22); // mono
  out.writeUInt32LE(sr, 24);
  out.writeUInt32LE(sr * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36, 'ascii');
  out.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767), 44 + i * 2);
  }
  return out;
}

/** In-place radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b]! * wr - im[b]! * wi;
        const xi = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a] = re[a]! + xr;
        im[a] = im[a]! + xi;
      }
    }
  }
}

const ROW_H = 96;
const COLS = 480;
const LABEL_W = 0;
const N = 2048;
const names = Object.keys(SOUND_SPECS) as Array<keyof typeof SOUND_SPECS>;
const sheet = new Uint8Array((LABEL_W + COLS) * ROW_H * names.length * 4);
const fMin = 25;
const fMax = 12000;

console.log('name             len(s)  peak dBFS  rms dBFS');
names.forEach((name, row) => {
  const spec = SOUND_SPECS[name];
  const s = spec.make(SR, new Rng(`${name}:0`));
  const out = spec.loop ? Float32Array.from({ length: s.length * 3 }, (_, i) => s[i % s.length]!) : s;
  writeFileSync(new URL(`${name}.wav`, OUT), wav(out, SR));
  const st = stats(s);
  const db = (x: number): string => (20 * Math.log10(Math.max(x, 1e-9))).toFixed(1).padStart(8);
  console.log(`${name.padEnd(16)} ${(s.length / SR).toFixed(2).padStart(6)} ${db(st.peak)}  ${db(st.rms)}`);

  // Spectrogram row: time across, log-frequency up, dB brightness.
  const hop = Math.max(1, Math.floor((s.length - N) / COLS));
  for (let c = 0; c < COLS; c++) {
    const start = Math.min(c * hop, Math.max(0, s.length - N));
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
      re[i] = (s[start + i] ?? 0) * w;
    }
    fft(re, im);
    for (let y = 0; y < ROW_H; y++) {
      const f = fMin * Math.pow(fMax / fMin, 1 - y / (ROW_H - 1));
      const bin = Math.min(N / 2 - 1, Math.round((f / SR) * N));
      const mag = Math.hypot(re[bin]!, im[bin]!) / (N / 4);
      const v = Math.max(0, Math.min(1, (20 * Math.log10(mag + 1e-9) + 80) / 80));
      const o = (((row * ROW_H + y) * (LABEL_W + COLS)) + LABEL_W + c) * 4;
      sheet[o] = Math.round(255 * Math.min(1, v * 1.6));
      sheet[o + 1] = Math.round(255 * v * v);
      sheet[o + 2] = Math.round(255 * (0.25 + 0.5 * v) * (1 - v));
      sheet[o + 3] = 255;
    }
  }
  // Divider line.
  for (let c = 0; c < COLS; c++) {
    const o = ((row * ROW_H) * COLS + c) * 4;
    sheet[o] = sheet[o + 1] = sheet[o + 2] = 255;
  }
});
writeFileSync(new URL('spectrograms.png', OUT), encodePng(COLS, ROW_H * names.length, sheet));
console.log('rows:', names.join(', '));

// A short walk: 8 steps on diamond plate, then 8 on grating, alternating variants.
{
  const step = 0.52;
  const steps: Array<keyof typeof SOUND_SPECS> = [...Array(8).fill('footPlate'), ...Array(8).fill('footGrate')];
  const walk = new Float32Array(Math.round(SR * (steps.length * step + 0.6)));
  steps.forEach((name, k) => {
    const s = SOUND_SPECS[name].make(SR, new Rng(`${name}:${k % SOUND_SPECS[name].variants}`));
    const at = Math.round(SR * k * step);
    for (let i = 0; i < s.length && at + i < walk.length; i++) walk[at + i] = walk[at + i]! + s[i]! * 0.8;
  });
  writeFileSync(new URL('footsteps-walk.wav', OUT), wav(walk, SR));
  console.log('footsteps-walk.wav written');
}
