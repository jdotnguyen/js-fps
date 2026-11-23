import * as THREE from 'three';
import { FINGER_MAX_CURL, FINGER_NAMES, MAX_SPLAY, shapeSplay, THUMB_MAX_CURL, THUMB_MAX_SPLAY, type FingerBoneDef, type FingerName, type HandDetailBone } from './handPhysics.ts';
import { gripFrameFor, mugRotation, MUG_SHAPE, pistolGripFrameFor, pistolRotation, type GripFrame } from './heldProps.ts';
import { pistolDistance } from './squadPistol.ts';

/** Items whose wrap is solved against their shape: the mug and the pistol (the wand keeps the radius wrap). */
export type SolvedItem = 'mug' | 'pistol';

const solved: Record<SolvedItem, WeakMap<readonly HandDetailBone[], HeldGrip | null>> = { mug: new WeakMap(), pistol: new WeakMap() };

/**
 * The wrap of a held mug or pistol for a rig's hand (grip frame, then the solve), computed once per rig and item and shared by every
 * body built from it.
 */
export function heldGripFor(handBones: readonly HandDetailBone[] | undefined, item: SolvedItem = 'mug'): HeldGrip | null {
  if (!handBones || handBones.length === 0) return null;
  const cache = solved[item];
  if (cache.has(handBones)) return cache.get(handBones)!;
  const frame = item === 'mug' ? gripFrameFor(handBones) : pistolGripFrameFor(handBones);
  const grip = frame ? solveHeldGrip(handBones, frame, shapeSplay(item === 'mug' ? 'cup' : 'grip'), HELD_SHAPES[item]) : null;
  cache.set(handBones, grip);
  return grip;
}

/** Signed clearance (m) of a finger's centre-line point, in the item's own frame, from its solid: negative = inside skin + margin. */
type Clearance = (p: THREE.Vector3) => number;

/** What the wrap solve needs of an item. */
export interface HeldShape {
  /** The item's rotation in the hand for a grip frame. */
  rotation(frame: GripFrame): THREE.Quaternion;
  clearance: Clearance;
  /** Turn the frame about its up axis so the item's +X (the mug's handle) points into the widest gap between the contacts. */
  turnHandle: boolean;
  /** Per-finger bend limits (radians, phalanges 1-3) tighter than the hand's own: the pistol's index stays straight. */
  maxCurl?: Partial<Record<FingerName, readonly [number, number, number]>>;
  /** How far (radians) a phalanx may open past straight to clear the item (default -0.1; the hand solver writes down to -0.25). */
  minCurl?: number;
}

/** Bend limits that keep a finger straight along the frame, off the trigger (squad-sidearms D2). */
export const STRAIGHT_INDEX: readonly [number, number, number] = [0.12, 0.08, 0.06];

export const HELD_SHAPES: Readonly<Record<SolvedItem, HeldShape>> = {
  mug: { rotation: (f) => mugRotation(f.up, f.handle), clearance: (p) => mugClearance(p), turnHandle: true },
  pistol: {
    rotation: (f) => pistolRotation(f),
    clearance: (p) => pistolDistance(p) - (WRAP_FINGER_HALF + WRAP_MARGIN),
    turnHandle: false,
    maxCurl: { index: STRAIGHT_INDEX },
    minCurl: -0.25,
  },
};

/**
 * The wrap of a held mug (held-props spec, upright-mug-grip D5): for one rig, the largest bend of each finger and thumb phalanx that
 * keeps it outside the mug, solved once in the hand's rest space (the mug never moves in the hand, so the contact pose is a constant
 * of the rig). The hand solver then drives each phalanx toward its contact angle and never past it.
 */

/** Half a finger's thickness (m): a phalanx's centre line keeps this far from the mug, plus the skin margin. */
export const WRAP_FINGER_HALF = 0.008;
/** Clearance (m) kept between the skin and the mug at contact. */
export const WRAP_MARGIN = 0.0015;
/** The distal phalanx (joint to fingertip) is this share of the middle one's length. */
export const DISTAL_SHARE = 0.85;

export interface HeldGrip {
  /** Final bone angle (radians about the phalanx's curl axis) for phalanges 1, 2, 3 of each finger, thumb to pinky. */
  contact: Record<FingerName, [number, number, number]>;
  /** Splay angle (radians) of each finger's first phalanx at contact. */
  splay: Record<FingerName, number>;
  /** The grip frame after the handle was turned into the opening of the grip. */
  frame: GripFrame;
  /**
   * Least clearance (m; negative = into the mug past the skin margin) of a finger at given bone angles and splay, for the hand
   * solver's per-frame guard while a grip eases in.
   */
  clearanceAt(finger: FingerName, angles: readonly number[], splay: number): number;
  /** Mug-local joint and tip positions of a finger at given angles and splay (diagnostics and tests). */
  pointsAt(finger: FingerName, angles: readonly number[], splay: number): THREE.Vector3[];
  /** Mug-local palm point (60% of the way from the wrist to the middle knuckle). */
  palm: THREE.Vector3;
}

