import { arr, num, obj, oneOf, optional, str, vec3, type Infer, type Validator, ValidationError } from '../../core/validate.ts';
import type { StationPhase } from '../../audio/ambience.ts';

/** data/roomFoley.json: positional room-life foley cues across non-Commons wings (in-world-audio spec). */

export const FOLEY_PHASES: readonly StationPhase[] = ['morning', 'lockdown', 'blackout'] as const;

const numPair: Validator<[number, number]> = (v, p) => {
  if (!Array.isArray(v) || v.length !== 2) throw new ValidationError(p, 'expected [min, max]');
  return [num(v[0], `${p}[0]`), num(v[1], `${p}[1]`)];
};

const cueShape = {
  id: str,
  room: str,
  sound: str,
  /** World-space [x, y, z] positions (desks, consoles, trusses, ducts) to pick from per firing. */
  positions: arr(vec3),
  /** Random [min, max] interval in seconds between firings. */
  every: numPair,
  gain: num,
  reverb: optional(num),
  rate: optional(numPair),
  /** Phases in which this cue may fire; omitted means all phases. */
  phases: optional(arr(oneOf(FOLEY_PHASES))),
  /** Share of gain while someone is talking (defaults to 0.5). */
  talkShare: optional(num),
};
export type RoomFoleyCue = Infer<typeof cueShape>;

const shape = {
  cues: arr(obj(cueShape)),
};
export type RoomFoleyData = Infer<typeof shape>;

const validateShape = obj(shape);

export const validateRoomFoley: Validator<RoomFoleyData> = (v, p) => {
  const data = validateShape(v, p);
  const seen = new Set<string>();
  data.cues.forEach((c, i) => {
    const at = `${p} > cues[${i}]`;
    if (seen.has(c.id)) throw new ValidationError(`${at} > id`, `duplicate foley cue id "${c.id}"`);
    seen.add(c.id);
    if (c.positions.length === 0) throw new ValidationError(`${at} > positions`, 'a cue needs at least one position');
    if (c.every[0] <= 0 || c.every[1] < c.every[0]) throw new ValidationError(`${at} > every`, 'invalid interval');
  });
  return data;
};
