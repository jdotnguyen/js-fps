/**
 * Lightweight non-WebGL title backdrop (session-loading spec): CSS abyssal depth gradient,
 * station depth/sonar SVG telemetry, and a subtle 2D canvas of drifting marine snow + caustic light.
 * Zero WebGL context; stops its RAF loop whenever a PlaySession is loading or running.
 */
export interface TitleBackdropOptions {
  reducedMotion: () => boolean;
  reducedFlashing: () => boolean;
}

interface Particle {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  alpha: number;
  phase: number;
}

const PARTICLE_COUNT = 72;

function createParticles(seed = 1337): Particle[] {
  let s = seed >>> 0;
  const rand = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  const out: Particle[] = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    out.push({
      x: rand(),
      y: rand(),
      r: 0.7 + rand() * 1.9,
      vx: (rand() - 0.5) * 0.006,
      vy: 0.004 + rand() * 0.011,
      alpha: 0.12 + rand() * 0.34,
      phase: rand() * Math.PI * 2,
    });
  }
  return out;
}

export class TitleBackdrop2D {
  readonly element: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly opts: TitleBackdropOptions;
  private readonly particles = createParticles();
  private raf: number | null = null;
  private running = false;
  private lastT = 0;
  private elapsed = 0;
  private width = 1;
  private height = 1;
  private readonly onResize = (): void => {
    this.resize();
    if (this.running && this.isReducedMotion()) this.draw(0);
  };

  constructor(parent: HTMLElement, opts: TitleBackdropOptions) {
    this.opts = opts;
    const root = document.createElement('div');
    root.id = 'title-backdrop';
    root.className = 'title-backdrop';
    root.setAttribute('aria-hidden', 'true');
    root.hidden = true;

    const canvas = document.createElement('canvas');
    canvas.className = 'title-backdrop-canvas';
    root.appendChild(canvas);

    // Subtle right-hand station depth schematic & sonar ring in pure SVG.
    const svgWrap = document.createElement('div');
    svgWrap.className = 'title-backdrop-schematic';
    svgWrap.innerHTML = `<svg viewBox="0 0 420 420" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="230" cy="210" r="165" stroke="rgba(159,216,230,0.09)" stroke-width="1" stroke-dasharray="6 8"/>
      <circle cx="230" cy="210" r="118" stroke="rgba(79,214,208,0.13)" stroke-width="1"/>
      <circle cx="230" cy="210" r="68" stroke="rgba(159,216,230,0.1)" stroke-width="1" stroke-dasharray="2 6"/>
      <line x1="230" y1="30" x2="230" y2="390" stroke="rgba(159,216,230,0.06)" stroke-width="1"/>
      <line x1="50" y1="210" x2="405" y2="210" stroke="rgba(159,216,230,0.06)" stroke-width="1"/>
      <polygon points="230,174 261,192 261,228 230,246 199,228 199,192" stroke="rgba(79,214,208,0.28)" stroke-width="1.4" fill="rgba(79,214,208,0.03)"/>
      <circle cx="230" cy="210" r="4" fill="rgba(163,230,53,0.45)"/>
      <text x="275" y="138" fill="rgba(159,216,230,0.28)" font-family="ui-monospace,Consolas,monospace" font-size="9" letter-spacing="2.4">DEPTH // 2,480M</text>
      <text x="275" y="152" fill="rgba(159,216,230,0.18)" font-family="ui-monospace,Consolas,monospace" font-size="8" letter-spacing="2">SECTOR 07 · DOCKING RING</text>
      <text x="275" y="294" fill="rgba(159,216,230,0.18)" font-family="ui-monospace,Consolas,monospace" font-size="8" letter-spacing="2">HULL PRESSURE NOMINAL</text>
    </svg>`;
    root.appendChild(svgWrap);

    parent.appendChild(root);
    this.element = root;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    if (typeof addEventListener === 'function') addEventListener('resize', this.onResize);
  }

