import * as THREE from 'three';

/**
 * A prop going over on a scripted track (voss-death-scene D8): from where it stands to its authored `after` pose, as a
 * yaw about its own origin, a roll about a bottom edge on the floor, and whatever slide is left over. The track is the
 * same with physics on and off, so the cart lands on the same frame in the same pose; physics only rides along.
 */

export interface PropPose {
  pos: THREE.Vector3;
  rotation: THREE.Quaternion;
}

export interface TipPlan {
  from: PropPose;
  to: PropPose;
  /** Turn about the vertical through its origin (the twist of the whole turn about world up). */
  yaw: THREE.Quaternion;
  /** The rest of the turn, about a horizontal axis: the fall. */
  roll: THREE.Quaternion;
  /** A point on the edge it rolls over (the floor under its origin, `edge` m toward the fall). */
  pivot: THREE.Vector3;
  /** What the roll alone leaves short of the `after` position. */
  slide: THREE.Vector3;
  /** The way it falls across the floor (unit, horizontal), or zero when it does not roll. */
  fall: THREE.Vector3;
  /** `[u, slide, yaw, roll]` keys, or null for the default curves. */
  keys: ReadonlyArray<readonly number[]> | null;
}

const UP = new THREE.Vector3(0, 1, 0);
const IDENTITY = new THREE.Quaternion();

/** Plan a tip from `from` to `to`, rolling over the edge `edge` m out from the origin toward the fall. */
export function planTip(from: PropPose, to: PropPose, edge = 0, keys?: ReadonlyArray<readonly number[]>): TipPlan {
  const turn = to.rotation.clone().multiply(from.rotation.clone().invert());
  if (turn.w < 0) turn.set(-turn.x, -turn.y, -turn.z, -turn.w);
  // Swing-twist about world up: turn = roll * yaw.
  const yaw = new THREE.Quaternion(0, turn.y, 0, turn.w);
  if (yaw.lengthSq() < 1e-12) yaw.identity();
  else yaw.normalize();
  const roll = turn.clone().multiply(yaw.clone().invert());
  if (roll.w < 0) roll.set(-roll.x, -roll.y, -roll.z, -roll.w);
  // Where its top ends up, flattened: the way it falls.
  const fall = UP.clone().applyQuaternion(to.rotation).setY(0);
  if (fall.lengthSq() < 1e-8 || 1 - roll.w < 1e-9) fall.set(0, 0, 0);
  else fall.normalize();
  const pivot = from.pos.clone().addScaledVector(fall, edge);
  const rolled = from.pos.clone().sub(pivot).applyQuaternion(roll).add(pivot);
  return { from, to, yaw, roll, pivot, slide: to.pos.clone().sub(rolled), fall, keys: keys ?? null };
}

const smooth = (u: number): number => u * u * (3 - 2 * u);

/** The shares of the slide, yaw and roll done at `u` (0..1 of the tip's time). */
export function tipShares(plan: TipPlan, u: number): { slide: number; yaw: number; roll: number } {
  const t = THREE.MathUtils.clamp(u, 0, 1);
  const keys = plan.keys;
  if (!keys || keys.length < 2) return { slide: smooth(t), yaw: smooth(t), roll: t * t };
  let i = 1;
  while (i < keys.length - 1 && keys[i]![0]! < t) i++;
  const a = keys[i - 1]!;
  const b = keys[i]!;
  const f = b[0]! > a[0]! ? THREE.MathUtils.clamp((t - a[0]!) / (b[0]! - a[0]!), 0, 1) : 1;
  const at = (n: number): number => a[n]! + (b[n]! - a[n]!) * f;
  return { slide: at(1), yaw: at(2), roll: at(3) };
}

/** The prop's pose `u` (0..1) of the way through the tip. At 1 it is exactly the `after` pose. */
export function tipPose(plan: TipPlan, u: number): PropPose {
  if (u >= 1) return { pos: plan.to.pos.clone(), rotation: plan.to.rotation.clone() };
  const s = tipShares(plan, u);
  const roll = IDENTITY.clone().slerp(plan.roll, s.roll);
  const yaw = IDENTITY.clone().slerp(plan.yaw, s.yaw);
  const rotation = roll.clone().multiply(yaw).multiply(plan.from.rotation).normalize();
  const pos = plan.from.pos.clone().sub(plan.pivot).applyQuaternion(roll).add(plan.pivot).addScaledVector(plan.slide, s.slide);
  return { pos, rotation };
}
