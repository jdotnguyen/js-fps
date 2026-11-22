/**
 * Bake one BVH take onto Thalassa's 21-joint skeleton (mocap-library spec, design D9). Works for any BVH source whose rest pose
 * is arbitrary (CMU's T-pose, Bandai's folded all-+X rest): each target joint's frame is calibrated from the motion itself.
 *
 * For every joint, an anatomical world frame is measured from joint positions on every frame (bone direction plus a second axis:
 * the body's left-right line for the trunk, the elbow or knee hinge for limbs). The constant offset between that frame and the
 * source bone's own world rotation is averaged over the clip (weighted by how well the hinge is defined), and the source rotation
 * times that offset drives the joint. Directions come from positions, and twist (forearm roll, wrist, head turns) comes from the
 * source rotations, so nothing depends on the source's rest pose.
 *
 * Output matches src/data/mocap-core.json clips: local joint quaternions per frame at 24 fps, pelvis offset, foot contacts, stride.
 */
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';
import * as THREE from 'three';

export const SAMPLE_FPS = 24;

/** Thalassa 21-joint layout (must stay in sync with src/actors/skeleton.ts and bake-mocap.mjs). */
export const THALASSA_JOINTS = [
  { name: 'root', parent: null, offset: [0, 0, 0] },
  { name: 'pelvis', parent: 'root', offset: [0, 0.98, 0] },
  { name: 'spine', parent: 'pelvis', offset: [0, 0.12, 0] },
  { name: 'chest', parent: 'spine', offset: [0, 0.18, 0] },
  { name: 'neck', parent: 'chest', offset: [0, 0.22, 0] },
  { name: 'head', parent: 'neck', offset: [0, 0.08, 0] },
  { name: 'jaw', parent: 'head', offset: [0, 0.062, 0.01] },
  { name: 'shoulder_L', parent: 'chest', offset: [-0.17, 0.2, 0] },
  { name: 'upperArm_L', parent: 'shoulder_L', offset: [-0.035, -0.01, 0] },
  { name: 'foreArm_L', parent: 'upperArm_L', offset: [0, -0.29, 0] },
  { name: 'hand_L', parent: 'foreArm_L', offset: [0, -0.26, 0] },
  { name: 'thigh_L', parent: 'pelvis', offset: [-0.095, -0.06, 0] },
  { name: 'shin_L', parent: 'thigh_L', offset: [0, -0.44, 0] },
  { name: 'foot_L', parent: 'shin_L', offset: [0, -0.42, 0] },
  { name: 'shoulder_R', parent: 'chest', offset: [0.17, 0.2, 0] },
  { name: 'upperArm_R', parent: 'shoulder_R', offset: [0.035, -0.01, 0] },
  { name: 'foreArm_R', parent: 'upperArm_R', offset: [0, -0.29, 0] },
  { name: 'hand_R', parent: 'foreArm_R', offset: [0, -0.26, 0] },
  { name: 'thigh_R', parent: 'pelvis', offset: [0.095, -0.06, 0] },
  { name: 'shin_R', parent: 'thigh_R', offset: [0, -0.44, 0] },
  { name: 'foot_R', parent: 'shin_R', offset: [0, -0.42, 0] },
];
const JOINT = Object.fromEntries(THALASSA_JOINTS.map((j) => [j.name, j]));
/** Thalassa leg length (thigh + shin), the scale reference for every source. */
const LEG = 0.44 + 0.42;

/**
 * Source bone names for each landmark the retarget needs, per source. `head_end`/`toe` may be missing (Bandai's head and hand
 * end sites have zero length); joints without a usable direction are calibrated against their parent's frame instead.
 */
export const BONE_MAPS = {
  cmu: {
    hips: 'Hips', spine: 'Spine', chest: 'Spine1', neck: 'Neck1', head: 'Head', headEnd: null,
    shoulder_L: 'LeftShoulder', upperArm_L: 'LeftArm', foreArm_L: 'LeftForeArm', hand_L: 'LeftHand', handEnd_L: 'LeftFingerBase',
    shoulder_R: 'RightShoulder', upperArm_R: 'RightArm', foreArm_R: 'RightForeArm', hand_R: 'RightHand', handEnd_R: 'RightFingerBase',
    thigh_L: 'LeftUpLeg', shin_L: 'LeftLeg', foot_L: 'LeftFoot', toe_L: 'LeftToeBase',
    thigh_R: 'RightUpLeg', shin_R: 'RightLeg', foot_R: 'RightFoot', toe_R: 'RightToeBase',
  },
  bandai: {
    hips: 'Hips', spine: 'Spine', chest: 'Chest', neck: 'Neck', head: 'Head', headEnd: null,
    shoulder_L: 'Shoulder_L', upperArm_L: 'UpperArm_L', foreArm_L: 'LowerArm_L', hand_L: 'Hand_L', handEnd_L: null,
    shoulder_R: 'Shoulder_R', upperArm_R: 'UpperArm_R', foreArm_R: 'LowerArm_R', hand_R: 'Hand_R', handEnd_R: null,
    thigh_L: 'UpperLeg_L', shin_L: 'LowerLeg_L', foot_L: 'Foot_L', toe_L: 'Toes_L',
    thigh_R: 'UpperLeg_R', shin_R: 'LowerLeg_R', foot_R: 'Foot_R', toe_R: 'Toes_R',
  },
};

