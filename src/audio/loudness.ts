/**
 * The loudness envelope of a recording (voss-death-scene D11): what a screaming kill victim's jaw follows. Pure, so it
 * runs in node tests. RMS over 20 ms windows, 5 ms apart, normalised to its 95th percentile (one spike does not shrink
 * everything else), then followed with a 15 ms attack and a 60 ms release, each the time to cover 90% of a step.
 */
export const LOUDNESS = { windowS: 0.02, stepS: 0.005, percentile: 0.95, attackS: 0.015, releaseS: 0.06 } as const;

/** Below this RMS the whole recording counts as silent. */
const SILENT = 1e-4;

export interface LoudnessEnvelope {
  /** Loudness 0..1, one value every `step` s from the start of the recording. */
  values: Float32Array;
  step: number;
}

export function loudnessEnvelope(samples: ArrayLike<number>, sampleRate: number): LoudnessEnvelope {
  const hop = Math.max(1, Math.round(sampleRate * LOUDNESS.stepS));
  const half = Math.max(1, Math.round((sampleRate * LOUDNESS.windowS) / 2));
  const step = hop / sampleRate;
  const values = new Float32Array(Math.ceil(samples.length / hop));
  for (let i = 0; i < values.length; i++) {
    // Centred on its own time, so the envelope neither leads nor lags the sound.
    const from = Math.max(0, i * hop - half);
    const to = Math.min(samples.length, i * hop + half);
    let sum = 0;
    for (let s = from; s < to; s++) sum += samples[s]! * samples[s]!;
    values[i] = Math.sqrt(sum / Math.max(1, to - from));
  }
  const sorted = Float32Array.from(values).sort();
  const high = sorted[Math.floor((sorted.length - 1) * LOUDNESS.percentile)] ?? 0;
  // A recording that is nearly all silence normalises to its loudest window instead.
  const full = high > SILENT ? high : (sorted[sorted.length - 1] ?? 0);
  const attack = 1 - Math.pow(0.1, step / LOUDNESS.attackS);
  const release = 1 - Math.pow(0.1, step / LOUDNESS.releaseS);
  let level = 0;
  for (let i = 0; i < values.length; i++) {
    const target = full > SILENT ? Math.min(1, values[i]! / full) : 0;
    level += (target - level) * (target > level ? attack : release);
    values[i] = level;
  }
  return { values, step };
}

/** The loudness `t` s into the recording, between the envelope's values; 0 before it starts and after it ends. */
export function loudnessAt(env: LoudnessEnvelope, t: number): number {
  const k = t / env.step;
  if (k < 0 || k > env.values.length - 1) return 0;
  const i = Math.floor(k);
  const a = env.values[i]!;
  const b = env.values[i + 1] ?? a;
  return a + (b - a) * (k - i);
}
