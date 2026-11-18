/**
 * Renders each music track to previews/music/<name>.wav (stereo, looped twice so you can hear
 * the seam) and prints levels. Run: npm run music:preview
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { Rng } from '../src/core/rng.ts';
import { stats } from '../src/audio/dsp.ts';
import { MUSIC_SPECS } from '../src/audio/music.ts';

const SR = 44100;
const OUT = new URL('../previews/music/', import.meta.url);
mkdirSync(OUT, { recursive: true });

function wavStereo(l: Float32Array, r: Float32Array, sr: number, repeats: number): Buffer {
  const frames = l.length * repeats;
  const out = Buffer.alloc(44 + frames * 4);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(36 + frames * 4, 4);
  out.write('WAVEfmt ', 8, 'ascii');
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(2, 22);
  out.writeUInt32LE(sr, 24);
  out.writeUInt32LE(sr * 4, 28);
  out.writeUInt16LE(4, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36, 'ascii');
  out.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) {
    const j = i % l.length;
    out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, l[j]!)) * 32767), 44 + i * 4);
    out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, r[j]!)) * 32767), 46 + i * 4);
  }
  return out;
}

for (const [name, spec] of Object.entries(MUSIC_SPECS)) {
  const t0 = performance.now();
  const { left, right } = spec.make(SR, new Rng(`music:${name}`));
  const ms = Math.round(performance.now() - t0);
  const s = stats(left);
  const seam = Math.abs(left[0]! - left[left.length - 1]!);
  console.log(`${name} "${spec.title}": ${spec.seconds}s, peak ${s.peak.toFixed(2)}, rms ${s.rms.toFixed(3)}, seam ${seam.toFixed(4)}, rendered in ${ms} ms`);
  writeFileSync(new URL(`${name}.wav`, OUT), wavStereo(left, right, SR, 2));
}