  get active(): boolean {
    return this.running;
  }

  private isReducedMotion(): boolean {
    const sys = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)').matches : false;
    return this.opts.reducedMotion() || sys;
  }

  start(): void {
    this.element.hidden = false;
    this.resize();
    if (this.running) {
      this.refresh();
      return;
    }
    this.running = true;
    this.lastT = typeof performance !== 'undefined' ? performance.now() : 0;
    if (this.isReducedMotion()) {
      this.draw(0);
      return;
    }
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.raf !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.raf);
    }
    this.raf = null;
    this.element.hidden = true;
  }

  /** Re-evaluate reduced-motion / reduced-flashing settings while visible. */
  refresh(): void {
    if (!this.running) return;
    if (this.isReducedMotion()) {
      if (this.raf !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf);
      this.raf = null;
      this.draw(0);
    } else if (this.raf === null) {
      this.lastT = typeof performance !== 'undefined' ? performance.now() : 0;
      this.schedule();
    }
  }

  dispose(): void {
    this.stop();
    if (typeof removeEventListener === 'function') removeEventListener('resize', this.onResize);
    this.element.remove();
  }

  private schedule(): void {
    if (typeof requestAnimationFrame !== 'function') {
      this.draw(0);
      return;
    }
    this.raf = requestAnimationFrame((now) => {
      this.raf = null;
      if (!this.running) return;
      const dt = Math.min(0.1, Math.max(0, (now - this.lastT) / 1000));
      this.lastT = now;
      this.draw(dt);
      if (this.running && !this.isReducedMotion()) this.schedule();
    });
  }

  private resize(): void {
    const w = typeof innerWidth === 'number' ? innerWidth : 1280;
    const h = typeof innerHeight === 'number' ? innerHeight : 720;
    const dpr = Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
    this.width = Math.max(1, Math.round(w));
    this.height = Math.max(1, Math.round(h));
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private draw(dt: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.elapsed += dt;
    const w = this.width;
    const h = this.height;
    ctx.clearRect(0, 0, w, h);

    // Subtle drifting light shafts from above the deep-water station.
    const reducedFlash = this.opts.reducedFlashing();
    const sway = dt > 0 ? Math.sin(this.elapsed * 0.22) * w * 0.03 : 0;
    const shaft = ctx.createRadialGradient(w * 0.68 + sway, h * 0.18, 20, w * 0.65, h * 0.45, Math.max(w, h) * 0.72);
    shaft.addColorStop(0, reducedFlash ? 'rgba(42, 118, 128, 0.16)' : 'rgba(56, 148, 158, 0.2)');
    shaft.addColorStop(0.5, 'rgba(14, 46, 58, 0.08)');
    shaft.addColorStop(1, 'rgba(3, 7, 10, 0)');
    ctx.fillStyle = shaft;
    ctx.fillRect(0, 0, w, h);

    // Slow expanding sonar pulse on the right side (skipped when reduced flashing/motion).
    if (!reducedFlash && dt > 0) {
      const cycle = (this.elapsed * 0.14) % 1;
      const cx = w * 0.72;
      const cy = h * 0.5;
      const radius = 30 + cycle * Math.min(w, h) * 0.42;
      const alpha = (1 - cycle) * 0.11;
      ctx.strokeStyle = `rgba(79, 214, 208, ${alpha.toFixed(3)})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Drifting abyssal marine snow particles.
    for (const p of this.particles) {
      if (dt > 0) {
        p.x = (p.x + p.vx * dt + Math.sin(this.elapsed * 0.4 + p.phase) * 0.002 * dt + 1) % 1;
        p.y = (p.y + p.vy * dt) % 1;
      }
      const shimmer = reducedFlash ? 1 : 0.72 + 0.28 * Math.sin(this.elapsed * 0.9 + p.phase);
      ctx.fillStyle = `rgba(182, 224, 234, ${(p.alpha * shimmer).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
