/**
 * Procedural vocal emotes: non-verbal mood sounds in a speaker's voice, the fallback when a line's recording is missing (spec voice-playback).
 *
 * Source-filter model, rendered offline to a mono buffer (runs in Node for tests and
 * previews, and in the browser before upload to an AudioBuffer):
 *   band-limited glottal pulse (harmonic series with spectral tilt) + breath noise
 *   -> three parallel band-pass formants moving between vowel targets
 *   -> saturator -> speaker brightness EQ.
 * Every render is seeded, so the same line id always sounds the same.
 */
import { Rng } from '../core/rng.ts';
import { Biquad, fadeEdges, makeBuf, normalize, OnePole, pink, TAU, white, type Buf } from '../audio/dsp.ts';
import type { Emote, VoiceProfile } from '../data/types/dialogue.ts';

// ------------------------------------------------------------------ vowels

export const VOWELS = ['a', 'e', 'i', 'o', 'u', 'm', '@'] as const;
export type Vowel = (typeof VOWELS)[number];

interface VowelShape {
  f: readonly [number, number, number];
  g: readonly [number, number, number];
}

/** Adult-male reference formants (Hz) and relative gains; `m` is a closed-mouth hum, `@` a schwa. */
const VOWEL_SHAPES: Record<Vowel, VowelShape> = {
  a: { f: [730, 1090, 2440], g: [1, 0.55, 0.28] },
  e: { f: [530, 1840, 2480], g: [1, 0.5, 0.32] },
  i: { f: [300, 2250, 3000], g: [1, 0.32, 0.28] },
  o: { f: [570, 840, 2410], g: [1, 0.6, 0.14] },
  u: { f: [320, 870, 2240], g: [1, 0.3, 0.1] },
  m: { f: [260, 1300, 2500], g: [1, 0.07, 0.035] },
  '@': { f: [500, 1500, 2500], g: [1, 0.45, 0.25] },
};
const BANDWIDTH: readonly [number, number, number] = [80, 110, 160];

type Keys = ReadonlyArray<readonly [number, Vowel]>;

function vowelAt(keys: Keys, u: number, out: { f: number[]; g: number[] }): void {
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1]![0] <= u) i++;
  const [u0, v0] = keys[i]!;
  const next = keys[Math.min(i + 1, keys.length - 1)]!;
  const span = next[0] - u0;
  const k = span > 0 ? Math.min(1, Math.max(0, (u - u0) / span)) : 0;
  const s = k * k * (3 - 2 * k);
  const a = VOWEL_SHAPES[v0];
  const b = VOWEL_SHAPES[next[1]];
  for (let j = 0; j < 3; j++) {
    out.f[j] = a.f[j]! + (b.f[j]! - a.f[j]!) * s;
    out.g[j] = a.g[j]! + (b.g[j]! - a.g[j]!) * s;
  }
}

// ------------------------------------------------------------------ tracks

/** Time-varying control signals for one utterance. `u` is normalised time 0..1. */
export interface VoiceTrack {
  duration: number;
  /** Multiplier of the speaker's f0. */
  pitch(u: number, t: number): number;
  amp(u: number, t: number): number;
  /** 0 = whisper/breath only, 1 = fully voiced. */
  voicing(u: number, t: number): number;
  /** Breath noise level added on top of the speaker's own breathiness. */
  breath(u: number, t: number): number;
  vowels: Keys;
  /** Glottal spectral tilt exponent: higher = darker, softer voice. */
  tilt: number;
  /** Added to the speaker's drive / rasp. */
  drive: number;
  rasp: number;
  /** Formant bandwidth multiplier (wider for shouting). */
  bandwidth: number;
  /** Output peak after normalisation. */
  peak: number;
  /** Seconds; scaled by the speaker's `attack`. */
  attack: number;
  release: number;
}

const smooth = (x: number): number => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};
const bump = (u: number, centre: number, width: number): number => {
  const d = (u - centre) / width;
  return Math.abs(d) >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * d);
};

