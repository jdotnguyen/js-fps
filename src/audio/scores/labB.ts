/**
 * The Lab B score (adaptive-music spec): the music of Dr. Voss's death and the creature that comes out of her. It grows
 * out of the menu theme "Pressure" (D, the b2 and the tritone, the double-thump heart) and runs at the Lab B klaxon's
 * period: one bar per 2.6 s, 92 BPM in 4/4. Eight layers loop together for 8 bars (20.8 s); `data/scores.json` cues
 * their levels. Stingers are one-shots.
 *
 *   drone      D sub drone and growling horror bass          the floor under everything
 *   heartSlow  double-thump heart, 46 BPM                     scratch: something is wrong
 *   heartFast  double-thump heart, 92 BPM                     panic onward; the walk to R05
 *   pulse      low toms and sub hits on the grid              panic to arch; the fight
 *   rise       Shepard-Risset string glissando (D + G#)       endless climb, panic to arch
 *   voice      wordless formant choir, oo <-> ah, cluster     the glass, the arch; nearing R05
 *   brutal     impacts, cracks, low brass b2/tritone, scrape  the arch; the fight
 *   hold       sparse pads with gaps, groans, a high note     after the burst; the walk
 */
import type { Rng } from '../../core/rng.ts';
import { Biquad, OnePole, TAU, white } from '../dsp.ts';
import type { RenderedScore, StereoPair } from '../scorePlayer.ts';
import {
  Saw,
  bowNoise,
  cents,
  crack,
  edges,
  impact,
  midi,
  oneShotRoom,
  pan,
  peak,
  put,
  rms,
  saturate,
  scale,
  seamlessStereo,
  smooth,
  snapper,
  stereo,
  thump,
  tom,
  withRoom,
  type Stereo,
} from './synth.ts';

export const LAB_B_BEAT = 0.65;
export const LAB_B_BAR = LAB_B_BEAT * 4;
export const LAB_B_BARS = 8;
export const LAB_B_LOOP = LAB_B_BAR * LAB_B_BARS;

const L = LAB_B_LOOP;
const snap = snapper(L);
const SIXTEENTH = LAB_B_BEAT / 4;

// ------------------------------------------------------------------ layers

function drone(sr: number, n: number, rng: Rng): Stereo {
  // The rumble and grit are noise, so render past the loop and crossfade the end into the start.
  const fadeS = 1;
  const total = n + Math.round(fadeS * sr);
  const out = stereo(total);
  const lpL = new Biquad('lowpass', 120, 2.2, sr);
  const lpR = new Biquad('lowpass', 120, 2.2, sr);
  const grit = new OnePole(120, sr);
  const noise = white(rng.fork('grit'));
  const rumble = new OnePole(55, sr);
  const rnoise = white(rng.fork('rumble'));
  const f0 = snap(midi(26)); // D1
  const fUp = snap(midi(26) * cents(9));
  const fDn = snap(midi(26) * cents(-11));
  const fBassL = snap(midi(38) * cents(-13));
  const fBassR = snap(midi(38) * cents(14));
  const fRub = snap(midi(32)); // G#1: the tritone rub
  const fB2 = snap(midi(39)); // Eb2: the b2
  for (let i = 0; i < total; i++) {
    const t = i / sr;
    if ((i & 15) === 0) {
      const sw = 0.5 + 0.5 * Math.sin((TAU * 2 * t) / L + 0.4);
      const sw2 = 0.5 + 0.5 * Math.sin((TAU * 3 * t) / L + 1.7);
      lpL.set(70 + 160 * sw * sw, 2.2);
      lpR.set(70 + 160 * sw2 * sw2, 2.2);
    }
    const sub = Math.sin(TAU * f0 * t) * 0.5 + Math.sin(TAU * fUp * t) * 0.2;
    const subR = Math.sin(TAU * f0 * t) * 0.5 + Math.sin(TAU * fDn * t) * 0.2;
    let hl = 0;
    let hr = 0;
    for (let h = 1; h <= 7; h++) {
      const a = 1 / Math.pow(h, 0.85);
      hl += Math.sin(TAU * fBassL * h * t + h * 0.3) * a;
      hr += Math.sin(TAU * fBassR * h * t + h * 0.7) * a;
    }
    const rubEnv = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin((TAU * 4 * t) / L));
    const rub = Math.sin(TAU * fRub * t) * 0.2 * rubEnv;
    const b2Env = smooth(0.5 + 0.5 * Math.sin((TAU * 1 * t) / L - 1.2));
    const b2 = Math.sin(TAU * fB2 * t) * 0.12 * b2Env;
    const g = 1 + 0.2 * grit.process(noise());
    const fl = lpL.process(Math.tanh((hl * 0.4 + rub + b2) * 2 * g));
    const fr = lpR.process(Math.tanh((hr * 0.4 - rub * 0.8 + b2) * 2 * g));
    const rb = rumble.process(rnoise()) * 1.1;
    out.l[i] = sub + fl * 0.5 + rb;
    out.r[i] = subR + fr * 0.5 - rb * 0.6;
  }
  return withRoom(seamlessStereo(out, sr, fadeS), sr, 0.35, 6);
}

