import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { planTip, tipPose, tipShares } from './killTip.ts';

// voss-death-scene D8: a prop going over on a scripted track, the same with physics on and off.
const yawed = (deg: number): THREE.Quaternion => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(deg));

/** A 0.9 x 0.9 x 0.5 box standing on the floor, over onto its -z side (0.25 m from its origin), as the Lab B cart. */
function cart(extraYaw = 0, slide = 0) {
  const from = { pos: new THREE.Vector3(6.78, 0, 23.4), rotation: yawed(60) };
  const yaw = THREE.MathUtils.degToRad(60 + extraYaw);
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, yaw, 0, 'YXZ'));
  const side = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const to = { pos: from.pos.clone().addScaledVector(side, 0.25 + slide).setY(0.25), rotation };
  return { from, to, side };
}

/** The lowest corner of the box at a pose. */
function lowest(pose: { pos: THREE.Vector3; rotation: THREE.Quaternion }): number {
  let y = Infinity;
  for (const x of [-0.45, 0.45]) for (const h of [0, 0.93]) for (const z of [-0.25, 0.25]) y = Math.min(y, new THREE.Vector3(x, h, z).applyQuaternion(pose.rotation).add(pose.pos).y);
  return y;
}

test('a tip starts where the prop stands and ends exactly at its after pose', () => {
  const { from, to } = cart(8, 0.04);
  const plan = planTip(from, to, 0.25);
  const a = tipPose(plan, 0);
  assert.ok(a.pos.distanceTo(from.pos) < 1e-9 && a.rotation.angleTo(from.rotation) < 1e-6);
  const b = tipPose(plan, 1);
  assert.ok(b.pos.distanceTo(to.pos) < 1e-9 && b.rotation.angleTo(to.rotation) < 1e-9);
  // Just short of the end it is nearly there: no jump on the last frame.
  const c = tipPose(plan, 0.999);
  assert.ok(c.pos.distanceTo(to.pos) < 0.01 && c.rotation.angleTo(to.rotation) < 0.01);
});

test('a straight fall rolls over its bottom edge: that edge stays on the floor and nothing goes under it', () => {
  const { from, to, side } = cart();
  const plan = planTip(from, to, 0.25);
  assert.ok(plan.fall.distanceTo(side) < 1e-6, 'it falls the way its top ends up');
  assert.ok(plan.slide.length() < 1e-6, 'a pure roll needs no slide');
  for (let i = 0; i <= 20; i++) {
    const p = tipPose(plan, i / 20);
    assert.ok(lowest(p) > -1e-6, `no corner under the floor at ${i / 20} (${lowest(p).toFixed(4)})`);
    // The edge it rolls over (its -z bottom edge) stays put.
    const edge = new THREE.Vector3(0, 0, -0.25).applyQuaternion(p.rotation).add(p.pos);
    assert.ok(edge.distanceTo(plan.pivot) < 1e-6, 'the pivot edge stays where it was');
  }
});

test('with a turn and a slide added, it dips no more than about a centimetre on the way', () => {
  const plan = planTip(cart(8, 0.04).from, cart(8, 0.04).to, 0.25);
  let low = Infinity;
  for (let i = 0; i <= 50; i++) low = Math.min(low, lowest(tipPose(plan, i / 50)));
  assert.ok(low > -0.015, `lowest corner ${low.toFixed(4)} m`);
});

test('by default the roll speeds up like a fall, and keys shape it instead', () => {
  const plan = planTip(cart().from, cart().to, 0.25);
  const angle = (u: number): number => tipPose(plan, u).rotation.angleTo(cart().from.rotation);
  assert.ok(angle(0.5) < angle(1) / 3, 'half the time, well under half the fall');
  assert.ok(angle(1) - angle(0.9) > angle(0.1) - angle(0), 'fastest at the end');
  const keyed = planTip(cart().from, cart().to, 0.25, [[0, 0, 0, 0], [0.5, 0.2, 0.3, 0.8], [1, 1, 1, 1]]);
  const near = (u: number, want: { slide: number; yaw: number; roll: number }): void => {
    const got = tipShares(keyed, u);
    for (const k of ['slide', 'yaw', 'roll'] as const) assert.ok(Math.abs(got[k] - want[k]) < 1e-9, `${k} at ${u}: ${got[k]}`);
  };
  near(0.5, { slide: 0.2, yaw: 0.3, roll: 0.8 });
  near(0.75, { slide: 0.6, yaw: 0.65, roll: 0.9 });
});
