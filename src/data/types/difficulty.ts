import { arr, nullable, num, numRange, obj, str, type Infer, type Validator, ValidationError } from '../../core/validate.ts';

/** Difficulty presets (ADR-0008). Every tuning number in the game reads from these. */
export const DIFFICULTY_IDS = ['story', 'standard', 'survival'] as const;
export type DifficultyId = (typeof DIFFICULTY_IDS)[number];

const presetShape = {
  label: str,
  description: str,
  playerDamageTaken: numRange(0, 5),
  enemyHp: numRange(0.1, 5),
  enemyLurchInterval: numRange(0.1, 5),
  startReserve: obj({ pistol: numRange(0, 999), shells: numRange(0, 999) }),
  dropChance: obj({ ammo: numRange(0, 1), health: numRange(0, 1) }),
  medPackHeal: numRange(0, 100),
  grabMashCount: numRange(1, 50),
  squadDamage: numRange(0, 2),
  squadAccuracy: numRange(0, 1),
  hintDelay: arr(num),
  checkpointHeal: numRange(0, 100),
  bleedOutTime: numRange(1, 300),
  reviveHp: numRange(1, 100),
  /** null = unlimited. */
  revivesPerCheckpoint: nullable(numRange(0, 99)),
  medicDownedTime: numRange(0, 120),
};

export type DifficultyPreset = Infer<typeof presetShape>;
export type DifficultyTable = Record<DifficultyId, DifficultyPreset>;

const validatePreset = obj(presetShape);

export const validateDifficultyTable: Validator<DifficultyTable> = (v, p) => {
  const table = obj({ story: validatePreset, standard: validatePreset, survival: validatePreset })(v, p);
  for (const id of DIFFICULTY_IDS) {
    const d = table[id].hintDelay;
    if (d.length !== 2 || d[0]! > d[1]!) throw new ValidationError(`${p} > ${id} > hintDelay`, 'expected [tier1, tier2] with tier1 <= tier2');
  }
  return table;
};
