/**
 * ElevenLabs Sound Effects generator for the infected-kill body sounds (infection-kills spec): bone crunches, flesh
 * tearing, the chest burst, blood hitting glass, drips and the creature; and the blows and heartbeat the player hears
 * on himself (player-hit-feedback). Same pipeline as `ambience-generate.ts`.
 *
 * Reads `ELEVENLABS_API_KEY` from `.env` or the process environment (never logged or written to code), writes
 * `public/assets/audio/gore/`, normalises one-shots to -6 dB peak and loops to -24 dB mean when ffmpeg is available.
 * Vocal reactions (Voss panting, whimpers, screams) are not made here: they come from Gemini TTS (audio-assets spec).
 *
 * After generating, register each sound in its area file's `samples` (`src/audio/sounds/`); `--register` prints the entries.
 * Until a sound exists, `data/kills.json` plays its stand-in (the second id in its `sfx` list).
 *
 * Usage:
 *   npm run gore:generate -- --list
 *   npm run gore:generate -- --id kill_crunch_1
 *   npm run gore:generate -- --all
 *   npm run gore:generate -- --register
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT_DIR = join(ROOT, 'public/assets/audio/gore');
const API_URL = 'https://api.elevenlabs.io/v1/sound-generation';
const MODEL_ID = 'eleven_text_to_sound_v2';
const OUTPUT_FORMAT = 'mp3_44100_128';

export interface GoreAssetSpec {
  id: string;
  /** The sound name it is a variant of (SAMPLE_URLS key, the id `data/kills.json` asks for). */
  sound: string;
  file: string;
  loop: boolean;
  duration: number;
  promptInfluence: number;
  prompt: string;
  /** A hit a kill fires on its frame: the silence the take opens with is cut, so it is heard as the event fires. */
  trim?: boolean;
}

const DRY = 'close-miked, dry, no room reverb, no music, no voice, no screaming, no speech';

const crunch = (n: number, detail: string): GoreAssetSpec => ({
  id: `kill_crunch_${n}`,
  sound: 'kill_crunch',
  file: `kill-crunch-${n}.mp3`,
  loop: false,
  duration: 1.2,
  promptInfluence: 0.6,
  prompt: `single visceral bone break inside a human torso, ${detail}, wet cartilage pop, sickening organic snap, horror game foley, ${DRY}`,
});

const splat = (n: number, detail: string): GoreAssetSpec => ({
  id: `blood_splat_glass_${n}`,
  sound: 'blood_splat_glass',
  file: `blood-splat-glass-${n}.mp3`,
  loop: false,
  duration: 1.0,
  promptInfluence: 0.55,
  prompt: `thick blood and gore splattering hard against a thick glass window pane, ${detail}, wet slap on glass, horror foley, ${DRY}`,
});

const GLASS = 'no shattering, no breaking glass, no music, no voice, no speech';

const slam = (n: number, detail: string): GoreAssetSpec => ({
  id: `creature_glass_hit_${n}`,
  sound: 'creature_glass_hit',
  file: `creature-glass-hit-${n}.mp3`,
  loop: false,
  duration: 1.2,
  promptInfluence: 0.65,
  prompt: `a huge monstrous creature slamming ${detail} against a thick reinforced laboratory observation window from the inside, deep heavy dull thump, the glass pane flexing and rattling hard in its steel frame, low resonant boom through the glass, horror game foley, close and heavy, ${GLASS}`,
});

const palm = (n: number, detail: string): GoreAssetSpec => ({
  id: `palm_glass_hit_${n}`,
  sound: 'palm_glass_hit',
  file: `palm-glass-hit-${n}.mp3`,
  loop: false,
  duration: 0.8,
  promptInfluence: 0.65,
  prompt: `a terrified person ${detail} on a thick laboratory observation window, flat dull slap and thump on heavy glass, the pane buzzing slightly in its metal frame, close-miked foley, ${GLASS}`,
  trim: true,
});

// Dr. Voss's run through Lab B (voss-death-scene D10): one designed sound for each blow, at its time in data/kills.json.
const blow = (id: string, duration: number, prompt: string): GoreAssetSpec => ({
  id,
  sound: id,
  file: `${id.replaceAll('_', '-')}.mp3`,
  loop: false,
  duration,
  promptInfluence: 0.65,
  prompt: `${prompt}, starting immediately, horror game foley, ${DRY}`,
  trim: true,
});

