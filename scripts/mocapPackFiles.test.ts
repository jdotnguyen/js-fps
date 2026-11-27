import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error plain ES module without types
import { PACK_TABLE_PATH, packPath, packTable } from './lib/mocapPackFiles.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

test('mocap pack files: a pack lives in its character\'s folder', () => {
  assert.equal(packPath('priya'), 'src/data/cast/priya/mocap.json');
});

test('mocap pack files: the committed table is what the bake writes for the packs on disk', () => {
  const cast = fs.readdirSync(path.join(ROOT, 'src/data/cast')).filter((n) => fs.existsSync(path.join(ROOT, packPath(n))));
  assert.ok(cast.length >= 7, `${cast.length} packs`);
  const table = fs.readFileSync(path.join(ROOT, PACK_TABLE_PATH), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(table, packTable(cast));
});
