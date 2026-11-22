import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Humanoid } from './humanoid.ts';
import { DEFAULT_MOTIONS, FORMAL_MOTIONS, resolveMotions, sampleClip, sampleLocomotion, sampleZombieLocomotion, sharedMocapLibrary, type LocomotionSample } from './mocap.ts';
import { Animator } from './animator.ts';
import { CAST } from './castLooks.ts';
import { emptyPose } from './poses.ts';
import { Spring1D, settleUprightTurn, stepUprightTurn, type UprightTurnState } from './springs.ts';
import { GILES, OKAFOR } from './squadLooks.ts';
import { ctx } from '../ai/enemyTestKit.ts';

test('Spring1D is stable at 30/60/120 fps, settles to target, and respects damping ratio', () => {
  for (const fps of [30, 60, 120]) {
    const dt = 1 / fps;
    const under = new Spring1D({ f: 2.5, z: 0.55 }, 0);
    const crit = new Spring1D({ f: 2.5, z: 1.05 }, 0);
    let maxUnder = 0;
    let maxCrit = 0;
    for (let i = 0; i < fps * 3; i++) {
      maxUnder = Math.max(maxUnder, under.step(1, dt));
      maxCrit = Math.max(maxCrit, crit.step(1, dt));
      assert.ok(Number.isFinite(under.value) && Number.isFinite(crit.value), `finite at ${fps} fps`);
    }
    assert.ok(Math.abs(under.value - 1) < 0.01, `underdamped settled (${under.value})`);
    assert.ok(Math.abs(crit.value - 1) < 0.01, `critically damped settled (${crit.value})`);
    assert.ok(maxUnder > 1.05, `underdamped overshoots (${maxUnder})`);
    assert.ok(maxCrit <= 1.01, `critically damped does not overshoot (${maxCrit})`);
  }
});

test('stepUprightTurn eases angular velocity smoothly and never overshoots', () => {
  const s: UprightTurnState = { vel: 0, error: 0 };
  let heading = 0;
  const target = Math.PI * 0.75;
  const dt = 1 / 60;
  const vels: number[] = [];
  for (let i = 0; i < 120; i++) {
    const d = stepUprightTurn(s, target - heading, 2.2, dt);
    heading += d;
    vels.push(s.vel);
    assert.ok(heading <= target + 1e-6, `never overshoots (${heading} <= ${target})`);
  }
  assert.ok(vels[0]! < vels[10]!, 'angular velocity ramps up smoothly instead of snapping');
  assert.ok(Math.abs(heading - target) < 0.02, `reached target (${heading})`);
  // Settling decays turn velocity cleanly to 0.
  for (let i = 0; i < 60; i++) settleUprightTurn(s, dt);
  assert.equal(s.vel, 0);
});

test('shipped mocap-clips.json compiles all 10 clips (human + zombie) with unit quaternions and phase-synced locomotion', () => {
  const lib = sharedMocapLibrary();
  const expected = ['idle', 'idle_talk', 'walk', 'walk_formal', 'jog', 'crouch_idle', 'kneel_fix', 'pistol_idle', 'zombie_walk', 'zombie_idle'];
  for (const id of expected) {
    assert.ok(lib.has(id), `has clip ${id}`);
    const c = lib.get(id);
    assert.ok(c.duration > 0.5 && c.frames >= 16, `${id} valid length`);
    const pose = emptyPose(id);
    sampleClip(c, 0.37, pose);
    for (const q of pose.joints) {
      assert.ok(Math.abs(q.length() - 1) < 1e-3, `${id} unit quaternion`);
    }
    assert.ok(Number.isFinite(pose.pelvis.x + pose.pelvis.y + pose.pelvis.z), `${id} finite pelvis`);
  }

  // Zombie locomotion stays in zombie_idle <-> zombie_walk (never human jog).
  const zOut = emptyPose('zloco');
  const zInfo: LocomotionSample = { stride: 1, moveWeight: 0, jogWeight: 0, contactL: 1, contactR: 1 };
  sampleZombieLocomotion(lib, 0.78, 0.25, 0, zOut, zInfo);
  assert.ok(zInfo.moveWeight > 0.9, 'shambler speed drives zombie_walk');
  assert.equal(zInfo.jogWeight, 0, 'zombie locomotion never blends into human jog');
  assert.ok(zInfo.stride > 1.0, `zombie_walk stride (${zInfo.stride})`);

  // Locomotion blend space: stride increases from walk to jog and contacts stay in [0, 1].
  const out = emptyPose('loco');
  const info: LocomotionSample = { stride: 1, moveWeight: 0, jogWeight: 0, contactL: 1, contactR: 1 };
  sampleLocomotion(lib, 0, 0, 0, {}, out, info);
  assert.equal(info.moveWeight, 0);
  assert.equal(info.contactL, 1);
  assert.equal(info.contactR, 1);

  sampleLocomotion(lib, 1.3, 0.2, 0, {}, out, info);
  const walkStride = info.stride;
  assert.ok(info.moveWeight > 0.9, 'walk is full locomotion');
  assert.ok(info.jogWeight < 0.05, '1.3 m/s stays in walk');

  sampleLocomotion(lib, 3.2, 0.2, 0, {}, out, info);
  assert.ok(info.jogWeight > 0.9, '3.2 m/s blends into jog');
  assert.ok(info.stride > walkStride + 0.4, `jog stride (${info.stride}) > walk stride (${walkStride})`);
});

