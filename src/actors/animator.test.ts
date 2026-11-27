import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import priyaPack from '../data/mocap/priya.json' with { type: 'json' };
import { Humanoid } from './humanoid.ts';
import { Animator } from './animator.ts';
import { sharedMocapLibrary, type RawMocapFile } from './mocap.ts';
import { JOINT_NAMES, type JointName } from './skeleton.ts';
import { ctx } from '../ai/enemyTestKit.ts';

// One-shot clips in kill beats (stinger-feed-and-rise, infection-kills "A kill beat can play a captured clip" and
// "Convulsion layers over captured motion"). Priya's pack is loaded with her body in the game; Node adds it directly.
sharedMocapLibrary().addPack('priya', priyaPack as unknown as RawMocapFile);

const TRUNK: readonly JointName[] = ['pelvis', 'spine', 'chest', 'neck', 'head', 'thigh_L', 'thigh_R', 'shin_L', 'upperArm_R'];

/** A raised-corpse body in a kill, lying prone, then (optionally) playing `priya_rise` at phase `u` for `frames`. */
function body(opts: { clip?: boolean; u?: number; convulse?: number; frames?: number } = {}): Humanoid {
  const h = new Humanoid({ seed: 'rise-test', outfit: 'crew', role: 'npc' }, ctx());
  h.beginKill();
  h.setPose('corpseProne', 0.01);
  h.update(1 / 30);
  h.killConvulse(opts.convulse ?? 0, 100);
  if (opts.clip !== false) {
    assert.ok(h.playKillClip('priya_rise', 0.01) !== null);
    h.killClipPhase(opts.u ?? 0.5);
  }
  for (let i = 0; i < (opts.frames ?? 20); i++) h.update(1 / 30);
  return h;
}

const rotations = (h: Humanoid): THREE.Quaternion[] => JOINT_NAMES.map((j) => h.bones[j].quaternion.clone());
const maxAngle = (a: THREE.Quaternion[], b: THREE.Quaternion[], only?: readonly JointName[]): number =>
  Math.max(...JOINT_NAMES.map((j, i) => (only && !only.includes(j) ? 0 : a[i]!.angleTo(b[i]!))));

test('playKillClip finds priya_rise in her pack and returns its length; an unknown clip returns null', () => {
  const h = new Humanoid({ seed: 'rise-test', outfit: 'crew', role: 'npc' }, ctx());
  h.beginKill();
  assert.ok(Math.abs(h.playKillClip('priya_rise', 0.3)! - 4.4) < 0.01);
  assert.equal(h.playKillClip('no_such_clip', 0.3), null);
  h.dispose();
});

test('the clip drives the body: the trunk moves a long way from lying (u 0) to standing (u 1)', () => {
  const lying = body({ u: 0 });
  const standing = body({ u: 1 });
  const moved = maxAngle(rotations(lying), rotations(standing), ['pelvis', 'thigh_L', 'shin_L']);
  assert.ok(moved > 0.8, `hips and legs turned ${moved.toFixed(2)} rad from lying to standing`);
  lying.dispose();
  standing.dispose();
});

test('without convulsion the body is the clip, frame for frame (same phase -> same pose)', () => {
  const a = body({ u: 0.6 });
  const b = body({ u: 0.6, frames: 35 });
  assert.ok(maxAngle(rotations(a), rotations(b), TRUNK) < 0.002, 'held clip frame: only spring settling (< 0.1 deg)');
  a.dispose();
  b.dispose();
});

test('convulsion layers over the clip: joints shake around the clip pose, not replace it', () => {
  const still = body({ u: 0.6 });
  const shaking = body({ u: 0.6, convulse: 0.1 });
  const lying = body({ u: 0 });
  const shake = maxAngle(rotations(still), rotations(shaking));
  const clipMotion = maxAngle(rotations(lying), rotations(still), ['pelvis', 'thigh_L', 'shin_L']);
  assert.ok(shake > 0.005, `convulsion moves the joints (${shake.toFixed(3)} rad)`);
  assert.ok(shake < clipMotion * 0.5, `but far less than the clip itself (${shake.toFixed(3)} vs ${clipMotion.toFixed(3)} rad)`);
  still.dispose();
  shaking.dispose();
  lying.dispose();
});

