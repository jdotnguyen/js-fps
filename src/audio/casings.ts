import * as THREE from 'three';
import type { EventBus } from '../core/events.ts';
import { Rng } from '../core/rng.ts';
import type { ColliderSurface } from '../world/collision.ts';
import type { VoiceOptions } from './engine.ts';
import type { SoundName } from './sounds.ts';

/**
 * Spent casings landing (in-world-audio spec: Spent casings land after the gun ejects them, and the requirements after
 * it; openspec change casing-drop-audio). Audio only: nothing is drawn and no body is simulated. Where a casing lands
 * is resolved once, when it leaves the gun (design D1), and the landing plays a whole recorded drop for that surface.
 *
 * `CasingAudio.eject` is the single entry point, used for Jay's guns and, later, anything else that ejects brass.
 */

export type CasingKind = 'brass' | 'hull';
/** What a casing lands on, as far as its sound goes. Rubber and carpet are both `soft`. */
export type CasingSurface = 'concrete' | 'metal' | 'grate' | 'soft' | 'shallow' | 'deep';

/** The parts of the level a landing needs. */
export interface CasingWorld {
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDistance: number): { distance: number; collider?: { minY: number } } | null;
  surfaceAt(x: number, y: number, z: number): ColliderSurface | null;
  waterDepth?(x: number, y: number, z: number): number;
}

/** A casing leaving the gun. `right` and `forward` are the shooter's horizontal axes (need not be unit length). */
export interface CasingEjection {
  kind: CasingKind;
  x: number;
  y: number;
  z: number;
  rightX: number;
  rightZ: number;
  forwardX: number;
  forwardZ: number;
}

export interface CasingTouch {
  x: number;
  y: number;
  z: number;
  surface: CasingSurface;
  /** Seconds after ejection. */
  delay: number;
}
/** A resolved landing; `under` is the second landing of a casing that fell through a grate. */
export interface CasingLanding extends CasingTouch {
  under?: CasingTouch;
}

const G = 9.81;
/** Landing delay window (s) after the casing leaves the gun. */
export const CASING_DELAY_MIN = 0.35;
export const CASING_DELAY_MAX = 0.7;
/** Sideways (to the shooter's right) and forward landing offsets (m). */
export const CASING_LATERAL: readonly [number, number] = [0.4, 1.5];
export const CASING_FORWARD: readonly [number, number] = [-0.2, 0.5];
/** How far below a grate a falling-through casing can land (m), and how often it falls through. */
export const GRATE_FALL_MAX = 3;
export const GRATE_FALL_CHANCE = 0.4;
/** Water at least this deep (m) plips; from WADE_DEEP down it swallows the casing (matches footsteps). */
const WET = 0.02;
const DEEP = 0.45;
/** Casings stop short of a wall by this much (m). */
const WALL_GAP = 0.08;
/** Longest downward look for a floor (m); nothing within it means nothing is heard. */
const FLOOR_LOOK = 4;

function classify(surface: ColliderSurface | null, depth: number): CasingSurface {
  if (depth >= DEEP) return 'deep';
  // A `water` tag with no depth data reads as shallow, as footsteps do.
  if (depth > WET || surface === 'water') return 'shallow';
  switch (surface) {
    case 'concrete':
      return 'concrete';
    case 'grate':
      return 'grate';
    case 'rubber':
      return 'soft';
    case 'metal':
    case null:
    default:
      return 'metal';
  }
}

function fallTime(h: number): number {
  return Math.sqrt((2 * Math.max(0, h)) / G);
}

function touchAt(world: CasingWorld, x: number, floorY: number, z: number): { surface: CasingSurface } {
  const surface = world.surfaceAt(x, floorY, z);
  const depth = world.waterDepth ? world.waterDepth(x, floorY, z) : 0;
  return { surface: classify(surface, depth) };
}

/**
 * Where a casing lands and what on (design D1, D2). Pure and deterministic for a given seed. Returns null when there
 * is no floor within FLOOR_LOOK below the landing point.
 */