const scuff = (n: number, detail: string): GoreAssetSpec => ({
  id: `voss_scuff_${n}`,
  sound: 'voss_scuff',
  file: `voss-scuff-${n}.mp3`,
  loop: false,
  duration: 0.7,
  promptInfluence: 0.7,
  prompt: `one shoe of a stumbling person ${detail} on a hard tiled laboratory floor, a single short sole scuff and nothing else, starting immediately, foley, ${DRY}`,
  trim: true,
});

// A hit landing on the player (player-hit-feedback D7): heard at the listener, so close and bodily.
const clawHit = (n: number, detail: string): GoreAssetSpec => ({
  id: `hit_claw_${n}`,
  sound: 'hitClaw',
  file: `hit-claw-${n}.mp3`,
  loop: false,
  duration: 0.8,
  promptInfluence: 0.65,
  prompt: `one fast claw slash ripping across a man's thick uniform jacket and into the skin, ${detail}, sharp fabric tear and a wet cut, a single immediate close body impact, horror game foley, ${DRY}`,
});

const biteHit = (n: number, detail: string): GoreAssetSpec => ({
  id: `hit_bite_${n}`,
  sound: 'hitBite',
  file: `hit-bite-${n}.mp3`,
  loop: false,
  duration: 0.9,
  promptInfluence: 0.65,
  prompt: `a monster's jaws biting hard into a man's shoulder through clothing, ${detail}, one wet crunch of teeth into flesh, a single immediate close impact, horror game foley, ${DRY}`,
});

const bodySlam = (n: number, detail: string): GoreAssetSpec => ({
  id: `hit_slam_${n}`,
  sound: 'hitSlam',
  file: `hit-slam-${n}.mp3`,
  loop: false,
  duration: 1,
  promptInfluence: 0.65,
  prompt: `one massive blunt blow hitting a man's chest and body, ${detail}, deep heavy muffled thud with cloth and breath-knocking weight, no metal, a single immediate close impact, horror game foley, ${DRY}`,
});

