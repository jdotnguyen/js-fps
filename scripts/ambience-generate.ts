/**
 * ElevenLabs Sound Effects generator for environmental ambience beds and one-shots.
 *
 * Reads `ELEVENLABS_API_KEY` from `.env` or the process environment (never logged or written to code),
 * generates seamless looping ambient beds (`loop: true`) and environmental foley one-shots into
 * `public/assets/audio/ambience/`, and verifies each file with `ffprobe` when available.
 *
 * Usage:
 *   npm run ambience:generate -- --list
 *   npm run ambience:generate -- --id hull_hum
 *   npm run ambience:generate -- --all
 *   npm run ambience:generate -- --all --force
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT_DIR = join(ROOT, 'public/assets/audio/ambience');
const API_URL = 'https://api.elevenlabs.io/v1/sound-generation';
const MODEL_ID = 'eleven_text_to_sound_v2';
const OUTPUT_FORMAT = 'mp3_44100_128';

export interface AmbienceAssetSpec {
  id: string;
  file: string;
  category: 'bed' | 'emitter' | 'oneshot';
  loop: boolean;
  duration: number;
  promptInfluence: number;
  prompt: string;
}

export const AMBIENCE_MANIFEST: readonly AmbienceAssetSpec[] = [
  // ---- Room ambient beds (10 presets authored in src/data/levels/slice01.json) ----
  {
    id: 'hull_hum',
    file: 'bed-hull-hum.mp3',
    category: 'bed',
    loop: true,
    duration: 18,
    promptInfluence: 0.45,
    prompt:
      'seamless ambient room tone inside a pressurized deep-sea steel research station hull, deep warm sub-bass ocean pressure outside thick steel walls, distant steady ship ventilation and generator vibration, subtle pressurized air circulation, dark industrial sci-fi horror atmosphere, no music, no voice, no melody, constant steady texture',
  },
  {
    id: 'commons_murmur',
    file: 'bed-commons-murmur.mp3',
    category: 'bed',
    loop: true,
    duration: 18,
    promptInfluence: 0.45,
    prompt:
      'seamless ambient room tone of a quiet retro-industrial underwater station crew lounge and galley, gentle overhead HVAC airflow, distant soft refrigerator and kitchen equipment hum, warm enclosed hall acoustics, faint steel hull settling, no music, no speech, no voices, no melody, constant steady bed',
  },
  {
    id: 'lab_hum',
    file: 'bed-lab-hum.mp3',
    category: 'bed',
    loop: true,
    duration: 16,
    promptInfluence: 0.45,
    prompt:
      'seamless ambient room tone of a sterile underwater biological research laboratory, clean HEPA air filtration airflow, soft electronic cooling fans, subtle low hum of glass containment pumps and lab instruments, tense clinical sci-fi atmosphere, no music, no voice, no beeps, constant steady loop',
  },
  {
    id: 'hull_groan',
    file: 'bed-hull-groan.mp3',
    category: 'bed',
    loop: true,
    duration: 20,
    promptInfluence: 0.45,
    prompt:
      'seamless dark ambient bed of a deep-sea steel maintenance corridor under extreme ocean depth pressure, heavy low-frequency abyssal water rumble through metal bulkheads, faint tense metallic structural vibration, claustrophobic drafty air hum, survival horror atmosphere, no music, no voice, no sudden loud bangs, constant steady loop',
  },
  {
    id: 'office_hvac',
    file: 'bed-office-hvac.mp3',
    category: 'bed',
    loop: true,
    duration: 16,
    promptInfluence: 0.45,
    prompt:
      'seamless ambient room tone of a quiet 1980s retro corporate security office inside an underwater facility, steady low overhead HVAC air conditioning vent hum, soft computer server and monitor fan whirr, subtle dry interior acoustics, muted background fluorescent hum, no music, no voice, no keyboard typing, constant steady loop',
  },
  {
    id: 'med_beeps',
    file: 'bed-med-bay.mp3',
    category: 'bed',
    loop: true,
    duration: 16,
    promptInfluence: 0.45,
    prompt:
      'seamless ambient room tone of a quiet dimly lit medical bay on an underwater research station, sterile cleanroom ventilation airflow, soft medical refrigerator and diagnostic equipment hum, faint pressurized air whisper, eerie quiet hospital atmosphere, no music, no voice, no loud alarms, constant steady loop',
  },
  {
    id: 'water_drip',
    file: 'bed-flooded-tunnel.mp3',
    category: 'bed',
    loop: true,
    duration: 20,
    promptInfluence: 0.45,
    prompt:
      'seamless ambient soundscape of a dark flooded underground steel maintenance tunnel deep under the ocean, gentle dark water lapping and rippling softly against metal walls, sparse echoing water drips into standing puddles, heavy muffled underwater hull pressure rumble, cavernous damp acoustics, no music, no voice, constant steady loop',
  },
  {
    id: 'pipes_knock',
    file: 'bed-valve-room.mp3',
    category: 'bed',
    loop: true,
    duration: 18,
    promptInfluence: 0.45,
    prompt:
      'seamless ambient soundscape of an industrial pressurized water valve and pump room in an underwater facility, steady rushing water flowing through thick steel pipes, deep rhythmic mechanical pump vibration, subtle steam and pressure valve hiss, enclosed metallic acoustics, no music, no voice, constant steady loop',
  },
  {
    id: 'hydro_misters',
    file: 'bed-hydro-misters.mp3',
    category: 'bed',
    loop: true,
    duration: 18,
    promptInfluence: 0.45,
    prompt:
      'seamless ambient soundscape of a humid enclosed sci-fi hydroponics greenhouse bay, soft continuous fine water mist sprayers, gentle circulating grow-room ventilation fans, subtle recirculating hydroponic water trickle in troughs, warm enclosed air, no music, no voice, no birds, constant steady loop',
  },
  {
    id: 'dive_drip',
    file: 'bed-dive-bay.mp3',
    category: 'bed',
    loop: true,
    duration: 20,
    promptInfluence: 0.45,
    prompt:
      'seamless ambient soundscape of a cavernous deep-sea diving moon pool chamber, dark cold ocean water gently sloshing and lapping inside an open concrete and steel pool, soft echoing condensation drips, deep muffled underwater ocean surge, heavy pressurized chamber hum, no music, no voice, constant steady loop',
  },

  // ---- Positional / emitter loops (upgrade DemoRoomAudio & level emitters) ----
  {
    id: 'ventFan',
    file: 'emitter-vent-fan.mp3',
    category: 'emitter',
    loop: true,
    duration: 10,
    promptInfluence: 0.5,
    prompt:
      'close-up seamless loop of an industrial metal wall ventilation duct exhaust fan spinning steadily, rushing air through steel grille slats, soft rhythmic mechanical motor hum and gentle blade flutter, no music, no voice',
  },
  {
    id: 'fluorescentBuzz',
    file: 'emitter-fluorescent-buzz.mp3',
    category: 'emitter',
    loop: true,
    duration: 8,
    promptInfluence: 0.55,
    prompt:
      'close-up seamless loop of an aging overhead fluorescent tube light ballast humming and buzzing electrically with subtle occasional tiny filament crackle, raw realistic electrical sound, no music, no voice',
  },
  {
    id: 'waterRumble',
    file: 'emitter-water-rumble.mp3',
    category: 'emitter',
    loop: true,
    duration: 14,
    promptInfluence: 0.45,
    prompt:
      'seamless loop of deep abyssal ocean water pressure rumbling heavily against a thick reinforced underwater viewing window, dark muffled underwater current and subtle deep bubble turbulence, low sub-bass weight, no music, no voice',
  },
  {
    id: 'consoleHum',
    file: 'emitter-console-hum.mp3',
    category: 'emitter',
    loop: true,
    duration: 8,
    promptInfluence: 0.5,
    prompt:
      'close-up seamless loop of a vintage 1980s industrial computer terminal and CRT monitor humming softly, quiet internal cooling fan airflow and warm analog electronics power supply hum, no beeps, no music, no voice',
  },

  // ---- Environmental spatial one-shots (paced by AmbienceDirector & DemoRoomAudio) ----
  {
    id: 'hullGroan_1',
    file: 'oneshot-hull-groan-1.mp3',
    category: 'oneshot',
    loop: false,
    duration: 5.5,
    promptInfluence: 0.55,
    prompt:
      'deep eerie submarine steel hull groaning slowly under immense deep-ocean water pressure, resonant bending metal bulkhead stress creak, heavy sub-bass weight fading out naturally, sci-fi horror ambience foley, no music, no voice',
  },
  {
    id: 'hullGroan_2',
    file: 'oneshot-hull-groan-2.mp3',
    category: 'oneshot',
    loop: false,
    duration: 4.5,
    promptInfluence: 0.55,
    prompt:
      'distant muffled metallic hull pressure shift and slow low-pitched structural steel groan inside a deep underwater station, subtle stick-slip metal torsion, natural dark decay, no music, no voice',
  },
  {
    id: 'metalKnock_1',
    file: 'oneshot-metal-knock-1.mp3',
    category: 'oneshot',
    loop: false,
    duration: 2.5,
    promptInfluence: 0.6,
    prompt:
      'distant heavy muffled metallic clank and bulkhead knock echoing down an empty steel ship corridor, single thermal pipe expansion bang with dark metallic decay, no music, no voice',
  },
  {
    id: 'metalKnock_2',
    file: 'oneshot-metal-knock-2.mp3',
    category: 'oneshot',
    loop: false,
    duration: 2.2,
    promptInfluence: 0.6,
    prompt:
      'two subtle distant hollow metal pipe knocks in an underwater industrial facility, muffled heavy steel resonance fading into silence, realistic environmental foley, no music, no voice',
  },
  {
    id: 'creak_1',
    file: 'oneshot-creak-1.mp3',
    category: 'oneshot',
    loop: false,
    duration: 2.0,
    promptInfluence: 0.6,
    prompt:
      'subtle realistic metallic ceiling beam creak in a pressurized steel corridor, slow dry metal-on-metal tension groan, short natural tail, no music, no voice',
  },
  {
    id: 'creak_2',
    file: 'oneshot-creak-2.mp3',
    category: 'oneshot',
    loop: false,
    duration: 1.8,
    promptInfluence: 0.6,
    prompt:
      'short quiet steel bulkhead hinge and frame stress creak inside an old ship compartment, dry industrial metal groan, natural decay, no music, no voice',
  },
  {
    id: 'drip_1',
    file: 'oneshot-drip-1.mp3',
    category: 'oneshot',
    loop: false,
    duration: 0.8,
    promptInfluence: 0.65,
    prompt:
      'single crisp realistic water droplet falling into a shallow puddle inside a damp metal tunnel, clean resonant plink with brief wet room reflection, no music, no voice',
  },
  {
    id: 'drip_2',
    file: 'oneshot-drip-2.mp3',
    category: 'oneshot',
    loop: false,
    duration: 1.0,
    promptInfluence: 0.65,
    prompt:
      'two quick quiet condensation water drips landing on wet steel grating and puddle in a cavernous underwater tunnel, realistic foley, no music, no voice',
  },
  {
    id: 'pressurePing',
    file: 'oneshot-pressure-ping.mp3',
    category: 'oneshot',
    loop: false,
    duration: 3.5,
    promptInfluence: 0.55,
    prompt:
      'distant muffled deep-sea acoustic sonar ping heard faintly through a thick submarine steel hull underwater, lonely eerie underwater echo fading away, no music, no voice',
  },
  {
    id: 'distantMoan',
    file: 'oneshot-distant-moan.mp3',
    category: 'oneshot',
    loop: false,
    duration: 6.5,
    promptInfluence: 0.5,
    prompt:
      'eerie distant deep-ocean resonant moan from an enormous unseen creature far outside an underwater research station, heavily muffled through deep dark water and steel hull, low ominous sub-bass swell, no music, no voice',
  },
  {
    id: 'medBeep',
    file: 'oneshot-med-beep.mp3',
    category: 'oneshot',
    loop: false,
    duration: 1.6,
    promptInfluence: 0.65,
    prompt:
      'quiet clinical medical diagnostic monitor double soft electronic pulse beep in a quiet sterile hospital room, subtle muffled hospital equipment telemetry, no loud alarm, no music, no voice',
  },
  // Dock checkpoint (dock-checkpoint spec): the walk-through metal detector arch and the guard's hand wand.
  {
    id: 'archPass',
    file: 'oneshot-arch-pass.mp3',
    category: 'oneshot',
    loop: false,
    duration: 1.0,
    promptInfluence: 0.7,
    prompt:
      'single short soft two-tone electronic confirmation chime from a walk-through airport security metal detector, clean and friendly, slight metal room reverb, no alarm, no music, no voice',
  },
  {
    id: 'archAlarm',
    file: 'oneshot-arch-alarm.mp3',
    category: 'oneshot',
    loop: false,
    duration: 1.6,
    promptInfluence: 0.7,
    prompt:
      'walk-through airport security metal detector alarm, a fast repeating electronic warning beep for about one second, loud but not harsh, slight metal room reverb, no siren, no music, no voice',
  },
  {
    id: 'wandBeep',
    file: 'oneshot-wand-beep.mp3',
    category: 'oneshot',
    loop: false,
    duration: 1.2,
    promptInfluence: 0.7,
    prompt:
      'handheld security metal detector wand being swept over a person, quiet rising and falling electronic hum with two short soft beeps, close and dry, no alarm, no music, no voice',
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

function probeAudio(filePath: string): string {
  try {
    const out = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration,bit_rate:stream=channels,sample_rate', '-of', 'json', filePath],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const info = JSON.parse(out) as {
      format?: { duration?: string; bit_rate?: string };
      streams?: Array<{ channels?: number; sample_rate?: string }>;
    };
    const st = info.streams?.[0];
    const dur = info.format?.duration ? `${Number(info.format.duration).toFixed(2)}s` : '?s';
    const ch = st?.channels === 2 ? 'stereo' : st?.channels === 1 ? 'mono' : `${st?.channels ?? '?'}ch`;
    const sr = st?.sample_rate ? `${st.sample_rate}Hz` : '?Hz';
    const kb = (statSync(filePath).size / 1024).toFixed(1);
    return `${dur} ${ch} ${sr} ${kb}KB`;
  } catch {
    const kb = (statSync(filePath).size / 1024).toFixed(1);
    return `${kb}KB`;
  }
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

/**
 * Apply pure linear gain via ffmpeg (no dynamic compression, so seamless loop seams stay intact).
 * Beds and emitters target -24 dB mean (capped at -3 dB peak); one-shots target -6 dB peak.
 */
