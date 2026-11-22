import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraFeeds, FEED_FPS, type Feed, type FeedDraw } from './cameraFeed.ts';
import type { CameraFeedOptions } from '../script/host.ts';

// ADR-0023 camera feeds, headless: the state machine, the throttle, which meshes get the screen,
// and what is drawn when. The GL passes themselves (cameraFeedGl.ts) need a context and are not run here.

function setup(withMonitor = true) {
  const root = new THREE.Group();
  const room = new THREE.Group();
  root.add(room);
  const original = new THREE.MeshBasicMaterial();
  const monitor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), original);
  monitor.name = 'feed:cam_a';
  if (withMonitor) room.add(monitor);
  const calls = { scene: [] as THREE.PerspectiveCamera[], look: [] as Feed[] };
  const draw: FeedDraw = { scene: (_f, cam) => void calls.scene.push(cam), look: (f) => void calls.look.push(f) };
  const warnings: string[] = [];
  const feeds = new CameraFeeds({ root, draw, warn: (m) => void warnings.push(m) });
  return { feeds, room, monitor, original, calls, warnings };
}

const opts = (o: Partial<CameraFeedOptions> = {}): CameraFeedOptions => ({ state: 'live', from: { x: 5, y: 3, z: 1 }, lookAt: { x: 5, y: 1, z: -4 }, fullscreen: false, ...o });
const run = (feeds: CameraFeeds, seconds: number): void => {
  for (let t = 0; t < seconds; t += 1 / 60) feeds.update(1 / 60, t);
};

test('apply creates the feed, aims its camera and puts the screen on the feed:<id> mesh', () => {
  const { feeds, monitor, original } = setup();
  feeds.apply('cam_a', opts({ label: 'CAM 04  MEDICAL BAY', fov: 70 }));
  const f = feeds.get('cam_a')!;
  assert.equal(f.state, 'live');
  assert.equal(f.label, 'CAM 04  MEDICAL BAY');
  assert.deepEqual(f.camera.position.toArray(), [5, 3, 1]);
  assert.equal(f.camera.fov, 70);
  // Looking down -z and down a little.
  const dir = f.camera.getWorldDirection(new THREE.Vector3());
  assert.ok(dir.z < -0.9 && dir.y < 0);
  assert.equal(monitor.material, f.screen);
  assert.notEqual(monitor.material, original);
  assert.equal(f.meshes.length, 1);
});

test('a live feed renders about FEED_FPS times a second, not every frame', () => {
  const { feeds, calls } = setup();
  feeds.apply('cam_a', opts());
  run(feeds, 2);
  assert.ok(calls.scene.length >= FEED_FPS * 2 - 2 && calls.scene.length <= FEED_FPS * 2 + 2, `${calls.scene.length} scene renders in 2 s`);
  assert.equal(calls.look.length, calls.scene.length, 'each frame also gets the CCTV pass');
  assert.equal(feeds.sceneRenders, calls.scene.length);
});

test('static draws only the noise pass; off draws one dark frame and then nothing', () => {
  const { feeds, calls } = setup();
  feeds.apply('cam_a', opts({ state: 'static' }));
  run(feeds, 1);
  assert.equal(calls.scene.length, 0, 'no scene render for static');
  assert.ok(calls.look.length >= FEED_FPS - 1);
  calls.look.length = 0;
  feeds.apply('cam_a', opts({ state: 'off' }));
  run(feeds, 1);
  assert.equal(calls.scene.length, 0);
  assert.equal(calls.look.length, 1, 'one pass to blank the glass');
  assert.equal(feeds.get('cam_a')!.hasFrame, false);
});

test('nothing renders while no one can see the feed (room hidden, no fullscreen)', () => {
  const { feeds, room, calls } = setup();
  feeds.apply('cam_a', opts());
  room.visible = false;
  run(feeds, 1);
  assert.equal(calls.scene.length, 0);
  room.visible = true;
  run(feeds, 0.5);
  assert.ok(calls.scene.length > 0, 'draws again once the monitor is back in view');
});

test('fullscreen works without a monitor and reports the feed to the overlay; off clears it', () => {
  const { feeds, calls, warnings } = setup(false);
  feeds.apply('stinger', opts({ fullscreen: true }));
  assert.equal(feeds.fullscreen?.id, 'stinger');
  assert.deepEqual(warnings, [], 'a fullscreen-only feed needs no monitor');
  run(feeds, 0.5);
  assert.ok(calls.scene.length > 0);
  feeds.apply('stinger', opts({ state: 'off' }));
  assert.equal(feeds.fullscreen, null);
});

