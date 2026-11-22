/**
 * Additive hold clips (design D4): a posture's idle life baked as offsets from the clip's mean pose, so it can be layered on
 * top of an authored pose (lean_back, sit_stool, ...) without dragging the body into the capture's own posture.
 */
import * as THREE from 'three';

const qOf = (arr, f) => new THREE.Quaternion(arr[f * 4], arr[f * 4 + 1], arr[f * 4 + 2], arr[f * 4 + 3]);

/** Mean of a joint track (hemisphere-aligned weighted average, normalized). */
export function meanQuat(arr, frames) {
  const ref = qOf(arr, 0);
  const acc = new THREE.Vector4(0, 0, 0, 0);
  for (let f = 0; f < frames; f++) {
    const q = qOf(arr, f);
    const s = q.dot(ref) < 0 ? -1 : 1;
    acc.x += q.x * s;
    acc.y += q.y * s;
    acc.z += q.z * s;
    acc.w += q.w * s;
  }
  return new THREE.Quaternion(acc.x, acc.y, acc.z, acc.w).normalize();
}

/**
 * Turn a baked clip into an additive one in place: each joint frame becomes mean^-1 * frame, the pelvis its offset from the mean.
 * `scale` (0..1) shrinks every offset, for a capture whose motion is right in kind but too big to layer under a pose.
 */
export function makeAdditive(clip, scale = 1) {
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const id = new THREE.Quaternion();
  for (const [j, arr] of Object.entries(clip.joints)) {
    const inv = meanQuat(arr, clip.frames).invert();
    const out = [];
    for (let f = 0; f < clip.frames; f++) {
      const q = inv.clone().multiply(qOf(arr, f)).normalize();
      if (scale !== 1) q.copy(id.clone().slerp(q, scale));
      if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      out.push(r3(q.x), r3(q.y), r3(q.z), r3(q.w));
    }
    clip.joints[j] = out;
  }
  const mean = [0, 0, 0];
  for (let f = 0; f < clip.frames; f++) for (let c = 0; c < 3; c++) mean[c] += clip.pelvis[f * 3 + c] / clip.frames;
  clip.pelvis = clip.pelvis.map((v, i) => r3((v - mean[i % 3]) * scale));
  delete clip.contactL;
  delete clip.contactR;
  delete clip.stride;
  clip.additive = true;
  return clip;
}
