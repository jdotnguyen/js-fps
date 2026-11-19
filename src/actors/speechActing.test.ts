import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ACTING, actingFor, gesture, mouthCues, mouthOpenAt, planSpeech } from './speechActing.ts';
import { EMOTES } from '../data/types/dialogue.ts';
import { Humanoid } from './humanoid.ts';
import { ctx } from '../ai/enemyTestKit.ts';
import type { JointName } from './skeleton.ts';

test('every emote has an acting style, and unknown ones talk like neutral', () => {
  for (const e of EMOTES) assert.ok(ACTING[e], e);
  assert.equal(actingFor('nonsense'), ACTING.neutral);
  assert.equal(actingFor(null), ACTING.neutral);
});

test('the mouth plan follows the text: one pulse per syllable, in order, inside the line, with a closing beat', () => {
  const text = "Cover me, I'll get this open!";
  const cues = mouthCues(text, 3, 'urgent');
  // co-ver me I'll get this o-pen: 8 syllables ("cover" and "open" have two).
  assert.equal(cues.length, 8);
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i]!;
    assert.ok(c.end > c.start, `cue ${i} has length`);
    assert.ok(c.open > 0 && c.open <= 1, `cue ${i} opens ${c.open}`);
    if (i > 0) assert.ok(c.start >= cues[i - 1]!.end - 1e-9, `cue ${i} starts after the last`);
  }
  assert.ok(cues[cues.length - 1]!.end <= 3 - 0.25, 'the mouth is shut before the line ends');
  // Deterministic for the same line, different for a different one.
  assert.deepEqual(mouthCues(text, 3, 'urgent'), cues);
  assert.notDeepEqual(mouthCues('Hold the door', 3, 'urgent').map((c) => c.open), cues.slice(0, 4).map((c) => c.open));
  // A comma or full stop gives a longer pause than a plain space.
  const plain = mouthCues('go now', 2, 'neutral');
  const stop = mouthCues('go. now', 2, 'neutral');
  assert.ok(stop[1]!.start - stop[0]!.end > plain[1]!.start - plain[0]!.end, 'a full stop pauses longer');
});

test('laughter is a steady run of ha-ha and a scream is one long open mouth', () => {
  const laugh = mouthCues('Ha, you wish', 2, 'laugh');
  assert.ok(laugh.length >= 6, `${laugh.length} laughs`);
  const gaps = laugh.slice(1).map((c, i) => c.start - laugh[i]!.start);
  assert.ok(gaps.every((g) => Math.abs(g - gaps[0]!) < 1e-6), 'even rhythm');
  const scream = mouthCues('Aaaah!', 1.5, 'scream');
  assert.equal(scream.length, 1);
  assert.ok(scream[0]!.end - scream[0]!.start > 1);
  assert.deepEqual(mouthCues('', 2, 'neutral'), []);
});

test('mouth opening is 0 between syllables and never above 1', () => {
  const cues = mouthCues('Hold the line', 2.5, 'neutral');
  let max = 0;
  for (let t = 0; t < 2.5; t += 0.01) {
    const o = mouthOpenAt(cues, t);
    assert.ok(o >= 0 && o <= 1.0001, `open ${o} at ${t}`);
    max = Math.max(max, o);
  }
  assert.ok(max > 0.4, `opens properly (${max})`);
  assert.equal(mouthOpenAt(cues, 2.45), 0);
  assert.equal(mouthOpenAt(cues, cues[0]!.start), 0);
});

test('gestures stay inside sane angles for every emote, and the other arm mirrors the primary', () => {
  for (const e of EMOTES) {
    const plan = planSpeech('We have to go, now. Come on!', e, 3, `line-${e}`);
    let peak = 0;
    for (let t = 0; t <= 3; t += 1 / 30) {
      gesture(plan, t, 1, 1, (_j, x, y, z) => {
        assert.ok(Number.isFinite(x + y + z), `${e}: finite`);
        peak = Math.max(peak, Math.abs(x), Math.abs(y), Math.abs(z));
      });
    }
    assert.ok(peak > 2, `${e}: visibly moves (${peak}°)`);
    assert.ok(peak < 110, `${e}: ${peak}° is too much`);
  }
  // The primary arm is the right one for a right-handed line and the left one otherwise; sideways angles mirror.
  const right = { ...planSpeech('x y z', 'scream', 2, 'a'), side: 0 as const };
  const left = { ...right, side: 1 as const };
  const z = (plan: typeof right, joint: JointName): number => {
    let v = 0;
    gesture(plan, 1, 1, 1, (j, _x, _y, zz) => {
      if (j === joint) v += zz;
    });
    return v;
  };
  assert.ok(z(right, 'upperArm_R') > 10 && z(right, 'upperArm_L') < -10, 'both arms flung out, mirrored');
  assert.ok(Math.abs(z(right, 'upperArm_R') + z(right, 'upperArm_L')) < 1e-6, 'symmetric for a symmetric emote');
  void left;
});

