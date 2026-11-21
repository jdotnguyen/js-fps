import type * as THREE from 'three';
import type { VoiceOptions } from './engine.ts';

/**
 * Sound occlusion (spec in-world-audio: Footstep range and occlusion, World sound occlusion, Glass muffles lightly):
 * one definition of "behind a wall" and one set of muffle values for footsteps and the engine.
 */

/** Low-pass cutoff (Hz) for a sound heard through a wall or closed door. */
export const OCCLUDED_CUTOFF_HZ = 520;
/** Gain multiplier for a sound heard through a wall or closed door. */
export const OCCLUDED_GAIN_SCALE = 0.42;
/** Minimum reverb send for a sound heard through a wall or closed door. */
export const OCCLUDED_REVERB = 0.34;
/** Low-pass cutoff (Hz) for a sound heard through glass only: slightly dulled, still clear. */
export const GLASS_CUTOFF_HZ = 2500;
/** Gain multiplier for a sound heard through glass only. */
export const GLASS_GAIN_SCALE = 0.75;
/** Sources this close to the listener are never occluded. */
export const OCCLUSION_MIN_DISTANCE = 0.6;
/** Cutoff the engine uses for `muffled: true` without an explicit `cutoff`. */
const MUFFLED_CUTOFF_HZ = 650;
/** Barriers whose top is at least this high block sound; lower ones let it diffract over. */
const BARRIER_TOP = 2.0;
/** The ray stops this far short of the source, so the source's own door leaf never blocks it. */
const SOURCE_CLEARANCE = 0.35;

/** What lies between the listener and a sound: nothing, only glass, or a wall or closed door. */
export type Occlusion = 'none' | 'glass' | 'wall';

/** Classifies the line of sound from `from` to `to`. */
export type Occluder = (from: THREE.Vector3, to: THREE.Vector3) => Occlusion;

/** The part of a collider the wall test reads. */
export interface OcclusionCollider {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  readonly acoustic?: 'glass';
}

/** The part of `CollisionWorld.raycast` the wall test needs; keeps this module free of world imports. */
export type OcclusionRaycast = (
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDistance: number,
) => { collider: OcclusionCollider; distance: number } | null;

/** Distance along a unit ray from (ox, oy, oz) at which it leaves the box. */
function exitDistance(c: OcclusionCollider, o: readonly number[], d: readonly number[]): number {
  let tExit = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]!) < 1e-9) continue;
    const t1 = (c.min[i]! - o[i]!) / d[i]!;
    const t2 = (c.max[i]! - o[i]!) / d[i]!;
    tExit = Math.min(tExit, Math.max(t1, t2));
  }
  return tExit;
}

/**
 * The wall test: a ray from the listener toward the source, stopping 0.35 m short so the source's own
 * door leaf never blocks it. Only full-height barriers (top at least 2 m) count, so counters and crates
 * let sound diffract over them. Open doors are disabled colliders and never block. Glass partitions give
 * `'glass'` unless a wall or closed door also lies on the line (design D8).
 */
export function wallOccluder(raycast: OcclusionRaycast): Occluder {
  return (from, to) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist <= 0.5) return 'none';
    const dir = [dx / dist, dy / dist, dz / dist] as const;
    const end = dist - SOURCE_CLEARANCE;
    let travelled = 0;
    let result: Occlusion = 'none';
    // A few panes in a row at most; each pass starts just past the glass it found.
    for (let pass = 0; pass < 4 && travelled < end; pass++) {
      const o = [from.x + dir[0] * travelled, from.y + dir[1] * travelled, from.z + dir[2] * travelled] as const;
      const hit = raycast(o[0], o[1], o[2], dir[0], dir[1], dir[2], end - travelled);
      if (!hit || hit.collider.max[1] < BARRIER_TOP) return result;
      if (hit.collider.acoustic !== 'glass') return 'wall';
      result = 'glass';
      travelled += Math.max(exitDistance(hit.collider, o, dir), hit.distance) + 1e-3;
    }
    return result;
  };
}

/**
 * Apply occlusion to a one-shot's options (design D1, D5, D8). Returns `opts` itself when the sound is not
 * eligible or nothing is in the way: it needs a position, the `sfx` bus, no `occlude: false`, an occluder,
 * and a source more than 0.6 m from the listener.
 */
export function occludeVoice(opts: VoiceOptions, listener: THREE.Vector3, occluder: Occluder | null): VoiceOptions {
  if (!occluder || !opts.position || opts.occlude === false || (opts.bus ?? 'sfx') !== 'sfx') return opts;
  if (opts.position.distanceTo(listener) <= OCCLUSION_MIN_DISTANCE) return opts;
  const occlusion = occluder(listener, opts.position);
  if (occlusion === 'none') return opts;
  const base = opts.cutoff ?? (opts.muffled ? MUFFLED_CUTOFF_HZ : Infinity);
  if (occlusion === 'glass') {
    return { ...opts, cutoff: Math.min(base, GLASS_CUTOFF_HZ), gain: (opts.gain ?? 1) * GLASS_GAIN_SCALE };
  }
  return {
    ...opts,
    cutoff: Math.min(base, OCCLUDED_CUTOFF_HZ),
    gain: (opts.gain ?? 1) * OCCLUDED_GAIN_SCALE,
    reverb: Math.max(opts.reverb ?? 0, OCCLUDED_REVERB),
  };
}
