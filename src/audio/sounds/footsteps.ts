/** Boot steps and wading, with the procedural boot step fallbacks. Part of the sound registry (./index.ts). */

import type { Rng } from '../../core/rng.ts';
import { Biquad, fadeEdges, makeBuf, normalize, OnePole, white, type Buf } from '../dsp.ts';
import { ResonatorBank, type SoundSpec } from '../synth.ts';

interface StepOptions {
  /** Plate resonances. */
  modes: { count: number; fMin: number; fMax: number; qMin: number; qMax: number; level: number };
  /** Extra light impacts after the step (loose grating bars knocking). */
  rattles: number;
  rattleWindow: number;
  grit: number;
  thud: number;
}

/**
 * Boot step: heel strike then toe, each a short rubber-filtered noise burst that excites
 * the plate resonances, plus a low body thud, gravel-like grit crunching under the sole,
 * and a brief scuff as the foot rolls.
 */
function bootStep(sr: number, rng: Rng, o: StepOptions): Buf {
  const dur = 0.5;
  const b = makeBuf(sr, dur);
  const noise = white(rng.fork('noise'));
  const gritNoise = white(rng.fork('grit'));
  const sole = new OnePole(rng.range(1800, 2800), sr); // rubber sole damps the highs
  const bank = new ResonatorBank(sr, rng.fork('modes'), o.modes.count, o.modes.fMin, o.modes.fMax, o.modes.qMin, o.modes.qMax);
  const thudLp = new Biquad('lowpass', rng.range(110, 160), 0.9, sr);
  const gritHp = new Biquad('highpass', rng.range(2500, 4000), 0.7, sr);
  const scuffBp = new Biquad('bandpass', rng.range(1800, 3200), 0.8, sr);
  const out = new Biquad('lowpass', 7000, 0.7, sr);
  const toe = rng.range(0.065, 0.11);
  const impacts: Array<[number, number]> = [[0, 1], [toe, rng.range(0.45, 0.65)]];
  for (let k = 0; k < o.rattles; k++) impacts.push([rng.range(0.02, o.rattleWindow), rng.range(0.08, 0.25)]);
  const gritRate = o.grit * 0.035;

  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    let excite = 0;
    let weight = 0;
    let gritEnv = 0;
    for (const [at, g] of impacts) {
      const dt = t - at;
      if (dt < 0) continue;
      excite += g * Math.exp(-dt / 0.005) * Math.min(1, dt / 0.0004);
      weight += g * Math.exp(-dt / 0.028);
      gritEnv += g * Math.exp(-dt / 0.035);
    }
    const n = noise();
    const strike = sole.process(n * excite);
    const plate = bank.process(strike) * o.modes.level;
    const thud = thudLp.process(n * weight) * o.thud;
    // Grit: sparse sharp crackles while weight is coming down.
    const crackle = gritNoise() < 1 - 2 * gritRate * gritEnv ? 0 : gritNoise() * gritEnv;
    const grit = gritHp.process(crackle) * o.grit;
    // Scuff: a soft sliding hiss between heel and toe.
    const scuffEnv = Math.max(0, Math.sin((Math.PI * Math.min(Math.max(t - 0.01, 0), toe)) / toe)) * (t < toe + 0.01 ? 1 : 0);
    const scuff = scuffBp.process(n) * scuffEnv * 0.06;
    b[i] = out.process(strike * 0.35 + plate + thud + grit + scuff);
  }
  return fadeEdges(normalize(b, 0.8), sr, 0.0005, 0.05);
}

/** Boot on painted concrete: dense damped low-mid thud, fine dry grit, no metallic ring. */
export function footConcrete(sr: number, rng: Rng): Buf {
  return bootStep(sr, rng, {
    modes: { count: 10, fMin: 120, fMax: 950, qMin: 1.5, qMax: 3.2, level: 0.75 },
    rattles: 0,
    rattleWindow: 0,
    grit: 1.15,
    thud: 3.2,
  });
}

/** Boot on rubber or carpet: soft, muffled low thump with minimal grit or ring. */
export function footRubber(sr: number, rng: Rng): Buf {
  return bootStep(sr, rng, {
    modes: { count: 6, fMin: 90, fMax: 420, qMin: 1.1, qMax: 2.0, level: 0.35 },
    rattles: 0,
    rattleWindow: 0,
    grit: 0.15,
    thud: 2.6,
  });
}

/** Boot on diamond plate: dense damped plate resonance, heavy thud, some grit. */
export function footPlate(sr: number, rng: Rng): Buf {
  return bootStep(sr, rng, {
    modes: { count: 16, fMin: 160, fMax: 3400, qMin: 5, qMax: 12, level: 2.2 },
    rattles: 0,
    rattleWindow: 0,
    grit: 0.9,
    thud: 2.6,
  });
}

/** Boot on grating: lighter thud, ringier bar resonances, loose bars rattling after. */
export function footGrate(sr: number, rng: Rng): Buf {
  return bootStep(sr, rng, {
    modes: { count: 12, fMin: 420, fMax: 4200, qMin: 14, qMax: 26, level: 2.6 },
    rattles: rng.int(3, 6),
    rattleWindow: 0.16,
    grit: 1.2,
    thud: 1.6,
  });
}

export const specs = {
  footConcrete: { make: footConcrete, loop: false, variants: 6 },
  footRubber: { make: footRubber, loop: false, variants: 6 },
  footPlate: { make: footPlate, loop: false, variants: 6 },
  footGrate: { make: footGrate, loop: false, variants: 6 },
} as const satisfies Record<string, SoundSpec>;

export const samples = {
  // Seven boot steps on painted concrete (ElevenLabs, scripts/footsteps-generate.ts).
  footConcrete: [1, 2, 3, 4, 5, 6, 7].map((i) => `assets/audio/footsteps/foot-concrete-${i}.mp3`),
  // Seven boot steps cut from the first ~4 s of freesound_community "metal footsteps" (14727).
  footPlate: [1, 2, 3, 4, 5, 6, 7].map((i) => `assets/audio/footsteps/foot-metal-${i}.mp3`),
  // Wading in standing water (in-world-audio spec; ElevenLabs, scripts/footsteps-generate.ts): ankle-to-knee and thigh deep.
  footWadeShallow: [1, 2, 3].map((i) => `assets/audio/footsteps/foot-wade-shallow-${i}.mp3`),
  footWadeDeep: [1, 2, 3].map((i) => `assets/audio/footsteps/foot-wade-deep-${i}.mp3`),
} as const satisfies Record<string, string | readonly string[]>;