export function resolveCasingLanding(ej: CasingEjection, world: CasingWorld, seed: number): CasingLanding | null {
  const rng = new Rng(seed);
  const lateral = rng.range(CASING_LATERAL[0], CASING_LATERAL[1]);
  const forward = rng.range(CASING_FORWARD[0], CASING_FORWARD[1]);
  const jitter = rng.range(0, 0.1);
  const fallRoll = rng.next();
  const rl = Math.hypot(ej.rightX, ej.rightZ) || 1;
  const fl = Math.hypot(ej.forwardX, ej.forwardZ) || 1;
  let ox = (ej.rightX / rl) * lateral + (ej.forwardX / fl) * forward;
  let oz = (ej.rightZ / rl) * lateral + (ej.forwardZ / fl) * forward;
  let len = Math.hypot(ox, oz);
  if (len > 1e-6) {
    // Never through a wall: stop short of whatever is between the gun and the landing spot.
    const wall = world.raycast(ej.x, ej.y, ej.z, ox / len, 0, oz / len, len);
    if (wall && wall.distance < len) {
      const k = Math.max(0, wall.distance - WALL_GAP) / len;
      ox *= k;
      oz *= k;
      len *= k;
    }
  }
  const x = ej.x + ox;
  const z = ej.z + oz;
  const floor = world.raycast(x, ej.y, z, 0, -1, 0, FLOOR_LOOK);
  if (!floor) return null;
  const y = ej.y - floor.distance;
  const delay = THREE.MathUtils.clamp(fallTime(ej.y - y) + jitter, CASING_DELAY_MIN, CASING_DELAY_MAX);
  const landing: CasingLanding = { x, y, z, delay, ...touchAt(world, x, y, z) };
  if (landing.surface === 'grate' && fallRoll < GRATE_FALL_CHANCE) {
    const from = (floor.collider ? floor.collider.minY : y - 0.05) - 0.01;
    const below = world.raycast(x, from, z, 0, -1, 0, GRATE_FALL_MAX);
    if (below) {
      const y2 = from - below.distance;
      landing.under = { x, y: y2, z, delay: delay + fallTime(y - y2), ...touchAt(world, x, y2, z) };
    }
  }
  return landing;
}

/**
 * Jay's guns eject (in-world-audio: Spent casings land after the gun ejects them): brass on every pistol shot, and a
 * hull on the first pump after a shotgun shot, so the racks on draw and wield eject nothing. A dry fire or a shell
 * inserted during a reload ejects nothing. Calls `eject` only, and emits nothing on the bus, so a casing never reaches
 * infected hearing. Returns the unsubscribe.
 */
