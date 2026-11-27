/** Weapons and spent casings, with the procedural gunfire fallbacks. Part of the sound registry (./index.ts). */

import type { Rng } from '../../core/rng.ts';
import { Biquad, brown, fadeEdges, makeBuf, normalize, TAU, white, type Buf } from '../dsp.ts';
import { ResonatorBank, type SoundSpec } from '../synth.ts';

// ------------------------------------------------------------------ weapons

/** Adds lowpassed, decaying echoes of the whole buffer: the "slap" off nearby walls that makes a shot feel big. */
function slapback(buf: Buf, sr: number, taps: ReadonlyArray<readonly [delay: number, gain: number]>, cutoff: number): Buf {
  const out = makeBuf(sr, buf.length / sr);
  out.set(buf);
  for (const [delay, gain] of taps) {
    const lp = new Biquad('lowpass', cutoff, 0.7, sr);
    const off = Math.round(delay * sr);
    for (let i = 0; i + off < out.length; i++) out[i + off] = out[i + off]! + lp.process(buf[i]!) * gain;
  }
  return out;
}

/** Simple feed-forward compressor: pulls the loud transient down so the tail comes up with it. */
function squash(buf: Buf, sr: number, amount: number, releaseS: number): Buf {
  const out = makeBuf(sr, buf.length / sr);
  const rel = Math.exp(-1 / (releaseS * sr));
  let env = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i]!;
    env = Math.max(Math.abs(x), env * rel);
    out[i] = x / (1 + amount * env);
  }
  return out;
}

/**
 * Security pistol (9 mm). Layered like a produced game weapon: a mechanical click, a bright
 * snap, a mid-range "pop", a tight low punch, a darkening air tail, slapback echoes off the
 * walls, then a brass casing tinkling on the floor.
 */
export function pistolShot(sr: number, rng: Rng): Buf {
  const dur = 1.0;
  const shot = makeBuf(sr, dur);
  const clickN = white(rng.fork('click'));
  const snapN = white(rng.fork('snap'));
  const popN = white(rng.fork('pop'));
  const airN = white(rng.fork('air'));
  const slideN = white(rng.fork('slide'));
  const clickHp = new Biquad('highpass', 4000, 0.7, sr);
  const snapHp = new Biquad('highpass', rng.range(1800, 2400), 0.7, sr);
  const snapBp = new Biquad('bandpass', rng.range(4200, 5600), 1.2, sr);
  const popBp = new Biquad('bandpass', rng.range(750, 1050), 1.3, sr);
  const airLp = new Biquad('lowpass', 6000, 0.7, sr);
  const slide = new ResonatorBank(sr, rng.fork('slide-modes'), 8, 900, 5200, 8, 18);
  const slideAt = rng.range(0.05, 0.065);
  const popTone = rng.range(340, 420);
  const f0 = rng.range(200, 240);
  let phase = 0;
  for (let i = 0; i < shot.length; i++) {
    const t = i / sr;
    if (i % 32 === 0) airLp.set(Math.max(500, 6000 * Math.exp(-t / 0.09)), 0.7);
    const click = clickHp.process(clickN()) * Math.exp(-t / 0.0012) * 2.2;
    const snap = (snapHp.process(snapN()) * Math.exp(-t / 0.0045) + snapBp.process(snapN()) * Math.exp(-t / 0.014) * 0.6) * 1.5;
    const pop = popBp.process(popN()) * Math.exp(-t / 0.028) * 2.0 + Math.sin(TAU * popTone * t) * Math.exp(-t / 0.02) * 0.5;
    phase += (f0 * (0.3 + 0.7 * Math.exp(-t / 0.025))) / sr;
    const punch = Math.sin(TAU * phase) * Math.exp(-t / 0.055) * 1.1;
    const air = airLp.process(airN()) * Math.exp(-t / 0.2) * 0.55;
    const ts = t - slideAt;
    const rack = ts > 0 ? slide.process(slideN() * Math.exp(-ts / 0.003)) * 0.09 : 0;
    shot[i] = Math.tanh(1.8 * (click + snap + pop + punch + air) * Math.min(1, t / 0.0003)) + rack;
  }
  const withSlap = slapback(shot, sr, [[0.038, 0.32], [0.092, 0.2], [0.17, 0.11], [0.29, 0.06]], 2600);
  // Brass casing bouncing on the floor, a little after the shot.
  const tink = rng.range(0.3, 0.42);
  for (const [at, g, f] of [[tink, 1, rng.range(4300, 5000)], [tink + 0.07, 0.5, rng.range(4300, 5000)], [tink + 0.115, 0.22, rng.range(4300, 5000)]] as const) {
    for (let i = Math.round(at * sr); i < withSlap.length; i++) {
      const dt = i / sr - at;
      if (dt > 0.12) break;
      withSlap[i] = withSlap[i]! + (Math.sin(TAU * f * dt) + 0.4 * Math.sin(TAU * f * 2.7 * dt)) * Math.exp(-dt / 0.02) * g * 0.05;
    }
  }
  return fadeEdges(normalize(squash(withSlap, sr, 1.5, 0.12), 0.93), sr, 0, 0.1);
}

