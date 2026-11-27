import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Humanoid } from './humanoid.ts';
import { DEFAULT_MOTIONS, sampleClip, sampleLocomotion, sampleZombieLocomotion, sharedMocapLibrary, type LocomotionSample } from './mocap.ts';
import { Animator } from './animator.ts';
import { CAST } from './castLooks.ts';
import { emptyPose } from './poses.ts';
import { Spring1D, settleUprightTurn, stepUprightTurn, type UprightTurnState } from './springs.ts';
import { GILES, OKAFOR } from './squadLooks.ts';
import { JOINT_INDEX } from './skeleton.ts';
import { ctx } from '../ai/enemyTestKit.ts';
import priyaPack from '../data/cast/priya/mocap.json' with { type: 'json' };
import vossPack from '../data/cast/voss/mocap.json' with { type: 'json' };
import bramPack from '../data/cast/bram/mocap.json' with { type: 'json' };
import ruizPack from '../data/cast/ruiz/mocap.json' with { type: 'json' };
import heinsPack from '../data/cast/heins/mocap.json' with { type: 'json' };
import halePack from '../data/cast/hale/mocap.json' with { type: 'json' };
import sungPack from '../data/cast/sung/mocap.json' with { type: 'json' };

// Named characters with clip packs (Priya) need them loaded, as the game does at start (loadMocapPacks). Node needs the JSON
// import attribute, which the bundler's lazy pack import cannot carry, so tests add the pack directly.
sharedMocapLibrary().addPack('priya', priyaPack as unknown as Parameters<ReturnType<typeof sharedMocapLibrary>['addPack']>[1]);
sharedMocapLibrary().addPack('voss', vossPack as unknown as Parameters<ReturnType<typeof sharedMocapLibrary>['addPack']>[1]);
sharedMocapLibrary().addPack('bram', bramPack as unknown as Parameters<ReturnType<typeof sharedMocapLibrary>['addPack']>[1]);
sharedMocapLibrary().addPack('ruiz', ruizPack as unknown as Parameters<ReturnType<typeof sharedMocapLibrary>['addPack']>[1]);
sharedMocapLibrary().addPack('heins', heinsPack as unknown as Parameters<ReturnType<typeof sharedMocapLibrary>['addPack']>[1]);
sharedMocapLibrary().addPack('hale', halePack as unknown as Parameters<ReturnType<typeof sharedMocapLibrary>['addPack']>[1]);
sharedMocapLibrary().addPack('sung', sungPack as unknown as Parameters<ReturnType<typeof sharedMocapLibrary>['addPack']>[1]);
for (const p of ['priya', 'voss', 'bram', 'ruiz', 'heins', 'hale', 'sung']) sharedMocapLibrary().retainPack(p); // held for the whole file: test bodies come and go

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

