/**
 * Kit conventions for an imported prop (spec imported-props, "Kit conventions on import" and
 * "Hinged parts stay separate"): keep/drop meshes, drop cameras/lights/skins/animations, bake
 * transforms, face -Z, scale to the configured height, pivot on the floor centre, weld, simplify to
 * the triangle budget, keep only POSITION/NORMAL/TEXCOORD_0 (never quantized). The result has one
 * `body` node and one `PART_<name>` node per hinged part, translated to its hinge.
 */
import type { Accessor, Document, Material, Mesh, Node as GNode, Primitive } from '@gltf-transform/core';
import { MeshoptSimplifier } from 'meshoptimizer-v1';
import * as THREE from 'three';
import { matches, type Front, type PropSource } from './config.ts';

const FRONT_YAW: Record<Front, number> = { '-z': 0, '+z': Math.PI, '+x': Math.PI / 2, '-x': -Math.PI / 2 };

interface Part {
  name: string;
  hinge: THREE.Vector3;
  geoms: Geom[];
}

/** Baked geometry of one primitive, in one space, plus its material. */
interface Geom {
  pos: Float32Array;
  nor: Float32Array;
  uv: Float32Array | null;
  idx: Uint32Array;
  material: Material | null;
}

export interface ConventionResult {
  triangles: number;
  /** Bounds after normalising: x/z centred, y from 0 (metres). */
  size: [number, number, number];
  parts: string[];
}

const nodeMaterials = (n: GNode): string[] => (n.getMesh()?.listPrimitives() ?? []).map((p) => p.getMaterial()?.getName() ?? '');

function readGeom(p: Primitive, world: THREE.Matrix4): Geom | null {
  const posA = p.getAttribute('POSITION');
  if (!posA || p.getMode() !== 4) return null; // triangles only
  const count = posA.getCount();
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const norA = p.getAttribute('NORMAL');
  const uvA = p.getAttribute('TEXCOORD_0');
  const uv = uvA ? new Float32Array(count * 2) : null;
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(world);
  const v = new THREE.Vector3();
  const e: number[] = [];
  for (let i = 0; i < count; i++) {
    posA.getElement(i, e);
    v.set(e[0]!, e[1]!, e[2]!).applyMatrix4(world);
    pos.set([v.x, v.y, v.z], i * 3);
    if (norA) {
      norA.getElement(i, e);
      v.set(e[0]!, e[1]!, e[2]!).applyMatrix3(normalMatrix).normalize();
      nor.set([v.x, v.y, v.z], i * 3);
    }
    if (uv && uvA) {
      uvA.getElement(i, e);
      uv.set([e[0]!, e[1]!], i * 2);
    }
  }
  const idxA = p.getIndices();
  let idx: Uint32Array;
  if (idxA) {
    idx = new Uint32Array(idxA.getCount());
    for (let i = 0; i < idx.length; i++) idx[i] = idxA.getScalar(i);
  } else idx = Uint32Array.from({ length: count }, (_, i) => i);
  if (world.determinant() < 0) for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2]!, idx[i + 1]!];
  const g: Geom = { pos, nor, uv, idx, material: p.getMaterial() };
  if (!norA) computeNormals(g);
  return g;
}

function computeNormals(g: Geom): void {
  g.nor.fill(0);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < g.idx.length; i += 3) {
    const [i0, i1, i2] = [g.idx[i]!, g.idx[i + 1]!, g.idx[i + 2]!];
    a.fromArray(g.pos, i0 * 3);
    b.fromArray(g.pos, i1 * 3).sub(a);
    c.fromArray(g.pos, i2 * 3).sub(a);
    b.cross(c);
    for (const k of [i0, i1, i2]) for (let j = 0; j < 3; j++) g.nor[k * 3 + j]! += b.getComponent(j);
  }
  for (let i = 0; i < g.nor.length; i += 3) {
    a.fromArray(g.nor, i).normalize();
    g.nor.set([a.x, a.y, a.z], i);
  }
}

/** Merge vertices that share position, normal and UV (seams stay split). */
export function weld(g: Geom): Geom {
  const key = (i: number): string => {
    const q = (v: number, s: number) => Math.round(v / s);
    let k = `${q(g.pos[i * 3]!, 1e-5)},${q(g.pos[i * 3 + 1]!, 1e-5)},${q(g.pos[i * 3 + 2]!, 1e-5)}|${q(g.nor[i * 3]!, 1e-3)},${q(g.nor[i * 3 + 1]!, 1e-3)},${q(g.nor[i * 3 + 2]!, 1e-3)}`;
    if (g.uv) k += `|${q(g.uv[i * 2]!, 1e-5)},${q(g.uv[i * 2 + 1]!, 1e-5)}`;
    return k;
  };
  const map = new Map<string, number>();
  const remap = new Uint32Array(g.pos.length / 3);
  const keep: number[] = [];
  for (let i = 0; i < remap.length; i++) {
    const k = key(i);
    let n = map.get(k);
    if (n === undefined) {
      n = keep.length;
      map.set(k, n);
      keep.push(i);
    }
    remap[i] = n;
  }
  return compact({ ...g, idx: g.idx.map((i) => remap[i]!) }, keep);
}

