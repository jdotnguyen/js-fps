import { test } from 'node:test';
import assert from 'node:assert/strict';
import kitTest from '../data/levels/kit_test.json' with { type: 'json' };
import type { LevelData, RoomData } from '../data/types/level.ts';
import { buildMapModel, doorGap, fillRects, gateLabel, MapState, outlineEdges, roomRaster, rotY, type Seg } from './mapModel.ts';

const level = kitTest as unknown as LevelData;
const len = (s: Seg): number => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
const perimeter = (edges: Seg[]): number => edges.reduce((n, s) => n + len(s), 0);

function room(pieces: RoomData['pieces'], extra: Partial<RoomData> = {}): RoomData {
  return { id: 'R', name: 'R', pieces, ...extra } as RoomData;
}

test('rotY matches the kit placement (rot 90 turns local -Z to -X)', () => {
  assert.deepEqual(rotY([0, -2], 0), [0, -2]);
  const r = rotY([0, -2], 90);
  assert.ok(Math.abs(r[0] + 2) < 1e-9 && Math.abs(r[1]) < 1e-9);
});

test('a 2x2-cell room outlines as an 8 x 8 m square', () => {
  const r = room([{ kit: 'floor', cells: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]] }]);
  const { squares, deck } = roomRaster(r);
  assert.equal(deck, 0);
  assert.equal(squares.size, 16 * 16);
  const edges = outlineEdges(squares);
  assert.equal(edges.length, 4, 'merged into four sides');
  assert.equal(perimeter(edges), 32);
  const fill = fillRects(squares);
  assert.equal(fill.length, 16, 'one rect per 0.5 m row');
  assert.deepEqual([fill[0]!.x0, fill[0]!.x1], [-2, 6]);
});

test('an L-shaped room gets six sides', () => {
  const r = room([{ kit: 'floor', cells: [[0, 0, 0], [1, 0, 0], [0, 0, 1]] }]);
  const edges = outlineEdges(roomRaster(r).squares);
  assert.equal(edges.length, 6);
  assert.equal(perimeter(edges), 32);
});

test('corridor pieces are 3 m wide with arms only on open sides', () => {
  const straight = roomRaster(room([{ kit: 'corridor_straight', cell: [0, 0, 0] }])).squares;
  // 3 m wide x 4 m long.
  assert.equal(straight.size, 6 * 8);
  const turned = roomRaster(room([{ kit: 'corridor_straight', cell: [0, 0, 0], rot: 90 }])).squares;
  assert.equal(turned.size, 6 * 8);
  assert.ok(turned.has('-4,0') && !turned.has('0,-4'), 'rotated 90 runs along X');
  const end = roomRaster(room([{ kit: 'corridor_end', cell: [0, 0, 0] }])).squares;
  assert.equal(end.size, 6 * 6 + 6 * 1, 'centre square plus the north arm');
});

test('outline override wins over the kit cells', () => {
  const r = room([{ kit: 'floor', cell: [0, 0, 0] }], { outline: [[0, 0], [6, 0], [6, 3], [0, 3]] });
  const { squares } = roomRaster(r);
  assert.equal(squares.size, 12 * 6);
  assert.equal(perimeter(outlineEdges(squares)), 18);
});

test('doors leave a 2 m gap in both rooms\' outlines', () => {
  const g = doorGap({ cell: [0, 0, 3], rot: 0 });
  assert.deepEqual(g.center, [0, 10]);
  assert.equal(len(g.gap), 2);
  const model = buildMapModel(level);
  const r01 = model.rooms.find((r) => r.id === 'R01')!;
  // R01 is 8 x 8 with one door (D1): 32 m of wall minus a 2 m gap.
  assert.equal(perimeter(r01.edges), 30);
  const west = doorGap({ cell: [1, 0, 0], rot: 270 });
  assert.deepEqual(west.center.map((v) => Math.round(v * 1e6) / 1e6), [6, 0]);
});

test('kit_test model: rooms, gates, vents and areas', () => {
  const m = buildMapModel(level);
  assert.deepEqual(m.rooms.map((r) => r.id), ['R01', 'R02', 'R03', 'R05', 'R04']);
  const d3 = m.doors.find((d) => d.id === 'D3')!;
  assert.equal(d3.gate, 'item');
  assert.equal(d3.requires, 'card_l2');
  const d4 = m.doors.find((d) => d.id === 'D4')!;
  assert.equal(d4.gate, 'sealed');
  assert.equal(m.doors.find((d) => d.id === 'D2')!.gate, 'locked');
  assert.equal(m.vents[0]!.requires, 'vent_driver');
  assert.ok(m.bounds.x1 > m.bounds.x0 && m.bounds.z1 > m.bounds.z0);
  assert.deepEqual(m.areas, ['prep', 'lab_b']);
  assert.equal(m.rooms.find((r) => r.id === 'R05')!.hidden, true);
  assert.equal(m.stations[0]!.room, 'R02', 'the wall map hangs in the corridor');
  const s = new MapState(m);
  assert.deepEqual(s.reveal('lab_b').sort(), ['R02', 'R03', 'R04'], 'the sealed annex stays hidden');
});

