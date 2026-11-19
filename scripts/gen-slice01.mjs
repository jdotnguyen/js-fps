#!/usr/bin/env node
/**
 * Generates src/data/levels/slice01.json (ADR-0014 map as amended, ADR-0017 intro, ADR-0023 hubs).
 *
 *   node scripts/gen-slice01.mjs            write the level
 *   node scripts/gen-slice01.mjs --check    print the room/cell table only
 *
 * Layout is authored here as rooms of grid cells (4 m, deck 0). The script places floor,
 * ceiling and wall tiles on every outside edge (walls skip edges that hold a door or that a
 * neighbour fills with glass), turns `door(...)` calls into doors, and converts wall-mounted
 * prop placements (`wallProp`) into positions + rotations. Edit the tables below and re-run.
 *
 * Grid: cell (x, z) is centred on world (4x, 0, 4z); +x east, +z south. Sides n/e/s/w.
 * Wall tiles: rot n=0, w=90, s=180, e=270. Wall props face into the room:
 * n wall -> rot 180, s -> 0, e -> 90, w -> 270 (props.ts / slice.ts convention).
 * Anchor and NPC yaw: degrees, 0 faces -Z (north), 90 faces -X (west).
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../src/data/levels/slice01.json');
const C = 4;
const WALL_FACE = 2 - 0.25; // cell centre to the inner face of a wall tile
const SIDES = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
const OPP = { n: 's', s: 'n', e: 'w', w: 'e' };
const WALL_ROT = { n: 0, w: 90, s: 180, e: 270 };
const PROP_ROT = { n: 180, s: 0, e: 90, w: 270 };
const r2 = (v) => Math.round(v * 100) / 100;
const deg = (rad) => r2(((rad * 180) / Math.PI + 360) % 360);
/** Yaw (degrees) that faces from a to b; 0 faces -Z, 90 faces -X. */
const face = (a, b) => deg(Math.atan2(-(b[0] - a[0]), -(b[2] - a[2])));
const rect = (x0, x1, z0, z1) => {
  const out = [];
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) out.push([x, z]);
  return out;
};
const cx = (x) => x * C;

// ------------------------------------------------------------------ authoring state

const rooms = [];
const byId = new Map();
const doors = [];
const doorEdges = new Map(); // "x,z,side" -> door id (both sides of the edge)
const glassEdges = new Map(); // "x,z,side" -> owner room id (the room behind skips its wall)
const vents = [];
const pickups = [];
const checkpoints = [];
const mapStations = [];
const edgeKey = (x, z, s) => `${x},${z},${s}`;
const neighbour = (x, z, s) => [x + SIDES[s][0], z + SIDES[s][1]];

function room(id, name, cells, o = {}) {
  const r = {
    id,
    name,
    cells,
    height: o.height ?? 3.2,
    area: o.area,
    hidden: o.hidden,
    atmosphere: o.atmosphere,
    floor: o.floor ?? 'floor',
    floorOverride: o.floorOverride ?? {},
    ceiling: o.ceiling ?? 'ceiling',
    walls: o.walls ?? ['wall_panel', 'wall_plain'],
    wallOverride: {},
    props: [],
    lights: o.lights ?? [],
    triggers: [],
    spawns: [],
    anchors: [],
    npcs: [],
    visibleFrom: o.visibleFrom,
  };
  rooms.push(r);
  byId.set(id, r);
  return r;
}

const hasCell = (id, x, z) => byId.get(id).cells.some(([px, pz]) => px === x && pz === z);

/** A door on `side` of cell (x, z) of room `a`, into room `b`. */
const doorChecks = [];
function door(id, a, b, x, z, side, o = {}) {
  const [nx, nz] = neighbour(x, z, side);
  // Rooms may be declared later; checked in build().
  doorChecks.push(() => {
    if (!hasCell(a, x, z)) throw new Error(`${id}: cell ${x},${z} not in ${a}`);
    if (!hasCell(b, nx, nz)) throw new Error(`${id}: cell ${nx},${nz} not in ${b}`);
  });
  doorEdges.set(edgeKey(x, z, side), id);
  doorEdges.set(edgeKey(nx, nz, OPP[side]), id);
  const d = { id, kit: o.kit ?? 'pressure_slide', between: [a, b], cell: [x, 0, z], rot: WALL_ROT[side], state: o.state ?? 'closed' };
  for (const k of ['unlockBy', 'task', 'unlockOn', 'access']) if (o[k] !== undefined) d[k] = o[k];
  doors.push(d);
  return { center: edgeCenter(x, z, side, 1.2) };
}

/** Glass partition on `side` of a cell, owned by room `owner`; the room behind gets no wall there. */
function glass(owner, x, z, side) {
  byId.get(owner).wallOverride[edgeKey(x, z, side)] = 'wall_glass_partition';
  const [nx, nz] = neighbour(x, z, side);
  glassEdges.set(edgeKey(nx, nz, OPP[side]), owner);
}

/** An open seam between two rooms (no wall, no door); both rooms render from each other. */
const openEdges = new Set();
function opening(a, b, x, z, side) {
  const [nx, nz] = neighbour(x, z, side);
  openEdges.add(edgeKey(x, z, side));
  openEdges.add(edgeKey(nx, nz, OPP[side]));
  for (const [r, o] of [[a, b], [b, a]]) {
    const room = byId.get(r);
    room.visibleFrom = [...new Set([...(room.visibleFrom ?? []), o])];
  }
}

const wallKit = (r, x, z, s, kit) => {
  r.wallOverride[edgeKey(x, z, s)] = kit;
};

function edgeCenter(x, z, s, y = 0) {
  return [r2(cx(x) + SIDES[s][0] * 2), y, r2(cx(z) + SIDES[s][1] * 2)];
}

/** Position + rot for a wall-mounted prop on `side` of cell (x, z); `along` runs left-to-right seen from inside. */
function onWall(x, z, s, along = 0, inset = 0.06) {
  const d = WALL_FACE - inset;
  const [dx, dz] = SIDES[s];
  const ax = s === 'n' ? along : s === 's' ? -along : 0;
  const az = s === 'e' ? along : s === 'w' ? -along : 0;
  return { pos: [r2(cx(x) + dx * d + ax), 0, r2(cx(z) + dz * d + az)], rot: PROP_ROT[s] };
}

function prop(r, kit, pos, rot = 0, params) {
  const p = { kit, pos: pos.map(r2) };
  if (rot) p.rot = r2(rot);
  if (params) p.params = params;
  r.props.push(p);
}
function wallProp(r, kit, x, z, s, along = 0, params, inset) {
  const w = onWall(x, z, s, along, inset);
  prop(r, kit, w.pos, w.rot, params);
  return w;
}
function anchor(r, id, pos, yaw) {
  const a = { id, pos: pos.map(r2) };
  if (yaw !== undefined) a.yaw = r2(yaw);
  r.anchors.push(a);
  return pos;
}
function npc(r, id, look, at, pose, extra = {}) {
  const n = { id, look, at, ...extra };
  if (pose) n.pose = pose;
  r.npcs.push(n);
}
function trigger(r, id, box, emit, o = {}) {
  const t = { id, box: box.map((v) => v.map(r2)), on: o.on ?? 'enter', emit };
  if (o.once !== undefined) t.once = o.once;
  if (o.prompt) t.prompt = o.prompt;
  r.triggers.push(t);
}
/** Box over cells (x0..x1, z0..z1) from the floor to `h`. */
const cellBox = (x0, x1, z0, z1, h = 2.6) => [
  [cx(x0) - 2 + 0.3, 0, cx(z0) - 2 + 0.3],
  [cx(x1) + 2 - 0.3, h, cx(z1) + 2 - 0.3],
];
const around = (p, s = 0.6, h = 2) => [
  [p[0] - s, 0, p[2] - s],
  [p[0] + s, h, p[2] + s],
];
/** Optional spawn fields the enemy schema accepts (filled in by detectSpawnFields). */
let SPAWN_FIELDS = new Set();
/** Spawn with a combat-beat group (ADR-0007/0021 encounter data). */
function spawn(r, id, pos, kind, group, extra = {}) {
  // Nothing spawns at level start: every point waits for its group (spawnGroup) or `on` event.
  r.spawns.push({ id, pos: pos.map(r2), kind, group, active: false, ...extra });
}
function station(r, id, area, x, z, s, along = 0) {
  const w = wallProp(r, 'map_station', x, z, s, along, { area: area.toUpperCase() });
  mapStations.push({ id, pos: w.pos, reveals: area, rot: (w.rot + 180) % 360, room: r.id });
}
/** Light on the ceiling slot of the room's `slot`-th cell (ceilings are emitted first, in cell order). */
const L = (slot, pattern = 'steady', color, intensity, range) => {
  const l = { slot, pattern };
  if (color) l.color = color;
  if (intensity !== undefined) l.intensity = intensity;
  if (range !== undefined) l.range = range;
  return l;
};

// ================================================================== the map

const QUIET_FOG = { fog: '#070b0d', fogDensity: 0.028 };

