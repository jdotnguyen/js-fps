import { h } from './dom.ts';

/**
 * The slice's title card (ADR-0014 beat 8): white lettering on black over everything, held for a few
 * seconds, then it fades out. Styled inline so no stylesheet has to know about it. Text, not colour alone.
 */
export class TitleCard {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(parent: HTMLElement) {
    this.title = h('div', { class: 'title-card-title' });
    this.sub = h('div', { class: 'title-card-sub' });
    this.root = h('div', { class: 'title-card', role: 'status', 'aria-live': 'assertive' }, this.title, this.sub);
    Object.assign(this.root.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '900',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#000',
      color: '#e8eef2',
      opacity: '0',
      pointerEvents: 'none',
      transition: 'opacity 1.2s ease',
      fontFamily: 'inherit',
      textAlign: 'center',
    });
    Object.assign(this.title.style, { fontSize: '3.2rem', letterSpacing: '0.4em', fontWeight: '300', paddingLeft: '0.4em' });
    Object.assign(this.sub.style, { marginTop: '1.2rem', fontSize: '1rem', letterSpacing: '0.25em', opacity: '0.7' });
    parent.append(this.root);
  }

  /** Fade in, hold, fade out. A new card replaces the old one. */
  show(title: string, sub: string, seconds: number): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.title.textContent = title;
    this.sub.textContent = sub;
    this.sub.hidden = sub === '';
    this.root.style.opacity = '1';
    this.timer = setTimeout(() => {
      this.root.style.opacity = '0';
      this.timer = null;
    }, Math.max(0.5, seconds) * 1000);
  }

  hide(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.root.style.opacity = '0';
  }
}
