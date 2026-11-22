/**
 * `npm test`: the colocated unit tests with a bounded number of test files running at once
 * (openspec change trim-memory-footprint, spec test-suite). Node's own default runs one file per CPU
 * thread, and the level tests take 400 MB-1.1 GB each, so several agents testing at once on a many-core
 * PC could exhaust RAM.
 *
 *   npm test                                 every src/ and scripts/ *.test.ts, 4 files at a time
 *   TEST_CONCURRENCY=8 npm test              more at once, for a solo run (PowerShell: $env:TEST_CONCURRENCY=8; npm test)
 *   npm test -- src/world/collision.test.ts      only the files given
 */
import { spawnSync } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_TEST_CONCURRENCY = 4;
export const DEFAULT_TEST_GLOBS: readonly string[] = ['src/**/*.test.ts', 'scripts/**/*.test.ts'];

/** Files at once: TEST_CONCURRENCY when it is a positive integer, otherwise the default; never above the CPU count. */
export function testConcurrency(env: Readonly<Record<string, string | undefined>>, cpus: number): number {
  const raw = env['TEST_CONCURRENCY'];
  const asked = raw !== undefined && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : DEFAULT_TEST_CONCURRENCY;
  return Math.max(1, Math.min(asked, Math.max(1, cpus)));
}

/** Loaded into every test file before it runs (shared clip library, Node engine loaders). */
export const TEST_SETUP = new URL('./test-setup.ts', import.meta.url).href;

/** Arguments for `node`: run the given files (or the whole suite) with the concurrency cap, after the test preload. */
export function testArgs(files: readonly string[], concurrency: number): string[] {
  return ['--experimental-strip-types', `--import=${TEST_SETUP}`, '--test', `--test-concurrency=${concurrency}`, ...(files.length > 0 ? files : DEFAULT_TEST_GLOBS)];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const concurrency = testConcurrency(process.env, availableParallelism());
  const result = spawnSync(process.execPath, testArgs(process.argv.slice(2), concurrency), { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
