import { ValidationError, arr, num, numRange, obj, optional, type Infer, type Validator } from '../core/validate.ts';

/**
 * Enemy variants (ADR-0007 `data/enemies.json`). Numbers are [Assumed] first guesses; HP is scaled by
 * the difficulty preset's `enemyHp` and lurch intervals by `enemyLurchInterval` (ADR-0008) at spawn.
 */

export const ENEMY_VARIANT_IDS = ['shambler', 'hero', 'playDead'] as const;
export type EnemyVariantId = (typeof ENEMY_VARIANT_IDS)[number];

const pair: Validator<[number, number]> = (v, p) => {
  const a = arr(num)(v, p);
  if (a.length !== 2 || a[0]! > a[1]!) throw new ValidationError(p, 'expected [min, max] with min <= max');
  return [a[0]!, a[1]!];
};

const variantShape = {
  baseHp: numRange(1, 5000),
  walk: numRange(0.1, 5),
  /** [speed m/s, seconds, min interval s, max interval s]. */
  lurch: (v: unknown, p: string): [number, number, number, number] => {
    const a = arr(num)(v, p);
    if (a.length !== 4 || a[2]! > a[3]!) throw new ValidationError(p, 'expected [speed, seconds, minInterval, maxInterval]');
    return [a[0]!, a[1]!, a[2]!, a[3]!];
  },
  attack: obj({
    range: numRange(0.3, 5),
    windup: numRange(0, 5),
    recover: numRange(0, 5),
    cooldown: numRange(0, 20),
    damage: numRange(0, 500),
    biteDamage: numRange(0, 500),
    grabChance: numRange(0, 1),
    grabDps: numRange(0, 100),
  }),
  stagger: numRange(0, 5),
  alertDelay: pair,
  wanderRadius: numRange(0, 30),
  knockback: optional(numRange(0, 20)),
  wakeRadius: optional(numRange(0.5, 20)),
  wakeBehind: optional(numRange(0, 30)),
  getUp: optional(numRange(0, 10)),
};

export type EnemyVariant = Infer<typeof variantShape>;
export type EnemyTable = Record<EnemyVariantId, EnemyVariant>;

export const validateEnemyTable: Validator<EnemyTable> = (v, p) =>
  obj({ shambler: obj(variantShape), hero: obj(variantShape), playDead: obj(variantShape) })(v, p);
