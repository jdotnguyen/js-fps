/** Decode a VO mp3, cap its pauses (`voPauses.ts`) and re-encode it in place with the clips' settings. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { joinSpans, longestPause, pauseSpans } from './voPauses.ts';

const SR = 24000;

function decode(mp3: string): Float32Array {
  const raw = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', mp3, '-f', 'f32le', '-ac', '1', '-ar', String(SR), '-'], { maxBuffer: 1 << 28 });
  return new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4)).slice();
}

function wav(samples: Float32Array): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

export interface TightenResult {
  before: number;
  after: number;
  pauseBefore: number;
  pauseAfter: number;
  changed: boolean;
}

/** Cap the pauses in `mp3` at `cap` seconds. Writes nothing when under 50 ms would go, or with `dryRun`. */
export function tightenClip(mp3: string, cap: number, opts: { dryRun?: boolean } = {}): TightenResult {
  const s = decode(mp3);
  const out = joinSpans(s, SR, pauseSpans(s, SR, cap));
  const r: TightenResult = { before: s.length / SR, after: out.length / SR, pauseBefore: longestPause(s, SR), pauseAfter: longestPause(out, SR), changed: s.length - out.length > SR * 0.05 };
  if (!r.changed) return { ...r, after: r.before, pauseAfter: r.pauseBefore };
  if (opts.dryRun) return r;
  const dir = mkdtempSync(join(tmpdir(), 'vo-tighten-'));
  try {
    const tmp = join(dir, 'clip.wav');
    writeFileSync(tmp, wav(out));
    execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', tmp, '-ac', '1', '-ar', String(SR), '-b:a', '64k', mp3]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return r;
}
