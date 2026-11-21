import { h } from '../dom.ts';
import { ObjectiveBanner, type ObjectiveTracker } from '../objectives.ts';

/**
 * Persistent right-side objective list (hud-wayfinding spec): shows active objectives
 * continuously while playing, highlights new ones briefly, shows a brief checkmark when
 * completed, and pulses on Tab. Announced politely to screen readers.
 */
export class ObjectiveHud {
  readonly banner = new ObjectiveBanner();
  readonly el: HTMLElement;
  private shown = '';
  private readonly tracker: ObjectiveTracker;

  constructor(parent: HTMLElement, tracker: ObjectiveTracker) {
    this.tracker = tracker;
    this.el = h('div', { class: 'objective-hud', role: 'status', 'aria-live': 'polite', hidden: true });
    parent.append(this.el);
    tracker.onChange((c) => this.banner.push(c));
  }

  /** Tab: emphasize the active objective list. */
  recall(): void {
    this.banner.recall(this.tracker.active());
  }

  /** Elevate above the wayfinding spotlight backdrop during the post-intro tutorial. */
  setSpotlight(on: boolean): void {
    this.el.classList.toggle('spotlight-focus', on);
  }

  /** Per frame (real time); `visible` false hides it (title, cutscene bars, map). */
  update(dt: number, visible: boolean): void {
    this.banner.update(dt);
    const snap = this.banner.snapshot(this.tracker.active());
    const on = visible && snap.visible;
    const key = on
      ? `${snap.pulsed ? 'P' : ''}|${snap.lines.map((l) => `${l.id}|${l.text}|${l.done}|${l.fresh}|${l.optional}`).join('\n')}`
      : '';
    if (key === this.shown) return;
    this.shown = key;
    this.el.hidden = !on;
    this.el.classList.toggle('pulsed', on && snap.pulsed);
    if (!on) return;
    this.el.replaceChildren(
      h('div', { class: 'objective-heading', text: 'Objectives' }),
      ...snap.lines.map((l) =>
        h(
          'div',
          {
            class: `objective-line${l.done ? ' done' : ''}${l.fresh ? ' fresh' : ''}${l.optional ? ' optional' : ''}`,
          },
          l.optional || l.done ? h('span', { class: 'objective-label', text: l.label }) : '',
          h('span', { class: 'objective-text', text: l.done ? `✓ ${l.text}` : l.text }),
        ),
      ),
    );
  }
}