// ---------------------------------------------------------------- R01 docking ring (dock)
const R01 = room('R01', 'Docking Ring', rect(0, 3, 0, 1), {
  area: 'dock',
  atmosphere: { ...QUIET_FOG, reverb: 'metal_hall', ambience: 'hull_hum' },
  ceiling: 'ceiling_pipes',
  lights: [L(1, 'steady', '#dcefff'), L(3, 'steady', '#dcefff'), L(6, 'steady')],
});
// The walk to the commons: its own room (culling, draw-call budget), open to the dock hall.
const R01w = room('R01w', 'Docking Ring Walk', [[4, 0], [5, 0], [6, 0], [6, 1], [6, 2]], {
  area: 'dock',
  atmosphere: { ...QUIET_FOG, reverb: 'metal_corridor', ambience: 'hull_hum' },
  ceiling: 'ceiling_pipes',
  lights: [L(0, 'steady', '#cfe6ff'), L(2, 'steady'), L(4, 'steady')],
});
opening('R01', 'R01w', 3, 0, 'e');
for (const x of [1, 2, 3]) wallKit(R01, x, 0, 'n', 'wall_window'); // the big dock window
for (const x of [5, 6]) wallKit(R01w, x, 0, 'n', 'wall_window'); // abyss window on the walk
wallKit(R01w, 6, 1, 'e', 'wall_window');
const R01a = room('R01a', 'Dock Airlock', [[-1, 0]], { area: 'dock', atmosphere: { ...QUIET_FOG, reverb: 'small_office' }, walls: ['wall_plain'], lights: [L(0, 'steady', '#ffe9c8', 7)] });
wallKit(R01a, -1, 0, 'w', 'wall_vent');
const dockDoor = door('D_dock', 'R01', 'R01a', 0, 0, 'w');
prop(R01, 'supply_sub', [8, 0.4, -7.2], 0, { state: 'away', dockTime: 10 });
prop(R01, 'desk', [3.4, 0, 5.2], 0, { width: 1.6 });
prop(R01, 'chair', [3.4, 0, 6.0]);
prop(R01, 'console', [-0.6, 0, 5.3], 0, { screen: 'status' });
prop(R01, 'locker', [-1.45, 0, 3.0], 270, { count: 2, label: 'DOCK SEC' });
wallProp(R01, 'tag_poster', 0, 1, 's', -0.8, { slogan: 'WELCOME TO THALASSA' });
wallProp(R01, 'notice_board', 2, 1, 's', 0, { text: 'SHIFT ROSTER', detail: '06:40 CHANGEOVER' });
prop(R01, 'crate_stack', [12.8, 0, 5.4], 15);
prop(R01, 'potted_plant', [13.2, 0, 3.2], 0, { kind: 'palm', pot: 'dark' });
prop(R01w, 'pipe_run', [18, 0, 1.4], 0, { length: 7, height: 0.35, paint: 'teal' });
prop(R01, 'cable_bundle', [8, 0, 5.6], 0, { length: 12, height: 2.9 });
prop(R01, 'crate', [-1.2, 0, 4.4], 0, { size: 0.7 });
prop(R01a, 'locker', [-4, 0, -1.4], 180, { count: 2, label: 'EVA' });
anchor(R01, 'post_front', [6, 0, 2.6], 0);
anchor(R01, 'dock_window', [8, 1.5, -2.2]);
anchor(R01, 'dock_door', dockDoor.center);
anchor(R01, 'walkby_stop', [4.4, 0, 1.0], face([4.4, 0, 1], [6, 0, 2.6]));
anchor(R01, 'post_okafor', [5.3, 0, 0.9], face([5.3, 0, 0.9], [6, 0, 2.6]));
anchor(R01, 'post_giles', [6.9, 0, 1.0], face([6.9, 0, 1], [6, 0, 2.6]));
anchor(R01, 'walk_mid', [14, 0, 0.6], 270);
anchor(R01w, 'walk_window', [20, 0, -0.4], 0);
// Separate spots at the window so the two NPCs and Jay stand side by side (~0.9 m apart); Jay is on the west so his walk in does not cross them.
anchor(R01w, 'window_jay', [18.9, 0, -0.9], 0);
anchor(R01w, 'window_giles', [19.8, 0, -0.9], 0);
anchor(R01w, 'window_okafor', [20.7, 0, -0.9], 0);
anchor(R01w, 'abyss_window_walk', [21, 1.7, -2.4]);
anchor(R01, 'sub_dock', [8, 0.4, -7.2]);
anchor(R01a, 'giles_start', [-4.6, 0, 0.6], 270);
anchor(R01a, 'okafor_start', [-4.6, 0, -0.6], 270);
anchor(R01a, 'ruiz_start', [-3.4, 0, 0.9], 270);
anchor(R01a, 'sung_start', [-3.4, 0, -0.9], 270);
npc(R01a, 'giles', 'giles', 'giles_start');
npc(R01a, 'okafor', 'okafor', 'okafor_start');
npc(R01a, 'ruiz', 'ruiz', 'ruiz_start');
npc(R01a, 'sung', 'sung', 'sung_start');
trigger(R01w, 'trig_walk_window', cellBox(5, 5, 0, 0), 'trigger:walk_window', { once: false });

// ---------------------------------------------------------------- R02 commons + kitchen (commons)
const R02 = room('R02', 'Commons', rect(4, 8, 3, 6), {
  area: 'commons',
  height: 4,
  atmosphere: { fog: '#0a0c0d', fogDensity: 0.022, reverb: 'metal_hall', ambience: 'commons_murmur' },
  floorOverride: { '7,3': 'floor_tiles', '8,3': 'floor_tiles', '6,3': 'floor_tiles' },
  lights: [L(2, 'steady', '#ffe6c8', 12), L(4, 'steady', '#ffe6c8', 11), L(6, 'steady', '#fff1dc', 10), L(11, 'steady', '#ffe6c8', 11), L(13, 'steady', '#ffe6c8', 11), L(17, 'steady', '#ffe0c0', 10)],
});
for (const x of [6, 7, 8]) wallKit(R02, x, 3, 'n', 'wall_tiles');
wallKit(R02, 4, 5, 'w', 'wall_window');
door('D_R01_R02', 'R02', 'R01w', 6, 3, 'n');
const counterZ = cx(3) - WALL_FACE + 0.34;
prop(R02, 'kitchen_counter', [29.2, 0, counterZ], 180, { width: 6.4, sink: true });
prop(R02, 'coffee_machine', [26.8, 0.92, counterZ - 0.02], 180);
prop(R02, 'tray', [29.0, 0.92, counterZ + 0.05], 180, { mugs: 3 });
prop(R02, 'radio', [31.6, 0.92, counterZ + 0.1], 200);
prop(R02, 'mug', [27.6, 0.92, counterZ - 0.12], 0, { color: 'teal' });
prop(R02, 'vending_machine', [33.2, 0, 23.4], 90);
prop(R02, 'dining_table', [18.5, 0, 17], 0, { width: 2.2, seats: 6, mugs: 2 });
prop(R02, 'dining_table', [25, 0, 17.5], 0, { width: 2.2, seats: 6, mugs: 1 });
prop(R02, 'dining_table', [30.5, 0, 18.5], 0, { width: 1.8, seats: 4, mugs: 0 });
prop(R02, 'sofa', [16.4, 0, 23.6], 0, { width: 2.4, tone: 'warm' });
prop(R02, 'sofa', [19.6, 0, 24.6], 300, { width: 1.8 });
wallProp(R02, 'notice_board', 5, 3, 'n', 0, { text: 'QUARANTINE NOTICE', detail: 'LAB B - ROUTINE' });
wallProp(R02, 'tag_poster', 4, 3, 'n', 0.6, { slogan: 'DEEPER. FURTHER. TOGETHER.' });
wallProp(R02, 'tag_poster', 8, 6, 's', 0, { slogan: 'SAFETY IS A SHIFT, NOT A DAY.' });
wallProp(R02, 'wall_screen', 7, 6, 's', 0, { id: 'commons_tv', width: 2.2, state: 'off' });
for (const [x, z, kind] of [[14.8, 10.8, 'palm'], [33.2, 25.2, 'fern'], [14.8, 25.2, 'tall'], [22, 25.3, 'shrub'], [33.2, 17.6, 'fern']]) prop(R02, 'potted_plant', [x, 0, z], 0, { kind });
prop(R02, 'hanging_plant', [18, 0, 17], 0, { drop: 0.9 });
prop(R02, 'hanging_plant', [25, 0, 17.5], 0, { drop: 0.7 });
station(R02, 'commons_map', 'commons', 4, 6, 'w');
anchor(R02, 'kitchen_door', [24, 1.2, 10]);
anchor(R02, 'counter', [29.2, 0.95, counterZ]);
anchor(R02, 'coffee_machine', [26.8, 1.2, counterZ]);
anchor(R02, 'radio', [31.6, 1.05, counterZ + 0.1]);
anchor(R02, 'cook_stand', [30.6, 0, 11.7], 0);
anchor(R02, 'counter_okafor', [27.4, 0, 12.3], 10);
anchor(R02, 'counter_giles', [28.6, 0, 12.5], 350);
anchor(R02, 'kitchen_stand', [25.6, 0, 13.4], face([25.6, 0, 13.4], [28, 0, 11.5]));
anchor(R02, 'priya_enter', [24, 0, 24.6], 0);
anchor(R02, 'priya_stand', [27.4, 0, 13.6], face([27.4, 0, 13.6], [25.6, 0, 13.4]));
anchor(R02, 'priya_offer', [26.5, 0, 13.0], face([26.5, 0, 13], [25.6, 0, 13.4]));
anchor(R02, 'priya_exit', [24, 0, 25.4], 180);
anchor(R02, 'priya_chair', [26.1, 0, 18.4], 0);
anchor(R02, 'gallery_door', [14, 1.2, 16]);
anchor(R02, 'cp_intro', [25.6, 0, 13.4], face([25.6, 0, 13.4], [28, 0, 11.5]));
anchor(R02, 'commons_tv', [28, 1.75, 25.6]);
anchor(R02, 'dawdle_call', [16.2, 0, 15.2], 270);
// Ruiz and Sung's background spots after the dock walk-by: floor cells west of the door (24,10), >= 2.5 m from it, clear of Jay's door-to-kitchen_stand line and of the cast.
anchor(R02, 'crew_ruiz_commons', [19.6, 0, 12.0], face([19.6, 0, 12], [21.6, 0, 12.6]));
anchor(R02, 'crew_sung_commons', [21.6, 0, 12.6], face([21.6, 0, 12.6], [19.6, 0, 12]));
npc(R02, 'cook', 'cook', 'cook_stand', 'idle');
npc(R02, 'crew_1', 'crew', [19.4, 0, 15.6], 'idle_mug');
npc(R02, 'crew_2', 'lab', [17.4, 0, 18.6], 'idle_weight');
npc(R02, 'crew_3', 'maintenance', [32.2, 0, 19.6], 'idle_crossed');
trigger(R02, 'trig_commons_enter', cellBox(6, 6, 3, 3), 'trigger:commons_enter', { once: false });
trigger(R02, 'trig_commons_to_gallery', cellBox(4, 4, 4, 4), 'trigger:commons_to_gallery', { once: false });
trigger(R02, 'trig_commons_radio', around([31.6, 0, counterZ - 0.4], 0.6, 1.6), 'commons:radio', { on: 'use', prompt: 'Listen', once: false });
trigger(R02, 'trig_commons_coffee', around([26.8, 0, counterZ - 0.4], 0.5, 1.6), 'commons:coffee', { on: 'use', prompt: 'Pour coffee', once: false });
trigger(R02, 'trig_commons_notice', around([20, 0, 10.6], 0.8, 2.2), 'commons:notice', { on: 'use', prompt: 'Read notice', once: false });

