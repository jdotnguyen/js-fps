import keymapJson from '../data/keymap.json';
import difficultyJson from '../data/difficulty.json';
import itemsJson from '../data/items.json';
import uiTextJson from '../data/dialogue/ui.json';
import scoresJson from '../data/scores.json';
import { validateKeymap } from '../data/types/keymap.ts';
import { validateDifficultyTable } from '../data/types/difficulty.ts';
import { validateItemTable } from '../data/types/items.ts';
import { validateUiText } from '../data/types/uiText.ts';
import { validateScoreTable } from '../data/types/scores.ts';
import { EventBus } from '../core/events.ts';
import type { MemProbe } from '../core/memProbe.ts';
import { SettingsStore, type Settings } from '../core/settings.ts';
import { persistentStore } from '../core/storage.ts';
import { validate } from '../core/validate.ts';
import { readDetailFlag } from '../actors/detailPass.ts';
import { AudioEngine, UI_SOUND_NAMES } from '../audio/engine.ts';
import { MenuMusic } from '../audio/menuMusic.ts';
import { applyBusVolumes } from '../audio/volume.ts';
import type { ScorePlayer } from '../audio/scorePlayer.ts';
import { SaveStore } from '../game/save.ts';
import { createMenus } from '../ui/menus/screens.ts';
import { TitleBackdrop2D } from '../ui/menus/titleBackdrop.ts';
import { LoadingScreen } from '../ui/loadingScreen.ts';
import type { EndCredits } from '../ui/credits.ts';
import { startSplash } from '../ui/splash.ts';
import { SessionCoordinator } from './coordinator.ts';
import { DEFAULT_LEVEL, parseLaunchPlan } from './launch.ts';
import { IdleGate, TITLE_SLICE_MS } from './titleIdle.ts';
import { TitleArming } from './titleArming.ts';
import { ITEMS, realSharedLoaders } from './titlePrepare.ts';
import { probeGpuLimits } from '../render/gpuProbe.ts';

/** Seconds the last scene's score takes to fade under the menu theme when the end credits close. */
const CREDITS_SCORE_FADE = 3;

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

/**
 * Fast shell-only application boot (session-loading spec):
 * initializes settings, saves, UI audio, MenuMusic, splash, 2D title backdrop, and `#menu`
 * with zero WebGL context and zero 3D/level downloads until the player starts/loads a session
 * (or opens a debug/sandbox auto-load URL).
 */
