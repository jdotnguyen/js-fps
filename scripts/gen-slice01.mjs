#!/usr/bin/env node
/**
 * Generates src/data/levels/slice01.json (ADR-0014 map as amended, intro-sequence spec, ADR-0023 hubs).
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
    /** Sunken floor below deck level (level-kit spec), and standing water (standing-water spec). */
    floorY: o.floorY,
    water: o.water,
    /** Structural pieces placed by hand on top of the generated tiles (stairs, landings). */
    extraPieces: o.extraPieces ?? [],
    area: o.area,
    hidden: o.hidden,
    atmosphere: o.atmosphere,
    floor: o.floor ?? 'floor',
    floorOverride: o.floorOverride ?? {},
    /** Floor-tile params per cell, keyed `x,z` (e.g. floor_carpet `bareEdge` / `bareWidth`). */
    floorParams: o.floorParams ?? {},
    ceiling: o.ceiling ?? 'ceiling',
    walls: o.walls ?? ['wall_panel', 'wall_plain'],
    wallOverride: {},
    /** `params.material` on every wall tile / every ceiling tile (a palette slot, e.g. "steel"). */
    wallMaterial: o.wallMaterial,
    ceilingMaterial: o.ceilingMaterial,
    /** `params.material` on every floor tile that has no per-cell `floorParams` (a palette slot, e.g. "diamondRusty"). */
    floorMaterial: o.floorMaterial,
    /** Omit ceiling light housings on unclaimed ceiling cells so inhabited rooms have no dead black fixtures. */
    noDeadFixtures: o.noDeadFixtures === true,
    props: [],
    lights: o.lights ?? [],
    triggers: [],
    spawns: [],
    anchors: [],
    npcs: [],
    walks: [],
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
  for (const k of ['unlockBy', 'task', 'unlockOn', 'access', 'params']) if (o[k] !== undefined) d[k] = o[k];
  doors.push(d);
  return { center: edgeCenter(x, z, side, 1.2) };
}

/**
 * Glass partition on `side` of a cell, owned by room `owner`; the room behind gets no wall there.
 * Both rooms draw each other (room-visibility spec): `build()` pairs the owner with whichever room owns
 * the cell behind, since that room may be declared later.
 */
function glass(owner, x, z, side) {
  byId.get(owner).wallOverride[edgeKey(x, z, side)] = 'wall_glass_partition';
  const [nx, nz] = neighbour(x, z, side);
  glassEdges.set(edgeKey(nx, nz, OPP[side]), owner);
}

/** Rooms `a` and `b` draw each other: each lists the other in `visibleFrom`. */
function seeEachOther(a, b) {
  for (const [r, o] of [[a, b], [b, a]]) {
    const room = byId.get(r);
    room.visibleFrom = [...new Set([...(room.visibleFrom ?? []), o])];
  }
}

/** An open seam between two rooms (no wall, no door); both rooms render from each other. */
const openEdges = new Set();
function opening(a, b, x, z, side) {
  const [nx, nz] = neighbour(x, z, side);
  openEdges.add(edgeKey(x, z, side));
  openEdges.add(edgeKey(nx, nz, OPP[side]));
  seeEachOther(a, b);
}

