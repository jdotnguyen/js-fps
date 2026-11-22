import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import coreJson from '../data/mocap-core.json' with { type: 'json' };
// @ts-expect-error plain ES module without types
import { makeAdditive } from '../../scripts/lib/additive.mjs';
import { ctx } from '../ai/enemyTestKit.ts';
import { Animator } from './animator.ts';
import { Humanoid, type HumanoidSpec } from './humanoid.ts';
import { MocapLibrary, type RawMocapFile } from './mocap.ts';
import { resolveProfile, validateMotionProfiles } from './motionProfiles.ts';
import { GILES } from './squadLooks.ts';

const core = coreJson as unknown as RawMocapFile;

function library(): MocapLibrary {
  const lib = new MocapLibrary(core);
  const hold = makeAdditive(JSON.parse(JSON.stringify(core.clips['idle_talk'])));
  lib.addPack('probe', { version: 1, fps: 24, source: 'test', clips: { probe_hold: hold } });
  return lib;
}

const profiles = validateMotionProfiles(
  {
    defaults: { m: 'crew_m', f: 'crew_f' },
    profiles: { crew_m: { gender: 'm' }, crew_f: { gender: 'f' }, held: { gender: 'm', holds: { lean_counter: 'probe_hold', lean_back: 'probe_hold' } } },
  },
  'test',
);

function body(pose: string, withHold: boolean, lib: MocapLibrary): { h: Humanoid; a: Animator } {
  const spec: HumanoidSpec = { ...GILES, role: 'npc', pose };
  const h = new Humanoid(spec, { ...ctx(), mocap: lib });
  const a = h['animator'] as Animator;
  a.setMotion(resolveProfile(lib, profiles, withHold ? 'held' : undefined, 'm'));
  return { h, a };
}

const wp = (h: Humanoid, j: string): THREE.Vector3 => ((h['bones'] as Record<string, THREE.Object3D>)[j]!).getWorldPosition(new THREE.Vector3());
const wq = (h: Humanoid, j: string): THREE.Quaternion => ((h['bones'] as Record<string, THREE.Object3D>)[j]!).getWorldQuaternion(new THREE.Quaternion());

for (const pose of ['lean_counter', 'lean_back_mug']) {
  test(`posture hold: ${pose} breathes with the character's hold clip while the hands stay put`, () => {
    const lib = library();
    const held = body(pose, true, lib);
    const plain = body(pose, false, lib);
    const dt = 1 / 60;
    let maxHand = 0;
    let maxChest = 0;
    for (let i = 0; i < 240; i++) {
      held.h.update(dt);
      plain.h.update(dt);
      if (i < 90) continue; // let the hold fade in
      for (const s of ['L', 'R']) maxHand = Math.max(maxHand, wp(held.h, `hand_${s}`).distanceTo(wp(plain.h, `hand_${s}`)));
      maxChest = Math.max(maxChest, wq(held.h, 'chest').angleTo(wq(plain.h, 'chest')));
    }
    assert.ok(held.a.holdW > 0.8, `hold active (${held.a.holdW.toFixed(2)})`);
    assert.ok(maxChest > (1 * Math.PI) / 180, `the chest moves with the hold (${((maxChest * 180) / Math.PI).toFixed(1)} deg)`);
    assert.ok(maxHand < 0.01, `hands stay where the pose puts them (${(maxHand * 100).toFixed(2)} cm)`);
  });
}

test('posture hold: no hold clip, no layer; a profile hold fades out when the pose changes family', () => {
  const lib = library();
  const { h, a } = body('lean_counter', true, lib);
  for (let i = 0; i < 120; i++) h.update(1 / 60);
  assert.ok(a.holdW > 0.8);
  h.setPose('idle');
  for (let i = 0; i < 120; i++) h.update(1 / 60);
  assert.ok(a.holdW < 0.05, `faded (${a.holdW.toFixed(3)})`);
});

