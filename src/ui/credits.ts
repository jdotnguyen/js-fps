import { button, h } from './dom.ts';
import { createTitleWordmark } from './menus/titleWordmark.ts';

export interface HeadlineCredit {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  accent?: boolean;
}

export interface CreditEntry {
  role: string;
  name: string;
}

export interface ModelCredit {
  asset: string;
  author: string;
  licence: string;
  usedAs: string;
}

export interface CreditsOptions {
  reducedMotion?: () => boolean;
  reducedFlashing?: () => boolean;
}

/** Phase 1: biggest title credits, shown one at a time with fade-in and fade-out. */
export const HEADLINE_CREDITS: readonly HeadlineCredit[] = [
  {
    eyebrow: 'SECTION 07 // DEPTH 3,840M',
    title: 'THALASSA',
    accent: true,
  },
  {
    eyebrow: 'DIRECTED & CREATED BY',
    title: 'JUSTIN NGUYEN',
  },
  {
    eyebrow: 'STORY, DESIGN & PROGRAMMING',
    title: 'JUSTIN NGUYEN',
  },
  {
    eyebrow: 'ENGINE & RENDERING',
    title: 'JUSTIN NGUYEN',
    subtitle: 'JUST-IN-TIME 3D ENGINE // J00K80',
  },
  {
    eyebrow: 'MUSIC & SOUND DESIGN',
    title: 'JUSTIN NGUYEN',
    subtitle: '"PRESSURE" — MAIN THEME',
  },
];

/** Friends whose likenesses are used for squad characters. */
export const LIKENESS_CREDITS: readonly CreditEntry[] = [
  { role: 'Chief Engineer Katie Heins', name: 'Katie Heins' },
  { role: 'Technician August Giles', name: 'August Giles' },
];

/** Third-party 3D models from CREDITS.md. */
export const MODEL_CREDITS: readonly ModelCredit[] = [
  { asset: 'zombie monster slasher necromorph', author: 'wojciechmiedziocha', licence: 'CC BY 4.0', usedAs: 'Common Infected' },
  { asset: 'Zombie (Game character)', author: 'barnusmodels', licence: 'CC BY 4.0', usedAs: 'Common Infected' },
  { asset: 'Necromorph Slasher Varient 1 Rig', author: 'NO.DONT.EAT.ME.CASEOH', licence: 'CC BY 4.0', usedAs: 'Hero Infected' },
  { asset: 'BS-V1 Cyborg', author: 'Blue Spirit', licence: 'CC BY 4.0', usedAs: "Katie Heins' Body" },
  { asset: 'Mechanic 1', author: 'SidewalkNZ', licence: 'CC BY 4.0', usedAs: "August Giles' Body" },
  { asset: "Doctor - Sketchfab Weekly - 13 Mar'23", author: 'BrushDip', licence: 'CC BY 4.0', usedAs: "Dr. Tomas Okafor's Body" },
  { asset: 'elegant woman', author: 'adri8restuz', licence: 'CC BY 4.0', usedAs: "Priya Anand's Body" },
  { asset: 'Construction Worker In Safety Gear', author: 'restore50', licence: 'CC BY 4.0', usedAs: "Sung's Body" },
  { asset: 'Blue Overalls Technician', author: 'restore50', licence: 'CC BY 4.0', usedAs: "Ines Ruiz's Body" },
  { asset: 'A Man in suit', author: 'anuragk1229', licence: 'CC BY 4.0', usedAs: "Director Hale's Body" },
  { asset: 'Chef T pose', author: 'Imran Aziz (bayharborbutcher)', licence: 'CC BY 4.0', usedAs: "Bram's Body" },
  { asset: 'scientist', author: 'Geont', licence: 'CC BY 4.0', usedAs: 'Botanist Crew 1' },
  { asset: 'source scientist', author: 'ค Ⓡℝ𝐎𝐠𝓐ⓝ𝐓𝐚Ŝ Ｐ３𝐃➆', licence: 'CC BY 4.0', usedAs: 'Botanist Crew 2' },
  { asset: 'Scientist', author: 'Scientist Broken', licence: 'CC BY 4.0', usedAs: 'Botanist Crew 3' },
  { asset: 'Lady in a trenchcoat', author: 'ustoopia', licence: 'CC BY 4.0', usedAs: "Admin Assistant's Body" },
  { asset: 'AnimatedPistol', author: 'JUST', licence: 'CC BY 4.0', usedAs: "Jay's Pistol" },
  { asset: 'Animated Shotgun', author: 'JUST', licence: 'CC BY 4.0', usedAs: "Jay's Shotgun" },
  { asset: 'Heckler & Koch USP Pistol', author: 'Urpo', licence: 'CC BY 4.0', usedAs: 'Squad Sidearm' },
  { asset: 'Ocean floor scene', author: 'teacherap123', licence: 'CC BY 4.0', usedAs: 'Sea Floor' },
  { asset: 'Kilo-class Submarine', author: 'spacelynxcanfly', licence: 'CC BY 4.0', usedAs: 'Supply Submarine' },
  { asset: 'Location underground laboratory', author: 'bazz4r', licence: 'CC BY 4.0', usedAs: 'Underground Lab' },
  { asset: 'Laboratory Cabinet Storage PBR Low Poly Free', author: 'Naked Singularity Studio', licence: 'CC BY 4.0', usedAs: 'Lab Cabinet' },
  { asset: 'PBR material Biomasse', author: 'Bessarabian Femboy (@vjuhandkx)', licence: 'CC BY 4.0', usedAs: 'The Bloom' },
  { asset: 'Power Box 01', author: 'Rico Cilliers, Yann Kervran (Poly Haven)', licence: 'CC0', usedAs: 'Bypass Panel' },
  { asset: 'Free CC0 Industrial 3D Models', author: '3dmodelscc0', licence: 'CC0', usedAs: 'Industrial Props' },
];

