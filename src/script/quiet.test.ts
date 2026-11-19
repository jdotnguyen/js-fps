/**
 * The quiet half (ADR-0023, ADR-0017): commons free time and the dawdle catch, the briefing trigger,
 * three morning rounds in any order, the Level 2 Card backtrack, TAG FM in rooms, the camera feed
 * glimpse, the PA call back and the drop. Every sequence loaded from data/sequences is checked against
 * the real dialogue, objectives, items, sounds and the slice01 level data (anchors, NPCs, doors), and
 * the chains are played headless on a host that dispatches events like the game does.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { ControlStack } from '../actors/control.ts';
import { SOUND_SPECS } from '../audio/sounds.ts';
import { DialogueLibrary } from '../dialogue/library.ts';
import { isParallel } from './actions.ts';
import type { CameraFeedOptions, SequenceHost } from './host.ts';
import { SequenceManager } from './runtime.ts';
import { validateSequences } from './schema.ts';
import type { Flags, Step } from './types.ts';

const json = (rel: string): any => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const dir = new URL('../data/sequences/', import.meta.url);
const files: Record<string, unknown> = {};
for (const f of readdirSync(dir)) if (f.endsWith('.json')) files[f] = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
const defs = validateSequences(files);
const byId = new Map(defs.map((d) => [d.id, d]));
const library = new DialogueLibrary(json('../data/dialogue/speakers.json'), {
  slice01: json('../data/dialogue/slice01.json'),
  slice01_action: json('../data/dialogue/slice01_action.json'),
  slice01_rounds: json('../data/dialogue/slice01_rounds.json'),
});
const level = json('../data/levels/slice01.json');
const anchors = new Set<string>(level.rooms.flatMap((r: any) => (r.anchors ?? []).map((a: any) => a.id)));
const npcIds = new Set<string>(level.rooms.flatMap((r: any) => (r.npcs ?? []).map((n: any) => n.id)));
const doorIds = new Set<string>(level.doors.map((d: any) => d.id));
const roomIds = new Set<string>(level.rooms.map((r: any) => r.id));
const objectives = json('../data/objectives.json');
const items = json('../data/items.json');
const triggerEmits = new Set<string>(level.rooms.flatMap((r: any) => (r.triggers ?? []).map((t: any) => t.emit)));

function walk(steps: Step[], visit: (s: Record<string, unknown>) => void): void {
  for (const step of steps) {
    if (isParallel(step)) walk(step.parallel, visit);
    else {
      visit(step);
      for (const key of ['steps', 'then', 'else']) {
        const inner = (step as Record<string, unknown>)[key];
        if (Array.isArray(inner)) walk(inner as Step[], visit);
      }
    }
  }
}

// ------------------------------------------------------------------------------- data checks

test('every shipped sequence names only things that exist: lines, sounds, anchors, NPCs, doors, rooms, objectives, items', () => {
  assert.ok(byId.size >= 25);
  const npcSet = new Set([...npcIds, 'medbay_figure', 'r08_thing', 'researcher_a', 'giles', 'okafor']);
  for (const def of defs.filter((d) => !d.id.startsWith('test_') && !d.id.startsWith('cutscene_test'))) {
    walk(def.steps, (s) => {
      const where = `${def.id}: ${String(s['do'])}`;
      if (s['do'] === 'say') {
        assert.ok(library.hasLine(s['line'] as string), `${where} line ${String(s['line'])}`);
        assert.equal(library.line(s['line'] as string).priority, 'story', `${where} ${String(s['line'])} must be story priority`);
      }
      if (s['do'] === 'sfx') assert.ok((s['id'] as string) in SOUND_SPECS, `${where} sound ${String(s['id'])}`);
      if (s['do'] === 'setObjective' || s['do'] === 'completeObjective') assert.ok(String(s['id']) in objectives, `${where} objective ${String(s['id'])}`);
      if (s['do'] === 'giveItem') assert.ok(String(s['item']) in items, `${where} item`);
      if (s['do'] === 'doorState') assert.ok(doorIds.has(s['id'] as string), `${where} door ${String(s['id'])}`);
      if (s['do'] === 'lightState') assert.ok(roomIds.has(s['room'] as string), `${where} room ${String(s['room'])}`);
      if (typeof s['npc'] === 'string') assert.ok(npcSet.has(s['npc']), `${where} npc ${s['npc']}`);
      for (const field of ['to', 'target', 'at', 'from', 'lookAt']) {
        const v = s[field];
        if (typeof v === 'string' && v.startsWith('anchor:')) assert.ok(anchors.has(v.slice(7)), `${where}.${field} ${v}`);
        if (typeof v === 'string' && v.startsWith('npc:')) assert.ok(npcSet.has(v.slice(4)), `${where}.${field} ${v}`);
      }
    });
    const ev = def.trigger?.event;
    if (ev && /^(trigger|round|commons|area):/.test(ev) && !ev.startsWith('round:complete')) {
      assert.ok(triggerEmits.has(ev) || ev === 'commons:dawdle', `${def.id}: trigger ${ev} is not emitted by any level trigger`);
    }
  }
});

test('the three rounds and the way back are objectives with the area they live in', () => {
  for (const id of ['round_hydro', 'round_dive', 'round_admin']) assert.equal(objectives[id].required, true, id);
  assert.equal(objectives['round_return'].required, true);
  assert.equal(objectives['round_return'].area, 'gallery');
  assert.ok('sample_case' in items && items['sample_case'].kind === 'tool');
  assert.ok(level.pickups.some((p: any) => p.item === 'sample_case' && p.room === 'R13b'));
});

test('the quiet sequences keep Jay in control except the two on rails; the drop cannot be skipped', () => {
  assert.equal(byId.get('commons_dawdle')?.skippable, true);
  assert.equal(byId.get('briefing_gallery')?.skippable, true);
  assert.equal(byId.get('intro_shift_change')?.skippable, true);
  for (const id of ['commons_free', 'hydro_moment', 'dive_moment', 'admin_hale', 'admin_glimpse', 'rounds_return', 'drop']) {
    assert.notEqual(byId.get(id)?.skippable, true, `${id} stays unskippable`);
  }
  assert.equal(byId.get('drop')?.exclusive, 'rails');
  assert.equal(byId.get('briefing_gallery')?.exclusive, 'rails');
  assert.equal(byId.get('commons_dawdle')?.exclusive, 'rails');
});

// ------------------------------------------------------------------------------- harness

function makeGame(only?: string[]) {
  const log: string[] = [];
  const control = new ControlStack();
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  const feeds: CameraFeedOptions[] = [];
  const host: SequenceHost = {
    events: {
      on(name, fn) {
        const set = handlers.get(name) ?? new Set();
        handlers.set(name, set);
        set.add(fn);
        return () => set.delete(fn);
      },
      emit(name, payload) {
        log.push(`event ${name}${payload && (payload as any).which ? ` ${(payload as any).which}` : ''}`);
        for (const fn of [...(handlers.get(name) ?? [])]) fn(payload);
      },
    },
    flags: {} as Flags,
    resolve: () => ({ x: 0, y: 0, z: 0 }),
    warn: (m) => void log.push(`warn ${m}`),
    pushControl: (over, owner) => control.push(over, owner),
    lookAt: () => undefined,
    clampLook: () => undefined,
    frame: (at) => void log.push(at ? 'frame' : 'unframe'),
    walkTo: () => Promise.resolve(),
    placePlayer: () => void log.push('place'),
    fade: () => undefined,
    cameraShake: () => void log.push('shake'),
    sfx: (id) => void log.push(`sfx ${id}`),
    radio: (track, at) => void log.push(track ? `radio ${track}${at ? '' : ' nowhere'}` : 'radio stop'),
    say: (line, opts) => {
      log.push(`say ${line}${opts?.overlap ? ' overlap' : ''}`);
      return { done: Promise.resolve() };
    },
    markLinePlayed: (line) => void log.push(`played ${line}`),
    stopSpeech: () => void log.push('stopSpeech'),
    checkpoint: (id) => void log.push(`checkpoint ${id}`),
    setDoor: (id, state) => (log.push(`door ${id} ${state}`), true),
    setLight: (room, pattern, tint) => (log.push(`light ${room} ${pattern}${tint ? ` ${tint}` : ''}`), true),
    glass: (id, state) => void log.push(`glass ${id} ${state}`),
    cameraFeed: (id, opts) => (feeds.push(opts), void log.push(`feed ${id} ${opts.state}`)),
    npc: (action, step) => {
      log.push(`npc ${action} ${String(step['npc'])}${step['anim'] ? ` ${String(step['anim'])}` : ''}${step['instant'] ? ' instant' : ''}${step['stay'] ? ' stay' : ''}`);
    },
  };
  const m = new SequenceManager(host, only ? defs.filter((d) => only.includes(d.id)) : defs);
  return { m, host, log, control, feeds };
}
type Game = ReturnType<typeof makeGame>;

/** Step the manager `seconds` of simulated time, letting resolved lines settle. */
async function advance(g: Game, seconds: number): Promise<void> {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    g.m.update(1 / 60);
    if (i % 3 === 0) await Promise.resolve();
  }
}
/** What a level trigger does (Level.fire): `trigger:fired`, then the emit name itself. */
function fire(g: Game, emit: string): void {
  g.host.events.emit('trigger:fired', { id: `t_${emit}`, event: emit });
  g.host.events.emit(emit, { id: `t_${emit}` });
}
/** Step until `cond` holds (one frame at a time), up to `max` simulated seconds. */
async function until(g: Game, cond: () => boolean, max = 200): Promise<void> {
  for (let i = 0; i < max * 60 && !cond(); i++) {
    g.m.update(1 / 60);
    if (i % 3 === 0) await Promise.resolve();
  }
  assert.ok(cond(), 'condition not reached');
}
const said = (g: Game, line: string): number => g.log.filter((e) => e === `say ${line}` || e === `say ${line} overlap`).length;
const count = (g: Game, entry: string): number => g.log.filter((e) => e === entry).length;
const noWarnings = (g: Game): void => assert.ok(!g.log.some((e) => e.startsWith('warn')), g.log.filter((e) => e.startsWith('warn')).join('\n'));
const endIntro = (g: Game, skipped = false): void => {
  g.host.flags['introSeen'] = true;
  g.host.events.emit('sequence:ended', { id: 'intro_shift_change', cancelled: false, skipped });
};