// ---------------------------------------------------------------- R03 observation gallery, R04 Lab B
const R03 = room('R03', 'Observation Gallery', rect(1, 3, 4, 5), {
  area: 'gallery',
  height: 3.6,
  atmosphere: { fog: '#06090b', fogDensity: 0.03, reverb: 'metal_hall', ambience: 'hull_hum' },
  floor: 'floor_carpet',
  lights: [L(0, 'steady', '#d6ecff', 9), L(2, 'steady', '#d6ecff', 9), L(4, 'steady', '#d6ecff', 8)],
});
const R04 = room('R04', 'Lab B', rect(1, 3, 6, 7), {
  area: 'labs',
  height: 3.6,
  atmosphere: { fog: '#05080a', fogDensity: 0.035, reverb: 'small_office', ambience: 'lab_hum' },
  floor: 'floor_tiles',
  walls: ['wall_tiles', 'wall_panel'],
  visibleFrom: ['R03'],
  lights: [L(0, 'steady', '#e8f4ff', 9), L(2, 'steady', '#e8f4ff', 9), L(4, 'flicker', '#e8f4ff', 7)],
});
for (const x of [1, 2, 3]) glass('R03', x, 5, 's');
door('D_R02_R03', 'R02', 'R03', 4, 4, 'w');
door('D_R03_R05', 'R03', 'R05', 1, 4, 'w', { state: 'locked', unlockBy: 'script', unlockOn: 'drop:done' });
door('D_R04_R05', 'R04', 'R05', 1, 6, 'w', { kit: 'bulkhead', state: 'closed', access: { sealed: true, text: 'lockdown' } });
wallProp(R03, 'wall_screen', 2, 4, 'n', 0, { id: 'brief_screen', channel: 'briefing', width: 2.8, y: 1.85 });
// Crack overlays on the gallery side of the three panes (`glass` action, id "labb").
for (const [i, x] of [1, 2, 3].entries()) wallProp(R03, 'glass_cracks', x, 5, 's', 0, { id: 'labb', seed: i + 1 }, 0.02);
for (const x of [1, 2, 3]) prop(R04, 'blinds', [cx(x), 0, cx(5) + 2 + 0.32], 0, { id: 'labb', width: 3.8, height: 2.25, top: 2.6, state: 'down' });
prop(R03, 'sofa', [12.3, 0, 15.4], 180, { width: 1.8 });
prop(R03, 'potted_plant', [2.6, 0, 14.8], 0, { kind: 'fern' });
prop(R03, 'potted_plant', [13.4, 0, 21.2], 0, { kind: 'tall', pot: 'white' });
prop(R03, 'console', [3.6, 0, 20.6], 0, { screen: 'status' });
prop(R04, 'lab_bench', [5.5, 0, 26.8], 90, { width: 3 });
prop(R04, 'lab_bench', [12.2, 0, 29.4], 0, { width: 3 });
prop(R04, 'specimen_tank', [9.5, 0, 28.6]);
prop(R04, 'gurney', [8, 0, 25.2], 90);
prop(R04, 'console', [12.8, 0, 25.6], 270, { screen: 'log' });
prop(R04, 'chair', [7.4, 0, 27.2]);
anchor(R03, 'brief_screen', [8, 1.85, 14.4]);
anchor(R03, 'labb_blinds', [8, 1.5, 22.3]);
anchor(R03, 'labb_glass', [8, 1.5, 21.8]);
anchor(R03, 'brief_jay', [8, 0, 17.4], 180);
anchor(R03, 'brief_giles', [6.4, 0, 17.8], 160);
anchor(R03, 'brief_okafor', [9.7, 0, 17.8], 200);
anchor(R03, 'brief_heins', [8, 0, 20.4], 0);
anchor(R03, 'gallery_enter', [13, 0, 16], 90);
anchor(R03, 'drop_jay', [8, 0, 19.6], 180);
anchor(R03, 'cp_briefing', [8, 0, 17.4], 180);
anchor(R04, 'labb_victim', [8, 0, 26.5], 0);
npc(R03, 'heins', 'heins', 'brief_heins', 'idle_crossed');
npc(R04, 'researcher_b', 'lab', 'labb_victim', 'typing', { transformable: true }); // Dr. Voss: transforms in the drop (ADR-0023)
trigger(R03, 'trig_gallery_enter', cellBox(1, 3, 4, 5), 'trigger:gallery_enter', { once: false });
trigger(R03, 'trig_gallery_brief', around([8, 0, 17.4], 1.0, 2.2), 'trigger:gallery_brief_spot', { once: false });

