import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import './ui/styles/base.css';
import './ui/styles/menu.css';
import './ui/styles/hud.css';
import keymapJson from './data/keymap.json';
import difficultyJson from './data/difficulty.json';
import { validateKeymap } from './data/types/keymap.ts';
import { validateDifficultyTable } from './data/types/difficulty.ts';
import { createDebugTools, readDebugFlags, type DebugTools } from './core/debug.ts';
import { EventBus } from './core/events.ts';
import { FreeCamera } from './core/freeCamera.ts';
import { Input } from './core/input.ts';
import { Loop } from './core/loop.ts';
import { Rng } from './core/rng.ts';
import { SettingsStore } from './core/settings.ts';
import { browserStore } from './core/storage.ts';
import { validate } from './core/validate.ts';
import { applyQuality, createRenderer } from './render/renderer.ts';
import { createMaterials } from './render/materials.ts';
import { createPost } from './render/post.ts';
import { Flashlight } from './render/flashlight.ts';
import { LIGHT_PATTERNS } from './render/lights.ts';
import { buildDemoRoom, type DemoRoom } from './world/demoRoom.ts';
import { demoRoomWorld } from './world/demoWorld.ts';
import { loadLevel, type Level } from './world/level.ts';
import { KitRegistry, validateKitManifest } from './world/registry.ts';
import { LevelOverlay, OVERLAY_LAYERS } from './world/levelDebug.ts';
import { levelValidator } from './data/types/level.ts';
import kitManifestJson from './data/kit-manifest.json';
import type { World } from './world/world.ts';
import { DemoRoomAudio } from './world/demoRoomAudio.ts';
import { AudioEngine } from './audio/engine.ts';
import { MenuMusic } from './audio/menuMusic.ts';
import { Game } from './game/game.ts';
import { CutsceneController } from './game/cutscene.ts';
import { createSequenceHost } from './game/sequenceHost.ts';
import { Sequencer } from './sequence/sequencer.ts';
import type { SequenceDef } from './sequence/types.ts';
import { CutsceneUi } from './ui/hud/cutsceneUi.ts';
import { Interactions } from './actors/interaction.ts';
import { Player, PLAYER_TUNING } from './actors/player.ts';
import { DEBUG_SEQUENCES } from './actors/debugSequences.ts';
import { createGameHost } from './script/gameHost.ts';
import { loadSequences } from './script/load.ts';
import { SequenceOverlay } from './script/overlay.ts';
import { SequenceManager } from './script/runtime.ts';
import { DEMO_INTERACT_BOXES } from './world/demoRoomColliders.ts';
import { PlayerHud, keyLabel } from './ui/hud/playerHud.ts';
import { SaveStore } from './game/save.ts';
import { createMenus } from './ui/menus/screens.ts';
import { Toasts } from './ui/toast.ts';
import { Viewmodel } from './render/viewmodel/viewmodel.ts';

const SEQUENCE_FILES = import.meta.glob<SequenceDef>('./data/sequences/*.json', { eager: true, import: 'default' });
const LEVEL_FILES = import.meta.glob<unknown>('./data/levels/*.json', { eager: true, import: 'default' });
const TEXTURE_SIZE = 512;
const FOG_COLOR = 0x04080a;
const GRAIN = 0.035;

function el<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`index.html is missing ${selector}`);
  return found;
}

function showBootError(err: unknown): void {
  const box = document.querySelector<HTMLElement>('#boot-error');
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error(err);
  if (!box) return;
  box.textContent = `The game could not start.\n\n${message}`;
  box.hidden = false;
}

/** Let the browser paint (e.g. a loading message) before blocking work. */
const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