export async function bootApp(): Promise<void> {
  const splash = startSplash(document.querySelector<HTMLElement>('#splash'));
  try {
    const launch = parseLaunchPlan(location.search);
    readDetailFlag(location.search);

    const shellEvents = new EventBus();
    const settings = new SettingsStore(shellEvents);
    const keymap = validate(validateKeymap, keymapJson, 'data/keymap.json');
    const difficulties = validate(validateDifficultyTable, difficultyJson, 'data/difficulty.json');
    const itemTable = validate(validateItemTable, itemsJson, 'data/items.json');
    const uiText = validate(validateUiText, uiTextJson, 'data/dialogue/ui.json');
    const scores = validate(validateScoreTable, scoresJson, 'data/scores.json');

    const saves = new SaveStore(persistentStore(launch.scratch));
    if (launch.scratch) {
      const badge = document.createElement('div');
      badge.textContent = 'SCRATCH SESSION · SAVES NOT KEPT';
      badge.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:30;font:11px monospace;letter-spacing:.08em;color:#9fd;opacity:.7;pointer-events:none;';
      document.body.appendChild(badge);
      console.info('[save] scratch session: saves and tutorial progress stay in memory');
    }

    const memProbe: MemProbe | null = launch.memprobe ? (await import('../core/memProbe.ts')).installMemProbe() : null;

    // `?vmlab` bypasses the shell and launches the viewmodel lab directly.
    if (launch.vmlab) {
      const prompt = document.querySelector<HTMLElement>('#prompt');
      if (prompt) prompt.hidden = true;
      document.querySelector<HTMLElement>('#ui')?.setAttribute('hidden', '');
      document.querySelector<HTMLElement>('#menu')?.setAttribute('hidden', '');
      const [{ createRenderer }, { runLab }] = await Promise.all([import('../render/renderer.ts'), import('../render/viewmodel/lab.ts')]);
      const renderer = createRenderer(el<HTMLCanvasElement>('#game'), settings.get());
      await runLab(renderer);
      return;
    }

    // Boot audio with UI sounds + MenuMusic only (no gameplay SFX synthesis or 140-file sample storm on title).
    const audio = new AudioEngine();
    console.info(`[boot] UI sounds rendered in ${audio.renderSounds(UI_SOUND_NAMES).toFixed(0)} ms`);
    void audio.loadUiSamples();
    const applyShellVolume = (): void => {
      const s = settings.get();
      audio.setMasterVolume(s.masterVolume);
      applyBusVolumes(audio, s);
    };
    applyShellVolume();
    memProbe?.attach({
      threeInfo: () => ({ geometries: 0, textures: 0 }),
      audioBytes: () => audio.decodedBytes(),
    });

    splash.attachAudio(audio);
    const menuMusic = new MenuMusic(audio, 'title');
    menuMusic.start();
    addEventListener('pointerdown', () => void audio.resume(), { capture: true });
    addEventListener('keydown', () => void audio.resume(), { capture: true });

    const backdrop = new TitleBackdrop2D(document.body, {
      reducedMotion: () => settings.get().reducedMotion,
      reducedFlashing: () => settings.get().reducedFlashing,
    });
    const loadingScreen = new LoadingScreen(document.body, {
      reducedMotion: () => settings.get().reducedMotion,
    });
    shellEvents.on('settings:changed', () => {
      if (!coordinator.active) applyShellVolume();
      backdrop.refresh();
      arming.qualityChanged(); // a new graphics quality discards what the title made for the old one
    });

    // End credits (lazy chunk).
    const menuRoot = el<HTMLElement>('#menu');
    let credits: EndCredits | null = null;
    let creditsLoad: Promise<EndCredits> | null = null;
    const loadCredits = (): Promise<EndCredits> =>
      (creditsLoad ??= Promise.all([import('../ui/credits.ts'), import('../ui/styles/credits.css')]).then(([{ EndCredits: Ctor }]) => {
        credits = new Ctor(document.body, {
          reducedMotion: () => settings.get().reducedMotion,
          reducedFlashing: () => settings.get().reducedFlashing,
        });
        return credits;
      }));
    let activeScore: ScorePlayer | null = null;
    let creditsScore = false;
    const endCreditsScore = (): void => {
      if (!creditsScore) return;
      creditsScore = false;
      activeScore?.fadeOutAll(CREDITS_SCORE_FADE);
      menuMusic.hold(false, CREDITS_SCORE_FADE);
    };
    const showCredits = (opts: { instant?: boolean } = {}): Promise<void> => {
      if (opts.instant && activeScore?.playing) {
        creditsScore = true;
        menuMusic.hold(true);
      }
      return loadCredits()
        .then((c) =>
          c.show(() => {
            endCreditsScore();
            if (!menuRoot.hidden) {
              menuRoot.querySelector<HTMLElement>('[autofocus], button, input, select')?.focus();
            }
          }, opts),
        )
        .catch((e: unknown) => {
          creditsLoad = null;
          endCreditsScore();
          console.error('[credits]', e);
        });
    };

    let coordinator!: SessionCoordinator;

    // What the title prepares for the first load (title-preload spec): armed on each title, held off the menu's back.
    const idle = new IdleGate();
    // Work that cannot be cut into small steps (preparing the cast's body models) waits for the splash to end: nothing
    // animates on the title after it, so those stalls land where they are not seen.
    let splashOver!: () => void;
    const afterSplash = new Promise<void>((resolve) => (splashOver = resolve));
    const idleAfterSplash = async (): Promise<void> => {
      await afterSplash;
      await idle.wait();
    };
    for (const type of ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const) menuRoot.addEventListener(type, () => idle.touch(), { capture: true, passive: true });
    const arming = new TitleArming({
      defaultLevel: DEFAULT_LEVEL,
      quality: () => settings.get().quality,
      probe: () => probeGpuLimits(),
      worldAllowed: !launch.checker,
      current: () => coordinator.currentPreload,
      loaders: (preload, limits) =>
        realSharedLoaders({
          baseUrl: import.meta.env.BASE_URL,
          physicsSetting: () => settings.get().physics,
          search: location.search,
          audio,
          yieldTo: idleAfterSplash,
          quality: () => preload.current.quality,
          world: () =>
            limits
              ? {
                  levelId: preload.current.levelId,
                  quality: preload.current.quality as Settings['quality'],
                  caps: { maxTextures: limits.maxTextures, maxFragmentUniforms: limits.maxFragmentUniforms },
                  itemTable,
                  uiText,
                  materials: () => preload.peek(ITEMS.materials),
                  yieldTo: idle.wait,
                  sliceMs: TITLE_SLICE_MS,
                }
              : null,
        }),
    });
    const menu = createMenus(menuRoot, {
      game: {
        get slot() {
          return coordinator.menuAdapter().slot;
        },
        get difficulty() {
          return coordinator.menuAdapter().difficulty;
        },
        get playTime() {
          return coordinator.menuAdapter().playTime;
        },
        get location() {
          return coordinator.menuAdapter().location;
        },
        newGame: (slot, difficulty) => coordinator.menuAdapter().newGame(slot, difficulty),
        load: (save) => coordinator.menuAdapter().load(save),
        resume: () => coordinator.menuAdapter().resume(),
        setDifficulty: (id) => coordinator.menuAdapter().setDifficulty(id),
        manualSave: () => coordinator.menuAdapter().manualSave(),
        quitToTitle: () => coordinator.menuAdapter().quitToTitle(),
      },
      saves,
      settings,
      difficulties,
      events: shellEvents,
      resetTutorials: () => {
        if (coordinator.active) {
          coordinator.active.resetTutorials();
        } else {
          // Clear persisted tutorial profile directly when invoked from the title menu.
          void import('../ui/tutorials.ts').then(({ TutorialProfile }) => new TutorialProfile(persistentStore(launch.scratch)).clear());
        }
      },
      showCredits: () => void showCredits(),
    });

    coordinator = new SessionCoordinator({
      showTitleBackdrop: () => backdrop.start(),
      hideTitleBackdrop: () => backdrop.stop(),
      showTitleMenu: () => shellEvents.emit('game:mode', { mode: 'title' }),
      hideMenu: () => menu.hide(),
      showLoading: (title) => loadingScreen.show(title),
      hideLoading: () => loadingScreen.hide(),
      showLoadError: (msg, onBack) => loadingScreen.showError(msg, onBack),
      createPreload: () => arming.create(),
      setTitleMusic: () => {
        if (!creditsScore) activeScore?.stopAll();
        menuMusic.setMode('title');
      },
      createSession: async (intent, preload) => {
        const { createPlaySession } = await import('./session.ts');
        return createPlaySession(
          {
            settings,
            saves,
            keymap,
            difficulties,
            itemTable,
            uiText,
            scores,
            audio,
            menuMusic,
            shellEvents,
            memProbe,
            launch,
            loading: loadingScreen,
            showCredits,
            onQuitToTitle: () => coordinator.enterTitle(),
            setActiveScore: (s) => {
              activeScore = s;
            },
          },
          intent,
          preload,
        );
      },
    });

    // Menu UI hover / click / open sounds.
    const menuControl = (t: EventTarget | null): HTMLElement | null =>
      t instanceof Element ? t.closest<HTMLElement>('button:not([disabled]), select, input') : null;
    let lastMenuHover: HTMLElement | null = null;
    menuRoot.addEventListener('pointerover', (e) => {
      const c = menuControl(e.target);
      if (!c || c === lastMenuHover) return;
      lastMenuHover = c;
      if (audio.hasSound('uiHover')) audio.play('uiHover', { bus: 'ui', gain: 0.8, rate: 0.97 + Math.random() * 0.06 });
    });
    menuRoot.addEventListener('pointerout', (e) => {
      if (menuControl(e.target) === lastMenuHover && !menuControl(e.relatedTarget)) lastMenuHover = null;
    });
    menuRoot.addEventListener('keydown', (e) => {
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && menuControl(e.target) && audio.hasSound('uiHover')) {
        audio.play('uiHover', { bus: 'ui', gain: 0.8, rate: 0.97 + Math.random() * 0.06 });
      }
    });
    const playMenuOpen = (): void => {
      try {
        audio.play('uiMenuOpen', { bus: 'ui', gain: 0.8, reverb: 0.1 });
      } catch {
        /* sample not loaded (yet) */
      }
    };
    let menuOpenPending = false;
    const onMenuShown = (): void => {
      if (credits?.open) return;
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
        if (!menuRoot.hidden && !credits?.open) playMenuOpen();
      });
    };
    addEventListener('pointerdown', flushPendingMenuOpen, { capture: true, once: false });
    addEventListener('keydown', flushPendingMenuOpen, { capture: true, once: false });
    menuRoot.addEventListener('click', (e) => {
      if (menuControl(e.target)?.tagName === 'BUTTON' && audio.hasSound('uiSelect')) {
        audio.play('uiSelect', { bus: 'ui', gain: 0.65, reverb: 0.1 });
      }
    });

    // Expose shell booted state before finishing splash.
    if (launch.autoLoad) {
      // Dev/sandbox URL: bypass title menu and launch session loading immediately after splash.
      await splash.finish();
      splashOver();
      await coordinator.start({ kind: 'autoLoad', plan: launch.autoLoad });
    } else {
      coordinator.enterTitle();
      shellEvents.emit('game:booted', { at: performance.now() });
      await splash.finish();
      splashOver();
    }
  } catch (err: unknown) {
    splash.abort();
    showBootError(err);
  }
}