function hubLevel(): LevelData {
  const floor = (x: number) => [{ kit: 'floor', cell: [x, 0, 0] }];
  return {
    id: 'hub',
    seed: 1,
    playerStart: { room: 'A', pos: [0, 0, 0], yaw: 0 },
    rooms: [
      { id: 'A', name: 'Commons', area: 'commons', pieces: floor(0) },
      { id: 'B', name: 'Racks', area: 'hydroponics', pieces: floor(1) },
      { id: 'C', name: 'Store', area: 'hydroponics', pieces: floor(2) },
      { id: 'S', name: 'Crawlspace', area: 'hydroponics', hidden: true, pieces: floor(3) },
    ],
    doors: [],
    checkpoints: [],
    mapStations: [{ id: 'hydro_map', pos: [4, 1.2, 0], reveals: 'hydroponics' }],
  } as unknown as LevelData;
}

test('seen on entry, stations reveal an area, hidden rooms stay unknown', () => {
  const model = buildMapModel(hubLevel());
  assert.equal(model.stations[0]!.room, 'B', 'station room found from its position');
  const s = new MapState(model);
  assert.equal(s.knowledge('A'), null);
  assert.equal(s.enter('A'), true);
  assert.equal(s.enter('A'), false, 'only the first entry counts');
  assert.equal(s.enter('nope'), false);
  assert.equal(s.knowledge('A'), 'seen');
  const newly = s.reveal('hydroponics');
  assert.deepEqual(newly.sort(), ['B', 'C']);
  assert.equal(s.knowledge('B'), 'revealed');
  assert.equal(s.knowledge('S'), null, 'hidden rooms are never revealed by a station');
  assert.deepEqual(s.reveal('hydroponics'), [], 'revealing again adds nothing');
  s.enter('S');
  assert.equal(s.knowledge('S'), 'seen', 'walking in still draws a hidden room');
  s.enter('B');
  assert.equal(s.knowledge('B'), 'seen', 'seen beats revealed');
});

test('map state save round-trip', () => {
  const model = buildMapModel(hubLevel());
  const s = new MapState(model);
  s.enter('A');
  s.reveal('hydroponics');
  const saved = JSON.parse(JSON.stringify(s.save()));
  const t = new MapState(model);
  t.restore(saved);
  assert.deepEqual(t.save(), s.save());
  assert.equal(t.knowledge('C'), 'revealed');
  t.restore(null);
  assert.equal(t.knowledge('A'), null);
});

test('gate labels name the item and change once it is held', () => {
  const name = (id: string): string => (id === 'card_l2' ? 'Level 2 Card' : id);
  assert.equal(gateLabel({ gate: 'item', requires: 'card_l2' }, name, () => false), 'Needs Level 2 Card');
  assert.equal(gateLabel({ gate: 'item', requires: 'card_l2' }, name, () => true), 'Unlocked: Level 2 Card');
  assert.match(gateLabel({ gate: 'sealed', text: 'lockdown' }, name, () => false), /Lockdown/);
});

// ---- schema (data/types/level.ts): area, hidden, outline, mapStations, supply pickups
import { validate } from '../core/validate.ts';
import { levelValidator, type KitIds } from '../data/types/level.ts';

const kits: KitIds = {
  structure: new Set(level.rooms.flatMap((r) => r.pieces.map((p) => p.kit))),
  prop: new Set(level.rooms.flatMap((r) => (r.props ?? []).map((p) => p.kit))),
};
const check = (raw: unknown): LevelData => validate(levelValidator(kits, { items: new Set(['card_l2', 'vent_driver']) }), raw, 'kit_test');

test('kit_test validates with areas, a hidden room, a map station and supplies', () => {
  const lv = check(kitTest);
  assert.equal(lv.mapStations?.length, 1);
  assert.deepEqual(lv.pickups?.filter((p) => p.kind).map((p) => p.kind), ['ammo_pistol', 'ammo_shotgun', 'medkit']);
});

test('schema errors: station area, pickup item/kind, short outline', () => {
  const bad = (edit: (c: Record<string, any>) => void): void => {
    const c = structuredClone(kitTest) as Record<string, any>;
    edit(c);
    assert.throws(() => check(c));
  };
  bad((c) => (c['mapStations'][0].reveals = 'nowhere'));
  bad((c) => (c['pickups'][1].item = 'card_l2'));
  bad((c) => delete c['pickups'][1].kind);
  bad((c) => (c['pickups'][0].amount = 3));
  bad((c) => (c['rooms'][0].outline = [[0, 0], [1, 1]]));
  bad((c) => (c['pickups'][1].kind = 'grenade'));
});
