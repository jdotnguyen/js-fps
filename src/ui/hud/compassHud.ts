import { h } from '../dom.ts';
import { computeCompass, type CompassObjectiveInput, type P3 } from '../wayfinding.ts';

/**
 * Top-center cardinal compass strip (hud-wayfinding spec): displays only N, E, S, W plus
 * active objective directional markers and metre distances. Hidden on title, map, and rails.
 */
export class CompassHud {
  readonly el: HTMLElement;
  private readonly track: HTMLElement;
  private readonly cardinals = new Map<'N' | 'E' | 'S' | 'W', HTMLElement>();
  private readonly marks: Array<{ el: HTMLElement; dist: HTMLElement }> = [];

  constructor(parent: HTMLElement) {
    this.track = h('div', { class: 'compass-track' });
    this.el = h(
      'div',
      { class: 'compass-hud', 'aria-hidden': 'true', hidden: true },
      this.track,
      h('div', { class: 'compass-center' }),
    );
    for (const label of ['N', 'E', 'S', 'W'] as const) {
      const node = h('span', { class: 'compass-cardinal', text: label });
      this.cardinals.set(label, node);
      this.track.append(node);
    }
    parent.append(this.el);
  }

  /** Elevate above the wayfinding spotlight backdrop during the post-intro tutorial. */
  setSpotlight(on: boolean): void {
    this.el.classList.toggle('spotlight-focus', on);
  }

  update(visible: boolean, playerPos: P3, playerYaw: number, objectives: readonly CompassObjectiveInput[]): void {
    this.el.hidden = !visible;
    if (!visible) return;
    const { cardinals, objectives: objMarks } = computeCompass(playerPos, playerYaw, objectives);
    const seen = new Set<string>();
    for (const c of cardinals) {
      seen.add(c.label);
      const node = this.cardinals.get(c.label)!;
      node.hidden = false;
      node.style.left = `${(c.x * 50 + 50).toFixed(2)}%`;
    }
    for (const [label, node] of this.cardinals) {
      if (!seen.has(label)) node.hidden = true;
    }
    while (this.marks.length < objMarks.length) {
      const dist = h('span', { class: 'compass-dist' });
      const el = h('div', { class: 'compass-mark' }, h('span', { class: 'compass-pip', text: '◆' }), dist);
      this.track.append(el);
      this.marks.push({ el, dist });
    }
    for (let i = 0; i < this.marks.length; i++) {
      const slot = this.marks[i]!;
      const m = objMarks[i];
      if (!m) {
        slot.el.hidden = true;
        continue;
      }
      slot.el.hidden = false;
      slot.el.className = `compass-mark${m.required ? '' : ' optional'}${m.clamped ? (m.x < 0 ? ' clamped-left' : ' clamped-right') : ''}`;
      slot.el.style.left = `${(m.x * 50 + 50).toFixed(2)}%`;
      slot.dist.textContent = `${m.distance}m`;
    }
  }
}
