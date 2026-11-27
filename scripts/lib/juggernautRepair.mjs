/**
 * The repairs `scripts/fix-juggernaut-glb.mjs` makes to the Monster Juggernaut GLB (openspec rig-juggernaut D1-D4). The
 * source is the Sketchfab export of "future monster_low.fbx" by sanyaork (CC BY 4.0), as committed in 900e513.
 *
 * Skinning in this file follows glTF: a vertex's place is the weighted sum of joint-world times inverse-bind, applied to its
 * stored position (three.js gives the same bounds). The body's joints are bound in the scene's world space: on the joints the
 * exported pose leaves alone (spine, shoulders, fat, stomach) joint-world times inverse-bind is the identity.
 *
 * 1. Face parts (D2). The eyes, teeth, tongue and tongue teeth were exported at another scale: skinned, they land 300-1000
 *    units from the head. Parts whose placeholder nodes (`Object_8` .. `Object_14`) share a rotation and scale share one
 *    correction, a similarity transform found by least squares:
 *    - eyes and teeth: each eye's vertices (one influence each) centred on their eye joint, the joint being the eye's pivot;
 *    - tongue and tongue teeth: the vertices blended evenly between a tongue joint and its parent ring that joint.
 *    The correction is baked into positions, normals and tangents; skin indices and weights are left alone.
 * 2. Hands, feet and the aim marker (D3). `arm3` (hand) and `leg4` (foot) hang off the rig's IK control bones and
 *    `head_ik_094` off the root. They move under `arm2`, `leg3` and `head_09`. The marker's offset from the head is the one
 *    it has in the exported pose, so at the end of the finale it is where it was.
 * 3. Neutral (D4). The node transforms are an exported, posed frame (head turned about 31 degrees, jaw open, tongue scaled
 *    1.228). Every weighted joint is set to its bind pose (the inverse of its inverse-bind); unweighted joints (the `_end`
 *    markers, the unused IK controls, the root) keep their offsets from their parent, and their inverse-binds (some are
 *    scaled 100) are rebuilt to match. The exported frame is returned as the pose `exported_rest`: per joint, XYZ Euler
 *    degrees relative to neutral, plus the offset (model units, parent frame) and scale where they differ.
 *
 * Joint names, the joint list and its order, weighted joints' inverse-binds and every vertex's skin stay as they were.
 */
import { createHash } from 'node:crypto';
import { NodeIO, VertexLayout } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as THREE from 'three';

export const SOURCE_COMMIT = '900e513';
export const SOURCE_PATH = 'previews/sources/monster_juggernaut_src.glb';
export const SOURCE_HINT = `git show ${SOURCE_COMMIT}:public/assets/models/infected/monster_juggernaut.glb > ${SOURCE_PATH}`;
export const MODEL_PATH = 'public/assets/models/infected/monster_juggernaut.glb';
export const POSES_PATH = 'src/data/creatures/juggernaut/poses.json';
export const FIXTURE_PATH = 'scripts/fixtures/juggernaut-source.json';

/** The game shows the Juggernaut this tall (m), measured on the body in the exported pose. */
export const HEIGHT_M = 5.1;

export const FACE_GROUPS = [
  { name: 'eyes and teeth', meshes: ['eyes_details_0', 'teeths_low_details_0'], fitMesh: 'eyes_details_0', fit: 'pivots' },
  { name: 'tongue', meshes: ['tongue_low_details_0', 'tongue_teeths_low_details_0'], fitMesh: 'tongue_low_details_0', fit: 'rings' },
];
export const BODY_MESH = 'body_low_body_0';

/** [joint, new parent]. */
export const REPARENT = [
  ['arm3.L_087', 'arm2.L_059'],
  ['arm3.R_078', 'arm2.R_062'],
  ['leg4.L_071', 'leg3.L_066'],
  ['leg4.R_074', 'leg3.R_069'],
  ['head_ik_094', 'head_09'],
];
export const AIM_MARKER = 'head_ik_094';
export const HEAD = 'head_09';

