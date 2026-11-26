/**
 * The Necromorph Slasher repair (openspec rig-necromorph, design D2): what `scripts/fix-necromorph-glb.mjs` changes in
 * `public/assets/models/infected/necromorph_slasher.glb`, and the checks the tests share.
 *
 * The model's jaw is a loop of rods round the mouth, fused to the skull's face and skinned to the head bone alone, so
 * nothing can open it. The repair adds one joint, `Jaw_066`, under `Head_013`, hinged across the face where the loop's lower
 * rods meet the skull, and moves head weight onto it in front of the face: fully on the hook and lower rods, blending along
 * the upper rods back to the skull. Nothing else in the file changes: every other joint, inverse bind matrix and weight,
 * the vertices, the textures and the compression stay as they were.
 */
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer/meshopt_decoder.module.js';
import { MeshoptEncoder } from 'meshoptimizer/meshopt_encoder.module.js';
import * as THREE from 'three';

export const SOURCE_COMMIT = '822dddf';
export const SOURCE_PATH = 'previews/sources/necromorph_slasher_src.glb';
export const SOURCE_HINT = `git show ${SOURCE_COMMIT}:public/assets/models/infected/necromorph_slasher.glb > ${SOURCE_PATH}`;
export const MODEL_PATH = 'public/assets/models/infected/necromorph_slasher.glb';
export const FIXTURE_PATH = 'scripts/fixtures/necromorph-source.json';

export const HEAD = 'Head_013';
export const JAW = 'Jaw_066';

/**
 * The jaw, in the head bone's bind frame (model units; the skull spans y 0..7.5, the face is at z = -2 and the hook reaches
 * z = -9). Measured from the model: the loop's lower rods meet the skull at about y 1-2 just in front of z = -1.5.
 */
export const JAW_SHAPE = {
  /** The hinge: a point on the axis, and the axis (the head's sideways axis). */
  pivot: [0, 1.6, -1.6],
  /** Weight on the jaw grows from 0 at `faceZ[0]` to 1 at `faceZ[1]` (forward is -z). */
  faceZ: [-1.8, -3.6],
  /** Above `topY[0]` the weight fades, gone by `topY[1]`: the upper rods' roots stay on the skull. */
  topY: [4.2, 6.6],
  /** Only the head's skin, inside this half-width either side of the midline. */
  halfWidth: 4,
};