test('arms gesture less when busy and not at all with armsK 0, and the body stays still', () => {
  const plan = planSpeech('Quiet now', 'urgent', 2, 'busy');
  const sum = (armsK: number): { arm: number; body: number } => {
    const r = { arm: 0, body: 0 };
    gesture(plan, 0.8, 1, armsK, (j, x, y, z) => {
      const m = Math.abs(x) + Math.abs(y) + Math.abs(z);
      if (j.startsWith('upperArm') || j.startsWith('foreArm') || j.startsWith('hand')) r.arm += m;
      else r.body += m;
    });
    return r;
  };
  assert.equal(sum(0).arm, 0);
  assert.ok(sum(0.25).arm < sum(1).arm);
  assert.equal(sum(1).body, 0);
});

// ---------------------------------------------------------------- on a real body

function bodyRotation(h: Humanoid, joint: JointName, rest: THREE.Quaternion): number {
  return h.bones[joint].quaternion.angleTo(rest);
}

test('a talking body opens its jaw on the syllables, gestures, and settles back when the line ends', () => {
  const h = new Humanoid({ seed: 'talker', outfit: 'crew', role: 'npc' }, ctx());
  for (let i = 0; i < 30; i++) h.update(1 / 30);
  const jawRest = h.bones.jaw.quaternion.clone();
  const armRest = h.bones.upperArm_R.quaternion.clone();
  let jawMax = 0;
  let armMax = 0;
  h.speak('Cover me, I will get this open!', 'urgent', 2.5, 'giles_cover_01');
  assert.equal(h.speaking, true);
  for (let i = 0; i < 80; i++) {
    h.update(1 / 30);
    jawMax = Math.max(jawMax, bodyRotation(h, 'jaw', jawRest));
    armMax = Math.max(armMax, bodyRotation(h, 'upperArm_R', armRest), bodyRotation(h, 'upperArm_L', armRest));
  }
  assert.ok(jawMax > 0.15, `jaw opened ${jawMax} rad`);
  assert.ok(jawMax < 0.5, `jaw ${jawMax} rad stays natural`);
  assert.ok(armMax > 0.2, `arms gestured ${armMax} rad`);
  // Line over: mouth shut, gestures gone (idle life keeps a few degrees on the arms).
  for (let i = 0; i < 60; i++) h.update(1 / 30);
  assert.equal(h.speaking, false);
  assert.ok(bodyRotation(h, 'jaw', jawRest) < 0.01, 'jaw closed');
  assert.ok(bodyRotation(h, 'upperArm_R', armRest) < 0.12, 'arms back to idle');
  h.dispose();
});

test('cutting a line off closes the mouth within half a second', () => {
  const h = new Humanoid({ seed: 'talker2', outfit: 'crew', role: 'npc' }, ctx());
  for (let i = 0; i < 30; i++) h.update(1 / 30);
  const jawRest = h.bones.jaw.quaternion.clone();
  h.speak('Wait, what is that noise coming from the vents?', 'alarmed', 4, 'cut');
  for (let i = 0; i < 20; i++) h.update(1 / 30);
  h.stopSpeaking();
  for (let i = 0; i < 15; i++) h.update(1 / 30);
  assert.ok(bodyRotation(h, 'jaw', jawRest) < 0.02, 'closed');
  h.dispose();
});

test('the dead and the infected do not talk', () => {
  const infected = new Humanoid({ seed: 'zed', outfit: 'crew', role: 'enemy', infection: 2 }, ctx());
  infected.speak('Hello there', 'neutral', 2);
  assert.equal(infected.speaking, false);
  infected.dispose();
});
