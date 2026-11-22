import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { collectTextures, loadPhotoTextures } from './textures.ts';
import type { PhotoSlot } from './tex/manifest.ts';

const SLOT: PhotoSlot = {
  dir: 'metal-painted',
  metersPerTile: 2,
  tiling: true,
  tint: 0xffffff,
  roughnessScale: 1,
  fallback: 'paintTeal',
};

test('loadPhotoTextures uses createImageBitmap with flipY and colorSpaceConversion:none when available', async () => {
  const urls: string[] = [];
  const optsSeen: Array<ImageBitmapOptions | undefined> = [];
  const fakeBitmap = { width: 16, height: 16, close() {} } as unknown as ImageBitmap;

  const tex = await loadPhotoTextures(SLOT, '/', 8, {
    fetchFn: (async (url: string | URL | Request) => {
      urls.push(String(url));
      return { ok: true, status: 200, blob: async () => new Blob([new Uint8Array(4)]) } as Response;
    }) as typeof fetch,
    createBitmap: (async (_src: ImageBitmapSource, opts?: ImageBitmapOptions) => {
      optsSeen.push(opts);
      return fakeBitmap;
    }) as typeof createImageBitmap,
  });

  assert.deepEqual(urls, [
    '/assets/textures/metal-painted/color.webp',
    '/assets/textures/metal-painted/normal.webp',
    '/assets/textures/metal-painted/orm.webp',
  ]);
  assert.equal(optsSeen.length, 3);
  for (const o of optsSeen) {
    assert.equal(o?.imageOrientation, 'flipY');
    assert.equal(o?.colorSpaceConversion, 'none');
  }
  assert.equal(tex.map.flipY, false, 'bitmap textures disable WebGL flipY to avoid double-flip');
  assert.equal(tex.map.colorSpace, THREE.SRGBColorSpace);
  assert.equal(tex.normalMap.colorSpace, THREE.NoColorSpace);
  assert.equal(tex.orm.colorSpace, THREE.NoColorSpace);
  assert.equal(tex.map.repeat.x, 0.5);
  assert.equal(tex.map.anisotropy, 8);
});

test('loadPhotoTextures falls back to TextureLoader path when createImageBitmap is unavailable', async () => {
  const fallbackUrls: string[] = [];
  const tex = await loadPhotoTextures(SLOT, '/base/', 4, {
    createBitmap: null,
    fallbackLoad: async (url) => {
      fallbackUrls.push(url);
      return new THREE.Texture();
    },
  });

  assert.deepEqual(fallbackUrls, [
    '/base/assets/textures/metal-painted/color.webp',
    '/base/assets/textures/metal-painted/normal.webp',
    '/base/assets/textures/metal-painted/orm.webp',
  ]);
  assert.equal(tex.map.flipY, true, 'TextureLoader images keep flipY = true');
  assert.equal(tex.map.anisotropy, 4);
});

test('collectTextures deduplicates textures across objects, materials, and standalone textures', () => {
  const t1 = new THREE.Texture();
  const t2 = new THREE.Texture();
  const t3 = new THREE.Texture();
  const m1 = new THREE.MeshStandardMaterial({ map: t1, normalMap: t2 });
  const m2 = new THREE.MeshStandardMaterial({ map: t1, aoMap: t3 });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.BoxGeometry(), m1));
  const out = collectTextures([group, m2, t2, null]);
  assert.equal(out.length, 3);
  assert.ok(out.includes(t1));
  assert.ok(out.includes(t2));
  assert.ok(out.includes(t3));
});
