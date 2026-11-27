/**
 * The claw marks a hit leaves on the view (player-hit-feedback D4): which cell of the atlas, where on the screen,
 * and how it draws on, holds and fades. The grade (post.ts) draws the three slots. Pure.
 *
 * Positions are screen UV (0..1, y up); sizes are in screen heights, as the shader reads them.
 */
import type { HitInfo, HitKind } from '../actors/hit.ts';

/** The atlas is a grid of square cells, row 0 at the top: swipes along it, then the bites, the slam and a spare. */
export const MARK_ATLAS = { cols: 4, rows: 2 } as const;
export type Cell = readonly [col: number, row: number];
export const MARK_CELLS: Record<'swipe' | 'bite' | 'slam', readonly Cell[]> = {
  swipe: [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
  ],
  bite: [
    [0, 1],
    [1, 1],
  ],
  slam: [[2, 1]],
};

/**
 * What a cell's art covers, as a share of the square's side (scripts/hit-marks keeps to it): swipes and bites stay
 * inside a circle of this radius, the slam is a band of this half height across the whole width.
 */
export const MARK_REACH = { swipe: 0.4, bite: 0.4, slam: 0.2 } as const;

/** Radius round the crosshair that stays clear, in screen heights (the shader masks it too). */
export const CLEAR_RADIUS = 0.18;
export const MARK_SLOTS = 3;
export const MARK_TIMING = { drawOn: 0.08, hold: 0.25, fade: 1.0 } as const;

export interface Mark {
  kind: keyof typeof MARK_CELLS;
  variant: number;
  mirrored: boolean;
  /** Centre, screen UV. */
  x: number;
  y: number;
  /** Side of the square the cell is drawn on, screen heights. */
  size: number;
  /** Radians, counter-clockwise. */
  turn: number;
  strength: number;
  age: number;
}

/** The atlas rectangle of a mark as (u, v, width, height); a negative width mirrors it. */
export function markRect(mark: Pick<Mark, 'kind' | 'variant' | 'mirrored'>): [number, number, number, number] {
  const [col, row] = MARK_CELLS[mark.kind][mark.variant]!;
  const w = 1 / MARK_ATLAS.cols;
  const h = 1 / MARK_ATLAS.rows;
  const v = 1 - (row + 1) * h;
  return mark.mirrored ? [(col + 1) * w, v, -w, h] : [col * w, v, w, h];
}

/** How far the mark is drawn along its swing and how strongly it shows (0..1 each) at its age. */
export function markState(mark: Pick<Mark, 'age' | 'strength'>): { drawn: number; opacity: number } {
  const { drawOn, hold, fade } = MARK_TIMING;
  const gone = Math.min(1, Math.max(0, (mark.age - drawOn - hold) / fade));
  const eased = 1 - gone * gone * (3 - 2 * gone);
  return { drawn: Math.min(1, mark.age / drawOn), opacity: mark.strength * eased };
}

const LIFE = MARK_TIMING.drawOn + MARK_TIMING.hold + MARK_TIMING.fade;

export class HitMarks {
  /** Fixed slots; null is empty. */
  readonly slots: (Mark | null)[] = Array.from({ length: MARK_SLOTS }, () => null);
  private last: Mark | null = null;
  private readonly random: () => number;

  constructor(random: () => number = Math.random) {
    this.random = random;
  }

  /** Leave the mark of a hit, if its kind leaves one; a fourth replaces the oldest. `aspect` is width over height. */
  add(hit: Pick<HitInfo, 'kind' | 'side' | 'dir' | 'severity'>, aspect: number): Mark | null {
    const kind = markKind(hit.kind);
    if (!kind) return null;
    const mark = this.place(kind, hit, aspect);
    let slot = this.slots.indexOf(null);
    if (slot < 0) slot = this.slots.reduce((oldest, m, i) => (m!.age > this.slots[oldest]!.age ? i : oldest), 0);
    this.slots[slot] = mark;
    this.last = mark;
    return mark;
  }

  /** Marks age on game time: no time, no change. */
  update(dt: number): void {
    for (let i = 0; i < MARK_SLOTS; i++) {
      const m = this.slots[i];
      if (!m) continue;
      m.age += dt;
      if (m.age >= LIFE) this.slots[i] = null;
    }
  }

  clear(): void {
    this.slots.fill(null);
    this.last = null;
  }

  private place(kind: keyof typeof MARK_CELLS, hit: Pick<HitInfo, 'side' | 'dir' | 'severity'>, aspect: number): Mark {
    const rand = (lo: number, hi: number): number => lo + (hi - lo) * this.random();
    const count = MARK_CELLS[kind].length;
    const before = this.last?.kind === kind ? this.last : null;
    // A different shape from the last of its kind (with one shape, the other way round).
    let variant = Math.min(count - 1, Math.floor(this.random() * count));
    if (before && count > 1 && variant === before.variant) variant = (variant + 1 + Math.floor(this.random() * (count - 1))) % count;
    const lean = hit.side ? (hit.side === 'L' ? -1 : 1) : Math.abs(hit.dir.x) > 0.15 ? Math.sign(hit.dir.x) : this.random() < 0.5 ? -1 : 1;
    const strength = 0.55 + 0.45 * hit.severity;
    const mark: Mark = { kind, variant, mirrored: false, x: 0.5, y: 0.5, size: 0.7, turn: 0, strength, age: 0 };
    if (kind === 'swipe') {
      // The art rakes from upper left to lower right: a blow from the right is its mirror image.
      mark.mirrored = lean > 0;
      mark.size = rand(0.68, 0.8);
      mark.turn = rand(-0.25, 0.25);
      // Out on the struck third, and never closer than the clear circle.
      const out = Math.max(CLEAR_RADIUS + MARK_REACH.swipe * mark.size + 0.02, aspect * 0.31) + rand(0, 0.05);
      mark.x = 0.5 + (lean * out) / aspect;
      mark.y = 0.5 + rand(-0.14, 0.14);
    } else if (kind === 'bite') {
      mark.mirrored = lean > 0;
      mark.size = rand(0.52, 0.62);
      mark.turn = rand(-0.3, 0.3);
      // Low and to the side, between the hands and the edge.
      const out = CLEAR_RADIUS + MARK_REACH.bite * mark.size + rand(0.03, 0.09);
      const angle = rand(0.85, 1.15);
      mark.x = 0.5 + (lean * Math.sin(angle) * out) / aspect;
      mark.y = 0.5 - Math.cos(angle) * out;
    } else {
      mark.mirrored = before ? !before.mirrored : this.random() < 0.5;
      mark.size = Math.max(1.3, aspect * 1.05) + rand(0, 0.08);
      mark.turn = rand(-0.03, 0.03);
      mark.x = 0.5 + rand(-0.05, 0.05);
      // The band's top stays under the clear circle; the rest runs off the bottom edge.
      mark.y = 0.5 - (CLEAR_RADIUS + MARK_REACH.slam * mark.size + 0.03);
    }
    return mark;
  }
}

function markKind(kind: HitKind): keyof typeof MARK_CELLS | null {
  return kind === 'swipe' || kind === 'bite' || kind === 'slam' ? kind : null;
}