interface EmoteDef {
  duration: readonly [number, number];
  build(dur: number, rng: Rng): Omit<VoiceTrack, 'duration'>;
}

/** The emote set [Assumed]. Contours are shaped to read by mood without words. */
export const EMOTE_DEFS: Record<Emote, EmoteDef> = {
  // Short closed "hm": level, slightly falling.
  neutral: {
    duration: [0.26, 0.36],
    build: (_d, rng) => {
      const fall = rng.range(0.07, 0.12);
      return {
        pitch: (u) => 1.03 - fall * u, amp: (u) => 1 - 0.3 * u, voicing: () => 1, breath: () => 0.02,
        vowels: [[0, 'm'], [1, 'm']], tilt: 1.3, drive: 0, rasp: 0, bandwidth: 1, peak: 0.6, attack: 0.03, release: 0.08,
      };
    },
  },
  // Rising "hm?": flat, then a clear upward sweep.
  question: {
    duration: [0.36, 0.46],
    build: (_d, rng) => {
      const rise = rng.range(0.4, 0.55);
      return {
        pitch: (u) => 0.95 + rise * smooth((u - 0.3) / 0.7), amp: (u) => 0.85 + 0.15 * u, voicing: () => 1, breath: () => 0.02,
        vowels: [[0, 'm'], [0.6, 'm'], [1, 'u']], tilt: 1.25, drive: 0, rasp: 0, bandwidth: 1, peak: 0.6, attack: 0.035, release: 0.06,
      };
    },
  },
  // Sharp "hey!": brief aspirated onset into a high, falling, e -> i glide.
  urgent: {
    duration: [0.24, 0.32],
    build: (_d, rng) => {
      const top = rng.range(1.35, 1.5);
      return {
        pitch: (u) => top - 0.28 * u,
        amp: (u) => 1 - 0.25 * u,
        voicing: (u) => 0.25 + 0.75 * smooth((u - 0.04) / 0.08),
        breath: (u) => (u < 0.12 ? 0.45 : 0.04),
        vowels: [[0, 'e'], [0.55, 'e'], [1, 'i']], tilt: 0.95, drive: 0.25, rasp: 0, bandwidth: 1.25, peak: 0.82, attack: 0.008, release: 0.05,
      };
    },
  },
  // Gasp: a fast startled vocalized intake/exclamation with soft breathiness.
  alarmed: {
    duration: [0.32, 0.44],
    build: (_d, rng) => {
      const p = rng.range(1.45, 1.68);
      return {
        pitch: (u) => p + 0.14 * u,
        amp: (u) => 0.5 + 0.5 * smooth(u / 0.2),
        voicing: (u) => 0.35 + 0.55 * smooth(u / 0.22),
        breath: () => 0.45,
        vowels: [[0, 'a'], [1, '@']], tilt: 1.15, drive: 0.05, rasp: 0, bandwidth: 1.3, peak: 0.65, attack: 0.012, release: 0.035,
      };
    },
  },
  // Grunt: low, tense, rough, falling, sudden.
  pained: {
    duration: [0.22, 0.34],
    build: (_d, rng) => {
      const p = rng.range(0.86, 0.95);
      return {
        pitch: (u) => p - 0.14 * u, amp: (u) => 1 - 0.55 * u, voicing: () => 1, breath: () => 0.08,
        vowels: [[0, '@'], [0.35, 'u'], [1, 'm']], tilt: 1.1, drive: 0.3, rasp: 0.35, bandwidth: 1.2, peak: 0.78, attack: 0.006, release: 0.07,
      };
    },
  },
  // Sigh: warm breathy exhale, voiced core swells gently, pitch falls away.
  relieved: {
    duration: [0.72, 0.9],
    build: (_d, rng) => {
      const p = rng.range(1.05, 1.15);
      return {
        pitch: (u) => p - 0.36 * u,
        amp: (u) => Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 0.7,
        voicing: (u) => 0.45 + 0.4 * Math.sin(Math.PI * u),
        breath: () => 0.35,
        vowels: [[0, 'a'], [0.55, '@'], [1, 'u']], tilt: 1.5, drive: 0, rasp: 0, bandwidth: 1.1, peak: 0.55, attack: 0.1, release: 0.25,
      };
    },
  },
  // Short chuckle: three quick voiced pulses, each a little softer.
  laugh: {
    duration: [0.42, 0.54],
    build: (_d, rng) => {
      const centres = [0.15, 0.44, 0.73].map((c) => c + rng.range(-0.03, 0.03));
      const levels = [1, 0.8, 0.58];
      const pulses = (u: number): number => centres.reduce((s, c, i) => s + bump(u, c, 0.15) * levels[i]!, 0);
      return {
        pitch: (u) => 1.25 - 0.16 * u,
        amp: pulses,
        voicing: () => 0.9,
        breath: () => 0.15,
        vowels: [[0, '@'], [0.5, 'a'], [1, '@']], tilt: 1.25, drive: 0, rasp: 0, bandwidth: 1.15, peak: 0.65, attack: 0.01, release: 0.04,
      };
    },
  },
  // Breathy murmur: unvoiced, two soft syllables, vowels moving.
  whisper: {
    duration: [0.5, 0.72],
    build: (_d, rng) => {
      const s1 = rng.range(0.2, 0.3);
      const s2 = rng.range(0.6, 0.72);
      return {
        pitch: () => 1, amp: (u) => 0.25 + bump(u, s1, 0.24) + 0.85 * bump(u, s2, 0.26), voicing: () => 0, breath: () => 0.8,
        vowels: [[0, 'o'], [0.3, 'u'], [0.6, 'a'], [1, 'u']], tilt: 1.3, drive: 0, rasp: 0, bandwidth: 1.05, peak: 0.34, attack: 0.06, release: 0.14,
      };
    },
  },
  // Low shaky exhale: voiced-breathy, falling, with a 6-7 Hz tremble in pitch and level.
  dread: {
    duration: [0.76, 0.9],
    build: (_d, rng) => {
      const rate = rng.range(6, 7.2);
      const ph = rng.range(0, TAU);
      return {
        pitch: (u, t) => (0.86 - 0.16 * u) * (1 + 0.05 * Math.sin(TAU * rate * t + ph)),
        amp: (u, t) => (0.75 + 0.25 * Math.sin(TAU * rate * t + ph)) * Math.sin(Math.PI * Math.min(1, u * 1.1)) ** 0.5,
        voicing: () => 0.85, breath: () => 0.25,
        vowels: [[0, 'o'], [1, 'u']], tilt: 1.5, drive: 0, rasp: 0.05, bandwidth: 1, peak: 0.52, attack: 0.14, release: 0.28,
      };
    },
  },
  // Long cry: very high, wide open, rough, rising then falling with vibrato.
  scream: {
    duration: [0.82, 0.9],
    build: (_d, rng) => {
      const top = rng.range(2.25, 2.5);
      return {
        pitch: (u, t) => (u < 0.2 ? 1.8 + (top - 1.8) * smooth(u / 0.2) : top - (top - 1.75) * smooth((u - 0.2) / 0.8)) * (1 + 0.03 * Math.sin(TAU * 5.5 * t)),
        amp: (u) => 0.85 + 0.15 * Math.sin(Math.PI * u), voicing: () => 1, breath: () => 0.15,
        vowels: [[0, 'a'], [0.7, 'a'], [1, '@']], tilt: 0.9, drive: 0.35, rasp: 0.18, bandwidth: 1.7, peak: 0.9, attack: 0.04, release: 0.14,
      };
    },
  },
};

