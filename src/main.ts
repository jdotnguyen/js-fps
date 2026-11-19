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
import { createMaterialsAsync } from './render/materials.ts';
import { createPost } from './render/post.ts';
import { Flashlight } from './render/flashlight.ts';
import { LIGHT_PATTERNS } from './render/lights.ts';
import { CameraFeeds } from './render/cameraFeed.ts';
import { createFeedGl } from './render/cameraFeedGl.ts';
import { preloadSeabed } from './render/fx/seabed.ts';
import { preloadSubModel } from './render/fx/subModel.ts';
import type { DemoRoom } from './world/demoRoom.ts';
import type { Level } from './world/level.ts';
import type { World } from './world/world.ts';
import type { DemoRoomAudio } from './world/demoRoomAudio.ts';
import { AudioEngine } from './audio/engine.ts';
import { MenuMusic } from './audio/menuMusic.ts';
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
import { startSplash } from './ui/splash.ts';
import { Toasts } from './ui/toast.ts';
import { TutorialPrompts } from './ui/tutorialPrompts.ts';
import { TutorialProfile } from './ui/tutorials.ts';
import { loadWeaponModels } from './render/viewmodel/glbWeapons.ts';
import { Viewmodel } from './render/viewmodel/viewmodel.ts';
import { Squad } from './ai/squad.ts';
import { NpcDirector } from './ai/npcs.ts';
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
// ADR-0024 map + objectives, ADR-0010 speech, barks and hints, ADR-0005/0008 supplies.
import objectivesJson from './data/objectives.json';
import { objectivesValidator } from './data/types/objectives.ts';
import type { MapModel, MapState } from './ui/mapModel.ts';
import { Guidance } from './game/guidance.ts';
import { loadDialogueLibrary } from './dialogue/load.ts';
import { SpeechManager } from './dialogue/speech.ts';
import { WebAudioVoicePlayer } from './dialogue/voicePlayer.ts';
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
  const flags = readDebugFlags(location.search);
  // All data goes through validators so bad JSON fails here with a readable path.
  const keymap = validate(validateKeymap, keymapJson, 'data/keymap.json');
  const difficulties = validate(validateDifficultyTable, difficultyJson, 'data/difficulty.json');
  const saves = new SaveStore(browserStore());
  // Key items and access hint text (ADR-0024).
  const itemTable = validate(validateItemTable, itemsJson, 'data/items.json');
  const uiText = validate(validateUiText, uiTextJson, 'data/dialogue/ui.json');
  const inventory = new Inventory(itemTable, events);

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
  // Start audio and menu theme rendering immediately so "Pressure" builds in parallel with
  // texture/level loading and plays before the splash screens begin.
  const audio = new AudioEngine();
  console.info(`[boot] sounds rendered in ${audio.renderSounds().toFixed(0)} ms`);
  void audio.loadSamples();
  splash.attachAudio(audio);
  const menuMusic = new MenuMusic(audio, 'title');
  menuMusic.start();
  splash.attachMusicReady(menuMusic.ready);
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
  // The game is the slice (ADR-0014): no ?level loads slice01 and New game plays the intro (ADR-0017).
  // ?level=<id> loads another data-driven kit level (ADR-0003, e.g. kit_test); ?level=demo is the hand-built demo room; ?level=lab is the imported underground-laboratory sandbox.
  const levelParam = new URLSearchParams(location.search).get('level');
  const levelId = levelParam === 'demo' || levelParam === 'lab' ? null : (levelParam ?? DEFAULT_LEVEL);
  let room: DemoRoom | null = null;
  let level: Level | null = null;
  let levelSpawns: SpawnPointData[] = [];
  let world: World;
  const [materials] = await Promise.all([
    createMaterialsAsync(texSize, Math.min(8, renderer.capabilities.getMaxAnisotropy())),
    preloadSeabed(import.meta.env.BASE_URL),
    preloadSubModel(import.meta.env.BASE_URL),
  ]);
  let mapModel: MapModel | null = null;
  let mapState: MapState | null = null;
  if (levelId) {
    const file = Object.entries(LEVEL_FILES).find(([path]) => path.endsWith(`/${levelId}.json`));
    if (!file) throw new Error(`No level '${levelId}'. Known: ${Object.keys(LEVEL_FILES).map((f) => f.replace(/^.*\/|\.json$/g, '')).join(', ')}`);
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
    ]);
    const registry = new KitRegistry(validate(validateKitManifest, kitManifestJson, 'data/kit-manifest.json'), undefined);
    const refs = { items: new Set(Object.keys(itemTable)), uiText: new Set(Object.keys(uiText)) };
    const data = validate(levelValidator(registry.ids(), refs), levelJson, `data/levels/${levelId}.json`);
    const debugChecker = new URLSearchParams(location.search).has('checker');
    level = await loadLevel(data, { materials, registry, events, scene, inventory, uiText, debugChecker });
    levelSpawns = spawnPointsOf(data);
    world = level;
    mapModel = buildMapModel(level.source);
    mapState = new MapState(mapModel);
    console.info(`[boot] level '${levelId}' built in ${(performance.now() - t0).toFixed(0)} ms`);
    console.table(level.roomStats());
  } else if (levelParam === 'lab') {
    // Sandbox: the imported underground-laboratory model with baked box collision (src/world/labWorld.ts).
    const { loadLabWorld } = await import('./world/labWorld.ts');
    world = await loadLabWorld(import.meta.env.BASE_URL, scene, materials);
    console.info(`[boot] lab map loaded in ${(performance.now() - t0).toFixed(0)} ms`);
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

  let roomAudio: DemoRoomAudio | null = null;
  if (room) {
    const { DemoRoomAudio } = await import('./world/demoRoomAudio.ts');
    roomAudio = new DemoRoomAudio(audio, room, new Rng('room-audio'));
    roomAudio.start();
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
  // ADR-0009 sequences (also run the ADR-0017 skippable cutscenes). Created once the loop
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
    // The opening needs the dock and kitchen anchors (ADR-0017); other levels start in control.
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
  const tutorials = new TutorialPrompts({
    parent: el<HTMLElement>('#ui'),
    events,
    settings,
    input,
    profile: new TutorialProfile(browserStore()),
    bindings: (a) => keymap[a],
    mode: () => game.mode,
    playTime: () => game.playTime,
    onRails: () => player.onRails || (sequences?.skippable ?? false),
    sequenceRunning: (id) => sequences?.isRunning(id) ?? false,
    flashlightOn: () => flashlight.on,
    focusId: () => interactions.focus?.target.id ?? null,
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
  await bodyModels.load(import.meta.env.BASE_URL);
  const squad = new Squad({
    ctx: { poses: new PoseLibrary(loadPoseFile(posesJson)), gore, bodyModels },
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
  console.info(`[boot] squad built in ${(performance.now() - t1).toFixed(0)} ms`);
  events.on('game:mode', ({ mode }) => {
    squad.group.visible = mode !== 'title';
  });
  // Enemies (ADR-0007): level spawns, player hits, noise; `?enemies=shambler:2,hero` for a quick fight.
  const enemies = setupEnemies({ events, ctx: { poses: new PoseLibrary(loadPoseFile(posesJson)), gore, bodyModels }, world, player, camera, flashlightOn: () => flashlight.on, game, audio, spawns: levelSpawns, squad, search: location.search });
  scene.add(enemies.director.group);
  wireSquadToEnemies(squad, enemies.director, events);
  // Enemies and squadmates open unlocked auto doors as they walk up (level.setActors).
  // (NPCs join below, once the NpcDirector exists.)
  // Scripted NPCs and the cast (ADR-0009/0017/0023): sequences drive them and borrow the squad.
  const npcFeet = new THREE.Vector3();
  const npcHead = new THREE.Vector3();
  const npcs = new NpcDirector({
    ctx: { poses: new PoseLibrary(loadPoseFile(posesJson)), gore, bodyModels },
    nav: world.navGraph(),
    colliders: world.playerWorld.colliders,
    squad,
    player: () => ({ feet: npcFeet.set(player.body.x, player.body.y, player.body.z), head: player.eyePosition(npcHead), wish: player.wish }),
    interact: (item) => interactions.add(item),
    emit: (name, payload) => events.emit(name as never, payload as never),
    sequenceRunning: () => (sequences?.running().length ?? 0) > 0,
  });
  scene.add(npcs.group);
  // Scripted walks path round corners, and everyone (cast, spawned NPCs, squad) is solid to Jay.
  player.setNav(world.navGraph());
  player.setBodies(() => npcs.solidBodies());
  if (level) npcs.spawnFromLevel(level.npcSpawns());
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
  events.on('game:restarted', () => npcs.reset());
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
  // Speech (ADR-0010): one voice at a time with subtitles; lines unknown to the library are skipped.
  const dialogue = loadDialogueLibrary();
  const speech = new SpeechManager(events, dialogue, new WebAudioVoicePlayer(audio));
  squad.setSpeech(speech);
  // ADR-0027: whoever says a line acts it: mouth on the subtitle's syllables, hands and body on the emote.
  wireSpeechActing(events, (speaker) => {
    const id = npcIdForSpeaker(speaker);
    return id && npcs.has(id) ? (npcs.actor(id, false)?.body ?? null) : null;
  });
  new Subtitles(el<HTMLElement>('#ui'), events, settings);
  const say = (id: string, opts?: { overlap?: boolean; at?: () => { x: number; y: number; z: number } }) => {
    if (!dialogue.hasLine(id)) {
      console.warn(`[speech] unknown line "${id}"`);
      return null;
    }
    return speech.say(id, opts);
  };
  events.on('game:mode', ({ mode }) => {
    if (mode === 'title') speech.stopAll();
  });
  events.on('game:restarted', () => speech.stopAll());
  const guidance = new Guidance({
    events,
    input,
    ui: el<HTMLElement>('#ui'),
    scene,
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
      if (sp !== 'engineer' && sp !== 'medic') return null;
      const p = squad.mate(sp).position;
      return { x: p.x, y: p.y + 1.6, z: p.z };
    },
    nav: () => world.navGraph(),
    difficulties,
    preset: () => game.preset,
    flags: () => game.flags,
    mode: () => game.mode,
    busy: () => game.flying || player.onRails || (sequences?.skippable ?? false) || tutorials.blocking,
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
  events.on('game:mode', ({ mode }) => menuMusic.setMode(mode));
  events.on('player:flashlight', () => roomAudio?.flashlightClick());
  events.on('player:footstep', (f) => roomAudio?.footstep(f.surface, f.x, f.z, f.sprint));
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
  events.on('room:entered', (r) => audio.setRoomReverb(r.reverb));

  events.on('item:given', (it) => toasts.show('Picked up', it.name));
  if (level) {
    level.registerInteractions(interactions);
    events.on('door:denied', (d) => toasts.show('Door', d.reason));
    events.on('door:unlocked', (d) => toasts.show('Door unlocked', d.id));
    events.on('access:denied', (d) => hud.showHint(d.hint));
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
    // ?debug&jump=r05|r06|r07|r09|r11: skip the quiet half and start at that action beat with the flags it needs
    // (ADR-0014 Part B). The intro still gets cancelled; doors are re-applied by the `action_restore` sequence.
    const jump = new URLSearchParams(location.search).get('jump');
    if (jump && level) {
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
          Object.assign(game.flags, base);
          for (const [, , add] of steps.slice(0, upto + 1)) Object.assign(game.flags, add);
          sequences?.start('action_restore');
          player.placeAtEye(new THREE.Vector3(cp.pos[0], cp.pos[1] + PLAYER_TUNING.eyeHeight, cp.pos[2]), ((cp.yaw ?? 0) * Math.PI) / 180);
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
      tutorials.update(dt);
      if (game.mode === 'playing') speech.update(dt);
      if (tutorials.blocking) {
        input.endStep();
        return;
      }
      simTime += dt;
      game.update(dt);
      if (game.mode === 'playing' && !game.flying) {
        sequences?.update(dt);
        enemies.update(dt);
        squad.update(dt, camera.position);
        npcs.update(dt, camera.position);
        gore.update(dt);
        guidance.update(dt);
      }
      input.endStep();
    },
    render: (_alpha, frameDt) => {
      debug?.beginFrame();
      // Camera feeds first: they rebind room visibility and lights, which world.update sets back for Jay.
      if (game.mode === 'playing') cameraFeeds.update(frameDt, simTime);
      tutorials.render();
      guidance.render(frameDt);
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
      feedGl.overlay(game.mode === 'playing' ? cameraFeeds.fullscreen : null);
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
      inventory,
      enemies: enemies.director,
      npcs,
      cameraFeeds,
      gore,
      titleCard: new TitleCard(el<HTMLElement>('#ui')),
      showCredits,
      speech: { say: (id: string, opts?: { overlap?: boolean }) => say(id, opts), stopAll: () => speech.stopAll() },
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