/** Guess a bone map from names (for sources such as 100STYLE whose files are added later). */
export function guessBoneMap(names) {
  const find = (...res) => {
    for (const re of res) {
      const n = names.find((x) => re.test(x));
      if (n) return n;
    }
    return null;
  };
  const side = (s) => (s === 'L' ? '(Left|L_|_L$|\\.L$|^L)' : '(Right|R_|_R$|\\.R$|^R)');
  const m = { hips: find(/^hips$/i, /pelvis/i), spine: find(/^spine$/i, /lowerback/i, /spine1/i), chest: find(/chest/i, /spine2/i, /spine1/i), neck: find(/^neck$/i, /neck/i), head: find(/^head$/i), headEnd: null };
  for (const s of ['L', 'R']) {
    const sd = side(s);
    m[`shoulder_${s}`] = find(new RegExp(`${sd}.*(shoulder|collar|clavicle)`, 'i'), new RegExp(`(shoulder|collar|clavicle).*${sd}`, 'i'));
    m[`upperArm_${s}`] = find(new RegExp(`${sd}.*(upperarm|^.*arm$)`, 'i'), new RegExp(`upperarm.*${sd}`, 'i'));
    m[`foreArm_${s}`] = find(new RegExp(`${sd}.*(forearm|lowerarm|elbow)`, 'i'), new RegExp(`(forearm|lowerarm).*${sd}`, 'i'));
    m[`hand_${s}`] = find(new RegExp(`${sd}.*(hand|wrist)$`, 'i'), new RegExp(`(hand|wrist).*${sd}`, 'i'));
    m[`handEnd_${s}`] = null;
    m[`thigh_${s}`] = find(new RegExp(`${sd}.*(upleg|thigh|upperleg|hip$)`, 'i'), new RegExp(`(upleg|thigh|upperleg).*${sd}`, 'i'));
    m[`shin_${s}`] = find(new RegExp(`${sd}.*(leg$|shin|knee|lowerleg|calf)`, 'i'), new RegExp(`(shin|knee|lowerleg|calf).*${sd}`, 'i'));
    m[`foot_${s}`] = find(new RegExp(`${sd}.*(foot|ankle)$`, 'i'), new RegExp(`(foot|ankle).*${sd}`, 'i'));
    m[`toe_${s}`] = find(new RegExp(`${sd}.*toe`, 'i'), new RegExp(`toe.*${sd}`, 'i'));
  }
  return m;
}

/** Orthonormal basis (x, y, z columns) with `a` as `axisA` direction and `b` projected orthogonal as the second axis. */
function frame(dir, second) {
  const y = dir.clone().normalize();
  const x = second.clone().sub(y.clone().multiplyScalar(second.dot(y)));
  if (x.lengthSq() < 1e-10) return null;
  x.normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return new THREE.Matrix4().makeBasis(x, y, z);
}

/** Rotation taking the target rest frame (tDir, tSec) to the measured frame (sDir, sSec), or null when degenerate. */
function frameRotation(tDir, tSec, sDir, sSec) {
  const ft = frame(tDir, tSec);
  const fs = frame(sDir, sSec);
  if (!ft || !fs) return null;
  const m = fs.multiply(ft.clone().invert());
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

/** Weighted quaternion average (hemisphere-aligned to the first). */
function averageQuat(list) {
  const acc = [0, 0, 0, 0];
  let ref = null;
  let total = 0;
  for (const { q, w } of list) {
    if (!(w > 0)) continue;
    ref ??= q;
    const s = q.dot(ref) < 0 ? -w : w;
    acc[0] += q.x * s;
    acc[1] += q.y * s;
    acc[2] += q.z * s;
    acc[3] += q.w * s;
    total += w;
  }
  if (!total) return null;
  return new THREE.Quaternion(acc[0], acc[1], acc[2], acc[3]).normalize();
}

const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * BVHLoader adds each joint's OFFSET to its position channels. Some exporters (Bandai Namco's datasets) give every joint position
 * channels holding the joint's full local position, which already includes the offset, so every bone would load twice as long
 * and the bake, scaling the doubled legs down, would halve the travel and the stride. When the child joints' channels repeat
 * their offsets, the file's positions are absolute: take the offset back out of every position track (root included).
 */
