/**
 * Builds the spent-casing landing banks (openspec change casing-drop-audio, design D3/D5) into
 * `public/assets/audio/weapons/casings/`.
 *
 * Each entry is either a cut from a CC0 recording (credited in CREDITS.md) or an ElevenLabs Sound Effects
 * generation for a surface no usable recording covers. CC0 downloads live outside the repository, in
 * `../audio-src/casings/` (next to `js-fps`, like `../props-src`). Every clip is made mono, its leading silence is
 * trimmed so the first impact lands on time, its length is capped with a short fade, and its peak is normalized to
 * PEAK_DB. Relative loudness per surface is set at play time (src/audio/casings.ts), not here.
 *
 * Usage:
 *   npm run casings:generate -- --list
 *   npm run casings:generate -- --all            (cuts and generates whatever is missing)
 *   npm run casings:generate -- --id brass-metal-1 --force
 *   npm run casings:generate -- --raw D:/somewhere/audio-src/casings --all
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
export const CASING_OUT_DIR = 'public/assets/audio/weapons/casings';
const API_URL = 'https://api.elevenlabs.io/v1/sound-generation';
const MODEL_ID = 'eleven_text_to_sound_v2';
const OUTPUT_FORMAT = 'mp3_44100_128';
/** Every bank is normalized to this peak; the surface's loudness comes from its play gain. */
const PEAK_DB = -6;

export type CasingBank =
  | 'casingBrassConcrete'
  | 'casingBrassMetal'
  | 'casingBrassGrate'
  | 'casingBrassSoft'
  | 'casingHullConcrete'
  | 'casingHullMetal'
  | 'casingHullGrate'
  | 'casingHullSoft'
  | 'casingWater';

interface BaseSpec {
  id: string;
  bank: CasingBank;
  file: string;
  /** Longest kept length (s) after the leading-silence trim. */
  maxSeconds: number;
}
/** A span of a CC0 recording in the raw folder. */
export interface CutSpec extends BaseSpec {
  source: { file: string; start: number; end: number; credit: string };
}
/** An ElevenLabs generation. */
export interface GenSpec extends BaseSpec {
  prompt: string;
  duration: number;
  promptInfluence: number;
}
export type CasingSpec = CutSpec | GenSpec;

const DRY = 'dry close-mic foley recording, no gunshot, no reverb, no echo, no voice, no music';
const BRASS = 'a single empty 9mm brass pistol cartridge casing';
const HULL = 'a single empty plastic 12 gauge shotgun shell hull with a brass base';

/** `casingBrassConcrete`, 3 -> id `brass-concrete-3`, file `casing-brass-concrete-3.mp3`. */
function naming(bank: CasingBank, n: number): { id: string; file: string } {
  const kebab = bank.replace(/^casing/, '').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  return { id: `${kebab}-${n}`, file: `casing-${kebab}-${n}.mp3` };
}
const cut = (bank: CasingBank, n: number, file: string, start: number, end: number, credit: string, maxSeconds: number): CutSpec => ({
  ...naming(bank, n),
  bank,
  maxSeconds,
  source: { file, start, end, credit },
});
const gen = (bank: CasingBank, n: number, prompt: string, duration: number, maxSeconds: number): GenSpec => ({
  ...naming(bank, n),
  bank,
  maxSeconds,
  prompt: `${prompt}, ${DRY}`,
  duration,
  promptInfluence: 0.75,
});

const GRAYJOY = 'GrayJoy, "Brass bullet shell casing drop onto concrete, multiple takes" (Freesound 210102, CC0)';
const GRYFF = 'GryffDavid, "Bouncing Shell Casings (Various Sizes)" (Freesound 318964, CC0)';
const panda = (id: number, n: number): string => `BlondPanda, "Small_Bullet_Very_Soft_Hit_0${n}" (Freesound ${id}, CC0)`;