// ------------------------------------------------------------------------------- commons

test('commons free time: after the intro Giles calls at 45 s and the squad heads for the gallery door', async () => {
  const g = makeGame();
  endIntro(g);
  assert.equal(g.m.isRunning('commons_free'), true);
  await advance(g, 40);
  assert.equal(said(g, 'commons_giles_call_01'), 0, 'free time first');
  await advance(g, 8);
  assert.equal(said(g, 'commons_giles_call_01'), 1);
  assert.ok(g.log.includes('npc npcMoveTo giles') && g.log.includes('npc npcMoveTo okafor'));
  // Jay walks to the gallery door in time: no dawdle catch.
  fire(g, 'trigger:commons_to_gallery');
  await advance(g, 60);
  assert.equal(g.m.isRunning('commons_free'), false);
  assert.equal(g.host.flags['dawdle_caught'], undefined);
  assert.equal(said(g, 'commons_giles_hey_01'), 0);
  noWarnings(g);
});

test('commons free time: a player who heads for the gallery on their own is not called', async () => {
  const g = makeGame();
  endIntro(g);
  await advance(g, 10);
  fire(g, 'trigger:commons_to_gallery');
  await advance(g, 5);
  assert.equal(g.m.isRunning('commons_free'), false);
  assert.equal(said(g, 'commons_giles_call_01'), 0);
});

