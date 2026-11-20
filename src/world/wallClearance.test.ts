import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelFileIds, loadLevel } from './headlessSlice.ts';

// level-kit spec, "Wall-mounted props stay clear of wall structure": no screen, poster, board,
// clock or CCTV wall in any level may overlap a wall tile's pilasters, trim rails or cable trays.

/** Overlap must exceed this on every axis to count: props mount flush against trim (touching is fine). */
const EPS = 0.005;

for (const id of levelFileIds()) {
  test(`${id}: wall-mounted props stay clear of wall structure`, () => {
    const { level } = loadLevel(id);
    const { keepouts, wallProps } = level.debug;
    const clashes: string[] = [];
    for (const p of wallProps) {
      for (const b of p.boxes) {
        for (const k of keepouts) {
          const ox = Math.min(b.max.x, k.box.max.x) - Math.max(b.min.x, k.box.min.x);
          const oy = Math.min(b.max.y, k.box.max.y) - Math.max(b.min.y, k.box.min.y);
          const oz = Math.min(b.max.z, k.box.max.z) - Math.max(b.min.z, k.box.min.z);
          if (ox > EPS && oy > EPS && oz > EPS) clashes.push(`${p.room}: ${p.source} overlaps ${k.source} (${k.room})`);
        }
      }
    }
    assert.deepEqual([...new Set(clashes)], []);
  });
}