// ---------------------------------------------------------------- R05 lab junction, R06 pressure door hall (labs)
const ACTION_FOG = { fog: '#05080a', fogDensity: 0.06 };
const R05 = room('R05', 'Lab Junction', rect(-1, 0, 4, 6), {
  area: 'labs',
  atmosphere: { ...ACTION_FOG, reverb: 'metal_corridor', ambience: 'hull_groan' },
  ceiling: 'ceiling_pipes',
  lights: [L(0, 'flicker'), L(3, 'steady'), L(5, 'dying')],
});
wallKit(R05, -1, 5, 'w', 'wall_vent');
const R06 = room('R06', 'Pressure Door Hall', rect(-1, 0, 7, 9), {
  area: 'labs',
  height: 4,
  atmosphere: { ...ACTION_FOG, reverb: 'metal_hall', ambience: 'hull_groan' },
  ceiling: 'ceiling_pipes',
  lights: [L(0, 'steady'), L(3, 'flicker'), L(5, 'steady', '#ffd9b0')],
});
wallKit(R06, -1, 8, 'w', 'wall_vent');
wallKit(R06, 0, 7, 'e', 'wall_vent');
door('D_R05_R06', 'R05', 'R06', 0, 6, 's');
door('D_R06_R07', 'R06', 'R07', 0, 9, 's', { kit: 'bulkhead', state: 'locked', unlockBy: 'engineer', task: 'bypass_short' });
prop(R05, 'crate_stack', [-4.6, 0, 14.6], 10);
prop(R05, 'debris_pile', [-1.5, 0, 22.5]);
prop(R05, 'console', [1.2, 0, 19.4], 270, { screen: 'log' });
prop(R05, 'emergency_beacon', [-5.7, 2.6, 20], 0, { wall: true });
prop(R05, 'cable_bundle', [-2, 0, 18], 90, { length: 10, height: 2.9 });
prop(R06, 'crate_stack', [-4.4, 0, 29], 0);
prop(R06, 'crate', [1.2, 0, 32.4], 20, { size: 0.9 });
prop(R06, 'crate', [-3.2, 0, 34.6], 40, { size: 0.8 });
prop(R06, 'pipe_run', [-5.4, 0, 32], 90, { length: 10, height: 0.5, paint: 'dark' });
prop(R06, 'valve', [1.0, 0, 28.6]);
prop(R06, 'emergency_beacon', [1.7, 2.8, 36], 270, { wall: true });
prop(R06, 'emergency_beacon', [-5.7, 2.8, 30], 90, { wall: true });
anchor(R05, 'r05_entry', [-1.6, 0, 16.2], 180);
anchor(R05, 'ammo_r05', [-4.8, 0.9, 14.6]);
// TAG FM is still playing in the ruined junction after the first fight (ADR-0023); the radio sits on the console.
prop(R05, 'radio', [1.5, 0.95, 19.1], 250);
anchor(R05, 'r05_radio', [1.5, 1.08, 19.1]);
anchor(R06, 'r06_panel', [-0.6, 0, 37.0], 180);
anchor(R06, 'r06_hold', [-2, 0, 31], 0);
spawn(R05, 'r05_door', [8, 0, 26.5], 'door', 'r05_contact', { yaw: 90, outfit: 'lab' });
// The first one breaks through the sealed Lab B door (group r05_contact); two to three more trickle in
// after it dies (group r05_trickle, ADR-0014 beat 3).
spawn(R05, 'r05_vent', [-5.2, 2.7, 22], 'vent', 'r05_trickle', { count: 2, interval: 6 });
spawn(R05, 'r05_floor', [-3.4, 0, 25], 'floor', 'r05_trickle', { count: 1, interval: 8, outfit: 'crew' });
spawn(R06, 'r06_vent_w', [-5.6, 1.0, 32], 'vent', 'r06_cover', { count: 2, interval: 4 });
spawn(R06, 'r06_vent_e', [1.6, 1.0, 28], 'vent', 'r06_cover', { count: 2, interval: 5 });
spawn(R06, 'r06_ceiling', [-2, 3.8, 34], 'ceiling', 'r06_cover', { count: 1 });
spawn(R06, 'r06_corridor', [-0.5, 0, 22], 'door', 'r06_cover', { count: 1, yaw: 180 });
trigger(R05, 'trig_r05_enter', cellBox(-1, 0, 4, 4), 'trigger:r05_enter');
trigger(R06, 'trig_r06_enter', cellBox(-1, 0, 7, 7), 'trigger:r06_enter');
trigger(R06, 'trig_r06_door', cellBox(-1, 0, 9, 9), 'trigger:r06_door');
checkpoints.push({ id: 'cp_first_contact', room: 'R05', pos: [-1.6, 0, 16.4], yaw: 180 });
checkpoints.push({ id: 'cp_cover_me', room: 'R06', pos: [-2, 0, 28.6], yaw: 180 });

// ---------------------------------------------------------------- R07 security + armory, R08 medical bay
const R07 = room('R07', 'Security Office', rect(-1, 1, 10, 11), {
  area: 'security',
  atmosphere: { fog: '#06080a', fogDensity: 0.045, reverb: 'small_office', ambience: 'office_hvac' },
  lights: [L(0, 'steady', '#e0ecff', 8), L(2, 'steady', '#e0ecff', 8), L(4, 'flicker', '#e0ecff', 6)],
});
const R07a = room('R07a', 'Armory', [[2, 10]], { area: 'security', atmosphere: { fog: '#06080a', fogDensity: 0.045, reverb: 'small_office' }, walls: ['wall_plain'], lights: [L(0, 'steady', '#ffe0b0', 7)] });
const R08 = room('R08', 'Medical Bay', rect(-1, 1, 12, 13), {
  area: 'medbay',
  atmosphere: { fog: '#05090a', fogDensity: 0.04, reverb: 'small_office', ambience: 'med_beeps' },
  floor: 'floor_tiles',
  walls: ['wall_tiles'],
  visibleFrom: ['R07'],
  lights: [L(0, 'steady', '#eaf6ff', 9), L(2, 'flicker', '#eaf6ff', 8), L(4, 'steady', '#eaf6ff', 8)],
});
const R08b = room('R08b', 'Surgery', [[2, 13]], { area: 'medbay', hidden: true, floor: 'floor_tiles', walls: ['wall_tiles'], atmosphere: { fog: '#05090a', fogDensity: 0.05, reverb: 'small_office' }, lights: [L(0, 'dying', '#eaf6ff', 6)] });
for (const x of [-1, 0, 1]) glass('R07', x, 11, 's');
// Priya's attack (ADR-0014 beat 5): the medical bay glass cracks and takes blood (events glass:set / glass:blood, id medbay).
for (const [i, x] of [-1, 0, 1].entries()) {
  wallProp(R07, 'glass_cracks', x, 11, 's', 0, { id: 'medbay', seed: i + 11 }, 0.02);
  wallProp(R07, 'glass_blood', x, 11, 's', 0, { id: 'medbay', seed: i + 21 }, 0.03);
}
door('D_R07_R07a', 'R07', 'R07a', 1, 10, 'e', { state: 'locked', unlockBy: 'engineer', task: 'bypass_short' });
door('D_R07_R09', 'R07', 'R09', 1, 11, 'e', { state: 'locked', unlockBy: 'medic', task: 'biometric' });
door('D_R08_R08b', 'R08', 'R08b', 1, 13, 'e', { state: 'closed', access: { sealed: true, text: 'lockdown' } });
prop(R07, 'console_bank', [-3.6, 0, 37.6], 180, { width: 3, mode: 'security' });
prop(R07, 'chair', [-3.6, 0, 39.2]);
prop(R07, 'desk', [-4.4, 0, 42.2], 90, { width: 1.6 });
prop(R07, 'locker', [5.4, 0, 39.4], 270, { count: 2, label: 'SEC-07' });
prop(R07, 'crate', [-5, 0, 38.4], 10, { size: 0.7 });
prop(R07, 'emergency_beacon', [-5.7, 2.6, 41], 90, { wall: true });
prop(R07a, 'armory_rack', [8, 0, 38.6], 180, { width: 2.4, empty: 1 });
prop(R07a, 'crate_stack', [8.8, 0, 41.4], 0);
prop(R08, 'med_bed', [-3.4, 0, 51], 0);
prop(R08, 'med_bed', [0.6, 0, 51], 0);
prop(R08, 'gurney', [4.4, 0, 49.6], 90);
prop(R08, 'lab_bench', [0, 0, 54.7], 180, { width: 3.2 });
prop(R08, 'console', [-5, 0, 48.2], 90, { screen: 'status' });
prop(R08b, 'med_bed', [8, 0, 52], 0);
prop(R08b, 'specimen_tank', [9.4, 0, 54]);
anchor(R07a, 'shotgun_pickup', [8, 1.25, 38.6]);
anchor(R07a, 'r07_panel', [8.6, 0, 40.4], 90);
anchor(R07a, 'ammo_r07a', [8.8, 0.9, 41.4]);
anchor(R07, 'r07_glass', [0, 1.5, 45.8]);
anchor(R07, 'health_r07', [-4.4, 0.8, 42.2]);
anchor(R07, 'okafor_biometric', [4.4, 0, 44], 270);
// Action half set pieces (ADR-0014 beat 5): Giles at the armory door, the squad at the glass, Priya's run,
// the thing waiting in R08b, and the stinger's camera in the surgery (ADR-0014 amendment).
anchor(R07, 'r07_armory_panel', [5.15, 0, 41.4], 270);
anchor(R07, 'r07_glass_okafor', [-1.1, 0, 45.0], 180);
anchor(R07, 'r07_glass_giles', [2.1, 0, 44.4], 200);
anchor(R07, 'r07_glass_jay', [0.4, 0, 44.2], 180);
anchor(R07, 'r07_regroup', [3.4, 0, 42.4], 200);
// The admin security-booth glimpse (ADR-0023): CAM 04 high in the north-east corner, a figure facing the west wall.
anchor(R08, 'cam04_pos', [5.4, 2.9, 47.0]);
anchor(R08, 'cam04_look', [-2.5, 1.0, 51.5]);
anchor(R08, 'cam04_figure', [-5.1, 0, 51.6], 90);
anchor(R08, 'priya_r08', [0, 0, 49.2], 0);
anchor(R08, 'r08_drag_exit', [5.6, 0, 52], 270);
anchor(R08, 'priya_glass', [0.3, 0, 46.62], 0);
anchor(R08, 'r08_drag_mid', [2.8, 0, 48.4]);
anchor(R08, 'r08_drag_turn', [3.0, 0, 51.6]);
anchor(R08b, 'r08_lurk', [7.8, 0, 52], 90);
anchor(R08b, 'stinger_cam', [9.65, 2.85, 50.35]);
anchor(R08b, 'stinger_look', [8.1, 0.55, 52.9]);
anchor(R08b, 'priya_hide', [8.7, 0, 53.35], 300);
anchor(R08b, 'stinger_enter', [6.7, 0, 52], 270);
anchor(R08b, 'stinger_kill', [8.0, 0, 52.6], 225);
// One play-dead in R07 (gets up as the player passes, ADR-0014 beat 5); the other bodies are dressing.
spawn(R07, 'r07_playdead', [2.6, 0, 42.6], 'corpse', 'r07_playdead', { variant: 'playDead', outfit: 'security', yaw: 120, on: 'trigger:r07_enter' });
anchor(R07, 'body_r07_1', [-3.2, 0, 40], 30);
anchor(R07, 'body_r07_2', [-1.2, 0, 43.4], 200);
trigger(R07, 'trig_r07_enter', cellBox(-1, 1, 10, 10), 'trigger:r07_enter');
trigger(R07, 'trig_r07_playdead', [[1, 0, 40.6], [4, 2.2, 44.4]], 'trigger:r07_playdead');
trigger(R07, 'trig_r08_glass', [[-5.6, 0, 43.4], [5.6, 2.4, 45.6]], 'trigger:r08_glass');
trigger(R07a, 'trig_r07_armory', cellBox(2, 2, 10, 10), 'trigger:r07_armory');
checkpoints.push({ id: 'cp_security', room: 'R07', pos: [0, 0, 40.2], yaw: 180 });

