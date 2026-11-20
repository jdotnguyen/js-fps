import * as THREE from 'three';
import type { FootstepEvent, FootstepKind } from '../actors/humanoid.ts';
import type { Surface } from '../actors/player.ts';
import { Rng } from '../core/rng.ts';
import type { ColliderSurface } from '../world/collision.ts';
import type { VoiceOptions } from './engine.ts';
import type { SoundName } from './sounds.ts';

/**
 * Minimal audio engine interface needed by FootstepAudio (matches `AudioEngine`
 * and allows deterministic headless unit tests without Web Audio globals).
 */
export interface FootstepAudioEngine {
  hasSound(name: SoundName): boolean;
  variantCount?(name: SoundName): number;
  play(name: SoundName, opts?: VoiceOptions): void;
}

export interface FootstepPlayerEvent {
  surface: Surface;
  x: number;
  y: number;
  z: number;
  sprint: boolean;
  landing?: boolean;
}

export interface FootstepAudioDeps {
  audio: FootstepAudioEngine;
  rng: Rng;
  /** Current camera/listener world position. */
  listener: () => THREE.Vector3;
  /** Acoustic surface under a world foot position (x, y, z). */
  surfaceAt: (x: number, y: number, z: number) => ColliderSurface | null;
  /**
   * True when a solid wall or closed door blocks line-of-sound from `from` to `to`
   * (used to muffle footsteps behind closed airlocks/bulkheads).
   */
  isOccluded?: (from: THREE.Vector3, to: THREE.Vector3) => boolean;
}

/** Max audible distance (m) for normal walking/jogging/shambling steps. */
export const FOOTSTEP_MAX_DISTANCE = 22;
/** Max audible distance (m) for heavy hero stomps. */
export const FOOTSTEP_HEAVY_MAX_DISTANCE = 30;
/** Distance (m) where smooth fade-out tail begins so steps never pop off at the cull edge. */
const FADE_START_DISTANCE = 13;
/** Low-pass cutoff (Hz) when footsteps are heard through a wall or closed door. */
const OCCLUDED_CUTOFF_HZ = 520;
/** Gain multiplier when a step is occluded by a wall or closed door. */
const OCCLUDED_GAIN_SCALE = 0.42;

/** Map a floor's acoustic surface tag to its sound bank entry. */
export function soundForSurface(surface: ColliderSurface | Surface | null | undefined): SoundName {
  switch (surface) {
    case 'concrete':
      return 'footConcrete';
    case 'grate':
      return 'footGrate';
    case 'rubber':
      return 'footRubber';
    case 'water':
      return 'footConcrete';
    case 'metal':
    default:
      return 'footPlate';
  }
}

