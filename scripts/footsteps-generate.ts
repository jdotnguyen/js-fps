/**
 * ElevenLabs Sound Effects generator + ffmpeg fitter for footstep one-shots.
 *
 * Generates dry, mono, tightly trimmed single-step clips into `public/assets/audio/footsteps/`,
 * strips leading silence so foot plants fire with zero trigger lag, caps clip length with a
 * clean tail fade, and linear-normalizes peaks to match existing `foot-metal-*.mp3` levels.
 *
 * Usage:
 *   npm run footsteps:generate -- --list
 *   npm run footsteps:generate -- --all
 *   npm run footsteps:generate -- --id concrete-1 --force
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT_DIR = join(ROOT, 'public/assets/audio/footsteps');
const API_URL = 'https://api.elevenlabs.io/v1/sound-generation';
const MODEL_ID = 'eleven_text_to_sound_v2';
const OUTPUT_FORMAT = 'mp3_44100_128';

export interface FootstepAudioSpec {
  id: string;
  file: string;
  duration: number;
  promptInfluence: number;
  targetPeakDb: number;
  maxTrimSeconds: number;
  prompt: string;
}

const DRY_CONCRETE_SUFFIX =
  'single isolated footstep only, one step not multiple, dry close-mic foley recording, no reverb, no echo, no metallic ring, no voice, no music';

export const FOOTSTEP_AUDIO_MANIFEST: readonly FootstepAudioSpec[] = [
  {
    id: 'concrete-1',
    file: 'foot-concrete-1.mp3',
    duration: 0.5,
    promptInfluence: 0.72,
    targetPeakDb: -4.0,
    maxTrimSeconds: 0.42,
    prompt: `heavy rubber-soled work boot taking one firm step on matte painted concrete industrial floor, solid dull heel strike and soft toe plant with subtle dry dust grit, ${DRY_CONCRETE_SUFFIX}`,
  },
  {
    id: 'concrete-2',
    file: 'foot-concrete-2.mp3',
    duration: 0.5,
    promptInfluence: 0.72,
    targetPeakDb: -4.0,
    maxTrimSeconds: 0.42,
    prompt: `tactical utility boot planting one steady step on smooth sealed concrete deck slab, dense muted thud and crisp rubber sole contact, slight fine grit, ${DRY_CONCRETE_SUFFIX}`,
  },
  {
    id: 'concrete-3',
    file: 'foot-concrete-3.mp3',
    duration: 0.5,
    promptInfluence: 0.72,
    targetPeakDb: -4.0,
    maxTrimSeconds: 0.42,
    prompt: `sturdy rubber-tread boot landing one natural walking step on painted concrete warehouse floor, tight low-mid heel thump and brief dry scuff, ${DRY_CONCRETE_SUFFIX}`,
  },
  {
    id: 'concrete-4',
    file: 'foot-concrete-4.mp3',
    duration: 0.5,
    promptInfluence: 0.72,
    targetPeakDb: -4.0,
    maxTrimSeconds: 0.42,
    prompt: `work boot taking one crisp heel-to-toe step on matte epoxy-painted concrete floor, solid grounded impact with faint sandy grit under rubber tread, ${DRY_CONCRETE_SUFFIX}`,
  },
  {
    id: 'concrete-5',
    file: 'foot-concrete-5.mp3',
    duration: 0.5,
    promptInfluence: 0.72,
    targetPeakDb: -4.0,
    maxTrimSeconds: 0.42,
    prompt: `rubber-soled crew boot making one measured step on flat painted industrial concrete floor, muted solid thump and short rubber sole roll, ${DRY_CONCRETE_SUFFIX}`,
  },
  {
    id: 'concrete-6',
    file: 'foot-concrete-6.mp3',
    duration: 0.5,
    promptInfluence: 0.72,
    targetPeakDb: -4.0,
    maxTrimSeconds: 0.42,
    prompt: `heavy boot stepping once onto dusty painted concrete slab, firm damped low-frequency heel impact and gentle rubber tread grip, ${DRY_CONCRETE_SUFFIX}`,
  },
  {
    id: 'concrete-7',
    file: 'foot-concrete-7.mp3',
    duration: 0.5,
    promptInfluence: 0.72,
    targetPeakDb: -4.0,
    maxTrimSeconds: 0.42,
    prompt: `industrial work boot taking one brisk step on painted concrete deck, compact dull heel-toe impact with subtle dry mineral grit, ${DRY_CONCRETE_SUFFIX}`,
  },
  // ---- Wading in standing water (openspec overhaul-flooded-tunnel) ----
  {
    id: 'wade-shallow-1',
    file: 'foot-wade-shallow-1.mp3',
    duration: 0.8,
    promptInfluence: 0.7,
    targetPeakDb: -5.0,
    maxTrimSeconds: 0.75,
    prompt: 'one boot stepping through ankle-to-knee deep murky water, a crisp splash and slosh as the foot lifts and plants, single step, dry close-mic foley recording, no reverb, no echo, no voice, no music',
  },
  {
    id: 'wade-shallow-2',
    file: 'foot-wade-shallow-2.mp3',
    duration: 0.8,
    promptInfluence: 0.7,
    targetPeakDb: -5.0,
    maxTrimSeconds: 0.75,
    prompt: 'one step wading through shin-deep standing water, short wet splash with a soft slosh around the boot, single step, dry close-mic foley recording, no reverb, no echo, no voice, no music',
  },
  {
    id: 'wade-shallow-3',
    file: 'foot-wade-shallow-3.mp3',
    duration: 0.8,
    promptInfluence: 0.7,
    targetPeakDb: -5.0,
    maxTrimSeconds: 0.75,
    prompt: 'one work boot splashing down into calf-deep flood water, loud wet splash and slosh as the leg pushes through, single step, dry close-mic foley recording, no reverb, no echo, no voice, no music',
  },
  {
    id: 'wade-deep-1',
    file: 'foot-wade-deep-1.mp3',
    duration: 0.8,
    promptInfluence: 0.7,
    targetPeakDb: -5.0,
    maxTrimSeconds: 0.75,
    prompt: 'one heavy step wading through thigh-deep murky water, slow deep slosh and surge of water pushed by the leg, single step, dry close-mic foley recording, no reverb, no echo, no voice, no music',
  },
  {
    id: 'wade-deep-2',
    file: 'foot-wade-deep-2.mp3',
    duration: 0.8,
    promptInfluence: 0.7,
    targetPeakDb: -5.0,
    maxTrimSeconds: 0.75,
    prompt: 'a single slow stride through waist-high standing water, heavy wet drag and swirling slosh, single step, dry close-mic foley recording, no reverb, no echo, no voice, no music',
  },
  {
    id: 'wade-deep-3',
    file: 'foot-wade-deep-3.mp3',
    duration: 0.8,
    promptInfluence: 0.7,
    targetPeakDb: -5.0,
    maxTrimSeconds: 0.75,
    prompt: 'one leg pushing through deep flood water, thick gurgling slosh and a low surge, single step, dry close-mic foley recording, no reverb, no echo, no voice, no music',
  },
];

function loadApiKey(): string {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
  const envPath = join(ROOT, '.env');
  if (existsSync(envPath)) {
    const raw = readFileSync(envPath, 'utf8');
    const match = raw.match(/^ELEVENLABS_API_KEY=(.+)$/m);
    if (match?.[1]) return match[1].trim().replace(/^["']|["']$/g, '');
  }
  throw new Error('ELEVENLABS_API_KEY not found in environment or .env');
}

function detectVolume(filePath: string): { mean: number; max: number } | null {
  const res = spawnSync('ffmpeg', ['-hide_banner', '-i', filePath, '-af', 'volumedetect', '-f', 'null', '-'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const combined = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
  const mean = combined.match(/mean_volume:\s*([-\d.]+)\s*dB/);
  const max = combined.match(/max_volume:\s*([-\d.]+)\s*dB/);
  if (mean?.[1] && max?.[1]) return { mean: Number(mean[1]), max: Number(max[1]) };
  return null;
}

function probeDuration(filePath: string): number {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', filePath],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return Number(out.trim()) || 0;
}

function probeAudio(filePath: string): string {
  try {
    const out = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration:stream=channels,sample_rate', '-of', 'json', filePath],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const info = JSON.parse(out) as { format?: { duration?: string }; streams?: Array<{ channels?: number; sample_rate?: string }> };
    const st = info.streams?.[0];
    const dur = info.format?.duration ? `${Number(info.format.duration).toFixed(2)}s` : '?s';
    const ch = st?.channels === 2 ? 'stereo' : st?.channels === 1 ? 'mono' : `${st?.channels ?? '?'}ch`;
    const kb = (statSync(filePath).size / 1024).toFixed(1);
    return `${dur} ${ch} ${kb}KB`;
  } catch {
    return `${(statSync(filePath).size / 1024).toFixed(1)}KB`;
  }
}

/**
 * Convert to mono (ideal for HRTF PannerNode), trim leading silence so foot plants fire
 * with zero lag, cap duration with a smooth short tail fade, and linear-normalize peak dB.
 */
