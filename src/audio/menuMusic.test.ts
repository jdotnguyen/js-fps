import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine, HOLD_SUSPEND_MS } from './engine.ts';
import { MenuMusic } from './menuMusic.ts';
import { installFakeWebAudio, reaches, type FakeAudioContext, type FakeNode, type FakeSource } from './testing/fakeWebAudio.ts';

function setup(t: TestContext) {
  t.after(installFakeWebAudio());
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const menu = new AudioEngine();
  const scene = new AudioEngine();
  const music = new MenuMusic(menu, scene, 'title');
  const fake = (e: AudioEngine) => e.ctx as unknown as FakeAudioContext;
  const buffer = menu.createStereo(new Float32Array(80_000), new Float32Array(80_000), 8000);
  const sources = (e: AudioEngine) => fake(e).nodes.filter((n) => n.kind === 'source') as FakeSource[];
  const level = (s: FakeSource) => ([...s.outputs][0] as FakeNode & { gain: { value: number } }).gain.value;
  const heard = (s: FakeSource, e: AudioEngine) => reaches(s, e.ctx.destination as unknown as FakeNode);
  /** The theme loop's level, and the scene copy's (null when it has none). */
  const levels = (): [number, number | null] => {
    const cue = sources(scene).filter((s) => heard(s, scene) && s.stopAt === null).at(-1);
    return [level(sources(menu)[0]!), cue ? level(cue) : null];
  };
  const holdScene = (): void => {
    scene.setHeld(true);
    t.mock.timers.tick(HOLD_SUSPEND_MS);
  };
  return { menu, scene, music, buffer, fake, sources, levels, heard, holdScene };
}

test('the theme follows the mode on the menu engine: full on the title, under the pause menu, off in play', (t) => {
  const { music, buffer, levels } = setup(t);
  music.use(buffer);
  assert.deepEqual(levels(), [1, null]);
  music.setMode('playing');
  assert.deepEqual(levels(), [0, null]);
  music.setMode('paused');
  assert.deepEqual(levels(), [0.4, null]);
});

test('the theme is gone within a fraction of a second of leaving a pause, but leaves the title slowly', (t) => {
  const { music, buffer, sources, menu } = setup(t);
  music.use(buffer);
  const gain = () => ([...sources(menu)[0]!.outputs][0] as FakeNode & { gain: { value: number; timeConstant: number } }).gain;
  music.setMode('playing');
  assert.equal(gain().timeConstant, 1.5, 'out of the title');
  music.setMode('paused');
  music.setMode('playing');
  assert.equal(gain().value, 0);
  assert.ok(gain().timeConstant <= 0.1, `resume: ${gain().timeConstant}`);
});

test('a scene cue plays on the scene engine; pausing leaves it alone and brings the theme up', (t) => {
  const { music, buffer, levels } = setup(t);
  music.use(buffer);
  music.setMode('playing');
  music.cue('main_theme');
  assert.deepEqual(levels(), [0, 1]);
  music.cue('main_theme', 0.3);
  assert.deepEqual(levels(), [0, 0.3]);
  music.setMode('paused');
  assert.deepEqual(levels(), [0.4, 0.3], 'the scene copy waits at its level, held with the scene');
  music.setMode('playing');
  assert.deepEqual(levels(), [0, 0.3]);
  music.cue(null);
  assert.deepEqual(levels(), [0, null]);
  music.cue('main_theme');
  assert.deepEqual(levels(), [0, 1]);
});

test('both loops play the one rendered buffer, and the scene copy starts where the theme is', (t) => {
  const { menu, scene, music, buffer, fake, sources } = setup(t);
  music.use(buffer);
  fake(menu).advance(23);
  music.setMode('playing');
  music.cue('main_theme');
  assert.equal(sources(menu)[0]!.buffer, buffer);
  assert.equal(sources(scene)[0]!.buffer, buffer);
  assert.deepEqual(sources(scene)[0]!.started, [0, 3], '23 s into a 10 s loop');
  assert.equal(music.decodedBytes(), 80_000 * 2 * 4);
});

test('a cue that arrives before the render plays once it lands', (t) => {
  const { music, buffer, levels } = setup(t);
  music.setMode('playing');
  music.cue('main_theme', 0.5);
  music.use(buffer);
  assert.deepEqual(levels(), [0, 0.5]);
});

test('the credits keep the theme silent until they let it go', (t) => {
  const { music, buffer, levels } = setup(t);
  music.use(buffer);
  music.hold(true);
  assert.deepEqual(levels(), [0, null]);
  music.hold(false);
  assert.deepEqual(levels(), [1, null]);
});

test('quitting to title from a pause drops the scene copy at once and keeps the theme', (t) => {
  const { scene, music, buffer, levels, sources, heard, holdScene } = setup(t);
  music.use(buffer);
  music.setMode('playing');
  music.cue('main_theme');
  music.setMode('paused');
  holdScene();
  music.setMode('title');
  assert.equal(heard(sources(scene)[0]!, scene), false);
  assert.deepEqual(levels(), [1, null]);
});

test('a restarting cue plays the theme from its first bar, wherever the theme loop is', (t) => {
  const { menu, scene, music, buffer, fake, sources, levels } = setup(t);
  music.use(buffer);
  fake(menu).advance(23);
  music.setMode('playing');
  music.cue('main_theme', 1, true);
  assert.deepEqual(sources(scene).at(-1)!.started, [0, 0]);
  assert.deepEqual(levels(), [0, 1]);
  music.cue(null);
  assert.deepEqual(levels(), [0, null]);
  music.cue('main_theme');
  assert.deepEqual(sources(scene).at(-1)!.started, [0, 3], 'an ordinary cue still joins where the theme is');
});
