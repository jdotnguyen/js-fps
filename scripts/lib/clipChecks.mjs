/**
 * Body-clearance checks and fixes for baked clips (mocap-library spec: different source proportions keep hands and feet off the
 * body). Works on RawMocapClip data (local joint quaternions per frame + pelvis offset) with Thalassa's reference skeleton.
 */
import * as THREE from 'three';
import { THALASSA_JOINTS } from './bvhBake.mjs';

/** Torso as an elliptic cylinder in the chest/pelvis frame (Thalassa reference body, metres). */
const TORSO = { rx: 0.14, rz: 0.1, y0: 0.0, y1: 0.5 };
/** Feet and shins closer than this to the other leg's shin line count as crossing. */
const LEG_GAP = 0.07;

export function buildRig() {
  const bones = {};
  for (const j of THALASSA_JOINTS) {
    const b = new THREE.Object3D();
    b.name = j.name;
    b.position.set(...j.offset);
    bones[j.name] = b;
    if (j.parent) bones[j.parent].add(b);
  }
  return bones;
}

const qOf = (arr, f) => new THREE.Quaternion(arr[f * 4], arr[f * 4 + 1], arr[f * 4 + 2], arr[f * 4 + 3]);

export function poseRig(rig, clip, f) {
  for (const [j, arr] of Object.entries(clip.joints)) if (rig[j]) rig[j].quaternion.copy(qOf(arr, f));
  rig.pelvis.position.set(clip.pelvis[f * 3], 0.98 + clip.pelvis[f * 3 + 1], clip.pelvis[f * 3 + 2]);
  rig.root.updateMatrixWorld(true);
}

const wpos = (b) => b.getWorldPosition(new THREE.Vector3());

/** Depth (m) a point sits inside the torso volume (0 = outside), in the frame spanned by pelvis -> neck. */
function torsoDepth(rig, p) {
  const base = wpos(rig.spine);
  const top = wpos(rig.neck);
  const axis = top.clone().sub(base);
  const len = axis.length();
  axis.normalize();
  const rel = p.clone().sub(base);
  const h = rel.dot(axis);
  if (h < TORSO.y0 || h > Math.min(TORSO.y1, len + 0.02)) return { depth: 0 };
  const chestQ = rig.chest.getWorldQuaternion(new THREE.Quaternion());
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(chestQ);
  const fwd = new THREE.Vector3().crossVectors(axis, right).normalize(); // -Z-ish
  const radial = rel.clone().sub(axis.clone().multiplyScalar(h));
  const x = radial.dot(right) / TORSO.rx;
  const z = radial.dot(fwd) / TORSO.rz;
  const r = Math.hypot(x, z);
  if (r >= 1) return { depth: 0 };
  // Push direction: radially outward in the ellipse (scaled back to metres).
  const out = right.clone().multiplyScalar((x / (r || 1)) * TORSO.rx).add(fwd.clone().multiplyScalar((z / (r || 1)) * TORSO.rz));
  const surface = base.clone().add(axis.clone().multiplyScalar(h)).add(out);
  return { depth: (1 - r) * Math.min(TORSO.rx, TORSO.rz), surface, normal: out.normalize() };
}

function segDist(p, a, b) {
  const ab = b.clone().sub(a);
  const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1);
  return { d: p.distanceTo(a.clone().add(ab.multiplyScalar(t))), closest: a.clone().add(b.clone().sub(a).multiplyScalar(t)) };
}

/** Every frame where a hand enters the torso or a foot crosses the other leg. */
export function clearanceProblems(clip, rig = buildRig()) {
  const out = [];
  for (let f = 0; f < clip.frames; f++) {
    poseRig(rig, clip, f);
    for (const s of ['L', 'R']) {
      const hand = wpos(rig[`hand_${s}`]);
      const tip = hand.clone().add(hand.clone().sub(wpos(rig[`foreArm_${s}`])).normalize().multiplyScalar(0.09));
      for (const p of [hand, tip]) {
        const t = torsoDepth(rig, p);
        if (t.depth > 0.02) out.push({ frame: f, what: `hand_${s} in torso`, depth: t.depth });
      }
      const o = s === 'L' ? 'R' : 'L';
      const foot = wpos(rig[`foot_${s}`]);
      const { d } = segDist(foot, wpos(rig[`shin_${o}`]), wpos(rig[`foot_${o}`]));
      if (d < LEG_GAP - 0.02) out.push({ frame: f, what: `foot_${s} through leg_${o}`, depth: LEG_GAP - d });
    }
  }
  return out;
}

