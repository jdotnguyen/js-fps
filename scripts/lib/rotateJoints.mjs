/**
 * A clip made from another by turning some of its joints (a bake-list clip with `from` and `rotate`): the same motion, with a
 * fixed rotation added to each named joint, in the joint's own frame. Used for a character's grip on a shared clip, where
 * their body model needs the arms and wrists set differently (spec `character-motion`, the squad pistol carry).
 */
import * as THREE from 'three';

const r4 = (v) => Math.round(v * 10000) / 10000;

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
