import type * as THREE from 'three';

/**
 * Stop a light's shadow pass (an unbound pool spot, the flashlight while off) without toggling
 * `castShadow`, which recompiles every material. If the light has never rendered a shadow map,
 * ask for one pass first so the map exists: three r183 binds a placeholder depth texture without
 * a compare function for a missing map in a shadow-sampler array, and WebGL2 then rejects every
 * lit draw call (the whole room rendered black). r187 fixes the placeholder; keep this anyway,
 * since a paused light with a real map costs nothing.
 */
export function pauseShadow(shadow: THREE.LightShadow): void {
  shadow.autoUpdate = false;
  if (shadow.map === null) shadow.needsUpdate = true;
}
