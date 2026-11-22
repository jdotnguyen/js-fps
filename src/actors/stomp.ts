/**
 * The player's stomp (adopt-physics-engine Block 5, design D11; spec physical-interaction "Corpses can be stomped").
 *
 * The player raises a boot and brings it down just ahead of their feet (`player:stomp`). The nearest limb, head or
 * hand on the floor under it takes stomp damage: a corpse's part loses HP and comes off as severed debris at its
 * sever threshold (`BodyDamage.applyToCorpse`), a living body takes an ordinary hit. Loose physical bodies under
 * the boot (severed pieces, physics props, later ragdolls) get a downward-forward shove, and the stomp plays a boot
 * thud plus a crunch when it hits flesh. The sounds are existing recordings (`footConcrete`, `kill_crunch`).
 */
import * as THREE from 'three';
import { JOINTS, type JointName, type Region } from './skeleton.ts';
import type { BodyHit, Humanoid } from './humanoid.ts';
import type { HitResult } from './damage.ts';

export const STOMP = {
  /** Damage per stomp. A shambler's parts have 11-16 HP (base 45), so an arm, leg or head takes two stomps. */
  damage: 9,
  /** How far ahead of the feet the boot lands (m). */
  ahead: 0.55,
  /** How far from where the boot lands a part can be and still be hit (m, horizontally). */
  reach: 0.45,
  /** Parts higher than this above the player's feet are out of a stomp's reach (m): only bodies on the floor. */
  maxHeight: 0.55,
  /** Impulse on loose physical bodies under the boot (N·s), straight down plus a little forward. */
  impulse: 6,
};

/** The joints a stomp can land on, with the region they belong to (hands and feet count for their forearm and shin). */
const STOMPABLE: ReadonlyArray<{ joint: JointName; region: Region }> = JOINTS.flatMap((j): Array<{ joint: JointName; region: Region }> => {
  if (j.name === 'hand_L' || j.name === 'hand_R') return [{ joint: j.name, region: j.name === 'hand_L' ? 'foreArm_L' : 'foreArm_R' }];
  if (j.name === 'foot_L' || j.name === 'foot_R') return [{ joint: j.name, region: j.name === 'foot_L' ? 'shin_L' : 'shin_R' }];
  return j.region && j.region !== 'torso' ? [{ joint: j.name, region: j.region }] : [];
});

/** Where the boot comes down: `ahead` metres along the flat view direction from the feet. */
export function stompPoint(feet: { x: number; y: number; z: number }, forward: { x: number; z: number }, out = new THREE.Vector3()): THREE.Vector3 {
  const len = Math.hypot(forward.x, forward.z) || 1;
  return out.set(feet.x + (forward.x / len) * STOMP.ahead, feet.y, feet.z + (forward.z / len) * STOMP.ahead);
}

/**
 * The part a boot landing at `at` hits: the nearest stompable joint of any body within `reach` horizontally and
 * no higher than `maxHeight` above `at`. Corpses win over living bodies at equal distance. Null when nothing is
 * under the boot.
 */
export function pickStompHit(at: THREE.Vector3, bodies: Iterable<Humanoid>): BodyHit | null {
  let best: BodyHit | null = null;
  let bestScore = Infinity;
  const p = new THREE.Vector3();
  for (const humanoid of bodies) {
    for (const { joint, region } of STOMPABLE) {
      if (humanoid.damage.isSevered(region)) continue;
      humanoid.jointWorld(joint, p);
      const dy = p.y - at.y;
      if (dy > STOMP.maxHeight || dy < -0.3) continue;
      const d = Math.hypot(p.x - at.x, p.z - at.z);
      if (d > STOMP.reach) continue;
      const score = d + (humanoid.alive ? 0.05 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = { humanoid, joint, region, distance: d, point: p.clone() };
      }
    }
  }
  return best;
}

export interface StompDeps {
  /** Every body a stomp can land on (enemies and their corpses). */
  bodies: () => Iterable<Humanoid>;
  /** Play a sound at a point (`bus: 'sfx'`, positional). */
  sound?: (name: 'footConcrete' | 'kill_crunch', at: THREE.Vector3, gain: number, rate: number) => void;
  /** Shove loose physical bodies in a box around `at` (null with physics off). */
  shove?: (at: THREE.Vector3, halfExtent: number, impulse: THREE.Vector3) => void;
}

/** Resolve one stomp landing at `at`, the player facing `forward`. Returns the hit result, or null on bare floor. */
export function stomp(at: THREE.Vector3, forward: THREE.Vector3, deps: StompDeps): HitResult | null {
  const flat = new THREE.Vector3(forward.x, 0, forward.z);
  if (flat.lengthSq() < 1e-6) flat.set(0, 0, -1);
  flat.normalize();
  deps.sound?.('footConcrete', at, 1.1, 0.7);
  deps.shove?.(at, STOMP.reach, new THREE.Vector3(flat.x * 0.3, -1, flat.z * 0.3).multiplyScalar(STOMP.impulse));
  const hit = pickStompHit(at, deps.bodies());
  if (!hit) return null;
  // Thrown forward and a little up, so a severed part clears the body it came off.
  const throwDir = flat.clone().add(new THREE.Vector3(0, 0.3, 0)).normalize();
  const result = hit.humanoid.stompHit(hit, STOMP.damage, throwDir);
  deps.sound?.('kill_crunch', hit.point, result.severed ? 1 : 0.7, result.severed ? 0.9 : 1.05);
  return result;
}