/** Reads and writes GLBs with every extension kept and vertex attributes in separate buffer views, as the source has them. */
export function createIO() {
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).setVertexLayout(VertexLayout.SEPARATE);
}

const mat = (a) => new THREE.Matrix4().fromArray(a);

function skinOf(doc) {
  const skins = doc.getRoot().listSkins();
  if (skins.length !== 1) throw new Error(`expected one skin, found ${skins.length}`);
  return skins[0];
}

function nodeByName(doc) {
  const map = new Map();
  for (const n of doc.getRoot().listNodes()) map.set(n.getName(), n);
  return (name) => {
    const n = map.get(name);
    if (!n) throw new Error(`no node "${name}"`);
    return n;
  };
}

function meshPrim(doc, name) {
  const m = doc.getRoot().listMeshes().find((x) => x.getName() === name);
  if (!m) throw new Error(`no mesh "${name}"`);
  return m.listPrimitives()[0];
}

function readAttr(prim, semantic) {
  const a = prim.getAttribute(semantic);
  if (!a) return null;
  const n = a.getElementSize();
  const out = [];
  const el = new Array(n);
  for (let i = 0; i < a.getCount(); i++) out.push(a.getElement(i, el).slice());
  return out;
}

/** Inverse-bind matrices, one per joint. */
export function inverseBinds(doc) {
  const acc = skinOf(doc).getInverseBindMatrices();
  const out = [];
  const el = new Array(16);
  for (let i = 0; i < acc.getCount(); i++) out.push(mat(acc.getElement(i, el)));
  return out;
}

/** Joints carrying any weight on any mesh, as indices into the skin's joint list. */
export function weightedJoints(doc) {
  const used = new Set();
  for (const m of doc.getRoot().listMeshes()) {
    for (const p of m.listPrimitives()) {
      const J = readAttr(p, 'JOINTS_0');
      const W = readAttr(p, 'WEIGHTS_0');
      if (!J || !W) continue;
      for (let v = 0; v < J.length; v++) for (let k = 0; k < 4; k++) if (W[v][k] > 0) used.add(J[v][k]);
    }
  }
  return used;
}

/** Bind-space position of each joint (the origin of its inverse-bind's inverse). */
function bindPositions(ibm) {
  return ibm.map((m) => new THREE.Vector3().setFromMatrixPosition(m.clone().invert()));
}

/** Least-squares similarity (Umeyama): the matrix M with s*R*a + t closest to b. */
export function similarityFit(A, B) {
  const n = A.length;
  if (n < 3) throw new Error('similarity fit needs at least 3 points');
  const ca = new THREE.Vector3();
  const cb = new THREE.Vector3();
  for (const a of A) ca.add(a);
  for (const b of B) cb.add(b);
  ca.divideScalar(n);
  cb.divideScalar(n);
  let va = 0;
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) {
    const a = A[i].clone().sub(ca).toArray();
    const b = B[i].clone().sub(cb).toArray();
    va += a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r][c] += b[r] * a[c];
  }
  const { U, S, V } = svd3(C);
  const d = Math.sign(det3(U) * det3(V)) || 1;
  const D = [1, 1, d];
  const R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) R[r][c] += U[r][k] * D[k] * V[c][k];
  const s = (S[0] * D[0] + S[1] * D[1] + S[2] * D[2]) / va;
  const m = new THREE.Matrix4().set(
    R[0][0] * s, R[0][1] * s, R[0][2] * s, 0,
    R[1][0] * s, R[1][1] * s, R[1][2] * s, 0,
    R[2][0] * s, R[2][1] * s, R[2][2] * s, 0,
    0, 0, 0, 1,
  );
  m.setPosition(cb.clone().sub(ca.clone().applyMatrix4(m)));
  return m;
}

function det3(M) {
  return M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
}

