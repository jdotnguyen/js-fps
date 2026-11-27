/** Menu sounds. Part of the sound registry (./index.ts). */

import type { Rng } from '../../core/rng.ts';
import { Biquad, fadeEdges, makeBuf, normalize, TAU, white, type Buf } from '../dsp.ts';
import { type SoundSpec } from '../synth.ts';

/** Menu hover: a low, dissonant descending groan with a breath of rasp, something stirring in the dark. */
export function uiHover(sr: number, rng: Rng): Buf {
  const b = makeBuf(sr, 0.24);
  const f0 = rng.range(150, 175);
  const noise = white(rng);
  const bp = new Biquad('bandpass', 420, 2.5, sr);
  const lp = new Biquad('lowpass', 1100, 0.8, sr);
  let p1 = 0;
  let p2 = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    const glide = 1 - 0.22 * Math.min(1, t / 0.2);
    // A minor-second pair beats against itself, which reads as wrong rather than pleasant.
    p1 += (TAU * f0 * glide) / sr;
    p2 += (TAU * f0 * 1.0595 * glide) / sr;
    const env = Math.min(1, t / 0.02) * Math.exp(-t / 0.09);
    const tone = Math.tanh(3 * (Math.sin(p1) + Math.sin(p2)) * 0.6);
    const rasp = bp.process(noise()) * Math.min(1, t / 0.03) * Math.exp(-t / 0.07) * 0.9;
    b[i] = lp.process(tone + rasp) * env;
  }
  return fadeEdges(normalize(b, 0.6), sr, 0.003, 0.05);
}

/** Menu select: a heavy, detuned downward lurch with a metallic scrape and a tritone sting, dread, not a chime. */
export function uiSelect(sr: number, rng: Rng): Buf {
  const b = makeBuf(sr, 0.7);
  const noise = white(rng);
  const lpThud = new Biquad('lowpass', 1500, 0.7, sr);
  const lpTone = new Biquad('lowpass', 1400, 0.8, sr);
  const scrapeBp = new Biquad('bandpass', 1900, 3, sr);
  let pa = 0;
  let pb = 0;
  let pc = 0;
  let drop = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    // Falling groan: root and a detuned tritone, both sliding down.
    const slide = Math.exp(-t / 0.35);
    const root = 200 * (0.55 + 0.45 * slide);
    pa += (TAU * root) / sr;
    pb += (TAU * root * 1.4142) / sr;
    pc += (TAU * root * 1.0595 * 0.5) / sr;
    const env = Math.min(1, t / 0.006) * Math.exp(-t / 0.2);
    const groan = Math.tanh(3.5 * (Math.sin(pa) + 0.7 * Math.sin(pb) + 0.8 * Math.sin(pc))) * env;
    // Ring-modulated metal scrape, like a bulkhead dragging.
    const scrape = scrapeBp.process(noise()) * (0.5 + 0.5 * Math.sin(TAU * 37 * t)) * Math.exp(-t / 0.12) * 0.9;
    drop += (TAU * (60 + 150 * Math.exp(-t / 0.06))) / sr;
    const sub = Math.sin(drop) * Math.min(1, t / 0.004) * Math.exp(-t / 0.2) * 1.3;
    const thud = lpThud.process(noise()) * Math.exp(-t / 0.008) * 0.7;
    b[i] = lpTone.process(groan) * 0.8 + scrape + sub + thud;
  }
  return fadeEdges(normalize(b, 0.7), sr, 0.0005, 0.1);
}

export const specs = {
  uiHover: { make: uiHover, loop: false, variants: 3 },
  uiSelect: { make: uiSelect, loop: false, variants: 2 },
} as const satisfies Record<string, SoundSpec>;

export const samples = {
  // Menu UI one-shots (trimmed from Universfield "interface click" and Dragon Studio "menu open").
  // uiHover / uiSelect replace the procedural versions once loaded; uiMenuOpen has no procedural fallback.
  uiHover: 'assets/audio/ui/ui-hover.mp3',
  uiSelect: 'assets/audio/ui/ui-click.mp3',
  uiMenuOpen: 'assets/audio/ui/ui-menu-open.mp3',
} as const satisfies Record<string, string | readonly string[]>;
