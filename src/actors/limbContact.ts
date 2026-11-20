import * as THREE from 'three';
import { solveTwoBone } from './ik.ts';
import type { Aabb, ColliderQuery } from './motor.ts';
import type { JointName, Side } from './skeleton.ts';

/**
 * General kinematic limb-contact solver (self-body capsules + world AABB colliders).
 *
 * Prevents hands from clipping through the character's own thighs/torso (e.g. while sitting
 * or swinging arms) and through world surfaces (tables, bar counters, desks, walls) using
 * exact geometry projection + 2-bone arm IK, outputting smooth surface contact normals so
 * `HandPhysicsSolver` can conform the palm and fingers onto the resting surface.
 */

export type ContactKind = 'none' | 'body' | 'world';

export interface HandContact {
  /** 0..1 smoothed contact strength (0 = free air, 1 = resting against surface). */
  weight: number;
  /** Outward surface normal in world space (e.g. (0, 1, 0) on a tabletop or seated thigh). */
  readonly normal: THREE.Vector3;
  kind: ContactKind;
}

export interface BodyCapsuleRef {
  joint: JointName;
  bone: THREE.Bone;
  a: THREE.Vector3;
  b: THREE.Vector3;
  r: number;
}

/** Mesh-fitted bone-local elliptical cylinder for accurate torso self-collision on imported models. */
export interface TorsoHullDef {
  joint: 'pelvis' | 'spine' | 'chest';
  /** Local cross-section center (metres, at REFERENCE_HEIGHT). */
  cx: number;
  cz: number;
  /** Vertical extent along bone-local Y. */
  y0: number;
  y1: number;
  /** Half-width (X) and half-depth (Z). */
  rx: number;
  rz: number;
}

export interface LimbContactInput {
  group: THREE.Group;
  bones: Readonly<Record<JointName, THREE.Bone>>;
  capsules: readonly BodyCapsuleRef[];
  /** Optional mesh-fitted torso hulls (from imported GLB vertices); falls back to torso capsules when absent. */
  torsoHulls?: readonly TorsoHullDef[];
  colliders: ColliderQuery | null;
  scaleY: number;
  attachedL: boolean;
  attachedR: boolean;
  /** Skip a side when explicit world IK (`handTargets`) already owns that hand. */
  skipL: boolean;
  skipR: boolean;
  /** True when the body is alive, near enough, and not lying/ragdolling. */
  enabled: boolean;
  dt: number;
}

interface WorldCapsule {
  joint: JointName;
  isThigh: boolean;
  readonly a: THREE.Vector3;
  readonly b: THREE.Vector3;
  r: number;
}

interface SideContactState {
  readonly smoothPush: THREE.Vector3;
  readonly contact: HandContact;
  primed: boolean;
}

const SELF_BODY_JOINTS = new Set<JointName>(['thigh_L', 'thigh_R', 'pelvis', 'spine', 'chest']);
const TORSO_JOINTS = new Set<JointName>(['pelvis', 'spine', 'chest']);

const WRIST_PROBE_R = 0.032;
const KNUCKLE_PROBE_R = 0.036;
const FOREARM_PROBE_R = 0.038;
const ENTER_RATE = 24;
const EXIT_RATE = 14;
/** Vertical tolerance (metres) below a tabletop surface where a dipping hand lifts onto the top face. */
const TABLE_TOP_SNAP_DEPTH = 0.28;
/** Max world query half-extent around pelvis (metres). */
const QUERY_EXTENT = 1.15;

// Module-level scratch vectors (zero per-frame allocations).
const vPelvis = new THREE.Vector3();
const vShoulderL = new THREE.Vector3();
const vShoulderR = new THREE.Vector3();
const vShoulder = new THREE.Vector3();
const vElbow = new THREE.Vector3();
const vWrist = new THREE.Vector3();
const vProbeW = new THREE.Vector3();
const vProbeK = new THREE.Vector3();
const vProbeF = new THREE.Vector3();
const vTarget = new THREE.Vector3();
const vPole = new THREE.Vector3();
const vPush = new THREE.Vector3();
const vAccPush = new THREE.Vector3();
const vAccNorm = new THREE.Vector3();
const vClosest = new THREE.Vector3();
const vDiff = new THREE.Vector3();
const vSeg = new THREE.Vector3();
const vScale = new THREE.Vector3();
const vLocalProbe = new THREE.Vector3();
const vLocalNorm = new THREE.Vector3();
const mInvBone = new THREE.Matrix4();
const qBoneWorld = new THREE.Quaternion();

