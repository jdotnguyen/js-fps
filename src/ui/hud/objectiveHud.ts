import { h } from '../dom.ts';
import { ObjectiveBanner, type ObjectiveTracker } from '../objectives.ts';

/**
 * The top-left objective line (ADR-0012): shown for 5 s when an objective starts or is done,
 * and again on the `objective` action (Tab). Announced politely to screen readers.
 */
export class ObjectiveHud {
  readonly banner = new ObjectiveBanner();
  private readonly el: HTMLElement;
  private shown = '';
  private readonly tracker: ObjectiveTracker;

  constructor(parent: HTMLElement, tracker: ObjectiveTracker) {
    this.tracker = tracker;
    this.el = h('div', { class: 'objective-hud', role: 'status', 'aria-live': 'polite', hidden: true });
    parent.append(this.el);
    tracker.onChange((c) => this.banner.push(c));
  }

  /** Tab: show what is active again. */
  recall(): void {
    this.banner.recall(this.tracker.active());
  }

  /** Per frame (real time); `visible` false hides it (title, cutscene bars, map). */
  update(dt: number, visible: boolean): void {
    this.banner.update(dt);
    const on = visible && this.banner.visible;
    const key = on ? this.banner.lines.map((l) => `${l.label}|${l.text}|${l.done}`).join('\n') : '';
    if (key === this.shown) return;
    this.shown = key;
    this.el.hidden = !on;
    if (!on) return;
    this.el.replaceChildren(
      ...this.banner.lines.map((l) =>
        h('div', { class: `objective-line${l.done ? ' done' : ''}` }, h('span', { class: 'objective-label', text: l.label }), h('span', { class: 'objective-text', text: l.done ? `✓ ${l.text}` : l.text })),
      ),
    );
  }
}