export const EMOTE_MIN_S = 0.2;
export const EMOTE_MAX_S = 0.9;

export function emoteTrack(profile: VoiceProfile, emote: Emote, rng: Rng): VoiceTrack {
  const def = EMOTE_DEFS[emote];
  const dur = Math.min(EMOTE_MAX_S, Math.max(EMOTE_MIN_S, rng.range(def.duration[0], def.duration[1]) * profile.tempo));
  return { duration: dur, ...def.build(dur, rng.fork('shape')) };
}

// ------------------------------------------------------------------ babble

/** Mood offsets applied to babble so it still carries the emote. */
const BABBLE_MOOD: Record<Emote, { pitch: number; voicing: number; breath: number; drive: number }> = {
  neutral: { pitch: 1, voicing: 1, breath: 0.05, drive: 0 },
  question: { pitch: 1.02, voicing: 1, breath: 0.05, drive: 0 },
  urgent: { pitch: 1.25, voicing: 1, breath: 0.1, drive: 0.3 },
  alarmed: { pitch: 1.35, voicing: 0.8, breath: 0.4, drive: 0.15 },
  pained: { pitch: 0.88, voicing: 1, breath: 0.2, drive: 0.4 },
  relieved: { pitch: 0.95, voicing: 0.7, breath: 0.5, drive: 0 },
  laugh: { pitch: 1.15, voicing: 0.8, breath: 0.3, drive: 0.05 },
  whisper: { pitch: 1, voicing: 0, breath: 1, drive: 0 },
  dread: { pitch: 0.85, voicing: 0.7, breath: 0.4, drive: 0 },
  scream: { pitch: 1.9, voicing: 1, breath: 0.3, drive: 0.6 },
};