/**
 * Resolve one world-space sphere probe against a mesh-fitted bone-local elliptical torso hull.
 * Biases pushes forward/outward so crossed forearms and hands always clear the chest/coat front
 * cleanly instead of being pushed backward through the ribcage.
 */
function resolveProbeTorsoHull(
  pWorld: THREE.Vector3,
  probeRWorld: number,
  hull: TorsoHullDef,
  bone: THREE.Bone,
  scaleY: number,
  outPush: THREE.Vector3,
  outNorm: THREE.Vector3,
): number {
  mInvBone.copy(bone.matrixWorld).invert();
  vLocalProbe.copy(pWorld).applyMatrix4(mInvBone);
  const invScale = 1 / Math.max(0.1, scaleY);
  const rLocal = probeRWorld * invScale;

  // Vertical overlap test with soft cap at top/bottom of the segment.
  const cy = THREE.MathUtils.clamp(vLocalProbe.y, hull.y0, hull.y1);
  const dy = vLocalProbe.y - cy;
  if (Math.abs(dy) >= rLocal) return 0;
  // Shrink effective radial margin slightly near vertical end-caps (capsule rounding).
  const capFactor = Math.sqrt(Math.max(0, 1 - (dy / rLocal) * (dy / rLocal)));
  const effRx = hull.rx + rLocal * capFactor;
  const effRz = hull.rz + rLocal * capFactor;

  const dx = vLocalProbe.x - hull.cx;
  const dz = vLocalProbe.z - hull.cz;
  const nx = dx / Math.max(1e-4, effRx);
  const nz = dz / Math.max(1e-4, effRz);
  const ellSq = nx * nx + nz * nz;
  if (ellSq >= 1) return 0;

  // Compute outward point on the ellipse boundary; if probe is inside the front or midline,
  // bias slightly forward (-Z) so crossed arms glide over the front of the chest/lab coat.
  let pushX = 0;
  let pushZ = 0;
  if (ellSq < 1e-6 || dz <= effRz * 0.25) {
    // Push forward onto the front surface of the elliptical ribcage at the current X.
    const clampedNx = THREE.MathUtils.clamp(nx, -0.95, 0.95);
    const frontZ = hull.cz - effRz * Math.sqrt(Math.max(0.05, 1 - clampedNx * clampedNx));
    const forwardPush = frontZ - vLocalProbe.z; // <= 0 (toward -Z)
    const radialScale = ellSq > 1e-6 ? 1 / Math.sqrt(ellSq) - 1 : 0;
    const radX = dx * radialScale;
    const radZ = dz * radialScale;
    // Choose whichever exit is cleaner: pure radial when already on the side, or forward (-Z) across the front.
    if (Math.abs(nx) > 0.72 && Math.hypot(radX, radZ) < Math.abs(forwardPush)) {
      pushX = radX;
      pushZ = radZ;
    } else {
      pushX = dx * 0.12;
      pushZ = forwardPush;
    }
  } else {
    const radialScale = 1 / Math.sqrt(ellSq) - 1;
    pushX = dx * radialScale;
    pushZ = dz * radialScale;
  }

  const localPen = Math.hypot(pushX, pushZ);
  if (localPen < 1e-5) return 0;

  vLocalNorm.set(pushX / localPen, 0, pushZ / localPen);
  bone.getWorldQuaternion(qBoneWorld);
  outNorm.copy(vLocalNorm).applyQuaternion(qBoneWorld).normalize();
  const worldPen = localPen * scaleY;
  outPush.copy(outNorm).multiplyScalar(worldPen);
  return worldPen;
}

function closestPointOnSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  vSeg.subVectors(b, a);
  const lenSq = vSeg.lengthSq();
  if (lenSq < 1e-10) return out.copy(a);
  const t = THREE.MathUtils.clamp(((p.x - a.x) * vSeg.x + (p.y - a.y) * vSeg.y + (p.z - a.z) * vSeg.z) / lenSq, 0, 1);
  return out.copy(a).addScaledVector(vSeg, t);
}

/**
 * Resolve one sphere probe `(p, radius)` against a self-body capsule.
 * Writes push vector into `outPush` and outward normal into `outNorm`; returns penetration depth (> 0 if hit).
 */
function resolveProbeCapsule(
  p: THREE.Vector3,
  probeR: number,
  cap: WorldCapsule,
  side: Side,
  outPush: THREE.Vector3,
  outNorm: THREE.Vector3,
): number {
  closestPointOnSegment(p, cap.a, cap.b, vClosest);
  vDiff.subVectors(p, vClosest);
  const effR = cap.isThigh ? cap.r * 1.02 : cap.r * 0.84;
  const minDist = effR + probeR;
  const distSq = vDiff.lengthSq();
  if (distSq >= minDist * minDist) return 0;

  const dist = Math.sqrt(distSq);
  // Check if this is a mostly horizontal seated thigh: bias push upward onto the top of the lap!
  vSeg.subVectors(cap.b, cap.a);
  const segLen = vSeg.length();
  const horizontalThigh = cap.isThigh && segLen > 1e-4 && Math.abs(vSeg.y) / segLen < 0.6;

  if (horizontalThigh && p.y >= vClosest.y - effR * 0.75) {
    // Lift cleanly onto the top surface of the thigh so seated hands rest on the lap instead of clipping under it.
    const horizDist = Math.hypot(vDiff.x, vDiff.z);
    const topY = vClosest.y + Math.sqrt(Math.max(0, minDist * minDist - Math.min(horizDist * horizDist, minDist * minDist * 0.5)));
    const lift = Math.max(0, topY - p.y);
    if (lift <= 1e-5) return 0;
    outNorm.set(vDiff.x * 0.2, 1, vDiff.z * 0.2).normalize();
    outPush.set(0, lift, 0);
    return lift;
  }

  if (dist > 1e-5) {
    outNorm.copy(vDiff).divideScalar(dist);
  } else {
    // Degenerate center overlap: push outward toward the arm's own side.
    outNorm.set(side === 'L' ? -1 : 1, 0.3, -0.3).normalize();
  }
  const pen = minDist - dist;
  outPush.copy(outNorm).multiplyScalar(pen);
  return pen;
}

/**
 * Resolve one sphere probe `(p, radius)` against a world AABB (table, counter, desk, wall).
 * Uses shoulder-to-probe slab entry so arms never tunnel through thin walls to the far side.
 * Writes push vector into `outPush` and outward normal into `outNorm`; returns penetration depth (> 0 if hit).
 */