export const CASING_MANIFEST: readonly CasingSpec[] = [
  // Brass on concrete: four takes from GrayJoy's concrete session, six of GryffDavid's cleanest drops.
  cut('casingBrassConcrete', 1, 'grayjoy-210102.mp3', 0.03, 3.0, GRAYJOY, 1.1),
  cut('casingBrassConcrete', 2, 'grayjoy-210102.mp3', 4.06, 7.3, GRAYJOY, 1.1),
  cut('casingBrassConcrete', 3, 'grayjoy-210102.mp3', 7.5, 8.85, GRAYJOY, 1.1),
  cut('casingBrassConcrete', 4, 'grayjoy-210102.mp3', 9.88, 10.86, GRAYJOY, 1.1),
  cut('casingBrassConcrete', 5, 'gryffdavid-318964.mp3', 16.78, 17.5, GRYFF, 1.0),
  cut('casingBrassConcrete', 6, 'gryffdavid-318964.mp3', 18.95, 19.6, GRYFF, 1.0),
  cut('casingBrassConcrete', 7, 'gryffdavid-318964.mp3', 13.02, 13.66, GRYFF, 1.0),
  cut('casingBrassConcrete', 8, 'gryffdavid-318964.mp3', 8.27, 8.95, GRYFF, 1.0),
  cut('casingBrassConcrete', 9, 'gryffdavid-318964.mp3', 20.9, 21.64, GRYFF, 1.0),
  cut('casingBrassConcrete', 10, 'gryffdavid-318964.mp3', 31.83, 32.55, GRYFF, 1.0),
  // Brass on rubber and carpet: BlondPanda's very soft hits, a short dull tick with no bounce.
  ...[778022, 778023, 778024, 778025, 778026, 778027, 778028].map((id, i) => cut('casingBrassSoft', i + 1, `blondpanda-${id}.mp3`, 0, 0.3, panda(id, i + 1), 0.3)),
  // Hulls on concrete.
  cut('casingHullConcrete', 1, 'mrgungus-773860.mp3', 0, 1.0, 'MrGungus, "12 guage shotgun shell drop" (Freesound 773860, CC0)', 1.0),
  cut('casingHullConcrete', 2, 'lumikon-564481.mp3', 0, 1.5, 'lumikon, "Shotgun Shell Drop sfx" (Freesound 564481, CC0)', 1.0),
  cut('casingHullConcrete', 3, 'magnuswaker-523059.mp3', 0, 1.2, 'magnuswaker, "Shell Bounce 1" (Freesound 523059, CC0)', 1.0),
  cut('casingHullConcrete', 4, 'metrolynn-620929.mp3', 0.05, 0.95, 'Metrolynn, "empty shotgun shells/casings hitting ground bouncing" (Freesound 620929, CC0)', 0.9),
  // No usable recording found for these surfaces (design D5): ElevenLabs.
  gen('casingBrassMetal', 1, `${BRASS} dropping onto a steel deck plate floor, bright ringing metallic ting, two quick bounces and a short ringing roll`, 1.0, 1.1),
  gen('casingBrassMetal', 2, `${BRASS} falling onto a riveted steel floor plate, a high clear clink that rings, a bounce and a skittering roll to rest`, 1.0, 1.1),
  gen('casingBrassMetal', 3, `${BRASS} landing on a painted steel ship deck, sharp metallic ping with a sustained ring, three small bounces`, 1.0, 1.1),
  gen('casingBrassMetal', 4, `${BRASS} hitting a hollow steel floor panel, bright ting-ting-ting bounces with a resonant ring`, 1.0, 1.1),
  gen('casingBrassMetal', 5, `${BRASS} dropped on a steel plate floor, crisp ringing clink and a short rattling roll`, 1.0, 1.1),
  gen('casingBrassGrate', 1, `${BRASS} dropping onto an open steel floor grating, a metallic rattle and buzz as it bounces between the bars`, 0.8, 0.9),
  gen('casingBrassGrate', 2, `${BRASS} landing on a steel bar grating walkway, a tinny rattling clatter against the grid`, 0.8, 0.9),
  gen('casingBrassGrate', 3, `${BRASS} falling onto an industrial metal grate floor, quick clinking rattle on the bars`, 0.8, 0.9),
  gen('casingBrassGrate', 4, `${BRASS} bouncing on an expanded metal mesh catwalk, short buzzing metallic rattle`, 0.8, 0.9),
  gen('casingHullMetal', 1, `${HULL} dropping onto a steel deck plate, a hollow plastic clack with a dull metal base knock, one bounce`, 0.8, 0.9),
  gen('casingHullMetal', 2, `${HULL} falling onto a steel floor plate, dull plastic thunk and a short knock, little ring`, 0.8, 0.9),
  gen('casingHullMetal', 3, `${HULL} landing on a painted steel deck, hollow clack, a small bounce and a brief roll`, 0.8, 0.9),
  gen('casingHullMetal', 4, `${HULL} hitting a steel floor panel, low plastic clack with a faint metallic ring`, 0.8, 0.9),
  gen('casingHullGrate', 1, `${HULL} dropping onto a steel bar floor grating, a hollow plastic clatter on the bars`, 0.8, 0.9),
  gen('casingHullGrate', 2, `${HULL} landing on an industrial metal grate, a dull rattling clack`, 0.8, 0.9),
  gen('casingHullGrate', 3, `${HULL} falling onto a steel grating walkway, plastic clack and a short rattle`, 0.8, 0.9),
  gen('casingHullGrate', 4, `${HULL} bouncing once on a metal mesh catwalk, hollow clatter`, 0.8, 0.9),
  gen('casingHullSoft', 1, `${HULL} dropping onto low pile office carpet, a soft muffled thud, no bounce`, 0.5, 0.35),
  gen('casingHullSoft', 2, `${HULL} falling onto a rubber floor mat, one dull soft thump`, 0.5, 0.35),
  gen('casingHullSoft', 3, `${HULL} landing on thin carpet, a quiet muted tap and nothing else`, 0.5, 0.35),
  gen('casingHullSoft', 4, `${HULL} dropped onto a rubber mat, a soft padded thud`, 0.5, 0.35),
  gen('casingWater', 1, 'a single small brass bullet casing dropping into shallow standing water, one tiny plip with a small splash', 0.5, 0.45),
  gen('casingWater', 2, 'a tiny metal object falling into a shallow puddle, a small wet plop', 0.5, 0.45),
  gen('casingWater', 3, 'a small casing plinking into ankle deep water, a quick light water drop plip', 0.5, 0.45),
  gen('casingWater', 4, 'a small metal shell dropped into a shallow puddle, a brief bloop and tiny splash', 0.5, 0.45),
  gen('casingWater', 5, 'a little brass casing landing in shallow flood water, one soft plip', 0.5, 0.45),
];