/** A finger whose easing pose reaches this far (m) into the mug jumps to its contact pose instead. */
export const EASE_GUARD = -0.003;

interface Phalanx {
  def: FingerBoneDef;
  offset: THREE.Vector3;
  curlAxis: THREE.Vector3;
  splayAxis: THREE.Vector3;
}

/** How far (m) past the skin margin a thumb pose may reach and still count as clear (the spec allows 3 mm of skin overlap). */
const THUMB_ALLOW = -0.0015;
/**
 * How far the thumb search swings the thumb out at its base, as a multiple of THUMB_MAX_SPLAY (24°): about 48°, inside a real
 * thumb's 50-60° at the base joint. A rig whose thumb lies across the palm (Giles once his finger chains follow his skin) only
 * clears the mug past about 42°.
 */
const THUMB_OPPOSITION = 2;
/**
 * How far past THUMB_MAX_CURL (34-47° per joint, conservative) a held mug's thumb may bend in that wider search: 1.5x stays inside
 * a real thumb's 55° at its middle joint and 80° at its last. Only the held grip writes these angles; every other hand shape keeps
 * the usual limits.
 */
export const HELD_THUMB_REACH = 1.5;
const SAMPLES = 6;
const STEP = 0.02;

/** Signed clearance (m) of a centre-line point (mug-local) from the mug body and handle: negative = inside skin + margin. */
function mugClearance(p: THREE.Vector3): number {
  const s = MUG_SHAPE;
  const t = THREE.MathUtils.clamp((p.y - s.yBottom) / (s.yTop - s.yBottom), 0, 1);
  const r = THREE.MathUtils.lerp(s.rBottom, s.rTop, t);
  const radial = Math.hypot(p.x, p.z);
  const keep = WRAP_FINGER_HALF + WRAP_MARGIN;
  // Distance outside the body's solid (a capped tapered cylinder).
  const dr = radial - r;
  const dy = Math.max(s.yBottom - p.y, p.y - s.yTop);
  const body = dr > 0 && dy > 0 ? Math.hypot(dr, dy) : Math.max(dr, dy);
  // Distance outside the handle's box (the loop included: a finger through it is in the handle).
  const h = s.handleBox;
  const qx = Math.max(h.min.x - p.x, p.x - h.max.x);
  const qy = Math.max(h.min.y - p.y, p.y - h.max.y);
  const qz = Math.max(h.min.z - p.z, p.z - h.max.z);
  const out = new THREE.Vector3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)).length();
  const handle = out > 0 ? out : Math.max(qx, qy, qz);
  return Math.min(body, handle) - keep;
}

/** Hand-rest space -> item-local transform for a grip frame. */
function itemInverse(frame: GripFrame, shape: HeldShape): THREE.Matrix4 {
  return new THREE.Matrix4().compose(frame.position, shape.rotation(frame), new THREE.Vector3(1, 1, 1)).invert();
}

/** One finger's three phalanges, from the rig's calibrated definitions. */
function phalanges(handBones: readonly HandDetailBone[], finger: FingerName): Phalanx[] | null {
  const out: Phalanx[] = [];
  for (const i of [1, 2, 3] as const) {
    const d = handBones.find((b): b is FingerBoneDef => b.kind === 'finger' && b.side === 'R' && b.finger === finger && b.phalanx === i);
    if (!d) return null;
    out.push({
      def: d,
      offset: new THREE.Vector3(...d.offset),
      curlAxis: new THREE.Vector3(...d.curlAxis).normalize(),
      splayAxis: new THREE.Vector3(...d.splayAxis).normalize(),
    });
  }
  return out;
}

/** Bone rotation for a phalanx at a bend angle (and splay on the first), exactly as the hand solver writes it. */
function boneQuat(ph: Phalanx, angle: number, splay: number, first: boolean): THREE.Quaternion {
  const q = new THREE.Quaternion().setFromAxisAngle(ph.curlAxis, angle);
  if (first && Math.abs(splay) > 1e-6) return new THREE.Quaternion().setFromAxisAngle(ph.splayAxis, splay).multiply(q);
  return q;
}

