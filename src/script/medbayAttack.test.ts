/**
 * The R08 medical bay attack as the player sees it (medbay-attack spec, change overhaul-priya-r08-death): the lines it
 * speaks, and (as the scene lands) its staging, Jay's helplessness, the aftermath and skip/restore.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DialogueLibrary } from '../dialogue/library.ts';
import { validateSequences } from './schema.ts';

const json = (rel: string): any => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const library = new DialogueLibrary(json('../data/dialogue/speakers.json'), {
  slice01: json('../data/dialogue/slice01.json'),
  slice01_action: json('../data/dialogue/slice01_action.json'),
  slice01_rounds: json('../data/dialogue/slice01_rounds.json'),
});
const secGlass = validateSequences({ 'action_security.json': json('../data/sequences/action_security.json') }).find((d) => d.id === 'sec_glass')!;

/** Every line id a step tree says (`say` steps and a kill step's lines). */
function linesIn(x: unknown, out: string[] = []): string[] {
  if (Array.isArray(x)) for (const v of x) linesIn(v, out);
  else if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    if (o['do'] === 'say' && typeof o['line'] === 'string') out.push(o['line']);
    for (const v of Object.values(o)) linesIn(v, out);
  }
  return out;
}

test('her name once: Okafor says "Priya" exactly once in the scene', () => {
  const okafor = linesIn(secGlass).filter((id) => library.line(id).speaker === 'medic');
  const named = okafor.filter((id) => /\bPriya\b/.test(library.line(id).text));
  assert.deepEqual(named, ['sec_okafor_03'], `Okafor's lines naming her: ${named.join(', ')}`);
});

test("Jay's shouts at the glass never use her name", () => {
  const bangs = library.allLines().filter((l) => l.id.startsWith('sec_jay_bang_'));
  assert.equal(bangs.length, 4);
  for (const l of bangs) assert.ok(!/Priya/.test(l.text), l.id);
});