// ---------------------------------------------------------------- R09 flooded tunnel, R10 valve room (tunnel)
const R09 = room('R09', 'Flooded Maintenance Tunnel', [[2, 11], [3, 11], [4, 11], [4, 12], [5, 12], [6, 12], [7, 12]], {
  area: 'tunnel',
  floor: 'floor_grate',
  ceiling: 'ceiling_pipes',
  walls: ['wall_plain', 'wall_vent', 'wall_plain'],
  atmosphere: { fog: '#03100f', fogDensity: 0.085, ambient: 'flooded', reverb: 'flooded', ambience: 'water_drip' },
  lights: [L(0, 'dying', '#9fe8ff', 6), L(2, 'flicker', '#9fe8ff', 5), L(4, 'dying', '#9fe8ff', 5), L(6, 'flicker', '#9fe8ff', 5)],
});
for (const [x, z] of R09.cells) prop(R09, 'water_surface', [cx(x), 0, cx(z)], 0, { width: 4, depth: 4, level: 0.45 });
const R10 = room('R10', 'Valve Room', rect(8, 9, 12, 13), {
  area: 'tunnel',
  ceiling: 'ceiling_pipes',
  atmosphere: { fog: '#040a0a', fogDensity: 0.06, reverb: 'metal_corridor', ambience: 'pipes_knock' },
  lights: [L(0, 'flicker', '#ffd9a0', 7), L(3, 'steady', '#ffd9a0', 6)],
});
door('D_R09_R10', 'R09', 'R10', 7, 12, 'e');
door('D_R10_R11', 'R10', 'R11', 8, 12, 'n', { kit: 'bulkhead', state: 'locked', unlockBy: 'script', unlockOn: 'valve:r10_main' });
prop(R09, 'debris_pile', [12, 0, 44.6]);
prop(R09, 'debris_pile', [20, 0, 48.6]);
prop(R09, 'crate', [17.2, 0, 49.6], 30, { size: 0.8 });
prop(R09, 'crate', [25, 0, 49.4], 70, { size: 0.6 });
prop(R09, 'pipe_run', [10, 0, 45.6], 0, { length: 6, height: 0.8, paint: 'teal' });
prop(R09, 'emergency_beacon', [17.7, 2.6, 46], 270, { wall: true });
wallProp(R10, 'valve_wheel', 9, 13, 'e', 0.6, { id: 'r10_main' });
prop(R10, 'console', [31.4, 0, 52.6], 270, { screen: 'status' });
prop(R10, 'pipe_run', [36, 0, 46.6], 0, { length: 7, height: 0.4, paint: 'dark' });
prop(R10, 'crate_stack', [33, 0, 54.6], 0);
prop(R10, 'valve', [36.4, 0, 49.4]);
anchor(R09, 'r09_entry', [8.4, 0, 44], 270);
anchor(R09, 'r09_mid', [16, 0, 48], 270);
anchor(R09, 'ammo_r09', [17.2, 0.9, 49.6]);
anchor(R10, 'valve_r10', [37.5, 1.3, 53.6]);
// Beat 6 (Mara moment): the squad waits in the valve room while Jay turns the wheel.
anchor(R10, 'r10_giles', [35.4, 0, 52.2], 270);
anchor(R10, 'r10_okafor', [34.2, 0, 50.6], 300);
anchor(R10, 'health_r10', [33, 1.0, 54.6]);
spawn(R09, 'r09_floor_1', [13, 0, 44], 'floor', 'r09_tunnel', { outfit: 'engineer' });
spawn(R09, 'r09_corpse_1', [16.4, 0, 49.4], 'corpse', 'r09_tunnel', { variant: 'playDead' });
spawn(R09, 'r09_floor_2', [22, 0, 47.2], 'floor', 'r09_tunnel', { count: 2, interval: 6 });
spawn(R09, 'r09_corpse_2', [26.6, 0, 48.6], 'corpse', 'r09_tunnel', { variant: 'playDead' });
spawn(R09, 'r09_vent', [19.6, 2.8, 49], 'vent', 'r09_tunnel', { count: 1 });
trigger(R09, 'trig_r09_enter', cellBox(2, 2, 11, 11), 'trigger:r09_enter');
trigger(R09, 'trig_r09_mid', cellBox(4, 4, 12, 12), 'trigger:r09_mid');
trigger(R10, 'trig_r10_enter', cellBox(8, 8, 12, 12), 'trigger:r10_enter');
trigger(R10, 'trig_r10_valve', around([36.9, 0, 53.6], 0.8, 2.2), 'valve:r10_main', { on: 'use', prompt: 'Turn valve' });
checkpoints.push({ id: 'cp_flooded', room: 'R09', pos: [8.4, 0, 44], yaw: 270 });

// ---------------------------------------------------------------- R11 control room (control)
const R11 = room('R11', 'Control Room', rect(8, 10, 9, 11), {
  area: 'control',
  height: 4,
  ceiling: 'ceiling_pipes',
  atmosphere: { fog: '#05070a', fogDensity: 0.05, reverb: 'metal_hall', ambience: 'hull_hum' },
  lights: [L(0, 'steady', '#cfe0ff', 8), L(2, 'flicker', '#cfe0ff', 7), L(4, 'steady', '#cfe0ff', 9), L(6, 'steady', '#cfe0ff', 7), L(8, 'dying', '#cfe0ff', 6)],
});
prop(R11, 'console_bank', [38.4, 0, 35], 180, { width: 3.6, mode: 'control' });
prop(R11, 'console_bank', [41.4, 0, 41], 90, { width: 3, mode: 'control' });
prop(R11, 'console', [31.2, 0, 38], 270, { screen: 'status' });
prop(R11, 'chair', [38.4, 0, 36.6]);
prop(R11, 'chair', [40, 0, 41.4]);
prop(R11, 'crate_stack', [32.6, 0, 44.4], 0);
prop(R11, 'crate', [38.8, 0, 43.6], 25, { size: 0.9 });
prop(R11, 'cable_bundle', [36, 0, 40], 0, { length: 12, height: 3.6 });
prop(R11, 'emergency_beacon', [41.7, 2.8, 36], 270, { wall: true });
prop(R11, 'emergency_beacon', [30.3, 2.8, 42], 90, { wall: true });
anchor(R11, 'giles_final', [32.4, 0, 38], 270);
anchor(R11, 'final_console', [31.2, 1.2, 38]);
anchor(R11, 'r11_hold', [36, 0, 40], 0);
anchor(R11, 'ammo_r11', [32.6, 0.9, 44.4]);
// Beat 7/8: Giles works facing the console; the reveal turns him to the room. Spare shells for the climax.
anchor(R11, 'r11_giles_task', [32.4, 0, 38], 90);
anchor(R11, 'r11_okafor_end', [35.4, 0, 40.4], 70);
anchor(R11, 'r11_okafor_step', [34.0, 0, 39.3], 70);
anchor(R11, 'r11_jay_end', [35.8, 0, 38.3], 90);
anchor(R11, 'ammo_r11_b', [38.8, 0.92, 43.6]);
anchor(R11, 'ammo_r11_c', [40.2, 0, 37.2]);
// Beat 8: the bloom's fluid trail runs from Giles's console back toward the south door (revealed by `reveal:trail`).
prop(R11, 'fluid_trail', [32.6, 0, 38.5], 203.6, { length: 8, width: 1, seed: 2 });
// ~14 enemies through two entrances (R10 side and the R13d maintenance door), max 8 active.
spawn(R11, 'r11_door_south', [32, 0, 48.6], 'door', 'r11_climax', { count: 4, interval: 5, yaw: 0 });
spawn(R11, 'r11_door_north', [36, 0, 31.6], 'door', 'r11_climax', { count: 4, interval: 5, yaw: 180 });
spawn(R11, 'r11_vent_1', [40, 3.8, 44], 'ceiling', 'r11_climax', { count: 2, interval: 8 });
spawn(R11, 'r11_vent_2', [32, 3.8, 36], 'ceiling', 'r11_climax', { count: 1 });
spawn(R11, 'r11_corridor', [40, 0, 32], 'floor', 'r11_climax', { count: 2, interval: 6 });
spawn(R11, 'r11_hero', [34, 0, 31.6], 'door', 'r11_climax', { variant: 'hero', yaw: 180 });
trigger(R11, 'trig_r11_enter', cellBox(8, 8, 11, 11), 'trigger:r11_enter');
checkpoints.push({ id: 'cp_climax', room: 'R11', pos: [32, 0, 43], yaw: 0 });

