import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { validate } from '../core/validate.ts';
import { validateKillTable } from '../data/types/kills.ts';
import { ACTING, FOREARM_UPPER_ARM_MAX, SCREAM_TREMBLE, actingFor, gesture, hash01, mouthCues, mouthOpenAt, planSpeech, screamJawAt } from './speechActing.ts';
import { loudnessEnvelope } from '../audio/loudness.ts';
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

// ---------------------------------------------------------------- calm lines (spec speech-acting)

const CALM = ['neutral', 'question', 'relieved', 'whisper'] as const;
const HEIGHTENED = ['urgent', 'alarmed', 'pained', 'dread', 'scream'] as const;

test('calm lines gesture from the elbow down: the upper arm barely moves, the forearm beats and the wrist bends', () => {
  for (const e of CALM) {
    assert.equal(ACTING[e].forearmOnly, true, `${e} is forearm-only`);
    const plan = planSpeech('Right, so the pump feeds the loop, and the loop feeds the bay.', e, 4, `calm-${e}`);
    let upperPeak = 0;
    let foreMin = Infinity;
    let foreMax = -Infinity;
    let handMin = Infinity;
    let handMax = -Infinity;
    for (let t = 0; t <= 4; t += 1 / 60) {
      let fore = 0;
      let hand = 0;
      gesture(plan, t, 1, 1, (j, x, y, z) => {
        assert.ok(!j.endsWith('_L'), `${e}: nothing on the left arm (${j})`);
        if (j === 'upperArm_R') upperPeak = Math.max(upperPeak, Math.hypot(x, y, z));
        if (j === 'foreArm_R') fore += x;
        if (j === 'hand_R') hand += x;
      });
      foreMin = Math.min(foreMin, fore);
      foreMax = Math.max(foreMax, fore);
      handMin = Math.min(handMin, hand);
      handMax = Math.max(handMax, hand);
    }
    assert.ok(upperPeak <= FOREARM_UPPER_ARM_MAX, `${e}: upper arm moves ${upperPeak.toFixed(1)}°`);
    assert.ok(foreMax - foreMin >= 8, `${e}: elbow flex varies ${(foreMax - foreMin).toFixed(1)}°`);
    assert.ok(handMax - handMin >= 4, `${e}: wrist bends ${(handMax - handMin).toFixed(1)}°`);
  }
});

test('a laugh brings the right hand up toward the belly from the elbow, with no shoulder swing and nothing on the left arm', () => {
  assert.equal(ACTING.laugh.forearmOnly, true);
  const plan = planSpeech("I know. I've been practising.", 'laugh', 2.5, 'intro_priya_03');
  let upperPeak = 0;
  let forePeak = 0;
  for (let t = 0; t <= 2.5; t += 1 / 60) {
    gesture(plan, t, 1, 1, (j, x, y, z) => {
      assert.ok(!j.endsWith('_L'), `laugh: nothing on the left arm (${j})`);
      if (j === 'upperArm_R') upperPeak = Math.max(upperPeak, Math.hypot(x, y, z));
      if (j === 'foreArm_R') forePeak = Math.max(forePeak, x);
    });
  }
  assert.ok(upperPeak <= FOREARM_UPPER_ARM_MAX, `laugh: upper arm moves ${upperPeak.toFixed(1)}°`);
  assert.ok(forePeak > 40, `laugh: the forearm comes up (${forePeak.toFixed(1)}°)`);
});

test('calm lines are always right-handed; heightened lines still vary, and nothing else about the plan changes', () => {
  for (let i = 0; i < 20; i++) {
    for (const e of [...CALM, 'laugh'] as const) assert.equal(planSpeech('Line', e, 2, `calm-seed-${i}`).side, 0, `${e} line ${i}`);
  }
  const sides = new Set(Array.from({ length: 20 }, (_, i) => planSpeech('Line', 'urgent', 2, `urgent-seed-${i}`).side));
  assert.equal(sides.size, 2, 'urgent lines use both hands across seeds');
  // Tilt and the mouth come from the seed as before: a neutral line matches an urgent one with the same seed and text.
  const a = planSpeech('Hold the line', 'question', 2, 'same');
  assert.equal(a.tilt, hash01('same', 92) < 0.5 ? 1 : -1);
  assert.deepEqual(a.cues, mouthCues('Hold the line', 2, 'question', 'same'));
});

