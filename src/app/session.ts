import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Keymap } from '../data/types/keymap.ts';
import type { DifficultyId, DifficultyTable } from '../data/types/difficulty.ts';
import type { ItemTable } from '../data/types/items.ts';
import type { UiText } from '../data/types/uiText.ts';
import type { ScoreTable } from '../data/types/scores.ts';
import killsJson from '../data/kills.json';
import { validateKillTable } from '../data/types/kills.ts';
import posesJson from '../data/poses.json';
import { loadPoseFile } from '../data/types/poses.ts';
import bodyModelsJson from '../data/body-models.json';
import { BodyModelLibrary, validateBodyModelTable } from '../actors/bodyModelLibrary.ts';
import objectivesJson from '../data/objectives.json';
import { objectivesValidator } from '../data/types/objectives.ts';
import { createDebugTools, type DebugTools } from '../core/debug.ts';
import { EventBus } from '../core/events.ts';
import { FreeCamera } from '../core/freeCamera.ts';
import { Input } from '../core/input.ts';
import { Loop } from '../core/loop.ts';
import type { MemProbe } from '../core/memProbe.ts';
import { Rng } from '../core/rng.ts';
import type { Settings, SettingsStore } from '../core/settings.ts';
import { persistentStore } from '../core/storage.ts';
import { validate } from '../core/validate.ts';
import { yieldFrame } from '../core/yieldFrame.ts';
import type { SoundName } from '../audio/sounds.ts';
import { applyQuality, createRenderer } from '../render/renderer.ts';
import { createMaterialsAsync, disposeMaterials, textureSizeFor, type Materials } from '../render/materials.ts';
import { collectTextures } from '../render/textures.ts';
import { createPost, type Post } from '../render/post.ts';
import type { RoomCaptures } from '../render/roomCaptures.ts';
import { anisotropyFor, clampTier, materialTextureUnits, RENDER_TIERS, type GpuLimits, type RenderTier } from '../render/tiers.ts';
import { applyAnisotropy, clearTrackedAnisotropy, currentAnisotropy, setAnisotropy } from '../render/anisotropy.ts';
import { Humanoid, setCharacterShadowDistance, type FootstepEvent } from '../actors/humanoid.ts';
import { Flashlight } from '../render/flashlight.ts';
import { LIGHT_PATTERNS } from '../render/lights.ts';
import { CameraFeeds } from '../render/cameraFeed.ts';
import { createFeedGl, type FeedGl } from '../render/cameraFeedGl.ts';
import { disposeSeabedCache, preloadSeabed } from '../render/fx/seabed.ts';
import { disposeSubModelCache, preloadSubModel } from '../render/fx/subModel.ts';
import type { DemoRoom } from '../world/demoRoom.ts';
import type { Level } from '../world/level.ts';
import type { KitRegistry } from '../world/registry.ts';
import { disposeMergeCaches } from '../world/kit/merge.ts';
import { WaterSystem } from '../render/water/system.ts';
import { WaterSplashes } from '../render/water/splashes.ts';
import { Sparks } from '../render/fx/sparks.ts';
import { WaterDisturbances, type SplashEvent, type StepKind } from '../world/waterDisturbances.ts';
import type { LightBudget, World } from '../world/world.ts';
import type { DemoRoomAudio } from '../world/demoRoomAudio.ts';
import { AMBIENCE_PRESETS, AmbienceDirector } from '../audio/ambience.ts';
import { DoorAudio } from '../audio/doorAudio.ts';
import type { AudioEngine } from '../audio/engine.ts';
import { CasingAudio, ejectOnWeaponEvents } from '../audio/casings.ts';
import { wireSquadShots } from './squadShots.ts';
import { SquadMuzzleLight } from '../render/squadMuzzleLight.ts';
import { FootstepAudio } from '../audio/footsteps.ts';
import { StageTimer } from './stageTimer.ts';
import { levelFileLoader } from './levelFiles.ts';
import { buildStationWorld, createStationScene, type WorldBundle } from './worldBundle.ts';
import { cachedGpuLimits, gpuKey } from '../render/gpuProbe.ts';
import type { LevelData } from '../data/types/level.ts';
import { ITEMS } from './titlePrepare.ts';
import type { TitlePreload } from './titlePreload.ts';
import type { MenuMusic } from '../audio/menuMusic.ts';
import { PropAudioController } from '../audio/propAudio.ts';
import { EARSHOT_LEVEL, voiceAudibility, wallOccluder } from '../audio/occlusion.ts';
import { loadPhysics } from '../physics/load.ts';
import { anyPhysics, resolvePhysicsSwitches } from '../physics/switches.ts';
import { PhysicsWorld } from '../physics/world.ts';
import { physicsDebris, type PhysicsDebrisBackend } from '../physics/debris.ts';
import { PhysicsProps, PlayerPusher } from '../physics/interaction.ts';
import { DEFAULT_MOTOR } from '../actors/motor.ts';
import { stomp, stompPoint } from '../actors/stomp.ts';
import { ScorePlayer, type RenderedScore } from '../audio/scorePlayer.ts';
import { engineScoreAudio } from '../audio/scoreAudio.ts';
import type { ScoreWorkerReply } from '../audio/scoreWorker.ts';
import { CollisionWorld } from '../world/collision.ts';
import { Game } from '../game/game.ts';
import { CutsceneController } from '../game/cutscene.ts';
import { CutsceneUi } from '../ui/hud/cutsceneUi.ts';
import { TitleCard } from '../ui/titleCard.ts';
import { Interactions } from '../actors/interaction.ts';
import { Player, PLAYER_TUNING } from '../actors/player.ts';
import { createGameHost } from '../script/gameHost.ts';
import { loadSequences } from '../script/load.ts';
import { SequenceManager } from '../script/runtime.ts';
import { PlayerHud, keyLabel } from '../ui/hud/playerHud.ts';
import type { SaveData, SaveStore } from '../game/save.ts';
import { clearSharedMocapLibrary, loadSharedMocapLibrary } from '../actors/mocap.ts';
import { loadMocapPacks } from '../actors/mocapPacks.ts';
import { sharedMotionProfiles } from '../actors/motionProfiles.ts';
import { motionScene } from '../actors/motionScene.ts';
import { Toasts } from '../ui/toast.ts';
import { TutorialPrompts } from '../ui/tutorialPrompts.ts';
import { TutorialProfile } from '../ui/tutorials.ts';
import { loadWeaponModels } from '../render/viewmodel/glbWeapons.ts';
import { Viewmodel } from '../render/viewmodel/viewmodel.ts';
import { loadSquadPistolModel } from '../actors/squadPistol.ts';
import { Squad } from '../ai/squad.ts';
import { REVIVE_TASK } from '../ai/squadBrain.ts';
import { NpcDirector } from '../ai/npcs.ts';
import { cameraForwardXZ } from '../ai/ambientLife.ts';
import { npcCandidatesForSpeaker, npcIdForSpeaker, wireSpeechActing } from '../ai/speakerBodies.ts';
import { wireSquadToEnemies } from '../ai/squadEnemies.ts';
import { setupEnemies, spawnPointsOf } from '../ai/enemyGame.ts';
import type { SpawnPointData } from '../ai/spawner.ts';
import { GoreSystem } from '../actors/gore.ts';
import { PoseLibrary } from '../actors/poses.ts';
import { Inventory } from '../game/inventory.ts';
import { buildMapModel, MapState, type MapModel } from '../ui/mapModel.ts';
import { Guidance } from '../game/guidance.ts';
import { sidearmAllowed } from '../game/sidearm.ts';
import { loadDialogueLibrary } from '../dialogue/load.ts';
import { SpeechManager, type Hearing, type SayOptions } from '../dialogue/speech.ts';
import type { DialogueLine } from '../data/types/dialogue.ts';
import type { ScriptSpeechOptions } from '../script/host.ts';
import { WebAudioVoicePlayer } from '../dialogue/voicePlayer.ts';
import { StoryDucker } from '../audio/storyDuck.ts';
import { Subtitles } from '../ui/hud/subtitles.ts';
import type { LoadingScreen } from '../ui/loadingScreen.ts';
import { DEFAULT_LEVEL, type AutoLoadPlan, type LaunchPlan } from './launch.ts';
import { ContactShadows, contactBodies } from '../render/contactShadows.ts';

const GRAIN = 0.035;
const TEXTURE_UPLOAD_BATCH = 8;

export type SessionIntent =
  | { kind: 'newGame'; slot: number; difficulty: DifficultyId; levelParam?: string | null }
  | { kind: 'load'; save: SaveData }
  | { kind: 'autoLoad'; plan: AutoLoadPlan };

export interface SessionShellDeps {
  settings: SettingsStore;
  saves: SaveStore;
  keymap: Keymap;
  difficulties: DifficultyTable;
  itemTable: ItemTable;
  uiText: UiText;
  scores: ScoreTable;
  audio: AudioEngine;
  menuMusic: MenuMusic;
  shellEvents: EventBus;
  memProbe: MemProbe | null;
  launch: LaunchPlan;
  loading: LoadingScreen;
  showCredits: (opts?: { instant?: boolean }) => Promise<void>;
  onQuitToTitle: () => void;
  setActiveScore: (score: ScorePlayer | null) => void;
}

export interface PlaySession {
  readonly game: Game;
  readonly levelId: string | null;
  resetTutorials(): void;
  dispose(): void;
}

function el<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`index.html is missing ${selector}`);
  return found;
}

/** Top-level empty flags provider so resetting `motionScene.flags` never retains `createPlaySession`'s V8 closure context. */
const EMPTY_FLAGS = (): Record<string, boolean | number> => ({});

