/** Validation for sequence JSON (ADR-0009), with readable paths in every error. */
import { ValidationError, arr, bool, obj, optional, record, scalar, str, type Validator } from '../core/validate.ts';
import { stepsV } from './actions.ts';
import type { SequenceDef } from './types.ts';

const id: Validator<string> = (v, p) => {
  const s = str(v, p);
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new ValidationError(p, `ids use letters, digits, _ and - only, got "${s}"`);
  return s;
};

export const sequenceV = obj({
  id,
  trigger: optional(obj({ event: str, requires: optional(str) })),
  once: optional(bool),
  exclusive: optional(str),
  resumeFromCheckpoint: optional(bool),
  debugSetup: optional(obj({ flags: optional(record(scalar)) })),
  steps: stepsV,
}) as Validator<SequenceDef>;

/**
 * Validate every sequence file. A file holds one sequence or an array of them; ids must
 * be unique across all files.
 */
export function validateSequences(files: Record<string, unknown>): SequenceDef[] {
  const out: SequenceDef[] = [];
  const seen = new Map<string, string>();
  for (const [name, raw] of Object.entries(files)) {
    const list = Array.isArray(raw) ? arr(sequenceV)(raw, name) : [sequenceV(raw, name)];
    for (const [i, def] of list.entries()) {
      const where = Array.isArray(raw) ? `${name}[${i}]` : name;
      const prior = seen.get(def.id);
      if (prior) throw new ValidationError(`${where} > id`, `duplicate sequence id "${def.id}" (also in ${prior})`);
      seen.set(def.id, where);
      out.push(def);
    }
  }
  return out;
}
