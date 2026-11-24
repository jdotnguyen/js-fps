import type { DifficultyId } from '../data/types/difficulty.ts';
import type { SaveData } from '../game/save.ts';
import type { MenuGameAdapter } from '../ui/menus/screens.ts';
import type { PlaySession, SessionIntent } from './session.ts';
import type { TitlePreload } from './titlePreload.ts';

export interface SessionLifecycleHost {
  showTitleBackdrop(): void;
  hideTitleBackdrop(): void;
  showTitleMenu(): void;
  hideMenu(): void;
  showLoading(title: string): void;
  hideLoading(): Promise<void>;
  showLoadError(message: string, onBack: () => void): void;
  setTitleMusic(): void;
  /** `preload` is what the title prepared for this load, or null (auto-load URLs, or no preparation). The session adopts what matches. */
  createSession(intent: SessionIntent, preload: TitlePreload | null): Promise<PlaySession>;
  /** A fresh holder for the title being entered, with its preparation started; null when nothing should be prepared. */
  createPreload?(): TitlePreload | null;
}

/**
 * Coordinates the shell <-> play-session lifecycle: ensures only one load runs at a time,
 * disposes the active session completely on Quit to title, and recovers cleanly from load errors.
 */
export class SessionCoordinator {
  private session: PlaySession | null = null;
  private loading = false;
  private preload: TitlePreload | null = null;
  private readonly host: SessionLifecycleHost;

  constructor(host: SessionLifecycleHost) {
    this.host = host;
  }

  get active(): PlaySession | null {
    return this.session;
  }

  /** What the title currently holds for the next load; null while a session has it or none was made. */
  get currentPreload(): TitlePreload | null {
    return this.preload;
  }

  get isLoading(): boolean {
    return this.loading;
  }

  /** Arm title-preload without entering the title menu (e.g. while the splash plays before an auto-load). */
  armPreload(): void {
    this.preload?.dispose();
    this.preload = this.host.createPreload?.() ?? null;
  }

  /** Enter the lightweight non-WebGL title state, disposing any active session first. */
  enterTitle(): void {
    if (this.session) {
      const s = this.session;
      this.session = null;
      s.dispose();
    }
    // A new holder per title: nothing a disposed session adopted is ever reused (title-preload spec).
    this.preload?.dispose();
    this.preload = this.host.createPreload?.() ?? null;
    this.host.setTitleMusic();
    this.host.showTitleBackdrop();
    this.host.showTitleMenu();
  }

  /** Start a new game, load a save, or auto-launch a debug/sandbox session. */
  async start(intent: SessionIntent): Promise<boolean> {
    if (this.loading) return false;
    // Loading a save from the pause menu within the same already-loaded level restores immediately.
    if (intent.kind === 'load' && this.session && (this.session.levelId === null || this.session.levelId === intent.save.level)) {
      this.session.game.load(intent.save);
      return true;
    }

    this.loading = true;
    if (this.session) {
      const prev = this.session;
      this.session = null;
      prev.dispose();
    }

    const preload = this.preload;
    this.preload = null;
    this.host.hideMenu();
    this.host.hideTitleBackdrop();
    const title =
      intent.kind === 'load'
        ? `LOADING // ${(intent.save.location || 'SECTION 07').toUpperCase()}`
        : intent.kind === 'autoLoad' && intent.plan.levelParam
          ? `LOADING // ${intent.plan.levelParam.toUpperCase()}`
          : 'THALASSA // DEPLOYING';
    this.host.showLoading(title);

    try {
      const next = await this.host.createSession(intent, preload);
      this.session = next;
      this.loading = false;
      preload?.dispose(); // releases whatever the session did not adopt; adopted items are the session's now
      await this.host.hideLoading();
      return true;
    } catch (err) {
      this.loading = false;
      preload?.dispose();
      console.error('[session] failed to load', err);
      const message = err instanceof Error ? err.message : String(err);
      this.host.showLoadError(message, () => {
        void this.host.hideLoading().then(() => this.enterTitle());
      });
      return false;
    }
  }

  /** Menu adapter exposed to `createMenus`, delegating title actions to `start` and pause actions to the active session. */
  menuAdapter(): MenuGameAdapter {
    const self = this;
    return {
      get slot() {
        return self.session?.game.slot ?? 0;
      },
      get difficulty(): DifficultyId {
        return self.session?.game.difficulty ?? 'standard';
      },
      get playTime() {
        return self.session?.game.playTime ?? 0;
      },
      get location() {
        return self.session?.game.location ?? '';
      },
      newGame(slot: number, difficulty: DifficultyId) {
        void self.start({ kind: 'newGame', slot, difficulty });
      },
      load(save: SaveData) {
        void self.start({ kind: 'load', save });
      },
      resume() {
        self.session?.game.resume();
      },
      setDifficulty(id: DifficultyId) {
        self.session?.game.setDifficulty(id);
      },
      manualSave() {
        self.session?.game.manualSave();
      },
      quitToTitle() {
        if (self.session) {
          self.session.game.quitToTitle();
        } else {
          self.enterTitle();
        }
      },
    };
  }
}
