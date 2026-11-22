/**
 * Procedural music (the menu theme; plays on the music bus, spec audio-mix). Renders a stereo, seamlessly looping track from a seeded RNG,
 * so it is identical on every machine and needs no audio files.
 *
 * "Pressure" - the main menu theme and base mood for the station. A 64 s loop in D, built from
 * a sub drone, a growling lower-octave horror bass, slow chord pads that clash on purpose (b2,
 * tritone), bowed bass swells, hull groans and a faint double-thump heartbeat.
 *
 * Loop strategy: every periodic part uses frequencies snapped to whole cycles per loop, and
 * everything is rendered with a tail that is folded back onto the start, so reverb and echo
 * tails ring across the seam.
 */
import type { Rng } from '../core/rng.ts';
import { Biquad, makeBuf, OnePole, TAU, white, type Buf } from './dsp.ts';

export interface StereoBuf {
  readonly left: Buf;
  readonly right: Buf;
}

export const MENU_LOOP_SECONDS = 64;
const TAIL_SECONDS = 12;

const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);
const cents = (c: number): number => Math.pow(2, c / 1200);
const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** Snap a frequency to a whole number of cycles per loop so periodic parts wrap cleanly. */
const snap = (f: number): number => Math.max(1, Math.round(f * MENU_LOOP_SECONDS)) / MENU_LOOP_SECONDS;

/** Distance in seconds between two times on the loop circle. */
function cyc(a: number, b: number): number {
  const d = Math.abs(a - b) % MENU_LOOP_SECONDS;
  return Math.min(d, MENU_LOOP_SECONDS - d);
}

interface Chord {
  readonly bass: number;
  readonly pad: readonly number[];
}

/** Dm(b2) -> Bbmaj7 -> Gm7b5 -> A7b9. Each lasts 16 s and overlaps its neighbours. */
const CHORDS: readonly Chord[] = [
  { bass: 26, pad: [38, 45, 53, 51] }, // D1 | D2 A2 F3 Eb3
  { bass: 22, pad: [41, 45, 50, 57] }, // Bb0 | F2 A2 D3 A3
  { bass: 31, pad: [43, 46, 49, 53] }, // G1 | G2 Bb2 Db3 F3
  { bass: 33, pad: [40, 43, 46, 49] }, // A1 | E2 G2 Bb2 Db3
];
const CHORD_LEN = MENU_LOOP_SECONDS / CHORDS.length;

/** Raised-cosine weight of chord k at time t (circular, 12 s half-width, sums ~constant). */
function chordWeight(k: number, t: number): number {
  const d = cyc(t, k * CHORD_LEN + CHORD_LEN / 2);
  const w = 12;
  if (d >= w) return 0;
  const c = Math.cos((Math.PI / 2) * (d / w));
  return c * c;
}

// ------------------------------------------------------------------ layers (dry, length N)

function drone(sr: number, n: number, rng: Rng): { l: Buf; r: Buf } {
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  const rumble = new OnePole(65, sr);
  const noise = white(rng.fork('drone-noise'));
  const f0 = snap(midi(26)); // D1 pedal, constant under every chord
  const fDetUp = snap(midi(26) * cents(9));
  const fDetDn = snap(midi(26) * cents(-11));
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const swell = 0.75 + 0.25 * Math.sin(TAU * (2 / MENU_LOOP_SECONDS) * t);
    const s = Math.sin(TAU * f0 * t) * 0.48 + Math.sin(TAU * 2 * f0 * t + 0.6) * 0.12 * swell;
    // slowly beating partners a few cents away: the "breathing" of the floor
    const beatL = Math.sin(TAU * fDetUp * t) * 0.24;
    const beatR = Math.sin(TAU * fDetDn * t) * 0.24;
    // chord roots in true lower-octave bass (24.5-36.7 Hz) with subtle upper-bass definition
    let root = 0;
    for (let k = 0; k < CHORDS.length; k++) {
      const w = chordWeight(k, t);
      if (w > 0) {
        const bassNote = CHORDS[k]!.bass;
        const subNote = bassNote >= 30 ? bassNote - 12 : bassNote;
        root += Math.sin(TAU * snap(midi(subNote)) * t) * 0.34 * w;
        root += Math.sin(TAU * snap(midi(bassNote)) * t) * 0.22 * w;
        root += Math.sin(TAU * snap(midi(bassNote + 12)) * t) * 0.08 * w;
      }
    }
    const rb = rumble.process(noise()) * 1.2;
    l[i] = (s + beatL + root + rb) * 0.52;
    r[i] = (s + beatR + root - rb * 0.5) * 0.52;
  }
  return { l, r };
}