test('a monitor feed with no mesh warns once', () => {
  const { feeds, warnings } = setup(false);
  feeds.apply('cam_a', opts());
  feeds.apply('cam_a', opts({ state: 'static' }));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /feed:cam_a/);
});

test('reset switches every feed off and drops the overlay; dispose puts the monitor material back', () => {
  const { feeds, monitor, original } = setup();
  feeds.apply('cam_a', opts({ fullscreen: true }));
  feeds.reset();
  assert.equal(feeds.get('cam_a')!.state, 'off');
  assert.equal(feeds.fullscreen, null);
  feeds.dispose();
  assert.equal(monitor.material, original);
  assert.deepEqual(feeds.ids(), []);
});

test('the feed id can also be found by the mesh userData.feed marker', () => {
  const { feeds, room } = setup(false);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
  m.userData['feed'] = 'cam_b';
  room.add(m);
  feeds.apply('cam_b', opts());
  assert.equal(m.material, feeds.get('cam_b')!.screen);
});

test('a feed that sets no rate or size keeps the 10 fps, 320x180 default', () => {
  const { feeds } = setup();
  feeds.apply('cam_a', opts());
  const f = feeds.get('cam_a')!;
  assert.equal(f.fps, 10);
  assert.equal(f.look, 'monitor');
  assert.deepEqual([f.raw.width, f.raw.height, f.output.width, f.output.height], [320, 180, 320, 180]);
});

test('a feed can set its own rate, size and look; a later step resizes it in place', () => {
  const { feeds } = setup(false);
  feeds.apply('stinger', opts({ fullscreen: true, fps: 30, size: { w: 960, h: 540 }, look: 'fullscreen' }));
  const f = feeds.get('stinger')!;
  const raw = f.raw;
  assert.equal(f.fps, 30);
  assert.equal(f.look, 'fullscreen');
  assert.deepEqual([f.raw.width, f.raw.height, f.output.width, f.output.height], [960, 540, 960, 540]);
  feeds.apply('stinger', opts({ fullscreen: true, size: { w: 640, h: 480 } }));
  assert.equal(f.raw, raw, 'the same target, resized');
  assert.deepEqual([f.raw.width, f.raw.height], [640, 480]);
  assert.ok(Math.abs(f.camera.aspect - 640 / 480) < 1e-9);
  assert.equal(f.fps, 30, 'a step without fps keeps the last rate');
});

test('a 30 fps feed at a steady 60 Hz renders exactly every second frame', () => {
  const { feeds, calls } = setup(false);
  feeds.apply('stinger', opts({ fullscreen: true, fps: 30 }));
  const frames: number[] = [];
  for (let i = 0; i < 120; i++) {
    const before = calls.scene.length;
    feeds.update(1 / 60, i / 60);
    if (calls.scene.length > before) frames.push(i);
  }
  assert.equal(frames.length, 60, `${frames.length} renders in 2 s`);
  for (let i = 1; i < frames.length; i++) assert.equal(frames[i]! - frames[i - 1]!, 2, `gap before render ${i}`);
});

test('a 10 fps feed holds its rate instead of drifting below it', () => {
  const { feeds, calls } = setup();
  feeds.apply('cam_a', opts());
  for (let i = 0; i < 600; i++) feeds.update(1 / 60, i / 60);
  assert.equal(calls.scene.length, 100, '10 s at 10 fps');
});

test('a feed at or above the display rate renders every frame', () => {
  const { feeds, calls } = setup(false);
  feeds.apply('stinger', opts({ fullscreen: true, fps: 120 }));
  for (let i = 0; i < 60; i++) feeds.update(1 / 60, i / 60);
  assert.equal(calls.scene.length, 60);
});

test('after a hitch the feed renders once, not a burst of catch-up frames', () => {
  const { feeds, calls } = setup(false);
  feeds.apply('stinger', opts({ fullscreen: true, fps: 30 }));
  for (let i = 0; i < 10; i++) feeds.update(1 / 60, i / 60);
  const before = calls.scene.length;
  feeds.update(0.5, 1);
  assert.equal(calls.scene.length - before, 1, 'one render for the long frame');
  feeds.update(1 / 60, 1.02);
  assert.equal(calls.scene.length - before, 1, 'nothing queued for the next frame');
});