test('motion sets: own clips over the default or formal set; unknown ids fall back; the walk clip drives the stride', () => {
  const lib = sharedMocapLibrary();
  assert.deepEqual(resolveMotions(lib, undefined), DEFAULT_MOTIONS);
  assert.deepEqual(resolveMotions(lib, undefined, true), FORMAL_MOTIONS);
  const warn = console.warn;
  console.warn = () => {};
  try {
    const set = resolveMotions(lib, { walk: 'walk_formal', idle: 'no_such_clip' });
    assert.equal(set.walk, 'walk_formal');
    assert.equal(set.idle, 'idle', 'a missing clip falls back to the default slot');
  } finally {
    console.warn = warn;
  }
  const out = emptyPose('loco');
  const info: LocomotionSample = { stride: 1, moveWeight: 0, jogWeight: 0, contactL: 1, contactR: 1 };
  sampleLocomotion(lib, 1.3, 0.2, 0, { motions: { ...DEFAULT_MOTIONS, walk: 'walk_formal' } }, out, info);
  assert.ok(Math.abs(info.stride - lib.get('walk_formal').stride) < 1e-6, 'walking at 1.3 m/s uses the set\'s walk clip');
});

test('a character with its own motion set gets damped procedural arm layers; others keep them whole', () => {
  const priya = new Humanoid({ ...CAST['priya']!, role: 'npc' }, ctx());
  const giles = new Humanoid({ ...GILES, role: 'npc' }, ctx());
  const okafor = new Humanoid({ ...OKAFOR, role: 'npc' }, ctx());
  const anim = (h: Humanoid): Animator => h['animator'];
  assert.equal(anim(priya).armLayer, Animator.OWN_MOTION_ARMS);
  assert.equal(anim(priya).motions.walk, 'walk_formal');
  assert.equal(anim(giles).armLayer, 1);
  assert.deepEqual(anim(giles).motions, DEFAULT_MOTIONS);
  assert.equal(anim(okafor).motions.walk, 'walk_formal', 'medics keep the formal walk without a set of their own');
});

