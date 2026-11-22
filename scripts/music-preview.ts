/**
 * Renders each music track to previews/music/<name>.wav (stereo, looped twice so you can hear
 * the seam) and prints levels. Run: npm run music:preview
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { Rng } from '../src/core/rng.ts';
import { stats } from '../src/audio/dsp.ts';
import { MUSIC_SPECS } from '../src/audio/music.ts';
import { SCORE_RENDERS } from '../src/audio/scores/index.ts';
import scoresJson from '../src/data/scores.json' with { type: 'json' };

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

// Adaptive scores (adaptive-music spec): every layer and stinger on its own, plus the score's arc as a rough mock-up:
// each cue held for a few bars at its levels, with its stinger on top. previews/music/<score>/.
const ARC: Record<string, Array<[string, number]>> = {
  labB: [
    ['kill:scratch', 5],
    ['kill:panic', 4],
    ['kill:glass', 2.6],
    ['kill:arch', 2.6],
    ['kill:burst', 0.6],
    ['kill:still', 1.6],
    ['kill:creature', 10.4],
    ['contact', 5.2],
    ['door', 10.4],
    ['end', 7],
  ],
};
for (const [id, spec] of Object.entries(SCORE_RENDERS)) {
  const t0 = performance.now();
  const score = spec.render(SR, new Rng(`score:${id}`));
  console.log(`score ${id} "${spec.title}": rendered in ${Math.round(performance.now() - t0)} ms`);
  const dir = new URL(`${id}/`, OUT);
  mkdirSync(dir, { recursive: true });
  for (const [name, p] of Object.entries(score.layers)) {
    const s = stats(p.left);
    console.log(`  layer ${name}: peak ${s.peak.toFixed(2)}, rms ${s.rms.toFixed(3)}`);
    writeFileSync(new URL(`layer_${name}.wav`, dir), wavStereo(p.left, p.right, SR, 2));
  }
  for (const [name, vs] of Object.entries(score.stingers)) {
    vs.forEach((p, i) => writeFileSync(new URL(`stinger_${name}${vs.length > 1 ? `_${i + 1}` : ''}.wav`, dir), wavStereo(p.left, p.right, SR, 1)));
  }
  const def = (scoresJson as Record<string, { cues: Record<string, { layers?: Record<string, number>; stinger?: string; fade?: number; cut?: boolean }>; stingers: Record<string, number> }>)[id]!;
  const arc = ARC[id];
  if (!arc) continue;
  const total = Math.round(arc.reduce((a, [, s]) => a + s, 0) * SR);
  const L = new Float32Array(total);
  const R = new Float32Array(total);
  const names = Object.keys(score.layers);
  const level = Object.fromEntries(names.map((n) => [n, 0]));
  let at = 0;
  for (const [cueName, secs] of arc) {
    const cue = def.cues[cueName]!;
    const tc = cue.cut ? 0.004 : Math.max(0.01, (cue.fade ?? 1) / 3);
    const k = 1 - Math.exp(-1 / (tc * SR));
    const len = Math.round(secs * SR);
    for (let i = 0; i < len && at + i < total; i++) {
      let l = 0;
      let r = 0;
      for (const n of names) {
        level[n]! += ((cue.layers?.[n] ?? 0) - level[n]!) * k;
        const p = score.layers[n]!;
        const j = (at + i) % p.left.length;
        l += p.left[j]! * level[n]!;
        r += p.right[j]! * level[n]!;
      }
      L[at + i]! += l;
      R[at + i]! += r;
    }
    if (cue.stinger) {
      const p = score.stingers[cue.stinger]![0]!;
      const g = def.stingers[cue.stinger] ?? 1;
      for (let i = 0; i < p.left.length && at + i < total; i++) {
        L[at + i]! += p.left[i]! * g;
        R[at + i]! += p.right[i]! * g;
      }
    }
    at += len;
  }
  writeFileSync(new URL('arc.wav', dir), wavStereo(L, R, SR, 1));
  console.log(`  arc mock-up: ${(total / SR).toFixed(1)} s`);
}