test('commons_dawdle: still wandering 45 s after the call, Giles says Hey and Jay is walked over on rails', async () => {
  const g = makeGame();
  endIntro(g);
  await until(g, () => count(g, 'event commons:dawdle') === 1);
  assert.equal(g.m.isRunning('commons_dawdle'), true);
  assert.equal(g.control.state.move, 'locked', 'on rails: the bars come in');
  await advance(g, 30);
  assert.equal(said(g, 'commons_giles_hey_01'), 1);
  assert.equal(said(g, 'commons_giles_hey_02'), 1);
  assert.equal(g.host.flags['dawdle_caught'], true);
  assert.equal(g.control.state.move, 'free');
  assert.equal(g.log.filter((e) => e === 'frame' || e === 'unframe').at(-1), 'unframe');
  noWarnings(g);
});

test('skipping the dawdle catch ends in the same place: Jay placed, both lines marked played, control free', async () => {
  const g = makeGame();
  endIntro(g);
  await until(g, () => count(g, 'event commons:dawdle') === 1);
  assert.equal(g.m.isRunning('commons_dawdle'), true);
  assert.equal(g.m.skippable, true);
  assert.equal(g.m.skip(), true);
  assert.equal(g.m.isRunning('commons_dawdle'), false);
  assert.equal(g.host.flags['dawdle_caught'], true);
  assert.equal(g.control.state.move, 'free');
  assert.ok(g.log.includes('place') || g.log.includes('played commons_giles_hey_02'));
  assert.ok(g.log.includes('played commons_giles_hey_02'));
  assert.equal(g.log.filter((e) => e === 'frame' || e === 'unframe').at(-1), 'unframe');
});

