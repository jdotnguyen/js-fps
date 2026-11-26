#!/usr/bin/env node
/**
 * Builds the first-person weapon viewmodels (swap-viewmodels-to-just-models): "AnimatedPistol" and "Animated Shotgun" by
 * JUST (https://sketchfab.com/teenjust500), CC BY 4.0 (credited in CREDITS.md).
 *
 *   node scripts/fix-just-weapons-glb.mjs <pistol.glb> <pistol.fbx> <shotgun.glb> <shotgun.fbx> <pistol-2k.glb> [outDir]
 *   node scripts/fix-just-weapons-glb.mjs textures <pistol-2k.glb> [pistol.glb] [out.glb]
 *
 * The first writes outDir/pistol.glb and outDir/shotgun.glb (default public/assets/models/weapons). The second only redoes
 * the pistol's gun textures on a built model (default: the shipped one, in place); geometry, skin and clips come out unchanged.
 * The sources live outside the repo (Sketchfab downloads: the glTF and the author's FBX of each model); keep your own copy
 * to rebuild.
 *
 * <pistol-2k.glb> is the 2K glTF download of AnimatedPistol (`animatedpistol.glb`, about 18 MB), from
 * https://sketchfab.com/3d-models/animatedpistol-e0bbe625b9504ed59db273c310e1cce7. Its gun meshes are the broken ones
 * described below, so only its 2048 px gun textures are used (remove-pistol-decals): the author's decals (two skull
 * emblems and "BANG" on the slide, one more skull on the magazine) are painted out and the result replaces the gun's
 * textures. See scripts/lib/pistolTextures.mjs.
 *
 * What is wrong with the Sketchfab glTF: its skeleton, arms and clips are fine, but the gun meshes are not consistent with
 * the skin. The pistol's three Colt parts are the FBX bind-pose geometry divided by 5.85 (the slide also doubled along
 * x); the shotgun body is 1.027x, its shell about 3x and flipped. Loaded as shipped, the gun floats far from the hands.
 * The author's FBX has the gun skinned correctly, so for each gun part this script:
 *   1. loads the FBX (three's FBXLoader) and skins the part to the rest pose, positions and normals;
 *   2. converts those vertices into the glTF's own bind space (the inverse of its joint-world times inverse-bind at the
 *      node default pose, which is the rest pose), so that skinning at rest lands each vertex where the FBX has it;
 *   3. swaps them into the glTF's gun mesh with the FBX's UVs and skin weights (joints mapped by bone name).
 * The arms (6.7k and 4.5k triangles, down from the FBX's 34k and 25k), the skeleton and every clip stay as they are in the glTF.
 * One shotgun part (a sight, `Remington870.001`) has a corrupt bind matrix in the FBX: it keeps its glTF geometry and is
 * scaled by the factor measured on the shotgun body (SIGHT_SCALE).
 *
 * Then it drops the rig's leftovers (camera, crosshair, sun, bone-shape widgets), renames the gun bones to Base / Up / Mag
 * (pistol) and Base / Pump / Shell (shotgun), re-encodes the other textures (1024 px) as WebP and meshopt-compresses the meshes.
 * The model keeps its authored size (the Armature node is scaled 1142x; the eye is the `camera_01` bone); the game sets its
 * scale and eye through WEAPON_MODELS in src/render/viewmodel/glbWeapons.ts. Running it on its own output gives the same model
 * (the rebuilt vertices differ by float rounding, about 3e-7).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer/meshopt_decoder.module.js';
import { MeshoptEncoder } from 'meshoptimizer/meshopt_encoder.module.js';
import * as THREE from 'three';
import { applyPistolTextures } from './lib/pistolTextures.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** FBX units (centimetre-ish, the camera bone at y = 3400) to glTF units (the camera bone at y = 34). */
const UNIT = 0.01;
/** The glTF shotgun body is the FBX's divided by this (measured over all three axes); applied to the sight part. */
const SIGHT_SCALE = 0.01027;

