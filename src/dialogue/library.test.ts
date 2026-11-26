import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
  const announcements = library.allLines().filter(l => l.speaker === 'pa');
  assert.equal(announcements.filter(l => l.priority === 'story').length, 7);
  assert.equal(announcements.filter(l => l.priority === 'background').length, 16);
  for (const l of announcements) {
    assert.equal(l.channel, 'pa');
    assert.equal(l.audio, `assets/vo/${l.id}.mp3`);
    assert.ok(existsSync(new URL(`../../public/${l.audio}`, import.meta.url)));
  }
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

test('audio lines may omit the emote and accept variant arrays', () => {
  const l = lib([
    line({ emote: null, audio: 'assets/vo/test_01.mp3' }),
    line({ id: 'test_02', emote: 'scream', audio: ['assets/vo/a.mp3', 'assets/vo/b.mp3'] }),
  ]);
  assert.equal(l.line('test_01').emote, null);
  assert.deepEqual(l.line('test_02').audio, ['assets/vo/a.mp3', 'assets/vo/b.mp3']);
  assert.throws(() => lib([line({ audio: [] })]), /audio variant array must not be empty/);
});

test('named crew speakers keep their display name and crew_* speakers get stable, distinct generated voices', () => {
  const l = lib([line({ speaker: 'crew_cook' }), line({ id: 'test_02', speaker: 'crew_mess' })]);
  assert.equal(l.speaker('crew_cook').name, 'Bram');
  const a = l.speaker('crew_mess');
  assert.deepEqual(l.speaker('crew_mess'), a);
  assert.notEqual(l.speaker('crew_lab').f0, a.f0);
  assert.throws(() => l.speaker('crew_'), /Unknown speaker/);
});
