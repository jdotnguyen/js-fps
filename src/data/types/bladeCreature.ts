import { arr, num, numRange, obj, optional, record, str, validate, ValidationError, type Infer, type Validator } from '../../core/validate.ts';
import { JOINT_NAMES, type JointName } from '../../actors/skeleton.ts';

/**
 * data/blade-creature.json (openspec rig-necromorph, design D1): the blade creature's profile. Its body stays a humanoid
 * body on the shared skeleton; the profile says what is different about it: its jaw, the extra neck and spine segments
 * that share their joint's bend, its belly arms, its ankle height, its blades, and which of its own poses stand in for
 * the poses the scenes and the AI ask for.
 */

const jointName: Validator<JointName> = (v, p) => {
  const s = str(v, p);
  if (!(JOINT_NAMES as readonly string[]).includes(s)) throw new ValidationError(p, `unknown joint "${s}", expected one of: ${JOINT_NAMES.join(', ')}`);
  return s as JointName;
};

const segment = obj({
  /** The game joint whose bend these bones share. */
  joint: jointName,
  /** The model's bones in that joint's chain, root first; each takes an equal share of the joint's rotation. */
  bones: arr(str),
});

const limb = obj({
  /** A name for the limb (belly_L). */
  name: str,
  /** The model bone at its root; it and every bone below it move as the limb. */
  root: str,
});

const blade = obj({
  /** The model bone the blade hangs from (the hand). */
  hand: str,
});

const shape = {
  /** The body model (data/body-models.json) this profile belongs to. */
  model: str,
  /** The ankle's height above the sole at the 1.78 m reference height, in metres. */
  ankleHeight: numRange(0.02, 0.5),
  jaw: obj({
    /** The model's jaw bone. */
    bone: str,
    /** How far the jaw opens at 1, in degrees. */
    openDeg: numRange(1, 90),
    /** How open it hangs at rest, 0..1. */
    rest: numRange(0, 1),
  }),
  segments: arr(segment),
  limbs: arr(limb),
  blades: obj({ L: blade, R: blade }),
  /** Hit capsules fitted to the drawn body: the blades' radius, and the largest any capsule may be (m, reference height). */
  hits: obj({ bladeRadius: numRange(0.005, 0.2), maxRadius: numRange(0.05, 0.5) }),
  /** Pose asked for -> the creature's own pose. Poses not listed are used as they are. */
  poseMap: record(str),
  /** Free notes for the reader (ignored). */
  notes: optional(arr(str)),
  /** Scale factor for every length above (tests). */
  scale: optional(num),
};

export type BladeCreatureProfile = Infer<typeof shape>;
export const validateBladeCreatureShape: Validator<BladeCreatureProfile> = obj(shape);

/**
 * Validate the profile, then check that every bone it names is in the model and every pose it maps to exists.
 * `bones` are the model's bone names; `poses` the pose library's names.
 */
export function loadBladeCreature(raw: unknown, refs: { bones?: readonly string[]; poses?: readonly string[] } = {}, source = 'data/blade-creature.json'): BladeCreatureProfile {
  const p = validate(validateBladeCreatureShape, raw, source);
  const bones = refs.bones ? new Set(refs.bones) : null;
  const bone = (name: string, path: string): void => {
    if (bones && !bones.has(name)) throw new ValidationError(`${source} > ${path}`, `unknown bone "${name}" (not in the ${p.model} model)`);
  };
  bone(p.jaw.bone, 'jaw > bone');
  p.segments.forEach((s, i) => s.bones.forEach((b, k) => bone(b, `segments[${i}] > bones[${k}]`)));
  p.limbs.forEach((l, i) => bone(l.root, `limbs[${i}] (${l.name}) > root`));
  bone(p.blades.L.hand, 'blades > L > hand');
  bone(p.blades.R.hand, 'blades > R > hand');
  if (refs.poses) {
    const known = new Set(refs.poses);
    for (const [from, to] of Object.entries(p.poseMap)) {
      if (!known.has(to)) throw new ValidationError(`${source} > poseMap > ${from}`, `unknown pose "${to}"`);
    }
  }
  return p;
}