export async function createIO() {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function skinOf(doc) {
  const skins = doc.getRoot().listSkins();
  if (skins.length !== 1) throw new Error(`expected one skin, found ${skins.length}`);
  return skins[0];
}

export function primitiveOf(doc) {
  const prims = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
  if (prims.length !== 1) throw new Error(`expected one skinned primitive, found ${prims.length}`);
  return prims[0];
}

const mat = (a) => new THREE.Matrix4().fromArray(a);

/** Jaw weight share for a vertex at `p` in the head's bind frame. */
export function jawShare(p) {
  const s = JAW_SHAPE;
  if (Math.abs(p.x) > s.halfWidth) return 0;
  return smooth(s.faceZ[0], s.faceZ[1], p.z) * (1 - smooth(s.topY[0], s.topY[1], p.y));
}

/**
 * Apply the repair to a document in place. `skip` names fixes to leave out (`jaw`). Returns a report.
 */
export function repair(doc, { skip = new Set() } = {}) {
  const report = { jaw: null };
  if (!skip.has('jaw')) report.jaw = addJaw(doc);
  return report;
}

function addJaw(doc) {
  const skin = skinOf(doc);
  const joints = skin.listJoints();
  if (joints.some((j) => j.getName() === JAW)) throw new Error(`${JAW} already present: repair the source, not the shipped file`);
  const head = joints.findIndex((j) => j.getName() === HEAD);
  if (head < 0) throw new Error(`no ${HEAD}`);
  const ibmAcc = skin.getInverseBindMatrices();
  const toHead = mat(ibmAcc.getElement(head, []));
  const headBind = toHead.clone().invert();

  // The jaw's bind frame: the head's, moved to the hinge.
  const pivotMesh = new THREE.Vector3(...JAW_SHAPE.pivot).applyMatrix4(headBind);
  const jawBind = headBind.clone().setPosition(pivotMesh);
  const jawIbm = jawBind.clone().invert();
  // Its transform under the head node: head^-1 * jaw, both in bind space (a pure translation in head units).
  const local = toHead.clone().multiply(jawBind);
  const t = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  local.decompose(t, q, s);
  const jawNode = doc.createNode(JAW).setTranslation(t.toArray()).setRotation(q.toArray()).setScale(s.toArray());
  joints[head].addChild(jawNode);
  skin.addJoint(jawNode);
  const jaw = joints.length; // its index in the skin

  // One more inverse bind matrix.
  const n = ibmAcc.getCount();
  const arr = new Float32Array((n + 1) * 16);
  arr.set(ibmAcc.getArray());
  arr.set(jawIbm.elements, n * 16);
  ibmAcc.setArray(arr);

  // Move head weight to the jaw in front of the face.
  const prim = primitiveOf(doc);
  const pos = prim.getAttribute('POSITION');
  const J = prim.getAttribute('JOINTS_0');
  const W = prim.getAttribute('WEIGHTS_0');
  if (jaw > 255 && J.getComponentType() === 5121) throw new Error('joint index does not fit JOINTS_0');
  const p = new THREE.Vector3();
  const jj = [];
  const ww = [];
  let changed = 0;
  let full = 0;
  for (let v = 0; v < pos.getCount(); v++) {
    J.getElement(v, jj);
    W.getElement(v, ww);
    const k = jj.findIndex((j, i) => j === head && ww[i] > 0);
    if (k < 0) continue;
    p.fromArray(pos.getElement(v, [])).applyMatrix4(toHead);
    const share = jawShare(p);
    if (share <= 0) continue;
    const moved = ww[k] * share;
    // Put the jaw in the slot with no weight, or else in the head's slot when all of the head moves.
    let slot = ww.findIndex((w, i) => i !== k && w <= 0);
    if (share >= 0.999) slot = k;
    if (slot < 0) {
      // No free slot: give the jaw the smallest other slot's place and fold that weight into the head's.
      slot = ww.reduce((best, w, i) => (i !== k && (best < 0 || w < ww[best]) ? i : best), -1);
      ww[k] += ww[slot];
    }
    if (slot !== k) ww[k] -= moved;
    jj[slot] = jaw;
    ww[slot] = slot === k ? ww[k] : moved;
    J.setElement(v, jj);
    W.setElement(v, normalise(ww, W));
    changed++;
    if (share >= 0.999) full++;
  }
  return { pivot: JAW_SHAPE.pivot, vertices: changed, fullyOnJaw: full };
}

/** Weights that sum to exactly 1 in the accessor's own storage (normalised integers round). */
function normalise(ww, acc) {
  const sum = ww.reduce((a, b) => a + b, 0);
  const out = ww.map((w) => w / sum);
  const ct = acc.getComponentType();
  if (!acc.getNormalized() || ct === 5126) return out;
  const max = ct === 5121 ? 255 : 65535;
  const q = out.map((w) => Math.round(w * max));
  const err = max - q.reduce((a, b) => a + b, 0);
  q[q.indexOf(Math.max(...q))] += err;
  return q.map((x) => x / max);
}

/** Write with the source's compression: meshopt over the quantized vertex data, as shipped. */
export function prepareWrite(doc) {
  const ext = doc.getRoot().listExtensionsUsed().find((e) => e.extensionName === 'EXT_meshopt_compression') ?? doc.createExtension(EXTMeshoptCompression);
  ext.setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
}

/** Opening the jaw turns it about the head's +X axis by this sign (the hook swings forward and down). */
export const JAW_OPEN_SIGN = -1;

/** Every vertex's bind-space position, and the triangles. */
export function bindMesh(doc) {
  const prim = primitiveOf(doc);
  const pos = prim.getAttribute('POSITION');
  const points = [];
  for (let v = 0; v < pos.getCount(); v++) points.push(new THREE.Vector3().fromArray(pos.getElement(v, [])));
  const idx = prim.getIndices();
  const tris = [];
  for (let t = 0; t < idx.getCount(); t += 3) tris.push([idx.getScalar(t), idx.getScalar(t + 1), idx.getScalar(t + 2)]);
  return { points, tris };
}

/** Bind-space positions with only the jaw opened `deg` degrees (linear blend skinning, everything else at bind). */
export function jawOpened(doc, deg) {
  const skin = skinOf(doc);
  const names = skin.listJoints().map((j) => j.getName());
  const jaw = names.indexOf(JAW);
  if (jaw < 0) throw new Error(`no ${JAW}`);
  const jawBind = mat(skin.getInverseBindMatrices().getElement(jaw, [])).invert();
  const turn = jawBind.clone().multiply(new THREE.Matrix4().makeRotationX((JAW_OPEN_SIGN * deg * Math.PI) / 180)).multiply(jawBind.clone().invert());
  const prim = primitiveOf(doc);
  const J = prim.getAttribute('JOINTS_0');
  const W = prim.getAttribute('WEIGHTS_0');
  const { points } = bindMesh(doc);
  const jj = [];
  const ww = [];
  const moved = new THREE.Vector3();
  return points.map((p, v) => {
    J.getElement(v, jj);
    W.getElement(v, ww);
    const share = jj.reduce((s, j, k) => s + (j === jaw ? ww[k] : 0), 0);
    if (share <= 0) return p.clone();
    moved.copy(p).applyMatrix4(turn);
    return p.clone().lerp(moved, share);
  });
}

/** Model units per metre for a body prepared at `height` m (the T-posed bind mesh is the standing height). */
export function unitsPerMetre(doc, height = 1.78) {
  const box = new THREE.Box3().setFromPoints(bindMesh(doc).points);
  return (box.max.y - box.min.y) / height;
}

/**
 * Facts about the source the tests compare the shipped model with, without needing the source file: the joint names,
 * every inverse bind matrix, the vertices that carry head weight, and a hash of every other vertex's joints and weights.
 */
export function sourceFacts(doc, headVertices = null) {
  const skin = skinOf(doc);
  const names = skin.listJoints().map((j) => j.getName());
  const head = names.indexOf(HEAD);
  const known = headVertices ? new Set(headVertices) : null;
  const prim = primitiveOf(doc);
  const J = prim.getAttribute('JOINTS_0');
  const W = prim.getAttribute('WEIGHTS_0');
  const hash = createHash('sha256');
  const headVerts = [];
  const jj = [];
  const ww = [];
  for (let v = 0; v < J.getCount(); v++) {
    J.getElement(v, jj);
    W.getElement(v, ww);
    // Pass the source's head vertices to hash the same vertices after the repair (some then carry jaw weight only).
    if (known ? known.has(v) : jj.some((j, i) => j === head && ww[i] > 0)) {
      headVerts.push(v);
      continue;
    }
    hash.update(`${v}:${jj.join(',')}:${ww.map((w) => w.toFixed(5)).join(',')};`);
  }
  const ibm = Array.from(skin.getInverseBindMatrices().getArray(), (x) => +x.toPrecision(7));
  return { joints: names, ibm, vertices: J.getCount(), headVertices: headVerts, otherSkinHash: hash.digest('hex') };
}
