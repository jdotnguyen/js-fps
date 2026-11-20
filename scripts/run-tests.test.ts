import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TEST_CONCURRENCY, testArgs, testConcurrency } from './run-tests.ts';

test('defaults to 4 files at once on a many-core machine', () => {
  assert.equal(DEFAULT_TEST_CONCURRENCY, 4);
  assert.equal(testConcurrency({}, 24), 4);
});

test('TEST_CONCURRENCY overrides the default, capped at the CPU count', () => {
  assert.equal(testConcurrency({ TEST_CONCURRENCY: '8' }, 24), 8);
  assert.equal(testConcurrency({ TEST_CONCURRENCY: '64' }, 16), 16);
  assert.equal(testConcurrency({}, 2), 2);
});

test('a bad TEST_CONCURRENCY falls back to the default', () => {
  for (const v of ['', 'lots', '-2', '1.5']) assert.equal(testConcurrency({ TEST_CONCURRENCY: v }, 24), 4, v);
  assert.equal(testConcurrency({ TEST_CONCURRENCY: '0' }, 24), 1);
});

test('runs the whole suite unless files are given', () => {
  assert.deepEqual(testArgs([], 4), ['--experimental-strip-types', '--test', '--test-concurrency=4', 'src/**/*.test.ts', 'scripts/**/*.test.ts']);
  assert.deepEqual(testArgs(['src/a.test.ts'], 2).slice(-2), ['--test-concurrency=2', 'src/a.test.ts']);
});
