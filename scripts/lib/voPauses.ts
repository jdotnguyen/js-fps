/**
 * Pause caps for tight scenes (overhaul-priya-r08-death decision 36). TTS takes often hold 1-3 s of air inside a line;
 * in a scene that plays its lines back to back that air is dead time. These helpers find the quiet runs in a clip and
 * shorten any that run past a cap, keeping the speech untouched.
 *
 * The caps live here (not as hand edits on the mp3s) so `vo-generate` applies them to every new take, and
 * `vo-tighten` applies them to the shipped clips.
 */

/** Longest pause kept inside a line (s). */
export const PAUSE_CAP = 0.6;
/** Longest pause kept where the script writes a beat ("..." or a bracketed [beat]) (s). */
export const BEAT_CAP = 1.0;
/** Air kept before the first word and after the last (s). */
export const LEAD = 0.04;
export const TAIL = 0.18;

/**
 * Lines whose pauses are capped, and the cap for each: the security office rescue (sections A-F). The written beats
 * (lines 5, 10, 14, 17, 19 and 22 of decision 29) get `BEAT_CAP`.
 */
export const TIGHT_LINES: Readonly<Record<string, number>> = {
  sec_priya_10: BEAT_CAP,
  sec_okafor_10: PAUSE_CAP,
  sec_priya_11: PAUSE_CAP,
  sec_priya_12: PAUSE_CAP,
  sec_giles_10: BEAT_CAP,
  sec_giles_11: PAUSE_CAP,
  sec_priya_13: PAUSE_CAP,
  sec_okafor_13: BEAT_CAP,
  sec_okafor_14: PAUSE_CAP,
  sec_priya_14: PAUSE_CAP,
  sec_okafor_15: BEAT_CAP,
  sec_priya_15: PAUSE_CAP,
  sec_priya_16: BEAT_CAP,
  sec_okafor_16: PAUSE_CAP,
  sec_okafor_17: BEAT_CAP,
  sec_priya_18: BEAT_CAP, // the laugh breaking into a sob: its gap is acting
  sec_giles_12: PAUSE_CAP,
  sec_giles_13: PAUSE_CAP,
  sec_priya_19: PAUSE_CAP,
  sec_priya_20: PAUSE_CAP,
  r15a_heins_03: PAUSE_CAP,
  r15a_jay_01: PAUSE_CAP,
};

/** A half-open sample range [start, end) to keep. */
export interface Span {
  start: number;
  end: number;
}

/** A quiet run inside the speech, in samples. */
interface Quiet {
  start: number;
  end: number;
}

/**
 * Where the speech is: RMS over 20 ms windows, quiet under 4% of the clip's peak RMS (as the batch splitter judges
 * silence). Returns the first and last loud sample and the quiet runs between them, or null for a silent clip.
 */
function activity(samples: Float32Array, sr: number): { first: number; last: number; quiet: Quiet[] } | null {
  const win = Math.max(1, Math.round(sr * 0.02));
  const frames = Math.floor(samples.length / win);
  const rms = new Float32Array(frames);
  let peak = 0;
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = 0; i < win; i++) sum += samples[f * win + i]! ** 2;
    rms[f] = Math.sqrt(sum / win);
    peak = Math.max(peak, rms[f]!);
  }
  const thr = Math.max(peak * 0.04, 0.002);
  let first = 0;
  while (first < frames && rms[first]! < thr) first++;
  if (first >= frames) return null;
  let last = frames - 1;
  while (last > first && rms[last]! < thr) last--;
  const quiet: Quiet[] = [];
  for (let f = first; f <= last; ) {
    if (rms[f]! >= thr) {
      f++;
      continue;
    }
    const q0 = f;
    while (f <= last && rms[f]! < thr) f++;
    quiet.push({ start: q0 * win, end: f * win });
  }
  return { first: first * win, last: (last + 1) * win, quiet };
}

/**
 * The spans of `samples` to keep so no quiet run inside the speech is longer than `cap` seconds, with `LEAD` before
 * the first sound and `TAIL` after the last. A long pause keeps its first and last `cap / 2`, so breaths into and out
 * of words stay.
 */
export function pauseSpans(samples: Float32Array, sr: number, cap: number): Span[] {
  const a = activity(samples, sr);
  if (!a) return [{ start: 0, end: samples.length }];
  const half = Math.round((cap / 2) * sr);
  const spans: Span[] = [];
  let from = Math.max(0, a.first - Math.round(LEAD * sr));
  for (const q of a.quiet) {
    if ((q.end - q.start) / sr <= cap) continue;
    spans.push({ start: from, end: q.start + half });
    from = q.end - half;
  }
  spans.push({ start: from, end: Math.min(samples.length, a.last + Math.round(TAIL * sr)) });
  return spans;
}

/** Join the kept spans, with a 5 ms ramp down and up at each cut so it does not click. */
export function joinSpans(samples: Float32Array, sr: number, spans: readonly Span[]): Float32Array {
  const out = new Float32Array(spans.reduce((n, s) => n + (s.end - s.start), 0));
  const ramp = Math.max(1, Math.round(sr * 0.005));
  let o = 0;
  spans.forEach((s, k) => {
    const len = s.end - s.start;
    for (let i = 0; i < len; i++) {
      let g = 1;
      if (k > 0 && i < ramp) g = i / ramp;
      if (k < spans.length - 1 && len - i <= ramp) g = Math.min(g, (len - i) / ramp);
      out[o + i] = samples[s.start + i]! * g;
    }
    o += len;
  });
  return out;
}

/** Longest quiet run inside the speech (s), by the same measure the caps use. */
export function longestPause(samples: Float32Array, sr: number): number {
  const a = activity(samples, sr);
  return a ? Math.max(0, ...a.quiet.map((q) => (q.end - q.start) / sr)) : 0;
}
