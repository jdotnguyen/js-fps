import type * as THREE from 'three';
import { hashString, Rng } from '../core/rng.ts';
import type { GameMode } from '../game/game.ts';
import type { AmbienceAudio } from './ambience.ts';
import type { LoopHandle } from './engine.ts';
import type { SampleName } from './sounds.ts';

/**
 * Conversation murmur (in-world-audio spec): each talking group gives a soft, wordless loop from where it is, so a room
 * of people sounds like one. It is on the `ambience` bus, travels through rooms and doors as voices do (level only:
 * a playing loop cannot change its filter), and drops back while a pair says a written exchange.
 *
 * Pure bookkeeping over the same small audio surface as the ambience director, so it runs in node tests.
 */

/** The recordings groups are shared out between. */
export const MURMUR_SOUNDS: readonly SampleName[] = ['murmurA', 'murmurB', 'murmurC'];

export const MURMUR_TUNING = {
  /** Level of one group's loop, before distance. */
  gain: 0.2,
  /** Other groups' share of that level while an exchange is being said. */
  makeWay: 0.45,
  /** Gain time constant (s): about a second to fade in or settle. */
  fade: 0.35,
  /** Fade-out (s) when a group breaks up. */
  fadeOut: 1,
  /** Each group's playback rate, so two sharing a recording do not sound alike. */
  rate: [0.93, 1.07] as const,
  /** One fixed low-pass: murmur is never crisp enough to pick words from. */
  cutoff: 2600,
} as const;

const MODE_SCALE: Record<GameMode, number> = { title: 0, paused: 0.35, playing: 1 };

export interface MurmurSource {
  /** The chat group. */
  readonly id: string;
  readonly position: THREE.Vector3;
}

interface Voice {
  handle: LoopHandle;
  sound: SampleName;
  /** Room propagation gain at the last update. */
  heard: number;
  /** 0 while this group speaks written lines, less than 1 while another does. */
  share: number;
}

export class ConversationMurmur {
  private readonly audio: AmbienceAudio;
  /** How much of a voice at this point reaches the player through the station, 0..1 (voice propagation). */
  private readonly hearing: (position: THREE.Vector3) => number;
  private readonly voices = new Map<string, Voice>();
  private mode: GameMode = 'title';

  constructor(audio: AmbienceAudio, hearing: (position: THREE.Vector3) => number) {
    this.audio = audio;
    this.hearing = hearing;
  }

  setMode(mode: GameMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'title') this.reset();
    else for (const v of this.voices.values()) this.apply(v);
  }

  /**
   * The conversations going on now. `speaking` is the group saying an exchange; `over` ends all murmur (the drop has
   * started).
   */
  update(sources: readonly MurmurSource[], speaking: string | null, over: boolean): void {
    const live = over || this.mode === 'title' ? [] : sources;
    for (const [id, v] of [...this.voices]) {
      if (live.some((s) => s.id === id)) continue;
      v.handle.stop(MURMUR_TUNING.fadeOut);
      this.voices.delete(id);
    }
    for (const s of live) {
      let v = this.voices.get(s.id);
      if (!v) {
        const started = this.start(s);
        if (!started) continue;
        v = started;
        this.voices.set(s.id, v);
      }
      v.handle.setPosition?.(s.position.x, s.position.y, s.position.z);
      v.heard = this.hearing(s.position);
      v.share = speaking === null ? 1 : speaking === s.id ? 0 : MURMUR_TUNING.makeWay;
      this.apply(v);
    }
  }

  /** Stop every loop (level reset, quit to title). */
  reset(): void {
    for (const v of this.voices.values()) v.handle.stop(0.2);
    this.voices.clear();
  }

  dispose(): void {
    for (const v of this.voices.values()) v.handle.stop(0);
    this.voices.clear();
  }

  /** Null while no recording is decoded. */
  private start(s: MurmurSource): Voice | null {
    const ready = MURMUR_SOUNDS.filter((n) => this.audio.hasSample(n) && this.audio.hasSound(n));
    if (ready.length === 0) return null;
    // The recording the fewest groups are using now.
    const used = (n: SampleName): number => [...this.voices.values()].filter((v) => v.sound === n).length;
    const sound = ready.reduce((best, n) => (used(n) < used(best) ? n : best));
    const rate = new Rng(hashString(s.id)).range(...MURMUR_TUNING.rate);
    const handle = this.audio.loop(sound, { bus: 'ambience', gain: 0, position: s.position.clone(), rate, cutoff: MURMUR_TUNING.cutoff, reverb: 0.2 });
    return { handle, sound, heard: 0, share: 1 };
  }

  private apply(v: Voice): void {
    v.handle.setGain(MURMUR_TUNING.gain * v.heard * v.share * MODE_SCALE[this.mode], MURMUR_TUNING.fade);
  }
}
