import { arr, obj, oneOf, str, type Infer, type Validator, ValidationError } from '../../core/validate.ts';

/** data/overheard.json: the voiced exchanges the player can overhear (in-world-audio spec). Lines are dialogue data. */

export const OVERHEARD_PHASES = ['before', 'after'] as const;
export type OverheardPhase = (typeof OVERHEARD_PHASES)[number];

const exchangeShape = {
  /** Also names the "already heard" game flag, `heard_<id>`. */
  id: str,
  /** The level `chat` group that speaks it; its members stay at their places until the drop. */
  chat: str,
  /** Before or after the morning briefing. Exchanges of one group and phase play in the order listed. */
  phase: oneOf(OVERHEARD_PHASES),
  /** Dialogue line ids, spoken in order. */
  lines: arr(str),
};
export type OverheardExchange = Infer<typeof exchangeShape>;

const shape = {
  /** The room the exchanges and the conversation murmur belong to. */
  room: str,
  exchanges: arr(obj(exchangeShape)),
};
export type OverheardData = Infer<typeof shape>;

const validateShape = obj(shape);

export const validateOverheard: Validator<OverheardData> = (v, p) => {
  const data = validateShape(v, p);
  const seen = new Set<string>();
  data.exchanges.forEach((x, i) => {
    const at = `${p} > exchanges[${i}]`;
    if (seen.has(x.id)) throw new ValidationError(`${at} > id`, `duplicate exchange id "${x.id}"`);
    seen.add(x.id);
    if (x.lines.length === 0) throw new ValidationError(`${at} > lines`, 'an exchange needs at least one line');
  });
  return data;
};
