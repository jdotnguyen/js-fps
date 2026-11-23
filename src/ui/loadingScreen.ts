/**
 * Fullscreen staged session loading screen (session-loading spec):
 * station graphic + deterministic progress bar (0..100%) + stage label + error recovery.
 */
export interface LoadingScreenOptions {
  reducedMotion?: () => boolean;
}

const DEFAULT_FADE_MS = 420;

export class LoadingScreen {
  readonly element: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly fillEl: HTMLElement;
  private readonly trackEl: HTMLElement;
  private readonly pctEl: HTMLElement;
  private readonly stageEl: HTMLElement;
  private readonly errorBox: HTMLElement;
  private readonly errorMsg: HTMLElement;
  private readonly backBtn: HTMLButtonElement;
  private readonly opts: LoadingScreenOptions;
  private progress = 0;
  private onBack: (() => void) | null = null;

  constructor(parent: HTMLElement, opts: LoadingScreenOptions = {}) {
    this.opts = opts;
    const root = document.createElement('div');
    root.id = 'loading-screen';
    root.className = 'loading-screen';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    root.hidden = true;

    const card = document.createElement('div');
    card.className = 'loading-card';

    const graphic = document.createElement('div');
    graphic.className = 'loading-graphic';
    graphic.setAttribute('aria-hidden', 'true');
    graphic.innerHTML =
      '<img src="/assets/brand/tag-stack-transparent.svg" alt="" width="520" height="380" draggable="false" />';

    const titleEl = document.createElement('div');
    titleEl.className = 'loading-title';
    titleEl.textContent = 'THALASSA // DEPLOYING';

    const trackEl = document.createElement('div');
    trackEl.className = 'loading-bar-track';
    trackEl.setAttribute('role', 'progressbar');
    trackEl.setAttribute('aria-valuemin', '0');
    trackEl.setAttribute('aria-valuemax', '100');
    trackEl.setAttribute('aria-valuenow', '0');

    const fillEl = document.createElement('div');
    fillEl.className = 'loading-bar-fill';
    fillEl.style.width = '0%';
    trackEl.appendChild(fillEl);

    const meta = document.createElement('div');
    meta.className = 'loading-meta';

    const stageEl = document.createElement('span');
    stageEl.className = 'loading-stage';
    stageEl.textContent = 'Initializing…';

    const pctEl = document.createElement('span');
    pctEl.className = 'loading-pct';
    pctEl.textContent = '0%';

    meta.appendChild(stageEl);
    meta.appendChild(pctEl);

    const errorBox = document.createElement('div');
    errorBox.className = 'loading-error';
    errorBox.setAttribute('role', 'alert');
    errorBox.hidden = true;

    const errorMsg = document.createElement('p');
    errorMsg.className = 'loading-error-msg';
    errorBox.appendChild(errorMsg);

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'menu-btn small';
    backBtn.textContent = 'Back to title';
    backBtn.addEventListener('click', () => this.onBack?.());
    errorBox.appendChild(backBtn);

    card.appendChild(graphic);
    card.appendChild(titleEl);
    card.appendChild(trackEl);
    card.appendChild(meta);
    card.appendChild(errorBox);
    root.appendChild(card);
    parent.appendChild(root);

    this.element = root;
    this.titleEl = titleEl;
    this.trackEl = trackEl;
    this.fillEl = fillEl;
    this.stageEl = stageEl;
    this.pctEl = pctEl;
    this.errorBox = errorBox;
    this.errorMsg = errorMsg;
    this.backBtn = backBtn;
  }

  get fraction(): number {
    return this.progress;
  }

  get stage(): string {
    return this.stageEl.textContent ?? '';
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  show(title = 'THALASSA // DEPLOYING'): void {
    this.progress = 0;
    this.onBack = null;
    this.titleEl.textContent = title;
    this.errorBox.hidden = true;
    this.errorMsg.textContent = '';
    this.fillEl.style.width = '0%';
    this.trackEl.setAttribute('aria-valuenow', '0');
    this.pctEl.textContent = '0%';
    this.stageEl.textContent = 'Initializing…';
    this.element.classList.remove('out');
    this.element.hidden = false;
  }

  /** Advance progress monotonically (clamped to [0, 1]) and update the stage label. */
  setProgress(fraction: number, label?: string): void {
    const clamped = Math.max(this.progress, Math.min(1, Number.isFinite(fraction) ? fraction : this.progress));
    this.progress = clamped;
    const pct = Math.round(clamped * 100);
    this.fillEl.style.width = `${pct}%`;
    this.trackEl.setAttribute('aria-valuenow', String(pct));
    this.pctEl.textContent = `${pct}%`;
    if (label !== undefined) this.stageEl.textContent = label;
  }

  /** Fade out and hide the loading screen. */
  async hide(fadeMs = DEFAULT_FADE_MS): Promise<void> {
    if (this.element.hidden) return;
    const reduced = this.opts.reducedMotion?.() === true;
    if (!reduced && fadeMs > 0) {
      this.element.classList.add('out');
      await new Promise((r) => setTimeout(r, fadeMs));
    }
    this.element.hidden = true;
    this.element.classList.remove('out');
  }

  /** Present a recoverable load failure with a Back to title action. */
  showError(message: string, onBackToTitle?: () => void): void {
    this.element.classList.remove('out');
    this.element.hidden = false;
    this.stageEl.textContent = 'Load failed';
    this.errorMsg.textContent = message;
    this.onBack = onBackToTitle ?? null;
    this.errorBox.hidden = false;
    this.backBtn.focus?.();
  }
}
