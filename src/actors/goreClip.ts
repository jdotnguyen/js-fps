/**
 * A gore clip plane (ADR-0014 beat 5): particles and chunks thrown by a `gore` action may not
 * cross an axis-aligned plane, so spray near the medical-bay glass stays on the bay side.
 * Pure maths, no DOM, so it is unit-testable.
 */
export interface GoreClip {
  axis: 'x' | 'y' | 'z';
  /** World coordinate of the plane. */
  at: number;
  /** Which side the gore keeps to: `above` = coordinate >= `at`, `below` = coordinate <= `at`. */
  keep: 'above' | 'below';
}

/** Gap kept between a clamped particle and the plane so it does not z-fight the pane. */
export const CLIP_GAP = 0.01;

export function sameClip(a: GoreClip, b: GoreClip): boolean {
  return a.axis === b.axis && a.at === b.at && a.keep === b.keep;
}

/** True when `p` is on the forbidden side of the plane. */
export function crossed(clip: GoreClip, p: number): boolean {
  return clip.keep === 'above' ? p < clip.at : p > clip.at;
}

/**
 * Clamp one coordinate to the allowed side. Returns the new position and velocity along the
 * axis: a particle that hits the plane stops there (it splats on the glass) and loses its push
 * through it; a velocity already pointing away is kept.
 */
export function clipCoord(clip: GoreClip, p: number, v: number): [number, number] {
  if (!crossed(clip, p)) return [p, v];
  const edge = clip.keep === 'above' ? clip.at + CLIP_GAP : clip.at - CLIP_GAP;
  const away = clip.keep === 'above' ? v > 0 : v < 0;
  return [edge, away ? v : 0];
}

/** A height band on a pane that blood marks keep off, so the player can still see through it (infection-kills spec). */
export interface ClearBand {
  /** World heights (m) of the band's bottom and top. */
  min: number;
  max: number;
}

/**
 * Where a mark of height `h` aimed at centre height `y` may go: its centre moved just out of the band (below it if the
 * centre is in the lower half, above it otherwise), or `y` unchanged when it already clears the band.
 */
export function clearOfBand(y: number, h: number, band: ClearBand | undefined): number {
  if (!band) return y;
  const lo = y - h / 2;
  const hi = y + h / 2;
  if (hi <= band.min || lo >= band.max) return y;
  return y < (band.min + band.max) / 2 ? band.min - h / 2 - 0.01 : band.max + h / 2 + 0.01;
}
