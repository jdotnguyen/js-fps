import { ValidationError, record, str, type Validator } from '../../core/validate.ts';

/**
 * UI strings (`data/dialogue/ui.json`): short templates the HUD fills in, e.g. the access
 * hints of ADR-0024. `{item}` marks the span the HUD highlights.
 */
export type UiText = Record<string, string>;

/** Keys the game reads directly; level data may add variants such as `access_sealed_lockdown`. */
export const REQUIRED_UI_KEYS = ['access_needs_item', 'access_needs_tool', 'access_sealed', 'access_sealed_vent'] as const;

export const validateUiText: Validator<UiText> = (v, p) => {
  const table = record(str)(v, p);
  for (const key of REQUIRED_UI_KEYS) if (!(key in table)) throw new ValidationError(`${p} > ${key}`, 'missing required string');
  for (const key of ['access_needs_item', 'access_needs_tool'] as const) {
    if (!table[key]!.includes('{item}')) throw new ValidationError(`${p} > ${key}`, 'needs an {item} placeholder');
  }
  return table;
};