/** Two-bone IK: rotate `upper` and `lower` (parent-local quaternions in the rig) so `end` reaches `target`, keeping the bend side. */
export function twoBone(rig, upper, lower, end, target) {
  const a = wpos(rig[upper]);
  const b = wpos(rig[lower]);
  const c = wpos(rig[end]);
  const l1 = a.distanceTo(b);
  const l2 = b.distanceTo(c);
  const toT = target.clone().sub(a);
  const dist = THREE.MathUtils.clamp(toT.length(), Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
  // Bend plane normal from the current pose.
  let n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(b));
  if (n.lengthSq() < 1e-10) n = new THREE.Vector3(1, 0, 0);
  n.normalize();
  const dir = toT.normalize();
  const cosA = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist);
  const angA = Math.acos(THREE.MathUtils.clamp(cosA, -1, 1));
  // Current elbow side: keep the elbow on the same side of the new reach line.
  const side = new THREE.Vector3().crossVectors(n, dir).normalize();
  const elbow = a.clone().add(dir.clone().multiplyScalar(Math.cos(angA) * l1)).add(side.multiplyScalar(-Math.sin(angA) * l1));
  const rotTo = (bone, from, to) => {
    const worldQ = rig[bone].getWorldQuaternion(new THREE.Quaternion());
    const delta = new THREE.Quaternion().setFromUnitVectors(from.clone().normalize(), to.clone().normalize());
    const parentQ = rig[bone].parent.getWorldQuaternion(new THREE.Quaternion());
    rig[bone].quaternion.copy(parentQ.invert().multiply(delta.multiply(worldQ))).normalize();
    rig.root.updateMatrixWorld(true);
  };
  rotTo(upper, b.clone().sub(a), elbow.clone().sub(a));
  rotTo(lower, wpos(rig[end]).sub(wpos(rig[lower])), target.clone().sub(wpos(rig[lower])));
}

/**
 * Fix clearance problems in place: hands are pushed out of the torso and feet out of the other leg with two-bone IK, blended
 * in and out over neighbouring frames so the fix never pops. Returns the number of frames changed.
 */
export function fixClearance(clip) {
  const rig = buildRig();
  const changed = new Set();
  for (let pass = 0; pass < 3; pass++) {
    const probs = clearanceProblems(clip, rig);
    if (!probs.length) break;
    const byFrame = new Map();
    for (const p of probs) byFrame.set(p.frame, [...(byFrame.get(p.frame) ?? []), p]);
    for (const [f, list] of byFrame) {
      poseRig(rig, clip, f);
      for (const p of list) {
        const s = p.what[5];
        if (p.what.startsWith('hand')) {
          const hand = wpos(rig[`hand_${s}`]);
          const tip = hand.clone().add(hand.clone().sub(wpos(rig[`foreArm_${s}`])).normalize().multiplyScalar(0.09));
          const t = torsoDepth(rig, torsoDepth(rig, tip).depth > torsoDepth(rig, hand).depth ? tip : hand);
          if (!t.surface) continue;
          const push = t.normal.clone().multiplyScalar(t.depth + 0.02);
          twoBone(rig, `upperArm_${s}`, `foreArm_${s}`, `hand_${s}`, hand.add(push));
        } else {
          const o = s === 'L' ? 'R' : 'L';
          const foot = wpos(rig[`foot_${s}`]);
          const { d, closest } = segDist(foot, wpos(rig[`shin_${o}`]), wpos(rig[`foot_${o}`]));
          const away = foot.clone().sub(closest).setY(0);
          if (away.lengthSq() < 1e-8) away.set(s === 'L' ? -1 : 1, 0, 0);
          twoBone(rig, `thigh_${s}`, `shin_${s}`, `foot_${s}`, foot.add(away.normalize().multiplyScalar(LEG_GAP - d + 0.01)));
        }
      }
      for (const j of ['upperArm_L', 'foreArm_L', 'upperArm_R', 'foreArm_R', 'thigh_L', 'shin_L', 'thigh_R', 'shin_R']) {
        const q = rig[j].quaternion;
        const arr = clip.joints[j];
        const old = qOf(arr, f);
        if (old.angleTo(q) < 1e-4) continue;
        // Spread the fix over two frames either side so it eases in and out.
        for (const [k, w] of [[f, 1], [f - 1, 0.6], [f + 1, 0.6], [f - 2, 0.25], [f + 2, 0.25]]) {
          const fi = clip.loop ? (k + clip.frames) % clip.frames : k;
          if (fi < 0 || fi >= clip.frames || (fi !== f && byFrame.has(fi))) continue;
          const delta = q.clone().multiply(old.clone().invert());
          const cur = qOf(arr, fi);
          const nq = new THREE.Quaternion().slerp(delta, w).multiply(cur).normalize();
          arr.splice(fi * 4, 4, nq.x, nq.y, nq.z, nq.w);
          changed.add(fi);
        }
      }
    }
  }
  // Back to the library's 3-decimal precision.
  for (const arr of Object.values(clip.joints)) for (let i = 0; i < arr.length; i++) arr[i] = Math.round(arr[i] * 1000) / 1000;
  return changed.size;
}