function normalizeLinear(filePath: string, category: AmbienceAssetSpec['category']): string | null {
  const vol = detectVolume(filePath);
  if (!vol) return null;
  let gainDb: number;
  if (category === 'oneshot') {
    gainDb = -6 - vol.max;
  } else {
    const want = -24 - vol.mean;
    const maxAllowed = -3 - vol.max;
    gainDb = Math.min(want, maxAllowed);
  }
  if (Math.abs(gainDb) < 1.5) return `unchanged (mean=${vol.mean.toFixed(1)}dB max=${vol.max.toFixed(1)}dB)`;
  const tmpPath = `${filePath}.norm.mp3`;
  execFileSync(
    'ffmpeg',
    ['-y', '-hide_banner', '-loglevel', 'error', '-i', filePath, '-af', `volume=${gainDb.toFixed(2)}dB`, '-c:a', 'libmp3lame', '-b:a', '128k', tmpPath],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  renameSync(tmpPath, filePath);
  const after = detectVolume(filePath);
  return `gain=${gainDb >= 0 ? '+' : ''}${gainDb.toFixed(1)}dB -> mean=${after?.mean.toFixed(1) ?? '?'}dB max=${after?.max.toFixed(1) ?? '?'}dB`;
}

async function generateOne(spec: AmbienceAssetSpec, apiKey: string, force: boolean): Promise<'generated' | 'skipped'> {
  const outPath = join(OUT_DIR, spec.file);
  if (existsSync(outPath) && !force) {
    console.log(`[skip] ${spec.id} -> ${spec.file} (${probeAudio(outPath)})`);
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
      loop: spec.loop,
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`HTTP ${res.status} generating "${spec.id}": ${detail}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(outPath, buf);
  const norm = normalizeLinear(outPath, spec.category);
  const cost = res.headers.get('character-cost') ?? res.headers.get('x-character-count');
  console.log(`[ok]   ${spec.id} -> ${spec.file} (${probeAudio(outPath)}${norm ? `, ${norm}` : ''}${cost ? `, cost=${cost}` : ''})`);
  return 'generated';
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const listOnly = args.includes('--list');
  const force = args.includes('--force');
  const all = args.includes('--all');
  const dryRun = args.includes('--dry-run');
  const normalizeOnly = args.includes('--normalize');
  const ids: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--id' && args[i + 1]) {
      ids.push(args[++i]!);
    }
  }

  if (normalizeOnly) {
    for (const spec of AMBIENCE_MANIFEST) {
      const outPath = join(OUT_DIR, spec.file);
      if (!existsSync(outPath)) continue;
      const msg = normalizeLinear(outPath, spec.category);
      console.log(`[norm] ${spec.id.padEnd(16)} ${spec.file.padEnd(28)} ${msg ?? 'skipped'}`);
    }
    return;
  }

  if (listOnly || (!all && ids.length === 0)) {
    console.log(`Ambience manifest (${AMBIENCE_MANIFEST.length} assets -> public/assets/audio/ambience/):\n`);
    for (const s of AMBIENCE_MANIFEST) {
      const exists = existsSync(join(OUT_DIR, s.file)) ? 'YES' : '---';
      console.log(`  [${exists}] ${s.id.padEnd(16)} ${s.category.padEnd(8)} ${s.loop ? 'loop' : 'shot'} ${String(s.duration).padStart(4)}s  ${s.file}`);
    }
    return;
  }

  const targets = all
    ? [...AMBIENCE_MANIFEST]
    : ids.map((id) => {
        const found = AMBIENCE_MANIFEST.find((s) => s.id === id);
        if (!found) throw new Error(`Unknown asset id "${id}". Run with --list to see available ids.`);
        return found;
      });

  if (dryRun) {
    console.log(`[dry-run] Would generate ${targets.length} asset(s): ${targets.map((t) => t.id).join(', ')}`);
    return;
  }

  const apiKey = loadApiKey();
  let generated = 0;
  let skipped = 0;
  for (const spec of targets) {
    const status = await generateOne(spec, apiKey, force);
    if (status === 'generated') generated++;
    else skipped++;
  }
  console.log(`\nDone: ${generated} generated, ${skipped} skipped.`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
