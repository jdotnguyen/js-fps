// game-pause: scene sound holds and resumes in place, and leaving a held moment drops it. Own file: these tests
// mock timers and the document.
import assert from 'node:assert/strict';
import { after, before, test, type TestContext } from 'node:test';
import * as THREE from 'three';
import { installFakeWebAudio, reaches, type FakeAudioContext, type FakeNode, type FakeSource } from './testing/fakeWebAudio.ts';
import { AudioEngine, HOLD_SUSPEND_MS, UI_SOUND_NAMES } from './engine.ts';
import type { SoundName } from './sounds.ts';

let uninstall: () => void;
before(() => {
  uninstall = installFakeWebAudio();
});
after(() => uninstall());

const SOUND: SoundName = 'metalKnock';
const node = (n: unknown) => n as FakeNode;
const settle = () => new Promise<void>((r) => setImmediate(r));

/** An engine with a two second buffer for SOUND and mocked timers. */
function setup(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const engine = new AudioEngine();
  const ctx = engine.ctx as unknown as FakeAudioContext;
  (engine as unknown as { buffers: Map<SoundName, unknown[]> }).buffers.set(SOUND, [ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)]);
  const listener = engine.ctx.listener as unknown as Record<string, unknown>;
  listener.setPosition = () => undefined;
  listener.setOrientation = () => undefined;
  const hold = (): void => {
    engine.setHeld(true);
    t.mock.timers.tick(HOLD_SUSPEND_MS);
  };
  /** The source the last `play` or `loop` made. */
  const lastSource = (): FakeSource => ctx.nodes.filter((n) => n.kind === 'source').at(-1) as FakeSource;
  const heard = (n: FakeNode) => reaches(n, node(engine.ctx.destination));
  const gate = () => [...node(engine.ctx.destination).context.nodes].find((n) => n.outputs.has(node(engine.ctx.destination))) as FakeNode & { gain: { value: number } };
  return { engine, ctx, hold, lastSource, heard, gate };
}

test('holding closes the output, then suspends; releasing resumes and opens it', async (t) => {
  const { engine, ctx, gate } = setup(t);
  engine.setHeld(true);
  assert.equal(engine.held, true);
  assert.equal(gate().gain.value, 0);
  assert.equal(ctx.state, 'running', 'the ramp plays out before the cut');
  t.mock.timers.tick(HOLD_SUSPEND_MS);
  assert.equal(ctx.state, 'suspended');
  engine.setHeld(false);
  await settle();
  assert.equal(engine.held, false);
  assert.equal(ctx.state, 'running');
  assert.equal(gate().gain.value, 1);
});

test('the unlock call does not release a hold', async (t) => {
  const { engine, ctx, hold } = setup(t);
  hold();
  await engine.resume();
  assert.equal(ctx.state, 'suspended');
});

test('a quick hold and release ends running', async (t) => {
  const { engine, ctx, gate } = setup(t);
  engine.setHeld(true);
  engine.setHeld(false);
  t.mock.timers.tick(HOLD_SUSPEND_MS * 2);
  await settle();
  assert.equal(ctx.state, 'running');
  assert.equal(gate().gain.value, 1);
});

test('a release that settles after a new hold does not leave the mix running', async (t) => {
  const { engine, ctx, hold } = setup(t);
  hold();
  engine.setHeld(false);
  engine.setHeld(true);
  t.mock.timers.tick(HOLD_SUSPEND_MS);
  await settle();
  assert.equal(ctx.state, 'suspended');
});

test('a hidden page suspends at once', (t) => {
  const { engine, ctx } = setup(t);
  const g = globalThis as unknown as { document?: unknown };
  const prev = g.document;
  g.document = { hidden: true };
  try {
    engine.setHeld(true);
    assert.equal(ctx.state, 'suspended');
  } finally {
    g.document = prev;
  }
});

