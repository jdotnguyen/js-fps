import type { Game } from './game.ts';

export interface SceneFreezeDeps {
  /** The pause menu, map or save station screen is open, or a tutorial pop-up is. */
  frozen: () => boolean;
  /** The scene's audio engine (`AudioEngine.held`, `setHeld`, `discardHeld`). */
  audio: { readonly held: boolean; setHeld(on: boolean): void; discardHeld(): void };
}

/**
 * The one switch for a frozen scene (game-pause): picture and delays read `frozen` and `time`, and `sync` makes the
 * scene's sound follow. A freeze holds the sound at once. A release waits a microtask, so the restore and quit
 * listeners running in the same call finish first.
 */
export class SceneFreeze {
  private readonly d: SceneFreezeDeps;
  private releasing = false;
  private disposed = false;

  constructor(deps: SceneFreezeDeps) {
    this.d = deps;
  }

  get frozen(): boolean {
    return this.d.frozen();
  }

  /** The time the scene advances by this frame: none while frozen. */
  time(dt: number): number {
    return this.frozen ? 0 : dt;
  }

  /** Call whenever `frozen` may have changed: on a mode change and after the tutorial step. */
  sync(): void {
    if (this.disposed) return;
    if (this.frozen) {
      this.d.audio.setHeld(true);
      return;
    }
    if (!this.d.audio.held || this.releasing) return;
    this.releasing = true;
    queueMicrotask(() => {
      this.releasing = false;
      if (!this.disposed && !this.frozen) this.d.audio.setHeld(false);
    });
  }

  /** The session ends: drop whatever it left held, and release. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.d.audio.discardHeld();
    this.d.audio.setHeld(false);
  }
}

/** Open the pause menu when the tab is hidden during play, captured mouse or not (game-pause). Returns the unhook. */
export function pauseWhenHidden(
  doc: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>,
  game: Pick<Game, 'pause'>,
): () => void {
  const onChange = (): void => {
    if (doc.hidden) game.pause();
  };
  doc.addEventListener('visibilitychange', onChange);
  return () => doc.removeEventListener('visibilitychange', onChange);
}
