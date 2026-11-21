import * as THREE from 'three';
import { buildStumpParts, STUMP_JOINTS, type BodyGeometry, type ExtraBoneDef, type PartGeometry } from './bodyGeometry.ts';
import type { SurfaceDef } from './bodyMaterial.ts';
import { FINGER_NAMES, type FingerBoneDef, type FingerBoneName, type FingerName, type HandDetailBone, type PhalanxIndex, type TwistBoneDef, type TwistBoneName } from './handPhysics.ts';
import type { TorsoHullDef } from './limbContact.ts';
import { JOINT_INDEX, JOINTS, REFERENCE_HEIGHT, type JointName, type Side, type Vec3T } from './skeleton.ts';

/**
 * Imported character models as humanoid bodies (ADR-0026). A rigged GLB is re-posed into the game's rest
 * pose (standing straight, arms hanging, facing -Z), its bones are mapped onto the 21 game joints and its
 * skin weights folded onto them, and its triangles are split into one piece per joint so severing,
 * hit capsules and the procedural animator work exactly as on procedural bodies.
 *
 * The model's own animations are not used: the procedural animator drives every body.
 * This module is pure three.js (no loading, no DOM) so it runs in node tests.
 */

/** One piece of an imported body: the triangles a joint owns, in that joint's rest space. */
export interface ModelPart {
  joint: JointName;
  surface: string;
  /** `position`, `normal`, `uv`, `skinIndex` (JOINT_INDEX), `skinWeight`; indexed. */
  geometry: THREE.BufferGeometry;
}

export interface PreparedBodyModel {
  parts: ModelPart[];
  /** Parent-relative joint positions at REFERENCE_HEIGHT (feed BodyGeometry.jointOffsets). */
  jointOffsets: Record<JointName, Vec3T>;
  /** Optional preserved finger and forearm-twist bones (indexed at JOINTS.length + k in skinIndex). */
  handBones: HandDetailBone[];
  /** Mesh-fitted elliptical torso hulls (pelvis, spine, chest) measured directly from the GLB vertices. */
  torsoHulls: TorsoHullDef[];
  /** Wound-cap radius per severable joint, measured from the mesh. */
  stumpRadius: Partial<Record<JointName, number>>;
  /** Surface key -> how strongly the infection shader tints it (0 = texture only). */
  surfaceSick: Record<string, number>;
  surfaces: Record<string, SurfaceDef>;
  triangles: number;
  /** Model bones that mapped to nothing and were folded into their parent (for the log). */
  unmapped: string[];
}

export interface PrepareOptions {
  /** Infection tint on opaque surfaces (0..1); cut-out surfaces (hair) are never tinted. Default 0.3. */
  sickTint?: number;
  /** Preserve individual finger and forearm-twist bones for biomechanical hand physics. Default false. */
  detailHands?: boolean;
}

// ---------------------------------------------------------------- bone mapping

interface Classified {
  joint: JointName | null;
  /** Spine bones are split into spine/chest by order once all are known. */
  spine: boolean;
  /** Ends used to aim a hand or foot when straightening. */
  end: 'hand' | 'toe' | null;
}

/** Strip exporter noise: `mixamorig:LeftArm`, `L_Shoulder_32`, `Bip01 L UpperArm`. */
export function normaliseBoneName(name: string): string {
  return name
    .replace(/^mixamorig\d*[:_]?/i, '')
    .replace(/_\d+$/, '')
    .replace(/^bip\d*[\s_]/i, '')
    .toLowerCase();
}

function sideOf(n: string): { side: Side | null; rest: string } {
  const m = /^(left|right|l|r)(?:[\s_.-]+|(?=[a-z]))(.*)$/.exec(n);
  if (m && (m[1]!.length > 1 || /^[\s_.-]/.test(n.slice(1)))) return { side: m[1]!.startsWith('l') ? 'L' : 'R', rest: m[2]! };
  const t = /^(.*?)[\s_.-](left|right|l|r)$/.exec(n);
  if (t) return { side: t[2]!.startsWith('l') ? 'L' : 'R', rest: t[1]! };
  return { side: null, rest: n };
}

function classify(raw: string, hasCollar: Record<Side, boolean>): Classified {
  const { side, rest } = sideOf(normaliseBoneName(raw));
  const none: Classified = { joint: null, spine: false, end: null };
  if (!side) {
    if (/^(hips|pelvis)$/.test(rest)) return { joint: 'pelvis', spine: false, end: null };
    if (/^spine\d*$|^chest$|^upperchest$/.test(rest)) return { joint: 'spine', spine: true, end: null };
    if (/^neck\d*$/.test(rest)) return { joint: 'neck', spine: false, end: null };
    if (/^head/.test(rest)) return { joint: 'head', spine: false, end: null };
    if (/^jaw/.test(rest)) return { joint: 'jaw', spine: false, end: null };
    return none;
  }
  if (/^rib/.test(rest)) return { joint: 'chest', spine: false, end: null };
  if (/collar|clavicle/.test(rest)) return { joint: `shoulder_${side}`, spine: false, end: null };
  if (/^shoulder/.test(rest)) return { joint: hasCollar[side] ? `upperArm_${side}` : `shoulder_${side}`, spine: false, end: null };
  if (/forearm|lowerarm|elbow/.test(rest)) return { joint: `foreArm_${side}`, spine: false, end: null };
  if (/upperarm|^arm$/.test(rest)) return { joint: `upperArm_${side}`, spine: false, end: null };
  if (/middle/.test(rest)) return { joint: `hand_${side}`, spine: false, end: 'hand' };
  if (/hand|wrist|index|ring|pinky|thumb|finger/.test(rest)) return { joint: `hand_${side}`, spine: false, end: null };
  if (/upleg|thigh|^hip$/.test(rest)) return { joint: `thigh_${side}`, spine: false, end: null };
  if (/toe/.test(rest)) return { joint: `foot_${side}`, spine: false, end: 'toe' };
  if (/foot|ankle/.test(rest)) return { joint: `foot_${side}`, spine: false, end: null };
  if (/^leg$|knee|calf|shin|lowerleg/.test(rest)) return { joint: `shin_${side}`, spine: false, end: null };
  return none;
}

interface RigMap {
  /** Game joint per model bone index. */
  jointOf: JointName[];
  /** Model bone index that marks each joint's pivot. */
  pivot: Partial<Record<JointName, number>>;
  handEnd: Partial<Record<Side, number>>;
  toe: Partial<Record<Side, number>>;
  unmapped: string[];
}

function depthOf(b: THREE.Object3D): number {
  let d = 0;
  for (let p = b.parent; p; p = p.parent) d++;
  return d;
}

