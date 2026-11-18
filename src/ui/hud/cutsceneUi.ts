import { h } from '../dom.ts';

/**
 * Cutscene chrome (ADR-0017): black letterbox bars while the player is on rails, and the
 * hold-to-skip prompt with its progress bar. Text plus a bar, never colour alone, and the
 * bar is a real progressbar for assistive tech.
 */
export class CutsceneUi {
  private readonly root: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly label: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly live: HTMLElement;
  private barsOn = false;
  private promptText = '';
  private shown = false;
  private pct = -1;

  constructor(parent: HTMLElement) {
    this.fill = h('div', { class: 'skip-fill' });
    this.bar = h('div', { class: 'skip-bar', role: 'progressbar', 'aria-label': 'Skip cutscene', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0 }, this.fill);
    this.label = h('span', { class: 'skip-label' });
    this.prompt = h('div', { class: 'skip-prompt', hidden: true }, this.label, this.bar);
    this.live = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'assertive' });
    this.root = h('div', { class: 'cine' }, h('div', { class: 'cine-bar top' }), h('div', { class: 'cine-bar bottom' }));
    parent.append(this.root, this.prompt, this.live);
  }

  /** Any key or mouse movement: the caller shows the skip hint again. */
  onActivity(fn: () => void): () => void {
    const opts = { passive: true } as const;
    addEventListener('keydown', fn, opts);
    addEventListener('mousemove', fn, opts);
    return () => {
      removeEventListener('keydown', fn);
      removeEventListener('mousemove', fn);
    };
  }

  setBars(on: boolean, reducedMotion: boolean): void {
    this.root.classList.toggle('reduced', reducedMotion);
    if (on === this.barsOn) return;
    this.barsOn = on;
    this.root.classList.toggle('on', on);
  }

  /** `progress` 0..1. Hidden when `visible` is false. */
  setSkip(visible: boolean, text: string, progress: number): void {
    if (visible !== this.shown) {
      this.shown = visible;
      this.prompt.hidden = !visible;
    }
    if (text !== this.promptText) {
      this.promptText = text;
      this.label.textContent = text;
    }
    const pct = Math.round(progress * 100);
    if (pct !== this.pct) {
      this.pct = pct;
      this.bar.setAttribute('aria-valuenow', String(pct));
      this.fill.style.width = `${pct}%`;
    }
  }

  announce(message: string): void {
    this.live.textContent = message;
  }
}