export function ejectOnWeaponEvents(events: EventBus, eject: (kind: CasingKind) => void): () => void {
  let spentHull = false;
  const offs = [
    events.on('weapon:fired', ({ weapon }) => {
      if (weapon === 'pistol') eject('brass');
      else spentHull = true;
    }),
    events.on('weapon:cue', ({ cue }) => {
      if (cue !== 'pump' || !spentHull) return;
      spentHull = false;
      eject('hull');
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}

export interface CasingSound {
  sound: SoundName;
  gain: number;
  rate: number;
}

/**
 * Bank, gain and base rate for a casing on a surface (design D3, D6). Every bank's clips peak at the same level, so
 * the gains here set the surface: soft floors sit about 9 dB under concrete. Deep water is silent.
 */
export function casingSound(kind: CasingKind, surface: CasingSurface): CasingSound | null {
  const brass = kind === 'brass';
  switch (surface) {
    case 'concrete':
      return brass ? { sound: 'casingBrassConcrete', gain: 0.42, rate: 1 } : { sound: 'casingHullConcrete', gain: 0.5, rate: 1 };
    case 'metal':
      return brass ? { sound: 'casingBrassMetal', gain: 0.42, rate: 1 } : { sound: 'casingHullMetal', gain: 0.5, rate: 1 };
    case 'grate':
      return brass ? { sound: 'casingBrassGrate', gain: 0.38, rate: 1 } : { sound: 'casingHullGrate', gain: 0.45, rate: 1 };
    case 'soft':
      return brass ? { sound: 'casingBrassSoft', gain: 0.15, rate: 1 } : { sound: 'casingHullSoft', gain: 0.18, rate: 1 };
    case 'shallow':
      return brass ? { sound: 'casingWater', gain: 0.3, rate: 1 } : { sound: 'casingWater', gain: 0.32, rate: 0.82 };
    case 'deep':
      return null;
  }
}

/** Most casing sounds playing at once; the oldest fades out when another starts. */
export const CASING_VOICES = 4;
/** Fade (s) for a casing voice pushed out by a newer one. */
export const CASING_STEAL_FADE = 0.05;
/** Farthest a casing is heard (m); it fades out over the last few metres. */
export const CASING_RANGE = 8;
const CASING_FADE_FROM = 5;
/** How long a casing voice counts toward the limit (s): the longest clip is 1.1 s. */
const VOICE_LIFE = 1.2;
/** A fall-through landing is about 8 dB down and duller. */
const UNDER_GAIN = 0.4;
const UNDER_CUTOFF = 2500;

export interface CasingAudioEngine {
  hasSound(name: SoundName): boolean;
  variantCount?(name: SoundName): number;
  play(name: SoundName, opts?: VoiceOptions): { stop(fadeSeconds?: number): void } | void;
}

export interface CasingAudioDeps {
  audio: CasingAudioEngine;
  world: CasingWorld;
  listener: () => THREE.Vector3;
  rng?: Rng;
  /** Run `fn` after `ms`; defaults to setTimeout. */
  later?: (fn: () => void, ms: number) => void;
  /** Clock in seconds; defaults to performance.now(). */
  now?: () => number;
}

interface Voice {
  stop(fadeSeconds?: number): void;
  until: number;
}

export class CasingAudio {
  private readonly deps: CasingAudioDeps;
  private readonly rng: Rng;
  private readonly later: (fn: () => void, ms: number) => void;
  private readonly now: () => number;
  private readonly lastVariant = new Map<SoundName, number>();
  private readonly voices: Voice[] = [];
  private seed = 1;
  /** Bumped by stopAll so landings scheduled before it never play. */
  private generation = 0;

  constructor(deps: CasingAudioDeps) {
    this.deps = deps;
    this.rng = deps.rng ?? new Rng('casings');
    this.later = deps.later ?? ((fn, ms) => void setTimeout(fn, ms));
    this.now = deps.now ?? (() => performance.now() / 1000);
  }

  /** A casing left a gun: work out where it lands and schedule its landing (and any fall-through) sound. */
  eject(ej: CasingEjection): CasingLanding | null {
    const landing = resolveCasingLanding(ej, this.deps.world, this.seed++);
    if (!landing) return null;
    const gen = this.generation;
    this.later(() => gen === this.generation && this.land(ej.kind, landing, false), landing.delay * 1000);
    const under = landing.under;
    if (under) this.later(() => gen === this.generation && this.land(ej.kind, under, true), under.delay * 1000);
    return landing;
  }

  /** Stop every casing sound and drop the landings still in the air (a restart or leaving the level). */
  stopAll(): void {
    this.generation++;
    for (const v of this.voices) v.stop(CASING_STEAL_FADE);
    this.voices.length = 0;
  }

  private land(kind: CasingKind, at: CasingTouch, under: boolean): void {
    const pick = casingSound(kind, at.surface);
    if (!pick || !this.deps.audio.hasSound(pick.sound)) return;
    const l = this.deps.listener();
    const dist = Math.hypot(at.x - l.x, at.y - l.y, at.z - l.z);
    if (dist > CASING_RANGE) return;
    const tail = dist <= CASING_FADE_FROM ? 1 : (1 - (dist - CASING_FADE_FROM) / (CASING_RANGE - CASING_FADE_FROM)) ** 2;
    const gain = pick.gain * tail * (under ? UNDER_GAIN : 1);
    if (gain <= 0.004) return;

    const now = this.now();
    for (let i = this.voices.length - 1; i >= 0; i--) if (this.voices[i]!.until <= now) this.voices.splice(i, 1);
    while (this.voices.length >= CASING_VOICES) this.voices.shift()!.stop(CASING_STEAL_FADE);

    const handle = this.deps.audio.play(pick.sound, {
      bus: 'sfx',
      // Just above the floor, so the occlusion probe is not blocked by the floor the casing lies on.
      position: new THREE.Vector3(at.x, at.y + 0.06, at.z),
      gain,
      reverb: 0.15,
      rate: pick.rate * this.rng.range(0.94, 1.06),
      variant: this.pickVariant(pick.sound),
      ...(under ? { cutoff: UNDER_CUTOFF } : {}),
    });
    if (handle) this.voices.push({ stop: (f) => handle.stop(f), until: now + VOICE_LIFE });
  }

  /** A variant other than the one this bank played last. */
  private pickVariant(sound: SoundName): number {
    const count = Math.max(1, this.deps.audio.variantCount?.(sound) ?? 4);
    if (count === 1) return 0;
    const prev = this.lastVariant.get(sound);
    let next = this.rng.int(0, count - 1);
    if (next === prev) next = (next + 1 + this.rng.int(0, count - 2)) % count;
    this.lastVariant.set(sound, next);
    return next;
  }
}
