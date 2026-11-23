import type { Activity, MotionProfileFile, PostureFamily } from './motionProfiles.ts';
import { conditionIds, postureFamily, poseTreatment } from './motionProfiles.ts';

/**
 * Cast motion coverage (character-motion spec: every named character has its own profile; profiles cover every activity the
 * character performs). Pure: callers pass parsed level and sequence data, so tests and the cast motion sandbox share it.
 */

/** One thing a level, sequence or squad task asks a named character to do. */
export interface MotionRequest {
  /** Named character's look id (`giles`, `voss`, ...). */
  look: string;
  /** Where it was asked: `level:R04`, `sequence:intro_shift_change`, `task:bypass`. */
  source: string;
  /** The pose, or `walk`/`talk` for moves and lines. */
  pose: string;
}

/** What a request needs from a profile. */
export type MotionNeed =
  | { kind: 'activity'; activity: Activity }
  | { kind: 'hold'; family: PostureFamily }
  | { kind: 'pose'; pose: string };

/** Authored poses that are an activity in the profile vocabulary. */
const POSE_ACTIVITY: Readonly<Record<string, Activity>> = {
  idle: 'idle',
  walk: 'walk',
  talk: 'talk',
  talk_gesture: 'talk',
  aim_pistol: 'aimPistol',
};

export function needFor(pose: string): MotionNeed {
  const activity = POSE_ACTIVITY[pose];
  if (activity) return { kind: 'activity', activity };
  const treatment = poseTreatment(pose);
  if (treatment) return { kind: 'activity', activity: treatment };
  const family = postureFamily(pose);
  if (family) return { kind: 'hold', family };
  return { kind: 'pose', pose };
}

interface Layer {
  clips?: Partial<Record<Activity, string>>;
  holds?: Partial<Record<PostureFamily, string>>;
  poses?: Record<string, string>;
}

function layerCovers(l: Layer, need: MotionNeed, pose: string): boolean {
  if (l.poses?.[pose]) return true;
  if (need.kind === 'activity') return Boolean(l.clips?.[need.activity]);
  if (need.kind === 'hold') return Boolean(l.holds?.[need.family]);
  return Boolean(l.holds?.stand);
}

/**
 * Does the character's own profile (not what it inherits) cover the need, in its everyday motion or in a scene variant that can
 * apply where the request comes from (a variant for that sequence or task, or one keyed only on a flag or stage)? Plain authored
 * poses are covered by a stand hold or by a variant's own version of the pose.
 */
export function ownCovers(file: MotionProfileFile, profile: string, need: MotionNeed, source = '', pose = ''): boolean {
  const prof = file.profiles[profile];
  if (!prof) return false;
  if (layerCovers(prof, need, pose)) return true;
  const [kind, id] = source.split(':');
  for (const v of Object.values(prof.variants ?? {})) {
    const w = v.when;
    const seqs = conditionIds(w.sequence);
    const tasks = conditionIds(w.task);
    const fits = (!seqs || (kind === 'sequence' && seqs.includes(id!))) && (!tasks || (kind === 'task' && tasks.includes(id!)));
    if (fits && layerCovers(v, need, pose)) return true;
  }
  return false;
}

/** Corpse and kill poses are not living motion (character-motion: infected and scripted kills keep their own motion). */
export function isDeathPose(pose: string): boolean {
  return pose.startsWith('corpse') || pose.startsWith('kill_');
}

/** Requests that are not written in level or sequence data. */
export interface GatherExtra {
  /** The named look that speaks a dialogue line (`say` steps name only the line). */
  speakerOf?: (line: string) => string | undefined;
  /** Poses squad behaviour gives a character outside tasks: revives, being downed, infection tells. */
  behaviours?: readonly MotionRequest[];
}

interface LevelLike {
  rooms: readonly { id: string; npcs?: readonly { id: string; look?: string; pose?: string; chat?: unknown }[] }[];
}

type Json = unknown;

