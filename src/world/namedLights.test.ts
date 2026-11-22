import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EventBus } from '../core/events.ts';
import type { LevelData } from '../data/types/level.ts';
import type { Materials } from '../render/materials.ts';
import { validateSequences } from '../script/schema.ts';
import { Level } from './level.ts';
import { KitRegistry } from './registry.ts';

// render-lighting spec "A single scripted light" (overhaul-flooded-tunnel D9: the R10 beacon).

const mats = new Proxy({} as Record<string, THREE.Material>, {
  get: (t, k: string) => (t[k] ??= Object.assign(new THREE.MeshStandardMaterial(), { name: k })),
}) as unknown as Materials;

function build(): Level {
  const cells: Array<[number, number, number]> = [[0, 0, 0], [1, 0, 0], [2, 0, 0]];
  const data: LevelData = {
    id: 'named_light_test',
    seed: 1,
    playerStart: { room: 'A', pos: [0, 0, 0], yaw: 0 },
    rooms: [
      {
        id: 'A',
        name: 'A',
        pieces: [...cells.map((cell) => ({ kit: 'ceiling', cell })), { kit: 'floor', cells }],
        lights: [
          { slot: 0, pattern: 'steady' as const },
          { slot: 1, pattern: 'flicker' as const },
          { slot: 2, pattern: 'off' as const, id: 'beacon' },
        ],
      },
    ],
    doors: [],
    checkpoints: [],
  };
  return new Level(data, { materials: mats, registry: new KitRegistry({ glb: {} }), events: new EventBus(), scene: new THREE.Scene() });
}

test('switching the beacon on red leaves the room\'s other lights as they were', () => {
  const level = build();
  const lights = level.roomLights('A');
  const before = lights.map((l) => ({ pattern: l.light.pattern, color: l.light.emissives[0]!.emissive.getHex() }));
  assert.equal(level.setLight('beacon', 'alarm', 'emergency'), true);
  assert.equal(lights[2]!.light.pattern, 'alarm');
  assert.equal(lights[2]!.light.emissives[0]!.emissive.getHex(), new THREE.Color('#ff2a1a').getHex());
  for (const i of [0, 1]) {
    assert.equal(lights[i]!.light.pattern, before[i]!.pattern);
    assert.equal(lights[i]!.light.emissives[0]!.emissive.getHex(), before[i]!.color);
  }
});

test('an unknown id changes nothing, and a level reset puts the beacon back', () => {
  const level = build();
  assert.equal(level.setLight('nope', 'alarm'), false);
  const beacon = level.roomLights('A')[2]!.light;
  const own = beacon.emissives[0]!.emissive.getHex();
  level.setLight('beacon', 'alarm', 'emergency');
  level.resetToData();
  assert.equal(beacon.pattern, 'off');
  assert.equal(beacon.emissives[0]!.emissive.getHex(), own);
});

test('the light step validates its pattern', () => {
  assert.ok(validateSequences({ 'x.json': { id: 'b', steps: [{ do: 'light', id: 'beacon', pattern: 'alarm', tint: 'emergency' }] } }));
  assert.throws(() => validateSequences({ 'x.json': { id: 'b', steps: [{ do: 'light', id: 'beacon', pattern: 'blinky' }] } }));
});

// flooded-tunnel spec "Failing lights and sparks in the tunnel": a tube hanging loose swings, and its light swings with it.
test('a hanging tube offers one swinging ceiling slot whose light follows the swing', () => {
  const data: LevelData = {
    id: 'hanging_tube_test',
    seed: 1,
    playerStart: { room: 'A', pos: [0, 0, 0], yaw: 0 },
    rooms: [
      {
        id: 'A',
        name: 'A',
        pieces: [{ kit: 'floor', cell: [0, 0, 0] }],
        props: [{ kit: 'hanging_tube', pos: [0, 0, 0], params: { amp: 0.2, period: 2 } }],
        lights: [{ slot: 0, pattern: 'failing' as const }],
      },
    ],
    doors: [],
    checkpoints: [],
  };
  const level = new Level(data, { materials: mats, registry: new KitRegistry({ glb: {} }), events: new EventBus(), scene: new THREE.Scene() });
  const eye = new THREE.Vector3(0, 1.62, 1);
  const light = level.roomLights('A')[0]!;
  assert.equal(light.kind, 'ceiling');
  level.update(0, 1 / 60, eye, false);
  const a = light.position.clone();
  level.update(0.5, 1 / 60, eye, false);
  const b = light.position.clone();
  assert.ok(a.distanceTo(b) > 0.05, `the light moved ${a.distanceTo(b).toFixed(3)} m in a quarter swing`);
  assert.ok(b.y < 3.2 && b.y > 1.5, 'it hangs below the ceiling');
});