function mapRig(bones: readonly THREE.Bone[]): RigMap {
  const hasCollar: Record<Side, boolean> = { L: false, R: false };
  for (const b of bones) {
    const { side, rest } = sideOf(normaliseBoneName(b.name));
    if (side && /collar|clavicle/.test(rest)) hasCollar[side] = true;
  }
  const index = new Map(bones.map((b, i) => [b, i]));
  const cls = bones.map((b) => classify(b.name, hasCollar));
  // Spine chain: lower half drives the spine joint, upper half the chest.
  const spineBones = bones.map((b, i) => ({ i, d: depthOf(b) })).filter(({ i }) => cls[i]!.spine).sort((a, b) => a.d - b.d);
  spineBones.forEach(({ i }, k) => {
    cls[i]!.joint = spineBones.length > 1 && k >= Math.floor(spineBones.length / 2) ? 'chest' : 'spine';
  });
  const jointOf: JointName[] = [];
  const unmapped: string[] = [];
  const order = bones.map((b, i) => ({ i, d: depthOf(b) })).sort((a, b) => a.d - b.d);
  for (const { i } of order) {
    const own = cls[i]!.joint;
    if (own) {
      jointOf[i] = own;
      continue;
    }
    // Unmapped (root, twist, helper): follow the parent bone, or the pelvis at the top.
    const parent = bones[i]!.parent;
    const pi = parent instanceof THREE.Bone ? index.get(parent) : undefined;
    jointOf[i] = pi !== undefined && jointOf[pi] ? jointOf[pi]! : 'pelvis';
    unmapped.push(bones[i]!.name);
  }
  const pivot: Partial<Record<JointName, number>> = {};
  const handEnd: Partial<Record<Side, number>> = {};
  const toe: Partial<Record<Side, number>> = {};
  for (const { i } of order) {
    const c = cls[i]!;
    if (c.joint && pivot[c.joint] === undefined) pivot[c.joint] = i;
    const side = c.joint?.endsWith('_L') ? 'L' : 'R';
    if (c.end === 'hand' && handEnd[side] === undefined) handEnd[side] = i;
    if (c.end === 'toe' && toe[side] === undefined) toe[side] = i;
  }
  return { jointOf, pivot, handEnd, toe, unmapped };
}

// ---------------------------------------------------------------- re-posing

const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);
/** Ankle to ball of the foot in the rest pose: down and forward. */
const TOE_DIR = new THREE.Vector3(0, -0.45, -0.89).normalize();

class Poser {
  /** Bind-pose world matrix per bone, and the accumulated re-pose transform applied to it. */
  readonly bind: THREE.Matrix4[];
  readonly deform: THREE.Matrix4[];
  private readonly children: number[][];

  constructor(bones: readonly THREE.Bone[], boneInverses: readonly THREE.Matrix4[]) {
    this.bind = boneInverses.map((m) => m.clone().invert());
    this.deform = bones.map(() => new THREE.Matrix4());
    const index = new Map(bones.map((b, i) => [b, i]));
    this.children = bones.map(() => []);
    bones.forEach((b, i) => {
      // Nearest ancestor that is a skinned bone (helpers in between are skipped).
      for (let p = b.parent; p; p = p.parent) {
        const pi = index.get(p as THREE.Bone);
        if (pi !== undefined) {
          this.children[pi]!.push(i);
          break;
        }
      }
    });
  }

  pos(i: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.setFromMatrixPosition(this.bind[i]!).applyMatrix4(this.deform[i]!);
  }

  subtree(i: number): number[] {
    const out = [i];
    for (let k = 0; k < out.length; k++) out.push(...this.children[out[k]!]!);
    return out;
  }

  applyAll(m: THREE.Matrix4): void {
    for (const d of this.deform) d.premultiply(m);
  }

