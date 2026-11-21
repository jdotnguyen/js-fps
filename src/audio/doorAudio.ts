import type * as THREE from 'three';
import type { DoorKit } from '../data/types/level.ts';
import type { LoopHandle, VoiceOptions } from './engine.ts';
import type { SampleName, SoundName } from './sounds.ts';

/** Minimal audio interface required by `DoorAudio` (matches `AudioEngine`). */
export interface DoorAudioEngine {
  hasSound(name: SoundName): boolean;
  durationOf(name: SoundName): number;
  play(name: SoundName, opts?: VoiceOptions): LoopHandle;
}

export interface DoorMoveEvent {
  id: string;
  kit: DoorKit;
  dir: 'open' | 'close';
  /** Current normalized leaf opening (0 = closed, 1 = open) at the moment movement starts/reverses. */
  progress: number;
  position: THREE.Vector3;
}

interface DoorClipSpec {
  open: SampleName;
  close: SampleName;
  fallback: SoundName;
  gain: number;
  reverb: number;
}

const DOOR_CLIPS: Record<DoorKit, DoorClipSpec> = {
  pressure_slide: {
    open: 'doorPressureOpen',
    close: 'doorPressureClose',
    fallback: 'metalKnock',
    gain: 0.78,
    reverb: 0.3,
  },
  glass_slide: {
    open: 'doorGlassOpen',
    close: 'doorGlassClose',
    fallback: 'click',
    gain: 0.62,
    reverb: 0.25,
  },
  bulkhead: {
    open: 'doorBulkheadOpen',
    close: 'doorBulkheadClose',
    fallback: 'metalKnock',
    gain: 0.9,
    reverb: 0.4,
  },
};

const REVERSE_FADE = 0.12;
const DENIED_COOLDOWN_MS = 350;

/**
 * Spatialized door foley controller on top of `AudioEngine`.
 *
 * Plays kit-matched ElevenLabs open/close clips at each door's 3D center, smoothly
 * crossfades into a proportional start offset if a closing door reverses mid-travel,
 * and plays access-denied / unlock feedback with cooldown protection.
 */
export class DoorAudio {
  private readonly audio: DoorAudioEngine;
  private readonly active = new Map<string, LoopHandle>();
  private readonly lastDenied = new Map<string, number>();

  constructor(audio: DoorAudioEngine) {
    this.audio = audio;
  }

  onMove(e: DoorMoveEvent): void {
    const prev = this.active.get(e.id);
    if (prev) {
      prev.stop(REVERSE_FADE);
      this.active.delete(e.id);
    }

    const spec = DOOR_CLIPS[e.kit];
    const preferred = e.dir === 'open' ? spec.open : spec.close;
    const sound: SoundName = this.audio.hasSound(preferred) ? preferred : spec.fallback;
    if (!this.audio.hasSound(sound)) return;

    // When reversing mid-travel (e.g. player walks back into a closing doorway), start proportionally into the clip.
    const dur = this.audio.durationOf(sound);
    const frac = e.dir === 'open' ? e.progress : 1 - e.progress;
    const offset = dur > 0.2 && frac > 0.05 && frac < 0.95 ? frac * dur : 0;

    const handle = this.audio.play(sound, {
      bus: 'sfx',
      position: e.position,
      gain: spec.gain,
      reverb: spec.reverb,
      rate: 0.97 + Math.random() * 0.06,
      ...(offset > 0 ? { offset } : {}),
    });
    this.active.set(e.id, handle);
  }

  onDenied(id: string, position: THREE.Vector3 | null, nowMs = performance.now()): void {
    const prev = this.lastDenied.get(id) ?? -Infinity;
    if (nowMs - prev < DENIED_COOLDOWN_MS) return;
    this.lastDenied.set(id, nowMs);
    const sound: SoundName = this.audio.hasSound('doorDenied') ? 'doorDenied' : 'consoleBeep';
    if (!this.audio.hasSound(sound)) return;
    this.audio.play(sound, {
      bus: 'sfx',
      ...(position ? { position } : {}),
      gain: 0.72,
      reverb: 0.25,
      rate: 0.98 + Math.random() * 0.04,
    });
  }

  onUnlocked(_id: string, position: THREE.Vector3 | null): void {
    const sound: SoundName = this.audio.hasSound('doorUnlocked') ? 'doorUnlocked' : 'click';
    if (!this.audio.hasSound(sound)) return;
    this.audio.play(sound, {
      bus: 'sfx',
      ...(position ? { position } : {}),
      gain: 0.75,
      reverb: 0.3,
    });
  }

  /** Stop any in-flight door sounds (e.g. level reset or returning to title). */
  stopAll(fadeSeconds = 0.15): void {
    for (const handle of this.active.values()) handle.stop(fadeSeconds);
    this.active.clear();
  }
}