/** SVD of a 3x3 matrix by one-sided Jacobi rotations: A = U diag(S) V^T. */
function svd3(A) {
  const U = A.map((r) => r.slice());
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        let al = 0, be = 0, ga = 0;
        for (let i = 0; i < 3; i++) {
          al += U[i][p] ** 2;
          be += U[i][q] ** 2;
          ga += U[i][p] * U[i][q];
        }
        off = Math.max(off, Math.abs(ga));
        if (Math.abs(ga) < 1e-18) continue;
        const ze = (be - al) / (2 * ga);
        const t = (ze >= 0 ? 1 : -1) / (Math.abs(ze) + Math.sqrt(1 + ze * ze));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = c * t;
        for (let i = 0; i < 3; i++) {
          const up = U[i][p], uq = U[i][q];
          U[i][p] = c * up - s * uq;
          U[i][q] = s * up + c * uq;
          const vp = V[i][p], vq = V[i][q];
          V[i][p] = c * vp - s * vq;
          V[i][q] = s * vp + c * vq;
        }
      }
    }
    if (off < 1e-18) break;
  }
  const S = [0, 1, 2].map((k) => Math.hypot(U[0][k], U[1][k], U[2][k]));
  for (let k = 0; k < 3; k++) for (let i = 0; i < 3; i++) U[i][k] /= S[k] || 1;
  // Coplanar points leave one singular value at zero and its column of U empty: complete U with the plane's normal
  // (cross product of the other two columns, in cyclic order so U stays right-handed).
  const top = Math.max(...S);
  const k = S.indexOf(Math.min(...S));
  if (S[k] <= top * 1e-9) {
    const a = (k + 1) % 3;
    const b = (k + 2) % 3;
    const ua = [U[0][a], U[1][a], U[2][a]];
    const ub = [U[0][b], U[1][b], U[2][b]];
    U[0][k] = ua[1] * ub[2] - ua[2] * ub[1];
    U[1][k] = ua[2] * ub[0] - ua[0] * ub[2];
    U[2][k] = ua[0] * ub[1] - ua[1] * ub[0];
    S[k] = 0;
  }
  return { U, S, V };
}

/** Correspondences (stored vertex point -> bind joint position) for one face group's fit. */
function fitPoints(doc, group, ibm) {
  const skin = skinOf(doc);
  const joints = skin.listJoints();
  const parentIndex = joints.map((j) => joints.indexOf(j.getParentNode()));
  const prim = meshPrim(doc, group.fitMesh);
  const P = readAttr(prim, 'POSITION');
  const J = readAttr(prim, 'JOINTS_0');
  const W = readAttr(prim, 'WEIGHTS_0');
  const bind = bindPositions(ibm);
  const sums = new Map();
  const add = (k, v) => {
    let s = sums.get(k);
    if (!s) sums.set(k, (s = { c: new THREE.Vector3(), n: 0 }));
    s.c.add(new THREE.Vector3(...P[v]));
    s.n++;
  };
  for (let v = 0; v < P.length; v++) {
    if (group.fit === 'pivots') {
      let best = 0;
      for (let k = 1; k < 4; k++) if (W[v][k] > W[v][best]) best = k;
      add(J[v][best], v);
    } else {
      const ws = [0, 1, 2, 3].filter((k) => W[v][k] > 0.2).map((k) => [J[v][k], W[v][k]]);
      for (const [a, wa] of ws) {
        for (const [b, wb] of ws) {
          if (a !== b && parentIndex[a] === b && 1 - Math.abs(wa - wb) >= 0.6) add(a, v);
        }
      }
    }
  }
  const A = [];
  const B = [];
  const names = [];
  for (const [k, s] of sums) {
    A.push(s.c.divideScalar(s.n));
    B.push(bind[k]);
    names.push(joints[k].getName());
  }
  return { A, B, names };
}

/** The correction for each face group, fitted on `doc` as it stands (the source). */
export function faceCorrections(doc) {
  const ibm = inverseBinds(doc);
  return FACE_GROUPS.map((group) => {
    const { A, B, names } = fitPoints(doc, group, ibm);
    const matrix = similarityFit(A, B);
    const residuals = A.map((a, i) => ({ joint: names[i], units: a.clone().applyMatrix4(matrix).distanceTo(B[i]) }));
    return { group, matrix, residuals };
  });
}

