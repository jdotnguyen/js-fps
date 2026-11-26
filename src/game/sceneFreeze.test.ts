// game-pause: the one switch for a frozen scene, driven by the real game modes and the real audio engine.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { AudioEngine, HOLD_SUSPEND_MS } from '../audio/engine.ts';
import type { SoundName } from '../audio/sounds.ts';
import { installFakeWebAudio, reaches, type FakeAudioContext, type FakeNode, type FakeSource } from '../audio/testing/fakeWebAudio.ts';
import { EventBus } from '../core/events.ts';
import { memoryStore } from '../core/storage.ts';
import { SceneTimers } from '../core/sceneTimers.ts';
import { DialogueLibrary } from '../dialogue/library.ts';
import { SpeechManager } from '../dialogue/speech.ts';
import { Game, type GameDeps } from './game.ts';
import { SAVE_VERSION, SaveStore, type SaveData } from './save.ts';
import { pauseWhenHidden, SceneFreeze } from './sceneFreeze.ts';

const SOUND: SoundName = 'metalKnock';
const settle = () => new Promise<void>((r) => setImmediate(r));

const save: SaveData = {
  version: SAVE_VERSION, kind: 'auto', slot: 0, savedAt: '2026-11-20T03:00:00.000Z', playTime: 600, difficulty: 'standard',
  chapter: 'slice01', level: 'slice01', checkpoint: 'cp_valve', location: 'Valve Room',
  player: { position: [36, 1.62, 52], yaw: 1, pitch: 0, health: 40, flashlightOn: true }, flags: {}, items: [], map: {},
};

/** A game wired to a scene freeze the way the session wires them, with `popup` standing in for the tutorial prompts. */
function setup(t: TestContext) {
  t.after(installFakeWebAudio());
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const doc = globalThis as unknown as { document?: unknown };
  const prevDoc = doc.document;
  doc.document = { hidden: false, pointerLockElement: null };
  t.after(() => void (doc.document = prevDoc));

  const audio = new AudioEngine();
  const ctx = audio.ctx as unknown as FakeAudioContext;
  (audio as unknown as { buffers: Map<SoundName, unknown[]> }).buffers.set(SOUND, [ctx.createBuffer(1, ctx.sampleRate * 5, ctx.sampleRate)]);
  const noop = (): void => {};
  const events = new EventBus();
  const game = new Game({
    events,
    settings: { get: () => ({ masterVolume: 1 }) },
    saves: new SaveStore(memoryStore()),
    difficulties: { standard: { label: 'Standard', checkpointHeal: 60 } },
    input: { requestLock: noop, consumeLook: noop },
    camera: new THREE.PerspectiveCamera(),
    player: { vitals: { hp: 100, checkpoint: noop }, alive: true, reset: noop, placeAtEye: noop },
    interactions: {},
    freeCam: {},
    flashlight: { on: false },
    world: { id: 'slice01', checkpoints: [], spawn: { position: new THREE.Vector3(), yaw: 0 }, resetToData: noop },
    audio,
    menuAudio: { setMasterVolume: noop, setBusVolume: noop },
    toasts: { show: noop },
    hud: { setFade: noop, hide: noop },
    cutscene: { cancel: noop, playIntro: noop, update: noop, render: noop, paused: noop },
    inventory: { restore: noop, clear: noop, list: () => [] },
    timers: new SceneTimers(),
  } as unknown as GameDeps);
  const popup = { open: false };
  const freeze = new SceneFreeze({ frozen: () => game.mode === 'paused' || (popup.open && game.mode === 'playing'), audio });
  events.on('game:mode', () => freeze.sync());
  /** Let the ramp finish and any queued release run. */
  const pass = async (): Promise<void> => {
    await settle();
    t.mock.timers.tick(HOLD_SUSPEND_MS);
    await settle();
  };
  const play = (): FakeSource => {
    audio.play(SOUND);
    return ctx.nodes.filter((n) => n.kind === 'source').at(-1) as FakeSource;
  };
  const heard = (n: FakeNode) => reaches(n, audio.ctx.destination as unknown as FakeNode);
  const running = () => ctx.state === 'running';
  game.load(save);
  return { game, events, audio, ctx, popup, freeze, pass, play, heard, running };
}