function resolveProbeAabb(
  p: THREE.Vector3,
  shoulder: THREE.Vector3,
  probeR: number,
  box: Aabb,
  floorY: number,
  shoulderY: number,
  outPush: THREE.Vector3,
  outNorm: THREE.Vector3,
): number {
  const minX = box.min[0];
  const minY = box.min[1];
  const minZ = box.min[2];
  const maxX = box.max[0];
  const maxY = box.max[1];
  const maxZ = box.max[2];

  // Tabletop / desk / bar-counter bias: when the box's top sits at table/counter height and the hand
  // dips below the top face from above, lift cleanly onto the tabletop instead of shoving horizontally.
  const isWorkSurface = maxY >= floorY + 0.35 && maxY <= shoulderY + 0.18;
  const overTopFootprint =
    p.x >= minX - probeR && p.x <= maxX + probeR && p.z >= minZ - probeR && p.z <= maxZ + probeR;
  if (isWorkSurface && overTopFootprint && p.y >= maxY - TABLE_TOP_SNAP_DEPTH && p.y < maxY + probeR) {
    const lift = maxY + probeR - p.y;
    outNorm.set(0, 1, 0);
    outPush.set(0, lift, 0);
    return lift;
  }

  // Segment-vs-expanded-AABB slab test from shoulder -> probe: catches both deep penetration and
  // thin-wall punch-through, always pushing back out through the entry face on the character's side.
  const exMinX = minX - probeR;
  const exMaxX = maxX + probeR;
  const exMinY = minY - probeR;
  const exMaxY = maxY + probeR;
  const exMinZ = minZ - probeR;
  const exMaxZ = maxZ + probeR;
  const shoulderOutside =
    shoulder.x < exMinX ||
    shoulder.x > exMaxX ||
    shoulder.y < exMinY ||
    shoulder.y > exMaxY ||
    shoulder.z < exMinZ ||
    shoulder.z > exMaxZ;

  if (shoulderOutside) {
    const sx = p.x - shoulder.x;
    const sy = p.y - shoulder.y;
    const sz = p.z - shoulder.z;
    let tEnter = 0;
    let tExit = 1;
    let hitAxis = -1;
    let hitSign = 0;

    const slab = (o: number, d: number, lo: number, hi: number, axis: number): boolean => {
      if (Math.abs(d) < 1e-8) return o >= lo && o <= hi;
      let t0 = (lo - o) / d;
      let t1 = (hi - o) / d;
      let sign = -1;
      if (t0 > t1) {
        const tmp = t0;
        t0 = t1;
        t1 = tmp;
        sign = 1;
      }
      if (t0 > tEnter) {
        tEnter = t0;
        hitAxis = axis;
        hitSign = sign;
      }
      if (t1 < tExit) tExit = t1;
      return tEnter <= tExit;
    };

    if (
      slab(shoulder.x, sx, exMinX, exMaxX, 0) &&
      slab(shoulder.y, sy, exMinY, exMaxY, 1) &&
      slab(shoulder.z, sz, exMinZ, exMaxZ, 2) &&
      hitAxis >= 0 &&
      tEnter <= 1
    ) {
      let push = 0;
      if (hitAxis === 0) {
        const face = hitSign > 0 ? exMaxX : exMinX;
        push = face - p.x;
        outNorm.set(hitSign, 0, 0);
        outPush.set(push, 0, 0);
      } else if (hitAxis === 1) {
        const face = hitSign > 0 ? exMaxY : exMinY;
        push = face - p.y;
        outNorm.set(0, hitSign, 0);
        outPush.set(0, push, 0);
      } else {
        const face = hitSign > 0 ? exMaxZ : exMinZ;
        push = face - p.z;
        outNorm.set(0, 0, hitSign);
        outPush.set(0, 0, push);
      }
      const mag = Math.abs(push);
      if (mag > 1e-5) return mag;
    }
  }

  // Fallback for probes already inside an enclosing box where shoulder is also inside the margin.
  const cx = THREE.MathUtils.clamp(p.x, minX, maxX);
  const cy = THREE.MathUtils.clamp(p.y, minY, maxY);
  const cz = THREE.MathUtils.clamp(p.z, minZ, maxZ);

  const dx = p.x - cx;
  const dy = p.y - cy;
  const dz = p.z - cz;
  const distSq = dx * dx + dy * dy + dz * dz;
  if (distSq >= probeR * probeR) return 0;

  if (distSq > 1e-10) {
    const dist = Math.sqrt(distSq);
    const pen = probeR - dist;
    outNorm.set(dx / dist, dy / dist, dz / dist);
    outPush.copy(outNorm).multiplyScalar(pen);
    return pen;
  }

  const toMinX = p.x - minX;
  const toMaxX = maxX - p.x;
  const toMinY = p.y - minY;
  const toMaxY = maxY - p.y;
  const toMinZ = p.z - minZ;
  const toMaxZ = maxZ - p.z;

  let best = toMaxY;
  outNorm.set(0, 1, 0);
  if (toMinX < best) {
    best = toMinX;
    outNorm.set(-1, 0, 0);
  }
  if (toMaxX < best) {
    best = toMaxX;
    outNorm.set(1, 0, 0);
  }
  if (toMinZ < best) {
    best = toMinZ;
    outNorm.set(0, 0, -1);
  }
  if (toMaxZ < best) {
    best = toMaxZ;
    outNorm.set(0, 0, 1);
  }
  if (toMinY < best && !isWorkSurface) {
    best = toMinY;
    outNorm.set(0, -1, 0);
  }
  const pen = best + probeR;
  outPush.copy(outNorm).multiplyScalar(pen);
  return pen;
}

