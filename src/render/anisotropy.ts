import type * as THREE from 'three';

/**
 * Texture anisotropy for the active quality tier (render-quality spec). Textures that sample the
 * world at grazing angles register here when created and take the tier's value, and a tier switch
 * re-applies it. Three reads anisotropy only on upload, so a change re-uploads each texture once.
 */
const tracked = new Set<THREE.Texture>();
let level = 8;

function untrack(this: THREE.Texture): void {
  tracked.delete(this);
}

/**
 * Give `texture` the current anisotropy (or `initial`, when the creator chose one) and keep it in
 * step with later tier switches. Returns it.
 */
export function trackAnisotropy<T extends THREE.Texture>(texture: T, initial = level): T {
  texture.anisotropy = initial;
  if (!tracked.has(texture)) {
    tracked.add(texture);
    texture.addEventListener('dispose', untrack);
  }
  return texture;
}

/** Set the anisotropy every tracked texture uses (at load and on a tier switch). */
export function setAnisotropy(value: number): void {
  const next = Math.max(1, Math.floor(value));
  if (next === level) return;
  level = next;
  for (const t of tracked) {
    if (t.anisotropy === level) continue;
    t.anisotropy = level;
    t.needsUpdate = true;
  }
}

export function currentAnisotropy(): number {
  return level;
}

/** Tracked textures, for tests. */
export function trackedTextureCount(): number {
  return tracked.size;
}

/** Drop all tracked textures and detach dispose listeners (session teardown). */
export function clearTrackedAnisotropy(): void {
  for (const t of tracked) t.removeEventListener('dispose', untrack);
  tracked.clear();
}
