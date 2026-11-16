/** Browser loader: every data/sequences/*.json file, validated at boot (ADR-0009). */
import { validateSequences } from './schema.ts';
import type { SequenceDef } from './types.ts';

const files = import.meta.glob<unknown>('../data/sequences/*.json', { eager: true, import: 'default' });

export function loadSequences(): SequenceDef[] {
  const named: Record<string, unknown> = {};
  for (const [path, data] of Object.entries(files)) named[path.replace('../', '')] = data;
  return validateSequences(named);
}
