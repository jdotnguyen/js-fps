import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DialogueLibrary, subtitleDuration } from './library.ts';

const dir = new URL('../data/dialogue/', import.meta.url);
const readJson = (name: string): unknown => JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
const speakers = readJson('speakers.json');
const chapters = Object.fromEntries(
  readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'speakers.json' && f !== 'ui.json')
    .map((f) => [`data/dialogue/${f}`, readJson(f)]),
);

const line = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'test_01', speaker: 'engineer', text: 'Hello there.', emote: 'neutral', channel: 'local',
  priority: 'story', audio: null, minDuration: 1, choices: [], ...over,
});
const lib = (lines: unknown[]): DialogueLibrary => new DialogueLibrary(speakers, { 'test.json': { chapter: 'test', lines } });

test('shipped dialogue files are valid', () => {
  const library = new DialogueLibrary(speakers, chapters);
  assert.ok(library.allLines().length > 0);
  for (const l of library.allLines()) assert.ok(library.speaker(l.speaker));
});

test('subtitle duration follows the ADR formula', () => {
  assert.equal(subtitleDuration('Cover me, I will get this open!', 1.5), 7 * 0.35 + 0.8);
  assert.equal(subtitleDuration('Hey', 2), 2);
});

test('validator rejects bad lines with a readable path', () => {
  assert.throws(() => lib([line({ choices: ['a'] })]), /lines\[0\] > choices: dialogue choices/);
  assert.throws(() => lib([line({ emote: null })]), /emote is required unless audio/);
  assert.throws(() => lib([line({ emote: 'sad' })]), /unknown value "sad"/);
  assert.throws(() => lib([line({ speaker: 'captain' })]), /unknown speaker "captain"/);
  assert.throws(() => lib([line(), line()]), /duplicate line id "test_01"/);
  assert.throws(() => lib([line({ id: 'Bad-Id' })]), /lower_snake_case/);
  assert.throws(() => lib([line({ priorty: 'story' })]), /priorty: unknown field/);
});

test('audio lines may omit the emote', () => {
  const l = lib([line({ emote: null, audio: 'assets/vo/test_01.mp3' })]);
  assert.equal(l.line('test_01').emote, null);
});

test('crew_* speakers get stable, distinct generated voices', () => {
  const l = lib([line({ speaker: 'crew_cook' })]);
  const a = l.speaker('crew_cook');
  assert.deepEqual(l.speaker('crew_cook'), a);
  assert.notEqual(l.speaker('crew_lab').f0, a.f0);
  assert.throws(() => l.speaker('crew_'), /Unknown speaker/);
});