/**
 * Deep, growling lower-octave horror bass: detuned harmonic-rich oscillators + tritone tension
 * rub, driven through tanh saturation and a slowly breathing resonant low-pass filter.
 */
function horrorBass(sr: number, n: number, rng: Rng): { l: Buf; r: Buf } {
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  const lpL = new Biquad('lowpass', 110, 2.3, sr);
  const lpR = new Biquad('lowpass', 110, 2.3, sr);
  const gritFilter = new OnePole(140, sr);
  const noise = white(rng.fork('horror-bass'));

  const chordFreqs = CHORDS.map((ch) => {
    const subNote = ch.bass >= 30 ? ch.bass - 12 : ch.bass;
    return {
      fSub: snap(midi(subNote)),
      fDetL: snap(midi(ch.bass) * cents(-13)),
      fDetR: snap(midi(ch.bass) * cents(14)),
      fRub: snap(midi(ch.bass + 6)),
    };
  });

  const warmup = Math.min(n, Math.round(sr * 2));
  const HARM = 7;

  for (let i = -warmup; i < n; i++) {
    // Wrap negative warmup time onto the end of the loop so filter state matches at i = 0
    const idx = i < 0 ? n + i : i;
    const t = idx / sr;

    if (i === -warmup || (idx & 15) === 0) {
      const sweepL = 0.5 + 0.5 * Math.sin(TAU * (2 / MENU_LOOP_SECONDS) * t + 0.4);
      const sweepR = 0.5 + 0.5 * Math.sin(TAU * (3 / MENU_LOOP_SECONDS) * t + 1.9);
      lpL.set(72 + 135 * sweepL * sweepL, 2.3);
      lpR.set(72 + 135 * sweepR * sweepR, 2.3);
    }

    let rawL = 0;
    let rawR = 0;
    let sub = 0;

    for (let k = 0; k < chordFreqs.length; k++) {
      const w = chordWeight(k, t);
      if (w < 1e-4) continue;
      const cf = chordFreqs[k]!;

      sub += Math.sin(TAU * cf.fSub * t) * 0.28 * w;

      let oscL = 0;
      let oscR = 0;
      for (let h = 1; h <= HARM; h++) {
        const amp = 1 / Math.pow(h, 0.85);
        oscL += Math.sin(TAU * cf.fDetL * h * t + h * 0.3) * amp;
        oscR += Math.sin(TAU * cf.fDetR * h * t + h * 0.7) * amp;
      }
      const rubEnv = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(TAU * (4 / MENU_LOOP_SECONDS) * t));
      const rub = Math.sin(TAU * cf.fRub * t) * 0.18 * rubEnv;

      rawL += (oscL * 0.42 + rub) * w;
      rawR += (oscR * 0.42 - rub * 0.8) * w;
    }

    const growl = 1 + 0.18 * gritFilter.process(noise());
    const fl = lpL.process(Math.tanh(rawL * 2.1 * growl));
    const fr = lpR.process(Math.tanh(rawR * 2.1 * growl));

    if (i >= 0) {
      l[i] = (fl * 0.48 + sub) * 0.62;
      r[i] = (fr * 0.48 + sub) * 0.62;
    }
  }
  return { l, r };
}

