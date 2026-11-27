/**
 * Builds the physics impact banks (openspec change adopt-physics-engine, design D16) into
 * `public/assets/audio/physics/`: loose props hitting things, and severed pieces landing.
 *
 * Every entry is a cut from a CC0 recording (credited in CREDITS.md). The downloads live outside the repository, in
 * `../audio-src/physics/` (next to `js-fps`), under the names Freesound and Kenney give them. Each cut is processed
 * like a spent casing (scripts/casings-generate.ts): mono, leading silence trimmed, length capped with a short fade,
 * peak at -6 dB. Relative loudness is set at play time (src/audio/impacts.ts).
 *
 * Usage:
 *   npm run impacts:generate -- --list
 *   npm run impacts:generate -- --all            (cuts whatever is missing)
 *   npm run impacts:generate -- --id glass-1 --force
 *   npm run impacts:generate -- --raw D:/somewhere/audio-src/physics --all
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { polish } from './casings-generate.ts';

const ROOT = resolve(import.meta.dirname, '..');
export const IMPACT_OUT_DIR = 'public/assets/audio/physics';

export type ImpactBank = 'propCartCrash' | 'propCartKnock' | 'propGlass' | 'propGlassHard' | 'propMetal' | 'propThud' | 'limbThud' | 'cartSlam' | 'cartRattle';

export interface ImpactSpec {
  id: string;
  bank: ImpactBank;
  file: string;
  /** Longest kept length (s) after the leading-silence trim. */
  maxSeconds: number;
  /** A file in the raw folder, the span to cut from it (s), and who made it. */
  source: { file: string; start: number; end: number; credit: string };
  /**
   * Further cuts mixed over `source` before the polish: each starts `delay` s in, at `gain` (livelier-cart-slam D6:
   * one slam is a tray boom and the metal ringing on, one rattle is several instruments jumping).
   */
  layers?: ReadonlyArray<{ file: string; start: number; end: number; credit: string; delay: number; gain: number }>;
}

const BOTTLE_HIT = { file: '789460__limpinglizards__bottle-hit-3.wav', credit: 'limpinglizards, "bottle hit 3" (Freesound 789460, CC0)' };
const BOTTLE_CLINK = { file: '506913__schoman3__bottle_clink.mp3', credit: 'schoman3, "Bottle_Clink.mp3" (Freesound 506913, CC0)' };
const WINE = { file: '253337__jmayoff__wine-bottles-clinking-on-a-concrete-floor.mp3', credit: 'jmayoff, "Wine bottles clinking on a concrete floor" (Freesound 253337, CC0)' };
const TROLLEY = { file: '721549__inmotionaudio__objwhled_teatrolley02_inmotionaudio_freesamplesunday.wav', credit: 'InMotionAudio, "OBJWhled_TeaTrolley02" (Freesound 721549, CC0)' };
const BANG = { file: '315916__bevibeldesign__bang-crash.aiff', credit: 'bevibeldesign, "bang crash.aiff" (Freesound 315916, CC0)' };
const RATTLE = { file: '815600__squarfington__metal-crash-reverberant-rattle-1.wav', credit: 'squarfington, "metal crash reverberant rattle 1" (Freesound 815600, CC0)' };
const DROP = { file: '339365__newagesoup__drop05.wav', credit: 'newagesoup, "drop05.wav" (Freesound 339365, CC0)' };
const GORE = { file: '641046__magnuswaker__gore-impact-lot-of-heart.wav', credit: 'magnuswaker, "Gore Impact - LOT OF HEART" (Freesound 641046, CC0)' };
/** One file of Kenney's pack, taken whole. */
const kenney = (name: string): { file: string; start: number; end: number; credit: string } => ({
  file: `kenney_impact-sounds/Audio/${name}.ogg`,
  start: 0,
  end: 1,
  credit: 'Kenney, "Impact Sounds" (kenney.nl, CC0)',
});

/** `propGlassHard`, 3 -> id `glass-hard-3`, file `prop-glass-hard-3.mp3`; `limbThud` -> `limb-thud-1.mp3`. */
function bank(name: ImpactBank, maxSeconds: number, sources: ReadonlyArray<{ file: string; start: number; end: number; credit: string; layers?: ImpactSpec['layers'] }>): ImpactSpec[] {
  const kebab = name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  return sources.map(({ layers, ...source }, i) => ({
    id: `${kebab.replace(/^prop-/, '')}-${i + 1}`,
    bank: name,
    file: `${kebab}-${i + 1}.mp3`,
    maxSeconds,
    source,
    ...(layers ? { layers } : {}),
  }));
}

