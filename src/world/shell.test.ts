import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShell, doorEdges, wallChoice, type ShellPiece } from './shell.ts';
import { layoutValidator, type RoomLayout } from '../data/types/layout.ts';

// Room shells (spec content-layout "Room shells are built from the layout", split-level-data D3).

const NO_DOORS = new Set<string>();
/** One entry per tile: "kit x,z rot params". */
const tiles = (pieces: ShellPiece[]): string[] =>
  pieces.flatMap((p) => (p.cells ?? [p.cell!]).map((c) => `${p.kit} ${c[0]},${c[2]} ${p.rot ?? 0}${p.params ? ` ${JSON.stringify(p.params)}` : ''}`));
const walls = (pieces: ShellPiece[]): string[] => tiles(pieces).filter((t) => t.startsWith('wall_'));
const ROW: RoomLayout = { cells: [[0, 0], [1, 0]] };

test('ceilings come first, one piece per cell in cell order, then floors and walls merged by kit, rotation and params', () => {
  const pieces = buildShell({ cells: [[1, 0], [0, 0]], walls: ['wall_plain'] }, NO_DOORS);
  assert.deepEqual(pieces.slice(0, 2), [
    { kit: 'ceiling', cell: [1, 0, 0] },
    { kit: 'ceiling', cell: [0, 0, 0] },
  ]);
  assert.deepEqual(pieces[2], { kit: 'floor', cells: [[1, 0, 0], [0, 0, 0]] });
  // Cell by cell, sides n, e, s, w; a rotation's group sits where it first appears.
  assert.deepEqual(pieces.slice(3), [
    { kit: 'wall_plain', cells: [[1, 0, 0], [0, 0, 0]] },
    { kit: 'wall_plain', cells: [[1, 0, 0]], rot: 270 },
    { kit: 'wall_plain', cells: [[1, 0, 0], [0, 0, 0]], rot: 180 },
    { kit: 'wall_plain', cells: [[0, 0, 0]], rot: 90 },
  ]);
});

test('no wall between two cells of the room; every outer side gets one', () => {
  const w = walls(buildShell({ cells: [[0, 0], [1, 0], [0, 1], [1, 1]] }, NO_DOORS));
  assert.equal(w.length, 8);
  for (const t of w) assert.doesNotMatch(t, /^wall_\w+ 0,0 270|^wall_\w+ 1,0 90/);
});

test('the wall finish is a fixed hash of cell and side into `walls`', () => {
  const list = ['wall_panel', 'wall_plain', 'wall_pipes'];
  const w = walls(buildShell({ cells: [[3, -2]], walls: list }, NO_DOORS));
  const rot = { n: 0, e: 270, s: 180, w: 90 } as const;
  assert.deepEqual(
    w.sort(),
    (['n', 'e', 's', 'w'] as const).map((s) => `${list[Math.abs(3 * 7 + -2 * 3 + s.charCodeAt(0)) % 3]} 3,-2 ${rot[s]}`).sort(),
  );
  assert.equal(wallChoice(list, 3, -2, 'n'), list[Math.abs(21 - 6 + 110) % 3]);
  // The default pair.
  assert.ok(walls(buildShell(ROW, NO_DOORS)).every((t) => /^wall_(panel|plain) /.test(t)));
});

test('a door removes the wall on both rooms of its edge', () => {
  // A door on the east side of cell 1,0 (rot 270) into the room at 2,0.
  const doors = doorEdges([{ cell: [1, 0, 0], rot: 270 }]);
  assert.deepEqual([...doors].sort(), ['1,0,e', '2,0,w']);
  assert.ok(!walls(buildShell(ROW, doors)).some((t) => t.includes(' 1,0 270')));
  assert.ok(!walls(buildShell({ cells: [[2, 0]] }, doors)).some((t) => t.includes(' 2,0 90')));
  assert.equal(walls(buildShell({ cells: [[2, 0]] }, doors)).length, 3);
  // Rotations name the side: n=0, w=90, s=180, e=270.
  assert.deepEqual([...doorEdges([{ cell: [0, 0, 0], rot: 0 }, { cell: [0, 0, 0], rot: 90 }, { cell: [0, 0, 0], rot: 180 }])].sort(), ['-1,0,e', '0,-1,s', '0,0,n', '0,0,s', '0,0,w', '0,1,n']);
});

test('an open side builds no wall (an open seam, or the far side of glass)', () => {
  const w = walls(buildShell({ ...ROW, open: ['1,0,s', '0,0,n'] }, NO_DOORS));
  assert.equal(w.length, 4);
  assert.ok(!w.some((t) => t.includes(' 1,0 180') || t.includes(' 0,0 0')));
});

test('per-side wall kits and params override the hash and the room material', () => {
  const pieces = buildShell(
    { ...ROW, walls: ['wall_plain'], wallMaterial: 'steel', wallOverride: { '0,0,n': 'wall_glass_partition', '1,0,n': 'wall_window' }, wallParams: { '1,0,n': { flicker: true } } },
    NO_DOORS,
  );
  const w = walls(pieces);
  assert.ok(w.includes('wall_glass_partition 0,0 0 {"material":"steel"}'));
  assert.ok(w.includes('wall_window 1,0 0 {"flicker":true}'), 'wallParams replace the material default');
  assert.ok(w.includes('wall_plain 1,0 270 {"material":"steel"}'));
});

