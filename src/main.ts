import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import './ui/styles/base.css';
import './ui/styles/menu.css';
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
import { buildDemoRoom } from './world/demoRoom.ts';
import { DemoRoomAudio } from './world/demoRoomAudio.ts';
import { AudioEngine } from './audio/engine.ts';
import { Game } from './game/game.ts';
import { SaveStore } from './game/save.ts';
import { createMenus } from './ui/menus/screens.ts';
import { Toasts } from './ui/toast.ts';

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
  const room = buildDemoRoom(materials, new Rng('demo-room'));
  scene.add(room.group);
  console.info(`[boot] textures + room built in ${(performance.now() - t0).toFixed(0)} ms`);

  // Audio starts suspended; the first click anywhere resumes it (browser rule).
  const audio = new AudioEngine();
  console.info(`[boot] sounds rendered in ${audio.renderSounds().toFixed(0)} ms`);
  const roomAudio = new DemoRoomAudio(audio, room, new Rng('room-audio'));
  roomAudio.start();
  addEventListener('pointerdown', () => void audio.resume(), { capture: true });
  addEventListener('keydown', () => void audio.resume(), { capture: true });

  camera.position.copy(room.spawn.position);
  const input = new Input(canvas, keymap, events);
  const freeCam = new FreeCamera(camera, input, () => settings.get());
  freeCam.yaw = room.spawn.yaw;
  freeCam.speed = 2.5;
  freeCam.bounds = room.bounds;

  const flashlight = new Flashlight(scene, camera);
  const post = createPost(renderer, scene, camera, settings.get().quality);
  renderer.compile(scene, camera);

  const toasts = new Toasts(document.body);
  const game = new Game({
    events,
    settings,
    saves,
    difficulties,
    input,
    camera,
    freeCam,
    flashlight,
    room,
    audio,
    toasts,
    interactPrompt: el<HTMLElement>('#interact'),
  });
  createMenus(el<HTMLElement>('#menu'), { game, saves, settings, difficulties, events });
  events.on('game:flashlight', () => roomAudio.flashlightClick());

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
    for (const item of room.lights.items) {
      const f = lightsFolder.addFolder(item.name);
      f.add(item, 'pattern', [...LIGHT_PATTERNS]);
      f.add(item, 'base', 0, 100, 0.5).name('intensity');
      f.close();
    }
    const sound = gui.addFolder('Audio mix');
    sound.add(audio.buses.ambience.gain, 'value', 0, 2, 0.01).name('ambience');
    sound.add(audio.buses.sfx.gain, 'value', 0, 2, 0.01).name('footsteps / sfx');
    gui.addFolder('Camera').add(freeCam, 'speed', 1, 20, 0.5);
    gui.close();
  }

  // "Click to look around" only matters while playing without the mouse captured.
  const updatePrompt = (): void => {
    prompt.textContent = 'Click to continue · WASD move · F flashlight · E use · Esc pause';
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
      input.endStep();
    },
    render: (_alpha, frameDt) => {
      debug?.beginFrame();
      game.render(frameDt);
      flashlight.update(frameDt);
      room.update(simTime, frameDt, camera.position, settings.get().reducedFlashing);
      audio.updateListener(camera);
      roomAudio.update(simTime, camera, game.mode === 'playing');
      post.render(simTime);
      debug?.endFrame();
    },
  });

  game.showTitle();
  updatePrompt();
  events.emit('game:booted', { at: performance.now() });
  loop.start();
}

boot().catch(showBootError);
