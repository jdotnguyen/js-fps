import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EventBus } from '../core/events.ts';
import type { LevelData, RoomData } from '../data/types/level.ts';
import type { Materials } from '../render/materials.ts';
import { BACKUP_LIGHT, Level } from './level.ts';
import { KitRegistry } from './registry.ts';

// render-lighting spec "Backup lights", "Station power reaches every room", "Scripted light changes under backup power".

const mats = new Proxy({} as Record<string, THREE.Material>, {
  get: (t, k: string) => (t[k] ??= Object.assign(new THREE.MeshStandardMaterial(), { name: k })),
}) as unknown as Materials;

const cells: Array<[number, number, number]> = [[0, 0, 0], [1, 0, 0], [2, 0, 0]];

function room(id: string, x: number, lights: NonNullable<RoomData['lights']>): RoomData {
  const c = cells.map(([a, b, d]) => [a + x, b, d] as [number, number, number]);
  return { id, name: id, pieces: [...c.map((cell) => ({ kit: 'ceiling', cell })), { kit: 'floor', cells: c }], lights };
}

function build(rooms: RoomData[]): Level {
  const data: LevelData = { id: 'power_test', seed: 1, playerStart: { room: rooms[0]!.id, pos: [0, 0, 0], yaw: 0 }, rooms, doors: [], checkpoints: [] };
  return new Level(data, { materials: mats, registry: new KitRegistry({ glb: {} }), events: new EventBus(), scene: new THREE.Scene() });
}

const powers = (level: Level, id: string): number[] => level.roomLights(id).map((l) => l.light.power);

test('a room with no backup light keeps its first claimed light, dim and warm', () => {
  const level = build([room('A', 0, [{ slot: 0, pattern: 'steady' }, { slot: 1, pattern: 'steady' }, { slot: 2, pattern: 'steady' }])]);
  level.setPower('backup');
  assert.deepEqual(powers(level, 'A'), [BACKUP_LIGHT.scale, 0, 0]);
  const glow = level.roomLights('A')[0]!.light.emissives[0]!.emissive.getHex();
  assert.equal(glow, new THREE.Color(BACKUP_LIGHT.color).getHex());
  assert.ok(BACKUP_LIGHT.scale <= 0.3, 'no more than 30% of its main-power intensity');
});

test('lights marked backup are the ones that stay on', () => {
  const level = build([room('A', 0, [{ slot: 0, pattern: 'steady' }, { slot: 1, pattern: 'steady', backup: true }, { slot: 2, pattern: 'steady' }])]);
  level.setPower('backup');
  assert.deepEqual(powers(level, 'A'), [0, BACKUP_LIGHT.scale, 0]);
});

test('a room with an emergency beacon keeps only the beacon lit', () => {
  const r = room('A', 0, [{ slot: 0, pattern: 'steady' }, { slot: 1, pattern: 'steady' }, { slot: 'emergency', pattern: 'steady' }]);
  r.props = [{ kit: 'emergency_beacon', pos: [1, 0, 1] }];
  const level = build([r]);
  const lights = level.roomLights('A');
  assert.equal(lights[2]!.kind, 'emergency');
  level.setPower('backup');
  assert.deepEqual(powers(level, 'A'), [0, 0, BACKUP_LIGHT.scale]);
});

test('a standby beacon is dark on main power, comes on when the mains fail, and goes dark again', () => {
  const r = room('A', 0, [{ slot: 0, pattern: 'steady' }, { slot: 'emergency', pattern: 'off' }]);
  r.props = [{ kit: 'emergency_beacon', pos: [1, 0, 1] }];
  const level = build([r]);
  const beacon = level.roomLights('A')[1]!.light;
  assert.equal(beacon.pattern, 'off');
  level.setPower('backup');
  assert.equal(beacon.pattern, 'steady');
  level.update(1, 1 / 60, new THREE.Vector3(1, 1.6, 1), false);
  assert.ok(beacon.level > 0, 'the beacon glows');
  assert.equal(level.roomLights('A')[0]!.light.level, 0, 'the ceiling light is out');
  level.setPower('mains');
  assert.equal(beacon.pattern, 'off');
});

test('back on main power every light returns to its own pattern, colour and intensity', () => {
  const level = build([room('A', 0, [{ slot: 0, pattern: 'flicker', color: '#123456' }, { slot: 1, pattern: 'steady' }])]);
  const before = level.roomLights('A').map((l) => ({ pattern: l.light.pattern, glow: l.light.emissives[0]!.emissive.getHex() }));
  level.setPower('backup');
  level.setPower('mains');
  const after = level.roomLights('A').map((l) => ({ pattern: l.light.pattern, glow: l.light.emissives[0]!.emissive.getHex() }));
  assert.deepEqual(after, before);
  assert.deepEqual(powers(level, 'A'), [1, 1]);
});

