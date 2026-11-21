import profilesJson from '../data/motion-profiles.json' with { type: 'json' };
import { ValidationError, numRange, obj, oneOf, optional, record, str, validate, type Validator } from '../core/validate.ts';
import type { MocapLibrary, MotionSet } from './mocap.ts';

/**
 * Motion profiles (per-character-motion change, character-motion spec): what each character plays for every activity, what idle
 * life it layers under authored poses, and its style values. Named characters have their own profile; everyone else uses the
 * masculine or feminine crew default. Every character still runs on the shared 21-joint skeleton.
 *
 * Resolution for each activity: the character's profile (and the profiles it inherits), then its gendered default, then the
 * built-in neutral clip. A clip id the library lacks falls through, with one warning per id.
 */

/** Things a character can be asked to do (the "slots"). Add to this list when a level or sequence needs a new one. */
export const ACTIVITIES = ['idle', 'talk', 'walk', 'jog', 'turnL', 'turnR', 'kneel', 'crouch', 'aimPistol', 'wave', 'point', 'drink', 'work'] as const;
export type Activity = (typeof ACTIVITIES)[number];

/** Authored-pose families that share one idle-life hold (`lean_back_glance` is in `lean_back`). */
export const POSTURE_FAMILIES = ['stand', 'sit_chair', 'sit_stool', 'sit_sofa', 'lean_wall', 'lean_back', 'lean_counter', 'kneel', 'crouch'] as const;
export type PostureFamily = (typeof POSTURE_FAMILIES)[number];

export type Gender = 'm' | 'f';

/** How a character moves where no clip of its own says otherwise. Every value is a multiplier or offset on the neutral motion. */
export interface MotionStyle {
  /** Playback rate of idle and hold clips, and of procedural idle life (1 = neutral). */
  tempo: number;
  /** Rate of idle fidgets and weight shifts (1 = neutral). */
  fidgetRate: number;
  /** Arm swing while walking (1 = neutral). */
  armSwing: number;
  /** Arms held closer (<1) or more open (>1) at rest. */
  armCarry: number;
  /** Head pitch offset in degrees (+ = down). */
  headPitch: number;
  /** Upright (>0) or slumped (<0) chest, -1..1. */
  posture: number;
  /** Left/right asymmetry in idle life, 0..1. */
  asymmetry: number;
}

export const NEUTRAL_STYLE: Readonly<MotionStyle> = { tempo: 1, fidgetRate: 1, armSwing: 1, armCarry: 1, headPitch: 0, posture: 0, asymmetry: 0 };

/** Built-in neutral clips: the bottom of every resolution chain. */
export const NEUTRAL_CLIPS: Readonly<Record<Activity, string>> = {
  idle: 'idle',
  talk: 'idle_talk',
  walk: 'walk',
  jog: 'jog',
  turnL: 'walk',
  turnR: 'walk',
  kneel: 'kneel_fix',
  crouch: 'crouch_idle',
  aimPistol: 'pistol_idle',
  wave: 'idle_talk',
  point: 'idle_talk',
  drink: 'idle',
  work: 'kneel_fix',
};

/** When a scene variant applies: every condition given must hold. */
export interface VariantCondition {
  /** A sequence (src/data/sequences/<id>.json) is running (any of them, for a list). */
  sequence?: string | string[];
  /** The character is doing this squad task (any of them, for a list). */
  task?: string | string[];
  /** This story flag is set (truthy). */
  flag?: string;
  /** Infection stage within [min, max] (4 = the reveal). */
  stage?: [number, number];
}

/** Extra motion a scene, task or story state gives a character, layered over its everyday profile while it applies. */
export interface MotionVariant {
  when: VariantCondition;
  clips?: Partial<Record<Activity, string>>;
  holds?: Partial<Record<PostureFamily, string>>;
  style?: Partial<MotionStyle>;
  /** Authored poses this character plays in place of the ones a sequence asks for (`offer_mug` -> `bram_offer_mug`). */
  poses?: Record<string, string>;
}

