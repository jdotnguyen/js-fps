import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  applySteadyLights,
  BLEND_SECONDS,
  blendWeight,
  CAPTURE_LAYER,
  CaptureSchedule,
  Handover,
  RoomCaptures,
  steadyPatternValue,
  type CaptureHost,
  type CaptureRenderer,
  type PmremFilter,
} from './roomCaptures.ts';
import type { ControlledLight } from './lights.ts';

// openspec change room-light-response: environment-lighting spec, design D1-D4.

interface Call {
  op: 'target' | 'render';
  target?: THREE.WebGLRenderTarget | null;
  face?: number;
  mip?: number;
  scene?: THREE.Object3D;
  camera?: THREE.Camera;
}

function stubRenderer(): CaptureRenderer & { calls: Call[]; reads: number } {
  let target: THREE.WebGLRenderTarget | null = null;
  let face = 0;
  let mip = 0;
  const r = {
    calls: [] as Call[],
    reads: 0,
    coordinateSystem: THREE.WebGLCoordinateSystem,
    shadowMap: { needsUpdate: true },
    getRenderTarget: () => target,
    getActiveCubeFace: () => face,
    getActiveMipmapLevel: () => mip,
    setRenderTarget(t: THREE.WebGLRenderTarget | null, f = 0, m = 0) {
      target = t;
      face = f;
      mip = m;
      r.calls.push({ op: 'target', target: t, face: f, mip: m });
    },
    render(scene: THREE.Object3D, camera: THREE.Camera) {
      r.calls.push({ op: 'render', scene, camera, target, face, mip });
    },
    async readRenderTargetPixelsAsync(_t: THREE.WebGLRenderTarget, _x: number, _y: number, _w: number, _h: number, buffer: THREE.TypedArray) {
      r.reads++;
      return buffer;
    },
  };
  return r;
}

/** A PMREM stand-in: a 256 px cube target with six mip levels, like PMREMGenerator's. */
function stubFilter(): PmremFilter & { made: THREE.WebGLCubeRenderTarget[]; disposed: number } {
  const made: THREE.WebGLCubeRenderTarget[] = [];
  const f = ((_cube: THREE.CubeTexture, reuse: THREE.WebGLCubeRenderTarget | null) => {
    if (reuse) return reuse;
    const t = new THREE.WebGLCubeRenderTarget(256);
    for (let i = 0; i < 6; i++) (t.texture.mipmaps as unknown[]).push({ width: 256 >> i, height: 256 >> i });
    t.addEventListener('dispose', () => f.disposed++);
    made.push(t);
    return t;
  }) as PmremFilter & { made: THREE.WebGLCubeRenderTarget[]; disposed: number };
  f.made = made;
  f.disposed = 0;
  return f;
}

interface StubHost extends CaptureHost {
  current: string | null;
  near: Record<string, string[]>;
  versions: Record<string, number>;
  faces: Array<{ eye: THREE.Vector3; camera: THREE.Camera }>;
  prepared: number;
}

function stubHost(): StubHost {
  const h: StubHost = {
    current: 'A',
    near: { A: ['B'], B: ['A', 'C'], C: ['B'] },
    versions: {},
    faces: [],
    prepared: 0,
    currentRoom: () => h.current,
    neighbours: (r) => h.near[r] ?? [],
    lightingVersion: (r) => h.versions[r] ?? 0,
    capturePoint: (r, out) => out.set(r.charCodeAt(0), 1.6, 0),
    prepareCapture: () => void h.prepared++,
    captureFromEye: (eye, draw, camera) => {
      h.faces.push({ eye: eye.clone(), camera });
      draw();
    },
  };
  return h;
}

function setup(opts: { generic?: THREE.Texture | null } = {}) {
  const renderer = stubRenderer();
  const host = stubHost();
  const filter = stubFilter();
  const scene = new THREE.Scene();
  const irradiance: string[] = [];
  const caps = new RoomCaptures({ renderer, scene, host, filter, generic: opts.generic ?? null, onIrradiance: (room) => irradiance.push(room) });
  return { renderer, host, filter, scene, caps, irradiance };
}

