/**
 * Procedural music (ADR-0013). Renders a stereo, seamlessly looping track from a seeded RNG,
 * so it is identical on every machine and needs no audio files.
 *
 * "Pressure" - the main menu theme and base mood for the station. A 64 s loop in D, built from
 * a sub drone, slow chord pads that clash on purpose (b2, tritone), a sonar ping into a long
 * dark echo, a sparse detuned bell motif, hull groans and a faint double-thump heartbeat.
 *
 * Loop strategy: every periodic part uses frequencies snapped to whole cycles per loop, and
 * everything is rendered with a tail that is folded back onto the start, so reverb and echo
 * tails ring across the seam.
 */
import type { Rng } from '../core/rng.ts';
import { makeBuf, OnePole, TAU, white, type Buf } from './dsp.ts';

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
  const rumble = new OnePole(70, sr);
  const noise = white(rng.fork('drone-noise'));
  const f0 = snap(midi(26)); // D1 pedal, constant under every chord
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const swell = 0.75 + 0.25 * Math.sin(TAU * (2 / MENU_LOOP_SECONDS) * t);
    let s = Math.sin(TAU * f0 * t) * 0.5 + Math.sin(TAU * 2 * f0 * t + 0.6) * 0.14 * swell;
    // slowly beating partner a few cents away: the "breathing" of the floor
    s += Math.sin(TAU * snap(midi(26) * cents(9)) * t) * 0.28;
    // chord roots
    for (let k = 0; k < CHORDS.length; k++) {
      const w = chordWeight(k, t);
      if (w > 0) s += Math.sin(TAU * snap(midi(CHORDS[k]!.bass + 12)) * t) * 0.22 * w;
    }
    const rb = rumble.process(noise()) * 1.2;
    l[i] = (s + rb) * 0.55;
    r[i] = (s - rb * 0.5) * 0.55;
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

/** Out-of-tune high shimmer: a tritone cluster that breathes in and out of hearing. */
function shimmer(sr: number, n: number): { l: Buf; r: Buf } {
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  const tones = [midi(86), midi(92), midi(87) * cents(18), midi(81) * cents(-23)];
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let sl = 0;
    let sr_ = 0;
    tones.forEach((f, j) => {
      const ff = snap(f);
      const breathL = Math.pow(0.5 + 0.5 * Math.sin(TAU * ((j + 1) / MENU_LOOP_SECONDS) * t + j), 3);
      const breathR = Math.pow(0.5 + 0.5 * Math.sin(TAU * ((j + 2) / MENU_LOOP_SECONDS) * t + j * 2), 3);
      const s = Math.sin(TAU * ff * t + j);
      sl += s * breathL;
      sr_ += s * breathR;
    });
    const gate = smooth((t - 14) / 10) * (1 - smooth((t - 56) / 6)) + 0.35 * smooth((t - 36) / 4) * (1 - smooth((t - 52) / 6));
    l[i] = sl * 0.012 * (0.4 + gate);
    r[i] = sr_ * 0.012 * (0.4 + gate);
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
      const f = 38 + 22 * Math.exp(-dt / 0.05);
      return Math.sin(TAU * f * dt) * Math.exp(-dt / 0.11) * amp * Math.min(1, dt / 0.004);
    };
    // present from the middle of the loop, receding before the seam
    const level = smooth((t - 18) / 14) * (1 - smooth((t - 54) / 8));
    out[i] = (pulse(0, 1) + pulse(0.3, 0.55)) * 0.55 * level;
  }
  return out;
}

// ------------------------------------------------------------------ one-shots (into length N+tail)

function addPing(l: Buf, r: Buf, sr: number, at: number, f: number, pan: number): void {
  const len = Math.min(l.length - Math.floor(at * sr), Math.floor(2.2 * sr));
  const start = Math.floor(at * sr);
  const gl = Math.sqrt(0.5 - 0.5 * pan);
  const gr = Math.sqrt(0.5 + 0.5 * pan);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const fi = f * (1 + 0.012 * Math.exp(-t / 0.05));
    const s = (Math.sin(TAU * fi * t) + 0.22 * Math.sin(TAU * fi * 2.01 * t)) * Math.exp(-t / 0.5) * Math.min(1, t / 0.003);
    l[start + i]! += s * 0.2 * gl;
    r[start + i]! += s * 0.2 * gr;
  }
}

