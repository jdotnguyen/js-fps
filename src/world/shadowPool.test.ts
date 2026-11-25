import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EventBus } from '../core/events.ts';
import { validate } from '../core/validate.ts';
import { levelValidator, type KitIds, type LevelData } from '../data/types/level.ts';
import type { Materials } from '../render/materials.ts';
import { RENDER_TIERS } from '../render/tiers.ts';
import { Level } from './level.ts';
import { KitRegistry } from './registry.ts';
import { LightPool } from './lightPool.ts';
import { SHADOW_CONES, ShadowPool } from './shadowPool.ts';
import { labLamps } from './labWorld.ts';
import type { LightBudget } from './world.ts';

// render-lighting spec (openspec fidelity-first-rendering): fill and shadow pools sized by tier,
// room lights opting in to shadows, fallback to the fill pool, and a constant light count in play.

const mats = new Proxy({} as Record<string, THREE.Material>, {
  get: (t, k: string) => (t[k] ??= k === 'glass' ? new THREE.MeshPhysicalMaterial({ transparent: true }) : Object.assign(new THREE.MeshStandardMaterial(), { name: k })),
}) as unknown as Materials;

const budget = (q: keyof typeof RENDER_TIERS): LightBudget => ({ fillLights: RENDER_TIERS[q].fillLights, shadowLights: RENDER_TIERS[q].shadowLights, shadowMapSize: RENDER_TIERS[q].shadowMapSize, cookieSpots: RENDER_TIERS[q].cookieSpots });

/**
 * Room A: 6 ceiling cells in a row (x 0..5), all lit; `shadowSlots` opt in to shadows.
 * Room B (x 7..8) is visible from A, both its lights opted in.
 */
function build(shadowSlots: number[], q: keyof typeof RENDER_TIERS, cookies: Record<number, 'grille' | 'fan' | 'cracked'> = {}): Level {
  const aCells = Array.from({ length: 6 }, (_, x) => [x, 0, 0] as [number, number, number]);
  const data: LevelData = {
    id: 'shadow_test',
    seed: 1,
    playerStart: { room: 'A', pos: [0, 0, 0], yaw: 0 },
    rooms: [
      {
        id: 'A',
        name: 'A',
        pieces: [...aCells.map((cell) => ({ kit: 'ceiling', cell })), { kit: 'floor', cells: aCells }],
        lights: aCells.map((_, i) => ({ slot: i, pattern: 'steady' as const, ...(shadowSlots.includes(i) ? { shadow: true } : {}), ...(cookies[i] ? { cookie: cookies[i] } : {}) })),
      },
      {
        id: 'B',
        name: 'B',
        visibleFrom: ['A'],
        pieces: [{ kit: 'ceiling', cell: [7, 0, 0] }, { kit: 'ceiling', cell: [8, 0, 0] }, { kit: 'floor', cells: [[7, 0, 0], [8, 0, 0]] }],
        lights: [{ slot: 0, pattern: 'steady', shadow: true }, { slot: 1, pattern: 'steady', shadow: true }],
      },
    ],
    doors: [],
    checkpoints: [],
  };
  const level = new Level(data, { materials: mats, registry: new KitRegistry({ glb: {} }), events: new EventBus(), scene: new THREE.Scene(), lightBudget: budget(q) });
  level.update(0, 1 / 60, new THREE.Vector3(0, 1.62, 0), false);
  return level;
}

const spots = (level: Level, room: string): number => level.roomLights(room).filter((l) => l.light.light instanceof THREE.SpotLight).length;
const points = (level: Level, room: string): number => level.roomLights(room).filter((l) => l.light.light instanceof THREE.PointLight).length;
const lightCount = (level: Level): number => {
  let n = 0;
  level.group.traverse((o) => void (o instanceof THREE.Light && !(o instanceof THREE.HemisphereLight) && !(o instanceof THREE.DirectionalLight) && n++));
  return n;
};

