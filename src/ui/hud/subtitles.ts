import type { EventBus } from '../../core/events.ts';
import type { SettingsStore } from '../../core/settings.ts';
import { h } from '../dom.ts';

/** Speaker name colours (ADR-0012: name in their colour). Unknown speakers use the visor colour. */
const COLORS: Record<string, string> = { engineer: '#ffc27a', medic: '#8fd0ff', player: '#b9f5c9', pa: '#d0d0d0', chief: '#d6a8ff', nurse: '#ffb3c7' };

/**
 * Subtitles (ADR-0012), bottom centre: the speaker's name in their colour, two lines max,
 * on a background box. Driven by the speech manager's `subtitle:show/hide` (ADR-0010);
 * hidden when the Subtitles setting is off.
 */
export class Subtitles {
  private readonly el: HTMLElement;
  private readonly lines = new Map<string, HTMLElement>();

  constructor(parent: HTMLElement, events: EventBus, settings: SettingsStore) {
    this.el = h('div', { class: 'subtitles', 'aria-live': 'polite' });
    parent.append(this.el);
    events.on('subtitle:show', (s) => {
      if (!settings.get().subtitles) return;
      this.lines.get(s.id)?.remove();
      const row = h(
        'p',
        { class: `subtitle${s.channel === 'radio' ? ' radio' : ''}` },
        h('span', { class: 'subtitle-name', style: `color:${COLORS[s.speaker] ?? 'var(--visor)'}`, text: `${s.name}${s.channel === 'radio' ? ' [radio]' : ''}: ` }),
        h('span', { text: s.text }),
      );
      this.lines.set(s.id, row);
      this.el.append(row);
      while (this.el.children.length > 2) this.el.firstElementChild?.remove();
    });
    events.on('subtitle:hide', ({ id }) => {
      this.lines.get(id)?.remove();
      this.lines.delete(id);
    });
    events.on('game:mode', ({ mode }) => {
      if (mode === 'title') this.clear();
    });
  }

  clear(): void {
    this.el.replaceChildren();
    this.lines.clear();
  }
}
