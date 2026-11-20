import * as THREE from 'three';
import { Rng } from '../core/rng.ts';
import type { GameMode } from '../game/game.ts';
import type { LoopHandle, VoiceOptions } from './engine.ts';
import { Scheduler } from './scheduler.ts';
import type { SampleName, SoundName } from './sounds.ts';

/**
 * Minimal audio surface needed by AmbienceDirector (matches `AudioEngine` and lets
 * tests run headless without Web Audio globals).
 */
export interface AmbienceAudio {
  hasSound(name: SoundName): boolean;
  hasSample(name: SampleName): boolean;
  onSampleLoaded(fn: (name: SampleName) => void): () => void;
  loop(name: SoundName, opts?: VoiceOptions): LoopHandle;
  play(name: SoundName, opts?: VoiceOptions): void;
}

export interface AmbienceLightSource {
  readonly position: THREE.Vector3;
  readonly light: { readonly level: number; readonly pattern?: string };
  /** Light-slot kind; `pendant` lamps are not fluorescent and never buzz (in-world-audio spec). */
  readonly kind?: string;
}

export interface BedLayerSpec {
  /** Preferred recorded/generated sample; falls back to `fallback` until decoded. */
  sample: SampleName;
  fallback: SoundName;
  gain: number;
  rate?: number;
  cutoff?: number;
  muffled?: boolean;
}

export type OneShotPlacement = 'perimeter' | 'ceiling' | 'far' | 'near';

export interface AmbienceOneShot {
  sound: SoundName;
  /** Optional fallback if `sound` is a sample-only name that has not loaded yet. */
  fallback?: SoundName;
  /** Random [min, max] interval in seconds between firings. */
  every: readonly [number, number];
  gain: number;
  placement: OneShotPlacement;
  reverb?: number;
  muffled?: boolean;
  rateRange?: readonly [number, number];
}

export interface AmbiencePreset {
  /** Primary stereo room bed plus optional asynchronous secondary texture layer. */
  beds: readonly BedLayerSpec[];
  /** Gentle dual-wave amplitude breathing so long stays in one room never feel static. */
  breathing: { depth: number; periodA: number; periodB: number };
  /** Room-appropriate spatialized environmental one-shots. */
  oneshots: readonly AmbienceOneShot[];
}

export const DEFAULT_AMBIENCE = 'hull_hum';
export const AMBIENCE_CROSSFADE = 2.0;

const MODE_SCALE: Record<GameMode, { scale: number; tc: number }> = {
  title: { scale: 0, tc: 0.45 },
  paused: { scale: 0.35, tc: 0.25 },
  playing: { scale: 1, tc: 0.6 },
};

const MAX_ROOM_BUZZERS = 4;
const STEADY_BUZZ_GAIN = 0.045;
const FLICKER_BUZZ_GAIN = 0.16;

/**
 * Environmental soundscape presets matching `atmosphere.ambience` in level JSONs
 * (plus `'silent'` for scripted quiet moments).
 */
