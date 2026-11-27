/** Station ambience: room beds, spatial emitters and the hull, water and console one-shots, with their procedural fallbacks. Part of the sound registry (./index.ts). */

import type { Rng } from '../../core/rng.ts';
import { Biquad, brown, fadeEdges, makeBuf, normalize, pink, seamless, TAU, white, type Buf } from '../dsp.ts';
import { clamp01, lerp, modal, type SoundSpec } from '../synth.ts';

const LOOP_FADE = 0.5;

// ------------------------------------------------------------------ loops

/** Station room tone: low rumble, 60 Hz mains hum, faint air. */
export function roomTone(sr: number, rng: Rng): Buf {
  const b = makeBuf(sr, 8 + LOOP_FADE);
  const br = brown(rng);
  const lp = new Biquad('lowpass', 180, 0.7, sr);
  const air = pink(rng.fork('air'));
  const bp = new Biquad('bandpass', 2500, 0.7, sr);
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    const wobble = 1 + 0.15 * Math.sin(TAU * 0.125 * t);
    const hum = (Math.sin(TAU * 60 * t) * 0.12 + Math.sin(TAU * 120 * t + 1) * 0.06 + Math.sin(TAU * 180 * t + 2) * 0.03) * wobble;
    b[i] = lp.process(br()) * 0.6 + hum + bp.process(air()) * 0.05;
  }
  return normalize(seamless(b, sr, LOOP_FADE), 0.5);
}

/** Wall vent: motor whine plus air chopped by four fan blades. */
export function ventFan(sr: number, rng: Rng): Buf {
  const b = makeBuf(sr, 4 + LOOP_FADE);
  const air = pink(rng);
  const bp = new Biquad('bandpass', 900, 0.8, sr);
  const br = brown(rng.fork('low'));
  const lp = new Biquad('lowpass', 120, 0.7, sr);
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    const blade = Math.sin(TAU * 5.75 * t);
    const phase = TAU * 180 * t + 0.3 * Math.sin(TAU * 0.5 * t);
    b[i] =
      bp.process(air()) * 0.5 * (0.7 + 0.3 * blade) +
      Math.sin(phase) * 0.05 +
      Math.sin(phase * 2) * 0.025 +
      lp.process(br()) * 0.3 * (0.8 + 0.2 * blade);
  }
  return normalize(seamless(b, sr, LOOP_FADE), 0.6);
}

/** Fluorescent ballast buzz (120 Hz and harmonics) with occasional crackle. */
export function fluorescentBuzz(sr: number, rng: Rng): Buf {
  const b = makeBuf(sr, 2 + LOOP_FADE);
  const phases = Array.from({ length: 13 }, () => rng.next() * TAU);
  const bp = new Biquad('bandpass', 1400, 0.7, sr);
  const hp = new Biquad('highpass', 3000, 0.7, sr);
  const noise = white(rng.fork('crackle'));
  const crackRng = rng.fork('crackle-timing');
  let crack = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    let s = 0;
    for (let k = 1; k <= 12; k++) s += Math.sin(TAU * 120 * k * t + phases[k]!) / Math.pow(k, 0.7);
    if (crackRng.next() < 0.0006) crack = 1;
    crack *= 0.995;
    const buzz = bp.process(s) * 0.5 + Math.sin(TAU * 120 * t) * 0.25 + Math.sin(TAU * 240 * t) * 0.1;
    b[i] = buzz * (0.85 + 0.15 * Math.sin(TAU * t)) + hp.process(noise()) * crack * 0.6;
  }
  return normalize(seamless(b, sr, LOOP_FADE), 0.5);
}

/** Ocean pressure on the hull: sub rumble that swells, with muffled bubbles. */
export function waterRumble(sr: number, rng: Rng): Buf {
  const b = makeBuf(sr, 8 + LOOP_FADE);
  const br = brown(rng);
  const lp = new Biquad('lowpass', 90, 0.7, sr);
  const bubbleLp = new Biquad('lowpass', 600, 0.7, sr);
  const bubbles: Array<{ age: number; f0: number; phase: number }> = [];
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    if (rng.next() < 1 / (sr * 1.4) && bubbles.length < 4) bubbles.push({ age: 0, f0: rng.range(150, 380), phase: 0 });
    let bub = 0;
    for (const bb of bubbles) {
      bb.phase += (bb.f0 * (1 + bb.age * 3)) / sr;
      bub += Math.sin(TAU * bb.phase) * Math.exp(-bb.age / 0.07);
      bb.age += 1 / sr;
    }
    for (let k = bubbles.length - 1; k >= 0; k--) if (bubbles[k]!.age > 0.4) bubbles.splice(k, 1);
    b[i] = lp.process(br()) * (1 + 0.35 * Math.sin((TAU * t) / 8)) + bubbleLp.process(bub) * 0.25;
  }
  return normalize(seamless(b, sr, LOOP_FADE), 0.6);
}

