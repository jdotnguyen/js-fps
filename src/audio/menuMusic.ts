import type { GameMode } from '../game/game.ts';
import type { AudioEngine, LoopHandle } from './engine.ts';
import type { MusicTrack } from './musicTracks.ts';
import type { MusicRendered } from './musicWorker.ts';

/** Music level per game mode: full on the title screen, ducked under the pause menu, off in play. */
const LEVELS: Record<GameMode, { gain: number; timeConstant: number }> = {
  title: { gain: 1, timeConstant: 1.2 },
  paused: { gain: 0.4, timeConstant: 0.5 },
  playing: { gain: 0, timeConstant: 1.5 },
};

/** setTargetAtTime time constants: ~95% of the change lands in 3x this. */
const CUE_FADE_IN = 0.4;
const CUE_FADE_OUT = 0.65;

/**
 * The menu theme "Pressure" (music.ts). Rendered in a worker at boot, then looped on the music
 * bus and faded by game mode. Until the render lands (a few seconds) the menu is simply quiet.
 */
export class MenuMusic {
  private readonly engine: AudioEngine;
  private mode: GameMode;
  private handle: LoopHandle | null = null;
  /** Track a sequence started in play (`{ "do": "music" }`); overrides the mode level until stopped. */
  private cued: MusicTrack | null = null;
  private resolveReady!: () => void;
  /** Resolves once the menu theme has finished rendering (or failed to render). */
  readonly ready: Promise<void>;

  constructor(engine: AudioEngine, mode: GameMode) {
    this.engine = engine;
    this.mode = mode;
    this.ready = new Promise<void>((r) => {
      this.resolveReady = r;
    });
  }

  start(): void {
    const t0 = performance.now();
    const worker = new Worker(new URL('./musicWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<MusicRendered>): void => {
      worker.terminate();
      this.handle = this.engine.loopStereo(e.data.left, e.data.right, e.data.sampleRate);
      console.info(`[boot] menu music rendered in ${(performance.now() - t0).toFixed(0)} ms`);
      this.apply();
      this.resolveReady();
    };
    worker.onerror = (e): void => {
      console.warn('[audio] menu music failed to render', e.message);
      this.resolveReady();
    };
    worker.postMessage('render');
  }

  setMode(mode: GameMode): void {
    this.mode = mode;
    // Leaving play (title, restart) ends any scripted cue.
    if (mode === 'title') this.cued = null;
    this.apply();
  }

  /** Sequence `music` step: start a track at full level in play, or `null` to fade it out (~2 s). */
  cue(track: MusicTrack | null): void {
    this.cued = track;
    this.apply(track === null ? CUE_FADE_OUT : CUE_FADE_IN);
  }

  get cuedTrack(): MusicTrack | null {
    return this.cued;
  }

  private apply(timeConstant?: number): void {
    const level = LEVELS[this.mode];
    // A cued track plays at full level in play, and keeps the pause-menu dip.
    const gain = this.cued && this.mode !== 'title' ? (this.mode === 'paused' ? LEVELS.paused.gain : 1) : level.gain;
    this.handle?.setGain(gain, timeConstant ?? level.timeConstant);
  }
}
