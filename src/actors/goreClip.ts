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