function pads(sr: number, n: number): { l: Buf; r: Buf } {
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  const voices: { f: number; chord: number; pan: number; ph: number; lfo: number }[] = [];
  CHORDS.forEach((ch, k) => {
    ch.pad.forEach((note, j) => {
      for (const det of [-7, 0, 6]) {
        const idx = voices.length;
        voices.push({
          f: snap(midi(note) * cents(det)),
          chord: k,
          pan: (((idx * 37) % 11) / 10) * 2 - 1,
          ph: idx * 1.7,
          lfo: 1 + ((idx + j) % 3), // integer cycles per loop for the drift
        });
      }
    });
  });
  const HARM = 6;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    // brightness breathes slowly, darker on the minor-2nd chord
    const bright = 0.35 + 0.25 * (0.5 + 0.5 * Math.sin(TAU * (4 / MENU_LOOP_SECONDS) * t - 1));
    let sl = 0;
    let sr_ = 0;
    for (const v of voices) {
      const w = chordWeight(v.chord, t);
      if (w < 1e-4) continue;
      const drift = 0.0006 * Math.sin(TAU * (v.lfo / MENU_LOOP_SECONDS) * t + v.ph);
      let s = 0;
      for (let h = 1; h <= HARM; h++) {
        s += (Math.sin(TAU * v.f * h * (1 + drift) * t + v.ph * h) * Math.pow(bright, h - 1)) / h;
      }
      s *= w * 0.075;
      const pl = 0.5 - 0.5 * v.pan;
      sl += s * Math.sqrt(pl);
      sr_ += s * Math.sqrt(1 - pl);
    }
    l[i] = sl;
    r[i] = sr_;
  }
  return { l, r };
}

function heartbeat(sr: number, n: number): Buf {
  const out = new Float32Array(n);
  const period = MENU_LOOP_SECONDS / 50; // 50 beats per loop, ~47 bpm
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const beatT = t % period;
    const pulse = (at: number, amp: number): number => {
      const dt = beatT - at;
      if (dt < 0) return 0;
      const f = 32 + 20 * Math.exp(-dt / 0.06);
      return Math.sin(TAU * f * dt) * Math.exp(-dt / 0.12) * amp * Math.min(1, dt / 0.004);
    };
    // present from the middle of the loop, receding before the seam
    const level = smooth((t - 18) / 14) * (1 - smooth((t - 54) / 8));
    out[i] = (pulse(0, 1) + pulse(0.3, 0.55)) * 0.55 * level;
  }
  return out;
}

// ------------------------------------------------------------------ one-shots (into length N+tail)

function addGroan(l: Buf, r: Buf, sr: number, rng: Rng, at: number, dur: number, f0: number, f1: number, pan: number): void {
  const start = Math.floor(at * sr);
  const len = Math.min(l.length - start, Math.floor(dur * sr));
  const rough = white(rng);
  const jitter = new OnePole(22, sr);
  const gl = Math.sqrt(0.5 - 0.5 * pan);
  const gr = Math.sqrt(0.5 + 0.5 * pan);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const p = i / len;
    const env = Math.sin(Math.PI * p) ** 2;
    const f = f0 + (f1 - f0) * smooth(p) + 1.2 * Math.sin(TAU * 0.9 * (i / sr));
    phase += (TAU * f) / sr;
    const grit = 0.65 + 0.35 * jitter.process(rough()) * 6;
    let s = 0;
    for (let h = 1; h <= 9; h++) {
      const formant = Math.exp(-Math.pow((h - 4.5) / 2.5, 2));
      s += (Math.sin(phase * h + h * 0.8) * formant) / Math.sqrt(h);
    }
    const e = s * env * grit * 0.075;
    l[start + i]! += e * gl;
    r[start + i]! += e * gr;
  }
}

