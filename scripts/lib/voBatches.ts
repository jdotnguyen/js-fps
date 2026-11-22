/** Batch planning for `scripts/vo-generate.ts`: which lines go into which TTS request. */
import type { DialogueLine } from '../../src/data/types/dialogue.ts';
import { castFor } from './voCast.ts';

export interface BatchSpec {
  name: string;
  speakers: string[];
  lines: DialogueLine[];
  sceneNote: string;
}

/** Pure non-verbal reactions are reaction pools (`scripts/vo-reactions.ts`) or credited recordings, not dialogue TTS. */
export function isNonVerbalOnly(line: DialogueLine): boolean {
  const t = line.text.trim();
  if (/^\[.*\]$/.test(t)) return true;
  if (/^(ah|agh|hngh|hh|ugh|oof|hm+)[!.\-?]*$/i.test(t)) return true;
  return false;
}

function groupBySpeaker(lines: readonly DialogueLine[]): Map<string, DialogueLine[]> {
  const bySpeaker = new Map<string, DialogueLine[]>();
  for (const l of lines) {
    castFor(l.speaker); // fail before any request for a speaker with no cast entry
    const list = bySpeaker.get(l.speaker) ?? [];
    list.push(l);
    bySpeaker.set(l.speaker, list);
  }
  return bySpeaker;
}

const soloNote = (sp: string): string =>
  `Thalassa Deep Research Station, 3000m underwater. Isolated character takes for ${castFor(sp).label}.`;

export interface AllBatchesOptions {
  force: boolean;
  batchSize: number;
  pairSmall: boolean;
  /** Whether a clip for this line id already exists. */
  hasClip: (lineId: string) => boolean;
}

/**
 * Every pending line, one speaker per batch. Speakers with few lines are paired into two-speaker batches
 * to save quota, but only with a speaker pinned to the same model, since one request runs on one model.
 */
export function allBatches(allLines: readonly DialogueLine[], opts: AllBatchesOptions): BatchSpec[] {
  const pending = allLines.filter((l) => !isNonVerbalOnly(l) && (opts.force || !opts.hasClip(l.id)));
  const batches: BatchSpec[] = [];
  const small: Array<[string, DialogueLine[]]> = [];

  for (const [sp, list] of groupBySpeaker(pending)) {
    if (opts.pairSmall && list.length <= Math.floor(opts.batchSize / 2)) {
      small.push([sp, list]);
      continue;
    }
    const numChunks = Math.max(1, Math.ceil(list.length / opts.batchSize), Math.ceil(list.reduce((s, l) => s + l.text.length, 0) / 800));
    const perChunk = Math.ceil(list.length / numChunks);
    for (let idx = 0; idx < numChunks; idx++) {
      const chunk = list.slice(idx * perChunk, (idx + 1) * perChunk);
      if (chunk.length === 0) continue;
      batches.push({ name: `vo_${sp}_${String(idx + 1).padStart(2, '0')}`, speakers: [sp], lines: chunk, sceneNote: soloNote(sp) });
    }
  }

  // Pair small speakers within each model, largest first.
  const byModel = new Map<string, Array<[string, DialogueLine[]]>>();
  for (const entry of small) {
    const m = castFor(entry[0]).model;
    const list = byModel.get(m) ?? [];
    list.push(entry);
    byModel.set(m, list);
  }
  for (const group of byModel.values()) {
    group.sort((a, b) => b[1].length - a[1].length);
    for (let i = 0; i < group.length; i += 2) {
      const a = group[i]!;
      const b = group[i + 1];
      if (b) {
        batches.push({
          name: `vo_${a[0]}_${b[0]}`,
          speakers: [a[0], b[0]],
          lines: [...a[1], ...b[1]],
          sceneNote: 'Thalassa Deep Research Station, 3000m underwater. Isolated character takes for two crew members.',
        });
      } else {
        batches.push({ name: `vo_${a[0]}_01`, speakers: [a[0]], lines: a[1], sceneNote: soloNote(a[0]) });
      }
    }
  }
  return batches;
}

/**
 * Retake direction. The long-pause, no-sigh note fixes 3.1's habit of sighing between lines, but on
 * gemini-2.5-flash-preview-tts it makes the model run on into minutes of silence or stop after one line
 * (2026-11-21), so 2.5-flash retakes get the same note as its original batches.
 */
export function retakeNote(sp: string): string {
  const c = castFor(sp);
  if (c.model === 'gemini-2.5-flash-preview-tts') return soloNote(sp);
  return `Thalassa Deep Research Station, 3000m underwater. Isolated retake lines for ${c.label}. Leave a VERY LONG, completely silent 3-second pause between each line and do not sigh or breathe during the pause.`;
}

/** Longest believable raw batch: past this the model has run on, and the splits would be wrong. */
export function maxBatchSeconds(lineCount: number): number {
  return Math.max(30, 8 * lineCount);
}

/** Specific line ids, one speaker per batch. */
export function idsBatches(byId: ReadonlyMap<string, DialogueLine>, ids: readonly string[], batchSize: number): BatchSpec[] {
  const lines = ids.map((id) => {
    const l = byId.get(id);
    if (!l) throw new Error(`Unknown line id "${id}"`);
    return l;
  });
  const batches: BatchSpec[] = [];
  for (const [sp, list] of groupBySpeaker(lines)) {
    const numChunks = Math.max(1, Math.ceil(list.length / batchSize));
    const perChunk = Math.ceil(list.length / numChunks);
    for (let idx = 0; idx < numChunks; idx++) {
      const chunk = list.slice(idx * perChunk, (idx + 1) * perChunk);
      if (chunk.length === 0) continue;
      batches.push({
        name: `retake_${sp}_${String(idx + 1).padStart(2, '0')}`,
        speakers: [sp],
        lines: chunk,
        sceneNote: retakeNote(sp),
      });
    }
  }
  return batches;
}
