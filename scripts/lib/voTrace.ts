/**
 * Works out which model made each shipped VO clip from what is left on disk: the raw batch WAVs in
 * `previews/vo-batches/` and the clips' file times. See openspec change pin-tts-model-per-speaker (design,
 * "Finding which line came from which old batch").
 *
 * - Each Gemini TTS model returns PCM in fixed-size chunks, so a WAV's sample count mod 480 identifies it.
 * - The generators encode every clip within about a second of saving its batch WAV, so a clip written just
 *   after a WAV for its speaker came from that WAV (`direct`).
 * - A clip whose WAV was later overwritten takes the model of the surviving WAVs on either side of it, when
 *   both agree and are close in time (`inferred`). Otherwise it is flagged, never guessed.
 */
import type { TakeEntry } from './voTakes.ts';

/** Sample count mod 480 -> model, measured on 2026-11-21 (probe + logged retakes). */
export const MODEL_SIGNATURES: Readonly<Record<number, string>> = {
  263: 'gemini-2.5-flash-preview-tts',
  0: 'gemini-3.1-flash-tts-preview',
  14: 'gemini-3.8-flash-tts',
};

export function modelFromSamples(samples: number): string | null {
  return MODEL_SIGNATURES[samples % 480] ?? null;
}

export interface TraceWav {
  name: string;
  mtimeMs: number;
  /** PCM sample count (16-bit mono). */
  samples: number;
  /** Speakers this batch recorded. */
  speakers: readonly string[];
}

export interface TraceClip {
  id: string;
  speaker: string;
  mtimeMs: number;
}

export interface TracedClip {
  id: string;
  speaker: string;
  model: string | null;
  batch: string | null;
  confidence: 'direct' | 'inferred' | 'flagged';
  reason: string;
}

const DIRECT_LAG_MS = 3_000;
const NEIGHBOUR_MAX_MS = 30 * 60_000;

export function traceClips(wavs: readonly TraceWav[], clips: readonly TraceClip[]): TracedClip[] {
  const sorted = [...wavs].sort((a, b) => a.mtimeMs - b.mtimeMs);
  const known = sorted.filter((w) => modelFromSamples(w.samples) !== null);

  return clips.map((clip): TracedClip => {
    const base = { id: clip.id, speaker: clip.speaker };
    let direct: TraceWav | undefined;
    for (const w of sorted) {
      const lag = clip.mtimeMs - w.mtimeMs;
      if (lag >= -500 && lag <= DIRECT_LAG_MS && w.speakers.includes(clip.speaker)) direct = w;
    }
    if (direct) {
      const model = modelFromSamples(direct.samples);
      return model
        ? { ...base, model, batch: direct.name, confidence: 'direct', reason: `written ${((clip.mtimeMs - direct.mtimeMs) / 1000).toFixed(1)}s after ${direct.name}` }
        : { ...base, model: null, batch: direct.name, confidence: 'flagged', reason: `${direct.name} has an unknown sample-count signature (${direct.samples % 480})` };
    }

    let prev: TraceWav | undefined;
    let next: TraceWav | undefined;
    for (const w of known) {
      if (w.mtimeMs <= clip.mtimeMs) prev = w;
      else if (!next) next = w;
    }
    if (!prev || !next) {
      return { ...base, model: null, batch: null, confidence: 'flagged', reason: `no surviving WAV ${prev ? 'after' : 'before'} it` };
    }
    const pm = modelFromSamples(prev.samples)!;
    const nm = modelFromSamples(next.samples)!;
    const far = clip.mtimeMs - prev.mtimeMs > NEIGHBOUR_MAX_MS || next.mtimeMs - clip.mtimeMs > NEIGHBOUR_MAX_MS;
    if (pm !== nm || far) {
      return {
        ...base, model: null, batch: null, confidence: 'flagged',
        reason: pm !== nm ? `neighbours disagree: ${prev.name} is ${pm}, ${next.name} is ${nm}` : `neighbours ${prev.name} / ${next.name} are more than 30 min away`,
      };
    }
    return { ...base, model: pm, batch: null, confidence: 'inferred', reason: `between ${prev.name} and ${next.name}, both ${pm}` };
  });
}

/**
 * Turns traced clips into `vo-takes.json` entries: one per direct batch, and one per run of inferred clips on
 * the same model written within 10 s of each other. Flagged clips get no entry.
 */
export function tracedEntries(traced: readonly TracedClip[], clips: readonly TraceClip[], voiceOf: (speaker: string) => string): TakeEntry[] {
  const timeOf = new Map(clips.map((c) => [c.id, c.mtimeMs]));
  const usable = traced.filter((t) => t.model !== null).sort((a, b) => timeOf.get(a.id)! - timeOf.get(b.id)!);
  const groups: Array<{ key: string; batch: string; model: string; clips: TracedClip[]; at: number; last: number }> = [];

  for (const t of usable) {
    const at = timeOf.get(t.id)!;
    const key = t.confidence === 'direct' ? `direct:${t.batch}:${t.model}` : `inferred:${t.model}`;
    const open = [...groups].reverse().find((g) => g.key === key && (t.confidence === 'direct' || at - g.last <= 10_000));
    if (open && (t.confidence === 'direct' ? open.batch === t.batch : true)) {
      open.clips.push(t);
      open.last = at;
    } else {
      groups.push({ key, batch: t.batch ?? `unknown@${new Date(at).toISOString()}`, model: t.model!, clips: [t], at, last: at });
    }
  }

  return groups
    .sort((a, b) => a.at - b.at)
    .map((g): TakeEntry => {
      const speakers = [...new Set(g.clips.map((c) => c.speaker))];
      return {
        batch: g.batch,
        speakers,
        voices: speakers.map(voiceOf),
        model: g.model,
        lines: g.clips.map((c) => c.id),
        at: new Date(g.at).toISOString(),
        source: 'traced',
        confidence: g.clips[0]!.confidence === 'direct' ? 'direct' : 'inferred',
      };
    });
}
