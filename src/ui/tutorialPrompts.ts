import type { EventBus } from '../core/events.ts';
import type { Input } from '../core/input.ts';
import type { SettingsStore } from '../core/settings.ts';
import { INTRO_SEQUENCE } from '../game/cutscene.ts';
import { h } from './dom.ts';
import { describeHint, describePrompt, TutorialQueue, type Bindings, type HintDef, type PromptDef, type SeenStore } from './tutorials.ts';

/** Mouse pixels that count as "looked" for the Look pop-up. */
const LOOK_THRESHOLD = 8;

declare module '../core/events.ts' {
  interface EventMap {
    /** Emitted by `script/runtime.ts` (ADR-0009). */
    'sequence:ended': { id: string; cancelled: boolean; skipped: boolean };
    /** The new-game intro finished (played or skipped) and the bars are fading (ADR-0025). */
    'intro:ended': Record<string, never>;
    /** The player's view landed on something usable (first time per target, ADR-0025). */
    'look:usable': { id: string };
    /** The player entered a dark space; fired by level data (ADR-0023 maintenance corridor). */
    'area:dark': { id?: string };
    /** First contact with an enemy; fired by level data or AI (R05). */
    'combat:first': Record<string, never>;
    /** Non-blocking hint for an action, e.g. `{ action: 'sprint' }` (ADR-0025). */
    'tutorial:hint': { action: string };
    /** A blocking pop-up was dismissed by its action. */
    'tutorial:dismissed': { id: string };
  }
}

export interface TutorialPromptsDeps {
  parent: HTMLElement;
  events: EventBus;
  settings: SettingsStore;
  input: Input;
  profile: SeenStore;
  /** The player's current bindings (the keymap today; a remap screen later). */
  bindings: Bindings;
  /** `game.mode`. */
  mode: () => string;
  /** `game.playTime`: 0 means the run just started (new game). */
  playTime: () => number;
  /** Player on rails or a cutscene running: nothing opens. */
  onRails: () => boolean;
  /** Whether a sequence is running (`sequences.isRunning`). */
  sequenceRunning: (id: string) => boolean;
  /** Whether the flashlight is already on (a dark area then needs no prompt). */
  flashlightOn: () => boolean;
  /** Id of the interactable in view, if any (`interactions.focus`). */
  focusId: () => string | null;
  /** Called when a spotlight callout opens/closes so live HUD elements can elevate above the backdrop. */
  onSpotlight?: (on: boolean) => void;
}

/**
 * Tutorial pop-ups (ADR-0025). Blocking pop-ups pause the simulation (the main loop skips
 * `game.update` while `blocking`; audio keeps running), blur the scene (a plain dim with
 * reduced motion), name the action and the player's current binding, and close only when
 * that action is pressed. Esc releases the mouse and pauses as usual; the pop-up waits
 * underneath and is back on Resume. Sprint and crouch get a small non-blocking hint.
 *
 * Triggers: `intro:ended` -> Move (then Look), `look:usable` -> Interact,
 * `area:dark` -> Flashlight, `combat:first` -> Fire / Reload, `tutorial:hint` -> hint.
 * Sequences and level triggers fire them with the `emit` action (ADR-0009).
 */
export class TutorialPrompts {
  readonly queue: TutorialQueue;
  private readonly d: TutorialPromptsDeps;
  private readonly overlay: HTMLElement;
  private readonly card: HTMLElement;
  private readonly icon: HTMLElement;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;
  private readonly hintEl: HTMLElement;
  private readonly live: HTMLElement;
  private lookAccum = 0;
  private clicked = false;
  private lastFocus: string | null = null;
  private lastMode = '';
  private introCheck = false;
  private restoreFocus: Element | null = null;