test('posture without a hold clip: style values keep two characters moving, and moving differently', () => {
  const lib = library();
  const styled = validateMotionProfiles(
    {
      defaults: { m: 'crew_m', f: 'crew_f' },
      profiles: { crew_m: { gender: 'm' }, crew_f: { gender: 'f' }, calm: { gender: 'm', style: { fidgetRate: 0.3, tempo: 0.85 } }, edgy: { gender: 'm', style: { fidgetRate: 2.5, tempo: 1.2, asymmetry: 0.5 } } },
    },
    'test',
  );
  const make = (seed: string, prof: string): Humanoid => {
    const h = new Humanoid({ ...GILES, seed, role: 'npc', pose: 'lean_counter' }, { ...ctx(), mocap: lib });
    (h['animator'] as Animator).setMotion(resolveProfile(lib, styled, prof, 'm'));
    return h;
  };
  const track = (h: Humanoid): number[] => {
    const out: number[] = [];
    for (let i = 0; i < 300; i++) {
      h.update(1 / 60);
      if (i > 60 && i % 5 === 0) out.push(wq(h, 'foreArm_L').angleTo(wq(h, 'chest')));
    }
    return out;
  };
  const ta = track(make('calm-one', 'calm'));
  const tb = track(make('edgy-one', 'edgy'));
  const range = (t: number[]): number => Math.max(...t) - Math.min(...t);
  assert.ok(range(ta) > 1e-3 && range(tb) > 1e-3, `neither is frozen (${range(ta).toFixed(4)}, ${range(tb).toFixed(4)})`);
  assert.ok(range(tb) > range(ta) * 1.3, `the fidgety one moves more (${range(tb).toFixed(4)} vs ${range(ta).toFixed(4)})`);
});

test('own talk clip: generated speech gestures stay within the reduced arm-layer strength', () => {
  const lib = library();
  const own = validateMotionProfiles(
    { defaults: { m: 'crew_m', f: 'crew_f' }, profiles: { crew_m: { gender: 'm' }, crew_f: { gender: 'f' }, talker: { gender: 'm', clips: { talk: 'idle', idle: 'idle' } } } },
    'test',
  );
  // Arm motion attributable to generated speech gestures: speaking body vs the same body silent, same seed and clips. The probe's
  // talk clip is its idle clip, so the capture itself adds nothing to the difference.
  const speechArm = (prof: string | undefined, emote: 'urgent' | 'neutral', joints: readonly string[]): number => {
    const make = (): Humanoid => {
      const h = new Humanoid({ ...GILES, seed: 'talk-probe', role: 'npc', pose: 'idle' }, { ...ctx(), mocap: lib });
      (h['animator'] as Animator).setMotion(resolveProfile(lib, own, prof, 'm'));
      return h;
    };
    const talking = make();
    const silent = make();
    talking.speak('So the panel was warped from the inside, and the coolant was warm.', emote, 4);
    let max = 0;
    for (let i = 0; i < 200; i++) {
      talking.update(1 / 60);
      silent.update(1 / 60);
      for (const j of joints) max = Math.max(max, wq(talking, j).angleTo(wq(silent, j)));
    }
    return max;
  };
  // Heightened lines gesture with the whole arm, so under a body's own clips they are damped.
  const ARMS = ['upperArm_L', 'foreArm_L', 'upperArm_R', 'foreArm_R'];
  const generic = speechArm(undefined, 'urgent', ARMS);
  const withOwn = speechArm('talker', 'urgent', ARMS);
  assert.ok(generic > 0.02, `speech moves the arms (${generic.toFixed(3)} rad)`);
  assert.ok(withOwn <= generic * (Animator.OWN_MOTION_ARMS + 0.25), `own clips damp generated gestures (${withOwn.toFixed(3)} vs ${generic.toFixed(3)})`);
  // A calm line's forearm gesture is the only speech motion on the arms (speech-acting), so it plays at full strength either
  // way, and its upper arms stay near the idle.
  const calmGeneric = speechArm(undefined, 'neutral', ['foreArm_R']);
  const calmOwn = speechArm('talker', 'neutral', ['foreArm_R']);
  assert.ok(Math.abs(calmOwn - calmGeneric) < 0.02, `calm forearm gesture undamped (${calmOwn.toFixed(3)} vs ${calmGeneric.toFixed(3)} rad)`);
  const calmUpper = speechArm('talker', 'neutral', ['upperArm_L', 'upperArm_R']);
  assert.ok(calmUpper < (6 * Math.PI) / 180, `calm upper arms stay near idle (${calmUpper.toFixed(3)} rad)`);
});

