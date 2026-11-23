/**
 * The medbay score (adaptive-music "The medbay score follows the scene", overhaul-priya-r08-death D31): Priya's death
 * in R08, seen from the dark security office. It runs on the vitals monitor's clock, one beat per 0.8 s (75 BPM in
 * 4/4, 8 bars = 25.6 s), so the music and the monitor share one grid while only the music speeds up its subdivisions.
 * E minor with a b2 (F) for the creature.
 *
 *   drone   cold low E pedal and a slow-beating fifth               from the moment the squad comes in
 *   glass   glass-harmonica sines, high and fragile                 louder the closer Jay is to the panes
 *   priya   a small warm music-box / felt-piano motif               the rescue: her only warm sound
 *   breath  sub-bass swells, in and out every two bars              the creature, once it is heard
 *   pulse   low toms on the beat, doubling in the last bars         the walk past Jay
 *   rise    Shepard-Risset rising sines                             the walk past Jay
 *   brutal  impacts and cracks on the b2                            the impale to the throw
 *   hold    the priya motif at half speed, detuned and far away     the aftermath
 */
import type { Rng } from '../../core/rng.ts';
import { Biquad, OnePole, TAU, white } from '../dsp.ts';
import type { RenderedScore, StereoPair } from '../scorePlayer.ts';
import { cents, crack, edges, impact, midi, oneShotRoom, pan, peak, put, rms, scale, smooth, snapper, stereo, tom, withRoom, type Stereo } from './synth.ts';

export const MEDBAY_BEAT = 0.8;
export const MEDBAY_BAR = MEDBAY_BEAT * 4;
export const MEDBAY_BARS = 8;
export const MEDBAY_LOOP = MEDBAY_BAR * MEDBAY_BARS;

const L = MEDBAY_LOOP;
const snap = snapper(L);

/** Priya's motif (midi, start beat, length in beats), two bars repeated with a turn: E G B A | G F# E . */
const MOTIF: ReadonlyArray<readonly [number, number, number]> = [
  [76, 0, 1], [79, 1, 1], [83, 2, 1.5], [81, 3.5, 0.5],
  [79, 4, 1], [78, 5, 1], [76, 6, 2],
  [76, 8, 1], [79, 9, 1], [83, 10, 1], [84, 11, 1],
  [83, 12, 1], [81, 13, 1], [79, 14, 2],
];

// ------------------------------------------------------------------ layers

function drone(sr: number, n: number, rng: Rng): Stereo {
  const out = stereo(n);
  const f1 = snap(midi(28));
  const f5 = snap(midi(35));
  const f5b = snap(midi(35) * cents(7));
  const noise = white(rng);
  const lp = new OnePole(90, sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const swell = 0.75 + 0.25 * Math.sin((TAU * t) / L);
    const rumble = lp.process(noise()) * 3;
    const s = Math.sin(TAU * f1 * t) * 0.7 + Math.sin(TAU * f1 * 2 * t + 0.4) * 0.18 + (Math.sin(TAU * f5 * t) + Math.sin(TAU * f5b * t)) * 0.16;
    out.l[i] = (s + rumble * 0.35) * swell;
    out.r[i] = (s * 0.97 + rumble * 0.33) * swell;
  }
  return withRoom(out, sr, 0.35, 5);
}

/** One glass-harmonica tone: a pure sine with a faint octave and a slow tremolo, swelled in and out. */
function glassTone(out: Stereo, sr: number, at: number, len: number, note: number, amp: number, p: number): void {
  const f = midi(note);
  const start = Math.round(at * sr);
  const total = Math.round(len * sr);
  const [gl, gr] = pan(p);
  for (let i = 0; i < total; i++) {
    const t = i / sr;
    const env = smooth(t / 0.9) * (1 - smooth((t - (len - 1.4)) / 1.4));
    const trem = 0.85 + 0.15 * Math.sin(TAU * 4.2 * t);
    const v = (Math.sin(TAU * f * t) + Math.sin(TAU * f * 2.01 * t) * 0.12) * env * trem * amp;
    put(out.l, start + i, v * gl);
    put(out.r, start + i, v * gr);
  }
}

