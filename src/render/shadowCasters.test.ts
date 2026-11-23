import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Rng } from '../core/rng.ts';
import { Humanoid, setCharacterShadowDistance } from '../actors/humanoid.ts';
import { ctx } from '../ai/enemyTestKit.ts';
import { ShadowCasterSet, shadowCasters, type ShadowCaster } from './shadowCasters.ts';

// A stub 2D canvas for gore's textures (as in gore.test.ts).
const noop = (): void => undefined;
const canvasCtx = new Proxy({} as Record<string | symbol, unknown>, {
  get: (t, k) => (k in t ? t[k] : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop: noop }) : noop),
  set: (t, k, v) => ((t[k] = v), true),
});
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ width: 1, height: 1, getContext: () => canvasCtx, style: {} }) };
const { GoreSystem } = await import('../actors/gore.ts');

// shadow-rich-rooms D4: every moving shadow caster registers, bumps while it moves, and leaves on dispose.

const sphere = new THREE.Sphere();
const only = (set: ShadowCasterSet): ShadowCaster => {
  const all = [...set];
  assert.equal(all.length, 1);
  return all[0]!;
};

test('a character joins the casters, bumps while alive, casts nothing beyond the shadow distance, and leaves on dispose', () => {
  const set = new ShadowCasterSet();
  const h = new Humanoid({ seed: 'caster', outfit: 'crew', role: 'npc' }, { ...ctx(), shadowCasters: set });
  new THREE.Scene().add(h.group);
  const c = only(set);
  const near = new THREE.Vector3(0, 1.6, 3);
  h.update(1 / 60, near);
  const v = c.version;
  h.update(1 / 60, near);
  assert.notEqual(c.version, v, 'a living body deforms every frame');
  assert.ok(c.bounds(sphere));
  assert.ok(sphere.radius > 1 && sphere.center.y > 0.5, 'a body-sized sphere around the torso');

  setCharacterShadowDistance(15);
  h.update(1 / 60, new THREE.Vector3(0, 1.6, 30));
  assert.equal(c.bounds(sphere), false, 'beyond the character-shadow distance it casts nothing');

  h.dispose();
  assert.equal(set.size, 0);
});

test('flying gore chunks are one caster that bumps while they fly and drops out once they rest', () => {
  const before = shadowCasters.size;
  const gore = new GoreSystem(new Rng('chunks'));
  assert.equal(shadowCasters.size, before + 1);
  const c = [...shadowCasters].at(-1)!;
  assert.equal(c.bounds(sphere), false, 'nothing flying yet');
  gore.chunks(new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(0, 1, 0), 6);
  gore.update(1 / 60);
  const v = c.version;
  assert.ok(c.bounds(sphere), 'chunks in the air');
  gore.update(1 / 60);
  assert.notEqual(c.version, v);
  for (let i = 0; i < 600; i++) gore.update(1 / 60);
  assert.equal(c.bounds(sphere), false, 'all at rest');
  const rest = c.version;
  gore.update(1 / 60);
  assert.equal(c.version, rest, 'resting chunks no longer bump');
  gore.dispose();
  assert.equal(shadowCasters.size, before);
});

test('a severed piece is a caster until it is disposed', () => {
  const gore = new GoreSystem(new Rng('limb'));
  const before = shadowCasters.size;
  const limb = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 0.1));
  let gone = false;
  gore.addDebris(limb, new THREE.Vector3(1, 2, 0), [new THREE.Vector3()], 0.05, () => void (gone = true));
  assert.equal(shadowCasters.size, before + 1);
  gore.clear();
  assert.ok(gone);
  assert.equal(shadowCasters.size, before);
  gore.dispose();
});