test('standing and walking NPCs pin feet to the floor via FootIk without dipping below deck', () => {
  const h = new Humanoid({ ...GILES, role: 'npc' }, ctx());
  const dt = 1 / 60;
  // Settle standing idle: both feet stay pinned near their initial floor positions.
  for (let i = 0; i < 30; i++) h.update(dt);
  assert.ok(h.footLockWeight('L') > 0.8 && h.footLockWeight('R') > 0.8, 'both feet locked at idle');
  const pinL = h.jointWorld('foot_L', new THREE.Vector3());
  const pinR = h.jointWorld('foot_R', new THREE.Vector3());
  let maxDrift = 0;
  for (let i = 0; i < 120; i++) {
    h.update(dt);
    const curL = h.jointWorld('foot_L', new THREE.Vector3());
    const curR = h.jointWorld('foot_R', new THREE.Vector3());
    maxDrift = Math.max(maxDrift, Math.hypot(curL.x - pinL.x, curL.z - pinL.z), Math.hypot(curR.x - pinR.x, curR.z - pinR.z));
  }
  assert.ok(maxDrift < 0.025, `standing feet stayed pinned (drift ${maxDrift.toFixed(4)} m)`);

  // Walk forward: feet alternate locking/lifting and never dip below the floor plane.
  const fwd = new THREE.Vector3(0, 0, -1);
  let minLockL = 1;
  let maxLockL = 0;
  let minFootY = Infinity;
  for (let i = 0; i < 120; i++) {
    h.move(fwd, dt);
    h.update(dt);
    minLockL = Math.min(minLockL, h.footLockWeight('L'));
    maxLockL = Math.max(maxLockL, h.footLockWeight('L'));
    minFootY = Math.min(minFootY, h.jointWorld('foot_L').y, h.jointWorld('foot_R').y);
  }
  assert.ok(maxLockL > 0.7 && minLockL < 0.25, `foot L alternates stance/swing (${minLockL.toFixed(2)}..${maxLockL.toFixed(2)})`);
  assert.ok(minFootY > 0.04, `feet never penetrate the floor (minY=${minFootY.toFixed(3)})`);
  h.dispose();
});

test('turn-in-place rotates smoothly with alternating pivot steps instead of frozen legs', () => {
  const h = new Humanoid({ ...OKAFOR, role: 'npc' }, ctx());
  const dt = 1 / 60;
  for (let i = 0; i < 15; i++) h.update(dt);
  const turnDir = new THREE.Vector3(-1, 0, 0.5).normalize(); // ~116 deg left
  let minContact = 1;
  let maxHeadLead = 0;
  const e = new THREE.Euler();
  for (let i = 0; i < 90; i++) {
    h.steer(turnDir, dt, { maxSpeed: 0, turnRate: 2.0 });
    h.update(dt);
    minContact = Math.min(minContact, h.footLockWeight('L'), h.footLockWeight('R'));
    e.setFromQuaternion(h.bones.head.quaternion, 'YXZ');
    maxHeadLead = Math.max(maxHeadLead, Math.abs(e.y));
  }
  assert.ok(minContact < 0.65, `stationary turn lifts stepping foot (min lock ${minContact.toFixed(2)})`);
  assert.ok(maxHeadLead > 0.15, `head leads the turn (${maxHeadLead.toFixed(2)} rad)`);
  h.dispose();
});

test('multi-segment look-at recruits spine/chest as well as head, and nudgeImpulse triggers torso recoil', () => {
  const h = new Humanoid({ seed: 'look-nudge', outfit: 'engineer', role: 'npc' }, ctx());
  const dt = 1 / 60;
  for (let i = 0; i < 30; i++) h.update(dt);
  const chestRest = h.bones.chest.quaternion.clone();
  const spineRest = h.bones.spine.quaternion.clone();

  // Look off to the left: chest and head both rotate toward the target.
  h.lookTarget = new THREE.Vector3(-4, 1.6, -2);
  for (let i = 0; i < 60; i++) h.update(dt);
  const chestLookAngle = h.bones.chest.quaternion.angleTo(chestRest);
  assert.ok(chestLookAngle > 0.08, `chest recruits into look-at (${chestLookAngle.toFixed(3)} rad)`);

  // Clear look target, settle, then apply a lateral nudge impulse.
  h.lookTarget = null;
  for (let i = 0; i < 90; i++) h.update(dt);
  const spineBefore = h.bones.spine.quaternion.clone();
  h.nudgeImpulse(0.05, 0, 1 / 60); // 3 m/s lateral push
  let peakRecoil = 0;
  for (let i = 0; i < 40; i++) {
    h.update(dt);
    peakRecoil = Math.max(peakRecoil, h.bones.spine.quaternion.angleTo(spineBefore));
  }
  assert.ok(peakRecoil > 0.02, `nudge produced visible torso recoil (${peakRecoil.toFixed(3)} rad)`);
  // Settles back cleanly.
  for (let i = 0; i < 120; i++) h.update(dt);
  assert.ok(h.bones.spine.quaternion.angleTo(spineRest) < 0.08, 'recoil settled back cleanly');
  h.dispose();
});

