import { layoutWord, TAG_COLORS } from '../../render/logo.ts';
import { h } from '../dom.ts';

/**
 * The THALASSA title wordmark: the TAG letter geometry on a station display that is failing.
 * The word wobbles as if seen through water, and at random it drops a letter (leaving a burned-in
 * ghost), tears scan rows sideways with a colour split, or loses signal behind a rolling bar.
 *
 * Reduced flashing: no signal loss or colour split, no letter shimmer, letters fade instead of
 * blinking, tears are small and at most one every 5-9 s. Reduced motion: no water wobble.
 */

export type FaultKind = 'drop' | 'tear' | 'loss';

export interface TearBand {
  /** Top of the band as a fraction of the canvas height. */
  y: number;
  /** Band height as a fraction of the canvas height. */
  h: number;
  /** Horizontal shift in design units (letters are 100 tall). */
  dx: number;
}

export interface Fault {
  kind: FaultKind;
  start: number;
  end: number;
  /** Letter a 'drop' fault blanks. */
  letter: number;
  bands: TearBand[];
}

export const WORD = layoutWord('THALASSA');
/** Design-unit margin around the word so glow, ghost and tears are not clipped. */
export const PAD = 30;
/** Largest tear shift in reduced-flashing mode, in design units. */
export const REDUCED_TEAR_DX = 6;

const between = (rand: () => number, a: number, b: number): number => a + rand() * (b - a);

/** Picks the next fault starting at `now` (ms) and when the one after it may start. */
export function planFault(now: number, reduced: boolean, rand: () => number = Math.random): { fault: Fault; next: number } {
  const pool: FaultKind[] = reduced ? ['tear', 'drop'] : ['drop', 'drop', 'tear', 'tear', 'tear', 'loss'];
  const kind = pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))] ?? 'tear';
  const dur = kind === 'loss' ? between(rand, 140, 260) : kind === 'drop' ? between(rand, 90, 260) : between(rand, 70, 200);
  const letter = Math.min(WORD.letters.length - 1, Math.floor(rand() * WORD.letters.length));
  const bandCount = kind !== 'tear' ? 0 : reduced ? 1 : 1 + Math.floor(rand() * 3);
  const maxDx = reduced ? REDUCED_TEAR_DX : 34;
  const bands = Array.from({ length: bandCount }, () => ({
    y: between(rand, 0.15, 0.85),
    h: between(rand, 0.04, 0.16),
    dx: between(rand, -1, 1) * maxDx,
  }));
  const end = now + dur;
  // A reduced drop fades over at least a second so it never reads as a blink.
  const fault: Fault = { kind, start: now, end: reduced && kind === 'drop' ? now + Math.max(dur, 1200) : end, letter, bands };
  const gap = reduced ? between(rand, 5000, 9000) : between(rand, 1400, 4500);
  return { fault, next: fault.end + gap };
}

/** Brightness multiplier (0..1) for letter `i` at `now` under `fault`. */
export function letterAlpha(fault: Fault | null, i: number, now: number, reduced: boolean): number {
  if (!fault || now < fault.start || now > fault.end) return 1;
  if (fault.kind === 'loss') return reduced ? 1 : 0.04;
  if (fault.kind !== 'drop' || i !== fault.letter) return 1;
  const p = (now - fault.start) / (fault.end - fault.start);
  // Reduced: a soft dip to 35 % and back. Full: out, a brief stutter back on, out again.
  if (reduced) return 0.35 + 0.65 * Math.abs(p * 2 - 1);
  return p > 0.55 && p < 0.65 ? 0.8 : 0;
}

/** Horizontal tear shift (design units) for a row at height fraction `y`. */
export function tearOffset(fault: Fault | null, y: number): number {
  if (fault?.kind !== 'tear') return 0;
  let dx = 0;
  for (const b of fault.bands) if (y >= b.y && y < b.y + b.h) dx += b.dx;
  return dx;
}

export interface TitleWordmarkOptions {
  reducedFlashing: () => boolean;
  reducedMotion: () => boolean;
}

/**
 * Builds the title art: the animated wordmark, an accent rule and the station line. Decorative only
 * (aria-hidden); the menu keeps the title text in its heading. The animation stops by itself once
 * the element leaves the document.
 */
export function createTitleWordmark(opts: TitleWordmarkOptions): HTMLElement {
  const canvas = h('canvas', { class: 'title-wordmark-canvas' });
  canvas.style.aspectRatio = `${WORD.width + PAD * 2} / ${WORD.height + PAD * 2}`;
  // Oversize the canvas by PAD on each side so the glow and tears can spill past the word's box.
  canvas.style.width = `${((WORD.width + PAD * 2) / WORD.width) * 100}%`;
  canvas.style.margin = `-${(PAD / WORD.width) * 100}%`;
  const root = h(
    'div',
    { class: 'title-wordmark', 'aria-hidden': 'true' },
    canvas,
    h('div', { class: 'title-wordmark-rule' }),
    h('span', { class: 'title-wordmark-station', text: 'DEEP RESEARCH STATION' }),
  );
  new FailingDisplay(canvas, opts).start();
  return root;
}