export const TEXTURE_CREDITS: readonly CreditEntry[] = [
  { role: 'PaintedMetal, DiamondPlate, Rubber & Tiles', name: 'ambientCG (CC0)' },
  { role: 'Concrete Wall & Brushed Concrete', name: 'Poly Haven (CC0)' },
  { role: 'Industrial Metal Surfaces', name: 'TextureCan (CC0)' },
];

/** Motion-capture sources the character animation is baked from (scripts/mocap.sources.json, docs/mocap-sources.md). */
export const ANIMATION_CREDITS: readonly CreditEntry[] = [
  { role: 'Universal Animation Library', name: 'Quaternius (CC0)' },
  { role: 'Motion Capture Database', name: 'Carnegie Mellon University Graphics Lab' },
  { role: 'Research Motion Dataset 1 & 2', name: 'Bandai Namco Research Inc. (CC BY-NC 4.0)' },
  { role: '100STYLE Locomotion Dataset', name: 'Ian Mason, Sebastian Starke, Taku Komura (CC BY 4.0)' },
  { role: 'Zombie Walk Animation', name: 'LostBoyz2078 (CC BY-NC 4.0)' },
];

export const AUDIO_CREDITS: readonly CreditEntry[] = [
  { role: 'Infected Vocalizations', name: 'Dragon Studio' },
];

/** Longest wait for the credits' fade-in (`#credits` opacity, 700 ms in credits.css) before calling them shown. */
const COVER_FALLBACK_MS = 900;
const CARD_IN_MS = 900;
const CARD_HOLD_MS = 2100;
const CARD_OUT_MS = 900;
const CARD_GAP_MS = 250;
const SCROLL_PX_PER_SEC = 52;
const FAST_FORWARD_MULT = 3.5;

interface DustMote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  phase: number;
}

function drawVisorBrackets(ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number): void {
  const pad = Math.round(Math.min(w, h) * 0.045);
  const len = Math.round(Math.min(w, h) * 0.032);
  ctx.save();
  ctx.strokeStyle = `rgba(207, 232, 240, ${alpha})`;
  ctx.lineWidth = 1.5;
  const corners: Array<[number, number, number, number]> = [
    [pad, pad, 1, 1],
    [w - pad, pad, -1, 1],
    [pad, h - pad, 1, -1],
    [w - pad, h - pad, -1, -1],
  ];
  ctx.beginPath();
  for (const [cx, cy, sx, sy] of corners) {
    ctx.moveTo(cx + sx * len, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + sy * len);
  }
  ctx.stroke();

  ctx.font = '11px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  ctx.fillStyle = `rgba(207, 232, 240, ${alpha * 0.85})`;
  ctx.textBaseline = 'top';
  ctx.fillText('VISOR // OPTIC LINK', pad + 10, pad + 8);
  ctx.textAlign = 'right';
  ctx.fillText('DEPTH 3,840M', w - pad - 10, pad + 8);
  ctx.restore();
}