/**
 * The finger's joint positions (hand-rest space) and the fingertip for given bone angles: joint k is at its parent's frame times its
 * offset; the tip runs on from the last joint by DISTAL_SHARE of the last offset, in the last bone's frame.
 */
function chainPoints(chain: Phalanx[], angles: readonly number[], splay: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const pos = new THREE.Vector3();
  const rot = new THREE.Quaternion();
  for (let k = 0; k < chain.length; k++) {
    pos.add(chain[k]!.offset.clone().applyQuaternion(rot));
    pts.push(pos.clone());
    rot.multiply(boneQuat(chain[k]!, angles[k] ?? 0, splay, k === 0));
  }
  pts.push(pos.clone().add(chain[chain.length - 1]!.offset.clone().multiplyScalar(DISTAL_SHARE).applyQuaternion(rot)));
  return pts;
}

/** Least clearance over the segments from joint `from` to the tip, sampled along each. */
function chainClearance(pts: THREE.Vector3[], from: number, inv: THREE.Matrix4, clearance: Clearance): number {
  let min = Infinity;
  const v = new THREE.Vector3();
  for (let k = from; k + 1 < pts.length; k++) {
    for (let s = 0; s <= SAMPLES; s++) {
      v.copy(pts[k]!).lerp(pts[k + 1]!, s / SAMPLES).applyMatrix4(inv);
      min = Math.min(min, clearance(v));
    }
  }
  return min;
}

/**
 * Bend each phalanx in turn, from the knuckle out, as far as it goes before its own segment meets the mug (that segment's samples
 * only: the phalanges beyond it bend next). A phalanx already touching at its rest angle stays at its lowest angle.
 */
function wrapFinger(chain: Phalanx[], splay: number, inv: THREE.Matrix4, maxes: readonly number[], clearance: Clearance, lo = -0.1): [number, number, number] {
  const angles = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const segOk = (a: number): boolean => {
      angles[k] = a;
      const pts = chainPoints(chain, angles, splay);
      // This phalanx's own segment (its joint -> the next joint or the tip), never deeper than where it starts: a knuckle that
      // rests pressed against the wall (GRIP_PRESS) may bend as long as the segment does not go further in.
      const start = clearance(pts[k]!.clone().applyMatrix4(inv));
      return chainClearance(pts.slice(k, k + 2), 0, inv, clearance) >= Math.min(0, start) - 1e-4;
    };

    let a = lo;
    if (!segOk(lo)) {
      angles[k] = lo;
      continue;
    }
    while (a + STEP <= maxes[k]! && segOk(a + STEP)) a += STEP;
    // Refine between a (clear) and a + STEP (touching).
    let hi = Math.min(maxes[k]!, a + STEP);
    for (let i = 0; i < 10; i++) {
      const mid = (a + hi) / 2;
      if (segOk(mid)) a = mid;
      else hi = mid;
    }
    angles[k] = a;
  }
  return [angles[0]!, angles[1]!, angles[2]!];
}

/** Angle (radians, about the mug's axis) of a mug-local point, measured in the mug's XZ plane. */
const aroundAxis = (p: THREE.Vector3): number => Math.atan2(p.z, p.x);

/**
 * Solve the wrap for one rig and grip frame: each finger at its cup splay, the thumb searched over opposition (splay) and first-bone
 * curl for the closest contact on the far side from the fingers. Then turn the handle into the widest gap between the contacts and
 * solve once more. Null when the hand lacks a full set of finger bones.
 */
