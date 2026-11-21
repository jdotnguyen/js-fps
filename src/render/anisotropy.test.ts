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

const { setAnisotropy, currentAnisotropy, trackedTextureCount } = await import('./anisotropy.ts');
const { toPbrTextures } = await import('./textures.ts');
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
