import type { GameMode } from '../game/game.ts';
import type { AudioEngine, LoopHandle } from './engine.ts';
import type { MusicRendered } from './musicWorker.ts';

/** Music level per game mode: full on the title screen, ducked under the pause menu, off in play. */
const LEVELS: Record<GameMode, { gain: number; timeConstant: number }> = {
  title: { gain: 1, timeConstant: 1.2 },
  paused: { gain: 0.4, timeConstant: 0.5 },
  playing: { gain: 0, timeConstant: 1.5 },
};

/**
 * The menu theme "Pressure" (music.ts). Rendered in a worker at boot, then looped on the music
 * bus and faded by game mode. Until the render lands (a few seconds) the menu is simply quiet.
 */
export class MenuMusic {
  private readonly engine: AudioEngine;
  private mode: GameMode;
  private handle: LoopHandle | null = null;

  constructor(engine: AudioEngine, mode: GameMode) {
    this.engine = engine;
    this.mode = mode;
  }

  start(): void {
    const t0 = performance.now();
    const worker = new Worker(new URL('./musicWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<MusicRendered>): void => {
      worker.terminate();
      this.handle = this.engine.loopStereo(e.data.left, e.data.right, e.data.sampleRate);
      console.info(`[boot] menu music rendered in ${(performance.now() - t0).toFixed(0)} ms`);
      this.apply();
    };
    worker.onerror = (e): void => console.warn('[audio] menu music failed to render', e.message);
    worker.postMessage('render');
  }

  setMode(mode: GameMode): void {
    this.mode = mode;
    this.apply();
  }

  private apply(): void {
    const level = LEVELS[this.mode];
    this.handle?.setGain(level.gain, level.timeConstant);
  }
}