export const GORE_MANIFEST: readonly GoreAssetSpec[] = [
  clawHit(1, 'a quick high swipe'),
  clawHit(2, 'a deeper raking swipe'),
  clawHit(3, 'two claws catching and tearing'),
  clawHit(4, 'a short vicious slash'),
  biteHit(1, 'a quick snapping bite'),
  biteHit(2, 'a clamping bite that grinds'),
  biteHit(3, 'a deep bite that tears away'),
  bodySlam(1, 'a huge fist'),
  bodySlam(2, 'a whole body rammed into him'),
  bodySlam(3, 'a crushing two-armed pound'),
  // The kept file is a 6 s loop built from the take's one clean lub-dub (5.12-5.74 s), repeated every 0.75 s and
  // levelled to -24 dB mean: the generated take beat unevenly. Regenerating replaces it with a raw take.
  {
    id: 'low_heartbeat',
    sound: 'lowHeartbeat',
    file: 'low-heartbeat.mp3',
    loop: true,
    duration: 8,
    promptInfluence: 0.7,
    prompt: `a labouring human heartbeat heard from inside the body, deep muffled lub-dub, steady at about eighty beats a minute, seamless loop, nothing else, ${DRY}`,
  },
  slam(1, 'its whole body'),
  slam(2, 'its bony bladed forearms'),
  slam(3, 'its shoulder and skull'),
  slam(4, 'both clawed arms at once'),
  palm(1, 'slamming both open palms flat'),
  palm(2, 'pounding a fist'),
  palm(3, 'slapping one palm hard'),
  blow('body_bench_hit', 1, 'a human body hitting a heavy laboratory bench hip first, one deep dull thud of flesh and bone on a solid edge, the bench jolting and the glassware on it rattling once'),
  blow('bench_sweep', 1.6, 'an arm swept violently across a laboratory bench top, glass flasks, bottles and a small steel tray scraped off together, a fast scrape then glassware clattering and bouncing on a hard floor'),
  blow('cart_crash', 2.2, 'a loaded stainless steel laboratory trolley landing on its side on a tiled floor, one huge heavy metal crash, the frame clanging, shelves banging, steel instruments skittering away and a short metallic ring, no shattering glass'),
  scuff(1, 'skidding sharply sideways'),
  scuff(2, 'dragging as the leg gives way'),
  scuff(3, 'squeaking as it catches and pushes off'),
  crunch(1, 'ribs cracking one after another'),
  crunch(2, 'spine vertebra snapping under strain'),
  crunch(3, 'collarbone and sternum crunching'),
  crunch(4, 'neck vertebrae grinding then cracking'),
  {
    id: 'kill_tear',
    sound: 'kill_tear',
    file: 'kill-tear.mp3',
    loop: false,
    duration: 1.6,
    promptInfluence: 0.6,
    prompt: `human flesh and skin ripping open from the inside, slow wet tearing then a sudden rip, muscle fibres splitting, horror foley, ${DRY}`,
  },
  {
    id: 'kill_burst',
    sound: 'kill_burst',
    file: 'kill-burst.mp3',
    loop: false,
    duration: 2.0,
    promptInfluence: 0.6,
    prompt: `violent wet chest cavity burst, ribcage exploding outward, heavy gush of blood and gore spraying, organic squelch, horror creature birth foley, ${DRY}`,
  },
  splat(1, 'one heavy spray'),
  splat(2, 'a few smaller wet chunks hitting'),
  splat(3, 'a long arterial spurt across the glass'),
  {
    id: 'blood_drip',
    sound: 'blood_drip',
    file: 'blood-drip.mp3',
    loop: true,
    duration: 8,
    promptInfluence: 0.5,
    prompt: `slow thick drips of blood falling onto a metal lab floor and pooling, irregular wet drips, seamless loop, quiet, ${DRY}`,
  },
  {
    id: 'creature_rush',
    sound: 'creature_rush',
    file: 'creature-rush.mp3',
    loop: false,
    duration: 2.5,
    promptInfluence: 0.55,
    prompt: 'infected zombie creature charging, a guttural wet snarl rising into a hoarse rasping shriek, fast clawed footfalls and heavy ragged breathing, close-miked, dry, no room reverb, no music, no speech, horror creature foley',
  },
  {
    id: 'creature_clicks',
    sound: 'creature_clicks',
    file: 'creature-clicks.mp3',
    loop: false,
    duration: 3.5,
    promptInfluence: 0.55,
    prompt: `newborn alien creature unfolding wet chitinous limbs, insect-like clicking and joint popping, low wet breathing rasp, slime squelches, horror creature foley, ${DRY}`,
  },
  // The R08 kill (medbay-attack spec): her head on the steel cart, her body against the pane, her palm dragged across it.
  // The slam's steel impacts and rattle are CC0 cuts (`scripts/impacts-generate.ts`, banks `cartSlam`, `cartRattle`).
  {
    // livelier-cart-slam D7: the kidney dish thrown off the cart, landing hard (impacts.ts `dish` material). The kept
    // file has Kenney's CC0 `impactMetal_medium_001` mixed in front (the landing clang, the spin 60 ms behind it), then
    // a 0.2 s fade and -6 dB peak: regenerating replaces it with the spin alone (see CREDITS.md).
    id: 'dish_spin',
    sound: 'propDishSpin',
    file: 'dish-spin.mp3',
    loop: false,
    duration: 2.6,
    promptInfluence: 0.7,
    prompt: `Euler disk effect: a metal bowl spinning on its rim on a tile floor, continuous wobbling metallic whirr that speeds up for two seconds, rising in pitch and getting faster, ending in a quick rattle and a final clack as it falls flat, close and dry, no room reverb, no music, no voice`,
  },
  {
    id: 'body_glass_hit',
    sound: 'body_glass_hit',
    file: 'body-glass-hit.mp3',
    loop: false,
    duration: 1.4,
    promptInfluence: 0.65,
    prompt: `a human body thrown hard back-first into a thick reinforced glass window, deep dull thud, the pane flexing and cracking with a sharp splintering tick, then a soft slide down the glass, horror foley, ${DRY}`,
  },
  {
    id: 'glass_squeak',
    sound: 'glass_squeak',
    file: 'glass-squeak.mp3',
    loop: false,
    duration: 1.6,
    promptInfluence: 0.6,
    prompt: `a wet bloody palm dragged slowly sideways across a glass window, long rubbery squeak and smear, fingers skidding, horror foley, ${DRY}`,
  },
  // overhaul-priya-r08-death D26: the dark surgery heard through the rescue, before the creature is seen.
  {
    id: 'surgery_rattle',
    sound: 'surgery_rattle',
    file: 'surgery-rattle.mp3',
    loop: false,
    duration: 1.6,
    promptInfluence: 0.6,
    prompt: `surgical steel instruments on a metal tray rattling and shifting in a dark room as something heavy brushes past the tray, tense metallic tinkling then stillness, horror foley, ${DRY}`,
  },
  {
    id: 'surgery_tray_fall',
    sound: 'surgery_tray_fall',
    file: 'surgery-tray-fall.mp3',
    loop: false,
    duration: 2,
    promptInfluence: 0.65,
    prompt: `a steel surgical tray knocked off a trolley crashing onto a tiled hospital floor, loud metallic clang and scalpels and instruments scattering and skittering across tile, horror foley, ${DRY}`,
  },
  {
    id: 'surgery_breath',
    sound: 'surgery_breath',
    file: 'surgery-breath.mp3',
    loop: false,
    duration: 4.5,
    promptInfluence: 0.55,
    prompt: `slow heavy wet breathing of a large unseen creature in a dark room, a deep rasping inhale and a gurgling bubbling exhale, twice, close and animal, horror foley, ${DRY}`,
  },
  {
    id: 'surgery_scrape',
    sound: 'surgery_scrape',
    file: 'surgery-scrape.mp3',
    loop: false,
    duration: 3,
    promptInfluence: 0.6,
    prompt: `one long slow claw scrape dragged along a ceramic tiled wall, hard keratin claws grinding and squealing on glazed tile, tile grout ticking, horror foley, ${DRY}`,
  },
  {
    id: 'surgery_latch',
    sound: 'surgery_latch',
    file: 'surgery-latch.mp3',
    loop: false,
    duration: 1.6,
    promptInfluence: 0.6,
    prompt: `a heavy metal door handle slowly pushed down from the other side, latch rattling, a click and a clunk as it gives, horror foley, ${DRY}`,
  },
  // overhaul-priya-r08-death 9.4: the creature's claw driven into her body, and the wet flesh as it holds her on it.
  {
    id: 'impale_stab_1',
    sound: 'impale_stab',
    file: 'impale-stab-1.mp3',
    loop: false,
    duration: 1.2,
    promptInfluence: 0.6,
    prompt: `a heavy blade-like claw driven hard through a human torso in one stroke, a deep wet punch and a crunch of ribs giving way, a gush of liquid, horror foley, ${DRY}`,
  },
  {
    id: 'impale_stab_2',
    sound: 'impale_stab',
    file: 'impale-stab-2.mp3',
    loop: false,
    duration: 1.2,
    promptInfluence: 0.6,
    prompt: `a thick curved claw punched through flesh and out the back, wet tearing thrust, cracking cartilage, a spatter of blood on tile, horror foley, ${DRY}`,
  },
  {
    id: 'impale_wet_1',
    sound: 'impale_wet',
    file: 'impale-wet-1.mp3',
    loop: false,
    duration: 2,
    promptInfluence: 0.55,
    prompt: `wet flesh shifting and squelching on a claw that is still inside a body, slow sucking movement, blood dripping and pattering onto a tiled floor, horror foley, ${DRY}`,
  },
  {
    id: 'impale_wet_2',
    sound: 'impale_wet',
    file: 'impale-wet-2.mp3',
    loop: false,
    duration: 2,
    promptInfluence: 0.55,
    prompt: `a body sliding and settling on a claw run through it, thick wet squelch, gristle creak, a steady drip of blood, horror foley, ${DRY}`,
  },
];