/** Electronics hum and fan hiss from the console. */
export function consoleHum(sr: number, rng: Rng): Buf {
  const b = makeBuf(sr, 2 + LOOP_FADE);
  const hiss = pink(rng);
  const bp = new Biquad('bandpass', 5000, 1.5, sr);
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    b[i] = Math.sin(TAU * 100 * t) * 0.3 + Math.sin(TAU * 200 * t) * 0.12 + bp.process(hiss()) * 0.08;
  }
  return normalize(seamless(b, sr, LOOP_FADE), 0.25);
}

// ------------------------------------------------------------------ one-shots

/** Long hull stress groan with stick-slip creaks riding on it. */
export function hullGroan(sr: number, rng: Rng): Buf {
  const dur = rng.range(4.5, 6.5);
  const b = makeBuf(sr, dur);
  const f0 = rng.range(38, 52);
  const bp = new Biquad('bandpass', 100, 5, sr);
  const lp = new Biquad('lowpass', 700, 0.7, sr);
  const creak1 = new Biquad('bandpass', rng.range(380, 650), 14, sr);
  const creak2 = new Biquad('bandpass', rng.range(1000, 1300), 9, sr);
  const rough = brown(rng.fork('rough'));
  const ph1 = rng.next() * TAU;
  let phase = 0;
  let nextImpulse = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    const p = t / dur;
    const env = clamp01(t / 1.2) * clamp01((dur - t) / 1.8);
    const f = f0 * (1 + 0.18 * Math.sin(TAU * 0.31 * t + ph1) + 0.06 * Math.sin(TAU * 1.7 * t));
    phase += f / sr;
    const saw = 2 * (phase % 1) - 1;
    if (i % 64 === 0) bp.set(90 + 70 * Math.sin(Math.PI * p), 5);
    const body = lp.process(bp.process(saw * (0.7 + 0.6 * rough()))) * 1.8;
    let impulse = 0;
    if (t >= nextImpulse) {
      impulse = 1;
      nextImpulse = t + 0.007 + 0.009 * rng.next() + 0.01 * (1 - Math.sin(Math.PI * p));
    }
    const creak = (creak1.process(impulse) + 0.5 * creak2.process(impulse)) * Math.sin(Math.PI * p) ** 2 * 0.9;
    b[i] = (body + creak) * env;
  }
  return fadeEdges(normalize(b, 0.85), sr, 0.01, 0.05);
}

/** A distant struck bulkhead: inharmonic decaying partials plus a thud. */
export function metalKnock(sr: number, rng: Rng): Buf {
  const b = makeBuf(sr, 2);
  const base = rng.range(90, 170);
  const ratios = [1, 2.32, 4.25, 6.63, 9.38, 12.1].map((r) => r * (1 + (rng.next() - 0.5) * 0.04));
  const phases = ratios.map(() => rng.next() * TAU);
  const noise = white(rng.fork('n'));
  const lp = new Biquad('lowpass', 500, 0.7, sr);
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    b[i] =
      modal(t, base, ratios, [1, 0.7, 0.45, 0.3, 0.2, 0.12], [1.4, 0.9, 0.6, 0.4, 0.28, 0.2], phases) * Math.min(1, t / 0.002) +
      lp.process(noise()) * Math.exp(-t / 0.012) * 0.8;
  }
  return fadeEdges(normalize(b, 0.9), sr, 0, 0.1);
}

/** Sonar-like pressure ping from outside, with echoes. */
export function pressurePing(sr: number, rng: Rng): Buf {
  const b = makeBuf(sr, 3.2);
  const f = rng.range(1050, 1400);
  const echoes: Array<[number, number]> = [[0, 1], [0.5, 0.45], [1.0, 0.2], [1.5, 0.08]];
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    let s = 0;
    for (const [delay, g] of echoes) {
      const te = t - delay;
      if (te < 0) continue;
      s += g * Math.exp(-te / 0.5) * Math.sin(TAU * f * (1 - 0.02 * Math.min(te, 1)) * te) * Math.min(1, te / 0.004);
    }
    b[i] = s;
  }
  return fadeEdges(normalize(b, 0.6), sr, 0, 0.1);
}

/** Water drip: a rising "bloop" with a tiny impact click. */
export function drip(sr: number, rng: Rng): Buf {
  const b = makeBuf(sr, 0.3);
  const f0 = rng.range(550, 1100);
  const noise = white(rng);
  let phase = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    phase += (f0 * (1 + (2.2 * Math.min(t, 0.03)) / 0.03)) / sr;
    b[i] = Math.sin(TAU * phase) * Math.exp(-t / 0.035) * Math.min(1, t / 0.001) + noise() * Math.exp(-t / 0.0015) * 0.3;
  }
  return fadeEdges(normalize(b, 0.7), sr, 0, 0.02);
}

