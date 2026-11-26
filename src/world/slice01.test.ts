import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as THREE from 'three';
import { validate } from '../core/validate.ts';
import { EventBus } from '../core/events.ts';
import { validateItemTable } from '../data/types/items.ts';
import { levelValidator, type LevelData } from '../data/types/level.ts';
import { validateUiText } from '../data/types/uiText.ts';
import { Inventory } from '../game/inventory.ts';
import type { Materials } from '../render/materials.ts';
import { withVertexColors } from './kit/merge.ts';
import { floorSurfaceForKey } from './kit/palettes.ts';
import { Rng } from '../core/rng.ts';
import type { Interactable, Interactions } from '../actors/interaction.ts';
import { DEFAULT_MOTOR, moveBody, type MotorState } from '../actors/motor.ts';
import type { P3 } from '../ai/nav.ts';
import { GIVE_WAY } from '../ai/giveWay.ts';

// slice01 (ADR-0014/0023, intro-sequence spec): the level validates, builds headlessly (no WebGL, a stub 2D
// canvas), provides every anchor the draft sequences use, reports each room's draw calls,
// and a body can walk the critical path through the real colliders and doors.

// ---- headless stubs: canvas 2D contexts that draw nothing
const noop = (): void => undefined;
const ctx = new Proxy({} as Record<string | symbol, unknown>, {
  get: (t, k) => (k in t ? t[k] : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop: noop }) : k === 'measureText' ? () => ({ width: 10 }) : k === 'getImageData' ? (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }) : noop),
  set: (t, k, v) => ((t[k] = v), true),
});
(globalThis as { Path2D?: unknown }).Path2D ??= function Path2D(): unknown {
  return new Proxy({}, { get: () => noop });
};
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ width: 1, height: 1, getContext: () => ctx, style: {} }) };

const { KitRegistry } = await import('./registry.ts');
const { Level } = await import('./level.ts');

const json = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const items = validate(validateItemTable, json('../data/items.json'), 'data/items.json');
const ui = validate(validateUiText, json('../data/dialogue/ui.json'), 'data/dialogue/ui.json');
const registry = new KitRegistry({ glb: {} });
const data: LevelData = validate(levelValidator(registry.ids(), { items: new Set(Object.keys(items)), uiText: new Set(Object.keys(ui)) }), json('../data/levels/slice01.json'), 'slice01');

function fakeMaterials(): Materials {
  const s = (color: number): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color });
  return {
    paintTeal: s(0x2f6f70), paintDark: s(0x222222), paintBone: s(0xccccbb), steel: s(0x888888), diamond: s(0x777777),
    grating: s(0x666666), rubber: s(0x111111), hazard: s(0xccaa00),
    labTile: s(0x889096), labPanel: s(0xb2b8bc), concrete: s(0x55585a),
    diamondHazard: s(0x886622), diamondRusty: s(0x775544), hazardClean: s(0xccaa00), rustHeavy: s(0x664433),
    rustDrip: s(0x775533), rustBlotch: s(0x887766), concreteFloor: s(0x55585a), concretePainted: s(0x333537),
    tileBroken: s(0x889096), tileWall: s(0xaaaaaa), tileWashroom: s(0x667777), signDanger: s(0xaa4422),
    servicePaint: s(0x777879), hullPlate: s(0x667076), boltPanel: s(0x778088), steelBrushed: s(0x88929a), deckCorrugated: s(0x444a50),
    acousticCeiling: s(0x9a9e9a), vinylPanel: s(0xb8b0a0), officeCeiling: s(0xccccca), woodPanel: s(0x6a4a30), carpet: s(0x2e3440),
    steelDark: s(0x465058), cleanWall: s(0xb8b6ac), cleanSlate: s(0x62707a), cleanTeal: s(0x3b787c), bloom: s(0xc8c8c8),
    glass: new THREE.MeshPhysicalMaterial({ transparent: true }),
    black: s(0x000000), cable: s(0x111111), glowCyan: s(0x00ffff),
  };
}

function build(inventory: Inventory | null = null): { level: InstanceType<typeof Level>; events: EventBus } {
  const events = new EventBus();
  const level = new Level(data, { materials: fakeMaterials(), registry, events, scene: new THREE.Scene(), inventory, uiText: ui });
  return { level, events };
}

const ROOMS = ['R01', 'R01w', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07', 'R08', 'R09', 'R10', 'R11', 'R12a', 'R12b', 'R12c', 'R12d', 'R12e', 'R13a', 'R13b', 'R13c', 'R13d', 'R13e', 'R14a', 'R14b', 'R14c', 'R14d', 'R14e', 'R15a', 'R16a', 'R16b', 'R16c'];

test('slice01 validates: every ADR-0014/0023 room, areas, map stations, checkpoints', () => {
  const ids = new Set(data.rooms.map((r) => r.id));
  for (const id of ROOMS) assert.ok(ids.has(id), `room ${id}`);
  const areas = new Set(data.rooms.map((r) => r.area));
  for (const a of ['dock', 'commons', 'gallery', 'hydroponics', 'dive_bay', 'admin', 'labs', 'security', 'medbay', 'tunnel', 'transit']) assert.ok(areas.has(a), `area ${a}`);
  assert.deepEqual(new Set((data.mapStations ?? []).map((s) => s.reveals)), new Set(['commons', 'hydroponics', 'dive_bay', 'admin']));
  assert.deepEqual(data.checkpoints.map((c) => c.id), ['cp_first_contact', 'cp_cover_me', 'cp_security', 'cp_flooded', 'cp_climax']);
  assert.deepEqual(data.doors.find((d) => d.id === 'hydro_store')?.access, { requires: 'card_l2' });
  assert.equal(data.pickups?.find((p) => p.item === 'card_l2')?.room, 'R14c');
  // Nothing hostile in the quiet half: every spawn waits for its group.
  const spawns = data.rooms.flatMap((r) => r.spawns ?? []);
  assert.ok(spawns.length >= 5);
  for (const s of spawns) assert.equal(s.active, false, s.id);
  // trim-lab-wing-encounters + finale-transit-rooms-geometry: no combat spawns in R11 Power Bay.
  assert.deepEqual(new Set(spawns.map((s) => s.group)), new Set(['r06_cover', 'r09_tunnel']));
});

test('slice01 builds headlessly; every anchor the draft sequences use exists; NPCs are placed', () => {
  const { level } = build();
  for (const file of ['intro_shift_change', 'briefing_gallery', 'commons', 'rounds', 'drop']) {
    const text = readFileSync(new URL(`../data/sequences/${file}.json`, import.meta.url), 'utf8');
    for (const match of text.matchAll(/"fixture":\s*"([^"]+)"/g)) {
      assert.ok(level.paSpeakerAt(level.spawn.position, match[1]), `${file}: fixture ${match[1]}`);
    }
    const names = [...new Set([...text.matchAll(/"anchor:([A-Za-z0-9_-]+)"/g)].map((m) => m[1]!))];
    assert.ok(names.length >= (file === 'drop' ? 1 : 3), file);
    for (const n of names) assert.ok(level.anchor(n), `${file}: anchor:${n}`);
  }
  for (const n of ['dock_door', 'dock_window', 'post_front', 'abyss_window_walk', 'window_jay', 'window_giles', 'window_okafor', 'kitchen_door', 'kitchen_stand', 'counter', 'counter_giles', 'counter_okafor', 'priya_enter', 'priya_offer', 'priya_walkout', 'priya_offstage']) assert.ok(level.anchor(n), `intro-sequence anchor ${n}`);
  assert.equal(level.anchor('priya_exit'), null, 'the old doorway spot is gone (priya-commons-exit)');
  for (const n of ['walkby_stop', 'walkby_queue', 'arch', 'arch_scan', 'arch_exit', 'guard_post', 'post_okafor', 'post_giles']) assert.ok(level.anchor(n), `dock-checkpoint anchor ${n}`);
  const npcs = new Map(level.npcSpawns().map((n) => [n.id, n]));
  for (const id of ['giles', 'okafor', 'priya', 'cook', 'ruiz', 'sung', 'heins', 'hale']) assert.ok(npcs.has(id), `npc ${id}`);
  assert.equal(npcs.get('giles')?.room, 'R01a');
  // The dock and walk mount on different walls. Compare the sound origin to the actual grille mesh.
  for (const id of ['pa_dock', 'pa_walk']) {
    const sound = level.paSpeakerAt(level.spawn.position, id)!;
    const fixture = level.debug.wallProps.find(p => p.source.startsWith(`pa_speaker:${id}@`))!;
    assert.ok(fixture.boxes.some(box => box.getCenter(new THREE.Vector3()).distanceTo(sound) < 0.001), id);
  }
  assert.equal(level.paSpeakerAt(level.spawn.position, 'missing'), null);
  for (const room of data.rooms.filter(r => ['hydroponics', 'dive_bay', 'admin', 'commons'].includes(r.area ?? ''))) {
    const floor = room.pieces.find(p => p.kit.startsWith('floor'))!;
    const [x, , z] = (floor.cell ?? floor.cells![0])!;
    assert.ok(level.paSpeakerAt(new THREE.Vector3(4 * x, 1.62, 4 * z)), `PA coverage in ${room.id}`);
  }
  assert.ok(Math.abs(level.anchor('post_front')!.yaw - (2 * Math.PI) / 180) < 1e-9, 'Jay leans on the desk facing between the dock door and the guard');
});

test('the closed airlock hides its waiting crew through the dock windows', () => {
  const { level } = build();
  level.setDoor('D_dock', 'locked');
  const shell = level.group.getObjectByName('room:R01a')!;
  const door = level.group.getObjectByName('door:D_dock')!;
  level.group.updateMatrixWorld(true);
  for (const view of ['post_front', 'walk_window']) {
    const eye = level.anchor(view)!.pos.clone();
    eye.y += 1.62;
    level.renderFromEye(eye, () => {
      assert.ok(shell.visible, `airlock must draw from ${view} with D_dock shut`);
      for (const id of ['giles', 'okafor', 'ruiz', 'sung']) {
        const head = level.anchor(`${id}_start`)!.pos.clone();
        head.y += 1.65;
        const ray = new THREE.Raycaster(eye, head.clone().sub(eye).normalize(), 0, eye.distanceTo(head));
        const hits = ray.intersectObjects([shell, door]);
        assert.ok(hits.some(({ object }) => object instanceof THREE.Mesh && !object.material.transparent), `${id} exposed from ${view}`);
      }
    });
  }
});

test('the dock walk sees the Commons hull across the water even with the kitchen culled', () => {
  const { level } = build();
  const hull = level.group.getObjectByName('station-hull')!;
  const commons = level.group.getObjectByName('room:R02')!;
  const cook = level.anchor('cook_stand')!.pos.clone();
  cook.y += 1.65;
  level.group.updateMatrixWorld(true);
  for (const z of [3.0, 4.2, 5.1]) {
    const eye = new THREE.Vector3(25.7, 1.65, z);
    level.renderFromEye(eye, () => {
      assert.equal(commons.visible, false);
      const ray = new THREE.Raycaster(eye, cook.clone().sub(eye).normalize(), 0, eye.distanceTo(cook));
      const hit = ray.intersectObject(hull)[0];
      assert.ok(hit, 'solid kitchen plating must precede the cook');
      assert.ok(hit.point.z > 9.8 && hit.point.z < 10.01, 'ray clears the dock window and hits the north kitchen wall');
    });
  }
  const toSea = new THREE.Raycaster(new THREE.Vector3(8, 1.65, -1), new THREE.Vector3(0, 0, -1));
  assert.equal(toSea.intersectObject(hull).length, 0, 'the main dock window still opens onto the sub berth');
  const fromBelow = new THREE.Raycaster(new THREE.Vector3(24, -4, 36), new THREE.Vector3(0, 1, 0), 0, 4);
  assert.ok(fromBelow.intersectObject(hull).length > 0, 'the launch trunk is closed by its skirt and outer hatch (dive-bay spec)');
});

test('slice01 Part A: the drop, the glimpse and the rounds have what they need in the level', () => {
  const { level } = build();
  const npcs = new Map(level.npcSpawns().map((n) => [n.id, n]));
  assert.equal(npcs.get('researcher_b')?.transformable, true, 'Voss can transform behind the glass');
  assert.equal(npcs.get('researcher_b')?.look, 'voss', 'the Lab B researcher is Dr. Voss, a named cast member (infection-kills spec)');
  // trim-lab-wing-encounters: the creature escapes Lab B through its ceiling vent and drops into R06 in its own body.
  const spawns = data.rooms.flatMap((r) => r.spawns ?? []);
  assert.ok(!spawns.some((sp) => sp.id === 'r05_door'), 'it no longer breaks out through the Lab B door');
  const creature = spawns.filter((sp) => sp.look === 'lab_creature');
  assert.deepEqual(creature.map((sp) => sp.id), ['r06_duct'], 'the only creature spawn is its drop into R06');
  assert.ok(data.rooms.find((r) => r.id === 'R04')!.props?.some((p) => p.kit === 'ceiling_vent' && p.params?.['id'] === 'labb_vent'), 'Lab B has the vent it escapes through');
  const emits = new Set(data.rooms.flatMap((r) => (r.triggers ?? []).map((t) => t.emit)));
  for (const e of ['trigger:commons_to_gallery', 'trigger:gallery_brief_spot', 'trigger:drop_spot', 'trigger:gallery_enter', 'round:hydro_log', 'round:dive_case', 'trigger:hale_office', 'trigger:security_booth', 'trigger:hydro_store_enter', 'trigger:dive_lockers_enter', 'commons:radio']) assert.ok(emits.has(e), `trigger ${e}`);
  for (const a of ['cam04_pos', 'cam04_look', 'cam04_figure', 'dawdle_call', 'gallery_door', 'brief_giles', 'brief_okafor']) assert.ok(level.anchor(a), `anchor ${a}`);
  assert.ok(JSON.stringify(data).includes('"sample_case"'), 'the dive sample case is placed');
  const r03 = data.rooms.find((r) => r.id === 'R03')!;
  assert.equal(r03.props?.filter((p) => p.kit === 'glass_cracks').length, 3, 'three crack layers on the Lab B glass');
  // render-lighting spec (fidelity-first-rendering): every R03 fixture takes a real light, and the two
  // centre ceilings and the two lamps over the seating ask for shadows.
  assert.equal(r03.lights?.filter((l) => l.pool !== false).length, 9, 'R03 has 9 pooled lights');
  assert.deepEqual(r03.lights?.filter((l) => l.shadow === true).map((l) => l.slot).sort(), [1, 4, 6, 7], 'R03 asks for 4 shadow lights');
  const r13d = data.rooms.find((r) => r.id === 'R13d')!;
  assert.ok(r13d.triggers?.some((t) => t.emit === 'area:dark'), 'the dark area trigger is in R13d');
});

