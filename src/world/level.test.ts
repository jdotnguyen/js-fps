import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EventBus } from '../core/events.ts';
import type { LevelData } from '../data/types/level.ts';
import { createMaterials, disposeMaterials } from '../render/materials.ts';
import { disposeMergeCaches } from './kit/merge.ts';
import { KitRegistry } from './registry.ts';
import { Level, loadLevel } from './level.ts';

function minimalLevel(): LevelData {
  return {
    id: 'dispose_test',
    name: 'Dispose Test',
    seed: 'test',
    playerStart: { room: 'R01', pos: [0, 0, 0], yaw: 0 },
    checkpoints: [],
    rooms: [
      {
        id: 'R01',
        name: 'Test Room',
        pieces: [{ kit: 'corridor_straight', cell: [0, 0, 0], rot: 0 }],
      },
    ],
    doors: [],
  };
}

test('Level.dispose and KitRegistry.dispose release geometries, pools, cached GLBs and listeners', async () => {
  const events = new EventBus();
  const scene = new THREE.Scene();
  const materials = createMaterials(8, 4);
  const registry = new KitRegistry({ glb: { custom_glb: 'mock.glb' } });
  const mockGeom = new THREE.BoxGeometry(1, 1, 1);
  const mockMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  let glbGeomDisposed = 0;
  let glbMatDisposed = 0;
  mockGeom.addEventListener('dispose', () => glbGeomDisposed++);
  mockMat.addEventListener('dispose', () => glbMatDisposed++);
  const mockGroup = new THREE.Group();
  mockGroup.add(new THREE.Mesh(mockGeom, mockMat));
  await registry.preload(['custom_glb'], async () => ({ scene: mockGroup }));
  assert.equal(registry.source('custom_glb'), 'glb');

  const level = await loadLevel(minimalLevel(), {
    materials,
    registry,
    events,
    scene,
    lightBudget: { fillLights: 4, shadowLights: 1, shadowMapSize: 512 },
  });
  scene.add(level.group);
  assert.equal(level.pool.size, 4);
  assert.equal(level.shadowPool.size, 1);
  assert.ok(level.group.children.length > 0);

  let disposedGeoms = 0;
  level.group.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
      o.geometry.addEventListener('dispose', () => disposedGeoms++);
    }
  });

  // Build nav fallback before disposing.
  const nav = level.navGraph();
  assert.ok(nav.nodes.length >= 0);

  level.dispose();
  registry.dispose();
  disposeMaterials(materials);
  disposeMergeCaches();

  assert.equal(level.pool.size, 0, 'fill light pool emptied');
  assert.equal(level.shadowPool.size, 0, 'shadow pool emptied');
  assert.equal(level.group.children.length, 0, 'level group cleared');
  assert.ok(disposedGeoms > 0, 'level geometries disposed');
  assert.equal(registry.source('custom_glb'), 'procedural', 'registry GLB cache cleared');
  assert.equal(glbGeomDisposed, 1, 'cached GLB geometry disposed');
  assert.equal(glbMatDisposed, 1, 'cached GLB material disposed');
});

test('Level.buildAsync reports monotonic progress and matches synchronous Level output', async () => {
  const eventsSync = new EventBus();
  const eventsAsync = new EventBus();
  const matSync = createMaterials(8, 4);
  const matAsync = createMaterials(8, 4);
  const regSync = new KitRegistry({ glb: {} });
  const regAsync = new KitRegistry({ glb: {} });
  const data = minimalLevel();

  const syncLevel = new Level(data, { materials: matSync, registry: regSync, events: eventsSync, scene: new THREE.Scene() });
  const progress: Array<{ f: number; label: string }> = [];
  const asyncLevel = await loadLevel(
    data,
    { materials: matAsync, registry: regAsync, events: eventsAsync, scene: new THREE.Scene() },
    { onProgress: (f, label) => progress.push({ f, label }) },
  );

  assert.ok(progress.length >= 3, 'reports multiple loading stages');
  for (let i = 1; i < progress.length; i++) {
    assert.ok(progress[i]!.f >= progress[i - 1]!.f, `progress monotonic (${progress[i - 1]!.f} -> ${progress[i]!.f})`);
  }
  assert.equal(progress.at(-1)!.f, 1, 'ends at 1.0');
  assert.deepEqual(asyncLevel.roomStats(), syncLevel.roomStats(), 'async build produces identical room geometry stats');

  syncLevel.dispose();
  asyncLevel.dispose();
  regSync.dispose();
  regAsync.dispose();
  disposeMaterials(matSync);
  disposeMaterials(matAsync);
  disposeMergeCaches();
});