/** `assets/...` URLs per bank, in variant order (what src/audio/sounds.ts registers). */
export function casingUrls(): Record<CasingBank, string[]> {
  const out = {} as Record<CasingBank, string[]>;
  for (const s of CASING_MANIFEST) (out[s.bank] ??= []).push(`${CASING_OUT_DIR.replace(/^public\//, '')}/${s.file}`);
  return out;
}

function loadApiKey(): string {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
  const envPath = join(ROOT, '.env');
  if (existsSync(envPath)) {
    const match = readFileSync(envPath, 'utf8').match(/^ELEVENLABS_API_KEY=(.+)$/m);
    if (match?.[1]) return match[1].trim().replace(/^["']|["']$/g, '');
  }
  throw new Error('ELEVENLABS_API_KEY not found in environment or .env');
}

function maxVolume(file: string): number | null {
  const res = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = `${res.stdout}\n${res.stderr}`.match(/max_volume:\s*([-\d.]+)\s*dB/);
  return m?.[1] ? Number(m[1]) : null;
}

function duration(file: string): number {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' }).trim()) || 0;
}

const ff = (args: string[]): void => void execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });

/** Mono, leading silence trimmed, capped at `maxSeconds` with a short fade, peak at PEAK_DB, 128 kbps MP3. */
export function polish(input: string, out: string, maxSeconds: number, span?: { start: number; end: number }): string {
  const wav = `${out}.tmp.wav`;
  const pre = span ? [`atrim=${span.start.toFixed(3)}:${span.end.toFixed(3)}`, 'asetpts=PTS-STARTPTS'] : [];
  ff(['-i', input, '-ac', '1', '-ar', '44100', '-af', [...pre, 'highpass=f=60', 'silenceremove=start_periods=1:start_duration=0:start_threshold=-40dB', `atrim=0:${maxSeconds.toFixed(3)}`].join(','), wav]);
  const dur = Math.max(0.05, duration(wav));
  const fade = Math.min(0.08, dur * 0.3);
  const peak = maxVolume(wav);
  const filters = [`afade=t=out:st=${Math.max(0, dur - fade).toFixed(4)}:d=${fade.toFixed(4)}`];
  if (peak !== null) filters.push(`volume=${(PEAK_DB - peak).toFixed(2)}dB`);
  ff(['-i', wav, '-ac', '1', '-ar', '44100', '-af', filters.join(','), '-c:a', 'libmp3lame', '-b:a', '128k', `${out}.tmp.mp3`]);
  renameSync(`${out}.tmp.mp3`, out);
  unlinkSync(wav);
  return `${duration(out).toFixed(2)}s peak ${maxVolume(out)?.toFixed(1)}dB`;
}