/** A Kenney clip laid over a cut, `delay` s in, at `gain`. */
const over = (name: string, delay: number, gain: number) => ({ ...kenney(name), delay, gain });

/** Mix a spec's source and layers into one mono WAV (the polish then trims, caps and levels it). */
function mixLayers(raw: string, s: ImpactSpec, out: string): void {
  const parts = [s.source, ...(s.layers ?? [])];
  const inputs = parts.flatMap((p) => ['-i', join(raw, p.file)]);
  const chains = parts.map((p, i) => {
    const delay = 'delay' in p ? Math.round((p as { delay: number }).delay * 1000) : 0;
    const gain = 'gain' in p ? (p as { gain: number }).gain : 1;
    return `[${i}:a]aresample=44100,pan=mono|c0=c0,atrim=${p.start.toFixed(3)}:${p.end.toFixed(3)},asetpts=PTS-STARTPTS,adelay=${delay},volume=${gain}[l${i}]`;
  });
  const mix = `${parts.map((_, i) => `[l${i}]`).join('')}amix=inputs=${parts.length}:normalize=0:duration=longest[m]`;
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...inputs, '-filter_complex', [...chains, mix].join(';'), '-map', '[m]', '-ac', '1', out], { stdio: ['ignore', 'pipe', 'pipe'] });
}

export const IMPACT_MANIFEST: readonly ImpactSpec[] = [
  // The prep cart struck hard (Voss, or tipping onto the floor): the three whole crashes.
  ...bank('propCartCrash', 1.8, [
    { ...TROLLEY, start: 0, end: 2 },
    { ...BANG, start: 0.2, end: 2.04 },
    { ...RATTLE, start: 0.36, end: 2.2 },
  ]),
  // The cart nudged or settling.
  ...bank('propCartKnock', 0.6, [kenney('impactPlate_heavy_000'), kenney('impactPlate_heavy_002'), kenney('impactMetal_heavy_001'), kenney('impactMetal_heavy_003')]),
  // Glassware tapping: single clinks out of the wine-bottle session, the short bottle clink, Kenney's light glass.
  ...bank('propGlass', 0.5, [
    { ...BOTTLE_CLINK, start: 0, end: 0.45 },
    { ...WINE, start: 0.19, end: 0.55 },
    { ...WINE, start: 0.91, end: 1.22 },
    { ...WINE, start: 2.6, end: 3.02 },
    { ...WINE, start: 9.09, end: 9.36 },
    { ...WINE, start: 9.7, end: 10.2 },
    kenney('impactGlass_light_000'),
    kenney('impactGlass_light_002'),
  ]),
  // Glassware dropped: the bottle knocked onto concrete (with its bounces), and Kenney's medium glass.
  ...bank('propGlassHard', 1.4, [{ ...BOTTLE_HIT, start: 0.5, end: 2.1 }, kenney('impactGlass_medium_000'), kenney('impactGlass_medium_001'), kenney('impactGlass_medium_003')]),
  // Tray and rack.
  ...bank('propMetal', 0.5, [
    kenney('impactTin_medium_000'),
    kenney('impactTin_medium_003'),
    kenney('impactTin_medium_004'),
    kenney('impactMetal_light_000'),
    kenney('impactMetal_light_001'),
    kenney('impactMetal_light_003'),
  ]),
  // The microscope.
  ...bank('propThud', 0.5, [{ ...DROP, start: 0, end: 0.5 }, kenney('impactSoft_heavy_000'), kenney('impactSoft_heavy_001'), kenney('impactSoft_heavy_003')]),
  // The R08 slam (livelier-cart-slam D6): the steel tray boomed under her head, each with a different ring; the third,
  // the hardest, carries the reverberant crash. Played in turn, so no two in a row match.
  ...bank('cartSlam', 1.6, [
    { ...kenney('impactPlate_heavy_001'), layers: [over('impactMetal_heavy_000', 0.01, 0.8), over('impactSoft_heavy_002', 0, 0.6), { ...RATTLE, start: 1.2, end: 2.4, delay: 0.03, gain: 0.7 }] },
    { ...kenney('impactPlate_heavy_003'), layers: [over('impactMetal_heavy_002', 0.01, 0.8), over('impactSoft_heavy_004', 0, 0.7), { ...RATTLE, start: 2.2, end: 3.4, delay: 0.03, gain: 0.9 }] },
    { ...kenney('impactPlate_heavy_004'), layers: [over('impactMetal_heavy_004', 0.01, 0.9), over('impactPunch_heavy_001', 0, 0.6), { ...RATTLE, start: 0.3, end: 1.9, delay: 0.02, gain: 0.55 }] },
  ]),
  // The instruments jumping on the tray as it is struck: several light hits a few hundredths of a second apart.
  ...bank('cartRattle', 0.9, [
    { ...kenney('impactMetal_light_002'), layers: [over('impactTin_medium_001', 0.07, 0.6), over('impactGlass_light_001', 0.11, 0.4), over('impactMetal_light_004', 0.17, 0.5)] },
    { ...kenney('impactTin_medium_002'), layers: [over('impactMetal_medium_000', 0.05, 0.7), over('impactMetal_light_002', 0.13, 0.5), over('impactTin_medium_001', 0.24, 0.4)] },
    { ...kenney('impactMetal_medium_002'), layers: [over('impactMetal_light_004', 0.04, 0.6), over('impactTin_medium_002', 0.1, 0.5), over('impactGlass_light_003', 0.18, 0.4), over('impactMetal_medium_004', 0.3, 0.45)] },
  ]),
  // A severed piece landing; the game varies its pitch.
  ...bank('limbThud', 1.0, [{ ...GORE, start: 0, end: 1.15 }]),
];

