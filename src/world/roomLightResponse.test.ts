import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EventBus } from '../core/events.ts';
import type { LevelData, RoomData } from '../data/types/level.ts';
import { createMaterials } from '../render/materials.ts';
import { CAPTURE_LAYER } from '../render/roomCaptures.ts';
import { hemisphereAverage, probeAverage, projectCubeSh } from '../render/roomLightProbe.ts';

// openspec change room-light-response: environment-lighting spec "Captures follow the room's lighting",
// "Room-coloured bounce light"; design D1, D2, D5.

// Headless canvas for door status screens.
const noop = (): void => undefined;
const ctx = new Proxy({} as Record<string | symbol, unknown>, {
  get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 10 }) : noop),
  set: (t, k, v) => ((t[k] = v), true),
});
(globalThis as { Path2D?: unknown }).Path2D ??= function Path2D(): unknown {
  return new Proxy({}, { get: () => noop });
};
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ width: 1, height: 1, getContext: () => ctx, style: {} }) };

const { KitRegistry } = await import('./registry.ts');
const { AMBIENT, Level } = await import('./level.ts');

const lights: NonNullable<RoomData['lights']> = [
  { slot: 0, pattern: 'steady' },
  { slot: 1, pattern: 'steady' },
];

/** Three rooms in a row along z: A [0,0,0], B [0,0,1] (gallery preset), C [0,0,2]. A-B door open, B-C door sealed. */
function threeRooms(): LevelData {
  const room = (id: string, z: number, extra: Partial<RoomData> = {}): RoomData => ({
    id,
    name: id,
    pieces: [{ kit: 'corridor_straight', cell: [0, 0, z], rot: 0 }],
    lights,
    ...extra,
  });
  return {
    id: 'light_response_test',
    name: 'Light response',
    seed: 'test',
    playerStart: { room: 'A', pos: [0, 0, 0], yaw: 0 },
    checkpoints: [],
    rooms: [room('A', 0), room('B', 1, { lights: [{ slot: 0, pattern: 'steady', id: 'b_lamp' }], atmosphere: { ambient: 'gallery', capture: [0.5, 1.2, 4.5] } }), room('C', 2)],
    doors: [
      { id: 'AB', kit: 'pressure_slide', between: ['A', 'B'], cell: [0, 0, 1], rot: 0, state: 'open' },
      { id: 'BC', kit: 'pressure_slide', between: ['B', 'C'], cell: [0, 0, 2], rot: 0, state: 'sealed' },
    ],
  };
}

function build() {
  const level = new Level(threeRooms(), { materials: createMaterials(8, 4), registry: new KitRegistry({ glb: {} }), events: new EventBus(), scene: new THREE.Scene(), inventory: null });
  const versions = (): Record<string, number> => Object.fromEntries(['A', 'B', 'C'].map((r) => [r, level.lightingVersion(r)]));
  return { level, versions };
}

const eyeIn = (z: number): THREE.Vector3 => new THREE.Vector3(0, 1.7, z * 4);
const run = (level: InstanceType<typeof Level>, eye: THREE.Vector3, seconds: number, t0 = 0): void => {
  for (let i = 0; i < Math.round(seconds * 60); i++) level.update(t0 + i / 60, 1 / 60, eye, false);
};

test('an alarm bumps only the affected room (design D2, spec "Alarm")', () => {
  const { level, versions } = build();
  const before = versions();
  level.setRoomLights('B', 'alarm');
  level.tintRoomLights('B', 'emergency');
  const after = versions();
  assert.ok(after['B']! > before['B']!);
  assert.equal(after['A'], before['A']);
  assert.equal(after['C'], before['C']);
});

test('a flicker never bumps, however long it plays (spec "Flickering light")', () => {
  const { level, versions } = build();
  const before = versions();
  level.setRoomLights('A', 'flicker');
  level.setRoomLights('A', 'failing');
  level.setRoomLights('A', 'steady');
  run(level, eyeIn(0), 3);
  assert.deepEqual(versions(), before);
});

test('a light switching off or on bumps its room; power bumps every room', () => {
  const { level, versions } = build();
  let v = versions();
  assert.ok(level.setLight('b_lamp', 'off'), `named light exists (B has ${level.roomLights('B').length} lights)`);
  assert.equal(versions()['B'], v['B']! + 1);
  assert.equal(versions()['A'], v['A']);
  v = versions();
  level.setLight('b_lamp', 'off');
  assert.deepEqual(versions(), v, 'no change, no bump');
  level.setLight('b_lamp', 'steady');
  assert.equal(versions()['B'], v['B']! + 1);
  v = versions();
  level.setPower('backup');
  for (const r of ['A', 'B', 'C']) assert.equal(versions()[r], v[r]! + 1, `${r} after the blackout`);
});

test('neighbours are rooms through passable portals only', () => {
  const { level } = build();
  run(level, eyeIn(0), 0.1);
  assert.deepEqual([...level.neighbours('A')], ['B']);
  assert.deepEqual([...level.neighbours('B')], ['A'], 'the sealed door to C is not a way through');
});

test('capture point: the authored point, else the room centre 1.6 m above the deck (design D1)', () => {
  const { level } = build();
  assert.deepEqual(level.capturePoint('B', new THREE.Vector3()).toArray(), [0.5, 1.2, 4.5]);
  assert.deepEqual(level.capturePoint('A', new THREE.Vector3()).toArray(), [0, 1.6, 0]);
});