export const AMBIENCE_PRESETS = {
  hull_hum: {
    beds: [
      { sample: 'ambHullHum', fallback: 'roomTone', gain: 0.55 },
      { sample: 'waterRumble', fallback: 'waterRumble', gain: 0.18, rate: 0.94, cutoff: 340 },
    ],
    breathing: { depth: 0.09, periodA: 19, periodB: 31 },
    oneshots: [
      { sound: 'hullGroan', every: [22, 46], gain: 0.48, placement: 'far', muffled: true, reverb: 0.55, rateRange: [0.88, 1.05] },
      { sound: 'metalKnock', every: [18, 40], gain: 0.36, placement: 'far', muffled: true, reverb: 0.65, rateRange: [0.84, 1.1] },
      { sound: 'creak', every: [15, 34], gain: 0.22, placement: 'ceiling', reverb: 0.4, rateRange: [0.9, 1.1] },
      { sound: 'pressurePing', every: [35, 70], gain: 0.18, placement: 'far', muffled: true, reverb: 0.75, rateRange: [0.95, 1.04] },
    ],
  },
  commons_murmur: {
    beds: [
      { sample: 'ambCommons', fallback: 'roomTone', gain: 0.52 },
      { sample: 'ventFan', fallback: 'ventFan', gain: 0.09, rate: 0.91, cutoff: 900 },
    ],
    breathing: { depth: 0.07, periodA: 23, periodB: 37 },
    oneshots: [
      { sound: 'creak', every: [24, 52], gain: 0.16, placement: 'ceiling', reverb: 0.35, rateRange: [0.92, 1.08] },
      { sound: 'metalKnock', every: [30, 64], gain: 0.22, placement: 'far', muffled: true, reverb: 0.55, rateRange: [0.85, 1.06] },
    ],
  },
  lab_hum: {
    beds: [
      { sample: 'ambLabHum', fallback: 'roomTone', gain: 0.52 },
      { sample: 'consoleHum', fallback: 'consoleHum', gain: 0.12, rate: 0.97, cutoff: 1400 },
    ],
    breathing: { depth: 0.08, periodA: 17, periodB: 29 },
    oneshots: [
      { sound: 'consoleBeep', every: [14, 30], gain: 0.16, placement: 'near', reverb: 0.2, rateRange: [0.97, 1.04] },
      { sound: 'hullGroan', every: [28, 56], gain: 0.34, placement: 'far', muffled: true, reverb: 0.5, rateRange: [0.88, 1.04] },
      { sound: 'creak', every: [20, 44], gain: 0.2, placement: 'ceiling', reverb: 0.35, rateRange: [0.92, 1.08] },
    ],
  },
  hull_groan: {
    beds: [
      { sample: 'ambHullGroan', fallback: 'roomTone', gain: 0.62 },
      { sample: 'waterRumble', fallback: 'waterRumble', gain: 0.28, rate: 0.92, cutoff: 380 },
    ],
    breathing: { depth: 0.13, periodA: 15, periodB: 27 },
    oneshots: [
      { sound: 'hullGroan', every: [12, 26], gain: 0.65, placement: 'far', muffled: true, reverb: 0.65, rateRange: [0.84, 1.04] },
      { sound: 'creak', every: [8, 19], gain: 0.32, placement: 'ceiling', reverb: 0.45, rateRange: [0.88, 1.12] },
      { sound: 'metalKnock', every: [12, 28], gain: 0.48, placement: 'far', muffled: true, reverb: 0.7, rateRange: [0.8, 1.08] },
      { sound: 'pressurePing', every: [26, 54], gain: 0.22, placement: 'far', muffled: true, reverb: 0.8, rateRange: [0.94, 1.05] },
    ],
  },
  office_hvac: {
    beds: [
      { sample: 'ambOfficeHvac', fallback: 'roomTone', gain: 0.5 },
      { sample: 'consoleHum', fallback: 'consoleHum', gain: 0.1, rate: 0.96, cutoff: 1200 },
    ],
    breathing: { depth: 0.06, periodA: 25, periodB: 41 },
    oneshots: [
      { sound: 'creak', every: [26, 56], gain: 0.14, placement: 'ceiling', reverb: 0.2, rateRange: [0.92, 1.08] },
      { sound: 'metalKnock', every: [32, 68], gain: 0.18, placement: 'far', muffled: true, reverb: 0.4, rateRange: [0.85, 1.05] },
    ],
  },
  med_beeps: {
    beds: [
      { sample: 'ambMedBay', fallback: 'roomTone', gain: 0.5 },
      { sample: 'ventFan', fallback: 'ventFan', gain: 0.08, rate: 0.93, cutoff: 800 },
    ],
    breathing: { depth: 0.07, periodA: 19, periodB: 33 },
    oneshots: [
      { sound: 'medBeep', fallback: 'consoleBeep', every: [7, 16], gain: 0.22, placement: 'near', reverb: 0.2, rateRange: [0.98, 1.02] },
      { sound: 'creak', every: [24, 50], gain: 0.16, placement: 'ceiling', reverb: 0.25, rateRange: [0.92, 1.08] },
    ],
  },
  water_drip: {
    beds: [
      { sample: 'ambFlooded', fallback: 'waterRumble', gain: 0.62 },
      { sample: 'waterRumble', fallback: 'waterRumble', gain: 0.26, rate: 0.9, cutoff: 420 },
    ],
    breathing: { depth: 0.12, periodA: 16, periodB: 29 },
    oneshots: [
      { sound: 'drip', every: [1.6, 5.2], gain: 0.42, placement: 'perimeter', reverb: 0.6, rateRange: [0.85, 1.18] },
      { sound: 'hullGroan', every: [16, 36], gain: 0.52, placement: 'far', muffled: true, reverb: 0.7, rateRange: [0.84, 1.02] },
      { sound: 'metalKnock', every: [14, 32], gain: 0.38, placement: 'far', muffled: true, reverb: 0.75, rateRange: [0.8, 1.08] },
      { sound: 'pressurePing', every: [28, 56], gain: 0.2, placement: 'far', muffled: true, reverb: 0.85, rateRange: [0.94, 1.04] },
    ],
  },
  pipes_knock: {
    beds: [
      { sample: 'ambValveRoom', fallback: 'ventFan', gain: 0.58 },
      { sample: 'waterRumble', fallback: 'waterRumble', gain: 0.22, rate: 0.95, cutoff: 480 },
    ],
    breathing: { depth: 0.1, periodA: 14, periodB: 23 },
    oneshots: [
      { sound: 'metalKnock', every: [6, 16], gain: 0.48, placement: 'perimeter', reverb: 0.55, rateRange: [0.82, 1.14] },
      { sound: 'creak', every: [10, 24], gain: 0.3, placement: 'ceiling', reverb: 0.45, rateRange: [0.88, 1.12] },
      { sound: 'drip', every: [4, 11], gain: 0.28, placement: 'perimeter', reverb: 0.4, rateRange: [0.9, 1.15] },
      { sound: 'hullGroan', every: [20, 42], gain: 0.45, placement: 'far', muffled: true, reverb: 0.55, rateRange: [0.85, 1.03] },
    ],
  },
  hydro_misters: {
    beds: [
      { sample: 'ambHydroMisters', fallback: 'ventFan', gain: 0.55 },
      { sample: 'ambHullHum', fallback: 'roomTone', gain: 0.14, rate: 0.96, cutoff: 320 },
    ],
    breathing: { depth: 0.08, periodA: 18, periodB: 31 },
    oneshots: [
      { sound: 'drip', every: [3.2, 8.5], gain: 0.24, placement: 'perimeter', reverb: 0.35, rateRange: [0.9, 1.18] },
      { sound: 'creak', every: [22, 48], gain: 0.18, placement: 'ceiling', reverb: 0.35, rateRange: [0.92, 1.08] },
    ],
  },
  dive_drip: {
    beds: [
      { sample: 'ambDiveBay', fallback: 'waterRumble', gain: 0.6 },
      { sample: 'waterRumble', fallback: 'waterRumble', gain: 0.24, rate: 0.91, cutoff: 360 },
    ],
    breathing: { depth: 0.11, periodA: 17, periodB: 30 },
    oneshots: [
      { sound: 'drip', every: [2.2, 6.5], gain: 0.36, placement: 'perimeter', reverb: 0.65, rateRange: [0.86, 1.16] },
      { sound: 'hullGroan', every: [18, 38], gain: 0.48, placement: 'far', muffled: true, reverb: 0.7, rateRange: [0.85, 1.03] },
      { sound: 'pressurePing', every: [24, 52], gain: 0.24, placement: 'far', muffled: true, reverb: 0.85, rateRange: [0.94, 1.05] },
      { sound: 'distantMoan', every: [55, 110], gain: 0.35, placement: 'far', muffled: true, reverb: 0.9, rateRange: [0.94, 1.04] },
    ],
  },
  silent: {
    beds: [],
    breathing: { depth: 0, periodA: 20, periodB: 31 },
    oneshots: [],
  },
} as const satisfies Record<string, AmbiencePreset>;

