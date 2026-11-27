/** The player's own sounds: the flashlight, hits landing, the low-health heartbeat and breathing. Part of the sound registry (./index.ts). */

import type { Rng } from '../../core/rng.ts';
import { Biquad, fadeEdges, makeBuf, normalize, TAU, white, type Buf } from '../dsp.ts';
import { type SoundSpec } from '../synth.ts';

/** Flashlight switch: two clicks. */
export function click(sr: number, rng: Rng): Buf {
  const b = makeBuf(sr, 0.06);
  const noise = white(rng);
  const hp = new Biquad('highpass', 2000, 0.7, sr);
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    let s = 0;
    for (const [at, g] of [[0, 1], [0.022, 0.6]] as const) {
      const dt = t - at;
      if (dt >= 0) s += g * (Math.exp(-dt / 0.0012) * 1.0 + Math.sin(TAU * 3200 * dt) * Math.exp(-dt / 0.004) * 0.4);
    }
    b[i] = hp.process(noise()) * s * 0.7 + s * 0.1;
  }
  return fadeEdges(normalize(b, 0.6), sr, 0, 0.005);
}

export const specs = {
  click: { make: click, loop: false, variants: 1 },
} as const satisfies Record<string, SoundSpec>;

export const samples = {
  // A hit landing on the player, and his labouring heart at low health (ElevenLabs, scripts/gore-generate.ts).
  hitClaw: [1, 2, 3, 4].map((i) => `assets/audio/gore/hit-claw-${i}.mp3`),
  hitBite: [1, 2, 3].map((i) => `assets/audio/gore/hit-bite-${i}.mp3`),
  hitSlam: [1, 2, 3].map((i) => `assets/audio/gore/hit-slam-${i}.mp3`),
  lowHeartbeat: 'assets/audio/gore/low-heartbeat.mp3',
  // Jay's heavy breathing at low health (Gemini TTS, scripts/vo-reactions.ts --only react_jay_breath).
  jayBreath: ['assets/vo/react_jay_breath_01.mp3', 'assets/vo/react_jay_breath_02.mp3', 'assets/vo/react_jay_breath_03.mp3'],
} as const satisfies Record<string, string | readonly string[]>;
