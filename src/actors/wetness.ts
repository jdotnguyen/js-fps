/**
 * How wet a body is from standing water (standing-water spec "Bodies stay wet", overhaul-flooded-tunnel D7): the height
 * above the feet the water has reached on it. It jumps up to the deepest the body has stood in, and dries back down
 * slowly once the body is out (about 1 cm a second, so a thigh-deep wade dries in about a minute).
 */

/** Metres of wet height lost per second out of the water. */
export const DRY_RATE = 0.01;

/** The wet height above the feet after `dt` s, standing `depth` m deep now. */
export function stepWetHeight(wet: number, depth: number, dt: number): number {
  if (depth > wet) return depth;
  return Math.max(0, wet - DRY_RATE * dt);
}

/** World height of the wet line for a body whose feet are at `feetY` (`dry` when there is none). */
export function wetLine(feetY: number, wet: number, dry: number): number {
  return wet > 0.005 ? feetY + wet : dry;
}
