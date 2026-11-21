import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EventBus } from '../core/events.ts';
import type { LevelData, PropData } from '../data/types/level.ts';
import type { Materials } from '../render/materials.ts';
import { standInPieces, type ImportedPropRecord } from './kit/importedProps.ts';
import { Level } from './level.ts';
import { KIT_PIECES, KitRegistry } from './registry.ts';

// spec imported-props, "Imported props count against room budgets".

const mats = new Proxy({} as Record<string, THREE.Material>, {
  get: (t, k: string) => (t[k] ??= Object.assign(new THREE.MeshStandardMaterial(), { name: k })),
}) as unknown as Materials;

const rec: ImportedPropRecord = {
  url: 'assets/models/props/thing.glb', size: [0.5, 0.5, 0.5], triangles: 1500, materials: 2, transparentMaterials: 0, texturePixels: 0, bytes: 1, parts: [],
  source: { title: 't', author: 'a', licence: 'CC0', url: 'u' },
};

function stats(props: PropData[]) {
  const data: LevelData = {
    id: 'budget_test',
    seed: 1,
    playerStart: { room: 'A', pos: [0, 0, 0], yaw: 0 },
    rooms: [{ id: 'A', name: 'A', pieces: [{ kit: 'floor', cells: [[0, 0, 0], [1, 0, 0]] }], props }],
    doors: [],
    checkpoints: [],
  };
  const registry = new KitRegistry({ glb: {} }, [...KIT_PIECES, ...standInPieces({ thing: rec })]);
  const level = new Level(data, { materials: mats, registry, events: new EventBus(), scene: new THREE.Scene() });
  return level.roomStats().find((s) => s.id === 'A')!;
}

test('Headless budget check: three copies at 2 materials and 1,500 triangles add 2 calls and 4,500 triangles', () => {
  const empty = stats([]);
  const three = stats([0, 1, 2].map((i) => ({ kit: 'thing', pos: [i, 0, 0] as [number, number, number] })));
  assert.equal(three.drawCalls - empty.drawCalls, 2);
  assert.equal(three.triangles - empty.triangles, 4500);
});
