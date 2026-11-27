/**
 * One hit on the player (player-hit-feedback D1): what struck, from which side of the view, from where and how
 * hard. `Player.damage` builds it once and `player:damaged` carries it to every feedback channel (camera,
 * weapon, screen, voice, sound), so they stay in step. Pure.
 */
import type { AttackKind } from '../ai/enemy.ts';

/** `generic` is a hit nobody named: a script, a hazard, the debug panel. */
export type HitKind = AttackKind | 'generic';
export type HitSide = 'L' | 'R';

/** What the attacker knows about its hit; `side` is its own arm. */
export interface PlayerHit {
  kind: HitKind;
  side?: HitSide;
}

export interface HitInfo {
  kind: HitKind;
  /** The side of the view the striking arm comes from; null when no arm struck. */
  side: HitSide | null;
  /** Where the attacker is, seen from the view: x -1 (left) to 1 (right), y -1 (below) to 1 (above). */
  dir: { x: number; y: number };
  /** 0..1: the damage taken (after difficulty) against `FULL_HIT`. */
  severity: number;
}

interface P3 {
  x: number;
  y: number;
  z: number;
}

/** Damage at which a hit's feedback is at full strength. */
export const FULL_HIT = 25;
/** How far to the side of the attacker's head its striking arm swings, metres. */
const ARM_OFFSET = 0.35;

/** The way to the blow on screen: the striking arm's side when there is one, else where the attacker is seen. */
export function struckFrom(hit: Pick<HitInfo, 'side' | 'dir'>): { x: number; y: number } {
  return hit.side ? { x: hit.side === 'L' ? -1 : 1, y: 0 } : { x: hit.dir.x, y: hit.dir.y };
}

export function hitSeverity(damage: number): number {
  return Math.min(1, Math.max(0, damage / FULL_HIT));
}

/**
 * The hit as the player sees it from `eye`, looking along `yaw` / `pitch` (-Z forward, ADR-0001). The attacker
 * faces the player when it strikes, so its arm sits to that side of `from`: a facing creature's right arm is on
 * the left of the view, and from behind it stays on the right.
 */
export function describeHit(hit: PlayerHit, damage: number, from: P3 | undefined, eye: P3, yaw: number, pitch: number): HitInfo {
  const info: HitInfo = { kind: hit.kind, side: null, dir: { x: 0, y: 0 }, severity: hitSeverity(damage) };
  if (!from) return info;
  const dx = from.x - eye.x;
  const dy = from.y - eye.y;
  const dz = from.z - eye.z;
  const length = Math.hypot(dx, dy, dz);
  if (length < 1e-6) return info;
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  // The view's up axis: world up tipped with the pitch.
  const ux = Math.sin(yaw) * sp;
  const uy = cp;
  const uz = Math.cos(yaw) * sp;
  info.dir.x = (dx * rx + dz * rz) / length;
  info.dir.y = (dx * ux + dy * uy + dz * uz) / length;
  if (hit.side) {
    // The attacker looks along from -> eye; its right is that turned a quarter turn clockwise seen from above.
    const flat = Math.hypot(dx, dz);
    const k = (hit.side === 'R' ? 1 : -1) * ARM_OFFSET;
    const ax = flat > 1e-6 ? (dz / flat) * k : 0;
    const az = flat > 1e-6 ? (-dx / flat) * k : 0;
    info.side = (dx + ax) * rx + (dz + az) * rz < 0 ? 'L' : 'R';
  }
  return info;
}
