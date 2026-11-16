/**
 * Humanoid joint layout and hit regions (ADR-0006). Pure data, no three.js.
 *
 * Conventions (ADR-0001): metres, Y up, the body faces -Z, so its left side is -X.
 * Joint rotations in data are XYZ Euler degrees relative to the rest pose (arms hanging):
 *   +x swings a limb forward, -x bends a knee (shin), +x bends an elbow (forearm),
 *   -x nods the spine/neck/head forward, +y turns left, -z raises the left arm sideways.
 */

/** Same order as JOINTS (bone index = position here); a test keeps them in step. */
export const JOINT_NAMES = [
  'root', 'pelvis', 'spine', 'chest', 'neck', 'head', 'jaw',
  'shoulder_L', 'upperArm_L', 'foreArm_L', 'hand_L', 'thigh_L', 'shin_L', 'foot_L',
  'shoulder_R', 'upperArm_R', 'foreArm_R', 'hand_R', 'thigh_R', 'shin_R', 'foot_R',
] as const;

export type JointName = (typeof JOINT_NAMES)[number];
export type Side = 'L' | 'R';

/** Severable hit regions plus the shared torso pool. */
export const REGIONS = [
  'head',
  'upperArm_L', 'foreArm_L', 'upperArm_R', 'foreArm_R',
  'thigh_L', 'shin_L', 'thigh_R', 'shin_R',
  'torso',
] as const;

export type Region = (typeof REGIONS)[number];
export type SeverableRegion = Exclude<Region, 'torso'>;
export type Limb = 'head' | 'arm_L' | 'arm_R' | 'leg_L' | 'leg_R';

export type Vec3T = readonly [number, number, number];

/** Hit capsule in joint-local space. */
export interface CapsuleDef {
  a: Vec3T;
  b: Vec3T;
  r: number;
}

/** Tapered capsule along local Y from y0 to y1 (limbs run downwards, y1 < y0). */
export interface SegmentDef {
  y0: number;
  y1: number;
  r0: number;
  r1: number;
  /** Cross-section scale (width, depth). */
  sx: number;
  sz: number;
}

export interface JointDef {
  name: JointName;
  parent: JointName | null;
  /** Joint origin relative to the parent, for the reference 1.78 m, build 1 body. */
  offset: Vec3T;
  /** Generic segment mesh; null for joints with bespoke geometry or none. */
  segment: SegmentDef | null;
  /** Hit capsules on this joint and the region they damage. */
  capsule: CapsuleDef | null;
  region: Region | null;
}

export const REFERENCE_HEIGHT = 1.78;

const sideX = (s: Side): number => (s === 'L' ? -1 : 1);

function seg(y0: number, y1: number, r0: number, r1: number, sx = 1, sz = 1): SegmentDef {
  return { y0, y1, r0, r1, sx, sz };
}

function capOf(s: SegmentDef, shrink = 0.92): CapsuleDef {
  const r = Math.max(s.r0, s.r1) * Math.max(s.sx, s.sz) * shrink;
  return { a: [0, s.y0, 0], b: [0, s.y1, 0], r };
}

function limbJoints(s: Side): JointDef[] {
  const x = sideX(s);
  const upperArm = seg(0.02, -0.28, 0.058, 0.046);
  const foreArm = seg(0.01, -0.25, 0.046, 0.034);
  const thigh = seg(0.03, -0.43, 0.086, 0.058);
  const shin = seg(0.0, -0.41, 0.056, 0.04);
  return [
    { name: `shoulder_${s}`, parent: 'chest', offset: [0.17 * x, 0.2, 0], segment: null, capsule: null, region: null },
    { name: `upperArm_${s}`, parent: `shoulder_${s}`, offset: [0.035 * x, -0.01, 0], segment: upperArm, capsule: capOf(upperArm), region: `upperArm_${s}` },
    { name: `foreArm_${s}`, parent: `upperArm_${s}`, offset: [0, -0.29, 0], segment: foreArm, capsule: capOf(foreArm), region: `foreArm_${s}` },
    { name: `hand_${s}`, parent: `foreArm_${s}`, offset: [0, -0.26, 0], segment: null, capsule: { a: [0, -0.02, 0], b: [0, -0.14, -0.01], r: 0.042 }, region: `foreArm_${s}` },
    { name: `thigh_${s}`, parent: 'pelvis', offset: [0.095 * x, -0.06, 0], segment: thigh, capsule: capOf(thigh), region: `thigh_${s}` },
    { name: `shin_${s}`, parent: `thigh_${s}`, offset: [0, -0.44, 0], segment: shin, capsule: capOf(shin), region: `shin_${s}` },
    { name: `foot_${s}`, parent: `shin_${s}`, offset: [0, -0.42, 0], segment: null, capsule: { a: [0, -0.025, 0.04], b: [0, -0.03, -0.15], r: 0.045 }, region: `shin_${s}` },
  ];
}

