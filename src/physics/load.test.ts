import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { PHYSICS_OFF } from '../core/settings.ts';
import { loadPhysics, physicsFactory, physicsLoadState, resetPhysicsLoader, type EngineImporter } from './load.ts';

// physics-world "Physics loads on demand" and "Game works without physics" (engine fails to load).

afterEach(() => resetPhysicsLoader());

const ON = { ...PHYSICS_OFF, debris: true };

test('with every feature off the engine is never imported', async () => {
  let imported = 0;
  const importer: EngineImporter = async () => {
    imported++;
    throw new Error('should not load');
  };
  assert.equal(await loadPhysics(PHYSICS_OFF, importer), null);
  assert.equal(imported, 0);
  assert.equal(physicsLoadState(), 'idle');
});

test('one feature on loads the engine once, however often it is asked', async () => {
  let imported = 0;
  const factory = async () => {
    throw new Error('not used here');
  };
  const importer: EngineImporter = async () => {
    imported++;
    return { initRapier: async () => {}, createRapierEngine: factory };
  };
  const loads = [loadPhysics(ON, importer), loadPhysics(ON, importer)];
  assert.equal(physicsLoadState(), 'loading');
  assert.equal(physicsFactory(), null, 'nothing is ready while loading');
  const [a, b] = await Promise.all(loads);
  assert.equal(a, factory);
  assert.equal(b, factory);
  assert.equal(imported, 1);
  assert.equal(physicsLoadState(), 'ready');
  assert.equal(physicsFactory(), factory);
});

test('a failed load resolves to null with one warning, and never throws', async (t) => {
  const warn = t.mock.method(console, 'warn', () => undefined);
  const importer: EngineImporter = async () => {
    throw new Error('network down');
  };
  assert.equal(await loadPhysics(ON, importer), null);
  assert.equal(await loadPhysics(ON, importer), null);
  assert.equal(physicsLoadState(), 'failed');
  assert.equal(warn.mock.callCount(), 1);
});

test('the real Rapier module loads under Node', async () => {
  const factory = await loadPhysics(ON);
  assert.ok(factory);
  const engine = await factory();
  assert.match(engine.name, /^rapier /);
  engine.destroy();
});