test('the dawdle catch never runs once the briefing is done', async () => {
  const g = makeGame();
  endIntro(g);
  g.host.flags['briefingSeen'] = true;
  await advance(g, 100);
  assert.equal(g.m.isRunning('commons_free'), false);
  assert.equal(g.m.isRunning('commons_dawdle'), false);
  assert.equal(g.host.flags['dawdle_caught'], undefined);
});

test('a cancelled intro (back to the title) does not start free time', () => {
  const g = makeGame();
  g.host.events.emit('sequence:ended', { id: 'intro_shift_change', cancelled: true, skipped: false });
  assert.equal(g.m.isRunning('commons_free'), false);
});

test('the briefing starts on the gallery spot once the intro is seen, and only once', async () => {
  const g = makeGame();
  fire(g, 'trigger:gallery_brief_spot');
  assert.equal(g.m.isRunning('briefing_gallery'), false, 'not before the intro');
  g.host.flags['introSeen'] = true;
  fire(g, 'trigger:gallery_brief_spot');
  assert.equal(g.m.isRunning('briefing_gallery'), true);
  assert.equal(g.control.state.move, 'locked');
  await advance(g, 120);
  assert.equal(g.host.flags['briefingSeen'], true);
  assert.equal(g.host.flags['obj:round_hydro'], 'active');
  fire(g, 'trigger:gallery_brief_spot');
  assert.equal(g.m.isRunning('briefing_gallery'), false, 'once');
});

