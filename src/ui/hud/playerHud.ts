import type { Player } from '../../actors/player.ts';
import type { SceneTimers } from '../../core/sceneTimers.ts';
import type { Interactions } from '../../actors/interaction.ts';
import type { AccessHint, HintPart } from '../../world/access.ts';
import { VisorHud, type VisorWiring } from './visor/visorHud.ts';

/** What the ammo readout shows: the held weapon's magazine and spare rounds. */
export interface AmmoReadout {
  name: string;
  loaded: number;
  reserve: number;
  mag: number;
  /** A reload is under way. */
  reloading?: boolean;
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
 * The player HUD: the interact prompt (with hold progress), the grab struggle prompt, the
 * game-over fade, the access hint under the prompt (ADR-0024: "You'll need a **Level 2
 * Card**...") and the visor, which shows health, stamina and ammo (visor-hud spec).
 */
export class PlayerHud {
  private readonly prompt: HTMLElement;
  private readonly fade: HTMLElement;
  private readonly hint: HTMLElement;
  /** Cancels the hint's expiry; null once it has run out. Counted in play time (game-pause). */
  private cancelHint: (() => void) | null = null;
  private readonly timers: Pick<SceneTimers, 'after'>;
  private readonly keyLabel: string;
  private promptText = '';
  private readonly visor: VisorHud;

  constructor(root: HTMLElement, prompt: HTMLElement, interactKey: string, timers: Pick<SceneTimers, 'after'>) {
    this.timers = timers;
    this.prompt = prompt;
    this.keyLabel = keyLabel(interactKey);
    this.fade = document.createElement('div');
    this.fade.className = 'screen-fade';
    this.hint = document.createElement('div');
    this.hint.className = 'access-hint';
    this.hint.setAttribute('role', 'status');
    this.hint.setAttribute('aria-live', 'polite');
    this.hint.hidden = true;
    root.append(this.fade, this.hint);
    this.visor = new VisorHud(root);
  }

  /** Where the weapon panel reads the held weapon from (the viewmodel owns the counts). */
  setAmmoSource(source: () => AmmoReadout | null): void {
    this.visor.setAmmoSource(source);
  }

  /** Give the visor the events it reacts to, the view it lags behind, the settings and the reload key's label. */
  connect(wiring: VisorWiring): void {
    this.visor.connect(wiring);
  }

  /** Boot the visor up again: play starts after the intro, a load or a checkpoint restore. */
  boot(): void {
    this.visor.boot();
  }

  /** A step of play (game-pause): what mirrors the simulation advances by it. */
  tick(dt: number): void {
    this.visor.tick(dt);
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
  update(player: Player, interactions: Interactions, frameDt = 0): void {
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

    this.visor.update(player, frameDt);
  }

  hide(): void {
    this.visor.hide();
    this.setPrompt('', 0);
    this.hint.hidden = true;
  }

  /** The session ends: the visor sits outside `#ui`, so it takes itself off the page. */
  dispose(): void {
    this.visor.dispose();
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
