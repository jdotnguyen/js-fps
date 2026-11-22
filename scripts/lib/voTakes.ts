/**
 * `scripts/vo-takes.json`: which batch, speaker, voice and model made each shipped VO clip (voice-playback
 * spec, "Shipped clips can be traced to their model"). The generators append one entry per generated batch;
 * `scripts/vo-trace.ts` seeded the entries for clips made before the record existed.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const TAKES_PATH = join(resolve(import.meta.dirname, '..'), 'vo-takes.json');

export interface TakeEntry {
  /** Batch name, or `unknown@<time>` for a traced clip whose batch WAV was overwritten. */
  batch: string;
  speakers: string[];
  /** Voice per speaker, in `speakers` order. */
  voices: string[];
  model: string;
  /** Clip ids (dialogue line ids or reaction take ids) this batch wrote. */
  lines: string[];
  /** ISO time the batch was generated. */
  at: string;
  /** `generated` by a run, or `traced` afterwards from WAV signatures and file times. */
  source: 'generated' | 'traced';
  /** Traced entries only: `direct` (the clip's own batch WAV) or `inferred` (from neighbouring WAVs). */
  confidence?: 'direct' | 'inferred';
}

export function readTakes(path = TAKES_PATH): TakeEntry[] {
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, 'utf8')) as TakeEntry[];
}

export function writeTakes(entries: readonly TakeEntry[], path = TAKES_PATH): void {
  writeFileSync(path, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
}

export function appendTake(entry: TakeEntry, path = TAKES_PATH): void {
  writeTakes([...readTakes(path), entry], path);
}

/**
 * Records a batch a generator just finished. A `--resplit` makes no new audio (it re-cuts a saved WAV), so it
 * records nothing and the clip keeps the entry of the batch that made its audio. Returns whether it recorded.
 */
export function recordBatch(
  batch: { name: string; speakers: readonly string[]; voices: readonly string[]; model: string; lines: readonly string[] },
  opts: { resplit: boolean; now?: Date; path?: string },
): boolean {
  if (opts.resplit) return false;
  appendTake(
    {
      batch: batch.name,
      speakers: [...batch.speakers],
      voices: [...batch.voices],
      model: batch.model,
      lines: [...batch.lines],
      at: (opts.now ?? new Date()).toISOString(),
      source: 'generated',
    },
    opts.path,
  );
  return true;
}

/** The latest entry for each clip id. Entries are in the order they were made. */
export function latestByLine(entries: readonly TakeEntry[]): Map<string, TakeEntry> {
  const out = new Map<string, TakeEntry>();
  for (const e of entries) for (const id of e.lines) out.set(id, e);
  return out;
}