test('a capture renders one cube face per frame, then filters on the seventh (design D1)', () => {
  const { renderer, host, filter, scene, caps } = setup();
  for (let frame = 1; frame <= 6; frame++) {
    renderer.calls.length = 0;
    caps.step(1 / 60);
    const draws = renderer.calls.filter((c) => c.op === 'render' && c.scene === scene);
    assert.equal(draws.length, 1, `frame ${frame} draws one face`);
    assert.equal(draws[0]!.face, frame - 1, `frame ${frame} draws face ${frame - 1}`);
    assert.equal(filter.made.length, 0, 'no filter before all six faces');
  }
  assert.equal(host.faces.length, 6);
  assert.ok(host.faces.every((f) => f.eye.equals(new THREE.Vector3(65, 1.6, 0))), 'every face from the room capture point');
  caps.step(1 / 60);
  assert.equal(filter.made.length, 1, 'filtered on frame 7');
  assert.equal(host.faces.length, 6, 'no scene render on the filter frame');
  assert.equal(host.prepared, 1, 'layers prepared once per capture');
  assert.ok(caps.schedule.get('A'));
  caps.dispose();
});

test('capture cameras see only the capture layer, which the level puts its own objects on (design D1)', () => {
  const { host, caps } = setup();
  caps.step(1 / 60);
  const cam = host.faces[0]!.camera;
  const levelMesh = new THREE.Mesh();
  levelMesh.layers.enable(CAPTURE_LAYER); // what Level.prepareCapture does
  const character = new THREE.Mesh(); // characters, viewmodel, gore and particles keep only layer 0
  assert.ok(levelMesh.layers.test(cam.layers), 'level geometry draws in captures');
  assert.ok(!character.layers.test(cam.layers), 'characters do not');
  assert.ok(levelMesh.layers.test(new THREE.PerspectiveCamera().layers), 'the player still sees level geometry');
  caps.dispose();
});

test('captures never ask for a shadow-map update and restore the frame render target', () => {
  const { renderer, caps } = setup();
  const seen: boolean[] = [];
  const render = renderer.render;
  renderer.render = (s, c) => {
    seen.push(renderer.shadowMap.needsUpdate);
    render(s, c);
  };
  caps.step(1 / 60);
  assert.deepEqual(seen, [false]);
  assert.equal(renderer.shadowMap.needsUpdate, true);
  assert.equal(renderer.getRenderTarget(), null);
  caps.dispose();
});

test('steady patterns: flicker and failing capture as steady, off as dark, alarm and dying dimmer (design D2)', () => {
  assert.equal(steadyPatternValue('flicker'), steadyPatternValue('steady'));
  assert.equal(steadyPatternValue('failing'), steadyPatternValue('steady'));
  assert.equal(steadyPatternValue('off'), 0);
  assert.ok(steadyPatternValue('alarm') < 1 && steadyPatternValue('alarm') > 0);
  const light = new THREE.PointLight();
  const glow = new THREE.MeshStandardMaterial();
  const item: ControlledLight = { name: 'A 0', light, base: 10, pattern: 'flicker', seed: 3, emissives: [glow], emissiveBase: 2, shafts: [], shaftBase: 0, level: 0.08, power: 0.5 };
  applySteadyLights([item]);
  assert.equal(light.intensity, 5);
  assert.equal(glow.emissiveIntensity, 1);
  assert.equal(item.level, 0.08, 'the audible level is left alone');
});

test('schedule: the current room first, then portal neighbours; stale rooms far away wait (design D2)', () => {
  const s = new CaptureSchedule<string>();
  const v: Record<string, number> = {};
  const ver = (r: string): number => v[r] ?? 0;
  assert.equal(s.next('A', ['B'], ver), 'A');
  s.set('A', 'a', 0, 1);
  assert.equal(s.next('A', ['B'], ver), 'B');
  s.set('B', 'b', 0, 1);
  s.set('Z', 'z', 0, 1);
  assert.equal(s.next('A', ['B'], ver), null, 'nothing to do');
  v['Z'] = 1; // a stale room far away
  assert.equal(s.next('A', ['B'], ver), null, 'not queued until approached');
  v['B'] = 1;
  assert.equal(s.next('A', ['B'], ver), 'B', 'a stale neighbour is retaken');
  v['A'] = 1;
  assert.equal(s.next('A', ['B'], ver), 'A', 'the current room before neighbours');
  assert.equal(s.next(null, [], ver), null);
});

