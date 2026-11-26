import * as THREE from 'three';
import { Rng } from '../core/rng.ts';
import type { GameMode } from '../game/game.ts';
import type { RoomFoleyCue, RoomFoleyData } from '../data/types/roomFoley.ts';
import type { StationPhase } from './ambience.ts';
import type { LoopHandle, VoiceOptions } from './engine.ts';
import type { SampleName, SoundName } from './sounds.ts';

/**
 * Wing and room-life positional foley director (in-world-audio spec): emits irregular, world-anchored
 * one-shots (office typing, desk phone chimes, printers, swivel chairs, paper rustles, CRT relays,
 * gantry/rail creaks, manifold releases) on the `sfx` bus so existing wall/door/glass occlusion and
 * distance culling apply automatically. Respects station phase (`morning` / `lockdown` / `blackout`),
 * talking attenuation, game mode, and clean resets.
 */

export const ROOM_FOLEY_TUNING = {
  /** Cues farther than this (m) from the listener do not start. */
  maxDistance: 24,
  /** Default gain share while audible speech is playing. */
  defaultTalkShare: 0.5,
  /** Maximum active one-shot handles tracked for clean stop on title/reset. */
  keptHandles: 12,
} as const;

export interface RoomFoleyAudio {
  hasSample(name: SampleName): boolean;
  play(name: SoundName, opts?: VoiceOptions): LoopHandle;
}

export interface RoomFoleyFrame {
  listener: THREE.Vector3;
  phase: StationPhase;
  /** True while audible dialogue or an overheard exchange is playing. */
  talking: boolean;
  /** True once the intro sequence has finished (prevents ambient clutter during opening cutscene). */
  introOver: boolean;
}

interface CueState {
  readonly cue: RoomFoleyCue;
  readonly positions: readonly THREE.Vector3[];
  nextIn: number;
  lastPosIndex: number;
}

export class RoomFoleyDirector {
  private readonly audio: RoomFoleyAudio;
  private readonly data: RoomFoleyData;
  private rng = new Rng('room-foley');
  private states: CueState[] = [];
  private playing: LoopHandle[] = [];
  private mode: GameMode = 'title';

  constructor(audio: RoomFoleyAudio, data: RoomFoleyData) {
    this.audio = audio;
    this.data = data;
    this.initStates();
  }

  setMode(mode: GameMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'title') this.stopPlaying(0.15);
  }

  update(dt: number, frame: RoomFoleyFrame): void {
    if (this.mode !== 'playing' || !frame.introOver) return;
    const maxDistSq = ROOM_FOLEY_TUNING.maxDistance * ROOM_FOLEY_TUNING.maxDistance;

    for (const st of this.states) {
      const { cue } = st;
      if (cue.phases && !cue.phases.includes(frame.phase)) continue;

      // Only advance timers for cues within audible range so walking into a wing feels naturally paced.
      let near = false;
      for (const pos of st.positions) {
        if (pos.distanceToSquared(frame.listener) <= maxDistSq) {
          near = true;
          break;
        }
      }
      if (!near) continue;

      st.nextIn -= dt;
      if (st.nextIn > 0) continue;
      st.nextIn = this.rng.range(cue.every[0], cue.every[1]);

      const sample = cue.sound as SampleName;
      if (!this.audio.hasSample(sample)) continue;

      const pos = this.pickPosition(st, frame.listener, maxDistSq);
      if (!pos) continue;

      const talkShare = cue.talkShare ?? ROOM_FOLEY_TUNING.defaultTalkShare;
      const rate = cue.rate ? this.rng.range(cue.rate[0], cue.rate[1]) : 1;
      const handle = this.audio.play(sample, {
        bus: 'sfx',
        position: pos,
        gain: cue.gain * (frame.talking ? talkShare : 1) * this.rng.range(0.88, 1.1),
        reverb: cue.reverb ?? 0.2,
        rate,
      });
      this.playing.push(handle);
      if (this.playing.length > ROOM_FOLEY_TUNING.keptHandles) this.playing.shift();
    }
  }

  reset(): void {
    this.stopPlaying(0.1);
    this.rng = new Rng('room-foley');
    this.initStates();
  }

  dispose(): void {
    this.stopPlaying(0);
    this.states = [];
  }

  private initStates(): void {
    this.states = this.data.cues.map((cue) => ({
      cue,
      positions: cue.positions.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
      // Stagger initial firing cleanly across the interval so entering a wing does not fire everything at once.
      nextIn: this.rng.range(cue.every[0] * 0.35, cue.every[1]),
      lastPosIndex: -1,
    }));
  }

  private pickPosition(st: CueState, listener: THREE.Vector3, maxDistSq: number): THREE.Vector3 | null {
    const indices: number[] = [];
    for (let i = 0; i < st.positions.length; i++) {
      if (st.positions[i]!.distanceToSquared(listener) <= maxDistSq) indices.push(i);
    }
    if (indices.length === 0) return null;
    const pool = indices.length > 1 ? indices.filter((i) => i !== st.lastPosIndex) : indices;
    const idx = this.rng.pick(pool);
    st.lastPosIndex = idx;
    return st.positions[idx]!;
  }

  private stopPlaying(fade: number): void {
    for (const h of this.playing) h.stop(fade);
    this.playing = [];
  }
}