/** How a character's hands move (the hand solver's personality, handPhysics.ts). */
export interface HandStyle {
  /** 0..1 baseline tension (tighter grip, snappier curls, slight tremor). */
  tension: number;
  /** Spring frequency multiplier (~0.75 loose .. 1.35 crisp). */
  stiffness: number;
  /** 0..1 finger micro-fidget while idle or talking. */
  fidget: number;
  /** 0..1 resting curl tightness. */
  restCurl: number;
  /** 0..1 involuntary finger twitch, scaled by the infection stage (Giles). */
  twitch?: number;
}

export interface MotionProfile {
  gender: Gender;
  inherits?: string;
  /** The character's own hands (character-motion; imported-body-models: every named character's hands move in their own way). */
  hands?: HandStyle;
  clips?: Partial<Record<Activity, string>>;
  holds?: Partial<Record<PostureFamily, string>>;
  style?: Partial<MotionStyle>;
  /**
   * The character's own versions of authored poses, used wherever a script, sequence or idle life asks for the shared one
   * (Okafor's steady `glance` -> `okafor_glance`). Scene variants can add more.
   */
  poses?: Record<string, string>;
  /** Scene variants, applied in declaration order (later ones win). */
  variants?: Record<string, MotionVariant>;
}

/** What the scene looks like to a character (see motionScene.ts). */
export interface SceneState {
  sequences: ReadonlySet<string>;
  task: string | null;
  stage: number;
  flag: (name: string) => boolean;
}

/** The ids a `sequence` or `task` condition names. */
export function conditionIds(v: string | string[] | undefined): readonly string[] | undefined {
  return v === undefined ? undefined : typeof v === 'string' ? [v] : v;
}

export function variantApplies(w: VariantCondition, s: SceneState): boolean {
  const seqs = conditionIds(w.sequence);
  const tasks = conditionIds(w.task);
  if (seqs && !seqs.some((id) => s.sequences.has(id))) return false;
  if (tasks && (s.task === null || !tasks.includes(s.task))) return false;
  if (w.flag !== undefined && !s.flag(w.flag)) return false;
  if (w.stage !== undefined && (s.stage < w.stage[0] || s.stage > w.stage[1])) return false;
  return true;
}

export interface MotionProfileFile {
  /** Default profile id per gender. */
  defaults: Record<Gender, string>;
  profiles: Record<string, MotionProfile>;
}

function keyedBy<K extends string, T>(keys: readonly K[], value: Validator<T>, what: string): Validator<Partial<Record<K, T>>> {
  const rec = record(value);
  return (v, p) => {
    const out = rec(v, p);
    for (const k of Object.keys(out)) {
      if (!(keys as readonly string[]).includes(k)) throw new ValidationError(`${p} > ${k}`, `unknown ${what} "${k}", expected one of: ${keys.join(', ')}`);
    }
    return out as Partial<Record<K, T>>;
  };
}

const gender = oneOf(['m', 'f'] as const);

const styleShape = {
  tempo: optional(numRange(0.5, 2)),
  fidgetRate: optional(numRange(0, 4)),
  armSwing: optional(numRange(0, 3)),
  armCarry: optional(numRange(0.3, 2)),
  headPitch: optional(numRange(-30, 30)),
  posture: optional(numRange(-1, 1)),
  asymmetry: optional(numRange(0, 1)),
};

const stageRange: Validator<[number, number]> = (v, p) => {
  if (!Array.isArray(v) || v.length !== 2 || v.some((x) => typeof x !== 'number')) throw new ValidationError(p, 'expected [min, max]');
  return [v[0] as number, v[1] as number];
};

const idOrIds: Validator<string | string[]> = (v, p) => {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string')) return v as string[];
  throw new ValidationError(p, 'expected an id or a non-empty list of ids');
};

const variantShape = obj({
  when: obj({ sequence: optional(idOrIds), task: optional(idOrIds), flag: optional(str), stage: optional(stageRange) }),
  clips: optional(keyedBy(ACTIVITIES, str, 'activity')),
  holds: optional(keyedBy(POSTURE_FAMILIES, str, 'posture family')),
  style: optional(obj(styleShape)),
  poses: optional(record(str)),
});

