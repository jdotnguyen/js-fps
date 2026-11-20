import type { Rng } from '../core/rng.ts';
import { impulseResponse, type Buf, type IrShape } from './dsp.ts';

/**
 * Per-room reverb presets (spec audio-mix: Room reverb). Each is a procedural impulse response; rooms pick one
 * with the `atmosphere.reverb` key in level data.
 */
export const REVERB_PRESETS = ['metal_corridor', 'metal_hall', 'small_office', 'flooded'] as const;
export type ReverbPreset = (typeof REVERB_PRESETS)[number];

export const DEFAULT_REVERB: ReverbPreset = 'metal_corridor';

/** Seconds to crossfade between two presets on a room change. */
export const REVERB_CROSSFADE = 0.5;

export interface ReverbSpec {
  rt60: number;
  /** Wet level at the output of the convolver. */
  level: number;
  shape: IrShape;
}

export const REVERB_SPECS: Record<ReverbPreset, ReverbSpec> = {
  // Short and bright: hard walls close together.
  metal_corridor: {
    rt60: 1.6,
    level: 0.55,
    shape: {
      cutoff: 6000, darken: 2.2, floor: 300, predelay: 0,
      taps: [[0.007, 0.7, 0], [0.011, 0.55, 1], [0.017, 0.45, 0], [0.023, 0.4, 1], [0.031, 0.3, 0], [0.043, 0.25, 1]],
    },
  },
  // Long and open: late first reflection, widely spaced echoes off a far ceiling.
  metal_hall: {
    rt60: 3.2,
    level: 0.5,
    shape: {
      cutoff: 5000, darken: 1.4, floor: 350, predelay: 0.022,
      taps: [[0.012, 0.5, 0], [0.027, 0.45, 1], [0.049, 0.35, 0], [0.071, 0.3, 1], [0.097, 0.22, 0], [0.131, 0.18, 1]],
    },
  },
  // Dry: soft furnishings, almost no tail.
  small_office: {
    rt60: 0.5,
    level: 0.4,
    shape: {
      cutoff: 4500, darken: 3.5, floor: 400, predelay: 0.003,
      taps: [[0.004, 0.6, 0], [0.007, 0.45, 1], [0.011, 0.3, 0]],
    },
  },
  // Dark and long: sound through water, sparse reflections.
  flooded: {
    rt60: 3.8,
    level: 0.65,
    shape: {
      cutoff: 1800, darken: 1.0, floor: 150, predelay: 0.012,
      taps: [[0.015, 0.4, 0], [0.034, 0.3, 1], [0.062, 0.22, 0]],
    },
  },
};

export function isReverbPreset(name: string): name is ReverbPreset {
  return (REVERB_PRESETS as readonly string[]).includes(name);
}

/** Unknown or missing names fall back to the corridor, so a typo in level data is not silent-fatal. */
export function resolveReverb(name: string | undefined): ReverbPreset {
  return name !== undefined && isReverbPreset(name) ? name : DEFAULT_REVERB;
}

export function renderReverbIr(sr: number, preset: ReverbPreset, rng: Rng): [Buf, Buf] {
  const spec = REVERB_SPECS[preset];
  return impulseResponse(sr, spec.rt60, rng.fork(`reverb:${preset}`), spec.shape);
}