test('a lighting version bump retakes the capture within the next seven frames', () => {
  const { host, filter, caps } = setup();
  for (let i = 0; i < 14; i++) caps.step(1 / 60); // A, then neighbour B
  assert.deepEqual([...caps.schedule.entries.keys()].sort(), ['A', 'B']);
  const faces = host.faces.length;
  for (let i = 0; i < 7; i++) caps.step(1 / 60);
  assert.equal(host.faces.length, faces, 'idle when everything is current');
  host.versions['A'] = 1; // an alarm tint in A
  for (let i = 0; i < 7; i++) caps.step(1 / 60);
  assert.equal(host.faces.length, faces + 6);
  assert.equal(filter.made.length, 2, 'the recapture reuses the room’s own map');
  assert.equal(caps.schedule.needs('A', 1), false);
  caps.dispose();
});

test('the cache keeps at most eight captures, dropping the least recently used, never the current room or its neighbours (design D4)', () => {
  const s = new CaptureSchedule<string>(8);
  for (let i = 0; i < 9; i++) s.set(`R${i}`, `m${i}`, 0, i);
  s.touch(['R0'], 100); // R0 was the camera's room most recently
  const dropped = s.evict(new Set(['R1', 'R2']));
  assert.deepEqual(dropped, [['R3', 'm3']], 'R3 is the oldest not kept');
  assert.equal(s.entries.size, 8);
  // Everything kept: the cache may run over rather than drop a room in use.
  const t = new CaptureSchedule<string>(2);
  for (const r of ['A', 'B', 'C']) t.set(r, r, 0, 0);
  assert.deepEqual(t.evict(new Set(['A', 'B', 'C'])), []);
});

test('evicted and torn-down captures release their render targets (runtime-memory spec)', () => {
  const { host, filter, caps } = setup();
  // Walk through a chain of ten rooms, each joined only to the next.
  const rooms = Array.from({ length: 10 }, (_, i) => `R${i}`);
  host.near = {};
  for (const r of rooms) host.near[r] = [];
  for (const r of rooms) {
    host.current = r;
    for (let i = 0; i < 7; i++) caps.step(1 / 60);
  }
  assert.equal(filter.made.length, 10);
  assert.equal(caps.schedule.entries.size, 8);
  assert.equal(filter.disposed, 2, 'two dropped as the walk went on');
  caps.dispose();
  assert.equal(filter.disposed, 10, 'teardown frees the rest');
});

test('blend weight runs 0 to 1 over the hand-over, smoothly (design D3)', () => {
  assert.equal(blendWeight(0), 0);
  assert.equal(blendWeight(BLEND_SECONDS), 1);
  assert.equal(blendWeight(BLEND_SECONDS / 2), 0.5);
  assert.ok(BLEND_SECONDS >= 0.3 && BLEND_SECONDS <= 0.8, 'spec: 0.3 to 0.8 s');
  let prev = 0;
  for (let t = 0; t <= BLEND_SECONDS; t += 1 / 60) {
    const w = blendWeight(t);
    assert.ok(w >= prev && w - prev < 0.06, 'no frame jumps more than 6%');
    prev = w;
  }
});

test('hand-over: an uncaptured room keeps the old map until its capture lands, then fades in (design D3)', () => {
  const h = new Handover();
  const have = new Set<string>(['A']);
  const has = (r: string): boolean => have.has(r);
  let s = h.update(1 / 60, 'A', has);
  assert.deepEqual(s, { kind: 'blend', from: null, to: 'A', weight: 0 }, 'cold start fades from the generic map');
  for (let i = 0; i < 40; i++) s = h.update(1 / 60, 'A', has);
  assert.deepEqual(s, { kind: 'static', room: 'A' });
  for (let i = 0; i < 5; i++) s = h.update(1 / 60, 'B', has);
  assert.deepEqual(s, { kind: 'static', room: 'A' }, 'B has no capture yet: A holds');
  have.add('B');
  s = h.update(1 / 60, 'B', has);
  assert.equal(s.kind, 'blend');
  const weights: number[] = [];
  while (s.kind === 'blend') {
    weights.push(s.weight);
    s = h.update(1 / 60, 'B', has);
  }
  assert.deepEqual(s, { kind: 'static', room: 'B' });
  assert.ok(weights.length >= 0.3 * 60 && weights.length <= 0.8 * 60 + 1, `fade lasts ${weights.length} frames`);
});