/** Top-level shell memProbe attachment so post-dispose probes never retain `createPlaySession`'s V8 closure context. */
function attachShellMemProbe(memProbe: MemProbe | null, audio: AudioEngine): void {
  memProbe?.attach({
    threeInfo: () => ({ geometries: 0, textures: 0 }),
    audioBytes: () => audio.decodedBytes(),
  });
}

/** Replace `#game` with a clean canvas after forcing WebGL context loss so the next session gets a fresh context. */
function resetGameCanvas(oldCanvas: HTMLCanvasElement): void {
  const fresh = document.createElement('canvas');
  fresh.id = 'game';
  oldCanvas.replaceWith(fresh);
}

/** Remove DOM elements appended to `#ui` during a session, keeping the static `#prompt`, `#interact`, `#crosshair`. */
function clearSessionUi(uiRoot: HTMLElement): void {
  const keep = new Set(['prompt', 'interact', 'crosshair']);
  for (const child of [...uiRoot.children]) {
    if (!keep.has(child.id)) child.remove();
  }
  const prompt = uiRoot.querySelector<HTMLElement>('#prompt');
  if (prompt) prompt.hidden = true;
  const interact = uiRoot.querySelector<HTMLElement>('#interact');
  if (interact) interact.hidden = true;
  const crosshair = uiRoot.querySelector<HTMLElement>('#crosshair');
  if (crosshair) crosshair.hidden = true;
}

/**
 * Create, asynchronously load, GPU pre-warm, and start a full 3D `PlaySession`.
 * If any step fails, partially allocated resources are disposed before rethrowing.
 */
