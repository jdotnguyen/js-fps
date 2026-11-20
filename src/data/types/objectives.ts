import { arr, bool, obj, optional, record, scalar, str, ValidationError, type Infer, type Validator } from '../../core/validate.ts';

/**
 * Objectives (ADR-0024; hints in dialogue/hints.ts): `data/objectives.json` maps an objective id to its
 * title, whether it is required, the map area it lives in and the hint ladder a squadmate
 * walks down when the player is stuck on it. Sequences start and finish objectives with
 * `setObjective` / `completeObjective`; `startOn` / `completeOn` do it from game events
 * (e.g. the first `access:denied` that needs a Level 2 Card starts the storeroom optional).
 */

/** An event to wait for: name plus payload fields that must match, e.g. `{ "requires": "card_l2" }`. */
const eventMatchShape = {
  event: str,
  match: optional(record(scalar)),
};
export type EventMatch = Infer<typeof eventMatchShape>;

/** One hint tier: a line id, or variants used in turn on repeat visits. */
const tier: Validator<string[]> = (v, p) => (typeof v === 'string' ? [str(v, p)] : arr(str)(v, p));

const objectiveShape = {
  title: str,
  required: bool,
  /** Map area (a room `area`); the hint distance and nav pulse aim at its nearest room. */
  area: optional(str),
  /** Explicit target instead of the area: "room:<id>", "door:<id>" or "anchor:<id>". */
  target: optional(str),
  /** Hint tiers, vague to explicit. The last tier also fires the nav pulse. */
  hints: optional(arr(tier)),
  startOn: optional(obj(eventMatchShape)),
  completeOn: optional(obj(eventMatchShape)),
};
export type ObjectiveDef = Infer<typeof objectiveShape> & { id: string };
export type ObjectiveTable = Record<string, ObjectiveDef>;

/** Validate the table; with `lineIds`, every hint line must exist in the dialogue library. */
export function objectivesValidator(lineIds?: ReadonlySet<string>): Validator<ObjectiveTable> {
  const shape = record(obj(objectiveShape));
  return (v, p) => {
    const raw = shape(v, p);
    const out: ObjectiveTable = {};
    for (const [id, def] of Object.entries(raw)) {
      const ip = `${p} > ${id}`;
      if (!/^[a-z0-9_]+$/.test(id)) throw new ValidationError(ip, `objective ids are lower_snake_case, got "${id}"`);
      if (def.target !== undefined && !/^(room|door|anchor):[A-Za-z0-9_-]+$/.test(def.target)) throw new ValidationError(`${ip} > target`, 'expected "room:<id>", "door:<id>" or "anchor:<id>"');
      (def.hints ?? []).forEach((t, i) => {
        if (t.length === 0) throw new ValidationError(`${ip} > hints[${i}]`, 'empty hint tier');
        for (const line of t) if (lineIds && !lineIds.has(line)) throw new ValidationError(`${ip} > hints[${i}]`, `unknown dialogue line "${line}"`);
      });
      out[id] = { ...def, id };
    }
    return out;
  };
}