// render-quality spec: draw calls and triangles are reported, never a pass/fail budget; the gate is
// the 30 fps floor at High on the target PC.
test('slice01 reports draw calls and triangles per room', () => {
  const { level } = build();
  const stats = level.roomStats();
  assert.ok(stats.length >= ROOMS.length, 'every room is counted');
  for (const s of stats) assert.ok(Number.isFinite(s.drawCalls) && Number.isFinite(s.triangles), `${s.id} has counts`);
  const worst = [...stats].sort((a, b) => b.drawCalls - a.drawCalls).slice(0, 3);
  console.info('[slice01] heaviest rooms', worst.map((s) => `${s.id} ${s.drawCalls} calls ${Math.round(s.triangles / 1000)}k tris`).join(', '));
  console.info('[slice01] per room', stats.map((s) => `${s.id} ${s.drawCalls}/${Math.round(s.triangles / 1000)}k`).join(' '));
  console.info(`[slice01] whole level ${stats.reduce((n, s) => n + s.triangles, 0)} triangles`);
});

// ---------------------------------------------------------------- the critical path, walked

interface DoorPeek {
  data: { id: string };
  collider: { enabled: boolean };
}

test('slice01 critical path: nav-reachable and walkable through the real doors', () => {
  const inventory = new Inventory(items);
  const { level, events } = build(inventory);
  const uses = new Map<string, Interactable>();
  level.registerInteractions({ add: (i: Interactable) => (uses.set(i.id, i), () => undefined) } as unknown as Interactions);
  const entered: string[] = [];
  const fired: string[] = [];
  events.on('room:entered', ({ id }) => void entered.push(id));
  events.on('trigger:fired', ({ event }) => void fired.push(event));
  const doors = (level as unknown as { doors: DoorPeek[] }).doors;
  const nav = level.navGraph();
  const EYE = 1.7;
  const body: MotorState = { x: 6, y: 0, z: 2.6, vy: 0, grounded: true };
  const eye = new THREE.Vector3();
  let t = 0;
  const tick = (dt: number): void => {
    t += dt;
    level.update(t, dt, eye.set(body.x, body.y + EYE, body.z), false);
  };
  /** Route ignoring door state (doors open as the walker reaches them, like the player). */
  const route = (to: P3): P3[] => {
    const saved = doors.map((d) => d.collider.enabled);
    for (const d of doors) d.collider.enabled = false;
    const path = nav.findPath({ x: body.x, y: body.y, z: body.z }, to, { radius: 0.3 });
    doors.forEach((d, i) => (d.collider.enabled = saved[i]!));
    assert.ok(path, `no nav route from ${body.x.toFixed(1)},${body.z.toFixed(1)} to ${to.x},${to.z}`);
    return path!;
  };
  const walkTo = (name: string, to: P3 = level.anchor(name)!.pos): void => {
    for (const wp of route(to)) {
      let stuck = 0;
      let best = Infinity;
      for (let step = 0; step < 30 * 40; step++) {
        const dx = wp.x - body.x;
        const dz = wp.z - body.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.25) break;
        const v = Math.min(d, 4 / 30);
        moveBody(body, (dx / d) * v, (dz / d) * v, 1 / 30, DEFAULT_MOTOR, level.collision);
        tick(1 / 30);
        if (d < best - 0.05) {
          best = d;
          stuck = 0;
        } else if (++stuck > 30 * 4) assert.fail(`walk to ${name}: stuck at ${body.x.toFixed(2)},${body.z.toFixed(2)} (waypoint ${wp.x.toFixed(1)},${wp.z.toFixed(1)}, room ${level.currentRoomId()})`);
      }
    }
    assert.ok(Math.hypot(to.x - body.x, to.z - body.z) < 0.6, `reached ${name}`);
    // On the floor the anchor stands on: the deck, or a sunken floor (level-kit spec: the R09 sump).
    assert.ok(Math.abs(body.y - to.y) < 0.05, `${name}: feet on its floor (y ${body.y.toFixed(2)}, anchor ${to.y.toFixed(2)})`);
  };
  const use = (id: string): void => {
    const it = uses.get(id);
    assert.ok(it, `interactable ${id}`);
    it!.use();
  };
  const at = (x: number, z: number): P3 => ({ x, y: 0, z });

  tick(1 / 30);
  // Quiet half: intro walk, briefing, the three rounds (any order), the card backtrack.
  walkTo('walk_window');
  walkTo('kitchen_stand');
  walkTo('brief_jay');
  walkTo('cp_round_admin');
  use('pickup:P_card_l2');
  assert.ok(inventory.has('card_l2'));
  walkTo('admin_cam_view');
  walkTo('cp_round_hydro');
  walkTo('hydro_store_moment');
  walkTo('hydro_alarm', at(48.6, 28.4));
  walkTo('cp_round_dive');
  walkTo('dive_case_locker', at(15.8, 40));
  // dive-bay spec (finale-transit-rooms-geometry): no doorway connects Launch Hall to R13d.
  assert.equal(level.doorStates()['D_R13b_R13d'], undefined);
  walkTo('drop_jay');
  // The drop: lockdown behind, the way to R05 opens (sequences do this with setDoor/unlock).
  level.setDoor('D_R02_R03', 'sealed');
  assert.ok(level.unlock('D_R03_R05', 'script'));
  walkTo('r05_entry');
  walkTo('r06_hold');
  assert.ok(level.unlock('D_R06_R07', 'engineer'));
  level.setDoor('D_R06_R07', 'open');
  walkTo('cp_security', at(0, 40.2));
  assert.ok(level.unlock('D_R07_R07a', 'engineer'));
  walkTo('r07_panel');
  assert.ok(level.unlock('D_R07_R09', 'medic'));
  walkTo('r09_mid');
  walkTo('valve', at(36.9, 52.8));
  use('trigger:trig_r10_valve');
  assert.equal(level.doorStates()['D_R10_R11'], 'closed', 'valve unlocks the control-room bulkhead');
  level.setDoor('D_R10_R11', 'open');
  walkTo('r11_hold');

  const required = ['R01', 'R01w', 'R02', 'R03', 'R14a', 'R14b', 'R14c', 'R14e', 'R12a', 'R12b', 'R12e', 'R12d', 'R13a', 'R13b', 'R13e', 'R05', 'R06', 'R07', 'R07a', 'R09', 'R10', 'R11'];
  assert.equal(entered.includes('R13d'), false, 'the sealed maintenance corridor is never on the way (dive-bay spec)');
  for (const r of required) assert.ok(entered.includes(r), `entered ${r}`);
  for (const e of ['trigger:commons_enter', 'trigger:gallery_enter', 'trigger:gallery_brief_spot', 'trigger:drop_spot', 'trigger:admin_enter', 'trigger:hale_office', 'trigger:security_booth', 'trigger:hydro_enter', 'trigger:hydro_store_enter', 'trigger:dive_enter', 'trigger:r05_enter', 'trigger:r06_enter', 'trigger:r07_enter', 'trigger:r09_enter', 'trigger:r10_enter', 'trigger:r11_enter', 'valve:r10_main']) {
    assert.ok(fired.includes(e), `fired ${e}`);
  }
  console.info(`[slice01] walked ${entered.length} room entries in ${t.toFixed(0)} s of game time`);
});

test('slice01 reports the heaviest visible view (render-quality spec: a report, not a budget)', () => {
  const { level } = build();
  const eye = new THREE.Vector3();
  let worst = { id: '', calls: 0 };
  for (const r of data.rooms) {
    const a = r.anchors?.[0]?.pos ?? r.npcs?.[0]?.at;
    const p = Array.isArray(a) ? a : level.anchorPosition('room', r.id)!.toArray();
    level.update(0, 0.016, eye.set(p[0]!, 1.7, p[2]!), false);
    const calls = level.visibleDrawCalls();
    if (calls > worst.calls) worst = { id: r.id, calls };
  }
  console.info(`[slice01] most visible draw calls: ${worst.calls} from ${worst.id}`);
  assert.ok(worst.calls > 0, 'some room draws');
});

test('slice01 props react to their events (sub, briefing screen, Lab B blinds)', () => {
  const { level, events } = build();
  const find = (name: string): THREE.Object3D => {
    const o = level.group.getObjectByName(name);
    assert.ok(o, name);
    return o!;
  };
  const eye = new THREE.Vector3(6, 1.7, 2.6);
  const run = (s: number): void => {
    for (let i = 0; i < s * 10; i++) level.update(i / 10, 0.1, eye, false);
  };
  const sub = find('supply_sub');
  run(0.2);
  assert.equal(sub.visible, false, 'sub away before the intro');
  (events.emit as (n: string, p: unknown) => void)('intro:sub_dock', {});
  run(16);
  assert.ok(sub.visible && Math.abs(sub.position.x) < 1e-3 && Math.abs(sub.position.y) < 1e-3, 'sub docked');
  // Docked bow spotlights sit in view through the R01 dock window (X in [2, 14]) and aim forward & down onto the seabed.
  sub.updateWorldMatrix(true, true);
  const subHeadlamps: THREE.Object3D[] = [];
  sub.traverse((o) => void (o.name === 'exterior-lamp' && subHeadlamps.push(o)));
  assert.equal(subHeadlamps.length, 2, 'two bow spotlight markers on docked sub');
  for (const lamp of subHeadlamps) {
    const wp = new THREE.Vector3().setFromMatrixPosition(lamp.matrixWorld);
    const meta = lamp.userData['exteriorLamp'] as { dir: [number, number, number]; range: number };
    assert.ok(wp.x >= 2 && wp.x <= 14, `headlamp X=${wp.x.toFixed(2)} sits inside R01 dock window [2, 14]`);
    assert.ok(wp.y > -4.5, `headlamp Y=${wp.y.toFixed(2)} sits above the seabed`);
    assert.ok(meta.dir[0] > 0.5 && meta.dir[1] < -0.2, 'headlamp aims forward and downward onto the seabed');
  }
  assert.ok(sub.getObjectByName('supply_sub:beams'), 'volumetric bow spotlight beams mesh exists');
  eye.set(8, 1.7, 17.4);
  run(0.2);
  const screen = find('screen:brief_screen') as THREE.Mesh;
  const mat = screen.material as THREE.MeshStandardMaterial;
  assert.ok(mat.emissiveIntensity < 0.5);
  (events.emit as (n: string, p: unknown) => void)('briefing:screen', { state: 'on', who: 'hale' });
  assert.ok(mat.emissiveIntensity > 1);
  // Hale's lines drive the feed's mouth (no image in node, so this only checks the wiring runs).
  (events.emit as (n: string, p: unknown) => void)('speech:started', { id: 'brief_hale_01', speaker: 'director', text: 'Good morning, Thalassa.', emote: 'neutral', duration: 3 });
  run(0.3);
  (events.emit as (n: string, p: unknown) => void)('speech:ended', { id: 'brief_hale_01', speaker: 'director', reason: 'finished' });
  (events.emit as (n: string, p: unknown) => void)('blinds:set', { id: 'labb', state: 'up', instant: true });
  (events.emit as (n: string, p: unknown) => void)('briefing:screen', { state: 'off' });
  assert.ok(mat.emissiveIntensity < 0.5);
});

test('slice01 Part B: the action sequences find their anchors, doors, groups and set-piece props', () => {
  const { level, events } = build();
  const doorIds = new Set(data.doors.map((d) => d.id));
  for (const file of ['action_contact', 'action_security', 'action_tunnel', 'action_climax']) {
    const text = readFileSync(new URL(`../data/sequences/${file}.json`, import.meta.url), 'utf8');
    const names = [...new Set([...text.matchAll(/"anchor:([A-Za-z0-9_-]+)"/g)].map((m) => m[1]!))];
    assert.ok(names.length >= 1, file);
    for (const n of names) assert.ok(level.anchor(n), `${file}: anchor:${n}`);
    for (const m of text.matchAll(/"(?:door:|id": ")(D_[A-Za-z0-9_]+)"/g)) assert.ok(doorIds.has(m[1]!), `${file}: door ${m[1]}`);
  }
  // Spawn groups: R06 single creature + R09 tunnel; R11 Power Bay has zero combat spawns.
  const spawns = data.rooms.flatMap((r) => r.spawns ?? []);
  const total = (g: string): number => spawns.filter((s) => s.group === g).reduce((n, s) => n + (s.count ?? 1), 0);
  assert.equal(total('r06_cover'), 1, 'the escaped creature alone');
  assert.equal(total('r11_climax'), 0, 'no combat spawns in R11 Power Bay');
  // The glass wall into the medical bay takes cracks and blood; the control room hides the bloom's trail.
  const r07 = data.rooms.find((r) => r.id === 'R07')!;
  // medbay-attack: marks land where Priya touches the centre pane, so no whole-pane blood overlay; each pane its own id.
  assert.equal(r07.props?.filter((p) => p.kit === 'glass_blood').length, 0);
  assert.deepEqual(r07.props?.filter((p) => p.kit === 'glass_cracks').map((p) => p.params?.['id']), ['medbay_w', 'medbay_c']);
  const r11 = data.rooms.find((r) => r.id === 'R11')!;
  assert.ok(r11.props?.some((p) => p.kit === 'fluid_trail'));
  const meshes = (prefix: string): THREE.Mesh[] => {
    const out: THREE.Mesh[] = [];
    level.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if ((o as THREE.Mesh).isMesh && m?.name?.startsWith(prefix)) out.push(o as THREE.Mesh);
    });
    return out;
  };
  const trail = meshes('fluid-trail');
  assert.equal(trail.length, 1);
  assert.equal(trail[0]!.visible, false, 'hidden until the lights come back');
  (events.emit as (n: string, p: unknown) => void)('reveal:trail', {});
  assert.equal(trail[0]!.visible, true);
  const blood = level.group.children.length ? meshesByName(level, 'glass-blood') : [];
  assert.equal(blood.length, 0, 'blood is set by level event; no hidden pane shows before it');
});

function meshesByName(level: InstanceType<typeof Level>, prefix: string): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  level.group.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | undefined;
    if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).visible && m?.name?.startsWith(prefix)) out.push(o as THREE.Mesh);
  });
  return out;
}

// ---------------------------------------------------------------- photo textures: palettes, Lab B, signs

function buildWith(materials: Materials): { level: InstanceType<typeof Level>; events: EventBus } {
  const events = new EventBus();
  const level = new Level(data, { materials, registry, events, scene: new THREE.Scene(), inventory: null, uiText: ui });
  return { level, events };
}

function roomMaterials(level: InstanceType<typeof Level>, room: string): Set<THREE.Material> {
  const out = new Set<THREE.Material>();
  level.group.getObjectByName(`room:${room}`)!.traverse((o) => {
    if (o instanceof THREE.Mesh) out.add(o.material as THREE.Material);
  });
  return out;
}