/** Ominous low-octave bowed horror bass swell: slow pitch sag, resonant LP sweep, and grit. */
function addBassSwell(
  l: Buf,
  r: Buf,
  sr: number,
  rng: Rng,
  at: number,
  dur: number,
  f0: number,
  f1: number,
  pan: number,
): void {
  const start = Math.floor(at * sr);
  const len = Math.min(l.length - start, Math.floor(dur * sr));
  if (len <= 0) return;
  const lp = new Biquad('lowpass', 80, 2.6, sr);
  const noise = white(rng);
  const bow = new OnePole(35, sr);
  const gl = Math.sqrt(0.5 - 0.5 * pan);
  const gr = Math.sqrt(0.5 + 0.5 * pan);
  let p1 = 0;
  let p2 = 0;
  for (let i = 0; i < len; i++) {
    const p = i / len;
    const env = Math.sin(Math.PI * p) ** 1.7;
    const f = f0 + (f1 - f0) * smooth(p);
    p1 += (TAU * f) / sr;
    p2 += (TAU * f * cents(-16)) / sr;
    if ((i & 15) === 0) {
      lp.set(65 + 210 * env, 2.6);
    }
    let s = 0;
    for (let h = 1; h <= 8; h++) {
      s += (Math.sin(p1 * h) + Math.sin(p2 * h + 0.5)) / Math.pow(h, 0.8);
    }
    const scrape = 0.85 + 0.15 * bow.process(noise()) * 5;
    const body = lp.process(Math.tanh(s * 0.55 * scrape));
    const sub = Math.sin(p1) * 0.45;
    const e = (body * 0.75 + sub) * env * 0.24;
    l[start + i]! += e * gl;
    r[start + i]! += e * gr;
  }
}

// ------------------------------------------------------------------ space

/** Compact stereo Schroeder/Moorer reverb: 4 damped combs + 2 allpasses per channel. */
export function reverb(l: Buf, r: Buf, sr: number, rt60: number, damp: number): { l: Buf; r: Buf } {
  const run = (src: Buf, delaysMs: readonly number[], apMs: readonly number[]): Buf => {
    const out = new Float32Array(src.length);
    for (const ms of delaysMs) {
      const d = Math.round((ms / 1000) * sr);
      const g = Math.pow(10, (-3 * (d / sr)) / rt60);
      const buf = new Float32Array(d);
      let idx = 0;
      let lp = 0;
      for (let i = 0; i < src.length; i++) {
        const y = buf[idx]!;
        lp += damp * (y - lp);
        buf[idx] = src[i]! + lp * g;
        idx = (idx + 1) % d;
        out[i]! += y;
      }
    }
    for (let i = 0; i < out.length; i++) out[i] = out[i]! * 0.25;
    for (const ms of apMs) {
      const d = Math.round((ms / 1000) * sr);
      const buf = new Float32Array(d);
      let idx = 0;
      for (let i = 0; i < out.length; i++) {
        const x = out[i]!;
        const y = buf[idx]!;
        buf[idx] = x + y * 0.5;
        out[i] = y - x * 0.5;
        idx = (idx + 1) % d;
      }
    }
    return out;
  };
  return {
    l: run(l, [91.3, 107.7, 127.1, 149.9], [5.1, 12.3]),
    r: run(r, [97.1, 113.3, 133.9, 157.3], [5.7, 11.1]),
  };
}

// ------------------------------------------------------------------ the track