/** Metal creak: stick-slip impulse train exciting narrow resonances. */
export function creak(sr: number, rng: Rng): Buf {
  const dur = rng.range(1, 1.8);
  const b = makeBuf(sr, dur);
  const r1 = new Biquad('bandpass', rng.range(300, 520), 16, sr);
  const r2 = new Biquad('bandpass', rng.range(900, 1300), 10, sr);
  const ph = rng.next() * TAU;
  let next = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    const p = t / dur;
    let imp = 0;
    if (t >= next) {
      imp = 1;
      next = t + lerp(0.006, 0.016, 0.5 + 0.5 * Math.sin(TAU * 0.7 * t + ph)) + rng.next() * 0.003;
    }
    b[i] = (r1.process(imp) + 0.4 * r2.process(imp)) * Math.sin(Math.PI * p) ** 1.5;
  }
  return fadeEdges(normalize(b, 0.6), sr, 0.005, 0.05);
}

/** Electrical arc when a failing light kicks back on. */
export function zap(sr: number, rng: Rng): Buf {
  const b = makeBuf(sr, 0.4);
  const hp = new Biquad('highpass', 1800, 0.7, sr);
  const lp = new Biquad('lowpass', 2000, 0.7, sr);
  const noise = white(rng);
  let gate = 1;
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    if (i % Math.round(sr * 0.003) === 0) gate = rng.next() < 0.55 ? 1 : 0.1;
    const env = Math.exp(-t / 0.12);
    b[i] = (hp.process(noise()) * gate + lp.process(Math.sign(Math.sin(TAU * 120 * t))) * 0.4) * env;
  }
  return fadeEdges(normalize(b, 0.7), sr, 0.001, 0.03);
}

/** Two-tone console chirp. */
export function consoleBeep(sr: number, rng: Rng): Buf {
  const b = makeBuf(sr, 0.3);
  const f1 = rng.pick([1568, 1760]);
  const f2 = rng.pick([2093, 2349]);
  const tone = (t: number, start: number, f: number): number => {
    const tt = t - start;
    if (tt < 0 || tt > 0.07) return 0;
    const env = Math.min(1, tt / 0.004) * Math.min(1, (0.07 - tt) / 0.004);
    return (Math.sin(TAU * f * tt) + 0.2 * Math.sin(TAU * 3 * f * tt)) * env;
  };
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    b[i] = tone(t, 0, f1) + tone(t, 0.11, f2);
  }
  return normalize(b, 0.35);
}

/** Something enormous, far out in the dark: a slow, gliding, formant-y moan. */
export function distantMoan(sr: number, rng: Rng): Buf {
  const dur = 7.5;
  const b = makeBuf(sr, dur);
  const fa = new Biquad('bandpass', 240, 4, sr);
  const fb = new Biquad('bandpass', 520, 6, sr);
  const lp = new Biquad('lowpass', 900, 0.7, sr);
  const grit = brown(rng);
  const start = rng.range(54, 62);
  let phase = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    const p = t / dur;
    if (i % 64 === 0) {
      fa.set(lerp(240, 180, p), 4);
      fb.set(lerp(520, 380, p), 6);
    }
    phase += (lerp(start, 36, p) * (1 + 0.04 * Math.sin(TAU * 0.35 * t))) / sr;
    const saw = 2 * (phase % 1) - 1;
    const env = clamp01(t / 2.2) * clamp01((dur - t) / 3);
    b[i] = lp.process((fa.process(saw) + fb.process(saw) * 0.6) * (0.7 + 0.3 * grit())) * env;
  }
  return fadeEdges(normalize(b, 0.8), sr, 0.01, 0.1);
}

export const specs = {
  roomTone: { make: roomTone, loop: true, variants: 1 },
  ventFan: { make: ventFan, loop: true, variants: 1 },
  fluorescentBuzz: { make: fluorescentBuzz, loop: true, variants: 2 },
  waterRumble: { make: waterRumble, loop: true, variants: 1 },
  consoleHum: { make: consoleHum, loop: true, variants: 1 },
  hullGroan: { make: hullGroan, loop: false, variants: 3 },
  metalKnock: { make: metalKnock, loop: false, variants: 4 },
  pressurePing: { make: pressurePing, loop: false, variants: 2 },
  drip: { make: drip, loop: false, variants: 4 },
  creak: { make: creak, loop: false, variants: 3 },
  zap: { make: zap, loop: false, variants: 3 },
  consoleBeep: { make: consoleBeep, loop: false, variants: 2 },
  distantMoan: { make: distantMoan, loop: false, variants: 2 },
} as const satisfies Record<string, SoundSpec>;