test('area palettes reach the pieces: the nutrient room override and the kitchen / lab tile materials', () => {
  const mats = fakeMaterials();
  const { level } = buildWith(mats);
  const has = (room: string, key: keyof Materials): boolean => {
    const set = roomMaterials(level, room);
    return set.has(mats[key]) || set.has(withVertexColors(mats[key]));
  };
  assert.ok(has('R12d', 'tileWall') && !has('R12d', 'tileWashroom'), 'R12d nutrient room uses clean tileWall via params.material');
  assert.ok(has('R12b', 'cleanWall') && has('R12b', 'cleanSlate') && has('R12b', 'steelDark') && has('R12b', 'cleanTeal') && !has('R12b', 'paintTeal'), 'R12b Grow Hall uses clean rust-free palette');
  assert.ok(has('R12a', 'officeCeiling') && has('R12c', 'officeCeiling'), 'hydroponics vestibule and seed lab use clean drop ceilings');
  assert.ok(has('R04', 'labTile') && has('R04', 'tileWall'), 'Lab B: tile floor and tile walls');
  assert.ok(has('R08b', 'tileWall'), 'surgery tile walls');
  assert.ok(has('R02', 'tileWall'), 'kitchen tile walls');
  assert.ok(has('R09', 'rustHeavy'), 'tunnel walls');
  // Dive bay & transit corridor: clean steel/slate everywhere including R13d.
  const rust: Array<keyof Materials> = ['rustBlotch', 'rustHeavy', 'rustDrip', 'servicePaint', 'diamondRusty', 'diamondHazard', 'hazard'];
  for (const r of ['R13a', 'R13b', 'R13c', 'R13d', 'R13e']) for (const k of rust) assert.ok(!has(r, k), `${r} uses no ${k}`);
  assert.ok(has('R13b', 'boltPanel') && has('R13b', 'cleanSlate') && has('R13b', 'hazardClean'), 'dive bay clean slate and bolted steel');
  assert.ok(has('R13d', 'cleanSlate') && has('R13d', 'concretePainted') && has('R13d', 'steelDark'), 'R13d uses clean transit palette');
  assert.ok(has('R15a', 'cleanSlate') && has('R15a', 'concretePainted') && !has('R15a', 'rustBlotch'), 'R15a uses clean transit palette');
  assert.ok(!has('R01', 'hazard') && has('R01', 'hazardClean'), 'dock uses the clean hazard stripes');
  assert.ok(has('R01', 'concretePainted'), 'dock floor');
  assert.ok(has('R01', 'cleanSlate') && has('R01', 'boltPanel') && has('R01', 'steelDark') && has('R01', 'steelBrushed') && has('R01', 'cleanTeal'), 'dock clean slate walls, bolted upper, dark steel ceiling, clean teal accents and brushed trim');
  assert.ok(has('R01a', 'boltPanel'), 'airlock bolted ceiling');
  assert.ok(has('R02', 'vinylPanel') && has('R02', 'cleanWall') && has('R02', 'officeCeiling') && has('R02', 'steelBrushed'), 'commons clean vinyl/wall bands, drop acoustic ceiling and brushed trim');
  assert.ok(has('R14a', 'officeCeiling') && has('R14a', 'woodPanel') && has('R14a', 'carpet') && has('R14a', 'steelBrushed'), 'admin office ceiling, wood panelling, carpet and brushed trim');
  assert.ok(has('R14e', 'boltPanel'), 'admin security booth bolted ceiling');
  const doorMats = (id: string): Set<THREE.Material> => {
    const out = new Set<THREE.Material>();
    level.group.getObjectByName(`door:${id}`)!.traverse((o) => {
      if (o instanceof THREE.Mesh) out.add(o.material as THREE.Material);
    });
    return out;
  };
  const doorHas = (id: string, key: keyof Materials): boolean => {
    const set = doorMats(id);
    return set.has(mats[key]) || set.has(withVertexColors(mats[key]));
  };
  assert.ok(doorHas('D_dock', 'cleanSlate') && doorHas('D_dock', 'steelDark') && !doorHas('D_dock', 'paintDark'), 'dock door uses clean slate surround and dark steel panels');
  assert.ok(doorHas('D_R01_R02', 'vinylPanel') && doorHas('D_R01_R02', 'cleanSlate') && doorHas('D_R01_R02', 'steelDark') && !doorHas('D_R01_R02', 'paintDark'), 'commons-dock door matches each side with clean materials');
  assert.ok(doorHas('D_R02_R14a', 'vinylPanel') && doorHas('D_R02_R14a', 'woodPanel') && doorHas('D_R02_R14a', 'cleanWall') && !doorHas('D_R02_R14a', 'paintDark') && !doorHas('D_R02_R14a', 'paintBone'), 'commons-admin glass door matches both rooms cleanly');
  assert.ok(doorHas('D_R14a_R14b', 'woodPanel') && doorHas('D_R14a_R14b', 'steelDark') && !doorHas('D_R14a_R14b', 'paintDark') && !doorHas('D_R14a_R14b', 'paintBone'), 'admin glass doors use wood surround and clean steel trim');
  assert.ok(doorHas('D_R14a_R14e', 'woodPanel') && doorHas('D_R14a_R14e', 'steelDark') && !doorHas('D_R14a_R14e', 'paintDark'), 'admin security booth door uses clean wood surround and dark steel leaves');
  assert.ok(doorHas('D_R02_R12a', 'vinylPanel') && doorHas('D_R02_R12a', 'cleanWall') && doorHas('D_R02_R12a', 'steelDark') && !doorHas('D_R02_R12a', 'paintDark'), 'commons-hydro door matches both rooms cleanly');
  assert.ok(doorHas('D_R12a_R12b', 'cleanWall') && doorHas('D_R12a_R12b', 'steelDark') && !doorHas('D_R12a_R12b', 'paintDark') && !doorHas('D_R12a_R12b', 'paintBone'), 'hydro vestibule glass door is rust-free');
  assert.ok(doorHas('D_R12b_R12d', 'cleanWall') && doorHas('D_R12b_R12d', 'steelDark') && !doorHas('D_R12b_R12d', 'paintDark'), 'hydro nutrient room door is rust-free');
  assert.ok(doorHas('hydro_store', 'cleanWall') && doorHas('hydro_store', 'steelDark') && !doorHas('hydro_store', 'paintDark'), 'hydro storeroom door is rust-free');
  // Acoustic surfaces match the visual floor materials (Room 1 painted concrete; the Commons is tiled since the cafeteria pass, and tile reads as a hard floor).
  assert.equal(level.collision.surfaceAt(6, 0, 2.6), 'concrete', 'R01 Docking Ring floor is concrete');
  assert.equal(level.collision.surfaceAt(24, 0, 18), floorSurfaceForKey('labTile'), 'R02 Commons tile floor');
});

test('Lab B floor swaps labTile -> tileBroken on the glass:set labb cracked event and back on level:reset', () => {
  const mats = fakeMaterials();
  const { level, events } = buildWith(mats);
  const floor = (): { clean: boolean; broken: boolean } => {
    const set = roomMaterials(level, 'R04');
    return { clean: set.has(withVertexColors(mats.labTile)) || set.has(mats.labTile), broken: set.has(withVertexColors(mats.tileBroken)) || set.has(mats.tileBroken) };
  };
  assert.deepEqual(floor(), { clean: true, broken: false });
  events.emit('glass:set' as never, { id: 'gallery_other', state: 'cracked' } as never);
  assert.deepEqual(floor(), { clean: true, broken: false }, 'other glass does not trigger it');
  events.emit('glass:set' as never, { id: 'labb', state: 'cracked' } as never);
  assert.deepEqual(floor(), { clean: false, broken: true });
  events.emit('level:reset', {});
  assert.deepEqual(floor(), { clean: true, broken: false });
  level.breakLabBFloor();
  assert.deepEqual(floor(), { clean: false, broken: true });
});

test('sign_danger props sit on the wall beside the Lab B and pressure-door-hall doors', () => {
  const doorFace = (doorId: string, side: 'cell' | 'far', lx: number): { pos: [number, number]; rot: number } => {
    const d = data.doors.find((x) => x.id === doorId)!;
    const th = (d.rot * Math.PI) / 180;
    // Door frame slab is 0.5 m thick centred on the cell's local -Z edge; the sign hugs one face, 1.66 m off-centre (beside the jamb, on the side with no perpendicular wall).
    const lz = side === 'cell' ? -1.75 : -2.25;
    const x = d.cell[0] * 4 + lx * Math.cos(th) + lz * Math.sin(th);
    const z = d.cell[2] * 4 - lx * Math.sin(th) + lz * Math.cos(th);
    return { pos: [Math.round(x * 100) / 100, Math.round(z * 100) / 100], rot: (d.rot + (side === 'cell' ? 180 : 0)) % 360 };
  };
  const expect: Array<[string, string, 'cell' | 'far', number]> = [
    ['R04', 'D_R04_R05', 'cell', -1.66],
    ['R06', 'D_R05_R06', 'far', 1.66],
    ['R06', 'D_R06_R07', 'cell', 1.66],
  ];
  for (const [room, door, side, lx] of expect) {
    const e = doorFace(door, side, lx);
    const sign = data.rooms.find((r) => r.id === room)!.props!.find((p) => p.kit === 'sign_danger' && Math.abs(p.pos[0] - e.pos[0]) < 0.02 && Math.abs(p.pos[2] - e.pos[1]) < 0.02);
    assert.ok(sign, `${room} sign for ${door} at ${e.pos.join(',')}`);
    assert.equal(sign.rot ?? 0, e.rot, `${door} sign faces into ${room}`);
    assert.equal(sign.pos[1], 0);
  }
  // The prop is a single textured quad.
  const out = registry.create('sign_danger', {}, new Rng('sign'), fakeMaterials());
  assert.equal(out.object.children.length, 1);
});

test('admin hub (R14a-R14e) props stay inside room bounds, do not overlap, and seat desk NPCs cleanly', () => {
  const mats = fakeMaterials();
  const deg = THREE.MathUtils.degToRad;
  const adminIds = ['R14a', 'R14b', 'R14c', 'R14d', 'R14e'];
  for (const id of adminIds) {
    const r = data.rooms.find((x) => x.id === id)!;
    const cells = r.pieces.flatMap((p) => p.cells ?? (p.cell ? [p.cell] : []));
    const minX = Math.min(...cells.map((c) => c[0] * 4 - 1.75));
    const maxX = Math.max(...cells.map((c) => c[0] * 4 + 1.75));
    const minZ = Math.min(...cells.map((c) => c[2] * 4 - 1.75));
    const maxZ = Math.max(...cells.map((c) => c[2] * 4 + 1.75));
    const propBoxes: Array<{ label: string; min: [number, number, number]; max: [number, number, number] }> = [];
    for (const p of r.props ?? []) {
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(...p.pos),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, deg(p.rot ?? 0), 0, 'YXZ')),
        new THREE.Vector3(1, 1, 1),
      );
      const out = registry.create(p.kit, { ceiling: r.height ?? 3.2, area: r.area ?? 'admin', ...(p.params ?? {}) }, new Rng(`${id}:${p.kit}:${p.pos.join(',')}`), mats);
      for (const c of out.colliders) {
        const b = new THREE.Box3(new THREE.Vector3(...c.min), new THREE.Vector3(...c.max)).applyMatrix4(m);
        // Every solid prop stays inside the room's inner wall envelope (allow 0.08 m for flush wall mounts).
        assert.ok(b.min.x >= minX - 0.08 && b.max.x <= maxX + 0.08, `${id} ${p.kit} X [${b.min.x.toFixed(2)}, ${b.max.x.toFixed(2)}] inside [${minX}, ${maxX}]`);
        assert.ok(b.min.z >= minZ - 0.08 && b.max.z <= maxZ + 0.08, `${id} ${p.kit} Z [${b.min.z.toFixed(2)}, ${b.max.z.toFixed(2)}] inside [${minZ}, ${maxZ}]`);
        propBoxes.push({ label: `${p.kit}@${p.pos.join(',')}`, min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] });
      }
    }
    // No two distinct props overlap each other's collider boxes.
    for (let i = 0; i < propBoxes.length; i++) {
      for (let j = i + 1; j < propBoxes.length; j++) {
        const a = propBoxes[i]!;
        const b = propBoxes[j]!;
        if (a.label === b.label) continue;
        const overlap =
          a.min[0] < b.max[0] - 0.01 && a.max[0] > b.min[0] + 0.01 &&
          a.min[1] < b.max[1] - 0.01 && a.max[1] > b.min[1] + 0.01 &&
          a.min[2] < b.max[2] - 0.01 && a.max[2] > b.min[2] + 0.01;
        assert.ok(!overlap, `${id}: ${a.label} overlaps ${b.label}`);
      }
    }
    // Standing NPCs stay clear of furniture colliders; seated NPCs align with a chair or claim an activity spot.
    for (const n of r.npcs ?? []) {
      const pos = typeof n.at === 'string' ? r.anchors!.find((a) => a.id === n.at)!.pos : n.at;
      const seated = (n.pose ?? '').startsWith('sit_') || (n.spot ?? '').startsWith('sit_');
      if (seated && !n.spot) {
        assert.ok(r.props!.some((p) => p.kit === 'chair' && Math.hypot(p.pos[0] - pos[0], p.pos[2] - pos[2]) < 0.05), `${id} seated ${n.id} has a chair`);
      } else if (!seated) {
        for (const b of propBoxes) {
          const cx = Math.max(b.min[0], Math.min(pos[0], b.max[0]));
          const cz = Math.max(b.min[2], Math.min(pos[2], b.max[2]));
          assert.ok(Math.hypot(pos[0] - cx, pos[2] - cz) >= 0.28, `${id} standing ${n.id} clips ${b.label}`);
        }
      }
    }
  }
  const { level } = build();
  const npcs = new Map(level.npcSpawns().map((n) => [n.id, n]));
  assert.equal(npcs.get('assistant')?.pose, 'sit_typing');
  assert.equal(npcs.get('exec_2')?.pose, 'sit_typing');
  assert.equal(npcs.get('exec_4')?.pose, 'sit_typing');
  assert.ok(npcs.get('admin_visitor')?.spot, 'reception sofa visitor claims a sit_sofa spot');
  for (const id of ['board_1', 'board_2', 'board_3']) assert.ok(npcs.get(id)?.spot, `${id} claims a boardroom seat`);
  // Boardroom (R14d, 3x2): a player capsule can walk a full loop around the conference table and chairs.
  const loop: Array<[number, number]> = [[44.0, 0.8], [48.1, 0.8], [48.1, -4.6], [39.9, -4.6], [39.9, 0.8], [44.0, 0.8]];
  const body: MotorState = { x: loop[0]![0], y: 0, z: loop[0]![1], vy: 0, grounded: true };
  for (const [tx, tz] of loop.slice(1)) {
    for (let step = 0; step < 30 * 10; step++) {
      const dx = tx - body.x;
      const dz = tz - body.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.2) break;
      const v = Math.min(d, 4 / 30);
      moveBody(body, (dx / d) * v, (dz / d) * v, 1 / 30, DEFAULT_MOTOR, level.collision);
    }
    assert.ok(Math.hypot(tx - body.x, tz - body.z) < 0.3, `boardroom walkway blocked before (${tx}, ${tz}), stopped at (${body.x.toFixed(2)}, ${body.z.toFixed(2)})`);
  }
  // Chair collider covers the backrest height (F1).
  const chair = registry.create('chair', { fixed: true }, new Rng('chair'), mats);
  assert.ok(chair.colliders[0]!.max[1] >= 1.0, 'chair collider covers backrest');
  // One station-wide exterior (overhaul-exterior-ocean): no per-window backdrop, seabed or truss.
  const exteriors: THREE.Object3D[] = [];
  let screens = 0;
  const screenRooms = new Set<string>();
  level.group.traverse((o) => {
    assert.notEqual(o.name, 'abyss-backdrop', 'no per-window abyss backdrop');
    if (o.name === 'exterior') exteriors.push(o);
    if (o.name.startsWith('seabed')) {
      let p: THREE.Object3D | null = o;
      while (p && p.name !== 'exterior') p = p.parent;
      assert.ok(p, `${o.name} belongs to the shared exterior, not a window tile`);
    }
    if (o instanceof THREE.Mesh && (o.material as THREE.Material).name === 'sanity-screen') screens++;
  });
  assert.equal(exteriors.length, 1, 'one exterior for the whole station');
  for (const r of data.rooms) if (r.pieces.some((p) => p.kit === 'wall_sanity_screen')) screenRooms.add(r.id);
  assert.deepEqual([...screenRooms].sort(), ['R02', 'R12c', 'R14c', 'R14d']);
  const realRooms = new Set(data.rooms.filter((r) => r.pieces.some((p) => p.kit === 'wall_window')).map((r) => r.id));
  assert.deepEqual([...realRooms].sort(), ['R01', 'R01w', 'R12b', 'R15a', 'R16a']);
  assert.ok(screens >= 4 && screens <= 8, `screens merge into about one mesh per screened room (found ${screens})`);
  const lamps = level.floodlights();
  const perRoom = (id: string): number => lamps.filter((l) => l.room === id).length;
  assert.deepEqual([perRoom('R01'), perRoom('R01w'), perRoom('R12b'), perRoom('R15a'), perRoom('R16a'), lamps.length], [2, 2, 1, 2, 2, 9], 'floodlights: R01 2, R01w 2, R12b 1, R15a 2, R16a 2');
  assert.equal(lamps.filter((l) => l.flicker).length, 1, 'one Docking Ring lamp flickers');
  assert.ok(lamps.find((l) => l.flicker)!.room === 'R01');
  let subLamps = 0;
  level.group.traverse((o) => void (o.name === 'exterior-lamp' && subLamps++));
  assert.equal(subLamps, 2, "the sub's two headlamps light the exterior");
  // The exterior draws only while a room with real windows is visible.
  const centre = (id: string): THREE.Vector3 => {
    const cells = data.rooms.find((x) => x.id === id)!.pieces.flatMap((p) => p.cells ?? (p.cell ? [p.cell] : []));
    const c = cells[Math.floor(cells.length / 2)]!;
    return new THREE.Vector3(c[0] * 4, 1.7, c[2] * 4);
  };
  const ext = exteriors[0]!;
  level.update(1, 1 / 60, centre('R07'), false);
  level.update(1.1, 1 / 60, centre('R07'), false);
  assert.equal(ext.visible, false, 'hidden from the Security Office');
  level.update(1.2, 1 / 60, centre('R12b'), false);
  level.update(1.3, 1 / 60, centre('R12b'), false);
  assert.equal(ext.visible, true, 'drawn from the Grow Hall');
});