function polishFootstepClip(filePath: string, targetPeakDb: number, maxTrimSeconds: number): string {
  const tmp1 = `${filePath}.trim.wav`;
  const tmp2 = `${filePath}.fit.mp3`;

  // Pass 1: mono + trim leading dead silence + cap max duration cleanly in uncompressed WAV.
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      filePath,
      '-ac',
      '1',
      '-ar',
      '44100',
      '-af',
      `silenceremove=start_periods=1:start_duration=0:start_threshold=-42dB,atrim=0:${maxTrimSeconds.toFixed(3)}`,
      tmp1,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const dur = Math.max(0.08, probeDuration(tmp1));
  const fadeDur = Math.min(0.04, dur * 0.25);
  const fadeStart = Math.max(0, dur - fadeDur);
  const vol = detectVolume(tmp1);
  const gainDb = vol ? targetPeakDb - vol.max : 0;

  const filters = [`afade=t=out:st=${fadeStart.toFixed(4)}:d=${fadeDur.toFixed(4)}`];
  if (Math.abs(gainDb) >= 0.5) filters.push(`volume=${gainDb.toFixed(2)}dB`);

  // Pass 2: normalize peak + tail fade -> final mono 44.1 kHz MP3.
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      tmp1,
      '-ac',
      '1',
      '-ar',
      '44100',
      '-af',
      filters.join(','),
      '-c:a',
      'libmp3lame',
      '-b:a',
      '128k',
      tmp2,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  renameSync(tmp2, filePath);
  try {
    unlinkSync(tmp1);
  } catch {
    /* ignore cleanup failure */
  }
  const after = detectVolume(filePath);
  return `mean=${after?.mean.toFixed(1) ?? '?'}dB max=${after?.max.toFixed(1) ?? '?'}dB`;
}

