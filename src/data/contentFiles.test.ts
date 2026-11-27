import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { mergePoseFiles, mergeTables } from './mergeFiles.ts';
import { BODY_MODEL_FILES } from './bodyModelFiles.ts';
import { MOTION_FILES } from './motionFiles.ts';
import { POSE_FILES } from './poseFiles.ts';

// Spec `content-layout`: one folder per character and creature, shared poses by family, one pose name used once.

const pose = { joints: {} };

test('pose files merge into one table, in file order', () => {
  const merged = mergePoseFiles([
    ['data/poses/a.json', { poses: { idle: pose }, sequences: { up: [] } }],
    ['data/cast/b/poses.json', { poses: { b_idle: { ...pose, extends: 'idle' } }, sequences: {} }],
  ]);
  assert.deepEqual(Object.keys(merged.poses), ['idle', 'b_idle']);
  assert.deepEqual(Object.keys(merged.sequences), ['up']);
});

test('a name two files define fails loading, naming both files', () => {
  const a = ['data/poses/a.json', { poses: { idle: pose }, sequences: { up: [] } }] as const;
  assert.throws(
    () => mergePoseFiles([a, ['data/cast/b/poses.json', { poses: { idle: pose }, sequences: {} }]]),
    /pose "idle" is defined in both data\/poses\/a\.json and data\/cast\/b\/poses\.json/,
  );
  assert.throws(() => mergePoseFiles([a, ['data/poses/c.json', { poses: {}, sequences: { up: [] } }]]), /pose sequence "up" is defined in both/);
  assert.throws(
    () => mergeTables([['x.json', { priya: 1 }], ['y.json', { priya: 2 }]], 'body model'),
    /body model "priya" is defined in both x\.json and y\.json/,
  );
});

/** The files of one name in the owner folders, as the indexes name them. */
function onDisk(file: string, folders: readonly string[]): string[] {
  return folders.flatMap((dir) =>
    readdirSync(new URL(`./${dir}/`, import.meta.url))
      .filter((owner) => existsSync(new URL(`./${dir}/${owner}/${file}`, import.meta.url)))
      .map((owner) => `data/${dir}/${owner}/${file}`),
  );
}

const paths = (files: ReadonlyArray<readonly [string, unknown]>): string[] => files.map(([p]) => p).sort();

test('the indexes list every pose, body and motion file', () => {
  const families = readdirSync(new URL('./poses/', import.meta.url)).map((f) => `data/poses/${f}`);
  // The Juggernaut has its own rig: its poses are not in the shared table.
  const owned = onDisk('poses.json', ['cast', 'creatures']).filter((p) => p !== 'data/creatures/juggernaut/poses.json');
  assert.deepEqual(paths(POSE_FILES), [...families, ...owned].sort());
  assert.deepEqual(paths(BODY_MODEL_FILES), ['data/body-models.json', ...onDisk('body.json', ['cast'])].sort());
  assert.deepEqual(paths(MOTION_FILES), ['data/motion-crew.json', ...onDisk('motion.json', ['cast'])].sort());
});

test('a character\'s files define only that character', () => {
  for (const [path, table] of MOTION_FILES.slice(1)) assert.deepEqual(Object.keys(table), [path.split('/')[2]], path);
  for (const [path, table] of BODY_MODEL_FILES.slice(1)) assert.equal(Object.keys(table).length, 1, path);
});