test('Giles speaks over relaxed shoulders and settles after a one-handed accent', () => {
  const make = (): Humanoid => new Humanoid({ ...GILES, role: 'npc', pose: 'idle' }, ctx());
  const talking = make();
  const idle = make();
  let leftLift = 0;
  let rightLift = 0;
  let restingFrames = 0;
  for (let frame = 0; frame < 540; frame++) {
    if (frame === 60) talking.speak('The pumps are quiet. We can wait here a while.', null, 6);
    talking.update(1 / 60);
    idle.update(1 / 60);
    const left = wp(talking, 'hand_L').y - wp(idle, 'hand_L').y;
    const right = wp(talking, 'hand_R').y - wp(idle, 'hand_R').y;
    for (const joint of ['shoulder_L', 'shoulder_R'] as const) {
      assert.ok(talking.bones[joint].quaternion.angleTo(idle.bones[joint].quaternion) < 3 * Math.PI / 180);
    }
    if (frame >= 60 && frame < 420) {
      leftLift = Math.max(leftLift, left);
      rightLift = Math.max(rightLift, right);
      if (left < 0.10 && right < 0.10) restingFrames++;
    }
    if (frame === 539) assert.ok(Math.abs(left) < 0.02 && Math.abs(right) < 0.02);
  }
  assert.ok(leftLift > 0.10 && leftLift < 0.30, `left-hand accent rises ${leftLift} m`);
  assert.ok(rightLift < 0.10, `right hand rises ${rightLift} m`);
  assert.ok(restingFrames > 180, 'hands rest for most of the six-second line');
});

test('turned bodies ignore their living profile: a named crew member who turns shambles like any infected', () => {
  const lib = library();
  const living = validateMotionProfiles(
    {
      defaults: { m: 'crew_m', f: 'crew_f' },
      profiles: { crew_m: { gender: 'm' }, crew_f: { gender: 'f' }, ruiz: { gender: 'f', clips: { walk: 'walk_formal', idle: 'idle_talk' }, holds: { stand: 'probe_hold' }, style: { tempo: 1.3, fidgetRate: 2 } } },
    },
    'test',
  );
  const run = (prof: string | undefined): THREE.Quaternion[] => {
    const h = new Humanoid({ ...GILES, seed: 'turned', role: 'npc', pose: 'idle' }, { ...ctx(), mocap: lib });
    const a = h['animator'] as Animator;
    a.setMotion(resolveProfile(lib, living, prof, 'f'));
    a.useMocap = true;
    a.twitchy = true;
    a['gait'] = 'shamble';
    a.speed = 0.8;
    for (let i = 0; i < 90; i++) a.update(1 / 60);
    return ['pelvis', 'thigh_L', 'shin_R', 'upperArm_L', 'head'].map((j) => wq(h, j));
  };
  const named = run('ruiz');
  const plain = run(undefined);
  named.forEach((q, i) => assert.ok(q.angleTo(plain[i]!) < 1e-3, `same infected gait whatever the living profile (joint ${i}: ${q.angleTo(plain[i]!).toFixed(5)} rad)`));
});

