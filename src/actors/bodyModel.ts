import * as THREE from 'three';
import { buildStumpParts, STUMP_JOINTS, type BodyGeometry, type PartGeometry } from './bodyGeometry.ts';
import type { SurfaceDef } from './bodyMaterial.ts';
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

  // Skin every vertex into the new pose and fold its weights onto game joints.
  const skinMats = bones.map((_, i) => poser.deform[i]!.clone());
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
  const normalM = new THREE.Matrix3();
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
    // This mesh's bone order may differ from the reference skeleton's: match by object.
    const boneIdx = mesh.skeleton.bones.map((b) => bones.indexOf(b));
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
        const b = boneIdx[si.getComponent(v, k)] ?? -1;
        if (b < 0) continue;
        const m = skinMats[b]!;
        acc.addScaledVector(tmpP.clone().applyMatrix4(m), w);
        accN.addScaledVector(tmpN.clone().applyMatrix3(normalM.setFromMatrix4(m)), w);
        const j = JOINT_INDEX[rig.jointOf[b]!];
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

  // Split triangles by the joint that carries most of their weight.
  const groups = new Map<string, { joint: JointName; surface: string; tris: Array<[Vert, Vert, Vert]> }>();
  for (const t of tris) {
    const score = new Map<number, number>();
    for (const v of t.v) for (const [j, w] of v.joints) score.set(j, (score.get(j) ?? 0) + w);
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
        if ((v.joints[0]?.[0] ?? -1) !== idx) continue;
        const dy = v.p.y - c.y;
        if (Math.abs(dy + (j === 'head' ? 0.02 : 0.04)) > 0.03) continue;
        ring.push(Math.hypot(v.p.x - c.x, v.p.z - c.z));
      }
    }
    ring.sort((a, b) => a - b);
    const r = ring[Math.floor(ring.length / 2)];
    if (r !== undefined) stumpRadius[j] = THREE.MathUtils.clamp(r, 0.025, j === 'head' ? 0.065 : 0.12);
  }

  return { parts, jointOffsets, stumpRadius, surfaceSick, surfaces, triangles: tris.length, unmapped: rig.unmapped };
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
  const stumps = buildStumpParts(seed, 1, model.jointOffsets, (j) => model.stumpRadius[j] ?? 0.05);
  return {
    parts: [...parts, ...stumps.parts],
    extraBones: stumps.extra,
    scale: { y: height / REFERENCE_HEIGHT, w: 1 },
    jointOffsets: model.jointOffsets,
    skinTone: new THREE.Color(0x8a7f74),
    surfaces: model.surfaces,
  };
}