/** Keep only the listed source vertices (in order); `g.idx` must already point at the new numbering. */
function compact(g: Geom, keep: number[]): Geom {
  const pos = new Float32Array(keep.length * 3);
  const nor = new Float32Array(keep.length * 3);
  const uv = g.uv ? new Float32Array(keep.length * 2) : null;
  keep.forEach((s, d) => {
    pos.set(g.pos.subarray(s * 3, s * 3 + 3), d * 3);
    nor.set(g.nor.subarray(s * 3, s * 3 + 3), d * 3);
    if (uv && g.uv) uv.set(g.uv.subarray(s * 2, s * 2 + 2), d * 2);
  });
  return { ...g, pos, nor, uv };
}

/** Drop vertices no triangle uses. */
function dropUnused(g: Geom): Geom {
  const remap = new Int32Array(g.pos.length / 3).fill(-1);
  const keep: number[] = [];
  const idx = g.idx.map((i) => {
    if (remap[i]! < 0) {
      remap[i] = keep.length;
      keep.push(i);
    }
    return remap[i]!;
  });
  return compact({ ...g, idx }, keep);
}

const tris = (gs: Geom[]): number => gs.reduce((n, g) => n + g.idx.length / 3, 0);

/** Per-vertex attributes the simplifier weighs (normal, then UV), so seams and shading survive. */
function attributes(g: Geom): { data: Float32Array; stride: number; weights: number[] } {
  const n = g.pos.length / 3;
  const stride = g.uv ? 5 : 3;
  const data = new Float32Array(n * stride);
  for (let i = 0; i < n; i++) {
    data.set(g.nor.subarray(i * 3, i * 3 + 3), i * stride);
    if (g.uv) data.set(g.uv.subarray(i * 2, i * 2 + 2), i * stride + 3);
  }
  return { data, stride, weights: g.uv ? [0.5, 0.5, 0.5, 1, 1] : [0.5, 0.5, 0.5] };
}

/** Simplify every geometry so the total is at most `budget` triangles. */
export async function simplifyTo(gs: Geom[], budget: number): Promise<Geom[]> {
  const total = tris(gs);
  if (total <= budget) return gs;
  await MeshoptSimplifier.ready;
  const attrs = gs.map(attributes);
  let ratio = budget / total;
  let error = 0.02;
  for (let attempt = 0; attempt < 12; attempt++) {
    const flags: Array<'Permissive'> = attempt >= 4 ? ['Permissive'] : [];
    const out = gs.map((g, i) => {
      const target = Math.max(3, Math.floor((g.idx.length / 3) * ratio) * 3);
      const a = attrs[i]!;
      const [idx] = MeshoptSimplifier.simplifyWithAttributes(g.idx, g.pos, 3, a.data, a.stride, a.weights, null, target, error, flags);
      return dropUnused({ ...g, idx: Uint32Array.from(idx) });
    });
    if (tris(out) <= budget) return out;
    ratio *= 0.93;
    error *= 2;
  }
  throw new Error(`could not simplify ${total} triangles to ${budget}`);
}

function writeGeom(doc: Document, g: Geom): Primitive {
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const acc = (arr: Float32Array | Uint32Array, type: 'SCALAR' | 'VEC2' | 'VEC3'): Accessor => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
  const p = doc.createPrimitive().setAttribute('POSITION', acc(g.pos, 'VEC3')).setAttribute('NORMAL', acc(g.nor, 'VEC3')).setIndices(acc(g.idx, 'SCALAR'));
  if (g.uv) p.setAttribute('TEXCOORD_0', acc(g.uv, 'VEC2'));
  if (g.material) p.setMaterial(g.material);
  return p;
}

/** Dispose every property of these types that nothing (but the root) points at any more. */
export function pruneUnused(doc: Document): void {
  const root = doc.getRoot();
  const orphan = (p: { listParents(): Array<{ propertyType: string }> }) => p.listParents().every((x) => x.propertyType === 'Root');
  for (const m of root.listMeshes()) {
    if (!orphan(m)) continue;
    // A mesh's primitives still point at their materials and accessors: dispose them with it.
    for (const p of m.listPrimitives()) p.dispose();
    m.dispose();
  }
  for (const a of root.listAccessors()) if (orphan(a)) a.dispose();
  for (const m of root.listMaterials()) if (orphan(m)) m.dispose();
  for (const t of root.listTextures()) if (orphan(t)) t.dispose();
}