test('hydroponics wing (R12a-R12e) props stay inside room bounds, do not overlap, and include all story/functional gear', () => {
  const mats = fakeMaterials();
  const deg = THREE.MathUtils.degToRad;
  const hydroIds = ['R12a', 'R12b', 'R12c', 'R12d', 'R12e'];
  for (const id of hydroIds) {
    const r = data.rooms.find((x) => x.id === id)!;
    const cells = r.pieces.flatMap((p) => p.cells ?? (p.cell ? [p.cell] : []));
    const minX = Math.min(...cells.map((c) => c[0] * 4 - 1.75));
    const maxX = Math.max(...cells.map((c) => c[0] * 4 + 1.75));
    const minZ = Math.min(...cells.map((c) => c[2] * 4 - 1.75));
    const maxZ = Math.max(...cells.map((c) => c[2] * 4 + 1.75));
    const propBoxes: Array<{ label: string; min: [number, number, number]; max: [number, number, number] }> = [];
    for (const p of r.props ?? []) {
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(...p.pos),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, deg(p.rot ?? 0), 0, 'YXZ')),
        new THREE.Vector3(1, 1, 1),
      );
      const out = registry.create(p.kit, { ceiling: r.height ?? 3.2, area: r.area ?? 'hydroponics', ...(p.params ?? {}) }, new Rng(`${id}:${p.kit}:${p.pos.join(',')}`), mats);
      for (const c of out.colliders) {
        const b = new THREE.Box3(new THREE.Vector3(...c.min), new THREE.Vector3(...c.max)).applyMatrix4(m);
        assert.ok(b.min.x >= minX - 0.1 && b.max.x <= maxX + 0.1, `${id} ${p.kit} X [${b.min.x.toFixed(2)}, ${b.max.x.toFixed(2)}] inside [${minX}, ${maxX}]`);
        assert.ok(b.min.z >= minZ - 0.1 && b.max.z <= maxZ + 0.1, `${id} ${p.kit} Z [${b.min.z.toFixed(2)}, ${b.max.z.toFixed(2)}] inside [${minZ}, ${maxZ}]`);
        propBoxes.push({ label: `${p.kit}@${p.pos.join(',')}`, min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] });
      }
    }
    for (let i = 0; i < propBoxes.length; i++) {
      for (let j = i + 1; j < propBoxes.length; j++) {
        const a = propBoxes[i]!;
        const b = propBoxes[j]!;
        if (a.label === b.label) continue;
        const overlap =
          a.min[0] < b.max[0] - 0.01 && a.max[0] > b.min[0] + 0.01 &&
          a.min[1] < b.max[1] - 0.01 && a.max[1] > b.min[1] + 0.01 &&
          a.min[2] < b.max[2] - 0.01 && a.max[2] > b.min[2] + 0.01;
        assert.ok(!overlap, `${id}: ${a.label} overlaps ${b.label}`);
      }
    }
    for (const n of r.npcs ?? []) {
      const pos = typeof n.at === 'string' ? r.anchors!.find((a) => a.id === n.at)!.pos : n.at;
      for (const b of propBoxes) {
        const cx = Math.max(b.min[0], Math.min(pos[0], b.max[0]));
        const cz = Math.max(b.min[2], Math.min(pos[2], b.max[2]));
        assert.ok(Math.hypot(pos[0] - cx, pos[2] - cz) >= 0.25, `${id} NPC ${n.id} clips ${b.label}`);
      }
    }
  }
  const kitsIn = (id: string): Set<string> => new Set((data.rooms.find((r) => r.id === id)!.props ?? []).map((p) => p.kit));
  const pieceKitsIn = (id: string): Set<string> => new Set(data.rooms.find((r) => r.id === id)!.pieces.map((p) => p.kit));
  assert.ok(kitsIn('R12a').has('bio_wash_station') && kitsIn('R12a').has('boot_wash_mat') && kitsIn('R12a').has('coat_rack'), 'R12a biosecurity vestibule gear');
  assert.ok(kitsIn('R12b').has('plant_rack') && kitsIn('R12b').has('hydro_workstation') && kitsIn('R12b').has('hydro_trough') && kitsIn('R12b').has('harvest_cart'), 'R12b grow hall gear');
  assert.ok(pieceKitsIn('R12b').has('wall_window') && pieceKitsIn('R12b').has('wall_glass_partition') && !pieceKitsIn('R12b').has('wall_greenhouse'), 'R12b uses real ocean windows & glass partition instead of fake wall_greenhouse');
  assert.ok(kitsIn('R12c').has('germination_cabinet') && kitsIn('R12c').has('seed_vault') && kitsIn('R12c').has('lab_bench'), 'R12c seed & harvest prep lab gear');
  assert.ok(kitsIn('R12d').has('fertigation_tank') && kitsIn('R12d').has('hvac_dehumidifier') && !kitsIn('R12d').has('specimen_tank'), 'R12d uses fertigation tanks & dehumidifier instead of alien specimen tanks');
  assert.ok(kitsIn('R12e').has('camp_cot') && kitsIn('R12e').has('kettle_set') && kitsIn('R12e').has('fertiliser_pallet') && !kitsIn('R12e').has('radio'), 'R12e includes cot, kettle+dog photo and fertiliser pallet, and no radio (hydroponics-wing spec)');

  // Distinct room ambience presets across all five Hydroponics rooms + staggered R12b misters with a sputter rail.
  const ambOf = (id: string): string | undefined => data.rooms.find((r) => r.id === id)!.atmosphere?.ambience;
  assert.equal(ambOf('R12a'), 'hydro_vestibule');
  assert.equal(ambOf('R12b'), 'hydro_misters');
  assert.equal(ambOf('R12c'), 'hydro_seed_lab');
  assert.equal(ambOf('R12d'), 'hydro_plant_room');
  assert.equal(ambOf('R12e'), 'hydro_storeroom');
  const misters = (data.rooms.find((r) => r.id === 'R12b')!.props ?? []).filter((p) => p.kit === 'mister');
  assert.equal(misters.length, 4, 'four overhead mister rails in R12b');
  assert.equal(new Set(misters.map((m) => `${m.params?.['period']}:${m.params?.['offset']}`)).size, 4, 'staggered mister cycles');
  assert.ok(misters.some((m) => m.params?.['sputter'] === true), 'at least one opinionated sputtering rail');
});

test('hydroponics work spots stay clear of colliders, navmesh-reachable across R12b/R12c/R12d, and botanists have roam zones', async () => {
  const { initNavmesh } = await import('../ai/navmesh.ts');
  await initNavmesh();
  const { level } = build();
  const nav = level.navGraph();
  const workIn = (roomId: string) => level.spots(roomId).filter((s) => s.kind.startsWith('work_'));
  const r12b = workIn('R12b');
  const r12c = workIn('R12c');
  const r12d = workIn('R12d');
  assert.ok(r12b.length >= 6, `R12b has work spots (${r12b.length})`);
  assert.ok(r12c.length >= 3, `R12c has work spots (${r12c.length})`);
  assert.ok(r12d.length >= 2, `R12d has work spots (${r12d.length})`);

  const fromR12b = level.anchor('cp_round_hydro')!.pos;
  for (const s of [...r12b, ...r12d]) {
    const path = nav.findPath({ x: fromR12b.x, y: 0, z: fromR12b.z }, { x: s.pos.x, y: 0, z: s.pos.z });
    assert.ok(path && path.length >= 1, `R12b -> ${s.room} spot ${s.id} (${s.kind}) reachable on navmesh`);
  }
  const fromR12c = r12c[0]!.pos;
  for (const s of r12c) {
    const path = nav.findPath({ x: fromR12c.x, y: 0, z: fromR12c.z }, { x: s.pos.x, y: 0, z: s.pos.z });
    assert.ok(path && path.length >= 1, `R12c spot ${s.id} (${s.kind}) reachable on navmesh`);
  }

  const spawns = new Map(level.npcSpawns().map((n) => [n.id, n]));
  assert.deepEqual(spawns.get('botanist_1')?.roam, ['R12b', 'R12d']);
  assert.deepEqual(spawns.get('botanist_2')?.roam, ['R12b']);
  assert.deepEqual(spawns.get('botanist_3')?.roam, ['R12c']);
});

test('security and medical bay (R07, R07a, R08, R08b) props stay inside their rooms, do not overlap, and keep the doors clear (medbay-attack spec)', () => {
  const mats = fakeMaterials();
  const deg = THREE.MathUtils.degToRad;
  const ids = ['R07', 'R07a', 'R08', 'R08b'];
  type Box = { label: string; min: [number, number, number]; max: [number, number, number] };
  const all: Box[] = [];
  const bad: string[] = [];
  const check = (ok: boolean, msg: string): void => void (ok || bad.push(msg));
  for (const id of ids) {
    const r = data.rooms.find((x) => x.id === id)!;
    const cells = r.pieces.flatMap((p) => p.cells ?? (p.cell ? [p.cell] : []));
    const minX = Math.min(...cells.map((c) => c[0] * 4 - 1.75));
    const maxX = Math.max(...cells.map((c) => c[0] * 4 + 1.75));
    const minZ = Math.min(...cells.map((c) => c[2] * 4 - 1.75));
    const maxZ = Math.max(...cells.map((c) => c[2] * 4 + 1.75));
    const boxes: Box[] = [];
    for (const p of r.props ?? []) {
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(...p.pos),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, deg(p.rot ?? 0), 0, 'YXZ')),
        new THREE.Vector3(1, 1, 1),
      );
      const out = registry.create(p.kit, { ceiling: r.height ?? 3.2, area: r.area ?? 'security', ...(p.params ?? {}) }, new Rng(`${id}:${p.kit}:${p.pos.join(',')}`), mats);
      for (const c of out.colliders) {
        const b = new THREE.Box3(new THREE.Vector3(...c.min), new THREE.Vector3(...c.max)).applyMatrix4(m);
        // "Nothing in the walls": every collider inside the room's inner wall faces (0.08 m for flush wall mounts).
        check(b.min.x >= minX - 0.08 && b.max.x <= maxX + 0.08, `${id} ${p.kit}@${p.pos.join(',')} X [${b.min.x.toFixed(2)}, ${b.max.x.toFixed(2)}] inside [${minX}, ${maxX}]`);
        check(b.min.z >= minZ - 0.08 && b.max.z <= maxZ + 0.08, `${id} ${p.kit}@${p.pos.join(',')} Z [${b.min.z.toFixed(2)}, ${b.max.z.toFixed(2)}] inside [${minZ}, ${maxZ}]`);
        boxes.push({ label: `${id} ${p.kit}@${p.pos.join(',')}`, min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] });
      }
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        if (a.label === b.label) continue;
        const overlap =
          a.min[0] < b.max[0] - 0.01 && a.max[0] > b.min[0] + 0.01 &&
          a.min[1] < b.max[1] - 0.01 && a.max[1] > b.min[1] + 0.01 &&
          a.min[2] < b.max[2] - 0.01 && a.max[2] > b.min[2] + 0.01;
        check(!overlap, `${a.label} overlaps ${b.label}`);
      }
    }
    all.push(...boxes);
  }
  // "Doors are clear": no floor-standing collider in a door's 2 m opening or 1.2 m in front of it, on either side.
  const SIDE: Record<number, [number, number]> = { 0: [0, -1], 90: [-1, 0], 180: [0, 1], 270: [1, 0] };
  const doors = data.doors.filter((d) => d.between.some((b) => ids.includes(b)));
  for (const want of ['D_R06_R07', 'D_R07_R07a', 'D_R07_R09', 'D_R07_R08', 'D_R08_R08b']) assert.ok(doors.some((d) => d.id === want), want);
  for (const d of doors) {
    const [sx, sz] = SIDE[d.rot]!;
    const ex = d.cell[0] * 4 + sx * 2;
    const ez = d.cell[2] * 4 + sz * 2;
    const half = [sx !== 0 ? 1.2 : 1.0, sz !== 0 ? 1.2 : 1.0];
    for (const b of all) {
      if (b.min[1] > 2.0) continue; // wall-mounted above head height
      const hit = b.min[0] < ex + half[0]! && b.max[0] > ex - half[0]! && b.min[2] < ez + half[1]! && b.max[2] > ez - half[1]!;
      check(!hit, `${b.label} stands in front of ${d.id}`);
    }
  }
  assert.deepEqual(bad, [], `R07/R07a/R08/R08b placement:\n${bad.join('\n')}`);
});