test('TAG FM: Listen toggles the kitchen radio once per use; entering the commons brings it back; rooms move it', async () => {
  const g = makeGame();
  g.host.flags['radio_place'] = 'commons';
  fire(g, 'commons:radio');
  await advance(g, 1);
  assert.equal(g.host.flags['radio_muted'], true, 'off after one use (the trigger arrives twice, once is enough)');
  assert.equal(count(g, 'radio stop'), 1);
  fire(g, 'trigger:commons_enter');
  await advance(g, 1);
  assert.equal(count(g, 'radio tag_fm_01'), 0, 'muted stays muted');
  fire(g, 'commons:radio');
  await advance(g, 1);
  assert.equal(g.host.flags['radio_muted'], false);
  assert.equal(g.host.flags['radio_place'], 'commons');
  assert.equal(count(g, 'radio tag_fm_01'), 1);
  // Dive lockers take the radio along; coming back to the commons returns it; staying put does not restart it.
  fire(g, 'trigger:dive_lockers_enter');
  await advance(g, 1);
  assert.equal(g.host.flags['radio_place'], 'dive');
  fire(g, 'trigger:dive_lockers_enter');
  await advance(g, 1);
  assert.equal(count(g, 'radio tag_fm_01'), 2, 'already there: no restart');
  fire(g, 'trigger:commons_enter');
  await advance(g, 1);
  assert.equal(g.host.flags['radio_place'], 'commons');
  assert.equal(count(g, 'radio tag_fm_01'), 3);
});

// ------------------------------------------------------------------------------- rounds

const complete = {
  hydro: (g: Game) => fire(g, 'round:hydro_log'),
  dive: (g: Game) => {
    g.host.events.emit('item:given', { id: 'sample_case' });
    fire(g, 'round:dive_case');
  },
  admin: (g: Game) => g.host.events.emit('item:given', { id: 'card_l2' }),
};
const perms = <T,>(xs: T[]): T[][] => (xs.length < 2 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));

test('the three rounds in any of the six orders: one checkpoint each, objectives done, the way back after the third', async () => {
  for (const order of perms(['hydro', 'dive', 'admin'] as const)) {
    const g = makeGame();
    g.host.flags['briefingSeen'] = true;
    for (let i = 0; i < order.length; i++) {
      complete[order[i]!](g);
      await advance(g, 4);
      assert.equal(g.host.flags[`round_${order[i]}_done`], true, order.join());
      assert.equal(g.host.flags['rounds_done'], i === 2 ? true : undefined, `${order.join()} after ${i + 1}`);
    }
    await advance(g, 20);
    for (const r of order) assert.equal(count(g, `checkpoint cp_round_${r}`), 1, `${order.join()} ${r}`);
    assert.equal(said(g, 'pa_gallery_call_01'), 1);
    assert.equal(said(g, 'rounds_giles_radio_01'), 1);
    assert.equal(said(g, 'pa_quarantine_01'), 1, 'the PA repeats once, after the first round only');
    assert.equal(g.host.flags['rounds_done'], true);
    assert.ok(g.log.includes('npc npcFollow giles stay') && g.log.includes('npc npcFollow okafor stay'), 'the squad is parked at the gallery');
    noWarnings(g);
  }
});

test('the commons changes as rounds complete: TV and the cook after the first, crew_1 seated after the second', async () => {
  const g = makeGame();
  complete.hydro(g);
  await advance(g, 4);
  assert.equal(count(g, 'event screen:set'), 1);
  assert.ok(g.log.includes('npc npcMoveTo cook instant'));
  assert.ok(!g.log.some((e) => e.startsWith('npc npcMoveTo crew_1')));
  complete.dive(g);
  await advance(g, 4);
  assert.ok(g.log.includes('npc npcMoveTo crew_1 instant'));
  complete.admin(g);
  await advance(g, 4);
  assert.equal(count(g, 'event screen:set'), 1, 'no third change');
  assert.equal(g.log.filter((e) => e === 'npc npcMoveTo crew_1 instant').length, 1);
});