/**
 * 12-gauge shotgun. Built for weight: a crushing, saturated sub boom, a gritty metallic
 * crunch from resonating steel, a hard noise blast, a long rumbling tail that darkens, and
 * big slapback echoes. Compressed so the tail swells up under the blast.
 */
export function shotgunShot(sr: number, rng: Rng): Buf {
  const dur = 2.2;
  const shot = makeBuf(sr, dur);
  const clickN = white(rng.fork('click'));
  const crackN = white(rng.fork('crack'));
  const blastN = white(rng.fork('blast'));
  const ringN = white(rng.fork('ring'));
  const rumbleN = brown(rng.fork('rumble'));
  const airN = white(rng.fork('air'));
  const tickN = white(rng.fork('tick'));
  const clickHp = new Biquad('highpass', 3000, 0.7, sr);
  const crackHp = new Biquad('highpass', rng.range(1400, 1900), 0.7, sr);
  const blastLp = new Biquad('lowpass', 3000, 0.7, sr);
  const blastLp2 = new Biquad('lowpass', 800, 0.8, sr);
  const ring = new ResonatorBank(sr, rng.fork('ring-modes'), 14, 180, 3200, 7, 18);
  const rumbleLp = new Biquad('lowpass', 170, 0.7, sr);
  const airLp = new Biquad('lowpass', 4500, 0.7, sr);
  const tickHp = new Biquad('highpass', 3500, 0.7, sr);
  const tickRng = rng.fork('tick-timing');
  const fEnd = rng.range(34, 42);
  let phase = 0;
  let tick = 0;
  for (let i = 0; i < shot.length; i++) {
    const t = i / sr;
    if (i % 32 === 0) {
      blastLp.set(Math.max(400, 3000 * Math.exp(-t / 0.06)), 0.7);
      airLp.set(Math.max(300, 4500 * Math.exp(-t / 0.25)), 0.7);
    }
    const click = clickHp.process(clickN()) * Math.exp(-t / 0.0015) * 2;
    const crack = crackHp.process(crackN()) * Math.exp(-t / 0.011) * 1.3;
    const blast = blastLp.process(blastN()) * Math.exp(-t / 0.055) * 2.2 + blastLp2.process(blastN()) * Math.exp(-t / 0.16) * 1.4;
    const crunch = ring.process(ringN() * Math.exp(-t / 0.006)) * 0.75;
    phase += (fEnd + 95 * Math.exp(-t / 0.05)) / sr;
    // Overdriven so the boom has harmonics and still reads on laptop speakers.
    const boom = Math.tanh(2.6 * Math.sin(TAU * phase)) * Math.exp(-t / 0.2) * 1.4;
    const rumble = rumbleLp.process(rumbleN()) * Math.exp(-t / 0.55) * 5;
    const air = airLp.process(airN()) * Math.exp(-t / 0.5) * 0.5;
    if (t > 0.05 && t < 0.6 && tickRng.next() < 0.003) tick = 1;
    tick *= 0.985;
    const pellets = tickHp.process(tickN()) * tick * Math.exp(-t / 0.3) * 0.3;
    shot[i] = Math.tanh(1.9 * (click + crack + blast + crunch + boom + rumble + air) * Math.min(1, t / 0.0005)) + pellets;
  }
  const withSlap = slapback(shot, sr, [[0.065, 0.42], [0.15, 0.3], [0.28, 0.2], [0.46, 0.12], [0.7, 0.06]], 1800);
  return fadeEdges(normalize(squash(withSlap, sr, 2.2, 0.25), 0.95), sr, 0, 0.2);
}

