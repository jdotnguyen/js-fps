/**
 * Atmospheric visor + lighting boot splash.
 *
 * Replaces the old gore act as the default boot presentation: frames the J00K80 mark inside a
 * worn security visor with a volumetric light sweep, drifting dust motes, and a fluorescent
 * power-on flicker that settles into steady illumination.
 */
import type { Act } from './splashAct.ts';

/** Total duration of the visor lighting sequence in seconds. */
export const VISOR_ACT_LENGTH = 4.8;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * Fluorescent / LED starter flicker curve (0..1+) over time `t` (seconds).
 * Ramps up quickly, dips twice like a failing station lamp, surges, and settles near 1.
 */
export function flickerIntensity(t: number): number {
  if (t <= 0) return 0;
  if (t < 0.14) return smoothstep(0, 0.14, t) * 0.72;
  if (t < 1.18) {
    // Two crisp voltage dips around 0.36s and 0.78s with a brief surge between them.
    const dip1 = Math.exp(-Math.pow((t - 0.36) / 0.055, 2)) * 0.62;
    const dip2 = Math.exp(-Math.pow((t - 0.78) / 0.045, 2)) * 0.72;
    const dip3 = Math.exp(-Math.pow((t - 0.92) / 0.03, 2)) * 0.38;
    const surge = Math.exp(-Math.pow((t - 1.06) / 0.09, 2)) * 0.14;
    const flutter = Math.sin(t * 58) * 0.04 + Math.sin(t * 97) * 0.025;
    return Math.max(0.12, 0.86 + surge + flutter - dip1 - dip2 - dip3);
  }
  const settle = smoothstep(1.18, 1.45, t);
  const hum = Math.sin(t * 24) * 0.012;
  return 0.92 + 0.08 * settle + hum;
}

/** Normalized progress (0..1) of the volumetric light sweep across the logo. */
export function sweepProgress(t: number): number {
  const u = clamp01((t - 0.1) / 1.65);
  return 1 - Math.pow(1 - u, 3);
}

interface DustMote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  phase: number;
}

function drawBrackets(ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number): void {
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

export function playVisorSplash(root: HTMLElement, target: HTMLElement, duration = VISOR_ACT_LENGTH): Act {
  const W = root.clientWidth || window.innerWidth;
  const H = root.clientHeight || window.innerHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(W * dpr));
  canvas.height = Math.max(1, Math.round(H * dpr));
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2';
  root.append(canvas);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return { finished: Promise.resolve(), stop: () => undefined };
  }

  const motes: DustMote[] = Array.from({ length: 36 }, (_, i) => ({
    x: ((i * 73) % 100) / 100,
    y: ((i * 41 + 17) % 100) / 100,
    vx: (((i % 5) - 2) * 0.004) + 0.003,
    vy: -0.004 - (i % 4) * 0.002,
    r: 0.8 + (i % 3) * 0.65,
    phase: i * 0.7,
  }));

  let raf = 0;
  let stopped = false;
  let resolveDone!: () => void;
  const finished = new Promise<void>((r) => {
    resolveDone = r;
  });

  const cleanup = (): void => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    target.style.filter = '';
    canvas.remove();
    resolveDone();
  };

  const t0 = performance.now();
  let lastT = 0;

  const frame = (now: number): void => {
    if (stopped) return;
    const t = (now - t0) / 1000;
    const dt = Math.min(0.05, Math.max(0, t - lastT));
    lastT = t;

    const light = flickerIntensity(t);
    const bloom = clamp01((light - 0.3) / 0.7);
    const sweep = sweepProgress(t);
    const visorAlpha = smoothstep(0.05, 0.5, t) * 0.34;

    // Drive dynamic target illumination + lime/visor halo.
    target.style.filter =
      `brightness(${(0.42 + 0.62 * light).toFixed(3)}) ` +
      `drop-shadow(0 0 ${(8 + 18 * bloom).toFixed(1)}px rgba(163, 230, 53, ${(0.22 * bloom).toFixed(3)})) ` +
      `drop-shadow(0 0 ${(22 * bloom).toFixed(1)}px rgba(207, 232, 240, ${(0.16 * bloom).toFixed(3)}))`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // 1. Ambient station light behind logo.
    const cx = W * 0.5;
    const cy = H * 0.48;
    const rad = Math.max(W, H) * 0.42;
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    glow.addColorStop(0, `rgba(163, 230, 53, ${(0.07 * light).toFixed(3)})`);
    glow.addColorStop(0.45, `rgba(207, 232, 240, ${(0.055 * light).toFixed(3)})`);
    glow.addColorStop(1, 'rgba(5, 9, 12, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // 2. Volumetric light beam sweeping left-to-right across the logo.
    const beamX = W * (-0.15 + 1.3 * sweep);
    const beamFade = (1 - smoothstep(1.35, 2.1, t)) * light;
    if (beamFade > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const beam = ctx.createLinearGradient(beamX - W * 0.16, 0, beamX + W * 0.16, H);
      beam.addColorStop(0, 'rgba(207, 232, 240, 0)');
      beam.addColorStop(0.5, `rgba(207, 232, 240, ${(0.11 * beamFade).toFixed(3)})`);
      beam.addColorStop(1, 'rgba(207, 232, 240, 0)');
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(beamX - W * 0.09, 0);
      ctx.lineTo(beamX + W * 0.09, 0);
      ctx.lineTo(beamX + W * 0.24, H);
      ctx.lineTo(beamX - W * 0.02, H);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // 3. Dust motes drifting in the light.
    for (const m of motes) {
      m.x = (m.x + m.vx * dt + 1) % 1;
      m.y = (m.y + m.vy * dt + 1) % 1;
      const mx = m.x * W;
      const my = m.y * H;
      const dist = Math.hypot((mx - cx) / (W * 0.45), (my - cy) / (H * 0.4));
      const vis = clamp01(1 - dist) * light * (0.35 + 0.3 * Math.sin(t * 2.2 + m.phase));
      if (vis <= 0.02) continue;
      ctx.fillStyle = `rgba(207, 232, 240, ${(vis * 0.45).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(mx, my, m.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. Visor calibration scan sweep.
    const scanT = clamp01((t - 0.08) / 1.35);
    if (scanT > 0 && scanT < 1) {
      const sy = scanT * H;
      const scanGrad = ctx.createLinearGradient(0, sy - 28, 0, sy + 2);
      scanGrad.addColorStop(0, 'rgba(207, 232, 240, 0)');
      scanGrad.addColorStop(0.88, 'rgba(207, 232, 240, 0.06)');
      scanGrad.addColorStop(1, 'rgba(207, 232, 240, 0.22)');
      ctx.fillStyle = scanGrad;
      ctx.fillRect(0, sy - 28, W, 30);
    }

    // 5. Worn security visor brackets & telemetry.
    drawBrackets(ctx, W, H, visorAlpha);

    if (t >= duration) {
      cleanup();
      return;
    }
    raf = requestAnimationFrame(frame);
  };

  raf = requestAnimationFrame(frame);
  return { finished, stop: cleanup };
}