export type AmbiencePresetId = keyof typeof AMBIENCE_PRESETS;

export function isAmbiencePreset(id: string): id is AmbiencePresetId {
  return id in AMBIENCE_PRESETS;
}

/** Unknown or missing names fall back to `hull_hum`, so a level typo is never silent-fatal. */
export function resolveAmbience(id: string | undefined): AmbiencePresetId {
  if (id === 'none') return 'silent';
  return id !== undefined && isAmbiencePreset(id) ? id : DEFAULT_AMBIENCE;
}

interface ActiveBed {
  spec: BedLayerSpec;
  usingSample: boolean;
  handle: LoopHandle;
}

interface ActiveBuzz {
  source: AmbienceLightSource;
  handle: LoopHandle;
  baseGain: number;
  rate: number;
  usingSample: boolean;
  prevLevel: number;
  lastZap: number;
}

/**
 * Room-aware environmental soundscape director on top of `AudioEngine`.
 *
 * Manages multi-layer stereo ambient beds with smooth crossfading on room transitions,
 * scripted `ambience(id)` overrides, seamless procedural-to-sample hot-swapping once
 * async samples decode, spatial one-shot pacing around the listener, and reactive
 * fluorescent buzz/zap emitters on the active room's light fixtures.
 */
export class AmbienceDirector {
  private readonly audio: AmbienceAudio;
  private readonly rng: Rng;
  private readonly offSample: () => void;

