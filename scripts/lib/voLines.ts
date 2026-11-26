/** Dialogue lines as the VO tools see them: which have words to check, and what was recorded either side of them. */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { DialogueChapter, DialogueLine } from '../../src/data/types/dialogue.ts';
import { isNonVerbalOnly } from './voBatches.ts';
import { latestByLine, type TakeEntry } from './voTakes.ts';

const DIALOGUE_DIR = join(resolve(import.meta.dirname, '../..'), 'src/data/dialogue');

export function readLines(dir = DIALOGUE_DIR): Map<string, DialogueLine> {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'speakers.json' && f !== 'ui.json').sort();
  const lines = files.flatMap((f) => (JSON.parse(readFileSync(join(dir, f), 'utf8')) as DialogueChapter).lines);
  return new Map(lines.map((l) => [l.id, l]));
}

/**
 * The recording of a line that speech-to-text can check: its single voice clip, when the line has words. Reaction
 * pools, `react_*` takes (screams, breaths) and lines with no recording have none.
 */
export function checkableClip(line: DialogueLine): string | null {
  const audio = line.audio;
  if (typeof audio !== 'string' || !audio.startsWith('assets/vo/') || audio.startsWith('assets/vo/react_')) return null;
  return isNonVerbalOnly(line) ? null : audio;
}

/** Subtitles of the lines cut from the same batch just before and after this one. */
export function neighbourTexts(id: string, takes: readonly TakeEntry[], lines: ReadonlyMap<string, DialogueLine>): { previous: string | undefined; next: string | undefined } {
  const batch = latestByLine(takes).get(id)?.lines ?? [];
  const at = batch.indexOf(id);
  const text = (other: string | undefined): string | undefined => (other === undefined ? undefined : lines.get(other)?.text);
  return { previous: at > 0 ? text(batch[at - 1]) : undefined, next: at >= 0 ? text(batch[at + 1]) : undefined };
}