function addBell(l: Buf, r: Buf, sr: number, at: number, f: number, vel: number, pan: number): void {
  const start = Math.floor(at * sr);
  const len = Math.min(l.length - start, Math.floor(7 * sr));
  const gl = Math.sqrt(0.5 - 0.5 * pan);
  const gr = Math.sqrt(0.5 + 0.5 * pan);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    // wow: the pitch sags, like a failing music box
    const fi = f * (1 - 0.004 * (1 - Math.exp(-t / 1.5)));
    const idx = 2.2 * Math.exp(-t / 0.5);
    const m = Math.sin(TAU * fi * 3.5 * t) * idx;
    const s = Math.sin(TAU * fi * t + m) * Math.exp(-t / 2.3) + 0.25 * Math.sin(TAU * fi * 5.43 * t) * Math.exp(-t / 0.35);
    const e = s * vel * Math.min(1, t / 0.002);
    l[start + i]! += e * gl;
    r[start + i]! += e * gr;
  }
}

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

// ------------------------------------------------------------------ space

/** Ping-pong echo (lowpassed repeats) applied to a bus. */
function pingPong(l: Buf, r: Buf, sr: number, delay: number, fb: number): { l: Buf; r: Buf } {
  const d = Math.round(delay * sr);
  const ol = new Float32Array(l.length);
  const or = new Float32Array(r.length);
  const lpl = new OnePole(2200, sr);
  const lpr = new OnePole(2200, sr);
  for (let i = 0; i < l.length; i++) {
    const fl = i >= d ? lpr.process(or[i - d]!) * fb : 0;
    const fr = i >= d ? lpl.process(ol[i - d]!) * fb : 0;
    ol[i] = l[i]! + fl;
    or[i] = r[i]! + fr;
  }
  return { l: ol, r: or };
}

/** Compact stereo Schroeder/Moorer reverb: 4 damped combs + 2 allpasses per channel. */
function reverb(l: Buf, r: Buf, sr: number, rt60: number, damp: number): { l: Buf; r: Buf } {
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
  add(pads(sr, n), 1);
  add(shimmer(sr, n), 1);
  const hb = heartbeat(sr, n);
  for (let i = 0; i < n; i++) {
    dry.l[i]! += hb[i]!;
    dry.r[i]! += hb[i]!;
  }

  // sonar: one ping at the top of each chord, alternating sides
  const pings = makeBus(total);
  [3, 19, 35, 51].forEach((t, i) => addPing(pings.l, pings.r, sr, t, midi(i % 2 ? 88 : 91), i % 2 ? 0.5 : -0.5));
  const pingEcho = pingPong(pings.l, pings.r, sr, 0.82, 0.58);

  // bells: a lonely motif that leans on the minor second
  const bells = makeBus(total);
  const motif: readonly [number, number, number][] = [
    [6, 74, 0.1], [9.5, 75, 0.09], [13, 74, 0.08],
    [24, 77, 0.1], [27.5, 75, 0.08], [30, 72, 0.09],
    [41, 69, 0.1], [44.5, 70, 0.09], [48, 69, 0.08],
    [58, 75, 0.09], [60.5, 74, 0.07],
  ];
  motif.forEach(([t, note, vel], i) => {
    const pan = ((i % 5) - 2) * 0.22;
    addBell(bells.l, bells.r, sr, t, midi(note), vel, pan);
    addBell(bells.l, bells.r, sr, t + 0.045, midi(note) * cents(14), vel * 0.4, -pan); // ghost
  });

  // hull groans
  const groans = makeBus(total);
  addGroan(groans.l, groans.r, sr, rng.fork('g1'), 14, 6, 58, 41, -0.4);
  addGroan(groans.l, groans.r, sr, rng.fork('g2'), 37, 7.5, 47, 36, 0.35);
  addGroan(groans.l, groans.r, sr, rng.fork('g3'), 55.5, 5, 62, 44, -0.1);

  // sends into the room
  const send = makeBus(total);
  const mixInto = (dst: { l: Buf; r: Buf }, src: { l: Buf; r: Buf }, g: number): void => {
    for (let i = 0; i < src.l.length; i++) {
      dst.l[i]! += src.l[i]! * g;
      dst.r[i]! += src.r[i]! * g;
    }
  };
  mixInto(send, dry, 0.5);
  mixInto(send, pingEcho, 1);
  mixInto(send, bells, 1.3);
  mixInto(send, groans, 0.8);
  const wet = reverb(send.l, send.r, sr, 8, 0.45);

  const mixL = makeBuf(sr, total / sr);
  const mixR = makeBuf(sr, total / sr);
  for (let i = 0; i < total; i++) {
    mixL[i] = dry.l[i]! + pingEcho.l[i]! * 0.9 + bells.l[i]! * 0.7 + groans.l[i]! + wet.l[i]! * 0.9;
    mixR[i] = dry.r[i]! + pingEcho.r[i]! * 0.9 + bells.r[i]! * 0.7 + groans.r[i]! + wet.r[i]! * 0.9;
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