test('discarding a held moment leaves nothing from before it connected', (t) => {
  const { engine, ctx, hold, lastSource, heard } = setup(t);
  const at = new THREE.Vector3(2, 1, 0);
  engine.play(SOUND, { position: at, reverb: 0.5 });
  const shot = lastSource();
  engine.play(SOUND, { delay: 1 });
  const waiting = lastSource();
  const before = ctx.nodes.filter((n) => n.kind === 'convolver');
  hold();
  engine.discardHeld();
  assert.equal(heard(shot), false);
  assert.equal(heard(waiting), false);
  assert.notEqual(shot.stopAt, null);
  assert.notEqual(waiting.stopAt, null);
  for (const c of before) assert.equal(reaches(node(engine.reverbIn), c), false, 'the old tail is cut off');
  const fresh = ctx.nodes.filter((n) => n.kind === 'convolver' && !before.includes(n));
  assert.ok(fresh.some((c) => reaches(node(engine.reverbIn), c) && heard(c)), 'the room still has its reverb');
});

test('discarding leaves loops playing, and does nothing unless held', (t) => {
  const { engine, hold, lastSource, heard } = setup(t);
  engine.play(SOUND);
  const shot = lastSource();
  engine.discardHeld();
  assert.equal(heard(shot), true);
  engine.loop(SOUND, {});
  const bed = lastSource();
  hold();
  engine.discardHeld();
  assert.equal(heard(bed), true);
  assert.equal(heard(shot), false);
});

test('a stop asked for while held is immediate, for a one-shot and a loop', (t) => {
  const { engine, hold, lastSource, heard } = setup(t);
  const shot = engine.play(SOUND);
  const shotSource = lastSource();
  const bed = engine.loop(SOUND, {});
  const bedSource = lastSource();
  hold();
  shot.stop(0.5);
  bed.stop(0.5);
  assert.equal(heard(shotSource), false);
  assert.equal(heard(bedSource), false);
});

test('a fade under way when the hold comes is still pending after the release', async (t) => {
  const { engine, ctx, hold, lastSource, heard } = setup(t);
  const bed = engine.loop(SOUND, {});
  const source = lastSource();
  bed.stop(1);
  ctx.advance(0.4);
  hold();
  t.mock.timers.tick(10_000);
  ctx.advance(10);
  assert.equal(heard(source), true, 'real time passing ends nothing');
  engine.setHeld(false);
  await settle();
  assert.ok(Math.abs(source.stopAt! - ctx.currentTime - 0.64) < 1e-9, 'the rest of the fade, and its stop');
  ctx.advance(0.7);
  assert.equal(heard(source), false);
});

test('a delayed sound starts that far ahead on the audio clock', (t) => {
  const { engine, ctx, lastSource } = setup(t);
  ctx.currentTime = 3;
  engine.play(SOUND, { delay: 0.25 });
  assert.deepEqual(lastSource().started, [3.25]);
  engine.play(SOUND);
  assert.deepEqual(lastSource().started, []);
});

test('an outgoing reverb is let go on the audio clock, not on real time', (t) => {
  const { engine, ctx, hold } = setup(t);
  const camera = new THREE.PerspectiveCamera();
  const old = ctx.nodes.find((n) => n.kind === 'convolver')!;
  engine.setRoomReverb('metal_hall', 0.5);
  hold();
  t.mock.timers.tick(10_000);
  engine.updateListener(camera);
  assert.equal(reaches(node(engine.reverbIn), old), true);
  ctx.currentTime += 1;
  engine.updateListener(camera);
  assert.equal(reaches(node(engine.reverbIn), old), false);
});

test('a menu engine plays interface sounds while the scene engine is held', async (t) => {
  const { ctx, hold } = setup(t);
  const menu = new AudioEngine();
  menu.renderSounds(UI_SOUND_NAMES);
  const menuCtx = menu.ctx as unknown as FakeAudioContext;
  hold();
  await menu.resume();
  menu.play('uiHover', { bus: 'ui' });
  const source = menuCtx.nodes.filter((n) => n.kind === 'source').at(-1) as FakeSource;
  assert.equal(ctx.state, 'suspended');
  assert.equal(menuCtx.state, 'running');
  assert.equal(menu.held, false);
  assert.ok(reaches(source, node(menu.ctx.destination)));
});
