/**
 * Builds the Commons room sounds (openspec change commons-room-sounds, design D6) into
 * `public/assets/audio/ambience/`: chair scrapes, cups and cutlery, kitchen clatter and the coffee machine.
 *
 * Every clip is cut from a CC0 recording credited in CREDITS.md. The downloads live outside the repository, in
 * `../audio-src/commons/` (next to `js-fps`, like `../props-src`); a raw file is found by the Freesound id its name
 * starts with. A clip is made mono, its parts are joined with a short crossfade (a brew is grinding, then pouring) and
 * it is faded out. The long brew is normalized to a peak of PEAK_DB. The short chair, table and kitchen clips are mostly
 * silence around a click, so peak normalization left them far under the room: they are matched on their loudest 100 ms
 * (SHORT_LOUD_DB) with a limiter holding their peaks. Loudness in the room is set at play time
 * (src/audio/commonsSounds.ts), not here.
 *
 * Usage:
 *   node --experimental-strip-types scripts/commons-sounds-generate.ts --list
 *   node --experimental-strip-types scripts/commons-sounds-generate.ts --all            (cuts whatever is missing)
 *   node --experimental-strip-types scripts/commons-sounds-generate.ts --all --force
 *   node --experimental-strip-types scripts/commons-sounds-generate.ts --raw D:/somewhere/audio-src/commons --all
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
export const COMMONS_OUT_DIR = 'public/assets/audio/ambience';
const PEAK_DB = -6;
/** The short clips: RMS of their loudest 100 ms, and the ceiling the limiter holds (dBFS). */
const SHORT_LOUD_DB = -15;
const SHORT_PEAK_DB = -2;
const CROSSFADE = 0.3;
const RATE = 44100;

export type CommonsBank = 'chairScrape' | 'tableClink' | 'kitchenClatter' | 'coffeeBrew';

/** A span (s) of one raw recording, by its Freesound id. */
interface Part {
  id: number;
  start: number;
  end: number;
}

export interface CommonsClip {
  bank: CommonsBank;
  file: string;
  parts: readonly Part[];
  /** Fade-out length (s). */
  fade: number;
}

/** The banks matched on loudness; the others are matched on their peak. */
const SHORT: ReadonlySet<CommonsBank> = new Set(['chairScrape', 'tableClink', 'kitchenClatter']);

const FILE_STEM: Record<CommonsBank, string> = {
  chairScrape: 'oneshot-commons-chair',
  tableClink: 'oneshot-commons-table',
  kitchenClatter: 'oneshot-commons-kitchen',
  coffeeBrew: 'oneshot-commons-coffee',
};

function clips(bank: CommonsBank, fade: number, takes: ReadonlyArray<readonly Part[]>): CommonsClip[] {
  return takes.map((parts, i) => ({ bank, file: `${FILE_STEM[bank]}-${i + 1}.mp3`, parts, fade }));
}

const part = (id: number, start: number, end: number): Part => ({ id, start, end });

export const COMMONS_MANIFEST: readonly CommonsClip[] = [
  // Short chair scoots on concrete.
  ...clips('chairScrape', 0.08, [[part(871017, 0.02, 1.34)], [part(784216, 4.0, 4.58)], [part(784216, 31.3, 31.84)], [part(784216, 43.64, 44.34)]]),
  // A teacup and spoon, a mug set down, cutlery, old cups, more cutlery, a mug on a table.
  ...clips('tableClink', 0.08, [
    [part(764764, 0.34, 0.58)],
    [part(377500, 0.5, 0.8)],
    [part(466329, 12.62, 13.1)],
    [part(608918, 6.84, 7.04)],
    [part(466329, 11.2, 11.76)],
    [part(839346, 12.34, 12.68)],
  ]),
  // A pot on the stove, a frying pan put down, plates stacked, the tap.
  ...clips('kitchenClatter', 0.1, [[part(218332, 25.26, 26.18)], [part(389425, 8.98, 9.52)], [part(322407, 2.0, 3.0)], [part(703251, 0.0, 1.45)]]),
  // Two takes of one bean-to-cup machine, each grinding and then pouring: about 8 s.
  ...clips('coffeeBrew', 0.6, [
    [part(684744, 0.4, 3.6), part(684744, 21.0, 26.1)],
    [part(684744, 5.6, 8.8), part(684744, 52.0, 57.1)],
  ]),
];

const ff = (args: string[]): void => void execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });

