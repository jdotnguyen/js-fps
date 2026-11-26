/**
 * Does a clip say its line? Compares the subtitle with what speech-to-text heard (voice-playback spec, "New takes are
 * checked before they ship"). Pure, so it is tested on saved transcripts with no ffmpeg or speech model.
 *
 * A small speech model misspells names, splits words differently and mishears short ones, so words are not compared one
 * by one. Both strings become runs of letters and digits and are aligned character by character. A mishearing swaps a
 * few characters for a few others. A bad cut leaves a long run that is only in the subtitle (a phrase is missing) or
 * only in the transcript (a phrase was added), or words from the line next to it in the take.
 */

/** A run of this many characters found on one side only is a missing or added phrase ("lost her" is 7). */
export const PHRASE_CHARS = 6;
/** The same at either end of the clip, when the run is the neighbouring line's words. */
export const NEIGHBOUR_CHARS = 3;
/** Under this share of matching characters, the clip is not this line at all. */
export const MIN_MATCH = 0.6;

export interface CompareInput {
  /** The line's subtitle. */
  text: string;
  /** What speech-to-text heard. */
  heard: string;
  /** Subtitle of the line recorded just before this one in the same take. */
  previous?: string | undefined;
  /** Subtitle of the line recorded just after it. */
  next?: string | undefined;
}

const SMALL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const NUMBERS = new Map<string, string>([
  ...SMALL.map((w, i) => [w, String(i)] as const),
  ...TENS.map((w, i) => [w, String((i + 2) * 10)] as const),
  ['hundred', '00'],
]);

/** Lower-case letters and digits only, with number words as digits and bracketed or starred sound notes dropped. */
export function spokenChars(s: string): string {
  return s
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, ' ')
    .replace(/['’]/g, '')
    .split(/[^a-z0-9]+/)
    .map((w) => NUMBERS.get(w) ?? w)
    .join('');
}

interface Alignment {
  /** Characters the two strings share. */
  matched: number;
  /** Runs found in the subtitle only. */
  missing: string[];
  /** Runs found in the transcript only, with where they start and end in it. */
  added: Array<{ chars: string; start: number; end: number }>;
}

/** Global alignment with affine gaps, so a dropped or added phrase stays one run instead of scattering. */
function align(want: string, got: string): Alignment {
  const SUB = 2;
  const OPEN = 2;
  const EXTEND = 0.5;
  const rows = want.length + 1;
  const cols = got.length + 1;
  // Three layers: M ends on a pair, D on a subtitle-only character, A on a transcript-only character.
  const make = (): Float64Array => new Float64Array(rows * cols).fill(Infinity);
  const cost = [make(), make(), make()] as const;
  const from = [new Int8Array(rows * cols), new Int8Array(rows * cols), new Int8Array(rows * cols)] as const;
  cost[0][0] = 0;
  const relax = (layer: 0 | 1 | 2, at: number, prev: number, steps: readonly [number, number, number]): void => {
    for (let k = 0; k < 3; k++) {
      const c = cost[k]![prev]! + steps[k]!;
      if (c < cost[layer][at]!) {
        cost[layer][at] = c;
        from[layer][at] = k;
      }
    }
  };
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const at = i * cols + j;
      if (i > 0 && j > 0) {
        const pair = want[i - 1] === got[j - 1] ? 0 : SUB;
        relax(0, at, at - cols - 1, [pair, pair, pair]);
      }
      if (i > 0) relax(1, at, at - cols, [OPEN + EXTEND, EXTEND, OPEN + EXTEND]);
      if (j > 0) relax(2, at, at - 1, [OPEN + EXTEND, OPEN + EXTEND, EXTEND]);
    }
  }

  const out: Alignment = { matched: 0, missing: [], added: [] };
  let i = want.length;
  let j = got.length;
  const last = rows * cols - 1;
  let layer = [0, 1, 2].reduce((best, k) => (cost[k]![last]! < cost[best]![last]! ? k : best), 0);
  let missing = '';
  let added = '';
  const flush = (): void => {
    if (missing) out.missing.unshift(missing);
    if (added) out.added.unshift({ chars: added, start: j, end: j + added.length });
    missing = '';
    added = '';
  };
  while (i > 0 || j > 0) {
    const prev = from[layer]![i * cols + j]!;
    if (layer === 0) {
      flush();
      if (want[i - 1] === got[j - 1]) out.matched++;
      i--;
      j--;
    } else if (layer === 1) {
      if (added) flush();
      missing = want[i - 1]! + missing;
      i--;
    } else {
      if (missing) flush();
      added = got[j - 1]! + added;
      j--;
    }
    layer = prev;
  }
  flush();
  return out;
}

/** Why the clip does not say its line. Empty when it does. */
export function compareWords({ text, heard, previous, next }: CompareInput): string[] {
  const want = spokenChars(text);
  const got = spokenChars(heard);
  if (!want) return [];
  if (!got) return ['nothing was heard'];
  const a = align(want, got);
  const reasons: string[] = [];
  const share = a.matched / Math.max(want.length, got.length);
  if (share < MIN_MATCH) reasons.push(`does not sound like the line (${Math.round(share * 100)}% match)`);
  for (const run of a.missing) if (run.length >= PHRASE_CHARS) reasons.push(`missing "${run}"`);
  for (const run of a.added) {
    const before = previous !== undefined && run.start === 0 && run.chars.length >= NEIGHBOUR_CHARS && spokenChars(previous).endsWith(run.chars);
    const after = next !== undefined && run.end === got.length && run.chars.length >= NEIGHBOUR_CHARS && spokenChars(next).startsWith(run.chars);
    if (before) reasons.push(`starts with the previous line's "${run.chars}"`);
    else if (after) reasons.push(`ends with the next line's "${run.chars}"`);
    else if (run.chars.length >= PHRASE_CHARS) reasons.push(`added "${run.chars}"`);
  }
  return reasons;
}
