import { clearWalk, type Navigator, type P3 } from './nav.ts';
import type { ColliderQuery } from '../actors/motor.ts';

/**
 * Giving way to Jay (shared by NpcActor and the squad AI). Everyone is solid to Jay, so anyone
 * standing still steps out of his line when he walks at them, and someone standing in a doorway
 * backs out of it. Pure maths over positions, so it runs in Node tests.
 */

/** Player footprint radius for actor separation and give-way (same as the enemy director's). */
export const PLAYER_RADIUS = 0.35;

export const GIVE_WAY = {
  /** Jay's feet this close to the body edge (plus both radii) count as contact. */
  reach: 0.35,
  /** Jay's wish must point at the body: dot(wish, Jay->body) above this. */
  facing: 0.5,
  /** Seconds of continuous pressing before the step. */
  press: 0.12,
  /** Metres the body steps aside. */
  step: 1.0,
  /** Brisk step-aside speed, turn rate and acceleration (a quick sidestep, not a scramble). */
  speed: 2.2,
  turnRate: 9,
  accel: 12,
  /** Doorway: within this of a door's centre the body backs out along the door normal. */
  doorReach: 1.2,
  doorOut: 1.5,
  /** Jay this far away and not heading at the spot... */
  clearDistance: 1.6,
  /** ...for this long: the body goes back. */
  clearTime: 1.5,
} as const;

export interface WayEnv {
  nav: Navigator | null;
  colliders: ColliderQuery | null;
  /** Is a body (another actor) standing at this circle? */
  occupied?: ((x: number, z: number, r: number) => boolean) | undefined;
}

export interface DoorSpot {
  cx: number;
  cz: number;
  /** Unit normal of the doorway (the thin axis of the door box). */
  nx: number;
  nz: number;
}

/** The nav door whose centre is within `radius` of the point, if any. */
export function doorNear(nav: Navigator | null, x: number, z: number, radius: number = GIVE_WAY.doorReach): DoorSpot | null {
  if (!nav) return null;
  for (const door of nav.doors) {
    const b = door.box;
    const cx = (b.min[0] + b.max[0]) / 2;
    const cz = (b.min[2] + b.max[2]) / 2;
    if (Math.hypot(x - cx, z - cz) > radius) continue;
    const thinX = b.max[0] - b.min[0] < b.max[2] - b.min[2];
    return { cx, cz, nx: thinX ? 1 : 0, nz: thinX ? 0 : 1 };
  }
  return null;
}

/** Is Jay pushing into this body (close enough, wish pointing at it)? */
export function pressing(x: number, z: number, r: number, feet: { x: number; z: number }, wish: { x: number; z: number }): boolean {
  const wl = Math.hypot(wish.x, wish.z);
  if (wl < 0.5) return false;
  const dx = x - feet.x;
  const dz = z - feet.z;
  const d = Math.hypot(dx, dz);
  if (d > r + PLAYER_RADIUS + GIVE_WAY.reach) return false;
  if (d < 1e-4) return true;
  return (dx * wish.x + dz * wish.z) / (d * wl) > GIVE_WAY.facing;
}

function walkable(me: P3, sx: number, sz: number, env: WayEnv, r: number): boolean {
  if (env.occupied?.(sx, sz, r)) return false;
  const to = { x: sx, y: me.y, z: sz };
  if (env.nav) return env.nav.direct(me, to, 0.2);
  if (env.colliders) return clearWalk(env.colliders, me, to, 0.2);
  return true;
}

/**
 * Where to step: out of a doorway along its normal, away from Jay; otherwise sideways out of
 * his line, on the side with a clear walk (preferring the side the body is already on, which is
 * the side he is not heading to). Null when nowhere is free.
 */
