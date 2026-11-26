import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { compileForPlay, warmShadowPass, type CompileRenderer, type ShadowWarmRenderer } from './warm.ts';

// session-loading spec (openspec stop-midgame-shader-stalls D1): programs compile for the target play draws into.

function stub(compile: () => Promise<unknown>, previous: THREE.WebGLRenderTarget | null = null) {
  let target = previous;
  const seen: Array<{ target: THREE.WebGLRenderTarget | null; args: unknown[] }> = [];
  const renderer: CompileRenderer = {
    getRenderTarget: () => target,
    setRenderTarget: (t) => void (target = t),
    compileAsync: (...args) => {
      seen.push({ target, args });
      return compile();
    },
  };
  return { renderer, seen, current: () => target };
}

test('a render target is bound while compiling, and the previous one is back before the programs are ready', async () => {
  let resolve!: () => void;
  const s = stub(() => new Promise<void>((r) => (resolve = r)));
  const root = new THREE.Group();
  const camera = new THREE.PerspectiveCamera();
  const scene = new THREE.Scene();
  const done = compileForPlay(s.renderer, root, camera, scene);
  assert.ok(s.seen[0]!.target, 'compiling against the screen would build programs play never uses');
  assert.deepEqual(s.seen[0]!.args, [root, camera, scene]);
  assert.equal(s.current(), null, 'restored at once: frames run while programs link');
  resolve();
  await done;
  assert.equal(s.current(), null);
});

test('a target already bound is restored, also when compiling throws or rejects', async () => {
  const own = new THREE.WebGLRenderTarget(2, 2);
  for (const compile of [
    () => {
      throw new Error('boom');
    },
    () => Promise.reject(new Error('boom')),
  ]) {
    const s = stub(compile, own);
    await assert.rejects(compileForPlay(s.renderer, new THREE.Group(), new THREE.PerspectiveCamera()), /boom/);
    assert.notEqual(s.seen[0]!.target, own);
    assert.equal(s.current(), own);
  }
});

test('the shadow warm-up draws once into a target with every caster in the pass, then puts everything back', () => {
  const scene = new THREE.Scene();
  const caster = new THREE.Mesh();
  caster.castShadow = true;
  const never = new THREE.Mesh();
  never.castShadow = true;
  never.frustumCulled = false;
  const plain = new THREE.Mesh();
  scene.add(caster, never, plain);
  const light = new THREE.SpotLight();
  light.shadow.autoUpdate = false;
  let target: THREE.WebGLRenderTarget | null = null;
  const seen: unknown[] = [];
  const renderer: ShadowWarmRenderer = {
    shadowMap: { needsUpdate: false },
    getRenderTarget: () => target,
    setRenderTarget: (t) => void (target = t),
    render: () => void seen.push([target !== null, renderer.shadowMap.needsUpdate, light.shadow.needsUpdate, caster.frustumCulled, plain.frustumCulled]),
  };
  warmShadowPass(renderer, scene, new THREE.PerspectiveCamera(), light);
  assert.deepEqual(seen, [[true, true, true, false, true]]);
  assert.equal(target, null);
  assert.deepEqual([caster.frustumCulled, never.frustumCulled], [true, false]);
});