export function absolutePositions(tracks) {
  const pos = tracks.filter((t) => t.path === 'position' && t.values.length >= 3);
  const children = pos.filter((t) => t.bone.parent?.isBone);
  if (!children.length) return false;
  const repeats = children.filter((t) => {
    const o = t.bone.position; // rest = offset
    const ch = new THREE.Vector3(t.values[0] - o.x, t.values[1] - o.y, t.values[2] - o.z);
    return ch.distanceTo(o) <= Math.max(1e-3, 0.02 * o.length());
  });
  if (repeats.length < children.length * 0.8) return false;
  for (const t of pos) {
    const o = t.bone.position;
    for (let i = 0; i < t.values.length; i += 3) {
      t.values[i] -= o.x;
      t.values[i + 1] -= o.y;
      t.values[i + 2] -= o.z;
    }
  }
  return true;
}

/** Parse a BVH file and return a sampler for world positions and rotations at any source frame. */
export function loadBvh(text) {
  const { skeleton, clip } = new BVHLoader().parse(text);
  const bones = skeleton.bones;
  const byName = new Map(bones.map((b) => [b.name, b]));
  const tracks = clip.tracks.map((t) => {
    const m = /^(?:\.bones\[)?(.+?)\]?\.(position|quaternion)$/.exec(t.name);
    return { bone: byName.get(m[1]), path: m[2], values: t.values, times: t.times };
  });
  absolutePositions(tracks);
  const frames = Math.max(...tracks.map((t) => t.times.length));
  const frameTime = frames > 1 ? clip.duration / (frames - 1) : 1 / 30;
  const root = bones[0];
  const rest = bones.map((b) => ({ p: b.position.clone(), q: b.quaternion.clone() }));
  /** Pose the skeleton at source frame `f` (integer). */
  const pose = (f) => {
    bones.forEach((b, i) => {
      b.position.copy(rest[i].p);
      b.quaternion.copy(rest[i].q);
    });
    for (const t of tracks) {
      const k = Math.min(f, t.times.length - 1);
      if (t.path === 'position') t.bone.position.fromArray(t.values, k * 3);
      else t.bone.quaternion.fromArray(t.values, k * 4).normalize();
    }
    root.updateMatrixWorld(true);
  };
  return { bones, byName, frames, frameTime, pose, names: bones.map((b) => b.name) };
}

/**
 * Bake a take. `spec`: { id, loop, loco, start?, end? (seconds), seamBlend?, cycles? (loco: gait cycles to keep, default 1),
 * mirror? }. Returns { clip, info } where `clip` is a RawMocapClip.
 */
