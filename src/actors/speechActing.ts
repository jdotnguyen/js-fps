import type { Emote } from '../data/types/dialogue.ts';
import type { JointName } from './skeleton.ts';

/**
 * Speech acting (ADR-0027): what a body does while it talks. Pure data and maths (no three.js), so it runs in node tests.
 *
 * Voices are non-verbal emote sounds under a subtitle (ADR-0010), so the *line* carries the performance: the subtitle text sets
 * the rhythm of the mouth (one jaw pulse per syllable, pauses at spaces and punctuation) and the emote sets how big the jaw
 * opens and which gestures the hands and body make. Everything is a few seconds of additive joint rotations in degrees that
 * the animator layers on whatever pose the body is in.
 */

/** One syllable of mouth movement: the jaw opens and closes between `start` and `end` (seconds). */
export interface MouthCue {
  start: number;
  end: number;
  /** 0..1 how wide this syllable opens (vowel shape, accent). */
  open: number;
}

/** Stable 0..1 hash of a string and an index, so a line always moves the same way. */
export function hash01(s: string, k = 0): number {
  let h = 2166136261 ^ k;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** How wide each vowel opens the jaw (a and o widest, i and e narrow). */
const VOWEL_OPEN: Record<string, number> = { a: 1, o: 0.9, u: 0.6, e: 0.7, i: 0.5, y: 0.5 };

/** A word's syllables: its vowel groups, at least one. Returns the vowel of each. */
function syllablesOf(word: string): string[] {
  const groups = word.toLowerCase().match(/[aeiouy]+/g) ?? [];
  // A silent trailing "e" ("take", "cover") is not a syllable of its own.
  if (groups.length > 1 && /[^aeiouy]e[sd]?$/.test(word.toLowerCase()) && groups[groups.length - 1]!.length === 1) groups.pop();
  if (groups.length === 0) return ['u'];
  return groups.map((g) => g[0]!);
}

/**
 * The mouth plan for a line: a syllable timeline spread over `duration` seconds, leaving a short closing beat at the end.
 * `laugh` becomes a run of "ha"s and `scream` one long open mouth.
 */
export function mouthCues(text: string, duration: number, emote: Emote | null, seed = text): MouthCue[] {
  const talk = Math.max(0.25, duration - 0.3);
  if (emote === 'laugh') {
    const cues: MouthCue[] = [];
    const period = 0.2;
    for (let t = 0; t + period * 0.8 <= talk; t += period) cues.push({ start: t, end: t + period * 0.8, open: 0.75 + 0.25 * hash01(seed, cues.length) });
    return cues;
  }
  if (emote === 'scream') return [{ start: 0, end: talk, open: 1 }];

  type Unit = { open: number; weight: number; gap: number };
  const units: Unit[] = [];
  const words = text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  words.forEach((word, wi) => {
    const syl = syllablesOf(word.replace(/[^a-z']/gi, ''));
    syl.forEach((v, si) => {
      // The first syllable of a word is stressed a little; the odd syllable is lazier, so no two words move alike.
      const stress = si === 0 ? 1 : 0.82;
      const jitter = 0.85 + 0.3 * hash01(seed, wi * 17 + si);
      units.push({ open: Math.min(1, (VOWEL_OPEN[v] ?? 0.7) * stress * jitter), weight: 1, gap: 0 });
    });
    const last = units[units.length - 1]!;
    last.gap = /[.!?…]$/.test(word) ? 1.5 : /[,;:—-]$/.test(word) ? 0.8 : 0.3;
  });
  if (units.length === 0) return [];
  let total = 0;
  for (const u of units) total += u.weight + u.gap;
  const unit = talk / total;
  const cues: MouthCue[] = [];
  let t = 0;
  for (const u of units) {
    // A syllable fills most of its slot, leaving a gap so the jaw visibly closes between them.
    cues.push({ start: t, end: t + unit * u.weight * 0.92, open: u.open });
    t += unit * (u.weight + u.gap);
  }
  return cues;
}

/** Jaw opening 0..1 at time `t` of the plan: each cue is a raised-cosine pulse, overlapping cues take the larger. */
export function mouthOpenAt(cues: readonly MouthCue[], t: number): number {
  let open = 0;
  for (const c of cues) {
    if (t < c.start) break;
    if (t > c.end) continue;
    const p = (t - c.start) / Math.max(1e-4, c.end - c.start);
    open = Math.max(open, c.open * (0.5 - 0.5 * Math.cos(2 * Math.PI * p)));
  }
  return open;
}

// ---------------------------------------------------------------- gestures

/**
 * Joints a gesture moves. `_P` is the primary (gesturing) arm and `_S` the other one; the animator maps them onto left and
 * right, mirroring the sideways and twist angles. Rotations are XYZ degrees on the game's conventions (skeleton.ts): +x swings
 * an arm forward and bends an elbow, -x nods the head forward, -x opens the jaw, +z raises a right arm sideways.
 */
export type GestureJoint = 'pelvis' | 'spine' | 'chest' | 'neck' | 'head' | 'upperArm_P' | 'foreArm_P' | 'hand_P' | 'upperArm_S' | 'foreArm_S' | 'hand_S';
export type GesturePose = Partial<Record<GestureJoint, readonly [number, number, number]>>;

export interface ActingStyle {
  /** Peak jaw opening in degrees at a full syllable. */
  jaw: number;
  /** Held while speaking (faded in and out). */
  hold: GesturePose;
  /** Added on each gesture beat. */
  beat: GesturePose;
  /** Beats per second, and how sharp each one is (higher = a quicker stab with a longer rest). */
  beatHz: number;
  beatSharp: number;
  /** Decaying jolt at the start of the line. */
  kick: GesturePose;
  /** High-frequency shake in degrees (fear, pain, a scream). */
  tremor: number;
  /** Torso and head bounce in degrees at the laugh rate. */
  bounce: number;
  /** True when both arms do the same thing (fright, a scream); otherwise only the primary arm gestures. */
  both: boolean;
  /** Head roll direction is random per line for the tilted emotes. */
  tilt: boolean;
}

const BASE: Omit<ActingStyle, 'jaw' | 'hold' | 'beat' | 'beatHz' | 'beatSharp'> = { kick: {}, tremor: 0, bounce: 0, both: false, tilt: false };

export const ACTING: Readonly<Record<Emote, ActingStyle>> = {
  // A statement: loose, conversational. One hand rises to waist height and beats softly; the head nods on the stresses.
  neutral: {
    ...BASE, jaw: 11, beatHz: 0.9, beatSharp: 1.5,
    hold: { spine: [-1, 0, 0], head: [-1, 0, 0], upperArm_P: [10, 0, 4], foreArm_P: [34, 0, 0], hand_P: [0, 0, -8], upperArm_S: [3, 0, -3], foreArm_S: [14, 0, 0] },
    beat: { upperArm_P: [10, 0, 2], foreArm_P: [14, 0, 0], hand_P: [-8, 0, 0], head: [-2, 0, 0], chest: [-0.8, 0, 0] },
  },
  // A question: head cocked, one palm turned up and offered, a small lift on the rising end.
  question: {
    ...BASE, jaw: 9, beatHz: 0.7, beatSharp: 1.2, tilt: true,
    hold: { head: [-1, 0, 6], neck: [0, 0, 3], upperArm_P: [16, 0, 10], foreArm_P: [58, 0, 0], hand_P: [-15, 0, -25], upperArm_S: [4, 0, -3], foreArm_S: [16, 0, 0] },
    beat: { upperArm_P: [8, 0, 2], foreArm_P: [10, 0, 0], hand_P: [-10, 0, -6], head: [2, 0, 2] },
    kick: { head: [-3, 0, 3] },
  },
  // A command: leaning in, sharp chops and points, the whole upper body behind each word.
  urgent: {
    ...BASE, jaw: 16, beatHz: 1.8, beatSharp: 3,
    hold: { spine: [-5, 0, 0], chest: [-3, 0, 0], head: [-4, 0, 0], upperArm_P: [28, 0, 8], foreArm_P: [38, 0, 0], hand_P: [0, 0, -10], upperArm_S: [14, 0, -6], foreArm_S: [30, 0, 0] },
    beat: { upperArm_P: [26, 0, -2], foreArm_P: [22, 0, 0], spine: [-3, 0, 0], head: [-3, 0, 0] },
    kick: { spine: [-6, 0, 0], head: [-6, 0, 0], upperArm_P: [20, 0, 0], foreArm_P: [18, 0, 0] },
  },
  // Spotting something: flinch back, both hands come up in front of the chest, head thrown up and back.
  alarmed: {
    ...BASE, jaw: 18, beatHz: 2.2, beatSharp: 2, both: true, tremor: 0.6,
    hold: { spine: [4, 0, 0], chest: [3, 0, 0], head: [6, 0, 0], upperArm_P: [24, 0, 10], foreArm_P: [64, 0, 0], hand_P: [-12, 0, -10], upperArm_S: [24, 0, 10], foreArm_S: [64, 0, 0], hand_S: [-12, 0, -10] },
    beat: { foreArm_P: [6, 0, 0], foreArm_S: [6, 0, 0], head: [-2, 0, 0] },
    kick: { spine: [8, 0, 0], head: [10, 0, 0], upperArm_P: [20, 0, 0], upperArm_S: [20, 0, 0] },
  },
  // Hurt: folded over, one hand clamped to the ribs, shaking.
  pained: {
    ...BASE, jaw: 9, beatHz: 0.7, beatSharp: 1.5, tremor: 0.8,
    hold: { spine: [-9, 0, 2], chest: [-5, 0, 0], neck: [-3, 0, 0], head: [-8, 0, -5], upperArm_P: [12, 0, -4], foreArm_P: [88, 0, 0], hand_P: [0, 0, 10], upperArm_S: [8, 0, 6], foreArm_S: [24, 0, 0] },
    beat: { spine: [-2, 0, 0], head: [-1, 0, 0], chest: [-1.5, 0, 0] },
    kick: { spine: [-6, 0, 0], head: [-5, 0, 0] },
  },
  // Letting go: a sigh, shoulders and head drop, hands loose and a little open.
  relieved: {
    ...BASE, jaw: 10, beatHz: 0.55, beatSharp: 1, both: true,
    hold: { spine: [2, 0, 0], chest: [3, 0, 0], head: [-3, 0, 0], upperArm_P: [8, 0, 6], foreArm_P: [30, 0, 0], upperArm_S: [6, 0, 6], foreArm_S: [24, 0, 0] },
    beat: { chest: [-3, 0, 0], upperArm_P: [6, 0, 0], upperArm_S: [6, 0, 0], head: [-2, 0, 0] },
    kick: { head: [-5, 0, 0], chest: [4, 0, 0] },
  },
  // Laughing: shoulders and chest bounce, head back, one hand goes to the belly.
  laugh: {
    ...BASE, jaw: 14, beatHz: 4.6, beatSharp: 1, bounce: 3.2,
    hold: { head: [5, 0, 0], chest: [1, 0, 0], upperArm_P: [20, 0, -6], foreArm_P: [92, 0, 0], upperArm_S: [8, 0, -4], foreArm_S: [30, 0, 0] },
    beat: { chest: [-1, 0, 0] },
    kick: { head: [4, 0, 0] },
  },
  // Hushed: leaning in close, head bowed toward the listener, a hand up by the mouth.
  whisper: {
    ...BASE, jaw: 4, beatHz: 0.6, beatSharp: 1,
    hold: { spine: [-4, 0, 0], chest: [-3, 0, 0], neck: [-3, 0, 0], head: [-5, 0, -4], upperArm_P: [20, 0, 0], foreArm_P: [96, 0, 0], hand_P: [-10, 0, 0], upperArm_S: [2, 0, -3], foreArm_S: [10, 0, 0] },
    beat: { head: [-1, 0, 0] },
  },
  // Dread: shrunk in on itself, arms drawn to the chest, trembling.
  dread: {
    ...BASE, jaw: 7, beatHz: 0.5, beatSharp: 1, both: true, tremor: 1,
    hold: { spine: [-6, 0, 0], chest: [-4, 0, 0], neck: [-4, 0, 0], head: [-6, 0, 0], upperArm_P: [16, 0, -2], foreArm_P: [70, 0, 0], upperArm_S: [16, 0, -2], foreArm_S: [70, 0, 0] },
    beat: { chest: [-1, 0, 0], foreArm_P: [4, 0, 0], foreArm_S: [4, 0, 0] },
  },
  // A scream: arched back, head thrown back, arms flung wide.
  scream: {
    ...BASE, jaw: 28, beatHz: 2.5, beatSharp: 2, both: true, tremor: 1.2,
    hold: { spine: [6, 0, 0], chest: [6, 0, 0], neck: [3, 0, 0], head: [12, 0, 0], upperArm_P: [30, 0, 40], foreArm_P: [50, 0, 0], hand_P: [0, 0, -20], upperArm_S: [30, 0, 40], foreArm_S: [50, 0, 0], hand_S: [0, 0, -20] },
    beat: { head: [-3, 0, 0], chest: [-3, 0, 0] },
    kick: { head: [14, 0, 0], spine: [8, 0, 0] },
  },
};

/** The style for a line: an unknown or missing emote talks like `neutral`. */
export function actingFor(emote: string | null | undefined): ActingStyle {
  return (emote && (ACTING as Record<string, ActingStyle>)[emote]) || ACTING.neutral;
}

/** A line being acted: everything the animator needs, computed once when the line starts. */
export interface SpeechPlan {
  emote: Emote | null;
  style: ActingStyle;
  cues: MouthCue[];
  /** Seconds the line lasts. */
  duration: number;
  /** 0 = the right arm gestures, 1 = the left (the speaker's handedness for this line). */
  side: 0 | 1;
  /** +1 or -1: which way a tilted head leans. */
  tilt: 1 | -1;
  seed: string;
}

export function planSpeech(text: string, emote: Emote | null, duration: number, seed: string): SpeechPlan {
  return {
    emote,
    style: actingFor(emote),
    cues: mouthCues(text, duration, emote, seed),
    duration,
    side: hash01(seed, 91) < 0.7 ? 0 : 1,
    tilt: hash01(seed, 92) < 0.5 ? 1 : -1,
    seed,
  };
}

const smooth01 = (x: number): number => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};

/**
 * Receives each gesture rotation as (joint, x, y, z degrees). Arm joints arrive already resolved to a real side.
 */
export type GestureSink = (joint: JointName, x: number, y: number, z: number) => void;

/**
 * The gesture layer at time `t` of the plan, weighted by `w` (0..1; the animator fades it in and out). `armsK` scales the arms
 * only (a body that is walking or using its hands gestures less).
 */
export function gesture(plan: SpeechPlan, t: number, w: number, armsK: number, out: GestureSink): void {
  if (w <= 1e-4) return;
  const s = plan.style;
  // Beats: a stab every 1/beatHz seconds with its own strength, alternating between the primary hand and (sometimes) both.
  const p = t * s.beatHz + hash01(plan.seed, 5);
  const idx = Math.floor(p);
  const frac = p - idx;
  const strength = 0.55 + 0.45 * hash01(plan.seed, 100 + idx);
  const pulse = Math.pow(Math.sin(Math.PI * frac), s.beatSharp) * strength;
  // The kick dies away in a quarter of a second.
  const kick = Math.exp(-t / 0.25);
  // The line settles near its end: gestures shrink on the last stretch.
  const settle = 0.35 + 0.65 * smooth01((plan.duration - t) / 0.6);
  const primary = plan.side === 0 ? 'R' : 'L';
  const secondary = plan.side === 0 ? 'L' : 'R';
  const sign = (side: 'L' | 'R') => (side === 'R' ? 1 : -1);
  const put = (joint: GestureJoint, v: readonly [number, number, number], k: number): void => {
    const [x, y, z] = v;
    if (joint.endsWith('_P') || joint.endsWith('_S')) {
      const side = joint.endsWith('_P') ? primary : secondary;
      const name = `${joint.slice(0, -2)}_${side}` as JointName;
      // Secondary arm: only gestures when the style uses both arms; otherwise it keeps its hold only, scaled down.
      out(name, x * k * armsK, y * k * armsK * sign(side), z * k * armsK * sign(side));
    } else {
      // The tilt of a cocked head leans a random way per line.
      out(joint as JointName, x * k, y * k, z * k * (s.tilt && (joint === 'head' || joint === 'neck') ? plan.tilt : 1));
    }
  };
  for (const [joint, v] of Object.entries(s.hold) as Array<[GestureJoint, readonly [number, number, number]]>) put(joint, v, w * settle);
  const beatK = w * pulse * settle;
  for (const [joint, v] of Object.entries(s.beat) as Array<[GestureJoint, readonly [number, number, number]]>) {
    // Without `both`, the other arm sits still between its hold values: its beat is a quarter strength.
    const k = joint.endsWith('_S') && !s.both ? beatK * 0.25 : beatK;
    put(joint, v, k);
  }
  for (const [joint, v] of Object.entries(s.kick) as Array<[GestureJoint, readonly [number, number, number]]>) put(joint, v, w * kick);
  if (s.tremor > 0) {
    const a = s.tremor * w;
    const f = t * 31 + hash01(plan.seed, 7) * 10;
    out('head', Math.sin(f) * a, Math.sin(f * 1.31 + 1) * a * 0.7, Math.sin(f * 0.83 + 2) * a * 0.5);
    out('chest', Math.sin(f * 1.1 + 3) * a * 0.4, 0, 0);
    if (armsK > 0.01) {
      out(`foreArm_${primary}` as JointName, Math.sin(f * 0.9 + 4) * a * 1.6 * armsK, 0, 0);
      out(`foreArm_${secondary}` as JointName, Math.sin(f * 1.2 + 5) * a * 1.6 * armsK, 0, 0);
    }
  }
  if (s.bounce > 0) {
    const f = Math.sin(t * Math.PI * 2 * s.beatHz) * s.bounce * w;
    out('chest', -Math.abs(f) * 0.6, 0, 0);
    out('head', -Math.abs(f) * 0.8, 0, 0);
    out('pelvis', 0, 0, f * 0.15);
  }
}