export async function createPlaySession(shell: SessionShellDeps, intent: SessionIntent, preload: TitlePreload | null = null): Promise<PlaySession> {
  const { settings, saves, keymap, difficulties, itemTable, uiText, scores, audio, menuMusic, shellEvents, memProbe, launch, loading } = shell;
  const canvas = el<HTMLCanvasElement>('#game');
  const uiRoot = el<HTMLElement>('#ui');
  const prompt = el<HTMLElement>('#prompt');

  const stages = new StageTimer();
  /** A prepared item when the title made one (title-preload spec), otherwise the session's own load. Shared items ignore the key. */
  const adopt = <T>(item: string, own: () => Promise<T>): Promise<T> => {
    if (!preload) return own();
    const key = { levelId: '', quality: settings.get().quality, gpu: '' };
    if (preload.available(item, key)) stages.markPrepared();
    return preload.take(item, key, own);
  };

  // The level this load targets, from the intent.
  const levelParam =
    intent.kind === 'autoLoad' ? intent.plan.levelParam : intent.kind === 'newGame' ? (intent.levelParam ?? null) : intent.save.level;
  const levelId = levelParam === 'demo' || levelParam === 'lab' || levelParam === 'corner' ? null : (levelParam ?? DEFAULT_LEVEL);

  // A world built at the title is adopted whole, with the bus, inventory, scene and materials it was built against
  // (title-preload design D9); a miss, a mismatch or a failure gives null and the normal load runs.
  const probe = cachedGpuLimits();
  let bundle: WorldBundle | null = null;
  if (preload && levelId && probe && !launch.checker) {
    // (The UV checker debug material is applied at build time, so a checker load always builds its own world.)
    const key = { levelId, quality: settings.get().quality, gpu: gpuKey(probe) };
    if (preload.available(ITEMS.world, key)) loading.setProgress(0.02, 'Finishing the station…');
    bundle = await preload.take<WorldBundle | null>(ITEMS.world, key, async () => null);
  }

  const events = bundle?.events ?? new EventBus();
  const cleanups: Array<() => void> = [];
  let disposed = false;

  // Resources tracked for deterministic teardown (both on Quit to title and on mid-load error).
  let renderer: THREE.WebGLRenderer | null = null;
  let envTexture: THREE.Texture | null = null;
  /** Per-room reflections and bounce light, station level only (room-light-response). */
  let roomCaptures: RoomCaptures | null = null;
  let post: Post | null = null;
  let materials: Materials | null = null;
  let registry: KitRegistry | null = null;
  let level: Level | null = null;
  let world: World | null = null;
  let bodyModels: BodyModelLibrary | null = null;
  if (bundle) {
    // Owned by this session from here, so an early failure disposes them like any other.
    materials = bundle.materials;
    registry = bundle.registry;
    level = bundle.level;
  }
  let squad: Squad | null = null;
  let npcs: NpcDirector | null = null;
  let enemies: ReturnType<typeof setupEnemies> | null = null;
  let viewmodel: Viewmodel | null = null;
  let gore: GoreSystem | null = null;
  let waterSystem: WaterSystem | null = null;
  let sparks: Sparks | null = null;
  let splashes: WaterSplashes | null = null;
  let feedGl: FeedGl | null = null;
  let cameraFeeds: CameraFeeds | null = null;
  let physicsWorld: PhysicsWorld | null = null;
  let roomAudio: DemoRoomAudio | null = null;
  let ambience: AmbienceDirector | null = null;
  let propAudio: PropAudioController | null = null;
  let doorAudio: DoorAudio | null = null;
  let footsteps: FootstepAudio | null = null;
  let casings: CasingAudio | null = null;
  let squadMuzzleLight: SquadMuzzleLight | null = null;
  let voicePlayer: WebAudioVoicePlayer | null = null;
  let storyDucker: StoryDucker | null = null;
  let score: ScorePlayer | null = null;
  let speech: SpeechManager | null = null;
  let sequences: SequenceManager | null = null;
  let cutscene: CutsceneController | null = null;
  let guidance: Guidance | null = null;
  let toasts: Toasts | null = null;
  let titleCard: TitleCard | null = null;
  let input: Input | null = null;
  let loop: Loop | null = null;
  let debug: DebugTools | null = null;
  let physicsView: import('../physics/debugView.ts').PhysicsDebugView | null = null;
  let activeFlashlight: Flashlight | null = null;
  let overlayRaf: number | null = null;
  const timers: Array<ReturnType<typeof setTimeout>> = [];

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const id of timers) clearTimeout(id);
    timers.length = 0;
    if (overlayRaf !== null) cancelAnimationFrame(overlayRaf);
    overlayRaf = null;
    for (const fn of cleanups) {
      try {
        fn();
      } catch {
        /* ignore cleanup error */
      }
    }
    cleanups.length = 0;
    loop?.stop();
    loop = null;
    input?.dispose();
    input = null;
    cutscene?.dispose();
    cutscene = null;
    sequences?.cancelAll();
    sequences = null;
    speech?.stopAll();
    speech = null;
    score?.stopAll();
    score = null;
    shell.setActiveScore(null);
    storyDucker?.dispose();
    storyDucker = null;
    roomAudio?.stop();
    roomAudio = null;
    ambience?.dispose();
    ambience = null;
    propAudio?.dispose();
    propAudio = null;
    doorAudio?.stopAll();
    doorAudio = null;
    footsteps?.stopSloshes();
    footsteps = null;
    casings?.stopAll();
    casings = null;
    squadMuzzleLight?.dispose();
    squadMuzzleLight = null;
    voicePlayer?.dispose();
    voicePlayer = null;
    audio.releaseGameplayBuffers();
    audio.setOccluder(null);
    motionScene.reset();
    motionScene.flags = EMPTY_FLAGS;
    const g = globalThis as Record<string, unknown>;
    delete g['__enemies'];
    delete g['__water'];
    physicsWorld?.destroy();
    physicsWorld = null;
    physicsView?.dispose();
    physicsView = null;
    debug?.gui.destroy();
    debug = null;
    guidance?.dispose?.();
    guidance = null;
    toasts?.dispose();
    toasts = null;
    titleCard?.dispose();
    titleCard = null;
    cameraFeeds?.dispose();
    cameraFeeds = null;
    feedGl?.dispose();
    feedGl = null;
    waterSystem?.dispose();
    waterSystem = null;
    sparks?.dispose();
    sparks = null;
    splashes?.dispose();
    splashes = null;
    viewmodel?.dispose();
    viewmodel = null;
    enemies?.director.dispose();
    enemies = null;
    npcs?.dispose();
    npcs = null;
    squad?.dispose();
    squad = null;
    gore?.dispose();
    gore = null;
    bodyModels?.dispose();
    bodyModels = null;
    clearSharedMocapLibrary();
    roomCaptures?.dispose();
    roomCaptures = null;
    delete (globalThis as { __roomCaptures?: unknown }).__roomCaptures;
    delete (globalThis as { __post?: unknown }).__post;
    level?.dispose();
    if (!level) world?.dispose?.();
    level = null;
    world = null;
    registry?.dispose();
    registry = null;
    disposeSeabedCache();
    disposeSubModelCache();
    if (materials) disposeMaterials(materials);
    materials = null;
    disposeMergeCaches();
    clearTrackedAnisotropy();
    post?.dispose();
    post = null;
    envTexture?.dispose();
    envTexture = null;
    activeFlashlight?.light.dispose();
    activeFlashlight = null;
    clearSessionUi(uiRoot);
    events.clear();
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss();
      renderer = null;
      memProbe?.ledger.reset();
      resetGameCanvas(canvas);
    }
    attachShellMemProbe(memProbe, audio);
  };

  try {
    const t0 = performance.now();
    stages.begin('renderer');
    // The shared clip library is its own chunk (startup-bundle spec); fetch it alongside every other stage.
    const mocapPromise = loadSharedMocapLibrary();
    mocapPromise.catch(() => undefined); // awaited with the cast assets below; avoids an unhandled rejection if an earlier stage throws
    loading.setProgress(0.02, 'Initializing renderer…');
    await yieldFrame();

    const physics = resolvePhysicsSwitches(settings.get().physics, location.search);
    if (physics.unknown.length) console.warn(`[physics] unknown features in ?physics=: ${physics.unknown.join(', ')}`);

    renderer = createRenderer(canvas, settings.get());
    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
    if (bundle && probe && gpuKey({ maxTextures: renderer.capabilities.maxTextures, maxFragmentUniforms: renderer.capabilities.maxFragmentUniforms, maxAnisotropy }) !== gpuKey(probe)) {
      console.warn('[session] the renderer reports other GPU limits than the title probe; the light pools are re-checked below');
    }
    const gpu: GpuLimits = { maxTextures: renderer.capabilities.maxTextures, maxFragmentUniforms: renderer.capabilities.maxFragmentUniforms, materialUnits: 0 };
    const tierWarnings = new Set<string>();
    const activeTier = (quality: Settings['quality']): RenderTier => {
      const { tier, warnings } = clampTier(RENDER_TIERS[quality], gpu);
      for (const w of warnings)
        if (!tierWarnings.has(w)) {
          tierWarnings.add(w);
          console.warn(`[render] ${quality}: ${w}`);
        }
      return tier;
    };
    const lightBudgetOf = (t: RenderTier): LightBudget => ({ fillLights: t.fillLights, shadowLights: t.shadowLights, shadowMapSize: t.shadowMapSize, cookieSpots: t.cookieSpots });
    const scene = bundle?.scene ?? createStationScene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    envTexture = pmrem.fromScene(roomEnv, 0.04).texture;
    roomEnv.dispose();
    scene.environment = envTexture;
    scene.environmentIntensity = 0.12;
    pmrem.dispose();

    const measureMaterialUnits = (mats: Iterable<THREE.Material>): void => {
      for (const m of mats) gpu.materialUnits = Math.max(gpu.materialUnits, materialTextureUnits(m, scene.environment !== null));
    };
    setAnisotropy(anisotropyFor(RENDER_TIERS[settings.get().quality], maxAnisotropy));

    const camera = new THREE.PerspectiveCamera(settings.get().fov, innerWidth / innerHeight, 0.05, 120);

    stages.begin('textures+audio');
    loading.setProgress(0.06, 'Preparing textures and audio…');
    await yieldFrame();

    const texSize = textureSizeFor(settings.get().quality);
    const inventory = bundle?.inventory ?? new Inventory(itemTable, events);

    // Stage 1 (0.06..0.24): Materials, exterior models, chunked procedural SFX & priority gameplay audio in parallel.
    const [loadedMaterials, , , , gameplayAudio] = await Promise.all([
      adopt(ITEMS.materials, () => createMaterialsAsync(texSize, currentAnisotropy())),
      preloadSeabed(import.meta.env.BASE_URL),
      preloadSubModel(import.meta.env.BASE_URL),
      adopt(ITEMS.audioSounds, () => audio.renderSoundsAsync(undefined, { batchSize: 4 })),
      adopt(ITEMS.audioSamples, () =>
        audio.loadGameplaySamples({
          onProgress: (done, total) => {
            loading.setProgress(0.06 + (done / Math.max(1, total)) * 0.16, 'Preparing audio and textures…');
          },
        }),
      ),
    ]);
    void gameplayAudio.background;
    materials = loadedMaterials;
    applyAnisotropy(); // prepared materials may predate the GPU's maximum
    measureMaterialUnits(Object.values(materials).filter((m): m is THREE.Material => m instanceof THREE.Material));
    loading.setProgress(0.24, 'Loading station assets…');
    await yieldFrame();

    // Start downloading body models, mocap packs, weapon GLBs, and physics WASM concurrently with level build.
    const bodyModelsReady = adopt(ITEMS.bodyModels, async () => {
      const lib = new BodyModelLibrary(validate(validateBodyModelTable, bodyModelsJson, 'data/body-models.json'));
      await lib.load(import.meta.env.BASE_URL);
      return lib;
    }).then((lib) => {
      if (disposed) lib.dispose(); // the load failed elsewhere while this was in flight
      if (launch.bodyModels === 'all') lib.forceShare = 1;
      if (launch.bodyModels === 'off') lib.forceShare = 0;
      return lib;
    });

    const physicsPromise = levelId && anyPhysics(physics.switches) ? loadPhysics(physics.switches) : Promise.resolve(null);
    const castAssetsPromise = Promise.all([
      bodyModelsReady,
      adopt(ITEMS.mocap, () => mocapPromise.then((lib) => loadMocapPacks(lib, Object.keys(sharedMotionProfiles().profiles)))),
      adopt(ITEMS.weapons, loadWeaponModels),
      loadSquadPistolModel(),
    ]);

    // Stage 2 (0.24..0.60): Load & chunk-build the level.
    stages.begin('level');
    let room: DemoRoom | null = null;
    let levelSpawns: SpawnPointData[] = [];
    let mapModel: MapModel | null = null;
    let mapState: MapState | null = null;

    if (levelId) {
      let loaded: { registry: KitRegistry; level: Level; data: LevelData };
      if (bundle) {
        // Built at the title: nothing to load or build here, only the light pools to confirm for this renderer.
        stages.markPrepared();
        loaded = bundle;
        loading.setProgress(0.6, 'Station ready…');
        const actual = lightBudgetOf(activeTier(settings.get().quality));
        if (JSON.stringify(actual) !== JSON.stringify(bundle.lightBudget)) {
          console.warn('[session] the prepared world used other light pools than this renderer allows; resizing', bundle.lightBudget, actual);
          bundle.level.setLightBudget(actual);
        }
      } else {
        loaded = await buildStationWorld({
          levelId,
          loadLevelJson: levelFileLoader(levelId),
          materials,
          events,
          scene,
          inventory,
          itemTable,
          uiText,
          debugChecker: launch.checker,
          lightBudget: lightBudgetOf(activeTier(settings.get().quality)),
          onProgress: (f, label) => {
            loading.setProgress(0.24 + f * 0.36, label);
          },
        });
      }
      registry = loaded.registry;
      level = loaded.level;
      const data = loaded.data;
      levelSpawns = spawnPointsOf(data);
      world = level;
      mapModel = buildMapModel(level.source);
      mapState = new MapState(mapModel);
      console.info(`[session] level '${levelId}' built in ${(performance.now() - t0).toFixed(0)} ms`);
    } else if (levelParam === 'lab') {
      loading.setProgress(0.4, 'Loading laboratory sandbox…');
      const { loadLabWorld } = await import('../world/labWorld.ts');
      world = await loadLabWorld(import.meta.env.BASE_URL, scene, materials, activeTier(settings.get().quality).fillLights);
    } else if (levelParam === 'corner') {
      loading.setProgress(0.4, 'Building texture corner test…');
      const { loadCornerWorld } = await import('../world/cornerTest.ts');
      world = await loadCornerWorld(scene, materials, new URLSearchParams(location.search));
    } else {
      loading.setProgress(0.4, 'Building demo room…');
      const [{ buildDemoRoom }, { demoRoomWorld }] = await Promise.all([import('../world/demoRoom.ts'), import('../world/demoWorld.ts')]);
      room = buildDemoRoom(materials, new Rng('demo-room'));
      world = demoRoomWorld(room);
    }

    // The station's rooms reflect and bounce their own light once captured; the generic environment holds until then,
    // and the lab world and sandboxes keep it (room-light-response D7).
    const { RoomCaptures: Captures, isCaptureWorld } = await import('../render/roomCaptures.ts');
    if (isCaptureWorld(world)) {
      const host = world;
      const capturePmrem = new THREE.PMREMGenerator(renderer);
      roomCaptures = new Captures({
        renderer,
        scene,
        host,
        generic: envTexture,
        filter: (cube, target) => capturePmrem.fromCubemap(cube, target),
        onIrradiance: (room, sh) => host.setRoomIrradiance(room, sh),
        onDispose: () => capturePmrem.dispose(),
      });
      if (launch.debug.enabled) (globalThis as { __roomCaptures?: unknown }).__roomCaptures = roomCaptures;
    }

    scene.add(world.group);
    const worldMaterials = new Set<THREE.Material>();
    world.group.traverse((o) => {
      if (o instanceof THREE.Mesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) worldMaterials.add(m);
    });
    measureMaterialUnits(worldMaterials);
    renderer.shadowMap.autoUpdate = false;

    stages.begin('navmesh+cast');
    // Stage 3 (0.60..0.72): Build Recast NavMesh in Web Worker + await cast assets & Rapier physics.
    loading.setProgress(0.62, 'Generating navigation mesh…');
    await yieldFrame();
    const navPromise = level ? level.buildNavAsync() : Promise.resolve(world.navGraph());
    const [, [bodyLibrary, , weaponModels], physicsFactory] = await Promise.all([navPromise, castAssetsPromise, physicsPromise]);
    bodyModels = bodyLibrary;
    stages.begin('simulation');
    loading.setProgress(0.7, 'Initializing simulation…');
    await yieldFrame();

    // Adaptive scores (music bus).
    const renderScore = (id: string): Promise<RenderedScore> =>
      new Promise((resolve, reject) => {
        const s0 = performance.now();
        const worker = new Worker(new URL('../audio/scoreWorker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (e: MessageEvent<ScoreWorkerReply>): void => {
          worker.terminate();
          if ('error' in e.data) return reject(new Error(e.data.error));
          console.info(`[audio] score ${id} rendered in ${(performance.now() - s0).toFixed(0)} ms`);
          resolve(e.data.score);
        };
        worker.onerror = (e): void => {
          worker.terminate();
          reject(new Error(e.message));
        };
        worker.postMessage({ id });
      });
    score = new ScorePlayer(engineScoreAudio(audio), scores, renderScore);
    shell.setActiveScore(score);

    if (room) {
      const { DemoRoomAudio } = await import('../world/demoRoomAudio.ts');
      roomAudio = new DemoRoomAudio(audio, room, new Rng('room-audio'));
      roomAudio.start();
    } else {
      ambience = new AmbienceDirector(audio, new Rng('level-ambience'));
      if (!level) ambience.enterRoom('hull_hum');
      if (level) propAudio = new PropAudioController(audio, level.soundLoops());
    }

    camera.position.copy(world.spawn.position);
    input = new Input(canvas, keymap, events);
    const freeCam = new FreeCamera(camera, input, () => settings.get());
    freeCam.yaw = world.spawn.yaw;
    freeCam.speed = 2.5;
    freeCam.bounds = world.bounds;

    feedGl = createFeedGl({ renderer, scene, view: level ? (eye, draw, cam) => level!.renderFromEye(eye, draw, cam) : null });
    cameraFeeds = new CameraFeeds({ root: world.group, draw: feedGl });
    events.on('level:reset', () => cameraFeeds!.reset());

    const flashlight = new Flashlight(scene, camera);
    activeFlashlight = flashlight;
    const interactions = new Interactions();
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
    post = createPost(renderer, scene, camera, settings.get().quality);
    if (launch.debug.enabled) (globalThis as { __post?: unknown }).__post = post;
    waterSystem = level ? new WaterSystem(level) : null;
    const splashSize = new THREE.Vector2();

    toasts = new Toasts(document.body);
    const hud = new PlayerHud(uiRoot, el<HTMLElement>('#interact'), keymap.interact[0] ?? 'KeyE');
    cutscene = new CutsceneController({
      sequences: () => sequences,
      input,
      settings,
      player,
      hud,
      ui: new CutsceneUi(uiRoot),
      skipKeyLabel: () => keyLabel(keymap.skipCutscene[0] ?? 'Space'),
      hasIntro: () => level?.anchor('post_front') != null,
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
      inventory,
      map: mapState,
    });
    currentPreset = () => game.preset;

    let setWayfindingSpotlight: ((on: boolean) => void) | null = null;
    const tutorials = new TutorialPrompts({
      parent: uiRoot,
      events,
      settings,
      input,
      profile: new TutorialProfile(persistentStore(launch.scratch)),
      bindings: (a) => keymap[a],
      mode: () => game.mode,
      playTime: () => game.playTime,
      onRails: () => player.onRails || (sequences?.skippable ?? false),
      sequenceRunning: (id) => sequences?.isRunning(id) ?? false,
      flashlightOn: () => flashlight.on,
      focusId: () => interactions.focus?.target.id ?? null,
      onSpotlight: (on) => setWayfindingSpotlight?.(on),
    });

    gore = new GoreSystem(new Rng('game-gore'), level ? (x, z) => level!.floorAt(x, z) : undefined);
    const waterFx = level && level.water.all().length ? new WaterDisturbances(level.water) : null;
    if (waterFx && level) {
      for (const r of level.source.rooms) for (const e of r.water?.emitters ?? []) waterFx.addEmitter({ kind: e.kind, x: e.at[0], z: e.at[1], rate: e.rate, radius: e.radius, strength: e.strength });
    }
    if (waterFx) gore.onLand = (x, y, z, size) => waterFx.land(x, y, z, size);
    if (level && level.water.all().length) gore.waterLevelAt = (x, z) => level!.water.at(x, z)?.level ?? null;

    sparks = level
      ? new Sparks((x, z) => {
          const body = level!.water.at(x, z);
          return body ? { y: body.level, water: true } : { y: level!.floorAt(x, z), water: false };
        })
      : null;
    if (sparks) {
      scene.add(sparks.points);
      sparks.onWater = (x, _y, z) => waterFx?.spark(x, z);
      events.on('light:sparks', (e) => {
        if (game.mode !== 'playing') return;
        sparks!.burst(e.x, e.y, e.z, e.strong);
        if (!e.strong && audio.hasSound('tubeStrike')) audio.play('tubeStrike', { bus: 'ambience', position: new THREE.Vector3(e.x, e.y, e.z), gain: 0.45, reverb: 0.3 });
      });
    }
    splashes = waterFx ? new WaterSplashes() : null;
    if (waterFx && splashes) {
      scene.add(splashes.points);
      const SPLASH_SOUND: Partial<Record<SplashEvent['kind'], { name: SoundName; gain: number }>> = {
        bullet: { name: 'waterSplashBullet', gain: 0.55 },
        body: { name: 'waterSplashBody', gain: 0.9 },
        part: { name: 'waterSplashBullet', gain: 0.4 },
        spark: { name: 'sparkHiss', gain: 0.35 },
      };
      waterFx.onSplash = (e) => {
        splashes!.burst(e);
        const snd = SPLASH_SOUND[e.kind];
        if (snd && game.mode === 'playing' && audio.hasSound(snd.name)) audio.play(snd.name, { bus: 'sfx', position: new THREE.Vector3(e.x, e.y + 0.1, e.z), gain: snd.gain * (0.6 + 0.4 * e.size), reverb: 0.3, rate: 0.94 + Math.random() * 0.12 });
      };
    }
    scene.add(gore.group);
    // Soft contact shadows under every character, on every tier (render-lighting "Characters are grounded").
    const contactShadows = new ContactShadows();
    scene.add(contactShadows.mesh);
    cleanups.push(() => contactShadows.dispose());

    // Initialize Rapier physics during loading (when enabled) so mirroring never pops in mid-game.
    const collisionWorld = world.playerWorld.colliders instanceof CollisionWorld ? world.playerWorld.colliders : null;
    let pusher: PlayerPusher | null = null;
    let physicsProps: PhysicsProps | null = null;
    let wakeDebris: PhysicsDebrisBackend | null = null;
    if (collisionWorld && physicsFactory) {
      loading.setProgress(0.73, 'Initializing physics world…');
      await yieldFrame();
      physicsWorld = await PhysicsWorld.create(physicsFactory, collisionWorld);
      console.info(`[physics] ${physicsWorld.engine.name}: ${physicsWorld.staticCount} level colliders mirrored`);
      const debris = physics.switches.debris ? physicsDebris(physicsWorld) : null;
      if (debris) gore.setDebrisBackend(debris);
      if (physics.switches.interact) {
        pusher = new PlayerPusher(physicsWorld, DEFAULT_MOTOR.radius);
        if (level) physicsProps = new PhysicsProps(physicsWorld, level);
        wakeDebris = debris;
      }
    }
    const stepPhysics = (dt: number): void => {
      if (!physicsWorld) return;
      if (pusher) {
        wakeDebris?.wakeNear(player.body, DEFAULT_MOTOR.radius + 0.8);
        pusher.update(player.body);
      }
      physicsWorld.step(dt);
      physicsProps?.sync();
    };
    const resetPhysics = (): void => void physicsWorld?.reset();
    events.on('level:reset', resetPhysics);
    events.on('game:restarted', resetPhysics);

    const occluder = collisionWorld ? wallOccluder((...ray) => collisionWorld.raycast(...ray)) : null;
    footsteps = new FootstepAudio({
      audio,
      rng: new Rng('footsteps'),
      listener: () => camera.position,
      surfaceAt: (x, y, z) => (world!.surfaceAt ? world!.surfaceAt(x, y, z) : collisionWorld ? collisionWorld.surfaceAt(x, y, z) : world!.playerWorld.surfaceAt(x, z)),
      ...(level && level.water.all().length ? { waterDepth: (x: number, y: number, z: number) => level!.water.depthAt(x, y, z) } : {}),
      ...(occluder ? { isOccluded: occluder } : {}),
    });
    audio.setOccluder(occluder);

    const waterDepthCtx =
      level && level.water.all().length
        ? {
            waterDepth: (x: number, y: number, z: number) => level!.water.depthAt(x, y, z),
            onWade: (actor: string, x: number, y: number, z: number, speed: number, dt: number) => {
              if (game.mode === 'playing') footsteps!.slosh(actor, x, y, z, speed, dt);
            },
          }
        : {};
    const onCharacterFootstep = (step: FootstepEvent): void => {
      waterFx?.footstep(step.x, step.y, step.z, step.kind as StepKind, step.actor);
      if (game.mode === 'playing' && !game.flying) footsteps!.playCharacter(step);
    };

    // Stage 4 (0.75..0.85): Build squad, enemies, batched cast NPCs, viewmodel.
    loading.setProgress(0.75, 'Deploying crew and squad…');
    await yieldFrame();
    squad = new Squad({
      ctx: { poses: new PoseLibrary(loadPoseFile(posesJson)), gore, bodyModels, colliders: world.playerWorld.colliders, onFootstep: onCharacterFootstep, ...waterDepthCtx },
      nav: world.navGraph(),
      player,
      difficulty: () => game.preset,
      emit: (name, payload) => events.emit(name, payload as never),
      flags: () => game.flags,
      gameOver: () => player.damage(1e6),
    });
    scene.add(squad.group);
    motionScene.flags = () => game.flags;
    const SQUAD_PROFILE: Record<string, string> = { engineer: 'giles', medic: 'okafor' };
    events.on('sequence:started', ({ id }) => motionScene.startSequence(id));
    events.on('sequence:ended', ({ id }) => motionScene.endSequence(id));
    events.on('squad:taskStarted', ({ id, task }) => SQUAD_PROFILE[id] && motionScene.setTask(SQUAD_PROFILE[id], task));
    events.on('squad:taskDone', ({ id, task }) => {
      const profile = SQUAD_PROFILE[id];
      if (!profile) return;
      const job = task === REVIVE_TASK ? squad!.mate(id).task : null;
      motionScene.setTask(profile, job && !job.done ? job.kind : null);
    });
    events.on('squad:infectionStage', ({ stage }) => motionScene.setStage(stage));

    enemies = setupEnemies({
      events,
      ctx: { poses: new PoseLibrary(loadPoseFile(posesJson)), gore, bodyModels, colliders: world.playerWorld.colliders, onFootstep: onCharacterFootstep, ...waterDepthCtx },
      world,
      player,
      camera,
      flashlightOn: () => flashlight.on,
      game,
      audio,
      spawns: levelSpawns,
      squad,
      search: location.search,
    });
    player.stompEnabled = physics.switches.interact;
    const stompAt = new THREE.Vector3();
    const stompDir = new THREE.Vector3();
    events.on('player:stomp', (e) => {
      stompAt.set(...e.at);
      stompPoint(stompAt, { x: e.dir[0], z: e.dir[2] }, stompAt);
      stomp(stompAt, stompDir.set(...e.dir), {
        bodies: () => enemies!.director.list.map((en) => en.body),
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

    const npcFeet = new THREE.Vector3();
    const npcHead = new THREE.Vector3();
    npcs = new NpcDirector({
      ctx: { poses: new PoseLibrary(loadPoseFile(posesJson)), gore, bodyModels, colliders: world.playerWorld.colliders, onFootstep: onCharacterFootstep, ...waterDepthCtx },
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
      panelDevice: (panel, near) => level?.panelDevice(panel, near) ?? null,
      kills: validate(validateKillTable, killsJson, 'data/kills.json'),
      listen: (name, fn) => events.on(name as never, fn as never),
      sfx: (ids, at) => {
        const id = ids.find((n) => audio.hasSound(n as SoundName));
        if (!id) return false;
        audio.play(id as SoundName, { position: new THREE.Vector3(at.x, at.y, at.z), occlude: false });
        return true;
      },
    });
    scene.add(npcs.group, npcs.fx);
    player.setNav(world.navGraph());
    player.setBodies(() => npcs!.solidBodies());
    if (level) {
      await npcs.spawnFromLevelAsync(level.npcSpawns(), (frac) => {
        loading.setProgress(0.76 + frac * 0.06, 'Deploying station crew…');
      });
      npcs.enableAmbientLife(level.spots());
    }
    level?.setActors(function* () {
      for (const e of enemies!.director.list) if (e.alive && e.state !== 'dormant' && e.state !== 'playDead') yield e.position;
      for (const m of squad!.mates) yield m.position;
      for (const id of npcs!.ids()) {
        if (npcs!.isSquad(id)) continue;
        const a = npcs!.actor(id, false);
        if (a) yield a.position;
      }
    });
    events.on('game:restarted', () => {
      npcs!.reset();
      squad!.requestPlacement();
    });

    const sidearmUp = (): boolean => sidearmAllowed(game.flags, level?.anchor('duct_r04') != null);
    viewmodel = new Viewmodel({
      scene,
      camera,
      input,
      player,
      events,
      models: weaponModels,
      enabled: () => game.mode === 'playing' && !game.flying && player.alive && player.control.state.weapons && !tutorials.blocking && sidearmUp(),
      visible: () => game.mode !== 'title' && !game.flying,
      // Before the drop's first duct bang the pistol is not in view at all (the flashlight is); it is drawn when it comes up.
      armed: sidearmUp,
      reducedMotion: () => settings.get().reducedMotion,
      owns: (id) => id === 'pistol' || !(level?.source.pickups ?? []).some((p) => p.kind === 'weapon_shotgun') || game.flags['weapon:shotgun'] === true,
    });
    if (waterSystem) waterSystem.hideFromReflection = () => viewmodel!.group.children.filter((c) => !(c instanceof THREE.Light));
    hud.setAmmoSource(() => {
      const id = viewmodel!.weapon;
      return { name: id, ...viewmodel!.ammoOf(id), mag: viewmodel!.magSize(id) };
    });

    // Dialogue & voice player (throttled background VO decoding starts after pre-warm).
    const dialogue = loadDialogueLibrary();
    voicePlayer = new WebAudioVoicePlayer({ ctx: audio.ctx, master: audio.buses.voice, reverbIn: audio.voiceReverbIn });
    memProbe?.attach({
      threeInfo: () => renderer!.info.memory,
      audioBytes: () => audio.decodedBytes() + (voicePlayer?.decodedBytes() ?? 0),
    });

    const voiceFrom = new THREE.Vector3();
    const hearing = (line: DialogueLine, at: SayOptions['at']): Hearing => {
      if (line.channel !== 'local' || !at || !level) return 'everywhere';
      const p = at();
      if (!p) return 'everywhere';
      voiceFrom.set(p.x, p.y, p.z);
      const a = voiceAudibility(level.voicePath(voiceFrom, camera.position));
      return { gain: a.gain, cutoffHz: a.cutoffHz, distance: voiceFrom.distanceTo(camera.position), audible: a.level >= EARSHOT_LEVEL };
    };
    speech = new SpeechManager(events, dialogue, voicePlayer, { hearing });
    const speakerHead = new THREE.Vector3();
    const pooledVoice = new Map<string, string>();
    const speakerNpcId = (speaker: string): string | null => {
      const held = pooledVoice.get(speaker);
      if (held && npcs!.has(held)) return held;
      const options = npcCandidatesForSpeaker(speaker).filter((id) => npcs!.has(id));
      if (options.length <= 1) return options[0] ?? null;
      let best: string | null = null;
      let bestD = Infinity;
      for (const id of options) {
        const a = npcs!.actor(id, false);
        if (!a || !a.body.alive) continue;
        const d = a.position.distanceToSquared(camera.position);
        if (d < bestD) {
          bestD = d;
          best = id;
        }
      }
      if (best) pooledVoice.set(speaker, best);
      return best;
    };
    const speakerHeadAt = (speaker: string): { x: number; y: number; z: number } | null => {
      const id = speakerNpcId(speaker);
      const body = id ? npcs!.actor(id, false)?.body : null;
      if (!body) return null;
      const h = body.jointWorld('head', speakerHead);
      return { x: h.x, y: h.y, z: h.z };
    };
    squad.setSpeech(speech);
    wireSpeechActing(events, (speaker) => {
      const id = speakerNpcId(speaker);
      return id ? (npcs!.actor(id, false)?.body ?? null) : null;
    });
    const talkerId = (speaker: string): string | null => (speaker === 'player' ? 'player' : speakerNpcId(speaker));
    const addresseeId = (to: string | undefined): string | null => {
      if (!to) return null;
      if (to === 'player') return 'player';
      const stripped = to.startsWith('npc:') ? to.slice(4) : to;
      if (npcs!.has(stripped)) return stripped;
      const mapped = npcIdForSpeaker(stripped);
      return mapped && npcs!.has(mapped) ? mapped : null;
    };
    events.on('speech:started', (info) => {
      const id = talkerId(info.speaker);
      if (id && (id === 'player' || npcs!.has(id))) npcs!.lineStarted(id, addresseeId(info.to));
    });
    events.on('speech:ended', (e) => {
      const id = talkerId(e.speaker);
      if (id) npcs!.lineEnded(id);
    });
    events.on('speech:ended', (e) => pooledVoice.delete(e.speaker));
    new Subtitles(uiRoot, events, settings);
    storyDucker = new StoryDucker(events, audio);

    const say = (id: string, opts?: SayOptions & ScriptSpeechOptions) => {
      if (!dialogue.hasLine(id)) {
        console.warn(`[speech] unknown line "${id}"`);
        return null;
      }
      if (dialogue.line(id).channel === 'pa') {
        return speech!.say(id, { ...opts, at: () => level?.paSpeakerAt(camera.position, opts?.fixture) ?? null });
      }
      const line = dialogue.line(id);
      if (line.channel === 'local' && !opts?.at && speakerHeadAt(line.speaker)) {
        const speaker = line.speaker;
        return speech!.say(id, { ...opts, at: () => speakerHeadAt(speaker) });
      }
      return speech!.say(id, opts);
    };
    const killLines = new Map<string, string>();
    events.on('kill:say', ({ npc, line }) => {
      if (say(line, { overlap: true })) killLines.set(npc, line);
    });
    events.on('kill:cut', ({ npc }) => {
      const line = killLines.get(npc);
      if (line === undefined) return;
      killLines.delete(npc);
      speech!.stop(line);
    });
    events.on('game:restarted', () => {
      speech!.stopAll();
      storyDucker!.reset();
    });

    guidance = new Guidance({
      events,
      input,
      ui: uiRoot,
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
      speech: { speaking: () => speech!.speaking(), say },
      speakerAt: (sp) => {
        if (sp === 'engineer' || sp === 'medic') {
          const p = squad!.mate(sp).position;
          return { x: p.x, y: p.y + 1.6, z: p.z };
        }
        return speakerHeadAt(sp);
      },
      nav: () => world!.navGraph(),
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
      ammo: () => ({
        pistol: { ...viewmodel!.ammoOf('pistol'), mag: viewmodel!.magSize('pistol') },
        ...(viewmodel!.owns('shotgun') ? { shotgun: { ...viewmodel!.ammoOf('shotgun'), mag: viewmodel!.magSize('shotgun') } } : {}),
      }),
      addAmmo: (w, n) => viewmodel!.addReserve(w, n),
      giveWeapon: (w) => {
        if (viewmodel!.owns(w)) return false;
        game.flags[`weapon:${w}`] = true;
        events.emit('weapon:given' as never, { weapon: w } as never);
        viewmodel!.equip(w);
        return true;
      },
      itemName: (id) => inventory.name(id),
      holds: (id) => inventory.satisfies(id),
      keys: (a) => keymap[a],
    });
    setWayfindingSpotlight = (on) => guidance!.setSpotlight(on);

    // Bridge session game modes & menu overlays to AppShell (`title` disposal is registered last, after all session listeners).
    events.on('game:mode', ({ mode }) => {
      menuMusic.setMode(mode);
      ambience?.setMode(mode);
      propAudio?.setMode(mode);
      if (mode !== 'title') {
        shellEvents.emit('game:mode', { mode });
      }
    });
    events.on('game:saveStation', () => shellEvents.emit('game:saveStation', {}));
    events.on('game:map', () => shellEvents.emit('game:map', {}));

    events.on('level:reset', () => {
      ambience?.reset();
      propAudio?.reset();
    });
    events.on('world:sfx', (ev) => propAudio?.onWorldSfx(ev, camera.position));
    events.on('game:restarted', () => menuMusic.cue(null));
    events.on('game:restarted', () => {
      score!.stopAll();
      score!.resume(game.flags);
    });
    for (const name of score.events()) events.on(name as never, () => score!.onEvent(name));
    events.on('score:stinger' as never, (p: { id?: string }) => {
      if (typeof p?.id === 'string') score!.stinger(p.id);
    });
    events.on('player:flashlight', () => roomAudio?.flashlightClick());
    events.on('player:footstep', (f) => {
      waterFx?.footstep(f.x, f.y, f.z, f.landing ? 'land' : f.sprint ? 'sprint' : 'walk', 'player');
      if (game.mode === 'playing' && !game.flying) footsteps!.playPlayer(f);
    });
    events.on('player:damaged', () => audio.muffle(0.4));

    const crosshair = el<HTMLElement>('#crosshair');
    crosshair.hidden = true;
    events.on('game:mode', ({ mode }) => {
      crosshair.hidden = mode !== 'playing';
    });

    events.on('weapon:dryFire', ({ weapon }) => audio.play('dryFire', { bus: 'sfx', gain: 0.8, rate: weapon === 'shotgun' ? 0.88 : 1 }));
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
        case 'pump':
          audio.play('shotgunPump', { bus: 'sfx', gain: 0.8, reverb: 0.2 });
          break;
      }
    });
    events.on('weapon:shellInsert', () => audio.play('shotgunShell', { bus: 'sfx', gain: 0.8, reverb: 0.2, rate: 0.96 + Math.random() * 0.08 }));
    // Shots knock swinging lamps (render-lighting "Swaying lights"): a shotgun blast within 3 m, any shot passing a shade.
    events.on('weapon:fired', ({ weapon }) => {
      if (!level) return;
      const o = camera.getWorldPosition(new THREE.Vector3());
      const dir = camera.getWorldDirection(new THREE.Vector3());
      const hit = collisionWorld?.raycast(o.x, o.y, o.z, dir.x, dir.y, dir.z, 60) ?? null;
      level.joltLightsAlong(o, dir, hit ? hit.distance : 60, weapon === 'shotgun' ? 1.6 : 1.1);
      if (weapon === 'shotgun') level.joltLightsNear(o, 3, 1.4);
    });
    events.on('weapon:fired', ({ weapon }) => {
      if (waterFx && collisionWorld) {
        const o = camera.getWorldPosition(new THREE.Vector3());
        const dir = camera.getWorldDirection(new THREE.Vector3());
        const hit = collisionWorld.raycast(o.x, o.y, o.z, dir.x, dir.y, dir.z, 60);
        waterFx.shot(o, dir, hit ? hit.distance : 60);
      }
      const rate = 0.97 + Math.random() * 0.06;
      if (weapon === 'pistol') audio.play('pistolShot', { bus: 'sfx', gain: 0.6, reverb: 0.35, rate });
      else audio.play('shotgunShot', { bus: 'sfx', gain: 0.9, reverb: 0.4, rate });
    });

    // Spent brass and hulls land on whatever is to Jay's right (in-world-audio: Spent casings; src/audio/casings.ts).
    if (collisionWorld) {
      const cw = collisionWorld;
      const caseAudio = new CasingAudio({
        audio,
        listener: () => camera.position,
        world: {
          raycast: (...ray) => cw.raycast(...ray),
          surfaceAt: (x, y, z) => (world!.surfaceAt ? world!.surfaceAt(x, y, z) : cw.surfaceAt(x, y, z)),
          ...(level && level.water.all().length ? { waterDepth: (x: number, y: number, z: number) => level!.water.depthAt(x, y, z) } : {}),
        },
      });
      casings = caseAudio;
      const eye = new THREE.Vector3();
      const look = new THREE.Vector3();
      ejectOnWeaponEvents(events, (kind) => {
        if (game.mode !== 'playing' || game.flying) return;
        camera.getWorldPosition(eye);
        camera.getWorldDirection(look);
        const len = Math.hypot(look.x, look.z) || 1;
        const fx = look.x / len;
        const fz = look.z / len;
        // The port is just right of and below the sights, inside Jay's own collision radius so it is never in a wall.
        caseAudio.eject({ kind, x: eye.x - fz * 0.1 + fx * 0.15, y: eye.y - 0.2, z: eye.z + fx * 0.1 + fz * 0.15, rightX: -fz, rightZ: fx, forwardX: fx, forwardZ: fz });
      });
      events.on('game:restarted', () => caseAudio.stopAll());
    }
    // Covering fire (squad-sidearms D4): the squad gunshot from the mate's muzzle, the slide kick, and the brass.
    // The squad's muzzle flashes light the room (D7): one shared light, only in a world with a squad.
    if (squad) squadMuzzleLight = new SquadMuzzleLight(scene);
    wireSquadShots({
      events,
      audio,
      casings: () => casings,
      light: squadMuzzleLight,
      body: (id) => squad?.mate(id).body ?? null,
      active: () => game.mode === 'playing' && !game.flying,
    });

    let ambienceRoom: string | null = null;
    events.on('room:entered', (r) => {
      ambienceRoom = r.id;
      audio.setRoomReverb(r.reverb);
      ambience?.enterRoom(r.ambience, level?.roomLights(r.id) ?? []);
    });
    events.on('power:changed', () => {
      if (ambienceRoom) ambience?.rebindLights(level?.roomLights(ambienceRoom) ?? []);
    });

    if (waterFx) {
      events.on('camera:shake', ({ amount }) => waterFx.shake(amount));
      events.on('player:waterJump', (e) => {
        waterFx.takeoff(e.x, e.y, e.z);
        footsteps!.waterJump(e.x, e.y, e.z);
      });
      events.on('game:restarted', () => footsteps!.stopSloshes());
      events.on('game:mode', ({ mode }) => {
        if (mode !== 'playing') footsteps?.stopSloshes();
      });
      events.on('enemy:died', (e) => waterFx.land(e.x, e.y, e.z, 0.9, 'body'));
      events.on('enemy:spawned', (e) => waterFx.land(e.x, e.y, e.z, 0.8, 'body'));
      events.on('game:restarted', () => waterFx.reset());
    }
    events.on('item:given', (it) => toasts!.show('Picked up', it.name));

    if (level) {
      doorAudio = new DoorAudio(audio);
      level.registerInteractions(interactions);
      events.on('door:move', (e) => {
        if (game.mode === 'playing') doorAudio!.onMove(e);
      });
      events.on('door:denied', (d) => {
        toasts!.show('Door', d.reason);
        doorAudio!.onDenied(d.id, level!.anchorPosition('door', d.id));
      });
      events.on('door:unlocked', (d) => {
        toasts!.show('Door unlocked', d.id);
        doorAudio!.onUnlocked(d.id, level!.anchorPosition('door', d.id));
      });
      events.on('access:denied', (d) => {
        hud.showHint(d.hint);
        if (d.kind === 'door') doorAudio!.onDenied(d.id, level!.anchorPosition('door', d.id));
      });
      events.on('level:reset', () => doorAudio!.stopAll());
    } else {
      const { DEMO_INTERACT_BOXES } = await import('../world/demoRoomColliders.ts');
      interactions.add({ id: 'save_station', prompt: 'Use save station', box: DEMO_INTERACT_BOXES.saveStation, use: () => game.openSaveStation() });
      interactions.add({
        id: 'locker_sec07',
        prompt: 'Open locker',
        hold: 0.6,
        box: DEMO_INTERACT_BOXES.locker,
        enabled: () => !game.flags['locker_sec07'],
        use: () => {
          game.flags['locker_sec07'] = true;
          toasts!.show('Locker SEC-07', 'Empty. Someone got here first.');
        },
      });
      interactions.add({
        id: 'lab_b_monitor',
        prompt: 'Read monitor',
        box: DEMO_INTERACT_BOXES.console,
        use: () => toasts!.show('Lab B monitor', 'Specimen B-7: stable. Containment check required.'),
      });
      interactions.add({
        id: 'door_07b_panel',
        prompt: 'Override door',
        hold: 1.0,
        box: DEMO_INTERACT_BOXES.doorPanel,
        use: () => toasts!.show('Access denied', 'Pressure differential · lockdown 07-B'),
      });
    }

    const runSequence = (id: string): void => {
      void import('../actors/debugSequences.ts').then(({ DEBUG_SEQUENCES }) => {
        if (disposed) return;
        const seq = DEBUG_SEQUENCES[id];
        if (!seq) {
          if (sequences?.has(id)) sequences.start(id, { debug: true });
          else console.warn(`[debug] unknown sequence '${id}'. Known: ${[...Object.keys(DEBUG_SEQUENCES), ...(sequences?.ids() ?? [])].join(', ')}`);
          return;
        }
        seq({ player, say: (t, b) => toasts!.show(t, b ?? ''), focus: room?.anchors.door ?? world!.spawn.position }).catch((err: unknown) => console.error(err));
      });
    };

    const applySettings = (): void => {
      if (disposed || !renderer || !post || !world) return;
      const s = settings.get();
      camera.fov = s.fov;
      camera.updateProjectionMatrix();
      applyQuality(renderer, s.quality);
      post.setSize(innerWidth, innerHeight, renderer.getPixelRatio());
      post.setQuality(s.quality);
      waterSystem?.setQuality(s.quality);
      const tier = activeTier(s.quality);
      world.setLightBudget?.(lightBudgetOf(tier));
      setAnisotropy(anisotropyFor(tier, maxAnisotropy));
      setCharacterShadowDistance(tier.characterShadowDistance);
      post.grade.uGrain.value = s.filmGrain ? GRAIN : 0;
      post.setEyeAdaptation(s.eyeAdaptation);
      game.applyVolume();
    };
    applySettings();
    cleanups.push(shellEvents.on('settings:changed', applySettings));

    let levelStats: { drawCalls: number; pool: number } | null = null;
    let lightingOverlay: { update(): void } | null = null;
    const physicsStats = { engine: 'not loaded', stepAvgMs: 0, stepPeakMs: 0 };
    if (launch.debug.enabled) {
      debug = await createDebugTools();
      (globalThis as { __water?: unknown }).__water = { level, waterFx, waterSystem, player, camera, renderer, game, gore, splashes };
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
      fx.add(post.ao, 'enabled').name('ambient occlusion').listen();
      fx.add(post.ao.configuration, 'intensity', 0, 8, 0.05).name('AO strength');
      fx.add(post.ao.configuration, 'aoRadius', 0.1, 5, 0.05).name('AO radius');
      fx.add(post.bloom, 'intensity', 0, 8, 0.05).name('bloom');
      fx.add(post.bloom.luminanceMaterial, 'threshold', 0, 2, 0.01).name('bloom threshold');
      fx.add(post.bloom.mipmapBlurPass, 'radius', 0, 1, 0.01).name('bloom radius');
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
          .onChange((val: string) => ambience!.setOverride(val === 'auto' ? null : val, 1.0));
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
      const onF1 = (e: KeyboardEvent): void => {
        if (e.code !== 'F1') return;
        e.preventDefault();
        if (game.mode === 'playing') game.toggleFly();
      };
      addEventListener('keydown', onF1);
      cleanups.push(() => removeEventListener('keydown', onF1));

      const seqId = launch.debug.seq;
      if (seqId) {
        const off = events.on('game:mode', ({ mode }) => {
          if (mode !== 'playing') return;
          off();
          timers.push(setTimeout(() => runSequence(seqId), 1200));
        });
      }
      const jump = new URLSearchParams(location.search).get('jump');
      if (jump === 'drop' && level) {
        const off = events.on('game:mode', ({ mode }) => {
          if (mode !== 'playing') return;
          off();
          timers.push(
            setTimeout(() => {
              sequences?.cancelAll();
              Object.assign(game.flags, { introSeen: true, briefingSeen: true, rounds_done: true });
              hud.setFade(0, 0.4);
              const at = level!.anchor('gallery_enter');
              if (!at) return console.warn('[debug] jump=drop: no anchor gallery_enter');
              player.placeAtEye(new THREE.Vector3(at.pos.x - 1, at.pos.y + PLAYER_TUNING.eyeHeight, at.pos.z + 1), Math.PI / 4);
            }, 400),
          );
        });
      }
      if (jump === 'hydro' && level) {
        const off = events.on('game:mode', ({ mode }) => {
          if (mode !== 'playing') return;
          off();
          timers.push(
            setTimeout(() => {
              sequences?.cancelAll();
              Object.assign(game.flags, { introSeen: true, briefingSeen: true });
              hud.setFade(0, 0.4);
              const at = level!.anchor('cp_round_hydro') ?? level!.anchor('hydro_entry');
              if (!at) return console.warn('[debug] jump=hydro: no hydro anchor');
              player.placeAtEye(new THREE.Vector3(at.pos.x, at.pos.y + PLAYER_TUNING.eyeHeight, at.pos.z), at.yaw);
            }, 400),
          );
        });
      }
      if (jump && jump !== 'drop' && jump !== 'hydro' && level) {
        const base: Record<string, boolean | number> = { introSeen: true, briefingSeen: true, rounds_done: true, drop_started: true, drop_done: true };
        const steps: Array<[string, string, Record<string, boolean | number>]> = [
          ['r05', 'cp_first_contact', {}],
          ['r06', 'cp_cover_me', { contact_done: true }],
          ['r07', 'cp_security', { cover_done: true, 'giles.infectionStage': 1 }],
          ['r09', 'cp_flooded', { armory_open: true, glass_near: true, sec_done: true, medlab_open: true, 'giles.infectionStage': 3, 'giles.bandaged': true, 'weapon:shotgun': true }],
          // Just before the valve and the flood cutscene (overhaul-flooded-tunnel): an anchor, not a checkpoint.
          ['r10_flood', 'anchor:r10_valve_stand', { tunnel_started: true }],
          ['r11', 'cp_climax', { tunnel_started: true, valve_done: true, 'giles.infectionStage': 3, 'giles.bandaged': true, 'weapon:shotgun': true }],
        ];
        const off = events.on('game:mode', ({ mode }) => {
          if (mode !== 'playing') return;
          off();
          timers.push(
            setTimeout(() => {
              const upto = steps.findIndex(([key]) => key === jump);
              const key = upto >= 0 ? steps[upto]![1] : '';
              const anchor = key.startsWith('anchor:') ? level!.anchor(key.slice(7)) : null;
              const cp = anchor ? { pos: [anchor.pos.x, anchor.pos.y, anchor.pos.z], yaw: (anchor.yaw * 180) / Math.PI } : upto >= 0 ? level!.source.checkpoints?.find((c) => c.id === key) : undefined;
              if (!cp) return console.warn(`[debug] jump=${jump}: use ${steps.map(([k]) => k).join(', ')}`);
              sequences?.cancelAll();
              hud.setFade(0, 0.4);
              Object.assign(game.flags, base);
              for (const [, , add] of steps.slice(0, upto + 1)) Object.assign(game.flags, add);
              sequences?.start('action_restore');
              player.placeAtEye(new THREE.Vector3(cp.pos[0], cp.pos[1] + PLAYER_TUNING.eyeHeight, cp.pos[2]), ((cp.yaw ?? 0) * Math.PI) / 180);
              squad!.requestPlacement();
            }, 400),
          );
        });
      }
      const give = new URLSearchParams(location.search).get('give');
      if (give) {
        events.on('game:mode', ({ mode }) => {
          if (mode === 'playing') for (const id of give.split(',')) inventory.give(id.trim(), 'debug');
        });
      }
      if (level) {
        const { LevelOverlay, OVERLAY_LAYERS } = await import('../world/levelDebug.ts');
        const overlay = new LevelOverlay(level);
        scene.add(overlay.group);
        const lf = gui.addFolder('Level');
        lf.add({ checker: level.debugCheckerEnabled }, 'checker').name('debug checkerboard').onChange((on: boolean) => level!.setDebugChecker(on));
        for (const layer of OVERLAY_LAYERS) lf.add(overlay.visible, layer).name(layer).onChange((on: boolean) => overlay.set(layer, on));
        lf.add({ unlockAll: () => level!.unlock('D2', 'script') }, 'unlockAll').name('unlock D2');
        for (const id of Object.keys(itemTable)) lf.add({ give: () => inventory.give(id, 'debug') }, 'give').name(`give ${inventory.name(id)}`);
        levelStats = { drawCalls: 0, pool: 0 };
        lf.add(levelStats, 'drawCalls').name('visible draw calls').listen().disable();
        lf.add(levelStats, 'pool').name('pooled lights bound').listen().disable();
        // Shadow and fill pools at a glance (shadow-rich-rooms D9).
        const { LightingOverlay } = await import('../world/lightingOverlay.ts');
        const lights = new LightingOverlay(level);
        lightingOverlay = lights;
        scene.add(lights.group);
        cleanups.push(() => lights.dispose());
        lf.add(lights, 'visible').name('lighting overlay');
      }
      enemies.addDebug(gui);
      const { PhysicsDebugView } = await import('../physics/debugView.ts');
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

    const updatePrompt = (): void => {
      if (disposed || !input) return;
      prompt.textContent = 'Click to continue · WASD move · Shift sprint · RMB aim · F flashlight · E use · V shove · Esc pause';
      prompt.hidden = !(game.mode === 'playing' && !input.locked);
    };
    events.on('input:pointerLock', updatePrompt);
    events.on('game:mode', updatePrompt);
    const onCanvasClick = (): void => {
      if (game.mode === 'playing') input?.requestLock();
    };
    canvas.addEventListener('click', onCanvasClick);
    cleanups.push(() => canvas.removeEventListener('click', onCanvasClick));

    // When pointer lock has not been acquired yet (e.g. immediately after async loading or during the intro),
    // pressing Escape must still open the pause menu.
    const onEscapePause = (e: KeyboardEvent): void => {
      if (e.code === 'Escape' && !e.repeat && game.mode === 'playing' && !input?.locked && !guidance?.mapOpen && !tutorials.blocking) {
        e.preventDefault();
        game.pause();
      }
    };
    addEventListener('keydown', onEscapePause);
    cleanups.push(() => removeEventListener('keydown', onEscapePause));

    const onResize = (): void => {
      if (!renderer || !post) return;
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
      post.setSize(innerWidth, innerHeight, renderer.getPixelRatio());
    };
    addEventListener('resize', onResize);
    cleanups.push(() => removeEventListener('resize', onResize));

    const npcCamFwd = { x: 0, z: -1 };
    const scoreFeet = { x: 0, y: 0, z: 0 };
    let simTime = 0;
    loop = new Loop({
      update: (dt) => {
        tutorials.update(dt);
        if (game.mode === 'playing') speech!.update(dt);
        if (tutorials.blocking) {
          input!.endStep();
          return;
        }
        simTime += dt;
        game.update(dt);
        if (game.mode === 'playing' && !game.flying) {
          stepPhysics(dt);
          sequences?.update(dt);
          enemies!.update(dt);
          squad!.update(dt, camera.position);
          npcs!.update(dt, camera.position, cameraForwardXZ(camera, npcCamFwd));
          gore!.update(dt);
          guidance!.update(dt);
          scoreFeet.x = player.body.x;
          scoreFeet.y = player.body.y;
          scoreFeet.z = player.body.z;
          score!.update(dt, scoreFeet, (t) => gameHost.resolve(t as never));
        }
        input!.endStep();
      },
      render: (_alpha, frameDt) => {
        debug?.beginFrame();
        if (game.mode === 'playing') cameraFeeds!.update(frameDt, simTime);
        // One room capture face (or filter) per frame, before the level binds the player's view (room-light-response D1).
        if (roomCaptures) {
          roomCaptures.step(frameDt);
          scene.environment = roomCaptures.texture;
        }
        tutorials.render();
        game.render(frameDt);
        // Optional screenshot view pinning (`window.__view`).
        const view = (globalThis as { __view?: { at: [number, number, number]; look: [number, number, number] } }).__view;
        if (view) {
          camera.position.set(...view.at);
          camera.lookAt(...view.look);
        }
        guidance!.render(frameDt);
        viewmodel!.update(frameDt);
        squadMuzzleLight?.update(frameDt);
        flashlight.update(frameDt);
        world!.update(simTime, frameDt, camera.position, settings.get().reducedFlashing, camera);
        if (level && levelStats) {
          levelStats.drawCalls = level.visibleDrawCalls();
          levelStats.pool = level.pool.boundCount();
        }
        lightingOverlay?.update();
        const lvl = level;
        contactShadows.update(contactBodies, {
          camera: camera.position,
          ...(lvl ? { floorY: (x: number, z: number) => lvl.floorAt(x, z), shadowed: (p: THREE.Vector3) => lvl.shadowPool.covers(p) } : {}),
        });
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
        propAudio?.update(camera.position);
        post!.grade.uDamage.value = game.mode === 'title' || game.flying ? 0 : player.damageFx;
        renderer!.shadowMap.needsUpdate = true;
        const coverFeed = game.mode === 'playing' && !feedGl!.failed ? cameraFeeds!.fullscreen : null;
        if (waterFx && game.mode === 'playing') {
          waterFx.wade('player', player.body.x, player.body.y, player.body.z);
          footsteps!.slosh('player', player.body.x, player.body.y, player.body.z, player.velocity.length(), frameDt);
          waterFx.update(frameDt);
        }
        splashes?.update(frameDt, renderer!.getDrawingBufferSize(splashSize).y, camera.fov);
        sparks?.update(frameDt, splashSize.y, camera.fov);
        if (!coverFeed) {
          waterSystem?.update(renderer!, frameDt, scene, camera);
          post!.render(simTime);
        }
        feedGl!.overlay(coverFeed, coverFeed !== null);
        debug?.endFrame();
      },
    });

    const gameHost = createGameHost({
      saves,
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
      titleCard: (titleCard = new TitleCard(uiRoot, {
        reducedFlashing: () => settings.get().reducedFlashing,
        reducedMotion: () => settings.get().reducedMotion,
      })),
      showCredits: shell.showCredits,
      speech: { say, stopAll: () => speech!.stopAll(), stopChannels: (match) => speech!.stopChannels(match), onlySpeakers: (who) => speech!.onlySpeakers(who) },
      anchors: room ? { door: room.anchors.door, window: room.anchors.window, vent: room.anchors.vent, console: room.anchors.console, abyss: room.anchors.abyss } : undefined,
      setTimeScale: (scale) => {
        loop!.clock.scale = scale;
      },
    });
    sequences = new SequenceManager(gameHost, loadSequences());
    sequences.registerHook('jayArmed', ({ flags: f }) => {
      f['jay_armed'] = viewmodel!.owns('pistol') || viewmodel!.owns('shotgun');
    });
    if (launch.debug.enabled) {
      const { SequenceOverlay } = await import('../script/overlay.ts');
      const overlay = new SequenceOverlay(sequences);
      events.on('game:mode', () => {
        if (!disposed) overlay.update();
      });
      const tickOverlay = (): void => {
        if (disposed) return;
        overlay.update();
        overlayRaf = requestAnimationFrame(tickOverlay);
      };
      tickOverlay();
    }

    // Stage 5 (0.83..0.93): Apply starting game state + chunked GPU texture pre-upload.
    stages.begin('texture-upload');
    loading.setProgress(0.84, 'Uploading textures to GPU…');
    await yieldFrame();
    if (intent.kind === 'load') {
      game.load(intent.save);
    } else if (intent.kind === 'newGame') {
      game.newGame(intent.slot, intent.difficulty);
    } else {
      const slot = saves.firstEmptySlot() ?? 0;
      game.newGame(slot, 'standard');
    }
    // Step sequence once at dt=0 so opening camera placement (e.g. intro_shift_change post_front) is active for warm.
    sequences.update(0);
    game.render(0);
    world.update(0, 1 / 60, camera.position, settings.get().reducedFlashing);
    viewmodel.update(1 / 60);

    const goreTex = gore.prewarm();
    const allTextures = collectTextures([
      scene,
      ...Object.values(materials),
      ...goreTex,
      viewmodel.group,
      squad.group,
      npcs.group,
      enemies.director.group,
    ]);
    for (let i = 0; i < allTextures.length; i += TEXTURE_UPLOAD_BATCH) {
      const batch = allTextures.slice(i, i + TEXTURE_UPLOAD_BATCH);
      for (const tex of batch) renderer.initTexture(tex);
      const frac = Math.min(1, (i + batch.length) / Math.max(1, allTextures.length));
      loading.setProgress(0.84 + frac * 0.08, 'Uploading textures to GPU…');
      await yieldFrame();
    }

    // Stage 6 (0.93..1.00): Pre-warm shaders & render targets across all rooms, cast, enemies, water & CCTV.
    stages.begin('shaders+warm');
    loading.setProgress(0.93, 'Compiling shaders…');
    await yieldFrame();
    waterSystem?.warm(renderer);
    feedGl.warm();

    // Temporarily reveal all rooms + exterior + actors + viewmodel + one representative warm enemy covering custom body shaders.
    const hiddenToRestore: THREE.Object3D[] = [];
    const reveal = (o: THREE.Object3D): void => {
      if (!o.visible) {
        o.visible = true;
        hiddenToRestore.push(o);
      }
    };
    world.group.traverse((o) => {
      if (o.name.startsWith('room:') || o.name === 'exterior' || o === world!.group) reveal(o);
    });
    reveal(squad.group);
    reveal(npcs.group);
    reveal(enemies.director.group);
    reveal(viewmodel.group);
    reveal(gore.group);

    // Warm custom `onBeforeCompile` body shaders (both procedural and imported body model if loaded).
    const warmBodies: Humanoid[] = [];
    const warmCtx = { poses: new PoseLibrary(loadPoseFile(posesJson)), gore, bodyModels, colliders: world.playerWorld.colliders };
    const firstModelId = Object.keys(bodyModels.table).find((id) => bodyModels!.get(id));
    const warmSpecs: Array<{ role: 'enemy'; seed: string; outfit: 'crew'; transformable: true; model?: string }> = [
      { role: 'enemy', seed: 'warm-proc', outfit: 'crew', transformable: true },
      ...(firstModelId ? [{ role: 'enemy' as const, seed: 'warm-model', outfit: 'crew' as const, transformable: true as const, model: firstModelId }] : []),
    ];
    for (const spec of warmSpecs) {
      const h = new Humanoid(spec, warmCtx);
      h.group.position.set(camera.position.x, camera.position.y - 20, camera.position.z);
      scene.add(h.group);
      warmBodies.push(h);
    }

    const rWithAsync = renderer as THREE.WebGLRenderer & { compileAsync?: (s: THREE.Object3D, c: THREE.Camera) => Promise<void> };
    if (typeof rWithAsync.compileAsync === 'function') {
      await rWithAsync.compileAsync(scene, camera);
    } else {
      renderer.compile(scene, camera);
    }
    for (const h of warmBodies) {
      scene.remove(h.group);
      h.dispose();
    }
    for (const o of hiddenToRestore) o.visible = false;

    // Warm render passes through the real post-processing + shadow + water chain while loading screen is still opaque.
    loading.setProgress(0.98, 'Starting station…');
    await yieldFrame();
    world.update(0, 1 / 60, camera.position, settings.get().reducedFlashing);
    viewmodel.update(1 / 60);
    renderer.shadowMap.needsUpdate = true;
    waterSystem?.update(renderer, 1 / 60, scene, camera);
    post.render(0);
    await yieldFrame();
    renderer.shadowMap.needsUpdate = true;
    post.render(1 / 60);

    loading.setProgress(1, 'Ready');
    updatePrompt();
    events.emit('game:booted', { at: performance.now() });
    console.info(`[session] ready in ${(performance.now() - t0).toFixed(0)} ms (${stages.summary()})`);

    // Start throttled background VO decoding (prioritizing intro lines first) after session is ready.
    void voicePlayer
      .loadLines(dialogue.allLines(), { concurrency: 2, idle: true, priority: (l) => l.id.startsWith('intro_') })
      .then((n) => {
        if (!disposed && n > 0) console.info(`[session] loaded ${n} VO clips in background`);
      });

    // Dispose session after all session-internal `game:mode` listeners have handled the transition to title.
    events.on('game:mode', ({ mode }) => {
      if (mode === 'title') shell.onQuitToTitle();
    });

    loop.start();
    return {
      game,
      levelId,
      resetTutorials: () => tutorials.reset(),
      dispose,
    };
  } catch (err) {
    dispose();
    throw err;
  }
}
