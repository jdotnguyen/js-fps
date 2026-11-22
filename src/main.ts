import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import './ui/styles/base.css';
import './ui/styles/menu.css';
import './ui/styles/hud.css';
import './ui/styles/tutorial.css';
import './ui/styles/map.css';
import keymapJson from './data/keymap.json';
import difficultyJson from './data/difficulty.json';
import { validateKeymap } from './data/types/keymap.ts';
import { validateDifficultyTable } from './data/types/difficulty.ts';
import { validateKillTable } from './data/types/kills.ts';
import killsJson from './data/kills.json';
import { createDebugTools, readDebugFlags, type DebugTools } from './core/debug.ts';
import { EventBus } from './core/events.ts';
import { FreeCamera } from './core/freeCamera.ts';
import { Input } from './core/input.ts';
import { Loop } from './core/loop.ts';
import { Rng } from './core/rng.ts';
import { SettingsStore, type Settings } from './core/settings.ts';
import { isScratchSession, persistentStore } from './core/storage.ts';
import { validate } from './core/validate.ts';
import type { SoundName } from './audio/sounds.ts';
import { applyQuality, createRenderer } from './render/renderer.ts';
import { createMaterialsAsync } from './render/materials.ts';
import { createPost } from './render/post.ts';
import { anisotropyFor, clampTier, materialTextureUnits, RENDER_TIERS, type GpuLimits, type RenderTier } from './render/tiers.ts';
import { currentAnisotropy, setAnisotropy } from './render/anisotropy.ts';
import { setCharacterShadowDistance } from './actors/humanoid.ts';
import { Flashlight } from './render/flashlight.ts';
import { LIGHT_PATTERNS } from './render/lights.ts';
import { CameraFeeds } from './render/cameraFeed.ts';
import { createFeedGl } from './render/cameraFeedGl.ts';
import { preloadSeabed } from './render/fx/seabed.ts';
import { preloadSubModel } from './render/fx/subModel.ts';
import type { DemoRoom } from './world/demoRoom.ts';
import type { Level } from './world/level.ts';
import type { LightBudget, World } from './world/world.ts';
import type { DemoRoomAudio } from './world/demoRoomAudio.ts';
import { AMBIENCE_PRESETS, AmbienceDirector } from './audio/ambience.ts';
import { DoorAudio } from './audio/doorAudio.ts';
import { AudioEngine } from './audio/engine.ts';
import { FootstepAudio } from './audio/footsteps.ts';
import { MenuMusic } from './audio/menuMusic.ts';
import { wallOccluder } from './audio/occlusion.ts';
import { loadPhysics } from './physics/load.ts';
import { anyPhysics, resolvePhysicsSwitches } from './physics/switches.ts';
import { PhysicsWorld } from './physics/world.ts';
import { physicsDebris, type PhysicsDebrisBackend } from './physics/debris.ts';
import { PhysicsProps, PlayerPusher } from './physics/interaction.ts';
import { DEFAULT_MOTOR } from './actors/motor.ts';
import { stomp, stompPoint } from './actors/stomp.ts';
import { ScorePlayer, type RenderedScore } from './audio/scorePlayer.ts';
import { engineScoreAudio } from './audio/scoreAudio.ts';
import type { ScoreWorkerReply } from './audio/scoreWorker.ts';
import { validateScoreTable } from './data/types/scores.ts';
import scoresJson from './data/scores.json';
import type { FootstepEvent } from './actors/humanoid.ts';
import { CollisionWorld } from './world/collision.ts';
import { Game } from './game/game.ts';
import { CutsceneController } from './game/cutscene.ts';
import { CutsceneUi } from './ui/hud/cutsceneUi.ts';
import { TitleCard } from './ui/titleCard.ts';
import { Interactions } from './actors/interaction.ts';
import { Player, PLAYER_TUNING } from './actors/player.ts';
import { createGameHost } from './script/gameHost.ts';
import { loadSequences } from './script/load.ts';
import { SequenceManager } from './script/runtime.ts';
import { PlayerHud, keyLabel } from './ui/hud/playerHud.ts';
import { SaveStore } from './game/save.ts';
import { createMenus } from './ui/menus/screens.ts';
import type { EndCredits } from './ui/credits.ts';
import { sharedMocapLibrary } from './actors/mocap.ts';
import { loadMocapPacks } from './actors/mocapPacks.ts';
import { sharedMotionProfiles } from './actors/motionProfiles.ts';
import { motionScene } from './actors/motionScene.ts';
import { readDetailFlag } from './actors/detailPass.ts';
import { startSplash } from './ui/splash.ts';
import { Toasts } from './ui/toast.ts';
import { TutorialPrompts } from './ui/tutorialPrompts.ts';
import { TutorialProfile } from './ui/tutorials.ts';
import { loadWeaponModels } from './render/viewmodel/glbWeapons.ts';
import { Viewmodel } from './render/viewmodel/viewmodel.ts';
import { Squad } from './ai/squad.ts';
import { REVIVE_TASK } from './ai/squadBrain.ts';
import { NpcDirector } from './ai/npcs.ts';
import { cameraForwardXZ } from './ai/ambientLife.ts';
import { npcIdForSpeaker, wireSpeechActing } from './ai/speakerBodies.ts';
import { wireSquadToEnemies } from './ai/squadEnemies.ts';
import { setupEnemies, spawnPointsOf } from './ai/enemyGame.ts';
import type { SpawnPointData } from './ai/spawner.ts';
import { GoreSystem } from './actors/gore.ts';
import { PoseLibrary } from './actors/poses.ts';
import { loadPoseFile } from './data/types/poses.ts';
import posesJson from './data/poses.json';
import bodyModelsJson from './data/body-models.json';
import { BodyModelLibrary, validateBodyModelTable } from './actors/bodyModelLibrary.ts';
import itemsJson from './data/items.json';
import uiTextJson from './data/dialogue/ui.json';
import { validateItemTable } from './data/types/items.ts';
import { validateUiText } from './data/types/uiText.ts';
import { Inventory } from './game/inventory.ts';
// ADR-0024 map + objectives, speech, barks and hints, ADR-0005/0008 supplies.
import objectivesJson from './data/objectives.json';
import { objectivesValidator } from './data/types/objectives.ts';
import type { MapModel, MapState } from './ui/mapModel.ts';
import { Guidance } from './game/guidance.ts';
import { loadDialogueLibrary } from './dialogue/load.ts';
import { SpeechManager, type SayOptions } from './dialogue/speech.ts';
import type { ScriptSpeechOptions } from './script/host.ts';
import { WebAudioVoicePlayer } from './dialogue/voicePlayer.ts';
import { StoryDucker } from './audio/storyDuck.ts';
import { Subtitles } from './ui/hud/subtitles.ts';