function glass(sr: number, n: number): Stereo {
  const out = stereo(n);
  const chords: ReadonlyArray<readonly number[]> = [[88, 91], [88, 95], [86, 93], [89, 91]];
  for (let k = 0; k < 4; k++) {
    const at = k * MEDBAY_BAR * 2;
    chords[k]!.forEach((note, j) => glassTone(out, sr, at + j * 0.35, MEDBAY_BAR * 2 + 1.2, note, 0.4, j === 0 ? -0.5 : 0.5));
  }
  return withRoom(out, sr, 0.6, 6, 0.3);
}

/** A music-box / felt-piano note: bright attack, fast decay, warm second partial, a little felt thump. */
function boxNote(out: Stereo, sr: number, at: number, note: number, amp: number, detune = 0): void {
  const f = midi(note) * cents(detune);
  const start = Math.round(at * sr);
  const len = Math.round(2.6 * sr);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const atk = Math.min(1, t / 0.004);
    const body = Math.sin(TAU * f * t) * Math.exp(-t / 0.9) + Math.sin(TAU * f * 2 * t + 0.3) * 0.35 * Math.exp(-t / 0.35) + Math.sin(TAU * f * 3.98 * t) * 0.08 * Math.exp(-t / 0.15);
    const felt = Math.sin(TAU * 140 * t) * Math.exp(-t / 0.03) * 0.25;
    const v = (body + felt) * atk * amp;
    put(out.l, start + i, v * 0.95);
    put(out.r, start + i, v);
  }
}

function priya(sr: number, n: number): Stereo {
  const out = stereo(n);
  // The motif twice per loop: bars 1-4 and 5-8, the second a touch softer.
  for (const rep of [0, 16]) for (const [note, beat] of MOTIF) boxNote(out, sr, (rep + beat) * MEDBAY_BEAT, note, rep === 0 ? 0.5 : 0.42);
  // A low E under each phrase, so it is warm rather than tinkly.
  for (let bar = 0; bar < MEDBAY_BARS; bar += 2) boxNote(out, sr, bar * MEDBAY_BAR, 52, 0.3);
  return withRoom(out, sr, 0.45, 3.2, 0.5);
}

function breath(sr: number, n: number, rng: Rng): Stereo {
  const out = stereo(n);
  const sub = snap(41.2);
  const noise = white(rng);
  const lp = new Biquad('lowpass', 180, 0.9, sr);
  const period = MEDBAY_BAR * 2;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const ph = (t % period) / period;
    // Inhale rises over 60% of the cycle, the exhale falls fast, then a held silence.
    const env = ph < 0.6 ? smooth(ph / 0.6) : ph < 0.85 ? 1 - smooth((ph - 0.6) / 0.25) : 0;
    const v = (Math.sin(TAU * sub * t) * 0.9 + lp.process(noise()) * 0.8) * env;
    out.l[i] = v;
    out.r[i] = v * 0.94;
  }
  return withRoom(out, sr, 0.25, 4);
}

function pulse(sr: number, n: number, rng: Rng): Stereo {
  const out = stereo(n);
  const beats = MEDBAY_BARS * 4;
  for (let b = 0; b < beats; b++) {
    const at = b * MEDBAY_BEAT;
    tom(out, sr, rng, at, 62, b % 4 === 0 ? 0.9 : 0.55, -0.15, 0.3);
    // The last two bars double: the clock seems to speed up while the monitor does not.
    if (b >= beats - 8) tom(out, sr, rng, at + MEDBAY_BEAT / 2, 74, 0.45, 0.2, 0.22);
  }
  return withRoom(out, sr, 0.3, 3);
}

function rise(sr: number, n: number): Stereo {
  const out = stereo(n);
  const voices = 6;
  const base = 110;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let l = 0;
    let r = 0;
    for (let v = 0; v < voices; v++) {
      // Each voice climbs one octave per loop; together they wrap, so the climb never ends (Shepard-Risset).
      const pos = ((t / L + v / voices) % 1 + 1) % 1;
      const a = Math.sin(Math.PI * pos) ** 2;
      // Phase from the integral of the exponential glide; the jump at the wrap falls where the voice is silent.
      const k = (voices * Math.LN2) / L;
      const phase = (TAU * base * (Math.pow(2, voices * ((t / L + v / voices) % 1)) - 1)) / k;
      const s = Math.sin(phase + v) * a;
      l += s * (v % 2 === 0 ? 0.9 : 0.6);
      r += s * (v % 2 === 0 ? 0.6 : 0.9);
    }
    out.l[i] = l / voices;
    out.r[i] = r / voices;
  }
  return withRoom(out, sr, 0.4, 4);
}

