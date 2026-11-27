/**
 * What Jay hears of his own hurt (player-hit-feedback D7): the blow of each hit, at the listener, and at low health
 * a heartbeat with his heavy breathing under the mix. His voice reaction to a hit is `dialogue/barks.ts`.
 */
import type { HitKind } from '../actors/hit.ts';
import type { LoopHandle, VoiceOptions } from './engine.ts';
import type { SampleName } from './sounds.ts';

export interface HurtAudio {
  hasSample(name: SampleName): boolean;
  play(name: SampleName, opts?: VoiceOptions): unknown;
  loop(name: SampleName, opts?: VoiceOptions): LoopHandle;
}

/** The blow each kind of hit lands. A grab's ticks make none; a hit nobody named is a quieter thud. */
export const IMPACTS: Partial<Record<HitKind, { name: SampleName; gain: number }>> = {
  swipe: { name: 'hitClaw', gain: 1 },
  bite: { name: 'hitBite', gain: 1 },
  slam: { name: 'hitSlam', gain: 1 },
  generic: { name: 'hitSlam', gain: 0.55 },
};

/** The low-health bed: kept well under dialogue. Fades are time constants, seconds. */
export const LOW_BED = {
  heart: { name: 'lowHeartbeat', bus: 'sfx', gain: 0.55 },
  breath: { name: 'jayBreath', bus: 'voice', gain: 0.22 },
  fadeIn: 0.5,
  fadeOut: 1.2,
} as const;

export class PlayerHurtAudio {
  private readonly audio: HurtAudio;
  private readonly random: () => number;
  private readonly playing: Partial<Record<'heart' | 'breath', LoopHandle>> = {};

  constructor(audio: HurtAudio, random: () => number = Math.random) {
    this.audio = audio;
    this.random = random;
  }

  /** A hit landed: its impact, now, a little different every time. */
  hit(kind: HitKind, severity: number): void {
    const impact = IMPACTS[kind];
    if (!impact || !this.audio.hasSample(impact.name)) return;
    const gain = impact.gain * (0.75 + 0.25 * severity) * (0.92 + 0.16 * this.random());
    this.audio.play(impact.name, { bus: 'sfx', gain, rate: 0.94 + 0.12 * this.random() });
  }

  /** Every frame: the bed plays while `low` (alive and under the low-health line) and fades out otherwise. */
  update(low: boolean): void {
    for (const part of ['heart', 'breath'] as const) {
      const spec = LOW_BED[part];
      const loop = this.playing[part];
      if (low && !loop) {
        if (!this.audio.hasSample(spec.name)) continue;
        const started = this.audio.loop(spec.name, { bus: spec.bus, gain: 0 });
        started.setGain(spec.gain, LOW_BED.fadeIn);
        this.playing[part] = started;
      } else if (!low && loop) {
        loop.stop(LOW_BED.fadeOut);
        delete this.playing[part];
      }
    }
  }

  /** The session ends. */
  dispose(): void {
    for (const loop of Object.values(this.playing)) loop.stop();
    delete this.playing.heart;
    delete this.playing.breath;
  }
}