test('the hydro storeroom backtrack: denied says the line once; the store moment plays Jay and keeps radio muted if muted', async () => {
  const g = makeGame();
  g.host.events.emit('access:denied', { id: 'hydro_store' });
  g.host.events.emit('access:denied', { id: 'hydro_store' });
  g.host.events.emit('access:denied', { id: 'somewhere_else' });
  await advance(g, 3);
  assert.equal(said(g, 'hydro_store_locked_01'), 1);
  fire(g, 'trigger:hydro_store_enter');
  await advance(g, 8);
  assert.equal(said(g, 'hydro_store_jay_01'), 1);
  assert.equal(said(g, 'hydro_store_jay_02'), 1);
  assert.equal(g.host.flags['hydro_store_seen'], true);
  assert.equal(g.host.flags['radio_place'], 'hydro');
  const m = makeGame();
  m.host.flags['radio_muted'] = true;
  fire(m, 'trigger:hydro_store_enter');
  await advance(m, 8);
  assert.equal(count(m, 'radio tag_fm_01'), 0);
  assert.equal(m.host.flags['hydro_store_seen'], true);
});

test('the dive stow without the case answers and finishes nothing; with the case it completes the round', async () => {
  const g = makeGame();
  g.host.flags['briefingSeen'] = true;
  fire(g, 'round:dive_case');
  await advance(g, 4);
  assert.equal(said(g, 'dive_jay_02'), 1);
  assert.equal(g.host.flags['round_dive_done'], undefined);
  // Pick the case up, stow it: now the round completes (the "no case" answer must not repeat).
  g.host.events.emit('item:given', { id: 'sample_case' });
  assert.equal(g.host.flags['dive_case_held'], true);
  fire(g, 'round:dive_case');
  await advance(g, 6);
  assert.equal(g.host.flags['round_dive_done'], true);
  assert.equal(said(g, 'dive_sung_03'), 1);
  assert.equal(said(g, 'dive_jay_02'), 1);
  assert.equal(count(g, 'checkpoint cp_round_dive'), 1);
});

test('the admin glimpse: a figure spawns, the feed goes live then static, the figure is gone', async () => {
  const g = makeGame();
  fire(g, 'trigger:security_booth');
  assert.equal(g.m.isRunning('admin_glimpse'), false, 'needs the briefing');
  g.host.flags['briefingSeen'] = true;
  fire(g, 'trigger:security_booth');
  await advance(g, 12);
  const at = (e: string): number => g.log.indexOf(e);
  assert.ok(at('npc spawn medbay_figure') >= 0 && at('feed admin_cam live') > at('npc spawn medbay_figure'));
  assert.ok(at('feed admin_cam static') > at('feed admin_cam live'));
  assert.ok(at('npc despawn medbay_figure') > at('feed admin_cam live'));
  assert.equal(said(g, 'admin_monitor_01'), 1);
  assert.equal(g.feeds[0]!.state, 'live');
  assert.equal(g.host.flags['admin_glimpse_seen'], true);
  noWarnings(g);
});

// ------------------------------------------------------------------------------- the drop

test('the drop does not start before the rounds are done, nor from the wrong door', async () => {
  const g = makeGame();
  g.host.flags['briefingSeen'] = true;
  fire(g, 'trigger:gallery_enter');
  assert.equal(g.m.isRunning('drop'), false);
  assert.equal(g.host.flags['drop_started'], undefined);
});