export function bakeBvh(text, map, spec) {
  const src = loadBvh(text);
  const B = (k) => (map[k] ? src.byName.get(map[k]) : null);
  for (const k of ['hips', 'spine', 'chest', 'neck', 'head', 'upperArm_L', 'foreArm_L', 'hand_L', 'upperArm_R', 'foreArm_R', 'hand_R', 'thigh_L', 'shin_L', 'foot_L', 'toe_L', 'thigh_R', 'shin_R', 'foot_R', 'toe_R']) {
    if (!B(k)) throw new Error(`${spec.id}: source has no bone for "${k}" (map: ${map[k]})`);
  }
  const wp = (k) => B(k).getWorldPosition(new THREE.Vector3());
  const wq = (k) => B(k).getWorldQuaternion(new THREE.Quaternion());

  // ---- 1. Measure every source frame: landmark positions and bone world rotations. A first frame that jumps away from the
  // second (the T-pose calibration frame CMU's conversions start with) is dropped.
  const keys = Object.keys(map).filter((k) => map[k] && src.byName.has(map[k]));
  let first = 0;
  if (src.frames > 2) {
    src.pose(0);
    const a = keys.map((k) => wq(k));
    src.pose(1);
    const jump = keys.some((k, i) => Math.abs(wq(k).dot(a[i])) < 0.95);
    if (jump) first = 1;
  }
  const F = src.frames - first;
  const P = [];
  const Q = [];
  for (let f = 0; f < F; f++) {
    src.pose(f + first);
    const p = {};
    const q = {};
    for (const k of keys) {
      p[k] = wp(k);
      q[k] = wq(k);
    }
    P.push(p);
    Q.push(q);
  }

  // ---- 2. Global alignment: source world (Y-up assumed, checked below) to Thalassa (facing -Z, left at -X), and scale.
  let legSum = 0;
  const fwd = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (const p of P) {
    legSum += (p.thigh_L.distanceTo(p.shin_L) + p.shin_L.distanceTo(p.foot_L) + p.thigh_R.distanceTo(p.shin_R) + p.shin_R.distanceTo(p.foot_R)) / 2;
    const right = p.thigh_R.clone().sub(p.thigh_L);
    fwd.add(new THREE.Vector3().crossVectors(up, right).setY(0));
  }
  const scale = LEG / (legSum / F);
  const yaw = Math.atan2(fwd.x, fwd.z); // source forward heading
  // Rotate so the source forward points to Thalassa forward (-Z).
  const align = new THREE.Quaternion().setFromAxisAngle(up, Math.PI - yaw);
  const headAbove = P.reduce((s, p) => s + (p.head.y > p.hips.y ? 1 : 0), 0) / F;
  if (headAbove < 0.9) throw new Error(`${spec.id}: head is above the hips on only ${(headAbove * 100).toFixed(0)}% of frames; is the source Y-up?`);
  const A = (v) => v.clone().applyQuaternion(align);

  // ---- 3. Measured anatomical frames per joint per frame (in Thalassa world), with a reliability weight.
  const RIGHT = new THREE.Vector3(1, 0, 0);
  const UP = new THREE.Vector3(0, 1, 0);
  const restDir = (j) => {
    const child = THALASSA_JOINTS.find((c) => c.parent === j && c.name !== 'jaw');
    return new THREE.Vector3(...child.offset).normalize();
  };
  const measured = (p, j, straightLegs = false) => {
    const v = (a, b) => A(p[b].clone().sub(p[a]));
    // Direction from `a` toward the first of `bs` that is not on top of it (CMU's Spine1 and Neck share a point).
    const up = (a, ...bs) => {
      for (const b of bs) {
        if (!p[b]) continue;
        const d = v(a, b);
        if (d.lengthSq() > 1e-6) return d;
      }
      return v('hips', 'head');
    };
    const hipLine = v('thigh_L', 'thigh_R');
    const shoulderLine = p.upperArm_L && p.upperArm_R ? v('upperArm_L', 'upperArm_R') : hipLine;
    switch (j) {
      case 'pelvis':
        return { q: frameRotation(restDir('pelvis'), RIGHT, up('hips', 'spine', 'chest', 'neck'), hipLine), w: 1 };
      case 'spine':
        return { q: frameRotation(UP, RIGHT, up('spine', 'chest', 'neck', 'head'), hipLine.clone().add(shoulderLine)), w: 1 };
      case 'chest':
        return { q: frameRotation(UP, RIGHT, up('chest', 'neck', 'head'), shoulderLine), w: 1 };
      case 'neck':
        return { q: frameRotation(UP, RIGHT, up('neck', 'head'), shoulderLine), w: 1 };
      default:
    }
    const s = j.slice(-1);
    const lim = j.slice(0, -2);
    if (lim === 'shoulder') {
      if (!p[`shoulder_${s}`]) return null;
      return { q: frameRotation(restDir(j), UP, v(`shoulder_${s}`, `upperArm_${s}`), up('spine', 'neck', 'head')), w: 1 };
    }
    if (lim === 'upperArm' || lim === 'foreArm') {
      const a = v(`upperArm_${s}`, `foreArm_${s}`);
      const b = v(`foreArm_${s}`, `hand_${s}`);
      const hinge = new THREE.Vector3().crossVectors(a.clone().normalize(), b.clone().normalize());
      const w = hinge.length();
      const dir = lim === 'upperArm' ? a : b;
      // Thalassa elbows flex forward: hanging arm (-Y) bending to -Z has hinge (-Y)x(-Z) = +X.
      return { q: w > 0.15 ? frameRotation(new THREE.Vector3(0, -1, 0), RIGHT, dir, hinge) : null, w: w * w };
    }
    if (lim === 'thigh' || lim === 'shin') {
      const a = v(`thigh_${s}`, `shin_${s}`);
      const b = v(`shin_${s}`, `foot_${s}`);
      const hinge = new THREE.Vector3().crossVectors(a.clone().normalize(), b.clone().normalize());
      const w = hinge.length();
      const dir = lim === 'thigh' ? a : b;
      // Knees flex backward: thigh (-Y) to shin (+Z) gives hinge (-Y)x(+Z) = -X.
      // A performer who never bends the knee (CMU subject 79 stands locked-kneed throughout) gives no hinge plane; then the knee is
      // taken to point straight ahead of the hips (hinge along the hip line), only when no frame of the take bends it.
      if (w <= 0.12 && straightLegs) return { q: frameRotation(new THREE.Vector3(0, -1, 0), RIGHT.clone().negate(), dir, hipLine.clone().negate()), w: 1 };
      return { q: w > 0.12 ? frameRotation(new THREE.Vector3(0, -1, 0), RIGHT.clone().negate(), dir, hinge) : null, w: w * w };
    }
    if (lim === 'foot') {
      return { q: frameRotation(new THREE.Vector3(0, -0.25, -1), RIGHT, v(`foot_${s}`, `toe_${s}`), hipLine), w: 1 };
    }
    return null;
  };

  // Joints driven by a source bone, and the frame used to calibrate it when it has no usable direction of its own.
  const SOURCE_OF = {
    pelvis: 'hips', spine: 'spine', chest: 'chest', neck: 'neck', head: 'head',
    shoulder_L: 'shoulder_L', upperArm_L: 'upperArm_L', foreArm_L: 'foreArm_L', hand_L: 'hand_L',
    shoulder_R: 'shoulder_R', upperArm_R: 'upperArm_R', foreArm_R: 'foreArm_R', hand_R: 'hand_R',
    thigh_L: 'thigh_L', shin_L: 'shin_L', foot_L: 'foot_L', thigh_R: 'thigh_R', shin_R: 'shin_R', foot_R: 'foot_R',
  };
  // head: assumed level with the neck on average; hands: wrist neutral against the forearm on average; shoulders: at rest against
  // the chest on average. Source skeletons run the clavicle up from the sternum (CMU, Bandai) where the shared skeleton runs it out
  // and down, so copying its direction lifted every baked character's shoulders 25-40 degrees into a constant shrug. Calibrated
  // against the chest, the clip keeps the performer's shrugs and rolls as movement away from the shared skeleton's rest.
  const CALIBRATE_AGAINST = { head: 'neck', hand_L: 'foreArm_L', hand_R: 'foreArm_R', shoulder_L: 'chest', shoulder_R: 'chest' };

  const calib = {};
  const order = ['pelvis', 'spine', 'chest', 'neck', 'shoulder_L', 'upperArm_L', 'foreArm_L', 'shoulder_R', 'upperArm_R', 'foreArm_R', 'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R', 'head', 'hand_L', 'hand_R'];
  const worldOf = (f, j) => align.clone().multiply(Q[f][SOURCE_OF[j]]).multiply(calib[j]);
  for (const j of order) {
    if (!B(SOURCE_OF[j])) continue;
    const sample = (straightLegs) => {
      const samples = [];
      for (let f = 0; f < F; f++) {
        let m;
        if (CALIBRATE_AGAINST[j]) m = { q: worldOf(f, CALIBRATE_AGAINST[j]), w: 1 };
        else m = measured(P[f], j, straightLegs);
        if (!m || !m.q) continue;
        const srcW = align.clone().multiply(Q[f][SOURCE_OF[j]]);
        samples.push({ q: srcW.invert().multiply(m.q), w: m.w });
      }
      return samples;
    };
    let samples = sample(false);
    if (!samples.length && /^(thigh|shin)_/.test(j)) samples = sample(true);
    const c = averageQuat(samples);
    if (!c) throw new Error(`${spec.id}: could not calibrate ${j} (no frame with a usable ${j} frame)`);
    calib[j] = c;
  }
  // Shoulders missing in a source follow the chest.
  for (const s of ['L', 'R']) if (!calib[`shoulder_${s}`]) calib[`shoulder_${s}`] = null;

  // ---- 4. Resample to 24 fps with a box low-pass over the source frames in each output sample.
  const srcFps = 1 / src.frameTime;
  const tStart = spec.start ?? 0;
  const tEndAll = (F - 1) * src.frameTime;
  let tEnd = spec.end ?? tEndAll;
  const worldAt = (t) => {
    const fc = t * srcFps;
    const half = Math.max(0, Math.round(srcFps / SAMPLE_FPS / 2));
    const f0 = Math.max(0, Math.min(F - 1, Math.round(fc) - half));
    const f1 = Math.max(0, Math.min(F - 1, Math.round(fc) + half));
    const out = {};
    for (const j of Object.keys(SOURCE_OF)) {
      const list = [];
      for (let f = f0; f <= f1; f++) {
        if (j.startsWith('shoulder') && !calib[j]) list.push({ q: worldOf(f, 'chest'), w: 1 });
        else if (calib[j]) list.push({ q: worldOf(f, j), w: 1 });
      }
      out[j] = averageQuat(list);
    }
    const hp = new THREE.Vector3();
    for (let f = f0; f <= f1; f++) hp.add(A(P[f].hips));
    out.hips = hp.multiplyScalar(scale / (f1 - f0 + 1));
    return out;
  };

  // ---- 5. Loop window: for locomotion, find the gait cycle whose ends match best.
  if (spec.loop && spec.loco && spec.end === undefined) {
    const step = 1 / SAMPLE_FPS;
    const samples = [];
    for (let t = 0; t <= tEndAll; t += step) samples.push(worldAt(t));
    const dist = (a, b) => {
      let d = 0;
      for (const j of ['thigh_L', 'shin_L', 'thigh_R', 'shin_R', 'upperArm_L', 'upperArm_R', 'spine']) d += 1 - Math.abs(a[j].dot(b[j]));
      return d;
    };
    const cycles = spec.cycles ?? 1;
    // Prefer steady walking: a window whose speed is near the take's median (not starting, stopping or turning).
    const speed = samples.map((w, i) => (i ? w.hips.clone().sub(samples[i - 1].hips).setY(0).length() * SAMPLE_FPS : 0));
    const sorted = speed.slice(1).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length * 0.6)] ?? 0;
    const meanSpeed = (s, e) => samples[e].hips.clone().sub(samples[s].hips).setY(0).length() / ((e - s) / SAMPLE_FPS);
    let best = { cost: Infinity, s: 0, e: samples.length - 1 };
    const margin = Math.round(0.3 * SAMPLE_FPS);
    for (let s = margin; s < samples.length - margin; s++) {
      for (let len = Math.round(0.8 * cycles * SAMPLE_FPS); len <= Math.round(1.6 * cycles * SAMPLE_FPS); len++) {
        const e = s + len;
        if (e >= samples.length - 2) break;
        const c = dist(samples[s], samples[e]) + 0.5 * dist(samples[s + 1], samples[e + 1]) + 0.002 * Math.abs(len - 1.15 * cycles * SAMPLE_FPS) + 0.4 * Math.abs(meanSpeed(s, e) - median) / Math.max(0.2, median);
        if (c < best.cost) best = { cost: c, s, e };
      }
    }
    spec = { ...spec, start: best.s * step };
    tEnd = best.e * step;
  }
  const t0 = spec.start ?? tStart;
  const duration = tEnd - t0;
  const frameCount = Math.max(2, Math.round(duration * SAMPLE_FPS));
  const dt = duration / frameCount;
  const numFrames = spec.loop ? frameCount : frameCount + 1;

  const W = [];
  for (let f = 0; f < numFrames; f++) W.push(worldAt(t0 + f * dt));
  // Loop-closing sample (one past the end) for in-place travel removal.
  const closing = worldAt(t0 + numFrames * dt);
  const trunk = spec.levelTrunk ? levelTrunk(W, [...W, closing]) : null;

  // ---- 6. Local joint rotations.
  const jointNames = THALASSA_JOINTS.map((j) => j.name).filter((n) => n !== 'root' && n !== 'jaw');
  const parentW = (w, j) => (JOINT[j].parent === 'root' ? new THREE.Quaternion() : w[JOINT[j].parent]);
  const qFrames = {};
  for (const j of jointNames) qFrames[j] = W.map((w) => parentW(w, j).clone().invert().multiply(w[j]).normalize());
  // Loop closure: the pose one step past the end should equal frame 0. Spread the remaining difference over the cycle so the
  // loop closes exactly with no pop (and no frozen blend at the seam).
  if (spec.loop) {
    for (const j of jointNames) {
      const end = parentW(closing, j).clone().invert().multiply(closing[j]).normalize();
      const fix = qFrames[j][0].clone().multiply(end.clone().invert()); // end -> start
      if (fix.w < 0) fix.set(-fix.x, -fix.y, -fix.z, -fix.w);
      const id = new THREE.Quaternion();
      for (let f = 0; f < numFrames; f++) {
        const part = id.clone().slerp(fix, f / numFrames);
        qFrames[j][f] = part.multiply(qFrames[j][f]).normalize();
      }
    }
  }

  // ---- 7. Pelvis: in place (linear travel removed), stride from travel per loop.
  const travel = closing.hips.clone().sub(W[0].hips).setY(0);
  const pelvisPos = W.map((w, f) => {
    const p = w.hips.clone().sub(W[0].hips);
    if (spec.loop) p.sub(travel.clone().multiplyScalar(f / numFrames));
    return p;
  });

  // Seam blend for looping clips.
  const blend = spec.loop ? Math.min(spec.seamBlend ?? (spec.loco ? 0 : 6), Math.floor(numFrames / 3)) : 0;
  for (let k = 0; k < blend; k++) {
    const fi = numFrames - blend + k;
    const s = (k + 1) / (blend + 1);
    const sm = s * s * (3 - 2 * s);
    for (const j of jointNames) qFrames[j][fi].slerp(qFrames[j][0], sm);
    pelvisPos[fi].lerp(pelvisPos[0], sm);
  }

  // FK on the Thalassa rig: feet height sets the pelvis height (lowest stance foot = rest foot height), contacts.
  const rig = {};
  for (const j of THALASSA_JOINTS) {
    const b = new THREE.Object3D();
    b.position.set(...j.offset);
    rig[j.name] = b;
    if (j.parent) rig[j.parent].add(b);
  }
  rig.root.updateMatrixWorld(true);
  const restFootY = rig.foot_L.getWorldPosition(new THREE.Vector3()).y;
  const fk = (f, py) => {
    for (const j of jointNames) rig[j].quaternion.copy(qFrames[j][f]);
    rig.pelvis.position.set(pelvisPos[f].x, 0.98 + py, pelvisPos[f].z);
    rig.root.updateMatrixWorld(true);
    return [rig.foot_L.getWorldPosition(new THREE.Vector3()), rig.foot_R.getWorldPosition(new THREE.Vector3())];
  };
  let minFoot = Infinity;
  for (let f = 0; f < numFrames; f++) {
    const [l, r] = fk(f, pelvisPos[f].y);
    minFoot = Math.min(minFoot, l.y, r.y);
  }
  const lift = restFootY - minFoot;
  let meanX = 0;
  let meanZ = 0;
  for (const p of pelvisPos) {
    p.y += lift;
    meanX += p.x / numFrames;
    meanZ += p.z / numFrames;
  }
  for (const p of pelvisPos) {
    p.x -= meanX;
    p.z -= meanZ;
  }
  const footL = [];
  const footR = [];
  for (let f = 0; f < numFrames; f++) {
    const [l, r] = fk(f, pelvisPos[f].y);
    footL.push(l);
    footR.push(r);
  }

  // Fidelity: hands, feet and head relative to the pelvis, Thalassa FK against the scaled source (same alignment).
  let err = 0;
  let errN = 0;
  const LAND = [['hand_L', 'hand_L'], ['hand_R', 'hand_R'], ['foot_L', 'foot_L'], ['foot_R', 'foot_R'], ['head', 'head']];
  for (let f = 0; f < numFrames; f++) {
    fk(f, pelvisPos[f].y);
    const pel = rig.pelvis.getWorldPosition(new THREE.Vector3());
    const fc = Math.min(F - 1, Math.round((t0 + f * dt) * srcFps));
    const sp = A(P[fc].hips).multiplyScalar(scale);
    for (const [tj, sk] of LAND) {
      const t = rig[tj].getWorldPosition(new THREE.Vector3()).sub(pel);
      const sv = A(P[fc][sk]).multiplyScalar(scale).sub(sp);
      err += t.distanceTo(sv);
      errN++;
    }
  }
  const fidelity = err / errN;
  // Segment direction error (degrees): Thalassa bone directions against the source's, independent of proportions.
  const SEGS = [['upperArm_L', 'foreArm_L'], ['foreArm_L', 'hand_L'], ['upperArm_R', 'foreArm_R'], ['foreArm_R', 'hand_R'], ['thigh_L', 'shin_L'], ['shin_L', 'foot_L'], ['thigh_R', 'shin_R'], ['shin_R', 'foot_R'], ['foot_L', 'toe_L'], ['foot_R', 'toe_R']];
  let ang = 0;
  let angMax = 0;
  let angWorst = '';
  let angN = 0;
  for (let f = 0; f < numFrames; f++) {
    fk(f, pelvisPos[f].y);
    const fc = Math.min(F - 1, Math.round((t0 + f * dt) * srcFps));
    for (const [a, b] of SEGS) {
      let td;
      if (b.startsWith('toe')) td = new THREE.Vector3(0, -0.25, -1).normalize().applyQuaternion(rig[a].getWorldQuaternion(new THREE.Quaternion()));
      else td = rig[b].getWorldPosition(new THREE.Vector3()).sub(rig[a].getWorldPosition(new THREE.Vector3())).normalize();
      const sd = A(P[fc][b].clone().sub(P[fc][a])).normalize();
      const d = (Math.acos(THREE.MathUtils.clamp(td.dot(sd), -1, 1)) * 180) / Math.PI;
      ang += d;
      if (d > angMax) angWorst = `${a}->${b}@${f}`;
      angMax = Math.max(angMax, d);
      angN++;
    }
  }
  const segmentError = ang / angN;

  const out = { duration: r3(duration), frames: numFrames, loop: Boolean(spec.loop), pelvis: [], joints: {} };
  for (const p of pelvisPos) out.pelvis.push(r3(p.x), r3(p.y), r3(p.z));
  for (const j of jointNames) {
    const arr = [];
    for (let f = 0; f < numFrames; f++) {
      const q = qFrames[j][f];
      if (f > 0 && q.dot(qFrames[j][f - 1]) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      arr.push(r3(q.x), r3(q.y), r3(q.z), r3(q.w));
    }
    out.joints[j] = arr;
  }
  if (spec.loco) {
    const stride = travel.length();
    out.stride = r3(stride);
    const minY = Math.min(...footL.map((p) => p.y), ...footR.map((p) => p.y));
    const maxY = Math.max(...footL.map((p) => p.y), ...footR.map((p) => p.y));
    const ySpan = Math.max(0.05, maxY - minY);
    const contact = (pts) =>
      pts.map((cur, f) => {
        const prev = pts[(f - 1 + numFrames) % numFrames];
        const next = pts[(f + 1) % numFrames];
        const vz = (next.z - prev.z) / (2 * dt) + stride / duration; // stance foot moves back at the travel speed in place
        const low = THREE.MathUtils.clamp(1 - ((cur.y - minY) / ySpan - 0.12) / 0.25, 0, 1);
        const back = THREE.MathUtils.clamp((vz - 0.1) / 0.6, 0, 1);
        return r3(low * Math.max(back, vz > -0.05 && low > 0.95 ? 1 : 0));
      });
    out.contactL = contact(footL);
    out.contactR = contact(footR);
  }
  return { clip: out, info: { fidelity, segmentError, segmentErrorMax: angMax, segmentWorst: angWorst, scale, yaw, start: t0, end: tEnd, srcFps, frames: numFrames, calibrated: Object.keys(calib).filter((k) => calib[k]), trunk } };
}

