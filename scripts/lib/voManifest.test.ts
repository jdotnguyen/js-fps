import assert from 'node:assert/strict';
import { test } from 'node:test';
import { manifestAudio } from './voManifest.ts';

const has = (...files: string[]) => (p: string): boolean => files.includes(p);

test('a line takes its own take when the file exists', () => {
  assert.equal(manifestAudio('a_01', null, has('assets/vo/a_01.mp3')), 'assets/vo/a_01.mp3');
  assert.equal(manifestAudio('a_01', 'assets/vo/a_01.mp3', has('assets/vo/a_01.mp3')), undefined);
});

test('a line wired to another existing file is never nulled (credited scream)', () => {
  const scream = 'assets/vo/react_priya_scream_slam.mp3';
  assert.equal(manifestAudio('sec_priya_02', scream, has(scream)), undefined);
});

test('a line pointing at a missing file is nulled; an already-null line is left alone', () => {
  assert.equal(manifestAudio('a_01', 'assets/vo/gone.mp3', has()), null);
  assert.equal(manifestAudio('a_01', null, has()), undefined);
});

test('variant arrays are never touched', () => {
  assert.equal(manifestAudio('a_01', ['assets/vo/x.mp3'], has()), undefined);
});
