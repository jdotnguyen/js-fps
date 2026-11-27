import * as THREE from 'three';
import { Rng } from '../core/rng.ts';
import type { PropSound } from '../data/types/level.ts';
import type { CasingAudioEngine } from './casings.ts';
import type { SoundName } from './sounds.ts';

/**
 * Things hitting things (openspec change adopt-physics-engine, design D16): loose props and severed pieces. Physics
 * says what was struck, where and how hard (`src/physics/interaction.ts`, `debris.ts`); this picks the recording, its
 * level, and keeps a crash of many objects from turning into noise. Audio only: nothing is emitted on the event bus, so
 * none of it reaches infected hearing.
 */

export type ImpactMaterial = PropSound | 'flesh';

export interface Impact {
  /** The thing that hit: one thing's sounds are spaced apart. */
  id: string;
  material: ImpactMaterial;
  x: number;
  y: number;
  z: number;
  /** How sharply its motion changed (m/s). */
  speed: number;
}

export interface ImpactSound {
  sound: SoundName;
  gain: number;
  /** A crash or a hard drop: kept when voices run out, and not repeated by the bounces right after it. */
  hard: boolean;
  /** Seconds before the same thing may sound again. */
  rest: number;
  /** Seconds it counts toward the voice limit: about the length of its clips. */
  life: number;
}

/** Slower changes than this (m/s) are silent: resting, creeping and the settle when a room loads. */
export const IMPACT_MIN_SPEED = 0.5;
/** Voice-limit life (s) of the short taps. */
const TAP_LIFE = 0.6;
/** Gain at the quietest audible hit, as a share of the material's full gain. */
const QUIET_SHARE = 0.2;

interface Voicing {
  sound: SoundName;
  gain: number;
  /** Speed (m/s) at which it reaches full gain. */
  full: number;
  rest: number;
  /** A different recording for a hit at least this fast. */
  hard?: { from: number; sound: SoundName; gain: number; rest: number; life: number };
}

/** Every clip peaks at the same level, so these gains set how loud each thing is. */
const VOICINGS: Readonly<Record<ImpactMaterial, Voicing>> = {
  // The shove that tips the cart is a knock (about 1.7 m/s); its landing on the floor is the crash.
  cart: { sound: 'propCartKnock', gain: 0.55, full: 2, rest: 0.25, hard: { from: 2.2, sound: 'propCartCrash', gain: 0.75, rest: 1, life: 1.8 } },
  glass: { sound: 'propGlass', gain: 0.35, full: 2.5, rest: 0.15, hard: { from: 2.2, sound: 'propGlassHard', gain: 0.5, rest: 0.6, life: 1.2 } },
  metal: { sound: 'propMetal', gain: 0.4, full: 3.5, rest: 0.15 },
  thud: { sound: 'propThud', gain: 0.5, full: 3.5, rest: 0.2 },
  // The R08 kidney dish (livelier-cart-slam D7): a clink when nudged; landing hard, it spins down to rest. The long
  // rest keeps its own bounces from cutting the spin off.
  dish: { sound: 'propMetal', gain: 0.4, full: 3.5, rest: 0.15, hard: { from: 1.5, sound: 'propDishSpin', gain: 0.6, rest: 3, life: 2.6 } },
  flesh: { sound: 'limbThud', gain: 0.5, full: 5, rest: 0.25 },
};

/** The recording and level for a hit, or null when it is too soft to hear. */
export function impactSound(material: ImpactMaterial, speed: number): ImpactSound | null {
  if (speed < IMPACT_MIN_SPEED) return null;
  const v = VOICINGS[material];
  const hard = v.hard && speed >= v.hard.from ? v.hard : null;
  if (hard) return { sound: hard.sound, gain: hard.gain, hard: true, rest: hard.rest, life: hard.life };
  const t = THREE.MathUtils.clamp((speed - IMPACT_MIN_SPEED) / (v.full - IMPACT_MIN_SPEED), 0, 1);
  return { sound: v.sound, gain: v.gain * (QUIET_SHARE + (1 - QUIET_SHARE) * t), hard: false, rest: v.rest, life: material === 'flesh' ? 1 : TAP_LIFE };
}