/** `assets/...` URLs per bank, in variant order (what src/audio/sounds/impacts.ts registers). */
export function impactUrls(): Record<ImpactBank, string[]> {
  const out = {} as Record<ImpactBank, string[]>;
  for (const s of IMPACT_MANIFEST) (out[s.bank] ??= []).push(`${IMPACT_OUT_DIR.replace(/^public\//, '')}/${s.file}`);
  return out;
}

function main(): void {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const all = args.includes('--all');
  const ids: string[] = [];
  let raw = resolve(ROOT, '../audio-src/physics');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--id' && args[i + 1]) ids.push(args[++i]!);
    else if (args[i] === '--raw' && args[i + 1]) raw = resolve(args[++i]!);
  }
  if (args.includes('--list') || (!all && ids.length === 0)) {
    console.log(`Impact banks (${IMPACT_MANIFEST.length} clips -> ${IMPACT_OUT_DIR}/):\n`);
    for (const s of IMPACT_MANIFEST) {
      const there = existsSync(join(ROOT, IMPACT_OUT_DIR, s.file)) ? 'YES' : '---';
      console.log(`  [${there}] ${s.id.padEnd(16)} ${s.bank.padEnd(14)} ${s.file.padEnd(26)} ${s.source.credit}`);
    }
    return;
  }
  const targets = all
    ? [...IMPACT_MANIFEST]
    : ids.map((id) => {
        const s = IMPACT_MANIFEST.find((m) => m.id === id);
        if (!s) throw new Error(`Unknown impact clip id "${id}".`);
        return s;
      });
  mkdirSync(join(ROOT, IMPACT_OUT_DIR), { recursive: true });
  let built = 0;
  let skipped = 0;
  for (const s of targets) {
    const out = join(ROOT, IMPACT_OUT_DIR, s.file);
    if (existsSync(out) && !force) {
      skipped++;
      continue;
    }
    for (const p of [s.source, ...(s.layers ?? [])]) {
      const src = join(raw, p.file);
      if (!existsSync(src)) throw new Error(`${s.id}: missing raw recording ${src} (download it from the source in its credit: ${p.credit})`);
    }
    if (s.layers) {
      const tmp = `${out}.mix.wav`;
      mixLayers(raw, s, tmp);
      console.log(`[mix] ${s.id.padEnd(16)} -> ${s.file} (${polish(tmp, out, s.maxSeconds)})`);
      unlinkSync(tmp);
    } else console.log(`[cut] ${s.id.padEnd(16)} -> ${s.file} (${polish(join(raw, s.source.file), out, s.maxSeconds, s.source)})`);
    built++;
  }
  console.log(`\nDone: ${built} built, ${skipped} skipped.`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
