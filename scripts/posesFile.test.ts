import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
// @ts-expect-error plain ES module without types
import { poseFilePaths, setPoses } from './lib/posesFile.mjs';
import { POSE_FILES } from '../src/data/poseFiles.ts';

test('pose writer: it searches the files the game loads', () => {
  const found = (poseFilePaths() as URL[]).map((u) => u.pathname.slice(u.pathname.lastIndexOf('/src/') + 5)).sort();
  assert.deepEqual(found, POSE_FILES.map(([p]) => p).sort());
});

test('pose writer: an existing pose changes in its own file, a new one goes to the given file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poses-'));
  const file = (name: string, text: string): URL => {
    fs.writeFileSync(path.join(dir, name), text);
    return pathToFileURL(path.join(dir, name));
  };
  const first = file('first.json', '{\n "poses": {\n  "a": {\n   "joints": {}\n  },\n  "b": {\n   "joints": { "spine": [95.0, 0, 0] }\n  }\n },\n "sequences": {}\n}\n');
  const empty = file('empty.json', '{\n "poses": {},\n "sequences": {}\n}\n');
  setPoses({ a: { joints: { head: [1, 0, 0] } }, c: { joints: {} } }, empty, [first, empty]);
  const text = fs.readFileSync(first, 'utf8');
  assert.deepEqual(JSON.parse(text).poses.a, { joints: { head: [1, 0, 0] } });
  assert.match(text, /95\.0/, 'the other poses keep their text');
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(empty, 'utf8')).poses), ['c']);
  setPoses({ d: { joints: {} } }, first, [first, empty]);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(first, 'utf8')).poses), ['a', 'b', 'd']);
  fs.rmSync(dir, { recursive: true, force: true });
});
