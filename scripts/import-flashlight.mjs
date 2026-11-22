#!/usr/bin/env node
/**
 * Imports the first-person flashlight (player-flashlight spec): "Flashlight" by MAR.COS., CC BY 4.0,
 * https://sketchfab.com/3d-models/flashlight-5fa9a65e7b0141ee877ed18f4f42d953 (credited in CREDITS.md).
 *
 *   node scripts/import-flashlight.mjs [raw.glb]     default ../props-src/flashlight/flashlight.glb
 *
 * Writes public/assets/models/weapons/flashlight.glb: one mesh, baked to LENGTH metres, the lens centre at the origin
 * and the beam along -Z (the viewmodel's forward), textures resized to TEX px WebP. The Sketchfab file's own node
 * transforms are dropped: its mesh already runs lens (-Z) to tail (+Z) in local space.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(process.argv[2] ?? join(ROOT, '../props-src/flashlight/flashlight.glb'));
const OUT = join(ROOT, 'public/assets/models/weapons/flashlight.glb');
/** Real length of a compact duty flashlight (m). */
const LENGTH = 0.22;
const TEX = 512;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(SRC);
const root = doc.getRoot();
const meshes = root.listMeshes();
if (meshes.length !== 1) throw new Error(`expected one mesh, found ${meshes.length}`);
const mesh = meshes[0];

// Bake: uniform scale to LENGTH along Z, lens centre (min Z, centred in X/Y) to the origin.
let lo = [Infinity, Infinity, Infinity];
let hi = [-Infinity, -Infinity, -Infinity];
for (const prim of mesh.listPrimitives()) {
  const p = prim.getAttribute('POSITION');
  const mn = p.getMin([]);
  const mx = p.getMax([]);
  lo = lo.map((v, i) => Math.min(v, mn[i]));
  hi = hi.map((v, i) => Math.max(v, mx[i]));
}
const scale = LENGTH / (hi[2] - lo[2]);
const centre = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]];
for (const prim of mesh.listPrimitives()) {
  const p = prim.getAttribute('POSITION');
  const v = [];
  for (let i = 0; i < p.getCount(); i++) {
    p.getElement(i, v);
    p.setElement(i, [(v[0] - centre[0]) * scale, (v[1] - centre[1]) * scale, (v[2] - centre[2]) * scale]);
  }
  // Keep only what the viewmodel shader reads.
  for (const s of prim.listSemantics()) if (!['POSITION', 'NORMAL', 'TEXCOORD_0', 'TANGENT'].includes(s)) prim.setAttribute(s, null);
}

// One scene, one node holding the mesh with no transform.
const scene = root.listScenes()[0];
for (const n of root.listNodes()) n.dispose();
const node = doc.createNode('flashlight').setMesh(mesh);
scene.addChild(node);
root.setDefaultScene(scene);

// Textures to TEX px WebP.
const tmp = mkdtempSync(join(tmpdir(), 'flashlight-'));
try {
  doc.createExtension(EXTTextureWebP).setRequired(true);
  for (const [i, t] of root.listTextures().entries()) {
    const src = join(tmp, `t${i}.png`);
    const dst = join(tmp, `t${i}.webp`);
    writeFileSync(src, t.getImage());
    const r = spawnSync('magick', [src, '-resize', `${TEX}x${TEX}`, '-quality', '88', '-define', 'webp:method=6', dst], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`magick failed on texture ${i}: ${r.stderr}`);
    t.setImage(readFileSync(dst)).setMimeType('image/webp').setURI('');
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

await io.write(OUT, doc);
const kb = (readFileSync(OUT).byteLength / 1024).toFixed(0);
console.log(`wrote ${OUT}: ${LENGTH} m, lens at origin facing -Z, ${root.listTextures().length} textures at ${TEX} px WebP, ${kb} KB`);