for (const [name, open] of [
  ['the pause menu', (g: Game) => g.pause()],
  ['the map', (g: Game) => g.openMap()],
  ['a save station', (g: Game) => g.openSaveStation()],
] as const) {
  test(`${name} freezes the scene and holds its sound; resuming releases it`, async (t) => {
    const { game, freeze, pass, play, heard, running } = setup(t);
    await pass();
    assert.equal(freeze.time(0.016), 0.016);
    const line = play();
    open(game);
    assert.equal(freeze.time(0.016), 0);
    await pass();
    assert.equal(running(), false);
    game.resume();
    await pass();
    assert.equal(running(), true);
    assert.equal(freeze.time(0.016), 0.016);
    assert.equal(heard(line), true, 'the held sound carries on');
  });
}

test('a tutorial pop-up freezes the scene, and a pause over it keeps it frozen until the pop-up goes', async (t) => {
  const { game, popup, freeze, pass, running } = setup(t);
  await pass();
  popup.open = true;
  freeze.sync();
  await pass();
  assert.equal(running(), false);
  game.pause();
  await pass();
  game.resume();
  await pass();
  assert.equal(freeze.frozen, true, 'the pop-up is back');
  assert.equal(running(), false);
  popup.open = false;
  freeze.sync();
  await pass();
  assert.equal(running(), true);
});

test('a line on the scene time neither ends nor loses time while frozen', async (t) => {
  const { game, freeze, pass } = setup(t);
  await pass();
  const speakers = JSON.parse(readFileSync(new URL('../data/dialogue/speakers.json', import.meta.url), 'utf8'));
  const lines = [{ id: 'line', channel: 'local', speaker: 'engineer', priority: 'story', emote: 'neutral', audio: null, choices: [], minDuration: 2, text: 'Testing.' }];
  const speech = new SpeechManager(new EventBus(), new DialogueLibrary(speakers, { test: { chapter: 'test', lines } }), { play: () => ({ stop: () => {} }) });
  const run = (seconds: number): void => {
    for (let i = 0; i < Math.round(seconds * 10); i++) speech.update(freeze.time(0.1));
  };
  speech.say('line');
  run(1.5);
  game.pause();
  run(30);
  assert.equal(speech.speaking()?.id, 'line');
  game.resume();
  run(0.4);
  assert.equal(speech.speaking()?.id, 'line');
  run(0.4);
  assert.equal(speech.speaking(), null);
});

test('loading from a pause drops the old sound and keeps what the restore starts', async (t) => {
  const { game, events, pass, play, heard, running } = setup(t);
  await pass();
  const old = play();
  game.pause();
  await pass();
  let fresh: FakeSource | null = null;
  events.on('game:restarted', () => {
    assert.equal(running(), false, 'still held while the restore listeners run');
    fresh = play();
  });
  game.load(save);
  await pass();
  assert.equal(running(), true);
  assert.equal(heard(old), false);
  assert.equal(heard(fresh!), true);
});

test('quitting to title from a pause drops the held sound before releasing', async (t) => {
  const { game, pass, play, heard, running } = setup(t);
  await pass();
  const shot = play();
  game.pause();
  await pass();
  game.quitToTitle();
  await pass();
  assert.equal(heard(shot), false);
  assert.equal(running(), true);
});

test('ending a held session (a load of another level) drops its sound and releases', async (t) => {
  const { game, freeze, pass, play, heard, running } = setup(t);
  await pass();
  const shot = play();
  game.pause();
  await pass();
  freeze.dispose();
  await settle();
  assert.equal(heard(shot), false);
  assert.equal(running(), true);
  freeze.sync();
  await pass();
  assert.equal(running(), true, 'a disposed switch does nothing more');
});

test('a load from the title, never held, discards nothing', async (t) => {
  const { game, pass, play, heard } = setup(t);
  await pass();
  const ambient = play();
  game.load(save);
  await pass();
  assert.equal(heard(ambient), true);
});

test('hiding the tab during play opens the pause menu; hiding it on the title does nothing', (t) => {
  const { game } = setup(t);
  let listener: (() => void) | null = null;
  const doc = {
    hidden: false,
    addEventListener: (_type: string, fn: () => void) => void (listener = fn),
    removeEventListener: () => void (listener = null),
  };
  const unhook = pauseWhenHidden(doc as unknown as Document, game);
  listener!();
  assert.equal(game.mode, 'playing', 'becoming visible does nothing');
  doc.hidden = true;
  listener!();
  assert.equal(game.mode, 'paused');
  game.quitToTitle();
  listener!();
  assert.equal(game.mode, 'title');
  unhook();
  assert.equal(listener, null);
});