test('power reaches every room, seen or not, and out lights never take a pooled light', () => {
  const level = build([
    room('A', 0, [{ slot: 0, pattern: 'steady' }, { slot: 1, pattern: 'steady' }]),
    room('B', 6, [{ slot: 0, pattern: 'steady' }, { slot: 1, pattern: 'steady' }]),
  ]);
  level.setPower('backup');
  assert.deepEqual(powers(level, 'B'), [BACKUP_LIGHT.scale, 0]);
  level.update(1, 1 / 60, new THREE.Vector3(1, 1.6, 1), false);
  for (const id of ['A', 'B']) for (const l of level.roomLights(id)) if (l.light.power === 0) assert.equal(l.light.light, null);
  for (const l of level.roomLights('A')) if (l.light.power === 0) assert.equal(l.light.level, 0, 'an out light shows a dark diffuser');
});

test('a scripted flicker under backup power moves only the backup lights', () => {
  const level = build([room('A', 0, [{ slot: 0, pattern: 'steady' }, { slot: 1, pattern: 'steady' }])]);
  level.setPower('backup');
  level.setRoomLights('A', 'flicker');
  for (let i = 0; i < 120; i++) {
    level.update(i / 60, 1 / 60, new THREE.Vector3(1, 1.6, 1), false);
    assert.equal(level.roomLights('A')[1]!.light.level, 0, 'the main light stays dark');
  }
});

test('a level reset returns to main power', () => {
  const level = build([room('A', 0, [{ slot: 0, pattern: 'steady' }, { slot: 1, pattern: 'steady' }])]);
  level.setPower('backup');
  level.resetToData();
  assert.equal(level.power, 'mains');
  assert.deepEqual(powers(level, 'A'), [1, 1]);
});

// overhaul-flooded-tunnel (playtest): the flooded tunnel's red alarm beacons stay red on backup power.
test('a beacon with ownColor keeps its own colour on backup power, and is still the room\'s lit light', () => {
  const r = room('A', 0, [{ slot: 0, pattern: 'steady' }, { slot: 'emergency', pattern: 'alarm', color: '#ff2a1a', ownColor: true }]);
  r.props = [{ kit: 'emergency_beacon', pos: [1, 0, 1] }];
  const level = build([r]);
  const beacon = level.roomLights('A')[1]!.light;
  const red = beacon.emissives[0]!.emissive.getHex();
  level.setPower('backup');
  assert.deepEqual(powers(level, 'A'), [0, BACKUP_LIGHT.scale]);
  assert.equal(beacon.emissives[0]!.emissive.getHex(), red, 'still red');
});

// overhaul-flooded-tunnel (playtest): the pump room is on its own circuit, fully lit for the ambush.
test('a light with backupScale stays lit at that strength on backup power', () => {
  const level = build([room('A', 0, [{ slot: 0, pattern: 'steady', backupScale: 1 }, { slot: 1, pattern: 'steady' }])]);
  level.setPower('backup');
  assert.deepEqual(powers(level, 'A'), [1, 0]);
});

// overhaul-priya-r08-death D24 (station-power "Medical bay on its own circuit", render-lighting "A light on its own
// circuit"): the medical bay's front row is on the medical circuit; the security office and the surgery are not.
test('slice01: the medical bay front row stays lit on backup power, the security office and surgery go to backup', async () => {
  const { readFileSync } = await import('node:fs');
  const data = JSON.parse(readFileSync(new URL('../data/levels/slice01.json', import.meta.url), 'utf8')) as LevelData;
  const lights = (id: string) => data.rooms.find((r) => r.id === id)!.lights ?? [];
  const front = lights('R08').filter((l) => l.slot === 0 || l.slot === 1 || l.slot === 2);
  assert.equal(front.length, 3);
  for (const l of front) {
    assert.equal(l.backupScale, 1, `R08 slot ${String(l.slot)}`);
    assert.equal(l.ownColor, true, `R08 slot ${String(l.slot)}`);
  }
  for (const id of ['R07', 'R07a', 'R08b']) assert.ok(lights(id).every((l) => l.backupScale === undefined), id);
  const r08 = data.rooms.find((r) => r.id === 'R08')!;
  const level = build([{ ...r08, id: 'M', props: [], pieces: room('M', 0, []).pieces, lights: lights('R08') }]);
  level.setPower('backup');
  const on = level.roomLights('M').filter((l) => l.light.power === 1);
  assert.ok(on.length >= 3, `${on.length} lights at full strength`);
});