const WEAPONS = {
  pistol: {
    out: 'pistol.glb',
    fbxParts: ['Cube002', 'Cylinder001', 'Cube005'],
    sightParts: {},
    bones: { Base_060: 'Base', Up_061: 'Up', Mag_062: 'Mag' },
  },
  shotgun: {
    out: 'shotgun.glb',
    fbxParts: ['Remington870', 'Cylinder'],
    sightParts: { 'Remington870.001_Material.001_0': SIGHT_SCALE },
    bones: { Base_060: 'Base', Pump_061: 'Pump', Shell_062: 'Shell' },
  },
};
/** Rig leftovers: bone-shape widgets, the crosshair plane, the sun, empty name nodes. Joints are kept (they are in the skin). */
const JUNK_NODES = ['crosshair', 'Sun', 'Cube.005', 'Cube.002', 'Cylinder.001', 'sleeve', 'hardknuckle', 'shape_pose'];

const stripName = (n) => n.replace(/_\d+$/, '');

// ------------------------------------------------------------------ the FBX (three's loader wants a browser)

globalThis.window ??= { innerWidth: 1920, innerHeight: 1080 };
globalThis.self ??= globalThis;
THREE.TextureLoader.prototype.load = () => new THREE.Texture();
const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');

function loadFbx(path) {
  const buf = readFileSync(path);
  const warn = console.warn;
  console.warn = () => {};
  try {
    const fbx = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
    fbx.updateMatrixWorld(true);
    return fbx;
  } finally {
    console.warn = warn;
  }
}

// ------------------------------------------------------------------ rebuild the gun meshes

/** Replace the glTF gun mesh that matches FBX skinned mesh `o` with the FBX geometry in the rest pose. Returns a report line. */
function rebuildPart(doc, o, skinMat, jointIndexByName) {
  const root = doc.getRoot();
  const key = o.name.replace(/\./g, '');
  const target = root.listMeshes().find((m) => m.getName().replace(/\./g, '').split('_')[0] === key);
  if (!target) throw new Error(`no glTF mesh for FBX part ${o.name}`);
  o.skeleton.update();
  const g = o.geometry;
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const uv = g.attributes.uv;
  const si = g.attributes.skinIndex;
  const sw = g.attributes.skinWeight;
  const n = pos.count;
  const P = new Float32Array(n * 3);
  const N = new Float32Array(n * 3);
  const U = new Float32Array(n * 2);
  const J = new Uint16Array(n * 4);
  const W = new Float32Array(n * 4);
  const boneNames = o.skeleton.bones.map((b) => stripName(b.name));
  const bm = o.skeleton.boneMatrices;
  const sum = new THREE.Matrix4();
  const tmp = new THREE.Matrix4();
  const M = new THREE.Matrix4();
  const S = new THREE.Matrix4();
  const nm = new THREE.Matrix3();
  const v = new THREE.Vector3();
  const nv = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    sum.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    S.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    let weight = 0;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (!w) continue;
      const gi = jointIndexByName.get(boneNames[si.getComponent(i, k)]);
      if (gi === undefined) throw new Error(`${o.name}: FBX bone ${boneNames[si.getComponent(i, k)]} is not a glTF joint`);
      tmp.fromArray(bm, si.getComponent(i, k) * 16);
      for (let e = 0; e < 16; e++) {
        sum.elements[e] += tmp.elements[e] * w;
        S.elements[e] += skinMat[gi].elements[e] * w;
      }
      J[i * 4 + k] = gi;
      W[i * 4 + k] = w;
      weight += w;
    }
    for (let k = 0; k < 4; k++) W[i * 4 + k] /= weight || 1;
    // FBX local -> world at rest, then into the glTF's bind space.
    M.copy(o.matrixWorld).multiply(o.bindMatrixInverse).multiply(sum).multiply(o.bindMatrix);
    v.fromBufferAttribute(pos, i).applyMatrix4(M).multiplyScalar(UNIT);
    nm.getNormalMatrix(M);
    nv.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
    const Sinv = S.clone().invert();
    v.applyMatrix4(Sinv);
    nv.transformDirection(Sinv).normalize();
    P.set([v.x, v.y, v.z], i * 3);
    N.set([nv.x, nv.y, nv.z], i * 3);
    U.set([uv.getX(i), uv.getY(i)], i * 2);
  }
  const buffer = root.listBuffers()[0];
  const acc = (arr, type) => doc.createAccessor().setArray(arr).setType(type).setBuffer(buffer);
  const prim = target.listPrimitives()[0];
  for (const sem of prim.listSemantics()) prim.setAttribute(sem, null);
  prim.setAttribute('POSITION', acc(P, 'VEC3'));
  prim.setAttribute('NORMAL', acc(N, 'VEC3'));
  prim.setAttribute('TEXCOORD_0', acc(U, 'VEC2'));
  prim.setAttribute('JOINTS_0', acc(J, 'VEC4'));
  prim.setAttribute('WEIGHTS_0', acc(W, 'VEC4'));
  prim.setIndices(acc(g.index ? Uint32Array.from(g.index.array) : Uint32Array.from({ length: n }, (_, i) => i), 'SCALAR'));
  const size = new THREE.Box3().setFromArray(P).getSize(new THREE.Vector3());
  return `${o.name} -> ${target.getName()}: ${n} vertices, ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}`;
}