test('the body keeps the clip while it plays (its own per-frame pose choice does not cut it) and setPose stops it', () => {
  const h = body({ u: 0.5 });
  const held = rotations(h);
  for (let i = 0; i < 30; i++) h.update(1 / 30);
  assert.ok(maxAngle(held, rotations(h), TRUNK) < 0.002, 'still on the clip after a second of updates');
  h.setPose('idle', 0.2);
  for (let i = 0; i < 30; i++) h.update(1 / 30);
  assert.ok(maxAngle(held, rotations(h), ['pelvis', 'thigh_L']) > 0.2, 'blended away to idle');
  h.dispose();
});

test('a body that never plays a clip convulses exactly as before (its convulsion clock is its time)', () => {
  const h = body({ clip: false, convulse: 0.7, frames: 90 });
  const a = (h as unknown as { animator: { time: number; convulsePhase: number } }).animator;
  assert.equal(a.convulsePhase, a.time);
  h.dispose();
});

test('during a clip the convulsion clock runs at a third of its speed', () => {
  assert.ok(Math.abs(Animator.CLIP_CONVULSE_RATE - 1 / 3) < 1e-9);
  const h = body({ u: 0.4, convulse: 0.1, frames: 60 });
  const a = (h as unknown as { animator: { time: number; convulsePhase: number } }).animator;
  // One frame before the clip at full rate, then 60 frames under it.
  const expected = 1 / 30 + (60 / 30) * Animator.CLIP_CONVULSE_RATE;
  assert.ok(Math.abs(a.convulsePhase - expected) < 1e-6, `${a.convulsePhase} vs ${expected}`);
  h.dispose();
});

// voss-death-scene D3: on a route the clip plays in place (its travel across the floor removed; the route moves the body).
function stumbleHips(inPlace: boolean): { hips: THREE.Vector3[]; origin: THREE.Vector3[] } {
  const h = new Humanoid({ seed: 'stumble-test', outfit: 'crew', role: 'npc' }, ctx());
  h.beginKill();
  h.setPose('idle', 0.01);
  for (let i = 0; i < 10; i++) h.update(1 / 30);
  h.playKillClip('priya_stumble', 0.01, { inPlace });
  const hips: THREE.Vector3[] = [];
  const origin: THREE.Vector3[] = [];
  for (let f = 0; f <= 30; f++) {
    h.killClipPhase(f / 30);
    h.update(1 / 30);
    h.group.updateMatrixWorld(true);
    hips.push(h.bones.pelvis.getWorldPosition(new THREE.Vector3()).sub(h.group.position).setY(0));
    origin.push(h.group.position.clone());
  }
  h.dispose();
  return { hips, origin };
}

test('In place: a travelling take played on a route keeps its hips over the origin (sway only), and the origin stays put', () => {
  const free = stumbleHips(false);
  const placed = stumbleHips(true);
  const travel = free.hips.at(-1)!.distanceTo(free.hips[2]!);
  const most = Math.max(...placed.hips.slice(2).map((p) => p.length()));
  assert.ok(travel > 0.35, `the take travels ${travel.toFixed(2)} m when played as it is`);
  assert.ok(most < 0.08, `in place its hips stay within ${most.toFixed(3)} m of the origin`);
  assert.ok(placed.origin.every((p) => p.distanceTo(placed.origin[0]!) < 1e-9), 'and the body is not moved under it');
});

test('playKillClip "from" starts the take partway: its first frame is the one asked for', () => {
  const h = new Humanoid({ seed: 'rise-test', outfit: 'crew', role: 'npc' }, ctx());
  const g = new Humanoid({ seed: 'rise-test', outfit: 'crew', role: 'npc' }, ctx());
  for (const b of [h, g]) {
    b.beginKill();
    b.setPose('idle', 0.01);
    b.update(1 / 30);
  }
  h.playKillClip('priya_rise', 0.01, { from: 3.3, inPlace: true });
  g.playKillClip('priya_rise', 0.01, { inPlace: true });
  h.killClipPhase(0.75);
  g.killClipPhase(0.75);
  for (let i = 0; i < 10; i++) {
    h.update(1 / 30);
    g.update(1 / 30);
  }
  assert.ok(maxAngle(rotations(h), rotations(g), TRUNK) < 0.002, 'the same frame of the take');
  h.dispose();
  g.dispose();
});

