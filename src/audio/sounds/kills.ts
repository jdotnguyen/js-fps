/** Infected kills: body sounds, the R08 and Lab B scenes, and their procedural fallbacks. Part of the sound registry (./index.ts). */

import type { Rng } from '../../core/rng.ts';
import { Biquad, brown, fadeEdges, makeBuf, normalize, TAU, white, type Buf } from '../dsp.ts';
import { clamp01, lerp, modal, type SoundSpec } from '../synth.ts';

// ------------------------------------------------------------------ set-piece one-shots (ADR-0014 beats 5 and 8)

/** Wet tearing: a run of crackling noise bursts through a sweeping band-pass, with a low, meaty thump under it. */
export function fleshTear(sr: number, rng: Rng): Buf {
  const dur = rng.range(0.9, 1.3);
  const b = makeBuf(sr, dur);
  const n = white(rng);
  const bp = new Biquad('bandpass', 900, 1.4, sr);
  const lp = new Biquad('lowpass', 220, 0.8, sr);
  const thump = brown(rng.fork('thump'));
  let crackle = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    const p = t / dur;
    if (i % 64 === 0) bp.set(lerp(1500, 500, p) * (1 + 0.3 * Math.sin(TAU * 7 * t)), 1.4);
    // Stick-slip: random sharp clicks, denser in the middle of the rip.
    if (rng.next() < 0.004 * Math.sin(Math.PI * p) + 0.0004) crackle = 1;
    crackle *= 0.985;
    const wet = bp.process(n()) * (0.35 + 0.65 * Math.sin(Math.PI * p) ** 0.5) * (0.6 + crackle);
    const low = lp.process(thump()) * Math.exp(-t / 0.25) * 1.4;
    b[i] = (wet + low) * clamp01(t / 0.01) * clamp01((dur - t) / 0.2);
  }
  return fadeEdges(normalize(b, 0.85), sr, 0.002, 0.05);
}

/** A palm slapping thick glass: a dull thump and a short glassy ring. */
export function glassThud(sr: number, rng: Rng): Buf {
  const b = makeBuf(sr, 0.9);
  const base = rng.range(380, 520);
  const ratios = [1, 2.71, 5.4, 8.9];
  const phases = ratios.map(() => rng.next() * TAU);
  const noise = white(rng.fork('n'));
  const lp = new Biquad('lowpass', 260, 0.9, sr);
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    const ring = modal(t, base, ratios, [0.25, 0.14, 0.07, 0.04], [0.18, 0.12, 0.08, 0.05], phases);
    const thud = lp.process(noise()) * Math.exp(-t / 0.04) * 2.2;
    b[i] = (ring + thud) * Math.min(1, t / 0.0015);
  }
  return fadeEdges(normalize(b, 0.9), sr, 0, 0.08);
}

export const specs = {
  fleshTear: { make: fleshTear, loop: false, variants: 3 },
  glassThud: { make: glassThud, loop: false, variants: 3 },
} as const satisfies Record<string, SoundSpec>;

