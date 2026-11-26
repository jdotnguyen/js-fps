import { arr, obj, oneOf, optional, str, type Infer, type Validator, ValidationError } from '../../core/validate.ts';

/**
 * data/overheard.json: voiced background exchanges and solo ambient work snippets across populated
 * quiet-half rooms (in-world-audio spec). Lines are dialogue data.
 */

export const OVERHEARD_PHASES = ['before', 'after'] as const;
export type OverheardPhase = (typeof OVERHEARD_PHASES)[number];

const exchangeShape = {
  /** Also names the "already heard" game flag, `heard_<id>`. */
  id: str,
  /** Room id where this exchange or snippet plays; falls back to top-level `room` when omitted. */
  room: optional(str),
  /** Level `chat` group (2+ NPCs) that speaks it; mutually exclusive with `speaker`. */
  chat: optional(str),
  /** Single NPC id for a solo ambient work snippet; mutually exclusive with `chat`. */
  speaker: optional(str),
  /** Legacy Commons phase (`before` or `after` morning briefing); optional when `requires`/`unless` are set. */
  phase: optional(oneOf(OVERHEARD_PHASES)),
  /** Game flags that must all be true before this item may start. */
  requires: optional(arr(str)),
  /** Game flags that must all be false for this item to start. */
  unless: optional(arr(str)),
  /** Dialogue line ids, spoken in order. */
  lines: arr(str),
};
export type OverheardExchange = Infer<typeof exchangeShape>;

const shape = {
  /** Default room (Commons `R02`) for exchanges that omit `room` and for Commons-scoped helpers. */
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
    const hasChat = x.chat !== undefined;
    const hasSpeaker = x.speaker !== undefined;
    if (hasChat === hasSpeaker) {
      throw new ValidationError(at, 'an exchange must specify exactly one of "chat" or "speaker"');
    }
  });
  return data;
};