interface Syllable {
  start: number;
  end: number;
  vowel: Vowel;
  pitch: number;
}

/** Animal Crossing style babble: one 60-90 ms syllable per 1-2 letters, random vowels, pitch drift. */
export function babbleTrack(profile: VoiceProfile, emote: Emote, text: string, rng: Rng): VoiceTrack {
  const mood = BABBLE_MOOD[emote];
  const syl: Syllable[] = [];
  const open: Vowel[] = ['a', 'e', 'i', 'o', 'u', '@'];
  let t = 0.02;
  let drift = 1;
  let letters = 0;
  const words = text.match(/[A-Za-z0-9']+|[,;:.!?]/g) ?? [];
  for (const w of words) {
    if (/^[,;:]$/.test(w)) {
      t += 0.12;
      continue;
    }
    if (/^[.!?]$/.test(w)) {
      t += 0.2;
      continue;
    }
    letters = 0;
    while (letters < w.length) {
      letters += rng.chance(0.5) ? 1 : 2;
      const len = rng.range(0.06, 0.09) * profile.tempo;
      drift = Math.min(1.2, Math.max(0.85, drift + rng.range(-0.035, 0.035)));
      syl.push({ start: t, end: t + len, vowel: rng.pick(open), pitch: drift });
      t += len;
    }
    t += 0.025;
  }
  if (syl.length === 0) syl.push({ start: 0.02, end: 0.1, vowel: '@', pitch: 1 });
  if (/\?\s*$/.test(text)) {
    const last = syl.slice(-3);
    last.forEach((s, i) => (s.pitch *= 1 + 0.12 * (i + 1)));
  }
  const duration = syl[syl.length - 1]!.end + 0.06;
  const at = (time: number): Syllable | null => {
    for (const s of syl) if (time >= s.start - 0.005 && time < s.end + 0.012) return s;
    return null;
  };
  const vowels: Array<[number, Vowel]> = syl.map((s) => [((s.start + s.end) / 2) / duration, s.vowel]);
  return {
    duration,
    pitch: (_u, time) => mood.pitch * (at(time)?.pitch ?? drift),
    amp: (_u, time) => {
      const s = at(time);
      if (!s) return 0;
      const len = s.end - s.start;
      const x = (time - s.start) / len;
      return x < 0.25 ? smooth(x / 0.25) : x > 0.8 ? 1 - smooth((x - 0.8) / 0.35) : 1;
    },
    voicing: () => mood.voicing,
    breath: () => mood.breath,
    vowels: [[0, vowels[0]![1]], ...vowels, [1, vowels[vowels.length - 1]![1]]],
    tilt: 1.2, drive: mood.drive, rasp: 0, bandwidth: 1.1, peak: emote === 'whisper' ? 0.36 : 0.6, attack: 0.002, release: 0.04,
  };
}

// ------------------------------------------------------------------ renderer

export interface RenderOptions {
  /** Overrides the profile's rasp (Giles's foreshadowing raises it over the slice). */
  rasp?: number;
}

const MAX_PARTIAL_HZ = 5200;
const CONTROL_BLOCK = 32;

/** Render one utterance. Pure and deterministic for a given seed. */
export function renderTrack(sr: number, profile: VoiceProfile, track: VoiceTrack, rng: Rng, opts: RenderOptions = {}): Buf {
  const dur = track.duration;
  const n = Math.max(1, Math.round(dur * sr));
  const tail = Math.round(0.06 * sr);
  const out = makeBuf(sr, (n + tail) / sr);

  const rasp = Math.min(1, (opts.rasp ?? profile.rasp) + track.rasp);
  const drive = Math.min(1, profile.drive + track.drive);
  const detune = profile.detune;
  const breathBase = profile.breath;
  const attack = Math.max(0.002, track.attack * profile.attack);
  const release = Math.max(0.01, track.release);

  // Per-render variation: tiny pitch offset and formant jitter.
  const pitchOffset = 1 + rng.range(-0.035, 0.035);
  const formantJitter = [0, 1, 2].map(() => 1 + rng.range(-0.04, 0.04));

  const noise = pink(rng.fork('breath'));
  const jitterNoise = white(rng.fork('jitter'));
  const jitterLp = new OnePole(35, sr);
  const breathLp = new OnePole(2800, sr);
  const raspLp = new OnePole(1800, sr);
  const formants = [0, 1, 2].map((j) => new Biquad('bandpass', VOWEL_SHAPES.a.f[j]!, 5, sr));
  const vf = { f: [0, 0, 0], g: [0, 0, 0] };
  const jitterAmt = 0.006 + rasp * 0.045;

  const maxK = Math.max(1, Math.floor(MAX_PARTIAL_HZ / 50));
  const weights = new Float64Array(maxK + 1);
  for (let k = 1; k <= maxK; k++) weights[k] = 1 / Math.pow(k, track.tilt);

  let phase = 0;
  let phase2 = 0;
  let period = 0;
  let periodFlip = 1;

  const partials = (ph: number, f0: number): number => {
    const x = TAU * ph;
    const c = 2 * Math.cos(x);
    let sPrev = 0;
    let s = Math.sin(x);
    let sum = 0;
    const limit = Math.min(maxK, MAX_PARTIAL_HZ / f0, (sr * 0.45) / f0);
    const kMax = Math.floor(limit);
    for (let k = 1; k <= kMax; k++) {
      // Fade the top partial in/out smoothly as f0 moves.
      const w = k === kMax ? weights[k]! * Math.min(1, limit - kMax + 0.5) : weights[k]!;
      sum += s * w;
      const sNext = c * s - sPrev;
      sPrev = s;
      s = sNext;
    }
    return sum;
  };

  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const u = t / dur;
    if (i % CONTROL_BLOCK === 0) {
      vowelAt(track.vowels, u, vf);
      for (let j = 0; j < 3; j++) {
        const f = vf.f[j]! * profile.formants * formantJitter[j]!;
        const bw = BANDWIDTH[j]! * track.bandwidth * (1 + 0.3 * rasp);
        formants[j]!.set(f, f / bw);
      }
    }
    const jit = jitterLp.process(jitterNoise()) * 4;
    const f0 = profile.f0 * pitchOffset * track.pitch(u, t) * (1 + jitterAmt * jit);
    phase += f0 / sr;
    if (phase >= 1) {
      phase -= 1;
      period++;
      periodFlip = period % 2 === 0 ? 1 : -1;
    }
    let voiced = partials(phase, f0);
    if (detune > 0) {
      const fd = f0 * (1 + 0.035 * detune);
      phase2 = (phase2 + fd / sr) % 1;
      voiced += partials(phase2, fd) * 0.6 * detune;
      voiced += Math.sin(TAU * phase * 0.5) * 0.4 * detune;
    }
    // Rasp: period-doubling (alternate pulse strength) + band-limited pulse-synchronous air.
    const pulseNoise = raspLp.process(noise());
    const glottalOpen = Math.pow(0.5 + 0.5 * Math.cos(TAU * phase), 6);
    voiced = voiced * (1 - rasp * 0.35 * (1 - periodFlip) * 0.5) + rasp * 0.55 * pulseNoise * glottalOpen;

    const env = Math.min(1, t / attack) * Math.min(1, (dur - t) / release) * Math.max(0, track.amp(u, t));
    const breathNoise = breathLp.process(noise());
    const excite = (voiced * 0.18 * track.voicing(u, t) + breathNoise * (breathBase * 0.25 + track.breath(u, t)) * 0.6) * env;
    let s = 0;
    for (let j = 0; j < 3; j++) s += formants[j]!.process(excite) * vf.g[j]!;
    out[i] = s;
  }
  // Let the formants ring out into the tail.
  for (let i = n; i < out.length; i++) {
    let s = 0;
    for (let j = 0; j < 3; j++) s += formants[j]!.process(0) * vf.g[j]!;
    out[i] = s;
  }

  normalize(out, 0.7);
  const g = 1 + drive * 5;
  const tg = Math.tanh(g);
  const lp = new Biquad('lowpass', profile.brightness, 0.7, sr);
  const hp = new Biquad('highpass', 90, 0.7, sr);
  for (let i = 0; i < out.length; i++) out[i] = hp.process(lp.process(Math.tanh(out[i]! * g) / tg));
  fadeEdges(out, sr, 0.003, 0.02);
  return normalize(out, track.peak);
}

/** Two-tone station PA chime (G5 -> E5, bell partials). Used for every `kind: chime` speaker. */
export function renderChime(sr: number, rng: Rng): Buf {
  const out = makeBuf(sr, 1.4);
  const notes: Array<[number, number]> = [[0, 784], [0.42, 659]];
  const ratios = [1, 2, 2.76, 4.07];
  const amps = [1, 0.35, 0.18, 0.08];
  const phases = ratios.map(() => rng.next() * TAU);
  for (const [at, f] of notes) {
    const start = Math.round(at * sr);
    for (let i = start; i < out.length; i++) {
      const t = (i - start) / sr;
      let s = 0;
      for (let k = 0; k < ratios.length; k++) s += amps[k]! * Math.exp(-t * (1.6 + k * 1.4)) * Math.sin(TAU * f * ratios[k]! * t + phases[k]!);
      out[i] = out[i]! + s * Math.min(1, t / 0.004);
    }
  }
  fadeEdges(out, sr, 0.002, 0.05);
  return normalize(out, 0.5);
}

/** Render a line's sound: the chime for PA, babble if asked, otherwise the emote. Seed = line id. */
export function renderUtterance(
  sr: number,
  profile: VoiceProfile,
  emote: Emote,
  seed: string,
  opts: RenderOptions & { babbleText?: string } = {},
): Buf {
  const rng = new Rng(seed);
  if (profile.kind === 'chime') return renderChime(sr, rng);
  const track = opts.babbleText !== undefined ? babbleTrack(profile, emote, opts.babbleText, rng.fork('babble')) : emoteTrack(profile, emote, rng);
  return renderTrack(sr, profile, track, rng.fork('render'), opts);
}
