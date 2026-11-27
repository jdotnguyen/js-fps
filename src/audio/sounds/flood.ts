/** Standing water, the flooded tunnel and pump room, and the valve cutscene. Part of the sound registry (./index.ts). */

import type { Rng } from '../../core/rng.ts';
import { Biquad, fadeEdges, makeBuf, normalize, type Buf } from '../dsp.ts';
import { type SoundSpec } from '../synth.ts';

/** Lockdown klaxon (heard muffled through the door). */
export function klaxon(sr: number, rng: Rng): Buf {
  const b = makeBuf(sr, 2.4);
  const lp = new Biquad('lowpass', 2200, 0.7, sr);
  const lo = rng.range(280, 320);
  let phase = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    let env = 0;
    let f = lo;
    for (const start of [0, 1.15]) {
      const tw = t - start;
      if (tw >= 0 && tw < 1) {
        env = Math.min(1, tw / 0.05) * Math.min(1, (1 - tw) / 0.2);
        f = lo + 240 * Math.pow(tw, 0.7);
      }
    }
    phase += f / sr;
    b[i] = lp.process(Math.tanh(1.5 * (2 * (phase % 1) - 1))) * env;
  }
  return fadeEdges(normalize(b, 0.7), sr, 0, 0.05);
}

export const specs = {
  klaxon: { make: klaxon, loop: false, variants: 1 },
} as const satisfies Record<string, SoundSpec>;

export const samples = {
  // Splashes (standing-water spec; CC0, rubberduck on OpenGameArt, see CREDITS.md).
  waterSplashStep: [1, 2, 3].map((i) => `assets/audio/water/splash-step-${i}.mp3`),
  waterSplashBullet: [1, 2, 3].map((i) => `assets/audio/water/splash-bullet-${i}.mp3`),
  waterSplashLand: [1, 2, 3].map((i) => `assets/audio/water/splash-land-${i}.mp3`),
  waterSplashTakeoff: [1, 2].map((i) => `assets/audio/water/splash-takeoff-${i}.mp3`),
  waterSplashBody: [1, 2].map((i) => `assets/audio/water/splash-body-${i}.mp3`),
  // Heavy charging-creature water splashes (rig-necromorph design D6c; ElevenLabs, scripts/ambience-generate.ts).
  waterSplashStomp: [1, 2, 3].map((i) => `assets/audio/ambience/oneshot-water-stomp-${i}.mp3`),
  waterSplashKick: [1, 2].map((i) => `assets/audio/ambience/oneshot-water-kick-${i}.mp3`),
  // The flooded tunnel and pump room (overhaul-flooded-tunnel; ElevenLabs, scripts/ambience-generate.ts).
  waterSlosh: 'assets/audio/ambience/emitter-water-slosh.mp3',
  pipePour: 'assets/audio/ambience/emitter-pipe-pour.mp3',
  waterLap: 'assets/audio/ambience/emitter-water-lap.mp3',
  pumpRoom: 'assets/audio/ambience/emitter-pump-room.mp3',
  klaxon: 'assets/audio/ambience/emitter-klaxon.mp3',
  sparkHiss: [1, 2].map((i) => `assets/audio/ambience/oneshot-spark-hiss-${i}.mp3`),
  tubeStrike: 'assets/audio/ambience/oneshot-tube-strike.mp3',
  floodDoorSlam: 'assets/audio/ambience/oneshot-flood-door-slam.mp3',
  bodyDrip: 'assets/audio/ambience/oneshot-body-drip.mp3',
  // The flood cutscene: the alarm with the beacon, and the sting as the shambler charges the door.
  valveTurn: 'assets/audio/ambience/oneshot-valve-turn.mp3',
  creatureCharge: 'assets/audio/ambience/oneshot-creature-charge.mp3',
  // The elite's sustained raging roar while charging down the flooded R09 hall (ElevenLabs, scripts/ambience-generate.ts).
  creatureChargeRage: 'assets/audio/ambience/oneshot-creature-charge-rage.mp3',
  // The elite's scream from far down the R09 hall as the flood cutscene opens (overhaul-valve-cutscene; downloaded, see CREDITS.md).
  creatureScreamFar: 'assets/audio/ambience/oneshot-creature-scream-far.mp3',
  creatureSeverShriek: 'assets/audio/ambience/oneshot-creature-sever-shriek.mp3',
  ambushSting: 'assets/audio/ambience/oneshot-ambush-sting.mp3',
  doorPound: 'assets/audio/ambience/oneshot-door-pound.mp3',
  alarmBlast: 'assets/audio/ambience/oneshot-alarm-blast.mp3',
  // One hit on the valve cutscene's slam (impact at 0.9 s, the door's slide), and the elite prying the door at R11.
  floodSlamHit: 'assets/audio/ambience/oneshot-flood-slam-hit.mp3',
  doorPry: 'assets/audio/ambience/oneshot-door-pry.mp3',
} as const satisfies Record<string, string | readonly string[]>;