export function pickSpot(me: P3, r: number, feet: { x: number; z: number }, wish: { x: number; z: number }, env: WayEnv, doorOnly: boolean): { x: number; z: number } | null {
  const door = doorNear(env.nav, me.x, me.z);
  if (door) {
    let s = Math.sign((me.x - feet.x) * door.nx + (me.z - feet.z) * door.nz);
    if (s === 0 || Math.abs((me.x - feet.x) * door.nx + (me.z - feet.z) * door.nz) < 0.05) s = Math.sign((door.cx - feet.x) * door.nx + (door.cz - feet.z) * door.nz) || 1;
    const tx = -door.nz;
    const tz = door.nx;
    const lat = Math.max(-0.5, Math.min(0.5, (me.x - door.cx) * tx + (me.z - door.cz) * tz));
    for (const out of [GIVE_WAY.doorOut, GIVE_WAY.doorOut - 0.3]) {
      const sx = door.cx + door.nx * s * out + tx * lat;
      const sz = door.cz + door.nz * s * out + tz * lat;
      if (walkable(me, sx, sz, env, r)) return { x: sx, z: sz };
    }
  }
  if (doorOnly) return null;
  const wl = Math.hypot(wish.x, wish.z) || 1;
  const wx = wish.x / wl;
  const wz = wish.z / wl;
  const px = -wz;
  const pz = wx;
  const lateral = (me.x - feet.x) * px + (me.z - feet.z) * pz;
  const side = lateral >= 0 ? 1 : -1;
  let best: { x: number; z: number; l: number } | null = null;
  for (const dist of [GIVE_WAY.step, 0.75]) {
    for (const sd of [side, -side]) {
      const sx = me.x + px * sd * dist;
      const sz = me.z + pz * sd * dist;
      if (!walkable(me, sx, sz, env, r)) continue;
      const l = Math.abs(lateral + sd * dist);
      if (l >= r + PLAYER_RADIUS + 0.1) return { x: sx, z: sz };
      if (!best || l > best.l) best = { x: sx, z: sz, l };
    }
  }
  return best;
}

/** Press timer and hold logic for one body. The owner walks to `spot`, and decides what comes after. */
export class GiveWay {
  /** Where the body is stepping to (null = not giving way). */
  spot: { x: number; z: number } | null = null;
  private pressT = 0;
  private clearT = 0;

  reset(): void {
    this.spot = null;
    this.pressT = 0;
    this.clearT = 0;
  }

  /**
   * Call every step while the body may give way. `mode`: 'any' steps aside anywhere, 'door' only out
   * of a doorway, 'none' never. Returns true on the step a (new) spot was chosen.
   */
  press(dt: number, me: P3, r: number, feet: { x: number; z: number }, wish: { x: number; z: number } | undefined, env: WayEnv, mode: 'any' | 'door' | 'none'): boolean {
    if (mode === 'none' || !wish || !pressing(me.x, me.z, r, feet, wish)) {
      this.pressT = Math.max(0, this.pressT - dt * 2);
      return false;
    }
    this.pressT += dt;
    if (this.pressT < GIVE_WAY.press) return false;
    this.pressT = 0;
    const spot = pickSpot(me, r, feet, wish, env, mode === 'door');
    if (!spot) return false;
    this.spot = spot;
    this.clearT = 0;
    return true;
  }

  /** At the spot: true once Jay has moved on (far and not heading at it) for long enough. */
  movedOn(dt: number, feet: { x: number; z: number }, wish: { x: number; z: number } | undefined): boolean {
    const s = this.spot;
    if (!s) return false;
    const dx = s.x - feet.x;
    const dz = s.z - feet.z;
    const d = Math.hypot(dx, dz);
    const wl = wish ? Math.hypot(wish.x, wish.z) : 0;
    const heading = wish !== undefined && wl > 0.5 && d > 1e-4 && (dx * wish.x + dz * wish.z) / (d * wl) > GIVE_WAY.facing && d < 4;
    if (d > GIVE_WAY.clearDistance && !heading) this.clearT += dt;
    else this.clearT = 0;
    return this.clearT >= GIVE_WAY.clearTime;
  }
}
