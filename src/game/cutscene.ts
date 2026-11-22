import type { Player } from '../actors/player.ts';
import type { Input } from '../core/input.ts';
import type { SettingsStore } from '../core/settings.ts';
import type { SequenceManager } from '../script/runtime.ts';
import { SkipHold } from '../script/skipHold.ts';
import type { PlayerHud } from '../ui/hud/playerHud.ts';
import type { CutsceneUi } from '../ui/hud/cutsceneUi.ts';

/** The new-game opening (intro-sequence spec). */
export const INTRO_SEQUENCE = 'intro_shift_change';

const HINT_START = 4;
const HINT_ACTIVITY = 3;
const SKIP_FADE_OUT = 0.4;
const SKIP_FADE_IN = 0.5;

export interface CutsceneDeps {
  /** Looked up on use: the manager is built after the loop (it owns the time scale). */
  sequences: () => SequenceManager | null;
  input: Input;
  settings: SettingsStore;
  player: Player;
  hud: PlayerHud;
  ui: CutsceneUi;
  /** Label for the skip key, e.g. "Space". */
  skipKeyLabel: () => string;
  /** Does this level have the opening's anchors (intro-sequence spec)? Default yes; kit_test and the demo room say no. */
  hasIntro?: () => boolean;
}

/**
 * Everything the player sees around a skippable sequence (intro-sequence spec): letterbox bars while
 * on rails, the hold-to-skip prompt, and the skip itself. The sequences are run and
 * ended by the ADR-0009 `SequenceManager`; this only decides when to skip.
 */
export class CutsceneController {
  private readonly d: CutsceneDeps;
  private readonly hold = new SkipHold();
  private hint = 0;
  private wasSkippable = false;
  private skipping = false;
  private skipTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly offActivity: () => void;

  constructor(deps: CutsceneDeps) {
    this.d = deps;
    this.offActivity = deps.ui.onActivity(() => {
      if (this.skippable) this.hint = Math.max(this.hint, HINT_ACTIVITY);
    });
  }

  dispose(): void {
    this.cancel();
    this.offActivity();
  }

  private get skippable(): boolean {
    return this.d.sequences()?.skippable ?? false;
  }

  /** Cutscene bars show while a sequence runs and the player cannot move on their own. */
  get barsOn(): boolean {
    const m = this.d.sequences();
    return m !== null && m.running().length > 0 && this.d.player.onRails;
  }

  playIntro(): boolean {
    const m = this.d.sequences();
    if (this.d.hasIntro && !this.d.hasIntro()) return false;
    return m !== null && m.has(INTRO_SEQUENCE) && m.start(INTRO_SEQUENCE);
  }

  /** Fixed step while playing (the manager itself is stepped by the main loop). */
  update(dt: number): void {
    const { input, settings } = this.d;
    const skippable = this.skippable;
    if (skippable && !this.wasSkippable) {
      this.hold.reset();
      this.hint = HINT_START;
    }
    this.wasSkippable = skippable;
    if (skippable && !this.skipping) {
      const s = settings.get();
      const fired = this.hold.update(
        dt,
        { held: input.isDown('skipCutscene'), pressed: input.wasPressed('skipCutscene') },
        { seconds: s.skipHoldSeconds, assist: s.skipAssist },
      );
      if (fired) this.startSkip();
    } else if (!skippable && !this.skipping) {
      this.hold.reset();
    }
    this.hint = Math.max(0, this.hint - dt);
  }

  /** Per rendered frame: bars and prompt. */
  render(): void {
    const { settings, ui } = this.d;
    ui.setBars(this.barsOn, settings.get().reducedMotion);
    const show = this.skippable && (this.hint > 0 || this.hold.progress > 0 || this.hold.armed);
    const key = this.d.skipKeyLabel();
    const assist = settings.get().skipAssist;
    const text = this.skipping
      ? 'Skipping…'
      : this.hold.armed
        ? `Skipping… press [${key}] again to cancel`
        : assist
          ? `Press [${key}] to skip`
          : `Hold [${key}] to skip`;
    ui.setSkip(show || this.skipping, text, this.hold.progress);
  }

  /** Death, load, quit to title: stop everything, free control, hide the chrome. */
  cancel(): void {
    if (this.skipTimer !== null) clearTimeout(this.skipTimer);
    this.skipTimer = null;
    this.skipping = false;
    this.hold.reset();
    this.hint = 0;
    this.wasSkippable = false;
    this.d.sequences()?.cancelAll();
    this.d.player.cancelWalk();
    this.d.ui.setBars(false, false);
    this.d.ui.setSkip(false, '', 0);
  }

  /** Pause: a half-held key must not carry over. */
  paused(): void {
    if (!this.skipping) this.hold.reset();
  }

  private startSkip(): void {
    this.skipping = true;
    this.d.ui.announce('Skipping cutscene');
    this.d.hud.setFade(1, SKIP_FADE_OUT);
    this.skipTimer = setTimeout(() => {
      this.skipTimer = null;
      this.d.sequences()?.skip();
      this.d.player.cancelWalk();
      this.hold.reset();
      this.hint = 0;
      this.wasSkippable = false;
      this.skipping = false;
      this.d.hud.setFade(0, SKIP_FADE_IN);
    }, (SKIP_FADE_OUT + 0.05) * 1000);
  }
}