function heart(sr: number, n: number, period: number, second: number, amp: number): Stereo {
  const out = stereo(n);
  const beats = Math.round(L / period);
  for (let b = 0; b < beats; b++) {
    const at = b * period;
    thump(out, sr, at, amp);
    thump(out, sr, at + second, amp * 0.55);
  }
  return withRoom(out, sr, 0.18, 2.5);
}

function pulse(sr: number, n: number, rng: Rng): Stereo {
  const out = stereo(n);
  for (let bar = 0; bar < LAB_B_BARS; bar++) {
    const t0 = bar * LAB_B_BAR;
    const r = rng.fork(`bar${bar}`);
    // Kick-tom on 1, a push on the "and" of 2, the low tom on 3, a ghost before 4.
    tom(out, sr, r.fork('a'), t0, 72, 1, 0, 0.42);
    tom(out, sr, r.fork('b'), t0 + 6 * SIXTEENTH, 64, 0.55, -0.3, 0.3);
    tom(out, sr, r.fork('c'), t0 + 8 * SIXTEENTH, 58, 0.85, 0.2, 0.38);
    tom(out, sr, r.fork('d'), t0 + 11 * SIXTEENTH, 80, 0.3, 0.35, 0.2);
    // Bars 4 and 8 climb into the next phrase.
    if (bar === 3 || bar === 7) {
      [12, 13, 14, 15].forEach((s, k) => tom(out, sr, r.fork(`f${k}`), t0 + s * SIXTEENTH, 70 + k * 12, 0.45 + k * 0.12, -0.4 + k * 0.27, 0.22));
    }
    // A low sub hit under every downbeat.
    const start = Math.round(t0 * sr);
    const len = Math.round(0.9 * sr);
    const f = snap(midi(26));
    for (let i = 0; i < len; i++) {
      const dt = i / sr;
      const v = Math.sin(TAU * f * dt) * Math.exp(-dt / 0.35) * 0.55 * Math.min(1, dt / 0.003);
      put(out.l, start + i, v);
      put(out.r, start + i, v);
    }
    // A muted tick on the off sixteenths, barely there.
    const tick = white(r.fork('tick'));
    const hp = new Biquad('bandpass', 3200, 4, sr);
    for (let s = 1; s < 16; s += 2) {
      const ts = Math.round((t0 + s * SIXTEENTH) * sr);
      const tl = Math.round(0.03 * sr);
      for (let i = 0; i < tl; i++) {
        const v = hp.process(tick()) * Math.exp(-i / sr / 0.008) * 0.12;
        put(out.l, ts + i, v * 0.7);
        put(out.r, ts + i, v);
      }
    }
  }
  return withRoom(saturate(out, 1.2), sr, 0.3, 2.8);
}

/**
 * Shepard-Risset glissando: string-like partials an octave apart that rise forever, faded in at the bottom and out at
 * the top, so the climb never arrives. A second set a tritone up rubs against it. Two octaves of climb per loop.
 */
