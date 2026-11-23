import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { COOKIE_KINDS, COOKIE_SIZE, cookieLuminance, cookieTexture } from './cookies.ts';

// shadow-rich-rooms D7: generated light patterns.

const stats = (a: Uint8Array): { min: number; max: number; mean: number } => {
  let min = 255;
  let max = 0;
  let sum = 0;
  for (const x of a) {
    min = Math.min(min, x);
    max = Math.max(max, x);
    sum += x;
  }
  return { min, max, mean: sum / a.length };
};

test('every room pattern is a 256² mipmapped grey texture with real contrast', () => {
  for (const kind of COOKIE_KINDS) {
    const tex = cookieTexture(kind);
    assert.equal(tex.image.width, COOKIE_SIZE);
    assert.equal(tex.image.height, COOKIE_SIZE);
    assert.equal(tex.generateMipmaps, true);
    assert.equal(tex.minFilter, THREE.LinearMipmapLinearFilter);
    const data = tex.image.data as Uint8Array;
    assert.equal(data[0], data[1], `${kind}: grey`);
    const s = stats(cookieLuminance(kind));
    assert.ok(s.max - s.min > 150, `${kind}: contrast ${s.min}..${s.max}`);
    assert.ok(s.mean > 60, `${kind}: still lets light through (mean ${s.mean.toFixed(0)})`);
    assert.equal(cookieTexture(kind), tex, 'shared, built once');
  }
});

test('the flashlight lens pattern is faint: brightest at the centre, a faint ring, no hard shapes', () => {
  const size = COOKIE_SIZE;
  const lum = cookieLuminance('lens');
  const at = (u: number, v: number): number => lum[Math.floor(((v + 1) / 2) * (size - 1)) * size + Math.floor(((u + 1) / 2) * (size - 1))]!;
  const centre = at(0, 0);
  assert.ok(centre >= 240, `hot spot ${centre}`);
  const s = stats(lum);
  assert.ok(s.min > 140, `never dark inside the beam (min ${s.min})`);
  // A faint ring near r 0.78, brighter than just inside it.
  let ring = 0;
  let inside = 0;
  for (let k = 0; k < 16; k++) {
    const t = (k / 16) * Math.PI * 2;
    ring += at(0.78 * Math.cos(t), 0.78 * Math.sin(t));
    inside += at(0.66 * Math.cos(t), 0.66 * Math.sin(t));
  }
  assert.ok(ring > inside, 'a faint ring towards the edge');
  // No hard edges: neighbouring texels never differ by more than a few levels.
  let maxStep = 0;
  for (let y = 0; y < size; y++) for (let x = 1; x < size; x++) maxStep = Math.max(maxStep, Math.abs(lum[y * size + x]! - lum[y * size + x - 1]!));
  assert.ok(maxStep <= 6, `max neighbour step ${maxStep}`);
});

test('the white map is a 1×1 plain texture', () => {
  const w = cookieTexture('white');
  assert.equal(w.image.width, 1);
  assert.deepEqual([...(w.image.data as Uint8Array)], [255, 255, 255, 255]);
});