/** How far the levelled chest may still lean, degrees (standing-posture-stability: upright trunk): a little toward the work, barely back. */
export const LEVEL_CHEST_FORWARD = 10;
export const LEVEL_CHEST_BACK = 3;
const ABOVE_CHEST = ['neck', 'head', 'shoulder_L', 'upperArm_L', 'foreArm_L', 'hand_L', 'shoulder_R', 'upperArm_R', 'foreArm_R', 'hand_R'];
const TRUNK = ['pelvis', 'spine', 'chest'];

/**
 * Average forward pitch (degrees, positive forward) of the pelvis, spine and chest segments over world-rotation samples, about
 * the horizontal `right` axis. Thalassa faces -Z, so forward is up x right.
 */
export function trunkPitch(samples, right) {
  const UP = new THREE.Vector3(0, 1, 0);
  const fwd = new THREE.Vector3().crossVectors(UP, right);
  const u = new THREE.Vector3();
  const sum = { pelvis: 0, spine: 0, chest: 0 };
  for (const w of samples) {
    for (const j of TRUNK) {
      u.copy(UP).applyQuaternion(w[j]);
      sum[j] += THREE.MathUtils.radToDeg(Math.atan2(u.dot(fwd), u.y));
    }
  }
  for (const j of TRUNK) sum[j] /= samples.length;
  return sum;
}