function rise(sr: number, n: number, rng: Rng): Stereo {
  const fade = Math.round(1.2 * sr);
  const total = n + fade;
  const out = stereo(total);
  const K = 7;
  const fMin = midi(26); // D1
  const octPerLoop = 2;
  const sets = [
    { off: 0, amp: 1 },
    { off: 0.5, amp: 0.55 }, // G#, the tritone
  ];
  interface V {
    k: number;
    off: number;
    amp: number;
    det: number;
    saw: Saw;
    pan: [number, number];
  }
  const voices: V[] = [];
  let idx = 0;
  for (const s of sets) {
    for (let k = 0; k < K; k++) {
      for (const det of [-9, 0, 8]) {
        voices.push({ k, off: s.off, amp: s.amp, det: cents(det), saw: new Saw(sr, (idx * 0.618) % 1), pan: pan(((idx * 37) % 11) / 5 - 1) });
        idx++;
      }
    }
  }
  const lpL = new Biquad('lowpass', 2400, 0.7, sr);
  const lpR = new Biquad('lowpass', 2400, 0.7, sr);
  const hpL = new Biquad('highpass', 70, 0.7, sr);
  const hpR = new Biquad('highpass', 70, 0.7, sr);
  const bow = bowNoise(rng.fork('bow'), sr, 25);
  for (let i = 0; i < total; i++) {
    const t = i / sr;
    const climb = (octPerLoop * t) / L;
    const trem = 1 + 0.12 * Math.sin(TAU * 5.4 * t) + 0.04 * bow();
    let sl = 0;
    let sr_ = 0;
    for (const v of voices) {
      const x = (((v.k + v.off + climb) % K) + K) % K;
      const w = 0.5 - 0.5 * Math.cos((TAU * x) / K);
      if (w < 1e-3) {
        v.saw.next(fMin * Math.pow(2, x) * v.det);
        continue;
      }
      const s = v.saw.next(fMin * Math.pow(2, x) * v.det) * w * w * v.amp * 0.12;
      sl += s * v.pan[0];
      sr_ += s * v.pan[1];
    }
    out.l[i] = hpL.process(lpL.process(sl * trem));
    out.r[i] = hpR.process(lpR.process(sr_ * trem));
  }
  return withRoom(seamlessStereo(out, sr, fade / sr), sr, 0.55, 5);
}

/** Wordless choir: a dissonant cluster through moving vowel formants, with breath. */
function voice(sr: number, n: number, rng: Rng): Stereo {
  const fadeS = 1.5;
  const total = n + Math.round(fadeS * sr);
  const out = stereo(total);
  const notes = [50, 57, 62, 63, 68]; // D3 A3 D4 Eb4 G#4
  const vs = notes.map((m, k) => ({
    f: midi(m),
    saw: new Saw(sr, k * 0.31),
    saw2: new Saw(sr, k * 0.77),
    vib: 4.8 + k * 0.23,
    swell: 1 + (k % 3),
    ph: k * 1.9,
    pan: pan(-0.8 + k * 0.4),
  }));
  const vowels = {
    oo: [300, 870, 2240],
    ah: [730, 1090, 2440],
  };
  const bank = (): Biquad[] => [new Biquad('bandpass', 300, 6, sr), new Biquad('bandpass', 870, 8, sr), new Biquad('bandpass', 2240, 10, sr)];
  const fl = bank();
  const fr = bank();
  const fGain = [1, 0.55, 0.28];
  const breath = white(rng.fork('breath'));
  const breathHp = new Biquad('highpass', 500, 0.7, sr);
  for (let i = 0; i < total; i++) {
    const t = i / sr;
    if ((i & 63) === 0) {
      const v = smooth(0.5 + 0.5 * Math.sin((TAU * 2 * t) / L));
      const vR = smooth(0.5 + 0.5 * Math.sin((TAU * 2 * t) / L + 0.9));
      for (let k = 0; k < 3; k++) {
        fl[k]!.set(vowels.oo[k]! + (vowels.ah[k]! - vowels.oo[k]!) * v, [6, 8, 10][k]!);
        fr[k]!.set(vowels.oo[k]! + (vowels.ah[k]! - vowels.oo[k]!) * vR, [6, 8, 10][k]!);
      }
    }
    let sl = 0;
    let sr_ = 0;
    for (const v of vs) {
      const drift = cents(18 * Math.sin((TAU * 1 * t) / L + v.ph));
      const vib = cents(14 * Math.sin(TAU * v.vib * t + v.ph));
      const sw = Math.pow(0.5 + 0.5 * Math.sin((TAU * v.swell * t) / L + v.ph), 1.6);
      const s = (v.saw.next(v.f * drift * vib) + v.saw2.next(v.f * drift * vib * cents(7))) * sw * 0.5;
      sl += s * v.pan[0];
      sr_ += s * v.pan[1];
    }
    const b = breathHp.process(breath()) * 0.35;
    sl += b;
    sr_ += b;
    let ol = 0;
    let or = 0;
    for (let k = 0; k < 3; k++) {
      ol += fl[k]!.process(sl) * fGain[k]!;
      or += fr[k]!.process(sr_) * fGain[k]!;
    }
    out.l[i] = ol;
    out.r[i] = or;
  }
  return withRoom(seamlessStereo(out, sr, fadeS), sr, 0.7, 6);
}