/** A part whose FBX data is unusable keeps its glTF geometry, scaled (once: a mesh already in range is left alone). */
function scalePart(doc, meshName, factor) {
  const mesh = doc.getRoot().listMeshes().find((m) => m.getName() === meshName);
  if (!mesh) throw new Error(`no glTF mesh ${meshName}`);
  const a = mesh.listPrimitives()[0].getAttribute('POSITION');
  const arr = a.getArray().slice();
  if (Math.max(...arr.map(Math.abs)) < 100) return `${meshName}: already scaled`;
  for (let i = 0; i < arr.length; i++) arr[i] *= factor;
  a.setArray(arr);
  return `${meshName}: scaled by ${factor}`;
}

// ------------------------------------------------------------------ clean-up

function dropNode(node) {
  for (const c of node.listChildren()) dropNode(c);
  node.dispose();
}

/** Dispose meshes, materials, textures and accessors that nothing uses any more (the root alone does not count). */
function prune(doc) {
  const root = doc.getRoot();
  const orphan = (p) => p.listParents().every((x) => x.propertyType === 'Root');
  for (let changed = true; changed; ) {
    changed = false;
    for (const list of [root.listMeshes(), root.listMaterials(), root.listTextures(), root.listAccessors()]) {
      for (const p of list) {
        if (orphan(p)) {
          // A mesh's primitives keep their material and accessors alive, so they go with it.
          if (p.propertyType === 'Mesh') p.listPrimitives().forEach((prim) => prim.dispose());
          p.dispose();
          changed = true;
        }
      }
    }
  }
}

