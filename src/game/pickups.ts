import type { DifficultyPreset, DifficultyTable } from '../data/types/difficulty.ts';
import type { SupplyKind } from '../data/types/level.ts';

/**
 * Supply pickups (ADR-0005 step 6, ADR-0008), the pure part: how much a placed ammo box or
 * medkit gives at the current difficulty, and the need-based enemy drop roll
 * ("director-lite"). `supplies.ts` places the props and collects them.
 *
 * Amounts at Standard [Assumed]: a pistol box is 12 rounds (one magazine), a shell box 4
 * shells, a medkit heals `medPackHeal`. Other presets scale ammo by their `startReserve`
 * against Standard's (Story 48/36 pistol, Survival 24/36), so scarcity follows the same
 * numbers the player starts with. Enemy drops give half a placed box, rounded up.
 */

export const BASE_AMOUNT: Readonly<Record<SupplyKind, number>> = { ammo_pistol: 12, ammo_shotgun: 4, medkit: 40, weapon_shotgun: 0 };
/** Weapon pickups (ADR-0005): the weapon a `weapon_*` kind gives. */
export const WEAPON_PICKUP: Readonly<Partial<Record<SupplyKind, AmmoWeapon>>> = { weapon_shotgun: 'shotgun' };
/** A weapon on a rack or shelf: reachable from a little further away and higher up than a box on the floor. */
export function inWeaponReach(feet: { x: number; y: number; z: number }, at: readonly [number, number, number]): boolean {
  return Math.hypot(feet.x - at[0], feet.z - at[2]) <= 1.5 && Math.abs(feet.y - at[1]) <= 1.8;
}
export const DROP_FRACTION = 0.5;
/** Pickup radius (ADR-0005: interact-free within 1 m). */
export const PICKUP_RADIUS = 1;

export type AmmoWeapon = 'pistol' | 'shotgun';
export const WEAPON_OF: Readonly<Record<'ammo_pistol' | 'ammo_shotgun', AmmoWeapon>> = { ammo_pistol: 'pistol', ammo_shotgun: 'shotgun' };

/** Amount a supply gives at `preset`; `base` is the level's Standard amount (default per kind). */
export function supplyAmount(kind: SupplyKind, preset: DifficultyPreset, table: Pick<DifficultyTable, 'standard'>, base?: number): number {
  const std = table.standard;
  if (kind === 'medkit') {
    if (base === undefined) return preset.medPackHeal;
    return Math.max(1, Math.round((base * preset.medPackHeal) / Math.max(1, std.medPackHeal)));
  }
  const b = base ?? BASE_AMOUNT[kind];
  const ratio = kind === 'ammo_pistol' ? preset.startReserve.pistol / Math.max(1, std.startReserve.pistol) : preset.startReserve.shells / Math.max(1, std.startReserve.shells);
  return Math.max(1, Math.round(b * ratio));
}

export interface DropNeed {
  hp: number;
  /** Reserve and magazine size per weapon the player owns (missing = not owned). */
  ammo: Partial<Record<AmmoWeapon, { reserve: number; mag: number }>>;
}

export interface Drop {
  kind: SupplyKind;
  amount: number;
}

/**
 * Roll an enemy drop (ADR-0008): health chance x2 below 40 HP, ammo chance x1.5 when the
 * reserve is under one magazine, never above 1, never ammo for a weapon not owned. The ammo
 * goes to the owned weapon with the emptier reserve (relative to its magazine).
 */
export function rollDrop(preset: DifficultyPreset, table: Pick<DifficultyTable, 'standard'>, need: DropNeed, random: () => number): Drop | null {
  const health = Math.min(1, preset.dropChance.health * (need.hp < 40 ? 2 : 1));
  if (random() < health) return { kind: 'medkit', amount: Math.ceil(supplyAmount('medkit', preset, table) * DROP_FRACTION) };
  const owned = (Object.entries(need.ammo) as Array<[AmmoWeapon, { reserve: number; mag: number }]>).filter(([, a]) => a !== undefined);
  if (owned.length === 0) return null;
  owned.sort((a, b) => a[1].reserve / Math.max(1, a[1].mag) - b[1].reserve / Math.max(1, b[1].mag));
  const [weapon, a] = owned[0]!;
  const ammo = Math.min(1, preset.dropChance.ammo * (a.reserve < a.mag ? 1.5 : 1));
  if (random() >= ammo) return null;
  const kind: SupplyKind = weapon === 'pistol' ? 'ammo_pistol' : 'ammo_shotgun';
  return { kind, amount: Math.max(1, Math.ceil(supplyAmount(kind, preset, table) * DROP_FRACTION)) };
}

/** Within pickup reach of the player's feet (1 m flat, 1.2 m up or down). */
export function inReach(feet: { x: number; y: number; z: number }, at: readonly [number, number, number], radius = PICKUP_RADIUS): boolean {
  return Math.hypot(feet.x - at[0], feet.z - at[2]) <= radius && Math.abs(feet.y - at[1]) <= 1.2;
}

/** Save flag for a placed pickup that was taken (ADR-0016 flags). */
export const takenFlag = (id: string): string => `pickup:${id}`;