function brutal(sr: number, n: number, rng: Rng): Stereo {
  const out = stereo(n);
  for (let bar = 0; bar < LAB_B_BARS; bar++) {
    const t0 = bar * LAB_B_BAR;
    const r = rng.fork(`bar${bar}`);
    impact(out, sr, r.fork('impact'), t0, 0.9, bar % 2 ? 103.8 : 110);
    crack(out, sr, r.fork('c1'), t0 + LAB_B_BEAT, 0.5);
    crack(out, sr, r.fork('c3'), t0 + 3 * LAB_B_BEAT, 0.55);
    if (bar === 3 || bar === 7) {
      for (let s = 12; s < 16; s++) crack(out, sr, r.fork(`f${s}`), t0 + s * SIXTEENTH, 0.25 + (s - 12) * 0.1);
    }
  }
  // Low brass: D and G# (the tritone), then Eb and A (the b2 above), two bars each.
  const chords = [
    [38, 44],
    [39, 45],
    [38, 44],
    [37, 43],
  ];
  chords.forEach((ch, k) => {
    const start = Math.round(k * 2 * LAB_B_BAR * sr);
    const len = Math.round((2 * LAB_B_BAR + 1.2) * sr);
    const saws = ch.flatMap((m) => [new Saw(sr, 0.1), new Saw(sr, 0.6)].map((s, j) => ({ s, f: midi(m) * cents(j ? 9 : -7) })));
    const lpL = new Biquad('lowpass', 500, 1.1, sr);
    const lpR = new Biquad('lowpass', 500, 1.1, sr);
    for (let i = 0; i < len; i++) {
      const dt = i / sr;
      const env = Math.min(1, dt / 0.04) * (0.45 + 0.55 * Math.exp(-dt / 0.5)) * (1 - smooth((dt - 2 * LAB_B_BAR + 0.2) / 1.2));
      if ((i & 31) === 0) {
        const c = 260 + 1100 * Math.exp(-dt / 0.35);
        lpL.set(c, 1.1);
        lpR.set(c * 1.1, 1.1);
      }
      let s = 0;
      for (const v of saws) s += v.s.next(v.f);
      const vl = Math.tanh(lpL.process(s) * 1.8) * env * 0.35;
      const vr = Math.tanh(lpR.process(s) * 1.8) * env * 0.35;
      put(out.l, start + i, vl);
      put(out.r, start + i, vr);
    }
  });
  // Bowed metal: noise through a ringing band that wanders, continuous.
  const fadeS = 1;
  const total = n + Math.round(fadeS * sr);
  const scrape = stereo(total);
  const bpL = new Biquad('bandpass', 1400, 28, sr);
  const bpR = new Biquad('bandpass', 1500, 28, sr);
  const nz = white(rng.fork('scrape'));
  const bow = bowNoise(rng.fork('scrape-bow'), sr, 8);
  for (let i = 0; i < total; i++) {
    const t = i / sr;
    if ((i & 31) === 0) {
      bpL.set(1100 + 900 * (0.5 + 0.5 * Math.sin((TAU * 3 * t) / L)), 28);
      bpR.set(1250 + 950 * (0.5 + 0.5 * Math.sin((TAU * 4 * t) / L + 1)), 28);
    }
    const a = 0.5 + 0.5 * Math.abs(bow());
    const x = nz();
    scrape.l[i] = bpL.process(x) * a * 1.4;
    scrape.r[i] = bpR.process(x) * a * 1.4;
  }
  const sc = seamlessStereo(scrape, sr, fadeS);
  for (let i = 0; i < n; i++) {
    out.l[i]! += sc.l[i]!;
    out.r[i]! += sc.r[i]!;
  }
  return withRoom(saturate(out, 1.1), sr, 0.4, 3.5);
}