/** Render the menu theme "Pressure". Mono-compatible, peak-normalised to 0.85. */
export function renderMenuTheme(sr: number, rng: Rng): StereoBuf {
  const n = Math.round(sr * MENU_LOOP_SECONDS);
  const total = n + Math.round(sr * TAIL_SECONDS);

  const dry = { l: makeBuf(sr, total / sr), r: makeBuf(sr, total / sr) };
  const add = (src: { l: Buf; r: Buf }, gain: number): void => {
    for (let i = 0; i < src.l.length; i++) {
      dry.l[i]! += src.l[i]! * gain;
      dry.r[i]! += src.r[i]! * gain;
    }
  };
  add(drone(sr, n, rng.fork('drone')), 1);
  add(horrorBass(sr, n, rng.fork('horror-bass')), 1);
  add(pads(sr, n), 1);
  const hb = heartbeat(sr, n);
  for (let i = 0; i < n; i++) {
    dry.l[i]! += hb[i]!;
    dry.r[i]! += hb[i]!;
  }

  // hull groans & deep horror bass swells
  const groans = makeBus(total);
  addGroan(groans.l, groans.r, sr, rng.fork('g1'), 14, 6, 58, 41, -0.4);
  addGroan(groans.l, groans.r, sr, rng.fork('g2'), 37, 7.5, 47, 36, 0.35);
  addGroan(groans.l, groans.r, sr, rng.fork('g3'), 55.5, 5, 62, 44, -0.1);

  const bassSwells = makeBus(total);
  addBassSwell(bassSwells.l, bassSwells.r, sr, rng.fork('bs1'), 1.5, 8.5, midi(26), midi(26) * cents(-35), -0.15);
  addBassSwell(bassSwells.l, bassSwells.r, sr, rng.fork('bs2'), 17.5, 9, midi(22), midi(22) * cents(-25), 0.15);
  addBassSwell(bassSwells.l, bassSwells.r, sr, rng.fork('bs3'), 33.5, 8.5, midi(19), midi(19) * cents(18), -0.12);
  addBassSwell(bassSwells.l, bassSwells.r, sr, rng.fork('bs4'), 49.5, 9, midi(21), midi(20), 0.12);

  // sends into the room
  const send = makeBus(total);
  const mixInto = (dst: { l: Buf; r: Buf }, src: { l: Buf; r: Buf }, g: number): void => {
    for (let i = 0; i < src.l.length; i++) {
      dst.l[i]! += src.l[i]! * g;
      dst.r[i]! += src.r[i]! * g;
    }
  };
  mixInto(send, dry, 0.5);
  mixInto(send, groans, 0.8);
  mixInto(send, bassSwells, 0.75);
  const wet = reverb(send.l, send.r, sr, 8, 0.45);

  const mixL = makeBuf(sr, total / sr);
  const mixR = makeBuf(sr, total / sr);
  for (let i = 0; i < total; i++) {
    mixL[i] = dry.l[i]! + groans.l[i]! + bassSwells.l[i]! + wet.l[i]! * 0.9;
    mixR[i] = dry.r[i]! + groans.r[i]! + bassSwells.r[i]! + wet.r[i]! * 0.9;
  }

  // fold the tail onto the head so the loop is seamless
  const left = makeBuf(sr, MENU_LOOP_SECONDS);
  const right = makeBuf(sr, MENU_LOOP_SECONDS);
  for (let i = 0; i < total; i++) {
    left[i % n]! += mixL[i]!;
    right[i % n]! += mixR[i]!;
  }

  // soft saturation tames stacked peaks, then normalise jointly
  let peak = 0;
  for (let i = 0; i < n; i++) {
    left[i] = Math.tanh(left[i]! * 0.9);
    right[i] = Math.tanh(right[i]! * 0.9);
    peak = Math.max(peak, Math.abs(left[i]!), Math.abs(right[i]!));
  }
  const k = peak > 0 ? 0.85 / peak : 1;
  for (let i = 0; i < n; i++) {
    left[i] = left[i]! * k;
    right[i] = right[i]! * k;
  }
  return { left, right };
}

function makeBus(total: number): { l: Buf; r: Buf } {
  return { l: new Float32Array(total), r: new Float32Array(total) };
}

export const MUSIC_SPECS = {
  menuTheme: { title: 'Pressure', seconds: MENU_LOOP_SECONDS, make: renderMenuTheme },
} as const;