test('no one waits in a Commons doorway: R02 NPC spots stay out of door give-way reach (intro-sequence spec)', () => {
  const room = data.rooms.find((r) => r.id === 'R02')!;
  const anchors = new Map((room.anchors ?? []).map((a) => [a.id, a.pos as [number, number, number]]));
  // Every spot an NPC is sent to in the Commons by any sequence, plus where the level puts its NPCs.
  const spots: Array<{ label: string; x: number; z: number }> = [];
  const visit = (node: unknown, file: string): void => {
    if (Array.isArray(node)) return node.forEach((n) => visit(n, file));
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    const target = o['do'] === 'npcMoveTo' ? o['to'] : o['do'] === 'spawn' ? o['at'] : undefined;
    const id = typeof target === 'string' && target.startsWith('anchor:') ? target.slice(7) : undefined;
    const pos = id ? anchors.get(id) : undefined;
    if (pos) spots.push({ label: `${file}: ${String(o['npc'])} -> ${id}`, x: pos[0], z: pos[2] });
    for (const v of Object.values(o)) visit(v, file);
  };
  for (const file of readdirSync(new URL('../data/sequences/', import.meta.url)).filter((f) => f.endsWith('.json'))) {
    visit(JSON.parse(readFileSync(new URL(`../data/sequences/${file}`, import.meta.url), 'utf8')), file);
  }
  for (const n of room.npcs ?? []) {
    const pos = typeof n.at === 'string' ? anchors.get(n.at) : (n.at as [number, number, number]);
    if (pos) spots.push({ label: `level npc ${n.id}`, x: pos[0], z: pos[2] });
  }
  assert.ok(spots.length >= 10, `found ${spots.length} Commons NPC spots`);
  // A door's front box on either side: 1.0 m each way along it, GIVE_WAY.doorReach (1.2 m) out from it.
  const SIDE: Record<number, [number, number]> = { 0: [0, -1], 90: [-1, 0], 180: [0, 1], 270: [1, 0] };
  const bad: string[] = [];
  for (const d of data.doors.filter((x) => x.between.includes('R02'))) {
    const [sx, sz] = SIDE[d.rot]!;
    const ex = d.cell[0] * 4 + sx * 2;
    const ez = d.cell[2] * 4 + sz * 2;
    const hx = sx !== 0 ? GIVE_WAY.doorReach : 1.0;
    const hz = sz !== 0 ? GIVE_WAY.doorReach : 1.0;
    for (const s of spots) if (Math.abs(s.x - ex) < hx && Math.abs(s.z - ez) < hz) bad.push(`${s.label} (${s.x}, ${s.z}) waits in front of ${d.id}`);
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('Priya waits off-stage in the shut surgery, outside the admin booth CAM 04 medbay shot (priya-commons-exit)', () => {
  const anchors = new Map(data.rooms.flatMap((r) => (r.anchors ?? []).map((a) => [a.id, { room: r.id, pos: a.pos as [number, number, number] }] as const)));
  const spot = anchors.get('priya_offstage');
  assert.ok(spot, 'priya_offstage exists');
  assert.equal(spot.room, 'R08b');
  // The feed (rounds.json) looks from cam04_pos to cam04_look with a 62 degree vertical FOV. Even a wide 16:9 frame
  // is under 100 degrees across, so a point more than 50 degrees off the view axis (or behind it) is out of frame.
  const from = anchors.get('cam04_pos')!.pos;
  const to = anchors.get('cam04_look')!.pos;
  const offAxis = (p: [number, number, number]): number => {
    const ax = to[0] - from[0], az = to[2] - from[2];
    const px = p[0] - from[0], pz = p[2] - from[2];
    return THREE.MathUtils.radToDeg(Math.acos((ax * px + az * pz) / (Math.hypot(ax, az) * Math.hypot(px, pz))));
  };
  assert.ok(offAxis(spot.pos) > 50, `priya_offstage is ${offAxis(spot.pos).toFixed(0)} degrees off the CAM 04 axis`);
  assert.ok(offAxis(anchors.get('priya_r08')!.pos) < 31, 'priya_r08 is in the CAM 04 shot, which is why she does not wait there');
});

test('medbay staging: clear spine, viewing strip, stage and lane; the shotgun faces the door; Jay sees the cart (medbay-attack spec)', () => {
  const mats = fakeMaterials();
  const deg = THREE.MathUtils.degToRad;
  const room = (id: string) => data.rooms.find((r) => r.id === id)!;
  const anchor = (id: string): [number, number, number] => data.rooms.flatMap((r) => r.anchors ?? []).find((a) => a.id === id)!.pos as [number, number, number];
  const boxesOf = (id: string): Array<{ kit: string; box: THREE.Box3 }> => {
    const r = room(id);
    const out: Array<{ kit: string; box: THREE.Box3 }> = [];
    for (const p of r.props ?? []) {
      // Loose props (the cart's instruments, livelier-cart-slam D12) have no collision for movement: never in the way.
      if (p.dynamic?.loose) continue;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(...p.pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, deg(p.rot ?? 0), 0, 'YXZ')), new THREE.Vector3(1, 1, 1));
      const made = registry.create(p.kit, { ceiling: r.height ?? 3.2, area: r.area ?? 'security', ...(p.params ?? {}) }, new Rng(`${id}:${p.kit}:${p.pos.join(',')}`), mats);
      for (const c of made.colliders) out.push({ kit: p.kit, box: new THREE.Box3(new THREE.Vector3(...c.min), new THREE.Vector3(...c.max)).applyMatrix4(m) });
    }
    return out;
  };
  const floor = (b: THREE.Box3): boolean => b.min.y < 2.0;
  const hitsRect = (b: THREE.Box3, x0: number, x1: number, z0: number, z1: number): boolean => b.min.x < x1 && b.max.x > x0 && b.min.z < z1 && b.max.z > z0;
  const dist2d = (b: THREE.Box3, x: number, z: number): number => Math.hypot(x - Math.max(b.min.x, Math.min(x, b.max.x)), z - Math.max(b.min.z, Math.min(z, b.max.z)));

  // R07: the spine from the entry to the glass and the viewing strip along it stay clear.
  const r07 = boxesOf('R07').filter((b) => floor(b.box));
  for (const { kit, box } of r07) {
    assert.ok(!hitsRect(box, -1.5, 1.5, 38.25, 45.75), `R07 ${kit} in the spine`);
    assert.ok(!hitsRect(box, -5.75, 5.75, 44.6, 45.75), `R07 ${kit} in the viewing strip`);
  }

  // R07a "The shotgun is in view": the rack holding it faces the door, and from the R07 side of the doorway the pickup is ahead.
  const rack = room('R07a').props!.find((p) => p.kit === 'armory_rack' && Math.abs(p.pos[0] - 9.45) < 0.3)!;
  assert.equal(rack.rot, 90, 'the shotgun rack faces west, toward D_R07_R07a');
  const gun = anchor('shotgun_pickup');
  const door = data.doors.find((d) => d.id === 'D_R07_R07a')!;
  const doorway: [number, number] = [door.cell[0] * 4 + 2 - 0.4, door.cell[2] * 4];
  const ang = Math.abs(Math.atan2(gun[2] - doorway[1], gun[0] - doorway[0]));
  assert.ok(ang < deg(30), `shotgun is ${THREE.MathUtils.radToDeg(ang).toFixed(0)} deg off the door's normal`);
  assert.ok(Math.abs(gun[0] - rack.pos[0]) < 0.3 && Math.abs(gun[2] - rack.pos[2]) < 1.2, 'the pickup sits on that rack');

  // R08 "Only the cart in front of the pane": nothing else within 2.5 m of the centre pane (x -2..2 on the partition, z 46.0).
  const r08 = boxesOf('R08');
  for (const { kit, box } of r08) {
    if (kit === 'instrument_cart') continue;
    const d = Math.hypot(Math.max(0, box.min.x - 2, -2 - box.max.x), Math.max(0, box.min.z - 46.0));
    assert.ok(d >= 2.5, `R08 ${kit} is ${d.toFixed(2)} m from the centre pane`);
  }
  // "Clear lane": the creature's route surgery door -> along the glass -> the impale spot keeps 0.6 m from every R08 collider.
  // (Along the glass, between the pane and the cart, then in to the corner.)
  const route: Array<[number, number, number]> = ['r08_lurk', 'r08_surgery_out', 'r08_surgery_in', 'r08_back', 'r08_lane2', 'r08_impale'].map(anchor);
  for (let i = 0; i + 1 < route.length; i++) {
    const [a, b] = [route[i]!, route[i + 1]!];
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const x = a[0] + (b[0] - a[0]) * t;
      const z = a[2] + (b[2] - a[2]) * t;
      for (const { kit, box } of r08) assert.ok(dist2d(box, x, z) >= 0.6, `lane point (${x.toFixed(2)}, ${z.toFixed(2)}) is ${dist2d(box, x, z).toFixed(2)} m from ${kit}`);
    }
  }
  // Priya's walks (beds -> door -> wall) are navmesh routes round the cart; 'medbay rescue staging' checks they reach.

  // R08: the stinger's CAM 04 sees her resting spot (no collider on the line of sight).
  const cam = new THREE.Vector3(...anchor('cam04_pos'));
  for (const target of ['cam04_stinger_look', 'priya_rest']) {
    const to = new THREE.Vector3(...anchor(target)).setY(Math.max(0.3, anchor(target)[1]));
    const ray = new THREE.Ray(cam, to.clone().sub(cam).normalize());
    const len = cam.distanceTo(to);
    for (const { kit, box } of r08) {
      if (kit === 'med_bed') continue;
      const hit = ray.intersectBox(box, new THREE.Vector3());
      assert.ok(!hit || hit.distanceTo(cam) > len, `stinger view to ${target} blocked by ${kit}`);
    }
  }

  // Everyone who stands on a spot in these rooms stands clear of the furniture (capsule 0.3 m).
  const spots = ['r07_glass_jay', 'r07_glass_giles', 'r07_glass_okafor', 'r07_medbay_door', 'r07_armory_panel', 'okafor_biometric', 'r07_regroup', 'r07_panel', 'priya_wait', 'priya_door', 'priya_sit', 'priya_cower', 'r08_impale', 'r08_along', 'priya_rest', 'r07_console', 'cam04_figure', 'r08_lurk', 'r08_slam_spot'];
  const furniture = [...boxesOf('R07'), ...boxesOf('R07a'), ...r08, ...boxesOf('R08b')].filter((b) => floor(b.box));
  for (const id of spots) {
    const a = anchor(id);
    for (const { kit, box } of furniture) assert.ok(dist2d(box, a[0], a[2]) >= 0.3, `${id} stands ${dist2d(box, a[0], a[2]).toFixed(2)} m from ${kit}`);
  }

  // 1.7 "Close enough to see" and "Nothing in the way": Jay's eye to the cart top.
  const jay = anchor('r07_glass_jay');
  const eye = new THREE.Vector3(jay[0], 1.62, jay[2]);
  const top = new THREE.Vector3(...anchor('r08_cart_top'));
  assert.ok(eye.distanceTo(top) < 2.5, `cart top ${eye.distanceTo(top).toFixed(2)} m from Jay's eye`);
  const ray = new THREE.Ray(eye, top.clone().sub(eye).normalize());
  const len = eye.distanceTo(top);
  for (const { kit, box } of [...boxesOf('R07'), ...r08]) {
    if (kit === 'instrument_cart') continue;
    const hit = ray.intersectBox(box, new THREE.Vector3());
    assert.ok(!hit || hit.distanceTo(eye) > len, `Jay's view of the cart blocked by ${kit}`);
  }
  // It crosses the partition through the glass (sill 0.35 m, head 2.54 m), not the frame.
  const tCross = (45.875 - eye.z) / (top.z - eye.z);
  const yCross = eye.y + (top.y - eye.y) * tCross;
  assert.ok(yCross > 0.45 && yCross < 2.4, `crosses the partition at y ${yCross.toFixed(2)}`);
  // Okafor and Giles stand off that line (0.5 m in plan).
  for (const id of ['r07_glass_okafor', 'r07_glass_giles', 'r07_medbay_door']) {
    const a = anchor(id);
    const dx = top.x - eye.x, dz = top.z - eye.z;
    const t = Math.max(0, Math.min(1, ((a[0] - eye.x) * dx + (a[2] - eye.z) * dz) / (dx * dx + dz * dz)));
    const off = Math.hypot(a[0] - (eye.x + dx * t), a[2] - (eye.z + dz * t));
    assert.ok(off >= 0.5, `${id} is ${off.toFixed(2)} m from Jay's line to the cart`);
  }
});

test('dive bay lanes fit two capsules side by side between the R13b doors (dive-bay spec, budgets and clearance)', () => {
  const { level } = build();
  const found: Array<{ tag: string; minY: number; maxY: number; enabled: boolean }> = [];
  // Door to door through the launch hall: from R13a to R13e and R13c (R13b east wall to R13d is solid).
  const routes: Array<Array<[number, number]>> = [
    [[24, 30.5], [21.2, 33.6], [21.0, 38.6], [18.6, 40]],
    [[24, 30.5], [21.0, 32.1], [18.6, 32]],
  ];
  for (const route of routes) {
    for (let i = 1; i < route.length; i++) {
      const [ax, az] = route[i - 1]!;
      const [bx, bz] = route[i]!;
      const len = Math.hypot(bx - ax, bz - az);
      const nx = -(bz - az) / len;
      const nz = (bx - ax) / len;
      for (let s = 0; s <= len; s += 0.1) {
        for (const side of [-0.4, 0.4]) {
          const x = ax + ((bx - ax) * s) / len + nx * side;
          const z = az + ((bz - az) * s) / len + nz * side;
          found.length = 0;
          level.collision.find(x - 0.35, z - 0.35, x + 0.35, z + 0.35, found as never);
          const blocking = found.filter((c) => c.enabled && !c.tag.startsWith('door:') && c.maxY > 0.36 && c.minY < 1.7);
          assert.equal(blocking.length, 0, `capsule at ${x.toFixed(2)},${z.toFixed(2)} hits ${blocking.map((c) => c.tag).join(', ')}`);
        }
      }
    }
  }
});

