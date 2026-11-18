import * as THREE from 'three';

export type WeaponId = 'pistol' | 'shotgun';

/** Where a hand sits in weapon space (metres, radians XYZ). */
export interface Placement {
  pos: [number, number, number];
  rot: [number, number, number];
}

/** A built weapon viewmodel: the gun, its moving parts, and the hands holding it. */
export interface WeaponRig {
  id: WeaponId;
  /** Gun space origin; hands are parented inside so they follow it. */
  root: THREE.Group;
  /** Slide (pistol) or pump forend group (shotgun, carries the support hand). */
  mover: THREE.Object3D;
  /** How far `mover` travels when cycled, metres along -Z (negative = toward the shooter). */
  moverTravel: number;
  /** Detachable magazine (pistol) so reloads can drop it. */
  mag: THREE.Object3D | null;
  muzzle: THREE.Object3D;
  /** Shotgun: the second right hand used while loading, with the shell it carries as a child. */
  loadHand?: THREE.Group;
  shell?: THREE.Group;
  /** Update on-gun readouts to match the internal ammo state. */
  setAmmo(loaded: number, reserve: number): void;
  /** Eased 0..1 laser-sight strength (pistol, aim mode). */
  setLaser(strength: number): void;
  /** Pose the trigger finger travel 0..1 (visible trigger). */
  setTrigger(pull: number): void;
}

/**
 * Placement that puts the hand-local point `s` (e.g. the palm surface) at weapon-space point `q`,
 * with the fingers pointing along `f` and the back of the hand along `d`. Right hands are built
 * mirrored (scale.z = -1), which is accounted for here.
 */
export function basisPlacement(
  q: [number, number, number],
  s: [number, number, number],
  f: [number, number, number],
  d: [number, number, number],
  right: boolean,
): Placement {
  const F = new THREE.Vector3(...f).normalize();
  const D = new THREE.Vector3(...d).normalize();
  D.addScaledVector(F, -D.dot(F)).normalize();
  const Z = new THREE.Vector3().crossVectors(F, D);
  const m = new THREE.Matrix4().makeBasis(F, D, Z);
  const e = new THREE.Euler().setFromRotationMatrix(m, 'XYZ');
  const sl = new THREE.Vector3(s[0], s[1], right ? -s[2] : s[2]).applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(e));
  return { pos: [q[0] - sl.x, q[1] - sl.y, q[2] - sl.z], rot: [e.x, e.y, e.z] };
}

/** Bend angles that point a hand's forearm toward weapon-space direction `elbow`, given its placement. */
export function elbowBend(p: Placement, elbow: [number, number, number], right: boolean): { yaw: number; pitch: number } {
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...p.rot, 'XYZ'));
  const e = new THREE.Vector3(...elbow).normalize().applyMatrix4(m.transpose());
  if (right) e.z = -e.z;
  const pitch = Math.asin(THREE.MathUtils.clamp(-e.y, -1, 1));
  const yaw = Math.atan2(e.z, -e.x);
  return { yaw, pitch };
}
