import { arr, nullable, num, numRange, obj, optional, record, str, tuple3, ValidationError, vec3, type Validator } from '../../core/validate.ts';

/**
 * Creature rigs (openspec rig-juggernaut, spec `creature-rig`): data/creatures/<id>/creature.json defines the rig and
 * data/creatures/<id>/poses.json its named poses. Joints are named as in the model file (three.js strips the dots when it
 * loads them; the rig matches either spelling). Angles are degrees.
 */

/** Chain roles. The solvers need the required ones; the rest only gather joints for limits and poses. */
export const REQUIRED_ROLES = ['spine', 'neck', 'head', 'jaw', 'tongue', 'eyes', 'arm.L', 'arm.R', 'leg.L', 'leg.R'] as const;
export const OPTIONAL_ROLES = ['lashes', 'crown', 'fat', 'stomach', 'fingers.L', 'fingers.R'] as const;
export const ROLES = [...REQUIRED_ROLES, ...OPTIONAL_ROLES] as const;
export type Role = (typeof ROLES)[number];

/** Joints in each limb chain, root first: arm = shoulder, upper arm, forearm, hand; leg = thigh, shin, third segment, foot. */
export const LIMB_LENGTH = 4;

export type Vec3 = [number, number, number];

/**
 * A rotation limit, relative to the joint's neutral pose, split into twist (about `axis`) and swing (the rest).
 * - hinge: `axis` is the hinge in the joint's neutral local frame; `range` limits the bend about it, `play` the wobble off it.
 * - ball: `axis` (default: the joint's local +Y, the bone's own axis in this rig) is the bone; `twist` limits the roll about
 *   it, `cone` the swing away from it, as half-angles of an ellipse about two axes across the bone (the first is local X
 *   with its part along the bone removed, the second the bone axis crossed with the first).
 *
 * Hinge angles are positive when the joint bends further than in neutral (the child segment turns away from the parent's).
 */
export type JointLimit =
  | { kind: 'hinge'; axis: Vec3; range: [number, number]; play: number }
  | { kind: 'ball'; axis?: Vec3; twist: [number, number]; cone: [number, number] };

export interface LimbIk {
  /** Direction the elbow or knee bends towards, in the creature's model frame (Y up, facing `forward`). */
  pole: Vec3;
}

export interface LegIk extends LimbIk {
  /** Fixed angle (degrees) between the third segment and the thigh in the bend plane (design D12), from the bind pose. */
  hock: number;
}

export interface CreatureDef {
  /** Model path under public/. */
  model: string;
  /** Height (m) the body is scaled to, measured in `heightPose`. */
  height: number;
  heightPose: string;
  /** The model's facing in its own frame. */
  forward: Vec3;
  /** The joint the squad aims at; it rides the head. */
  aimMarker: string;
  chains: Partial<Record<Role, string[]>>;
  limits: Record<string, JointLimit>;
  ik: { 'arm.L': LimbIk; 'arm.R': LimbIk; 'leg.L': LegIk; 'leg.R': LegIk };
  /** Share of a look-at turn taken by the neck (the head takes the rest). */
  lookNeckShare: number;
  /** Partial poses (data/creatures/<id>/poses.json) that open the jaw and move the tongue (design D8). */
  face: { jawOpen: string; tongueExtend: string; tongueCurl: string };
}

export interface CreaturePose {
  /** XYZ Euler degrees relative to neutral; joints left out stay where the base pose puts them. */
  joints: Record<string, Vec3>;
  /** Translation relative to neutral, in model units, in the parent joint's frame. */
  offsets?: Record<string, Vec3>;
  /** Scale relative to neutral. */
  scales?: Record<string, Vec3>;
}

/** One step of a key-pose sequence (openspec juggernaut-walk-and-roar D5). */
export interface SequenceStep {
  /** Pose to blend into (null: neutral). */
  pose: string | null;
  /** Seconds to blend into it, then to hold it. */
  blend: number;
  hold: number;
  /** Face amounts (0..1) to reach over the blend; left out, they stay where they are. */
  jaw?: number;
  tongueExtend?: number;
  tongueCurl?: number;
  /** Shaking of the neck, head and jaw (degrees), reached over the blend; left out, none. */
  tremble?: number;
  /** How firmly the hands stay on their IK targets (0..1), reached over the blend: 0 lets the pose lift them. Left out, unchanged. */
  hands?: number;
  /** How much the head and eyes follow the look target (0..1), reached over the blend. Left out, unchanged. */
  look?: number;
}

export interface CreaturePoseFile {
  poses: Record<string, CreaturePose>;
  /** Named key-pose sequences (roars and other set pieces). */
  sequences?: Record<string, SequenceStep[]>;
}

const range: Validator<[number, number]> = (v, p) => {
  if (!Array.isArray(v) || v.length !== 2) throw new ValidationError(p, 'expected [min, max]');
  const out: [number, number] = [numRange(-180, 180)(v[0], `${p}[0]`), numRange(-180, 180)(v[1], `${p}[1]`)];
  if (out[0] > out[1]) throw new ValidationError(p, `min ${out[0]} is greater than max ${out[1]}`);
  return out;
};

const cone: Validator<[number, number]> = (v, p) => {
  if (!Array.isArray(v) || v.length !== 2) throw new ValidationError(p, 'expected [half-angle, half-angle]');
  return [numRange(0, 180)(v[0], `${p}[0]`), numRange(0, 180)(v[1], `${p}[1]`)];
};