/** The level New game plays (ADR-0014). */
const DEFAULT_LEVEL = 'slice01';
const LEVEL_FILES = import.meta.glob<unknown>('./data/levels/*.json', { import: 'default' });
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
  // Physics feature switches for this session (adopt-physics-engine D9): the setting, or a `?physics=` override.
  const physics = resolvePhysicsSwitches(settings.get().physics, location.search);
  if (physics.unknown.length) console.warn(`[physics] unknown features in ?physics=: ${physics.unknown.join(', ')}`);
  const flags = readDebugFlags(location.search);
  readDetailFlag(location.search);
  // All data goes through validators so bad JSON fails here with a readable path.
  const keymap = validate(validateKeymap, keymapJson, 'data/keymap.json');
  const difficulties = validate(validateDifficultyTable, difficultyJson, 'data/difficulty.json');
  // `?slot=scratch` (memory runs, spec runtime-memory): saves and tutorial progress stay in memory, never in localStorage.
  const scratch = isScratchSession(location.search);
  const saves = new SaveStore(persistentStore(scratch));
  if (scratch) {
    const badge = document.createElement('div');
    badge.textContent = 'SCRATCH SESSION · SAVES NOT KEPT';
    badge.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:30;font:11px monospace;letter-spacing:.08em;color:#9fd;opacity:.7;pointer-events:none;';
    document.body.appendChild(badge);
    console.info('[save] scratch session: saves and tutorial progress stay in memory');
  }
  // Key items and access hint text (ADR-0024).
  const itemTable = validate(validateItemTable, itemsJson, 'data/items.json');
  const uiText = validate(validateUiText, uiTextJson, 'data/dialogue/ui.json');
  const inventory = new Inventory(itemTable, events);

  prompt.textContent = 'Generating textures…';
  prompt.hidden = false;
  await nextFrame();
  await nextFrame();

  // `?memprobe` (memory runs, spec runtime-memory): count WebGL objects and uploads from the first context on.
  const memProbe = new URLSearchParams(location.search).has('memprobe') ? (await import('./core/memProbe.ts')).installMemProbe() : null;
  const renderer = createRenderer(canvas, settings.get());
  // GPU limits and the active tier fitted to them (render-quality spec). Material samplers are
  // measured from the kit materials once they exist, then from the loaded world.
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
  const gpu: GpuLimits = { maxTextures: renderer.capabilities.maxTextures, maxFragmentUniforms: renderer.capabilities.maxFragmentUniforms, materialUnits: 0 };
  const tierWarnings = new Set<string>();
  const activeTier = (quality: Settings['quality']): RenderTier => {
    const { tier, warnings } = clampTier(RENDER_TIERS[quality], gpu);
    for (const w of warnings) if (!tierWarnings.has(w)) {
      tierWarnings.add(w);
      console.warn(`[render] ${quality}: ${w}`);
    }
    return tier;
  };
  const lightBudgetOf = (t: RenderTier): LightBudget => ({ fillLights: t.fillLights, shadowLights: t.shadowLights, shadowMapSize: t.shadowMapSize });
  const measureMaterialUnits = (mats: Iterable<THREE.Material>): void => {
    for (const m of mats) gpu.materialUnits = Math.max(gpu.materialUnits, materialTextureUnits(m, scene.environment !== null));
  };
  setAnisotropy(anisotropyFor(RENDER_TIERS[settings.get().quality], maxAnisotropy));
  if (new URLSearchParams(location.search).has('vmlab')) {
    prompt.hidden = true;
    document.querySelector<HTMLElement>('#ui')?.setAttribute('hidden', '');
    document.querySelector<HTMLElement>('#menu')?.setAttribute('hidden', '');
    const { runLab } = await import('./render/viewmodel/lab.ts');
    await runLab(renderer);
    return;
  }
  // Start audio and menu theme rendering immediately so "Pressure" builds in parallel with
  // texture/level loading and plays before the splash screens begin.
  const audio = new AudioEngine();
  console.info(`[boot] sounds rendered in ${audio.renderSounds().toFixed(0)} ms`);
  void audio.loadSamples();
  splash.attachAudio(audio);
  const menuMusic = new MenuMusic(audio, 'title');
  menuMusic.start();
  splash.attachMusicReady(menuMusic.ready);
  // Adaptive scores (adaptive-music spec): rendered in a worker when first loaded or cued, on the music bus.
  const renderScore = (id: string): Promise<RenderedScore> =>
    new Promise((resolve, reject) => {
      const t0 = performance.now();
      const worker = new Worker(new URL('./audio/scoreWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<ScoreWorkerReply>): void => {
        worker.terminate();
        if ('error' in e.data) return reject(new Error(e.data.error));
        console.info(`[audio] score ${id} rendered in ${(performance.now() - t0).toFixed(0)} ms`);
        resolve(e.data.score);
      };
      worker.onerror = (e): void => {
        worker.terminate();
        reject(new Error(e.message));
      };
      worker.postMessage({ id });
    });
  const score = new ScorePlayer(engineScoreAudio(audio), validate(validateScoreTable, scoresJson, 'data/scores.json'), renderScore);
  addEventListener('pointerdown', () => void audio.resume(), { capture: true });
  addEventListener('keydown', () => void audio.resume(), { capture: true });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(FOG_COLOR);
  scene.fog = new THREE.FogExp2(FOG_COLOR, 0.05);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.12;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(settings.get().fov, innerWidth / innerHeight, 0.05, 120);

  const t0 = performance.now();
  const texSize = settings.get().quality === 'low' ? 256 : TEXTURE_SIZE;
  // The game is the slice (ADR-0014): no ?level loads slice01 and New game plays the intro (intro-sequence spec).
  // ?level=<id> loads another data-driven kit level (ADR-0003, e.g. kit_test); ?level=demo is the hand-built demo room; ?level=lab is the imported underground-laboratory sandbox; ?level=corner is the texture-tiling corner test.
  const levelParam = new URLSearchParams(location.search).get('level');
  const levelId = levelParam === 'demo' || levelParam === 'lab' || levelParam === 'corner' ? null : (levelParam ?? DEFAULT_LEVEL);
  let room: DemoRoom | null = null;
  let level: Level | null = null;
  let levelSpawns: SpawnPointData[] = [];
  let world: World;
  const [materials] = await Promise.all([
    createMaterialsAsync(texSize, currentAnisotropy()),
    preloadSeabed(import.meta.env.BASE_URL),
    preloadSubModel(import.meta.env.BASE_URL),
  ]);
  measureMaterialUnits(Object.values(materials).filter((m): m is THREE.Material => m instanceof THREE.Material));
  let mapModel: MapModel | null = null;
  let mapState: MapState | null = null;
  if (levelId) {
    const file = Object.entries(LEVEL_FILES).find(([path]) => path.endsWith(`/${levelId}.json`));
    if (!file) throw new Error(`No level '${levelId}'. Known: ${Object.keys(LEVEL_FILES).map((f) => f.replace(/^.*\/|\.json$/g, '')).join(', ')}`);
    // The physics engine downloads alongside the level when any feature is on; nothing waits for it (D10).
    void loadPhysics(physics.switches);
    const [
      levelJson,
      { loadLevel },
      { KitRegistry, validateKitManifest },
      { levelValidator },
      { default: kitManifestJson },
      { buildMapModel, MapState },
    ] = await Promise.all([
      file[1](),
      import('./world/level.ts'),
      import('./world/registry.ts'),
      import('./data/types/level.ts'),
      import('./data/kit-manifest.json'),
      import('./ui/mapModel.ts'),
      // Navmesh WASM (ADR-0028): kit levels path on a Recast navmesh.
      import('./ai/navmesh.ts').then((m) => m.initNavmesh()),
    ]);
    const registry = new KitRegistry(validate(validateKitManifest, kitManifestJson, 'data/kit-manifest.json'), undefined);
    const refs = { items: new Set(Object.keys(itemTable)), uiText: new Set(Object.keys(uiText)) };
    const data = validate(levelValidator(registry.ids(), refs), levelJson, `data/levels/${levelId}.json`);
    const debugChecker = new URLSearchParams(location.search).has('checker');
    level = await loadLevel(data, { materials, registry, events, scene, inventory, uiText, debugChecker, lightBudget: lightBudgetOf(activeTier(settings.get().quality)) });
    levelSpawns = spawnPointsOf(data);
    world = level;
    mapModel = buildMapModel(level.source);
    mapState = new MapState(mapModel);
    console.info(`[boot] level '${levelId}' built in ${(performance.now() - t0).toFixed(0)} ms`);
    console.table(level.roomStats());
  } else if (levelParam === 'lab') {
    // Sandbox: the imported underground-laboratory model with baked box collision (src/world/labWorld.ts).
    const { loadLabWorld } = await import('./world/labWorld.ts');
    world = await loadLabWorld(import.meta.env.BASE_URL, scene, materials, activeTier(settings.get().quality).fillLights);
    console.info(`[boot] lab map loaded in ${(performance.now() - t0).toFixed(0)} ms`);
  } else if (levelParam === 'corner') {
    // Sandbox: L-shaped corner for checking texture tiling (src/world/cornerTest.ts; ?uv=world|repeat|local).
    const { loadCornerWorld } = await import('./world/cornerTest.ts');
    world = await loadCornerWorld(scene, materials, new URLSearchParams(location.search));
    console.info(`[boot] corner test built in ${(performance.now() - t0).toFixed(0)} ms`);
  } else {
    const [{ buildDemoRoom }, { demoRoomWorld }] = await Promise.all([
      import('./world/demoRoom.ts'),
      import('./world/demoWorld.ts'),
    ]);
    room = buildDemoRoom(materials, new Rng('demo-room'));
    world = demoRoomWorld(room);
    console.info(`[boot] textures + room built in ${(performance.now() - t0).toFixed(0)} ms`);
  }
  scene.add(world.group);
  // Imported models can bind more samplers than the kit; refit the shadow pool if they do.
  const worldMaterials = new Set<THREE.Material>();
  world.group.traverse((o) => {
    if (o instanceof THREE.Mesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) worldMaterials.add(m);
  });
  measureMaterialUnits(worldMaterials);
  renderer.shadowMap.autoUpdate = false; // the render loop asks for one shadow pass per frame

  let roomAudio: DemoRoomAudio | null = null;
  let ambience: AmbienceDirector | null = null;
  if (room) {
    const { DemoRoomAudio } = await import('./world/demoRoomAudio.ts');
    roomAudio = new DemoRoomAudio(audio, room, new Rng('room-audio'));
    roomAudio.start();
  } else {
    ambience = new AmbienceDirector(audio, new Rng('level-ambience'));
    if (!level) ambience.enterRoom('hull_hum');
  }

  camera.position.copy(world.spawn.position);
  const input = new Input(canvas, keymap, events);
  const freeCam = new FreeCamera(camera, input, () => settings.get());
  freeCam.yaw = world.spawn.yaw;
  freeCam.speed = 2.5;
  freeCam.bounds = world.bounds;

  // Security camera feeds (ADR-0023): `cameraFeed` actions draw the world from a camera onto `feed:<id>` screens.
  const feedGl = createFeedGl({ renderer, scene, view: level ? (eye, draw) => level.renderFromEye(eye, draw) : null });
  const cameraFeeds = new CameraFeeds({ root: world.group, draw: feedGl });
  events.on('level:reset', () => cameraFeeds.reset());

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

  const toasts = new Toasts(document.body);
  const hud = new PlayerHud(el<HTMLElement>('#ui'), el<HTMLElement>('#interact'), keymap.interact[0] ?? 'KeyE');
  // ADR-0009 sequences (also run the skippable cutscenes, openspec/specs/intro-sequence). Created once the loop
  // exists, because the loop owns the time scale; the cutscene chrome looks it up on use.
  let sequences: SequenceManager | null = null;
  const cutscene = new CutsceneController({
    sequences: () => sequences,
    input,
    settings,
    player,
    hud,
    ui: new CutsceneUi(el<HTMLElement>('#ui')),
    skipKeyLabel: () => keyLabel(keymap.skipCutscene[0] ?? 'Space'),
    // The opening needs the dock and kitchen anchors (intro-sequence spec); other levels start in control.
    hasIntro: () => level?.anchor('post_front') != null,
  });
  // Map knowledge (ADR-0024): outlines from the level data, saved with the game.
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
    inventory,
    map: mapState,
  });
  currentPreset = () => game.preset;
  // Tutorial pop-ups (ADR-0025): pause the simulation while one is open (see the loop).
  let setWayfindingSpotlight: ((on: boolean) => void) | null = null;
  const tutorials = new TutorialPrompts({
    parent: el<HTMLElement>('#ui'),
    events,
    settings,
    input,
    profile: new TutorialProfile(persistentStore(scratch)),
    bindings: (a) => keymap[a],
    mode: () => game.mode,
    playTime: () => game.playTime,
    onRails: () => player.onRails || (sequences?.skippable ?? false),
    sequenceRunning: (id) => sequences?.isRunning(id) ?? false,
    flashlightOn: () => flashlight.on,
    focusId: () => interactions.focus?.target.id ?? null,
    onSpotlight: (on) => setWayfindingSpotlight?.(on),
  });

  // Squad (ADR-0011): Giles and Okafor follow Jay through the shared navgraph (ADR-0007).
  prompt.textContent = 'Building the squad…';
  await nextFrame();
  const t1 = performance.now();
  const gore = new GoreSystem(new Rng('game-gore'));
  scene.add(gore.group);
  // Imported crowd bodies (ADR-0026): `?bodyModels=all` makes every eligible spawn use one, `off` none.
  const bodyModels = new BodyModelLibrary(validate(validateBodyModelTable, bodyModelsJson, 'data/body-models.json'));
  const bodyModelsParam = new URLSearchParams(location.search).get('bodyModels');
  if (bodyModelsParam === 'all') bodyModels.forceShare = 1;
  if (bodyModelsParam === 'off') bodyModels.forceShare = 0;
  // Each named character's own clips (per-character-motion) load with the bodies, as their own chunks.
  await Promise.all([bodyModels.load(import.meta.env.BASE_URL), loadMocapPacks(sharedMocapLibrary(), Object.keys(sharedMotionProfiles().profiles))]);
  const collisionWorld = world.playerWorld.colliders instanceof CollisionWorld ? world.playerWorld.colliders : null;
  // adopt-physics-engine Block 1: one physics world mirroring the level's collision, once the engine has loaded.
  // Until then (or with every switch off, or if it fails) it stays null and every feature uses its fallback.
  let physicsWorld: PhysicsWorld | null = null;
  if (collisionWorld && anyPhysics(physics.switches)) {
    void loadPhysics(physics.switches).then(async (factory) => {
      if (!factory) return;
      physicsWorld = await PhysicsWorld.create(factory, collisionWorld);
      console.info(`[physics] ${physicsWorld.engine.name}: ${physicsWorld.staticCount} level colliders mirrored`);
      // Block 2: severed pieces become rigid bodies from now on (pieces already flying keep the floor model).
      const debris = physics.switches.debris ? physicsDebris(physicsWorld) : null;
      if (debris) gore.setDebrisBackend(debris);
      // Block 5: the player shoves loose bodies, and props the level marks dynamic move.
      if (physics.switches.interact) {
        pusher = new PlayerPusher(physicsWorld, DEFAULT_MOTOR.radius);
        if (level) physicsProps = new PhysicsProps(physicsWorld, level);
        wakeDebris = debris;
      }
    });
  }
  let pusher: PlayerPusher | null = null;
  let physicsProps: PhysicsProps | null = null;
  let wakeDebris: PhysicsDebrisBackend | null = null;
  /** One physics step: the pusher follows the player first, props take their new poses after (design D8, D11). */
  const stepPhysics = (dt: number): void => {
    if (!physicsWorld) return;
    if (pusher) {
      wakeDebris?.wakeNear(player.body, DEFAULT_MOTOR.radius + 0.8);
      pusher.update(player.body);
    }
    physicsWorld.step(dt);
    physicsProps?.sync();
  };
  // Restarts (new game, loads, death) rebuild the world empty, so nothing from the last attempt survives.
  const resetPhysics = (): void => void physicsWorld?.reset();
  events.on('level:reset', resetPhysics);
  events.on('game:restarted', resetPhysics);
  // One wall test for footsteps and every other positional sound (in-world-audio: World sound occlusion).
  const occluder = collisionWorld ? wallOccluder((...ray) => collisionWorld.raycast(...ray)) : null;
  const footsteps = new FootstepAudio({
    audio,
    rng: new Rng('footsteps'),
    listener: () => camera.position,
    surfaceAt: (x, y, z) => (collisionWorld ? collisionWorld.surfaceAt(x, y, z) : world.playerWorld.surfaceAt(x, z)),
    ...(occluder ? { isOccluded: occluder } : {}),
  });
  // The title screen muffles nothing; play uses the level's walls.
  audio.setOccluder(game.mode === 'title' ? null : occluder);
  events.on('game:mode', ({ mode }) => audio.setOccluder(mode === 'title' ? null : occluder));
  const onCharacterFootstep = (step: FootstepEvent): void => {
    if (game.mode === 'playing' && !game.flying) footsteps.playCharacter(step);
  };
  const squad = new Squad({
    ctx: { poses: new PoseLibrary(loadPoseFile(posesJson)), gore, bodyModels, colliders: world.playerWorld.colliders, onFootstep: onCharacterFootstep },
    nav: world.navGraph(),
    player,
    difficulty: () => game.preset,
    // squad:* events (reloading, downed, revived, taskProgress, noSafetyNet...) for barks and the HUD.
    emit: (name, payload) => events.emit(name, payload as never),
    flags: () => game.flags,
    // ADR-0011: Jay down while the medic is down: nobody can revive him.
    gameOver: () => player.damage(1e6),
  });
  scene.add(squad.group);
  squad.group.visible = false;
  // Scene variants (per-character-motion): what is running, who is on which task, Giles's stage, story flags.
  motionScene.flags = () => game.flags;
  const SQUAD_PROFILE: Record<string, string> = { engineer: 'giles', medic: 'okafor' };
  events.on('sequence:started', ({ id }) => motionScene.startSequence(id));
  events.on('sequence:ended', ({ id }) => motionScene.endSequence(id));
  events.on('squad:taskStarted', ({ id, task }) => SQUAD_PROFILE[id] && motionScene.setTask(SQUAD_PROFILE[id], task));
  events.on('squad:taskDone', ({ id, task }) => {
    const profile = SQUAD_PROFILE[id];
    if (!profile) return;
    // A revive interrupts a panel job (revive > task): when it ends, the motion goes back to the job he still has.
    const job = task === REVIVE_TASK ? squad.mate(id).task : null;
    motionScene.setTask(profile, job && !job.done ? job.kind : null);
  });
  events.on('squad:infectionStage', ({ stage }) => motionScene.setStage(stage));
  console.info(`[boot] squad built in ${(performance.now() - t1).toFixed(0)} ms`);
  events.on('game:mode', ({ mode }) => {
    squad.group.visible = mode !== 'title';
  });
  // Enemies (ADR-0007): level spawns, player hits, noise; `?enemies=shambler:2,hero` for a quick fight.
  const enemies = setupEnemies({ events, ctx: { poses: new PoseLibrary(loadPoseFile(posesJson)), gore, bodyModels, colliders: world.playerWorld.colliders, onFootstep: onCharacterFootstep }, world, player, camera, flashlightOn: () => flashlight.on, game, audio, spawns: levelSpawns, squad, search: location.search });
  // Player stomp (adopt-physics-engine Block 5): damages the part under the boot and shoves loose bodies there.
  player.stompEnabled = physics.switches.interact;
  const stompAt = new THREE.Vector3();
  const stompDir = new THREE.Vector3();
  events.on('player:stomp', (e) => {
    stompAt.set(...e.at);
    stompPoint(stompAt, { x: e.dir[0], z: e.dir[2] }, stompAt);
    stomp(stompAt, stompDir.set(...e.dir), {
      bodies: () => enemies.director.list.map((en) => en.body),
      sound: (name, at, gain, rate) => void audio.play(name, { bus: 'sfx', gain, rate, position: at.clone(), reverb: 0.25 }),
      shove: (at, half, impulse) => {
        const w = physicsWorld;
        if (!w || !physics.switches.interact) return;
        for (const b of w.engine.overlappingBodies({ x: at.x, y: at.y + half, z: at.z }, { x: half, y: half, z: half })) w.engine.applyImpulse(b, impulse);
      },
    });
  });
  scene.add(enemies.director.group);
  wireSquadToEnemies(squad, enemies.director, events);
  // Enemies and squadmates open unlocked auto doors as they walk up (level.setActors).
  // (NPCs join below, once the NpcDirector exists.)
  // Scripted NPCs and the cast (ADR-0009/0023, intro-sequence spec): sequences drive them and borrow the squad.
  const npcFeet = new THREE.Vector3();
  const npcHead = new THREE.Vector3();
  const npcs = new NpcDirector({
    ctx: { poses: new PoseLibrary(loadPoseFile(posesJson)), gore, bodyModels, colliders: world.playerWorld.colliders, onFootstep: onCharacterFootstep },
    nav: world.navGraph(),
    colliders: world.playerWorld.colliders,
    squad,
    player: () => ({ feet: npcFeet.set(player.body.x, player.body.y, player.body.z), head: player.eyePosition(npcHead), wish: player.wish }),
    interact: (item) => interactions.add(item),
    emit: (name, payload) => events.emit(name as never, payload as never),
    sequenceRunning: () => (sequences?.running().length ?? 0) > 0,
    walk: (id) => level?.walk(id) ?? null,
    setPropTransform: (id, pos, yaw) => level?.setPropTransform(id, pos, yaw) ?? false,
    setPropVisible: (id, visible) => level?.setPropVisible(id, visible) ?? false,
    propState: (id) => level?.propState(id) ?? null,
    kills: validate(validateKillTable, killsJson, 'data/kills.json'),
    listen: (name, fn) => events.on(name as never, fn as never),
    sfx: (ids, at) => {
      // The first sound that exists: a recording still to be generated, then its existing stand-in (infection-kills spec).
      const id = ids.find((n) => audio.hasSound(n as SoundName));
      if (!id) return false;
      // Kill sounds play as authored, e.g. through Lab B's glass (in-world-audio: World sound occlusion).
      audio.play(id as SoundName, { position: new THREE.Vector3(at.x, at.y, at.z), occlude: false });
      return true;
    },
  });
  scene.add(npcs.group, npcs.fx);
  // Scripted walks path round corners, and everyone (cast, spawned NPCs, squad) is solid to Jay.
  player.setNav(world.navGraph());
  player.setBodies(() => npcs.solidBodies());
  if (level) {
    npcs.spawnFromLevel(level.npcSpawns());
    npcs.enableAmbientLife(level.spots());
  }
  // Enemies, squadmates and scripted NPCs (the intro crew) open unlocked auto doors as they walk up.
  level?.setActors(function* () {
    for (const e of enemies.director.list) if (e.alive && e.state !== 'dormant' && e.state !== 'playDead') yield e.position;
    for (const m of squad.mates) yield m.position;
    for (const id of npcs.ids()) {
      if (npcs.isSquad(id)) continue;
      const a = npcs.actor(id, false);
      if (a) yield a.position;
    }
  });
  npcs.group.visible = false;
  events.on('game:mode', ({ mode }) => {
    npcs.group.visible = mode !== 'title';
    if (mode === 'title') npcs.reset();
  });
  events.on('game:restarted', () => {
    npcs.reset();
    // checkpoint-restore spec: every load and restart puts the squad beside Jay on the next update.
    squad.requestPlacement();
  });
  prompt.textContent = 'Loading weapons…';
  await nextFrame();
  const weaponModels = await loadWeaponModels();
  const viewmodel = new Viewmodel({
    scene,
    camera,
    input,
    player,
    events,
    models: weaponModels,
    enabled: () => game.mode === 'playing' && !game.flying && player.alive && player.control.state.weapons && !tutorials.blocking,
    visible: () => game.mode !== 'title' && !game.flying,
    reducedMotion: () => settings.get().reducedMotion,
    // ADR-0005: on a level with a shotgun pickup Jay starts with the pistol only (flag `weapon:shotgun`).
    owns: (id) => id === 'pistol' || !(level?.source.pickups ?? []).some((p) => p.kind === 'weapon_shotgun') || game.flags['weapon:shotgun'] === true,
  });
  hud.setAmmoSource(() => {
    const id = viewmodel.weapon;
    return { name: id, ...viewmodel.ammoOf(id), mag: viewmodel.magSize(id) };
  });
  renderer.compile(scene, camera);
  // Speech: one voice at a time with subtitles; lines unknown to the library are skipped.
  const dialogue = loadDialogueLibrary();
  // Dialogue plays on the engine's voice bus (audio-mix: Mix buses), keeping the room reverb send.
  const voicePlayer = new WebAudioVoicePlayer({ ctx: audio.ctx, master: audio.buses.voice, reverbIn: audio.voiceReverbIn });
  memProbe?.attach({ threeInfo: () => renderer.info.memory, audioBytes: () => audio.decodedBytes() + voicePlayer.decodedBytes() });
  void voicePlayer.loadLines(dialogue.allLines()).then((n) => {
    if (n > 0) console.info(`[boot] loaded ${n} VO clips`);
  });
  const speech = new SpeechManager(events, dialogue, voicePlayer);
  const speakerHead = new THREE.Vector3();
  /** A speaker's head, for a speaker with a body on this level (voice-playback: local lines play from the speaker's head). */
  const speakerHeadAt = (speaker: string): { x: number; y: number; z: number } | null => {
    const id = npcIdForSpeaker(speaker);
    const body = id && npcs.has(id) ? npcs.actor(id, false)?.body : null;
    if (!body) return null;
    const h = body.jointWorld('head', speakerHead);
    return { x: h.x, y: h.y, z: h.z };
  };
  squad.setSpeech(speech);
  // ADR-0027: whoever says a line acts it: mouth on the subtitle's syllables, hands and body on the emote.
  wireSpeechActing(events, (speaker) => {
    const id = npcIdForSpeaker(speaker);
    return id && npcs.has(id) ? (npcs.actor(id, false)?.body ?? null) : null;
  });
  // ADR-0029 listen-look: people near a speaker turn their heads to them; the speaker looks at whoever they answer.
  const talkerId = (speaker: string): string | null => (speaker === 'player' ? 'player' : npcIdForSpeaker(speaker));
  events.on('speech:started', (info) => {
    const id = talkerId(info.speaker);
    if (id && (id === 'player' || npcs.has(id))) npcs.lineStarted(id);
  });
  events.on('speech:ended', (e) => {
    const id = talkerId(e.speaker);
    if (id) npcs.lineEnded(id);
  });
  new Subtitles(el<HTMLElement>('#ui'), events, settings);
  // Music and ambience dip under story lines (spec audio-mix: Story ducking).
  const storyDucker = new StoryDucker(events, audio);
  const say = (id: string, opts?: SayOptions & ScriptSpeechOptions) => {
    if (!dialogue.hasLine(id)) {
      console.warn(`[speech] unknown line "${id}"`);
      return null;
    }
    if (dialogue.line(id).channel === 'pa') {
      return speech.say(id, { ...opts, at: () => level?.paSpeakerAt(camera.position, opts?.fixture) ?? null });
    }
    const line = dialogue.line(id);
    if (line.channel === 'local' && !opts?.at && speakerHeadAt(line.speaker)) {
      const speaker = line.speaker;
      return speech.say(id, { ...opts, at: () => speakerHeadAt(speaker) });
    }
    return speech.say(id, opts);
  };
  // infection-kills "The victim's voice worsens": a mauled victim's lines play beside anything else that is speaking
  // (never queued behind it), from her head; an impact or the throw cuts the one she is on.
  const killLines = new Map<string, string>();
  events.on('kill:say', ({ npc, line }) => {
    if (say(line, { overlap: true })) killLines.set(npc, line);
  });
  events.on('kill:cut', ({ npc }) => {
    const line = killLines.get(npc);
    if (line === undefined) return;
    killLines.delete(npc);
    speech.stop(line);
  });
  events.on('game:mode', ({ mode }) => {
    if (mode !== 'title') return;
    speech.stopAll();
    storyDucker.reset();
  });
  events.on('game:restarted', () => {
    speech.stopAll();
    storyDucker.reset();
  });
  const guidance = new Guidance({
    events,
    input,
    ui: el<HTMLElement>('#ui'),
    scene,
    camera,
    materials,
    interactions,
    toasts,
    level,
    model: mapModel,
    mapState,
    objectives: validate(objectivesValidator(new Set(dialogue.allLines().map((l) => l.id))), objectivesJson, 'data/objectives.json'),
    barkLines: dialogue.allLines().filter((l) => l.id.startsWith('bark_') || l.id.startsWith('hint_')),
    speech: { speaking: () => speech.speaking(), say },
    speakerAt: (sp) => {
      if (sp === 'engineer' || sp === 'medic') {
        const p = squad.mate(sp).position;
        return { x: p.x, y: p.y + 1.6, z: p.z };
      }
      return speakerHeadAt(sp);
    },
    nav: () => world.navGraph(),
    difficulties,
    preset: () => game.preset,
    flags: () => game.flags,
    mode: () => game.mode,
    busy: () => game.flying || player.onRails || (sequences?.skippable ?? false) || tutorials.blocking,
    onRails: () => player.onRails,
    openMap: () => game.openMap(),
    resume: () => game.resume(),
    player: {
      feet: () => ({ x: player.body.x, y: player.body.y, z: player.body.z }),
      yaw: () => player.yaw,
      hp: () => player.vitals.hp,
      alive: () => player.alive,
      heal: (n) => {
        const before = player.vitals.hp;
        player.heal(n);
        return player.vitals.hp > before;
      },
    },
    // Shotgun ammo only counts (boxes, drops) once the armory shotgun is carried (ADR-0005).
    ammo: () => ({
      pistol: { ...viewmodel.ammoOf('pistol'), mag: viewmodel.magSize('pistol') },
      ...(viewmodel.owns('shotgun') ? { shotgun: { ...viewmodel.ammoOf('shotgun'), mag: viewmodel.magSize('shotgun') } } : {}),
    }),
    addAmmo: (w, n) => viewmodel.addReserve(w, n),
    giveWeapon: (w) => {
      if (viewmodel.owns(w)) return false;
      game.flags[`weapon:${w}`] = true;
      events.emit('weapon:given' as never, { weapon: w } as never);
      viewmodel.equip(w);
      return true;
    },
    itemName: (id) => inventory.name(id),
    holds: (id) => inventory.satisfies(id),
    keys: (a) => keymap[a],
  });
  setWayfindingSpotlight = (on) => guidance.setSpotlight(on);
  const menuRoot = el<HTMLElement>('#menu');
  let credits: EndCredits | null = null;
  const showCredits = (): void => {
    void (async () => {
      if (!credits) {
        const [{ EndCredits }] = await Promise.all([
          import('./ui/credits.ts'),
          import('./ui/styles/credits.css'),
        ]);
        credits = new EndCredits(document.body, {
          reducedMotion: () => settings.get().reducedMotion,
          reducedFlashing: () => settings.get().reducedFlashing,
        });
      }
      credits.show(() => {
        if (!menuRoot.hidden) {
          menuRoot.querySelector<HTMLElement>('[autofocus], button, input, select')?.focus();
        }
      });
    })();
  };
  createMenus(menuRoot, { game, saves, settings, difficulties, events, resetTutorials: () => tutorials.reset(), showCredits });
  // Menu UI sounds: hover/keyboard focus on a control, and a chirp when it's activated.
  const menuControl = (t: EventTarget | null): HTMLElement | null =>
    t instanceof Element ? t.closest<HTMLElement>('button:not([disabled]), select, input') : null;
  let lastMenuHover: HTMLElement | null = null;
  menuRoot.addEventListener('pointerover', (e) => {
    const c = menuControl(e.target);
    if (!c || c === lastMenuHover) return;
    lastMenuHover = c;
    audio.play('uiHover', { bus: 'ui', gain: 0.8, rate: 0.97 + Math.random() * 0.06 });
  });
  menuRoot.addEventListener('pointerout', (e) => {
    if (menuControl(e.target) === lastMenuHover && !menuControl(e.relatedTarget)) lastMenuHover = null;
  });
  menuRoot.addEventListener('keydown', (e) => {
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && menuControl(e.target)) audio.play('uiHover', { bus: 'ui', gain: 0.8, rate: 0.97 + Math.random() * 0.06 });
  });
  // Menu open sting: at boot and whenever the menu reappears (Esc, or alt-tab dropping pointer lock).
  // Browsers keep audio suspended until the first gesture, so a boot-time open waits for it.
  const playMenuOpen = (): void => {
    try {
      audio.play('uiMenuOpen', { bus: 'ui', gain: 0.8, reverb: 0.1 });
    } catch {
      /* sample not loaded (yet) */
    }
  };
  let menuOpenPending = false;
  const onMenuShown = (): void => {
    if (audio.ctx.state === 'running') playMenuOpen();
    else menuOpenPending = true;
  };
  new MutationObserver(() => {
    if (!menuRoot.hidden) onMenuShown();
  }).observe(menuRoot, { attributes: true, attributeFilter: ['hidden'] });
  const flushPendingMenuOpen = (): void => {
    if (!menuOpenPending) return;
    void audio.resume().then(() => {
      if (!menuOpenPending) return;
      menuOpenPending = false;
      if (!menuRoot.hidden) playMenuOpen();
    });
  };
  addEventListener('pointerdown', flushPendingMenuOpen, { capture: true, once: false });
  addEventListener('keydown', flushPendingMenuOpen, { capture: true, once: false });
  if (!menuRoot.hidden) onMenuShown();
  menuRoot.addEventListener('click', (e) => {
    if (menuControl(e.target)?.tagName === 'BUTTON') audio.play('uiSelect', { bus: 'ui', gain: 0.65, reverb: 0.1 });
  });
  menuMusic.setMode(game.mode);
  ambience?.setMode(game.mode);
  events.on('game:mode', ({ mode }) => {
    menuMusic.setMode(mode);
    ambience?.setMode(mode);
  });
  events.on('level:reset', () => ambience?.reset());
  events.on('game:restarted', () => menuMusic.cue(null));
  // A score never survives a restart or the title; a restore into a scored stretch starts it again (adaptive-music).
  events.on('game:restarted', () => {
    score.stopAll();
    score.resume(game.flags);
  });
  events.on('game:mode', ({ mode }) => {
    if (mode === 'title') score.stopAll();
  });
  for (const name of score.events()) events.on(name as never, () => score.onEvent(name));
  events.on('score:stinger' as never, (p: { id?: string }) => {
    if (typeof p?.id === 'string') score.stinger(p.id);
  });
  events.on('player:flashlight', () => roomAudio?.flashlightClick());
  events.on('player:footstep', (f) => {
    if (game.mode === 'playing' && !game.flying) footsteps.playPlayer(f);
  });
  events.on('player:damaged', () => audio.muffle(0.4));
  const crosshair = el<HTMLElement>('#crosshair');
  crosshair.hidden = game.mode !== 'playing';
  events.on('game:mode', ({ mode }) => {
    crosshair.hidden = mode !== 'playing';
  });
  // Empty chamber: same click for both guns, a little lower and heavier on the shotgun.
  events.on('weapon:dryFire', ({ weapon }) => audio.play('dryFire', { bus: 'sfx', gain: 0.8, rate: weapon === 'shotgun' ? 0.88 : 1 }));
  // Reload, pump and shell sounds hang on cues the viewmodel emits at fixed points of the GLB clips (CUES in
  // viewmodel.ts), so they stay in step with the animation whatever its speed. The samples start a few
  // milliseconds before their transient, so each cue time already allows for that.
  events.on('weapon:cue', ({ cue }) => {
    switch (cue) {
      case 'magOut':
        audio.play('pistolReloadOut', { bus: 'sfx', gain: 0.7, reverb: 0.2 });
        break;
      case 'magIn':
        audio.play('pistolReloadIn', { bus: 'sfx', gain: 0.8, reverb: 0.2 });
        break;
      case 'slide':
        audio.play('pistolReloadSlide', { bus: 'sfx', gain: 0.8, reverb: 0.2 });
        break;
      case 'slideSoft':
        audio.play('pistolReloadSlide', { bus: 'sfx', gain: 0.45, reverb: 0.2, rate: 1.04 });
        break;
      case 'cockBack':
        audio.play('pistolCock', { bus: 'sfx', gain: 0.8, reverb: 0.2 });
        break;
      case 'pump':
        audio.play('shotgunPump', { bus: 'sfx', gain: 0.8, reverb: 0.2 });
        break;
    }
  });
  // One shell-in sound per shell as it seats in the port (ReloadOne), with a little pitch variation so a run of them doesn't machine-gun.
  events.on('weapon:shellInsert', () => audio.play('shotgunShell', { bus: 'sfx', gain: 0.8, reverb: 0.2, rate: 0.96 + Math.random() * 0.08 }));
  events.on('weapon:fired', ({ weapon }) => {
    const rate = 0.97 + Math.random() * 0.06;
    if (weapon === 'pistol') audio.play('pistolShot', { bus: 'sfx', gain: 0.6, reverb: 0.35, rate });
    else audio.play('shotgunShot', { bus: 'sfx', gain: 0.9, reverb: 0.4, rate });
  });
  events.on('room:entered', (r) => {
    audio.setRoomReverb(r.reverb);
    ambience?.enterRoom(r.ambience, level?.roomLights(r.id) ?? []);
  });

  events.on('item:given', (it) => toasts.show('Picked up', it.name));
  if (level) {
    const doorAudio = new DoorAudio(audio);
    level.registerInteractions(interactions);
    events.on('door:move', (e) => {
      if (game.mode === 'playing') doorAudio.onMove(e);
    });
    events.on('door:denied', (d) => {
      toasts.show('Door', d.reason);
      doorAudio.onDenied(d.id, level.anchorPosition('door', d.id));
    });
    events.on('door:unlocked', (d) => {
      toasts.show('Door unlocked', d.id);
      doorAudio.onUnlocked(d.id, level.anchorPosition('door', d.id));
    });
    events.on('access:denied', (d) => {
      hud.showHint(d.hint);
      if (d.kind === 'door') doorAudio.onDenied(d.id, level.anchorPosition('door', d.id));
    });
    events.on('level:reset', () => doorAudio.stopAll());
    events.on('game:mode', ({ mode }) => {
      if (mode === 'title') doorAudio.stopAll();
    });
  } else {
    // Demo room interactables (ADR-0004).
    const { DEMO_INTERACT_BOXES } = await import('./world/demoRoomColliders.ts');
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

  const runSequence = (id: string): void => {
    void import('./actors/debugSequences.ts').then(({ DEBUG_SEQUENCES }) => {
      const seq = DEBUG_SEQUENCES[id];
      if (!seq) {
        if (sequences?.has(id)) sequences.start(id, { debug: true });
        else console.warn(`[debug] unknown sequence '${id}'. Known: ${[...Object.keys(DEBUG_SEQUENCES), ...(sequences?.ids() ?? [])].join(', ')}`);
        return;
      }
      seq({ player, say: (t, b) => toasts.show(t, b ?? ''), focus: room?.anchors.door ?? world.spawn.position }).catch((err: unknown) => console.error(err));
    });
  };

  // Apply settings now and whenever they change.
  const applySettings = (): void => {
    const s = settings.get();
    camera.fov = s.fov;
    camera.updateProjectionMatrix();
    applyQuality(renderer, s.quality);
    post.setSize(innerWidth, innerHeight, renderer.getPixelRatio());
    post.setQuality(s.quality);
    // The rest of the tier's budget (render-quality spec): light pools, anisotropy, character shadows.
    const tier = activeTier(s.quality);
    world.setLightBudget?.(lightBudgetOf(tier));
    setAnisotropy(anisotropyFor(tier, maxAnisotropy));
    setCharacterShadowDistance(tier.characterShadowDistance);
    post.grade.uGrain.value = s.filmGrain ? GRAIN : 0;
    game.applyVolume();
  };
  applySettings();
  events.on('settings:changed', applySettings);

  let debug: DebugTools | null = null;
  let levelStats: { drawCalls: number; pool: number } | null = null;
  // `?debug` physics panel (adopt-physics-engine task 2.6): collider view and step timing.
  let physicsView: import('./physics/debugView.ts').PhysicsDebugView | null = null;
  const physicsStats = { engine: 'not loaded', stepAvgMs: 0, stepPeakMs: 0 };
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
    if (ambience) {
      const ambDebug = { preset: 'auto' };
      sound
        .add(ambDebug, 'preset', ['auto', ...Object.keys(AMBIENCE_PRESETS)])
        .name('ambience preset')
        .onChange((val: string) => ambience.setOverride(val === 'auto' ? null : val, 1.0));
    }
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
    // ?debug&jump=r05|r06|r07|r09|r11: skip the quiet half and start at that action beat with the flags it needs
    // (ADR-0014 Part B). The intro still gets cancelled; doors are re-applied by the `action_restore` sequence.
    const jump = new URLSearchParams(location.search).get('jump');
    // ?debug&jump=drop: rounds done, Jay put inside the Observation Gallery, so the Lab B drop (and Voss's death) plays at once.
    if (jump === 'drop' && level) {
      const off = events.on('game:mode', ({ mode }) => {
        if (mode !== 'playing') return;
        off();
        setTimeout(() => {
          sequences?.cancelAll();
          Object.assign(game.flags, { introSeen: true, briefingSeen: true, rounds_done: true });
          // The intro opens on black and fades in; cancelling it early leaves the screen black.
          hud.setFade(0, 0.4);
          const at = level.anchor('gallery_enter');
          if (!at) return console.warn('[debug] jump=drop: no anchor gallery_enter');
          // Inside the gallery's entry trigger, facing the Lab B glass: entering it starts the drop.
          player.placeAtEye(new THREE.Vector3(at.pos.x - 1, at.pos.y + PLAYER_TUNING.eyeHeight, at.pos.z + 1), Math.PI / 4);
        }, 400);
      });
    }
    if (jump && jump !== 'drop' && level) {
      const base: Record<string, boolean | number> = { introSeen: true, briefingSeen: true, rounds_done: true, drop_started: true, drop_done: true };
      const steps: Array<[string, string, Record<string, boolean | number>]> = [
        ['r05', 'cp_first_contact', {}],
        ['r06', 'cp_cover_me', { contact_done: true }],
        ['r07', 'cp_security', { cover_done: true, 'giles.infectionStage': 1 }],
        ['r09', 'cp_flooded', { armory_open: true, glass_near: true, sec_done: true, medlab_open: true, 'giles.infectionStage': 3, 'giles.bandaged': true, 'weapon:shotgun': true }],
        ['r11', 'cp_climax', { tunnel_started: true, valve_done: true, 'giles.infectionStage': 3, 'giles.bandaged': true, 'weapon:shotgun': true }],
      ];
      const off = events.on('game:mode', ({ mode }) => {
        if (mode !== 'playing') return;
        off();
        setTimeout(() => {
          const upto = steps.findIndex(([key]) => key === jump);
          const cp = upto >= 0 ? level.source.checkpoints?.find((c) => c.id === steps[upto]![1]) : undefined;
          if (!cp) return console.warn(`[debug] jump=${jump}: use ${steps.map(([k]) => k).join(', ')}`);
          sequences?.cancelAll();
          // The intro opens on black and fades in; cancelling it early leaves the screen black (as for jump=drop).
          hud.setFade(0, 0.4);
          Object.assign(game.flags, base);
          for (const [, , add] of steps.slice(0, upto + 1)) Object.assign(game.flags, add);
          sequences?.start('action_restore');
          player.placeAtEye(new THREE.Vector3(cp.pos[0], cp.pos[1] + PLAYER_TUNING.eyeHeight, cp.pos[2]), ((cp.yaw ?? 0) * Math.PI) / 180);
          squad.requestPlacement();
        }, 400);
      });
    }
    // ?debug&give=card_l2,vent_driver: key items at the start of play (ADR-0024).
    const give = new URLSearchParams(location.search).get('give');
    if (give) {
      events.on('game:mode', ({ mode }) => {
        if (mode === 'playing') for (const id of give.split(',')) inventory.give(id.trim(), 'debug');
      });
    }
    if (level) {
      const { LevelOverlay, OVERLAY_LAYERS } = await import('./world/levelDebug.ts');
      const overlay = new LevelOverlay(level);
      scene.add(overlay.group);
      const lf = gui.addFolder('Level');
      lf.add({ checker: level.debugCheckerEnabled }, 'checker').name('debug checkerboard').onChange((on: boolean) => level.setDebugChecker(on));
      for (const layer of OVERLAY_LAYERS) lf.add(overlay.visible, layer).name(layer).onChange((on: boolean) => overlay.set(layer, on));
      lf.add({ unlockAll: () => level.unlock('D2', 'script') }, 'unlockAll').name('unlock D2');
      for (const id of Object.keys(itemTable)) lf.add({ give: () => inventory.give(id, 'debug') }, 'give').name(`give ${inventory.name(id)}`);
      levelStats = { drawCalls: 0, pool: 0 };
      lf.add(levelStats, 'drawCalls').name('visible draw calls').listen().disable();
      lf.add(levelStats, 'pool').name('pooled lights bound').listen().disable();
    }
    enemies.addDebug(gui);
    const { PhysicsDebugView } = await import('./physics/debugView.ts');
    physicsView = new PhysicsDebugView();
    physicsView.visible = false;
    scene.add(physicsView.group);
    const physicsFolder = gui.addFolder('Physics');
    physicsFolder.add(physicsView, 'visible').name('show colliders');
    physicsFolder.add(physicsStats, 'engine').listen().disable();
    physicsFolder.add(physicsStats, 'stepAvgMs').name('step avg ms').listen().disable();
    physicsFolder.add(physicsStats, 'stepPeakMs').name('step peak ms').listen().disable();
    physicsFolder.close();
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

  const npcCamFwd = { x: 0, z: -1 };
  const scoreFeet = { x: 0, y: 0, z: 0 };
  let simTime = 0;
  const loop = new Loop({
    update: (dt) => {
      tutorials.update(dt);
      if (game.mode === 'playing') speech.update(dt);
      if (tutorials.blocking) {
        input.endStep();
        return;
      }
      simTime += dt;
      game.update(dt);
      if (game.mode === 'playing' && !game.flying) {
        // Physics steps first, so everything after reads this step's bodies; a pause skips it (design D8).
        stepPhysics(dt);
        sequences?.update(dt);
        enemies.update(dt);
        squad.update(dt, camera.position);
        npcs.update(dt, camera.position, cameraForwardXZ(camera, npcCamFwd));
        gore.update(dt);
        guidance.update(dt);
        scoreFeet.x = player.body.x;
        scoreFeet.y = player.body.y;
        scoreFeet.z = player.body.z;
        score.update(dt, scoreFeet, (t) => gameHost.resolve(t as never));
      }
      input.endStep();
    },
    render: (_alpha, frameDt) => {
      debug?.beginFrame();
      // Camera feeds first: they rebind room visibility and lights, which world.update sets back for Jay.
      if (game.mode === 'playing') cameraFeeds.update(frameDt, simTime);
      tutorials.render();
      game.render(frameDt);
      guidance.render(frameDt);
      viewmodel.update(frameDt);
      flashlight.update(frameDt);
      world.update(simTime, frameDt, camera.position, settings.get().reducedFlashing);
      if (level && levelStats) {
        levelStats.drawCalls = level.visibleDrawCalls();
        levelStats.pool = level.pool.boundCount();
      }
      audio.updateListener(camera);
      if (physicsView) {
        physicsView.update(physicsWorld?.engine ?? null);
        if (physicsWorld) {
          const s = physicsWorld.stats();
          physicsStats.engine = physicsWorld.engine.name;
          physicsStats.stepAvgMs = Math.round(s.avgMs * 1000) / 1000;
          physicsStats.stepPeakMs = Math.round(s.peakMs * 1000) / 1000;
        }
      }
      roomAudio?.update(simTime);
      ambience?.update(simTime, camera.position);
      post.grade.uDamage.value = game.mode === 'title' || game.flying ? 0 : player.damageFx;
      // One shadow pass per frame, for the player's view (see renderer.shadowMap.autoUpdate below).
      renderer.shadowMap.needsUpdate = true;
      post.render(simTime);
      feedGl.overlay(game.mode === 'playing' ? cameraFeeds.fullscreen : null);
      debug?.endFrame();
    },
  });

  const gameHost = createGameHost({
      events,
      game,
      player,
      world,
      level,
      audio,
      ambience,
      music: menuMusic,
      score,
      hud,
      toasts,
      inventory,
      enemies: enemies.director,
      npcs,
      cameraFeeds,
      gore,
      titleCard: new TitleCard(el<HTMLElement>('#ui')),
      showCredits,
      speech: { say, stopAll: () => speech.stopAll() },
      anchors: room ? { door: room.anchors.door, window: room.anchors.window, vent: room.anchors.vent, console: room.anchors.console, abyss: room.anchors.abyss } : undefined,
      setTimeScale: (scale) => {
        loop.clock.scale = scale;
      },
    });
  sequences = new SequenceManager(gameHost, loadSequences());
  // dock-checkpoint: does Jay carry a weapon through the dock arch? (`runHook jayArmed`, then `if jay_armed`.)
  sequences.registerHook('jayArmed', ({ flags: f }) => {
    f['jay_armed'] = viewmodel.owns('pistol') || viewmodel.owns('shotgun');
  });
  // Back to the title or a fresh game: nothing from the last session keeps running.
  events.on('game:mode', ({ mode }) => {
    if (mode === 'title') sequences?.cancelAll();
  });
  if (flags.enabled) {
    const { SequenceOverlay } = await import('./script/overlay.ts');
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

const splash = startSplash(document.querySelector<HTMLElement>('#splash'));
boot()
  .then(() => splash.finish())
  .catch((err: unknown) => {
    splash.abort();
    showBootError(err);
  });