function bakeFace(doc, corrections) {
  for (const { group, matrix } of corrections) {
    const rot = new THREE.Matrix3().setFromMatrix4(matrix);
    const scale = new THREE.Vector3().setFromMatrixScale(matrix).x;
    rot.multiplyScalar(1 / scale);
    for (const name of group.meshes) {
      const prim = meshPrim(doc, name);
      const v = new THREE.Vector3();
      const pos = prim.getAttribute('POSITION');
      for (let i = 0; i < pos.getCount(); i++) pos.setElement(i, v.fromArray(pos.getElement(i, [])).applyMatrix4(matrix).toArray());
      const nor = prim.getAttribute('NORMAL');
      if (nor) for (let i = 0; i < nor.getCount(); i++) nor.setElement(i, v.fromArray(nor.getElement(i, [])).applyMatrix3(rot).normalize().toArray());
      const tan = prim.getAttribute('TANGENT');
      if (tan) {
        for (let i = 0; i < tan.getCount(); i++) {
          const t = tan.getElement(i, []);
          v.set(t[0], t[1], t[2]).applyMatrix3(rot).normalize();
          tan.setElement(i, [v.x, v.y, v.z, t[3]]);
        }
      }
    }
  }
}

function decomposeInto(node, m) {
  const t = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  m.decompose(t, q, s);
  const back = new THREE.Matrix4().compose(t, q, s);
  const err = Math.max(...back.elements.map((x, i) => Math.abs(x - m.elements[i])));
  if (err > 1e-4) throw new Error(`${node.getName()}: its transform is not a translation, rotation and scale (off by ${err})`);
  node.setTranslation(t.toArray());
  node.setRotation(q.toArray());
  node.setScale(s.toArray());
}

/** World matrix of a node from the given local matrices (Map node -> Matrix4), walking its current parents. */
function worldOf(node, locals) {
  const chain = [];
  for (let n = node; n && n.propertyType === 'Node'; n = n.getParentNode()) chain.push(n);
  const out = new THREE.Matrix4();
  for (let i = chain.length - 1; i >= 0; i--) out.multiply(locals.get(chain[i]) ?? mat(chain[i].getMatrix()));
  return out;
}

/** Sort joints so each comes after its parent. */
function parentFirst(joints) {
  const set = new Set(joints);
  const depth = (j) => {
    let d = 0;
    for (let p = j.getParentNode(); p && set.has(p); p = p.getParentNode()) d++;
    return d;
  };
  return [...joints].sort((a, b) => depth(a) - depth(b));
}

const round = (x, places) => {
  const f = 10 ** places;
  const r = Math.round(x * f) / f;
  return Object.is(r, -0) ? 0 : r;
};

/**
 * Repair `doc` in place. Each fix can be switched off (`{ face: false }` and so on) to compare. Returns the exported pose
 * (when `neutral` ran) and what each step measured.
 */