/** Pump action: rack back, then forward, each a metallic clack plus a rattle of the slide. */
export function shotgunPump(sr: number, rng: Rng): Buf {
  const dur = 0.55;
  const b = makeBuf(sr, dur);
  const noise = white(rng.fork('noise'));
  const bank = new ResonatorBank(sr, rng.fork('modes'), 10, 500, 4500, 10, 22);
  const thudLp = new Biquad('lowpass', 180, 0.8, sr);
  const hp = new Biquad('highpass', 1200, 0.7, sr);
  const back = 0;
  const fwd = rng.range(0.19, 0.24);
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    const n = noise();
    let excite = 0;
    let weight = 0;
    for (const [at, g] of [[back, 0.85], [fwd, 1]] as const) {
      const dt = t - at;
      if (dt < 0) continue;
      excite += g * Math.exp(-dt / 0.004) * Math.min(1, dt / 0.0004);
      weight += g * Math.exp(-dt / 0.03);
    }
    // Slide friction between the two clacks.
    const slideEnv = t > 0.01 && t < fwd ? Math.sin((Math.PI * (t - 0.01)) / (fwd - 0.01)) : 0;
    const slide = hp.process(n) * slideEnv * 0.05;
    b[i] = bank.process(hp.process(n * excite)) * 1.6 + thudLp.process(n * weight) * 2 + slide;
  }
  return fadeEdges(normalize(b, 0.8), sr, 0.0005, 0.06);
}

/** `casing-<bank>-1.mp3` .. `-<count>.mp3` under assets/audio/weapons/casings/ (scripts/casings-generate.ts names them). */
function casingFiles(bank: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `assets/audio/weapons/casings/casing-${bank}-${i + 1}.mp3`);
}

export const specs = {
  pistolShot: { make: pistolShot, loop: false, variants: 4 },
  shotgunShot: { make: shotgunShot, loop: false, variants: 4 },
  shotgunPump: { make: shotgunPump, loop: false, variants: 2 },
} as const satisfies Record<string, SoundSpec>;

export const samples = {
  pistolShot: 'assets/audio/weapons/pistol-shot.mp3',
  pistolReloadOut: 'assets/audio/weapons/pistol-reload-out.mp3',
  pistolReloadIn: 'assets/audio/weapons/pistol-reload-in.mp3',
  pistolReloadSlide: 'assets/audio/weapons/pistol-cock-fit.mp3', // pull back + slide home, at the end of a reload and a draw (scripts/fit-weapon-audio.mjs)
  shotgunShot: 'assets/audio/weapons/shotgun-shot.mp3',
  shotgunPump: 'assets/audio/weapons/shotgun-pump-fit.mp3', // stretched x1.1 to match the old PostFire clip (scripts/fit-weapon-audio.mjs); the new Shoot racks quicker, see swap-viewmodels-to-just-models
  shotgunShell: 'assets/audio/weapons/shotgun-shell.mp3',
  dryFire: 'assets/audio/weapons/dry-fire.mp3',
  // Giles's and Okafor's covering fire (squad-sidearms D5): "pistol shot" by mrfriends (Pixabay Content License, see CREDITS.md),
  // trimmed and level-matched. Recorded only, played positionally from the mate's muzzle, its pitch varied per shot.
  squadPistolShot: 'assets/audio/weapons/squad-pistol-shot.mp3',
  // Spent casings landing (in-world-audio spec: Spent casings; src/audio/casings.ts). Built by scripts/casings-generate.ts:
  // CC0 cuts (GrayJoy, GryffDavid, BlondPanda, MrGungus, lumikon, magnuswaker, Metrolynn; see CREDITS.md) for brass on
  // concrete and soft floors and hulls on concrete, ElevenLabs for the rest. Every clip peaks at -6 dB; play gain sets the surface.
  casingBrassConcrete: casingFiles('brass-concrete', 10),
  casingBrassMetal: casingFiles('brass-metal', 5),
  casingBrassGrate: casingFiles('brass-grate', 4),
  casingBrassSoft: casingFiles('brass-soft', 7),
  casingHullConcrete: casingFiles('hull-concrete', 4),
  casingHullMetal: casingFiles('hull-metal', 4),
  casingHullGrate: casingFiles('hull-grate', 4),
  casingHullSoft: casingFiles('hull-soft', 4),
  casingWater: casingFiles('water', 5),
} as const satisfies Record<string, string | readonly string[]>;