const axis: Validator<Vec3> = (v, p) => {
  const a = vec3(v, p);
  if (Math.hypot(...a) < 1e-6) throw new ValidationError(p, 'axis has no length');
  return a;
};

const limit: Validator<JointLimit> = (v, p) => {
  const kind = (v as { kind?: unknown } | null)?.kind;
  if (kind === 'hinge') return obj({ kind: str, axis, range, play: numRange(0, 90) })(v, p) as JointLimit;
  if (kind === 'ball') return obj({ kind: str, axis: optional(axis), twist: range, cone })(v, p) as JointLimit;
  throw new ValidationError(`${p} > kind`, 'expected "hinge" or "ball"');
};

const limbIk = obj({ pole: axis });
const legIk = obj({ pole: axis, hock: numRange(-180, 180) });

const chains: Validator<Partial<Record<Role, string[]>>> = (v, p) => {
  const out = record((x, q) => {
    if (!Array.isArray(x) || x.length === 0) throw new ValidationError(q, 'expected a non-empty list of joints');
    return x.map((j, i) => str(j, `${q}[${i}]`));
  })(v, p);
  for (const role of Object.keys(out)) {
    if (!(ROLES as readonly string[]).includes(role)) throw new ValidationError(`${p} > ${role}`, `unknown role, expected one of: ${ROLES.join(', ')}`);
  }
  for (const role of REQUIRED_ROLES) if (!out[role]) throw new ValidationError(`${p} > ${role}`, 'missing role the solvers need');
  for (const role of ['arm.L', 'arm.R', 'leg.L', 'leg.R'] as const) {
    if (out[role]!.length !== LIMB_LENGTH) throw new ValidationError(`${p} > ${role}`, `expected ${LIMB_LENGTH} joints, root first`);
  }
  return out as Partial<Record<Role, string[]>>;
};

const defShape = obj({
  model: str,
  height: numRange(0.1, 100),
  heightPose: str,
  forward: axis,
  aimMarker: str,
  chains,
  limits: record(limit),
  ik: obj({ 'arm.L': limbIk, 'arm.R': limbIk, 'leg.L': legIk, 'leg.R': legIk }),
  lookNeckShare: numRange(0, 1),
  face: obj({ jawOpen: str, tongueExtend: str, tongueCurl: str }),
});

/** Every joint in a chain has a limit, and each joint is in one chain only. */
export const validateCreatureDef: Validator<CreatureDef> = (v, p) => {
  const def = defShape(v, p) as CreatureDef;
  const seen = new Map<string, string>();
  for (const [role, joints] of Object.entries(def.chains)) {
    for (const j of joints!) {
      const other = seen.get(j);
      if (other) throw new ValidationError(`${p} > chains > ${role}`, `joint "${j}" is already in chain "${other}"`);
      seen.set(j, role);
      if (!def.limits[j]) throw new ValidationError(`${p} > chains > ${role}`, `joint "${j}" has no limit`);
    }
  }
  for (const j of Object.keys(def.limits)) {
    if (!seen.has(j)) throw new ValidationError(`${p} > limits > ${j}`, 'unknown joint: not in any chain');
  }
  return def;
};

const pose = obj({ joints: record(vec3), offsets: optional(record(vec3)), scales: optional(record(tuple3(num))) });
const unit = numRange(0, 1);
const step = obj({ pose: nullable(str), blend: numRange(0, 30), hold: numRange(0, 60), jaw: optional(unit), tongueExtend: optional(unit), tongueCurl: optional(unit), tremble: optional(numRange(0, 20)), hands: optional(unit), look: optional(unit) });
const poseFileShape = obj({ poses: record(pose), sequences: optional(record(arr(step))) });

/** A creature's poses and sequences; a sequence step naming an unknown pose is rejected, naming the sequence and the pose. */
export const validateCreaturePoses: Validator<CreaturePoseFile> = (v, p) => {
  const file = poseFileShape(v, p) as CreaturePoseFile;
  for (const [name, steps] of Object.entries(file.sequences ?? {})) {
    if (steps.length === 0) throw new ValidationError(`${p} > sequences > ${name}`, 'a sequence needs at least one step');
    steps.forEach((s, i) => {
      if (s.pose !== null && !file.poses[s.pose]) throw new ValidationError(`${p} > sequences > ${name}[${i}] > pose`, `unknown pose "${s.pose}" in sequence "${name}"`);
    });
  }
  return file;
};

/**
 * Checks a pose file against its creature: every joint a pose names is one the rig poses (in a chain), and the poses the
 * definition names exist. Throws a ValidationError naming the pose and the joint.
 */
export function checkCreaturePoses(def: CreatureDef, file: CreaturePoseFile, source: string): void {
  const rigged = new Set(Object.values(def.chains).flat());
  for (const [name, data] of Object.entries(file.poses)) {
    for (const part of ['joints', 'offsets', 'scales'] as const) {
      for (const j of Object.keys(data[part] ?? {})) {
        if (!rigged.has(j)) throw new ValidationError(`${source} > poses > ${name} > ${part} > ${j}`, `unknown joint in pose "${name}": "${j}" is not in any chain`);
      }
    }
  }
  for (const needed of [def.heightPose, def.face.jawOpen, def.face.tongueExtend, def.face.tongueCurl]) {
    if (!file.poses[needed]) throw new ValidationError(`${source} > poses`, `missing pose "${needed}" the creature names`);
  }
}