test('clipRootSpeed: a walk baked in place goes its stride each cycle; a travelling take goes as far as its hips', async () => {
  const { clipRootSpeed } = await import('./mocap.ts');
  const lib = sharedMocapLibrary();
  const walk = lib.get('walk');
  assert.ok(Math.abs(clipRootSpeed(walk) - walk.stride / walk.duration) < 1e-9);
  const stumble = lib.get('priya_stumble');
  const speed = clipRootSpeed(stumble);
  assert.ok(speed > 0.35 && speed < 1.2, `the stumble covers ${speed.toFixed(2)} m/s`);
  assert.equal(clipRootSpeed(stumble, 0.4, 0.4), 0);
});

test('the get-up starts where the body lies: no jump or dip through the floor in the blend, and the origin moves under it', () => {
  const h = new Humanoid({ seed: 'rise-test', outfit: 'crew', role: 'npc' }, ctx());
  h.group.position.set(4, 0, 7);
  h.setHeading(1.1);
  h.beginKill();
  h.setPose('corpseProne', 0.01);
  for (let i = 0; i < 30; i++) h.update(1 / 30);
  const at = (j: JointName): THREE.Vector3 => h.bones[j].getWorldPosition(new THREE.Vector3());
  h.group.updateMatrixWorld(true);
  const lying = { head: at('head'), pelvis: at('pelvis'), origin: h.group.position.clone() };
  h.playKillClip('priya_rise', 0.3);
  let prev = lying.head.clone();
  let jump = 0;
  let low = Infinity;
  for (let f = 0; f < 12; f++) {
    h.killClipPhase(f / 132);
    h.update(1 / 30);
    h.group.updateMatrixWorld(true);
    const head = at('head');
    jump = Math.max(jump, head.distanceTo(prev));
    low = Math.min(low, head.y);
    prev = head;
  }
  assert.ok(jump < 0.04, `head moves at most ${jump.toFixed(3)} m a frame while the clip blends in`);
  assert.ok(low > 0.05, `head stays above the floor (lowest ${low.toFixed(2)} m)`);
  assert.ok(at('pelvis').distanceTo(lying.pelvis) < 0.12, 'hips start where they lay');
  assert.ok(h.group.position.distanceTo(lying.origin) > 0.3, 'the origin moved under the body');
  assert.equal(h.group.position.y, lying.origin.y, 'on the floor plane');
  h.dispose();
});

// ------------------------------------------------------------------ waiting motion (voss-death-scene D6)

const ARMS: readonly JointName[] = ['shoulder_L', 'upperArm_L', 'foreArm_L', 'hand_L', 'shoulder_R', 'upperArm_R', 'foreArm_R', 'hand_R'];

/** A standing body in a kill playing the get-up's standing end, optionally with a pose layer on `layer` joints. */
function layered(layer: readonly JointName[] | null, pose = 'kill_scratch_0', frames = 30): Humanoid {
  const h = new Humanoid({ seed: 'layer-test', outfit: 'crew', role: 'npc' }, ctx());
  h.beginKill();
  h.killConvulse(0, 100);
  assert.ok(h.playKillClip('priya_rise', 0.01) !== null);
  h.killClipPhase(0.95);
  if (layer) h.setKillLayer(layer, pose, 0.01);
  for (let i = 0; i < frames; i++) h.update(1 / 30);
  return h;
}

