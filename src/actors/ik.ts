import * as THREE from 'three';

const pA = new THREE.Vector3();
const pB = new THREE.Vector3();
const pC = new THREE.Vector3();
const axis = new THREE.Vector3();
const toPole = new THREE.Vector3();
const want = new THREE.Vector3();
const from = new THREE.Vector3();
const to = new THREE.Vector3();
const qDelta = new THREE.Quaternion();
const qWorld = new THREE.Quaternion();
const qParent = new THREE.Quaternion();
const qBefore = new THREE.Quaternion();

/** Rotate `bone` (in world space) so the direction `from` becomes `to`, blended by weight. */
function aim(bone: THREE.Object3D, fromDir: THREE.Vector3, toDir: THREE.Vector3, weight: number): void {
  qDelta.setFromUnitVectors(fromDir, toDir);
  bone.getWorldQuaternion(qWorld);
  qWorld.premultiply(qDelta);
  if (bone.parent) {
    bone.parent.getWorldQuaternion(qParent);
    qWorld.premultiply(qParent.invert());
  }
  qBefore.copy(bone.quaternion);
  bone.quaternion.slerpQuaternions(qBefore, qWorld, weight);
  bone.updateMatrixWorld(true);
}

/**
 * Analytic two-bone IK (ADR-0006): rotates `upper` and `lower` so `end` reaches `target`,
 * bending toward `pole`. All points in world space. Lengths come from the current pose,
 * so joint scale (infection elongation) is respected.
 */
export function solveTwoBone(
  upper: THREE.Object3D,
  lower: THREE.Object3D,
  end: THREE.Object3D,
  target: THREE.Vector3,
  pole: THREE.Vector3,
  weight = 1,
): void {
  if (weight <= 0) return;
  upper.updateMatrixWorld(true);
  upper.getWorldPosition(pA);
  lower.getWorldPosition(pB);
  end.getWorldPosition(pC);
  const lenAB = pA.distanceTo(pB);
  const lenBC = pB.distanceTo(pC);
  if (lenAB < 1e-5 || lenBC < 1e-5) return;
  axis.subVectors(target, pA);
  const dist = THREE.MathUtils.clamp(axis.length(), Math.abs(lenAB - lenBC) + 1e-4, lenAB + lenBC - 1e-4);
  axis.normalize();
  toPole.subVectors(pole, pA);
  toPole.addScaledVector(axis, -toPole.dot(axis));
  if (toPole.lengthSq() < 1e-10) return;
  toPole.normalize();
  const cosA = THREE.MathUtils.clamp((lenAB * lenAB + dist * dist - lenBC * lenBC) / (2 * lenAB * dist), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  want.copy(pA).addScaledVector(axis, cosA * lenAB).addScaledVector(toPole, sinA * lenAB);

  aim(upper, from.subVectors(pB, pA).normalize(), to.subVectors(want, pA).normalize(), weight);
  lower.getWorldPosition(pB);
  end.getWorldPosition(pC);
  aim(lower, from.subVectors(pC, pB).normalize(), to.subVectors(target, pB).normalize(), weight);
}