const profileShape = obj({
  gender,
  inherits: optional(str),
  clips: optional(keyedBy(ACTIVITIES, str, 'activity')),
  holds: optional(keyedBy(POSTURE_FAMILIES, str, 'posture family')),
  style: optional(obj(styleShape)),
  variants: optional(record(variantShape)),
  poses: optional(record(str)),
  hands: optional(
    obj({ tension: numRange(0, 1), stiffness: numRange(0.6, 1.5), fidget: numRange(0, 1), restCurl: numRange(0, 1), twitch: optional(numRange(0, 1)) }),
  ),
});

const fileShape = obj({ defaults: obj({ m: str, f: str }), profiles: record(profileShape) });

/** Validate a profile table: shapes, known activities and families, `inherits` and defaults that exist, no inheritance loops. */
export const validateMotionProfiles: Validator<MotionProfileFile> = (v, p) => {
  const file = fileShape(v, p) as MotionProfileFile;
  for (const g of ['m', 'f'] as const) {
    const id = file.defaults[g];
    const prof = file.profiles[id];
    if (!prof) throw new ValidationError(`${p} > defaults > ${g}`, `unknown profile "${id}"`);
    if (prof.gender !== g) throw new ValidationError(`${p} > defaults > ${g}`, `profile "${id}" has gender "${prof.gender}"`);
  }
  for (const [id, prof] of Object.entries(file.profiles)) {
    const seen = new Set([id]);
    let cur = prof;
    while (cur.inherits) {
      const parent = file.profiles[cur.inherits];
      if (!parent) throw new ValidationError(`${p} > profiles > ${id} > inherits`, `unknown profile "${cur.inherits}"`);
      if (seen.has(cur.inherits)) throw new ValidationError(`${p} > profiles > ${id} > inherits`, `inheritance loop through "${cur.inherits}"`);
      seen.add(cur.inherits);
      cur = parent;
    }
  }
  return file;
};

let shared: MotionProfileFile | null = null;

/** The game's profile table (src/data/motion-profiles.json), validated once. */
export function sharedMotionProfiles(): MotionProfileFile {
  if (!shared) shared = validate(validateMotionProfiles, profilesJson, 'data/motion-profiles.json');
  return shared;
}

/** A profile resolved against the clip library: every activity has a clip the library has. */
export interface ResolvedMotion {
  /** The character's profile id, or the gendered default's id. */
  profile: string;
  gender: Gender;
  clips: Record<Activity, string>;
  holds: Partial<Record<PostureFamily, string>>;
  style: MotionStyle;
  /** True when the character's own profile (not a default) names clips of its own: its procedural arm layers are turned down. */
  ownClips: boolean;
  /** True when the body uses a gendered crew default (no named profile): it gets seeded per-body variation. */
  isDefault: boolean;
  /** Ids of the scene variants in effect. */
  variants: string[];
  /** Authored-pose replacements from the variants in effect. */
  poses: Record<string, string>;
  /** The character's own hands, or null for seeded crew hands. */
  hands: HandStyle | null;
}

const warned = new Set<string>();

function warnOnce(id: string, msg: string): void {
  if (warned.has(id)) return;
  warned.add(id);
  console.warn(msg);
}

/** Chain of profiles from `id` up through `inherits`, then the gendered default chain (most specific first, no repeats). */
function chain(file: MotionProfileFile, id: string | undefined, g: Gender): { id: string; prof: MotionProfile }[] {
  const out: { id: string; prof: MotionProfile }[] = [];
  const push = (start: string | undefined): void => {
    let cur = start;
    while (cur && !out.some((e) => e.id === cur)) {
      const prof = file.profiles[cur];
      if (!prof) break;
      out.push({ id: cur, prof });
      cur = prof.inherits;
    }
  };
  push(id);
  push(file.defaults[g]);
  return out;
}

/**
 * Resolve the motion for one body. `id` is the character's profile (named characters), `g` its body's gender. `formal` gives
 * generic crew the composed walk (medic outfits) where no profile in the chain names a walk of its own.
 */
