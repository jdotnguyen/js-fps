import * as THREE from 'three';
import type { FootstepEvent, FootstepKind } from '../actors/humanoid.ts';
import type { Surface } from '../actors/player.ts';
import { Rng } from '../core/rng.ts';
import type { ColliderSurface } from '../world/collision.ts';
import type { LoopHandle, VoiceOptions } from './engine.ts';
import {
  GLASS_CUTOFF_HZ,
  GLASS_GAIN_SCALE,
  OCCLUDED_CUTOFF_HZ,
  OCCLUDED_GAIN_SCALE,
  OCCLUDED_REVERB,
  OCCLUSION_MIN_DISTANCE,
  type Occluder,
  type Occlusion,
} from './occlusion.ts';
import type { SoundName } from './sounds.ts';

/**
 * Minimal audio engine interface needed by FootstepAudio (matches `AudioEngine`
 * and allows deterministic headless unit tests without Web Audio globals).
 */
export interface FootstepAudioEngine {
  hasSound(name: SoundName): boolean;
  variantCount?(name: SoundName): number;
  play(name: SoundName, opts?: VoiceOptions): void;
  /** Looped sound (the wading slosh); engines without loops skip it. */
  loop?(name: SoundName, opts?: VoiceOptions): LoopHandle;
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
   * What lies on the line of sound from `from` to `to`: a wall or closed door muffles footsteps fully,
   * glass only lightly (see `wallOccluder`).
   */
  isOccluded?: Occluder;
  /** Depth of standing water at a foot (in-world-audio spec: steps in water are wading sounds by depth). */
  waterDepth?: (x: number, y: number, z: number) => number;
  /** Run `fn` after `ms` (the drips after a dry landing); defaults to setTimeout. */
  later?: (fn: () => void, ms: number) => void;
}

/** Thigh-deep wading steps from this depth (m) down; shallower ones are the splashier ankle-to-knee bank. */
export const WADE_DEEP = 0.45;
/** Feet this deep (m) count as in the water. */
const WET = 0.02;

/** The wading bank for a depth. */
export function wadeSound(depth: number): SoundName {
  return depth >= WADE_DEEP ? 'footWadeDeep' : 'footWadeShallow';
}