test('LightPool.resize grows and shrinks the pool; assign never changes its size', () => {
  const parent = new THREE.Group();
  const pool = new LightPool(parent, 16);
  pool.resize(32);
  assert.equal(pool.size, 32);
  assert.equal(parent.children.filter((c) => c instanceof THREE.PointLight).length, 32);
  pool.resize(12);
  assert.equal(pool.size, 12);
  assert.equal(parent.children.length, 12, 'removed lights leave the scene');
});

test('switching Medium to High gives the level 32 fill lights, and play never changes the count', () => {
  const level = build([], 'medium');
  assert.equal(level.pool.size, 16);
  level.setLightBudget(budget('high'));
  assert.equal(level.pool.size, 32);
  assert.equal(level.shadowPool.size, 6);
  const count = lightCount(level);
  for (let i = 0; i < 30; i++) level.update(i / 10, 0.1, new THREE.Vector3(i * 0.3, 1.62, 0), false);
  assert.equal(level.pool.size, 32);
  assert.equal(level.shadowPool.size, 6);
  assert.equal(lightCount(level), count, 'no light is added or removed during play');
});

test('the lab world sizes its pool from the tier: 12 on Low, 32 on High', () => {
  const group = new THREE.Group();
  const lamps = Array.from({ length: 40 }, (_, i) => ({ x: i * 2, y: 3, z: 0 }));
  const { pool, slots } = labLamps(group, lamps, RENDER_TIERS.low.fillLights);
  assert.equal(pool.size, 12);
  pool.assign(slots, new THREE.Vector3());
  assert.equal(pool.boundCount(), 12);
  pool.resize(RENDER_TIERS.high.fillLights);
  pool.assign(slots, new THREE.Vector3());
  assert.equal(pool.size, 32);
  assert.equal(pool.boundCount(), 32);
});

test('shadow lights go to opted-in lights in the current room first, nearest first', () => {
  const level = build([0, 3, 5], 'medium');
  // Medium holds 2: the camera at x 0 is nearest A's slot 0 then slot 3; B's opted-in lights miss.
  assert.equal(spots(level, 'A'), 2);
  assert.equal(spots(level, 'B'), 0);
  const a = level.roomLights('A');
  assert.ok(a[0]!.light.light instanceof THREE.SpotLight, 'slot 0 is shadowed');
  assert.ok(a[3]!.light.light instanceof THREE.SpotLight, 'slot 3 (the second opted-in, nearer than 5) is shadowed');
  assert.ok(a[5]!.light.light instanceof THREE.PointLight, 'slot 5 misses the shadow pool and falls back to the fill pool');
  assert.ok(a[1]!.light.light instanceof THREE.PointLight, 'a light that did not opt in uses the fill pool');
  const spot = a[0]!.light.light as THREE.SpotLight;
  assert.ok(spot.castShadow);
  assert.ok(spot.target.position.y < spot.position.y, 'the cone points down from the fixture');
  assert.equal(spot.shadow.mapSize.x, 1024, 'Medium shadow map size');
});

test('when more visible lights opt in than the pool holds, the farthest ones light the room unshadowed', () => {
  const level = build([0, 1, 2, 3, 4, 5], 'high');
  assert.equal(spots(level, 'A'), 6, 'High holds 6 and the current room takes them all');
  assert.equal(spots(level, 'B'), 0);
  assert.equal(points(level, 'B'), 2, "B's opted-in lights still light the room, unshadowed");
});

test('Low binds no shadow lights; every opted-in light uses the fill pool', () => {
  const level = build([0, 1, 2], 'low');
  assert.equal(level.shadowPool.size, 0);
  assert.equal(spots(level, 'A') + spots(level, 'B'), 0);
  assert.equal(points(level, 'A'), 6);
  assert.equal(points(level, 'B'), 2, 'Low holds 12: both rooms fully lit');
});

