import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EventBus } from '../core/events.ts';
import type { LevelData } from '../data/types/level.ts';
import type { Materials } from '../render/materials.ts';
import { ShadowCasterSet } from '../render/shadowCasters.ts';
import { validateSequences } from '../script/schema.ts';
import { advanceJolt, joltSwing, newJolt, swingAngle } from './kit/types.ts';
import { Level } from './level.ts';
import { KitRegistry } from './registry.ts';

// render-lighting "Swaying lights" (shadow-rich-rooms D6): pendant lamps swing on the kit's slot swing, and knocks
// set them swinging harder.

const mats = new Proxy({} as Record<string, THREE.Material>, {
  get: (t, k: string) => (t[k] ??= Object.assign(new THREE.MeshStandardMaterial(), { name: k })),
}) as unknown as Materials;

const DT = 1 / 60;

function build(params: Record<string, string | number | boolean>, shadow = true): Level {
  const data: LevelData = {
    id: 'sway_test',
    seed: 1,
    playerStart: { room: 'A', pos: [0, 0, 0], yaw: 0 },
    rooms: [
      {
        id: 'A',
        name: 'A',
        pieces: [{ kit: 'floor', cell: [0, 0, 0] }],
        props: [{ kit: 'pendant_light', pos: [0, 0, 0], params: { slots: true, ...params } }],
        lights: [{ slot: 0, pattern: 'steady' as const, ...(shadow ? { shadow: true } : {}) }],
      },
    ],
    doors: [],
    checkpoints: [],
  };
  return new Level(data, { materials: mats, registry: new KitRegistry({ glb: {} }), events: new EventBus(), scene: new THREE.Scene(), shadowCasters: new ShadowCasterSet(), lightBudget: { fillLights: 4, shadowLights: 1, shadowMapSize: 512 } });
}

const shade = (level: Level): THREE.Object3D | undefined => level.group.getObjectByName('pendant-sway');
const eye = new THREE.Vector3(0, 1.62, 2);
const run = (level: Level, from: number, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds / DT); i++) level.update(from + i * DT, DT, eye, false);
};

test('a jolt is a damped swing that settles, and advancing it twice at one time changes nothing', () => {
  const j = newJolt();
  advanceJolt(j, 0, 2);
  joltSwing(j, 1.5);
  let peak = 0;
  for (let t = DT; t < 1; t += DT) peak = Math.max(peak, Math.abs(advanceJolt(j, t, 2)));
  assert.ok(peak > 0.1, `a knock swings the lamp (${peak.toFixed(3)} rad)`);
  const a = advanceJolt(j, 1.5, 2);
  assert.equal(advanceJolt(j, 1.5, 2), a, 'idempotent per time (the piece and the level both advance it)');
  for (let t = 1.5 + DT; t < 6; t += DT) advanceJolt(j, t, 2);
  let late = 0;
  for (let t = 6; t < 7; t += DT) late = Math.max(late, Math.abs(advanceJolt(j, t, 2)));
  assert.ok(late < peak * 0.1, `settles back (${late.toFixed(4)} rad after 6 s)`);
  const s = { amp: 0.05, period: 2, jolt: newJolt() };
  assert.equal(swingAngle(s, 0.3), swingAngle({ amp: 0.05, period: 2 }, 0.3), 'an un-knocked jolt adds nothing');
});

test('without sway the lamp stays merged and still; with sway the shade hangs from an unmerged pivot at the cable mount', () => {
  const still = build({});
  assert.equal(shade(still), undefined);
  const p0 = still.roomLights('A')[0]!.position.clone();
  run(still, 0, 1);
  assert.ok(still.roomLights('A')[0]!.position.distanceTo(p0) < 1e-9, 'a still lamp does not move');

  const swaying = build({ sway: true, ceiling: 3.2, drop: 1.2 });
  const pivot = shade(swaying);
  assert.ok(pivot, 'the swaying shade is its own pivot group');
  const world = pivot.getWorldPosition(new THREE.Vector3());
  assert.ok(Math.abs(world.y - 3.16) < 1e-6, `pivot at the cable mount (${world.y.toFixed(3)})`);
});