test('shipped mocap-core.json compiles all 10 clips (human + zombie) with unit quaternions and phase-synced locomotion', () => {
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

test('the locomotion blend uses the set\'s walk clip for the stride', () => {
  const lib = sharedMocapLibrary();
  const out = emptyPose('loco');
  const info: LocomotionSample = { stride: 1, moveWeight: 0, jogWeight: 0, contactL: 1, contactR: 1 };
  sampleLocomotion(lib, 1.3, 0.2, 0, { motions: { ...DEFAULT_MOTIONS, walk: 'walk_formal' } }, out, info);
  assert.ok(Math.abs(info.stride - lib.get('walk_formal').stride) < 1e-6, 'walking at 1.3 m/s uses the set\'s walk clip');
});

test('a character whose profile names its own clips gets damped procedural arm layers; others keep them whole', () => {
  const priya = new Humanoid({ ...CAST['priya']!, role: 'npc' }, ctx());
  const giles = new Humanoid({ ...GILES, role: 'npc' }, ctx());
  const okafor = new Humanoid({ ...OKAFOR, role: 'npc' }, ctx());
  const anim = (h: Humanoid): Animator => h['animator'];
  assert.equal(anim(priya).armLayer, Animator.OWN_MOTION_ARMS);
  assert.equal(anim(priya).motions.walk, 'priya_walk', 'Priya walks her own walk (her clip pack)');
  assert.equal(anim(giles).armLayer, Animator.OWN_MOTION_ARMS, 'Giles plays his own clips');
  assert.deepEqual(anim(giles).motions, { idle: 'giles_idle', talk: 'giles_talk', walk: 'giles_walk', jog: 'giles_jog' });
  assert.equal(anim(giles).motion.profile, 'giles');
  const crew = new Humanoid({ seed: 'crew:arms', outfit: 'crew', role: 'npc' }, ctx());
  assert.equal(anim(crew).armLayer, 1, 'crew on a default keep the procedural arm layers whole');
  // Shared idle and talk; a walk and run from the masculine default's pools (task 6.9).
  assert.equal(anim(crew).motions.idle, DEFAULT_MOTIONS.idle);
  assert.equal(anim(crew).motions.talk, DEFAULT_MOTIONS.talk);
  assert.match(anim(crew).motions.walk, /^crew_m_walk_[abc]$/);
  assert.match(anim(crew).motions.jog, /^crew_m_jog_[abc]$/);
  assert.equal(anim(priya).motion.gender, 'f');
  assert.equal(anim(okafor).motions.walk, 'okafor_walk', 'Okafor walks his own walk');
  const medic = new Humanoid({ seed: 'crew:medic', outfit: 'medic', role: 'npc' }, ctx());
  assert.equal(anim(medic).motions.walk, 'walk_formal', 'medics keep the formal walk without a set of their own');
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

/** Characters whose own motion has landed (tasks 6.x); the rest still play what they played before profiles. */
const OWN_MOTION_LANDED = new Set(['giles', 'okafor', 'priya', 'voss', 'bram', 'ruiz', 'heins', 'hale', 'sung']);

test('profiles on today\'s clips: a named character whose own motion has not landed plays exactly what it played before profiles', () => {
  const anim = (h: Humanoid): Animator => h['animator'];
  const named = { giles: GILES, okafor: OKAFOR, ...CAST };
  for (const [id, look] of Object.entries(named)) {
    if (id === 'lab_creature' || id === 'cook') continue;
    if (OWN_MOTION_LANDED.has(id)) {
      const a = anim(new Humanoid({ ...look, role: 'npc' }, ctx()));
      // Its own capture for each (Voss, who has no lines, talks with her idle).
      for (const slot of ['idle', 'talk', 'walk', 'jog'] as const) assert.ok(a.motions[slot].startsWith(`${id}_`), `${id} plays its own ${slot} (${a.motions[slot]})`);
      assert.equal(a.armLayer, Animator.OWN_MOTION_ARMS, `${id} keeps its captured arms readable`);
      continue;
    }
    const h = new Humanoid({ ...look, role: 'npc' }, ctx());
    const a = anim(h);
    const ownBefore = id === 'priya';
    const formalBefore = ownBefore || look.outfit === 'medic' || look.seed === 'director-hale';
    assert.deepEqual(a.motions, { ...DEFAULT_MOTIONS, walk: formalBefore ? 'walk_formal' : 'walk' }, `${id} locomotion clips unchanged`);
    assert.equal(a.armLayer, ownBefore ? Animator.OWN_MOTION_ARMS : 1, `${id} arm layer unchanged`);
    assert.equal(a.motion.clips.aimPistol, 'pistol_idle', `${id} pistol clip unchanged`);
    assert.equal(a.motion.clips.kneel, 'kneel_fix', `${id} kneel clip unchanged`);
    assert.equal(a.motion.clips.crouch, 'crouch_idle', `${id} crouch clip unchanged`);
    assert.equal(a.motion.profile, look.profile, `${id} uses its own profile`);
  }
});

test('crew on the same default profile vary by body: out of phase, different tempo, the same every run', () => {
  const anim = (h: Humanoid): Animator => h['animator'];
  const make = (id: string): Animator => anim(new Humanoid({ seed: `crew:${id}`, outfit: 'crew', role: 'npc' }, ctx()));
  const a = make('mess_1');
  const b = make('mess_2');
  assert.equal(a.motion.profile, b.motion.profile, 'same default profile');
  assert.ok(a.motion.isDefault);
  assert.notEqual(a.tempo, b.tempo, 'tempos differ');
  for (const x of [a, b]) {
    assert.ok(x.tempo >= 0.92 && x.tempo <= 1.08, `tempo ${x.tempo} within ±8%`);
    assert.ok(Math.abs(x.posture) <= 0.15);
  }
  assert.notEqual(a['idlePhase'], b['idlePhase'], 'idle cycles out of phase');
  const again = make('mess_1');
  assert.equal(again.tempo, a.tempo, 'tempo repeats for the same id');
  assert.equal(again['idlePhase'], a['idlePhase'], 'phase repeats for the same id');
  const giles = anim(new Humanoid({ ...GILES, role: 'npc' }, ctx()));
  assert.equal(giles.tempo, giles.motion.style.tempo, 'named characters take their tempo from their profile only');
  assert.equal(giles.posture, giles.motion.style.posture);
});

test('a character with a talk capture of its own plays its arms while speaking; crew keep the shared talk clip off the arms', () => {
  const ARM_INDEX = new Set((['upperArm_L', 'foreArm_L', 'upperArm_R', 'foreArm_R'] as const).map((j) => JOINT_INDEX[j]));
  /** Largest arm-joint difference (rad) in the mocap base between the same body speaking and silent. */
  const armShift = (spec: ConstructorParameters<typeof Humanoid>[0]): number => {
    const quiet = new Humanoid(spec, ctx());
    const loud = new Humanoid(spec, ctx());
    loud.speak('Third quarantine this month, and nobody tells the kitchen anything.', null, 4);
    let worst = 0;
    for (let i = 0; i < 90; i++) {
      quiet.update(1 / 60);
      loud.update(1 / 60);
      const a = quiet['animator']['mocapPose'] as ReturnType<typeof emptyPose>;
      const b = loud['animator']['mocapPose'] as ReturnType<typeof emptyPose>;
      for (let k = 0; k < a.joints.length; k++) {
        const qa = a.joints[k];
        const qb = b.joints[k];
        if (qa && qb && ARM_INDEX.has(k)) worst = Math.max(worst, qa.angleTo(qb));
      }
    }
    quiet.dispose();
    loud.dispose();
    return worst;
  };
  const giles = armShift({ ...GILES, role: 'npc' });
  const crew = armShift({ seed: 'crew:talker', outfit: 'crew', role: 'npc' });
  assert.ok(giles > 0.15, `Giles's own talk capture moves his arms (${giles.toFixed(3)} rad)`);
  assert.ok(crew < 0.01, `the shared talk clip stays off crew arms (${crew.toFixed(3)} rad)`);
});

// ---------------------------------------------------------------- calm lines (spec speech-acting)

const CALM_LINE = 'Right, so the pump feeds the loop, and the loop feeds the bay.';
const R2D = 180 / Math.PI;

/** Run a speaking body beside a silent twin; `each` gets both every frame after the line starts. */
function twins(spec: ConstructorParameters<typeof Humanoid>[0], emote: 'neutral' | 'urgent' | 'laugh', seconds: number, each: (loud: Humanoid, quiet: Humanoid, frame: number) => void, drive?: (h: Humanoid, dt: number) => void): void {
  const quiet = new Humanoid(spec, ctx());
  const loud = new Humanoid(spec, ctx());
  const dt = 1 / 60;
  const step = (): void => {
    for (const h of [quiet, loud]) {
      drive?.(h, dt);
      h.update(dt);
    }
  };
  for (let i = 0; i < 30; i++) step();
  loud.speak(CALM_LINE, emote, seconds, `twins-${emote}`);
  for (let i = 1; i <= seconds * 60; i++) {
    step();
    each(loud, quiet, i);
  }
  quiet.dispose();
  loud.dispose();
}

test('Tomas and Priya talk calmly from the elbow: their talk capture moves the trunk, the right forearm beats, the shoulders stay put', () => {
  for (const [id, spec] of [['okafor', { ...OKAFOR, role: 'npc' as const }], ['priya', { ...CAST['priya']!, role: 'npc' as const }]] as const) {
    let upper = 0;
    let foreMin = Infinity;
    let foreMax = -Infinity;
    let leftFore = 0;
    let trunk = 0;
    twins(spec, 'neutral', 4, (loud, quiet, i) => {
      upper = Math.max(upper, loud.bones.upperArm_R.quaternion.angleTo(quiet.bones.upperArm_R.quaternion) * R2D, loud.bones.upperArm_L.quaternion.angleTo(quiet.bones.upperArm_L.quaternion) * R2D);
      leftFore = Math.max(leftFore, loud.bones.foreArm_L.quaternion.angleTo(quiet.bones.foreArm_L.quaternion) * R2D);
      trunk = Math.max(trunk, loud.bones.chest.quaternion.angleTo(quiet.bones.chest.quaternion) * R2D);
      // Past the fade-in and before the closing settle: the elbow's flex as the line plays.
      if (i > 30 && i < 3.4 * 60) {
        const flex = loud.bones.foreArm_R.quaternion.angleTo(quiet.bones.foreArm_R.quaternion) * R2D;
        foreMin = Math.min(foreMin, flex);
        foreMax = Math.max(foreMax, flex);
      }
    });
    assert.ok(upper <= 6, `${id}: upper arms stay within ${upper.toFixed(1)}° of idle`);
    assert.ok(leftFore < 1, `${id}: the left forearm plays its idle (${leftFore.toFixed(2)}°)`);
    assert.ok(foreMax - foreMin >= 8, `${id}: the right elbow flex varies ${(foreMax - foreMin).toFixed(1)}° over the line`);
    assert.ok(trunk > 0.5, `${id}: the own talk capture still moves the trunk (${trunk.toFixed(2)}°)`);
  }
});

test('no line plays Tomas\'s or Priya\'s talk capture on the arms, heightened ones included (Priya laughs in the kitchen)', () => {
  const ARM_INDEX = (['upperArm_L', 'foreArm_L', 'hand_L', 'upperArm_R', 'foreArm_R', 'hand_R'] as const).map((j) => JOINT_INDEX[j]);
  for (const [id, spec] of [['okafor', { ...OKAFOR, role: 'npc' as const }], ['priya', { ...CAST['priya']!, role: 'npc' as const }]] as const) {
    for (const emote of ['laugh', 'urgent', 'neutral'] as const) {
      let arms = 0;
      let trunk = 0;
      twins(spec, emote, 4, (loud, quiet) => {
        const a = quiet['animator']['mocapPose'] as ReturnType<typeof emptyPose>;
        const b = loud['animator']['mocapPose'] as ReturnType<typeof emptyPose>;
        for (const k of ARM_INDEX) arms = Math.max(arms, a.joints[k]!.angleTo(b.joints[k]!));
        trunk = Math.max(trunk, a.joints[JOINT_INDEX.chest]!.angleTo(b.joints[JOINT_INDEX.chest]!));
      });
      assert.ok(arms * R2D < 0.1, `${id} ${emote}: the talk capture leaves the arms alone (${(arms * R2D).toFixed(2)}°)`);
      assert.ok(trunk > 0.002, `${id} ${emote}: it still moves the trunk (${(trunk * R2D).toFixed(2)}°)`);
    }
  }
});

/** Giles's six arm-joint quaternions (L then R: upper arm, forearm, hand) at frames 40, 110, 180 and 240 of a calm line, before the change. */
const GILES_CALM_BEFORE: Record<number, readonly number[]> = {
  40: [0.0613, -0.2369, -0.1932, 0.9502, 0.6446, 0, 0, 0.7645, 0.0138, -0.2402, -0.0067, 0.9706, 0.0222, -0.1109, 0.0558, 0.992, 0.3014, 0, 0, 0.9535, 0.003, -0.0584, 0.0138, 0.9982],
  110: [0.0568, 0.1341, 0.0241, 0.9891, 0.1457, 0, 0, 0.9893, 0.0576, -0.1258, 0.0083, 0.9904, 0.0149, -0.0832, 0.0653, 0.9943, 0.3658, 0, 0, 0.9307, 0.0016, -0.1119, -0.0188, 0.9935],
  180: [0.0022, 0.3008, -0.0858, 0.9498, 0.0046, -0.0241, 0.1727, 0.9847, -0.0215, -0.1634, -0.053, 0.9849, -0.0129, -0.1784, 0.038, 0.9831, 0.2796, 0, 0, 0.9601, -0.0113, -0.0588, 0.0164, 0.9981],
  240: [-0.0065, 0.1195, 0.0279, 0.9924, 0.2258, 0, 0, 0.9742, -0.0114, 0.0369, 0.0046, 0.9992, -0.0214, -0.1557, 0.0466, 0.9865, 0.2736, 0, 0, 0.9618, -0.028, -0.0415, 0.0071, 0.9987],
};

test('Giles keeps his reviewed one-handed talk capture on calm lines', () => {
  const h = new Humanoid({ ...GILES, role: 'npc' }, ctx());
  for (let i = 0; i < 30; i++) h.update(1 / 60);
  h.speak(CALM_LINE, 'neutral', 5, 'giles-calm');
  for (let i = 1; i <= 240; i++) {
    h.update(1 / 60);
    const want = GILES_CALM_BEFORE[i];
    if (!want) continue;
    // The captured arm (upper arm and forearm) is compared; the hands also carry the hand solver's wrist springs, and a calm
    // line now leaves the non-gesturing wrist still (spec speech-acting), so the left hand differs by a degree or two.
    const got = (['upperArm_L', 'foreArm_L', 'hand_L', 'upperArm_R', 'foreArm_R', 'hand_R'] as const).flatMap((j) => h.bones[j].quaternion.toArray());
    for (let k = 0; k < got.length; k++) {
      if (Math.floor(k / 4) % 3 === 2) continue; // hand_L, hand_R
      assert.ok(Math.abs(got[k]! - want[k]!) < 0.005, `frame ${i}, component ${k}: ${got[k]!.toFixed(4)} vs ${want[k]}`);
    }
  }
  h.dispose();
});

test('speech adds no arm motion while Tomas or Priya walk or jog, and the jaw still talks', () => {
  const ARMS = ['upperArm_L', 'foreArm_L', 'hand_L', 'upperArm_R', 'foreArm_R', 'hand_R'] as const;
  for (const [id, spec] of [['okafor', { ...OKAFOR, role: 'npc' as const }], ['priya', { ...CAST['priya']!, role: 'npc' as const }]] as const) {
    for (const [gait, speed] of [['walk', 1], ['jog', 3]] as const) {
      for (const emote of ['neutral', 'urgent'] as const) {
        const fwd = new THREE.Vector3(0, 0, -speed);
        let arm = 0;
        let hand = 0;
        let jaw = 0;
        twins(spec, emote, 3, (loud, quiet, i) => {
          if (i < 30) return; // up to speed
          const moving = loud['animator']['locoInfo'].moveWeight as number;
          if (moving < 0.999) return;
          for (const j of ARMS) {
            const d = loud.bones[j].quaternion.angleTo(quiet.bones[j].quaternion);
            if (j.startsWith('hand')) hand = Math.max(hand, d);
            else arm = Math.max(arm, d);
          }
          jaw = Math.max(jaw, loud.bones.jaw.quaternion.angleTo(quiet.bones.jaw.quaternion));
        }, (h, dt) => h.move(fwd, dt));
        // Within 0.1°: the talking nod's few tenths of a degree of chest motion is all that reaches the arms.
        assert.ok(arm * R2D < 0.1, `${id} ${gait} ${emote}: upper arms and forearms match the silent walk (${(arm * R2D).toFixed(3)}°)`);
        // The wrists keep only the hand solver's follow-through to the talking nod's chest motion, no speech accent.
        assert.ok(hand * R2D < 1, `${id} ${gait} ${emote}: wrists stay within ${(hand * R2D).toFixed(2)}° of the silent walk`);
        assert.ok(jaw > 0.05, `${id} ${gait} ${emote}: the jaw follows the line (${jaw.toFixed(3)} rad)`);
      }
    }
  }
});

test('Okafor\'s glance: a sequence asking for `glance` gets his steadier, head-led version', () => {
  const okafor = new Humanoid({ ...OKAFOR, role: 'npc' }, ctx());
  const crew = new Humanoid({ seed: 'crew:glancer', outfit: 'crew', role: 'npc' }, ctx());
  for (const h of [okafor, crew]) h.setPose('glance', 0.3);
  assert.equal(okafor.idlePose, 'okafor_glance');
  assert.equal(crew.idlePose, 'glance');
  // Slower: his own version blends at his tempo, the shared one at the asked-for 0.3 s.
  const blendDur = (h: Humanoid): number => (h['animator'] as Animator)['blendDur'] as number;
  const tempo = (okafor['animator'] as Animator).tempo;
  assert.ok(tempo < 1);
  assert.ok(Math.abs(blendDur(okafor) - 0.3 / tempo) < 1e-6, `his glance blends over ${blendDur(okafor).toFixed(3)} s`);
  assert.ok(Math.abs(blendDur(crew) - 0.3) < 1e-6);
  const chestTurn = (h: Humanoid): number => {
    for (let i = 0; i < 60; i++) h.update(1 / 60);
    return (h['bones'] as Record<string, THREE.Object3D>)['chest']!.quaternion.angleTo(new THREE.Quaternion());
  };
  assert.ok(chestTurn(okafor) < chestTurn(crew), 'he turns his chest less than the shared glance does');
  okafor.dispose();
  crew.dispose();
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
  // Walk slowly (0.35 m/s) then decelerate to a stop: feet must never drag > 0.16 m behind FK ankles,
  // and once stopped must settle back under the hips instead of staying stuck leaning over planted feet.
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
