import * as THREE from 'three';
import type { JointLimit } from '../../data/types/creatures.ts';

/**
 * Joint limits of a creature rig (openspec rig-juggernaut D6). A joint's rotation relative to its neutral pose is split into
 * a twist about the limit's axis and a swing (the rest, about an axis across it): q = swing * twist. The twist is clamped to
 * its range and the swing to an ellipse whose half-angles lie along `u` and `v`. A hinge is the same split with the hinge as
 * the twist axis and a small circular swing (its play).
 */
export interface CompiledLimit {
  readonly kind: JointLimit['kind'];
  /** Twist axis in the joint's neutral local frame (unit). */
  readonly axis: THREE.Vector3;
  /** Ellipse axes across `axis` (unit, perpendicular). */
  readonly u: THREE.Vector3;
  readonly v: THREE.Vector3;
  /** Twist range (radians). */
  readonly twist: readonly [number, number];
  /** Swing half-angles about u and v (radians). */
  readonly cone: readonly [number, number];
}

const D2R = Math.PI / 180;

export function compileLimit(l: JointLimit): CompiledLimit {
  const axis = new THREE.Vector3(...(l.kind === 'hinge' ? l.axis : (l.axis ?? [0, 1, 0]))).normalize();
  let u = new THREE.Vector3(1, 0, 0).addScaledVector(axis, -axis.x);
  if (u.lengthSq() < 1e-6) u = new THREE.Vector3(0, 0, 1).addScaledVector(axis, -axis.z);
  u.normalize();
  const v = new THREE.Vector3().crossVectors(axis, u).normalize();
  if (l.kind === 'hinge') {
    return { kind: 'hinge', axis, u, v, twist: [l.range[0] * D2R, l.range[1] * D2R], cone: [l.play * D2R, l.play * D2R] };
  }
  return { kind: 'ball', axis, u, v, twist: [l.twist[0] * D2R, l.twist[1] * D2R], cone: [l.cone[0] * D2R, l.cone[1] * D2R] };
}

const _twist = new THREE.Quaternion();
const _swing = new THREE.Quaternion();
const _axis = new THREE.Vector3();

export interface SwingTwist {
  /** Signed twist angle about the axis (radians, -PI..PI). */
  twist: number;
  /** Swing angles about u and v (radians). */
  su: number;
  sv: number;
}

/** Split `q` (taken with w >= 0) into twist about `lim.axis` and swing across it. */
export function swingTwist(q: THREE.Quaternion, lim: CompiledLimit, out: SwingTwist = { twist: 0, su: 0, sv: 0 }): SwingTwist {
  const s = q.w < 0 ? -1 : 1;
  const x = q.x * s, y = q.y * s, z = q.z * s, w = q.w * s;
  const a = lim.axis;
  const d = x * a.x + y * a.y + z * a.z;
  out.twist = 2 * Math.atan2(d, w);
  if (out.twist > Math.PI) out.twist -= 2 * Math.PI;
  if (out.twist < -Math.PI) out.twist += 2 * Math.PI;
  _twist.set(a.x * d, a.y * d, a.z * d, w);
  if (_twist.lengthSq() < 1e-20) _twist.identity();
  else _twist.normalize();
  _swing.set(x, y, z, w).multiply(_twist.invert());
  if (_swing.w < 0) _swing.set(-_swing.x, -_swing.y, -_swing.z, -_swing.w);
  const angle = 2 * Math.acos(Math.min(1, _swing.w));
  _axis.set(_swing.x, _swing.y, _swing.z);
  const len = _axis.length();
  if (len < 1e-12) {
    out.su = 0;
    out.sv = 0;
  } else {
    _axis.divideScalar(len);
    out.su = angle * _axis.dot(lim.u);
    out.sv = angle * _axis.dot(lim.v);
  }
  return out;
}

/** Rebuild a rotation from its swing-twist parts. */
export function fromSwingTwist(st: SwingTwist, lim: CompiledLimit, out: THREE.Quaternion): THREE.Quaternion {
  _twist.setFromAxisAngle(lim.axis, st.twist);
  const angle = Math.hypot(st.su, st.sv);
  if (angle < 1e-12) _swing.identity();
  else _swing.setFromAxisAngle(_axis.copy(lim.u).multiplyScalar(st.su).addScaledVector(lim.v, st.sv).divideScalar(angle), angle);
  return out.copy(_swing).multiply(_twist);
}

/** How far the parts are along their limits: 1 means on a bound (twist end or the swing ellipse). */
export function limitUse(st: SwingTwist, lim: CompiledLimit): { twist: number; swing: number } {
  const [lo, hi] = lim.twist;
  const twist = st.twist >= 0 ? (hi > 1e-9 ? st.twist / hi : st.twist > 1e-9 ? Infinity : 0) : lo < -1e-9 ? st.twist / lo : st.twist < -1e-9 ? Infinity : 0;
  const eu = lim.cone[0] > 1e-9 ? st.su / lim.cone[0] : Math.abs(st.su) > 1e-9 ? Infinity : 0;
  const ev = lim.cone[1] > 1e-9 ? st.sv / lim.cone[1] : Math.abs(st.sv) > 1e-9 ? Infinity : 0;
  return { twist, swing: Math.hypot(eu, ev) };
}

const _st: SwingTwist = { twist: 0, su: 0, sv: 0 };

/**
 * Clamp `q` (a rotation relative to neutral) to `lim` in place. Returns true when it had to move it. The twist is cut to its
 * range; a swing outside the ellipse is scaled back onto it along the same direction.
 */
export function clampRotation(q: THREE.Quaternion, lim: CompiledLimit): boolean {
  swingTwist(q, lim, _st);
  const [lo, hi] = lim.twist;
  let moved = false;
  if (_st.twist < lo - 1e-9 || _st.twist > hi + 1e-9) {
    _st.twist = Math.min(hi, Math.max(lo, _st.twist));
    moved = true;
  }
  const [cu, cv] = lim.cone;
  const eu = cu > 1e-9 ? _st.su / cu : _st.su === 0 ? 0 : Infinity;
  const ev = cv > 1e-9 ? _st.sv / cv : _st.sv === 0 ? 0 : Infinity;
  const r = Math.hypot(eu, ev);
  if (r > 1 + 1e-9) {
    if (Number.isFinite(r)) {
      _st.su /= r;
      _st.sv /= r;
    } else {
      // A zero half-angle: drop the swing along it, keep (and bound) the other.
      _st.su = cu > 1e-9 ? Math.max(-cu, Math.min(cu, _st.su)) : 0;
      _st.sv = cv > 1e-9 ? Math.max(-cv, Math.min(cv, _st.sv)) : 0;
    }
    moved = true;
  }
  if (moved) fromSwingTwist(_st, lim, q);
  return moved;
}