  constructor(deps: TutorialPromptsDeps) {
    this.d = deps;
    const { events, settings } = deps;
    this.queue = new TutorialQueue(deps.profile, () => settings.get().tutorialPrompts, deps.bindings);

    this.icon = h('div', { class: 'tutorial-icon', 'aria-hidden': 'true' });
    this.title = h('h2', { id: 'tutorial-title', class: 'tutorial-title' });
    this.body = h('div', { id: 'tutorial-body', class: 'tutorial-body' });
    this.card = h(
      'div',
      { class: 'tutorial-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tutorial-title', 'aria-describedby': 'tutorial-body', tabindex: -1 },
      this.icon,
      this.title,
      this.body,
    );
    this.overlay = h('div', { class: 'tutorial', hidden: true }, this.card);
    this.overlay.addEventListener('pointerdown', () => {
      if (this.queue.current?.spotlight) this.clicked = true;
    });
    this.hintEl = h('div', { class: 'tutorial-hint', role: 'status', 'aria-live': 'polite', hidden: true });
    this.live = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'assertive' });
    deps.parent.append(this.overlay, this.hintEl, this.live);

    events.on('sequence:ended', ({ id, cancelled }) => {
      if (id === INTRO_SEQUENCE && !cancelled) events.emit('intro:ended', {});
    });
    events.on('intro:ended', () => this.queue.trigger('move'));
    events.on('look:usable', () => this.queue.trigger('interact'));
    events.on('area:dark', () => {
      if (!deps.flashlightOn()) this.queue.trigger('flashlight');
    });
    events.on('combat:first', () => this.queue.trigger('combat'));
    events.on('tutorial:hint', ({ action }) => this.queue.triggerHint(String(action)));
    events.on('game:mode', ({ mode }) => this.onMode(mode));
  }

  /** The simulation should not step. */
  get blocking(): boolean {
    return this.queue.blocking && this.d.mode() === 'playing';
  }

  /** Settings > "Reset tutorials". */
  reset(): void {
    this.queue.reset();
  }

  /** Fixed step, before `game.update`. */
  update(dt: number): void {
    if (this.d.mode() !== 'playing') return;
    if (this.introCheck) {
      // New game without an intro sequence: control starts at once, so Move is due now.
      this.introCheck = false;
      if (!this.d.sequenceRunning(INTRO_SEQUENCE)) this.d.events.emit('intro:ended', {});
    }
    const focus = this.d.focusId();
    if (focus !== null && focus !== this.lastFocus) this.d.events.emit('look:usable', { id: focus });
    this.lastFocus = focus;

    const { input } = this.d;
    const r = this.queue.step(dt, {
      onRails: this.d.onRails(),
      pressed: (a) => input.wasPressed(a),
      looked: this.lookAccum >= LOOK_THRESHOLD,
      clicked: this.clicked || input.wasPressed('fire'),
    });
    this.lookAccum = 0;
    this.clicked = false;
    if (r.dismissed) {
      this.close();
      this.d.events.emit('tutorial:dismissed', { id: r.dismissed.id });
    }
    if (r.opened) this.open(r.opened);
    if (r.hintShown) this.showHint(r.hintShown);
    if (r.hintHidden) this.hintEl.hidden = true;
  }

  /** Per rendered frame, before `game.render`: a blocking pop-up freezes the view. */
  render(): void {
    if (!this.blocking) return;
    const look = this.d.input.consumeLook();
    this.lookAccum += Math.abs(look.x) + Math.abs(look.y);
  }

  private onMode(mode: string): void {
    if (mode === 'title' || (this.lastMode === 'title' && mode === 'playing')) {
      this.queue.newRun();
      this.close();
      this.hintEl.hidden = true;
      this.lastFocus = null;
      this.introCheck = mode === 'playing' && this.d.playTime() === 0;
    }
    this.lastMode = mode;
    // Pause menu on top: hide the pop-up, bring it back on Resume.
    const show = mode === 'playing' && this.queue.current !== null;
    if (show && this.overlay.hidden) this.open(this.queue.current!);
    else if (!show) {
      this.overlay.hidden = true;
      this.d.onSpotlight?.(false);
    }
    if (mode !== 'playing') this.hintEl.hidden = true;
  }

  private open(def: PromptDef): void {
    const { groups, sentence } = describePrompt(def, this.d.bindings);
    this.overlay.classList.toggle('reduced', this.d.settings.get().reducedMotion);
    this.overlay.classList.toggle('spotlight', def.spotlight === true);
    this.icon.textContent = def.icon;
    this.title.textContent = def.title;
    const bullets = def.items?.length
      ? [
          h(
            'ul',
            { class: 'tutorial-bullets' },
            ...def.items.map((it) =>
              h('li', {}, h('strong', { text: `${it.heading}: ` }), h('span', { text: it.detail })),
            ),
          ),
        ]
      : [];
    this.body.replaceChildren(
      ...bullets,
      ...groups.map((g) =>
        h('p', { class: 'tutorial-line' }, h('span', { class: 'tutorial-keys', 'aria-hidden': 'true' }, ...g.keys.map((k) => h('kbd', { text: k }))), h('span', { text: g.text })),
      ),
    );
    const wasHidden = this.overlay.hidden;
    this.overlay.hidden = false;
    this.d.onSpotlight?.(def.spotlight === true);
    if (wasHidden) this.restoreFocus = document.activeElement;
    this.card.focus({ preventScroll: true });
    this.live.textContent = sentence;
  }

  private close(): void {
    this.d.onSpotlight?.(false);
    this.overlay.classList.remove('spotlight');
    if (this.overlay.hidden) return;
    this.overlay.hidden = true;
    const back = this.restoreFocus;
    this.restoreFocus = null;
    if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
    else this.card.blur();
  }

  private showHint(def: HintDef): void {
    const d = describeHint(def, this.d.bindings);
    if (!d) return;
    this.hintEl.replaceChildren(h('kbd', { text: d.key }), h('span', { text: d.text }));
    this.hintEl.hidden = false;
  }
}
