/**
 * Re-cuts voice clips from audio the project already has, following a written recipe (`scripts/vo-recuts.json`), so a
 * bad batch cut can be fixed without a new voice request. Each output clip is a list of spans, taken from a raw batch
 * recording or from a shipped clip as it was at the recipe's starting commit. Sources are never the files being
 * written, so running a recipe again gives the same output.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const SR = 24000;
/** The fades and level filters a normal take gets (docs/voice-casting-standard.md §5). */
const LEAD_FADE_S = 0.012;
const TAIL_FADE_S = 0.035;
/** Ramp either side of a join, so it does not click. */
const JOIN_FADE_S = 0.005;

export interface RecipePart {
  /** A raw batch recording, relative to `previews/vo-batches/`. */
  wav?: string;
  /** Or a clip id, read from `public/assets/vo/` at the recipe's commit. */
  clip?: string;
  /** Span in seconds. */
  from: number;
  to: number;
  /** Silence put before this span, for the breath between two joined sentences. */
  gap?: number;
  /** Level change for this span, when joined spans differ. */
  gainDb?: number;
}

export interface Recipe {
  /** Commit whose shipped clips `clip` parts are read from. */
  commit: string;
  clips: Record<string, RecipePart[]>;
}

export function validateRecipe(recipe: Recipe): void {
  if (!recipe.commit) throw new Error('recipe: no commit');
  for (const [id, parts] of Object.entries(recipe.clips)) {
    if (parts.length === 0) throw new Error(`recipe: ${id} has no parts`);
    const raw = parts.filter((p) => p.wav !== undefined).length;
    if (raw !== 0 && raw !== parts.length) throw new Error(`recipe: ${id} mixes raw recordings and shipped clips, which have different levels`);
    for (const p of parts) {
      if ((p.wav === undefined) === (p.clip === undefined)) throw new Error(`recipe: ${id} needs exactly one of "wav" or "clip" per part`);
      if (!(p.from >= 0 && p.to > p.from)) throw new Error(`recipe: ${id} has a bad span ${p.from}-${p.to}`);
    }
  }
}

export function decodeMono(path: string): Float32Array {
  const raw = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', String(SR), '-'], { maxBuffer: 1 << 28 });
  return new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4)).slice();
}

/** The spans end to end, with their gaps, gains and fades. */
export function joinParts(parts: readonly RecipePart[], load: (part: RecipePart) => Float32Array): Float32Array {
  const pieces = parts.map((part, k) => {
    const source = load(part);
    const a = Math.round(part.from * SR);
    const b = Math.min(source.length, Math.round(part.to * SR));
    if (b <= a) throw new Error(`span ${part.from}-${part.to} s is outside its source (${(source.length / SR).toFixed(2)} s)`);
    const piece = source.slice(a, b);
    const gain = 10 ** ((part.gainDb ?? 0) / 20);
    const fadeIn = Math.round((k === 0 ? LEAD_FADE_S : JOIN_FADE_S) * SR);
    const fadeOut = Math.round((k === parts.length - 1 ? TAIL_FADE_S : JOIN_FADE_S) * SR);
    for (let i = 0; i < piece.length; i++) piece[i] = piece[i]! * gain * Math.min(1, i / fadeIn, (piece.length - 1 - i) / fadeOut);
    return { gap: Math.round((part.gap ?? 0) * SR), piece };
  });
  const out = new Float32Array(pieces.reduce((n, p) => n + p.gap + p.piece.length, 0));
  let at = 0;
  for (const { gap, piece } of pieces) {
    at += gap;
    out.set(piece, at);
    at += piece.length;
  }
  return out;
}

function wavBytes(samples: Float32Array): Buffer {
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

/**
 * Writes the clip as a shipped VO MP3. Raw recordings get the take's level filters; spans of shipped clips already had
 * them. Returns the length in seconds.
 */
export function encodeRecut(parts: readonly RecipePart[], load: (part: RecipePart) => Float32Array, outMp3: string): number {
  const samples = joinParts(parts, load);
  const filters = parts[0]!.wav !== undefined ? ['-af', 'highpass=f=75,loudnorm=I=-16:TP=-1.5:LRA=11'] : [];
  const dir = mkdtempSync(join(tmpdir(), 'vo-recut-'));
  try {
    const tmp = join(dir, 'clip.wav');
    writeFileSync(tmp, wavBytes(samples));
    mkdirSync(dirname(outMp3), { recursive: true });
    execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', tmp, ...filters, '-ac', '1', '-ar', String(SR), '-b:a', '64k', outMp3]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return samples.length / SR;
}
