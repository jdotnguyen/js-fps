/**
 * Renders every emote for every fixed speaker to previews/voice/<speaker>-<emote>.wav,
 * a babble sample per squadmate, and a spectrogram sheet previews/voice/spectrograms.png
 * (rows = emotes, columns = engineer | medic | infected). Run: npm run voice:preview
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { stats } from '../src/audio/dsp.ts';
import { EMOTES, validateSpeakers } from '../src/data/types/dialogue.ts';
import { validate } from '../src/core/validate.ts';
import { renderUtterance } from '../src/dialogue/vocalSynth.ts';
import { encodePng } from './png.ts';

const SR = 48000;
const OUT = new URL('../previews/voice/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const speakers = validate(validateSpeakers, JSON.parse(readFileSync(new URL('../src/data/dialogue/speakers.json', import.meta.url), 'utf8')), 'speakers.json');

function wav(samples: Float32Array, sr: number): Buffer {
  const out = Buffer.alloc(44 + samples.length * 2);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(36 + samples.length * 2, 4);
  out.write('WAVEfmt ', 8, 'ascii');
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(sr, 24);
  out.writeUInt32LE(sr * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36, 'ascii');
  out.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767), 44 + i * 2);
  return out;
}

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

const cols = ['engineer', 'medic', 'infected'];
const CELL_W = 220;
const CELL_H = 110;
const W = CELL_W * cols.length;
const H = CELL_H * EMOTES.length;
const sheet = new Uint8Array(W * H * 4);
const N = 1024;
const fMin = 60;
const fMax = 8000;
const SPAN_S = 1.0;

console.log('speaker   emote      len(s)  peak dBFS  rms dBFS');
const db = (x: number): string => (20 * Math.log10(Math.max(x, 1e-9))).toFixed(1).padStart(8);
EMOTES.forEach((emote, row) => {
  cols.forEach((id, col) => {
    const s = renderUtterance(SR, speakers[id]!, emote, `preview:${id}:${emote}`);
    writeFileSync(new URL(`${id}-${emote}.wav`, OUT), wav(s, SR));
    const st = stats(s);
    console.log(`${id.padEnd(9)} ${emote.padEnd(9)} ${(s.length / SR).toFixed(2).padStart(6)} ${db(st.peak)}  ${db(st.rms)}`);
    // Fixed 1 s time span per cell so durations are comparable.
    for (let c = 0; c < CELL_W; c++) {
      const centre = Math.round((c / CELL_W) * SPAN_S * SR);
      const re = new Float64Array(N);
      const im = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
        re[i] = (s[centre - N / 2 + i] ?? 0) * w;
      }
      fft(re, im);
      for (let y = 0; y < CELL_H; y++) {
        const f = fMin * Math.pow(fMax / fMin, 1 - y / (CELL_H - 1));
        const bin = Math.min(N / 2 - 1, Math.round((f / SR) * N));
        const mag = Math.hypot(re[bin]!, im[bin]!) / (N / 4);
        const v = Math.max(0, Math.min(1, (20 * Math.log10(mag + 1e-9) + 70) / 70));
        const o = ((row * CELL_H + y) * W + col * CELL_W + c) * 4;
        const edge = y === 0 || c === 0;
        sheet[o] = edge ? 255 : Math.round(255 * Math.min(1, v * 1.6));
        sheet[o + 1] = edge ? 255 : Math.round(255 * v * v);
        sheet[o + 2] = edge ? 255 : Math.round(255 * (0.25 + 0.5 * v) * (1 - v));
        sheet[o + 3] = 255;
      }
    }
  });
});
writeFileSync(new URL('spectrograms.png', OUT), encodePng(W, H, sheet));
console.log(`spectrograms.png: rows ${EMOTES.join(', ')}; columns ${cols.join(', ')}; 1 s per cell, ${fMin}-${fMax} Hz log`);

for (const id of ['engineer', 'medic']) {
  const s = renderUtterance(SR, speakers[id]!, 'neutral', `preview:${id}:babble`, { babbleText: 'Cover me, I will get this open! Ready?' });
  writeFileSync(new URL(`${id}-babble.wav`, OUT), wav(s, SR));
}
const chime = renderUtterance(SR, speakers['pa']!, 'neutral', 'preview:pa');
writeFileSync(new URL('pa-chime.wav', OUT), wav(chime, SR));
console.log('babble + chime written');