/** Most impact sounds playing at once. */
export const IMPACT_VOICES = 6;
/** Fade (s) for a voice pushed out by a newer one. */
const STEAL_FADE = 0.05;
/** Farthest an impact is heard (m); it fades out over the last few metres. */
export const IMPACT_RANGE = 16;
const FADE_FROM = 10;
const REVERB = 0.2;
/**
 * Things a scripted crash throws (a sweep, a tip and its load: voss-death-scene D10) play at this share of their gain for
 * this many seconds, beneath the crash's own designed sound.
 */
export const SCRIPTED_DUCK = { gain: 0.35, s: 1.5 } as const;

export interface ImpactAudioDeps {
  audio: CasingAudioEngine;
  listener: () => THREE.Vector3;
  rng?: Rng;
  /** Clock in seconds; defaults to performance.now(). */
  now?: () => number;
}

interface Voice {
  stop(fadeSeconds?: number): void;
  until: number;
  hard: boolean;
}

export class ImpactAudio {
  private readonly deps: ImpactAudioDeps;
  private readonly rng: Rng;
  private readonly now: () => number;
  private readonly lastVariant = new Map<SoundName, number>();
  private readonly resting = new Map<string, { until: number; hard: boolean }>();
  /** Things a scripted crash threw, and until when their impacts are ducked. */
  private readonly ducked = new Map<string, number>();
  private voices: Voice[] = [];

  constructor(deps: ImpactAudioDeps) {
    this.deps = deps;
    this.rng = deps.rng ?? new Rng('impacts');
    this.now = deps.now ?? (() => performance.now() / 1000);
  }

  /** Play a hit if it is loud enough, near enough and there is room for it. Returns the sound played. */
  play(hit: Impact): SoundName | null {
    const pick = impactSound(hit.material, hit.speed);
    if (!pick || !this.deps.audio.hasSound(pick.sound)) return null;
    const l = this.deps.listener();
    const dist = Math.hypot(hit.x - l.x, hit.y - l.y, hit.z - l.z);
    if (dist >= IMPACT_RANGE) return null;
    const tail = dist <= FADE_FROM ? 1 : (1 - (dist - FADE_FROM) / (IMPACT_RANGE - FADE_FROM)) ** 2;

    const now = this.now();
    const rest = this.resting.get(hit.id);
    // A crash may interrupt a thing's quiet spell after a tap, never the other way round.
    if (rest && now < rest.until && !(pick.hard && !rest.hard)) return null;

    this.voices = this.voices.filter((v) => v.until > now);
    if (this.voices.length >= IMPACT_VOICES) {
      let out = this.voices.findIndex((v) => !v.hard);
      if (out < 0) {
        if (!pick.hard) return null;
        out = 0;
      }
      this.voices.splice(out, 1)[0]!.stop(STEAL_FADE);
    }

    const jitter = hit.material === 'flesh' ? 0.12 : 0.06;
    const handle = this.deps.audio.play(pick.sound, {
      bus: 'sfx',
      // Just above the point of impact, so the occlusion probe is not blocked by what was struck.
      position: new THREE.Vector3(hit.x, hit.y + 0.06, hit.z),
      gain: pick.gain * tail * (now < (this.ducked.get(hit.id) ?? -Infinity) ? SCRIPTED_DUCK.gain : 1),
      reverb: REVERB,
      rate: this.rng.range(1 - jitter, 1 + jitter),
      variant: this.pickVariant(pick.sound),
    });
    this.resting.set(hit.id, { until: now + pick.rest, hard: pick.hard });
    if (handle) this.voices.push({ stop: (f) => handle.stop(f), until: now + pick.life, hard: pick.hard });
    return pick.sound;
  }

  /** A scripted crash threw this thing: its impacts play quieter for `SCRIPTED_DUCK.s` (D10). */
  duck(id: string): void {
    this.ducked.set(id, this.now() + SCRIPTED_DUCK.s);
  }

  /** Stop everything (a restart or leaving the level). */
  stopAll(): void {
    for (const v of this.voices) v.stop(STEAL_FADE);
    this.voices = [];
    this.resting.clear();
    this.ducked.clear();
  }

  /** A variant other than the one this bank played last. */
  private pickVariant(sound: SoundName): number {
    const count = Math.max(1, this.deps.audio.variantCount?.(sound) ?? 1);
    if (count === 1) return 0;
    const prev = this.lastVariant.get(sound);
    let next = this.rng.int(0, count - 1);
    if (next === prev) next = (next + 1 + this.rng.int(0, count - 2)) % count;
    this.lastVariant.set(sound, next);
    return next;
  }
}
