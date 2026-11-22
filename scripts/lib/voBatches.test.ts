import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DialogueLine } from '../../src/data/types/dialogue.ts';
import { allBatches, idsBatches, maxBatchSeconds, retakeNote } from './voBatches.ts';
import { batchModel } from './voCast.ts';

const line = (id: string, speaker: string): DialogueLine => ({ id, speaker, text: 'Morning. Coffee is on.', emote: 'neutral' }) as DialogueLine;
const opts = { force: true, batchSize: 14, pairSmall: true, hasClip: () => false };

test('batches: small speakers only pair with a speaker on the same model', () => {
  const lines = [
    line('r1', 'crew_ruiz'), line('r2', 'crew_ruiz'),
    line('a1', 'crew_assistant'), line('a2', 'crew_assistant'),
    line('m1', 'crew_mess'),
    line('t1', 'crew_maint'),
  ];
  const batches = allBatches(lines, opts);
  const find = (sp: string) => batches.find((b) => b.speakers.includes(sp))!;
  assert.notEqual(find('crew_ruiz'), find('crew_assistant'), 'Ruiz (3.1) and the assistant (3.8) must be separate requests');
  assert.deepEqual(find('crew_ruiz').speakers, ['crew_ruiz']);
  // The three 3.8 speakers: the two largest pair, the third goes alone, and every batch has one model.
  assert.equal(find('crew_assistant').speakers.length, 2);
  for (const b of batches) assert.doesNotThrow(() => batchModel(b.speakers), b.name);
});

test('batches: crew_mess and crew_maint still pair when they are the only small 3.8 speakers', () => {
  const batches = allBatches([line('m1', 'crew_mess'), line('t1', 'crew_maint')], opts);
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0]!.speakers.sort(), ['crew_maint', 'crew_mess']);
});

test('batches: lines that already have a clip are skipped unless forced', () => {
  const lines = [line('g1', 'engineer'), line('g2', 'engineer')];
  const batches = allBatches(lines, { ...opts, force: false, pairSmall: false, hasClip: (id) => id === 'g1' });
  assert.deepEqual(batches.flatMap((b) => b.lines.map((l) => l.id)), ['g2']);
});

test('batches: 2.5-flash retakes use the plain note; 3.1 retakes keep the long-pause note', () => {
  const byId = new Map([
    ['g1', line('g1', 'engineer')],
    ['j1', line('j1', 'player')],
  ]);
  const [giles, jay] = idsBatches(byId, ['g1', 'j1'], 14);
  assert.doesNotMatch(giles!.sceneNote, /VERY LONG/);
  assert.equal(giles!.sceneNote, retakeNote('engineer'));
  assert.match(jay!.sceneNote, /VERY LONG/);
});

test('batches: raw batches far longer than their lines are treated as runaway output', () => {
  // Good batches seen so far: 9 guard lines in 51.8 s, 13 Okafor lines in 30.7 s, 11 Heins lines in 42 s.
  assert.ok(51.8 <= maxBatchSeconds(9));
  assert.ok(42 <= maxBatchSeconds(11));
  // The runaway 2.5-flash batches of 2026-11-21.
  assert.ok(655 > maxBatchSeconds(13));
  assert.ok(225 > maxBatchSeconds(9));
  assert.ok(133 > maxBatchSeconds(8));
  assert.equal(maxBatchSeconds(1), 30);
});