test('a swaying lamp moves its shade, its glow and its light together, and its shadow spot redraws while it swings', () => {
  const level = build({ sway: 0.12 });
  const pivot = shade(level)!;
  const light = level.roomLights('A')[0]!;
  run(level, 0, 0.1);
  const pos0 = light.position.clone();
  const rot0 = pivot.rotation.x;
  run(level, 0.1, 0.5);
  assert.ok(light.position.distanceTo(pos0) > 0.02, 'the light follows the swing');
  assert.notEqual(pivot.rotation.x, rot0, 'the shade swings');
  // The glow rides the level's own pivot with the same angle as the shade.
  let glowPivot: THREE.Object3D | undefined;
  level.group.traverse((o) => void (o !== pivot && o.type === 'Group' && o.rotation.order === 'YXZ' && o.children.length && (glowPivot ??= o)));
  assert.ok(glowPivot);
  assert.ok(Math.abs(glowPivot.rotation.x - pivot.rotation.x) < 1e-9, 'glow and shade at one angle');
  const spot = light.light.light as THREE.SpotLight;
  assert.ok(spot instanceof THREE.SpotLight, 'the opted-in lamp holds the shadow spot');
  level.update(0.7, DT, eye, false);
  assert.equal(level.shadowPool.redraws, 1, 'the swinging lamp redraws its shadow');
});

test('a shotgun blast within 3 m and a shot passing the shade knock it; farther blasts do not', () => {
  const level = build({ sway: 0.04 });
  const light = level.roomLights('A')[0]!;
  const amplitude = (from: number): number => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 90; i++) {
      level.update(from + i * DT, DT, eye, false);
      lo = Math.min(lo, light.position.z);
      hi = Math.max(hi, light.position.z);
    }
    return hi - lo;
  };
  run(level, 0, 0.5);
  const calm = amplitude(0.5);
  const rest = light.position.clone().setY(2.0);
  assert.equal(level.joltLightsNear(rest.clone().add(new THREE.Vector3(0, 0, 5)), 3, 1.4), 0, 'a blast 5 m away');
  assert.equal(level.joltLightsNear(rest.clone().add(new THREE.Vector3(0, 0, 2)), 3, 1.4), 1);
  const knocked = amplitude(2);
  assert.ok(knocked > calm * 1.5, `swings harder after a blast (${calm.toFixed(3)} -> ${knocked.toFixed(3)} m)`);
  run(level, 3.5, 8);
  const settled = amplitude(11.5);
  assert.ok(settled < knocked * 0.75, `eases back (${settled.toFixed(3)} m)`);

  const bulb = level.roomLights('A')[0]!.position.clone();
  const from = new THREE.Vector3(bulb.x - 6, bulb.y + 0.1, bulb.z);
  assert.equal(level.joltLightsAlong(from, new THREE.Vector3(1, 0, 0), 20, 1.2), 1, 'a shot passing the shade');
  assert.equal(level.joltLightsAlong(from.clone().setY(bulb.y + 1), new THREE.Vector3(1, 0, 0), 20, 1.2), 0, 'a shot a metre above');
  assert.equal(level.joltLightsAlong(from, new THREE.Vector3(1, 0, 0), 3, 1.2), 0, 'a shot that hit a wall first');
});

test('the lightJolt sequence action validates and knocks the room', () => {
  assert.equal(validateSequences({ 'x.json': { id: 'quake', steps: [{ do: 'lightJolt', room: 'A', strength: 2 }] } }).length, 1);
  assert.ok(validateSequences({ 'x.json': { id: 'quake', steps: [{ do: 'lightJolt', room: 'A' }] } }), 'strength is optional');
  assert.throws(() => validateSequences({ 'x.json': { id: 'bad', steps: [{ do: 'lightJolt', room: 'A', strength: 9 }] } }));
  const level = build({ sway: true });
  assert.equal(level.joltRoomLights('A', 1.2), true);
  assert.equal(level.joltRoomLights('B', 1.2), false);
});
