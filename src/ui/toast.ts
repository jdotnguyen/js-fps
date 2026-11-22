import { h } from './dom.ts';

/** Short status messages ("Checkpoint", "Game saved") in the corner. */
export class Toasts {
  private readonly root: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = h('div', { class: 'toasts', 'aria-live': 'polite' });
    parent.append(this.root);
  }

  show(text: string, detail = '', ms = 2800): void {
    const t = h('div', { class: 'toast' }, h('strong', { text }), detail ? h('span', { text: detail }) : null);
    this.root.append(t);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => {
      t.classList.remove('in');
      setTimeout(() => t.remove(), 400);
    }, ms);
  }

  dispose(): void {
    this.root.remove();
  }
}
