/**
 * ElevenLabs Sound Effects generator + ffmpeg timing/loudness fitter for level doors.
 *
 * Generates door open/close/denied/unlocked clips into `public/assets/audio/doors/`,
 * trims leading silence so motion starts with zero lag, and linear-normalizes peaks
 * to -4 dB without compressing dynamics.
 *
 * Usage:
 *   npm run doors:generate -- --list
 *   npm run doors:generate -- --all
 *   npm run doors:generate -- --id pressureOpen --force
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT_DIR = join(ROOT, 'public/assets/audio/doors');
const API_URL = 'https://api.elevenlabs.io/v1/sound-generation';
const MODEL_ID = 'eleven_text_to_sound_v2';
const OUTPUT_FORMAT = 'mp3_44100_128';

export interface DoorAudioSpec {
  id: string;
  file: string;
  duration: number;
  promptInfluence: number;
  /** Target peak dB for linear normalization. */
  targetPeakDb: number;
  prompt: string;
}

export const DOOR_AUDIO_MANIFEST: readonly DoorAudioSpec[] = [
  {
    id: 'pressureOpen',
    file: 'door-pressure-open.mp3',
    duration: 1.0,
    promptInfluence: 0.65,
    targetPeakDb: -4,
    prompt:
      'sci-fi underwater research station heavy dual steel sliding pressure door opening in one second, crisp pneumatic air seal release hiss, metallic track slide, solid damped mechanical end-stop clunk, realistic industrial foley, no music, no voice',
  },
  {
    id: 'pressureClose',
    file: 'door-pressure-close.mp3',
    duration: 1.0,
    promptInfluence: 0.65,
    targetPeakDb: -4,
    prompt:
      'sci-fi underwater research station heavy dual steel sliding pressure door closing in one second, sturdy metal leaves gliding shut on tracks, ending with a firm pressurized airlock thud and steel latch locking into place, realistic industrial foley, no music, no voice',
  },
  {
    id: 'glassOpen',
    file: 'door-glass-open.mp3',
    duration: 1.0,
    promptInfluence: 0.65,
    targetPeakDb: -6,
    prompt:
      'modern sterile laboratory automated glass sliding door opening smoothly in one second, quiet electric track motor whirr, soft pneumatic whoosh, light framed glass glide into soft rubber stop, realistic foley, no music, no voice',
  },
  {
    id: 'glassClose',
    file: 'door-glass-close.mp3',
    duration: 1.0,
    promptInfluence: 0.65,
    targetPeakDb: -6,
    prompt:
      'modern sterile laboratory automated glass sliding door closing smoothly in one second, quiet electric actuator glide on aluminum rails, ending with a soft sealed magnetic click, realistic foley, no music, no voice',
  },
  {
    id: 'bulkheadOpen',
    file: 'door-bulkhead-open.mp3',
    duration: 1.9,
    promptInfluence: 0.65,
    targetPeakDb: -3,
    prompt:
      'massive submarine vertical steel pressure bulkhead door unlocking and lifting open over two seconds, heavy metal locking bolt clank, deep hydraulic actuator groan and metallic rail slide, solid heavy resonant stop at top, realistic industrial foley, no music, no voice',
  },
  {
    id: 'bulkheadClose',
    file: 'door-bulkhead-close.mp3',
    duration: 1.9,
    promptInfluence: 0.65,
    targetPeakDb: -3,
    prompt:
      'massive submarine vertical steel pressure bulkhead door lowering and sealing shut over two seconds, heavy hydraulic descent groan, weighty steel slam onto rubber gasket frame, heavy locking bolts clanking shut, realistic industrial foley, no music, no voice',
  },
  {
    id: 'doorDenied',
    file: 'door-denied.mp3',
    duration: 0.6,
    promptInfluence: 0.7,
    targetPeakDb: -5,
    prompt:
      'short retro-industrial sci-fi security door keypad access denied low double electronic buzz paired with a dull locked deadbolt rattle inside a steel frame, crisp game UI and foley sound, no music, no voice',
  },
  {
    id: 'doorUnlocked',
    file: 'door-unlocked.mp3',
    duration: 0.8,
    promptInfluence: 0.7,
    targetPeakDb: -5,
    prompt:
      'short retro-industrial sci-fi security door access granted subtle two-tone electronic confirm chirp followed immediately by a heavy mechanical steel magnetic lock bolt releasing, crisp foley, no music, no voice',
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

/** Trim leading dead silence and linear-normalize peak dB so doors fire with zero trigger lag. */
function polishDoorClip(filePath: string, targetPeakDb: number): string {
  const vol = detectVolume(filePath);
  const gainDb = vol ? targetPeakDb - vol.max : 0;
  const tmpPath = `${filePath}.fit.mp3`;
  const filters = ['silenceremove=start_periods=1:start_duration=0:start_threshold=-45dB'];
  if (Math.abs(gainDb) >= 1.0) filters.push(`volume=${gainDb.toFixed(2)}dB`);
  execFileSync(
    'ffmpeg',
    ['-y', '-hide_banner', '-loglevel', 'error', '-i', filePath, '-af', filters.join(','), '-c:a', 'libmp3lame', '-b:a', '128k', tmpPath],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  renameSync(tmpPath, filePath);
  const after = detectVolume(filePath);
  return `mean=${after?.mean.toFixed(1) ?? '?'}dB max=${after?.max.toFixed(1) ?? '?'}dB`;
}

async function generateOne(spec: DoorAudioSpec, apiKey: string, force: boolean): Promise<'generated' | 'skipped'> {
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
  const stats = polishDoorClip(outPath, spec.targetPeakDb);
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
    console.log(`Door audio manifest (${DOOR_AUDIO_MANIFEST.length} assets -> public/assets/audio/doors/):\n`);
    for (const s of DOOR_AUDIO_MANIFEST) {
      const exists = existsSync(join(OUT_DIR, s.file)) ? 'YES' : '---';
      console.log(`  [${exists}] ${s.id.padEnd(14)} ${s.duration.toFixed(1)}s  ${s.file}`);
    }
    return;
  }
  const targets = all
    ? [...DOOR_AUDIO_MANIFEST]
    : ids.map((id) => {
        const found = DOOR_AUDIO_MANIFEST.find((s) => s.id === id);
        if (!found) throw new Error(`Unknown door audio id "${id}".`);
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