/** Stable tiny pitch offset (-0.04..+0.04) per actor id so squadmates/crew have subtly distinct boots. */
function actorPitchBias(actor: string): number {
  let h = 2166136261;
  for (let i = 0; i < actor.length; i++) {
    h ^= actor.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const u = (h >>> 0) / 0xffffffff;
  return (u - 0.5) * 0.08;
}

function baseGainForKind(kind: FootstepKind, speed: number): number {
  switch (kind) {
    case 'pivot':
      return 0.34;
    case 'walk':
      return 0.62 + THREE.MathUtils.clamp((speed - 1.2) * 0.12, -0.1, 0.16);
    case 'jog':
      return 0.86;
    case 'shamble':
      return 0.72;
    case 'heavy':
      return 1.2;
  }
}

function rateScaleForKind(kind: FootstepKind): number {
  switch (kind) {
    case 'pivot':
      return 1.04;
    case 'walk':
      return 1.0;
    case 'jog':
      return 1.06;
    case 'shamble':
      return 0.92;
    case 'heavy':
      return 0.76;
  }
}

/**
 * Spatialized, surface-accurate footstep playback for Jay and every humanoid in the world.
 *
 * - Picks surface-matched sound banks (`footConcrete`, `footPlate`, `footGrate`, `footRubber`).
 * - Never repeats the exact same variant twice in a row per sound bank.
 * - Applies 3D HRTF positioning via `AudioEngine`, smooth distance falloff/culling,
 *   distance air-absorption low-pass, and wall/door occlusion muffling.
 */
export class FootstepAudio {
  private readonly deps: FootstepAudioDeps;
  private readonly lastVariant = new Map<SoundName, number>();
  private readonly probeTo = new THREE.Vector3();

  constructor(deps: FootstepAudioDeps) {
    this.deps = deps;
  }

  /** Play one footstep or landing from the player. */
  playPlayer(ev: FootstepPlayerEvent): void {
    const sound = soundForSurface(ev.surface);
    if (!this.deps.audio.hasSound(sound)) return;

    const landing = ev.landing === true;
    const gain = landing ? 0.76 : ev.sprint ? 0.68 : 0.48;
    const rateBase = landing ? 0.9 : ev.sprint ? 1.05 : 1.0;
    const rate = this.deps.rng.range(0.95, 1.05) * rateBase;
    const variant = this.pickVariant(sound);

    const opts: VoiceOptions = {
      bus: 'sfx',
      position: new THREE.Vector3(ev.x, ev.y + 0.05, ev.z),
      gain,
      reverb: landing ? 0.24 : 0.18,
      rate,
      variant,
      ...(ev.surface === 'water' ? { cutoff: 950 } : {}),
    };
    this.deps.audio.play(sound, opts);
  }

  /** Play one spatialized footstep from an NPC, squadmate, or enemy. */
  playCharacter(ev: FootstepEvent): void {
    const listener = this.deps.listener();
    const dx = ev.x - listener.x;
    const dy = ev.y - listener.y;
    const dz = ev.z - listener.z;
    const dist = Math.hypot(dx, dy, dz);
    const maxDist = ev.kind === 'heavy' ? FOOTSTEP_HEAVY_MAX_DISTANCE : FOOTSTEP_MAX_DISTANCE;
    if (dist > maxDist) return;

    const surface = this.deps.surfaceAt(ev.x, ev.y, ev.z) ?? 'metal';
    const sound = soundForSurface(surface);
    if (!this.deps.audio.hasSound(sound)) return;

    // Smooth tail attenuation past FADE_START_DISTANCE so voices fade out naturally before culling.
    const tail =
      dist <= FADE_START_DISTANCE
        ? 1
        : Math.max(0, 1 - (dist - FADE_START_DISTANCE) / Math.max(1, maxDist - FADE_START_DISTANCE));
    const tailGain = tail * tail;
    if (tailGain <= 0.005) return;

    // Wall / closed-door occlusion check: aim at torso height (~1.35 m above floor) so waist-high
    // counters, chairs, and crates in an open room never falsely muffle someone standing right in front of you.
    this.probeTo.set(ev.x, ev.y + 1.35, ev.z);
    const occluded = dist > 0.6 && (this.deps.isOccluded?.(listener, this.probeTo) ?? false);

    let gain = baseGainForKind(ev.kind, ev.speed) * tailGain;
    if (occluded) gain *= OCCLUDED_GAIN_SCALE;
    if (gain <= 0.004) return;

    // Distance air absorption (high frequencies soften with distance) + occlusion low-pass.
    let cutoff: number | undefined;
    if (occluded) {
      cutoff = OCCLUDED_CUTOFF_HZ;
    } else if (surface === 'water') {
      cutoff = 950;
    } else if (dist > 4) {
      const k = THREE.MathUtils.clamp((dist - 4) / (maxDist - 4), 0, 1);
      // Exponentially sweep from 16 kHz at 4 m down to ~3.2 kHz near max distance.
      cutoff = Math.round(16000 * Math.pow(3200 / 16000, k));
    }

    const rate = this.deps.rng.range(0.95, 1.05) * rateScaleForKind(ev.kind) * (1 + actorPitchBias(ev.actor));
    const reverb = ev.kind === 'heavy' ? 0.42 : occluded ? 0.34 : 0.22 + THREE.MathUtils.clamp((dist - 3) * 0.015, 0, 0.16);
    const variant = this.pickVariant(sound);

    const opts: VoiceOptions = {
      bus: 'sfx',
      position: new THREE.Vector3(ev.x, ev.y, ev.z),
      gain,
      reverb,
      rate,
      variant,
      ...(cutoff !== undefined ? { cutoff } : {}),
    };
    this.deps.audio.play(sound, opts);
  }

  /** Pick a variant index without repeating the immediately preceding clip for `sound`. */
  private pickVariant(sound: SoundName): number {
    const count = Math.max(1, this.deps.audio.variantCount?.(sound) ?? 7);
    if (count === 1) return 0;
    const prev = this.lastVariant.get(sound);
    let next = this.deps.rng.int(0, count - 1);
    if (next === prev) next = (next + 1 + this.deps.rng.int(0, count - 2)) % count;
    this.lastVariant.set(sound, next);
    return next;
  }
}