function volume(file: string): { mean: number; max: number } {
  const res = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const text = `${res.stdout}\n${res.stderr}`;
  const mean = text.match(/mean_volume:\s*([-\d.]+)\s*dB/)?.[1];
  const max = text.match(/max_volume:\s*([-\d.]+)\s*dB/)?.[1];
  if (mean === undefined || max === undefined) throw new Error(`could not measure ${file}`);
  return { mean: Number(mean), max: Number(max) };
}

/** RMS (dBFS) of the loudest 100 ms of a file. */
function loudest(file: string): number {
  const bytes = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  const samples = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2);
  const window = RATE / 10;
  let best = 0;
  for (let at = 0; at < samples.length; at += window / 2) {
    let sum = 0;
    for (let i = at; i < Math.min(samples.length, at + window); i++) sum += samples[i]! ** 2;
    best = Math.max(best, sum / window);
  }
  return 10 * Math.log10(best + 1e-12);
}

/** The level filters for a rendered clip. */
function level(bank: CommonsBank, wav: string): string[] {
  if (!SHORT.has(bank)) return [`volume=${(PEAK_DB - volume(wav).max).toFixed(2)}dB`];
  const limit = (10 ** (SHORT_PEAK_DB / 20)).toFixed(4);
  return [`volume=${(SHORT_LOUD_DB - loudest(wav)).toFixed(2)}dB`, `alimiter=limit=${limit}:attack=1:release=40:level=false`];
}

function seconds(file: string): number {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' }).trim());
}

function rawFile(raw: string, id: number): string {
  const name = existsSync(raw) ? readdirSync(raw).find((f) => f.startsWith(`${id}_`)) : undefined;
  if (!name) throw new Error(`missing raw recording ${id}__*.mp3 in ${raw} (download it from https://freesound.org/s/${id}/)`);
  return join(raw, name);
}

function build(clip: CommonsClip, raw: string): string {
  const out = join(ROOT, COMMONS_OUT_DIR, clip.file);
  const wav = `${out}.tmp.wav`;
  const tmp = `${out}.tmp.mp3`;
  const inputs = clip.parts.flatMap((p) => ['-i', rawFile(raw, p.id)]);
  const chains = clip.parts.map((p, i) => `[${i}:a]atrim=${p.start}:${p.end},asetpts=PTS-STARTPTS,aformat=channel_layouts=mono:sample_rates=44100[p${i}]`);
  let last = 'p0';
  for (let i = 1; i < clip.parts.length; i++) {
    chains.push(`[${last}][p${i}]acrossfade=d=${CROSSFADE}:c1=tri:c2=tri[x${i}]`);
    last = `x${i}`;
  }
  chains.push(`[${last}]highpass=f=60[out]`);
  ff([...inputs, '-filter_complex', chains.join(';'), '-map', '[out]', wav]);
  const length = seconds(wav);
  const fade = Math.min(clip.fade, length * 0.3);
  const filters = ['afade=t=in:d=0.004', `afade=t=out:st=${(length - fade).toFixed(4)}:d=${fade.toFixed(4)}`, ...level(clip.bank, wav)];
  ff(['-i', wav, '-af', filters.join(','), '-ac', '1', '-ar', String(RATE), '-c:a', 'libmp3lame', '-b:a', '128k', tmp]);
  renameSync(tmp, out);
  unlinkSync(wav);
  return `${seconds(out).toFixed(2)}s loudest 100 ms ${loudest(out).toFixed(1)}dB peak ${volume(out).max}dB`;
}

function main(): void {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const rawAt = args.indexOf('--raw');
  const raw = resolve(ROOT, rawAt >= 0 && args[rawAt + 1] ? args[rawAt + 1]! : '../audio-src/commons');
  if (!args.includes('--all')) {
    for (const c of COMMONS_MANIFEST) {
      console.log(`  [${existsSync(join(ROOT, COMMONS_OUT_DIR, c.file)) ? 'YES' : '---'}] ${c.bank.padEnd(15)} ${c.file}  <- Freesound ${[...new Set(c.parts.map((p) => p.id))].join(', ')}`);
    }
    return;
  }
  mkdirSync(join(ROOT, COMMONS_OUT_DIR), { recursive: true });
  for (const c of COMMONS_MANIFEST) {
    if (!force && existsSync(join(ROOT, COMMONS_OUT_DIR, c.file))) console.log(`[skip] ${c.file}`);
    else console.log(`[cut]  ${c.file.padEnd(32)} ${build(c, raw)}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main();
