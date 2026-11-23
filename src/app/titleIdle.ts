import { yieldFrame } from '../core/yieldFrame.ts';

/** How long title preparation works between hand-backs, so the splash keeps its frames (about a third of a 60 Hz frame). */
export const TITLE_SLICE_MS = 6;

export interface IdleGateOptions {
  /** How long after the last interaction the menu counts as busy. */
  quietMs?: number;
  now?: () => number;
  /** One animation frame. */
  frame?: () => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Keeps title preparation out of the menu's way (title-preload spec: preparation yields to the menu). The shell calls
 * `touch()` on menu input; background work awaits `wait()` between chunks, which is a frame normally and holds for
 * as long as the player keeps interacting.
 */
export class IdleGate {
  private lastTouch = -Infinity;
  private readonly quietMs: number;
  private readonly now: () => number;
  private readonly frame: () => Promise<void>;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: IdleGateOptions = {}) {
    this.quietMs = options.quietMs ?? 300;
    this.now = options.now ?? (() => performance.now());
    this.frame = options.frame ?? yieldFrame;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** The player touched the menu. */
  touch(): void {
    this.lastTouch = this.now();
  }

  /** True while the player has interacted within the quiet window. */
  get busy(): boolean {
    return this.now() - this.lastTouch < this.quietMs;
  }

  /** Bound, so it can be handed straight to code that takes a `() => Promise<void>` yield. */
  readonly wait = async (): Promise<void> => {
    await this.frame();
    while (this.busy) await this.sleep(50);
  };
}
