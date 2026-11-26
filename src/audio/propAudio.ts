import * as THREE from 'three';
import type { GameMode } from '../game/game.ts';
import type { AmbienceAudio } from './ambience.ts';
import type { LoopHandle, VoiceOptions } from './engine.ts';
import type { SampleName } from './sounds.ts';

export interface WorldSoundLoop {
  readonly room: string;
  readonly sound: SampleName;
  readonly position: THREE.Vector3;
  readonly gain: number;
  readonly maxDist: number;
  readonly rate?: number;
  readonly cutoff?: number;
  readonly reverb?: number;
  readonly bus: 'ambience' | 'sfx';
  readonly active?: () => boolean;
}

export interface WorldSfxEvent {
  readonly sound: SampleName;
  readonly position: THREE.Vector3;
  readonly gain?: number;
  readonly rate?: number;
  readonly reverb?: number;
  readonly bus?: 'sfx' | 'ambience';
  readonly maxDist?: number;
}

/** Level and fade per game mode. A pause holds the whole scene engine (game-pause), so it keeps the playing level. */
const MODE_SCALE: Record<GameMode, { scale: number; tc: number }> = {
  title: { scale: 0, tc: 0.3 },
  paused: { scale: 1, tc: 0.2 },
  playing: { scale: 1, tc: 0.25 },
};

const DEFAULT_SFX_MAX_DIST = 24;

interface ActiveLoop {
  readonly spec: WorldSoundLoop;
  handle: LoopHandle | null;
}

/**
 * Drives positional looping emitters declared by level kit props and synchronized
 * prop one-shot events (`world:sfx`). Loops start lazily when within audible range
 * and their ElevenLabs sample has decoded, scale with game mode, and stop cleanly
 * when out of range, gated off, reset, or disposed.
 */
export class PropAudioController {
  private readonly audio: AmbienceAudio;
  private readonly entries: ActiveLoop[];
  private readonly offSample: () => void;
  private mode: GameMode = 'title';
  private lastListener = new THREE.Vector3(Infinity, Infinity, Infinity);
  private hasListener = false;

  constructor(audio: AmbienceAudio, loops: readonly WorldSoundLoop[]) {
    this.audio = audio;
    this.entries = loops.map((spec) => ({ spec, handle: null }));
    this.offSample = this.audio.onSampleLoaded((name) => this.handleSampleLoaded(name));
  }

  setMode(mode: GameMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'title') {
      for (const e of this.entries) {
        if (!e.handle) continue;
        e.handle.stop(MODE_SCALE.title.tc);
        e.handle = null;
      }
      return;
    }
    if (this.hasListener) this.syncLoops(this.lastListener, MODE_SCALE[mode].tc);
  }

  /** Update distance gating and live `active()` predicates for all prop loops. */
  update(listenerPos: THREE.Vector3): void {
    this.lastListener.copy(listenerPos);
    this.hasListener = true;
    this.syncLoops(listenerPos, 0.15);
  }

  /** Handle a synchronized positional one-shot emitted by a level prop (`world:sfx`). */
  onWorldSfx(ev: WorldSfxEvent, listenerPos: THREE.Vector3): void {
    if (this.mode !== 'playing') return;
    if (!this.audio.hasSound(ev.sound)) return;
    const maxDist = ev.maxDist ?? DEFAULT_SFX_MAX_DIST;
    if (ev.position.distanceTo(listenerPos) > maxDist) return;
    const opts: VoiceOptions = {
      bus: ev.bus ?? 'sfx',
      position: ev.position,
      ...(ev.gain !== undefined ? { gain: ev.gain } : {}),
      ...(ev.rate !== undefined ? { rate: ev.rate } : {}),
      ...(ev.reverb !== undefined ? { reverb: ev.reverb } : {}),
    };
    this.audio.play(ev.sound, opts);
  }

  /** Stop all currently running prop loops (e.g. on `level:reset`). */
  reset(): void {
    for (const e of this.entries) {
      if (!e.handle) continue;
      e.handle.stop(0.2);
      e.handle = null;
    }
  }

  dispose(): void {
    this.offSample();
    for (const e of this.entries) {
      if (!e.handle) continue;
      e.handle.stop(0);
      e.handle = null;
    }
  }

  private handleSampleLoaded(name: SampleName): void {
    if (this.mode === 'title' || !this.hasListener) return;
    for (const e of this.entries) {
      if (e.spec.sound === name && !e.handle) {
        this.syncEntry(e, this.lastListener, 0.25);
      }
    }
  }

  private syncLoops(listenerPos: THREE.Vector3, tc: number): void {
    for (const e of this.entries) this.syncEntry(e, listenerPos, tc);
  }

  private syncEntry(e: ActiveLoop, listenerPos: THREE.Vector3, tc: number): void {
    const modeScale = MODE_SCALE[this.mode].scale;
    const isActive = modeScale > 0 && (e.spec.active ? e.spec.active() : true);
    const dist = e.spec.position.distanceTo(listenerPos);
    const inRange = isActive && dist < e.spec.maxDist;

    if (!inRange) {
      if (e.handle) {
        e.handle.stop(0.3);
        e.handle = null;
      }
      return;
    }

    if (!e.handle) {
      if (!this.audio.hasSample(e.spec.sound) || !this.audio.hasSound(e.spec.sound)) return;
      const opts: VoiceOptions = {
        bus: e.spec.bus,
        position: e.spec.position,
        gain: 0,
        ...(e.spec.rate !== undefined ? { rate: e.spec.rate } : {}),
        ...(e.spec.cutoff !== undefined ? { cutoff: e.spec.cutoff } : {}),
        ...(e.spec.reverb !== undefined ? { reverb: e.spec.reverb } : {}),
      };
      e.handle = this.audio.loop(e.spec.sound, opts);
    }

    // Smoothly taper gain in the outer 35% of maxDist so culling never clicks.
    const fadeStart = e.spec.maxDist * 0.65;
    const edge = dist <= fadeStart ? 1 : Math.max(0, 1 - (dist - fadeStart) / Math.max(0.01, e.spec.maxDist - fadeStart));
    e.handle.setGain(e.spec.gain * modeScale * edge, tc);
  }
}