async function generateOne(spec: FootstepAudioSpec, apiKey: string, force: boolean): Promise<'generated' | 'skipped'> {
  const outPath = join(OUT_DIR, spec.file);
  if (existsSync(outPath) && !force) {
    console.log(`[skip] ${spec.id.padEnd(14)} -> ${spec.file} (${probeAudio(outPath)})`);
    return 'skipped';
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const res = await fetch(`${API_URL}?output_format=${encodeURIComponent(OUTPUT_FORMAT)}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: spec.prompt,
      model_id: MODEL_ID,
      duration_seconds: spec.duration,
      prompt_influence: spec.promptInfluence,
      loop: false,
    }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} generating "${spec.id}": ${await res.text()}`);
  }
  writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
  const stats = polishFootstepClip(outPath, spec.targetPeakDb, spec.maxTrimSeconds);
  const cost = res.headers.get('character-cost') ?? res.headers.get('x-character-count');
  console.log(`[ok]   ${spec.id.padEnd(14)} -> ${spec.file} (${probeAudio(outPath)}, ${stats}${cost ? `, cost=${cost}` : ''})`);
  return 'generated';
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const listOnly = args.includes('--list');
  const force = args.includes('--force');
  const all = args.includes('--all');
  const ids: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--id' && args[i + 1]) ids.push(args[++i]!);
  }
  if (listOnly || (!all && ids.length === 0)) {
    console.log(`Footstep audio manifest (${FOOTSTEP_AUDIO_MANIFEST.length} assets -> public/assets/audio/footsteps/):\n`);
    for (const s of FOOTSTEP_AUDIO_MANIFEST) {
      const exists = existsSync(join(OUT_DIR, s.file)) ? 'YES' : '---';
      console.log(`  [${exists}] ${s.id.padEnd(14)} ${s.duration.toFixed(1)}s  ${s.file}`);
    }
    return;
  }
  const targets = all
    ? [...FOOTSTEP_AUDIO_MANIFEST]
    : ids.map((id) => {
        const found = FOOTSTEP_AUDIO_MANIFEST.find((s) => s.id === id);
        if (!found) throw new Error(`Unknown footstep audio id "${id}".`);
        return found;
      });
  const apiKey = loadApiKey();
  let generated = 0;
  let skipped = 0;
  for (const spec of targets) {
    if ((await generateOne(spec, apiKey, force)) === 'generated') generated++;
    else skipped++;
  }
  console.log(`\nDone: ${generated} generated, ${skipped} skipped.`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