// ---------------------------------------------------------------- R12 hydroponics hub
const HYDRO = { fog: '#0a1a10', fogDensity: 0.045, reverb: 'small_office', ambience: 'hydro_misters' };
const R12a = room('R12a', 'Hydroponics Vestibule', [[9, 5]], { area: 'hydroponics', atmosphere: HYDRO, floor: 'floor_tiles', lights: [L(0, 'steady', '#e0ffe0', 8)] });
const R12b = room('R12b', 'Grow Hall', rect(10, 12, 4, 6), {
  area: 'hydroponics',
  height: 4.5,
  atmosphere: { ...HYDRO, fogDensity: 0.05, reverb: 'metal_hall' },
  floor: 'floor_grate',
  ceiling: 'ceiling_pipes',
  walls: ['wall_greenhouse', 'wall_panel'],
  lights: [L(1, 'steady', '#d8ffd0', 10), L(3, 'steady', '#d8ffd0', 9), L(5, 'steady', '#d8ffd0', 9), L(7, 'steady', '#e8ffe0', 10)],
});
const R12c = room('R12c', 'Seed Lab', [[13, 4], [13, 5]], { area: 'hydroponics', atmosphere: HYDRO, floor: 'floor_tiles', walls: ['wall_tiles', 'wall_greenhouse'], lights: [L(0, 'steady', '#f0fff0', 8), L(1, 'steady', '#f0fff0', 7)] });
const R12d = room('R12d', 'Nutrient Room', [[11, 7], [12, 7]], { area: 'hydroponics', atmosphere: { ...HYDRO, reverb: 'metal_corridor' }, ceiling: 'ceiling_pipes', walls: ['wall_plain', 'wall_panel'], lights: [L(0, 'steady', '#c8ffd8', 7), L(1, 'flicker', '#c8ffd8', 6)] });
const R12e = room('R12e', 'Hydroponics Storeroom', [[10, 7]], { area: 'hydroponics', atmosphere: { ...HYDRO, reverb: 'small_office' }, walls: ['wall_plain'], lights: [L(0, 'steady', '#ffe2b8', 6)] });
wallKit(R12d, 12, 7, 'e', 'wall_vent');
door('D_R02_R12a', 'R02', 'R12a', 8, 5, 'e');
door('D_R12a_R12b', 'R12a', 'R12b', 9, 5, 'e', { kit: 'glass_slide' });
door('D_R12b_R12c', 'R12b', 'R12c', 12, 4, 'e', { kit: 'glass_slide' });
door('D_R12b_R12d', 'R12b', 'R12d', 12, 6, 's');
door('hydro_store', 'R12b', 'R12e', 10, 6, 's', { access: { requires: 'card_l2' } });
// The sealed vent: the wall_vent tile on R12d's east wall (fan 0.9 m along, 0.55 m up).
vents.push({ id: 'hydro_vent', room: 'R12d', box: [[49.4, 0.2, 27.0], [50.0, 0.9, 28.8]], access: { requires: 'vent_driver' } });
station(R12a, 'hydro_map', 'hydroponics', 9, 5, 'n');
prop(R12a, 'potted_plant', [37, 0, 22.6], 0, { kind: 'fern', pot: 'white' });
prop(R12a, 'potted_plant', [38.6, 0, 22.4], 0, { kind: 'succulent', pot: 'clay' });
prop(R12a, 'locker', [34.6, 0, 18.6], 270, { count: 1, label: 'HYDRO' });
// Rows keep clear of the doors at (50, 16) east, (48, 26) and (40, 26) south.
for (const z of [17.6, 20, 22.4]) {
  prop(R12b, 'plant_rack', [42.4, 0, z], 0, { length: 3.2, tiers: 3, light: z < 20 ? 'magenta' : 'white' });
  prop(R12b, 'plant_rack', [47.2, 0, z], 0, { length: 3.2, tiers: 3, light: 'magenta' });
}
prop(R12b, 'plant_rack', [43.6, 0, 24.6], 0, { length: 2.4, tiers: 2, light: 'white' });
for (const z of [16.4, 18.8, 21.2, 23.6, 25.6]) prop(R12b, 'mister', [45, 0, z], 0, { length: 8, period: 7 + (Math.round(z) % 3) });
for (const [x, z] of [[40.4, 15], [49.6, 15.2], [40.4, 26], [49.6, 26]]) prop(R12b, 'hanging_plant', [x, 0, z], 0, { drop: 1.1 });
prop(R12b, 'console', [45, 0, 14.8], 180, { screen: 'status' });
prop(R12b, 'potted_plant', [39.2, 0, 14.6], 0, { kind: 'palm', pot: 'clay', size: 1.3 });
prop(R12b, 'potted_plant', [50.6, 0, 22], 0, { kind: 'tall', pot: 'dark', size: 1.2 });
prop(R12c, 'lab_bench', [53.4, 0, 17.2], 270, { width: 3.2 });
prop(R12c, 'storage_shelf', [51.6, 0, 22.8], 0, { width: 1.8 });
for (const [x, z, kind] of [[50.6, 14.6, 'succulent'], [53.4, 14.6, 'fern'], [53.4, 20.6, 'shrub'], [50.6, 19.6, 'palm']]) prop(R12c, 'potted_plant', [x, 0, z], 0, { kind });
prop(R12d, 'specimen_tank', [43.6, 0, 29.4]);
prop(R12d, 'specimen_tank', [46, 0, 29.4]);
prop(R12d, 'pipe_run', [44, 0, 26.6], 0, { length: 3, height: 0.6, paint: 'teal' });
prop(R12d, 'console', [48.6, 0, 29.6], 0, { screen: 'log' });
prop(R12d, 'valve', [44.8, 0, 27.4]);
prop(R12e, 'storage_shelf', [38.6, 0, 28], 270, { width: 2.4 });
prop(R12e, 'desk', [41.2, 0, 29.4], 0, { width: 1.2 });
prop(R12e, 'chair', [41.2, 0, 28.6]);
prop(R12e, 'radio', [41.6, 0.78, 29.5], 160);
prop(R12e, 'potted_plant', [41.6, 0, 26.6], 0, { kind: 'succulent', pot: 'white', size: 0.7 });
prop(R12e, 'potted_plant', [41.4, 0, 30.4], 0, { kind: 'fern', pot: 'clay', size: 0.8 });
anchor(R12a, 'hydro_entry', [36.4, 0, 20], 270);
anchor(R12b, 'hydro_log', [45, 1.2, 14.8]);
anchor(R12b, 'cp_round_hydro', [45, 0, 18], 180);
anchor(R12b, 'botanist_1_spot', [45, 0, 17.9], 180);
anchor(R12b, 'botanist_2_spot', [45, 0, 23.1], 90);
anchor(R12d, 'hydro_alarm', [48.6, 1.2, 29.6]);
anchor(R12e, 'hydro_store_moment', [41.2, 0, 27.6], 180);
anchor(R12e, 'hydro_radio', [41.6, 0.9, 29.5]);
npc(R12b, 'botanist_1', 'botanist', 'botanist_1_spot', 'crouchWork');
npc(R12b, 'botanist_2', 'botanist', 'botanist_2_spot', 'clipboard');
npc(R12c, 'botanist_3', 'botanist', [52.2, 0, 17.2], 'typing');
trigger(R12a, 'trig_hydro_enter', cellBox(9, 9, 5, 5), 'trigger:hydro_enter', { once: false });
trigger(R12b, 'trig_hydro_log', around([45, 0, 15.8], 0.8, 2), 'round:hydro_log', { on: 'use', prompt: 'Sign irrigation log' });
trigger(R12d, 'trig_hydro_alarm', around([48.6, 0, 28.6], 0.8, 2), 'round:hydro_alarm', { on: 'use', prompt: 'Reset humidity alarm' });
trigger(R12e, 'trig_hydro_store', cellBox(10, 10, 7, 7), 'trigger:hydro_store_enter');

