import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ctx } from '../ai/enemyTestKit.ts';
import type { Animator } from './animator.ts';
import { Humanoid } from './humanoid.ts';
import { validateMotionProfiles } from './motionProfiles.ts';
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
