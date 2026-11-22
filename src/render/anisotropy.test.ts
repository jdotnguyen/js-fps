import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// render-quality spec: texture filtering follows the tier, live, for every kind of world texture.
// Headless: stub 2D canvases for the decal and screen textures.
const noop = (): void => undefined;
const ctx = new Proxy({} as Record<string | symbol, unknown>, {
  get: (t, k) => (k in t ? t[k] : k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern' ? () => ({ addColorStop: noop }) : k === 'measureText' ? () => ({ width: 10 }) : k === 'getImageData' || k === 'createImageData' ? () => ({ data: new Uint8ClampedArray(4) }) : noop),
  set: (t, k, v) => ((t[k] = v), true),
});
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ width: 1, height: 1, getContext: () => ctx, style: {} }) };

const { setAnisotropy, currentAnisotropy, trackedTextureCount, clearTrackedAnisotropy } = await import('./anisotropy.ts');
const { toPbrTextures } = await import('./textures.ts');
const { createMaterials, disposeMaterials } = await import('./materials.ts');
const { withVertexColors, flatBucket, flatGlowBucket, disposeMergeCaches } = await import('../world/kit/merge.ts');
const { bloodDecal } = await import('./decals.ts');
const { CanvasScreen } = await import('./screens.ts');
const { normalizeGltf } = await import('./gltf.ts');

test('generated, decal, screen and imported textures all take the tier anisotropy after a switch', () => {
  setAnisotropy(8);
  const bytes = new Uint8Array(4 * 4 * 4);
  const pbr = toPbrTextures({ size: 4, albedo: bytes, orm: bytes, normal: bytes } as unknown as Parameters<typeof toPbrTextures>[0], currentAnisotropy());
  const decal = bloodDecal(64, 64, 'aniso').map!;
  const screen = new CanvasScreen(16, 16, noop).texture;
  const glbTex = new THREE.Texture();
  const glb = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: glbTex }));
  normalizeGltf(Object.assign(new THREE.Group(), { children: [] }).add(glb));
  const all = [pbr.map, pbr.orm, pbr.normalMap, decal, screen, glbTex];
  for (const t of all) assert.equal(t.anisotropy, 8, 'created at the current tier value');

  const versions = all.map((t) => t.version);
  setAnisotropy(16); // Medium -> High on a 16x GPU
  all.forEach((t, i) => {
    assert.equal(t.anisotropy, 16, `texture ${i} follows the switch`);
    assert.ok(t.version > versions[i]!, `texture ${i} is re-uploaded so the GPU sees the new filtering`);
  });

  const before = all.map((t) => t.version);
  setAnisotropy(16);
  assert.deepEqual(all.map((t) => t.version), before, 'switching to the same value re-uploads nothing');
});

test('a disposed texture stops being tracked', () => {
  const n = trackedTextureCount();
  const screen = new CanvasScreen(8, 8, noop);
  assert.equal(trackedTextureCount(), n + 1);
  screen.texture.dispose();
  assert.equal(trackedTextureCount(), n);
});

test('disposeMaterials, disposeMergeCaches and clearTrackedAnisotropy release resources and recreate cleanly', () => {
  clearTrackedAnisotropy();
  assert.equal(trackedTextureCount(), 0);
  const mats = createMaterials(8, 4);
  assert.ok(trackedTextureCount() > 0);
  // Attach a mock ImageBitmap-like close() to verify bitmap closure on dispose.
  let closed = 0;
  const fakeBitmapTex = new THREE.Texture({ close: () => closed++ } as unknown as HTMLImageElement);
  mats.glass.map = fakeBitmapTex;

  const vc1 = withVertexColors(mats.steel);
  const fb1 = flatBucket(new THREE.MeshStandardMaterial({ color: 0x336699, roughness: 0.5 }));
  const gb1 = flatGlowBucket();

  disposeMaterials(mats);
  disposeMergeCaches();
  assert.equal(closed, 1, 'ImageBitmap.close() called on texture disposal');
  assert.equal(trackedTextureCount(), 0, 'all disposed material textures untracked');

  // Recreating produces fresh instances with no stale references.
  const mats2 = createMaterials(8, 4);
  const vc2 = withVertexColors(mats2.steel);
  const fb2 = flatBucket(new THREE.MeshStandardMaterial({ color: 0x336699, roughness: 0.5 }));
  const gb2 = flatGlowBucket();
  assert.notEqual(vc2, vc1);
  assert.notEqual(fb2, fb1);
  assert.notEqual(gb2, gb1);
  assert.equal(vc2.vertexColors, true);

  disposeMaterials(mats2);
  disposeMergeCaches();
  clearTrackedAnisotropy();
  assert.equal(trackedTextureCount(), 0);
});