test('dive bay (R13a-R13e) props stay inside room bounds, do not overlap, and NPCs stand clear of them', () => {
  const mats = fakeMaterials();
  const deg = THREE.MathUtils.degToRad;
  for (const id of ['R13a', 'R13b', 'R13c', 'R13d', 'R13e']) {
    const r = data.rooms.find((x) => x.id === id)!;
    const cells = r.pieces.flatMap((p) => p.cells ?? (p.cell ? [p.cell] : []));
    const minX = Math.min(...cells.map((c) => c[0] * 4 - 1.75));
    const maxX = Math.max(...cells.map((c) => c[0] * 4 + 1.75));
    const minZ = Math.min(...cells.map((c) => c[2] * 4 - 1.75));
    const maxZ = Math.max(...cells.map((c) => c[2] * 4 + 1.75));
    const boxes: Array<{ label: string; box: THREE.Box3 }> = [];
    for (const p of r.props ?? []) {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(...p.pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, deg(p.rot ?? 0), 0, 'YXZ')), new THREE.Vector3(1, 1, 1));
      const out = registry.create(p.kit, { ceiling: (r.height ?? 3.2) - p.pos[1], area: r.area ?? 'dive_bay', ...(p.params ?? {}) }, new Rng(`${id}:${p.kit}:${p.pos.join(',')}`), mats);
      for (const c of out.colliders) {
        const b = new THREE.Box3(new THREE.Vector3(...c.min), new THREE.Vector3(...c.max)).applyMatrix4(m);
        assert.ok(b.min.x >= minX - 0.1 && b.max.x <= maxX + 0.1 && b.min.z >= minZ - 0.1 && b.max.z <= maxZ + 0.1, `${id} ${p.kit} inside the room`);
        boxes.push({ label: `${p.kit}@${p.pos.join(',')}`, box: b });
      }
      if (id === 'R13d') {
        out.object.applyMatrix4(m);
        out.object.updateMatrixWorld(true);
        const vb = new THREE.Box3().setFromObject(out.object);
        assert.ok(vb.min.x >= minX - 0.1 && vb.max.x <= maxX + 0.1 && vb.min.z >= minZ - 0.1 && vb.max.z <= maxZ + 0.1, `${id} ${p.kit} visual mesh stays inside room bounds`);
      }
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        if (boxes[i]!.label === boxes[j]!.label) continue;
        const a = boxes[i]!.box.clone().expandByScalar(-0.01);
        assert.ok(!a.intersectsBox(boxes[j]!.box), `${id}: ${boxes[i]!.label} overlaps ${boxes[j]!.label}`);
      }
    }
    for (const n of r.npcs ?? []) {
      const pos = typeof n.at === 'string' ? r.anchors!.find((a) => a.id === n.at)!.pos : n.at;
      for (const { label, box } of boxes) {
        if (box.min.y > 1.8) continue;
        const cx = Math.max(box.min.x, Math.min(pos[0], box.max.x));
        const cz = Math.max(box.min.z, Math.min(pos[2], box.max.z));
        assert.ok(Math.hypot(pos[0] - cx, pos[2] - cz) >= 0.25, `${id} NPC ${n.id} clips ${label}`);
      }
    }
  }
});

test('dive bay rooms have their roles: four dive_bay rooms, no dive-suit racks, cold store at stow point, and R13d detached', () => {
  const props = data.rooms.flatMap((r) => (r.props ?? []).map((p) => ({ room: r.id, ...p })));
  assert.equal(props.filter((p) => p.kit === 'dive_suit_rack').length, 0, 'no open-water dive suits anywhere in slice01');
  const diveNames = Object.fromEntries(data.rooms.filter((r) => r.area === 'dive_bay').map((r) => [r.id, r.name]));
  assert.deepEqual(diveNames, { R13a: 'Wet Vestibule', R13b: 'Launch Hall', R13c: 'ROV Workshop', R13e: 'Sample Store' });
  assert.equal(data.rooms.find((r) => r.id === 'R13d')!.area, 'transit', 'R13d belongs to transit wing');
  const store = props.find((p) => p.kit === 'cold_store')!;
  assert.equal(store.room, 'R13e');
  const locker = data.rooms.find((r) => r.id === 'R13e')!.anchors!.find((a) => a.id === 'dive_case_locker')!;
  assert.ok(Math.hypot(store.pos[0] - locker.pos[0], store.pos[2] - locker.pos[2]) < 0.9, 'the stow anchor is at the cold store');
  for (const kit of ['gantry_crane', 'rov', 'tether_winch', 'pilot_console', 'whiteboard', 'wet_bench', 'core_rack', 'eyewash_station', 'shadow_board']) {
    assert.ok(props.some((p) => p.room === 'R13b' && p.kit === kit), `R13b has a ${kit}`);
  }
  assert.equal(props.some((p) => p.room === 'R13d' && (p.kit === 'pipe_run' || p.kit === 'pipe_leak')), false, 'blocking R13d pipe and leak removed');
});

test('dive bay signage and wear: plates by the entries, and 4-8 wear decals per clean room (surface-dressing §4)', () => {
  const props = (id: string) => data.rooms.find((r) => r.id === id)!.props ?? [];
  const r13bSign = props('R13b').find((p) => p.kit === 'room_sign')!;
  assert.equal(`${r13bSign.params!['code']} · ${r13bSign.params!['name']}`, 'R13B · LAUNCH HALL');
  for (const id of ['R13a', 'R13b', 'R13c', 'R13d', 'R13e']) assert.equal(props(id).filter((p) => p.kit === 'room_sign').length, 1, `${id} plate`);
  for (const id of ['R13a', 'R13b', 'R13c', 'R13e']) {
    assert.notEqual(props(id).find((p) => p.kit === 'room_sign')!.params!['panel'], false, `${id} life-support panel`);
    const n = props(id).filter((p) => p.kit === 'floor_wear').length;
    assert.ok(n >= 4 && n <= 8, `${id}: ${n} wear decals`);
  }
  assert.equal(props('R13d').find((p) => p.kit === 'room_sign')!.params!['panel'], false, 'R13d plate only');
  assert.ok(props('R13b').some((p) => p.kit === 'pipe_labels'), 'R13b pipe labels');
});

test('security and medbay overhaul: low fog, cleanWall armory walls, 8-light shared pool, and purposeful dressing (security-medbay spec)', () => {
  const room = (id: string) => data.rooms.find((r) => r.id === id)!;
  for (const id of ['R07', 'R07a', 'R08', 'R08b']) {
    const fog = room(id).atmosphere?.fogDensity ?? 0;
    assert.ok(fog > 0 && fog <= 0.025, `${id} fogDensity ${fog} <= 0.025`);
  }
  const r07aWalls = room('R07a').pieces.filter((p) => p.kit.startsWith('wall_'));
  assert.ok(r07aWalls.length > 0, 'R07a has wall pieces');
  for (const w of r07aWalls) assert.equal(w.params?.material, 'cleanWall', 'R07a walls override to cleanWall');
  // A standby emergency beacon (`off` until backup power) takes no pooled light on main power.
  const pooled = (id: string) => (room(id).lights ?? []).filter((l) => l.pool !== false && !(l.slot === 'emergency' && l.pattern === 'off')).length;
  const totalPooled = pooled('R07') + pooled('R07a') + pooled('R08');
  assert.ok(totalPooled <= 8, `R07 (${pooled('R07')}) + R07a (${pooled('R07a')}) + R08 (${pooled('R08')}) = ${totalPooled} <= 8`);
  assert.equal(pooled('R07a'), 2, 'R07a has overhead + dedicated rack light');
  assert.ok((room('R07a').props ?? []).some((p) => p.kit === 'pendant_light' && p.params?.slots === true), 'R07a rack pendant_light');
  assert.equal((room('R07').lights ?? []).filter((l) => l.slot !== 'emergency').length, 6, 'all R07 ceiling slots claimed (no dead diffusers)');
  assert.equal((room('R08').lights ?? []).filter((l) => l.slot !== 'emergency').length, 6, 'all R08 ceiling slots claimed (no dead diffusers)');
  for (const kit of ['notice_board', 'wall_clock', 'mug', 'desk_wand']) {
    assert.ok((room('R07').props ?? []).some((p) => p.kit === kit), `R07 has ${kit}`);
  }
  for (const kit of ['bio_wash_station', 'lab_cabinet', 'wall_clock']) {
    assert.ok((room('R08').props ?? []).some((p) => p.kit === kit), `R08 has ${kit}`);
  }
});

// station-power spec "Every room keeps some light": under backup power each room has a backup light.
test('under backup power every room keeps at least one light, and the post-lab path uses its beacons', () => {
  const { level } = build();
  level.setPower('backup');
  const fallback: string[] = [];
  for (const r of data.rooms) {
    const lights = level.roomLights(r.id);
    if (lights.length === 0) continue;
    const lit = lights.filter((l) => l.light.power > 0);
    assert.ok(lit.length >= 1, `${r.id} keeps a light`);
    if (!lit.some((l) => l.kind === 'emergency') && !(r.lights ?? []).some((l) => l.backup)) fallback.push(r.id);
  }
  for (const id of ['R02', 'R05', 'R06', 'R07', 'R08', 'R09', 'R11']) assert.ok(!fallback.includes(id), `${id} is lit by its beacons`);
  console.log(`[station-power] rooms still on the first-light fallback: ${fallback.join(', ')}`);
});

// flooded-tunnel spec (overhaul-flooded-tunnel group 7): the R09 sump and the R10 pump room.
test('R09 is a sump: the water stays below both doors and the landings are out of jump reach', () => {
  const { level } = build(new Inventory(items));
  const water = level.water.room('R09');
  assert.ok(water, 'R09 has standing water');
  const sump = level.floorAt(10.8, 43);
  assert.ok(Math.abs(sump - -1.2) < 0.01, `sump floor ${sump}`);
  assert.ok(Math.abs(water.level - sump - 0.75) < 0.01, 'about 0.75 m deep');
  for (const [name, x, z] of [['R07 landing', 6.7, 44], ['R10 landing', 29.3, 48]] as const) {
    const top = level.floorAt(x, z);
    assert.ok(Math.abs(top) < 0.01, `${name} at deck level (${top})`);
    assert.ok(water.level < top - 0.3, `${name}: the waterline stays below the threshold`);
    assert.ok(top - sump > 0.9, `${name}: more than a water jump's reach above the sump floor`);
  }
});

test('the squad and enemies can path from R07 through the sump to the pump room', () => {
  const { level } = build(new Inventory(items));
  const doors = (level as unknown as { doors: Array<{ collider: { enabled: boolean } }> }).doors;
  for (const d of doors) d.collider.enabled = false;
  const nav = level.navGraph();
  const path = nav.findPath({ x: 6.8, y: 0, z: 39.1 }, { x: 34, y: 0, z: 50 }, { radius: 0.3 });
  assert.ok(path, 'a route');
  assert.ok(path.some((p) => p.y < -1), 'through the sump');
});

// dive-bay + transit-wing specs (finale-transit-rooms-geometry): solid wall between R13b and R13d,
// walkable transit wing (R11 -> R13d -> R15a -> Train A; Train B -> R16a -> stairs -> R16b -> R16c),
// and isolated Arrival Terminal culled from the departure wing.
test('transit wing: solid Dive Bay wall, walkable departure bay and grand arrival terminal, and arrival culled from departure', () => {
  const { level } = build();
  assert.equal(data.doors.some((d) => d.id === 'D_R13b_R13d'), false, 'no D_R13b_R13d door in slice01');
  const r11 = data.rooms.find((r) => r.id === 'R11')!;
  assert.equal(r11.name, 'Power Bay');
  assert.equal(r11.height, 5);
  assert.equal(data.rooms.find((r) => r.id === 'R16b')!.height, 8, 'R16b has 8.0 m grand concourse ceiling');

  // Solid wall separates Launch Hall (x=29.2, z=32) from R13d (x=30.8, z=32).
  const wallHits = level.collision.query(29.7, 31.5, 30.3, 32.5, []).filter((b) => b.max[1] > 2.5);
  assert.ok(wallHits.length > 0, 'solid wall collider separates R13b and R13d');

  // Arrival terminal is culled when standing in R11, R13d, or R15a.
  for (const anchorId of ['r11_hold', 'dark_corridor', 'r15a_platform']) {
    const a = level.anchor(anchorId)!.pos;
    level.update(0, 0.016, new THREE.Vector3(a.x, a.y + 1.62, a.z), false);
    for (const arr of ['R16a', 'R16b', 'R16c']) {
      assert.equal(level.group.getObjectByName(`room:${arr}`)!.visible, false, `${arr} culled from ${anchorId}`);
    }
  }

  // Headless walk: R11 -> R13d -> R15a -> inside Train Car A, and Train Car B -> west platform -> south stairs -> R16b -> R16c.
  level.setDoor('D_R13d_R11', 'open');
  level.setDoor('D_R13d_R15a', 'open');
  level.setDoor('D_R16b_R16c', 'open');
  const openEye = new THREE.Vector3(36, 1.62, 34);
  for (let i = 0; i < 120; i++) level.update(i / 30, 1 / 30, openEye, false);
  const nav = level.navGraph();
  const walkChain = (startAnchor: string, targets: string[]): void => {
    const start = level.anchor(startAnchor)!.pos;
    const body: MotorState = { x: start.x, y: start.y, z: start.z, vy: 0, grounded: true };
    const eye = new THREE.Vector3();
    for (const target of targets) {
      const to = level.anchor(target)!.pos;
      const path = nav.findPath({ x: body.x, y: body.y, z: body.z }, to, { radius: 0.3 });
      assert.ok(path, `nav route from ${startAnchor} to ${target}`);
      for (const wp of path!) {
        for (let step = 0; step < 30 * 20; step++) {
          const dx = wp.x - body.x;
          const dz = wp.z - body.z;
          const d = Math.hypot(dx, dz);
          if (d < 0.25) break;
          const v = Math.min(d, 4 / 30);
          moveBody(body, (dx / d) * v, (dz / d) * v, 1 / 30, DEFAULT_MOTOR, level.collision);
          level.update(step / 30, 1 / 30, eye.set(body.x, body.y + 1.62, body.z), false);
        }
      }
      assert.ok(Math.hypot(to.x - body.x, to.z - body.z) < 0.6, `walked to ${target}`);
      assert.ok(Math.abs(body.y - to.y) < 0.12, `${target}: y ${body.y.toFixed(2)} near ${to.y.toFixed(2)}`);
    }
  };
  walkChain('r11_hold', ['dark_corridor', 'r15a_platform', 'r15a_train_inside']);
  walkChain('r16_train_inside', ['r16_train_exit', 'r16_concourse', 'r16_dispatch']);

  // detail-r11-power-bay: R11 has twin power_generators, switchgear_bank, power_terminal, and clear squad walkability.
  const r11Props = r11.props ?? [];
  assert.equal(r11Props.filter((p) => p.kit === 'power_generator').length, 2, 'R11 has twin parallel turbine-generators');
  assert.ok(r11Props.some((p) => p.kit === 'switchgear_bank'), 'R11 has switchgear_bank');
  assert.ok(r11Props.some((p) => p.kit === 'power_terminal'), 'R11 has power_terminal');
  walkChain('r11_giles_task', ['r11_hold', 'dark_corridor']);

  // Under station backup power, R11's 6 overhead bank lights are dark while beacons & desk lamp keep it readable.
  level.setPower('backup');
  const r11Lights = level.roomLights('R11');
  const overheadDark = r11Lights.filter((l) => l.kind === 'ceiling' && l.light.power === 0);
  assert.equal(overheadDark.length, 6, 'all 6 overhead cascade bank lights are dark under backup power');
  assert.ok(r11Lights.some((l) => l.kind === 'emergency' && l.light.power > 0), 'standby emergency beacons stay lit');
});

