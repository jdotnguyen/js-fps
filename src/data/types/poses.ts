import { arr, num, obj, optional, record, str, validate, ValidationError, vec3, type Validator } from '../../core/validate.ts';
import { JOINT_NAMES, type JointName } from '../../actors/skeleton.ts';

/**
 * data/poses.json (ADR-0006). Angles are XYZ Euler degrees relative to the rest pose;
 * see actors/skeleton.ts for the sign conventions (body faces -Z).
 */
export interface PoseData {
  /** Joint rotations; joints left out stay at rest. */
  joints: Partial<Record<JointName, [number, number, number]>>;
  /** Whole-body rotation about the feet (degrees), e.g. [-90, 0, 0] lies face down. */
  rootRot?: [number, number, number];
  /** Whole-body offset in metres. */
  rootPos?: [number, number, number];
  /** Pelvis offset in metres (crouching, sitting). */
  pelvis?: [number, number, number];
  /**
   * Start from another pose (ADR-0029): its joints, pelvis and root, with this pose's own entries on top. Seated and leaning
   * gestures extend their base pose so the legs stay where the base puts them.
   */
  extends?: string;
}

export interface PoseStep {
  pose: string;
  /** Seconds to blend into this pose. */
  blend: number;
  /** Seconds to hold it before the next step. */
  hold: number;
}

export interface PoseFile {
  poses: Record<string, PoseData>;
  sequences: Record<string, PoseStep[]>;
}

const jointMap: Validator<Partial<Record<JointName, [number, number, number]>>> = (v, p) => {
  const out = record(vec3)(v, p);
  for (const key of Object.keys(out)) {
    if (!(JOINT_NAMES as readonly string[]).includes(key)) {
      throw new ValidationError(`${p} > ${key}`, `unknown joint, expected one of: ${JOINT_NAMES.join(', ')}`);
    }
  }
  return out as Partial<Record<JointName, [number, number, number]>>;
};

const pose = obj({ joints: jointMap, rootRot: optional(vec3), rootPos: optional(vec3), pelvis: optional(vec3), extends: optional(str) });
const step = obj({ pose: str, blend: num, hold: num });
const file = obj({ poses: record(pose), sequences: record(arr(step)) });

export const validatePoseFile: Validator<PoseFile> = (v, p) => {
  const out = file(v, p) as PoseFile;
  for (const [name, data] of Object.entries(out.poses)) {
    const seen = new Set([name]);
    for (let base = data.extends; base !== undefined; base = out.poses[base]?.extends) {
      if (!(base in out.poses)) throw new ValidationError(`${p} > poses > ${name} > extends`, `unknown pose "${base}"`);
      if (seen.has(base)) throw new ValidationError(`${p} > poses > ${name} > extends`, `"${base}" extends itself`);
      seen.add(base);
    }
  }
  for (const [name, steps] of Object.entries(out.sequences)) {
    steps.forEach((s, i) => {
      if (!(s.pose in out.poses)) throw new ValidationError(`${p} > sequences > ${name}[${i}] > pose`, `unknown pose "${s.pose}"`);
    });
  }
  return out;
};

/** A pose with its `extends` chain applied: the base's joints and offsets, then its own on top. */
export function resolvePose(file: PoseFile, name: string): PoseData {
  const data = file.poses[name];
  if (!data) throw new Error(`unknown pose "${name}"`);
  if (data.extends === undefined) return data;
  const base = resolvePose(file, data.extends);
  const out: PoseData = { joints: { ...base.joints, ...data.joints } };
  const rootRot = data.rootRot ?? base.rootRot;
  const rootPos = data.rootPos ?? base.rootPos;
  const pelvis = data.pelvis ?? base.pelvis;
  if (rootRot) out.rootRot = rootRot;
  if (rootPos) out.rootPos = rootPos;
  if (pelvis) out.pelvis = pelvis;
  return out;
}

export function loadPoseFile(raw: unknown, source = 'data/poses.json'): PoseFile {
  return validate(validatePoseFile, raw, source);
}
