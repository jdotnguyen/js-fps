import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { heardFlag, OverheardDirector } from '../ai/overheard.ts';
import { validate } from '../core/validate.ts';
import { EventBus } from '../core/events.ts';
import { validateOverheard } from '../data/types/overheard.ts';
import { memoryStore } from '../core/storage.ts';
import { SceneTimers } from '../core/sceneTimers.ts';
import { Game, type GameDeps } from './game.ts';
import { SAVE_VERSION, SaveStore, type SaveData } from './save.ts';

// checkpoint-restore spec: a title load and a death restart run the same restore.

function sample(over: Partial<SaveData> = {}): SaveData {
  return {
    version: SAVE_VERSION,
    kind: 'auto',
    slot: 0,
    savedAt: '2026-11-20T03:00:00.000Z',
    playTime: 600,
    difficulty: 'standard',
    chapter: 'slice01',
    level: 'slice01',
    checkpoint: 'cp_valve',
    location: 'Valve Room',
    player: { position: [36, 1.62, 52], yaw: 1, pitch: 0, health: 40, flashlightOn: true },
    flags: { 'cp:cp_valve': true, valve_done: true },
    items: [],
    map: {},
    ...over,
  };
}

/** Records the levels a mix was last given. */
function mixer() {
  const levels: Record<string, number> = {};
  return {
    levels,
    setMasterVolume: (v: number) => void (levels['master'] = v),
    setBusVolume: (bus: string, v: number) => void (levels[bus] = v),
    discardHeld: () => {},
  };
}

function setup() {
  const events = new EventBus();
  const saves = new SaveStore(memoryStore());
  const log: string[] = [];
  const noop = () => {};
  const timers = new SceneTimers();
  const player = {
    hp: 100,
    placed: null as THREE.Vector3 | null,
    vitals: { hp: 100, checkpoint: noop },
    alive: true,
    reset(hp?: number) {
      this.hp = hp ?? 100;
    },
    placeAtEye(p: THREE.Vector3) {
      this.placed = p.clone();
    },
  };
  const deps = {
    events,
    settings: { get: () => ({ masterVolume: 1 }) },
    saves,
    difficulties: { standard: { label: 'Standard', checkpointHeal: 60 } },
    input: { requestLock: noop, consumeLook: noop },
    camera: new THREE.PerspectiveCamera(),
    player,
    interactions: {},
    freeCam: {},
    flashlight: { on: false },
    world: {
      id: 'slice01',
      checkpoints: [],
      spawn: { position: new THREE.Vector3(), yaw: 0 },
      resetToData: () => log.push('resetToData'),
    },
    audio: mixer(),
    menuAudio: mixer(),
    toasts: { show: (title: string) => log.push(`toast:${title}`) },
    hud: { setFade: (v: number) => log.push(`fade:${v}`), hide: noop },
    cutscene: { cancel: noop, playIntro: noop, update: noop, render: noop, paused: noop },
    inventory: { restore: noop, clear: noop, list: () => [] },
    timers,
  } as unknown as GameDeps;
  events.on('game:mode', ({ mode }) => log.push(`mode:${mode}`));
  events.on('game:restarted', ({ checkpoint }) => log.push(`restarted:${checkpoint}`));
  const game = new Game(deps);
  const scene = deps.audio as unknown as ReturnType<typeof mixer>;
  const menu = deps.menuAudio as unknown as ReturnType<typeof mixer>;
  return { game, saves, player, log, deps, scene, menu, events, timers };
}

test('a title load resets the level, starts play, then announces the restart with the checkpoint', () => {
  const { game, player, log } = setup();
  game.load(sample());
  assert.deepEqual(
    log.filter((l) => l !== 'fade:0'),
    ['resetToData', 'mode:playing', 'toast:Autosave loaded', 'restarted:cp_valve'],
  );
  assert.equal(game.mode, 'playing');
  assert.equal(game.checkpoint, 'cp_valve');
  assert.equal(game.flags['valve_done'], true);
  assert.equal(player.hp, 40);
  assert.deepEqual(player.placed?.toArray(), [36, 1.62, 52]);
});

test('pausing lowers only the menu output; the scene stays at the master setting', () => {
  const { game, scene, menu } = setup();
  game.load(sample());
  assert.deepEqual([scene.levels['master'], menu.levels['master']], [1, 1]);
  game.pause();
  assert.deepEqual([scene.levels['master'], menu.levels['master']], [1, 0.45]);
  game.resume();
  assert.deepEqual([scene.levels['master'], menu.levels['master']], [1, 1]);
});