/**
 * End credits overlay: plays the visor atmosphere in the background while fading
 * headline title cards in/out, then smoothly scrolls the remaining credits.
 */
export class EndCredits {
  readonly root: HTMLElement;
  private readonly opts: CreditsOptions;
  private readonly canvas: HTMLCanvasElement;
  private readonly stage: HTMLElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly motes: DustMote[];

  private active = false;
  private raf = 0;
  private timers: Array<ReturnType<typeof setTimeout>> = [];
  private fastForward = false;
  private onCloseCb: (() => void) | null = null;
  private scrollMask: HTMLElement | null = null;
  private scrollTrack: HTMLElement | null = null;
  private scrollY = 0;
  private scrollEndY = 0;
  private scrollStarted = false;
  private scrollDone = false;

  constructor(parent: HTMLElement, opts: CreditsOptions = {}) {
    this.opts = opts;
    this.canvas = h('canvas', { class: 'credits-visor', 'aria-hidden': 'true' });
    this.stage = h('div', { class: 'credits-stage' });
    this.closeBtn = button('Close [ESC]', () => this.hide(), { class: 'credits-close-btn' });
    const controls = h(
      'div',
      { class: 'credits-controls' },
      h('span', { class: 'credits-hint', text: 'Hold Space to fast-forward' }),
      this.closeBtn,
    );
    this.root = h(
      'section',
      {
        id: 'credits',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'End credits',
        hidden: true,
      },
      this.canvas,
      this.stage,
      controls,
    );
    parent.append(this.root);

    this.motes = Array.from({ length: 34 }, (_, i) => ({
      x: ((i * 73) % 100) / 100,
      y: ((i * 41 + 17) % 100) / 100,
      vx: (((i % 5) - 2) * 0.003) + 0.002,
      vy: -0.003 - (i % 4) * 0.0015,
      r: 0.8 + (i % 3) * 0.65,
      phase: i * 0.7,
    }));
  }

  get visible(): boolean {
    return this.active;
  }

  /** The credits are open (covering, or fading in to cover, the screen). */
  get open(): boolean {
    return this.active;
  }

