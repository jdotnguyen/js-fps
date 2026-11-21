/**
 * Lazy physics engine loader (adopt-physics-engine, design D10; physics-world "Physics loads on demand",
 * "Game works without physics"). The engine is its own bundle chunk, fetched only when a level loads with at
 * least one physics feature switched on. Nothing awaits it: until it is ready, or if it fails, every feature
 * uses its fallback.
 */
import type { PhysicsSwitches } from '../core/settings.ts';
import type { PhysicsEngineFactory } from './engine.ts';
import { anyPhysics } from './switches.ts';

export type PhysicsLoadState = 'idle' | 'loading' | 'ready' | 'failed';

/** What the loader needs from the engine module (the Rapier adapter). */
export interface EngineModule {
  initRapier(): Promise<void>;
  createRapierEngine: PhysicsEngineFactory;
}
export type EngineImporter = () => Promise<EngineModule>;

const defaultImporter: EngineImporter = () => import('./rapierAdapter.ts');

let state: PhysicsLoadState = 'idle';
let factory: PhysicsEngineFactory | null = null;
let pending: Promise<PhysicsEngineFactory | null> | null = null;

/**
 * Start loading the engine if any feature is on (once per page; later calls share the first load). Resolves to
 * the engine factory, or null when nothing is switched on or the load failed (one warning, no throw).
 */
export function loadPhysics(switches: PhysicsSwitches, importer: EngineImporter = defaultImporter): Promise<PhysicsEngineFactory | null> {
  if (!anyPhysics(switches)) return Promise.resolve(factory);
  pending ??= (async () => {
    state = 'loading';
    try {
      const mod = await importer();
      await mod.initRapier();
      factory = mod.createRapierEngine;
      state = 'ready';
      return factory;
    } catch (err) {
      state = 'failed';
      console.warn('[physics] engine failed to load; physics features use their fallbacks', err);
      return null;
    }
  })();
  return pending;
}

export function physicsLoadState(): PhysicsLoadState {
  return state;
}

/** The engine factory once loaded, else null (callers fall back). */
export function physicsFactory(): PhysicsEngineFactory | null {
  return factory;
}

/** Tests only: forget the loaded engine. */
export function resetPhysicsLoader(): void {
  state = 'idle';
  factory = null;
  pending = null;
}