/** `gesture()` output summed at fixed times, recorded before the calm-line change (rounded to 0.001°). */
const HEIGHTENED_BEFORE: Record<string, Record<string, readonly number[]>> = {
  urgent: { spine: [0, 0, 0], chest: [0, 0, 0], head: [0, 0, 0], upperArm_R: [115.003, 0, 27.444], foreArm_R: [148.046, 0, 0], hand_R: [0, 0, -35.185], upperArm_L: [49.259, 0, 21.111], foreArm_L: [105.556, 0, 0] },
  alarmed: { spine: [0, 0, 0], chest: [0, 0, 0], head: [0, 0, 0], upperArm_R: [91.772, 0, 35.185], foreArm_R: [236.546, 0, 0], hand_R: [-42.222, 0, -35.185], upperArm_L: [91.772, 0, -35.185], foreArm_L: [236.546, 0, 0], hand_L: [-42.222, 0, 35.185] },
  pained: { spine: [0, 0, 0], chest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0], upperArm_L: [42.222, 0, 14.074], foreArm_L: [309.63, 0, 0], hand_L: [0, 0, -35.185], upperArm_R: [28.148, 0, 21.111], foreArm_R: [84.444, 0, 0] },
  dread: { spine: [0, 0, 0], chest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0], upperArm_R: [56.296, 0, -7.037], foreArm_R: [254.456, 0, 0], upperArm_L: [56.296, 0, 7.037], foreArm_L: [254.456, 0, 0] },
  scream: { spine: [0, 0, 0], chest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0], upperArm_R: [105.556, 0, 140.741], foreArm_R: [175.926, 0, 0], hand_R: [0, 0, -70.37], upperArm_L: [105.556, 0, -140.741], foreArm_L: [175.926, 0, 0], hand_L: [0, 0, 70.37] },
};

