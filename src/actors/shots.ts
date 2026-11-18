import * as THREE from 'three';
import type { HitResult } from './damage.ts';
import type { BodyHit } from './humanoid.ts';
import type { Aabb, ColliderQuery } from './motor.ts';

/**
 * Player hitscan (ADR-0005 "Firing and hits"): rays from the camera centre with spread, tested
 * against the level colliders and enemy hit capsules (ADR-0006). First hit wins; pellets resolve
 * independently. Damage numbers follow the ADR-0005 table [Assumed]. The viewmodel owns ammo and
 * animation and only emits `weapon:fired`; this turns that into hits.
 */

export interface WeaponHitSpec {
  damage: number;
  pellets: number;
  /** Spread half-angle (radians) from the hip and fully aimed. */
  hip: number;
  aim: number;
  range: number;
  /** Damage falloff: full to `from`, down to `min` share at `to` metres. */
  falloff: { from: number; to: number; min: number } | null;
  /** Pellets on one body in one shot that knock it back (shotgun "high stagger power"). */
  staggerPellets: number;
}

export const WEAPON_HITS: Record<'pistol' | 'shotgun', WeaponHitSpec> = {
  pistol: { damage: 18, pellets: 1, hip: 0.02, aim: 0.004, range: 60, falloff: null, staggerPellets: Infinity },
  shotgun: { damage: 9, pellets: 8, hip: 0.075, aim: 0.055, range: 40, falloff: { from: 6, to: 12, min: 0.5 }, staggerPellets: 3 },
};

/** What the shots hit: the enemy director implements this. */
export interface ShotTargets {
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): BodyHit | null;
  applyHit(hit: BodyHit, amount: number, dir: THREE.Vector3, by: string): HitResult | null;
}

export interface ShotReport {
  /** Pellets that hit a body. */
  bodyHits: number;
  /** Bodies hit and how many pellets each took. */
  perBody: Map<BodyHit['humanoid'], number>;
  /** Nearest world impact of the first pellet, if it hit a wall (for sparks and decals). */
  wall: THREE.Vector3 | null;
}

/** Distance along a normalised ray to the first collider, or Infinity. Uses `raycast` when the world has one. */
export function rayWorld(world: ColliderQuery, o: THREE.Vector3, d: THREE.Vector3, max: number): number {
  const fast = (world as { raycast?: (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, m: number) => { distance: number } | null }).raycast;
  if (typeof fast === 'function') {
    const hit = fast.call(world, o.x, o.y, o.z, d.x, d.y, d.z, max);
    return hit ? hit.distance : Infinity;
  }
  const ex = o.x + d.x * max;
  const ez = o.z + d.z * max;
  const boxes = world.query(Math.min(o.x, ex), Math.min(o.z, ez), Math.max(o.x, ex), Math.max(o.z, ez), []);
  let best = Infinity;
  for (const b of boxes) {
    const t = rayAabb(o, d, b);
    if (t !== null && t <= max && t < best) best = t;
  }
  return best;
}

function rayAabb(o: THREE.Vector3, d: THREE.Vector3, b: Aabb): number | null {
  let t0 = 0;
  let t1 = Infinity;
  const os = [o.x, o.y, o.z];
  const ds = [d.x, d.y, d.z];
  for (let k = 0; k < 3; k++) {
    const ok = os[k]!;
    const dk = ds[k]!;
    if (Math.abs(dk) < 1e-12) {
      if (ok < b.min[k]! || ok > b.max[k]!) return null;
      continue;
    }
    let ta = (b.min[k]! - ok) / dk;
    let tb = (b.max[k]! - ok) / dk;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return t0;
}

const ray = new THREE.Vector3();
const axis = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const side = new THREE.Vector3();
const q = new THREE.Quaternion();

/**
 * Fire one shot: `pellets` rays around `view` (normalised) from `origin`. `aimBlend` 0..1 narrows the
 * spread; `random` gives 0..1 values (Math.random in game, seeded in tests).
 */
export function fireShot(spec: WeaponHitSpec, origin: THREE.Vector3, view: THREE.Vector3, aimBlend: number, world: ColliderQuery, targets: ShotTargets, random: () => number = Math.random, by = 'player'): ShotReport {
  const report: ShotReport = { bodyHits: 0, perBody: new Map(), wall: null };
  const spread = spec.hip + (spec.aim - spec.hip) * Math.min(1, Math.max(0, aimBlend));
  side.crossVectors(view, up);
  if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
  side.normalize();
  for (let p = 0; p < spec.pellets; p++) {
    ray.copy(view);
    if (spread > 0) {
      // Uniform over the cone's disc: a random tilt off the view around a random roll.
      const roll = random() * Math.PI * 2;
      const tilt = Math.sqrt(random()) * spread;
      axis.copy(side).applyAxisAngle(view, roll);
      q.setFromAxisAngle(axis, tilt);
      ray.applyQuaternion(q).normalize();
    }
    const wall = rayWorld(world, origin, ray, spec.range);
    const limit = Math.min(wall, spec.range);
    const hit = targets.raycast(origin, ray, limit);
    if (!hit) {
      if (p === 0 && Number.isFinite(wall)) report.wall = origin.clone().addScaledVector(ray, wall);
      continue;
    }
    const f = spec.falloff;
    const share = f ? 1 - (1 - f.min) * Math.min(1, Math.max(0, (hit.distance - f.from) / (f.to - f.from))) : 1;
    targets.applyHit(hit, spec.damage * share, ray.clone(), by);
    report.bodyHits++;
    report.perBody.set(hit.humanoid, (report.perBody.get(hit.humanoid) ?? 0) + 1);
  }
  return report;
}
