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

// priya-door-rescue (medbay-attack "Priya runs into the medical bay", "A rescue attempt comes before the creature",
// "Okafor checks her over and talks her down").
test('priya-door-rescue: she runs to the door and turns, he goes to the door, and the talk-down is the breathing one', () => {
  const seq = (json('../data/sequences/action_security.json') as Array<{ id: string; steps: unknown[] }>).find((q) => q.id === 'sec_glass')!;
  const moves: Array<{ npc: string; to: string }> = [];
  const walk = (steps: unknown[]): void => {
    for (const st of steps as Array<Record<string, unknown>>) {
      if (st['do'] === 'npcMoveTo' && !st['instant']) moves.push({ npc: String(st['npc']), to: String(st['to']) });
      for (const k of ['steps', 'parallel', 'then', 'else']) if (Array.isArray(st[k])) walk(st[k] as unknown[]);
    }
  };
  walk(seq.steps);
  const hers = moves.filter((m) => m.npc === 'priya').map((m) => m.to);
  assert.equal(hers[0], 'anchor:priya_door_in', 'the run ends just inside the door');
  assert.ok(!hers.includes('anchor:priya_window') && !hers.includes('anchor:priya_wait'), `no walk to the window or the beds before she sits (${hers.join(', ')})`);
  assert.equal(moves.find((m) => m.npc === 'okafor')?.to, 'anchor:r07_medbay_door', 'Okafor goes straight to the door');
  assert.equal(library.line('cover_priya_run_02').text, "Don't shoot! Don't shoot!");
  assert.equal(library.line('sec_okafor_17').text, 'Sit down by the beds. Breathe with me. In... and out.');
  assert.match(library.line('sec_priya_18').text, /Okay\. Okay\.$/);
  for (const id of ['sec_okafor_10', 'sec_okafor_17', 'sec_priya_18']) assert.doesNotMatch(library.line(id).text, /medical advice|my line/i, id);
});