const wallKit = (r, x, z, s, kit, params) => {
  if (params) (r.wallParams ??= {})[edgeKey(x, z, s)] = params;
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

function prop(r, kit, pos, rot = 0, params, extra) {
  const p = { kit, pos: pos.map(r2) };
  if (rot) p.rot = r2(rot);
  if (params) p.params = params;
  if (extra) Object.assign(p, extra);
  r.props.push(p);
}
function wallProp(r, kit, x, z, s, along = 0, params, inset) {
  const w = onWall(x, z, s, along, inset);
  prop(r, kit, w.pos, w.rot, params);
  return w;
}
/**
 * Desk + aligned chair (+ optional seated NPC) placed from one origin so they never face backwards
 * or clip. `rot` is the desk rotation (degrees); local -Z is the sitter/keyboard side, so the chair
 * sits `chairDist` m along local -Z facing back toward the desk (`(rot + 180) % 360`).
 */
function workstation(r, pos, rot = 0, o = {}) {
  const { chairDist = 0.72, fixedChair = Boolean(o.npc), npc: who, ...deskParams } = o;
  prop(r, 'office_desk', pos, rot, deskParams);
  const rad = (rot * Math.PI) / 180;
  const seatPos = [r2(pos[0] - Math.sin(rad) * chairDist), pos[1], r2(pos[2] - Math.cos(rad) * chairDist)];
  const seatRot = (rot + 180) % 360;
  prop(r, 'chair', seatPos, seatRot, fixedChair ? { fixed: true } : undefined);
  if (who) npc(r, who.id, who.look, seatPos, who.pose ?? 'sit_typing', { yaw: seatRot, ...(who.extra ?? {}) });
  return { seatPos, seatRot };
}
function anchor(r, id, pos, yaw) {
  const a = { id, pos: pos.map(r2) };
  if (yaw !== undefined) a.yaw = r2(yaw);
  r.anchors.push(a);
  return pos;
}
/** Authored curve walk (ADR-0028): anchor ids or [x, 0, z] points. Suggest one with `npm run walks:suggest`. */
function walk(r, id, points, speed) {
  const w = { id, points: points.map((p) => (typeof p === 'string' ? p : p.map(r2))) };
  if (speed !== undefined) w.speed = speed;
  r.walks.push(w);
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
const L = (slot, pattern = 'steady', color, intensity, range, extra) => {
  const l = { slot, pattern };
  if (color) l.color = color;
  if (intensity !== undefined) l.intensity = intensity;
  if (range !== undefined) l.range = range;
  if (extra) Object.assign(l, extra);
  return l;
};

// ================================================================== the map

const QUIET_FOG = { fog: '#070b0d', fogDensity: 0.028 };

// ---------------------------------------------------------------- R01 docking ring (dock)
const DOCK_FOG = { fog: '#0a1014', fogDensity: 0.018, ambient: 'dock' };
const R01 = room('R01', 'Docking Ring', rect(0, 3, 0, 1), {
  area: 'dock',
  atmosphere: { ...DOCK_FOG, reverb: 'metal_hall', ambience: 'hull_hum' },
  ceiling: 'ceiling_pipes',
  noDeadFixtures: true,
  lights: [
    L(0, 'steady', '#cfe8ff', 13, 12, { shaft: 0.045, emissive: 2.6 }),
    L(1, 'steady', '#d8eeff', 12, 12, { shaft: 0.04, emissive: 2.6 }),
    L(3, 'steady', '#cfe8ff', 13, 12, { shaft: 0.04, emissive: 2.6 }),
    L(5, 'steady', '#ffddb3', 15, 12, { drop: 0.45, shaft: 0.025, emissive: 2.8 }),
    L(6, 'steady', '#ffe8cc', 13, 12, { shaft: 0.02, emissive: 2.5 }),
  ],
});
// The walk to the commons: its own room (culling, draw-call budget), open to the dock hall.
const R01w = room('R01w', 'Docking Ring Walk', [[4, 0], [5, 0], [6, 0], [6, 1], [6, 2]], {
  area: 'dock',
  atmosphere: { ...DOCK_FOG, reverb: 'metal_corridor', ambience: 'hull_hum' },
  ceiling: 'ceiling_pipes',
  noDeadFixtures: true,
  lights: [
    L(0, 'steady', '#d4ebff', 12, 12, { shaft: 0.035, emissive: 2.6 }),
    L(2, 'steady', '#d4ebff', 12, 12, { shaft: 0.035, emissive: 2.6 }),
    L(4, 'steady', '#ffe4c4', 13, 12, { shaft: 0.025, emissive: 2.6 }),
  ],
});
opening('R01', 'R01w', 3, 0, 'e');
for (const x of [1, 2, 3]) wallKit(R01, x, 0, 'n', 'wall_window', { flicker: true }); // the big dock window (one floodlight flickers)
for (const x of [5, 6]) wallKit(R01w, x, 0, 'n', 'wall_window'); // ocean window on the walk
wallKit(R01w, 6, 1, 'e', 'wall_window'); // courtyard window onto the seabed between the wings
const R01a = room('R01a', 'Dock Airlock', [[0, -1]], { area: 'dock', atmosphere: { ...QUIET_FOG, reverb: 'small_office' }, ceilingMaterial: 'boltPanel', walls: ['wall_plain'], lights: [L(0, 'steady', '#ffe9c8', 7)] });
wallKit(R01a, 0, -1, 'w', 'wall_vent');
// Its outer hull is visible through both runs of dock windows even with D_dock shut.
R01a.visibleFrom = ['R01', 'R01w'];
const dockDoor = door('D_dock', 'R01', 'R01a', 0, 0, 'n');
const subBerth = [2.5, 0.4, -9];
prop(R01, 'supply_sub', subBerth, 0, { state: 'away', dockTime: 10 });
// Jay's security post (dock-checkpoint spec): a corner counter booth facing the dock window, closed on the arrivals
// side and open to the east, a desk under a wall of camera feeds, and the detector line from the counter's east end
// to the window. With the gate shut, the arch is the only way from the dock side to the station side.
prop(R01, 'half_wall', [5.9, 0, 1.8], 0, { width: 3.0, height: 1.08, material: 'cleanTeal' });
prop(R01, 'half_wall', [4.5, 0, 3.775], 90, { width: 4.15, height: 1.08, material: 'cleanTeal' });
prop(R01, 'mug', [6.75, 1.08, 1.86], 0, { color: 'teal' });
// The CCTV bank sits between the south wall's pilasters at x 6.0 and 7.9 (wall-mounted props stay clear of wall structure).
const R01_DESK = [6.95, 0, 5.1];
const R01_CHAIR_START = [5.45, 0, 4.55];
const R01_CHAIR_START_ROT = 150;
const R01_WAND_SPOT = [7.02, 0.775, 5.14];
const R01_WAND_ROT = 108;
const R01_GUARD_SEAT = [6.45, 0, 4.38]; // aligned with the left keyboard (x = 6.45, chairDist = 0.72), facing the CCTV wall
prop(R01, 'office_desk', R01_DESK, 0, { width: 1.8, monitor: false, keyboards: 2, papers: 2, top: 'panel' });
prop(R01, 'cctv_wall', [6.95, 0, 5.69], 0, { id: 'dock_post', camera: 'CAM 02  DOCK AIRLOCK', width: 1.84 });
prop(R01, 'chair', R01_CHAIR_START, R01_CHAIR_START_ROT, { id: 'dock_chair', fixed: true }); // pushed aside: Jay leans on the desk; guard pulls it up after arrivals
prop(R01, 'desk_wand', R01_WAND_SPOT, R01_WAND_ROT, { id: 'dock_wand', hidden: true });
// Detector line at x = 7.675: arch (1.2 m clear, z 0.57..1.77; the navmesh needs more than 1.1 m) against the counter,
// then rail, the fixed staff gate, rail to the window.
const ARCH = [7.675, 0, 1.17];
prop(R01, 'metal_detector', ARCH, 90, { id: 'dock_arch', opening: 1.2 });
prop(R01, 'rail', [7.675, 0, 0.26], 90, { length: 0.3 });
prop(R01, 'staff_gate', [7.675, 0, -0.49], 90, { width: 1.2 });
prop(R01, 'rail', [7.675, 0, -1.48], 90, { length: 0.76 });
prop(R01, 'tray_table', [7.0, 0, 0.12], 90);
wallProp(R01, 'tag_poster', 0, 1, 's', -0.9, { slogan: 'WELCOME TO THALASSA' });
wallProp(R01, 'notice_board', 1, 1, 's', 1.1, { text: 'SHIFT ROSTER', detail: '06:40 CHANGEOVER' });
prop(R01, 'crate', [-1.2, 0, 4.4], 0, { size: 0.7 });
prop(R01, 'vending_machine', [10.6, 0, 5.35]);
prop(R01, 'potted_plant', [11.6, 0, 5.3], 0, { kind: 'palm', pot: 'dark' });
prop(R01, 'crate_stack', [12.9, 0, 5.2], 15);
prop(R01, 'potted_plant', [13.2, 0, 3.2], 0, { kind: 'palm', pot: 'dark' });
prop(R01w, 'pipe_run', [18, 0, 1.4], 0, { length: 7, height: 0.35, paint: 'teal' });
prop(R01, 'cable_bundle', [8, 0, 5.6], 0, { length: 12, height: 2.9 });
prop(R01, 'locker', [-1.45, 0, 3.0], 270, { count: 2, label: 'DOCK SEC' });
prop(R01a, 'locker', [0, 0, -5.5], 180, { count: 2, label: 'EVA' });
// Jay's post: leaning back against the security desk at the rear of the booth, facing between the dock
// door (front left, ~45 deg) and the guard past the arch (front right, ~45 deg), so everyone coming through is in view.
const POST = [6.95, 0, 4.3];
anchor(R01, 'post_front', POST, 2);
anchor(R01, 'dock_window', [5.8, 1.5, -2.2]);
anchor(R01, 'dock_door', dockDoor.center);
// The checkpoint: badge in at the counter in front of Jay (the next arrival queues behind), through the arch, stop
// past it in front of the guard. Okafor and Giles then wait on the station side by the booth's open side.
anchor(R01, 'walkby_stop', [6, 0, 1.15], 180);
anchor(R01, 'walkby_queue', [4.7, 0, 0.45], face([4.7, 0, 0.45], [6, 0, 1.15]));
anchor(R01, 'arch', [ARCH[0], 1.6, ARCH[2]]);
const GUARD = [9.75, 0, 1.25]; // 1.15 m past the scan spot: face to face, arms-out room, no bumping
anchor(R01, 'arch_scan', [8.6, 0, 1.25], face([8.6, 0, 1.25], GUARD));
anchor(R01, 'guard_post', GUARD, face(GUARD, [8.6, 0, 1.25]));
// Past the guard, on the north lane, before heading on to the Commons (`checkpoint_exit` swings round him).
anchor(R01, 'arch_exit', [10.6, 0, -0.3], 270);
walk(R01, 'checkpoint_exit', ['arch_scan', [9.0, 0, 0.35], 'arch_exit']);
// The dock guard (dock-checkpoint spec): on his post past the arch, facing it, wand in hand. The only guard1 body in the slice.
npc(R01, 'dock_guard', 'security', 'guard_post', 'idle_wand', { model: 'guard1' });
// Guard's return to the security desk (dock-guard-routine): approach clearing the counter, Jay and squad,
// wand placement on the desk, grip position beside the loose chair, and final seated spot facing the keyboard.
anchor(R01, 'guard_desk_approach', [7.02, 0, 4.32], 180);
anchor(R01, 'guard_wand_spot', R01_WAND_SPOT, R01_WAND_ROT);
anchor(R01, 'guard_chair_grip', [5.8, 0, 3.88], face([5.8, 0, 3.88], R01_CHAIR_START));
anchor(R01, 'guard_seat', R01_GUARD_SEAT, 180);
walk(R01, 'guard_return_desk', ['guard_post', [8.6, 0, 1.85], [7.75, 0, 2.25], [6.95, 0, 2.75], [6.75, 0, 3.5], 'guard_desk_approach']);
anchor(R01, 'post_okafor', [8.2, 0, 2.9], face([8.2, 0, 2.9], POST));
anchor(R01, 'post_giles', [9.6, 0, 3.4], face([9.6, 0, 3.4], POST));
anchor(R01, 'walk_mid', [14, 0, 0.6], 270);
// Intro walks (ADR-0028, `npm run walks:suggest`): one at a time from the airlock to the counter (the next arrival
// waits in the queue spot), then from the station side to the kitchen. The guard stands at GUARD, so the kitchen
// walks leave along the south lane, Jay behind the squad.
walk(R01, 'intro_jay_kitchen', ['post_front', [7.85, 0, 3.5], [10.8, 0, 2.7], [14.3, 0, 0], [22.1, 0, 0.3], [23.4, 0, 2], [24, 0, 10.5], 'kitchen_stand']);
walk(R01, 'intro_okafor_arrive', ['okafor_start', [0.35, 0, -0.95], 'walkby_stop']);
walk(R01, 'intro_giles_arrive', ['giles_start', [0.05, 0, -2.85], [0.25, 0, -1.05], 'walkby_queue']);
// ADR-0029 kitchen beat: in through the north door, round Bram at the coffee machine, then along the counter and settle back against it.
walk(R01, 'intro_okafor_counter', ['post_okafor', [10.6, 0, 2.5], [14.2, 0, 0.05], [21.6, 0, 0.05], [22.9, 0, 1.05], [24, 0, 3.25], [24.2, 0, 10.85], [25.8, 0, 11.95], [27, 0, 11.95], 'counter_okafor']);
walk(R01, 'intro_giles_counter', ['post_giles', [14.5, 0, -0.75], [20.5, 0, -0.75], [22, 0, 0.15], [23.4, 0, 2.05], [24.2, 0, 10.85], [26, 0, 12.2], [27.7, 0, 12.35], [28.45, 0, 11.85], 'counter_giles']);
anchor(R01w, 'walk_window', [20, 0, -0.4], 0);
// Separate spots at the window so the two NPCs and Jay stand side by side (~0.9 m apart); Jay is on the west so his walk in does not cross them.
anchor(R01w, 'window_jay', [18.9, 0, -0.9], 0);
anchor(R01w, 'window_giles', [19.8, 0, -0.9], 0);
anchor(R01w, 'window_okafor', [20.7, 0, -0.9], 0);
anchor(R01w, 'abyss_window_walk', [21, 1.7, -2.4]);
anchor(R01, 'sub_dock', subBerth);
anchor(R01a, 'giles_start', [0.65, 0, -4.55], 180);
anchor(R01a, 'okafor_start', [-0.65, 0, -4.55], 180);
anchor(R01a, 'ruiz_start', [0.75, 0, -3.25], 180);
anchor(R01a, 'sung_start', [-0.75, 0, -3.25], 180);
npc(R01a, 'giles', 'giles', 'giles_start');
npc(R01a, 'okafor', 'okafor', 'okafor_start');
npc(R01a, 'ruiz', 'ruiz', 'ruiz_start');
npc(R01a, 'sung', 'sung', 'sung_start');
// dock-checkpoint free play: walking through the arch (either way) after the intro. dock_checkpoint.json reacts.
trigger(R01, 'trig_dock_arch', [[7.42, 0, 0.6], [7.93, 2.2, 1.74]], 'trigger:dock_arch', { once: false });
trigger(R01w, 'trig_walk_window', cellBox(5, 5, 0, 0), 'trigger:walk_window', { once: false });

// ---------------------------------------------------------------- R02 commons + kitchen (commons)
// The cafeteria lounge. Inner faces x 14.25..33.75, z 10.25..25.75, 4 m ceiling. Zones:
//   NE galley: back counter (coffee, radio) + servery hot line, menu board above; staff passage
//      down the east wall from the TAG reception glass door.
//   NW self-serve wall: drinks, the quarantine notice, bins; one table.
//   Centre: dining tables under pendant lamps, either side of a straight N-S aisle (x 23..25)
//      between the dock door and the dive-bay door. Kept clear: the gallery lane (z 15..17, west),
//      the hydroponics lane (z 19..21, east), the servery queue (z 14.4..15.6).
//   South wall: windows onto the abyss (the accent wall, facing the entry). SW: a window bar with
//      stools. SE: a rug lounge behind a planter, sofas facing the window, the TV on the east wall.
const R02 = room('R02', 'Commons', rect(4, 8, 3, 6), {
  area: 'commons',
  height: 4,
  atmosphere: { fog: '#121312', fogDensity: 0.012, ambient: 'commons', reverb: 'metal_hall', ambience: 'commons_murmur' },
  floorOverride: { '7,3': 'floor_tiles', '8,3': 'floor_tiles' },
  noDeadFixtures: true,
  // Ceiling slots follow the cell order (z rows of x 4..8): entry/drinks 1, galley 3-4, dining 6/8/10, bar 16, lounge 18.
  lights: [
    L(1, 'steady', '#fff0da', 16, 14, { drop: 0.4, shaft: 0.015, emissive: 2.6 }),
    L(3, 'steady', '#fff4e4', 18, 13, { drop: 0.35, shaft: 0.01, emissive: 2.8 }),
    L(4, 'steady', '#ffe4bd', 16, 12, { drop: 0.55, shaft: 0.01, emissive: 2.6 }),
    L(6, 'steady', '#ffe0b2', 17, 13, { drop: 1.25, shaft: 0.012, emissive: 2.2 }),
    L(8, 'steady', '#ffe2b8', 17, 13, { drop: 1.25, shaft: 0.012, emissive: 2.2 }),
    L(10, 'steady', '#ffe4bc', 15, 13, { drop: 1.0, shaft: 0.01, emissive: 2.2 }),
    L(16, 'steady', '#ffd096', 15, 12, { drop: 1.35, shaft: 0.01, emissive: 2.0 }),
    L(18, 'steady', '#ffcca0', 16, 13, { drop: 1.1, shaft: 0.01, emissive: 2.2 }),
  ],
});
for (const x of [7, 8]) wallKit(R02, x, 3, 'n', 'wall_tiles');
for (const x of [4, 5, 7, 8]) wallKit(R02, x, 6, 's', 'wall_sanity_screen'); // sanity screens behind the bar and the lounge (exterior-ocean)
door('D_R01_R02', 'R02', 'R01w', 6, 3, 'n');
const R02_CEIL = 4;
const R02_N = cx(3) - WALL_FACE; // north wall inner face (z 10.25)
// Galley: back counter against the north wall (coffee, radio: intro beats), servery 2.4 m in front of it.
const counterZ = cx(3) - WALL_FACE + 0.34;
prop(R02, 'kitchen_counter', [29.2, 0, counterZ], 180, { width: 6.4, sink: true });
prop(R02, 'coffee_machine', [26.8, 0.92, counterZ - 0.02], 180);
prop(R02, 'tray', [29.0, 0.92, counterZ + 0.05], 180, { mugs: 3 });
prop(R02, 'radio', [31.6, 0.92, counterZ + 0.1], 200);
prop(R02, 'mug', [27.6, 0.92, counterZ - 0.12], 0, { color: 'teal' });
prop(R02, 'servery', [30.3, 0, 13.7], 180, { width: 3.8, pans: 5 });
wallProp(R02, 'menu_board', 7, 3, 'n', 1.2, { width: 3.6, height: 1.0, y: 3.0, title: 'GALLEY' });
wallProp(R02, 'wall_clock', 8, 3, 'n', 0.9, { y: 2.95 });
// Self-serve wall (NW): drinks, the quarantine notice (in the west bay of the panel tile, clear of
// its mid rib at x 20; its trigger sits at x 19.05), bins by the entry.
prop(R02, 'drink_station', [16.3, 0, R02_N + 0.33], 180, { width: 1.8 });
wallProp(R02, 'notice_board', 5, 3, 'n', -0.95, { text: 'QUARANTINE NOTICE', detail: 'LAB B - ROUTINE' });
prop(R02, 'bin_station', [21.45, 0, R02_N + 0.3], 180, { count: 2 });
wallProp(R02, 'tag_poster', 4, 3, 'w', -0.6, { slogan: 'DEEPER. FURTHER. TOGETHER.' });
wallProp(R02, 'tag_poster', 8, 4, 'e', 0, { slogan: 'SAFETY IS A SHIFT, NOT A DAY.' });
// Dining: 2.2 m six-seat tables (2.0 m deep with chairs), each under a pair of pendants.
const R02_TABLES = [
  [16.6, 13.0, 2],
  [17.2, 18.6, 1],
  [20.9, 18.6, 2],
  [17.2, 21.8, 0],
  [20.9, 21.8, 1],
  [27.0, 16.9, 1],
  [30.9, 16.9, 2],
];
for (const [x, z, mugs] of R02_TABLES) {
  prop(R02, 'dining_table', [x, 0, z], 0, { width: 2.2, seats: 6, mugs, caddy: true });
  prop(R02, 'pendant_light', [x, 0, z], 0, { ceiling: R02_CEIL, drop: 1.7, count: 2, spacing: 1.1 });
}
prop(R02, 'vending_machine', [14.67, 0, 19.7], 270);
// SW window bar: a high ledge in front of the glass, stools facing out.
prop(R02, 'bar_counter', [18.3, 0, 25.32], 0, { width: 4.6, stools: 6, mugs: 2 });
prop(R02, 'pendant_light', [18.3, 0, 25.1], 0, { ceiling: R02_CEIL, drop: 1.75, count: 4, spacing: 1.15, shade: 'dark' });
// SE lounge: planter edge, rug, a sofa and two armchairs facing the window, the TV on the east wall.
prop(R02, 'planter', [28.6, 0, 21.35], 0, { width: 4.4 });
prop(R02, 'rug', [29.6, 0, 23.75], 0, { width: 5.2, depth: 3.2, tone: 'teal' });
prop(R02, 'sofa', [29.6, 0, 22.6], 180, { width: 2.6, tone: 'warm' });
prop(R02, 'coffee_table', [29.6, 0, 23.9], 0, { width: 1.4, depth: 0.7 });
prop(R02, 'mug', [29.3, 0.44, 23.8], 0, { color: 'red' });
prop(R02, 'sofa', [27.5, 0, 24.1], 225, { width: 1.0 });
prop(R02, 'sofa', [31.7, 0, 24.1], 135, { width: 1.0 });
wallProp(R02, 'wall_screen', 8, 6, 'e', -0.4, { id: 'commons_tv', width: 2.2, channel: 'commons', state: 'on' });
// Greens: corner pots, hanging baskets by the windows.
for (const [x, z, kind] of [[14.8, 10.8, 'palm'], [14.9, 25.2, 'tall'], [21.2, 25.25, 'shrub'], [33.2, 25.2, 'fern']]) prop(R02, 'potted_plant', [x, 0, z], 0, { kind, pot: 'white' });
prop(R02, 'hanging_plant', [26.2, 0, 24.9], 0, { ceiling: R02_CEIL, drop: 1.1 });
prop(R02, 'hanging_plant', [32.9, 0, 22.4], 0, { ceiling: R02_CEIL, drop: 1.0 });
station(R02, 'commons_map', 'commons', 4, 6, 'w');
anchor(R02, 'kitchen_door', [24, 1.2, 10]);
anchor(R02, 'counter', [29.2, 0.95, counterZ]);
anchor(R02, 'coffee_machine', [26.8, 1.2, counterZ]);
anchor(R02, 'radio', [31.6, 1.05, counterZ + 0.1]);
anchor(R02, 'cook_stand', [30.6, 0, 11.7], 0);
// Backs against the counter (front edge z 10.91; feet 0.36 m out for lean_back), turned a little toward each other.
anchor(R02, 'counter_okafor', [27.65, 0, 11.27], 200);
anchor(R02, 'counter_giles', [28.65, 0, 11.27], 160);
// Bram at the coffee machine: he turns to hand Okafor his mug, then goes round to Giles's far (east) side, so Jay
// (kitchen_stand) sees the hand-off side-on instead of Bram's back, and from there on to his station.
anchor(R02, 'cook_coffee', [26.75, 0, 11.32], 0);
anchor(R02, 'cook_turn_okafor', [26.75, 0, 11.32], 270);
anchor(R02, 'cook_serve_giles', [29.3, 0, 11.85], face([29.3, 0, 11.85], [28.65, 0, 11.27]));
walk(R02, 'cook_to_giles', ['cook_turn_okafor', [27.45, 0, 11.98], [28.65, 0, 12.02], 'cook_serve_giles']);
anchor(R02, 'kitchen_stand', [25.6, 0, 13.4], face([25.6, 0, 13.4], [28, 0, 11.5]));
anchor(R02, 'priya_enter', [24, 0, 24.6], 0);
anchor(R02, 'priya_stand', [27.4, 0, 13.6], face([27.4, 0, 13.6], [25.6, 0, 13.4]));
anchor(R02, 'priya_offer', [26.5, 0, 13.0], face([26.5, 0, 13], [25.6, 0, 13.4]));
anchor(R02, 'priya_chair', [26.1, 0, 18.6], 0); // a standing spot beside the east tables (crew_1 moves here)
anchor(R02, 'gallery_door', [14, 1.2, 16]);
anchor(R02, 'cp_intro', [25.6, 0, 13.4], face([25.6, 0, 13.4], [28, 0, 11.5]));
anchor(R02, 'commons_tv', [33.6, 1.75, 23.6]);
anchor(R02, 'dawdle_call', [16.2, 0, 15.2], 270);
// Ruiz and Sung's background spots after the dock walk-by: floor cells west of the door (24,10), >= 2.5 m from it, clear of Jay's door-to-kitchen_stand line and of the cast.
anchor(R02, 'crew_ruiz_commons', [19.6, 0, 12.0], face([19.6, 0, 12], [21.6, 0, 12.6]));
anchor(R02, 'crew_sung_commons', [21.6, 0, 12.6], face([21.6, 0, 12.6], [19.6, 0, 12]));
npc(R02, 'cook', 'cook', 'cook_stand', 'idle');
npc(R02, 'crew_1', 'crew', [19.4, 0, 15.6], 'idle_mug', { model: 'scientist1' });
// ADR-0029 ambient life: most of the room sits, a few talk, one leans. `spot` takes the nearest free seat of that kind
// to `at` (seats come from the tables, the bar and the sofas); `chat` groups talk to each other. Lanes stay clear.
// `model` spreads the imported crew bodies so nobody sits beside their twin (and no named character's body is reused).
npc(R02, 'crew_2', 'lab', [18.7, 0, 24.8], undefined, { spot: 'sit_stool', chat: 'commons_bar', model: 'scientist1' }); // at the window bar
npc(R02, 'bar_1', 'crew', [19.4, 0, 24.8], undefined, { spot: 'sit_stool', chat: 'commons_bar', model: 'office2' });
npc(R02, 'crew_3', 'maintenance', [29.9, 0, 22.6], undefined, { spot: 'sit_sofa', model: 'office1' }); // on the lounge sofa, watching the abyss
npc(R02, 'diner_1', 'crew', [20.1, 0, 17.8], undefined, { spot: 'sit_chair', chat: 'commons_t17', model: 'botanist2' });
npc(R02, 'diner_3', 'crew', [20.9, 0, 19.4], undefined, { spot: 'sit_chair', chat: 'commons_t17', model: 'assistant' });
npc(R02, 'diner_7', 'crew', [21.7, 0, 17.8], undefined, { spot: 'sit_chair', chat: 'commons_t17', model: 'office1' });
npc(R02, 'diner_6', 'crew', [16.5, 0, 22.6], undefined, { spot: 'sit_chair', chat: 'commons_t19', model: 'botanist3' });
npc(R02, 'diner_2', 'lab', [17.2, 0, 21.0], undefined, { spot: 'sit_chair', chat: 'commons_t19', model: 'office3' });
npc(R02, 'tea_1', 'lab', [30.9, 0, 17.7], undefined, { spot: 'sit_chair', model: 'botanist1' }); // alone with a mug at the east table
npc(R02, 'wall_1', 'crew', [14.7, 0, 22.6], undefined, { spot: 'lean_wall', yaw: 270, chat: 'commons_wall', model: 'office3' }); // back to the west wall; not guard1, that body is the dock guard's
npc(R02, 'chat_5', 'engineer', [15.55, 0, 22.75], 'idle', { yaw: 90, chat: 'commons_wall', model: 'botanist1' });
trigger(R02, 'trig_commons_enter', cellBox(6, 6, 3, 3), 'trigger:commons_enter', { once: false });
trigger(R02, 'trig_commons_to_gallery', cellBox(4, 4, 4, 4), 'trigger:commons_to_gallery', { once: false });
trigger(R02, 'trig_commons_radio', around([31.6, 0, counterZ - 0.4], 0.6, 1.6), 'commons:radio', { on: 'use', prompt: 'Listen', once: false });
trigger(R02, 'trig_commons_coffee', around([26.8, 0, counterZ - 0.4], 0.5, 1.6), 'commons:coffee', { on: 'use', prompt: 'Pour coffee', once: false });
trigger(R02, 'trig_commons_notice', around([19.05, 0, 10.6], 0.8, 2.2), 'commons:notice', { on: 'use', prompt: 'Read notice', once: false });

// ---------------------------------------------------------------- R03 observation gallery, R04 Lab B
const R03 = room('R03', 'Observation Gallery', rect(1, 3, 4, 5), {
  area: 'gallery',
  height: 3.6,
  atmosphere: { fog: '#06090b', fogDensity: 0.03, reverb: 'metal_hall', ambience: 'hull_hum', ambient: 'gallery' },
  floor: 'floor_carpet',
  // 1 m of bare brushed metal along the Lab B glass (1.25 from the cell edge; the partition takes 0.25).
  floorParams: Object.fromEntries([1, 2, 3].map((x) => [`${x},5`, { bareEdge: 's', bareWidth: 1.25 }])),
  // Every fixture casts real light (render-lighting spec, fidelity-first-rendering): 9 pooled lights, which with
  // Lab B's 3 through the glass fit every tier's pool (12 on Low). The ceilings over the team (1) and over Heins (4)
  // and the two low warm lamps (6 west, 7 east) carry the room and cast shadows; the corner ceilings stay dimmer so
  // the gallery keeps its mood. The lamp bulbs (20) are bright enough that their pools, and the sofa's and table's
  // shadows in them, read on the dark carpet. Slots: ceilings 0-5 in cell order, then the pendant_light bulbs
  // in prop order (6, 7, 8).
  lights: [
    ...[0, 2, 3, 5].map((i) => L(i, 'steady', '#eef1f4', 3, 6)),
    L(1, 'steady', '#eef1f4', 5, 8, { shadow: true }),
    L(4, 'steady', '#eef1f4', 5, 8, { shadow: true }),
    L(6, 'steady', '#ffcf99', 20, 6, { shadow: true }),
    L(7, 'steady', '#ffcf99', 20, 6, { shadow: true }),
    L(8, 'steady', '#ffcf99', 20, 6),
  ],
});
const R04 = room('R04', 'Lab B', rect(1, 3, 6, 7), {
  area: 'labs',
  height: 3.6,
  atmosphere: { fog: '#05080a', fogDensity: 0.02, reverb: 'small_office', ambience: 'lab_hum' },
  floor: 'floor_tiles',
  walls: ['wall_tiles', 'wall_panel'],
  lights: [L(0, 'steady', '#e8f4ff', 9), L(2, 'steady', '#e8f4ff', 9), L(4, 'flicker', '#e8f4ff', 7)],
});
for (const x of [1, 2, 3]) glass('R03', x, 5, 's');
// Plain wall behind the briefing screen: a panel tile's mid-bay rib would cross it (level-kit clearance test).
wallKit(R03, 2, 4, 'n', 'wall_plain');
door('D_R02_R03', 'R02', 'R03', 4, 4, 'w');
door('D_R03_R05', 'R03', 'R05', 1, 4, 'w', { state: 'locked', unlockBy: 'script', unlockOn: 'drop:done' });
door('D_R04_R05', 'R04', 'R05', 1, 6, 'w', { kit: 'bulkhead', state: 'closed', access: { sealed: true, text: 'lockdown' } });
wallProp(R03, 'wall_screen', 2, 4, 'n', 0, { id: 'brief_screen', channel: 'briefing', width: 2.8, y: 1.85 });
// Crack overlays on the gallery side of the three panes (`glass` action, id "labb").
for (const [i, x] of [1, 2, 3].entries()) wallProp(R03, 'glass_cracks', x, 5, 's', 0, { id: 'labb', seed: i + 1 }, 0.02);
for (const x of [1, 2, 3]) prop(R04, 'blinds', [cx(x), 0, cx(5) + 2 + 0.32], 0, { id: 'labb', width: 3.8, height: 2.25, top: 2.6, state: 'down' });
// Gallery layout (openspec refresh-observation-gallery): a clear lane door to door along the back wall (z 14.8..17.6),
// a clear stage between the team and Heins (x 5.4..10.6, z 17 to the strip), furniture only in the glass corners.
// Back wall: coffee credenza (west), clock over the screen, a TAG poster (east).
prop(R03, 'credenza', [4.2, 0, 14.53], 180, { width: 2 });
wallProp(R03, 'wall_clock', 2, 4, 'n', 0, { y: 3.05 });
wallProp(R03, 'tag_poster', 3, 4, 'n', -0.2, { slogan: 'OBSERVE. RECORD. REPORT.' });
// West glass corner: the observation station facing Lab B, its chair, a notice, a fern.
prop(R03, 'console', [3.9, 0, 20.75], 0, { screen: 'status' });
prop(R03, 'chair', [3.9, 0, 19.75], 180, { fixed: true });
wallProp(R03, 'notice_board', 1, 5, 'w', 0.4, { text: 'OBSERVATION GALLERY', detail: 'DO NOT TAP THE GLASS' });
prop(R03, 'potted_plant', [2.65, 0, 21.35], 0, { kind: 'fern' });
// East glass corner: the sofa facing the glass, a coffee table, the tall plant.
prop(R03, 'sofa', [12, 0, 18.7], 180, { width: 2 });
prop(R03, 'coffee_table', [12, 0, 19.9], 0, { width: 1.2, depth: 0.6 });
prop(R03, 'potted_plant', [13.35, 0, 21.3], 0, { kind: 'tall', pot: 'white' });
// Low warm lamps (real light slots, claimed above): one over the observation station, a pair over the coffee table.
prop(R03, 'pendant_light', [3.9, 0, 20.35], 0, { drop: 1.55, slots: true });
prop(R03, 'pendant_light', [12, 0, 19.9], 0, { drop: 1.55, count: 2, spacing: 0.9, slots: true });
// Lab B (rebuild-lab-wing D4): Voss's culture lab, composed for the gallery glass. Voss's spot (labb_victim), her benches,
// the gurney, chair and desk console stay where voss-burst-death expects them; the culture column takes the specimen
// tank's place behind her; the rest of the equipment stands against the east and south walls, out of the glass sight lines.
prop(R04, 'lab_bench', [5.5, 0, 26.8], 90, { width: 3 });
prop(R04, 'lab_bench', [12.2, 0, 29.4], 0, { width: 3 });
prop(R04, 'culture_column', [9.5, 0, 28.6]);
prop(R04, 'gurney', [8, 0, 25.2], 90);
prop(R04, 'console', [12.8, 0, 25.6], 270, { screen: 'log' });
prop(R04, 'chair', [7.4, 0, 27.2]);
prop(R04, 'sign_danger', [2.25, 0, 25.66], 270); // beside the Lab B bulkhead (slice01.test: sign_danger)
prop(R04, 'lab_cabinet', [4.0, 0, 29.48]); // imported (import-lab-props): glass doors closed, back on the south wall
prop(R04, 'freezer_ultra', [6.6, 0, 29.75]);
wallProp(R04, 'biosafety_cabinet', 3, 7, 'e', -0.1, undefined, 0);
wallProp(R04, 'incubator_stack', 3, 6, 'e', -1.0, undefined, 0);
wallProp(R04, 'pressure_gauge', 1, 6, 'w', 1.45, { y: 1.7 });
// The service wall: the warped access panel on the coolant line, where Giles cut his arm (the tag lands here later).
// A plain service wall behind it: a panel tile's mid-bay rib would cross the panel (level-kit clearance test).
wallKit(R04, 1, 7, 'w', 'wall_plain');
wallProp(R04, 'service_panel', 1, 7, 'w', 0, { y: 1.25 });
anchor(R03, 'brief_screen', [8, 1.85, 14.4]);
anchor(R03, 'labb_blinds', [8, 1.5, 22.3]);
anchor(R03, 'labb_glass', [8, 1.5, 21.8]);
anchor(R03, 'brief_jay', [8, 0, 17.4], 180);
anchor(R03, 'brief_giles', [6.4, 0, 17.8], 160);
anchor(R03, 'brief_okafor', [9.7, 0, 17.8], 200);
anchor(R03, 'brief_sung', [5.2, 0, 18.8], 135);
anchor(R03, 'brief_heins', [8, 0, 20.4], 0);
anchor(R03, 'gallery_enter', [13, 0, 16], 90);
anchor(R03, 'drop_jay', [8, 0, 19.6], 180);
anchor(R03, 'cp_briefing', [8, 0, 17.4], 180);
// After the coffee hand-off Priya leaves for the medical bay by the gallery, the way to it, and is taken off-stage
// from here once Jay can't see her (intro-sequence spec "She walks out"). Clear of the doors and the briefing spots.
anchor(R03, 'priya_walkout', [5.6, 0, 15.4], face([5.6, 0, 15.4], [2, 0, 16]));
anchor(R04, 'labb_victim', [8, 0, 26.5], 0);
npc(R03, 'heins', 'heins', 'brief_heins', 'idle_crossed');
npc(R04, 'researcher_b', 'voss', 'labb_victim', 'typing', { transformable: true }); // Dr. Voss: transforms in the drop (ADR-0023)
trigger(R03, 'trig_gallery_enter', cellBox(1, 3, 4, 5), 'trigger:gallery_enter', { once: false });
trigger(R03, 'trig_gallery_brief', [[2.3, 0, 14.3], [11.8, 2.6, 21.7]], 'trigger:gallery_brief_spot', { once: false });

// ---------------------------------------------------------------- R05 lab junction, R06 pressure door hall (labs)
// rebuild-lab-wing: the wing is in lockdown when the player first enters it (after the drop). Red alarm light, with one
// steady white work light over each fight's focus so enemies stay readable; the other fixtures glow red without
// taking a pooled light. Ceiling slots run in cell order: R05 (-1,4)(0,4)(-1,5)(0,5)(-1,6)(0,6), R06 the same from z 7.
const ACTION_FOG = { fog: '#0a0607', fogDensity: 0.025 };
const LOCKDOWN = '#ff2a1c';
const LAB_WORK = '#eef2f4';
const redGlow = (slot) => L(slot, 'alarm', LOCKDOWN, undefined, undefined, { pool: false });
const R05 = room('R05', 'Lab Junction', rect(-1, 0, 4, 6), {
  area: 'labs',
  atmosphere: { ...ACTION_FOG, reverb: 'metal_corridor', ambience: 'hull_groan' },
  ceiling: 'ceiling_pipes',
  // Work light over the middle of the junction (slot 3, cell 0,5); red alarms at both ends.
  lights: [L(0, 'alarm', LOCKDOWN, 6), L(3, 'steady', LAB_WORK, 8), L(4, 'alarm', LOCKDOWN, 6), redGlow(1), redGlow(2), redGlow(5)],
});
wallKit(R05, -1, 5, 'w', 'wall_vent');
const R06 = room('R06', 'Pressure Door Hall', rect(-1, 0, 7, 9), {
  area: 'labs',
  height: 4,
  atmosphere: { ...ACTION_FOG, reverb: 'metal_hall', ambience: 'hull_groan' },
  ceiling: 'ceiling_pipes',
  // Work light over Giles's panel cell (slot 4, cell -1,9); red alarms at the north end and by the hold point.
  lights: [L(0, 'alarm', LOCKDOWN, 7), L(3, 'alarm', LOCKDOWN, 6), L(4, 'steady', LAB_WORK, 9), redGlow(1), redGlow(2), redGlow(5)],
});

// R05 (rebuild-lab-wing D5): the lab wing's decon junction, an hour after the evacuation. Cover against the walls and
// corners; the middle stays open so the three sources read: the Lab B bulkhead (east), the west vent, the floor drain.
door('D_R05_R06', 'R05', 'R06', 0, 6, 's');
door('D_R06_R07', 'R06', 'R07', 0, 9, 's', { kit: 'bulkhead', state: 'locked', unlockBy: 'engineer', task: 'bypass_short' });
prop(R05, 'emergency_shower', [-5.15, 0, 14.85]);
for (const [i, x] of [-3.0, -2.38, -1.76].entries()) prop(R05, 'ppe_locker', [x, 0, 14.25], 180, i === 1 ? { open: true } : undefined);
wallKit(R05, 0, 4, 'n', 'wall_plain'); // plain behind the directory (level-kit clearance test)
wallProp(R05, 'directory_sign', 0, 4, 'n', 0.7, { y: 1.8 });
prop(R05, 'hazmat_rack', [-5.75, 0, 21.2], 270, { count: 3 });
prop(R05, 'sample_cart', [-5.3, 0, 18.0], 90); // upright, against the west wall; the R05 ammo sits on it
prop(R05, 'sample_cart', [-1.4, 0, 20.6], 30, { tipped: true });
prop(R05, 'floor_drain', [-4.6, 0, 24.6]);
prop(R05, 'console', [1.2, 0, 19.4], 270, { screen: 'log' });
prop(R05, 'emergency_beacon', [-5.7, 2.6, 20], 0, { wall: true });
prop(R05, 'cable_bundle', [-2, 0, 18], 90, { length: 10, height: 2.9 });
anchor(R05, 'r05_entry', [-1.6, 0, 16.2], 180);
anchor(R05, 'ammo_r05', [-5.3, 0.84, 18.0]);

// R06 (rebuild-lab-wing D6): a compartment boundary, built around the cover-me fight. Giles works the bypass panel on the
// coolant line beside the south bulkhead, back to the hall; four sources: the ruptured duct (bloom), the service trench,
// the east vent near him, and the corridor behind. Cover: pump skid (1.2 m), cylinder cage (1.4 m), switchgear (2.1 m),
// and the cable drum (1.0 m), a deliberate perch far from Giles.
wallKit(R06, 0, 9, 'e', 'wall_vent');
prop(R06, 'pump_skid', [-3.9, 0, 32.6], 90);
prop(R06, 'cylinder_cage', [1.45, 0, 27.6], 90);
for (const z of [27.15, 27.6, 28.05]) prop(R06, 'gas_cylinder', [1.45, 0.04, z], Math.round(z * 97) % 360, { solid: false }); // the cage collides
prop(R06, 'electrical_box_02', [1.25, 0, 31.6]); // switchgear, its door swung open toward the hall
prop(R06, 'cable_drum', [-5.0, 0, 27.4]);
prop(R06, 'trench_grate', [-5.15, 0, 35.4], 90, { length: 2.4 });
prop(R06, 'ruptured_duct', [-3.4, 0, 30.3], 0, { length: 4, y: 3.3 });
prop(R06, 'emergency_beacon', [1.7, 2.8, 36], 270, { wall: true });
prop(R06, 'emergency_beacon', [-5.7, 2.8, 30], 90, { wall: true });
prop(R06, 'sign_danger', [-1.66, 0, 26.25], 180); // beside the doors in and out of the hall
prop(R06, 'sign_danger', [-1.66, 0, 37.75], 0);
// The bulkhead: dogging wheel, pressure manifold, status board (green when Giles's bypass opens it); his panel.
wallProp(R06, 'bulkhead_wheel', 0, 9, 's', -1.4, { y: 1.3 });
wallProp(R06, 'pressure_manifold', -1, 9, 's', 0.2, { y: 1.15 });
wallProp(R06, 'status_board', 0, 9, 's', 0, { y: 3.0, door: 'D_R06_R07' });
prop(R06, 'power_box', [-2.6, 1.1, 37.5]); // imported (import-lab-props): Giles's bypass panel, door open
// Giles's bypass panel (the imported power box) on the coolant line, on the south wall west of the bulkhead (rebuild-lab-wing D6).
anchor(R06, 'r06_panel', [-2.6, 0, 37.0], 180);
anchor(R06, 'r06_hold', [-0.5, 0, 29.2], 180);
// The creature that burst out of Voss (infection-kills spec): it spawns where it stands pounding the Lab B glass and breaks out at contact.
spawn(R05, 'r05_door', [8, 0, 22.51], 'door', 'r05_contact', { yaw: 180, look: 'lab_creature' });
// The first one breaks through the sealed Lab B door (group r05_contact); two to three more trickle in
// after it dies (group r05_trickle, ADR-0014 beat 3): two from the west vent, one up out of the floor drain.
spawn(R05, 'r05_vent', [-5.2, 2.7, 22], 'vent', 'r05_trickle', { count: 2, interval: 6 });
spawn(R05, 'r05_drain', [-4.6, 0, 24.6], 'floor', 'r05_trickle', { count: 1, interval: 8, outfit: 'crew' });
spawn(R06, 'r06_duct', [-2.6, 3.3, 30.3], 'ceiling', 'r06_cover', { count: 1 });
spawn(R06, 'r06_trench', [-5.15, 0, 35.4], 'floor', 'r06_cover', { count: 2, interval: 4 });
spawn(R06, 'r06_vent_e', [1.6, 1.0, 36], 'vent', 'r06_cover', { count: 2, interval: 5 });
spawn(R06, 'r06_corridor', [-0.5, 0, 22], 'door', 'r06_cover', { count: 1, yaw: 180 });
trigger(R05, 'trig_r05_enter', cellBox(-1, 0, 4, 4), 'trigger:r05_enter');
trigger(R06, 'trig_r06_enter', cellBox(-1, 0, 7, 7), 'trigger:r06_enter');
trigger(R06, 'trig_r06_door', cellBox(-1, 0, 9, 9), 'trigger:r06_door');
checkpoints.push({ id: 'cp_first_contact', room: 'R05', pos: [-1.6, 0, 16.4], yaw: 180 });
checkpoints.push({ id: 'cp_cover_me', room: 'R06', pos: [-2, 0, 28.6], yaw: 180 });

// The coolant line (rebuild-lab-wing D2): one route, column -> Lab B service wall -> R05 ceiling -> R06 west side ->
// Giles's panel. One piece per room so each room merges its own part; collars where it passes through a wall.
prop(R04, 'coolant_line', [0, 0, 0], 0, { path: '9.85,2.9,29.25;2.45,2.9,29.25;2.45,2.9,28;2.45,2.9,25.3;2.0,2.9,25.3', valves: '2', sight: '1', collars: '4' });
prop(R04, 'coolant_line', [0, 0, 0], 0, { path: '2.45,2.9,28;2.45,1.75,28' }); // the branch down into the service panel
prop(R05, 'coolant_line', [0, 0, 0], 0, { path: '2.0,2.8,25.3;1.55,2.8,25.3;-3.5,2.8,25.3;-3.5,2.8,26.0', collars: '0;3', valves: '1', sight: '2' });
prop(R06, 'coolant_line', [0, 0, 0], 0, { path: '-3.5,2.8,26.0;-3.5,2.8,26.5;-5.5,2.8,26.5;-5.5,2.8,37.5;-2.6,2.8,37.5;-2.6,1.62,37.5', collars: '0', sight: '3' });
// The bloom follows the line (D3). Lab B: inside the column from the start; outside it only after the drop's burst
// (`reveal: 'spread'`). R05 and R06 are only ever entered after the drop, so their growth is always there.
prop(R04, 'bloom_growth_c', [9.3, 0, 29.45], 20, { material: 'bloom', reveal: 'spread', breathe: true });
prop(R04, 'bloom_growth_a', [3.1, 0, 28.6], 70, { material: 'bloom', reveal: 'spread' });
prop(R04, 'bloom_growth_d', [2.7, 0, 27.2], 0, { material: 'bloom', reveal: 'spread' });
wallProp(R04, 'bloom_decal', 1, 7, 'w', 0.15, { w: 1.4, h: 1.2, y: 1.6, seed: 0, reveal: 'spread' });
prop(R04, 'bloom_decal', [6.0, 0, 29.25], 0, { w: 2.0, h: 0.8, y: 2.95, ceiling: true, seed: 1, reveal: 'spread' });
prop(R05, 'bloom_growth_a', [-2.6, 0, 25.15], 15, { material: 'bloom' });
prop(R05, 'bloom_decal', [-1.6, 0, 25.75], 0, { w: 1.0, h: 0.7, y: 2.45, seed: 2 });
prop(R06, 'bloom_growth_c', [-4.6, 0, 29.6], 200, { material: 'bloom', breathe: true });
prop(R06, 'bloom_decal', [-3.25, 0, 37.73], 0, { w: 0.8, h: 1.1, y: 0.95, seed: 3 });

// ---------------------------------------------------------------- R07 security + armory, R08 medical bay
const R07 = room('R07', 'Security Office', rect(-1, 1, 10, 11), {
  area: 'security',
  atmosphere: { fog: '#090d11', fogDensity: 0.022, reverb: 'small_office', ambience: 'office_hvac' },
  // 3 pooled + 3 glow-only: keeps R07 slightly dimmer than R08 while staying inside the 8-light shared pool with R08 (3) and R07a (2).
  lights: [
    L(0, 'steady', '#e6f0ff', 8, 10),
    L(1, 'steady', '#e6f0ff', undefined, undefined, { pool: false, emissive: 2.0, shaft: 0 }),
    L(2, 'steady', '#e6f0ff', 8, 10),
    L(3, 'steady', '#e6f0ff', undefined, undefined, { pool: false, emissive: 1.6, shaft: 0 }),
    L(4, 'flicker', '#e6f0ff', 6.5, 9),
    L(5, 'steady', '#e6f0ff', undefined, undefined, { pool: false, emissive: 1.6, shaft: 0 }),
  ],
});
const R07a = room('R07a', 'Armory', [[2, 10]], {
  area: 'security',
  wallMaterial: 'cleanWall',
  atmosphere: { fog: '#0c1014', fogDensity: 0.018, reverb: 'small_office' },
  walls: ['wall_plain'],
  // 2 pooled lights: crisp overhead work light (slot 0) + dedicated pendant over the east shotgun rack (slot 1).
  lights: [
    L(0, 'steady', '#f4f8ff', 12, 10, { shaft: 0.03, emissive: 2.8 }),
    L(1, 'steady', '#fff4e0', 9, 7, { emissive: 3.0 }),
  ],
});
const R08 = room('R08', 'Medical Bay', rect(-1, 1, 12, 13), {
  area: 'medbay',
  atmosphere: { fog: '#081012', fogDensity: 0.018, reverb: 'small_office', ambience: 'med_beeps' },
  floor: 'floor_tiles',
  walls: ['wall_tiles'],
  // medbay-attack staging: 3 pooled on the front row (steady key over the cart at cell 0,12, flicker over the door and
  // lane, soft fill over beds) + 3 low-emissive glow-only back-row fixtures so the ceiling has no dark diffusers.
  lights: [
    L(0, 'steady', '#eef8ff', 6, 10),
    L(1, 'steady', '#f2faff', 11, 11, { shaft: 0.035, emissive: 2.8 }),
    L(2, 'flicker', '#eef8ff', 7.5, 10),
    L(3, 'steady', '#eef8ff', undefined, undefined, { pool: false, emissive: 1.4, shaft: 0 }),
    L(4, 'steady', '#eef8ff', undefined, undefined, { pool: false, emissive: 1.4, shaft: 0 }),
    L(5, 'steady', '#eef8ff', undefined, undefined, { pool: false, emissive: 1.4, shaft: 0 }),
  ],
});
const R08b = room('R08b', 'Surgery', [[2, 13]], {
  area: 'medbay',
  hidden: true,
  floor: 'floor_tiles',
  walls: ['wall_tiles'],
  atmosphere: { fog: '#081012', fogDensity: 0.022, reverb: 'small_office' },
  lights: [L(0, 'dying', '#eef8ff', 7.5, 9)],
});
// Two panes and the medical bay door (medbay-attack spec): the east edge is the sealed glass door Okafor tries.
for (const x of [-1, 0]) glass('R07', x, 11, 's');
// Each pane its own id (medbay-attack spec "Only the struck pane"): the kill's marks land where Priya touches the centre
// pane (gore glass marks, not whole-pane overlays); the whole-pane crack overlays stay, unused by the R08 scene.
for (const [i, [x, id]] of [[-1, 'medbay_w'], [0, 'medbay_c']].entries()) {
  wallProp(R07, 'glass_cracks', x, 11, 's', 0, { id, seed: i + 11 }, 0.02);
}
door('D_R07_R07a', 'R07', 'R07a', 1, 10, 'e', { state: 'locked', unlockBy: 'engineer', task: 'bypass_short' });
door('D_R07_R09', 'R07', 'R09', 1, 11, 'e', { state: 'locked', unlockBy: 'medic', task: 'biometric' });
door('D_R08_R08b', 'R08', 'R08b', 1, 13, 'e', { state: 'closed', access: { sealed: true, text: 'lockdown' } });
door('D_R07_R08', 'R07', 'R08', 1, 11, 's', { kit: 'glass_slide', state: 'closed', access: { sealed: true, text: 'lockdown' } });
// Staging (medbay-attack spec, design decision 12): R07 is three clusters with the spine (x -1.5..1.5) and the
// viewing strip along the glass (z 44.6-45.7) kept clear; rot is the way a kit's front faces (0 N, 90 W, 180 S, 270 E).
// Watch desk on the north wall, west of the entry: the bank, the camera wall above it, the post left in a hurry.
prop(R07, 'console_bank', [-3.6, 0, 38.7], 180, { width: 3, mode: 'security' });
prop(R07, 'cctv_wall', [-3.6, 0, 38.27], 180, { id: 'sec_cctv', width: 1.6, y: 1.69, live: 1, camera: 'CAM 04  MEDBAY', labels: 'CAM 01  SECURITY|CAM 04  MEDBAY|CAM 05  LAB B CORRIDOR|CAM 07  PRESSURE HALL|CAM 08  TUNNEL|CAM 03  RING WALK' });
prop(R07, 'chair', [-3.6, 0, 39.75]);
prop(R07, 'chair', [-2.3, 0, 40.9], 150); // shoved back from the bank
// Lockers on the north wall east of the entry, off the armory door.
prop(R07, 'locker', [3.4, 0, 38.55], 180, { count: 2, label: 'SEC-07' });
// Last stand on the west wall: the desk with the medkit, a chair knocked aside, the second body.
prop(R07, 'desk', [-5.3, 0, 42.6], 90, { width: 1.6 });
prop(R07, 'chair', [-4.4, 0, 43.9], 200);
prop(R07, 'emergency_beacon', [-5.7, 2.6, 41], 90, { wall: true });
// Purposeful security dressing (overhaul-security-medbay-look): shift roster, clock, and desktop items.
wallKit(R07, -1, 10, 'w', 'wall_plain');
wallProp(R07, 'notice_board', -1, 10, 'w', 0, { text: 'SECURITY WATCH', detail: 'LOCKDOWN PROTOCOL' });
wallProp(R07, 'wall_clock', 1, 10, 'n', 0.4, { y: 2.75 });
prop(R07, 'mug', [-2.65, 0.9, 38.62], 40, { color: 'teal' });
prop(R07, 'desk_wand', [-5.15, 0.775, 42.15], 115, { id: 'r07_wand' });
// R07a: the rack faces the door so the Breacher is framed as it opens; a looted rack, a shelf for the ammo, and a dedicated rack lamp.
prop(R07a, 'armory_rack', [9.45, 0, 40], 90, { width: 2.4, empty: 2 });
prop(R07a, 'armory_rack', [8.2, 0, 38.55], 180, { width: 1.6, empty: 3 });
prop(R07a, 'storage_shelf', [7.9, 0, 41.45], 0, { width: 1.6 });
prop(R07a, 'pendant_light', [8.8, 0, 40.0], 0, { ceiling: 3.2, drop: 0.72, count: 1, slots: true });
// R08 medical bay: only the cart in front of the centre pane (the stage); beds and vitals on the west wall; clinical
// storage, glass supply cabinet, bench, scrub sink and parked gurney on the south wall; the lane x 2.5..5.75 stays empty.
prop(R08, 'instrument_cart', [0, 0, 47.4], 0);
prop(R08, 'med_bed', [-4.7, 0, 48.6], 90);
prop(R08, 'console', [-5.3, 0, 50.1], 270, { screen: 'status' });
prop(R08, 'med_bed', [-4.7, 0, 51.6], 90);
prop(R08, 'storage_shelf', [-4.9, 0, 53.45], 0, { width: 1.6 });
prop(R08, 'lab_cabinet', [-3.4, 0, 53.48], 0);
prop(R08, 'lab_bench', [-1.45, 0, 53.35], 0, { width: 2.4 });
prop(R08, 'bio_wash_station', [0.35, 0, 53.5], 0);
prop(R08, 'gurney', [2.0, 0, 53.3], 90);
wallProp(R08, 'wall_clock', 0, 13, 's', 0, { y: 2.75 });
// R08b surgery: the bed, and a shelf on the north wall behind the stinger camera (no specimen tank).
prop(R08b, 'med_bed', [8, 0, 52], 0);
prop(R08b, 'storage_shelf', [7.3, 0, 50.55], 180, { width: 1.6 });
anchor(R07a, 'shotgun_pickup', [9.4, 1.25, 40.0]);
anchor(R07a, 'r07_panel', [6.9, 0, 38.9], 0);
anchor(R07a, 'ammo_r07a', [7.9, 0.78, 41.4]);
anchor(R07, 'r07_glass', [0, 1.5, 45.8]);
anchor(R07, 'health_r07', [-5.3, 0.8, 42.6]);
anchor(R07, 'okafor_biometric', [4.4, 0, 44], 270);
// Action half set pieces (ADR-0014 beat 5): Giles at the armory door, the squad at the glass, Priya's run,
// the thing waiting in R08b, and the stinger's camera in the surgery (ADR-0014 amendment).
anchor(R07, 'r07_armory_panel', [5.15, 0, 41.4], 270);
// At the glass (design decision 10): Jay against the centre pane, Giles west of him, Okafor east by the door, both off
// Jay's line to the cart. Jay stands 0.15 m clear of the partition's collider (face z 45.75, capsule 0.35).
anchor(R07, 'r07_glass_okafor', [3.1, 0, 45.1], 180);
anchor(R07, 'r07_glass_giles', [-1.8, 0, 45.0], 170);
anchor(R07, 'r07_glass_jay', [0.3, 0, 45.25], 180);
anchor(R07, 'r07_medbay_door', [4.0, 0, 45.35], 180);
anchor(R07, 'r07_regroup', [3.4, 0, 42.4], 200);
// The admin security-booth glimpse (ADR-0023): CAM 04 high in the north-east corner, a figure facing the west wall.
anchor(R08, 'cam04_pos', [5.4, 2.9, 47.0]);
anchor(R08, 'cam04_look', [-3.6, 1.0, 50.2]);
anchor(R08, 'cam04_figure', [-4.3, 0, 50.1], 90); // at the vitals console between the beds, facing the west wall
anchor(R08, 'priya_r08', [2.2, 0, 49.4], 0); // her work spot, with a clear walk to the glass around the cart
anchor(R08, 'r08_drag_exit', [5.6, 0, 52], 270);
anchor(R08, 'priya_glass', [1.0, 0, 46.35], 0); // the plead spot, 0.35 m off the partition (R08 face z 46.0), east of the cart
anchor(R08, 'r08_drag_mid', [3.8, 0, 46.7]); // along the glass, right behind the door Okafor is pressed against
anchor(R08, 'r08_drag_turn', [4.4, 0, 48.6]);
// The kill's stage (design decision 10): plead/grab at the glass, slams on the cart top, thrown back into the centre
// pane at head height, the reach in the gap between the pane and the cart.
anchor(R08, 'r08_grab', [1.0, 0, 46.35], 0);
anchor(R08, 'r08_cart_top', [0, 0.925, 47.4]);
anchor(R08, 'r08_throw_point', [0.9, 1.55, 45.75]);
anchor(R08, 'r08_reach', [1.0, 0, 46.33], 0);
// The centre pane's face (z 45.72): the kill's glass, its marks and its gore clip.
anchor(R08, 'medbay_c_glass', [1.0, 1.5, 45.72]);
// The attacker's marks (kills.json "mauled"): behind her at the glass; round the cart's east end to its far side; the
// slam spot (its right hand reaches 0.61 m ahead and 0.32 m right, so it stands there to land her head on the cart),
// facing the glass; at her feet for the drag; and the end of the drag in the surgery.
anchor(R08, 'r08_approach', [1.1, 0, 46.8], 0);
anchor(R08, 'r08_around', [1.1, 0, 48.15]);
anchor(R08, 'r08_slam_spot', [-0.32, 0, 48.01], 0);
anchor(R08, 'r08_slam_face', [-0.32, 0, 46.5]);
anchor(R08, 'r08_feet', [1.25, 0, 47.95], 0); // 1.6 m out from her at the pane: she lies at full length when dragged
anchor(R08b, 'r08_lurk', [7.0, 0, 51.35], 90); // just inside the surgery door, clear of the bed
anchor(R08b, 'r08_drag_end', [7.1, 0, 53.0], 90); // where the drag leaves her, between the bed and the door
anchor(R08b, 'stinger_cam', [9.65, 2.85, 50.35]);
anchor(R08b, 'stinger_look', [8.1, 0.55, 52.9]);
anchor(R08b, 'priya_hide', [9.2, 0, 53.45], 0);
anchor(R08b, 'priya_pool', [9.2, 0, 52.55]);
// Where Priya waits off-stage between the intro and the security wing (priya-commons-exit): she "went to the medbay",
// but the medbay itself is on the admin booth's CAM 04 feed, so she waits in the shut surgery, out of every view.
anchor(R08b, 'priya_offstage', [9.3, 0, 50.9], 0);
anchor(R08b, 'stinger_enter', [6.7, 0, 52], 270);
anchor(R08b, 'stinger_kill', [8.0, 0, 52.6], 225);
// One play-dead in R07 (gets up as the player passes, ADR-0014 beat 5); the other bodies are dressing.
spawn(R07, 'r07_playdead', [2.6, 0, 42.6], 'corpse', 'r07_playdead', { variant: 'playDead', outfit: 'security', yaw: 120, on: 'trigger:r07_enter' });
anchor(R07, 'body_r07_1', [-2.4, 0, 39.9], 30); // slumped at the post
anchor(R07, 'body_r07_2', [-4.2, 0, 42.3], 250); // the last stand, out of the viewing strip
trigger(R07, 'trig_r07_enter', cellBox(-1, 1, 10, 10), 'trigger:r07_enter');
trigger(R07, 'trig_r07_playdead', [[1, 0, 40.6], [4, 2.2, 44.4]], 'trigger:r07_playdead');
trigger(R07, 'trig_r08_glass', [[-5.6, 0, 43.4], [5.6, 2.4, 45.6]], 'trigger:r08_glass');
// Jay bangs on the centre pane while Priya pleads (medbay-attack spec): only offered while the scene allows interact.
trigger(R07, 'medbay_bang', [[-1.2, 0, 44.7], [1.8, 2.2, 45.75]], 'interact:medbay_bang', { on: 'use', prompt: 'Bang on the glass', once: false });
trigger(R07a, 'trig_r07_armory', cellBox(2, 2, 10, 10), 'trigger:r07_armory');
checkpoints.push({ id: 'cp_security', room: 'R07', pos: [0, 0, 40.2], yaw: 180 });

// ---------------------------------------------------------------- R09 flooded sump, R10 pump room (tunnel)
// openspec overhaul-flooded-tunnel: R09's floor sits 1.2 m below deck with 0.75 m of standing water. Stairs fall from
// the R07 door (cell 2,11, landing on its west edge) and rise to the R10 door (cell 7,12, landing on its east edge).
// Cell 7,13 is a sump bay under the burst pipe, seen from R10 through a low window.
const SUMP = -1.2;
const WATER = -0.45;
// Open steel grating (task 11.2): the water shows through the landings and between the treads.
const STAIRS = { rise: 1.2, run: 2.4, offset: 0.6, grate: true };
const LANDING = { rise: 1.2, depth: 1.4, grate: true };
const R09 = room('R09', 'Flooded Maintenance Tunnel', [[2, 11], [3, 11], [4, 11], [4, 12], [5, 12], [6, 12], [7, 12], [7, 13]], {
  area: 'tunnel',
  floor: 'floor_grate',
  ceiling: 'ceiling_pipes',
  // Bare concrete (task 11.1), plain tiles only so no wall vent sits under the water.
  walls: ['wall_plain'],
  wallMaterial: 'concrete',
  floorY: SUMP,
  water: {
    level: WATER,
    junk: [
      { kind: 'paper', at: [11.2, 44.7], rot: 20 },
      { kind: 'paper', at: [11.6, 44.3], rot: 75 },
      { kind: 'hardhat', at: [13.4, 43.2], rot: 140 },
      { kind: 'sheen', at: [15.2, 44.4], scale: 1.4 },
      { kind: 'glove', at: [18.6, 47.0], rot: 200 },
      { kind: 'cup', at: [21.4, 48.9], rot: 60 },
      { kind: 'paper', at: [23.2, 47.3], rot: 160 },
      { kind: 'sheen', at: [25.4, 48.5] },
      { kind: 'cup', at: [27.6, 51.6], rot: 15 },
      { kind: 'sheen', at: [28.2, 52.6], scale: 0.8 },
    ],
    emitters: [
      { kind: 'pour', at: [28.4, 52.6], rate: 22, radius: 0.35, strength: -0.012 },
      { kind: 'drip', at: [11.3, 44.9], rate: 0.45, radius: 0.06, strength: -0.014 },
      { kind: 'drip', at: [19.1, 47.3], rate: 0.35, radius: 0.06, strength: -0.014 },
      { kind: 'drip', at: [24.6, 48.9], rate: 0.5, radius: 0.06, strength: -0.014 },
    ],
  },
  extraPieces: [
    { kit: 'stairs', cell: [2, 0, 11], rot: 90, params: STAIRS },
    { kit: 'floor_landing', cell: [2, 0, 11], rot: 90, params: LANDING },
    { kit: 'stairs', cell: [7, 0, 12], rot: 270, params: STAIRS },
    { kit: 'floor_landing', cell: [7, 0, 12], rot: 270, params: LANDING },
  ],
  atmosphere: { fog: '#03100f', fogDensity: 0.07, ambient: 'flooded', reverb: 'flooded', ambience: 'water_drip' },
  // Failing tubes (render-lighting spec): six pooled at most (Low keeps 12), the rest glow only. The L-bend fixture
  // is the broken one that sparks; slot 8 is the tube hanging loose (the first prop slot after the eight ceilings).
  lights: [
    L(0, 'failing', '#9fe8ff', 6),
    L(1, 'failing', '#9fe8ff', 4, undefined, { pool: false }),
    L(2, 'failing', '#9fe8ff', 5),
    L(3, 'failing', '#bfefff', 6, undefined, { sparks: true }),
    L(4, 'failing', '#9fe8ff', 4, undefined, { pool: false }),
    L(5, 'failing', '#9fe8ff', 5),
    L(6, 'failing', '#9fe8ff', 5),
    L(7, 'failing', '#9fe8ff', 4, undefined, { pool: false }),
    L(8, 'failing', '#cfefff', 5),
    // Red alarm beacons along the tunnel (playtest): they light the sump in red, on main and on backup power.
    ...['r09_beacon_1', 'r09_beacon_2', 'r09_beacon_3', 'r09_beacon_4', 'r09_beacon_5'].map((id) => L('emergency', 'alarm', '#ff2a1a', 12, 13, { id, ownColor: true })),
  ],
});
const R10 = room('R10', 'Pump Room', rect(8, 9, 12, 13), {
  area: 'tunnel',
  ceiling: 'ceiling_pipes',
  walls: ['wall_plain', 'wall_panel'],
  wallMaterial: 'concrete',
  atmosphere: { fog: '#040a0a', fogDensity: 0.05, reverb: 'metal_corridor', ambience: 'pipes_knock' },
  // Slot 4 is the beacon (the emergency_beacon prop's slot, after the four ceilings): off until the valve turns.
  lights: [
    // The pump room runs on its own circuit: fully lit on backup power (playtest: the ambush needs to be seen).
    L(0, 'steady', '#ffe2b8', 10, undefined, { backupScale: 1, ownColor: true }),
    L(3, 'steady', '#ffe2b8', 9, undefined, { backupScale: 1, ownColor: true }),
    L(4, 'off', '#ff2a1a', 12, 14, { id: 'r10_beacon', ownColor: true }),
    // Two more beacons on the north and south walls so the flood plays in strong red light.
    L('emergency', 'off', '#ff2a1a', 12, 14, { id: 'r10_beacon_n', ownColor: true }),
    L('emergency', 'off', '#ff2a1a', 12, 14, { id: 'r10_beacon_s', ownColor: true }),
  ],
});
door('D_R09_R10', 'R09', 'R10', 7, 12, 'e', { params: { porthole: true } });
door('D_R10_R11', 'R10', 'R11', 8, 12, 'n', { kit: 'bulkhead', state: 'locked', unlockBy: 'script', unlockOn: 'valve:r10_main' });
// The overlook: a low window from the pump room down into the sump bay (R09 owns it, so it reaches the sunken floor).
glass('R09', 7, 13, 'e');
// R09 dressing (flooded-tunnel spec "The tunnel looks long-flooded").
prop(R09, 'hanging_tube', [20, SUMP, 48], 0, { amp: 0.14, period: 3.6 });
prop(R09, 'emergency_beacon', [17.7, 2.6, 46], 270, { wall: true });
// High on the walls (2.6 m, above even the flooded level): over each flight, along both legs and in the bay.
for (const [x, z, s, along] of [[2, 11, 's', 0.4], [3, 11, 'n', 1.0], [6, 12, 's', -0.6], [7, 13, 'w', 0]]) {
  const w = onWall(x, z, s, along, 0.02);
  prop(R09, 'emergency_beacon', [w.pos[0], 2.6, w.pos[2]], w.rot, { wall: true });
}
prop(R09, 'debris_pile', [12, SUMP, 44.6]);
prop(R09, 'debris_pile', [20.4, SUMP, 49.1]);
// The steel case with the ammo: wedged against the wall pipe, its top 0.85 m above the sump floor.
prop(R09, 'crate', [17.2, SUMP, 49.2], 30, { size: 0.85 });
prop(R09, 'crate', [25, SUMP, 49.4], 70, { size: 0.6 });
prop(R09, 'pipe_run', [10, SUMP, 45.6], 0, { length: 6, height: 2.0, paint: 'teal' });
prop(R09, 'pipe_run', [22, SUMP, 49.6], 0, { length: 8, height: 1.15, paint: 'dark' });
prop(R09, 'chair', [13.6, SUMP, 43.4], 80);
prop(R09, 'cable_bundle', [24, SUMP, 46.6], 0, { length: 7, height: 0.08 });
prop(R09, 'burst_pipe', [28.4, SUMP, 52.6], 90, { height: 4.0, fall: 3.25 });
// Industrial surfaces (tasks 11.3, 11.4): sprayed TAG stencils and depth gauges on the concrete, cable trays and high
// pipes overhead. Wall stencils stand at 0.4 m (above the water, clear of the sunken-floor check).
const stencil = (r, x, z, side, along, params) => {
  const w = onWall(x, z, side, along, 0.02);
  prop(r, 'tag_stencil', [w.pos[0], 0.4, w.pos[2]], w.rot, params);
};
stencil(R09, 3, 11, 'n', 0, { y: 1.2 });
stencil(R09, 5, 12, 's', 0, { y: 1.2 });
stencil(R09, 2, 11, 'n', 1.2, { kind: 'depth', y: -0.4 });
stencil(R09, 7, 12, 'n', -1.2, { kind: 'depth', y: -0.4 });
prop(R09, 'cable_tray', [13, SUMP, 43.1], 0, { length: 9.6 });
prop(R09, 'cable_tray', [22.2, SUMP, 49.0], 0, { length: 11.6, drop: 0.45 });
prop(R09, 'pipe_run', [13, SUMP, 45.3], 0, { length: 9.6, height: 3.95, paint: 'teal', hung: true });
prop(R09, 'pipe_run', [22, SUMP, 46.7], 0, { length: 11.6, height: 3.9, paint: 'dark', hung: true });
prop(R09, 'ambient_loop', [12, WATER, 43], 0, { sound: 'waterLap', gain: 0.22, range: 9, float: true });
prop(R09, 'ambient_loop', [22, WATER, 49], 0, { sound: 'waterLap', gain: 0.22, range: 9, float: true });
// R10 pump room (flooded-tunnel spec "The pump room overlooks the sump").
wallProp(R10, 'valve_wheel', 9, 13, 'e', 0.6, { id: 'r10_main' });
prop(R10, 'pump_unit', [35.6, 0, 47.2], 0, {});
prop(R10, 'pump_unit', [35.6, 0, 50.0], 0, { paint: 'dark' });
prop(R10, 'console', [31.4, 0, 49.8], 270, { screen: 'status' });
prop(R10, 'pipe_run', [36, 0, 46.6], 0, { length: 7, height: 2.6, paint: 'dark' });
prop(R10, 'crate_stack', [33, 0, 54.6], 0);
prop(R10, 'emergency_beacon', [30.3, 2.7, 48.0], 90, { wall: true });
for (const [x, z, s] of [[8, 12, 'n'], [9, 13, 's']]) {
  const w = onWall(x, z, s, 0.8, 0.02);
  prop(R10, 'emergency_beacon', [w.pos[0], 2.7, w.pos[2]], w.rot, { wall: true });
}
wallProp(R10, 'pressure_gauge', 9, 12, 'n', -0.8);
wallProp(R10, 'tag_stencil', 8, 13, 's', 0, { y: 1.7 });
prop(R10, 'cable_tray', [34, 0, 54.9], 0, { length: 7.2, drop: 0.3 });
prop(R10, 'pipe_run', [34, 0, 45.4], 0, { length: 7.2, height: 2.85, paint: 'teal', hung: true });
wallProp(R10, 'pressure_gauge', 9, 12, 'n', 0.2);
// The klaxon sounds from the valve on (the flood cutscene emits flood:klaxon).
prop(R10, 'ambient_loop', [36.6, 2.6, 49], 0, { sound: 'klaxon', gain: 0.9, range: 20, on: 'flood:klaxon' });
anchor(R09, 'r09_entry', [6.9, 0, 44], 270);
anchor(R09, 'r09_mid', [16, SUMP, 48], 270);
anchor(R09, 'ammo_r09', [17.2, SUMP + 0.95, 49.2]);
anchor(R10, 'valve_r10', [37.4, 1.3, 52.6]);
// Where `?debug&jump=r10_flood` puts Jay: facing the valve wheel.
anchor(R10, 'r10_valve_stand', [36.3, 0, 52.6], 270);
// Beat 6: the squad waits in the pump room while Jay turns the wheel.
anchor(R10, 'r10_giles', [35.4, 0, 52.2], 270);
anchor(R10, 'r10_okafor', [34.2, 0, 50.6], 300);
anchor(R10, 'health_r10', [33, 1.0, 54.6]);
// The flood cutscene (flooded-tunnel spec): the squad stands behind Jay at the wheel; the shambler starts in the sump.
anchor(R10, 'r10_flood_giles', [31.4, 0, 50.7], 90);
anchor(R10, 'r10_flood_okafor', [32.4, 0, 51.4], 90);
anchor(R10, 'r10_flood_view', [31.0, 1.5, 48.0]);
anchor(R10, 'r10_porthole', [30.0, 1.6, 48.5]);
anchor(R09, 'r09_flood_shambler', [24.4, SUMP, 48.2], 90);
anchor(R09, 'r09_flood_top', [28.7, 0, 48.2], 90);
// The ambush: it waits right behind the door, then lunges into the doorway (elbows at the door's plane).
anchor(R09, 'r09_flood_behind', [28.9, 0, 48.0], 90);
anchor(R09, 'r09_flood_door', [29.55, 0, 48.0], 90);
// The elite prying the door open from the middle (design D13): facing the door, blades within reach of the seam.
anchor(R09, 'r09_pry', [29.5, 0, 48.0], 270);
spawn(R09, 'r09_floor_1', [13, SUMP, 44], 'floor', 'r09_tunnel', { outfit: 'engineer' });
// The play-dead corpses float face down (flooded-tunnel spec), just under the surface.
spawn(R09, 'r09_corpse_1', [16.4, WATER - 0.2, 48.6], 'corpse', 'r09_tunnel', { variant: 'playDead', float: true });
spawn(R09, 'r09_floor_2', [22, SUMP, 47.2], 'floor', 'r09_tunnel', { count: 2, interval: 6 });
spawn(R09, 'r09_corpse_2', [24.2, WATER - 0.2, 47.6], 'corpse', 'r09_tunnel', { variant: 'playDead', float: true });
spawn(R09, 'r09_vent', [19.6, 2.8, 49], 'vent', 'r09_tunnel', { count: 1 });
trigger(R09, 'trig_r09_enter', [[6.3, -0.2, 42.3], [9.7, 2.6, 45.7]], 'trigger:r09_enter');
trigger(R09, 'trig_r09_mid', [[14.3, SUMP - 0.1, 46.3], [17.7, 1.6, 49.7]], 'trigger:r09_mid');
trigger(R10, 'trig_r10_enter', cellBox(8, 8, 12, 12), 'trigger:r10_enter');
// At the R11 bulkhead after the valve: the shambler bursts back through the R09 door.
trigger(R10, 'trig_r10_ambush', around([32, 0, 47.2], 1.4, 2.2), 'trigger:r10_ambush');
trigger(R10, 'trig_r10_valve', around([36.9, 0, 52.6], 0.8, 2.2), 'valve:r10_main', { on: 'use', prompt: 'Turn valve' });
checkpoints.push({ id: 'cp_flooded', room: 'R09', pos: [6.9, 0, 44], yaw: 270 });

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
const HYDRO = { fog: '#141e1b', fogDensity: 0.016, ambient: 'hydro', reverb: 'small_office', ambience: 'hydro_misters' };
const R12a = room('R12a', 'Hydroponics Vestibule', [[9, 5]], {
  area: 'hydroponics',
  atmosphere: { ...HYDRO, ambience: 'hydro_vestibule' },
  floor: 'floor_tiles',
  ceilingMaterial: 'officeCeiling',
  walls: ['wall_panel', 'wall_plain'],
  noDeadFixtures: true,
  lights: [L(0, 'steady', '#f0f7f4', 11, 10, { shaft: 0.02 })],
});
const R12b = room('R12b', 'Grow Hall', rect(10, 12, 4, 6), {
  area: 'hydroponics',
  height: 4.5,
  atmosphere: { ...HYDRO, fogDensity: 0.018, reverb: 'metal_hall', ambience: 'hydro_misters' },
  floor: 'floor_grate',
  floorOverride: { '11,4': 'floor_tiles', '11,5': 'floor_tiles', '11,6': 'floor_tiles' },
  ceiling: 'ceiling_pipes',
  walls: ['wall_panel', 'wall_plain'],
  noDeadFixtures: true,
  lights: [
    L(1, 'steady', '#f0f7f2', 13, 12, { shaft: 0.03 }),
    L(3, 'steady', '#edf5ff', 12, 12, { shaft: 0.025 }),
    L(5, 'steady', '#edf5ff', 12, 12, { shaft: 0.025 }),
    L(7, 'steady', '#f2f8f4', 13, 12, { shaft: 0.03 }),
  ],
});
const R12c = room('R12c', 'Seed Lab', [[13, 4], [13, 5]], {
  area: 'hydroponics',
  atmosphere: { ...HYDRO, ambience: 'hydro_seed_lab' },
  floor: 'floor_tiles',
  ceilingMaterial: 'officeCeiling',
  walls: ['wall_tiles'],
  noDeadFixtures: true,
  lights: [
    L(0, 'steady', '#f4faf6', 11, 10, { shaft: 0.02 }),
    L(1, 'steady', '#f4faf6', 10, 10, { shaft: 0.02 }),
  ],
});
const R12d = room('R12d', 'Nutrient Room', [[11, 7], [12, 7]], {
  area: 'hydroponics',
  atmosphere: { ...HYDRO, reverb: 'metal_corridor', ambience: 'hydro_plant_room' },
  floor: 'floor_tiles',
  ceiling: 'ceiling_pipes',
  walls: ['wall_plain', 'wall_panel'],
  wallMaterial: 'tileWall',
  noDeadFixtures: true,
  lights: [
    L(0, 'steady', '#eef6f4', 10, 10, { shaft: 0.02 }),
    L(1, 'flicker', '#eef6f4', 9, 10, { shaft: 0.02 }),
  ],
});
const R12e = room('R12e', 'Hydroponics Storeroom', [[10, 7]], {
  area: 'hydroponics',
  atmosphere: { ...HYDRO, reverb: 'small_office', ambience: 'hydro_storeroom' },
  floor: 'floor_tiles',
  walls: ['wall_plain'],
  noDeadFixtures: true,
  lights: [L(0, 'steady', '#ffe2b8', 9, 9, { shaft: 0.02 })],
});
// Open-abyss ocean viewports on the east seaward hull (Grow Hall south-east bay & Seed Lab east wall).
wallKit(R12b, 12, 6, 'e', 'wall_window');
wallKit(R12c, 13, 4, 'e', 'wall_sanity_screen');
// Full-height glass partition between the Grow Hall and Seed Lab beside the glass door.
glass('R12b', 12, 5, 'e');
wallKit(R12d, 12, 7, 'e', 'wall_vent');
door('D_R02_R12a', 'R02', 'R12a', 8, 5, 'e');
door('D_R12a_R12b', 'R12a', 'R12b', 9, 5, 'e', { kit: 'glass_slide' });
door('D_R12b_R12c', 'R12b', 'R12c', 12, 4, 'e', { kit: 'glass_slide' });
door('D_R12b_R12d', 'R12b', 'R12d', 12, 6, 's');
door('hydro_store', 'R12b', 'R12e', 10, 6, 's', { access: { requires: 'card_l2' } });
// The sealed vent: the wall_vent tile on R12d's east wall (fan 0.9 m along, 0.55 m up).
vents.push({ id: 'hydro_vent', room: 'R12d', box: [[49.4, 0.2, 27.0], [50.0, 0.9, 28.8]], access: { requires: 'vent_driver' } });
// R12a Biosecurity Air-Lock: map station, stainless hand-wash station + bio sign, locker, lab coat/boot rack, floor boot-wash mat.
station(R12a, 'hydro_map', 'hydroponics', 9, 5, 'n', -0.45);
prop(R12a, 'bio_wash_station', [37.05, 0, 18.52], 180);
prop(R12a, 'locker', [34.65, 0, 18.58], 180, { count: 1, label: 'HYDRO' });
prop(R12a, 'coat_rack', [36.0, 0, 21.48], 0, { width: 1.6 });
prop(R12a, 'boot_wash_mat', [36.0, 0, 20.0], 0, { width: 1.6, depth: 1.2 });
// R12b Grow Hall: multi-crop tiered racks flanking an open central vista (z=20) to the Seed Lab glass, waist-high NFT troughs under the ocean windows, and the irrigation workstation.
prop(R12b, 'plant_rack', [41.2, 0, 17.6], 0, { length: 3.0, tiers: 3, light: 'magenta', crop: 'tomatoes' });
prop(R12b, 'plant_rack', [46.8, 0, 17.6], 0, { length: 3.0, tiers: 3, light: 'magenta', crop: 'tomatoes' });
prop(R12b, 'plant_rack', [41.2, 0, 22.4], 0, { length: 3.0, tiers: 3, light: 'white', crop: 'greens' });
prop(R12b, 'plant_rack', [46.8, 0, 22.4], 0, { length: 3.0, tiers: 3, light: 'magenta', crop: 'herbs' });
prop(R12b, 'plant_rack', [44.0, 0, 24.4], 0, { length: 2.6, tiers: 3, light: 'white', crop: 'greens' });
prop(R12b, 'hydro_trough', [40.6, 0, 14.95], 0, { length: 2.6 });
prop(R12b, 'hydro_trough', [47.4, 0, 14.95], 0, { length: 2.6 });
prop(R12b, 'hydro_workstation', [44.0, 0, 14.8], 180);
prop(R12b, 'harvest_cart', [48.9, 0, 20.6], 90);
for (const [z, period, offset, sputter] of [
  [16.4, 9.6, 0.4, false],
  [18.8, 11.4, 3.8, true],
  [21.2, 12.8, 7.1, false],
  [23.6, 10.5, 5.2, false],
]) prop(R12b, 'mister', [44.0, 0, z], 0, { length: 8, period, offset, ...(sputter ? { sputter: true } : {}) });
// R12c Propagation & Harvest Prep Lab: germination incubator, lab bench, cold-storage seed vault, harvest cart (all strictly within bounds).
prop(R12c, 'germination_cabinet', [52.0, 0, 14.68], 180, { width: 1.8 });
prop(R12c, 'lab_bench', [53.32, 0, 19.5], 270, { width: 2.6 });
prop(R12c, 'seed_vault', [52.2, 0, 21.38], 0, { width: 1.4 });
prop(R12c, 'harvest_cart', [50.95, 0, 20.6], 0);
// R12d Fertigation & Climate Plant Room: industrial A/B nutrient mixing tanks, HVAC dehumidifier with live humidity fault beacon, telemetry console.
prop(R12d, 'fertigation_tank', [43.8, 0, 28.9], 0, { label: 'TANK A · NITROGEN', fluid: 'blue' });
prop(R12d, 'fertigation_tank', [45.6, 0, 28.9], 0, { label: 'TANK B · MINERALS', fluid: 'amber' });
prop(R12d, 'hvac_dehumidifier', [42.78, 0, 27.15], 270);
prop(R12d, 'pipe_run', [44.8, 0, 26.52], 0, { length: 3.0, height: 0.55, paint: 'teal' });
prop(R12d, 'valve', [46.5, 0, 26.75]);
prop(R12d, 'console', [48.6, 0, 29.28], 0, { screen: 'hydro' });
// R12e Hydroponics Storeroom: fertiliser pallet + shelf near entry, hidden camp cot + desk + kettle & framed dog photo (no radio: station-blackout keeps TAG FM in the kitchen).
prop(R12e, 'fertiliser_pallet', [38.8, 0, 27.1], 270);
prop(R12e, 'storage_shelf', [38.6, 0, 28.85], 270, { width: 1.5 });
prop(R12e, 'camp_cot', [41.25, 0, 27.4], 90);
prop(R12e, 'desk', [40.65, 0, 29.3], 0, { width: 1.3 });
prop(R12e, 'chair', [40.45, 0, 28.58]);
prop(R12e, 'kettle_set', [40.42, 0.78, 29.3], 0);
anchor(R12a, 'hydro_entry', [36.0, 0, 20.0], 270);
anchor(R12b, 'hydro_log', [44.0, 1.2, 14.8]);
anchor(R12b, 'cp_round_hydro', [44.0, 0, 19.8], 180);
anchor(R12b, 'botanist_1_spot', [43.8, 0, 17.8], 90);
anchor(R12b, 'botanist_2_spot', [44.2, 0, 22.4], 270);
anchor(R12d, 'hydro_alarm', [48.6, 1.2, 29.28]);
anchor(R12e, 'hydro_store_moment', [39.9, 0, 27.5], 180);
npc(R12b, 'botanist_1', 'botanist', 'botanist_1_spot', 'crouchWork', { roam: ['R12b', 'R12d'] });
npc(R12b, 'botanist_2', 'botanist', 'botanist_2_spot', 'clipboard', { roam: ['R12b'] });
npc(R12c, 'botanist_3', 'botanist', [52.35, 0, 19.5], 'typing', { yaw: 270, roam: ['R12c'] });
trigger(R12a, 'trig_hydro_enter', cellBox(9, 9, 5, 5), 'trigger:hydro_enter', { once: false });
trigger(R12b, 'trig_hydro_log', around([44.0, 0, 15.7], 0.85, 2), 'round:hydro_log', { on: 'use', prompt: 'Sign irrigation log' });
trigger(R12d, 'trig_hydro_alarm', around([48.6, 0, 28.4], 0.85, 2), 'round:hydro_alarm', { on: 'use', prompt: 'Reset humidity alarm' });
trigger(R12e, 'trig_hydro_store', cellBox(10, 10, 7, 7), 'trigger:hydro_store_enter');

// ---------------------------------------------------------------- R13 dive bay hub
// rebuild-dive-bay: neutral work light and thin fog; the only strong blue comes up out of the launch trunk.
const DIVE = { fog: '#0b1316', fogDensity: 0.015, reverb: 'metal_hall', ambience: 'dive_drip' };
const WORK = '#eef4f6';
const R13a = room('R13a', 'Wet Vestibule', [[6, 7]], { area: 'dive_bay', atmosphere: { ...DIVE, reverb: 'metal_corridor' }, floor: 'floor_grate', ceiling: 'ceiling_pipes', lights: [L(0, 'steady', WORK, 8, undefined, { shaft: 0.01 })] });
const R13b = room('R13b', 'Launch Hall', rect(5, 7, 8, 10), {
  area: 'dive_bay',
  height: 5,
  atmosphere: { ...DIVE, ambience: 'launch_bay' },
  floor: 'floor_grate',
  floorOverride: { '6,9': 'floor_moonpool' },
  ceiling: 'ceiling_pipes',
  // Five neutral work lights, and the trunk's own shaft lamp (its only wall slot) throwing blue up out of the trunk.
  lights: [...[0, 2, 4, 6, 8].map((slot) => L(slot, 'steady', WORK, slot === 4 ? 14 : 13, undefined, { shaft: 0.01 })), L('wall', 'steady', '#58c8e0', 7, 9)],
});
const R13c = room('R13c', 'ROV Workshop', [[4, 8], [4, 9]], { area: 'dive_bay', atmosphere: { ...DIVE, reverb: 'small_office' }, floor: 'floor_tiles', lights: [L(0, 'steady', WORK, 7), L(1, 'steady', WORK, 6)] });
const R13d = room('R13d', 'Maintenance Corridor', rect(8, 10, 8, 8), {
  area: 'dive_bay',
  // The only decayed room in the bay (rebuild-dive-bay): rust by override so the dive map still reveals it.
  wallMaterial: 'rustBlotch',
  ceilingMaterial: 'paintDark',
  floorMaterial: 'diamondRusty',
  atmosphere: { fog: '#020405', fogDensity: 0.09, ambient: 'dark', reverb: 'metal_corridor', ambience: 'hull_groan' },
  ceiling: 'ceiling_pipes',
  walls: ['wall_plain', 'wall_vent'],
  lights: [L(2, 'dying', '#ffcf9a', 3, 6)],
});
const R13e = room('R13e', 'Sample Store', [[4, 10]], { area: 'dive_bay', atmosphere: { ...DIVE, reverb: 'small_office' }, floor: 'floor_tiles', lights: [L(0, 'steady', WORK, 7)] });
door('D_R02_R13a', 'R02', 'R13a', 6, 6, 's');
door('D_R13a_R13b', 'R13a', 'R13b', 6, 7, 's');
door('D_R13b_R13c', 'R13b', 'R13c', 5, 8, 'w');
// The unfinished maintenance corridor is shut from the dive bay all game (dive-bay spec); the climax opens it from R11.
door('D_R13b_R13d', 'R13b', 'R13d', 7, 8, 'e', { access: { sealed: true, text: 'out_of_service' } });
door('D_R13b_R13e', 'R13b', 'R13e', 5, 10, 'w');
door('D_R13d_R11', 'R13d', 'R11', 9, 8, 's', { kit: 'bulkhead', access: { sealed: true, text: 'lockdown' } });
station(R13a, 'dive_map', 'dive_bay', 6, 7, 'w');
// R13a wet vestibule: boot wash and coveralls on the east wall, a grated wash mat over the drain on the centreline.
wallProp(R13a, 'boot_wash', 6, 7, 'e', -0.9, { width: 1.3 }, 0.01);
wallProp(R13a, 'coverall_hooks', 6, 7, 'e', 0.8, { count: 3 }, 0.01);
prop(R13a, 'boot_wash_mat', [24, 0, 28.0], 0, { width: 1.4, depth: 1.0 });
// R13b launch-and-recovery hall (rebuild-dive-bay, design.md §5): gantry over the recovered ROV, pilot console on the
// north wall, wet bench and core rack on the west wall, winch in the south-east, eyewash and tool board on the south wall.
prop(R13b, 'gantry_crane', [24, 0, 36], 0, { width: 10.2, length: 10, height: 4.5, bridge: 2.4, trolley: 4.4, hook: 2.15 });
prop(R13b, 'rov', [28.4, 0, 38.4], 90, { name: 'NEREUS' });
prop(R13b, 'tether_winch', [28.7, 0, 40.55], 0);
prop(R13b, 'pilot_console', [28.0, 0, 30.75], 180);
wallProp(R13b, 'whiteboard', 5, 8, 'n', -0.4, { lines: 'DIVE 214 · TRENCH WALL|ROV: NEREUS   PILOT: SUNG|TASK: 6 CORES FOR LAB B|RECOVERED 06:42 · CASE TO COLD STORE|NEXT: DIVE 215 — TBC|!KEEP TRUNK GATE SHUT' });
wallProp(R13b, 'wet_bench', 5, 9, 'w', 0, { width: 2.2 }, 0.01);
wallProp(R13b, 'core_rack', 5, 9, 'w', -2.0, undefined, 0.01);
wallProp(R13b, 'eyewash_station', 5, 10, 's', 0.7, undefined, 0.01);
wallProp(R13b, 'shadow_board', 6, 10, 's', 0, undefined, 0.01);
prop(R13b, 'pipe_run', [24.5, 0, 41.4], 0, { length: 8, height: 0.4, paint: 'teal' });
prop(R13b, 'crate', [26.5, 0, 40.65], 10, { size: 0.6 });
// Signage (task 5.1): a plate and life-support panel by each entry, pipe labels on the service runs.
wallProp(R13a, 'room_sign', 6, 7, 'w', 1.1, { code: 'R13A', name: 'WET VESTIBULE', warn: 'WET AREA · NON-SLIP BOOTS', y: 2.2, co2: 610, rh: 78 }, 0.01);
wallProp(R13b, 'room_sign', 5, 8, 'n', 1.3, { code: 'R13B', name: 'LAUNCH HALL', warn: 'KEEP TRUNK GATE SHUT', co2: 650, rh: 81 }, 0.01);
wallProp(R13c, 'room_sign', 4, 9, 'e', -0.95, { code: 'R13C', name: 'ROV WORKSHOP', co2: 720, rh: 64 }, 0.01);
wallProp(R13e, 'room_sign', 4, 10, 's', -1.05, { code: 'R13E', name: 'SAMPLE STORE', warn: 'LAB B CHAIN OF CUSTODY', co2: 590, rh: 55 }, 0.01);
wallProp(R13d, 'room_sign', 8, 8, 'n', -1.2, { code: 'R13D', name: 'MAINTENANCE', panel: false }, 0.01);
prop(R13b, 'pipe_labels', [24.5, 0, 41.4], 0, { length: 8, y: 0.4, radius: 0.1, labels: 'SEAWATER COOLING:#2f7a3a|HYDRAULIC RETURN:#b4551c' });
prop(R13d, 'pipe_labels', [36, 0, 33.4], 0, { length: 11, y: 0.5, radius: 0.1, labels: 'SEAWATER COOLING:#2f7a3a|HYDRAULIC SUPPLY:#b4551c|FRESH WATER:#2b5d8a' });
// Wear by rule (task 5.2): wet where water is, oil under the workshop bench, salt rings at drains and doors.
for (const [x, z, w, d, rot] of [[24, 33.9, 2.6, 0.7, 0], [21.8, 36, 2.4, 0.6, 90], [24, 38.15, 2.4, 0.6, 180], [27.3, 38.4, 1.4, 1.0, 0]]) prop(R13b, 'floor_wear', [x, 0, z], rot, { kind: 'puddle', width: w, depth: d });
prop(R13b, 'floor_wear', [22.4, 0, 31.6], 20, { kind: 'prints', width: 0.9, depth: 2.4 });
prop(R13b, 'floor_wear', [19.5, 0, 36.6], 0, { kind: 'salt', width: 0.9, depth: 0.8 });
prop(R13a, 'floor_wear', [25.2, 0, 27.1], 0, { kind: 'puddle', width: 0.9, depth: 1.3 });
prop(R13a, 'floor_wear', [24.1, 0, 26.9], 0, { kind: 'prints', width: 0.9, depth: 1.6 });
prop(R13a, 'floor_wear', [24, 0, 28.0], 0, { kind: 'salt', width: 1.6, depth: 1.2 });
prop(R13a, 'floor_wear', [25.3, 0, 28.8], 90, { kind: 'puddle', width: 1.4, depth: 0.5 });
prop(R13c, 'floor_wear', [14.9, 0, 35.5], 0, { kind: 'oil', width: 0.9, depth: 1.6 });
prop(R13c, 'floor_wear', [17.2, 0, 36.6], 0, { kind: 'puddle', width: 0.7, depth: 0.7 });
prop(R13c, 'floor_wear', [17.2, 0, 32], 90, { kind: 'prints', width: 0.9, depth: 1.4 });
prop(R13c, 'floor_wear', [16.5, 0, 33.6], 30, { kind: 'oil', width: 0.6, depth: 0.5 });
prop(R13e, 'floor_wear', [15.2, 0, 38.95], 0, { kind: 'puddle', width: 0.9, depth: 0.5 });
prop(R13e, 'floor_wear', [15.4, 0, 41.0], 0, { kind: 'puddle', width: 1.4, depth: 0.45 });
prop(R13e, 'floor_wear', [17.2, 0, 40], 90, { kind: 'prints', width: 0.9, depth: 1.2 });
prop(R13e, 'floor_wear', [15.6, 0, 40], 0, { kind: 'salt', width: 0.8, depth: 0.8 });
// R13c ROV workshop: bench and battery charger on the west wall, parts bins on the north, gas and hose to the south-east.
wallProp(R13c, 'workbench', 4, 9, 'w', 0.5, { width: 2.4 }, 0.01);
wallProp(R13c, 'battery_charger', 4, 8, 'w', 0.5, undefined, 0.01);
prop(R13c, 'platform_trolley', [16.4, 0, 34.9], 0, { id: 'rov_trolley' }, { dynamic: { mass: 45 } });
wallProp(R13c, 'parts_bins', 4, 8, 'n', 0, { width: 1.6 }, 0.01);
wallProp(R13c, 'gas_cylinder_rack', 4, 9, 's', -1.0, undefined, 0.01);
wallProp(R13c, 'hose_reel', 4, 9, 'e', 0.6, undefined, 0.01);
prop(R13d, 'pipe_run', [36, 0, 33.4], 0, { length: 11, height: 0.5, paint: 'dark' });
prop(R13d, 'crate', [41, 0, 30.8], 15, { size: 0.7 });
prop(R13d, 'debris_pile', [37.6, 0, 31.2]);
// R13e sample store: the Lab B cold store (the stow point) on the west wall, fridges on the south, freezer, pressure
// cabinet and survival suits on the north.
wallProp(R13e, 'cold_store', 4, 10, 'w', 0, undefined, 0.01);
wallProp(R13e, 'core_fridge', 4, 10, 's', 0.6, undefined, 0.01);
wallProp(R13e, 'freezer', 4, 10, 'n', -1.0, undefined, 0.01);
wallProp(R13e, 'pressure_cabinet', 4, 10, 'n', 0.1, undefined, 0.01);
wallProp(R13e, 'survival_suits', 4, 10, 'n', 1.15, { count: 3 }, 0.01);
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
// A hissing leak on the R13d pipe run (rebuild-dive-bay): steam puff, and `trigger:dive_leak` plays the hiss.
prop(R13d, 'pipe_leak', [38.5, 0.5, 33.4], 0);
anchor(R13d, 'dive_leak', [38.5, 0.6, 33.4]);
npc(R13b, 'diver_1', 'diver', [26.4, 0, 35.4], 'idle_hips');
npc(R13b, 'maint_1', 'maintenance', [26.6, 0, 37.9], 'crouchWork', { yaw: 270 }); // at the ROV's core basket
npc(R13e, 'diver_2', 'diver', [16.6, 0, 39.4], 'idle_weight');
trigger(R13a, 'trig_dive_enter', cellBox(6, 6, 7, 7), 'trigger:dive_enter', { once: false });
trigger(R13d, 'trig_dive_dark', cellBox(8, 8, 8, 8), 'area:dark');
trigger(R13d, 'trig_dive_leak', around([38.5, 0, 32.9], 1.4, 2.2), 'trigger:dive_leak', { once: false });
trigger(R13e, 'trig_dive_case', around([15.6, 0, 40], 0.8, 2), 'round:dive_case', { on: 'use', prompt: 'Stow sample case', once: false });
trigger(R13e, 'trig_dive_lockers', cellBox(4, 4, 10, 10), 'trigger:dive_lockers_enter', { once: false });

// ---------------------------------------------------------------- R14 TAG admin office hub
const ADMIN = { fog: '#14110e', fogDensity: 0.012, ambient: 'admin', reverb: 'small_office', ambience: 'office_hvac' };
const R14a = room('R14a', 'TAG Reception', [[9, 2], [9, 3]], {
  area: 'admin',
  atmosphere: ADMIN,
  floor: 'floor_carpet',
  walls: ['wall_wood'],
  lights: [
    L(0, 'steady', '#ffebd0', 13, 12, { shaft: 0.01, emissive: 2.2 }),
    L(1, 'steady', '#ffebd0', 13, 12, { shaft: 0.01, emissive: 2.2 }),
  ],
});
const R14b = room('R14b', 'Open Office', rect(10, 12, 1, 2), {
  area: 'admin',
  atmosphere: ADMIN,
  floor: 'floor_carpet',
  walls: ['wall_wood'],
  noDeadFixtures: true,
  lights: [
    L(0, 'steady', '#fff0d8', 14, 13, { shaft: 0.01, emissive: 2.2 }),
    L(2, 'steady', '#fff0d8', 14, 13, { shaft: 0.01, emissive: 2.2 }),
    L(4, 'steady', '#ffebd0', 14, 13, { shaft: 0.01, emissive: 2.2 }),
  ],
});
const R14c = room('R14c', "Director's Office", [[13, 1], [13, 2]], {
  area: 'admin',
  atmosphere: { ...ADMIN, fog: '#14100c' },
  floor: 'floor_carpet',
  walls: ['wall_wood'],
  lights: [
    L(0, 'steady', '#ffd8a6', 10, 11, { shaft: 0.015, emissive: 1.9 }),
    L(1, 'steady', '#ffd096', 14, 12, { drop: 0.4, shaft: 0.015, emissive: 2.1 }),
  ],
});
// 3x2 executive boardroom (12 m x 8 m) with > 2.3 m walkway around the conference table and chairs.
const R14d = room('R14d', 'Boardroom', rect(10, 12, -1, 0), {
  area: 'admin',
  atmosphere: { ...ADMIN, fogDensity: 0.011 },
  floor: 'floor_carpet',
  walls: ['wall_wood'],
  noDeadFixtures: true,
  lights: [
    L(0, 'steady', '#ffebd0', 13, 13, { shaft: 0.01, emissive: 2.1 }),
    L(2, 'steady', '#ffe4be', 13, 13, { shaft: 0.01, emissive: 2.1 }),
    L(4, 'steady', '#ffdcad', 16, 14, { drop: 0.85, shaft: 0.018, emissive: 2.2 }),
  ],
});
const R14e = room('R14e', 'Security Booth', [[9, 1]], {
  area: 'admin',
  atmosphere: { fog: '#0b0e12', fogDensity: 0.02, ambient: 'normal', reverb: 'small_office', ambience: 'office_hvac' },
  ceilingMaterial: 'boltPanel',
  floor: 'floor_carpet',
  walls: ['wall_wood'],
  lights: [L(0, 'steady', '#b8d8ff', 10, 9, { shaft: 0.025, emissive: 2.2 })],
});
wallKit(R14c, 13, 1, 'n', 'wall_sanity_screen');
wallKit(R14c, 13, 1, 'e', 'wall_sanity_screen');
for (const x of [10, 11, 12]) wallKit(R14d, x, -1, 'n', 'wall_sanity_screen');
glass('R14b', 10, 1, 'n'); // full-width glass frontage into the 3x2 boardroom
glass('R14b', 12, 1, 'n');
glass('R14b', 12, 2, 'e'); // Hale's office behind glass
door('D_R02_R14a', 'R02', 'R14a', 8, 3, 'e', { kit: 'glass_slide' });
door('D_R14a_R14b', 'R14a', 'R14b', 9, 2, 'e', { kit: 'glass_slide' });
door('D_R14b_R14c', 'R14b', 'R14c', 12, 1, 'e', { kit: 'glass_slide' });
door('D_R14b_R14d', 'R14b', 'R14d', 11, 1, 'n', { kit: 'glass_slide' });
door('D_R14a_R14e', 'R14a', 'R14e', 9, 2, 'n');
station(R14a, 'admin_map', 'admin', 9, 3, 's');
// Reception desk on the east side of [9,3]: monitor faces east toward the seated assistant, who faces west toward arriving visitors.
workstation(R14a, [36.5, 0, 10.7], 270, {
  width: 2,
  papers: 4,
  npc: { id: 'assistant', look: 'assistant', pose: 'sit_typing' },
});
// Waiting sofa flush against the west wall of [9,2], facing east (rot 270) into reception, poster centred above it.
prop(R14a, 'sofa', [34.72, 0, 8.4], 270, { width: 1.8, tone: 'warm' });
npc(R14a, 'admin_visitor', 'lab', [34.72, 0, 8.4], undefined, { spot: 'sit_sofa', model: 'scientist1' });
wallProp(R14a, 'tag_poster', 9, 2, 'w', 0.4, { slogan: 'THE FUTURE IS DEEP.' });
for (const [x, z, kind] of [[34.65, 6.65, 'palm'], [37.35, 13.35, 'fern'], [37.35, 6.65, 'tall']]) prop(R14a, 'potted_plant', [x, 0, z], 0, { kind, pot: 'white', size: 1.0 });
// Open office: four workstations facing north (rot 180 puts sitter/chair on south side facing the screen), leaving clear aisles to all 3 doors.
workstation(R14b, [40.6, 0, 3.2], 180, {
  width: 1.6,
  papers: 2,
  npc: { id: 'exec_2', look: 'exec', pose: 'sit_typing', extra: { model: 'office1' } },
});
workstation(R14b, [46.8, 0, 3.2], 180, { width: 1.6, papers: 2 });
workstation(R14b, [41.6, 0, 7.4], 180, { width: 1.6, papers: 2 });
workstation(R14b, [45.6, 0, 7.4], 180, {
  width: 1.6,
  papers: 2,
  npc: { id: 'exec_4', look: 'exec', pose: 'sit_typing', extra: { model: 'botanist2' } },
});
prop(R14b, 'bookshelf', [48.4, 0, 9.52], 0, { width: 1.6 });
for (const [x, z, kind] of [[38.65, 2.65, 'tall'], [49.35, 2.65, 'fern'], [38.65, 9.35, 'shrub'], [43.6, 9.35, 'palm']]) prop(R14b, 'potted_plant', [x, 0, z], 0, { kind, pot: 'white' });
prop(R14b, 'hanging_plant', [43.6, 0, 5.6], 0, { drop: 0.7, pot: 'white' });
// Director's office: executive desk faces west toward the door (rot 270 puts Hale's chair on the east side facing west).
workstation(R14c, [52.4, 0, 6.2], 270, { width: 2.2, exec: true, papers: 4, fixedChair: true });
prop(R14c, 'bookshelf', [53.52, 0, 8.6], 90, { width: 1.6, height: 2.2 });
prop(R14c, 'sofa', [51.4, 0, 9.28], 0, { width: 1.8, tone: 'warm' });
prop(R14c, 'potted_plant', [50.65, 0, 2.65], 0, { kind: 'palm', pot: 'dark', size: 1.2 });
prop(R14c, 'potted_plant', [53.35, 0, 2.65], 0, { kind: 'fern', pot: 'dark' });
wallProp(R14c, 'tag_poster', 13, 2, 's', 0, { slogan: 'TAG INDUSTRIES - 40 YEARS DEEP', width: 1.1 });
// Executive boardroom: dark-wood conference table under brass pendants, live TAG slide deck, coffee credenza, and active 4-person meeting.
prop(R14d, 'conference_table', [44.0, 0, -2.0], 0, { width: 4.4, depth: 1.3, sideSeats: 3, endEast: true });
prop(R14d, 'pendant_light', [44.0, 0, -2.0], 0, { ceiling: 3.2, drop: 1.05, count: 3, spacing: 1.4, shade: 'brass' });
prop(R14d, 'wall_screen', [38.31, 0, -2.0], 270, { id: 'admin_tv', width: 3.0, channel: 'boardroom', state: 'on' });
prop(R14d, 'credenza', [49.45, 0, -2.0], 90, { width: 2.6 });
prop(R14d, 'bookshelf', [49.55, 0, 0.35], 90, { width: 1.4, height: 2.2 });
prop(R14d, 'tag_poster', [49.69, 0, -4.4], 90, { slogan: 'DEEPER. FURTHER. TOGETHER.', width: 1.0 });
prop(R14d, 'potted_plant', [38.7, 0, -5.25], 0, { kind: 'palm', pot: 'dark', size: 1.1 });
prop(R14d, 'potted_plant', [49.25, 0, -5.25], 0, { kind: 'tall', pot: 'white', size: 1.0 });
prop(R14d, 'potted_plant', [38.7, 0, 1.25], 0, { kind: 'fern', pot: 'white', size: 1.0 });
npc(R14d, 'board_1', 'exec', [42.5, 0, -3.07], undefined, { spot: 'sit_chair', chat: 'admin_boardroom', model: 'office1' });
npc(R14d, 'board_2', 'exec', [45.5, 0, -3.07], undefined, { spot: 'sit_chair', chat: 'admin_boardroom', model: 'office2' });
npc(R14d, 'board_3', 'lab', [44.0, 0, -0.93], undefined, { spot: 'sit_chair', chat: 'admin_boardroom', model: 'scientist1' });
npc(R14d, 'board_4', 'exec', [40.5, 0, -2.0], 'idle', { yaw: 270, chat: 'admin_boardroom', model: 'office3' });
prop(R14e, 'security_monitor', [36, 0, 2.8], 180, { id: 'admin_cam', camera: 'CAM 04  MEDICAL BAY', feed: 'live' });
prop(R14e, 'chair', [35.2, 0, 3.9], 0, { fixed: true });
pickups.push({ id: 'P_card_l2', room: 'R14c', item: 'card_l2', pos: [52.4, 0.78, 5.5], rot: 15 });
// The divers' sample case (ADR-0023 dive round): lies at the moon pool's rim until Jay takes it.
pickups.push({ id: 'P_sample_case', room: 'R13b', item: 'sample_case', pos: [21.4, 0.02, 37.2], rot: 80 });
anchor(R14a, 'admin_entry', [35, 0, 12], 90);
anchor(R14c, 'hale_desk', [52.4, 0.8, 6.2]);
anchor(R14c, 'hale_stand', [52.4, 0, 8.3], 90);
anchor(R14c, 'cp_round_admin', [51, 0, 5.4], 270);
anchor(R14e, 'admin_cam_monitor', [36, 1.4, 2.6]);
anchor(R14e, 'admin_cam_view', [36.4, 0, 4.2], 0);
npc(R14b, 'exec_1', 'exec', [44.2, 0, 5.6], 'idle', { yaw: 90, chat: 'admin_hall', model: 'office3' });
npc(R14b, 'exec_3', 'exec', [43.2, 0, 5.6], 'clipboard', { yaw: 270, chat: 'admin_hall', model: 'office2' });
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

// Wall loudspeakers. Small adjoining vestibules share a fixture with the room at their door.
wallProp(R01, 'pa_speaker', 0, 0, 'w', 1, { id: 'pa_dock', serves: 'R01a' }, 0.012);
wallProp(R01w, 'pa_speaker', 5, 0, 's', -0.9, { id: 'pa_walk' }, 0.012);
wallProp(R02, 'pa_speaker', 7, 3, 'n', 1, { id: 'pa_commons' }, 0.012);
wallProp(R03, 'pa_speaker', 1, 4, 'n', 1, { id: 'pa_gallery' }, 0.012);
// The lab wing's PA (station-power spec: the power-failure notice is heard in the Lab Junction and Lab B).
wallProp(R05, 'pa_speaker', 0, 4, 'n', 1.4, { id: 'pa_lab_junction', serves: 'R04' }, 0.012);
wallProp(R12b, 'pa_speaker', 10, 4, 'w', -1, { id: 'pa_grow', serves: 'R12a' }, 0.012);
wallProp(R12c, 'pa_speaker', 13, 5, 's', 1, { id: 'pa_seed' }, 0.012);
wallProp(R12d, 'pa_speaker', 11, 7, 's', 1, { id: 'pa_nutrients' }, 0.012);
wallProp(R12e, 'pa_speaker', 10, 7, 'w', 1, { id: 'pa_hydro_store' }, 0.012);
wallProp(R13b, 'pa_speaker', 7, 8, 'n', -0.9, { id: 'pa_moon_pool', serves: 'R13a' }, 0.012);
wallProp(R13c, 'pa_speaker', 4, 8, 'n', 1, { id: 'pa_workshop' }, 0.012);
wallProp(R13d, 'pa_speaker', 8, 8, 'n', 1, { id: 'pa_maintenance' }, 0.012);
wallProp(R13e, 'pa_speaker', 4, 10, 's', 1, { id: 'pa_sample_store' }, 0.012);
wallProp(R14a, 'pa_speaker', 9, 2, 'w', 1, { id: 'pa_reception', serves: 'R14e' }, 0.012);
wallProp(R14b, 'pa_speaker', 10, 2, 's', -1, { id: 'pa_office' }, 0.012);
wallProp(R14c, 'pa_speaker', 13, 2, 's', 1, { id: 'pa_director' }, 0.012);
wallProp(R14d, 'pa_speaker', 12, -1, 'e', 1, { id: 'pa_boardroom' }, 0.012);

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
  return new Set(['group', 'active', 'variant', 'count', 'interval', 'yaw', 'outfit', 'infection', 'model', 'look', 'on', 'float'].filter((f) => new RegExp(`\\b${f}\\b`).test(body)));
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
  // Glass is see-through from both sides: pair each glass owner with the room behind its pane.
  for (const [ek, ownerId] of glassEdges) {
    const [nx, nz] = ek.split(',');
    const behind = seen.get(`${nx},${nz}`);
    if (!behind) throw new Error(`glass owned by ${ownerId} at edge ${ek} has no room behind it`);
    seeEachOther(ownerId, behind);
  }
  const out = [];
  for (const r of rooms) {
    const inRoom = new Set(r.cells.map(([x, z]) => `${x},${z}`));
    const pieces = [];
    const group = new Map();
    const put = (kit, cell, rot, params) => {
      const key = `${kit}|${rot}|${params ? JSON.stringify(params) : ''}`;
      if (!group.has(key)) group.set(key, { kit, rot, params, cells: [] });
      group.get(key).cells.push(cell);
    };
    const ceilParams = r.ceilingMaterial ? { material: r.ceilingMaterial } : undefined;
    const wallParams = r.wallMaterial ? { material: r.wallMaterial } : undefined;
    // Ceilings first, one entry per cell, so numeric light slots follow the cell order.
    // When `noDeadFixtures` is set, unclaimed ceiling tiles omit housings (`fixture: false`) and
    // claimed numeric light slots remap onto the emitted fixture slots.
    const litCells = r.noDeadFixtures ? new Set(r.lights.filter((l) => typeof l.slot === 'number').map((l) => l.slot)) : null;
    const slotMap = new Map();
    let nextSlot = 0;
    r.cells.forEach(([x, z], i) => {
      const c = { kit: r.ceiling === 'ceiling_pipes' && i % 2 === 0 ? 'ceiling' : r.ceiling, cell: [x, 0, z] };
      const p = { ...(ceilParams ?? {}) };
      if (litCells && !litCells.has(i)) p.fixture = false;
      else slotMap.set(i, nextSlot++);
      if (Object.keys(p).length) c.params = p;
      pieces.push(c);
    });
    for (const [x, z] of r.cells) {
      put(r.floorOverride[`${x},${z}`] ?? r.floor, [x, 0, z], 0, r.floorParams[`${x},${z}`] ?? (r.floorMaterial ? { material: r.floorMaterial } : undefined));
      for (const s of ['n', 'e', 's', 'w']) {
        const [nx, nz] = neighbour(x, z, s);
        if (inRoom.has(`${nx},${nz}`)) continue;
        const ek = edgeKey(x, z, s);
        if (doorEdges.has(ek) || glassEdges.has(ek) || openEdges.has(ek)) continue;
        const kit = r.wallOverride[ek] ?? r.walls[Math.abs(x * 7 + z * 3 + s.charCodeAt(0)) % r.walls.length];
        put(kit, [x, 0, z], WALL_ROT[s], r.wallParams?.[ek] ?? wallParams);
      }
    }
    for (const g of group.values()) {
      const p = { kit: g.kit, cells: g.cells };
      if (g.params) p.params = g.params;
      if (g.rot) p.rot = g.rot;
      pieces.push(p);
    }
    for (const p of r.extraPieces) pieces.push(p);
    const o = { id: r.id, name: r.name };
    if (r.area) o.area = r.area;
    if (r.hidden) o.hidden = true;
    if (r.height !== 3.2) o.height = r.height;
    if (r.floorY !== undefined) o.floorY = r.floorY;
    if (r.water) o.water = r.water;
    if (r.atmosphere) o.atmosphere = r.atmosphere;
    if (r.visibleFrom) o.visibleFrom = r.visibleFrom;
    o.pieces = pieces;
    if (r.props.length) o.props = r.props;
    if (r.lights.length) o.lights = litCells ? r.lights.map((l) => (typeof l.slot === 'number' ? { ...l, slot: slotMap.get(l.slot) } : l)) : r.lights;
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
    if (r.walks.length) o.walks = r.walks;
    out.push(o);
  }
  return {
    id: 'slice01',
    name: 'Slice 01: Thalassa Deep',
    seed: 1337,
    playerStart: { room: 'R01', pos: [6.95, 0, 4.3], yaw: 2 },
    squadStart: { engineer: [0.65, 0, -4.55], medic: [-0.65, 0, -4.55] },
    rooms: out,
    doors,
    vents,
    pickups,
    mapStations,
    checkpoints,
  };
}

// Station blackout (render-lighting spec "Backup lights"): the wall beacons on the post-lab path are claimed as
// standby lights, dark on main power and lit under backup power. R10's beacon is already the scripted r10_beacon.
// The Commons and the Medical Bay get one each: on the Commons' west wall above the vending machine, and on the
// Medical Bay's west wall above the console (west-wall beacons face rot 90, as in R06 and R07).
prop(R02, 'emergency_beacon', [14.3, 3.0, 20], 90, { wall: true });
prop(R08, 'emergency_beacon', [-5.7, 2.6, 50], 90, { wall: true });
// R09 authors its own red beacons (overhaul-flooded-tunnel), so it takes no standby beacon here.
for (const [r, n] of [[R02, 1], [R05, 1], [R06, 2], [R07, 1], [R08, 1], [R11, 2]]) for (let i = 0; i < n; i++) r.lights.push(L('emergency', 'off'));

SPAWN_FIELDS = await detectSpawnFields();
const level = build();
if (process.argv.includes('--check')) {
  for (const r of rooms) console.log(r.id.padEnd(5), r.name.padEnd(28), r.cells.map((c) => c.join(',')).join(' '));
} else {
  writeFileSync(OUT, `${JSON.stringify(level, null, 1)}\n`);
  const n = (k) => level.rooms.reduce((a, r) => a + (r[k]?.length ?? 0), 0);
  console.log(`wrote slice01.json: ${level.rooms.length} rooms, ${level.doors.length} doors, ${n('props')} props, ${n('anchors')} anchors, ${n('npcs')} npcs, ${n('triggers')} triggers, ${n('spawns')} spawns; spawn extras kept: ${[...SPAWN_FIELDS].join(', ') || 'none (schema has no group yet)'}`);
}