const PELVIS = seg(-0.08, 0.1, 0.15, 0.14, 1.2, 0.82);
const SPINE = seg(0, 0.18, 0.13, 0.14, 1.2, 0.76);
const CHEST = seg(0, 0.24, 0.15, 0.13, 1.3, 0.78);
const NECK = seg(-0.03, 0.09, 0.052, 0.048);

/** Hero bodies get a longer neck (metres) so the head clears the chest bulk and the jaw reads from eye level. */
export const HERO_NECK_EXTRA = 0.07;

/** Neck segment for hero bodies: the reference neck stretched and thickened at the base (trapezius). */
export const HERO_NECK = seg(-0.03, 0.09 + HERO_NECK_EXTRA, 0.07, 0.046);

export const JOINTS: readonly JointDef[] = [
  { name: 'root', parent: null, offset: [0, 0, 0], segment: null, capsule: null, region: null },
  { name: 'pelvis', parent: 'root', offset: [0, 0.98, 0], segment: PELVIS, capsule: capOf(PELVIS, 0.85), region: 'torso' },
  { name: 'spine', parent: 'pelvis', offset: [0, 0.12, 0], segment: SPINE, capsule: capOf(SPINE, 0.85), region: 'torso' },
  { name: 'chest', parent: 'spine', offset: [0, 0.18, 0], segment: CHEST, capsule: capOf(CHEST, 0.85), region: 'torso' },
  { name: 'neck', parent: 'chest', offset: [0, 0.22, 0], segment: NECK, capsule: capOf(NECK, 1), region: 'head' },
  { name: 'head', parent: 'neck', offset: [0, 0.08, 0], segment: null, capsule: { a: [0, 0.06, -0.01], b: [0, 0.12, -0.01], r: 0.1 }, region: 'head' },
  // Lower jaw, hinged near the ears; covered by the head capsule.
  { name: 'jaw', parent: 'head', offset: [0, 0.062, 0.01], segment: null, capsule: null, region: null },
  ...limbJoints('L'),
  ...limbJoints('R'),
];

export const JOINT_INDEX: Readonly<Record<JointName, number>> = Object.fromEntries(
  JOINTS.map((j, i) => [j.name, i]),
) as Record<JointName, number>;

export function jointDef(name: JointName): JointDef {
  const d = JOINTS[JOINT_INDEX[name]];
  if (!d) throw new Error(`unknown joint ${name}`);
  return d;
}

/** The joint that detaches when a region is severed. */
export const SEVER_JOINT: Readonly<Record<SeverableRegion, JointName>> = {
  head: 'head',
  upperArm_L: 'upperArm_L',
  foreArm_L: 'foreArm_L',
  upperArm_R: 'upperArm_R',
  foreArm_R: 'foreArm_R',
  thigh_L: 'thigh_L',
  shin_L: 'shin_L',
  thigh_R: 'thigh_R',
  shin_R: 'shin_R',
};

/** Regions lost along with a severed region (everything below it). */
export const REGION_CHILDREN: Readonly<Record<SeverableRegion, readonly SeverableRegion[]>> = {
  head: [],
  upperArm_L: ['foreArm_L'],
  foreArm_L: [],
  upperArm_R: ['foreArm_R'],
  foreArm_R: [],
  thigh_L: ['shin_L'],
  shin_L: [],
  thigh_R: ['shin_R'],
  shin_R: [],
};

export function limbOf(r: SeverableRegion): Limb {
  if (r === 'head') return 'head';
  const side = r.endsWith('_L') ? 'L' : 'R';
  return r.startsWith('thigh') || r.startsWith('shin') ? `leg_${side}` : `arm_${side}`;
}

export function isSeverable(r: Region): r is SeverableRegion {
  return r !== 'torso';
}

/** Joints in the subtree rooted at `name` (inclusive), in JOINTS order. */
export function subtree(name: JointName): JointName[] {
  const out = new Set<JointName>([name]);
  for (const j of JOINTS) if (j.parent && out.has(j.parent)) out.add(j.name);
  return [...out];
}
