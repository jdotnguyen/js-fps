/**
 * The view jolt when a scripted slam lands nearby (livelier-cart-slam D8, medbay-attack "The slams jolt the view"): a
 * downward kick on the player's camera spring (`Player.addKick`), which reduced motion already scales down. It only
 * pitches the view: the player's position and control are untouched.
 */

/** Kick for the first impact, and how much each later one adds. */
export const SLAM_KICK = { base: 0.5, per: 0.25 } as const;

export interface SlamImpact {
  /** Impact count in its beat, from 1. */
  n: number;
  /** A skipped or restored kill: nothing is felt. */
  instant?: boolean | undefined;
}

/**
 * The kick to add (negative pitches the view down), or 0 when the player is not in the slam's room or one beside it.
 * `here` and `there` are room ids (the player's, the impact's); `neighbours` lists the rooms opening onto a room.
 */
export function slamKick(e: SlamImpact, here: string | undefined, there: string | undefined, neighbours: (room: string) => readonly string[]): number {
  if (e.instant || !here || !there) return 0;
  if (here !== there && !neighbours(there).includes(here)) return 0;
  return -(SLAM_KICK.base + SLAM_KICK.per * e.n);
}