test('captures see the level’s geometry and lights but not its dust (design D1)', () => {
  const { level } = build();
  level.prepareCapture();
  const cam = new THREE.PerspectiveCamera();
  cam.layers.set(CAPTURE_LAYER);
  let meshes = 0;
  level.group.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.Light) {
      assert.ok(o.layers.test(cam.layers), `${o.name || o.type} on the capture layer`);
      meshes++;
    }
  });
  assert.ok(meshes > 0);
  const dust = level.group.children.find((o) => o instanceof THREE.Points)!;
  assert.ok(!dust.layers.test(cam.layers), 'dust stays out');
});

test('a capture face renders with steady lights and the probe off, and lights resume next update', () => {
  const { level } = build();
  level.setRoomLights('A', 'flicker');
  run(level, eyeIn(0), 0.2);
  level.probe.intensity = 1;
  let seen: { probe: number; levels: number[] } | null = null;
  level.captureFromEye(eyeIn(0), () => {
    seen = { probe: level.probe.intensity, levels: level.roomLights('A').map((l) => l.light.light?.intensity ?? -1) };
  }, new THREE.PerspectiveCamera(90, 1, 0.05, 80));
  assert.equal(seen!.probe, 0);
  const bases = level.roomLights('A').map((l) => l.light.base);
  seen!.levels.forEach((v, i) => {
    if (v >= 0) assert.equal(v, bases[i], 'flicker captured at its steady value');
  });
  assert.equal(level.probe.intensity, 1);
});

test('the probe is added once at build, so materials never gain a light at runtime', () => {
  const { level } = build();
  const probes = (): number => {
    let n = 0;
    level.group.traverse((o) => void (o instanceof THREE.LightProbe && n++));
    return n;
  };
  assert.equal(probes(), 1);
  level.setRoomIrradiance('A', new THREE.SphericalHarmonics3());
  run(level, eyeIn(0), 0.5);
  assert.equal(probes(), 1);
});

/** Combined ambient average of the level's hemisphere and probe (what a diffuse surface receives on average). */
function combinedAverage(level: InstanceType<typeof Level>): number {
  const hemi = level.group.children.find((o) => o instanceof THREE.HemisphereLight) as THREE.HemisphereLight;
  return hemisphereAverage({ sky: hemi.color, ground: hemi.groundColor, intensity: hemi.intensity }) + probeAverage(level.probe.sh) * level.probe.intensity;
}

const warmCube = (scale: number): THREE.SphericalHarmonics3 => {
  const face = (c: number[]): Float32Array => {
    const f = new Float32Array(16 * 16 * 4);
    for (let i = 0; i < 256; i++) f.set([c[0]! * scale, c[1]! * scale, c[2]! * scale, 1], i * 4);
    return f;
  };
  return projectCubeSh([face([1, 0.6, 0.25]), face([0.2, 0.4, 1]), face([0.1, 0.1, 0.1]), face([0.1, 0.1, 0.1]), face([0.1, 0.1, 0.1]), face([0.1, 0.1, 0.1])], 16, -1);
};

test('combined ambient stays within ±10% of the preset with the probe on (spec "Preset brightness kept", design D5)', () => {
  const { level } = build();
  const gallery = { sky: new THREE.Color(AMBIENT.gallery.sky), ground: new THREE.Color(AMBIENT.gallery.ground), intensity: AMBIENT.gallery.intensity };
  const want = hemisphereAverage(gallery);
  run(level, eyeIn(1), 4);
  const noProbe = combinedAverage(level);
  assert.ok(Math.abs(noProbe - want) / want < 0.02, 'without a capture the hemisphere carries it all');
  for (const scale of [0.05, 3, 50]) {
    level.setRoomIrradiance('B', warmCube(scale));
    run(level, eyeIn(1), 4, 10);
    const got = combinedAverage(level);
    assert.ok(Math.abs(got - want) / want <= 0.1, `capture ×${scale}: ${got.toFixed(4)} vs ${want.toFixed(4)}`);
    assert.ok(probeAverage(level.probe.sh) > 0.4 * want, 'the probe carries a real share');
  }
});

test('under backup power the probe follows the backup preset’s strength', async () => {
  const { BACKUP_AMBIENT } = await import('./level.ts');
  const { level } = build();
  level.setRoomIrradiance('B', warmCube(5));
  level.setPower('backup');
  run(level, eyeIn(1), 4);
  const backup = { sky: new THREE.Color(BACKUP_AMBIENT.sky), ground: new THREE.Color(BACKUP_AMBIENT.ground), intensity: BACKUP_AMBIENT.intensity };
  const want = hemisphereAverage(backup);
  assert.ok(Math.abs(combinedAverage(level) - want) / want <= 0.1);
});

test('only the station level takes room captures; other worlds keep the generic environment (design D7)', async () => {
  const { isCaptureWorld } = await import('../render/roomCaptures.ts');
  const { Rng } = await import('../core/rng.ts');
  const { buildDemoRoom } = await import('./demoRoom.ts');
  const { demoRoomWorld } = await import('./demoWorld.ts');
  const { level } = build();
  assert.ok(isCaptureWorld(level));
  const demo = demoRoomWorld(buildDemoRoom(createMaterials(8, 4), new Rng('demo-room')));
  assert.ok(!isCaptureWorld(demo), 'the demo room');
  // The lab world (labWorld.ts) is a plain World: group, colliders, lights and update, no rooms.
  assert.ok(!isCaptureWorld({ group: new THREE.Group(), update: () => undefined }), 'the lab world');
  assert.ok(!isCaptureWorld(null));
});