/**
 * Level a standing take's trunk (design D2 of level-mocap-trunk-posture). Removes the clip's average forward/back tilt from the
 * pelvis, spine and chest, keeping the chest's own lean within LEVEL_CHEST_FORWARD forward and LEVEL_CHEST_BACK back and spreading it evenly over the lower and
 * upper back. Only the constant average changes, so every frame keeps its motion around it:
 *   - the arms, neck and head ride with the chest (their pose against it is kept, so a head tipped back only by the trunk comes level);
 *   - the thighs keep their world rotation (legs untouched);
 *   - the hips shift so the hip joints, and so the feet, stay where they were.
 * `measure` are the samples the average comes from, `apply` every sample to correct (with the loop-closing one). Mutates `apply`.
 */
export function levelTrunk(measure, apply) {
  // The clip's horizontal right axis, from the pelvis (the same for every sample, so turning and side-lean are untouched).
  const right = new THREE.Vector3();
  for (const w of measure) right.add(new THREE.Vector3(1, 0, 0).applyQuaternion(w.pelvis).setY(0));
  right.normalize();
  const before = trunkPitch(measure, right);
  const chest = THREE.MathUtils.clamp(before.chest, -LEVEL_CHEST_BACK, LEVEL_CHEST_FORWARD);
  const target = { pelvis: 0, spine: chest / 2, chest };
  // A forward tilt of a degrees is a rotation of -a about the right axis (+Y toward -Z with right = +X).
  const tilt = (j) => new THREE.Quaternion().setFromAxisAngle(right, -THREE.MathUtils.degToRad(target[j] - before[j]));
  const rot = { pelvis: tilt('pelvis'), spine: tilt('spine'), chest: tilt('chest') };
  const hipsDrop = new THREE.Vector3(...THALASSA_JOINTS.find((j) => j.name === 'thigh_L').offset).setX(0);
  for (const w of apply) {
    // Keep the midpoint between the hip joints where it was: the pelvis turns about its own origin, which sits above them.
    const was = hipsDrop.clone().applyQuaternion(w.pelvis);
    for (const j of TRUNK) w[j] = rot[j].clone().multiply(w[j]).normalize();
    for (const j of ABOVE_CHEST) if (w[j]) w[j] = rot.chest.clone().multiply(w[j]).normalize();
    const now = hipsDrop.clone().applyQuaternion(w.pelvis);
    // Both offsets are in shared-skeleton metres, like the scaled hips samples.
    w.hips.add(was.sub(now));
  }
  return { before, after: trunkPitch(measure, right) };
}

