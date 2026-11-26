/**
 * Transcribes shipped voice clips on this machine and lists those that do not say their line (docs/voice-casting-standard.md §8).
 * It changes nothing. A listed clip needs listening to: the small speech model also mishears.
 *
 *   node --experimental-strip-types scripts/vo-check.ts                  # every spoken line (a few minutes)
 *   node --experimental-strip-types scripts/vo-check.ts intro_jay_05 dive_jay_01
 *
 * Exit code: 0 all passed, 1 some held, 2 nothing could be checked.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { compareWords } from './lib/voCompare.ts';
import { describeHeld } from './lib/voGate.ts';
import { checkableClip, neighbourTexts, readLines } from './lib/voLines.ts';
import { sttSetup } from './lib/voStt.ts';
import { readTakes } from './lib/voTakes.ts';

const ROOT = resolve(import.meta.dirname, '..');

const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const lines = readLines();
const unknown = ids.filter((id) => !lines.has(id));
if (unknown.length > 0) {
  console.error(`[vo-check] unknown line id(s): ${unknown.join(', ')}`);
  process.exit(2);
}
const stt = sttSetup();
if (!stt.transcribe) {
  console.error(`[vo-check] nothing checked: ${stt.reason}`);
  process.exit(2);
}

const takes = readTakes();
const held: string[] = [];
const skipped: string[] = [];
let checked = 0;
for (const line of ids.length > 0 ? ids.map((id) => lines.get(id)!) : [...lines.values()]) {
  const clip = checkableClip(line);
  const path = clip === null ? null : join(ROOT, 'public', clip);
  if (path === null || !existsSync(path)) {
    skipped.push(line.id);
    continue;
  }
  const heard = stt.transcribe(path);
  const reasons = compareWords({ text: line.text, heard, ...neighbourTexts(line.id, takes, lines) });
  checked++;
  if (reasons.length === 0) continue;
  held.push(line.id);
  console.log(describeHeld(line.id, line.text, heard, reasons));
}
console.log(`\n[vo-check] checked ${checked}, held ${held.length}, skipped ${skipped.length} (non-verbal or no clip)`);
if (held.length > 0) console.log(`[vo-check] held: ${held.join(' ')}`);
if (ids.length > 0 && skipped.length > 0) console.log(`[vo-check] skipped: ${skipped.join(' ')}`);
process.exitCode = held.length > 0 ? 1 : checked === 0 ? 2 : 0;