/** Every request the given level, sequences and squad tasks make of named characters (`named` maps look id -> profile id). */
export function gatherRequests(
  level: LevelLike,
  sequences: Readonly<Record<string, Json>>,
  tasks: Readonly<Record<string, { who: string; pose: string }>>,
  named: ReadonlySet<string>,
  squadLooks: Readonly<Record<string, string>>,
  extra: GatherExtra = {},
): MotionRequest[] {
  const out: MotionRequest[] = [...(extra.behaviours ?? [])];
  const npcLook = new Map<string, string>(Object.values(squadLooks).map((look) => [look, look]));
  for (const [id, look] of Object.entries(squadLooks)) npcLook.set(id, look);
  for (const room of level.rooms) {
    for (const npc of room.npcs ?? []) {
      if (!npc.look || !named.has(npc.look)) continue;
      npcLook.set(npc.id, npc.look);
      out.push({ look: npc.look, source: `level:${room.id}`, pose: npc.pose ?? 'idle' });
      if (npc.chat) out.push({ look: npc.look, source: `level:${room.id}`, pose: 'talk' });
    }
  }
  const lookOf = (ref: unknown): string | undefined => {
    if (typeof ref !== 'string') return undefined;
    return npcLook.get(ref.startsWith('npc:') ? ref.slice(4) : ref);
  };
  for (const [seqId, seq] of Object.entries(sequences)) {
    const source = `sequence:${seqId}`;
    const walk = (node: Json): void => {
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (!node || typeof node !== 'object') return;
      const step = node as Record<string, unknown>;
      const look = lookOf(step['npc'] ?? step['actor'] ?? step['who']);
      if (look) {
        const kind = step['do'];
        if (kind === 'npcAnim' && typeof step['anim'] === 'string') out.push({ look, source, pose: step['anim'] });
        else if (kind === 'npcMoveTo' || kind === 'npcFollow') out.push({ look, source, pose: 'walk' });
        else if (kind === 'npcTask' && typeof step['task'] === 'string') {
          const t = tasks[step['task']];
          if (t) out.push({ look, source: `task:${step['task']}`, pose: t.pose });
        }
      }
      if (step['do'] === 'say' && typeof step['line'] === 'string') {
        const speaker = extra.speakerOf?.(step['line']);
        if (speaker && named.has(speaker)) out.push({ look: speaker, source, pose: 'talk' });
      }
      for (const v of Object.values(step)) walk(v);
    };
    walk(seq);
  }
  for (const [taskId, t] of Object.entries(tasks)) {
    const look = squadLooks[t.who];
    if (look) out.push({ look, source: `task:${taskId}`, pose: t.pose });
  }
  const seen = new Set<string>();
  return out.filter((r) => {
    if (isDeathPose(r.pose)) return false;
    const k = `${r.look}|${r.source}|${r.pose}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export interface CoverageProblem {
  look: string;
  message: string;
}

/**
 * Check the cast against the profiles. Every named look must have a profile, and every request must name a pose that exists.
 * For looks in `ownRequired` (characters whose own motion has landed), every request must be covered by their own profile or
 * one of its scene variants, and every variant `sceneVariants` lists for them (design D11) must exist.
 */
export function checkCoverage(
  file: MotionProfileFile,
  named: Readonly<Record<string, string | undefined>>,
  requests: readonly MotionRequest[],
  poseExists: (pose: string) => boolean,
  ownRequired: ReadonlySet<string>,
  sceneVariants: Readonly<Record<string, readonly string[]>> = {},
  /** Whether a look's body has a captured clip (`npcAnim` with `clip:<id>` plays one once). Without it, any clip request is a problem. */
  clipExists: (look: string, clip: string) => boolean = () => false,
): CoverageProblem[] {
  const problems: CoverageProblem[] = [];
  for (const [look, profile] of Object.entries(named)) {
    if (!profile || !file.profiles[profile]) problems.push({ look, message: `named character "${look}" has no motion profile` });
  }
  for (const [look, ids] of Object.entries(sceneVariants)) {
    const profile = named[look];
    if (!profile || !ownRequired.has(look)) continue;
    for (const id of ids) {
      if (!file.profiles[profile]?.variants?.[id]) problems.push({ look, message: `"${look}" has no "${id}" scene variant` });
    }
  }
  for (const r of requests) {
    if (r.pose.startsWith('clip:')) {
      const clip = r.pose.slice(5);
      if (!clipExists(r.look, clip)) problems.push({ look: r.look, message: `${r.source} asks "${r.look}" for clip "${clip}", which its body does not have` });
      continue;
    }
    if (r.pose !== 'walk' && r.pose !== 'talk' && !poseExists(r.pose)) {
      problems.push({ look: r.look, message: `${r.source} asks "${r.look}" for unknown pose "${r.pose}"` });
      continue;
    }
    const profile = named[r.look];
    if (!profile || !ownRequired.has(r.look)) continue;
    if (!ownCovers(file, profile, needFor(r.pose), r.source, r.pose)) {
      problems.push({ look: r.look, message: `${r.source} asks "${r.look}" for "${r.pose}", which falls through to the default profile` });
    }
  }
  return problems;
}