async function boot(): Promise<void> {
  const canvas = el<HTMLCanvasElement>('#game');
  const prompt = el<HTMLElement>('#prompt');

  const events = new EventBus();
  const settings = new SettingsStore(events);
  const flags = readDebugFlags(location.search);
  // All data goes through validators so bad JSON fails here with a readable path.
  const keymap = validate(validateKeymap, keymapJson, 'data/keymap.json');
  const difficulties = validate(validateDifficultyTable, difficultyJson, 'data/difficulty.json');
  const saves = new SaveStore(browserStore());

  prompt.textContent = 'Generating textures…';
  prompt.hidden = false;
  await nextFrame();
  await nextFrame();

  const renderer = createRenderer(canvas, settings.get());
  if (new URLSearchParams(location.search).has('vmlab')) {
    prompt.hidden = true;
    document.querySelector<HTMLElement>('#ui')?.setAttribute('hidden', '');
    document.querySelector<HTMLElement>('#menu')?.setAttribute('hidden', '');
    const { runLab } = await import('./render/viewmodel/lab.ts');
    await runLab(renderer);
    return;
  }
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(FOG_COLOR);
  scene.fog = new THREE.FogExp2(FOG_COLOR, 0.05);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.12;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(settings.get().fov, innerWidth / innerHeight, 0.05, 120);

  const t0 = performance.now();
  const materials = createMaterials(TEXTURE_SIZE, Math.min(8, renderer.capabilities.getMaxAnisotropy()));
  // ?level=<id> loads a data-driven kit level (ADR-0003); otherwise the hand-built demo room.
  const levelId = new URLSearchParams(location.search).get('level');
  let room: DemoRoom | null = null;
  let level: Level | null = null;
  let world: World;
  if (levelId) {
    const file = Object.entries(LEVEL_FILES).find(([path]) => path.endsWith(`/${levelId}.json`));
    if (!file) throw new Error(`No level '${levelId}'. Known: ${Object.keys(LEVEL_FILES).map((f) => f.replace(/^.*\/|\.json$/g, '')).join(', ')}`);
    const registry = new KitRegistry(validate(validateKitManifest, kitManifestJson, 'data/kit-manifest.json'), undefined);
    const data = validate(levelValidator(registry.ids()), file[1], `data/levels/${levelId}.json`);
    level = await loadLevel(data, { materials, registry, events, scene });
    world = level;
    console.info(`[boot] level '${levelId}' built in ${(performance.now() - t0).toFixed(0)} ms`);
    console.table(level.roomStats());
  } else {
    room = buildDemoRoom(materials, new Rng('demo-room'));
    world = demoRoomWorld(room);
    console.info(`[boot] textures + room built in ${(performance.now() - t0).toFixed(0)} ms`);
  }
  scene.add(world.group);

  // Audio starts suspended; the first click anywhere resumes it (browser rule).
  const audio = new AudioEngine();
  console.info(`[boot] sounds rendered in ${audio.renderSounds().toFixed(0)} ms`);
  const roomAudio = room ? new DemoRoomAudio(audio, room, new Rng('room-audio')) : null;
  roomAudio?.start();
  addEventListener('pointerdown', () => void audio.resume(), { capture: true });
  addEventListener('keydown', () => void audio.resume(), { capture: true });

  camera.position.copy(world.spawn.position);
  const input = new Input(canvas, keymap, events);
  const freeCam = new FreeCamera(camera, input, () => settings.get());
  freeCam.yaw = world.spawn.yaw;
  freeCam.speed = 2.5;
  freeCam.bounds = world.bounds;

  const flashlight = new Flashlight(scene, camera);
  const interactions = new Interactions();
  // The game sets the difficulty; until then the player reads Standard.
  let currentPreset = (): (typeof difficulties)['standard'] => difficulties.standard;
  const player = new Player({
    camera,
    input,
    events,
    settings: () => settings.get(),
    flashlight,
    interactions,
    difficulty: () => currentPreset(),
    world: world.playerWorld,
  });
  const post = createPost(renderer, scene, camera, settings.get().quality);
  renderer.compile(scene, camera);

  const toasts = new Toasts(document.body);
  const hud = new PlayerHud(el<HTMLElement>('#ui'), el<HTMLElement>('#interact'), keymap.interact[0] ?? 'KeyE');
  // Sequences and the cutscene chrome (ADR-0009, ADR-0017). `game` is created just below;
  // the sequencer shares its flags object so sequences read and write the real game state.
  const gameRef: { current: Game | null } = { current: null };
  const sequenceFlags = new Proxy({} as Game['flags'], {
    get: (_t, key: string) => gameRef.current?.flags[key],
    set: (_t, key: string, value: Game['flags'][string]) => {
      if (gameRef.current) gameRef.current.flags[key] = value;
      return true;
    },
  });
  const sequencer = new Sequencer({
    events,
    flags: sequenceFlags,
    host: createSequenceHost({ player, hud, audio, toasts, checkpoint: (id) => gameRef.current?.scriptedCheckpoint(id) }),
  });
  for (const [path, def] of Object.entries(SEQUENCE_FILES)) {
    try {
      sequencer.register(def);
    } catch (err) {
      throw new Error(`data/sequences/${path.replace(/^.*\//, '')}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const cutscene = new CutsceneController({
    events,
    sequencer,
    input,
    settings,
    player,
    hud,
    ui: new CutsceneUi(el<HTMLElement>('#ui')),
    skipKeyLabel: () => keyLabel(keymap.skipCutscene[0] ?? 'Space'),
  });
  const game = new Game({
    events,
    settings,
    saves,
    difficulties,
    input,
    camera,
    player,
    interactions,
    freeCam,
    flashlight,
    world,
    audio,
    toasts,
    hud,
    cutscene,
  });
  gameRef.current = game;
  currentPreset = () => game.preset;
  prompt.textContent = 'Building weapons…';
  await nextFrame();
  const viewmodel = new Viewmodel({
    scene,
    camera,
    input,
    player,
    events,
    enabled: () => game.mode === 'playing' && !game.flying && player.alive && player.control.state.weapons,
    visible: () => game.mode !== 'title' && !game.flying,
    reducedMotion: () => settings.get().reducedMotion,
  });
  renderer.compile(scene, camera);
  createMenus(el<HTMLElement>('#menu'), { game, saves, settings, difficulties, events });
  const menuMusic = new MenuMusic(audio, game.mode);
  menuMusic.start();
  events.on('game:mode', ({ mode }) => menuMusic.setMode(mode));
  events.on('player:flashlight', () => roomAudio?.flashlightClick());
  events.on('player:footstep', (f) => roomAudio?.footstep(f.surface, f.x, f.z, f.sprint));
  events.on('player:damaged', () => audio.muffle(0.4));

  if (level) {
    level.registerInteractions(interactions);
    events.on('door:denied', (d) => toasts.show('Door', d.reason));
    events.on('door:unlocked', (d) => toasts.show('Door unlocked', d.id));
  } else {
    // Demo room interactables (ADR-0004).
    interactions.add({ id: 'save_station', prompt: 'Use save station', box: DEMO_INTERACT_BOXES.saveStation, use: () => game.openSaveStation() });
    interactions.add({
      id: 'locker_sec07',
      prompt: 'Open locker',
      hold: 0.6,
      box: DEMO_INTERACT_BOXES.locker,
      enabled: () => !game.flags['locker_sec07'],
      use: () => {
        game.flags['locker_sec07'] = true;
        toasts.show('Locker SEC-07', 'Empty. Someone got here first.');
      },
    });
    interactions.add({
      id: 'lab_b_monitor',
      prompt: 'Read monitor',
      box: DEMO_INTERACT_BOXES.console,
      use: () => toasts.show('Lab B monitor', 'Specimen B-7: stable. Containment check required.'),
    });
    interactions.add({
      id: 'door_07b_panel',
      prompt: 'Override door',
      hold: 1.0,
      box: DEMO_INTERACT_BOXES.doorPanel,
      use: () => toasts.show('Access denied', 'Pressure differential · lockdown 07-B'),
    });
  }

  // ADR-0009 sequences; created once the loop exists (it owns the time scale).
  let sequences: SequenceManager | null = null;

  const runSequence = (id: string): void => {
    if (sequencer.has(id)) {
      sequencer.play(id);
      return;
    }
    const seq = DEBUG_SEQUENCES[id];
    if (!seq) {
      if (sequences?.has(id)) sequences.start(id, { debug: true });
      else console.warn(`[debug] unknown sequence '${id}'. Known: ${[...Object.keys(DEBUG_SEQUENCES), ...(sequences?.ids() ?? [])].join(', ')}`);
      return;
    }
    seq({ player, say: (t, b) => toasts.show(t, b ?? ''), focus: room?.anchors.door ?? world.spawn.position }).catch((err: unknown) => console.error(err));
  };

  // Apply settings now and whenever they change.
  const applySettings = (): void => {
    const s = settings.get();
    camera.fov = s.fov;
    camera.updateProjectionMatrix();
    applyQuality(renderer, s.quality);
    post.setSize(innerWidth, innerHeight, renderer.getPixelRatio());
    post.setQuality(s.quality);
    post.grade.uGrain.value = s.filmGrain ? GRAIN : 0;
    game.applyVolume();
  };
  applySettings();
  events.on('settings:changed', applySettings);

  let debug: DebugTools | null = null;
  let levelStats: { drawCalls: number; pool: number } | null = null;
  if (flags.enabled) {
    debug = await createDebugTools();
    const gui = debug.gui;
    const look = gui.addFolder('Look');
    look.add(renderer, 'toneMappingExposure', 0.1, 2.5, 0.01).name('exposure');
    look.add(scene, 'environmentIntensity', 0, 1, 0.01).name('reflections');
    const fog = scene.fog;
    if (fog instanceof THREE.FogExp2) look.add(fog, 'density', 0, 0.15, 0.001).name('fog density');
    look.add(post.grade.uGrain, 'value', 0, 0.15, 0.001).name('film grain');
    look.add(post.grade.uVignette, 'value', 0, 1, 0.01).name('vignette');
    look.add(post.grade.uAberration, 'value', 0, 0.02, 0.0005).name('aberration');
    look.add(post.grade.uDamage, 'value', 0, 1, 0.01).name('damage tint');
    const fx = gui.addFolder('Post');
    fx.add(post.gtao, 'enabled').name('ambient occlusion');
    fx.add(post.gtao, 'blendIntensity', 0, 1, 0.01).name('AO strength');
    fx.add(post.bloom, 'strength', 0, 2, 0.01).name('bloom');
    fx.add(post.bloom, 'threshold', 0, 2, 0.01).name('bloom threshold');
    fx.add(post.bloom, 'radius', 0, 1, 0.01).name('bloom radius');
    const lightsFolder = gui.addFolder('Lights');
    lightsFolder.add(flashlight, 'intensity', 0, 200, 1).name('flashlight');
    for (const item of world.lights.items) {
      const f = lightsFolder.addFolder(item.name);
      f.add(item, 'pattern', [...LIGHT_PATTERNS]);
      f.add(item, 'base', 0, 100, 0.5).name('intensity');
      f.close();
    }
    const sound = gui.addFolder('Audio mix');
    sound.add(audio.buses.ambience.gain, 'value', 0, 2, 0.01).name('ambience');
    sound.add(audio.buses.sfx.gain, 'value', 0, 2, 0.01).name('footsteps / sfx');
    sound.add(audio.buses.music.gain, 'value', 0, 1, 0.01).name('music');
    gui.addFolder('Camera').add(freeCam, 'speed', 1, 20, 0.5).name('fly speed (F1)');
    const pf = gui.addFolder('Player');
    const actions = {
      damage: () => player.damage(20, player.eyePosition().add(new THREE.Vector3(1.5, 0, 0))),
      down: () => player.damage(10000),
      revive: () => player.revive(),
      grab: () => player.grab(player.eyePosition().addScaledVector(player.viewDirection(), 0.9)),
      controlTest: () => runSequence('control-test'),
      walkTest: () => runSequence('walk-test'),
      cutsceneTest: () => runSequence('cutscene_test'),
      fly: () => game.toggleFly(),
    };
    pf.add(player.vitals, 'hp', 0, 100).name('hp').listen().disable();
    pf.add(player, 'stamina', 0, PLAYER_TUNING.sprintMax).name('sprint stamina').listen().disable();
    pf.add(actions, 'damage').name('take 20 damage');
    pf.add(actions, 'down').name('go down');
    pf.add(actions, 'revive').name('medic revive');
    pf.add(actions, 'grab').name('get grabbed');
    pf.add(actions, 'controlTest').name('run control-test');
    pf.add(actions, 'walkTest').name('run walk-test');
    pf.add(actions, 'cutsceneTest').name('run cutscene_test (skippable)');
    pf.add(actions, 'fly').name('toggle fly (F1)');
    const feel = pf.addFolder('Feel');
    for (const key of Object.keys(PLAYER_TUNING) as Array<keyof typeof PLAYER_TUNING>) feel.add(PLAYER_TUNING, key);
    feel.close();
    addEventListener('keydown', (e) => {
      if (e.code !== 'F1') return;
      e.preventDefault();
      if (game.mode === 'playing') game.toggleFly();
    });
    // ?debug&seq=<id>: run a debug sequence a moment after play starts.
    const seqId = flags.seq;
    if (seqId) {
      const off = events.on('game:mode', ({ mode }) => {
        if (mode !== 'playing') return;
        off();
        setTimeout(() => runSequence(seqId), 1200);
      });
    }
    if (level) {
      const overlay = new LevelOverlay(level);
      scene.add(overlay.group);
      const lf = gui.addFolder('Level');
      for (const layer of OVERLAY_LAYERS) lf.add(overlay.visible, layer).name(layer).onChange((on: boolean) => overlay.set(layer, on));
      lf.add({ unlockAll: () => level.unlock('D2', 'script') }, 'unlockAll').name('unlock D2');
      levelStats = { drawCalls: 0, pool: 0 };
      lf.add(levelStats, 'drawCalls').name('visible draw calls').listen().disable();
      lf.add(levelStats, 'pool').name('pooled lights bound').listen().disable();
    }
    gui.close();
  }

  // "Click to look around" only matters while playing without the mouse captured.
  const updatePrompt = (): void => {
    prompt.textContent = 'Click to continue · WASD move · Shift sprint · RMB aim · F flashlight · E use · V shove · Esc pause';
    prompt.hidden = !(game.mode === 'playing' && !input.locked);
  };
  events.on('input:pointerLock', updatePrompt);
  events.on('game:mode', updatePrompt);
  canvas.addEventListener('click', () => {
    if (game.mode === 'playing') input.requestLock();
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    post.setSize(innerWidth, innerHeight, renderer.getPixelRatio());
  });

  let simTime = 0;
  const loop = new Loop({
    update: (dt) => {
      simTime += dt;
      game.update(dt);
      if (game.mode === 'playing' && !game.flying) sequences?.update(dt);
      input.endStep();
    },
    render: (_alpha, frameDt) => {
      debug?.beginFrame();
      game.render(frameDt);
      viewmodel.update(frameDt);
      flashlight.update(frameDt);
      world.update(simTime, frameDt, camera.position, settings.get().reducedFlashing);
      if (level && levelStats) {
        levelStats.drawCalls = level.visibleDrawCalls();
        levelStats.pool = level.pool.boundCount();
      }
      audio.updateListener(camera);
      roomAudio?.update(simTime);
      post.grade.uDamage.value = game.mode === 'title' || game.flying ? 0 : player.damageFx;
      post.render(simTime);
      debug?.endFrame();
    },
  });

  sequences = new SequenceManager(
    createGameHost({
      events,
      game,
      player,
      world,
      level,
      audio,
      hud,
      toasts,
      anchors: room ? { door: room.anchors.door, window: room.anchors.window, vent: room.anchors.vent, console: room.anchors.console, abyss: room.anchors.abyss } : undefined,
      setTimeScale: (scale) => {
        loop.clock.scale = scale;
      },
    }),
    loadSequences(),
  );
  // Back to the title or a fresh game: nothing from the last session keeps running.
  events.on('game:mode', ({ mode }) => {
    if (mode === 'title') sequences?.cancelAll();
  });
  if (flags.enabled) {
    const overlay = new SequenceOverlay(sequences);
    events.on('game:mode', () => overlay.update());
    const tickOverlay = (): void => {
      overlay.update();
      requestAnimationFrame(tickOverlay);
    };
    tickOverlay();
  }

  game.showTitle();
  updatePrompt();
  events.emit('game:booted', { at: performance.now() });
  loop.start();
}

boot().catch(showBootError);
