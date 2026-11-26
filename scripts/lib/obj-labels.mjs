// Bone labels from an OBJ's face groups (openspec rebuild-heins-rig D1, D4), carried onto a GLB of the same geometry.
//
// Blender's OBJ export with vertex groups writes `g <group>` before each run of faces, naming the face's main vertex group;
// object and material groups (`g Body.006_Head`) are written the same way. A face takes the most recent group as its label
// when that group is a bone name (`isLabel`), and no label otherwise.
//
// The GLB side is matched by position, not by index: an exporter splits vertices at UV and normal seams and may reorder them, but
// every position survives. Positions are compared on a key rounded to `grid` (the OBJ's six decimals are 1 µm).

/** Bone names of the Unreal-style rig the artist used (pelvis, spine_01..05, neck_01/02, clavicle_l, upperarm_twist_01_l, ...). */
export const UNREAL_BONE =
  /^(root|pelvis|spine_0\d|neck_0\d|head|clavicle_[lr]|(upperarm|lowerarm|thigh|calf)(_twist_0\d)?_[lr]|hand_[lr]|(thumb|index|middle|ring|pinky)_(0\d|metacarpal)_[lr]|foot_[lr]|ball_[lr])$/;

/**
 * Reads an OBJ's positions and faces with each face's label, object group and material.
 * Returns { pos: Float64Array (x, y, z per vertex), faceStart: Int32Array (faces + 1 offsets into faceVerts), faceVerts: Int32Array
 * (0-based vertex ids), faceLabel: Int16Array (index into labels, -1 none), faceObject: Int16Array (index into objects: the most
 * recent group that is not a label, -1 none), faceMaterial: Int16Array (index into materials, -1 none), labels: string[],
 * objects: string[], materials: string[] }.
 */
export function readObjLabels(text, { isLabel = (g) => UNREAL_BONE.test(g) } = {}) {
  const pos = [];
  const faceStart = [0], faceVerts = [], faceLabel = [], faceObject = [], faceMaterial = [];
  const labels = [], labelId = new Map();
  const objects = [], objectId = new Map();
  const materials = [], materialId = new Map();
  let label = -1, object = -1, material = -1;
  const idOf = (map, list, name) => {
    let id = map.get(name);
    if (id === undefined) { id = list.length; list.push(name); map.set(name, id); }
    return id;
  };
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = text.length;
    const line = text.slice(start, end).trim();
    start = end + 1;
    if (line.startsWith('v ')) {
      const p = line.split(/\s+/);
      pos.push(+p[1], +p[2], +p[3]);
    } else if (line.startsWith('f ')) {
      const p = line.split(/\s+/);
      const n = pos.length / 3;
      for (let k = 1; k < p.length; k++) {
        const v = parseInt(p[k], 10); // v, v/vt, v//vn or v/vt/vn; negative ids count back from the last vertex
        faceVerts.push(v < 0 ? n + v : v - 1);
      }
      faceStart.push(faceVerts.length);
      faceLabel.push(label);
      faceObject.push(object);
      faceMaterial.push(material);
    } else if (line.startsWith('g ') || line === 'g') {
      const g = line.slice(2).trim();
      label = g && isLabel(g) ? idOf(labelId, labels, g) : -1;
      if (g && label < 0) object = idOf(objectId, objects, g);
    } else if (line.startsWith('usemtl')) {
      const m = line.slice(6).trim();
      material = m ? idOf(materialId, materials, m) : -1;
    }
  }
  return {
    pos: Float64Array.from(pos), faceStart: Int32Array.from(faceStart), faceVerts: Int32Array.from(faceVerts),
    faceLabel: Int16Array.from(faceLabel), faceObject: Int16Array.from(faceObject), faceMaterial: Int16Array.from(faceMaterial),
    labels, objects, materials,
  };
}

const keyOf = (x, y, z, grid) => `${Math.round(x / grid)},${Math.round(y / grid)},${Math.round(z / grid)}`;

/** An index of the OBJ by rounded position: each distinct position gets a key id, and each key the faces that touch it. */
export function objPositionIndex(obj, { grid = 2e-6 } = {}) {
  const keyId = new Map();
  const n = obj.pos.length / 3;
  const vertKey = new Int32Array(n);
  for (let v = 0; v < n; v++) {
    const k = keyOf(obj.pos[v * 3], obj.pos[v * 3 + 1], obj.pos[v * 3 + 2], grid);
    let id = keyId.get(k);
    if (id === undefined) { id = keyId.size; keyId.set(k, id); }
    vertKey[v] = id;
  }
  const facesAt = Array.from({ length: keyId.size }, () => []);
  const nF = obj.faceStart.length - 1;
  for (let f = 0; f < nF; f++) {
    for (let i = obj.faceStart[f]; i < obj.faceStart[f + 1]; i++) {
      const list = facesAt[vertKey[obj.faceVerts[i]]];
      if (list[list.length - 1] !== f) list.push(f);
    }
  }
  return { keyId, vertKey, facesAt, grid };
}

/**
 * Matches each GLB vertex to an OBJ position key (-1 when none is within the grid). Tries the key and its neighbours on the grid,
 * so a coordinate that rounds the other way still matches. `toObj(x, y, z)` maps a GLB mesh-space position into the OBJ's frame.
 */
export function matchPositions(index, positions, { toObj = (x, y, z) => [x, y, z] } = {}) {
  const n = positions.length / 3;
  const out = new Int32Array(n).fill(-1);
  const { keyId, grid } = index;
  for (let v = 0; v < n; v++) {
    const [x, y, z] = toObj(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
    let id = keyId.get(keyOf(x, y, z, grid));
    if (id === undefined) {
      search: for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) for (const dz of [-1, 0, 1]) {
        id = keyId.get(keyOf(x + dx * grid, y + dy * grid, z + dz * grid, grid));
        if (id !== undefined) break search;
      }
    }
    out[v] = id ?? -1;
  }
  return out;
}

/**
 * The OBJ face of each triangle (a, b, c as matched position keys): a face that touches all three positions, -1 for none. Where
 * several faces touch all three (coincident layers), the first labelled one in file order wins, else the first.
 */
export function triangleFaces(obj, index, keys, indices) {
  const nT = indices.length / 3;
  const out = new Int32Array(nT).fill(-1);
  for (let t = 0; t < nT; t++) {
    const a = keys[indices[t * 3]], b = keys[indices[t * 3 + 1]], c = keys[indices[t * 3 + 2]];
    if (a < 0 || b < 0 || c < 0) continue;
    const fb = new Set(index.facesAt[b]), fc = new Set(index.facesAt[c]);
    let best = -1;
    for (const f of index.facesAt[a]) {
      if (!fb.has(f) || !fc.has(f)) continue;
      if (best < 0) best = f;
      if (obj.faceLabel[f] >= 0) { best = f; break; }
    }
    out[t] = best;
  }
  return out;
}

/** The label of each triangle (triangleFaces' face's label): -1 for none or an unlabelled face. */
export function triangleLabels(obj, index, keys, indices) {
  return Int16Array.from(triangleFaces(obj, index, keys, indices), (f) => (f < 0 ? -1 : obj.faceLabel[f]));
}
