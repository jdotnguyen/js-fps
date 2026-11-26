import * as THREE from 'three';
import type { Humanoid } from '../humanoid.ts';
import type { Side } from '../skeleton.ts';
import type { Collider, CollisionWorld } from '../../world/collision.ts';

/**
 * Blade clearance check (openspec rig-necromorph, design D9, task 7.2): samples both blade segments (hand joint to tip)
 * against a CollisionWorld's enabled boxes and reports the deepest penetration into any solid collider (metres).
 */

export interface BladePenetration {
  /** Deepest penetration of any blade sample into an enabled collider (0 when completely clear), metres. */
  depth: number;
  side: Side | null;
  fraction: number;
  point: THREE.Vector3 | null;
  collider: Collider | null;
}

export interface BladeClearanceOpts {
  /** Number of evenly spaced sample points along each blade (including root and tip). Default 9. */
  samples?: number;
  /** Optional predicate to skip colliders intentionally contacted (such as a door leaf being pried). */
  ignore?: (c: Collider) => boolean;
}

const tmp = new THREE.Vector3();

/** Measure how deeply either blade penetrates enabled colliders in `world` on this frame. */
export function measureBladePenetration(body: Humanoid, world: CollisionWorld, opts: BladeClearanceOpts = {}): BladePenetration {
  const samples = Math.max(2, opts.samples ?? 9);
  const best: BladePenetration = { depth: 0, side: null, fraction: 0, point: null, collider: null };
  for (const side of ['L', 'R'] as const) {
    if (body.bones[`hand_${side}`].scale.x < 0.01) continue;
    for (let i = 0; i < samples; i++) {
      const f = i / (samples - 1);
      const p = body.bladePoint(side, f, tmp);
      for (const c of world.colliders) {
        if (!c.enabled) continue;
        if (opts.ignore?.(c)) continue;
        if (p.x <= c.minX || p.x >= c.maxX || p.y <= c.minY || p.y >= c.maxY || p.z <= c.minZ || p.z >= c.maxZ) continue;
        const d = Math.min(p.x - c.minX, c.maxX - p.x, p.y - c.minY, c.maxY - p.y, p.z - c.minZ, c.maxZ - p.z);
        if (d > best.depth) {
          best.depth = d;
          best.side = side;
          best.fraction = f;
          best.point = p.clone();
          best.collider = c;
        }
      }
    }
  }
  return best;
}
