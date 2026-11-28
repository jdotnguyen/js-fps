/**
 * A clip made from another by turning some of its joints (a bake-list clip with `from` and `rotate`): the same motion, with a
 * fixed rotation added to each named joint, in the joint's own frame. Used for a character's grip on a shared clip, where
 * their body model needs the arms and wrists set differently (spec `character-motion`, the squad pistol carry).
 */
import * as THREE from 'three';
import { THALASSA_JOINTS } from './bvhBake.mjs';

const r4 = (v) => Math.round(v * 10000) / 10000;
const r3 = (v) => Math.round(v * 1000) / 1000;

/** Joints whose turn moves the feet: a clip that turns any of them is grounded again (`groundClip`). */
export const LEG_JOINTS = ['pelvis', 'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R'];

/**
 * Puts a clip back on the floor after its legs were turned (a crouch: hips, knees and ankles bent): moves its pelvis track
 * up or down so that in every frame the lower foot sits at the rest foot height (a walk always has a foot down), smoothed
 * over three frames so the hips don't jitter.
 */
export function groundClip(clip) {
  const rig = {};
  for (const j of THALASSA_JOINTS) {
    const b = new THREE.Object3D();
    b.position.set(...j.offset);
    rig[j.name] = b;
    if (j.parent) rig[j.parent].add(b);
  }
  rig.root.updateMatrixWorld(true);
  const restFootY = rig.foot_L.getWorldPosition(new THREE.Vector3()).y;
  const p = clip.pelvis;
  const foot = new THREE.Vector3();
  const lift = [];
  for (let f = 0; f < clip.frames; f++) {
    for (const [name, track] of Object.entries(clip.joints)) if (rig[name]) rig[name].quaternion.fromArray(track, f * 4);
    rig.pelvis.position.set(p[f * 3], 0.98 + p[f * 3 + 1], p[f * 3 + 2]);
    rig.root.updateMatrixWorld(true);
    lift.push(restFootY - Math.min(rig.foot_L.getWorldPosition(foot).y, rig.foot_R.getWorldPosition(foot).y));
  }
  const at = (f) => lift[clip.loop ? (f + clip.frames) % clip.frames : Math.min(Math.max(f, 0), clip.frames - 1)];
  const pelvis = p.map((v, i) => (i % 3 === 1 ? r3(v + (at((i - 1) / 3 - 1) + at((i - 1) / 3) + at((i - 1) / 3 + 1)) / 3) : v));
  return { ...clip, pelvis };
}

/** `rotate`: joint name -> XYZ Euler degrees. Everything but those joints' tracks is the base clip's. */
export function rotateJoints(base, rotate) {
  const joints = { ...base.joints };
  for (const [joint, degrees] of Object.entries(rotate)) {
    const track = base.joints[joint];
    if (!track) throw new Error(`the base clip has no joint "${joint}"`);
    const turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(...degrees.map(THREE.MathUtils.degToRad), 'XYZ'));
    const out = [];
    let previous = null;
    for (let i = 0; i < track.length; i += 4) {
      const q = new THREE.Quaternion().fromArray(track, i).multiply(turn).normalize();
      // One hemisphere from frame to frame, starting with w positive.
      if (previous ? q.dot(previous) < 0 : q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      previous = q;
      out.push(r4(q.x), r4(q.y), r4(q.z), r4(q.w));
    }
    joints[joint] = out;
  }
  return { ...base, joints };
}