/** The aftermath: soft clashing pads with gaps between them, far-off groans, and one high thin note. */
function hold(sr: number, n: number, rng: Rng): Stereo {
  const out = stereo(n);
  const pad = (at: number, dur: number, notes: number[], amp: number, p: number): void => {
    const start = Math.round(at * sr);
    const len = Math.round((dur + 2.5) * sr);
    const saws = notes.flatMap((m, k) => [-6, 5].map((d, j) => ({ s: new Saw(sr, (k * 0.37 + j * 0.5) % 1), f: midi(m) * cents(d) })));
    const lp = new Biquad('lowpass', 520, 0.7, sr);
    const [gl, gr] = pan(p);
    for (let i = 0; i < len; i++) {
      const dt = i / sr;
      const env = smooth(dt / 1.6) * (1 - smooth((dt - dur) / 2.5));
      let s = 0;
      for (const v of saws) s += v.s.next(v.f);
      const y = lp.process(s) * env * amp;
      put(out.l, start + i, y * gl);
      put(out.r, start + i, y * gr);
    }
  };
  pad(0.2, 4.4, [50, 53, 57, 63], 0.09, -0.3); // Dm with the b2
  pad(7.9, 3.6, [46, 52, 62], 0.08, 0.35); // Bb, E (tritone), D
  pad(13.4, 2.6, [49, 55, 63], 0.07, -0.1); // Db, G, Eb: nothing resolves
  // Groans, far off.
  const groan = (at: number, dur: number, f0: number, f1: number, p: number, r: Rng): void => {
    const start = Math.round(at * sr);
    const len = Math.round(dur * sr);
    const jit = new OnePole(20, sr);
    const nz = white(r);
    const [gl, gr] = pan(p);
    let ph = 0;
    for (let i = 0; i < len; i++) {
      const q = i / len;
      const env = Math.sin(Math.PI * q) ** 2;
      ph += (TAU * (f0 + (f1 - f0) * smooth(q))) / sr;
      const g = 0.65 + 0.35 * jit.process(nz()) * 6;
      let s = 0;
      for (let h = 1; h <= 9; h++) s += (Math.sin(ph * h + h * 0.8) * Math.exp(-Math.pow((h - 4.5) / 2.5, 2))) / Math.sqrt(h);
      const y = s * env * g * 0.06;
      put(out.l, start + i, y * gl);
      put(out.r, start + i, y * gr);
    }
  };
  groan(3.4, 6, 54, 39, -0.5, rng.fork('g1'));
  groan(15.5, 5, 61, 44, 0.45, rng.fork('g2'));
  // One thin high note, D6 against a slow beat a few cents off, breathing over the loop.
  const fA = snap(midi(86));
  const fB = snap(midi(86) * cents(6));
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const br = 0.5 + 0.5 * Math.sin((TAU * 1 * t) / L - 0.5);
    const y = (Math.sin(TAU * fA * t) + Math.sin(TAU * fB * t) * 0.6) * 0.012 * (0.4 + 0.6 * br);
    out.l[i]! += y;
    out.r[i]! += y * 0.8;
  }
  return withRoom(out, sr, 0.75, 7);
}

// ------------------------------------------------------------------ stingers

function stab(sr: number, rng: Rng, notes: number[]): Stereo {
  const len = Math.round(1.8 * sr);
  const out = stereo(len);
  const saws = notes.flatMap((m, k) => [-8, 0, 9].map((d, j) => ({ s: new Saw(sr, (k * 0.29 + j * 0.41) % 1), f: midi(m) * cents(d), p: pan(-0.7 + ((k * 3 + j) % 7) * 0.23) })));
  const lpL = new Biquad('lowpass', 4000, 0.8, sr);
  const lpR = new Biquad('lowpass', 4000, 0.8, sr);
  const scratch = white(rng.fork('scratch'));
  const sbp = new Biquad('bandpass', 2600, 2, sr);
  for (let i = 0; i < len; i++) {
    const dt = i / sr;
    const env = Math.min(1, dt / 0.004) * Math.exp(-dt / 0.22);
    if ((i & 31) === 0) {
      const c = 500 + 4200 * Math.exp(-dt / 0.12);
      lpL.set(c, 0.8);
      lpR.set(c * 1.05, 0.8);
    }
    let l = 0;
    let r = 0;
    for (const v of saws) {
      const s = v.s.next(v.f);
      l += s * v.p[0];
      r += s * v.p[1];
    }
    const sc = sbp.process(scratch()) * Math.exp(-dt / 0.03) * 1.5;
    out.l[i] = (lpL.process(l) * 0.16 + sc) * env;
    out.r[i] = (lpR.process(r) * 0.16 + sc) * env;
  }
  tom(out, sr, rng.fork('thump'), 0, 60, 0.6, 0, 0.25);
  return edges(oneShotRoom(out, sr, 0.5, 2.5), sr);
}

