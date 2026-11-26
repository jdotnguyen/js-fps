import type { Player } from '../../actors/player.ts';
import type { SceneTimers } from '../../core/sceneTimers.ts';
import type { Interactions } from '../../actors/interaction.ts';
import type { AccessHint, HintPart } from '../../world/access.ts';
import { LOW_HP, MAX_HP } from '../../actors/vitals.ts';
import { PLAYER_TUNING } from '../../actors/player.ts';

/** What the ammo readout shows: the held weapon's magazine and spare rounds. */
export interface AmmoReadout {
  name: string;
  loaded: number;
  reserve: number;
  mag: number;
}

/** Seconds an access hint stays up (ADR-0024). */
export const HINT_SECONDS = 4;
const SVG_NS = 'http://www.w3.org/2000/svg';
/** Small line icons for the highlighted item (24 x 24 viewBox). */
const ITEM_ICONS: Record<string, string> = {
  card: 'M3 6h18v12H3z M3 10h18 M6 14h5',
  tool: 'M14 3l7 7-3 3-7-7z M11 6L3 14v7h7l8-8',
  item: 'M12 3l9 5v8l-9 5-9-5V8z',
};

/**
 * Minimal player HUD for ADR-0004: the interact prompt (with hold progress), the grab
 * struggle prompt, the downed bleed-out readout and the game-over fade. The full HUD
 * is ADR-0012; this only covers what the controller needs to be testable.
 * Also the access hint under the prompt (ADR-0024): "You'll need a **Level 2 Card**...".
 */
export class PlayerHud {
  private readonly prompt: HTMLElement;
  private readonly status: HTMLElement;
  private readonly fade: HTMLElement;
  private readonly hint: HTMLElement;
  /** Cancels the hint's expiry; null once it has run out. Counted in play time (game-pause). */
  private cancelHint: (() => void) | null = null;
  private readonly timers: Pick<SceneTimers, 'after'>;
  private readonly keyLabel: string;
  private promptText = '';
  private statusText = '';
  private readonly vitalsEl: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly staminaRow: HTMLElement;
  private readonly staminaFill: HTMLElement;
  private readonly ammoEl: HTMLElement;
  private readonly ammoLoaded: HTMLElement;
  private readonly ammoReserve: HTMLElement;
  private readonly ammoName: HTMLElement;
  private ammoSource: (() => AmmoReadout | null) | null = null;
  private shown = { hp: -1, stamina: -1, loaded: -1, reserve: -1, name: '' };

  constructor(root: HTMLElement, prompt: HTMLElement, interactKey: string, timers: Pick<SceneTimers, 'after'>) {
    this.timers = timers;
    this.prompt = prompt;
    this.keyLabel = keyLabel(interactKey);
    this.status = document.createElement('div');
    this.status.className = 'player-status';
    this.status.setAttribute('role', 'status');
    this.status.hidden = true;
    this.fade = document.createElement('div');
    this.fade.className = 'screen-fade';
    this.hint = document.createElement('div');
    this.hint.className = 'access-hint';
    this.hint.setAttribute('role', 'status');
    this.hint.setAttribute('aria-live', 'polite');
    this.hint.hidden = true;
    root.append(this.status, this.fade, this.hint);

    // Bottom-left: health + stamina. Bottom-right: ammo. Text carries the numbers, so colour is never the only cue.
    this.vitalsEl = div('hud-vitals');
    const hpRow = div('hud-row');
    const hpLabel = div('hud-label', 'HP');
    const hpBar = div('hud-bar');
    this.hpFill = div('hud-fill hp');
    hpBar.append(this.hpFill);
    this.hpText = div('hud-num');
    hpRow.append(hpLabel, hpBar, this.hpText);
    this.staminaRow = div('hud-row stamina');
    const stLabel = div('hud-label', 'STA');
    const stBar = div('hud-bar thin');
    this.staminaFill = div('hud-fill sta');
    stBar.append(this.staminaFill);
    this.staminaRow.append(stLabel, stBar);
    this.vitalsEl.append(hpRow, this.staminaRow);
    this.vitalsEl.setAttribute('role', 'group');
    this.vitalsEl.setAttribute('aria-label', 'Vitals');

    this.ammoEl = div('hud-ammo');
    this.ammoName = div('hud-ammo-name');
    this.ammoLoaded = div('hud-ammo-loaded');
    this.ammoReserve = div('hud-ammo-reserve');
    const counts = div('hud-ammo-counts');
    counts.append(this.ammoLoaded, this.ammoReserve);
    this.ammoEl.append(this.ammoName, counts);
    this.vitalsEl.hidden = true;
    this.ammoEl.hidden = true;
    root.append(this.vitalsEl, this.ammoEl);
  }

  /** Where the ammo readout reads the held weapon from (the viewmodel owns the counts). */
  setAmmoSource(source: () => AmmoReadout | null): void {
    this.ammoSource = source;
  }