test('Layer: joints outside the layer follow the base clip exactly; the layer joints take the layer pose', () => {
  const plain = layered(null);
  const arms = layered(ARMS);
  const rest = JOINT_NAMES.filter((j) => !ARMS.includes(j));
  assert.ok(maxAngle(rotations(plain), rotations(arms), rest) < 1e-6, `outside the layer: ${maxAngle(rotations(plain), rotations(arms), rest)} rad`);
  // The arms are the pose's, not the clip's.
  const posed = new Humanoid({ seed: 'layer-test', outfit: 'crew', role: 'npc' }, ctx());
  posed.beginKill();
  posed.setPose('kill_scratch_0', 0.01);
  for (let i = 0; i < 30; i++) posed.update(1 / 30);
  assert.ok(maxAngle(rotations(posed), rotations(arms), ARMS) < 0.01, `arms on the layer pose: ${maxAngle(rotations(posed), rotations(arms), ARMS).toFixed(4)} rad`);
  assert.ok(maxAngle(rotations(plain), rotations(arms), ARMS) > 0.3, 'and away from the clip\'s arms');
  for (const h of [plain, arms, posed]) h.dispose();
});

test('Layer: a new layer pose blends in over its blend; the layer eases off when ended, back to the clip', () => {
  const h = layered(ARMS, 'kill_scratch_0');
  const a = rotations(h);
  h.setKillLayer(ARMS, 'kill_scratch_1', 0.1);
  h.update(1 / 30);
  const mid = rotations(h);
  for (let i = 0; i < 6; i++) h.update(1 / 30);
  const b = rotations(h);
  const whole = maxAngle(a, b, ARMS);
  assert.ok(whole > 0.1, `the two scratch poses differ (${whole.toFixed(2)} rad)`);
  assert.ok(maxAngle(a, mid, ARMS) < whole * 0.8, 'one frame in it is still on its way');
  h.setKillLayer(null, null);
  for (let i = 0; i < 15; i++) h.update(1 / 30);
  assert.equal(h.killLayerWeight, 0);
  const plain = layered(null, undefined, 52);
  // Off again, the body is the clip: within a fifth of a degree, and the hands, whose own springs are still settling, close.
  const hands: readonly JointName[] = ['hand_L', 'hand_R'];
  const off = maxAngle(rotations(plain), rotations(h), JOINT_NAMES.filter((j) => !hands.includes(j)));
  assert.ok(off < 0.003, `off again: the body is the clip (${off.toFixed(4)} rad)`);
  assert.ok(maxAngle(rotations(plain), rotations(h), hands) < 0.05, 'and the hands nearly so');
  h.dispose();
  plain.dispose();
});

test('Look in a kill: the head turns to the target within the glance and back when it ends', () => {
  const h = layered(ARMS);
  /** Where the head faces, on the floor plane. */
  const fwd = (): THREE.Vector3 => {
    h.group.updateMatrixWorld(true);
    const ahead = new THREE.Vector3(0, 0, -1).applyQuaternion(h.bones.head.getWorldQuaternion(new THREE.Quaternion()));
    return ahead.setY(0).normalize();
  };
  const before = fwd();
  const turn = (): number => THREE.MathUtils.radToDeg(before.angleTo(fwd()));
  // 60 degrees to her left, at eye height, 2 m away.
  const yaw = THREE.MathUtils.degToRad(60);
  h.lookTarget = new THREE.Vector3(-Math.sin(yaw) * 2, 1.55, -Math.cos(yaw) * 2);
  for (let i = 0; i < 15; i++) h.update(1 / 30);
  const half = turn();
  for (let i = 0; i < 21; i++) h.update(1 / 30); // 1.2 s, the default glance
  const turned = turn();
  // The head (with the neck and chest under it) turns most of the way; there are no eyes to make up the rest.
  assert.ok(turned > 60 * 0.7 && turned < 65, `head turned ${turned.toFixed(1)} deg toward a target 60 deg off`);
  assert.ok(half > turned * 0.9, `most of it within half a second (${half.toFixed(1)} deg)`);
  h.lookTarget = null;
  for (let i = 0; i < 45; i++) h.update(1 / 30);
  assert.ok(turn() < 5, `and looks ahead again (${turn().toFixed(1)} deg)`);
  h.dispose();
});