function swell(sr: number, rng: Rng): Stereo {
  const dur = 3.4;
  const len = Math.round((dur + 2.5) * sr);
  const out = stereo(len);
  const saws = [38, 44, 51, 56, 63].flatMap((m, k) => [-10, 10].map((d, j) => ({ s: new Saw(sr, (k + j) * 0.21), f: midi(m) * cents(d), p: pan(-0.6 + k * 0.3) })));
  const lp = new Biquad('lowpass', 300, 1.4, sr);
  const lp2 = new Biquad('lowpass', 300, 1.4, sr);
  const nz = white(rng.fork('air'));
  const end = Math.round(dur * sr);
  for (let i = 0; i < end; i++) {
    const dt = i / sr;
    const q = dt / dur;
    const env = Math.pow(q, 2.6) * (1 - smooth((dt - dur + 0.03) / 0.03));
    if ((i & 31) === 0) {
      lp.set(250 + 2600 * q * q, 1.4);
      lp2.set(260 + 2700 * q * q, 1.4);
    }
    const bend = cents(-60 * q);
    let l = 0;
    let r = 0;
    for (const v of saws) {
      const s = v.s.next(v.f * bend);
      l += s * v.p[0];
      r += s * v.p[1];
    }
    const air = nz() * 0.3 * q;
    out.l[i] = Math.tanh(lp.process(l + air) * 0.5 * (1 + q)) * env;
    out.r[i] = Math.tanh(lp2.process(r + air) * 0.5 * (1 + q)) * env;
  }
  return edges(oneShotRoom(out, sr, 0.6, 4), sr);
}

function riser(sr: number, rng: Rng): Stereo {
  const dur = 2.6;
  const len = Math.round((dur + 0.1) * sr);
  const out = stereo(len);
  const nz = white(rng.fork('riser'));
  const bpL = new Biquad('bandpass', 200, 3, sr);
  const bpR = new Biquad('bandpass', 210, 3, sr);
  const saw = new Saw(sr);
  const saw2 = new Saw(sr, 0.5);
  const end = Math.round(dur * sr);
  for (let i = 0; i < end; i++) {
    const dt = i / sr;
    const q = dt / dur;
    if ((i & 31) === 0) {
      const f = 200 * Math.pow(30, q);
      bpL.set(f, 3);
      bpR.set(f * 1.06, 3);
    }
    const f = midi(38) * Math.pow(2, 2 * q * q);
    const tone = (saw.next(f) + saw2.next(f * cents(50))) * 0.12 * q;
    const env = Math.pow(q, 1.8);
    const x = nz();
    out.l[i] = Math.tanh((bpL.process(x) * 1.6 + tone) * 1.4) * env;
    out.r[i] = Math.tanh((bpR.process(x) * 1.6 + tone) * 1.4) * env;
  }
  return edges(out, sr, 0.01, 0.01);
}

function slam(sr: number, rng: Rng): Stereo {
  const len = Math.round(5.5 * sr);
  const out = stereo(len);
  impact(out, sr, rng.fork('a'), 0, 1, 98, 4.5);
  impact(out, sr, rng.fork('b'), 0.012, 0.6, 146.8, 3.5);
  const saws = [26, 38, 44].map((m, k) => ({ s: new Saw(sr, k * 0.3), f: midi(m) }));
  const lp = new Biquad('lowpass', 700, 1, sr);
  for (let i = 0; i < Math.round(3 * sr); i++) {
    const dt = i / sr;
    if ((i & 31) === 0) lp.set(180 + 1400 * Math.exp(-dt / 0.4), 1);
    let s = 0;
    for (const v of saws) s += v.s.next(v.f);
    const y = Math.tanh(lp.process(s) * 2) * Math.exp(-dt / 0.9) * 0.4 * Math.min(1, dt / 0.004);
    out.l[i]! += y;
    out.r[i]! += y;
  }
  return edges(oneShotRoom(saturate(out, 1.3), sr, 0.5, 4), sr);
}