test('patterns and tints drive a bound shadow spot like a fill light', () => {
  const level = build([0], 'medium');
  const slot = level.roomLights('A')[0]!;
  const spot = slot.light.light as THREE.SpotLight;
  assert.ok(spot instanceof THREE.SpotLight);
  const steady = spot.intensity;
  assert.ok(steady > 0);
  assert.ok(level.setRoomLights('A', 'alarm'));
  const seen = new Set<number>();
  for (let i = 0; i < 8; i++) {
    level.update(0.1 + i * 0.07, 0.07, new THREE.Vector3(0, 1.62, 0), false);
    seen.add(Math.round(spot.intensity * 1000));
  }
  assert.ok(seen.size > 3, 'the alarm pattern varies the spot over time');
  assert.ok(Math.max(...seen) / 1000 <= steady + 1e-6);
  assert.ok(level.tintRoomLights('A', 'emergency'));
  level.update(1, 0.1, new THREE.Vector3(0, 1.62, 0), false);
  assert.equal(spot.color.getHexString(), new THREE.Color('#ff2a1a').getHexString(), 'emergency red reaches the spot');
});

test('camera feeds render with the shadow spots unbound', () => {
  const level = build([0], 'medium');
  let during = -1;
  level.renderFromEye(new THREE.Vector3(0, 1.62, 0), () => void (during = level.shadowPool.boundCount()));
  assert.equal(during, 0);
  assert.ok(level.roomLights('A')[0]!.light.light instanceof THREE.PointLight, 'the opted-in light still lights the feed');
});

test('level data accepts shadow: true and rejects a non-boolean', () => {
  const kits: KitIds = { structure: new Set(['ceiling', 'floor']), prop: new Set() };
  const raw = (shadow: unknown): unknown => ({
    id: 'v',
    seed: 1,
    playerStart: { room: 'A', pos: [0, 0, 0], yaw: 0 },
    rooms: [{ id: 'A', name: 'A', pieces: [{ kit: 'ceiling', cell: [0, 0, 0] }], lights: [{ slot: 0, pattern: 'steady', shadow }] }],
    doors: [],
    checkpoints: [],
  });
  const ok = validate(levelValidator(kits), raw(true), 'v');
  assert.equal(ok.rooms[0]!.lights![0]!.shadow, true);
  assert.throws(() => validate(levelValidator(kits), raw('yes'), 'v'), /shadow/);
});

test('every cone kind sets its shadow biases and a soft-PCF radius above 1, and a bound spot takes them (r183 PCFShadowMap)', () => {
  for (const [kind, cone] of Object.entries(SHADOW_CONES)) {
    assert.ok(cone.bias < 0 && cone.bias > -0.01, `${kind} bias`);
    assert.ok(cone.normalBias > 0 && cone.normalBias < 0.1, `${kind} normal bias`);
    assert.ok(cone.radius > 1, `${kind} radius ${cone.radius} is soft`);
  }
  const spot = build([0], 'high').roomLights('A')[0]!.light.light as THREE.SpotLight;
  assert.equal(spot.shadow.bias, SHADOW_CONES.ceiling.bias);
  assert.equal(spot.shadow.normalBias, SHADOW_CONES.ceiling.normalBias);
  assert.equal(spot.shadow.radius, SHADOW_CONES.ceiling.radius);
});

test('an unbound pool spot stays paused but gets one shadow pass to allocate its map (r183 empty shadow sampler)', () => {
  const level = build([0], 'high');
  const spot = level.roomLights('A')[0]!.light.light as THREE.SpotLight;
  let unbound: THREE.SpotLight | undefined;
  level.group.traverse((o) => void (o instanceof THREE.SpotLight && o !== spot && o.intensity === 0 && o.castShadow && (unbound ??= o)));
  assert.ok(unbound, 'High leaves pool spots unbound');
  assert.equal(unbound.shadow.autoUpdate, false);
  assert.equal(unbound.shadow.needsUpdate, true);
});