// ---------------------------------------------------------------- R13 dive bay hub
const DIVE = { fog: '#06151a', fogDensity: 0.05, reverb: 'metal_hall', ambience: 'dive_drip' };
const R13a = room('R13a', 'Dive Bay Access', [[6, 7]], { area: 'dive_bay', atmosphere: { ...DIVE, reverb: 'metal_corridor' }, floor: 'floor_grate', ceiling: 'ceiling_pipes', lights: [L(0, 'steady', '#bfefff', 8)] });
const R13b = room('R13b', 'Moon Pool', rect(5, 7, 8, 10), {
  area: 'dive_bay',
  height: 5,
  atmosphere: DIVE,
  floor: 'floor_grate',
  floorOverride: { '6,9': 'floor_moonpool' },
  ceiling: 'ceiling_pipes',
  lights: [L(0, 'steady', '#9fe8ff', 10), L(2, 'steady', '#9fe8ff', 9), L(4, 'steady', '#bff4ff', 12), L(6, 'steady', '#9fe8ff', 9), L(8, 'flicker', '#9fe8ff', 8)],
});
const R13c = room('R13c', 'Suit Room', [[4, 8], [4, 9]], { area: 'dive_bay', atmosphere: { ...DIVE, reverb: 'small_office' }, floor: 'floor_tiles', lights: [L(0, 'steady', '#d8f4ff', 7), L(1, 'steady', '#d8f4ff', 6)] });
const R13d = room('R13d', 'Maintenance Corridor', rect(8, 10, 8, 8), {
  area: 'dive_bay',
  atmosphere: { fog: '#020405', fogDensity: 0.09, ambient: 'dark', reverb: 'metal_corridor', ambience: 'hull_groan' },
  ceiling: 'ceiling_pipes',
  walls: ['wall_plain', 'wall_vent'],
  lights: [L(2, 'dying', '#ffcf9a', 3, 6)],
});
const R13e = room('R13e', 'Dive Lockers', [[4, 10]], { area: 'dive_bay', atmosphere: { ...DIVE, reverb: 'small_office' }, floor: 'floor_tiles', lights: [L(0, 'steady', '#d8f4ff', 7)] });
door('D_R02_R13a', 'R02', 'R13a', 6, 6, 's');
door('D_R13a_R13b', 'R13a', 'R13b', 6, 7, 's');
door('D_R13b_R13c', 'R13b', 'R13c', 5, 8, 'w');
door('D_R13b_R13d', 'R13b', 'R13d', 7, 8, 'e');
door('D_R13b_R13e', 'R13b', 'R13e', 5, 10, 'w');
door('D_R13d_R11', 'R13d', 'R11', 9, 8, 's', { kit: 'bulkhead', access: { sealed: true, text: 'lockdown' } });
station(R13a, 'dive_map', 'dive_bay', 6, 7, 'w');
prop(R13a, 'locker', [25.6, 0, 26.4], 90, { count: 1, label: 'DIVE' });
prop(R13b, 'rib_frame', [24, 0, 36], 0, { width: 4, height: 4.6 });
prop(R13b, 'crate_stack', [20.6, 0, 33.4], 20);
prop(R13b, 'crate', [27.4, 0, 39.4], 10, { size: 0.9 });
prop(R13b, 'pipe_run', [24, 0, 41.4], 0, { length: 10, height: 0.4, paint: 'teal' });
prop(R13b, 'cable_bundle', [24, 0, 36], 90, { length: 10, height: 4.4 });
prop(R13b, 'console', [27.6, 0, 33], 270, { screen: 'status' });
prop(R13b, 'dive_suit_rack', [20.6, 0, 38.4], 90, { suits: 2 });
prop(R13c, 'dive_suit_rack', [14.6, 0, 31.4], 270, { suits: 3 });
prop(R13c, 'dive_suit_rack', [14.6, 0, 36], 270, { suits: 3 });
prop(R13c, 'locker', [17.4, 0, 37.4], 90, { count: 2, label: 'DIVE' });
prop(R13d, 'pipe_run', [36, 0, 33.4], 0, { length: 11, height: 0.5, paint: 'dark' });
prop(R13d, 'crate', [41, 0, 30.8], 15, { size: 0.7 });
prop(R13d, 'debris_pile', [37.6, 0, 31.2]);
prop(R13e, 'locker', [14.6, 0, 40], 270, { count: 3, label: 'AIRLOCK' });
prop(R13e, 'crate', [17.4, 0, 41.4], 0, { size: 0.6 });
anchor(R13a, 'dive_entry', [24, 0, 27.4], 180);
// Priya waits outside the commons' south door until the intro brings her in with the tray.
anchor(R13a, 'priya_start', [24, 0, 29.4], 0);
npc(R13a, 'priya', 'priya', 'priya_start', 'idle');
anchor(R13b, 'moon_pool', [24, 0, 36]);
anchor(R13b, 'cp_round_dive', [24, 0, 33], 180);
anchor(R13b, 'diver_1_spot', [21.4, 0, 36], 270); // Sung (he walks in from the commons on dive_enter)
anchor(R13b, 'dive_case_pickup', [21.4, 0, 37.2], 270);
anchor(R13e, 'dive_case_locker', [15, 1.0, 40]);
anchor(R13d, 'dark_corridor', [32, 0, 32], 270);
npc(R13b, 'diver_1', 'diver', [26.4, 0, 35.4], 'idle_hips');
npc(R13b, 'maint_1', 'maintenance', [27, 0, 37.6], 'crouchWork');
npc(R13e, 'diver_2', 'diver', [16.6, 0, 39.4], 'idle_weight');
trigger(R13a, 'trig_dive_enter', cellBox(6, 6, 7, 7), 'trigger:dive_enter', { once: false });
trigger(R13d, 'trig_dive_dark', cellBox(8, 8, 8, 8), 'area:dark');
trigger(R13e, 'trig_dive_case', around([15.6, 0, 40], 0.8, 2), 'round:dive_case', { on: 'use', prompt: 'Stow sample case', once: false });
// TAG FM follows Jay between rooms (ADR-0023): a second radio in the dive lockers.
prop(R13e, 'radio', [17.2, 0.62, 41.4], 200);
anchor(R13e, 'dive_radio', [17.2, 0.75, 41.4]);
trigger(R13e, 'trig_dive_lockers', cellBox(4, 4, 10, 10), 'trigger:dive_lockers_enter', { once: false });

// ---------------------------------------------------------------- R14 TAG admin office hub
const ADMIN = { fog: '#0b0a08', fogDensity: 0.02, reverb: 'small_office', ambience: 'office_hvac' };
const WARM = '#ffe2c0';
const R14a = room('R14a', 'TAG Reception', [[9, 2], [9, 3]], { area: 'admin', atmosphere: ADMIN, floor: 'floor_carpet', walls: ['wall_wood'], lights: [L(0, 'steady', WARM, 8), L(1, 'steady', WARM, 8)] });
const R14b = room('R14b', 'Open Office', rect(10, 12, 1, 2), { area: 'admin', atmosphere: ADMIN, floor: 'floor_carpet', walls: ['wall_wood', 'wall_plain'], lights: [L(0, 'steady', WARM, 8), L(2, 'steady', WARM, 8), L(4, 'steady', WARM, 8)] });
const R14c = room('R14c', "Director's Office", [[13, 1], [13, 2]], { area: 'admin', atmosphere: ADMIN, floor: 'floor_carpet', walls: ['wall_wood'], lights: [L(0, 'steady', '#ffd9a8', 7), L(1, 'steady', '#ffd9a8', 6)] });
const R14d = room('R14d', 'Meeting Room', [[10, 0], [11, 0]], { area: 'admin', atmosphere: ADMIN, floor: 'floor_carpet', walls: ['wall_wood'], lights: [L(0, 'steady', WARM, 7), L(1, 'steady', WARM, 7)] });
const R14e = room('R14e', 'Security Booth', [[9, 1]], { area: 'admin', atmosphere: { ...ADMIN, fogDensity: 0.03 }, floor: 'floor_carpet', walls: ['wall_plain'], lights: [L(0, 'steady', '#cfe0ff', 5)] });
wallKit(R14c, 13, 1, 'n', 'wall_window');
wallKit(R14c, 13, 1, 'e', 'wall_window');
wallKit(R14d, 10, 0, 'n', 'wall_window');
wallKit(R14d, 11, 0, 'n', 'wall_window');
glass('R14b', 10, 1, 'n'); // meeting room seen from the open office
glass('R14b', 12, 2, 'e'); // Hale's office behind glass
door('D_R02_R14a', 'R02', 'R14a', 8, 3, 'e', { kit: 'glass_slide' });
door('D_R14a_R14b', 'R14a', 'R14b', 9, 2, 'e', { kit: 'glass_slide' });
door('D_R14b_R14c', 'R14b', 'R14c', 12, 1, 'e', { kit: 'glass_slide' });
door('D_R14b_R14d', 'R14b', 'R14d', 11, 1, 'n', { kit: 'glass_slide' });
door('D_R14a_R14e', 'R14a', 'R14e', 9, 2, 'n');
R14c.visibleFrom = ['R14b'];
R14d.visibleFrom = ['R14b'];
station(R14a, 'admin_map', 'admin', 9, 3, 's');
prop(R14a, 'office_desk', [36.4, 0, 10], 270, { width: 2, papers: 4 });
prop(R14a, 'chair', [37.3, 0, 10]);
prop(R14a, 'sofa', [34.6, 0, 6.6], 90, { width: 1.8, tone: 'warm' });
wallProp(R14a, 'tag_poster', 9, 2, 'w', 0.8, { slogan: 'THE FUTURE IS DEEP.' });
for (const [x, z, kind] of [[34.6, 4.6, 'palm'], [37.4, 13.4, 'fern'], [37.4, 4.6, 'tall']]) prop(R14a, 'potted_plant', [x, 0, z], 0, { kind, pot: 'white', size: 1.1 });
for (const [x, z] of [[41.2, 3.4], [45, 3.4], [41.2, 7.8], [45, 7.8]]) {
  prop(R14b, 'office_desk', [x, 0, z], 0, { width: 1.6, papers: 2 });
  prop(R14b, 'chair', [x, 0, z + 0.9]);
}
prop(R14b, 'bookshelf', [48.8, 0, 9.5], 0, { width: 1.6 });
for (const [x, z, kind] of [[38.6, 2.4, 'tall'], [50.4, 6.4, 'fern'], [38.6, 9.6, 'shrub'], [43.6, 9.8, 'palm']]) prop(R14b, 'potted_plant', [x, 0, z], 0, { kind, pot: 'white' });
prop(R14b, 'hanging_plant', [43.6, 0, 6], 0, { drop: 0.7, pot: 'white' });
prop(R14c, 'office_desk', [52.6, 0, 6.2], 90, { width: 2.2, exec: true, papers: 4 });
prop(R14c, 'chair', [53.5, 0, 6.2]);
prop(R14c, 'bookshelf', [53.6, 0, 9.2], 270, { width: 1.8, height: 2.2 });
prop(R14c, 'sofa', [51.4, 0, 9.4], 0, { width: 1.8, tone: 'warm' });
prop(R14c, 'potted_plant', [50.4, 0, 2.6], 0, { kind: 'palm', pot: 'dark', size: 1.3 });
prop(R14c, 'potted_plant', [53.4, 0, 2.6], 0, { kind: 'fern', pot: 'dark' });
wallProp(R14c, 'tag_poster', 13, 2, 's', 0, { slogan: 'TAG INDUSTRIES - 40 YEARS DEEP', width: 1.1 });
prop(R14d, 'dining_table', [42, 0, 0.2], 0, { width: 3.2, seats: 6, mugs: 3 });
wallProp(R14d, 'wall_screen', 10, 0, 'w', 0, { id: 'admin_tv', width: 2 });
prop(R14d, 'potted_plant', [46.4, 0, -1.2], 0, { kind: 'tall', pot: 'white' });
prop(R14e, 'security_monitor', [36, 0, 2.8], 180, { id: 'admin_cam', camera: 'CAM 04  MEDICAL BAY', feed: 'live' });
prop(R14e, 'chair', [35, 0, 3.9]);
pickups.push({ id: 'P_card_l2', room: 'R14c', item: 'card_l2', pos: [52.5, 0.78, 5.5], rot: 15 });
// The divers' sample case (ADR-0023 dive round): lies at the moon pool's rim until Jay takes it.
pickups.push({ id: 'P_sample_case', room: 'R13b', item: 'sample_case', pos: [21.4, 0.02, 37.2], rot: 80 });
anchor(R14a, 'admin_entry', [35, 0, 12], 90);
anchor(R14c, 'hale_desk', [52.6, 0.8, 6.2]);
anchor(R14c, 'hale_stand', [52.4, 0, 8.4], 90);
anchor(R14c, 'cp_round_admin', [51, 0, 5.4], 270);
anchor(R14e, 'admin_cam_monitor', [36, 1.4, 2.6]);
anchor(R14e, 'admin_cam_view', [36.4, 0, 4.2], 0);
npc(R14a, 'assistant', 'assistant', [37.3, 0, 10], 'typing');
npc(R14b, 'exec_1', 'exec', [45.6, 0, 6], 'talk_gesture');
npc(R14b, 'exec_2', 'exec', [41.6, 0, 4.1], 'typing');
npc(R14c, 'hale', 'hale', 'hale_stand', 'idle_hips');
trigger(R14a, 'trig_admin_enter', cellBox(9, 9, 3, 3), 'trigger:admin_enter', { once: false });
trigger(R14c, 'trig_hale_office', cellBox(13, 13, 1, 2), 'trigger:hale_office', { once: false });
trigger(R14e, 'trig_security_booth', cellBox(9, 9, 1, 1), 'trigger:security_booth');