export function solveHeldGrip(handBones: readonly HandDetailBone[] | undefined, frame: GripFrame, cupSplay: readonly number[], shape: HeldShape = HELD_SHAPES.mug): HeldGrip | null {
  if (!handBones) return null;
  const clearance = shape.clearance;
  const chains = new Map<FingerName, Phalanx[]>();
  for (const f of FINGER_NAMES) {
    const c = phalanges(handBones, f);
    if (!c) return null;
    chains.set(f, c);
  }
  // The palm, for telling which side of the mug a finger came round (as the held-props test reads it): from the wrist 60% of the
  // way to the middle knuckle.
  const palmPoint = new THREE.Vector3().lerp(chains.get('middle')![0]!.offset, 0.6);
  const solve = (fr: GripFrame): HeldGrip => {
    const inv = itemInverse(fr, shape);
    const contact = {} as Record<FingerName, [number, number, number]>;
    const splay = {} as Record<FingerName, number>;
    // Seen down the mug's axis, which side of the line from the axis to the palm a point lies on.
    const palmLocal = palmPoint.clone().applyMatrix4(inv);
    const sideOf = (v: THREE.Vector3): number => Math.sign(palmLocal.x * v.z - palmLocal.z * v.x);
    // Fingers first: they set the side the thumb must come round from.
    let fingerSide = 1;
    for (let fi = 1; fi < 5; fi++) {
      const f = FINGER_NAMES[fi]!;
      const sp = (cupSplay[fi] ?? 0) * MAX_SPLAY;
      contact[f] = wrapFinger(chains.get(f)!, sp, inv, shape.maxCurl?.[f] ?? FINGER_MAX_CURL, clearance, shape.minCurl);
      splay[f] = sp;
      if (f === 'middle') {
        const pts = chainPoints(chains.get(f)!, contact[f], sp);
        fingerSide = sideOf(pts[pts.length - 1]!.clone().applyMatrix4(inv)) || 1;
      }
    }
    // Thumb: a grid over opposition (splay) and its three bends, keeping only poses clear of the mug; the closest tip on the far side
    // from the fingers wins (a thumb on the fingers' side only when nothing else fits).
    const thumb = chains.get('thumb')!;
    let best = null as { score: number; angles: [number, number, number]; sp: number } | null;
    const steps = (lo: number, max: number, n: number): number[] => Array.from({ length: n + 1 }, (_, i) => lo + ((max - lo) * i) / n);
    const search = (range: number, lo: number, reach: number): void => {
      for (let s = -range; s <= range + 1e-4; s += 0.25) {
        const sp = s * THUMB_MAX_SPLAY;
        for (const a1 of steps(lo, THUMB_MAX_CURL[0] * reach, 6)) {
          for (const a2 of steps(lo, THUMB_MAX_CURL[1] * reach, 6)) {
            for (const a3 of steps(lo, THUMB_MAX_CURL[2] * reach, 6)) {
              const angles: [number, number, number] = [a1, a2, a3];
              const pts = chainPoints(thumb, angles, sp);
              if (chainClearance(pts, 0, inv, clearance) < THUMB_ALLOW) continue;
              const tip = pts[pts.length - 1]!.clone().applyMatrix4(inv);
              const score = Math.max(0, clearance(tip)) + (sideOf(tip) === -fingerSide ? 0 : 0.05);
              if (!best || score < best.score) best = { score, angles, sp };
            }
          }
        }
      }
    };
    // The thumb's usual range first; only a thumb with no clear pose there (one lying across the palm) swings further out, uncurls
    // as far as the hand solver writes (-0.25 rad) and bends up to HELD_THUMB_REACH times its usual joint limits.
    search(1, -0.1, 1);
    if (!best) search(THUMB_OPPOSITION, -0.25, HELD_THUMB_REACH);
    contact.thumb = best ? best.angles : [0, 0, 0];
    splay.thumb = best ? best.sp : 0;
    const clearanceAt = (finger: FingerName, angles: readonly number[], sp: number): number => chainClearance(chainPoints(chains.get(finger)!, angles, sp), 0, inv, clearance);
    const pointsAt = (finger: FingerName, angles: readonly number[], sp: number): THREE.Vector3[] => chainPoints(chains.get(finger)!, angles, sp).map((p) => p.applyMatrix4(inv));
    return { contact, splay, frame: fr, clearanceAt, pointsAt, palm: palmLocal };
  };

  const first = solve(frame);
  if (!shape.turnHandle) return first;
  // Turn the handle into the widest opening between where the fingers and thumb are.
  const inv = itemInverse(frame, shape);
  const angles: number[] = [];
  for (const f of FINGER_NAMES) {
    for (const p of chainPoints(chains.get(f)!, first.contact[f], first.splay[f])) {
      const q = p.clone().applyMatrix4(inv);
      if (Math.hypot(q.x, q.z) < MUG_SHAPE.rTop + 0.03) angles.push(aroundAxis(q));
    }
  }
  if (angles.length < 2) return first;
  angles.sort((a, b) => a - b);
  let gapStart = angles[angles.length - 1]!;
  let gap = angles[0]! + Math.PI * 2 - gapStart;
  for (let i = 1; i < angles.length; i++) {
    if (angles[i]! - angles[i - 1]! > gap) {
      gap = angles[i]! - angles[i - 1]!;
      gapStart = angles[i - 1]!;
    }
  }
  const mid = gapStart + gap / 2;
  // The handle sits at the mug's +X; turn the frame about its up axis so +X points at `mid`.
  const turned: GripFrame = { ...frame, handle: frame.handle.clone().applyAxisAngle(frame.up, -mid) };
  return solve(turned);
}
