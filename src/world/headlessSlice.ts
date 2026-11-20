/**
 * Build slice01 without WebGL or a DOM (stub 2D canvases, plain materials), for tests and offline
 * tools such as `npm run walks:suggest`. Not a test file itself.
 */
import { readdirSync, readFileSync } from 'node:fs';
import * as THREE from 'three';

const noop = (): void => undefined;
const ctx = new Proxy({} as Record<string | symbol, unknown>, {
  get: (t, k) => (k in t ? t[k] : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop: noop }) : k === 'measureText' ? () => ({ width: 10 }) : k === 'getImageData' ? (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }) : noop),
  set: (t, k, v) => ((t[k] = v), true),
});
(globalThis as { Path2D?: unknown }).Path2D ??= function Path2D(): unknown {
  return new Proxy({}, { get: () => noop });
};
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ width: 1, height: 1, getContext: () => ctx, style: {} }) };

const { validate } = await import('../core/validate.ts');
const { EventBus } = await import('../core/events.ts');
const { validateItemTable } = await import('../data/types/items.ts');
const { levelValidator } = await import('../data/types/level.ts');
const { validateUiText } = await import('../data/types/uiText.ts');
const { KitRegistry } = await import('./registry.ts');
const { Level } = await import('./level.ts');
const { initNavmesh } = await import('../ai/navmesh.ts');
// Tests and tools path on the navmesh like the game (ADR-0028).
await initNavmesh();

const json = (p: string): unknown => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));

export type HeadlessLevel = InstanceType<typeof Level>;

/** Doors as the level holds them (tests and tools open them all to ask "is there a way"). */
export interface DoorHandle {
  data: { id: string };
  collider: { enabled: boolean };
}

export function loadSlice01(): { level: HeadlessLevel; events: InstanceType<typeof EventBus>; doors: DoorHandle[] } {
  return loadLevel('slice01');
}

/** Every level file id under `data/levels/` (`slice01`, `kit_test`, ...). */
export function levelFileIds(): string[] {
  return readdirSync(new URL('../data/levels/', import.meta.url))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort();
}

/** Build any level under `data/levels/<id>.json` headlessly. */
export function loadLevel(id: string): { level: HeadlessLevel; events: InstanceType<typeof EventBus>; doors: DoorHandle[] } {
  const items = validate(validateItemTable, json('items.json'), 'data/items.json');
  const ui = validate(validateUiText, json('dialogue/ui.json'), 'data/dialogue/ui.json');
  const registry = new KitRegistry({ glb: {} });
  const data = validate(levelValidator(registry.ids(), { items: new Set(Object.keys(items)), uiText: new Set(Object.keys(ui)) }), json(`levels/${id}.json`), id);
  const mats = new Proxy({} as Record<string | symbol, THREE.Material>, {
    get: (t, k) => (t[k] ??= k === 'glass' ? new THREE.MeshPhysicalMaterial({ transparent: true }) : new THREE.MeshStandardMaterial()),
  });
  const events = new EventBus();
  const info = console.info;
  console.info = noop;
  try {
    const level = new Level(data, { materials: mats as never, registry, events, scene: new THREE.Scene(), inventory: null, uiText: ui });
    return { level, events, doors: (level as unknown as { doors: DoorHandle[] }).doors };
  } finally {
    console.info = info;
  }
}

/** Every sequence file's parsed JSON, by file id. */
export function loadSequenceFiles(): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const dir = new URL('../data/sequences/', import.meta.url);
  for (const f of readdirSync(dir)) if (f.endsWith('.json')) out.set(f.slice(0, -5), JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
  return out;
}

