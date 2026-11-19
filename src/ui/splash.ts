/**
 * Boot splash sequence:
 *   0. Loading screen (`#splash-loader`): mirrors boot progress while assets and the menu theme
 *      ("Pressure") render in parallel. Once ready, if browser autoplay keeps audio suspended,
 *      prompts for a click/keypress so the music starts *before* the splash screens begin.
 *   1. Engine splash (`#splash-engine`): "JUST-IN-TIME — REAL-TIME 3D ENGINE" with visor + light sweep.
 *   2. Developer splash (`#splash-dev`): "J00K80" with visor + volumetric lighting + flicker
 *      (or the legacy zombie act with `?zombiesplash`).
 *
 * Escape, Enter, Space or a click advances/skips the active splash stage once loading is done.
 * Add `?nosplash` to the URL to skip the splash while developing.
 */
import type { AudioEngine } from '../audio/engine.ts';
import { ZOMBIE_SPLASH_VARIANT } from '../audio/sounds.ts';
import { playAct, type Act, type ActSounds } from './splashAct.ts';
import { playVisorSplash, VISOR_ACT_LENGTH } from './splashVisor.ts';

const ENGINE_SPLASH_SEC = 4.2;
const REDUCED_HOLD_MS = 3200;
const FADE_OUT_MS = 700;

export interface Splash {
  /** Give the splash the audio engine once it exists. */
  attachAudio(audio: AudioEngine): void;
  /** Give the splash a promise that resolves when the menu theme has rendered. */
  attachMusicReady(ready: Promise<void>): void;
  /** Boot succeeded: wait for music + audio unlock, play engine & dev splashes, then fade out. */
  finish(): Promise<void>;
  /** Boot failed: drop the splash at once so the error box is visible. */
  abort(): void;
}

const noop: Splash = {
  attachAudio: () => undefined,
  attachMusicReady: () => undefined,
  finish: () => Promise.resolve(),
  abort: () => undefined,
};

function waitForGesture(root: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      removeEventListener('keydown', onKey, { capture: true });
      root.removeEventListener('pointerdown', done);
      resolve();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (!e.repeat) done();
    };
    addEventListener('keydown', onKey, { capture: true });
    root.addEventListener('pointerdown', done);
  });
}

export function startSplash(root: HTMLElement | null, search = location.search): Splash {
  if (!root) return noop;
  const params = new URLSearchParams(search);
  if (params.has('nosplash') || params.has('vmlab')) {
    root.remove();
    return noop;
  }

  const zombieEasterEgg = params.has('zombiesplash');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const loaderEl = root.querySelector<HTMLElement>('#splash-loader');
  const barEl = root.querySelector<HTMLElement>('.splash-bar');
  const status = root.querySelector<HTMLElement>('#splash-status');
  const engineEl = root.querySelector<HTMLElement>('#splash-engine');
  const devEl = root.querySelector<HTMLElement>('#splash-dev');
  const logo = root.querySelector<HTMLImageElement>('#splash-dev img');

  let audio: AudioEngine | null = null;
  let musicReady: Promise<void> = Promise.resolve();
  let activeAct: Act | null = null;
  let skipStage: (() => void) | null = null;

  const onSkipInput = (e: Event): void => {
    if (!skipStage) return;
    if (e instanceof KeyboardEvent && (e.repeat || !['Escape', 'Enter', ' '].includes(e.key))) return;
    skipStage();
  };
  addEventListener('keydown', onSkipInput, { capture: true });
  root.addEventListener('pointerdown', onSkipInput);

  // Mirror the loading prompt ("Generating textures…") during Stage 0.
  const prompt = document.querySelector<HTMLElement>('#prompt');
  const mirror = (): void => {
    if (status && prompt && !status.classList.contains('prompt')) {
      status.textContent = prompt.hidden ? '' : (prompt.textContent ?? '');
    }
  };
  const observer = new MutationObserver(mirror);
  if (prompt) observer.observe(prompt, { attributes: true, childList: true, characterData: true, subtree: true });
  mirror();

  const say = (name: Parameters<AudioEngine['play']>[0], opts: Parameters<AudioEngine['play']>[1]): void => {
    if (!audio || audio.ctx.state !== 'running') return;
    try {
      audio.play(name, { bus: 'sfx', ...opts });
    } catch {
      // Sample not loaded yet: stay silent rather than break the splash.
    }
  };
  const zombieSounds: ActSounds = {
    voice: () => say('zombieVoice', { gain: 0.85, reverb: 0.15, variant: ZOMBIE_SPLASH_VARIANT }),
    shot: () => say('shotgunShot', { gain: 0.9, reverb: 0.4, rate: 0.97 + Math.random() * 0.06 }),
    pump: () => say('shotgunPump', { gain: 0.8, reverb: 0.2 }),
  };

  const cleanup = (): void => {
    observer.disconnect();
    removeEventListener('keydown', onSkipInput, { capture: true });
    root.removeEventListener('pointerdown', onSkipInput);
  };

  const runCard = async (el: HTMLElement | null, target: HTMLElement | null, sec: number): Promise<void> => {
    if (!el) return;
    el.hidden = false;
    await new Promise<void>((resolve) => {
      let timer = 0;
      const done = (): void => {
        clearTimeout(timer);
        skipStage = null;
        activeAct?.stop();
        activeAct = null;
        resolve();
      };
      skipStage = done;
      if (!reduceMotion && target) {
        activeAct = playVisorSplash(root, target, sec);
        void activeAct.finished.then(done);
      } else {
        timer = window.setTimeout(done, REDUCED_HOLD_MS);
      }
    });
    el.hidden = true;
  };

  return {
    attachAudio(engine) {
      audio = engine;
    },
    attachMusicReady(ready) {
      musicReady = ready;
    },
    async finish() {
      // Wait for the menu theme worker so music is ready before any splash screen begins.
      await musicReady;
      observer.disconnect();

      if (audio && audio.ctx.state !== 'running') {
        barEl?.classList.add('ready');
        if (status) {
          status.classList.add('prompt');
          status.textContent = 'CLICK OR PRESS ANY KEY TO START';
        }
        await waitForGesture(root);
        await audio.resume().catch(() => undefined);
      }

      if (loaderEl) loaderEl.hidden = true;

      // Stage 1: Engine splash ("JUST-IN-TIME").
      await runCard(engineEl, engineEl, ENGINE_SPLASH_SEC);

      // Stage 2: Developer splash ("J00K80").
      if (zombieEasterEgg && !reduceMotion && devEl && logo) {
        devEl.hidden = false;
        await new Promise<void>((resolve) => {
          const done = (): void => {
            skipStage = null;
            activeAct?.stop();
            activeAct = null;
            resolve();
          };
          skipStage = done;
          try {
            activeAct = playAct(root, logo, zombieSounds);
            void activeAct.finished.then(done);
          } catch (err) {
            console.warn('[splash] zombie act failed', err);
            logo.style.visibility = '';
            done();
          }
        });
      } else {
        await runCard(devEl, logo, VISOR_ACT_LENGTH);
      }

      cleanup();
      root.classList.add('out');
      await new Promise((r) => setTimeout(r, FADE_OUT_MS));
      root.remove();
    },
    abort() {
      skipStage = null;
      activeAct?.stop();
      cleanup();
      root.remove();
    },
  };
}