test('upright enemies use hybrid mocap and foot locking, while severed crawlers and corpses turn foot locking off', () => {
  const zed = new Humanoid({ seed: 'zed-check', outfit: 'crew', role: 'enemy', infection: 2 }, ctx());
  const hero = new Humanoid({ seed: 'hero-check', outfit: 'lab', role: 'enemy', infection: 2, hero: true, height: 2.15, pose: 'hulk' }, ctx());
  const corpse = new Humanoid({ seed: 'corpse-check', outfit: 'crew', role: 'corpse', pose: 'corpseSupine' }, ctx());
  const fwd = new THREE.Vector3(0, 0, -1);
  let zedMinLock = 1;
  let zedMaxLock = 0;
  let heroFootfalls = 0;
  for (let i = 0; i < 150; i++) {
    zed.move(fwd, 1 / 60);
    zed.update(1 / 60);
    zedMinLock = Math.min(zedMinLock, zed.footLockWeight('L'));
    zedMaxLock = Math.max(zedMaxLock, zed.footLockWeight('L'));
    hero.move(fwd, 1 / 60);
    hero.update(1 / 60);
    if (hero.footfall) heroFootfalls++;
    corpse.update(1 / 60);
  }
  assert.ok(zedMaxLock > 0.7 && zedMinLock < 0.25, `shambler alternates foot lock (${zedMinLock.toFixed(2)}..${zedMaxLock.toFixed(2)})`);
  assert.ok(heroFootfalls >= 1, `hero keeps stomp footfall events (${heroFootfalls})`);
  assert.equal(corpse.footLockWeight('L'), 0, 'corpse never locks feet');
  // Severing a leg switches enemy to crawl and immediately disables upright foot locking.
  zed.hurt('thigh_L', 500);
  for (let i = 0; i < 60; i++) zed.update(1 / 60);
  assert.equal(zed.footLockWeight('L'), 0, 'crawling enemy releases upright foot lock');
  zed.dispose();
  hero.dispose();
  corpse.dispose();
});

test('standing upper-body actions (offer_mug) and ambient fidgets keep mocapW active without trunk lean snaps', () => {
  const dt = 1 / 60;
  for (const pose of ['offer_mug', 'idle_weight', 'idle_shift', 'head_tilt', 'idle_crossed'] as const) {
    const h = new Humanoid({ seed: `stable-${pose}`, outfit: 'crew', role: 'npc' }, ctx());
    const a = h['animator'] as Animator;
    for (let i = 0; i < 60; i++) h.update(dt);
    const chestBefore = h.bones.chest.quaternion.clone();
    const pelvisBefore = h.bones.pelvis.quaternion.clone();
    const armBefore = h.bones.upperArm_R.quaternion.clone();

    h.setPose(pose, 0.45);
    let minMocapW = 1;
    let maxChestSwing = 0;
    let maxPelvisSwing = 0;
    let maxArmMove = 0;
    for (let i = 0; i < 90; i++) {
      h.update(dt);
      minMocapW = Math.min(minMocapW, a['mocapW'] as number);
      maxChestSwing = Math.max(maxChestSwing, h.bones.chest.quaternion.angleTo(chestBefore));
      maxPelvisSwing = Math.max(maxPelvisSwing, h.bones.pelvis.quaternion.angleTo(pelvisBefore));
      maxArmMove = Math.max(maxArmMove, h.bones.upperArm_R.quaternion.angleTo(armBefore));
    }
    assert.ok(minMocapW > 0.95, `${pose}: mocapW stays active (${minMocapW.toFixed(3)})`);
    assert.ok(maxChestSwing < 0.14, `${pose}: chest avoids 18 deg mocap-drop lean (${((maxChestSwing * 180) / Math.PI).toFixed(1)} deg)`);
    assert.ok(maxPelvisSwing < 0.14, `${pose}: pelvis avoids twist snap (${((maxPelvisSwing * 180) / Math.PI).toFixed(1)} deg)`);
    if (pose === 'offer_mug') {
      assert.ok(maxArmMove > 0.35, `offer_mug still extends the right arm (${((maxArmMove * 180) / Math.PI).toFixed(1)} deg)`);
    }
    h.dispose();
  }
});