  /**
   * Open the credits. The returned promise settles once they fully cover the screen (their fade-in is done), so a
   * caller can change what is underneath without it showing through. `instant` skips the fade-in: for a screen that
   * is already black (the end of the slice), so nothing above the black shows through while they would fade in.
   */
  show(onClose?: () => void, opts: { instant?: boolean } = {}): Promise<void> {
    if (this.active) return Promise.resolve();
    this.active = true;
    this.onCloseCb = onClose ?? null;
    this.fastForward = false;
    this.scrollStarted = false;
    this.scrollDone = false;
    this.scrollMask = null;
    this.scrollTrack = null;
    this.stage.replaceChildren();

    this.root.hidden = false;
    this.root.classList.toggle('instant', opts.instant === true);
    if (opts.instant) this.root.classList.add('visible');
    else {
      requestAnimationFrame(() => {
        if (this.active) this.root.classList.add('visible');
      });
    }
    this.closeBtn.focus();

    addEventListener('keydown', this.onKeyDown, { capture: true });
    addEventListener('keyup', this.onKeyUp, { capture: true });
    this.root.addEventListener('wheel', this.onWheel, { passive: true });

    this.startVisorLoop();
    void this.runSequence();
    if (opts.instant) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        this.root.removeEventListener('transitionend', onEnd);
        resolve();
      };
      const onEnd = (e: TransitionEvent): void => {
        if (e.target === this.root && e.propertyName === 'opacity') done();
      };
      // Reduced motion (or a missed event) has no transition to wait for: never hold the caller past the CSS fade.
      const timer = setTimeout(done, COVER_FALLBACK_MS);
      this.root.addEventListener('transitionend', onEnd);
    });
  }

  hide(): void {
    if (!this.active) return;
    this.active = false;
    this.fastForward = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];

    removeEventListener('keydown', this.onKeyDown, { capture: true });
    removeEventListener('keyup', this.onKeyUp, { capture: true });
    this.root.removeEventListener('wheel', this.onWheel);

    this.root.classList.remove('visible', 'instant');
    this.root.hidden = true;
    this.stage.replaceChildren();
    this.scrollMask = null;
    this.scrollTrack = null;

    const cb = this.onCloseCb;
    this.onCloseCb = null;
    cb?.();
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const id = setTimeout(() => {
        this.timers = this.timers.filter((t) => t !== id);
        resolve();
      }, ms);
      this.timers.push(id);
    });
  }

  private async runSequence(): Promise<void> {
    const reduced = this.isReducedMotion();
    const fadeInMs = reduced ? 250 : CARD_IN_MS;
    const holdMs = reduced ? 1500 : CARD_HOLD_MS;
    const fadeOutMs = reduced ? 250 : CARD_OUT_MS;

    for (const card of HEADLINE_CREDITS) {
      if (!this.active) return;
      const el = h(
        'div',
        { class: `credits-card${card.accent ? ' accent' : ''}` },
        card.eyebrow ? h('div', { class: 'credits-card-eyebrow', text: card.eyebrow }) : null,
        card.title === 'THALASSA'
          ? // The game's name is its logo (the title screen's failing-display wordmark); the text stays for screen readers.
            h(
              'div',
              { class: 'credits-card-title credits-card-logo' },
              h('span', { class: 'sr-only', text: card.title }),
              createTitleWordmark({ reducedFlashing: () => this.opts.reducedFlashing?.() ?? false, reducedMotion: () => this.isReducedMotion() }),
            )
          : h('div', { class: 'credits-card-title', text: card.title }),
        card.subtitle ? h('div', { class: 'credits-card-sub', text: card.subtitle }) : null,
      );
      this.stage.replaceChildren(el);
      // Force layout before adding .active so the fade-in transition triggers.
      void el.offsetWidth;
      el.classList.add('active');
      await this.wait(fadeInMs + holdMs);
      if (!this.active) return;
      el.classList.remove('active');
      await this.wait(fadeOutMs + CARD_GAP_MS);
    }

    if (!this.active) return;
    this.startScroll();
  }

  private startScroll(): void {
    const section = (heading: string, rows: readonly CreditEntry[]): HTMLElement =>
      h(
        'div',
        { class: 'credits-section' },
        h('h2', { class: 'credits-section-heading', text: heading }),
        ...rows.map((r) =>
          h(
            'div',
            { class: 'credits-row' },
            h('span', { class: 'credits-role', text: r.role }),
            h('span', { class: 'credits-name', text: r.name }),
          ),
        ),
      );

    const modelsSection = h(
      'div',
      { class: 'credits-section' },
      h('h2', { class: 'credits-section-heading', text: '3D Models' }),
      ...MODEL_CREDITS.map((m) =>
        h(
          'div',
          { class: 'credits-model-row' },
          h('div', { class: 'credits-model-title' }, `${m.asset} — `, h('span', { class: 'credits-model-author', text: m.author })),
          h('div', { class: 'credits-model-meta', text: `${m.usedAs} · ${m.licence}` }),
        ),
      ),
    );

    const closing = h(
      'div',
      { class: 'credits-closing' },
      h('div', { class: 'credits-closing-title', text: 'THANKS FOR PLAYING' }),
      h('div', { class: 'credits-closing-sub', text: 'J00K80 // THALASSA' }),
    );

    const track = h(
      'div',
      { class: 'credits-scroll-track' },
      section('Likeness', LIKENESS_CREDITS),
      modelsSection,
      section('Motion Capture', ANIMATION_CREDITS),
      section('Textures & Surface Materials', TEXTURE_CREDITS),
      section('Additional Audio', AUDIO_CREDITS),
      closing,
    );
    const mask = h('div', { class: 'credits-scroll-mask' }, track);
    this.stage.replaceChildren(mask);

    this.scrollMask = mask;
    this.scrollTrack = track;
    const maskH = mask.clientHeight || window.innerHeight * 0.78;
    const trackH = track.scrollHeight;
    this.scrollY = maskH + 24;
    this.scrollEndY = -trackH - 40;
    this.scrollStarted = true;
    track.style.transform = `translate3d(0, ${this.scrollY.toFixed(1)}px, 0)`;
  }

  private startVisorLoop(): void {
    const ctx = this.canvas.getContext('2d');
    const t0 = performance.now();
    let lastT = 0;

    const frame = (now: number): void => {
      if (!this.active) return;
      const t = (now - t0) / 1000;
      const dt = Math.min(0.05, Math.max(0, t - lastT));
      lastT = t;

      // Advance scrolling credits if Phase 2 is active.
      if (this.scrollStarted && !this.scrollDone && this.scrollTrack) {
        const speed = SCROLL_PX_PER_SEC * (this.fastForward ? FAST_FORWARD_MULT : 1);
        this.scrollY -= speed * dt;
        if (this.scrollY <= this.scrollEndY) {
          this.scrollY = this.scrollEndY;
          this.scrollDone = true;
          void this.wait(1200).then(() => {
            if (this.active) this.hide();
          });
        }
        this.scrollTrack.style.transform = `translate3d(0, ${this.scrollY.toFixed(1)}px, 0)`;
      }

      if (ctx) this.drawVisor(ctx, t, dt);
      this.raf = requestAnimationFrame(frame);
    };

    this.raf = requestAnimationFrame(frame);
  }

  private drawVisor(ctx: CanvasRenderingContext2D, t: number, dt: number): void {
    const w = this.root.clientWidth || window.innerWidth;
    const h = this.root.clientHeight || window.innerHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.max(1, Math.round(w * dpr));
    const ch = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const reducedMotion = this.isReducedMotion();
    const reducedFlashing = this.opts.reducedFlashing?.() ?? false;
    const pulse = reducedFlashing ? 0.92 : 0.88 + 0.08 * Math.sin(t * 0.9);

    // 1. Ambient station glow behind credits.
    const cx = w * 0.5;
    const cy = h * 0.48;
    const rad = Math.max(w, h) * 0.46;
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    glow.addColorStop(0, `rgba(163, 230, 53, ${(0.055 * pulse).toFixed(3)})`);
    glow.addColorStop(0.45, `rgba(207, 232, 240, ${(0.045 * pulse).toFixed(3)})`);
    glow.addColorStop(1, 'rgba(5, 9, 12, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    // 2. Slow volumetric light sweep across the visor.
    if (!reducedMotion) {
      const cycle = (t % 11) / 11;
      const beamX = w * (-0.2 + 1.4 * cycle);
      const beamFade = Math.sin(cycle * Math.PI) * 0.65;
      if (beamFade > 0.01) {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        const beam = ctx.createLinearGradient(beamX - w * 0.14, 0, beamX + w * 0.14, h);
        beam.addColorStop(0, 'rgba(207, 232, 240, 0)');
        beam.addColorStop(0.5, `rgba(207, 232, 240, ${(0.06 * beamFade).toFixed(3)})`);
        beam.addColorStop(1, 'rgba(207, 232, 240, 0)');
        ctx.fillStyle = beam;
        ctx.beginPath();
        ctx.moveTo(beamX - w * 0.08, 0);
        ctx.lineTo(beamX + w * 0.08, 0);
        ctx.lineTo(beamX + w * 0.22, h);
        ctx.lineTo(beamX - w * 0.02, h);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }

    // 3. Drifting underwater/station dust motes.
    for (const m of this.motes) {
      if (!reducedMotion) {
        m.x = (m.x + m.vx * dt + 1) % 1;
        m.y = (m.y + m.vy * dt + 1) % 1;
      }
      const mx = m.x * w;
      const my = m.y * h;
      const dist = Math.hypot((mx - cx) / (w * 0.48), (my - cy) / (h * 0.45));
      const vis = Math.max(0, Math.min(1, 1 - dist)) * (0.35 + 0.25 * Math.sin(t * 1.8 + m.phase));
      if (vis <= 0.02) continue;
      ctx.fillStyle = `rgba(207, 232, 240, ${(vis * 0.4).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(mx, my, m.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. Worn security visor brackets & telemetry.
    drawVisorBrackets(ctx, w, h, 0.34);
  }

  private isReducedMotion(): boolean {
    return (this.opts.reducedMotion?.() ?? false) || matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.hide();
    } else if (e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      this.fastForward = true;
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === ' ' || e.key === 'ArrowDown') {
      this.fastForward = false;
    }
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.scrollStarted || this.scrollDone || !this.scrollTrack || !this.scrollMask) return;
    const maskH = this.scrollMask.clientHeight || window.innerHeight * 0.78;
    this.scrollY = Math.min(maskH + 24, Math.max(this.scrollEndY, this.scrollY - e.deltaY * 0.65));
    this.scrollTrack.style.transform = `translate3d(0, ${this.scrollY.toFixed(1)}px, 0)`;
  };
}