  /** Rotate bone `i` (and everything below it) about its pivot so the direction to `end` becomes `dir`. */
  aim(i: number | undefined, end: number | undefined, dir: THREE.Vector3): void {
    if (i === undefined || end === undefined || i === end) return;
    const p = this.pos(i);
    const cur = this.pos(end).sub(p);
    if (cur.lengthSq() < 1e-10) return;
    const q = new THREE.Quaternion().setFromUnitVectors(cur.normalize(), dir.clone().normalize());
    const g = new THREE.Matrix4()
      .makeTranslation(p.x, p.y, p.z)
      .multiply(new THREE.Matrix4().makeRotationFromQuaternion(q))
      .multiply(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
    for (const k of this.subtree(i)) this.deform[k]!.premultiply(g);
  }
}

// ---------------------------------------------------------------- prepare

interface Vert {
  p: THREE.Vector3;
  n: THREE.Vector3;
  uv: [number, number];
  joints: Array<[number, number]>; // [JOINT_INDEX, weight], heaviest first, max 4
}

/**
 * Re-pose, re-rig and split a loaded model (the GLTF scene). Needs at least one SkinnedMesh with a
 * humanoid skeleton: hips/pelvis, spine, neck, head, both arms and both legs.
 */
export function prepareBodyModel(root: THREE.Object3D, opts: PrepareOptions = {}): PreparedBodyModel {
  root.updateMatrixWorld(true);
  const meshes: THREE.SkinnedMesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh);
  });
  const first = meshes[0];
  if (!first) throw new Error('body model: no skinned mesh (is it rigged?)');
  const bones = first.skeleton.bones;
  const rig = mapRig(bones);
  const need: JointName[] = ['pelvis', 'spine', 'neck', 'head', 'upperArm_L', 'foreArm_L', 'hand_L', 'upperArm_R', 'foreArm_R', 'hand_R', 'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R'];
  const missing = need.filter((j) => rig.pivot[j] === undefined);
  if (missing.length) throw new Error(`body model: no bones for ${missing.join(', ')}`);
  const pv = rig.pivot as Record<JointName, number>;

  const poser = new Poser(bones, first.skeleton.boneInverses);

  // Face -Z with the left side at -X (ADR-0001): right = left hip -> right hip, forward = up x right.
  const right = poser.pos(pv.thigh_R).sub(poser.pos(pv.thigh_L));
  right.y = 0;
  if (right.lengthSq() < 1e-10) throw new Error('body model: hips overlap');
  const forward = new THREE.Vector3().crossVectors(UP, right.normalize());
  const yaw = Math.atan2(-forward.x, -forward.z);
  poser.applyAll(new THREE.Matrix4().makeRotationY(-yaw));

  // Stand it up straight: spine vertical, then each limb hanging (arms slightly out from the hips).
  poser.aim(pv.spine, pv.neck, UP);
  for (const s of ['L', 'R'] as const) {
    const out = s === 'L' ? -1 : 1;
    const armDir = new THREE.Vector3(out * 0.06, -1, 0);
    poser.aim(pv[`upperArm_${s}`], pv[`foreArm_${s}`], armDir);
    poser.aim(pv[`foreArm_${s}`], pv[`hand_${s}`], armDir);
    poser.aim(pv[`hand_${s}`], rig.handEnd[s], DOWN);
    poser.aim(pv[`thigh_${s}`], pv[`shin_${s}`], DOWN);
    poser.aim(pv[`shin_${s}`], pv[`foot_${s}`], DOWN);
    poser.aim(pv[`foot_${s}`], rig.toe[s], TOE_DIR);
  }

  // Optional detail hand rig: preserve individual finger and forearm-twist bones for main cast models.
  const skinSlotOf: number[] = bones.map((_, i) => JOINT_INDEX[rig.jointOf[i]!]);
  const slotOwner: JointName[] = JOINTS.map((j) => j.name);
  interface PendingTwist {
    boneIdx: number;
    side: Side;
    name: TwistBoneName;
    fraction: number;
    slot: number;
  }
  interface PendingFinger {
    boneIdx: number;
    tipBoneIdx: number | null;
    side: Side;
    finger: FingerName;
    phalanx: PhalanxIndex;
    name: FingerBoneName;
    parent: JointName | FingerBoneName;
    slot: number;
  }
  const pendingTwists: PendingTwist[] = [];
  const pendingFingers: PendingFinger[] = [];

  if (opts.detailHands) {
    const fingerLetter: Record<string, number> = { a: 1, b: 2, c: 3, d: 4 };
    const fingerGroups: Record<Side, Record<FingerName, Array<{ i: number; ord: number; depth: number }>>> = {
      L: { thumb: [], index: [], middle: [], ring: [], pinky: [] },
      R: { thumb: [], index: [], middle: [], ring: [], pinky: [] },
    };
    const twistCandidates: Record<Side, Array<{ i: number; t: number }>> = { L: [], R: [] };

    for (let i = 0; i < bones.length; i++) {
      const { side, rest } = sideOf(normaliseBoneName(bones[i]!.name));
      if (!side) continue;
      // Forearm twist bones: ForearmTwist01/02 (CC/doctor) or ForeArm1/2 (Mixamo/priya/hale).
      if (i !== pv[`foreArm_${side}`] && /^forearm(?:twist)?\d+$/.test(rest)) {
        const pA = poser.pos(pv[`foreArm_${side}`]);
        const pB = poser.pos(pv[`hand_${side}`]);
        const seg = pB.clone().sub(pA);
        const lenSq = seg.lengthSq();
        if (lenSq > 1e-8) {
          const t = poser.pos(i).sub(pA).dot(seg) / lenSq;
          if (t > 0.05 && t < 0.95) twistCandidates[side].push({ i, t });
        }
        continue;
      }
      const fm = /^(?:hand)?(thumb|index|middle|ring|pinky|little)([1-4]|[a-d])$/.exec(rest);
      if (!fm) continue;
      const fName = (fm[1] === 'little' ? 'pinky' : fm[1]) as FingerName;
      const ord = fingerLetter[fm[2]!] ?? Number(fm[2]);
      fingerGroups[side][fName].push({ i, ord, depth: depthOf(bones[i]!) });
    }

    for (const s of ['L', 'R'] as const) {
      // Forearm twists (up to 2 per arm, ordered elbow -> wrist).
      const twists = twistCandidates[s].sort((a, b) => a.t - b.t).slice(0, 2);
      twists.forEach((tw, k) => {
        const slot = slotOwner.length;
        const name: TwistBoneName = `twist_foreArm_${s}_${k}`;
        slotOwner.push(`foreArm_${s}`);
        skinSlotOf[tw.i] = slot;
        pendingTwists.push({ boneIdx: tw.i, side: s, name, fraction: THREE.MathUtils.clamp(tw.t, 0.15, 0.85), slot });
      });

      // Only build a finger rig if the hand actually carries multi-phalanx fingers (skip 24-joint mitten rigs).
      const multiCount = FINGER_NAMES.filter((fn) => fingerGroups[s][fn].length >= 2).length;
      if (multiCount < 3) continue;

      const pHand = poser.pos(pv[`hand_${s}`]);
      const midList = fingerGroups[s].middle.sort((a, b) => a.ord - b.ord || a.depth - b.depth);
      const idxList = fingerGroups[s].index.sort((a, b) => a.ord - b.ord || a.depth - b.depth);
      const refIdx = midList[0]?.i ?? idxList[0]?.i;
      const refDist = refIdx !== undefined ? poser.pos(refIdx).distanceTo(pHand) : 0.08;

      for (const fn of FINGER_NAMES) {
        let list = fingerGroups[s][fn].sort((a, b) => a.ord - b.ord || a.depth - b.depth);
        if (list.length === 0) continue;
        // Detect metacarpal bone inside the palm (e.g. mechanic.glb's Ring1 near the wrist): fold it into hand.
        if (fn !== 'thumb' && list.length >= 4 && poser.pos(list[0]!.i).distanceTo(pHand) < refDist * 0.45) {
          list = list.slice(1);
        }
        const kept = list.slice(0, 3);
        const extraTips = list.slice(3);
        let prevSlot = JOINT_INDEX[`hand_${s}`];
        kept.forEach((item, idx) => {
          const phalanx = (idx + 1) as PhalanxIndex;
          const slot = slotOwner.length;
          const name: FingerBoneName = `finger_${s}_${fn}_${phalanx}`;
          const parent: JointName | FingerBoneName = phalanx === 1 ? `hand_${s}` : `finger_${s}_${fn}_${(phalanx - 1) as PhalanxIndex}`;
          slotOwner.push(`hand_${s}`);
          skinSlotOf[item.i] = slot;
          prevSlot = slot;
          pendingFingers.push({
            boneIdx: item.i,
            tipBoneIdx: phalanx === kept.length && extraTips[0] ? extraTips[0].i : null,
            side: s,
            finger: fn,
            phalanx,
            name,
            parent,
            slot,
          });
        });
        // Any trailing tip-end bones (e.g. *4 on Mixamo) follow phalanx 3 cleanly.
        for (const tip of extraTips) skinSlotOf[tip.i] = prevSlot;
      }
    }
  }

  // Skin every vertex into the new pose and fold its weights onto game joints (plus optional detail hand slots).
  const tris: Array<{ v: [Vert, Vert, Vert]; surface: string }> = [];
  const surfaces: Record<string, SurfaceDef> = {};
  const surfaceSick: Record<string, number> = {};
  const sick = opts.sickTint ?? 0.3;
  const used = new Set<string>();
  const surfaceOf = new Map<THREE.Material, string>();
  const tmpP = new THREE.Vector3();
  const tmpN = new THREE.Vector3();
  const acc = new THREE.Vector3();
  const accN = new THREE.Vector3();
  for (const mesh of meshes) {
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial | undefined;
    if (!mat) continue;
    let key = surfaceOf.get(mat);
    if (!key) {
      // 'body' and 'wet' name the procedural layers in humanoid.ts.
      const clean = (mat.name || 'surface').replace(/[^\w-]+/g, '_');
      const base = clean === 'body' || clean === 'wet' ? `model_${clean}` : clean;
      key = base;
      for (let k = 2; used.has(key); k++) key = `${base}_${k}`;
      used.add(key);
      surfaceOf.set(mat, key);
      const cutout = mat.transparent || mat.alphaTest > 0;
      surfaces[key] = {
        map: mat.map ?? null,
        normalMap: mat.normalMap ?? null,
        color: mat.color ? mat.color.clone() : new THREE.Color(1, 1, 1),
        alphaTest: cutout ? Math.max(mat.alphaTest, 0.4) : 0,
        doubleSided: cutout || mat.side === THREE.DoubleSide,
        roughness: THREE.MathUtils.clamp(mat.roughness ?? 0.8, 0.45, 1),
      };
      surfaceSick[key] = cutout ? 0 : sick;
    }
    // This mesh's bone order and inverseBindMatrices may differ from the reference skeleton's
    // (e.g. KHR_mesh_quantization creates one skin per sub-mesh with per-mesh dequantization in IBM).
    const boneIdx = mesh.skeleton.bones.map((b) => bones.indexOf(b));
    const meshMats = mesh.skeleton.bones.map((_, i) => {
      const b = boneIdx[i] ?? -1;
      if (b < 0) return new THREE.Matrix4();
      return poser.deform[b]!.clone().multiply(poser.bind[b]!).multiply(mesh.skeleton.boneInverses[i]!);
    });
    const meshNormMats = meshMats.map((m) => new THREE.Matrix3().getNormalMatrix(m));
    const geo = mesh.geometry;
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    const uv = geo.getAttribute('uv');
    const si = geo.getAttribute('skinIndex');
    const sw = geo.getAttribute('skinWeight');
    if (!pos || !si || !sw) continue;
    const bindM = mesh.bindMatrix;
    const bindN = new THREE.Matrix3().getNormalMatrix(bindM);
    const verts: Vert[] = [];
    for (let v = 0; v < pos.count; v++) {
      tmpP.fromBufferAttribute(pos, v).applyMatrix4(bindM);
      if (nor) tmpN.fromBufferAttribute(nor, v).applyMatrix3(bindN);
      else tmpN.set(0, 1, 0);
      acc.set(0, 0, 0);
      accN.set(0, 0, 0);
      const byJoint = new Map<number, number>();
      let total = 0;
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(v, k);
        if (w <= 0) continue;
        const mi = si.getComponent(v, k);
        const b = boneIdx[mi] ?? -1;
        if (b < 0) continue;
        acc.addScaledVector(tmpP.clone().applyMatrix4(meshMats[mi]!), w);
        accN.addScaledVector(tmpN.clone().applyMatrix3(meshNormMats[mi]!), w);
        const j = skinSlotOf[b] ?? JOINT_INDEX[rig.jointOf[b]!];
        byJoint.set(j, (byJoint.get(j) ?? 0) + w);
        total += w;
      }
      if (total <= 0) {
        acc.copy(tmpP);
        accN.copy(tmpN);
        byJoint.set(JOINT_INDEX.pelvis, 1);
        total = 1;
      } else {
        acc.divideScalar(total);
      }
      const joints = [...byJoint.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const sum = joints.reduce((s, [, w]) => s + w, 0);
      verts.push({
        p: acc.clone(),
        n: accN.lengthSq() > 0 ? accN.clone().normalize() : new THREE.Vector3(0, 1, 0),
        uv: uv ? [uv.getX(v), uv.getY(v)] : [0, 0],
        joints: joints.map(([j, w]) => [j, w / sum] as [number, number]),
      });
    }
    const index = geo.getIndex();
    const count = index ? index.count : pos.count;
    for (let t = 0; t + 2 < count; t += 3) {
      const a = index ? index.getX(t) : t;
      const b = index ? index.getX(t + 1) : t + 1;
      const c = index ? index.getX(t + 2) : t + 2;
      tris.push({ v: [verts[a]!, verts[b]!, verts[c]!], surface: key });
    }
  }
  if (tris.length === 0) throw new Error('body model: no triangles');

  // Normalise: feet on the floor, pelvis over the origin, REFERENCE_HEIGHT tall (hair included).
  const box = new THREE.Box3();
  for (const t of tris) for (const v of t.v) box.expandByPoint(v.p);
  const scale = REFERENCE_HEIGHT / (box.max.y - box.min.y);
  const pelvis = poser.pos(pv.pelvis);
  const norm = new THREE.Matrix4()
    .makeScale(scale, scale, scale)
    .multiply(new THREE.Matrix4().makeTranslation(-pelvis.x, -box.min.y, -pelvis.z));
  const done = new Set<Vert>();
  for (const t of tris) {
    for (const v of t.v) {
      if (done.has(v)) continue;
      done.add(v);
      v.p.applyMatrix4(norm);
    }
  }

  // Joint rest positions (world), then parent-relative offsets.
  const world = {} as Record<JointName, THREE.Vector3>;
  const at = (j: JointName): THREE.Vector3 | null => {
    const i = rig.pivot[j];
    return i === undefined ? null : poser.pos(i).applyMatrix4(norm);
  };
  for (const j of JOINTS) {
    const p = at(j.name);
    if (p) {
      world[j.name] = p;
      continue;
    }
    // Missing in the model (no collar or jaw bone): reference offset from the parent.
    const parent = j.parent ? world[j.parent] : new THREE.Vector3();
    world[j.name] = (parent ?? new THREE.Vector3()).clone().add(new THREE.Vector3(...j.offset));
  }
  world.root = new THREE.Vector3();
  const jointOffsets = {} as Record<JointName, Vec3T>;
  for (const j of JOINTS) {
    const p = world[j.name];
    const parent = j.parent ? world[j.parent] : new THREE.Vector3();
    const d = p.clone().sub(parent ?? new THREE.Vector3());
    jointOffsets[j.name] = [d.x, d.y, d.z];
  }

  // Build calibrated HandDetailBone descriptors (forearm twists + fingers) in normalized rest space.
  const handBones: HandDetailBone[] = [];
  if (pendingTwists.length > 0 || pendingFingers.length > 0) {
    const posNorm = (i: number): THREE.Vector3 => poser.pos(i).applyMatrix4(norm);
    const fingerWorld = new Map<string, THREE.Vector3>();
    for (const pf of pendingFingers) fingerWorld.set(pf.name, posNorm(pf.boneIdx));

    // Per-side anatomical frame derived directly from normalized knuckle & middle-finger geometry.
    const handFrame: Record<Side, { palmNormal: THREE.Vector3; across: THREE.Vector3; splayAxis: THREE.Vector3; handDown: THREE.Vector3 }> = {
      L: {
        palmNormal: new THREE.Vector3(1, 0, 0),
        across: new THREE.Vector3(0, 0, 1),
        splayAxis: new THREE.Vector3(1, 0, 0),
        handDown: new THREE.Vector3(0, -1, 0),
      },
      R: {
        palmNormal: new THREE.Vector3(-1, 0, 0),
        across: new THREE.Vector3(0, 0, 1),
        splayAxis: new THREE.Vector3(1, 0, 0),
        handDown: new THREE.Vector3(0, -1, 0),
      },
    };

    for (const s of ['L', 'R'] as const) {
      const pIdx = fingerWorld.get(`finger_${s}_index_1`);
      const pPnk = fingerWorld.get(`finger_${s}_pinky_1`) ?? fingerWorld.get(`finger_${s}_ring_1`);
      const pMid1 = fingerWorld.get(`finger_${s}_middle_1`) ?? pIdx;
      const pMid2 = fingerWorld.get(`finger_${s}_middle_2`) ?? fingerWorld.get(`finger_${s}_index_2`);
      const f = handFrame[s];
      if (pIdx && pPnk && pIdx.distanceToSquared(pPnk) > 1e-8) {
        f.across.copy(pPnk).sub(pIdx).normalize();
      }
      if (pMid1 && pMid2 && pMid1.distanceToSquared(pMid2) > 1e-8) {
        f.handDown.copy(pMid2).sub(pMid1).normalize();
      }
      // Left hand: across (+Z) x down (-Y) = +X (palm inward). Right hand: down (-Y) x across (+Z) = -X (palm inward).
      if (s === 'L') f.palmNormal.crossVectors(f.across, f.handDown);
      else f.palmNormal.crossVectors(f.handDown, f.across);
      if (f.palmNormal.lengthSq() > 1e-6) f.palmNormal.normalize();
      else f.palmNormal.set(s === 'L' ? 1 : -1, 0, 0);
      // splayAxis: +angle swings finger toward index (-across) on both hands.
      f.splayAxis.crossVectors(f.across, f.handDown);
      if (f.splayAxis.lengthSq() > 1e-6) f.splayAxis.normalize();
      else f.splayAxis.set(1, 0, 0);
    }

    // Hands whose finger bones exist in the skeleton but carry (almost) no painted vertex weight are auto-skinned further down
    // (e.g. mechanic.glb, where every hand vertex was left on Hand). A hand qualifies when fewer than half its finger bones carry
    // painted skin, so a partly painted hand is repaired too, while a fully painted one with a few thin phalanges is left alone.
    const fingerSlotsBySide: Record<Side, Set<number>> = { L: new Set(), R: new Set() };
    const slotByBoneName = new Map<string, number>();
    for (const pf of pendingFingers) {
      fingerSlotsBySide[pf.side].add(pf.slot);
      slotByBoneName.set(pf.name, pf.slot);
    }
    const paintedPerSlot = new Map<number, number>();
    const seenVerts = new Set<Vert>();
    for (const t of tris) {
      for (const v of t.v) {
        if (seenVerts.has(v)) continue;
        seenVerts.add(v);
        for (const [slot, w] of v.joints) {
          if (w >= 0.15 && (fingerSlotsBySide.L.has(slot) || fingerSlotsBySide.R.has(slot))) {
            paintedPerSlot.set(slot, (paintedPerSlot.get(slot) ?? 0) + 1);
          }
        }
      }
    }
    const autoSkin: Record<Side, boolean> = { L: false, R: false };
    for (const s of ['L', 'R'] as const) {
      const slots = [...fingerSlotsBySide[s]];
      const painted = slots.filter((slot) => (paintedPerSlot.get(slot) ?? 0) >= 3).length;
      autoSkin[s] = slots.length > 0 && painted * 2 < slots.length;
    }

    // An unpainted hand's bones were never fitted to its skin either: mechanic.glb models the fingers in a relaxed curl, the tips
    // 4-6 cm palm-ward of its straight finger bones. Re-trace each finger's chain through the skin, keeping the knuckle and each
    // phalanx's length: from each joint, the next one sits on the centreline of the finger's skin one phalanx further on (the
    // centroid of the finger's vertices in a thin shell round the joint). The bones then lie inside the fingers, their rest curl
    // is measured below as a baked curl, and the auto-skin binds each finger's strip to its own chain.
    const fittedTip = new Map<FingerBoneName, THREE.Vector3>();
    for (const s of ['L', 'R'] as const) {
      if (!autoSkin[s]) continue;
      const handSlot = JOINT_INDEX[`hand_${s}`];
      const handPos = world[`hand_${s}`];
      const f = handFrame[s];
      const handVerts: Vert[] = [];
      for (const v of seenVerts) {
        if ((v.joints.find(([j]) => j === handSlot)?.[1] ?? 0) >= 0.5 && v.p.distanceTo(handPos) < 0.25) handVerts.push(v);
      }
      // Non-thumb fingers keep to a lane across the hand (the curl swings a finger within its own lane).
      const laneOf = (p: THREE.Vector3): number => p.clone().sub(handPos).dot(f.across);
      const lanes = FINGER_NAMES.filter((fn) => fn !== 'thumb' && fingerWorld.has(`finger_${s}_${fn}_1`)).map((fn) => ({
        fn,
        c: laneOf(fingerWorld.get(`finger_${s}_${fn}_1`)!),
      }));
      lanes.sort((a, b) => a.c - b.c);
      const spacing = lanes.length > 1 ? Math.abs(lanes[lanes.length - 1]!.c - lanes[0]!.c) / (lanes.length - 1) : 0.02;
      for (const fn of FINGER_NAMES) {
        const chain: Array<{ name: FingerBoneName; p: THREE.Vector3 }> = [];
        for (let k = 1; k <= 3; k++) {
          const name = `finger_${s}_${fn}_${k as PhalanxIndex}` as FingerBoneName;
          const p = fingerWorld.get(name);
          if (!p) break;
          chain.push({ name, p });
        }
        if (chain.length < 2) continue;
        const last = pendingFingers.find((pf) => pf.name === chain[chain.length - 1]!.name)!;
        const pts = chain.map((c) => c.p.clone());
        const prev = pts[pts.length - 1]!.clone().sub(pts[pts.length - 2]!);
        pts.push(last.tipBoneIdx !== null ? posNorm(last.tipBoneIdx) : pts[pts.length - 1]!.clone().addScaledVector(prev, 0.75));
        const li = lanes.findIndex((l) => l.fn === fn);
        const lo = li < 0 ? -Infinity : li === 0 ? lanes[0]!.c - spacing * 0.6 : (lanes[li - 1]!.c + lanes[li]!.c) / 2;
        const hi = li < 0 ? Infinity : li === lanes.length - 1 ? lanes[li]!.c + spacing * 0.6 : (lanes[li]!.c + lanes[li + 1]!.c) / 2;
        const own = handVerts.filter((v) => {
          const a = laneOf(v.p);
          return a >= lo && a <= hi;
        });
        const cone = Math.cos(fn === 'thumb' ? 0.8 : 1.05);
        const joint = pts[0]!.clone();
        const dir = pts[1]!.clone().sub(pts[0]!).normalize();
        const fitted: THREE.Vector3[] = [joint.clone()];
        const d = new THREE.Vector3();
        for (let k = 1; k < pts.length; k++) {
          const len = pts[k]!.distanceTo(pts[k - 1]!);
          const band = Math.max(0.004, len * 0.25);
          const c = new THREE.Vector3();
          let n = 0;
          for (const v of own) {
            d.subVectors(v.p, joint);
            const r = d.length();
            if (Math.abs(r - len) > band || d.dot(dir) < cone * r) continue;
            c.add(v.p);
            n++;
          }
          if (n >= 4) {
            const next = c.divideScalar(n).sub(joint);
            if (next.lengthSq() > 1e-8) dir.copy(next.normalize());
          }
          joint.addScaledVector(dir, len);
          fitted.push(joint.clone());
        }
        chain.forEach((c, k) => fingerWorld.set(c.name, fitted[k]!));
        fittedTip.set(chain[chain.length - 1]!.name, fitted[fitted.length - 1]!);
      }
    }

    // Emit in exact slot order (JOINTS.length + k) so ExtraBone indices match skinIndex 1:1.
    const bySlot = new Map<number, HandDetailBone>();
    for (const tw of pendingTwists) {
      const p = posNorm(tw.boneIdx);
      const parentPos = world[`foreArm_${tw.side}`];
      const d = p.sub(parentPos);
      const def: TwistBoneDef = {
        kind: 'twist',
        name: tw.name,
        parent: `foreArm_${tw.side}`,
        offset: [d.x, d.y, d.z],
        side: tw.side,
        fraction: tw.fraction,
      };
      bySlot.set(tw.slot, def);
    }
    for (const pf of pendingFingers) {
      const cur = fingerWorld.get(pf.name)!;
      const parentPos = pf.phalanx === 1 ? world[`hand_${pf.side}`] : fingerWorld.get(pf.parent)!;
      const off = cur.clone().sub(parentPos);
      const nextPos =
        fittedTip.get(pf.name) ??
        (pf.phalanx < 3
          ? fingerWorld.get(`finger_${pf.side}_${pf.finger}_${(pf.phalanx + 1) as PhalanxIndex}`)
          : pf.tipBoneIdx !== null
            ? posNorm(pf.tipBoneIdx)
            : undefined);
      const f = handFrame[pf.side];
      const prevDir = cur.clone().sub(parentPos);
      if (prevDir.lengthSq() > 1e-8) prevDir.normalize();
      else prevDir.copy(f.handDown);
      const segDir = nextPos && nextPos.distanceToSquared(cur) > 1e-8 ? nextPos.clone().sub(cur).normalize() : prevDir.clone();

      const curlAxis = new THREE.Vector3();
      const splayAxis = new THREE.Vector3();
      if (pf.finger === 'thumb') {
        // Thumb opposes inward into the palm and across toward ring/pinky.
        const thumbIn = f.palmNormal.clone().multiplyScalar(0.72).addScaledVector(f.across, 0.69).normalize();
        curlAxis.crossVectors(segDir, thumbIn);
        if (curlAxis.lengthSq() > 1e-6) curlAxis.normalize();
        else curlAxis.crossVectors(f.handDown, f.palmNormal).normalize();
        const thumbOut = f.palmNormal.clone().multiplyScalar(-0.35).addScaledVector(f.across, -0.94).normalize();
        splayAxis.crossVectors(segDir, thumbOut);
        if (splayAxis.lengthSq() > 1e-6) splayAxis.normalize();
        else splayAxis.copy(f.splayAxis);
      } else {
        // segDir x palmNormal guarantees (+angle around curlAxis) sweeps segDir toward +palmNormal.
        curlAxis.crossVectors(segDir, f.palmNormal);
        if (curlAxis.lengthSq() > 1e-6) curlAxis.normalize();
        else curlAxis.crossVectors(f.handDown, f.palmNormal).normalize();
        splayAxis.copy(f.splayAxis);
      }

      // Measure any pre-baked curl already present in the GLB bind pose so we don't double-curl.
      let restCurl = 0;
      if (pf.phalanx > 1 || pf.finger !== 'thumb') {
        const cross = new THREE.Vector3().crossVectors(prevDir, segDir);
        const sinA = cross.dot(curlAxis);
        const cosA = THREE.MathUtils.clamp(prevDir.dot(segDir), -1, 1);
        const signed = Math.atan2(sinA, cosA);
        const cap = pf.phalanx === 1 ? (pf.finger === 'thumb' ? 0 : 0.35) : 0.65;
        restCurl = THREE.MathUtils.clamp(signed, 0, cap);
      }

      const def: FingerBoneDef = {
        kind: 'finger',
        name: pf.name,
        parent: pf.parent,
        offset: [off.x, off.y, off.z],
        side: pf.side,
        finger: pf.finger,
        phalanx: pf.phalanx,
        curlAxis: [curlAxis.x, curlAxis.y, curlAxis.z],
        splayAxis: [splayAxis.x, splayAxis.y, splayAxis.z],
        restCurl,
      };
      bySlot.set(pf.slot, def);
    }
    for (let slot = JOINTS.length; slot < slotOwner.length; slot++) {
      const def = bySlot.get(slot);
      if (def) handBones.push(def);
    }

    // Fallback auto-skinning for the hands picked out above, against their re-traced finger chains.
    for (const s of ['L', 'R'] as const) {
      if (!autoSkin[s]) continue;
      const handSlot = JOINT_INDEX[`hand_${s}`];
      interface Seg {
        finger: FingerName;
        phalanx: PhalanxIndex;
        slot: number;
        parentSlot: number;
        nextSlot: number | null;
        a: THREE.Vector3;
        b: THREE.Vector3;
        knuckle: THREE.Vector3;
        dir: THREE.Vector3;
      }
      const segs: Seg[] = [];
      for (const fn of FINGER_NAMES) {
        const p1 = fingerWorld.get(`finger_${s}_${fn}_1`);
        const p2 = fingerWorld.get(`finger_${s}_${fn}_2`);
        const p3 = fingerWorld.get(`finger_${s}_${fn}_3`);
        if (!p1 || !p2) continue;
        const s1 = slotByBoneName.get(`finger_${s}_${fn}_1`);
        const s2 = slotByBoneName.get(`finger_${s}_${fn}_2`);
        const s3 = slotByBoneName.get(`finger_${s}_${fn}_3`);
        if (s1 === undefined || s2 === undefined) continue;
        const baseDir = p2.clone().sub(p1).normalize();
        segs.push({ finger: fn, phalanx: 1, slot: s1, parentSlot: handSlot, nextSlot: s2, a: p1, b: p2, knuckle: p1, dir: baseDir });
        if (p3 && s3 !== undefined) {
          const tip = fittedTip.get(`finger_${s}_${fn}_3`) ?? p3.clone().addScaledVector(p3.clone().sub(p2), 0.75);
          segs.push({ finger: fn, phalanx: 2, slot: s2, parentSlot: s1, nextSlot: s3, a: p2, b: p3, knuckle: p1, dir: baseDir });
          segs.push({ finger: fn, phalanx: 3, slot: s3, parentSlot: s2, nextSlot: null, a: p3, b: tip, knuckle: p1, dir: baseDir });
        } else {
          const tip = fittedTip.get(`finger_${s}_${fn}_2`) ?? p2.clone().addScaledVector(p2.clone().sub(p1), 0.75);
          segs.push({ finger: fn, phalanx: 2, slot: s2, parentSlot: s1, nextSlot: null, a: p2, b: tip, knuckle: p1, dir: baseDir });
        }
      }
      const REACH = 0.026; // skin further than this from every finger segment stays on the hand
      const WEB_BLEND = 0.024; // a vertex this much nearer its own finger than the next takes no share of the next
      // Smoothing of each vertex's finger shares (below): passes, and how far each pass moves a share toward its neighbours' mean.
      // Twelve half-steps spread a share over about four edges, enough for mechanic.glb's webbed fingers to curl one at a time.
      const SMOOTH_PASSES = 12;
      const SMOOTH_RATE = 0.5;
      const ab = new THREE.Vector3();
      const ap = new THREE.Vector3();
      const closest = new THREE.Vector3();
      // A vertex's weights along one finger's chain: its phalanx, eased into the neighbouring joints near each end.
      const chainWeights = (seg: Seg, u: number, along: number): Array<[number, number]> => {
        if (seg.phalanx === 1 && along < 0) {
          const t = THREE.MathUtils.clamp((along + 0.012) / 0.012, 0, 1);
          return [[seg.slot, t], [handSlot, 1 - t]];
        }
        if (u < 0.25) {
          const t = 0.5 + (u / 0.25) * 0.5;
          return [[seg.slot, t], [seg.parentSlot, 1 - t]];
        }
        if (u > 0.75 && seg.nextSlot !== null) {
          const t = ((u - 0.75) / 0.25) * 0.5;
          return [[seg.slot, 1 - t], [seg.nextSlot, t]];
        }
        return [[seg.slot, 1]];
      };
      // Each hand vertex's weights are a mix of profiles: for each finger, its weights along that finger's chain at the vertex
      // (above), and for 'hand', what the model painted. The shares of the mix start on the vertex's own finger (or the hand) and
      // are then smoothed over the surface; skin far from every finger keeps the painted weights and anchors the smoothing.
      type Owner = FingerName | 'hand';
      interface Node {
        verts: Vert[];
        free: boolean;
        profile: Map<Owner, Array<[number, number]>>;
        share: Map<Owner, number>;
      }
      // Coincident vertices (UV seams) are one node, so they move as one.
      const keyOf = (p: THREE.Vector3): string => `${Math.round(p.x / 1e-4)},${Math.round(p.y / 1e-4)},${Math.round(p.z / 1e-4)}`;
      const nodes = new Map<string, Node>();
      for (const v of seenVerts) {
        const handW = v.joints.find(([j]) => j === handSlot)?.[1] ?? 0;
        if (handW < 0.5) continue;
        const key = keyOf(v.p);
        const known = nodes.get(key);
        if (known) {
          known.verts.push(v);
          continue;
        }
        const node: Node = { verts: [v], free: false, profile: new Map([['hand', v.joints]]), share: new Map([['hand', 1]]) };
        nodes.set(key, node);
        // The nearest segment of each finger.
        const nearest = new Map<FingerName, { seg: Seg; d: number; u: number }>();
        for (const seg of segs) {
          ab.subVectors(seg.b, seg.a);
          const lenSq = ab.lengthSq();
          if (lenSq < 1e-8) continue;
          ap.subVectors(v.p, seg.a);
          const u = THREE.MathUtils.clamp(ap.dot(ab) / lenSq, 0, 1);
          closest.copy(seg.a).addScaledVector(ab, u);
          const d = v.p.distanceTo(closest);
          const cur = nearest.get(seg.finger);
          if (!cur || d < cur.d) nearest.set(seg.finger, { seg, d, u });
        }
        const ranked = [...nearest.values()].sort((a, b) => a.d - b.d);
        const first = ranked[0];
        if (!first || first.d >= REACH * 1.5) continue;
        node.free = true;
        for (const [fn, n] of nearest) node.profile.set(fn, chainWeights(n.seg, n.u, v.p.clone().sub(n.seg.knuckle).dot(n.seg.dir)));
        if (first.d >= REACH || v.p.clone().sub(first.seg.knuckle).dot(first.seg.dir) < -0.012) continue;
        // Scan fingers are often joined by a web of skin. A vertex about as near the next finger as its own shares the two
        // fingers (half and half on the midline), so curling one finger alone stretches the web instead of tearing it.
        const second = ranked[1];
        const share = second && second.d < REACH ? 0.5 * THREE.MathUtils.clamp(1 - (second.d - first.d) / WEB_BLEND, 0, 1) : 0;
        node.share = new Map<Owner, number>([[first.seg.finger, 1 - share]]);
        if (share > 0) node.share.set(second!.seg.finger, share);
      }
      // Smooth the shares over the hand's surface. Wherever the scan's skin joins two parts that move apart (a finger web, a thumb
      // modelled lying against the palm) a hard step would tear the edge across it; a few passes spread each step over several
      // edges. Only the shares are smoothed, never the profiles, so a phalanx's skin does not bleed along the finger into the next.
      const neighbours = new Map<Node, Set<Node>>();
      for (const t of tris) {
        const ns = t.v.map((v) => nodes.get(keyOf(v.p)));
        for (const a of ns) {
          if (!a?.free) continue;
          for (const b of ns) {
            if (!b || b === a) continue;
            let set = neighbours.get(a);
            if (!set) neighbours.set(a, (set = new Set()));
            set.add(b);
          }
        }
      }
      for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
        const next = new Map<Node, Map<Owner, number>>();
        for (const [node, ns] of neighbours) {
          const acc = new Map<Owner, number>();
          for (const [o, w] of node.share) acc.set(o, w * (1 - SMOOTH_RATE));
          for (const n of ns) for (const [o, w] of n.share) acc.set(o, (acc.get(o) ?? 0) + (w * SMOOTH_RATE) / ns.size);
          next.set(node, acc);
        }
        for (const [node, share] of next) node.share = share;
      }
      for (const node of nodes.values()) {
        if (!node.free) continue;
        const mix = new Map<number, number>();
        for (const [o, k] of node.share) {
          // A finger with no segment in reach of this vertex lends the hand's profile.
          for (const [slot, w] of node.profile.get(o) ?? node.profile.get('hand')!) mix.set(slot, (mix.get(slot) ?? 0) + w * k);
        }
        // At most four influences; a share under 1% is dropped, and the rest renormalised to full weight.
        const kept = [...mix.entries()].filter(([, w]) => w > 0.01).sort((a, b) => b[1] - a[1]).slice(0, 4);
        const total = kept.reduce((acc, [, w]) => acc + w, 0);
        if (total <= 0) continue;
        for (const v of node.verts) v.joints = kept.map(([slot, w]) => [slot, w / total] as [number, number]);
      }
    }
  }

  // Split triangles by the core joint that carries most of their weight (finger/twist weights belong to hand/foreArm).
  const groups = new Map<string, { joint: JointName; surface: string; tris: Array<[Vert, Vert, Vert]> }>();
  for (const t of tris) {
    const score = new Map<number, number>();
    for (const v of t.v) {
      for (const [slot, w] of v.joints) {
        const ownerJoint = JOINT_INDEX[slotOwner[slot] ?? 'pelvis'];
        score.set(ownerJoint, (score.get(ownerJoint) ?? 0) + w);
      }
    }
    let best = JOINT_INDEX.pelvis;
    let bestW = -1;
    for (const [j, w] of score) if (w > bestW) [best, bestW] = [j, w];
    const joint = JOINTS[best]!.name;
    const k = `${joint}|${t.surface}`;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { joint, surface: t.surface, tris: [] }));
    g.tris.push(t.v);
  }
  const parts: ModelPart[] = [];
  for (const g of groups.values()) parts.push({ joint: g.joint, surface: g.surface, geometry: buildPart(g.tris, world[g.joint]) });

  // Wound caps: median distance from the bone axis of the skin just past each severable joint.
  const stumpRadius: Partial<Record<JointName, number>> = {};
  for (const j of STUMP_JOINTS) {
    const c = world[j];
    const ring: number[] = [];
    // Limbs: the limb's own skin just below the joint. Head: the neck just below the skull, where the cap sits.
    const idx = JOINT_INDEX[j === 'head' ? 'neck' : j];
    for (const t of tris) {
      for (const v of t.v) {
        const topSlot = v.joints[0]?.[0] ?? -1;
        const ownerIdx = topSlot >= 0 ? JOINT_INDEX[slotOwner[topSlot] ?? 'pelvis'] : -1;
        if (ownerIdx !== idx) continue;
        const dy = v.p.y - c.y;
        if (Math.abs(dy + (j === 'head' ? 0.02 : 0.04)) > 0.03) continue;
        ring.push(Math.hypot(v.p.x - c.x, v.p.z - c.z));
      }
    }
    ring.sort((a, b) => a - b);
    const r = ring[Math.floor(ring.length / 2)];
    if (r !== undefined) stumpRadius[j] = THREE.MathUtils.clamp(r, 0.025, j === 'head' ? 0.065 : 0.12);
  }

  // Mesh-fitted elliptical torso hulls (pelvis, spine, chest) measured from each piece's actual vertices
  // so hand/forearm self-collision matches bulky lab coats, vests, and off-center ValveBiped spines accurately.
  const torsoHulls: TorsoHullDef[] = [];
  const quantile = (sorted: number[], p: number): number =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))] ?? 0;
  for (const joint of ['pelvis', 'spine', 'chest'] as const) {
    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];
    for (const part of parts) {
      if (part.joint !== joint) continue;
      const pos = part.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        xs.push(pos.getX(i));
        ys.push(pos.getY(i));
        zs.push(pos.getZ(i));
      }
    }
    if (xs.length < 24) continue;
    xs.sort((a, b) => a - b);
    ys.sort((a, b) => a - b);
    zs.sort((a, b) => a - b);
    const xLo = quantile(xs, 0.08);
    const xHi = quantile(xs, 0.92);
    const yLo = quantile(ys, 0.08);
    const yHi = quantile(ys, 0.92);
    const zFront = quantile(zs, 0.05);
    const zBack = quantile(zs, 0.95);
    const rx = THREE.MathUtils.clamp((xHi - xLo) * 0.5, 0.08, 0.24);
    const rz = THREE.MathUtils.clamp((zBack - zFront) * 0.5, 0.07, 0.22);
    if (yHi - yLo < 0.04) continue;
    torsoHulls.push({
      joint,
      cx: (xLo + xHi) * 0.5,
      cz: (zFront + zBack) * 0.5,
      y0: yLo,
      y1: yHi,
      rx,
      rz,
    });
  }

  return { parts, jointOffsets, handBones, torsoHulls, stumpRadius, surfaceSick, surfaces, triangles: tris.length, unmapped: rig.unmapped };
}