test('the drop: seals the door, blinds up, Voss transforms, red lights and glass cracks, then control returns and cp_drop is taken', async () => {
  const g = makeGame();
  g.host.flags['briefingSeen'] = true;
  for (const r of ['hydro', 'dive', 'admin'] as const) complete[r](g);
  await advance(g, 30);
  assert.equal(g.host.flags['rounds_done'], true);
  fire(g, 'trigger:gallery_enter');
  assert.equal(g.m.isRunning('drop'), true);
  assert.equal(g.m.skippable, false);
  assert.equal(g.m.skip(), false, 'the drop cannot be skipped');
  assert.equal(g.control.state.weapons, false);
  await until(g, () => !g.m.isRunning('drop'), 120);
  const at = (e: string): number => g.log.findIndex((x) => x.startsWith(e));
  assert.equal(g.host.flags['drop_done'], true);
  assert.ok(g.log.includes('door D_R02_R03 locked') || at('door D_R02_R03') >= 0, 'R03 sealed');
  assert.ok(at('event blinds:set') >= 0, 'blinds up');
  assert.ok(at('npc transform researcher_b') >= 0, 'Voss changes');
  assert.ok(g.log.some((e) => e.startsWith('light ') && e.endsWith('alarm emergency')), 'red lights');
  assert.equal(g.log.includes('glass labb cracked'), false);
  assert.equal(count(g, 'event drop:done'), 1);
  assert.equal(count(g, 'checkpoint cp_drop'), 1);
  assert.ok(g.log.indexOf('checkpoint cp_drop') > g.log.indexOf('event drop:done'));
  assert.equal(g.host.flags['obj:round_return'], 'done');
  assert.equal(g.host.flags['obj:obj_survive_lab'], 'active');
  assert.equal(g.control.state.move, 'free');
  assert.equal(g.control.state.weapons, true);
  // And never twice.
  fire(g, 'trigger:gallery_enter');
  assert.equal(g.m.isRunning('drop'), false);
  noWarnings(g);
});

test('the cameraFeed action: validates, fills the host call, warns without a host,', async () => {
  const ok = validateSequences({
    'x.json': { id: 'cam_ok', steps: [{ do: 'cameraFeed', id: 'a', from: 'anchor:cam04_pos', lookAt: 'anchor:cam04_look', state: 'live', fullscreen: true }] },
  });
  assert.equal(ok.length, 1);
  assert.throws(() => validateSequences({ 'x.json': { id: 'cam_bad', steps: [{ do: 'cameraFeed', id: 'a', state: 'sideways' }] } }));
  const g = makeGame();
  const d = validateSequences({ 'x.json': { id: 'cam_ok', steps: [{ do: 'cameraFeed', id: 'a', from: [1, 2, 3], lookAt: [0, 0, 0], state: 'live' }] } });
  const gm = new SequenceManager(g.host, d);
  assert.equal(gm.start('cam_ok'), true);
  assert.equal(g.feeds.length, 1);
  assert.equal(g.feeds[0]!.state, 'live');
  const bare = makeGame();
  delete (bare.host as { cameraFeed?: unknown }).cameraFeed;
  new SequenceManager(bare.host, d).start('cam_ok');
  assert.ok(bare.log.some((e) => e.startsWith('warn')), 'no host: a warning, not a crash');
});

// ------------------------------------------------------------------------------- restore, walk-by, ruined room

test('quiet_restore on a load: radio, commons changes and the drop aftermath come back from the flags; a fresh game does nothing', async () => {
  const fresh = makeGame(['quiet_restore']);
  fresh.host.events.emit('game:mode', { mode: 'playing' });
  assert.equal(fresh.log.filter((e) => e.startsWith('radio') || e.startsWith('npc') || e.startsWith('light') || e.startsWith('glass')).length, 0);
  const g = makeGame(['quiet_restore']);
  Object.assign(g.host.flags, { radio_place: 'dive', commons_changed_1: true, commons_changed_2: true, drop_started: true, drop_done: true });
  g.host.events.emit('game:mode', { mode: 'title' });
  assert.equal(g.log.filter((e) => e.startsWith('radio')).length, 0, 'only on playing');
  g.host.events.emit('game:mode', { mode: 'playing' });
  assert.equal(count(g, 'radio tag_fm_01'), 1);
  assert.equal(count(g, 'event screen:set'), 1);
  assert.ok(g.log.includes('npc npcMoveTo cook instant') && g.log.includes('npc npcMoveTo crew_1 instant') && g.log.includes('npc npcAnim crew_1 idle_mug instant'));
  assert.ok(g.log.includes('event blinds:set'));
  assert.ok(g.log.includes('npc transform researcher_b instant') && g.log.includes('npc npcAnim researcher_b shamble instant'));
  assert.ok(g.log.includes('light R04 alarm emergency') && g.log.includes('light R03 steady emergency'));
  assert.equal(g.log.includes('glass labb cracked'), false);
  noWarnings(g);
  // Muted stays muted; only the mid-quiet pieces apply before the drop.
  const muted = makeGame(['quiet_restore']);
  Object.assign(muted.host.flags, { radio_place: 'none', radio_muted: true, commons_changed_1: true });
  muted.host.events.emit('game:mode', { mode: 'playing' });
  assert.equal(count(muted, 'radio tag_fm_01'), 0);
  assert.equal(count(muted, 'event screen:set'), 1);
  assert.ok(!muted.log.some((e) => e.startsWith('light') || e.startsWith('glass')));
  for (const place of ['commons', 'hydro', 'dive', 'ruined']) {
    const r = makeGame(['quiet_restore']);
    r.host.flags['radio_place'] = place;
    r.host.events.emit('game:mode', { mode: 'playing' });
    assert.equal(count(r, 'radio tag_fm_01'), 1, place);
  }
});