export function resolveProfile(
  lib: MocapLibrary,
  file: MotionProfileFile,
  id: string | undefined,
  g: Gender,
  formal = false,
  scene?: SceneState,
): ResolvedMotion {
  if (id && !file.profiles[id]) warnOnce(`profile:${id}`, `motion: no profile "${id}", using the ${g === 'f' ? 'feminine' : 'masculine'} default`);
  const own = id && file.profiles[id] ? id : undefined;
  const gen = own ? file.profiles[own]!.gender : g;
  const links: { id: string; prof: Omit<MotionProfile, 'gender'> }[] = chain(file, own, gen);
  // Scene variants in effect go in front of the chain (most specific first: the last declared variant wins).
  const variants: string[] = [];
  // Pose replacements: the default's, then the character's own, then the variants in effect (later wins).
  const poses: Record<string, string> = {};
  for (const { prof } of [...links].reverse()) Object.assign(poses, (prof as MotionProfile).poses ?? {});
  if (own && scene) {
    const active = Object.entries(file.profiles[own]!.variants ?? {}).filter(([, v]) => variantApplies(v.when, scene));
    for (const [vid, v] of active) {
      variants.push(vid);
      Object.assign(poses, v.poses ?? {});
    }
    links.unshift(...active.reverse().map(([vid, v]) => ({ id: `${own}:${vid}`, prof: v })));
  }

  const clips = { ...NEUTRAL_CLIPS };
  if (formal) clips.walk = 'walk_formal';
  for (const a of ACTIVITIES) {
    for (const { prof } of links) {
      const clip = prof.clips?.[a];
      if (!clip) continue;
      if (lib.has(clip)) {
        clips[a] = clip;
        break;
      }
      warnOnce(clip, `mocap: no clip "${clip}" for the ${a} activity, falling back`);
    }
    if (!lib.has(clips[a])) clips[a] = NEUTRAL_CLIPS[a];
  }

  const holds: Partial<Record<PostureFamily, string>> = {};
  for (const f of POSTURE_FAMILIES) {
    for (const { prof } of links) {
      const clip = prof.holds?.[f];
      if (!clip) continue;
      if (lib.has(clip)) {
        holds[f] = clip;
        break;
      }
      warnOnce(clip, `mocap: no hold clip "${clip}" for ${f}, falling back`);
    }
  }

  const style: MotionStyle = { ...NEUTRAL_STYLE };
  for (const { prof } of [...links].reverse()) Object.assign(style, prof.style ?? {});

  const ownClips = own ? Object.values(file.profiles[own]!.clips ?? {}).some((c) => c && lib.has(c)) : false;
  const hands = (own && file.profiles[own]!.hands) || null;
  return { profile: own ?? file.defaults[gen], gender: gen, clips, holds, style, ownClips, isDefault: !own, variants, poses, hands };
}

/** The locomotion subset the blend space samples. */
export function locomotionSet(r: ResolvedMotion): MotionSet {
  return { idle: r.clips.idle, talk: r.clips.talk, walk: r.clips.walk, jog: r.clips.jog };
}

/**
 * Authored poses whose activity is played as a treatment on the pose (design D4): the profile's clip for that activity, when it
 * is an additive clip, is layered over the pose like a posture hold, with the hands kept on the keyboard or the mug.
 */
export function poseTreatment(pose: string): Activity | null {
  if (pose === 'typing' || pose === 'sit_typing' || pose.startsWith('sit_typing_')) return 'work';
  if (pose === 'drink' || pose.endsWith('_drink')) return 'drink';
  return null;
}

/** Which posture family an authored pose belongs to (its base name before a `_glance`/`_talk`/... variant), or null. */
export function postureFamily(pose: string): PostureFamily | null {
  let best: PostureFamily | null = null;
  for (const f of POSTURE_FAMILIES) {
    if ((pose === f || pose.startsWith(`${f}_`)) && (!best || f.length > best.length)) best = f;
  }
  if (!best && pose === 'squad_downed') return 'kneel';
  if (!best && pose === 'crouchWork') return 'crouch';
  return best;
}
