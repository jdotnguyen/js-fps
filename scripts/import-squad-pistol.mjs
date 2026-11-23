#!/usr/bin/env node
/**
 * Imports the squad sidearm (squad-sidearms, design D1): "Heckler & Koch USP Pistol" by Urpo, CC BY 4.0,
 * https://sketchfab.com/3d-models/heckler-koch-usp-pistol-972e3643000246e8959a6df509557bcc (credited in CREDITS.md).
 *
 *   node scripts/import-squad-pistol.mjs [raw.glb]     default ../props-src/weapons/heckler__koch_usp_pistol.glb
 *
 * Writes public/assets/models/weapons/squad_pistol.glb, a held prop seen only at third-person distance:
 *   - node transforms baked, scaled to LENGTH metres, barrel along -Z, up +Y, right +X, the origin at the grip marker;
 *   - two meshes: `slide` (the slide and its sights, which kick back along +Z) and `frame` (the body, barrel, small parts
 *     and magazine), each simplified on its own with its UV seams and normals weighed, to TRI_BUDGET triangles in all;
 *   - empty marker nodes `muzzle` (the bore's front), `ejectPort` (the right side of the slide over the chamber) and `grip`
 *     (the centre of the grip at the middle of the hand's wrap; its +Y runs up the grip axis toward the slide and its -Z
 *     forward along the barrel, square to that axis);
 *   - one material per mesh: the frame's three source materials are packed into a 2x2 atlas, all maps TEX px WebP.
 *
 * The source (all three meshes in one space, about 2 units long): muzzle +Z, up +Y, the right-hand side -X. The source's
 * `Slide` mesh also holds the magazine, which is split off by connectivity, and the sights live among `Small_Parts`.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import * as THREE from 'three';
import { simplifyTo, weld } from './props/convention.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(process.argv[2] ?? join(ROOT, '../props-src/weapons/heckler__koch_usp_pistol.glb'));
const OUT = resolve(process.argv[3] ?? join(ROOT, 'public/assets/models/weapons/squad_pistol.glb'));
/** Real length of an H&K USP (m). */
const LENGTH = 0.194;
const TRI_BUDGET = 3000;
const TEX = 512;
/** Source height (units) of the grip marker: the knuckle row's centre, between the index above the trigger guard and the pinky. */
const GRIP_HEIGHT = -0.2;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(SRC);
const root = doc.getRoot();
const textures = root.listTextures();

// ------------------------------------------------------------------ read every primitive, baked into source space

function readGeom(prim, world) {
  const posA = prim.getAttribute('POSITION');
  const norA = prim.getAttribute('NORMAL');
  const uvA = prim.getAttribute('TEXCOORD_0');
  const n = posA.getCount();
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const nm = new THREE.Matrix3().getNormalMatrix(world);
  const v = new THREE.Vector3();
  const e = [];
  for (let i = 0; i < n; i++) {
    v.fromArray(posA.getElement(i, e)).applyMatrix4(world).toArray(pos, i * 3);
    v.fromArray(norA.getElement(i, e)).applyMatrix3(nm).normalize().toArray(nor, i * 3);
    uvA.getElement(i, e);
    uv[i * 2] = e[0];
    uv[i * 2 + 1] = e[1];
  }
  const idxA = prim.getIndices();
  const idx = new Uint32Array(idxA.getCount());
  for (let i = 0; i < idx.length; i++) idx[i] = idxA.getScalar(i);
  return { pos, nor, uv, idx, material: prim.getMaterial() };
}

const geoms = [];
for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const world = new THREE.Matrix4().fromArray(node.getWorldMatrix());
  for (const prim of mesh.listPrimitives()) geoms.push(readGeom(prim, world));
}
const byMaterial = (name) => {
  const g = geoms.find((x) => x.material?.getName() === name);
  if (!g) throw new Error(`material ${name} not found`);
  return g;
};

// ------------------------------------------------------------------ split by connected component

