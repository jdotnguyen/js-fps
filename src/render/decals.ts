import * as THREE from 'three';
import { Rng } from '../core/rng.ts';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

function decalMaterial(c: HTMLCanvasElement, roughness: number): THREE.MeshStandardMaterial {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return new THREE.MeshStandardMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    roughness,
    metalness: 0,
  });
}

/** Wear: knock out flecks and a few scrapes from whatever is already painted. */
function wearOut(ctx: CanvasRenderingContext2D, rng: Rng, width: number, height: number): void {
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 900; i++) {
    ctx.globalAlpha = rng.range(0.3, 1);
    ctx.beginPath();
    ctx.arc(rng.next() * width, rng.next() * height, rng.range(0.5, 3.2), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 2;
  for (let i = 0; i < 12; i++) {
    ctx.beginPath();
    const x = rng.next() * width;
    const y = rng.next() * height;
    ctx.moveTo(x, y);
    ctx.lineTo(x + rng.range(-80, 80), y + rng.range(-10, 10));
    ctx.stroke();
  }
}

export interface StencilLine {
  text: string;
  /** Font size as a fraction of canvas height. */
  size: number;
  /** Baseline as a fraction of canvas height. */
  y: number;
}

/** Spray-stencilled, worn signage on a transparent background. */
export function stencilDecal(lines: StencilLine[], width: number, height: number, color: string, seed: string): THREE.MeshStandardMaterial {
  const [c, ctx] = canvas(width, height);
  const rng = new Rng(seed);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  for (const line of lines) {
    ctx.font = `700 ${Math.round(line.size * height)}px "DIN Condensed", "Arial Narrow", Impact, sans-serif`;
    ctx.fillText(line.text, width / 2, line.y * height);
  }
  wearOut(ctx, rng, width, height);
  return decalMaterial(c, 0.7);
}

/** Wet smears, a dragged hand and drips. Glossy, very dark red. */
export function bloodDecal(width: number, height: number, seed: string): THREE.MeshStandardMaterial {
  const [c, ctx] = canvas(width, height);
  const rng = new Rng(seed);
  const red = (a: number): string => `rgba(${rng.int(55, 85)}, ${rng.int(2, 8)}, ${rng.int(2, 6)}, ${a})`;
  ctx.lineCap = 'round';
  // Dragged smears, heavier at the top.
  for (let s = 0; s < 5; s++) {
    const x = width * rng.range(0.25, 0.75);
    const y = height * rng.range(0.15, 0.35);
    for (let k = 0; k < 14; k++) {
      ctx.strokeStyle = red(rng.range(0.05, 0.25));
      ctx.lineWidth = rng.range(4, 18);
      ctx.beginPath();
      ctx.moveTo(x + rng.range(-25, 25), y + rng.range(-10, 10));
      ctx.bezierCurveTo(
        x + rng.range(-60, 60), y + height * 0.15,
        x + rng.range(-80, 80), y + height * 0.3,
        x + rng.range(-90, 90), y + height * rng.range(0.35, 0.55),
      );
      ctx.stroke();
    }
  }
  // Hand print: palm + fingers.
  const hx = width * 0.42;
  const hy = height * 0.22;
  ctx.fillStyle = red(0.75);
  ctx.beginPath();
  ctx.ellipse(hx, hy, 26, 32, 0.2, 0, Math.PI * 2);
  ctx.fill();
  for (let f = 0; f < 4; f++) {
    ctx.beginPath();
    ctx.ellipse(hx - 24 + f * 16, hy - 46 - (f === 1 || f === 2 ? 8 : 0), 7, 20, 0.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.ellipse(hx + 32, hy - 6, 7, 17, -0.9, 0, Math.PI * 2);
  ctx.fill();
  // Drips from the heavy areas.
  for (let d = 0; d < 16; d++) {
    const x = width * rng.range(0.2, 0.8);
    const y0 = height * rng.range(0.15, 0.45);
    const len = height * rng.range(0.08, 0.45);
    const wpx = rng.range(2, 5);
    ctx.fillStyle = red(rng.range(0.6, 0.9));
    ctx.fillRect(x - wpx / 2, y0, wpx, len);
    ctx.beginPath();
    ctx.arc(x, y0 + len, wpx * 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
  const m = decalMaterial(c, 0.22);
  m.metalness = 0.1;
  return m;
}

/** Any painted-on-metal artwork (logos) drawn by `paint`, then worn like stencil signage. */
export function paintedDecal(paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, width: number, height: number, seed: string, worn = true): THREE.MeshStandardMaterial {
  const [c, ctx] = canvas(width, height);
  paint(ctx, width, height);
  if (worn) wearOut(ctx, new Rng(seed), width, height);
  return decalMaterial(c, 0.7);
}