export class LimbContactSolver {
  private readonly sides: Record<Side, SideContactState> = {
    L: { smoothPush: new THREE.Vector3(), contact: { weight: 0, normal: new THREE.Vector3(0, 1, 0), kind: 'none' }, primed: false },
    R: { smoothPush: new THREE.Vector3(), contact: { weight: 0, normal: new THREE.Vector3(0, 1, 0), kind: 'none' }, primed: false },
  };
  private readonly bodyCaps: WorldCapsule[] = [];
  private readonly worldBoxes: Aabb[] = [];
  private readonly filteredBoxes: Aabb[] = [];

  reset(): void {
    for (const s of ['L', 'R'] as const) {
      const st = this.sides[s];
      st.smoothPush.set(0, 0, 0);
      st.contact.weight = 0;
      st.contact.normal.set(0, 1, 0);
      st.contact.kind = 'none';
      st.primed = false;
    }
  }

  /** Latest smoothed hand contact info for `HandPhysicsSolver` and tests. */
  contactOf(side: Side): Readonly<HandContact> {
    return this.sides[side].contact;
  }

  solve(input: LimbContactInput): boolean {
    if (!input.enabled || input.dt <= 0) {
      if (this.sides.L.contact.weight > 0 || this.sides.R.contact.weight > 0) this.reset();
      return false;
    }

    const h = Math.min(input.dt, 0.05);
    input.group.updateMatrixWorld(true);

    // 1. Snapshot live world-space self-body capsules (thighs always; torso capsules only when no fitted torsoHulls).
    const torsoHulls = input.torsoHulls ?? [];
    const fittedTorsoJoints = torsoHulls.length > 0 ? TORSO_JOINTS : null;
    let capCount = 0;
    for (let i = 0; i < input.capsules.length; i++) {
      const ref = input.capsules[i]!;
      if (!SELF_BODY_JOINTS.has(ref.joint)) continue;
      if (fittedTorsoJoints && fittedTorsoJoints.has(ref.joint)) continue;
      let dst = this.bodyCaps[capCount];
      if (!dst) {
        dst = { joint: ref.joint, isThigh: ref.joint === 'thigh_L' || ref.joint === 'thigh_R', a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0 };
        this.bodyCaps.push(dst);
      } else {
        dst.joint = ref.joint;
        dst.isThigh = ref.joint === 'thigh_L' || ref.joint === 'thigh_R';
      }
      const m = ref.bone.matrixWorld;
      dst.a.copy(ref.a).applyMatrix4(m);
      dst.b.copy(ref.b).applyMatrix4(m);
      vScale.setFromMatrixColumn(m, 0);
      dst.r = ref.r * vScale.length();
      capCount++;
    }

    // 2. Query nearby world AABBs (tables, counters, desks, walls), excluding floors, ceilings,
    //    and any seat/sofa bounding volume that encloses the character's own pelvis.
    input.bones.pelvis.getWorldPosition(vPelvis);
    input.bones.upperArm_L.getWorldPosition(vShoulderL);
    input.bones.upperArm_R.getWorldPosition(vShoulderR);
    const floorY = input.group.position.y;
    const shoulderY = Math.max(vShoulderL.y, vShoulderR.y);

    this.filteredBoxes.length = 0;
    if (input.colliders) {
      this.worldBoxes.length = 0;
      input.colliders.query(
        vPelvis.x - QUERY_EXTENT,
        vPelvis.z - QUERY_EXTENT,
        vPelvis.x + QUERY_EXTENT,
        vPelvis.z + QUERY_EXTENT,
        this.worldBoxes,
      );
      for (let i = 0; i < this.worldBoxes.length; i++) {
        const b = this.worldBoxes[i]!;
        // Ignore floor slabs and high overhead ceilings.
        if (b.max[1] <= floorY + 0.14 || b.min[1] >= shoulderY + 0.55) continue;
        // Ignore seat/sofa colliders that wrap around the seated character's own pelvis.
        const pad = 0.03;
        if (
          vPelvis.x >= b.min[0] - pad &&
          vPelvis.x <= b.max[0] + pad &&
          vPelvis.y >= b.min[1] - pad &&
          vPelvis.y <= b.max[1] + pad &&
          vPelvis.z >= b.min[2] - pad &&
          vPelvis.z <= b.max[2] + pad
        ) {
          continue;
        }
        this.filteredBoxes.push(b);
      }
    }

    const wristR = WRIST_PROBE_R * input.scaleY;
    const knuckleR = KNUCKLE_PROBE_R * input.scaleY;
    const forearmR = FOREARM_PROBE_R * input.scaleY;
    let solvedAny = false;

    for (const side of ['L', 'R'] as const) {
      const st = this.sides[side];
      const attached = side === 'L' ? input.attachedL : input.attachedR;
      const skip = side === 'L' ? input.skipL : input.skipR;
      if (!attached || skip) {
        st.smoothPush.set(0, 0, 0);
        st.contact.weight = 0;
        st.contact.kind = 'none';
        continue;
      }

      const upper = input.bones[`upperArm_${side}`];
      const fore = input.bones[`foreArm_${side}`];
      const hand = input.bones[`hand_${side}`];

      upper.getWorldPosition(vShoulder);
      fore.getWorldPosition(vElbow);
      hand.getWorldPosition(vWrist);

      // Three probes per arm: wrist crease, knuckles/palm center, and forearm midpoint (catches crossed-arm chest clipping).
      vLocalProbe.set(0, -0.02, 0);
      vProbeW.copy(vLocalProbe).applyMatrix4(hand.matrixWorld);
      vLocalProbe.set(0, -0.095, 0);
      vProbeK.copy(vLocalProbe).applyMatrix4(hand.matrixWorld);
      vProbeF.lerpVectors(vElbow, vWrist, 0.55);

      vAccPush.set(0, 0, 0);
      vAccNorm.set(0, 0, 0);
      let hitBody = false;
      let hitWorld = false;
      let torsoPushMag = 0;

      // Two projection passes resolve coupled table + thigh + torso contacts cleanly.
      for (let iter = 0; iter < 2; iter++) {
        let iterPushX = 0;
        let iterPushY = 0;
        let iterPushZ = 0;

        // World AABBs (tables, counters, desks, walls).
        for (let bi = 0; bi < this.filteredBoxes.length; bi++) {
          const box = this.filteredBoxes[bi]!;
          let bestPen = 0;
          let bx = 0;
          let by = 0;
          let bz = 0;
          let bnx = 0;
          let bny = 0;
          let bnz = 0;

          const penW = resolveProbeAabb(vProbeW, vShoulder, wristR, box, floorY, shoulderY, vPush, vClosest);
          if (penW > bestPen) {
            bestPen = penW;
            bx = vPush.x;
            by = vPush.y;
            bz = vPush.z;
            bnx = vClosest.x;
            bny = vClosest.y;
            bnz = vClosest.z;
          }
          const penK = resolveProbeAabb(vProbeK, vShoulder, knuckleR, box, floorY, shoulderY, vPush, vClosest);
          if (penK > bestPen) {
            bestPen = penK;
            bx = vPush.x;
            by = vPush.y;
            bz = vPush.z;
            bnx = vClosest.x;
            bny = vClosest.y;
            bnz = vClosest.z;
          }
          if (bestPen > 1e-5) {
            hitWorld = true;
            iterPushX += bx;
            iterPushY += by;
            iterPushZ += bz;
            vAccNorm.x += bnx * bestPen;
            vAccNorm.y += bny * bestPen;
            vAccNorm.z += bnz * bestPen;
            vProbeW.x += bx;
            vProbeW.y += by;
            vProbeW.z += bz;
            vProbeK.x += bx;
            vProbeK.y += by;
            vProbeK.z += bz;
            vProbeF.x += bx * 0.55;
            vProbeF.y += by * 0.55;
            vProbeF.z += bz * 0.55;
          }
        }

        // Mesh-fitted elliptical torso hulls (imported models: chest, spine, pelvis).
        for (let hi = 0; hi < torsoHulls.length; hi++) {
          const hull = torsoHulls[hi]!;
          const bone = input.bones[hull.joint];
          let bestPen = 0;
          let bx = 0;
          let by = 0;
          let bz = 0;
          let bnx = 0;
          let bny = 0;
          let bnz = 0;

          const penW = resolveProbeTorsoHull(vProbeW, wristR, hull, bone, input.scaleY, vPush, vClosest);
          if (penW > bestPen) {
            bestPen = penW;
            bx = vPush.x;
            by = vPush.y;
            bz = vPush.z;
            bnx = vClosest.x;
            bny = vClosest.y;
            bnz = vClosest.z;
          }
          const penK = resolveProbeTorsoHull(vProbeK, knuckleR, hull, bone, input.scaleY, vPush, vClosest);
          if (penK > bestPen) {
            bestPen = penK;
            bx = vPush.x;
            by = vPush.y;
            bz = vPush.z;
            bnx = vClosest.x;
            bny = vClosest.y;
            bnz = vClosest.z;
          }
          const penF = resolveProbeTorsoHull(vProbeF, forearmR, hull, bone, input.scaleY, vPush, vClosest);
          // Forearm midpoint sits ~55% down the forearm, so scale its wrist correction slightly so the full forearm clears.
          if (penF * 1.2 > bestPen) {
            bestPen = penF * 1.2;
            bx = vPush.x * 1.2;
            by = vPush.y * 1.2;
            bz = vPush.z * 1.2;
            bnx = vClosest.x;
            bny = vClosest.y;
            bnz = vClosest.z;
          }
          if (bestPen > 1e-5) {
            hitBody = true;
            torsoPushMag = Math.max(torsoPushMag, bestPen);
            iterPushX += bx;
            iterPushY += by;
            iterPushZ += bz;
            vAccNorm.x += bnx * bestPen;
            vAccNorm.y += bny * bestPen;
            vAccNorm.z += bnz * bestPen;
            vProbeW.x += bx;
            vProbeW.y += by;
            vProbeW.z += bz;
            vProbeK.x += bx;
            vProbeK.y += by;
            vProbeK.z += bz;
            vProbeF.x += bx * 0.75;
            vProbeF.y += by * 0.75;
            vProbeF.z += bz * 0.75;
          }
        }

        // Self-body capsules (thighs always; generic torso capsules on procedural bodies).
        for (let ci = 0; ci < capCount; ci++) {
          const cap = this.bodyCaps[ci]!;
          let bestPen = 0;
          let bx = 0;
          let by = 0;
          let bz = 0;
          let bnx = 0;
          let bny = 0;
          let bnz = 0;

          const penW = resolveProbeCapsule(vProbeW, wristR, cap, side, vPush, vClosest);
          if (penW > bestPen) {
            bestPen = penW;
            bx = vPush.x;
            by = vPush.y;
            bz = vPush.z;
            bnx = vClosest.x;
            bny = vClosest.y;
            bnz = vClosest.z;
          }
          const penK = resolveProbeCapsule(vProbeK, knuckleR, cap, side, vPush, vClosest);
          if (penK > bestPen) {
            bestPen = penK;
            bx = vPush.x;
            by = vPush.y;
            bz = vPush.z;
            bnx = vClosest.x;
            bny = vClosest.y;
            bnz = vClosest.z;
          }
          if (!cap.isThigh) {
            const penF = resolveProbeCapsule(vProbeF, forearmR, cap, side, vPush, vClosest);
            if (penF * 1.15 > bestPen) {
              bestPen = penF * 1.15;
              bx = vPush.x * 1.15;
              by = vPush.y * 1.15;
              bz = vPush.z * 1.15;
              bnx = vClosest.x;
              bny = vClosest.y;
              bnz = vClosest.z;
            }
          }
          if (bestPen > 1e-5) {
            hitBody = true;
            if (!cap.isThigh) torsoPushMag = Math.max(torsoPushMag, bestPen);
            iterPushX += bx;
            iterPushY += by;
            iterPushZ += bz;
            vAccNorm.x += bnx * bestPen;
            vAccNorm.y += bny * bestPen;
            vAccNorm.z += bnz * bestPen;
            vProbeW.x += bx;
            vProbeW.y += by;
            vProbeW.z += bz;
            vProbeK.x += bx;
            vProbeK.y += by;
            vProbeK.z += bz;
            vProbeF.x += bx * 0.7;
            vProbeF.y += by * 0.7;
            vProbeF.z += bz * 0.7;
          }
        }

        vAccPush.x += iterPushX;
        vAccPush.y += iterPushY;
        vAccPush.z += iterPushZ;
        if (iterPushX * iterPushX + iterPushY * iterPushY + iterPushZ * iterPushZ < 1e-8) break;
      }

      const rawMag = vAccPush.length();
      // Clamp extreme correction (e.g. if a character spawns deeply embedded in a wall).
      if (rawMag > 0.45 * input.scaleY) vAccPush.multiplyScalar((0.45 * input.scaleY) / rawMag);

      const activeContact = hitWorld || hitBody;
      const targetW = activeContact ? THREE.MathUtils.clamp(rawMag / 0.015, 0.25, 1) : 0;

      if (!st.primed) {
        // Snap cleanly on frame 1 so freshly placed seated characters don't start clipped.
        st.smoothPush.copy(vAccPush);
        st.contact.weight = targetW;
        if (vAccNorm.lengthSq() > 1e-10) st.contact.normal.copy(vAccNorm).normalize();
        st.contact.kind = hitWorld ? 'world' : hitBody ? 'body' : 'none';
        st.primed = true;
      } else {
        const rate = activeContact ? ENTER_RATE : EXIT_RATE;
        const alpha = 1 - Math.exp(-rate * h);
        st.smoothPush.lerp(vAccPush, alpha);
        st.contact.weight += (targetW - st.contact.weight) * alpha;
        if (st.contact.weight < 0.005) st.contact.weight = 0;
        if (vAccNorm.lengthSq() > 1e-10) {
          vAccNorm.normalize();
          st.contact.normal.lerp(vAccNorm, alpha).normalize();
        }
        st.contact.kind = hitWorld ? 'world' : hitBody ? 'body' : st.contact.weight > 0.05 ? st.contact.kind : 'none';
      }

      if (st.smoothPush.lengthSq() > 1e-8) {
        // Keep the resolved wrist target safely within arm reach so the shoulder never pops.
        const lenAB = vShoulder.distanceTo(vElbow);
        const lenBC = vElbow.distanceTo(vWrist);
        const maxReach = (lenAB + lenBC) * 0.985;
        vTarget.copy(vWrist).add(st.smoothPush);
        vDiff.subVectors(vTarget, vShoulder);
        const reach = vDiff.length();
        if (reach > maxReach && reach > 1e-5) {
          vTarget.copy(vShoulder).addScaledVector(vDiff, maxReach / reach);
        }

        // Natural anatomical elbow pole: outward and slightly behind the shoulder normally,
        // swinging gently forward when clearing a thick chest/coat (crossed arms).
        const xSign = side === 'L' ? -1 : 1;
        const torsoSwing = THREE.MathUtils.clamp(torsoPushMag / 0.14, 0, 1);
        const poleZ = THREE.MathUtils.lerp(0.78, -0.35, torsoSwing);
        const poleX = xSign * THREE.MathUtils.lerp(0.68, 0.92, torsoSwing);
        input.group.localToWorld(vPole.set(poleX, Math.max(0.55, (vShoulder.y - floorY) - 0.25), poleZ));
        solveTwoBone(upper, fore, hand, vTarget, vPole, 1);
        solvedAny = true;
      }
    }

    if (solvedAny) input.group.updateMatrixWorld(true);
    return solvedAny;
  }
}