function finale(sr: number, rng: Rng): Stereo {
  const len = Math.round(7 * sr);
  const out = stereo(len);
  impact(out, sr, rng.fork('hit'), 0, 1, 110, 3.5);
  const f = midi(26);
  const f2 = midi(38);
  for (let i = 0; i < Math.round(5 * sr); i++) {
    const dt = i / sr;
    const env = Math.min(1, dt / 0.05) * (1 - smooth((dt - 0.6) / 3.2));
    const y = (Math.sin(TAU * f * dt) * 0.6 + Math.sin(TAU * f2 * dt + 0.3) * 0.25 + Math.sin(TAU * f * cents(10) * dt) * 0.2) * env * 0.6;
    out.l[i]! += y;
    out.r[i]! += y;
  }
  return edges(oneShotRoom(out, sr, 0.55, 5), sr);
}

// ------------------------------------------------------------------ the score

/** RMS each layer is set to before the cues mix them; the cue table then balances them by level. */
const LAYER_RMS: Record<string, number> = {
  drone: 0.11,
  heartSlow: 0.06,
  heartFast: 0.06,
  pulse: 0.075,
  rise: 0.065,
  voice: 0.06,
  brutal: 0.1,
  hold: 0.05,
};

/** The arch's levels (scores.json): the loudest moment, used to keep the full mix under clipping. */
const ARCH: Record<string, number> = { drone: 1, heartFast: 0.9, pulse: 0.9, rise: 0.9, voice: 0.8, brutal: 1 };

const pair = (s: Stereo): StereoPair => ({ left: s.l, right: s.r });

export function renderLabB(sr: number, rng: Rng): RenderedScore {
  const n = Math.round(sr * L);
  const layers: Record<string, Stereo> = {
    drone: drone(sr, n, rng.fork('drone')),
    heartSlow: heart(sr, n, LAB_B_BEAT * 2, 0.28, 0.8),
    heartFast: heart(sr, n, LAB_B_BEAT, 0.2, 0.75),
    pulse: pulse(sr, n, rng.fork('pulse')),
    rise: rise(sr, n, rng.fork('rise')),
    voice: voice(sr, n, rng.fork('voice')),
    brutal: brutal(sr, n, rng.fork('brutal')),
    hold: hold(sr, n, rng.fork('hold')),
  };
  for (const [name, s] of Object.entries(layers)) {
    const r = rms(s);
    if (r > 0) scale(s, (LAYER_RMS[name] ?? 0.06) / r);
  }
  // Keep the arch (everything loud at once) under clipping.
  const mix = stereo(n);
  for (const [name, g] of Object.entries(ARCH)) {
    const s = layers[name]!;
    for (let i = 0; i < n; i++) {
      mix.l[i]! += s.l[i]! * g;
      mix.r[i]! += s.r[i]! * g;
    }
  }
  const p = peak(mix);
  if (p > 0.95) for (const s of Object.values(layers)) scale(s, 0.95 / p);

  const norm = (s: Stereo, to = 0.9): Stereo => {
    const pk = peak(s);
    return pk > 0 ? scale(s, to / pk) : s;
  };
  const stingers: Record<string, StereoPair[]> = {
    stab: [pair(norm(stab(sr, rng.fork('stab1'), [50, 51, 56, 62]), 0.75)), pair(norm(stab(sr, rng.fork('stab2'), [51, 52, 57, 63]), 0.75))],
    swell: [pair(norm(swell(sr, rng.fork('swell')), 0.8))],
    rise: [pair(norm(riser(sr, rng.fork('riser')), 0.7))],
    slam: [pair(norm(slam(sr, rng.fork('slam')), 0.95))],
    end: [pair(norm(finale(sr, rng.fork('end')), 0.9))],
  };
  return {
    sampleRate: sr,
    layers: Object.fromEntries(Object.entries(layers).map(([k, s]) => [k, pair(s)])),
    stingers,
  };
}