test('a master volume of 0% silences both outputs, and bus volumes reach both', () => {
  const { game, scene, menu, deps } = setup();
  game.load(sample());
  game.pause();
  Object.assign(deps.settings, { get: () => ({ masterVolume: 0, musicVolume: 0.5, sfxVolume: 0.25, voiceVolume: 0.75 }) });
  game.applyVolume();
  assert.deepEqual([scene.levels['master'], menu.levels['master']], [0, 0]);
  assert.deepEqual([menu.levels['ui'], menu.levels['music'], scene.levels['voice']], [0.25, 0.5, 0.75]);
});

test('a manual save loaded from the title says so', () => {
  const { game, log } = setup();
  game.load(sample({ kind: 'manual' }));
  assert.ok(log.includes('toast:Save loaded'));
  assert.equal(log.filter((l) => l.startsWith('restarted:')).length, 1);
});

test('a death restart restores the autosave once, healed, without resetting the level', () => {
  const { game, saves, player, log } = setup();
  saves.write(sample());
  game.load(sample());
  log.length = 0;
  (game as unknown as { restartFromCheckpoint(): void }).restartFromCheckpoint();
  assert.ok(!log.includes('resetToData'), 'the live level is kept on a death restart');
  assert.deepEqual(log.filter((l) => l.startsWith('restarted:')), ['restarted:cp_valve']);
  assert.ok(log.includes('toast:Restarted'));
  assert.equal(player.hp, 60, 'healed to the checkpoint heal');
});

test('the death restart counts play time: it waits out a pause and fires after resume', () => {
  const { game, saves, log, events, timers } = setup();
  saves.write(sample());
  game.load(sample());
  /** The session's rule: timers step only while the scene is not frozen. */
  const play = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) if (game.mode === 'playing') timers.update(1 / 60);
  };
  log.length = 0;
  events.emit('player:died', {} as never);
  play(1);
  game.pause();
  play(60);
  assert.equal(game.mode, 'paused', 'the menu stays open');
  assert.ok(!log.includes('toast:Restarted'));
  game.resume();
  play(1.3);
  assert.ok(!log.includes('toast:Restarted'), '1.4 s of fade and 1 s of hold, in play');
  play(0.2);
  assert.ok(log.includes('toast:Restarted'));
});

test('loading from the death fade cancels the restart', () => {
  const { game, saves, log, events, timers } = setup();
  saves.write(sample());
  game.load(sample());
  events.emit('player:died', {} as never);
  game.pause();
  game.load(sample({ kind: 'manual' }));
  log.length = 0;
  for (let i = 0; i < 600; i++) timers.update(1 / 60);
  assert.deepEqual(log, []);
});

test('an overheard exchange heard before a checkpoint stays heard after loading it', () => {
  const data = validate(validateOverheard, JSON.parse(readFileSync(new URL('../data/overheard.json', import.meta.url), 'utf8')), 'overheard.json');
  const { game, saves } = setup();
  game.load(sample({ flags: { commons_free: true } }));
  Object.assign((game as unknown as { d: GameDeps }).d.player, { eyePosition: (v: THREE.Vector3) => v, yaw: 0, pitch: 0 });
  const said: string[] = [];
  const director = () =>
    new OverheardDirector(data, {
      say: (id) => void said.push(id),
      stop: () => undefined,
      ready: () => true,
      flag: (n) => !!game.flags[n],
      setFlag: (n) => void (game.flags[n] = true),
      playerRoom: () => data.room,
      freeControl: () => true,
      sceneRunning: () => false,
      higherSpeech: () => false,
      pair: (chat) => (chat === 'commons_bar' ? { distance: 2, free: true } : null),
      suspend: () => undefined,
    });
  director().update(0.1);
  assert.deepEqual(said, ['overheard_bar_before_01']);
  game.reachCheckpoint('cp_test', 'Commons');
  game.flags = {};
  const saved = saves.read(0, 'auto');
  assert.equal(saved.error, null);
  game.load(saved.data!);
  assert.equal(game.flags[heardFlag('overheard_bar_before')], true);
  director().update(0.1);
  assert.equal(said.length, 1, 'not said again');
});