test('hand-over: a room change mid-fade waits for the fade to end, never jumping', () => {
  const h = new Handover();
  const has = (): boolean => true;
  h.update(1 / 60, 'A', has);
  for (let i = 0; i < 40; i++) h.update(1 / 60, 'A', has);
  h.update(1 / 60, 'B', has);
  for (let i = 0; i < 10; i++) h.update(1 / 60, 'B', has);
  let s = h.update(1 / 60, 'C', has);
  assert.equal(s.kind === 'blend' && s.to, 'B', 'B finishes first');
  for (let i = 0; i < 40 && !(s.kind === 'blend' && s.to === 'C'); i++) s = h.update(1 / 60, 'C', has);
  assert.ok(s.kind === 'blend' && s.from === 'B' && s.to === 'C');
});

test('cold start: the generic environment shows until the first capture, then the room’s own (design D7)', () => {
  const generic = new THREE.Texture();
  const { caps } = setup({ generic });
  for (let i = 0; i < 6; i++) {
    caps.step(1 / 60);
    assert.equal(caps.texture, generic, `frame ${i + 1}: generic`);
  }
  caps.step(1 / 60); // filtered: the fade from the generic map starts
  for (let i = 0; i < 40; i++) caps.step(1 / 60);
  assert.equal(caps.texture, caps.schedule.get('A')!.texture);
  caps.dispose();
  assert.equal(caps.texture, generic);
});

test('a fade renders the blended map into every face of every mip level', () => {
  const generic = new THREE.WebGLCubeRenderTarget(256);
  for (let i = 0; i < 6; i++) (generic.texture.mipmaps as unknown[]).push({ width: 256 >> i, height: 256 >> i });
  const { renderer, caps } = setup({ generic: generic.texture });
  for (let i = 0; i < 7; i++) caps.step(1 / 60);
  renderer.calls.length = 0;
  caps.step(1 / 60); // mid-fade
  const blendDraws = renderer.calls.filter((c) => c.op === 'render' && c.scene instanceof THREE.Mesh);
  assert.equal(blendDraws.length, 36, '6 faces x 6 mips');
  const blended = caps.texture!;
  assert.notEqual(blended, generic.texture);
  assert.equal((blended as THREE.Texture & { isPMREMTexture?: boolean }).isPMREMTexture, true, 'sampled as a PMREM');
  assert.equal(blended.mipmaps.length, 6);
  caps.dispose();
});

test('each capture reads its bounce light back asynchronously', async () => {
  const { renderer, caps, irradiance } = setup();
  for (let i = 0; i < 7; i++) caps.step(1 / 60);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(renderer.reads, 6, 'six 16 px faces');
  assert.deepEqual(irradiance, ['A']);
  caps.dispose();
});

test('lights outside the level are counted in a capture at zero intensity, then restored (no second program variant)', () => {
  const { renderer, scene, caps } = setup();
  const flashlight = new THREE.SpotLight(0xffffff, 40);
  const levelLight = new THREE.PointLight(0xffffff, 5);
  levelLight.layers.enable(CAPTURE_LAYER);
  scene.add(flashlight, levelLight);
  let seen: { mask: boolean; intensity: number; level: number } | null = null;
  const render = renderer.render;
  renderer.render = (s, c) => {
    if (s === scene) seen = { mask: flashlight.layers.test(c.layers), intensity: flashlight.intensity, level: levelLight.intensity };
    render(s, c);
  };
  caps.step(1 / 60);
  assert.deepEqual(seen, { mask: true, intensity: 0, level: 5 }, 'counted, dark; the level’s own light untouched');
  assert.equal(flashlight.intensity, 40);
  assert.ok(!flashlight.layers.isEnabled(CAPTURE_LAYER), 'layer mask restored');
  caps.dispose();
});

test('warm takes the current room and starts its fade at once, drawing every capture shader (session-loading)', async () => {
  const generic = new THREE.WebGLCubeRenderTarget(256);
  for (let i = 0; i < 6; i++) (generic.texture.mipmaps as unknown[]).push({ width: 256 >> i, height: 256 >> i });
  const { renderer, filter, caps } = setup({ generic: generic.texture });
  caps.warm();
  assert.ok(caps.schedule.get('A'), 'captured');
  assert.equal(filter.made.length, 1, 'filtered');
  const boxDraws = renderer.calls.filter((c) => c.op === 'render' && c.scene instanceof THREE.Mesh);
  assert.equal(boxDraws.length, 6 + 36, 'the downsample for the bounce light, then the first blend');
  assert.equal(caps.handover.current, null, 'the fade runs on in play');
  await new Promise((r) => setTimeout(r, 0));
  caps.dispose();
});