export function repair(doc, { face = true, reparent = true, neutral = true } = {}) {
  const byName = nodeByName(doc);
  const skin = skinOf(doc);
  const joints = skin.listJoints();
  const ibm = inverseBinds(doc);
  const weighted = weightedJoints(doc);
  const exportWorld = new Map(doc.getRoot().listNodes().map((n) => [n, mat(n.getWorldMatrix())]));
  const report = {};

  if (face) {
    const corrections = faceCorrections(doc);
    bakeFace(doc, corrections);
    report.face = corrections.map(({ group, matrix, residuals }) => ({
      group: group.name,
      scale: new THREE.Vector3().setFromMatrixScale(matrix).x,
      residuals,
    }));
  }

  if (reparent) {
    for (const [name, parentName] of REPARENT) {
      const node = byName(name);
      const parent = byName(parentName);
      node.getParentNode()?.removeChild(node);
      parent.addChild(node);
      decomposeInto(node, exportWorld.get(parent).clone().invert().multiply(exportWorld.get(node)));
    }
  }

  if (!neutral) return { exportedRest: null, report };

  // Exported locals in the (possibly new) hierarchy, then neutral ones.
  const exportLocal = new Map();
  for (const j of joints) exportLocal.set(j, exportWorld.get(j.getParentNode()).clone().invert().multiply(exportWorld.get(j)));
  const neutralWorld = new Map();
  const locals = new Map();
  for (const j of parentFirst(joints)) {
    const k = joints.indexOf(j);
    const parentWorld = neutralWorld.get(j.getParentNode()) ?? worldOf(j.getParentNode(), locals);
    const w = weighted.has(k) ? ibm[k].clone().invert() : parentWorld.clone().multiply(exportLocal.get(j));
    neutralWorld.set(j, w);
    const local = parentWorld.clone().invert().multiply(w);
    locals.set(j, local);
    decomposeInto(j, local);
  }
  // Rebuild unweighted joints' inverse-binds; weighted ones stay as exported.
  const acc = skin.getInverseBindMatrices();
  let rebuilt = 0;
  joints.forEach((j, k) => {
    if (weighted.has(k)) return;
    acc.setElement(k, neutralWorld.get(j).clone().invert().toArray());
    rebuilt++;
  });
  report.neutral = { weighted: weighted.size, rebuiltInverseBinds: rebuilt };

  // The exported frame relative to neutral.
  const pose = { joints: {}, offsets: {}, scales: {} };
  const tn = new THREE.Vector3(), qn = new THREE.Quaternion(), sn = new THREE.Vector3();
  const te = new THREE.Vector3(), qe = new THREE.Quaternion(), se = new THREE.Vector3();
  const e = new THREE.Euler();
  // Only weighted joints: the others keep their exported offsets from their parent by construction (rounding noise aside).
  const nonZero = (v) => v.some((x) => x !== 0);
  joints.forEach((j, k) => {
    if (!weighted.has(k)) return;
    locals.get(j).decompose(tn, qn, sn);
    exportLocal.get(j).decompose(te, qe, se);
    const name = j.getName();
    const dq = qn.clone().invert().multiply(qe);
    e.setFromQuaternion(dq, 'XYZ');
    const r = [e.x, e.y, e.z].map((a) => round(THREE.MathUtils.radToDeg(a), 4));
    if (nonZero(r)) pose.joints[name] = r;
    const t = te.clone().sub(tn).toArray().map((x) => round(x, 5));
    if (nonZero(t)) pose.offsets[name] = t;
    const s = [se.x / sn.x, se.y / sn.y, se.z / sn.z].map((x) => round(x - 1, 5));
    if (nonZero(s)) pose.scales[name] = s.map((x) => round(x + 1, 5));
  });
  if (!Object.keys(pose.offsets).length) delete pose.offsets;
  if (!Object.keys(pose.scales).length) delete pose.scales;
  return { exportedRest: pose, report };
}

/** Skinned positions of a mesh under the given joint world matrices (default: the document's node transforms). */
export function skinnedPositions(doc, meshName, jointWorld = null) {
  const skin = skinOf(doc);
  const joints = skin.listJoints();
  const ibm = inverseBinds(doc);
  const mats = joints.map((j, k) => (jointWorld ? jointWorld(j, k) : mat(j.getWorldMatrix())).clone().multiply(ibm[k]));
  const prim = meshPrim(doc, meshName);
  const P = readAttr(prim, 'POSITION');
  const J = readAttr(prim, 'JOINTS_0');
  const W = readAttr(prim, 'WEIGHTS_0');
  const out = [];
  const tmp = new THREE.Vector3();
  for (let v = 0; v < P.length; v++) {
    const s = new THREE.Vector3();
    for (let k = 0; k < 4; k++) {
      if (W[v][k] <= 0) continue;
      s.addScaledVector(tmp.fromArray(P[v]).applyMatrix4(mats[J[v][k]]), W[v][k]);
    }
    out.push(s);
  }
  return out;
}

/** A mesh's stored vertex positions (its bind-space, modelled positions). */
export function storedPositions(doc, meshName) {
  return readAttr(meshPrim(doc, meshName), 'POSITION').map((p) => new THREE.Vector3(...p));
}