test('spine distribution: lean_back curves over the trunk; no joint takes more than half the bend; the chest keeps its orientation', () => {
  const h = new Humanoid({ ...GILES, role: 'npc', pose: 'lean_back' }, ctx());
  for (let i = 0; i < 120; i++) h.update(1 / 60);
  const bones = h['bones'] as Record<string, THREE.Object3D>;
  // Averaged over a few seconds: the character's own hold and breathing move each segment a little from frame to frame.
  let sp = 0;
  let ch = 0;
  const FRAMES = 300;
  for (let i = 0; i < FRAMES; i++) {
    h.update(1 / 60);
    sp += bones['spine']!.quaternion.angleTo(new THREE.Quaternion()) / FRAMES;
    ch += bones['chest']!.quaternion.angleTo(new THREE.Quaternion()) / FRAMES;
  }
  const total = sp + ch;
  assert.ok(total > 0.02, `lean_back bends the trunk (${total.toFixed(3)} rad)`);
  assert.ok(sp > 0.05 * total && ch > 0.05 * total, 'both segments bend');
  assert.ok(Math.max(sp, ch) <= 0.55 * total, `no segment carries most of the bend (${sp.toFixed(3)} / ${ch.toFixed(3)})`);
});

const treated = validateMotionProfiles(
  {
    defaults: { m: 'crew_m', f: 'crew_f' },
    profiles: {
      crew_m: { gender: 'm' },
      crew_f: { gender: 'f' },
      worker: { gender: 'm', clips: { work: 'probe_hold', drink: 'probe_hold' } },
      fullClip: { gender: 'm', clips: { work: 'kneel_fix', drink: 'idle_talk' } },
    },
  },
  'test',
);

for (const pose of ['typing', 'sit_typing', 'lean_back_mug_drink']) {
  test(`pose treatment: ${pose} plays the profile's own additive clip with the hands kept on the job`, () => {
    const lib = library();
    const make = (prof: string | undefined): { h: Humanoid; a: Animator } => {
      const h = new Humanoid({ ...GILES, role: 'npc', pose }, { ...ctx(), mocap: lib });
      const a = h['animator'] as Animator;
      a.setMotion(resolveProfile(lib, treated, prof, 'm'));
      return { h, a };
    };
    const own = make('worker');
    const plain = make(undefined);
    const full = make('fullClip');
    let maxHand = 0;
    let maxChest = 0;
    let maxPelvis = 0;
    for (let i = 0; i < 240; i++) {
      for (const b of [own, plain, full]) b.h.update(1 / 60);
      if (i < 90) continue;
      // A drinking hand follows the mouth (upright-mug-grip D3c): it keeps its place relative to the head, not the body.
      const drinking = pose.endsWith('_drink');
      for (const s of ['L', 'R']) {
        const d =
          drinking && s === 'R'
            ? Math.abs(wp(own.h, 'hand_R').distanceTo(wp(own.h, 'head')) - wp(plain.h, 'hand_R').distanceTo(wp(plain.h, 'head')))
            : wp(own.h, `hand_${s}`).distanceTo(wp(plain.h, `hand_${s}`));
        maxHand = Math.max(maxHand, d);
      }
      maxChest = Math.max(maxChest, wq(own.h, 'chest').angleTo(wq(plain.h, 'chest')));
      maxPelvis = Math.max(maxPelvis, wp(own.h, 'pelvis').distanceTo(wp(plain.h, 'pelvis')));
    }
    assert.ok(own.a.holdW > 0.8, `treatment active (${own.a.holdW.toFixed(2)})`);
    assert.ok(maxChest > (1 * Math.PI) / 180, `the body moves with the character's clip (${((maxChest * 180) / Math.PI).toFixed(1)} deg)`);
    assert.ok(maxHand < 0.01, `hands stay on the keyboard or mug (${(maxHand * 100).toFixed(2)} cm)`);
    if (pose.startsWith('sit_')) assert.ok(maxPelvis < 1e-4, `seated: the pelvis stays on the seat (${(maxPelvis * 100).toFixed(2)} cm)`);
    assert.equal(full.a.holdW, 0, 'a full (non-additive) clip is not layered onto the pose');
  });
}