export async function applyConventions(doc: Document, entry: PropSource): Promise<ConventionResult> {
  const root = doc.getRoot();
  const nodes = root.listNodes();
  for (const a of root.listAnimations()) a.dispose();
  for (const s of root.listSkins()) s.dispose();
  for (const c of root.listCameras()) c.dispose();
  for (const ext of root.listExtensionsUsed()) if (ext.extensionName === 'KHR_lights_punctual') ext.dispose();

  // Parts: find their nodes; optionally reset them to the closed pose.
  const partNodes = new Map<GNode, string>();
  for (const [name, part] of Object.entries(entry.parts ?? {})) {
    const n = nodes.find((x) => x.getName() === part.node);
    if (!n) throw new Error(`part ${name}: node "${part.node}" not found`);
    if (part.closed) n.setRotation([0, 0, 0, 1]);
    partNodes.set(n, name);
  }
  const partOf = (n: GNode): string | null => {
    for (let x: GNode | null = n; x; x = x.getParentNode()) {
      const p = partNodes.get(x);
      if (p) return p;
    }
    return null;
  };

  // Select and bake.
  const body: Geom[] = [];
  const parts = new Map<string, Part>();
  for (const [n, name] of partNodes) {
    const w = new THREE.Matrix4().fromArray(n.getWorldMatrix());
    parts.set(name, { name, hinge: new THREE.Vector3().setFromMatrixPosition(w), geoms: [] });
  }
  nodes.forEach((n, index) => {
    const mesh = n.getMesh();
    if (!mesh) return;
    const name = n.getName();
    const mats = nodeMaterials(n);
    if (entry.keep && !entry.keep.some((s) => matches(s, name, index, mats))) return;
    if (entry.drop?.some((s) => matches(s, name, index, mats))) return;
    const world = new THREE.Matrix4().fromArray(n.getWorldMatrix());
    const part = partOf(n);
    for (const p of mesh.listPrimitives()) {
      const g = readGeom(p, world);
      if (!g) continue;
      (part ? parts.get(part)!.geoms : body).push(g);
    }
  });
  const all = [...body, ...[...parts.values()].flatMap((p) => p.geoms)];
  if (!all.length) throw new Error('no meshes left after keep/drop');

  // Face -Z, then scale to height and pivot on the floor centre.
  const yaw = new THREE.Matrix4().makeRotationY(FRONT_YAW[entry.front ?? '-z']);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  const each = (fn: (g: Geom) => void) => all.forEach(fn);
  each((g) => {
    for (let i = 0; i < g.pos.length; i += 3) box.expandByPoint(v.fromArray(g.pos, i).applyMatrix4(yaw));
  });
  const size = box.getSize(new THREE.Vector3());
  if (!(size.y > 0)) throw new Error('model has no height');
  const s = entry.height / size.y;
  const centre = box.getCenter(new THREE.Vector3());
  const T = new THREE.Matrix4().makeTranslation(-centre.x * s, -box.min.y * s, -centre.z * s).multiply(new THREE.Matrix4().makeScale(s, s, s)).multiply(yaw);
  const nT = new THREE.Matrix3().getNormalMatrix(T);
  each((g) => {
    for (let i = 0; i < g.pos.length; i += 3) {
      v.fromArray(g.pos, i).applyMatrix4(T);
      g.pos.set([v.x, v.y, v.z], i);
      v.fromArray(g.nor, i).applyMatrix3(nT).normalize();
      g.nor.set([v.x, v.y, v.z], i);
    }
  });
  for (const p of parts.values()) {
    p.hinge.applyMatrix4(T);
    for (const g of p.geoms) for (let i = 0; i < g.pos.length; i += 3) for (let k = 0; k < 3; k++) g.pos[i + k]! -= p.hinge.getComponent(k);
  }

  // Weld and simplify (the budget covers body and parts together).
  const welded = all.map(weld);
  const simplified = await simplifyTo(welded, entry.triBudget);
  const byOld = new Map(all.map((g, i) => [g, simplified[i]!]));

  // Rebuild the scene: body + PART_<name> nodes.
  for (const scene of root.listScenes()) scene.dispose();
  for (const n of root.listNodes()) n.dispose();
  const scene = doc.createScene(entry.id);
  root.setDefaultScene(scene);
  const meshOf = (name: string, gs: Geom[]): Mesh => {
    const m = doc.createMesh(name);
    for (const g of gs) m.addPrimitive(writeGeom(doc, byOld.get(g)!));
    return m;
  };
  const bodyNode = doc.createNode('body');
  if (body.length) bodyNode.setMesh(meshOf('body', body));
  scene.addChild(bodyNode);
  for (const p of parts.values()) {
    const n = doc.createNode(`PART_${p.name}`).setTranslation([p.hinge.x, p.hinge.y, p.hinge.z]);
    if (p.geoms.length) n.setMesh(meshOf(`PART_${p.name}`, p.geoms));
    bodyNode.addChild(n);
  }
  pruneUnused(doc);

  // Exact bounds of the result: body in place, parts offset back onto their hinges.
  const exact = new THREE.Box3();
  for (const g of body.map((x) => byOld.get(x)!)) for (let i = 0; i < g.pos.length; i += 3) exact.expandByPoint(v.fromArray(g.pos, i));
  for (const p of parts.values()) for (const g of p.geoms.map((x) => byOld.get(x)!)) for (let i = 0; i < g.pos.length; i += 3) exact.expandByPoint(v.fromArray(g.pos, i).add(p.hinge));
  const sz = exact.getSize(new THREE.Vector3());
  return { triangles: tris(simplified), size: [sz.x, sz.y, sz.z], parts: [...parts.keys()] };
}
