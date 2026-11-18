/** `?debug` overlay (ADR-0009): running sequences and the step each one is on. */
import type { SequenceManager } from './runtime.ts';

export class SequenceOverlay {
  private readonly el: HTMLElement;
  private last = '';
  private readonly manager: SequenceManager;

  constructor(manager: SequenceManager) {
    this.manager = manager;
    this.el = document.createElement('pre');
    this.el.style.cssText =
      'position:fixed;right:8px;bottom:8px;margin:0;padding:6px 8px;font:11px/1.35 ui-monospace,monospace;' +
      'color:#9fe3c0;background:rgba(0,0,0,.55);pointer-events:none;z-index:20;max-width:46ch;white-space:pre-wrap';
    document.body.append(this.el);
  }

  update(): void {
    const runs = this.manager.running();
    const text = runs.length
      ? runs.map((r) => `${r.id}  ${r.step + 1}/${r.total}  ${r.elapsed.toFixed(1)}s\n  ${r.label}`).join('\n')
      : 'no sequences running';
    if (text === this.last) return;
    this.last = text;
    this.el.textContent = `sequences\n${text}`;
  }

  dispose(): void {
    this.el.remove();
  }
}