test('heightened lines keep their whole-arm gestures exactly as before', () => {
  for (const e of HEIGHTENED) {
    assert.equal(ACTING[e].forearmOnly, false, `${e} is not forearm-only`);
    const plan = planSpeech('We have to go, now. Come on!', e, 3, `line-${e}`);
    const rec: Record<string, number[]> = {};
    for (const t of [0.1, 0.7, 1.6, 2.8]) {
      gesture(plan, t, 1, 1, (j, x, y, z) => {
        const r = (rec[j] ??= [0, 0, 0]);
        r[0]! += x;
        r[1]! += y;
        r[2]! += z;
      });
    }
    const round = Object.fromEntries(Object.entries(rec).map(([j, v]) => [j, v.map((n) => Math.round(n * 1000) / 1000 + 0)]));
    assert.deepEqual(round, HEIGHTENED_BEFORE[e], e);
  }
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

// ---------------------------------------------------------------- a kill victim's scream (voss-death-scene D11)

const RATE = 8000;
/** The scream style's widest jaw (degrees). */
const WIDEST = ACTING.scream.jaw;

/** A made-up recorded scream: `[seconds, amplitude]` stretches of a tone. */
function recording(...parts: Array<[number, number]>) {
  const out: number[] = [];
  for (const [s, amp] of parts) for (let i = 0; i < Math.round(s * RATE); i++) out.push(amp * Math.sin((2 * Math.PI * 400 * out.length) / RATE));
  return loudnessEnvelope(Float32Array.from(out), RATE);
}

/** Loud, a breath a tenth as loud, loud again, then half as loud. */
const SCREAM = recording([1, 0.8], [0.4, 0.08], [1, 0.8], [0.8, 0.4]);

const degrees = (from: number, to: number, f: (t: number) => number, step = 1 / 240): number[] =>
  Array.from({ length: Math.floor((to - from) / step) }, (_, i) => f(from + i * step));

test('infection-kills "Peak of the scream": at its loudest the jaw is at least 80% of its widest and trembles at 20 Hz', () => {
  const jaw = degrees(0.3, 0.8, (t) => screamJawAt(SCREAM, t));
  assert.ok(Math.min(...jaw) >= 0.8 * WIDEST, `least ${Math.min(...jaw)} deg of ${WIDEST}`);
  const around = jaw.map((d) => d - WIDEST);
  assert.ok(Math.max(...around) > 1.5 && Math.min(...around) < -1.5, 'it shakes both ways');
  assert.ok(Math.max(...around.map(Math.abs)) <= SCREAM_TREMBLE.deg + 1e-6, 'by no more than 2 deg');
  const crossings = around.filter((d, i) => i > 0 && d >= 0 !== around[i - 1]! >= 0).length;
  assert.ok(Math.abs(crossings - 20) <= 1, `${crossings} crossings in 0.5 s is 20 Hz`);
});

test('infection-kills "A breath in the scream": the jaw is under 30% of its widest within 0.1 s and stays there', () => {
  // Just under the spec's fifth of the peak, the shallowest breath that counts, and a near-silent one.
  for (const breath of [0.19, 0.01]) {
    const env = recording([1, 0.8], [0.4, 0.8 * breath], [1, 0.8]);
    const jaw = degrees(1.1, 1.39, (t) => screamJawAt(env, t));
    assert.ok(Math.max(...jaw) < 0.3 * WIDEST, `breath at ${breath}: ${Math.max(...jaw)} deg`);
    assert.ok(screamJawAt(env, 1.7) > 0.8 * WIDEST, 'and opens again');
  }
});

test('a quieter scream opens the jaw less, without a tremble', () => {
  const jaw = degrees(2.8, 3.1, (t) => screamJawAt(SCREAM, t));
  for (const d of jaw) assert.ok(Math.abs(d - 0.5 * WIDEST) < 1, `half as loud, half open: ${d}`);
});

/**
 * Voss in her kill, convulsing in the pose that holds her mouth open at the glass, saying a line: her jaw's opening in
 * degrees every 1/60 s. `screamJaw` is the kill style's flag; null for a body in no kill.
 */
function jawWhileSaying(opts: { screamJaw: boolean | null; loudness?: boolean; emote?: 'scream' | 'urgent'; silent?: boolean; stopAt?: number }) {
  const h = new Humanoid({ seed: 'victim', outfit: 'crew', role: 'npc' }, ctx());
  for (let i = 0; i < 30; i++) h.update(1 / 60);
  const shut = h.bones.jaw.quaternion.clone();
  if (opts.screamJaw !== null) {
    h.beginKill();
    h.setKillScreamJaw(opts.screamJaw);
    h.setPose('kill_glass_0', 0.01);
    h.killConvulse(0.5, 20);
  }
  for (let i = 0; i < 30; i++) h.update(1 / 60);
  if (!opts.silent) h.speak('[screaming]', opts.emote ?? 'scream', 3.3, 'drop_voss_02', opts.loudness === false ? undefined : SCREAM);
  const out: number[] = [];
  for (let i = 1; i <= 240; i++) {
    if (opts.stopAt !== undefined && i === Math.round(opts.stopAt * 60)) h.stopSpeaking();
    h.update(1 / 60);
    out.push(THREE.MathUtils.radToDeg(h.bones.jaw.quaternion.angleTo(shut)));
  }
  h.dispose();
  return (from: number, to: number) => out.slice(Math.round(from * 60), Math.round(to * 60));
}

test('a screaming kill victim\'s jaw follows the recording over the pose and the convulsion, and hands back when it ends', () => {
  const jaw = jawWhileSaying({ screamJaw: true });
  assert.ok(Math.min(...jaw(0.3, 0.9)) >= 0.8 * WIDEST, `loud: ${Math.min(...jaw(0.3, 0.9))} deg`);
  assert.ok(Math.max(...jaw(0.3, 0.9)) <= WIDEST + SCREAM_TREMBLE.deg + 0.5, 'no wider than the scream: the pose\'s open mouth is replaced');
  assert.ok(Math.max(...jaw(1.1, 1.39)) < 0.3 * WIDEST, `breath: ${Math.max(...jaw(1.1, 1.39))} deg`);
  assert.ok(Math.min(...jaw(1.55, 2.3)) >= 0.8 * WIDEST, 'open again');
  // The recording is 3.2 s long: after it her mouth is the pose's again, as she convulses.
  const posed = jawWhileSaying({ screamJaw: true, silent: true });
  assert.deepEqual(jaw(3.8, 4), posed(3.8, 4));
});

test('a cut scream hands the jaw straight back to the pose', () => {
  const jaw = jawWhileSaying({ screamJaw: true, stopAt: 1.2 });
  const posed = jawWhileSaying({ screamJaw: true, silent: true });
  jaw(1.7, 2.3).forEach((d, i) => assert.ok(Math.abs(d - posed(1.7, 2.3)[i]!) < 0.5, `frame ${i}: ${d}`));
});

test('infection-kills "No recording": the beat\'s poses hold her scream open as usual', () => {
  const jaw = jawWhileSaying({ screamJaw: true, loudness: false });
  assert.deepEqual(jaw(0, 4), jawWhileSaying({ screamJaw: true, silent: true })(0, 4));
  // The pose opens 32 deg and the convulsion shakes it either way: never near shut.
  assert.ok(Math.min(...jaw(0.3, 2.5)) > 20, `held open: ${Math.min(...jaw(0.3, 2.5))} deg`);
});

test('other screams are unchanged: another kill\'s victim, a body in no kill, and a kill victim\'s other lines', () => {
  for (const screamJaw of [false, null]) {
    assert.deepEqual(jawWhileSaying({ screamJaw })(0, 4), jawWhileSaying({ screamJaw, loudness: false })(0, 4), `screamJaw ${screamJaw}`);
  }
  const urgent = { screamJaw: true, emote: 'urgent' } as const;
  assert.deepEqual(jawWhileSaying(urgent)(0, 4), jawWhileSaying({ ...urgent, loudness: false })(0, 4));
});

test('only the Lab B kill screams with the jaw: the R08 and stinger kills keep their screams', () => {
  const table = validate(validateKillTable, JSON.parse(readFileSync(new URL('../data/kills.json', import.meta.url), 'utf8')), 'kills');
  assert.deepEqual(Object.entries(table).filter(([, style]) => style.screamJaw).map(([id]) => id), ['grownInside']);
});

test('the dead and the infected do not talk', () => {
  const infected = new Humanoid({ seed: 'zed', outfit: 'crew', role: 'enemy', infection: 2 }, ctx());
  infected.speak('Hello there', 'neutral', 2);
  assert.equal(infected.speaking, false);
  infected.dispose();
});