function brutal(sr: number, n: number, rng: Rng): Stereo {
  const out = stereo(n);
  for (let bar = 0; bar < MEDBAY_BARS; bar++) {
    const at = bar * MEDBAY_BAR;
    impact(out, sr, rng, at, 0.9, midi(41), 2.4);
    crack(out, sr, rng, at + MEDBAY_BEAT * 2, 0.5);
    if (bar % 2 === 1) crack(out, sr, rng, at + MEDBAY_BEAT * 3.5, 0.35);
  }
  return withRoom(out, sr, 0.3, 3.5);
}

function hold(sr: number, n: number): Stereo {
  const out = stereo(n);
  // Her motif once, at half speed, detuned and wavering, far away.
  for (const [note, beat] of MOTIF.slice(0, 7)) boxNote(out, sr, beat * 2 * MEDBAY_BEAT, note, 0.45, -28 + (beat % 3) * 9);
  return withRoom(out, sr, 0.9, 7, 0.55);
}

// ------------------------------------------------------------------ stingers

/** The surgery door opening: a dissonant cluster with a hard attack and a long ring. */
function stab(sr: number, rng: Rng): Stereo {
  const out = stereo(Math.round(4 * sr));
  impact(out, sr, rng, 0, 0.7, midi(41), 1.6);
  for (const note of [64, 65, 70, 71]) {
    const f = midi(note);
    for (let i = 0; i < out.l.length; i++) {
      const t = i / sr;
      const v = Math.sin(TAU * f * t) * Math.exp(-t / 1.4) * Math.min(1, t / 0.003) * 0.22;
      out.l[i]! += v;
      out.r[i]! += v * 0.9;
    }
  }
  return edges(oneShotRoom(out, sr, 0.5, 4.5), sr);
}

// ------------------------------------------------------------------ the score

const LAYER_RMS: Record<string, number> = {
  drone: 0.1,
  glass: 0.05,
  priya: 0.055,
  breath: 0.08,
  pulse: 0.07,
  rise: 0.055,
  brutal: 0.1,
  hold: 0.05,
};

/** The loudest cue (the impale): keep that mix under clipping. */
const LOUDEST: Record<string, number> = { drone: 1, breath: 0.8, pulse: 0.9, rise: 0.8, brutal: 1 };

const pair = (s: Stereo): StereoPair => ({ left: s.l, right: s.r });

export function renderMedbay(sr: number, rng: Rng): RenderedScore {
  const n = Math.round(sr * L);
  const layers: Record<string, Stereo> = {
    drone: drone(sr, n, rng.fork('drone')),
    glass: glass(sr, n),
    priya: priya(sr, n),
    breath: breath(sr, n, rng.fork('breath')),
    pulse: pulse(sr, n, rng.fork('pulse')),
    rise: rise(sr, n),
    brutal: brutal(sr, n, rng.fork('brutal')),
    hold: hold(sr, n),
  };
  for (const [name, s] of Object.entries(layers)) {
    const r = rms(s);
    if (r > 0) scale(s, (LAYER_RMS[name] ?? 0.06) / r);
  }
  const mix = stereo(n);
  for (const [name, g] of Object.entries(LOUDEST)) {
    const s = layers[name]!;
    for (let i = 0; i < n; i++) {
      mix.l[i]! += s.l[i]! * g;
      mix.r[i]! += s.r[i]! * g;
    }
  }
  const p = peak(mix);
  if (p > 0.95) for (const s of Object.values(layers)) scale(s, 0.95 / p);
  const st = stab(sr, rng.fork('stab'));
  const sp = peak(st);
  if (sp > 0) scale(st, 0.8 / sp);
  return {
    sampleRate: sr,
    layers: Object.fromEntries(Object.entries(layers).map(([k, s]) => [k, pair(s)])),
    stingers: { stab: [pair(st)] },
  };
}