test('the silent researcher walks through the commons after the first round, once, and Jay gets no answer', async () => {
  const g = makeGame();
  fire(g, 'trigger:commons_enter');
  await advance(g, 1);
  assert.equal(g.log.some((e) => e.startsWith('npc spawn researcher_a')), false, 'not before the first round');
  g.host.flags['commons_changed_1'] = true;
  fire(g, 'trigger:commons_enter');
  await advance(g, 12);
  assert.ok(g.log.includes('npc spawn researcher_a'));
  assert.ok(g.log.includes('npc npcMoveTo researcher_a'));
  assert.equal(said(g, 'walkby_jay_01'), 1);
  assert.equal(said(g, 'walkby_jay_02'), 1);
  assert.ok(g.log.includes('npc despawn researcher_a'));
  assert.ok(!g.log.some((e) => e.startsWith('npc npcLookAt researcher_a') || e.startsWith('npc npcFollow researcher_a')), 'she never looks at Jay');
  assert.equal(g.host.flags['researcher_walkby_seen'], true);
  fire(g, 'trigger:commons_enter');
  await advance(g, 12);
  assert.equal(count(g, 'npc spawn researcher_a'), 1, 'once');
  // Not once the drop has started.
  const late = makeGame();
  Object.assign(late.host.flags, { commons_changed_1: true, drop_started: true });
  fire(late, 'trigger:commons_enter');
  await advance(late, 2);
  assert.equal(late.log.some((e) => e.startsWith('npc spawn researcher_a')), false);
});

test('TAG FM plays in the ruined junction once the first fight is over and stops when Jay enters the next hall', async () => {
  const g = makeGame(['ruined_radio_off']);
  fire(g, 'trigger:r06_enter');
  assert.equal(count(g, 'radio stop'), 0, 'nothing plays: nothing to stop');
  g.host.flags['contact_done'] = true;
  g.host.flags['radio_place'] = 'commons';
  fire(g, 'trigger:r06_enter');
  assert.equal(count(g, 'radio stop'), 0, 'a radio elsewhere is left alone');
  g.host.flags['radio_place'] = 'ruined';
  fire(g, 'trigger:r06_enter');
  assert.equal(count(g, 'radio stop'), 1);
  assert.equal(g.host.flags['radio_place'], 'none');
  // The data: the contact beat ends by starting it at the R05 radio before its checkpoint.
  const contact = byId.get('contact')!;
  const names: string[] = [];
  walk(contact.steps, (s) => void names.push(`${String(s['do'])}${s['do'] === 'radio' ? `:${String(s['at'])}` : ''}${s['do'] === 'checkpoint' ? `:${String(s['id'])}` : ''}`));
  assert.ok(names.indexOf('radio:anchor:r05_radio') >= 0 && names.indexOf('radio:anchor:r05_radio') < names.indexOf('checkpoint:cp_contact_clear'));
  assert.ok(anchors.has('r05_radio'));
});