/** Metres per model unit: HEIGHT_M over the body's skinned height in the source's exported pose. */
export function metresPerUnit(sourceDoc) {
  const box = new THREE.Box3().setFromPoints(skinnedPositions(sourceDoc, BODY_MESH));
  return HEIGHT_M / (box.max.y - box.min.y);
}

/**
 * The face-part acceptance checks (D2), on a repaired document in its bind pose. `m` is metres per model unit. Each entry
 * says which part and check, whether it passed, and the measured value.
 */
export function faceChecks(doc, m) {
  const skin = skinOf(doc);
  const joints = skin.listJoints();
  const ibm = inverseBinds(doc);
  const bind = bindPositions(ibm);
  const head = joints.findIndex((j) => j.getName() === HEAD);
  const inHead = new Set();
  joints.forEach((j, k) => {
    for (let p = j; p; p = p.getParentNode()) if (p === joints[head]) inHead.add(k);
  });
  // The head's region: body vertices with at least 10% of their weight on the head or anything it carries.
  const body = meshPrim(doc, BODY_MESH);
  const BP = readAttr(body, 'POSITION');
  const BJ = readAttr(body, 'JOINTS_0');
  const BW = readAttr(body, 'WEIGHTS_0');
  const headBox = new THREE.Box3();
  for (let v = 0; v < BP.length; v++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (inHead.has(BJ[v][k])) w += BW[v][k];
    if (w >= 0.1) headBox.expandByPoint(new THREE.Vector3(...BP[v]));
  }
  const tolerance = 0.02 / m;
  const out = [];
  const joint = (name) => bind[joints.findIndex((j) => j.getName() === name)];
  for (const group of FACE_GROUPS) {
    for (const name of group.meshes) {
      const P = readAttr(meshPrim(doc, name), 'POSITION').map((p) => new THREE.Vector3(...p));
      const box = new THREE.Box3().setFromPoints(P);
      const outside = Math.max(0, headBox.min.x - box.min.x, headBox.min.y - box.min.y, headBox.min.z - box.min.z, box.max.x - headBox.max.x, box.max.y - headBox.max.y, box.max.z - headBox.max.z);
      out.push({ part: name, check: 'inside the head', ok: outside <= tolerance, metres: outside * m });
      // Mirror symmetry about the body's midline (x = 0): every vertex has a mirror partner.
      let worst = 0;
      for (const p of P) {
        let best = Infinity;
        for (const q of P) {
          const d = (q.x + p.x) ** 2 + (q.y - p.y) ** 2 + (q.z - p.z) ** 2;
          if (d < best) best = d;
        }
        worst = Math.max(worst, Math.sqrt(best));
      }
      out.push({ part: name, check: 'mirrors across the midline', ok: worst * m <= 0.01, metres: worst * m });
    }
    const { A, B, names } = fitPoints(doc, group, ibm);
    const limit = group.fit === 'pivots' ? 0.02 : 0.1;
    const worstFit = Math.max(...A.map((a, i) => a.distanceTo(B[i])));
    out.push({ part: group.name, check: `on its joints (${names.length})`, ok: worstFit * m <= limit, metres: worstFit * m });
  }
  // The teeth sit between the jaws, the upper row above the lower; the tongue stays behind the front teeth.
  const teeth = meshPrim(doc, 'teeths_low_details_0');
  const TP = readAttr(teeth, 'POSITION');
  const TJ = readAttr(teeth, 'JOINTS_0');
  const TW = readAttr(teeth, 'WEIGHTS_0');
  const rowY = (jointName) => {
    const k = joints.findIndex((j) => j.getName() === jointName);
    let y = 0, n = 0;
    for (let v = 0; v < TP.length; v++) {
      let best = 0;
      for (let i = 1; i < 4; i++) if (TW[v][i] > TW[v][best]) best = i;
      if (TJ[v][best] === k) { y += TP[v][1]; n++; }
    }
    return y / n;
  };
  const upper = rowY('uppermouth_011');
  const lower = rowY('lowermouth_010');
  const between = lower < upper && lower > joint('lowermouth_010').y && upper < joint('uppermouth_011').y;
  out.push({ part: 'teeth', check: 'between the jaws, upper row above lower', ok: between, metres: (upper - lower) * m });
  const tongueFront = new THREE.Box3().setFromPoints(readAttr(meshPrim(doc, 'tongue_low_details_0'), 'POSITION').map((p) => new THREE.Vector3(...p))).max.z;
  const teethFront = new THREE.Box3().setFromPoints(TP.map((p) => new THREE.Vector3(...p))).max.z;
  out.push({ part: 'tongue', check: 'behind the front teeth', ok: tongueFront <= teethFront, metres: (teethFront - tongueFront) * m });
  return out;
}

