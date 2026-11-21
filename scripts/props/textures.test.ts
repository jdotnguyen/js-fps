import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Document } from '@gltf-transform/core';
import type { MapSet } from './readers.ts';
import { findMagick, processTextures, textureSize } from './textures.ts';
import { tempDir } from './testFixtures.ts';

const magick = findMagick();
const skip = 'bin' in magick ? false : magick.error;
const bin = 'bin' in magick ? magick.bin : '';

test('Small prop: a 0.5 m prop at the default density gets 512 px textures', () => {
  assert.equal(textureSize(0.5), 512);
  assert.equal(textureSize(1.8), 2048);
  assert.equal(textureSize(0.1), 256);
  assert.equal(textureSize(4), 2048);
  assert.equal(textureSize(0.5, 512), 256);
});

function png(dir: string, name: string, colour: string, px = 16): Uint8Array {
  const out = join(dir, name);
  execFileSync(bin, ['-size', `${px}x${px}`, `xc:${colour}`, '-depth', '8', `PNG24:${out}`]);
  return new Uint8Array(readFileSync(out));
}

/** Green channel (0-255) of the centre pixel and the size of a WebP texture. */
function probe(dir: string, image: Uint8Array): { g: number; r: number; b: number; w: number } {
  const f = join(dir, `probe${Math.random().toString(36).slice(2)}.webp`);
  writeFileSync(f, image);
  const out = execFileSync(bin, [f, '-format', '%[fx:int(255*p{w/2,h/2}.r+0.5)] %[fx:int(255*p{w/2,h/2}.g+0.5)] %[fx:int(255*p{w/2,h/2}.b+0.5)] %w', 'info:'], { encoding: 'utf8' });
  const [r, g, b, w] = out.trim().split(/\s+/).map(Number);
  return { r: r!, g: g!, b: b!, w: w! };
}

function material(doc: Document, set: Partial<MapSet>): Map<ReturnType<Document['createMaterial']>, MapSet> {
  const m = doc.createMaterial('paint');
  return new Map([[m, { color: null, normal: null, normalDx: false, roughness: null, metalness: null, ao: null, ...set }]]);
}

test('DirectX normal source: green is inverted; an OpenGL one is left alone', { skip }, () => {
  const dir = tempDir();
  for (const dx of [true, false]) {
    const doc = new Document();
    const normal = doc.createTexture('n').setImage(png(dir, 'n.png', 'rgb(128,200,255)')).setMimeType('image/png');
    const maps = material(doc, { normal, normalDx: dx });
    processTextures(doc, maps, 0.5, undefined, bin);
    const out = [...maps.keys()][0]!.getNormalTexture()!;
    assert.equal(out.getMimeType(), 'image/webp');
    const p = probe(dir, out.getImage()!);
    assert.equal(p.w, 512);
    if (dx) assert.ok(Math.abs(p.g - 55) <= 3, `dx green ${p.g}`);
    else assert.ok(Math.abs(p.g - 200) <= 3, `gl green ${p.g}`);
  }
});

test('ORM packs AO, roughness and metalness from separate maps, white where a map is missing', { skip }, () => {
  const dir = tempDir();
  const doc = new Document();
  const rough = doc.createTexture('r').setImage(png(dir, 'r.png', 'gray(150)')).setMimeType('image/png');
  const metal = doc.createTexture('m').setImage(png(dir, 'm.png', 'gray(40)')).setMimeType('image/png');
  const maps = material(doc, { roughness: { texture: rough, channel: 'R' }, metalness: { texture: metal, channel: 'R' } });
  const r = processTextures(doc, maps, 0.3, undefined, bin);
  const m = [...maps.keys()][0]!;
  const orm = m.getMetallicRoughnessTexture()!;
  assert.equal(m.getOcclusionTexture(), null, 'no AO map, no occlusion slot');
  const p = probe(dir, orm.getImage()!);
  assert.ok(p.r >= 250, `R (AO) white ${p.r}`);
  assert.ok(Math.abs(p.g - 150) <= 3, `G (roughness) ${p.g}`);
  assert.ok(Math.abs(p.b - 40) <= 3, `B (metalness) ${p.b}`);
  assert.equal(r.size, 512);
  assert.equal(r.textures, 1);
  assert.equal(r.texturePixels, 512 * 512);
  assert.ok(doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'EXT_texture_webp'));
});

test('a glTF metal-rough map is split into G and B, and its occlusion into R', { skip }, () => {
  const dir = tempDir();
  const doc = new Document();
  const arm = doc.createTexture('arm').setImage(png(dir, 'arm.png', 'rgb(90,160,30)')).setMimeType('image/png');
  const maps = material(doc, { roughness: { texture: arm, channel: 'G' }, metalness: { texture: arm, channel: 'B' }, ao: { texture: arm, channel: 'R' } });
  processTextures(doc, maps, 0.5, undefined, bin);
  const m = [...maps.keys()][0]!;
  assert.equal(m.getOcclusionTexture(), m.getMetallicRoughnessTexture());
  const p = probe(dir, m.getMetallicRoughnessTexture()!.getImage()!);
  assert.ok(Math.abs(p.r - 90) <= 3 && Math.abs(p.g - 160) <= 3 && Math.abs(p.b - 30) <= 3, JSON.stringify(p));
});