/** Max audible distance (m) for normal walking/jogging/shambling steps. */
export const FOOTSTEP_MAX_DISTANCE = 22;
/** Max audible distance (m) for heavy hero stomps. */
export const FOOTSTEP_HEAVY_MAX_DISTANCE = 30;
/** Distance (m) where smooth fade-out tail begins so steps never pop off at the cull edge. */
const FADE_START_DISTANCE = 13;

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
      return 'footWadeShallow';
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
    case 'lift':
      return 0;
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
    case 'lift':
      return 1.0;
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
  /** Water depth at each actor's last step (a first step into water splashes). */
  private readonly prevDepth = new Map<string, number>();
  /** The player's current jump started in water (a dry landing then drips). */
  private waterJumped = false;
  /** One slosh loop per wading body (in-world-audio spec: Wading slosh). */
  private readonly sloshes = new Map<string, { handle: LoopHandle; gain: number; idle: number }>();

  private depthAt(x: number, y: number, z: number, surface: string | null | undefined): number {
    return this.deps.waterDepth ? this.deps.waterDepth(x, y, z) : surface === 'water' ? 0.3 : 0;
  }

  /** The player jumped from the water: play the takeoff splash, and drips if he lands somewhere dry. */
  waterJump(x: number, y: number, z: number): void {
    this.waterJumped = true;
    if (this.deps.audio.hasSound('waterSplashTakeoff')) this.deps.audio.play('waterSplashTakeoff', { bus: 'sfx', position: new THREE.Vector3(x, y + 0.3, z), gain: 0.7, reverb: 0.25, occlude: false, variant: this.pickVariant('waterSplashTakeoff') });
  }
  private readonly probeTo = new THREE.Vector3();

  constructor(deps: FootstepAudioDeps) {
    this.deps = deps;
  }

  /** Play one footstep or landing from the player. */
  playPlayer(ev: FootstepPlayerEvent): void {
    const landing = ev.landing === true;
    const depth = this.depthAt(ev.x, ev.y, ev.z, ev.surface);
    const water = depth > WET;
    const prev = this.prevDepth.get('player') ?? 0;
    this.prevDepth.set('player', depth);
    const at = new THREE.Vector3(ev.x, ev.y + 0.05, ev.z);
    if (landing) {
      const fromWater = this.waterJumped;
      this.waterJumped = false;
      // In water a landing is a splash, not a step (in-world-audio spec: Jumping and landing in water).
      if (water && this.deps.audio.hasSound('waterSplashLand')) {
        this.deps.audio.play('waterSplashLand', { bus: 'sfx', position: at, gain: 0.85, reverb: 0.28, occlude: false, variant: this.pickVariant('waterSplashLand') });
        return;
      }
      if (!water && fromWater && this.deps.audio.hasSound('bodyDrip')) {
        (this.deps.later ?? ((fn, ms) => void setTimeout(fn, ms)))(() => this.deps.audio.play('bodyDrip', { bus: 'sfx', position: at, gain: 0.55, reverb: 0.2, occlude: false }), 140);
      }
    }
    // The first step into the water splashes (in-world-audio spec: Footsteps by surface).
    if (!landing && water && prev <= WET && this.deps.audio.hasSound('waterSplashStep')) {
      this.deps.audio.play('waterSplashStep', { bus: 'sfx', position: at, gain: 0.6, reverb: 0.22, occlude: false, variant: this.pickVariant('waterSplashStep') });
    }
    const sound = water ? wadeSound(depth) : soundForSurface(ev.surface);
    if (!this.deps.audio.hasSound(sound)) return;
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
      // The player's own steps are never behind a wall.
      occlude: false,
    };
    this.deps.audio.play(sound, opts);
  }

  /** Play one spatialized footstep from an NPC, squadmate, or enemy. */
  playCharacter(ev: FootstepEvent): void {
    // Foot lifts only drive water kick sprays (not dry-floor footsteps).
    if (ev.kind === 'lift') return;
    const listener = this.deps.listener();
    const dx = ev.x - listener.x;
    const dy = ev.y - listener.y;
    const dz = ev.z - listener.z;
    const dist = Math.hypot(dx, dy, dz);
    const maxDist = ev.kind === 'heavy' ? FOOTSTEP_HEAVY_MAX_DISTANCE : FOOTSTEP_MAX_DISTANCE;
    if (dist > maxDist) return;

    const surface = this.deps.surfaceAt(ev.x, ev.y, ev.z) ?? 'metal';
    const depth = this.depthAt(ev.x, ev.y, ev.z, surface);
    const firstWet = depth > WET && (this.prevDepth.get(ev.actor) ?? 0) <= WET;
    this.prevDepth.set(ev.actor, depth);
    const sound = depth > WET ? wadeSound(depth) : soundForSurface(surface);
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
    const occlusion: Occlusion = dist > OCCLUSION_MIN_DISTANCE ? (this.deps.isOccluded?.(listener, this.probeTo) ?? 'none') : 'none';
    const occluded = occlusion === 'wall';

    let gain = baseGainForKind(ev.kind, ev.speed) * tailGain;
    if (occluded) gain *= OCCLUDED_GAIN_SCALE;
    else if (occlusion === 'glass') gain *= GLASS_GAIN_SCALE;
    if (gain <= 0.004) return;

    // Distance air absorption (high frequencies soften with distance) + occlusion low-pass.
    let cutoff: number | undefined;
    if (occluded) {
      cutoff = OCCLUDED_CUTOFF_HZ;
    } else if (dist > 4) {
      const k = THREE.MathUtils.clamp((dist - 4) / (maxDist - 4), 0, 1);
      // Exponentially sweep from 16 kHz at 4 m down to ~3.2 kHz near max distance.
      cutoff = Math.round(16000 * Math.pow(3200 / 16000, k));
    }
    // Through glass only: slightly dulled (in-world-audio: Glass muffles lightly).
    if (occlusion === 'glass') cutoff = Math.min(cutoff ?? Infinity, GLASS_CUTOFF_HZ);

    const rate = this.deps.rng.range(0.95, 1.05) * rateScaleForKind(ev.kind) * (1 + actorPitchBias(ev.actor));
    const reverb = ev.kind === 'heavy' ? 0.42 : occluded ? OCCLUDED_REVERB : 0.22 + THREE.MathUtils.clamp((dist - 3) * 0.015, 0, 0.16);
    const variant = this.pickVariant(sound);

    const opts: VoiceOptions = {
      bus: 'sfx',
      position: new THREE.Vector3(ev.x, ev.y, ev.z),
      gain,
      reverb,
      rate,
      variant,
      // Occlusion is applied above (torso-height probe); the engine must not apply it a second time.
      occlude: false,
      ...(cutoff !== undefined ? { cutoff } : {}),
    };
    this.deps.audio.play(sound, opts);
    if (firstWet && this.deps.audio.hasSound('waterSplashStep')) this.deps.audio.play('waterSplashStep', { ...opts, gain: gain * 1.1, variant: this.pickVariant('waterSplashStep') });
  }

  /**
   * The slosh of a body moving through standing water (in-world-audio spec: Wading slosh): a loop that follows its
   * speed and depth and fades out within about half a second of stopping. Jay's own (`actor` "player") is heard
   * close; anyone else's is positional, cut past footstep range and quieter behind a wall, as their steps are.
   */
  slosh(actor: string, x: number, y: number, z: number, speed: number, dt: number): void {
    if (!this.deps.audio.loop || !this.deps.audio.hasSound('waterSlosh')) return;
    const depth = this.depthAt(x, y, z, null);
    const player = actor === 'player';
    let target = depth > 0.05 && speed > 0.15 ? Math.min(1, speed / 2.2) * (0.35 + Math.min(depth, 0.9)) * (player ? 0.45 : 0.6) : 0;
    let pos: THREE.Vector3 | null = null;
    if (!player && target > 0) {
      const l = this.deps.listener();
      const dist = Math.hypot(x - l.x, y - l.y, z - l.z);
      if (dist > FOOTSTEP_MAX_DISTANCE) target = 0;
      else {
        pos = new THREE.Vector3(x, y + 0.4, z);
        if (dist > FADE_START_DISTANCE) target *= Math.max(0, 1 - (dist - FADE_START_DISTANCE) / (FOOTSTEP_MAX_DISTANCE - FADE_START_DISTANCE)) ** 2;
        if (dist > OCCLUSION_MIN_DISTANCE && this.deps.isOccluded?.(l, this.probeTo.set(x, y + 1.35, z)) === 'wall') target *= OCCLUDED_GAIN_SCALE;
      }
    }
    let s = this.sloshes.get(actor);
    if (!s) {
      if (target <= 0.001) return;
      s = { handle: this.deps.audio.loop('waterSlosh', { bus: 'sfx', gain: 0, reverb: 0.2, ...(pos ? { position: pos } : {}), occlude: false }), gain: 0, idle: 0 };
      this.sloshes.set(actor, s);
    }
    if (pos) s.handle.setPosition?.(pos.x, pos.y, pos.z);
    // Time constant 0.12 s: about 0.5 s to fade out after stopping.
    s.handle.setGain(target, 0.12);
    s.gain = target;
    s.idle = target > 0.001 ? 0 : s.idle + dt;
    if (s.idle > 1.5) {
      s.handle.stop(0.1);
      this.sloshes.delete(actor);
    }
  }

  /** Stop every slosh (a restart or leaving the level). */
  stopSloshes(): void {
    for (const s of this.sloshes.values()) s.handle.stop(0.2);
    this.sloshes.clear();
    this.prevDepth.clear();
    this.waterJumped = false;
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
