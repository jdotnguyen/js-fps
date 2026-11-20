import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bytesPerTexel, GlLedger } from './memProbe.ts';

const TEXTURE_2D = 0x0de1;
const TEXTURE_CUBE_MAP = 0x8513;
const CUBE_PX = 0x8515;
const TEXTURE0 = 0x84c0;
const ARRAY_BUFFER = 0x8892;
const RGBA8 = 0x8058;
const RGBA16F = 0x881a;
const DEPTH24_STENCIL8 = 0x88f0;

test('texStorage2D counts every mip level and is freed on delete', () => {
  const L = new GlLedger();
  const tex = {};
  L.created('textures', tex);
  L.bindTexture(TEXTURE_2D, tex);
  L.texStorage(TEXTURE_2D, 11, RGBA8, 1024, 1024);
  // 1024^2 * 4 * (1 + 1/4 + ...) for 11 levels
  let texels = 0;
  for (let l = 0; l < 11; l++) texels += Math.max(1, 1024 >> l) ** 2;
  assert.equal(L.counts.textureBytes, texels * 4);
  assert.equal(L.counts.textures, 1);
  L.deleted('textures', tex);
  assert.deepEqual([L.counts.textures, L.counts.textureBytes], [0, 0]);
});

test('re-uploading the same level does not double count; cube faces add up', () => {
  const L = new GlLedger();
  const canvasTex = {};
  L.created('textures', canvasTex);
  L.bindTexture(TEXTURE_2D, canvasTex);
  for (let i = 0; i < 5; i++) L.texImage(TEXTURE_2D, 0, RGBA8, 256, 128);
  assert.equal(L.counts.textureBytes, 256 * 128 * 4);

  const cube = {};
  L.activeTexture(TEXTURE0 + 3);
  L.bindTexture(TEXTURE_CUBE_MAP, cube);
  for (let f = 0; f < 6; f++) L.texImage(CUBE_PX + f, 0, RGBA16F, 64, 64);
  assert.equal(L.counts.textureBytes, 256 * 128 * 4 + 6 * 64 * 64 * 8);
});

test('uploads go to the texture bound on the active unit', () => {
  const L = new GlLedger();
  const a = {};
  const b = {};
  L.activeTexture(TEXTURE0);
  L.bindTexture(TEXTURE_2D, a);
  L.activeTexture(TEXTURE0 + 1);
  L.bindTexture(TEXTURE_2D, b);
  L.texImage(TEXTURE_2D, 0, RGBA8, 2, 2);
  L.deleted('textures', a);
  assert.equal(L.counts.textureBytes, 16, 'deleting a does not remove b');
});

test('buffers and renderbuffers track their latest size', () => {
  const L = new GlLedger();
  const buf = {};
  L.created('buffers', buf);
  L.bindBuffer(ARRAY_BUFFER, buf);
  L.bufferData(ARRAY_BUFFER, 1000);
  L.bufferData(ARRAY_BUFFER, 400);
  assert.equal(L.counts.bufferBytes, 400);
  const rb = {};
  L.created('renderbuffers', rb);
  L.bindRenderbuffer(rb);
  L.renderbufferStorage(DEPTH24_STENCIL8, 100, 50, 4);
  assert.equal(L.counts.renderbufferBytes, 100 * 50 * 4 * 4);
  L.deleted('buffers', buf);
  L.deleted('renderbuffers', rb);
  assert.deepEqual([L.counts.buffers, L.counts.bufferBytes, L.counts.renderbuffers, L.counts.renderbufferBytes], [0, 0, 0, 0]);
});

test('unknown formats count 4 bytes per texel; null objects are ignored', () => {
  assert.equal(bytesPerTexel(0x1234), 4);
  const L = new GlLedger();
  L.created('textures', null);
  L.deleted('textures', null);
  assert.equal(L.counts.textures, 0);
});