test('a camera feed drawn every frame causes no hand-overs, no fade restarts and no extra redraws (shadow-rich-rooms D2a)', () => {
  const level = build([0, 3], 'medium');
  const eye = new THREE.Vector3(0, 1.62, 0);
  for (let i = 1; i < 30; i++) level.update(i / 60, 1 / 60, eye, false);
  const before = level.shadowPool.states().map((s) => [s.slot, s.phase, s.fade]);
  for (let i = 30; i < 120; i++) {
    let lit = -1;
    level.renderFromEye(new THREE.Vector3(4, 1.62, 0), () => void (lit = level.shadowPool.lights.filter((l) => l.intensity > 0).length));
    assert.equal(lit, 0, 'no shadow spot lights the feed');
    level.update(i / 60, 1 / 60, eye, false);
    assert.equal(level.shadowPool.redraws, 0, `frame ${i}: nothing redrawn`);
  }
  assert.deepEqual(level.shadowPool.states().map((s) => [s.slot, s.phase, s.fade]), before);
  assert.ok(level.shadowPool.lights.every((l) => l.intensity > 0), 'the player view is lit by both spots again');
});

test('level data accepts a known light pattern and rejects an unknown one', () => {
  const kits: KitIds = { structure: new Set(['ceiling', 'floor']), prop: new Set() };
  const raw = (cookie: unknown): unknown => ({
    id: 'v',
    seed: 1,
    playerStart: { room: 'A', pos: [0, 0, 0], yaw: 0 },
    rooms: [{ id: 'A', name: 'A', pieces: [{ kit: 'ceiling', cell: [0, 0, 0] }], lights: [{ slot: 0, pattern: 'steady', shadow: true, cookie }] }],
    doors: [],
    checkpoints: [],
  });
  for (const kind of ['grille', 'fan', 'cracked']) assert.equal(validate(levelValidator(kits), raw(kind), 'v').rooms[0]!.lights![0]!.cookie, kind);
  assert.throws(() => validate(levelValidator(kits), raw('disco'), 'v'), /cookie/);
  assert.throws(() => validate(levelValidator(kits), raw('lens'), 'v'), /cookie/, "the flashlight's lens is not a room pattern");
});

test('a level light with a cookie offers it to the pool, and a patterned spot projects it', () => {
  const level = build([0, 3], 'medium', { 3: 'grille' });
  const a = level.roomLights('A');
  const patterned = a[3]!.light.light as THREE.SpotLight;
  assert.ok(patterned instanceof THREE.SpotLight);
  assert.equal(patterned.map?.name, 'cookie:grille', "Medium's one patterned spot goes to the patterned light");
  const plain = a[0]!.light.light as THREE.SpotLight;
  assert.ok(plain instanceof THREE.SpotLight);
  assert.equal(plain.map, null);
});

test('a shadow slot with a custom aim direction points its spot sideways and redraws as it moves', () => {
  const parent = new THREE.Group();
  const pool = new ShadowPool(parent, 1, 512, 0);
  const slot = {
    item: { name: 'rib', light: null as THREE.Light | null, base: 8, pattern: 'steady' as const, seed: 1, emissives: [], emissiveBase: 0, shafts: [], shaftBase: 0, level: 1, power: 1 },
    position: new THREE.Vector3(-2, 2, 0),
    color: new THREE.Color(0x7ee4f5),
    range: 7.5,
    priority: 1,
    kind: 'wall' as const,
    shadow: true,
    aim: new THREE.Vector3(1, 0, 0),
    score: 0,
  };
  pool.assign([slot], new THREE.Vector3(0, 1.6, 0), { dt: 1 / 60 });
  const spot = slot.item.light as THREE.SpotLight;
  assert.ok(spot instanceof THREE.SpotLight);
  assert.ok(spot.target.position.x > spot.position.x, 'spot aims along +X rather than straight down');
  assert.equal(spot.target.position.y, spot.position.y);
  assert.equal(pool.redraws, 1);
  assert.ok(pool.covers(new THREE.Vector3(0, 2, 0)), 'covers points along the sideways cone');
  assert.equal(pool.covers(new THREE.Vector3(-4, 2, 0)), false, 'does not cover points behind the sideways cone');
  // Sliding the slot along Z forces a shadow redraw on the next frame.
  slot.position.z += 0.5;
  pool.assign([slot], new THREE.Vector3(0, 1.6, 0), { dt: 1 / 60 });
  assert.equal(pool.redraws, 1, 'moving tunnel rib light redraws its shadow map');
});