function loadApiKey(): string {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
  const envPath = join(ROOT, '.env');
  if (existsSync(envPath)) {
    const match = readFileSync(envPath, 'utf8').match(/^ELEVENLABS_API_KEY=(.+)$/m);
    if (match?.[1]) return match[1].trim().replace(/^["']|["']$/g, '');
  }
  throw new Error('ELEVENLABS_API_KEY not found in environment or .env');
}

function sizeOf(filePath: string): string {
  return `${(statSync(filePath).size / 1024).toFixed(1)}KB`;
}

function detectVolume(filePath: string): { mean: number; max: number } | null {
  const res = spawnSync('ffmpeg', ['-hide_banner', '-i', filePath, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const out = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
  const mean = out.match(/mean_volume:\s*([-\d.]+)\s*dB/);
  const max = out.match(/max_volume:\s*([-\d.]+)\s*dB/);
  return mean?.[1] && max?.[1] ? { mean: Number(mean[1]), max: Number(max[1]) } : null;
}

/** Pure linear gain (no compression, so the drip loop seam stays intact). */
function normalize(filePath: string, loop: boolean): string | null {
  const vol = detectVolume(filePath);
  if (!vol) return null;
  const gainDb = loop ? Math.min(-24 - vol.mean, -3 - vol.max) : -6 - vol.max;
  if (Math.abs(gainDb) < 1.5) return 'unchanged';
  const tmp = `${filePath}.norm.mp3`;
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', filePath, '-af', `volume=${gainDb.toFixed(2)}dB`, '-c:a', 'libmp3lame', '-b:a', '128k', tmp], { stdio: ['ignore', 'pipe', 'pipe'] });
  renameSync(tmp, filePath);
  return `gain ${gainDb >= 0 ? '+' : ''}${gainDb.toFixed(1)}dB`;
}

/** Cut what comes before the take's first sound: everything under 30 dB below its peak, keeping 5 ms of it. */
function trimLead(filePath: string): void {
  const vol = detectVolume(filePath);
  if (!vol) return;
  const tmp = `${filePath}.trim.mp3`;
  const filter = `silenceremove=start_periods=1:start_threshold=${(vol.max - 30).toFixed(1)}dB:start_silence=0.005,afade=t=in:d=0.002`;
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', filePath, '-af', filter, '-c:a', 'libmp3lame', '-b:a', '128k', tmp], { stdio: ['ignore', 'pipe', 'pipe'] });
  renameSync(tmp, filePath);
}

async function generateOne(spec: GoreAssetSpec, apiKey: string, force: boolean): Promise<boolean> {
  const outPath = join(OUT_DIR, spec.file);
  if (existsSync(outPath) && !force) {
    console.log(`[skip] ${spec.id} -> ${spec.file} (${sizeOf(outPath)})`);
    return false;
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const res = await fetch(`${API_URL}?output_format=${encodeURIComponent(OUTPUT_FORMAT)}`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text: spec.prompt, model_id: MODEL_ID, duration_seconds: spec.duration, prompt_influence: spec.promptInfluence, loop: spec.loop }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} generating "${spec.id}": ${await res.text()}`);
  writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
  if (spec.trim) trimLead(outPath);
  const norm = normalize(outPath, spec.loop);
  console.log(`[ok]   ${spec.id} -> ${spec.file} (${sizeOf(outPath)}${norm ? `, ${norm}` : ''})`);
  return true;
}

/** The `samples` entries for every sound whose files all exist. */
export function registrationLines(exists: (file: string) => boolean = (f) => existsSync(join(OUT_DIR, f))): string[] {
  const bySound = new Map<string, string[]>();
  for (const s of GORE_MANIFEST) bySound.set(s.sound, [...(bySound.get(s.sound) ?? []), s.file]);
  const lines: string[] = [];
  for (const [sound, files] of bySound) {
    if (!files.every(exists)) continue;
    const urls = files.map((f) => `'assets/audio/gore/${f}'`);
    lines.push(`  ${sound}: ${urls.length === 1 ? urls[0] : `[${urls.join(', ')}]`},`);
  }
  return lines;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const all = args.includes('--all');
  const ids: string[] = [];
  for (let i = 0; i < args.length; i++) if (args[i] === '--id' && args[i + 1]) ids.push(args[++i]!);

  if (args.includes('--register')) {
    const lines = registrationLines();
    console.log(lines.length ? `Add to samples in the area file under src/audio/sounds/ (kill sounds: kills.ts, hits on the player: player.ts):\n  // Infected-kill body sounds (ElevenLabs, scripts/gore-generate.ts).\n${lines.join('\n')}` : 'No complete sound yet; generate first.');
    return;
  }
  if (args.includes('--list') || (!all && ids.length === 0)) {
    console.log(`Gore manifest (${GORE_MANIFEST.length} assets -> public/assets/audio/gore/):\n`);
    for (const s of GORE_MANIFEST) {
      const have = existsSync(join(OUT_DIR, s.file)) ? 'YES' : '---';
      console.log(`  [${have}] ${s.id.padEnd(20)} ${s.sound.padEnd(18)} ${s.loop ? 'loop' : 'shot'} ${String(s.duration).padStart(4)}s  ${s.file}`);
    }
    return;
  }
  const targets = all
    ? [...GORE_MANIFEST]
    : ids.map((id) => {
        const found = GORE_MANIFEST.find((s) => s.id === id);
        if (!found) throw new Error(`Unknown asset id "${id}". Run with --list to see available ids.`);
        return found;
      });
  const apiKey = loadApiKey();
  let made = 0;
  for (const spec of targets) if (await generateOne(spec, apiKey, force)) made++;
  console.log(`\nDone: ${made} generated, ${targets.length - made} skipped. Next: npm run gore:generate -- --register`);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('gore-generate.ts')) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
