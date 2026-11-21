import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

// slice01 (ADR-0014/0023, intro-sequence spec): the level validates, builds headlessly (no WebGL, a stub 2D
// canvas), provides every anchor the draft sequences use, keeps rooms in the draw-call budget,
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

const ROOMS = ['R01', 'R01w', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07', 'R08', 'R09', 'R10', 'R11', 'R12a', 'R12b', 'R12c', 'R12d', 'R12e', 'R13a', 'R13b', 'R13c', 'R13d', 'R13e', 'R14a', 'R14b', 'R14c', 'R14d', 'R14e'];

test('slice01 validates: every ADR-0014/0023 room, areas, map stations, checkpoints', () => {
  const ids = new Set(data.rooms.map((r) => r.id));
  for (const id of ROOMS) assert.ok(ids.has(id), `room ${id}`);
  const areas = new Set(data.rooms.map((r) => r.area));
  for (const a of ['dock', 'commons', 'gallery', 'hydroponics', 'dive_bay', 'admin', 'labs', 'security', 'medbay', 'tunnel', 'control']) assert.ok(areas.has(a), `area ${a}`);
  assert.deepEqual(new Set((data.mapStations ?? []).map((s) => s.reveals)), new Set(['commons', 'hydroponics', 'dive_bay', 'admin']));
  assert.deepEqual(data.checkpoints.map((c) => c.id), ['cp_first_contact', 'cp_cover_me', 'cp_security', 'cp_flooded', 'cp_climax']);
  assert.deepEqual(data.doors.find((d) => d.id === 'hydro_store')?.access, { requires: 'card_l2' });
  assert.equal(data.pickups?.find((p) => p.item === 'card_l2')?.room, 'R14c');
  // Nothing hostile in the quiet half: every spawn waits for its group.
  const spawns = data.rooms.flatMap((r) => r.spawns ?? []);
  assert.ok(spawns.length > 10);
  for (const s of spawns) assert.equal(s.active, false, s.id);
  assert.deepEqual(new Set(spawns.map((s) => s.group)), new Set(['r05_contact', 'r05_trickle', 'r06_cover', 'r07_playdead', 'r09_tunnel', 'r11_climax']));
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
  for (const n of ['dock_door', 'dock_window', 'post_front', 'abyss_window_walk', 'window_jay', 'window_giles', 'window_okafor', 'kitchen_door', 'kitchen_stand', 'counter', 'counter_giles', 'counter_okafor', 'priya_enter', 'priya_offer', 'priya_exit']) assert.ok(level.anchor(n), `intro-sequence anchor ${n}`);
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
  const breakout = data.rooms.flatMap((r) => r.spawns ?? []).find((sp) => sp.id === 'r05_door');
  assert.equal(breakout?.model, 'necromorph', 'the contact fight is the creature that came out of Voss');
  assert.ok(breakout && Math.abs(breakout.pos[2] - 22.5) < 0.3, 'it breaks out from where it stood pounding the glass');
  const emits = new Set(data.rooms.flatMap((r) => (r.triggers ?? []).map((t) => t.emit)));
  for (const e of ['trigger:commons_to_gallery', 'trigger:gallery_brief_spot', 'trigger:gallery_enter', 'round:hydro_log', 'round:dive_case', 'trigger:hale_office', 'trigger:security_booth', 'trigger:hydro_store_enter', 'trigger:dive_lockers_enter', 'commons:radio']) assert.ok(emits.has(e), `trigger ${e}`);
  for (const a of ['cam04_pos', 'cam04_look', 'cam04_figure', 'dawdle_call', 'gallery_door', 'brief_giles', 'brief_okafor']) assert.ok(level.anchor(a), `anchor ${a}`);
  assert.ok(JSON.stringify(data).includes('"sample_case"'), 'the dive sample case is placed');
  const r03 = data.rooms.find((r) => r.id === 'R03')!;
  assert.equal(r03.props?.filter((p) => p.kit === 'glass_cracks').length, 3, 'three crack layers on the Lab B glass');
  const r13d = data.rooms.find((r) => r.id === 'R13d')!;
  assert.ok(r13d.triggers?.some((t) => t.emit === 'area:dark'), 'the dark area trigger is in R13d');
});

test('slice01 draw calls stay within the ADR-0003 budget per room', () => {
  const { level } = build();
  const stats = level.roomStats();
  const worst = [...stats].sort((a, b) => b.drawCalls - a.drawCalls).slice(0, 3);
  console.info('[slice01] heaviest rooms', worst.map((s) => `${s.id} ${s.drawCalls} calls ${Math.round(s.triangles / 1000)}k tris`).join(', '));
  for (const s of stats) assert.ok(s.drawCalls <= 60, `${s.id}: ${s.drawCalls} draw calls`);
  const tris = stats.reduce((n, s) => n + s.triangles, 0);
  assert.ok(tris < 1_500_000, `whole level ${tris} triangles`);
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
    assert.ok(Math.abs(body.y) < 0.05, `${name}: feet on the deck (y ${body.y.toFixed(2)})`);
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
  walkTo('dark_corridor');
  assert.ok(fired.includes('area:dark'), 'dark corridor trigger');
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

  const required = ['R01', 'R01w', 'R02', 'R03', 'R14a', 'R14b', 'R14c', 'R14e', 'R12a', 'R12b', 'R12e', 'R12d', 'R13a', 'R13b', 'R13e', 'R13d', 'R05', 'R06', 'R07', 'R07a', 'R09', 'R10', 'R11'];
  for (const r of required) assert.ok(entered.includes(r), `entered ${r}`);
  for (const e of ['trigger:commons_enter', 'trigger:gallery_enter', 'trigger:gallery_brief_spot', 'trigger:admin_enter', 'trigger:hale_office', 'trigger:security_booth', 'trigger:hydro_enter', 'trigger:hydro_store_enter', 'trigger:dive_enter', 'trigger:r05_enter', 'trigger:r06_enter', 'trigger:r07_enter', 'trigger:r09_enter', 'trigger:r10_enter', 'trigger:r11_enter', 'valve:r10_main']) {
    assert.ok(fired.includes(e), `fired ${e}`);
  }
  console.info(`[slice01] walked ${entered.length} room entries in ${t.toFixed(0)} s of game time`);
});

test('slice01 visible draw calls stay under the ADR-0015 frame budget', () => {
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
  assert.ok(worst.calls <= 300, `${worst.id}: ${worst.calls}`);
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
  eye.set(8, 1.7, 17.4);
  run(0.2);
  const screen = find('screen:brief_screen') as THREE.Mesh;
  const mat = screen.material as THREE.MeshStandardMaterial;
  assert.ok(mat.emissiveIntensity < 0.5);
  (events.emit as (n: string, p: unknown) => void)('briefing:screen', { state: 'on', who: 'hale' });
  assert.ok(mat.emissiveIntensity > 1);
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
  // Spawn groups: the counts ADR-0014 asks for.
  const spawns = data.rooms.flatMap((r) => r.spawns ?? []);
  const total = (g: string): number => spawns.filter((s) => s.group === g).reduce((n, s) => n + (s.count ?? 1), 0);
  assert.equal(total('r05_contact'), 1, 'one shambler breaks through the door');
  assert.ok(total('r05_trickle') >= 2 && total('r05_trickle') <= 3, 'two to three trickle in');
  assert.equal(total('r06_cover'), 6);
  assert.equal(total('r11_climax'), 14);
  assert.ok(spawns.some((s) => s.group === 'r11_climax' && s.variant === 'hero'), 'a hero in the climax');
  // The glass wall into the medical bay takes cracks and blood; the control room hides the bloom's trail.
  const r07 = data.rooms.find((r) => r.id === 'R07')!;
  assert.equal(r07.props?.filter((p) => p.kit === 'glass_blood').length, 3);
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
  // Dive bay (rebuild-dive-bay): clean steel everywhere except the R13d maintenance corridor.
  const rust: Array<keyof Materials> = ['rustBlotch', 'rustHeavy', 'rustDrip', 'servicePaint', 'diamondRusty', 'diamondHazard', 'hazard'];
  for (const r of ['R13a', 'R13b', 'R13c', 'R13e']) for (const k of rust) assert.ok(!has(r, k), `${r} uses no ${k}`);
  assert.ok(has('R13b', 'boltPanel') && has('R13b', 'cleanSlate') && has('R13b', 'hazardClean'), 'dive bay clean slate and bolted steel');
  assert.ok(has('R13d', 'rustBlotch') && has('R13d', 'diamondRusty'), 'R13d keeps rust walls and floor');
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
  assert.deepEqual([...realRooms].sort(), ['R01', 'R01w', 'R12b']);
  assert.ok(screens >= 4 && screens <= 8, `screens merge into about one mesh per screened room (found ${screens})`);
  const lamps = level.floodlights();
  const perRoom = (id: string): number => lamps.filter((l) => l.room === id).length;
  assert.deepEqual([perRoom('R01'), perRoom('R01w'), perRoom('R12b'), lamps.length], [2, 2, 1, 5], 'floodlights: R01 2, R01w 2, R12b 1');
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
  assert.ok(kitsIn('R12e').has('camp_cot') && kitsIn('R12e').has('kettle_set') && kitsIn('R12e').has('fertiliser_pallet') && kitsIn('R12e').has('radio'), 'R12e includes cot, kettle+dog photo, radio, and fertiliser pallet');
});

test('dive bay lanes fit two capsules side by side between the R13b doors (dive-bay spec, budgets and clearance)', () => {
  const { level } = build();
  const found: Array<{ tag: string; minY: number; maxY: number; enabled: boolean }> = [];
  // Door to door through the launch hall: from R13a to R13e, R13c and R13d, stopping short of the door leaves.
  const routes: Array<Array<[number, number]>> = [
    [[24, 30.5], [21.2, 33.6], [21.0, 38.6], [18.6, 40]],
    [[24, 30.5], [21.0, 32.1], [18.6, 32]],
    [[24, 30.5], [26.5, 32.6], [29.4, 32]],
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

test('dive bay rooms have their new roles: no dive-suit racks, the cold store at the stow point, the leak in R13d', () => {
  const props = data.rooms.flatMap((r) => (r.props ?? []).map((p) => ({ room: r.id, ...p })));
  assert.equal(props.filter((p) => p.kit === 'dive_suit_rack').length, 0, 'no open-water dive suits anywhere in slice01');
  const names = Object.fromEntries(data.rooms.filter((r) => r.id.startsWith('R13')).map((r) => [r.id, r.name]));
  assert.deepEqual(names, { R13a: 'Wet Vestibule', R13b: 'Moon Pool', R13c: 'ROV Workshop', R13d: 'Maintenance Corridor', R13e: 'Sample Store' });
  const store = props.find((p) => p.kit === 'cold_store')!;
  assert.equal(store.room, 'R13e');
  const locker = data.rooms.find((r) => r.id === 'R13e')!.anchors!.find((a) => a.id === 'dive_case_locker')!;
  assert.ok(Math.hypot(store.pos[0] - locker.pos[0], store.pos[2] - locker.pos[2]) < 0.9, 'the stow anchor is at the cold store');
  for (const kit of ['gantry_crane', 'rov', 'tether_winch', 'pilot_console', 'whiteboard', 'wet_bench', 'core_rack', 'eyewash_station', 'shadow_board']) {
    assert.ok(props.some((p) => p.room === 'R13b' && p.kit === kit), `R13b has a ${kit}`);
  }
  assert.ok(props.some((p) => p.room === 'R13d' && p.kit === 'pipe_leak'), 'R13d leak');
  assert.ok(data.rooms.find((r) => r.id === 'R13d')!.triggers!.some((t) => t.emit === 'trigger:dive_leak'), 'leak trigger');
});

test('dive bay signage and wear: plates by the entries, and 4-8 wear decals per clean room (surface-dressing §4)', () => {
  const props = (id: string) => data.rooms.find((r) => r.id === id)!.props ?? [];
  const r13bSign = props('R13b').find((p) => p.kit === 'room_sign')!;
  assert.equal(`${r13bSign.params!['code']} · ${r13bSign.params!['name']}`, 'R13B · LAUNCH TRUNK 1');
  for (const id of ['R13a', 'R13b', 'R13c', 'R13d', 'R13e']) assert.equal(props(id).filter((p) => p.kit === 'room_sign').length, 1, `${id} plate`);
  for (const id of ['R13a', 'R13b', 'R13c', 'R13e']) {
    assert.notEqual(props(id).find((p) => p.kit === 'room_sign')!.params!['panel'], false, `${id} life-support panel`);
    const n = props(id).filter((p) => p.kit === 'floor_wear').length;
    assert.ok(n >= 4 && n <= 8, `${id}: ${n} wear decals`);
  }
  assert.equal(props('R13d').find((p) => p.kit === 'room_sign')!.params!['panel'], false, 'R13d plate only');
  for (const id of ['R13b', 'R13d']) assert.ok(props(id).some((p) => p.kit === 'pipe_labels'), `${id} pipe labels`);
});