async function build(spec: CasingSpec, raw: string, force: boolean, key: () => string): Promise<'built' | 'skipped'> {
  const out = join(ROOT, CASING_OUT_DIR, spec.file);
  if (existsSync(out) && !force) return 'skipped';
  mkdirSync(join(ROOT, CASING_OUT_DIR), { recursive: true });
  if ('source' in spec) {
    const src = join(raw, spec.source.file);
    if (!existsSync(src)) throw new Error(`${spec.id}: missing raw recording ${src} (download it from the source in its credit: ${spec.source.credit})`);
    console.log(`[cut]  ${spec.id.padEnd(18)} -> ${spec.file} (${polish(src, out, spec.maxSeconds, spec.source)})`);
    return 'built';
  }
  const res = await fetch(`${API_URL}?output_format=${OUTPUT_FORMAT}`, {
    method: 'POST',
    headers: { 'xi-api-key': key(), 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text: spec.prompt, model_id: MODEL_ID, duration_seconds: spec.duration, prompt_influence: spec.promptInfluence, loop: false }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} generating "${spec.id}": ${await res.text()}`);
  const tmp = `${out}.gen.mp3`;
  writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  const stats = polish(tmp, out, spec.maxSeconds);
  unlinkSync(tmp);
  console.log(`[gen]  ${spec.id.padEnd(18)} -> ${spec.file} (${stats})`);
  return 'built';
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const all = args.includes('--all');
  const ids: string[] = [];
  let raw = resolve(ROOT, '../audio-src/casings');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--id' && args[i + 1]) ids.push(args[++i]!);
    else if (args[i] === '--raw' && args[i + 1]) raw = resolve(args[++i]!);
  }
  if (args.includes('--list') || (!all && ids.length === 0)) {
    console.log(`Casing banks (${CASING_MANIFEST.length} clips -> ${CASING_OUT_DIR}/):\n`);
    for (const s of CASING_MANIFEST) {
      const there = existsSync(join(ROOT, CASING_OUT_DIR, s.file)) ? 'YES' : '---';
      console.log(`  [${there}] ${s.id.padEnd(18)} ${'source' in s ? 'CC0 cut   ' : 'ElevenLabs'}  ${s.bank.padEnd(20)} ${s.file}`);
    }
    return;
  }
  const targets = all
    ? [...CASING_MANIFEST]
    : ids.map((id) => {
        const s = CASING_MANIFEST.find((m) => m.id === id);
        if (!s) throw new Error(`Unknown casing clip id "${id}".`);
        return s;
      });
  let apiKey: string | null = null;
  const key = (): string => (apiKey ??= loadApiKey());
  let built = 0;
  let skipped = 0;
  for (const s of targets) ((await build(s, raw, force, key)) === 'built' ? built++ : skipped++);
  console.log(`\nDone: ${built} built, ${skipped} skipped.`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