/**
 * Joint world matrices (Map joint node -> Matrix4) after applying a pose to the document's node transforms: per joint, local
 * rotation = neutral rotation * Euler XYZ degrees, translation = neutral + offset, scale = neutral * scale.
 */
export function poseWorlds(doc, pose) {
  const joints = skinOf(doc).listJoints();
  const locals = new Map();
  const e = new THREE.Euler();
  for (const j of joints) {
    const name = j.getName();
    const t = new THREE.Vector3(...j.getTranslation());
    const q = new THREE.Quaternion(...j.getRotation());
    const s = new THREE.Vector3(...j.getScale());
    const r = pose?.joints?.[name];
    if (r) q.multiply(new THREE.Quaternion().setFromEuler(e.set(...r.map((d) => THREE.MathUtils.degToRad(d)), 'XYZ')));
    const o = pose?.offsets?.[name];
    if (o) t.add(new THREE.Vector3(...o));
    const k = pose?.scales?.[name];
    if (k) s.multiply(new THREE.Vector3(...k));
    locals.set(j, new THREE.Matrix4().compose(t, q, s));
  }
  return new Map(joints.map((j) => [j, worldOf(j, locals)]));
}

const sha = (values) => createHash('sha256').update(Buffer.from(new Float64Array(values).buffer)).digest('hex');

/** What the tests need to know about the source, so they can run without it (scripts/fixtures/juggernaut-source.json). */
export function sourceFixture(doc) {
  const skin = skinOf(doc);
  const joints = skin.listJoints();
  const ibm = inverseBinds(doc);
  const weighted = [...weightedJoints(doc)].sort((a, b) => a - b);
  const skins = {};
  for (const m of doc.getRoot().listMeshes()) {
    const p = m.listPrimitives()[0];
    skins[m.getName()] = sha([...readAttr(p, 'JOINTS_0').flat(), ...readAttr(p, 'WEIGHTS_0').flat()]);
  }
  const r6 = (x) => round(x, 6);
  return {
    source: `${SOURCE_COMMIT}:${MODEL_PATH}`,
    metresPerUnit: metresPerUnit(doc),
    joints: joints.map((j) => j.getName()),
    weighted: weighted.map((k) => joints[k].getName()),
    weightedInverseBinds: sha(weighted.flatMap((k) => ibm[k].elements)),
    skins,
    exportedWorld: Object.fromEntries(joints.map((j) => [j.getName(), j.getWorldMatrix().map(r6)])),
  };
}

/** Hashes of the same skin data on another document, for comparison with `sourceFixture`. */
export function skinHashes(doc) {
  const f = sourceFixture(doc);
  return { joints: f.joints, weighted: f.weighted, weightedInverseBinds: f.weightedInverseBinds, skins: f.skins };
}

/** The pose file with `exported_rest` replaced, written with each vector on one line. */
export function posesJson(existing, exportedRest) {
  const file = existing ?? { poses: {} };
  file.poses = { ...file.poses, exported_rest: exportedRest };
  return JSON.stringify(file, null, 2).replace(/\[\s+([-\d.e,\s]+?)\s+\]/g, (_, inner) => `[${inner.split(/,\s*/).join(', ')}]`) + '\n';
}