/** Triangle lists of each connected component (vertices joined by position), with its bounds. */
function components(g) {
  const n = g.pos.length / 3;
  const ids = new Int32Array(n);
  const keys = new Map();
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(g.pos[i * 3] * 1e4)},${Math.round(g.pos[i * 3 + 1] * 1e4)},${Math.round(g.pos[i * 3 + 2] * 1e4)}`;
    if (!keys.has(k)) keys.set(k, keys.size);
    ids[i] = keys.get(k);
  }
  const parent = Array.from({ length: keys.size }, (_, i) => i);
  const find = (a) => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]];
    return a;
  };
  for (let t = 0; t < g.idx.length; t += 3) {
    const a = find(ids[g.idx[t]]);
    parent[find(ids[g.idx[t + 1]])] = a;
    parent[find(ids[g.idx[t + 2]])] = a;
  }
  const out = new Map();
  for (let t = 0; t < g.idx.length; t += 3) {
    const r = find(ids[g.idx[t]]);
    let c = out.get(r);
    if (!c) out.set(r, (c = { tris: [], box: new THREE.Box3() }));
    c.tris.push(g.idx[t], g.idx[t + 1], g.idx[t + 2]);
    for (let j = 0; j < 3; j++) c.box.expandByPoint(new THREE.Vector3().fromArray(g.pos, g.idx[t + j] * 3));
  }
  return [...out.values()];
}

/** A copy of `g` with only the given triangles (vertices left as they are; welding drops the unused ones' effect). */
const withTris = (g, tris) => ({ ...g, idx: Uint32Array.from(tris) });

const body = byMaterial('Barrel_Body');
const small = byMaterial('Small_Parts');
const slideMag = byMaterial('Slide_Magazine');
const bodyParts = components(body);
const smallParts = components(small);
const slideParts = components(slideMag);
// The barrel: the body's smaller piece, inside the slide's front.
const barrel = bodyParts.sort((a, b) => b.tris.length - a.tris.length)[1];
if (!barrel) throw new Error('expected the barrel as a separate piece of Barrel_Body');
// The slide is everything of Slide_Magazine above the frame rails; the magazine reaches down the grip.
const isSlide = (c) => c.box.min.y > 0.3;
// The sights sit on top of the slide.
const isSight = (c) => c.box.min.y > 0.68;
const slideGeoms = [withTris(slideMag, slideParts.filter(isSlide).flatMap((c) => c.tris)), withTris(small, smallParts.filter(isSight).flatMap((c) => c.tris))];
const frameGeoms = [body, withTris(small, smallParts.filter((c) => !isSight(c)).flatMap((c) => c.tris)), withTris(slideMag, slideParts.filter((c) => !isSlide(c)).flatMap((c) => c.tris))];
if (!slideParts.some(isSlide) || slideParts.every(isSlide)) throw new Error('could not split the magazine off the slide');

// ------------------------------------------------------------------ markers, in source space

const box = new THREE.Box3();
for (const g of geoms) for (let i = 0; i < g.pos.length; i += 3) box.expandByPoint(new THREE.Vector3().fromArray(g.pos, i));
const scale = LENGTH / (box.max.z - box.min.z);

// Grip axis: midpoints of the grip's front-to-back extent in thin height slices below the trigger guard, fitted to a line.
const gripPts = [];
for (const g of frameGeoms) for (const i of g.idx) gripPts.push(new THREE.Vector3().fromArray(g.pos, i * 3));
const slices = [];
for (let y = -0.6; y <= -0.25 + 1e-6; y += 0.05) {
  const s = gripPts.filter((p) => Math.abs(p.y - y) < 0.025 && p.z < -0.28);
  if (s.length < 8) continue;
  const zs = s.map((p) => p.z);
  const xs = s.map((p) => p.x);
  slices.push({ y, z: (Math.min(...zs) + Math.max(...zs)) / 2, depth: Math.max(...zs) - Math.min(...zs), x: (Math.min(...xs) + Math.max(...xs)) / 2, width: Math.max(...xs) - Math.min(...xs) });
}
if (slices.length < 4) throw new Error('could not find the grip');
const my = slices.reduce((s, c) => s + c.y, 0) / slices.length;
const mz = slices.reduce((s, c) => s + c.z, 0) / slices.length;
const slope = slices.reduce((s, c) => s + (c.y - my) * (c.z - mz), 0) / slices.reduce((s, c) => s + (c.y - my) ** 2, 0);
const gripX = slices.reduce((s, c) => s + c.x, 0) / slices.length;
const gripSrc = new THREE.Vector3(gripX, GRIP_HEIGHT, mz + slope * (GRIP_HEIGHT - my));
const gripAxisSrc = new THREE.Vector3(0, 1, slope).normalize();
const gripDepth = slices.reduce((s, c) => s + c.depth, 0) / slices.length;
const gripWidth = slices.reduce((s, c) => s + c.width, 0) / slices.length;

// Muzzle: the barrel's front, on its centre line.
const muzzleSrc = new THREE.Vector3((barrel.box.min.x + barrel.box.max.x) / 2, (barrel.box.min.y + barrel.box.max.y) / 2, barrel.box.max.z);
// Ejection port: the right (-X) face of the slide, in the slide's upper half, over the chamber (the barrel's rear sixth).
const portZ = barrel.box.min.z + (barrel.box.max.z - barrel.box.min.z) / 6;
let portX = Infinity;
for (const g of slideGeoms.slice(0, 1)) for (const i of g.idx) {
  const z = g.pos[i * 3 + 2];
  const y = g.pos[i * 3 + 1];
  if (Math.abs(z - portZ) < 0.15 && y > 0.45) portX = Math.min(portX, g.pos[i * 3]);
}
if (!Number.isFinite(portX)) throw new Error('could not find the slide over the chamber');
const portSrc = new THREE.Vector3(portX, 0.64, portZ);

// ------------------------------------------------------------------ bake: barrel to -Z (half turn about Y), origin at the grip

const T = new THREE.Matrix4().makeScale(scale, scale, scale).multiply(new THREE.Matrix4().makeRotationY(Math.PI)).multiply(new THREE.Matrix4().makeTranslation(-gripSrc.x, -gripSrc.y, -gripSrc.z));
const R = new THREE.Matrix3().getNormalMatrix(T);
const toModel = (p) => p.clone().applyMatrix4(T);
function bake(g) {
  const pos = new Float32Array(g.pos.length);
  const nor = new Float32Array(g.nor.length);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.length; i += 3) {
    v.fromArray(g.pos, i).applyMatrix4(T).toArray(pos, i);
    v.fromArray(g.nor, i).applyMatrix3(R).normalize().toArray(nor, i);
  }
  return { ...g, pos, nor, uv: Float32Array.from(g.uv) };
}

/** Pack each frame material's UVs into its 2x2 atlas tile (inset a little so mip levels do not bleed across tiles). */
const TILE = { Barrel_Body: [0, 0], Small_Parts: [1, 0], Slide_Magazine: [0, 1] };
const INSET = 0.008;
function toTile(g) {
  const [tx, ty] = TILE[g.material.getName()];
  const uv = new Float32Array(g.uv.length);
  for (let i = 0; i < uv.length; i += 2) {
    uv[i] = (tx + INSET + g.uv[i] * (1 - 2 * INSET)) / 2;
    uv[i + 1] = (ty + INSET + g.uv[i + 1] * (1 - 2 * INSET)) / 2;
  }
  return { ...g, uv };
}

/** Concatenate geometries into one. */
function merge(gs) {
  const n = gs.reduce((s, g) => s + g.pos.length / 3, 0);
  const out = { pos: new Float32Array(n * 3), nor: new Float32Array(n * 3), uv: new Float32Array(n * 2), idx: new Uint32Array(gs.reduce((s, g) => s + g.idx.length, 0)), material: null };
  let vo = 0;
  let io2 = 0;
  for (const g of gs) {
    out.pos.set(g.pos, vo * 3);
    out.nor.set(g.nor, vo * 3);
    out.uv.set(g.uv, vo * 2);
    for (let i = 0; i < g.idx.length; i++) out.idx[io2 + i] = g.idx[i] + vo;
    vo += g.pos.length / 3;
    io2 += g.idx.length;
  }
  return out;
}

const slideGeom = weld(merge(slideGeoms.map(bake)));
const frameGeom = weld(merge(frameGeoms.map(bake).map(toTile)));
const tris = (g) => g.idx.length / 3;
const total = tris(slideGeom) + tris(frameGeom);
const [slideLow] = await simplifyTo([slideGeom], Math.floor((TRI_BUDGET * tris(slideGeom)) / total));
const [frameLow] = await simplifyTo([frameGeom], Math.floor((TRI_BUDGET * tris(frameGeom)) / total));

// ------------------------------------------------------------------ textures: WebP, the frame's atlased

const tmp = mkdtempSync(join(tmpdir(), 'squad-pistol-'));
const magick = (args) => {
  const r = spawnSync('magick', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`magick failed: ${r.stderr}`);
};
const dump = (tex, name) => {
  const p = join(tmp, `${name}${tex.getMimeType() === 'image/jpeg' ? '.jpg' : '.png'}`);
  writeFileSync(p, tex.getImage());
  return p;
};
const WEBP = ['-quality', '88', '-define', 'webp:method=6'];
const slots = [
  ['base', (m) => m.getBaseColorTexture()],
  ['orm', (m) => m.getMetallicRoughnessTexture()],
  ['normal', (m) => m.getNormalTexture()],
];
const mat = (name) => root.listMaterials().find((m) => m.getName() === name);
const images = {};
try {
  for (const [slot, get] of slots) {
    const src = Object.fromEntries(['Barrel_Body', 'Small_Parts', 'Slide_Magazine'].map((n) => [n, dump(get(mat(n)), `${slot}_${n}`)]));
    const slideOut = join(tmp, `slide_${slot}.webp`);
    magick([src.Slide_Magazine, '-resize', `${TEX}x${TEX}!`, ...WEBP, slideOut]);
    // The atlas: row 0 (v 0..0.5, the image's top half) Barrel_Body | Small_Parts, row 1 Slide_Magazine | blank (a flat fill).
    const half = `${TEX / 2}x${TEX / 2}!`;
    const frameOut = join(tmp, `frame_${slot}.webp`);
    const blank = slot === 'normal' ? 'xc:rgb(128,128,255)' : slot === 'orm' ? 'xc:rgb(255,200,0)' : 'xc:gray30';
    magick(['(', src.Barrel_Body, '-resize', half, src.Small_Parts, '-resize', half, '+append', ')', '(', src.Slide_Magazine, '-resize', half, '(', '-size', `${TEX / 2}x${TEX / 2}`, blank, ')', '+append', ')', '-append', ...WEBP, frameOut]);
    images[slot] = { slide: readFileSync(slideOut), frame: readFileSync(frameOut) };
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ------------------------------------------------------------------ write a fresh document

const out = new Document();
Object.assign(out.getRoot().getAsset(), { extras: root.getAsset().extras, generator: 'scripts/import-squad-pistol.mjs (glTF-Transform)' });
out.createExtension(EXTTextureWebP).setRequired(true);
const buffer = out.createBuffer();
const material = (name, part) => {
  const tex = (slot) => out.createTexture(`${part}_${slot}`).setImage(images[slot][part]).setMimeType('image/webp');
  const orm = tex('orm');
  return out
    .createMaterial(name)
    .setBaseColorTexture(tex('base'))
    .setMetallicRoughnessTexture(orm)
    .setOcclusionTexture(orm)
    .setNormalTexture(tex('normal'))
    .setMetallicFactor(1)
    .setRoughnessFactor(1)
    .setAlphaMode('OPAQUE');
};
const meshOf = (name, g, m) => {
  const acc = (arr, type) => out.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
  const prim = out.createPrimitive().setAttribute('POSITION', acc(g.pos, 'VEC3')).setAttribute('NORMAL', acc(g.nor, 'VEC3')).setAttribute('TEXCOORD_0', acc(g.uv, 'VEC2')).setIndices(acc(g.idx, 'SCALAR')).setMaterial(m);
  return out.createMesh(name).addPrimitive(prim);
};
const scene = out.createScene('squad_pistol');
out.getRoot().setDefaultScene(scene);
const top = out.createNode('squad_pistol');
scene.addChild(top);
top.addChild(out.createNode('frame').setMesh(meshOf('frame', frameLow, material('frame', 'frame'))));
top.addChild(out.createNode('slide').setMesh(meshOf('slide', slideLow, material('slide', 'slide'))));
const marker = (name, p, q = [0, 0, 0, 1]) => top.addChild(out.createNode(name).setTranslation(p.toArray()).setRotation(q));
marker('muzzle', toModel(muzzleSrc));
marker('ejectPort', toModel(portSrc));
// The grip marker's frame: +Y up the grip axis, -Z forward along the barrel (model -Z, made square to the axis).
const up = gripAxisSrc.clone().applyMatrix3(R).normalize();
const back = new THREE.Vector3(0, 0, 1).addScaledVector(up, -up.z).normalize();
const right = new THREE.Vector3().crossVectors(up, back);
const gripQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, back));
marker('grip', toModel(gripSrc), gripQ.toArray());
top.setExtras({ gripWidth: +(gripWidth * scale).toFixed(4), gripDepth: +(gripDepth * scale).toFixed(4) });

await io.write(OUT, out);
const kb = (readFileSync(OUT).byteLength / 1024).toFixed(0);
const fmt = (v) => v.toArray().map((x) => x.toFixed(4)).join(', ');
console.log(`wrote ${OUT}: ${LENGTH} m, ${tris(slideLow) + tris(frameLow)} triangles (slide ${tris(slideLow)}, frame ${tris(frameLow)}), ${kb} KB`);
console.log(`  muzzle [${fmt(toModel(muzzleSrc))}]  ejectPort [${fmt(toModel(portSrc))}]  grip axis [${fmt(up)}] (${THREE.MathUtils.radToDeg(up.angleTo(new THREE.Vector3(0, 1, 0))).toFixed(1)}° from vertical)`);
console.log(`  grip ${(gripWidth * scale * 1000).toFixed(1)} mm wide, ${(gripDepth * scale * 1000).toFixed(1)} mm deep`);
