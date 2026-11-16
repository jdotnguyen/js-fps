import { h } from '../dom.ts';

export interface Screen {
  title: string;
  subtitle?: string;
  /** Extra class on the panel, e.g. 'title-screen'. */
  variant?: string;
  build(menu: Menu): Array<Node | null | false>;
  /** Esc / Back on the root screen. Omit to make Esc do nothing there. */
  onBack?: () => void;
}

/**
 * A stack of menu screens rendered into one overlay. Keyboard: Tab/arrow keys move
 * focus, Enter/Space activate, Esc goes back.
 */
export class Menu {
  readonly root: HTMLElement;
  private stack: Screen[] = [];

  constructor(root: HTMLElement) {
    this.root = root;
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.back();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.moveFocus(e.key === 'ArrowDown' ? 1 : -1);
      }
    });
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  show(screen: Screen): void {
    this.stack = [screen];
    this.render();
  }

  push(screen: Screen): void {
    this.stack.push(screen);
    this.render();
  }

  /** Replace the top screen (e.g. after deleting a save). */
  refresh(): void {
    this.render();
  }

  back(): void {
    if (this.stack.length > 1) {
      this.stack.pop();
      this.render();
    } else {
      this.stack[0]?.onBack?.();
    }
  }

  hide(): void {
    this.stack = [];
    this.root.hidden = true;
    this.root.replaceChildren();
  }

  private render(): void {
    const screen = this.stack[this.stack.length - 1];
    if (!screen) return this.hide();
    const panel = h(
      'section',
      { class: `menu-panel ${screen.variant ?? ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'menu-title' },
      h('h1', { id: 'menu-title', text: screen.title }),
      screen.subtitle ? h('p', { class: 'menu-sub', text: screen.subtitle }) : null,
      ...screen.build(this),
    );
    if (this.stack.length > 1) {
      panel.append(h('p', { class: 'menu-hint', text: 'Esc to go back' }));
    }
    this.root.replaceChildren(panel);
    this.root.hidden = false;
    const first = panel.querySelector<HTMLElement>('[autofocus]') ?? panel.querySelector<HTMLElement>('button, input, select');
    first?.focus();
  }

  private moveFocus(dir: number): void {
    const items = [...this.root.querySelectorAll<HTMLElement>('button:not([disabled]), input, select')];
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = items[(i + dir + items.length) % items.length];
    next?.focus();
  }
}