class FailingDisplay {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly word = document.createElement('canvas');
  private readonly red = document.createElement('canvas');
  private readonly blue = document.createElement('canvas');
  private readonly paths = WORD.letters.map((l) => new Path2D(l.d));
  private readonly resizer = new ResizeObserver(() => this.resize());
  private shimmer: number[] = WORD.letters.map(() => 1);
  private shimmerAt = 0;
  private fault: Fault | null = null;
  private nextFault = 0;
  private scale = 1;
  private raf = 0;
  private wasConnected = false;
  private idleFrames = 0;

  private readonly canvas: HTMLCanvasElement;
  private readonly opts: TitleWordmarkOptions;

  constructor(canvas: HTMLCanvasElement, opts: TitleWordmarkOptions) {
    this.canvas = canvas;
    this.opts = opts;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('titleWordmark: no 2D context');
    this.ctx = ctx;
  }

  start(): void {
    this.nextFault = performance.now() + 1500;
    this.resizer.observe(this.canvas);
    const tick = (now: number): void => {
      if (!this.canvas.isConnected) {
        // Built before it is attached; give up if it never is, and stop once it is removed.
        if (this.wasConnected || ++this.idleFrames > 30) return this.stop();
      } else {
        this.wasConnected = true;
        this.frame(now);
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stop(): void {
    cancelAnimationFrame(this.raf);
    this.resizer.disconnect();
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round((w * (WORD.height + PAD * 2)) / (WORD.width + PAD * 2));
    for (const c of [this.canvas, this.word, this.red, this.blue]) {
      c.width = w;
      c.height = h;
    }
    this.scale = w / (WORD.width + PAD * 2);
  }

  private tint(dst: HTMLCanvasElement, color: string): void {
    const x = dst.getContext('2d');
    if (!x) return;
    x.globalCompositeOperation = 'copy';
    x.drawImage(this.word, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color;
    x.fillRect(0, 0, dst.width, dst.height);
  }

  private frame(now: number): void {
    const W = this.canvas.width;
    const H = this.canvas.height;
    if (W < 2 || H < 2) return;
    const reduced = this.opts.reducedFlashing();
    const still = this.opts.reducedMotion();
    const s = this.scale;
    const t = now / 1000;

    if (this.fault && now > this.fault.end) this.fault = null;
    if (!this.fault && now > this.nextFault) ({ fault: this.fault, next: this.nextFault } = planFault(now, reduced));
    const fault = this.fault;
    if (reduced) this.shimmer.fill(1);
    else if (now > this.shimmerAt) {
      this.shimmer = this.shimmer.map(() => 0.9 + Math.random() * 0.1);
      this.shimmerAt = now + 60 + Math.random() * 80;
    }

    // The word, into an offscreen buffer.
    const o = this.word.getContext('2d');
    if (!o) return;
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.clearRect(0, 0, W, H);
    o.setTransform(s, 0, 0, s, PAD * s, PAD * s);
    // Burn-in: a faint stuck copy, offset, that shows through when letters drop.
    o.globalAlpha = 0.09;
    o.fillStyle = TAG_COLORS.accent;
    WORD.letters.forEach((l, i) => this.fillLetter(o, i, l.x + 2.5, 1.5));
    o.shadowColor = 'rgb(79 214 208 / 0.55)';
    o.shadowBlur = 14 * s;
    o.fillStyle = TAG_COLORS.ink;
    WORD.letters.forEach((l, i) => {
      o.globalAlpha = (this.shimmer[i] ?? 1) * letterAlpha(fault, i, now, reduced);
      this.fillLetter(o, i, l.x, 0);
    });
    o.shadowBlur = 0;
    o.globalAlpha = 1;

    // Out to the screen in strips: slow water wobble plus torn bands.
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const split = !reduced && fault !== null && fault.kind !== 'drop';
    if (split) {
      this.tint(this.red, '#ff2a4a');
      this.tint(this.blue, '#2ad8ff');
    }
    const strip = Math.max(2, Math.round(2 * (window.devicePixelRatio || 1)));
    for (let y = 0; y < H; y += strip) {
      const wobble = still ? 0 : Math.sin((y / H) * 9 + t * 1.1) * 1.3 + Math.sin((y / H) * 23 - t * 0.7) * 0.5;
      const dx = (wobble + tearOffset(fault, y / H)) * s;
      if (split) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.55;
        ctx.drawImage(this.red, 0, y, W, strip, dx - 4 * s, y, W, strip);
        ctx.drawImage(this.blue, 0, y, W, strip, dx + 4 * s, y, W, strip);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
      ctx.drawImage(this.word, 0, y, W, strip, dx, y, W, strip);
    }

    // A rolling bar while the signal comes back.
    if (fault?.kind === 'loss' && !reduced) {
      const y = ((now - fault.start) / (fault.end - fault.start)) * H;
      const g = ctx.createLinearGradient(0, y - 14 * s, 0, y + 14 * s);
      g.addColorStop(0, 'rgb(207 232 240 / 0)');
      g.addColorStop(0.5, 'rgb(207 232 240 / 0.22)');
      g.addColorStop(1, 'rgb(207 232 240 / 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, y - 14 * s, W, 28 * s);
    }
  }

  private fillLetter(o: CanvasRenderingContext2D, i: number, x: number, y: number): void {
    const path = this.paths[i];
    if (!path) return;
    o.save();
    o.translate(x, y);
    o.fill(path, 'evenodd');
    o.restore();
  }
}