export const samples = {
  // Infected-kill body sounds (ElevenLabs, scripts/gore-generate.ts; infection-kills spec, data/kills.json).
  kill_crunch: ['assets/audio/gore/kill-crunch-1.mp3', 'assets/audio/gore/kill-crunch-2.mp3', 'assets/audio/gore/kill-crunch-3.mp3', 'assets/audio/gore/kill-crunch-4.mp3'],
  kill_tear: 'assets/audio/gore/kill-tear.mp3',
  kill_burst: 'assets/audio/gore/kill-burst.mp3',
  blood_splat_glass: ['assets/audio/gore/blood-splat-glass-1.mp3', 'assets/audio/gore/blood-splat-glass-2.mp3', 'assets/audio/gore/blood-splat-glass-3.mp3'],
  blood_drip: 'assets/audio/gore/blood-drip.mp3',
  creature_clicks: 'assets/audio/gore/creature-clicks.mp3',
  // The R08 kill (medbay-attack spec): three head-impact crunches with names of their own, so the slams can play them in
  // turn (never the same one twice running); the recorded kill crunches stand in until head-impact takes are made.
  head_crunch_1: 'assets/audio/gore/kill-crunch-2.mp3',
  head_crunch_2: 'assets/audio/gore/kill-crunch-4.mp3',
  head_crunch_3: 'assets/audio/gore/kill-crunch-1.mp3',
  // Not generated yet (`npm run gore:generate -- --id <name>`): until they exist the kill plays the next id it names.
  body_glass_hit: 'assets/audio/gore/body-glass-hit.mp3',
  // overhaul-priya-r08-death D26: the dark surgery, heard through the rescue.
  surgery_rattle: 'assets/audio/gore/surgery-rattle.mp3',
  surgery_tray_fall: 'assets/audio/gore/surgery-tray-fall.mp3',
  surgery_breath: 'assets/audio/gore/surgery-breath.mp3',
  surgery_scrape: 'assets/audio/gore/surgery-scrape.mp3',
  surgery_latch: 'assets/audio/gore/surgery-latch.mp3',
  // overhaul-priya-r08-death 9.4: the impale (data/kills.json mauled), two variants each.
  // The lab creature charging Priya in R08 (ElevenLabs, scripts/gore-generate.ts).
  creature_rush: 'assets/audio/gore/creature-rush.mp3',
  impale_stab: ['assets/audio/gore/impale-stab-1.mp3', 'assets/audio/gore/impale-stab-2.mp3'],
  impale_wet: ['assets/audio/gore/impale-wet-1.mp3', 'assets/audio/gore/impale-wet-2.mp3'],
  // The blade piercing her and her choking as it goes in: two downloaded clips (CREDITS.md); the choke is raised 2x.
  impale_blade: 'assets/audio/gore/impale-blade.mp3',
  impale_choke: 'assets/audio/gore/impale-choke.mp3',
  glass_squeak: 'assets/audio/gore/glass-squeak.mp3',
  // The creature hammering on the Lab B glass, and Voss's palms on it (ElevenLabs, scripts/gore-generate.ts).
  creature_glass_hit: [1, 2, 3, 4].map((i) => `assets/audio/gore/creature-glass-hit-${i}.mp3`),
  palm_glass_hit: [1, 2, 3].map((i) => `assets/audio/gore/palm-glass-hit-${i}.mp3`),
  // Voss panting and whimpering as it crawls up her arm (Gemini TTS, scripts/vo-reactions.ts --only react_voss_panic).
  voss_panic_breath: ['assets/vo/react_voss_panic_01.mp3', 'assets/vo/react_voss_panic_02.mp3', 'assets/vo/react_voss_panic_03.mp3'],
  // Her gasps, grunts and bloody coughs in the run to the glass (Gemini TTS, scripts/vo-reactions.ts --per-take --only
  // react_voss_gasp,react_voss_grunt,react_voss_cough; voss-death-scene 4.7).
  voss_gasp: [1, 2, 3].map((i) => `assets/vo/react_voss_gasp_0${i}.mp3`),
  voss_grunt: [1, 2, 3].map((i) => `assets/vo/react_voss_grunt_0${i}.mp3`),
  voss_cough: [1, 2, 3].map((i) => `assets/vo/react_voss_cough_0${i}.mp3`),
  // Her wet gags as she crouch-walks to the glass with blood running from her mouth (Gemini TTS, --per-take --only
  // react_voss_gag, cut by hand: docs/voice-casting-standard.md).
  voss_gag: [1, 2, 3].map((i) => `assets/vo/react_voss_gag_0${i}.mp3`),
  // The blows of that run, each one designed sound at its time, over the quieter physics impacts of what it throws
  // (ElevenLabs, scripts/gore-generate.ts; voss-death-scene D10).
  body_bench_hit: 'assets/audio/gore/body-bench-hit.mp3',
  bench_sweep: 'assets/audio/gore/bench-sweep.mp3',
  cart_crash: 'assets/audio/gore/cart-crash.mp3',
  voss_scuff: [1, 2, 3].map((i) => `assets/audio/gore/voss-scuff-${i}.mp3`),
} as const satisfies Record<string, string | readonly string[]>;