function buildPart(tris: Array<[Vert, Vert, Vert]>, origin: THREE.Vector3): THREE.BufferGeometry {
  const map = new Map<Vert, number>();
  const list: Vert[] = [];
  const index: number[] = [];
  for (const t of tris) {
    for (const v of t) {
      let i = map.get(v);
      if (i === undefined) {
        i = list.length;
        map.set(v, i);
        list.push(v);
      }
      index.push(i);
    }
  }
  const n = list.length;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  list.forEach((v, i) => {
    pos.set([v.p.x - origin.x, v.p.y - origin.y, v.p.z - origin.z], i * 3);
    nor.set([v.n.x, v.n.y, v.n.z], i * 3);
    uv.set(v.uv, i * 2);
    v.joints.forEach(([j, w], k) => {
      si[i * 4 + k] = j;
      sw[i * 4 + k] = w;
    });
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1));
  return g;
}

// ---------------------------------------------------------------- per body

/**
 * A fresh BodyGeometry for one humanoid from a prepared model. Geometry is cloned (each body disposes its
 * own); textures stay shared. `height` in metres.
 */
export function bodyGeometryFromModel(model: PreparedBodyModel, height: number, seed: number): BodyGeometry {
  const parts: PartGeometry[] = model.parts.map((p) => {
    const g = p.geometry.clone();
    const n = g.getAttribute('position').count;
    const white = new Float32Array(n * 3).fill(1);
    g.setAttribute('color', new THREE.BufferAttribute(white, 3));
    g.setAttribute('aSkin', new THREE.BufferAttribute(new Float32Array(n).fill(model.surfaceSick[p.surface] ?? 0), 1));
    g.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute('aRot', new THREE.BufferAttribute(new Float32Array(n), 1));
    return { bone: p.joint, layer: 'body', geometry: g, surface: p.surface };
  });
  const detailExtra: ExtraBoneDef[] = model.handBones.map((b) => ({
    name: b.name,
    parent: b.parent,
    offset: b.offset,
    kind: b.kind,
  }));
  const stumps = buildStumpParts(seed, 1, model.jointOffsets, (j) => model.stumpRadius[j] ?? 0.05);
  return {
    parts: [...parts, ...stumps.parts],
    extraBones: [...detailExtra, ...stumps.extra],
    scale: { y: height / REFERENCE_HEIGHT, w: 1 },
    jointOffsets: model.jointOffsets,
    skinTone: new THREE.Color(0x8a7f74),
    surfaces: model.surfaces,
    ...(model.handBones.length > 0 ? { handBones: model.handBones } : {}),
    ...(model.torsoHulls.length > 0 ? { torsoHulls: model.torsoHulls } : {}),
  };
}
