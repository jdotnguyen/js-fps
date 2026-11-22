/**
 * TAG Industries corporate identity, drawn procedurally so it works on canvas screens and
 * worn wall decals alike. Geometry mirrors public/assets/brand/*.svg.
 *
 * Marks: `drawTagMark` (hex hull-viewport emblem), `drawTagLockup` (emblem + TAG + INDUSTRIES,
 * 600x205 design space) and `drawTagBanner` (single row, 810x100 design space).
 */

export interface TagColors {
  /** Emblem ring, wordmark and INDUSTRIES line. */
  ink: string;
  /** Descent bars and rule. */
  accent: string;
}

export const TAG_COLORS: TagColors = { ink: '#cfe8f0', accent: '#4fd6d0' };

/** Heavy chamfered capitals, 100 units tall. TAG uses T/A/G; the THALASSA title wordmark adds H/L/S. */
const LETTERS: Record<string, string> = {
  T: 'M0,0H100V22H61V100H39V22H0Z',
  A: 'M0,100L38,0H62L100,100H76L68,78H32L24,100ZM40,58H60L50,30Z',
  G: 'M20,0H100V24H28L22,30V70L28,76H76V62H54V42H100V100H20L0,80V20Z',
  H: 'M0,0H22V39H78V0H100V100H78V61H22V100H0Z',
  L: 'M0,0H22V78H80V100H0Z',
  S: 'M100,0V24H28L22,30V34L28,39H80L100,59V80L80,100H0V76H72L78,70V66L72,61H20L0,41V20L20,0Z',
};

/** Letter advance width in design units; letters not listed are 100 wide. */
const LETTER_WIDTH: Record<string, number> = { L: 80 };

export interface WordLetter {
  ch: string;
  /** SVG path data, 100 units tall, origin at the letter's top-left. */
  d: string;
  x: number;
  width: number;
}

/** Lays out `text` in the heavy capitals with `gap` units between letters. Throws on a letter with no glyph. */
export function layoutWord(text: string, gap = 24): { letters: WordLetter[]; width: number; height: 100 } {
  const letters: WordLetter[] = [];
  let x = 0;
  for (const ch of text) {
    const d = LETTERS[ch];
    if (!d) throw new Error(`logo: no glyph for '${ch}'`);
    const width = LETTER_WIDTH[ch] ?? 100;
    letters.push({ ch, d, x, width });
    x += width + gap;
  }
  return { letters, width: Math.max(0, x - gap), height: 100 };
}

const SMALL: Record<string, string> = {
  I: 'M1,0H7M4,0V14M1,14H7',
  N: 'M0,14V0L8,14V0',
  D: 'M0,0H4L8,4V10L4,14H0Z',
  U: 'M0,0V10L3,14H5L8,10V0',
  S: 'M8,0H2L0,2V5L2,7H6L8,9V12L6,14H0',
  T: 'M0,0H8M4,0V14',
  R: 'M0,14V0H6L8,2V5L6,7H0M4,7L8,14',
  E: 'M8,0H0V14H8M0,7H6',
};

const HEX_R = 72;

function hexPoints(r: number): Array<[number, number]> {
  return [0, 60, 120, 180, 240, 300].map((a) => [r * Math.sin((a * Math.PI) / 180), -r * Math.cos((a * Math.PI) / 180)]);
}

/** Emblem centred on (cx, cy); `radius` is the hexagon's circumradius in px. */
export function drawTagMark(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, c: TagColors = TAG_COLORS): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(radius / HEX_R, radius / HEX_R);
  const ring = new Path2D();
  for (const r of [HEX_R, HEX_R - 9]) {
    hexPoints(r).forEach(([x, y], i) => (i === 0 ? ring.moveTo(x, y) : ring.lineTo(x, y)));
    ring.closePath();
  }
  ctx.fillStyle = c.ink;
  ctx.fill(ring, 'evenodd');
  // Three descending bars (pressure depth).
  const top = -30;
  const bot = 34;
  const w = (y: number): number => (36 * (bot - y)) / (bot - top);
  ctx.fillStyle = c.accent;
  for (const [a, b] of [[-30, -12], [-6, 10], [16, 34]] as const) {
    ctx.beginPath();
    ctx.moveTo(-w(a), a);
    ctx.lineTo(w(a), a);
    ctx.lineTo(w(b), b);
    ctx.lineTo(-w(b), b);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = c.ink;
  for (const sx of [-1, 1]) for (const k of [-14, 0, 14]) ctx.fillRect(sx * (HEX_R + 6) - 3, -1.5 + k, 6, 3);
  ctx.restore();
}

/** Heavy "TAG" wordmark; 100 units tall, 332 wide at scale 1. */
function drawWord(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ['T', 'A', 'G'].forEach((ch, i) => {
    ctx.save();
    ctx.translate(x + i * 116, y);
    ctx.fill(new Path2D(LETTERS[ch]), 'evenodd');
    ctx.restore();
  });
}

/** Wide-tracked stroke lettering ("INDUSTRIES"), cap height 14 * s. */
function drawStrokeText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, s: number, sw: number, color: string): void {
  const gap = (width - text.length * 8 * s) / (text.length - 1);
  ctx.strokeStyle = color;
  ctx.lineWidth = sw / s;
  ctx.lineJoin = 'bevel';
  ctx.lineCap = 'butt';
  [...text].forEach((ch, i) => {
    ctx.save();
    ctx.translate(x + i * (8 * s + gap), y);
    ctx.scale(s, s);
    ctx.stroke(new Path2D(SMALL[ch]));
    ctx.restore();
  });
}

/** Horizontal lockup: emblem, TAG, rule, INDUSTRIES. Design space 600x205, drawn `width` px wide at (x, y). */
export function drawTagLockup(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, c: TagColors = TAG_COLORS): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(width / 600, width / 600);
  drawTagMark(ctx, 100, 92, 72, c);
  drawWord(ctx, 210, 30, c.ink);
  ctx.fillStyle = c.accent;
  ctx.fillRect(210, 148, 332, 3);
  drawStrokeText(ctx, 'INDUSTRIES', 210, 160, 332, 1.9, 3.0, c.ink);
  ctx.restore();
}

/** Single-row banner for headers and lintels. Design space 810x100 (aspect 8.1:1). */
export function drawTagBanner(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, c: TagColors = TAG_COLORS): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(width / 810, width / 810);
  drawTagMark(ctx, 58, 50, 45, c);
  ctx.save();
  ctx.translate(132, 0);
  ctx.scale(0.74, 0.74);
  drawWord(ctx, 0, 13.5, c.ink);
  ctx.restore();
  drawStrokeText(ctx, 'INDUSTRIES', 412, 29, 378, 3.0, 4, c.ink);
  ctx.restore();
}
