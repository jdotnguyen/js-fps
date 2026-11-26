import * as THREE from 'three';

/** The renderer calls a play compile makes (a `WebGLRenderer`, or a stub in tests). */
export interface CompileRenderer {
  getRenderTarget(): THREE.WebGLRenderTarget | null;
  setRenderTarget(target: THREE.WebGLRenderTarget | null): void;
  compileAsync(scene: THREE.Object3D, camera: THREE.Camera, targetScene?: THREE.Scene | null): Promise<unknown>;
}

/**
 * Compile the programs `root` will need in play (openspec stop-midgame-shader-stalls D1). The game draws into the post
 * chain's linear target. With no target bound, three.js keys programs as screen output (sRGB, tone mapped), so those
 * are never used and every draw compiles its real program on the spot. A target is bound for `compileAsync`'s
 * synchronous pass only and the previous one restored at once: frames may run while the programs link.
 *
 * `targetScene` supplies the lights, fog and environment when `root` is only part of a scene.
 */
export function compileForPlay(renderer: CompileRenderer, root: THREE.Object3D, camera: THREE.Camera, targetScene: THREE.Scene | null = null): Promise<void> {
  const target = new THREE.WebGLRenderTarget(1, 1);
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  let ready: Promise<unknown>;
  try {
    ready = renderer.compileAsync(root, camera, targetScene);
  } catch (err) {
    ready = Promise.reject(err);
  } finally {
    renderer.setRenderTarget(previous);
    target.dispose();
  }
  return ready.then(() => undefined);
}

/** The renderer calls the shadow warm-up makes. */
export interface ShadowWarmRenderer {
  readonly shadowMap: { needsUpdate: boolean };
  getRenderTarget(): THREE.WebGLRenderTarget | null;
  setRenderTarget(target: THREE.WebGLRenderTarget | null): void;
  render(scene: THREE.Object3D, camera: THREE.Camera): void;
}

/**
 * Build the shadow-depth programs, which `compile` does not (openspec stop-midgame-shader-stalls D5): one draw of
 * `scene` in which `light`'s shadow pass takes every visible caster, wherever it is. Reveal what play can show first.
 */
export function warmShadowPass(renderer: ShadowWarmRenderer, scene: THREE.Object3D, camera: THREE.Camera, light: THREE.SpotLight): void {
  const culled: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.castShadow || !o.frustumCulled) return;
    o.frustumCulled = false;
    culled.push(o);
  });
  const target = new THREE.WebGLRenderTarget(1, 1);
  const previous = renderer.getRenderTarget();
  try {
    light.shadow.needsUpdate = true;
    renderer.shadowMap.needsUpdate = true;
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
  } finally {
    renderer.setRenderTarget(previous);
    target.dispose();
    for (const o of culled) o.frustumCulled = true;
  }
}
