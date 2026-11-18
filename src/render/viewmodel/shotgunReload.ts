import * as THREE from 'three';
import type { HandPose } from './hand.ts';
import { basisPlacement, elbowBend, type Placement } from './rig.ts';

/**
 * Shotgun reload choreography (ADR-0005): the right hand lets go of the grip, picks a shell, carries it
 * under the receiver's loading port and shoves it in. The loading hand is a second right-hand mesh posed
 * as a loose fist with the shell cradled across the curled fingers (brass by the thumb), so the shell
 * rides with the hand instead of flying to the port on its own. Everything is in gun space (-Z = muzzle).
 * Pure maths, so scripts can render the same frames the game plays.
 */

export type V3 = [number, number, number];

/** Loose fist with room for a shell across the fingers. */
export const LOAD_POSE: HandPose = {
  index: { mcp: 0.75, pip: 1.0, dip: 0.45, spread: 0.04 },
  middle: { mcp: 0.8, pip: 1.1, dip: 0.5, spread: 0 },
  ring: { mcp: 0.85, pip: 1.15, dip: 0.5, spread: -0.03 },
  little: { mcp: 0.9, pip: 1.15, dip: 0.5, spread: -0.06 },
  thumb: { mc: [0.35, 0.55], pp: [0.2, 0.75], dp: [0.1, 0.6] },
};

/** Where the shell sits in the loading hand's own (mirrored) frame. */
export const SHELL_IN_HAND: V3 = [0.075, -0.045, 0];

/** Receiver loading port, gun space (underside of the receiver). */
export const PORT: V3 = [0, -0.031, -0.152];

// Fingers up into the port, back of the hand to the right, shell nose forward and tilted up ~20 degrees.
const UP: V3 = [0, 1, 0.35];
const BACK: V3 = [1, 0, 0];
const place = (q: V3, f: V3, d: V3): Placement => basisPlacement(q, SHELL_IN_HAND, f, d, true);

/** Keyframes (shell centre in gun space): picked up at the belt, held under the port, pushed home. */
export const GRAB = place([0.05, -0.15, 0.04], [0.3, 1, 0.45], [1, -0.25, 0]);
export const APPROACH = place([0, -0.088, -0.135], UP, BACK);
export const INSERT = place([0, -0.022, -0.158], UP, BACK);

/** Forearm trails down and a touch back, away from the gun. */
export const LOAD_BEND = elbowBend(APPROACH, [0.1, -1, 0.2], true);

const e = (p: Placement): THREE.Quaternion => new THREE.Quaternion().setFromEuler(new THREE.Euler(...p.rot, 'XYZ'));
const QG = e(GRAB);
const QA = e(APPROACH);
const QI = e(INSERT);

const ease = (t: number): number => t * t * (3 - 2 * t);
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export interface LoadHandState {
  pos: V3;
  quat: THREE.Quaternion;
  /** The shell is in the hand (visible) at this point of the cycle. */
  shell: boolean;
}

/** Seconds per shell. */
export const CYCLE = 0.6;

/** Cycle fractions. The shell-in click is timed to PUSH_START. */
export const PICKUP_END = 0.12;
export const PUSH_START = 0.58;
export const PUSH_END = 0.72;

/** Hand placement through one shell cycle, `u` in 0..1. */
export function loadCycle(u: number): LoadHandState {
  if (u < PICKUP_END) {
    // Closing on the shell at the belt: a tiny dip.
    const k = ease(u / PICKUP_END);
    return { pos: lerp3(GRAB.pos, [GRAB.pos[0], GRAB.pos[1] - 0.004, GRAB.pos[2]], Math.sin(k * Math.PI)), quat: QG.clone(), shell: u > 0.05 };
  }
  if (u < PUSH_START) {
    const k = ease((u - PICKUP_END) / (PUSH_START - PICKUP_END));
    return { pos: lerp3(GRAB.pos, APPROACH.pos, k), quat: QG.clone().slerp(QA, k), shell: true };
  }
  if (u < PUSH_END) {
    // The shove: starts gently, finishes fast.
    const t = (u - PUSH_START) / (PUSH_END - PUSH_START);
    const k = t * t * (1.5 - 0.5 * t);
    return { pos: lerp3(APPROACH.pos, INSERT.pos, k), quat: QA.clone().slerp(QI, k), shell: true };
  }
  const k = ease(clamp01((u - PUSH_END) / (1 - PUSH_END)));
  return { pos: lerp3(INSERT.pos, GRAB.pos, k), quat: QI.clone().slerp(QG, k), shell: false };
}

/**
 * Place the loading hand: `blend` 0 = at the grip (`grip`), 1 = following the cycle at `u`.
 * The hand group is built mirrored, so rotation is applied as-is (matches basisPlacement).
 */
export function placeLoadHand(hand: THREE.Object3D, grip: Placement, u: number, blend: number): LoadHandState {
  const s = loadCycle(u);
  const b = ease(clamp01(blend));
  const gq = new THREE.Quaternion().setFromEuler(new THREE.Euler(...grip.rot, 'XYZ'));
  const pos = lerp3(grip.pos, s.pos, b);
  const quat = gq.slerp(s.quat, b);
  hand.position.set(...pos);
  hand.quaternion.copy(quat);
  return { pos, quat, shell: s.shell };
}