// ---------------------------------------------------------------- supplies (ADR-0008), action half only
const SUPPLIES = [
  ['ammo_r05', 'ammo_pistol'],
  ['health_r07', 'medkit'],
  ['ammo_r07a', 'ammo_shotgun'],
  ['ammo_r09', 'ammo_pistol'],
  ['health_r10', 'medkit'],
  ['ammo_r11', 'ammo_shotgun'],
  ['ammo_r11_b', 'ammo_shotgun'],
  ['ammo_r11_c', 'ammo_pistol'],
  // ADR-0005: the Breacher on the armory rack; Jay starts with the pistol only.
  ['shotgun_pickup', 'weapon_shotgun'],
];
for (const [anchorId, kind] of SUPPLIES) {
  const r = rooms.find((x) => x.anchors.some((a) => a.id === anchorId));
  const a = r.anchors.find((x) => x.id === anchorId);
  pickups.push({ id: `S_${anchorId}`, room: r.id, kind, pos: a.pos });
}

// ================================================================== build

/**
 * Spawn fields beyond { id, pos, kind } are only kept if the level schema accepts them
 * (the enemy work adds group/playDead/hero). Detected from src/data/types/level.ts text.
 */
async function detectSpawnFields() {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/data/types/level.ts'), 'utf8');
  const m = src.match(/spawnShape\s*=\s*\{([\s\S]*?)\n\};/) ?? src.match(/spawns:\s*optional\(arr\(obj\(\{([^}]*)\}/);
  const body = m ? m[1] : '';
  return new Set(['group', 'active', 'variant', 'count', 'interval', 'yaw', 'outfit', 'infection', 'on'].filter((f) => new RegExp(`\\b${f}\\b`).test(body)));
}

function build() {
  for (const check of doorChecks) check();
  const seen = new Map();
  for (const r of rooms) {
    for (const [x, z] of r.cells) {
      const k = `${x},${z}`;
      if (seen.has(k)) throw new Error(`cell ${k} is in both ${seen.get(k)} and ${r.id}`);
      seen.set(k, r.id);
    }
  }
  const out = [];
  for (const r of rooms) {
    const inRoom = new Set(r.cells.map(([x, z]) => `${x},${z}`));
    const pieces = [];
    const group = new Map();
    const put = (kit, cell, rot) => {
      const key = `${kit}|${rot}`;
      if (!group.has(key)) group.set(key, { kit, rot, cells: [] });
      group.get(key).cells.push(cell);
    };
    // Ceilings first, one entry per cell, so numeric light slots follow the cell order.
    r.cells.forEach(([x, z], i) => pieces.push({ kit: r.ceiling === 'ceiling_pipes' && i % 2 === 0 ? 'ceiling' : r.ceiling, cell: [x, 0, z] }));
    for (const [x, z] of r.cells) {
      put(r.floorOverride[`${x},${z}`] ?? r.floor, [x, 0, z], 0);
      for (const s of ['n', 'e', 's', 'w']) {
        const [nx, nz] = neighbour(x, z, s);
        if (inRoom.has(`${nx},${nz}`)) continue;
        const ek = edgeKey(x, z, s);
        if (doorEdges.has(ek) || glassEdges.has(ek) || openEdges.has(ek)) continue;
        const kit = r.wallOverride[ek] ?? r.walls[Math.abs(x * 7 + z * 3 + s.charCodeAt(0)) % r.walls.length];
        put(kit, [x, 0, z], WALL_ROT[s]);
      }
    }
    for (const g of group.values()) {
      const p = { kit: g.kit, cells: g.cells };
      if (g.rot) p.rot = g.rot;
      pieces.push(p);
    }
    const o = { id: r.id, name: r.name };
    if (r.area) o.area = r.area;
    if (r.hidden) o.hidden = true;
    if (r.height !== 3.2) o.height = r.height;
    if (r.atmosphere) o.atmosphere = r.atmosphere;
    if (r.visibleFrom) o.visibleFrom = r.visibleFrom;
    o.pieces = pieces;
    if (r.props.length) o.props = r.props;
    if (r.lights.length) o.lights = r.lights;
    if (r.triggers.length) o.triggers = r.triggers;
    if (r.spawns.length) {
      o.spawns = r.spawns.map((s) => {
        const keep = { id: s.id, pos: s.pos, kind: s.kind };
        for (const f of SPAWN_FIELDS) if (s[f] !== undefined) keep[f] = s[f];
        return keep;
      });
    }
    if (r.anchors.length) o.anchors = r.anchors;
    if (r.npcs.length) o.npcs = r.npcs;
    out.push(o);
  }
  return {
    id: 'slice01',
    name: 'Slice 01: Thalassa Deep',
    seed: 1337,
    playerStart: { room: 'R01', pos: [6, 0, 2.6], yaw: 0 },
    squadStart: { engineer: [-4.6, 0, 0.6], medic: [-4.6, 0, -0.6] },
    rooms: out,
    doors,
    vents,
    pickups,
    mapStations,
    checkpoints,
  };
}

SPAWN_FIELDS = await detectSpawnFields();
const level = build();
if (process.argv.includes('--check')) {
  for (const r of rooms) console.log(r.id.padEnd(5), r.name.padEnd(28), r.cells.map((c) => c.join(',')).join(' '));
} else {
  writeFileSync(OUT, `${JSON.stringify(level, null, 1)}\n`);
  const n = (k) => level.rooms.reduce((a, r) => a + (r[k]?.length ?? 0), 0);
  console.log(`wrote slice01.json: ${level.rooms.length} rooms, ${level.doors.length} doors, ${n('props')} props, ${n('anchors')} anchors, ${n('npcs')} npcs, ${n('triggers')} triggers, ${n('spawns')} spawns; spawn extras kept: ${[...SPAWN_FIELDS].join(', ') || 'none (schema has no group yet)'}`);
}