  /**
   * Show an access hint for a few seconds. The item name is bold, carries an icon and the
   * accent colour, so it never relies on colour alone (ADR-0012).
   */
  showHint(hint: AccessHint, seconds = HINT_SECONDS): void {
    this.hint.replaceChildren(...hint.parts.map((p) => hintNode(p)));
    this.hint.setAttribute('aria-label', hint.text);
    this.hint.dataset['key'] = hint.key;
    this.cancelHint?.();
    const expire = (): void => {
      this.cancelHint = null;
      this.hint.hidden = true;
    };
    this.cancelHint = this.timers.after(seconds, expire, expire);
    this.hint.hidden = false;
  }

  /** Per rendered frame while playing. */
  update(player: Player, interactions: Interactions): void {
    let text = '';
    let progress = 0;
    const grab = player.grabProgress;
    if (grab !== null) {
      text = `Mash [${this.keyLabel}] to break free`;
      progress = grab;
    } else if (interactions.focus) {
      const f = interactions.focus;
      text = `[${this.keyLabel}] ${f.target.prompt}${f.target.hold !== undefined ? ' (hold)' : ''}`;
      progress = f.progress;
    }
    this.setPrompt(text, progress);
    // `hide` takes it off the screen without ending it.
    this.hint.hidden = this.cancelHint === null;

    this.updateVitals(player);
    this.updateAmmo();

    let status = '';
    if (player.downed) {
      const left = player.vitals.revivesLeft;
      status = `DOWN · bleeding out ${Math.ceil(player.vitals.bleed)} s · wait for the medic${left === null ? '' : ` · revives left ${left}`}`;
    }
    if (status !== this.statusText) {
      this.statusText = status;
      this.status.textContent = status;
      this.status.hidden = status === '';
    }
  }

  private updateVitals(player: Player): void {
    this.vitalsEl.hidden = false;
    const hp = Math.ceil(player.vitals.hp);
    if (hp !== this.shown.hp) {
      this.shown.hp = hp;
      this.hpFill.style.width = `${(hp / MAX_HP) * 100}%`;
      this.hpText.textContent = String(hp);
      this.vitalsEl.classList.toggle('low', hp <= LOW_HP);
    }
    // Stamina only shows while it is not full; a spent bar flags exhaustion until sprint is allowed again.
    const sta = Math.round((player.stamina / PLAYER_TUNING.sprintMax) * 100);
    if (sta !== this.shown.stamina) {
      this.shown.stamina = sta;
      this.staminaFill.style.width = `${sta}%`;
      this.staminaRow.classList.toggle('full', sta >= 100);
    }
    this.staminaRow.classList.toggle('spent', player.isExhausted);
  }

  private updateAmmo(): void {
    const a = this.ammoSource?.() ?? null;
    this.ammoEl.hidden = a === null;
    if (!a) return;
    const sh = this.shown;
    if (a.name !== sh.name) {
      sh.name = a.name;
      this.ammoName.textContent = a.name.toUpperCase();
    }
    if (a.loaded !== sh.loaded || a.reserve !== sh.reserve) {
      sh.loaded = a.loaded;
      sh.reserve = a.reserve;
      this.ammoLoaded.textContent = String(a.loaded);
      this.ammoReserve.textContent = `/ ${a.reserve}`;
      this.ammoEl.classList.toggle('empty', a.loaded === 0);
      this.ammoEl.classList.toggle('low', a.loaded > 0 && a.loaded <= Math.ceil(a.mag / 4));
    }
  }

  hide(): void {
    this.vitalsEl.hidden = true;
    this.ammoEl.hidden = true;
    this.setPrompt('', 0);
    this.hint.hidden = true;
    if (this.statusText) {
      this.statusText = '';
      this.status.hidden = true;
    }
  }

  /** 0 = clear, 1 = black. CSS transitions the change over `seconds`. */
  setFade(level: number, seconds = 0.8): void {
    this.fade.style.transitionDuration = `${seconds}s`;
    this.fade.style.opacity = String(level);
  }

  private setPrompt(text: string, progress: number): void {
    if (text !== this.promptText) {
      this.promptText = text;
      this.prompt.textContent = text;
      this.prompt.hidden = text === '';
    }
    this.prompt.style.setProperty('--progress', progress.toFixed(3));
    this.prompt.classList.toggle('holding', progress > 0);
  }
}

function div(cls: string, text?: string): HTMLElement {
  const el = document.createElement('div');
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

function hintNode(part: HintPart): Node {
  if (!part.item) return document.createTextNode(part.text);
  const strong = document.createElement('strong');
  strong.className = 'hint-item';
  strong.dataset['item'] = part.item.id;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'hint-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ITEM_ICONS[part.item.kind ?? 'item'] ?? ITEM_ICONS['item']!);
  svg.append(path);
  strong.append(svg, document.createTextNode(part.text));
  return strong;
}

/** "KeyE" -> "E", "Mouse0" -> "LMB". */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return { Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Space: 'Space' }[code] ?? code;
}
