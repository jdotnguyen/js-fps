/**
 * Zombie vocalisations: the three recorded clips in public/assets/audio/zombies/ (sample `zombieVoice`).
 * They take turns, so back-to-back groans never repeat the same clip, and each groan plays a short
 * slice of its clip from where the infected stands.
 *
 * Two triggers: an infected noticing someone (`alerted`) and an idle groan every few seconds from one
 * of the infected near the listener (`update`). Pure logic; the caller supplies the `play` function,
 * which keeps this testable without Web Audio.
 */

/** Seconds of audio in each `zombieVoice` clip, in SAMPLE_URLS order. */
export const ZOMBIE_CLIP_SECONDS = [8.1, 8.1, 3.9] as const;

export interface ZombieVoiceCall {
  /** Index into the `zombieVoice` clips. */
  variant: number;
  x: number;
  y: number;
  z: number;
  gain: number;
  rate: number;
  /** Where in the clip the slice starts, and how long it plays (seconds, at rate 1). */
  offset: number;
  duration: number;
}

/** What a groan needs to know about an infected; an `Enemy` fits as is. */
export interface VoiceSource {
  readonly hero: boolean;
  readonly state: string;
  readonly motor: { readonly x: number; readonly y: number; readonly z: number };
}

export interface ZombieVoiceOptions {
  play: (call: ZombieVoiceCall) => void;
  rng?: () => number;
  clipSeconds?: readonly number[];
  /** Furthest an infected can be from the listener and still groan on its own (m). */
  idleRange?: number;
  /** Idle groans come this many seconds apart (min, max). */
  idleEvery?: readonly [number, number];
  /** Fewest seconds between any two voices. */
  minGap?: number;
  /** Most voices sounding at once. */
  maxVoices?: number;
}

/** States that must stay silent: the ambush, the getting-up and the dead. */
const SILENT = new Set(['dead', 'playDead', 'waking']);

export class ZombieVoices {
  private readonly play: (call: ZombieVoiceCall) => void;
  private readonly rng: () => number;
  private readonly clips: readonly number[];
  private readonly idleRange: number;
  private readonly idleEvery: readonly [number, number];
  private readonly minGap: number;
  private readonly maxVoices: number;
  private clock = 0;
  private lastAt = -Infinity;
  private nextIdleAt: number;
  private nextClip = 0;
  private readonly endings: number[] = [];

  constructor(o: ZombieVoiceOptions) {
    this.play = o.play;
    this.rng = o.rng ?? Math.random;
    this.clips = o.clipSeconds ?? ZOMBIE_CLIP_SECONDS;
    this.idleRange = o.idleRange ?? 24;
    this.idleEvery = o.idleEvery ?? [5, 11];
    this.minGap = o.minGap ?? 1.1;
    this.maxVoices = o.maxVoices ?? 3;
    this.nextIdleAt = this.rollIdle();
  }

  private rollIdle(): number {
    const [lo, hi] = this.idleEvery;
    return this.clock + lo + this.rng() * (hi - lo);
  }

  private busy(): boolean {
    for (let i = this.endings.length - 1; i >= 0; i--) if (this.endings[i]! <= this.clock) this.endings.splice(i, 1);
    return this.endings.length >= this.maxVoices || this.clock - this.lastAt < this.minGap;
  }

  /** Start the next clip in turn, as a slice from `at`. False if too many voices are already going. */
  private speak(at: { x: number; y: number; z: number }, hero: boolean, loud: number): boolean {
    if (this.busy()) return false;
    const variant = this.nextClip % this.clips.length;
    this.nextClip++;
    const clip = this.clips[variant]!;
    const duration = Math.min(clip, 2.2 + this.rng() * 1.6);
    const offset = this.rng() * Math.max(0, clip - duration);
    // Heroes are big: deeper and slower. Commons vary a little so repeats do not match.
    const rate = hero ? 0.72 + this.rng() * 0.06 : 0.92 + this.rng() * 0.18;
    this.play({ variant, x: at.x, y: at.y, z: at.z, gain: loud, rate, offset, duration });
    this.lastAt = this.clock;
    this.endings.push(this.clock + duration / rate);
    return true;
  }

  /** An infected noticed someone: it calls out from where it stands. */
  alerted(at: { x: number; y: number; z: number }, hero: boolean): void {
    this.speak(at, hero, 0.9);
  }

  /** Advance by `dt` seconds; every so often, one of the infected near `listener` groans. */
  update(dt: number, enemies: Iterable<VoiceSource>, listener: { x: number; y: number; z: number }): void {
    this.clock += dt;
    if (this.clock < this.nextIdleAt) return;
    const near: Array<{ e: VoiceSource; d: number }> = [];
    for (const e of enemies) {
      if (SILENT.has(e.state)) continue;
      const d = Math.hypot(e.motor.x - listener.x, e.motor.y - listener.y, e.motor.z - listener.z);
      if (d <= this.idleRange) near.push({ e, d });
    }
    if (near.length === 0) {
      this.nextIdleAt = this.clock + 2;
      return;
    }
    near.sort((a, b) => a.d - b.d);
    // One of the three closest, so the nearest one does not do all the talking.
    const pick = near[Math.floor(this.rng() * Math.min(3, near.length))]!.e;
    if (this.speak({ x: pick.motor.x, y: pick.motor.y + 1.5, z: pick.motor.z }, pick.hero, 0.7)) this.nextIdleAt = this.rollIdle();
    else this.nextIdleAt = this.clock + 0.5;
  }
}
