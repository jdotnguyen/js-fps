import { ValidationError, arr, bool, num, numRange, obj, oneOf, optional, record, str, type Infer, type Validator } from '../../core/validate.ts';
import { JOINT_NAMES, type JointName } from '../../actors/skeleton.ts';

/**
 * Scripted infected kills (infection-kills spec, `data/kills.json`): a kill style is an ordered list of beats. Each beat
 * holds or loops authored poses, eases the victim's convulsion toward a target, may move lumps under the skin, fires timed
 * events (sounds, jolts, gore, glass marks, the tear, the death, the creature), and ends on its cue or its time limit.
 */

export const KILL_KINDS = ['grownInside', 'converted'] as const;
export type KillKind = (typeof KILL_KINDS)[number];

/** How a beat ends (always also at `max` seconds): a spoken line, its own time `s`, reaching the glass, or the creature standing. */
export const BEAT_UNTIL = ['line', 'time', 'arrive', 'creature'] as const;

export const KILL_EVENTS = ['pose', 'sfx', 'kick', 'gore', 'glass', 'tear', 'die', 'creature', 'light', 'toGlass', 'face'] as const;
export type KillEventKind = (typeof KILL_EVENTS)[number];

const joint: Validator<JointName> = (v, p) => {
  const s = str(v, p);
  if (!(JOINT_NAMES as readonly string[]).includes(s)) throw new ValidationError(p, `unknown joint "${s}"`);
  return s as JointName;
};

const eventShape = {
  /** Seconds after the beat starts. */
  t: numRange(0, 60),
  do: oneOf(KILL_EVENTS),
  /** `pose`/`die`: the pose; `creature`: the creature's start pose. */
  pose: optional(str),
  blend: optional(numRange(0, 5)),
  /** `sfx`: sound names, first one that exists plays (a recording to come, then an existing stand-in). */
  id: optional(arr(str)),
  /** `sfx`/`kick`/`gore`: the joint it comes from. */
  joint: optional(joint),
  /** `kick`: push direction in the victim's own frame (she faces forward). */
  dir: optional(oneOf(['back', 'fwd', 'left', 'right', 'up'] as const)),
  strength: optional(numRange(0, 3)),
  /** `gore`: burst | chunks | spurt | pool; `glass`: print | splat | streak. */
  kind: optional(str),
  count: optional(numRange(1, 400)),
  size: optional(numRange(0.02, 6)),
  /** `gore spurt`: seconds; `glass streak`: seconds to run down. */
  s: optional(numRange(0, 30)),
  /** `glass print`: which palm. */
  hand: optional(oneOf(['L', 'R'] as const)),
  /** `tear`: wound radius (m). */
  radius: optional(numRange(0, 0.5)),
  /** `light`: the kill's key light on the victim. */
  state: optional(oneOf(['on', 'off', 'dip'] as const)),
  /** `toGlass`: walk speed (m/s). */
  speed: optional(numRange(0.1, 6)),
};

const bulgeShape = {
  /** Joint chain the lump travels along, from start to end. */
  path: arr(joint),
  radius: numRange(0.01, 0.4),
  /** Outward push (m). */
  amp: numRange(0, 0.2),
};

const beatShape = {
  id: str,
  /** Poses held (one) or looped back and forth (two or more, every `period` s). */
  poses: arr(str),
  period: optional(numRange(0.05, 5)),
  blend: optional(numRange(0, 3)),
  /** Convulsion target (0..1) and how fast it eases there (per second). */
  convulse: numRange(0, 1),
  rate: optional(numRange(0.05, 20)),
  until: oneOf(BEAT_UNTIL),
  /** `until: time`: the beat's own length. */
  s: optional(numRange(0, 60)),
  /** Time limit: the beat always ends by then, so a missing recording never stops the kill. */
  max: numRange(0.1, 60),
  /** Only when the victim stands at a glass partition. */
  needsGlass: optional(bool),
  /** Lumps under the skin, moving start to end of their path over the beat (by `s`, else `max`). */
  bulges: optional(arr(obj(bulgeShape))),
  events: optional(arr(obj(eventShape))),
};

const styleShape = {
  kind: oneOf(KILL_KINDS),
  /** Look id (castLooks) of the creature that comes out of the victim (grownInside). */
  creature: optional(str),
  /** Heights above the floor (m) that blood marks on the glass keep clear of. */
  clearBand: optional(obj({ min: num, max: num })),
  /** How far from the glass the victim stands (m). */
  glassStand: optional(numRange(0.2, 2)),
  beats: arr(obj(beatShape)),
};

export type KillEvent = Infer<typeof eventShape>;
export type KillBeat = Infer<typeof beatShape>;
export type KillStyle = Infer<typeof styleShape>;
export type KillTable = Record<string, KillStyle>;

export const validateKillTable: Validator<KillTable> = (v, p) => {
  const table = record(obj(styleShape))(v, p);
  for (const [id, style] of Object.entries(table)) {
    const sp = `${p} > ${id}`;
    const seen = new Set<string>();
    style.beats.forEach((b, i) => {
      const bp = `${sp} > beats[${i}]`;
      if (seen.has(b.id)) throw new ValidationError(bp, `duplicate beat "${b.id}"`);
      seen.add(b.id);
      if (b.poses.length === 0) throw new ValidationError(`${bp} > poses`, 'at least one pose');
      if (b.until === 'time' && b.s === undefined) throw new ValidationError(bp, '"until": "time" needs "s"');
      if (b.s !== undefined && b.s > b.max) throw new ValidationError(bp, '"s" is longer than the time limit "max"');
      for (const [k, e] of (b.events ?? []).entries()) {
        const ep = `${bp} > events[${k}]`;
        if (e.t > b.max) throw new ValidationError(ep, `fires after the beat's time limit (${b.max} s)`);
        if (e.do === 'sfx' && !e.id?.length) throw new ValidationError(ep, 'sfx needs "id"');
        if (e.do === 'kick' && (!e.joint || !e.dir)) throw new ValidationError(ep, 'kick needs "joint" and "dir"');
        if (e.do === 'gore' && !['burst', 'chunks', 'spurt', 'pool'].includes(e.kind ?? '')) throw new ValidationError(ep, 'gore kind is burst | chunks | spurt | pool');
        if (e.do === 'glass' && !['print', 'splat', 'streak'].includes(e.kind ?? '')) throw new ValidationError(ep, 'glass kind is print | splat | streak');
        if ((e.do === 'pose' || e.do === 'die') && !e.pose) throw new ValidationError(ep, `${e.do} needs "pose"`);
      }
    });
  }
  return table;
};