function toWebp(doc) {
  const tmp = mkdtempSync(join(tmpdir(), 'just-weapons-'));
  try {
    doc.getRoot().listTextures().forEach((tex, i) => {
      if (tex.getMimeType() === 'image/webp') return;
      const src = join(tmp, `${i}.png`);
      const dst = join(tmp, `${i}.webp`);
      writeFileSync(src, tex.getImage());
      const r = spawnSync('magick', [src, '-quality', '88', '-define', 'webp:method=6', dst], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`magick failed: ${r.stderr}`);
      tex.setImage(readFileSync(dst)).setMimeType('image/webp');
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------ build one weapon

async function gltfIo() {
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
}

async function build(id, glbPath, fbxPath, outDir, texturesPath) {
  const spec = WEAPONS[id];
  const io = await gltfIo();
  const doc = await io.read(glbPath);
  const root = doc.getRoot();
  const report = [];

  // Rename the gun bones first (the FBX bones are matched by name without the exporter's _NNN suffix).
  for (const node of root.listNodes()) if (spec.bones[node.getName()]) node.setName(spec.bones[node.getName()]);
  const skin = root.listSkins()[0];
  const joints = skin.listJoints();
  const jointIndexByName = new Map(joints.map((j, i) => [stripName(j.getName()), i]));
  const ibm = skin.getInverseBindMatrices();
  const skinMat = joints.map((j, i) => new THREE.Matrix4().fromArray(j.getWorldMatrix()).multiply(new THREE.Matrix4().fromArray(ibm.getElement(i, []))));

  const fbx = loadFbx(fbxPath);
  fbx.traverse((o) => {
    if (o.isSkinnedMesh && spec.fbxParts.includes(o.name)) report.push(rebuildPart(doc, o, skinMat, jointIndexByName));
  });
  for (const [name, factor] of Object.entries(spec.sightParts)) report.push(scalePart(doc, name, factor));

  for (const node of root.listNodes()) if (JUNK_NODES.includes(node.getName())) dropNode(node);
  prune(doc);
  if (texturesPath) await applyPistolTextures(doc, io, texturesPath);
  toWebp(doc);
  if (!root.listExtensionsUsed().some((e) => e.extensionName === 'EXT_texture_webp')) doc.createExtension(EXTTextureWebP).setRequired(true);
  const meshopt = root.listExtensionsUsed().find((e) => e.extensionName === 'EXT_meshopt_compression') ?? doc.createExtension(EXTMeshoptCompression);
  meshopt.setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  root.setExtras({ ...(root.getExtras() ?? {}), license: 'CC-BY-4.0', author: 'JUST (https://sketchfab.com/teenjust500)', rebuilt: 'scripts/fix-just-weapons-glb.mjs' });

  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, spec.out);
  await io.write(out, doc);
  console.log(`${id}: ${out}\n  ${report.join('\n  ')}`);
}

/**
 * Only the pistol's gun textures, on an already built model. Geometry, skin and clips are written back losslessly
 * (meshopt without filters, which would re-quantize the rotations).
 */
async function retexture(texturesPath, modelPath, outPath) {
  const io = await gltfIo();
  const doc = await io.read(modelPath);
  await applyPistolTextures(doc, io, texturesPath);
  doc.getRoot().listExtensionsUsed().find((e) => e.extensionName === 'EXT_meshopt_compression')?.setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  await io.write(outPath, doc);
  console.log(`pistol textures: ${outPath}`);
}

const SHIPPED = join(ROOT, 'public/assets/models/weapons');
const USAGE = `usage:
  node scripts/fix-just-weapons-glb.mjs <pistol.glb> <pistol.fbx> <shotgun.glb> <shotgun.fbx> <pistol-2k.glb> [outDir]
  node scripts/fix-just-weapons-glb.mjs textures <pistol-2k.glb> [pistol.glb] [out.glb]`;
const args = process.argv.slice(2);
if (args[0] === 'textures') {
  const [, texturesPath, modelPath = join(SHIPPED, 'pistol.glb'), outPath = modelPath] = args;
  if (!texturesPath) {
    console.error(USAGE);
    process.exit(1);
  }
  await retexture(texturesPath, modelPath, outPath);
} else {
  const [pistolGlb, pistolFbx, shotgunGlb, shotgunFbx, texturesPath, outDir = SHIPPED] = args;
  if (!pistolGlb || !pistolFbx || !shotgunGlb || !shotgunFbx || !texturesPath || !existsSync(texturesPath)) {
    console.error(USAGE);
    process.exit(1);
  }
  await build('pistol', pistolGlb, pistolFbx, outDir, texturesPath);
  await build('shotgun', shotgunGlb, shotgunFbx, outDir);
}
