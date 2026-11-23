import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ctx } from '../ai/enemyTestKit.ts';
import type { Animator } from './animator.ts';
import { Humanoid } from './humanoid.ts';
import { resolveProfile, sharedMotionProfiles, validateMotionProfiles } from './motionProfiles.ts';
import { sharedMocapLibrary } from './mocap.ts';
import { motionScene } from './motionScene.ts';
import { GILES } from './squadLooks.ts';

const profiles = validateMotionProfiles(
  {
    defaults: { m: 'crew_m', f: 'crew_f' },
    profiles: {
      crew_m: { gender: 'm' },
      crew_f: { gender: 'f' },
      bram: {
        gender: 'm',
        variants: {
          intro: { when: { sequence: 'intro_shift_change' }, clips: { idle: 'idle_talk' }, poses: { offer_mug: 'drink' } },
          panel: { when: { task: 'bypass', stage: [2, 4] }, clips: { crouch: 'kneel_fix' } },
          late: { when: { flag: 'kitchen_closed' }, style: { tempo: 0.8 } },
          hush: { when: { flag: 'bram_hush' }, style: { talkArms: 0 } },
        },
      },
    },
  },
  'test',
);

const bram = (): Humanoid => new Humanoid({ ...GILES, seed: 'bram-probe', profile: 'bram', role: 'npc', pose: 'idle' }, { ...ctx(), motionProfiles: profiles });
const anim = (h: Humanoid): Animator => h['animator'];
const run = (h: Humanoid, s = 0.5): void => {
  for (let i = 0; i < s * 60; i++) h.update(1 / 60);
};

beforeEach(() => motionScene.reset());

test('scene variants: a sequence variant applies only while its sequence runs', () => {
  const h = bram();
  run(h);
  assert.equal(anim(h).motion.clips.idle, 'idle');
  motionScene.startSequence('intro_shift_change');
  run(h);
  assert.equal(anim(h).motion.clips.idle, 'idle_talk', 'intro variant clip while the intro runs');
  motionScene.endSequence('intro_shift_change');
  run(h);
  assert.equal(anim(h).motion.clips.idle, 'idle', 'back to everyday motion after it');
});

test('scene variants: task and stage conditions must all hold; flags are read from the game', () => {
  const h = bram();
  motionScene.setTask('bram', 'bypass');
  run(h);
  assert.equal(anim(h).motion.clips.crouch, 'crouch_idle', 'stage 0: not yet');
  motionScene.setStage(2);
  run(h);
  assert.equal(anim(h).motion.clips.crouch, 'kneel_fix');
  motionScene.setTask('bram', null);
  run(h);
  assert.equal(anim(h).motion.clips.crouch, 'crouch_idle');
  const flags: Record<string, boolean> = {};
  motionScene.flags = () => flags;
  run(h);
  assert.equal(anim(h).motion.style.tempo, 1);
  flags['kitchen_closed'] = true;
  run(h);
  assert.equal(anim(h).motion.style.tempo, 0.8, 'flag picked up without a scene change event');
  motionScene.flags = () => ({});
});

test('scene variants: a pose a sequence asks for resolves through the active variant first', () => {
  const h = bram();
  motionScene.startSequence('intro_shift_change');
  run(h);
  h.setPose('offer_mug');
  assert.equal(h['idlePose'], 'drink', "the intro variant's own pose");
  motionScene.endSequence('intro_shift_change');
  run(h);
  h.setPose('offer_mug');
  assert.equal(h['idlePose'], 'offer_mug');
});

test('scene variants: switching cross-fades instead of popping', () => {
  const h = bram();
  run(h, 1);
  const before = h['bones']['chest'].quaternion.clone();
  motionScene.startSequence('intro_shift_change');
  h.update(1 / 60);
  h.update(1 / 60);
  const step = h['bones']['chest'].quaternion.angleTo(before);
  assert.ok(step < 0.05, `first frames after the switch move ${step.toFixed(3)} rad`);
});

test('talkArms 0: a talking body keeps its arms and wrists at rest; the jaw still talks', () => {
  const flags: Record<string, boolean> = { bram_hush: true };
  motionScene.flags = () => flags;
  const swing = (hush: boolean): { arm: number; wrist: number; jaw: number } => {
    flags['bram_hush'] = hush;
    const quiet = bram();
    const talker = bram();
    run(quiet);
    run(talker);
    talker.speak('Coffee first, then the gossip, that is the rule in my kitchen.', 'neutral', 3, 'hush_probe');
    let arm = 0;
    let wrist = 0;
    let jaw = 0;
    for (let i = 0; i < 150; i++) {
      quiet.update(1 / 60);
      talker.update(1 / 60);
      for (const j of ['upperArm_R', 'foreArm_R', 'upperArm_L', 'foreArm_L'] as const) {
        arm = Math.max(arm, talker['bones'][j].quaternion.angleTo(quiet['bones'][j].quaternion));
      }
      for (const j of ['hand_R', 'hand_L'] as const) wrist = Math.max(wrist, talker['bones'][j].quaternion.angleTo(quiet['bones'][j].quaternion));
      jaw = Math.max(jaw, talker['bones'].jaw.quaternion.angleTo(quiet['bones'].jaw.quaternion));
    }
    quiet.dispose();
    talker.dispose();
    return { arm, wrist, jaw };
  };
  const loud = swing(false);
  const hushed = swing(true);
  motionScene.flags = () => ({});
  assert.ok(loud.arm > 0.3, `a calm line normally lifts the forearm (${loud.arm.toFixed(2)} rad)`);
  assert.ok(hushed.arm < 0.02, `with talkArms 0 the arms stay at rest (${hushed.arm.toFixed(3)} rad)`);
  // The wrists keep only the hand solver's follow-through of the talking trunk (a few degrees), with no speech accents.
  assert.ok(hushed.wrist < 0.09 && hushed.wrist < loud.wrist, `wrists stay quiet (${hushed.wrist.toFixed(3)} vs ${loud.wrist.toFixed(3)} rad)`);
  assert.ok(hushed.jaw > 0.1, 'the jaw still talks');
});

test("Bram's intro: no talk gestures on his arms until the coffee is served, then he talks with his hands again", () => {
  const flags: Record<string, boolean> = {};
  const scene = (seq: boolean) => ({ sequences: new Set(seq ? ['intro_shift_change'] : []), task: null, stage: 0, flag: (n: string) => Boolean(flags[n]) });
  const lib = sharedMocapLibrary();
  const talkArms = (seq: boolean): number => resolveProfile(lib, sharedMotionProfiles(), 'bram', 'm', false, scene(seq), true).style.talkArms;
  assert.equal(talkArms(false), 1, 'everyday Bram gestures');
  assert.equal(talkArms(true), 0, 'intro, before the hand-off');
  flags['bram_coffee_served'] = true;
  assert.equal(talkArms(true), 1, 'intro, after both mugs are handed over');
});