test('floor kit, per-cell overrides and params, and the floor material', () => {
  const pieces = buildShell(
    { cells: [[0, 0], [1, 0], [2, 0]], floor: 'floor_grate', floorMaterial: 'diamondRusty', floorOverride: { '1,0': 'floor_tiles' }, floorParams: { '2,0': { bareEdge: 's', bareWidth: 1.25 } } },
    NO_DOORS,
  );
  const f = tiles(pieces).filter((t) => t.startsWith('floor'));
  assert.deepEqual(f, ['floor_grate 0,0 0 {"material":"diamondRusty"}', 'floor_tiles 1,0 0 {"material":"diamondRusty"}', 'floor_grate 2,0 0 {"bareEdge":"s","bareWidth":1.25}']);
});

test('ceiling kit and material; ceiling_pipes alternates, starting with a plain ceiling', () => {
  const pieces = buildShell({ cells: [[0, 0], [1, 0], [2, 0]], ceiling: 'ceiling_pipes', ceilingMaterial: 'paintDark' }, NO_DOORS);
  assert.deepEqual(pieces.slice(0, 3), [
    { kit: 'ceiling', cell: [0, 0, 0], params: { material: 'paintDark' } },
    { kit: 'ceiling_pipes', cell: [1, 0, 0], params: { material: 'paintDark' } },
    { kit: 'ceiling', cell: [2, 0, 0], params: { material: 'paintDark' } },
  ]);
});

test('with `fixtures`, only those cells carry a light housing', () => {
  const pieces = buildShell({ cells: [[0, 0], [1, 0], [2, 0]], fixtures: [[2, 0], [0, 0]] }, NO_DOORS);
  assert.deepEqual(pieces.slice(0, 3), [
    { kit: 'ceiling', cell: [0, 0, 0] },
    { kit: 'ceiling', cell: [1, 0, 0], params: { fixture: false } },
    { kit: 'ceiling', cell: [2, 0, 0] },
  ]);
  // Without the list, every ceiling has one.
  assert.ok(buildShell(ROW, NO_DOORS).slice(0, 2).every((p) => p.params === undefined));
});

test('extra pieces come last, exactly as given, and are copies', () => {
  const stairs = { kit: 'stairs', cell: [0, 0, 0] as [number, number, number], rot: 90 as const, params: { rise: 0.6, steps: 3 } };
  const layout: RoomLayout = { ...ROW, extraPieces: [stairs, { kit: 'ceiling', cell: [0, 0, 1] }] };
  const pieces = buildShell(layout, NO_DOORS);
  assert.deepEqual(pieces.slice(-2), [stairs, { kit: 'ceiling', cell: [0, 0, 1] }]);
  pieces.at(-2)!.params!['rise'] = 9;
  assert.equal(stairs.params.rise, 0.6);
});

test('adding a cell moves the outer wall to the new edge', () => {
  const before = walls(buildShell({ cells: [[0, 0]], walls: ['wall_plain'] }, NO_DOORS));
  const after = walls(buildShell({ cells: [[0, 0], [1, 0]], walls: ['wall_plain'] }, NO_DOORS));
  assert.ok(before.includes('wall_plain 0,0 270'));
  assert.ok(!after.includes('wall_plain 0,0 270'));
  assert.ok(after.includes('wall_plain 1,0 270'));
});

test('the layout validator names bad keys, cells outside the room and repeated cells', () => {
  const check = (v: unknown) => () => layoutValidator(v, 'rooms/R01.json > layout');
  assert.throws(check({ cells: [[0, 0], [0, 0]] }), /layout > cells\[1\]: cell 0,0 is listed twice/);
  assert.throws(check({ cells: [[0, 0]], wallOverride: { '1,0,n': 'wall_window' } }), /wallOverride > 1,0,n: cell 1,0 is not one of the room's cells/);
  assert.throws(check({ cells: [[0, 0]], wallOverride: { '0,0': 'wall_window' } }), /wallOverride > 0,0: expected a cell side key/);
  assert.throws(check({ cells: [[0, 0]], open: ['0,0,up'] }), /open\[0\]: expected a cell side like/);
  assert.throws(check({ cells: [[0, 0]], fixtures: [[5, 5]] }), /fixtures\[0\]: cell 5,5 is not one/);
  assert.throws(check({ cells: [[0, 0]], walls: [] }), /walls: list at least one wall kit/);
  assert.throws(check({ cells: [[0, 0]], extraPieces: [{ kit: 'stairs' }] }), /extraPieces\[0\]: give exactly one of "cell" or "cells"/);
  assert.throws(check({ cells: [[0, 0]], pieces: [] }), /layout > pieces: unknown field/);
  assert.deepEqual(layoutValidator({ cells: [[0, 0]], floorOverride: { '0,0': 'floor_tiles' } }, 'x'), { cells: [[0, 0]], floorOverride: { '0,0': 'floor_tiles' } });
});