test('`jump=r10_flood` stands Jay at the valve, within reach of its use box', () => {
  const { level } = build(new Inventory(items));
  const a = level.anchor('r10_valve_stand');
  assert.ok(a, 'the jump anchor exists');
  assert.ok(Math.abs(a.pos.y - level.floorAt(a.pos.x, a.pos.z)) < 0.05, 'on the floor');
  const valve = data.rooms.find((r) => r.id === 'R10')!.triggers!.find((t) => t.id === 'trig_r10_valve')!;
  const [min, max] = valve.box;
  assert.ok(a.pos.x >= min[0] && a.pos.x <= max[0] && a.pos.z >= min[2] && a.pos.z <= max[2], 'inside the valve use box');
});

// overhaul-valve-cutscene: Jay's scripted run ends outside the ambush box, and the elite's charge start is seen through the open door.
test('the valve cutscene run stops outside the ambush trigger and sees the charge start down the R09 hall', () => {
  const { level } = build();
  const box = data.rooms.find((r) => r.id === 'R10')!.triggers!.find((t) => t.id === 'trig_r10_ambush')!.box;
  const [min, max] = box;
  // R10 is the 8 x 8 m room x 30..38, z 46..54.
  assert.ok(min[0] >= 30 && max[0] <= 38 && min[2] >= 46 - 0.3 && max[2] <= 54, 'the box lies in R10 (beside the doors)');
  const stop = level.anchor('r10_run_stop')!.pos;
  assert.ok(stop.x < min[0] || stop.x > max[0] || stop.z < min[2] || stop.z > max[2], 'the run stop is outside the ambush box');
  assert.ok(Math.min(Math.abs(stop.x - max[0]), Math.abs(stop.z - max[2])) >= 1.2, 'with room to spare for the player body');
  assert.ok(Math.abs(stop.y - level.floorAt(stop.x, stop.z)) < 0.05, 'on the floor');
  // The sightline: with the R09 door open, the charge start is in clear view from the run stop at eye height.
  level.setDoor('D_R09_R10', 'open');
  const from = new THREE.Vector3(stop.x, 1.62, stop.z);
  for (let i = 0; i < 3 * 60; i++) level.update(i / 60, 1 / 60, from, false);
  assert.equal(level.doorOpenness('D_R09_R10'), 1, 'the door has opened');
  const start = level.anchor('r09_charge_start')!.pos;
  const eye = { x: stop.x, y: 1.62, z: stop.z };
  for (const y of [start.y + 0.6, start.y + 1.2, start.y + 1.8]) {
    const dx = start.x - eye.x;
    const dy = y - eye.y;
    const dz = start.z - eye.z;
    const d = Math.hypot(dx, dy, dz);
    const hit = level.collision.raycast(eye.x, eye.y, eye.z, dx / d, dy / d, dz / d, d);
    assert.equal(hit, null, `the charge start is hidden at y ${y.toFixed(1)} (hit ${hit ? `${hit.collider.minX.toFixed(1)},${hit.collider.minZ.toFixed(1)}` : ''})`);
  }
});

// station-power spec "A squad reaction and the PA notice": the notice is heard where the blackout finds the player.
test('the power-failure notice has a PA speaker in the Lab Junction and in Lab B', () => {
  const { level } = build();
  for (const [room, at] of [['R05', [-2, 1.6, 20]], ['R04', [8, 1.6, 26]]] as const) {
    const spot = new THREE.Vector3(...at);
    assert.ok(level.paSpeakerAt(spot), `${room} has a PA speaker`);
  }
});

test('R09 is bare concrete: plain wall tiles only, none with a vent under the water', () => {
  const walls = data.rooms.find((r) => r.id === 'R09')!.pieces.filter((p) => p.kit.startsWith('wall_') && p.kit !== 'wall_glass_partition');
  assert.ok(walls.length > 0);
  for (const w of walls) {
    assert.equal(w.kit, 'wall_plain');
    assert.equal(w.params?.['material'], 'concrete');
  }
});

// overhaul-flooded-tunnel (playtest): a door a sequence opened stays open until the sequence closes it (no auto-close),
// so the R09 door stands open through the valve cutscene and the ambush.
test('an auto door opened by a script holds open with nobody near it', () => {
  const { level } = build();
  level.setDoor('D_R09_R10', 'open');
  const far = new THREE.Vector3(36.3, 1.62, 52.6);
  for (let i = 0; i < 10 * 60; i++) level.update(i / 60, 1 / 60, far, false);
  assert.equal(level.doorStates()['D_R09_R10'], 'open');
  level.setDoor('D_R09_R10', 'sealed');
  assert.equal(level.doorStates()['D_R09_R10'], 'sealed');
});

// overhaul-priya-r08-death D23-D30 (medbay-attack "On the screen", "Her cardigan"): the rescue's marks are reachable,
// the console shows administration's lockdown order, the intercom grille carries R08 and the surgery, and her
// cardigan is in the medical bay.
test('medbay rescue staging: Priya\'s marks are reachable, the lockdown order is on screen, the intercom and cardigan are placed', async () => {
  const { initNavmesh } = await import('../ai/navmesh.ts');
  await initNavmesh();
  const { level } = build();
  const nav = level.navGraph();
  const from = level.anchor('priya_wait')!.pos;
  for (const id of ['priya_door', 'priya_sit', 'priya_cower']) {
    const a = level.anchor(id);
    if (!a) continue; // priya_cower lands with task 11.1
    const path = nav.findPath({ x: from.x, y: 0, z: from.z }, { x: a.pos.x, y: 0, z: a.pos.z });
    assert.ok(path && path.length >= 1, `priya_wait -> ${id} reachable on navmesh`);
  }
  // priya-door-rescue D1: her run ends just inside D_R07_R08 (x 4.0 on the partition at z 46.0), in R08, and she walks
  // to the beds from there when told to sit.
  const atDoor = level.anchor('priya_door_in')!;
  assert.equal(level.roomAt(atDoor.pos)?.data.id, 'R08');
  assert.ok(Math.hypot(atDoor.pos.x - 4.0, atDoor.pos.z - 46.0) <= 1.5 && atDoor.pos.z - 46.0 >= 0.9, 'within 1.5 m of the door, clear of its leaves');
  const sit = level.anchor('priya_sit')!.pos;
  const toSit = nav.findPath({ x: atDoor.pos.x, y: 0, z: atDoor.pos.z }, { x: sit.x, y: 0, z: sit.z });
  assert.ok(toSit && toSit.length >= 1, 'priya_door_in -> priya_sit reachable on navmesh');
  const room = (id: string) => data.rooms.find((r) => r.id === id)!;
  const bank = room('R07').props!.find((p) => p.kit === 'console_bank')!;
  const notice = String(bank.params?.['notice'] ?? '');
  assert.match(notice, /STATION ADMINISTRATION/);
  assert.match(notice, /ROUTINE/);
  assert.match(notice, /NOT AVAILABLE/);
  const grille = room('R07').props!.find((p) => p.kit === 'pa_speaker' && p.params?.['intercom'] === 'medbay');
  assert.ok(grille, 'the intercom grille is in the security office');
  assert.equal(grille.params?.['sources'], 'R08|R08b');
  assert.equal(grille.params?.['id'], undefined, 'not a Station PA speaker');
  assert.ok(level.anchor('r07_intercom'));
  assert.ok(room('R08').props!.some((p) => p.kit === 'cardigan'), 'her cardigan is in the medical bay');
});

// overhaul-priya-r08-death D20 (task 12.1, slice-stinger "Opening frame"): the stinger's CAM 04 feed looks from cam04_pos at
// her body by the centre pane; the admin booth glimpse keeps its own look point.
test('the stinger feed frames her resting spot from CAM 04', () => {
  const anchors = new Map(data.rooms.flatMap((r) => (r.anchors ?? []).map((a) => [a.id, a.pos as [number, number, number]] as const)));
  const from = anchors.get('cam04_pos')!;
  const to = anchors.get('cam04_stinger_look')!;
  const rest = anchors.get('priya_rest')!;
  const ax = new THREE.Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]).normalize();
  const toRest = new THREE.Vector3(rest[0] - from[0], rest[1] + 0.2 - from[1], rest[2] - from[2]).normalize();
  const off = THREE.MathUtils.radToDeg(ax.angleTo(toRest));
  assert.ok(off < 20, `priya_rest is ${off.toFixed(0)} degrees off the stinger axis (70 degree feed)`);
  assert.ok(new THREE.Vector3(...from).distanceTo(new THREE.Vector3(...rest)) < 6, 'close enough to read her body');
  const stinger = JSON.parse(readFileSync(new URL('../data/sequences/action_climax.json', import.meta.url), 'utf8')).find((s: { id: string }) => s.id === 'stinger_priya');
  const text = JSON.stringify(stinger);
  assert.ok(text.includes('anchor:cam04_stinger_look') && text.includes('CAM 04  MEDBAY') && !text.includes('stinger_cam'), 'the stinger films from CAM 04 in the medical bay');
});

test('no room light shaft hangs through a train car: standing in a cabin never puts the camera inside one', () => {
  const { level } = build();
  level.group.updateMatrixWorld(true);
  const cars: Array<[string, number, number, number, number]> = [
    ['R15a car and its pull-out path', 48, 32.8, 56, 0],
    ['R16a car and its glide-in path', 88, 15, 40, -0.6],
    ['R15b car', 128, 34.8, 45.2, 0],
  ];
  for (const [name, x, z0, z1, y0] of cars) {
    const body = new THREE.Box3(new THREE.Vector3(x - 1.5, y0 + 0.4, z0), new THREE.Vector3(x + 1.5, y0 + 3.3, z1));
    level.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || !(o.material instanceof THREE.ShaderMaterial) || !o.material.uniforms['uTime']) return;
      // Marine snow and water also use shader materials; light shafts are the ones with a "uTime" uniform and no snow name.
      if (o.parent?.name === 'abyss_backdrop' || o.name.startsWith('abyss')) return;
      const b = new THREE.Box3().setFromObject(o);
      if (b.getSize(new THREE.Vector3()).length() > 8) return; // exterior water and other big shader surfaces are not shafts
      assert.equal(b.intersectsBox(body), false, `a light shaft box ${b.min.toArray().map((n) => n.toFixed(1))}..${b.max.toArray().map((n) => n.toFixed(1))} crosses the ${name}`);
    });
  }
});

// r16a-perpendicular-train-arrival: the train still runs north to south in R16a's east column, and the whole concourse is
// turned 90 degrees clockwise so it lies WEST of the dock: you stand between the pillars looking east at the train's right
// side. R16c hangs off R16b's south side, and the track runs on south out of R16a into a dark bore.
test('R16 is turned: the concourse lies west of the dock, the dispatch room south of the concourse, and no room overlaps another', () => {
  const { level } = build();
  const room = (id: string) => data.rooms.find((r) => r.id === id)!;
  const cellsOf = (id: string, kit: string): number[][] => (room(id).pieces ?? []).filter((p) => p.kit === kit).flatMap((p) => ((p as { cells?: number[][] }).cells ?? [(p as { cell?: number[] }).cell!]));
  const span = (cells: number[][], axis: 0 | 2): [number, number] => [Math.min(...cells.map((c) => c[axis]!)), Math.max(...cells.map((c) => c[axis]!))];
  const a = cellsOf('R16a', 'floor');
  assert.deepEqual([span(a, 0), span(a, 2)], [[20, 22], [8, 10]], 'R16a is the 3x3 dock at x cells 20-22, z cells 8-10');
  const b = cellsOf('R16b', 'floor');
  assert.deepEqual([span(b, 0), span(b, 2)], [[14, 19], [7, 11]], 'R16b is 24 m (east-west) x 20 m, west of the dock, between R15a and R16a');
  const c = cellsOf('R16c', 'floor');
  assert.deepEqual([span(c, 0), span(c, 2)], [[16, 18], [12, 12]], 'R16c sits south of R16b, east of the booth bays');
  const stairs = (room('R16a').pieces ?? []).filter((p) => p.kit === 'stairs') as Array<{ cell: number[]; rot?: number }>;
  assert.deepEqual(stairs.map((s) => [s.cell[0], s.cell[2], s.rot]).sort(), [[20, 10, 90], [20, 8, 90], [20, 9, 90]], 'full-width stairs on the west edge only, climbing west');
  // No cell is a floor of two rooms.
  const seen = new Map<string, string>();
  for (const r of data.rooms) {
    for (const cell of cellsOf(r.id, 'floor')) {
      const key = cell.join(',');
      assert.equal(seen.has(key), false, `cell ${key} is a floor of both ${seen.get(key)} and ${r.id}`);
      seen.set(key, r.id);
    }
  }
  // The pillars flank the dock's centre line (z 36), so the first pair frames the train from the aisle.
  const pillars = (room('R16b').props ?? []).filter((p) => p.kit === 'concourse_pillar');
  assert.ok(pillars.length >= 6 && pillars.every((p) => Math.abs(Math.abs(p.pos![2]! - 36) - 4.8) < 0.01), 'pillar rows run east to west, either side of z 36');
  // Looking east from between the first pillar pair, the train's right side is straight ahead across the platform.
  const view = level.anchor('r16_concourse')!;
  assert.ok(view.pos.x < 78 && Math.abs(view.pos.z - 36) < 0.01, 'the concourse anchor stands in R16b on the dock\'s centre line');
});

