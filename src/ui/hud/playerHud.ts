import type { Player } from '../../actors/player.ts';
import type { Interactions } from '../../actors/interaction.ts';

/**
 * Minimal player HUD for ADR-0004: the interact prompt (with hold progress), the grab
 * struggle prompt, the downed bleed-out readout and the game-over fade. The full HUD
 * is ADR-0012; this only covers what the controller needs to be testable.
 */
export class PlayerHud {
  private readonly prompt: HTMLElement;
  private readonly status: HTMLElement;
  private readonly fade: HTMLElement;
  private readonly keyLabel: string;
  private promptText = '';
  private statusText = '';

  constructor(root: HTMLElement, prompt: HTMLElement, interactKey: string) {
    this.prompt = prompt;
    this.keyLabel = keyLabel(interactKey);
    this.status = document.createElement('div');
    this.status.className = 'player-status';
    this.status.setAttribute('role', 'status');
    this.status.hidden = true;
    this.fade = document.createElement('div');
    this.fade.className = 'screen-fade';
    root.append(this.status, this.fade);
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

  hide(): void {
    this.setPrompt('', 0);
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

/** "KeyE" -> "E", "Mouse0" -> "LMB". */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return { Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Space: 'Space' }[code] ?? code;
}
