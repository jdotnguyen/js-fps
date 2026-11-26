import type { GameMode } from '../game/game.ts';
import type { AudioEngine, LoopHandle } from './engine.ts';
import type { MusicTrack } from './musicTracks.ts';
import type { MusicRendered } from './musicWorker.ts';

/** Menu theme level per game mode: full on the title screen, under the pause menu, off in play. */
const LEVELS: Record<GameMode, { gain: number; timeConstant: number }> = {
  title: { gain: 1, timeConstant: 1.2 },
  paused: { gain: 0.4, timeConstant: 0.5 },
  playing: { gain: 0, timeConstant: 1.5 },
};

/** setTargetAtTime time constants: ~95% of the change lands in 3x this. */
const CUE_FADE_IN = 0.4;
const CUE_FADE_OUT = 0.65;
/** The swap between the theme and a scene's copy of it: quick, so the two are never heard as an echo. */
const HANDOFF_TC = 0.05;
/** The theme leaving a pause screen: gone before it can trail over the scene, or over a pop-up that returns with it. */
const RESUME_TC = 0.08;
/** A cue this soon (s) after play starts from the title takes the playing theme over where it is. */
const TAKEOVER_WINDOW = 1;

/**
 * The menu theme "Pressure" (music.ts), rendered in a worker at boot. The theme loops on the menu engine for the title
 * and pause screens. A sequence that cues the track gets a copy of its own on the scene engine, so it holds with the
 * scene (game-pause); both loops play the one rendered buffer.
 */
export class MenuMusic {
  private readonly menu: AudioEngine;
  private readonly scene: AudioEngine;
  private mode: GameMode;
  private buffer: AudioBuffer | null = null;
  private theme: LoopHandle | null = null;
  /** The menu clock when the theme loop started (s). */
  private themeStart = 0;
  /** The scene's copy, while a sequence has the track cued. */
  private cueLoop: LoopHandle | null = null;
  /** The menu clock when play last started from the title (s), until a cue has used it. */
  private fromTitleAt: number | null = null;
  /** Theme kept silent whatever the mode (the end credits playing the last scene's score); `hold(false)` fades it in. */
  private held = false;
  /** Track a sequence started in play (`{ "do": "music" }`), until stopped. */
  private cued: MusicTrack | null = null;
  /** Level of the cued track (1 = full): a sequence dips it under a sound that has to carry. */
  private cuedLevel = 1;
  private resolveReady!: () => void;
  /** Resolves once the menu theme has finished rendering (or failed to render). */
  readonly ready: Promise<void>;

  constructor(menu: AudioEngine, scene: AudioEngine, mode: GameMode) {
    this.menu = menu;
    this.scene = scene;
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
      this.use(this.menu.createStereo(e.data.left, e.data.right, e.data.sampleRate));
      console.info(`[boot] menu music rendered in ${(performance.now() - t0).toFixed(0)} ms`);
      this.resolveReady();
    };
    worker.onerror = (e): void => {
      console.warn('[audio] menu music failed to render', e.message);
      this.resolveReady();
    };
    worker.postMessage('render');
  }

  /** Loop the rendered theme (`start` calls this when the render lands). */
  use(buffer: AudioBuffer): void {
    this.buffer = buffer;
    this.themeStart = this.menu.ctx.currentTime;
    this.theme = this.menu.loopStereo(buffer);
    this.apply();
  }

  /** Bytes of the rendered theme, held once for both loops (memory probe). */
  decodedBytes(): number {
    return this.buffer ? this.buffer.length * this.buffer.numberOfChannels * 4 : 0;
  }

  setMode(mode: GameMode): void {
    const resumed = mode === 'playing' && this.mode === 'paused';
    if (mode === 'playing' && this.mode === 'title') this.fromTitleAt = this.menu.ctx.currentTime;
    this.mode = mode;
    // Leaving play (title, restart) ends any scripted cue.
    if (mode === 'title') {
      this.cued = null;
      this.fromTitleAt = null;
    }
    this.apply();
    if (resumed) this.theme?.setGain(0, this.cued === null ? RESUME_TC : HANDOFF_TC);
  }

  /** Sequence `music` step: start a track in play at `level` (cueing the playing track again moves it there), or `null` to fade it out (~2 s). */
  cue(track: MusicTrack | null, level = 1): void {
    this.cued = track;
    this.cuedLevel = level;
    this.apply(track === null ? CUE_FADE_OUT : CUE_FADE_IN);
  }

  /** Keep the theme silent (true), or let it come back at the mode's level over about `fadeIn` seconds (false). */
  hold(on: boolean, fadeIn = 3): void {
    this.held = on;
    this.apply(on ? 0.3 : fadeIn / 3);
  }

  get cuedTrack(): MusicTrack | null {
    return this.cued;
  }

  private apply(timeConstant?: number): void {
    // A scene's cue starting while the title theme is still sounding carries straight on from it.
    const takeover =
      this.cued !== null && this.cueLoop === null && this.fromTitleAt !== null && this.menu.ctx.currentTime - this.fromTitleAt < TAKEOVER_WINDOW;
    const level = LEVELS[this.mode];
    const underCue = this.mode === 'playing' && this.cued !== null;
    this.theme?.setGain(this.held ? 0 : level.gain, underCue ? HANDOFF_TC : (timeConstant ?? level.timeConstant));
    if (this.cued === null) {
      this.cueLoop?.stop(CUE_FADE_OUT * 3);
      this.cueLoop = null;
      return;
    }
    if (!this.buffer) return;
    const fresh = this.cueLoop === null;
    if (fresh) {
      this.cueLoop = this.scene.loopStereo(this.buffer, (this.menu.ctx.currentTime - this.themeStart) % this.buffer.duration);
      this.fromTitleAt = null;
    }
    // Only a cue moves the scene's copy: pausing leaves it as it is, to carry on from there.
    if (fresh || timeConstant !== undefined) this.cueLoop!.setGain(this.cuedLevel, takeover ? HANDOFF_TC : (timeConstant ?? CUE_FADE_IN));
  }
}