test('R16a opens west across a platform onto the concourse stairs, with nothing tall near the car\'s right side, and walled elsewhere', () => {
  const { level } = build();
  const tall = (b: { readonly min: readonly number[]; readonly max: readonly number[] }): boolean => b.min[1]! < 2.5 && b.max[1]! > 2.5; // not the ceiling slab
  assert.equal(level.collision.query(82.5, 30.5, 86.15, 41.5, []).filter(tall).length, 0, 'nothing tall within 4 m of the car\'s right side');
  // The seam is open for the dock\'s whole 12 m and walled beyond it (R16b\'s corners).
  assert.equal(level.collision.query(77.8, 30.4, 78.2, 41.6, []).filter(tall).length, 0, 'the west seam is open');
  assert.ok(level.collision.query(77.8, 26.5, 78.2, 29.5, []).filter(tall).length > 0, 'R16b\'s north corner is walled');
  assert.ok(level.collision.query(77.8, 42.5, 78.2, 45.5, []).filter(tall).length > 0, 'R16b\'s south corner is walled');
  // South wall over the platform columns; the track column is the open portal.
  for (const x of [80, 84]) assert.ok(level.collision.query(x - 0.3, 41.8, x + 0.3, 42.1, []).filter(tall).length > 0, `the south wall closes the platform at x ${x}`);
  assert.equal(level.collision.query(87.6, 41.8, 88.4, 42.1, []).filter(tall).length, 0, 'the track column is open to the bore');
  // Walking west from the platform climbs the stairs onto the concourse floor.
  level.update(0, 0.016, new THREE.Vector3(82, 1.0, 36), false);
  const climb: MotorState = { x: 83.5, y: -0.6, z: 36, vy: 0, grounded: true };
  for (let i = 0; i < 90; i++) moveBody(climb, -3 / 30, 0, 1 / 30, DEFAULT_MOTOR, level.collision);
  assert.ok(climb.x < 76 && Math.abs(climb.y) < 0.12, `up the stairs and onto R16b (x ${climb.x.toFixed(2)}, y ${climb.y.toFixed(2)})`);
});

test('R16a guard rail keeps the player off the track, with a boarding gap of at least 2.2 m at the car door', () => {
  const { level } = build();
  const a = data.rooms.find((r) => r.id === 'R16a')!;
  const rails = (a.props ?? []).filter((p) => p.kit === 'platform_railing').map((p) => ({ z: p.pos![2]!, len: (p.params as { length: number }).length })).sort((p, q) => p.z - q.z);
  assert.equal(rails.length, 2, 'two rail runs with a gap between');
  const gap0 = rails[0]!.z + rails[0]!.len / 2;
  const gap1 = rails[1]!.z - rails[1]!.len / 2;
  assert.ok(gap1 - gap0 >= 2.2, `the boarding gap is ${(gap1 - gap0).toFixed(2)} m`);
  assert.ok(gap0 < 35 && gap1 > 35, 'the gap is in front of the car door (car centre z 35)');
  assert.ok(rails[1]!.z + rails[1]!.len / 2 >= 41.7, 'the south run reaches the south wall, so there is no way round the car\'s nose');
  assert.ok(rails[0]!.z - rails[0]!.len / 2 <= 30.3, 'the north run reaches the north wall, so there is no way round the car\'s tail');
  level.update(0, 0.016, new THREE.Vector3(82, 1.0, 36), false);
  for (const z of [30.8, 32, 33, 37, 38.5, 40, 41.2]) {
    const body: MotorState = { x: 82, y: -0.6, z, vy: 0, grounded: true };
    for (let i = 0; i < 90; i++) moveBody(body, 4 / 30, 0, 1 / 30, DEFAULT_MOTOR, level.collision);
    assert.ok(body.x < 86.0, `walking east at z ${z} stops at the rail, not on the track (x ${body.x.toFixed(2)})`);
  }
});

test('R16a: the track runs on south out of the dock into a dark, unlit bore that fades to black', () => {
  const { level } = build();
  const a = data.rooms.find((r) => r.id === 'R16a')!;
  const bore = (a.props ?? []).find((p) => p.kit === 'transit_dark_bore')!;
  assert.ok(bore, 'R16a has the dark bore piece');
  assert.deepEqual([bore.pos![0], bore.pos![2]], [88, 42], 'it is on the car\'s track, in the south wall');
  level.update(0, 0.016, new THREE.Vector3(84, 1.0, 38), false);
  // The fog planes are a dynamic part: read their world positions (Level.integrate keeps the world transform).
  level.group.updateMatrixWorld(true);
  const fog = level.group.getObjectByName('dark_bore_fog');
  assert.ok(fog, 'the bore has its fog planes');
  assert.equal(fog!.children.length, 4, 'four fog planes thicken to black');
  const p = new THREE.Vector3();
  for (const c of fog!.children) {
    c.getWorldPosition(p);
    assert.ok(p.z > 42.5 && p.z < 48.01 && Math.abs(p.x - 88) < 0.01 && Math.abs(p.y - (-0.6 + 1.7)) < 0.01, `a fog plane sits inside the bore (world ${p.toArray().map((n) => n.toFixed(2))})`);
  }
  // A capsule can go in through the portal but the liner holds it and the cap stops it.
  const south: MotorState = { x: 88, y: -0.6, z: 41, vy: 0, grounded: true };
  for (let i = 0; i < 150; i++) moveBody(south, 0, 4 / 30, 1 / 30, DEFAULT_MOTOR, level.collision);
  assert.ok(south.z > 43 && south.z < 47.8, `the bore is closed at its far end (z ${south.z.toFixed(2)})`);
  const west: MotorState = { x: 88, y: -0.6, z: 44, vy: 0, grounded: true };
  for (let i = 0; i < 90; i++) moveBody(west, -4 / 30, 0, 1 / 30, DEFAULT_MOTOR, level.collision);
  assert.ok(west.x > 86.3, `the liner\'s west wall holds (x ${west.x.toFixed(2)})`);
});

test('Stage 2 tunnel rings sit around the car and a sealed blast-gate shutter meets the floor, in world coordinates', () => {
  const { level } = build();
  level.group.updateMatrixWorld(true);
  const p = new THREE.Vector3();
  // The rig is at (128, 0, 40) and its nine 6 m rings cover +/- 27 m around it.
  let rings = 0;
  level.group.traverse((o) => {
    if (!o.name.startsWith('sea_tunnel_ring_')) return;
    o.getWorldPosition(p);
    rings++;
    assert.ok(Math.abs(p.x - 128) < 0.01, `${o.name} is on the car's track (x ${p.x})`);
    assert.ok(p.z >= 40 - 27.01 && p.z <= 40 + 27.01, `${o.name} is within 27 m of the car (z ${p.z})`);
  });
  assert.equal(rings, 9, 'nine tunnel rings');
  // Sealed shutters sit on their room floor: R15a (floor 0) and R16a (floor -0.6).
  const shutters: Array<[number, number]> = [];
  level.group.traverse((o) => {
    if (o.name !== 'blast_gate_shutter') return;
    for (let q: THREE.Object3D | null = o; q; q = q.parent) if (q.name === 'rig_gate_root') return; // the rig's approaching gate is not a room gate
    o.getWorldPosition(p);
    shutters.push([p.z, p.y]);
  });
  assert.equal(shutters.length, 2, 'two blast-gate shutters');
  for (const [z, y] of shutters) {
    const floor = z < 40 ? -0.6 : 0; // R16a's gate is the one north of z = 40
    assert.ok(Math.abs(y - floor) < 0.01, `sealed shutter at z ${z.toFixed(1)} meets its floor (y ${y} vs ${floor})`);
  }
});

test('each train car claims its two cabin lights, they ride with the car, and the whole cabin is in their range', () => {
  const { level } = build();
  const slots = (level as unknown as { debug: { slots: Array<{ pos: THREE.Vector3; kind: string; claimed: boolean }> } }).debug.slots;
  // [car centre x, z, floor y, car length] for Train Car A, Train Car B and the Stage 2 car.
  const cars: Array<[string, number, number, number, number]> = [
    ['R15a car', 48, 38, 0, 10.4],
    ['R16a car', 88, 35, -0.6, 9],
    ['R15b car', 128, 40, 0, 10.4],
  ];
  for (const [name, x, z, y0, len] of cars) {
    const lightY = y0 + 0.4 + 2.9 - 0.18 - 0.16;
    const mine = slots.filter((s) => s.claimed && Math.abs(s.pos.x - x) < 0.05 && Math.abs(s.pos.y - lightY) < 0.05 && Math.abs(s.pos.z - z) < len / 2);
    assert.equal(mine.length, 2, `${name} has both cabin light slots claimed`);
    // 8 m range from each slot (see slice01.json) covers the far bulkhead from either side of the car.
    for (const end of [z - len / 2, z + len / 2]) {
      const nearest = Math.min(...mine.map((s) => Math.abs(s.pos.z - end)));
      assert.ok(nearest <= 8, `${name}: the bulkhead at z ${end} is within 8 m of a cabin light (${nearest.toFixed(1)} m)`);
    }
  }
  // The claimed fixtures are real meshes that move with the car and leave nothing behind.
  const fixturesNear = (x: number, y: number, z: number): number => {
    let n = 0;
    level.group.updateMatrixWorld(true);
    level.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const p = o.getWorldPosition(new THREE.Vector3());
      if (Math.abs(p.x - x) < 0.05 && Math.abs(p.y - y) < 0.06 && Math.abs(p.z - z) < 2.3) n++;
    });
    return n;
  };
  const y = 0.4 + 2.9 - 0.18 - 0.16;
  const parked = fixturesNear(128, y, 40);
  assert.equal(parked, 2, 'the Stage 2 car has its two glow fixtures where it stands');
  level.setPropTransform('r15b_train', { x: 128, y: 0, z: 60 }, Math.PI);
  assert.equal(fixturesNear(128, y, 40), 0, 'no cabin fixture is left floating where the car was');
  assert.equal(fixturesNear(128, y, 60), 2, 'the fixtures are now in the car');
  level.setPropTransform('r15b_train', { x: 128, y: 0, z: 40 }, Math.PI);
  assert.equal(fixturesNear(128, y, 40), 2, 'back where it started, back with the car');
});

test('R16a visual overhaul: ocean windows behind train, arrival signage, blood decals, movable pillar body, named lights & rotating beacons', () => {
  const { level } = build();
  const data = level.source;
  const r16a = data.rooms.find((r) => r.id === 'R16a')!;
  const r16b = data.rooms.find((r) => r.id === 'R16b')!;

  // East wall behind Train Car B uses real ocean windows (wall_window, rot 270).
  const eastWin = (r16a.pieces ?? []).find((p) => p.kit === 'wall_window' && p.rot === 270);
  assert.ok(eastWin, 'R16a east wall has wall_window ocean glazing');
  assert.equal(eastWin.cells?.length, 3, 'all 3 east-wall cells behind the track are ocean windows');

  // Arrival board, signage, overhead framing, and blood decals are present.
  const board = (r16a.props ?? []).find((p) => p.kit === 'transit_depart_board');
  assert.equal(board?.params?.['mode'], 'arrival', 'R16a uses arrival mode on transit_depart_board');
  assert.ok((r16a.props ?? []).some((p) => p.kit === 'room_sign'), 'R16a has room_sign');
  assert.ok((r16a.props ?? []).filter((p) => p.kit === 'blood_decal').length >= 6, 'R16a has dense blood decals');
  assert.equal((r16b.props ?? []).filter((p) => p.kit === 'transit_rotating_beacon').length, 0, 'R16b has no rotating red beacons');

  // Rigged dead crew bodies in R16a and R16b use varied models, dead poses, and blood overlays.
  const r16Npcs = level.npcSpawns().filter((n) => n.room === 'R16a' || n.room === 'R16b');
  assert.ok(r16Npcs.length >= 6, `at least 6 rigged fallen crew bodies across R16a/R16b (got ${r16Npcs.length})`);
  assert.ok(r16Npcs.every((n) => n.dead === true && n.blood === true), 'all R16a/R16b fallen bodies are marked dead and bloodied');
  const pillarBody = r16Npcs.find((n) => n.id === 'r16_pillar_body');
  assert.ok(pillarBody && pillarBody.room === 'R16b' && pillarBody.pose === 'corpseProne', 'r16_pillar_body sits beside the facing R16b pillar in corpseProne');

  // Named lights support blackout, selective flash, and rotating beacon alarm lights.
  assert.ok(level.tintRoomLights('R16a', 'black'), 'R16a supports pitch-black blackout');
  assert.ok(level.setLight('r16a_light_mid', 'steady', '#dce8f4', 1), 'R16a named hero light flashes cleanly');
  assert.ok(level.setLight('r16a_beacon_n', 'alarm', '#ff2218', 1), 'R16a north rotating beacon light switches to alarm');
});

test('R16b Arrival Concourse visual overhaul: clean grand terminal dressing, full blood texture coverage, and clear walkability', () => {
  const { level } = build();
  const r16b = level.source.rooms.find((r) => r.id === 'R16b')!;
  const props = r16b.props ?? [];

  assert.equal(r16b.area, 'transit', 'R16b stays on the clean transit palette');
  assert.ok(props.filter((p) => p.kit === 'concourse_truss').length >= 4, 'R16b has overhead ceiling trusses');
  assert.ok(props.some((p) => p.kit === 'concourse_monument_sign'), 'R16b has focal west-wall monument sign');
  assert.ok(props.filter((p) => p.kit === 'concourse_bench').length >= 4, 'R16b has clean terminal waiting benches');
  assert.ok(props.filter((p) => p.kit === 'stanchion_barrier').length >= 2, 'R16b has check-in queue stanchions');
  assert.ok(props.filter((p) => p.kit === 'luggage_cluster').length >= 4, 'R16b has abandoned luggage clusters');

  // Blood decals cover all five photographic texture families (pool, spatter, smear, leak, drop).
  const blood = props.filter((p) => p.kit === 'blood_decal');
  assert.ok(blood.length >= 40, `R16b is plastered with blood decals (${blood.length})`);
  const texNames = new Set(blood.map((p) => String(p.params?.['tex'] ?? '')).filter(Boolean));
  for (const prefix of ['pool_', 'spatter_', 'smear_', 'leak_', 'drop_']) {
    assert.ok([...texNames].some((t) => t.startsWith(prefix)), `R16b uses ${prefix}* photographic blood textures`);
  }

  // Central aisle (z = 36) from east stairs (x = 76) to west focal wall (x = 57) is completely walkable.
  level.update(0, 0.016, new THREE.Vector3(76, 1.0, 36), false);
  const aisle: MotorState = { x: 76, y: 0, z: 36, vy: 0, grounded: true };
  for (let i = 0; i < 180; i++) moveBody(aisle, -4 / 30, 0, 1 / 30, DEFAULT_MOTOR, level.collision);
  assert.ok(aisle.x < 57.5, `R16b central aisle is unobstructed down to west wall (reached x ${aisle.x.toFixed(2)})`);
});

test('all three transit ride train cars share identical 9 m shell dimensions for seamless handoffs', () => {
  const { level } = build();
  const findTrain = (roomId: string, id: string) =>
    (level.source.rooms.find((r) => r.id === roomId)?.props ?? []).find((p) => p.params?.['id'] === id);
  const cars = [
    findTrain('R15a', 'r15a_train'),
    findTrain('R15b', 'r15b_train'),
    findTrain('R16a', 'r16a_train'),
  ];
  for (const car of cars) {
    assert.ok(car, 'train prop exists');
    assert.equal(car!.params?.['length'], 9, `${String(car!.params?.['id'])} length is 9 m`);
    assert.equal(car!.params?.['width'], 3, `${String(car!.params?.['id'])} width is 3 m`);
    assert.equal(car!.params?.['height'], 2.9, `${String(car!.params?.['id'])} height is 2.9 m`);
  }
});