  private mode: GameMode = 'title';
  private roomPreset: AmbiencePresetId | null = null;
  private overridePreset: AmbiencePresetId | null = null;
  private activePreset: AmbiencePresetId | null = null;
  private beds: ActiveBed[] = [];
  private scheduler: Scheduler | null = null;
  private buzzers: ActiveBuzz[] = [];
  private listenerPos = new THREE.Vector3();
  private lastTime = 0;

  constructor(audio: AmbienceAudio, rng: Rng) {
    this.audio = audio;
    this.rng = rng;
    this.offSample = this.audio.onSampleLoaded((name) => this.handleSampleLoaded(name));
  }

  /** Current effective preset (script override wins over room preset). */
  get currentPreset(): AmbiencePresetId | null {
    return this.activePreset;
  }

  /** Set game mode: silent on title (MenuMusic owns it), ducked on pause, full while playing. */
  setMode(mode: GameMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'title') this.overridePreset = null;
    this.applyBedGains(this.lastTime, MODE_SCALE[mode].tc);
    this.applyBuzzGains(MODE_SCALE[mode].tc);
  }

  /** Called on `room:entered` with the room's `atmosphere.ambience` id and optional light fixtures. */
  enterRoom(ambienceId: string | undefined, lights: readonly AmbienceLightSource[] = [], fadeSeconds = AMBIENCE_CROSSFADE): void {
    this.roomPreset = resolveAmbience(ambienceId);
    this.bindRoomLights(lights);
    if (this.overridePreset === null) {
      this.transitionTo(this.roomPreset, fadeSeconds);
    }
  }

  /** Scripted `ambience(id)` action: overrides room ambience until cleared with `null`. */
  setOverride(ambienceId: string | null, fadeSeconds = AMBIENCE_CROSSFADE): void {
    if (ambienceId === null) {
      this.overridePreset = null;
      if (this.roomPreset !== null) this.transitionTo(this.roomPreset, fadeSeconds);
      return;
    }
    this.overridePreset = resolveAmbience(ambienceId);
    this.transitionTo(this.overridePreset, fadeSeconds);
  }

  /** Clear scripted override and light emitters (e.g. on `level:reset`). */
  reset(): void {
    this.overridePreset = null;
    this.clearBuzzers(0.25);
    if (this.roomPreset !== null) {
      this.transitionTo(this.roomPreset, 0.8);
    }
  }

  /** Tick breathing modulation, one-shot scheduler, and flickering light arcs. */
  update(t: number, listenerPos: THREE.Vector3): void {
    this.lastTime = t;
    this.listenerPos.copy(listenerPos);

    if (this.mode === 'playing') {
      this.applyBedGains(t, 0.35);
      this.scheduler?.update(t);
    }

    const modeScale = MODE_SCALE[this.mode].scale;
    for (const b of this.buzzers) {
      const level = b.source.light.level;
      b.handle.setGain(b.baseGain * level * modeScale, 0.02);
      if (this.mode === 'playing' && b.prevLevel < 0.4 && level > 0.75 && t - b.lastZap > 0.3) {
        if (this.audio.hasSound('zap')) {
          this.audio.play('zap', {
            bus: 'ambience',
            position: b.source.position,
            gain: 0.3,
            reverb: 0.25,
            rate: this.rng.range(0.9, 1.12),
          });
        }
        b.lastZap = t;
      }
      b.prevLevel = level;
    }
  }

  /** Stop all active loops and unsubscribe from sample-load events. */
  dispose(): void {
    this.offSample();
    for (const b of this.beds) b.handle.stop(0);
    this.beds = [];
    this.clearBuzzers(0);
    this.scheduler = null;
    this.activePreset = null;
  }

  // ---------------------------------------------------------------- internals

  private transitionTo(next: AmbiencePresetId, fadeSeconds: number): void {
    if (next === this.activePreset && this.beds.length > 0) return;
    if (next === this.activePreset && AMBIENCE_PRESETS[next].beds.length === 0) return;

    const prevBeds = this.beds;
    this.beds = [];
    for (const b of prevBeds) b.handle.stop(fadeSeconds);

    this.activePreset = next;
    const spec = AMBIENCE_PRESETS[next];
    const tc = Math.max(0.05, fadeSeconds * 0.45);
    const modeScale = MODE_SCALE[this.mode].scale;

    for (const layer of spec.beds) {
      const active = this.startBedLayer(layer, 0);
      if (!active) continue;
      this.beds.push(active);
      active.handle.setGain(layer.gain * modeScale * this.breathFactor(this.lastTime), tc);
    }

    this.rebuildScheduler(spec);
  }

  private startBedLayer(spec: BedLayerSpec, initialGain: number): ActiveBed | null {
    const sampleReady = this.audio.hasSample(spec.sample) && this.audio.hasSound(spec.sample);
    const sound: SoundName = sampleReady ? spec.sample : spec.fallback;
    if (!this.audio.hasSound(sound)) return null;
    const opts: VoiceOptions = {
      bus: 'ambience',
      gain: initialGain,
      ...(spec.rate !== undefined ? { rate: spec.rate } : {}),
      ...(spec.cutoff !== undefined ? { cutoff: spec.cutoff } : {}),
      ...(spec.muffled ? { muffled: true } : {}),
    };
    return {
      spec,
      usingSample: sampleReady,
      handle: this.audio.loop(sound, opts),
    };
  }

  private handleSampleLoaded(name: SampleName): void {
    const modeScale = MODE_SCALE[this.mode].scale;
    const breath = this.breathFactor(this.lastTime);

    // Hot-swap any active bed layer waiting for its recorded ElevenLabs sample.
    for (let i = 0; i < this.beds.length; i++) {
      const b = this.beds[i]!;
      if (!b.usingSample && b.spec.sample === name && this.audio.hasSound(name)) {
        const replacement = this.startBedLayer(b.spec, 0);
        if (!replacement) continue;
        b.handle.stop(1.0);
        replacement.handle.setGain(b.spec.gain * modeScale * breath, 0.45);
        this.beds[i] = replacement;
      }
    }

    // Hot-swap active fluorescent buzzers when the ElevenLabs buzz clip finishes decoding.
    if (name === 'fluorescentBuzz' && this.audio.hasSound('fluorescentBuzz')) {
      for (const b of this.buzzers) {
        if (b.usingSample) continue;
        const level = b.source.light.level;
        const nextHandle = this.audio.loop('fluorescentBuzz', {
          bus: 'ambience',
          gain: 0,
          position: b.source.position,
          rate: b.rate,
        });
        b.handle.stop(0.4);
        nextHandle.setGain(b.baseGain * level * modeScale, 0.2);
        b.handle = nextHandle;
        b.usingSample = true;
      }
    }
  }

  private rebuildScheduler(preset: AmbiencePreset): void {
    if (preset.oneshots.length === 0) {
      this.scheduler = null;
      return;
    }
    const sched = new Scheduler(this.rng.fork(`oneshots:${this.activePreset ?? 'none'}`));
    for (const shot of preset.oneshots) {
      sched.add(shot.every, () => this.fireOneShot(shot));
    }
    this.scheduler = sched;
  }

  private fireOneShot(shot: AmbienceOneShot): void {
    if (this.mode !== 'playing') return;
    const sound = this.audio.hasSound(shot.sound) ? shot.sound : shot.fallback;
    if (!sound || !this.audio.hasSound(sound)) return;

    const pos = this.placeOneShot(shot.placement);
    const rate = shot.rateRange ? this.rng.range(shot.rateRange[0], shot.rateRange[1]) : 1;
    this.audio.play(sound, {
      bus: 'ambience',
      position: pos,
      gain: shot.gain * this.rng.range(0.82, 1.12),
      ...(shot.muffled ? { muffled: true } : {}),
      ...(shot.reverb !== undefined ? { reverb: shot.reverb } : {}),
      rate,
    });
  }

  private placeOneShot(placement: OneShotPlacement): THREE.Vector3 {
    const angle = this.rng.range(0, Math.PI * 2);
    const p = this.listenerPos;
    switch (placement) {
      case 'near': {
        const r = this.rng.range(2.2, 4.8);
        return new THREE.Vector3(p.x + Math.cos(angle) * r, p.y + this.rng.range(-0.4, 0.8), p.z + Math.sin(angle) * r);
      }
      case 'ceiling': {
        const r = this.rng.range(2.0, 6.5);
        return new THREE.Vector3(p.x + Math.cos(angle) * r, p.y + this.rng.range(1.8, 3.6), p.z + Math.sin(angle) * r);
      }
      case 'perimeter': {
        const r = this.rng.range(4.5, 9.5);
        return new THREE.Vector3(p.x + Math.cos(angle) * r, p.y + this.rng.range(-1.2, 1.4), p.z + Math.sin(angle) * r);
      }
      case 'far': {
        const r = this.rng.range(9.5, 17.0);
        return new THREE.Vector3(p.x + Math.cos(angle) * r, p.y + this.rng.range(-3.0, 3.5), p.z + Math.sin(angle) * r);
      }
    }
  }

  private bindRoomLights(all: readonly AmbienceLightSource[]): void {
    this.clearBuzzers(0.35);
    const lights = all.filter((l) => l.kind !== 'pendant'); // lamps are not fluorescent tubes
    if (lights.length === 0 || !this.audio.hasSound('fluorescentBuzz')) return;

    // Prioritize flickering/failing tubes so faulty fixtures are always audible, then steady fixtures.
    const ranked = [...lights].sort((a, b) => {
      const aFlicker = a.light.pattern && a.light.pattern !== 'steady' && a.light.pattern !== 'off' ? 1 : 0;
      const bFlicker = b.light.pattern && b.light.pattern !== 'steady' && b.light.pattern !== 'off' ? 1 : 0;
      return bFlicker - aFlicker;
    });

    const modeScale = MODE_SCALE[this.mode].scale;
    const usingSample = this.audio.hasSample('fluorescentBuzz');
    for (const src of ranked.slice(0, MAX_ROOM_BUZZERS)) {
      if (src.light.pattern === 'off') continue;
      const isFaulty = src.light.pattern !== undefined && src.light.pattern !== 'steady';
      const baseGain = isFaulty ? FLICKER_BUZZ_GAIN : STEADY_BUZZ_GAIN;
      const rate = this.rng.range(0.97, 1.03);
      const handle = this.audio.loop('fluorescentBuzz', {
        bus: 'ambience',
        gain: 0,
        position: src.position,
        rate,
      });
      handle.setGain(baseGain * src.light.level * modeScale, 0.25);
      this.buzzers.push({
        source: src,
        handle,
        baseGain,
        rate,
        usingSample,
        prevLevel: src.light.level,
        lastZap: -1,
      });
    }
  }

  private clearBuzzers(fadeSeconds: number): void {
    for (const b of this.buzzers) b.handle.stop(fadeSeconds);
    this.buzzers = [];
  }

  private breathFactor(t: number): number {
    if (!this.activePreset) return 1;
    const br = AMBIENCE_PRESETS[this.activePreset].breathing;
    if (br.depth <= 0) return 1;
    const wave = 0.6 * Math.sin((Math.PI * 2 * t) / br.periodA) + 0.4 * Math.sin((Math.PI * 2 * t) / br.periodB + 1.3);
    return 1 + br.depth * wave;
  }

  private applyBedGains(t: number, tc: number): void {
    const modeScale = MODE_SCALE[this.mode].scale;
    const breath = this.breathFactor(t);
    for (const b of this.beds) {
      b.handle.setGain(b.spec.gain * modeScale * breath, tc);
    }
  }

  private applyBuzzGains(tc: number): void {
    const modeScale = MODE_SCALE[this.mode].scale;
    for (const b of this.buzzers) {
      b.handle.setGain(b.baseGain * b.source.light.level * modeScale, tc);
    }
  }
}