export const samples = {
  // Environmental ambient beds, spatial emitters, and foley one-shots (ElevenLabs, scripts/ambience-generate.ts).
  // Keys matching SOUND_SPECS replace their procedural fallback once loaded; amb* beds power AmbienceDirector.
  roomTone: 'assets/audio/ambience/bed-hull-hum.mp3',
  ambHullHum: 'assets/audio/ambience/bed-hull-hum.mp3',
  ambCommons: 'assets/audio/ambience/bed-commons-murmur.mp3',
  ambLabHum: 'assets/audio/ambience/bed-lab-hum.mp3',
  ambHullGroan: 'assets/audio/ambience/bed-hull-groan.mp3',
  ambOfficeHvac: 'assets/audio/ambience/bed-office-hvac.mp3',
  ambMedBay: 'assets/audio/ambience/bed-med-bay.mp3',
  ambFlooded: 'assets/audio/ambience/bed-flooded-tunnel.mp3',
  ambValveRoom: 'assets/audio/ambience/bed-valve-room.mp3',
  ambHydroMisters: 'assets/audio/ambience/bed-hydro-misters.mp3',
  ambHydroVestibule: 'assets/audio/ambience/bed-hydro-vestibule.mp3',
  ambHydroSeedLab: 'assets/audio/ambience/bed-hydro-seed-lab.mp3',
  ambHydroPlantRoom: 'assets/audio/ambience/bed-hydro-plant-room.mp3',
  ambHydroStoreroom: 'assets/audio/ambience/bed-hydro-storeroom.mp3',
  ambDiveBay: 'assets/audio/ambience/bed-dive-bay.mp3',
  ventFan: 'assets/audio/ambience/emitter-vent-fan.mp3',
  fluorescentBuzz: 'assets/audio/ambience/emitter-fluorescent-buzz.mp3',
  waterRumble: 'assets/audio/ambience/emitter-water-rumble.mp3',
  consoleHum: 'assets/audio/ambience/emitter-console-hum.mp3',
  hydroTrickle: 'assets/audio/ambience/emitter-hydro-trickle.mp3',
  dehumidifierHum: 'assets/audio/ambience/emitter-dehumidifier-hum.mp3',
  fertigationPump: 'assets/audio/ambience/emitter-fertigation-pump.mp3',
  kettleSimmer: 'assets/audio/ambience/emitter-kettle-simmer.mp3',
  hullGroan: ['assets/audio/ambience/oneshot-hull-groan-1.mp3', 'assets/audio/ambience/oneshot-hull-groan-2.mp3'],
  metalKnock: ['assets/audio/ambience/oneshot-metal-knock-1.mp3', 'assets/audio/ambience/oneshot-metal-knock-2.mp3'],
  creak: ['assets/audio/ambience/oneshot-creak-1.mp3', 'assets/audio/ambience/oneshot-creak-2.mp3'],
  drip: ['assets/audio/ambience/oneshot-drip-1.mp3', 'assets/audio/ambience/oneshot-drip-2.mp3'],
  hydroDrip: ['assets/audio/ambience/oneshot-hydro-drip-1.mp3', 'assets/audio/ambience/oneshot-hydro-drip-2.mp3'],
  misterValve: ['assets/audio/ambience/oneshot-mister-valve-1.mp3', 'assets/audio/ambience/oneshot-mister-valve-2.mp3'],
  misterSpray: ['assets/audio/ambience/oneshot-mister-spray-1.mp3', 'assets/audio/ambience/oneshot-mister-spray-2.mp3'],
  misterSputter: 'assets/audio/ambience/oneshot-mister-sputter.mp3',
  humidityAlarm: 'assets/audio/ambience/oneshot-humidity-alarm.mp3',
  hydroLogSign: 'assets/audio/ambience/oneshot-hydro-log-sign.mp3',
  hydroAlarmReset: 'assets/audio/ambience/oneshot-hydro-alarm-reset.mp3',
  pressurePing: 'assets/audio/ambience/oneshot-pressure-ping.mp3',
  distantMoan: 'assets/audio/ambience/oneshot-distant-moan.mp3',
  medBeep: 'assets/audio/ambience/oneshot-med-beep.mp3',
  // overhaul-priya-r08-death D25/D31: the medbay intercom's switch and static; the vitals monitor's steady single beep.
  intercomClick: 'assets/audio/ambience/oneshot-intercom-click.mp3',
  intercomStatic: 'assets/audio/ambience/oneshot-intercom-static.mp3',
  monitorBeep: 'assets/audio/ambience/oneshot-monitor-beep.mp3',
} as const satisfies Record<string, string | readonly string[]>;