test('slow indoor curved stops keep inertial braking pitch and cornering roll subtle', () => {
  const h = new Humanoid({ seed: 'bram-stop', outfit: 'crew', role: 'npc' }, ctx());
  const a = h['animator'] as Animator;
  const dt = 1 / 60;
  for (let i = 0; i < 30; i++) h.update(dt);
  const chestIdle = h.bones.chest.quaternion.clone();

  // Simulate a curved 1.45 m/s indoor walk followed by a quick stop into offer_mug.
  a.speed = 1.45;
  a.turnRate = 1.6;
  for (let i = 0; i < 35; i++) h.update(dt);
  a.speed = 0;
  a.turnRate = 0;
  a.accelFwd = -4.5;
  h.setPose('offer_mug', 0.45);
  let maxChestSwing = 0;
  for (let i = 0; i < 60; i++) {
    if (i > 6) a.accelFwd = 0;
    h.update(dt);
    maxChestSwing = Math.max(maxChestSwing, h.bones.chest.quaternion.angleTo(chestIdle));
  }
  assert.ok(maxChestSwing < 0.18, `indoor stop + offer_mug stays upright (${((maxChestSwing * 180) / Math.PI).toFixed(1)} deg)`);
  h.dispose();
});

test('curved indoor walks at 60 and 120 fps do not amplify acceleration into outward lateral torso leans', () => {
  for (const fps of [60, 120]) {
    const dt = 1 / fps;
    const h = new Humanoid({ seed: `curve-${fps}`, outfit: 'crew', role: 'npc' }, ctx());
    const a = h['animator'] as Animator;
    let maxLat = 0;
    let maxFwd = 0;
    for (let i = 0; i < fps * 2; i++) {
      const ang = (i / fps) * 1.1;
      const dir = new THREE.Vector3(-Math.sin(ang), 0, -Math.cos(ang));
      const vel = h.steer(dir, dt, { maxSpeed: 1.4, turnRate: 2.5, accel: 4 });
      h.group.position.addScaledVector(vel, dt);
      h.update(dt);
      maxLat = Math.max(maxLat, Math.abs(a['leanLatSpring'].value));
      maxFwd = Math.max(maxFwd, Math.abs(a['leanFwdSpring'].value));
    }
    assert.ok(maxLat < 0.5, `${fps} fps: curved walk produces no outward leanLatSpring tilt (${maxLat.toFixed(2)} deg)`);
    assert.ok(maxFwd < 3.0, `${fps} fps: curved walk forward lean stays subtle (${maxFwd.toFixed(2)} deg)`);
    h.dispose();
  }
});

test('FootIk never leaves feet glued far behind a slow-moving or stopping body', () => {
  const h = new Humanoid({ ...OKAFOR, role: 'npc' }, ctx());
  const dt = 1 / 60;
  for (let i = 0; i < 20; i++) h.update(dt);
  const fwd = new THREE.Vector3(0, 0, -1);
  const ik = h['footIk'] as unknown as { feet: Record<'L' | 'R', { fkPos: THREE.Vector3; pinPos: THREE.Vector3; lockWeight: number }> };
  let maxPinnedDrift = 0;
  for (let i = 0; i < 150; i++) {
    const vel = h.steer(i < 90 ? fwd : null, dt, { maxSpeed: i < 90 ? 0.35 : 0, accel: 4 });
    h.group.position.addScaledVector(vel, dt);
    h.update(dt);
    for (const s of ['L', 'R'] as const) {
      const f = ik.feet[s];
      if (f.lockWeight > 0.5) {
        maxPinnedDrift = Math.max(maxPinnedDrift, Math.hypot(f.fkPos.x - f.pinPos.x, f.fkPos.z - f.pinPos.z));
      }
    }
  }
  const finalDriftL = Math.hypot(ik.feet.L.fkPos.x - ik.feet.L.pinPos.x, ik.feet.L.fkPos.z - ik.feet.L.pinPos.z);
  const finalDriftR = Math.hypot(ik.feet.R.fkPos.x - ik.feet.R.pinPos.x, ik.feet.R.fkPos.z - ik.feet.R.pinPos.z);
  assert.ok(maxPinnedDrift < 0.16, `pinned foot never drags body into whole-body lean (max ${maxPinnedDrift.toFixed(3)} m)`);
  assert.ok(Math.max(finalDriftL, finalDriftR) < 0.06, `settled under hips after stop (${finalDriftL.toFixed(3)}, ${finalDriftR.toFixed(3)} m)`);
  h.dispose();
});
