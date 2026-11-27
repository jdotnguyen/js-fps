/**
 * The quiet half (ADR-0023, intro-sequence spec): commons free time and the dawdle catch, the briefing trigger,
 * three morning rounds in any order, the Level 2 Card backtrack, TAG FM in rooms, the camera feed
 * glimpse, the PA call back and the drop. Every sequence loaded from data/sequences is checked against
 * the real dialogue, objectives, items, sounds and the slice01 level data (anchors, NPCs, doors), and
 * the chains are played headless on a host that dispatches events like the game does.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { ControlStack } from '../actors/control.ts';
import { sidearmAllowed } from '../game/sidearm.ts';
import { SAMPLE_URLS, SOUND_SPECS } from '../audio/sounds.ts';
import { DialogueLibrary } from '../dialogue/library.ts';
import { isParallel } from './actions.ts';
import type { CameraFeedOptions, SequenceHost } from './host.ts';
import { SequenceManager } from './runtime.ts';
import { validateSequences } from './schema.ts';
import type { Flags, Step } from './types.ts';
import { readLevel } from '../data/levels/readLevel.ts';

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
const level = readLevel('slice01') as any;
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
  const npcSet = new Set([...npcIds, 'medbay_figure', 'r08_thing', 'researcher_a', 'giles', 'okafor', 'r09_flood_shambler']);
  // A `grownInside` kill spawns the creature that comes out of the victim (infection-kills spec).
  for (const def of defs) walk(def.steps, (s) => {
    if (s['do'] === 'kill') npcSet.add(typeof s['creatureId'] === 'string' ? s['creatureId'] : `${String(s['npc'])}_creature`);
  });
  for (const def of defs.filter((d) => !d.id.startsWith('test_') && !d.id.startsWith('cutscene_test'))) {
    walk(def.steps, (s) => {
      const where = `${def.id}: ${String(s['do'])}`;
      if (s['do'] === 'say') {
        // A say may be a pool of lines said in turn (medbay-attack: Jay's shouts at the glass).
        for (const line of Array.isArray(s['line']) ? (s['line'] as string[]) : [s['line'] as string]) {
          assert.ok(library.hasLine(line), `${where} line ${line}`);
          assert.equal(library.line(line).priority, 'story', `${where} ${line} must be story priority`);
        }
      }
      if (s['do'] === 'sfx') assert.ok((s['id'] as string) in SOUND_SPECS || (s['id'] as string) in SAMPLE_URLS, `${where} sound ${String(s['id'])}`);
      if (s['do'] === 'setObjective' || s['do'] === 'completeObjective') assert.ok(String(s['id']) in objectives, `${where} objective ${String(s['id'])}`);
      if (s['do'] === 'giveItem') assert.ok(String(s['item']) in items, `${where} item`);
      if (s['do'] === 'doorState') assert.ok(doorIds.has(s['id'] as string), `${where} door ${String(s['id'])}`);
      if (s['do'] === 'lightState') assert.ok(roomIds.has(s['room'] as string), `${where} room ${String(s['room'])}`);
      if (typeof s['npc'] === 'string') assert.ok(npcSet.has(s['npc']), `${where} npc ${s['npc']}`);
      if (s['do'] === 'kill') for (const l of Object.values((s['lines'] as Record<string, string> | undefined) ?? {})) assert.ok(library.hasLine(l), `${where} cue line ${l}`);
      for (const field of ['to', 'target', 'at', 'from', 'lookAt', 'glass']) {
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

test('the quiet sequences keep Jay in control; briefing and intro stay skippable, drop cannot be skipped', () => {
  assert.equal(byId.get('briefing_gallery')?.skippable, true);
  assert.equal(byId.get('intro_shift_change')?.skippable, true);
  for (const id of ['commons_free', 'commons_dawdle', 'hydro_moment', 'dive_moment', 'admin_hale', 'admin_glimpse', 'rounds_return', 'drop']) {
    assert.notEqual(byId.get(id)?.skippable, true, `${id} stays unskippable`);
  }
  assert.equal(byId.get('drop')?.exclusive, 'rails');
  assert.equal(byId.get('briefing_gallery')?.exclusive, undefined);
  assert.equal(byId.get('commons_dawdle')?.exclusive, undefined);
});

// ------------------------------------------------------------------------------- harness

function makeGame(only?: string[]) {
  const log: string[] = [];
  const control = new ControlStack();
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  const feeds: CameraFeedOptions[] = [];
  /** Every NPC step as the director would get it. */
  const npcSteps: Array<{ action: string; step: Readonly<Record<string, unknown>> }> = [];
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
    score: (id, o) => void log.push(`score ${id} ${o.cue ?? (o.stinger ? `stinger ${o.stinger}` : 'load')}`),
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
    ventState: (id, state, instant) => void log.push(`vent ${id} ${state}${instant ? ' instant' : ''}`),
    hush: (speakers, _s, keep) => void log.push(speakers ? `hush ${speakers.join(',')}${keep?.length ? ` keep ${keep.join(',')}` : ''}` : 'hush off'),
    intercom: (id, live) => (log.push(`intercom ${id} ${live ? 'on' : 'off'}`), true),
    cameraFeed: (id, opts) => (feeds.push(opts), void log.push(`feed ${id} ${opts.state}`)),
    // Squad placement steps (unify-checkpoint-restore): everyone counts as in the room.
    squadRegroup: () => [],
    inRoom: () => true,
    squadPlaceIn: () => [],
    squadCatchUpIn: () => [],
    npc: (action, step) => {
      npcSteps.push({ action, step });
      const extra =
        step['anim']
          ? ` ${String(step['anim'])}`
          : step['task']
            ? ` ${String(step['task'])}`
            : action === 'npcLookAt' && step['target']
              ? ` ${String(step['target'])}`
              : '';
      log.push(`npc ${action} ${String(step['npc'])}${extra}${step['instant'] ? ' instant' : ''}${step['stay'] ? ' stay' : ''}`);
      if (action === 'npcMoveTo') log.push(`to ${String(step['npc'])} ${String(step['to'])}`);
    },
  };
  const m = new SequenceManager(host, only ? defs.filter((d) => only.includes(d.id)) : defs);
  return { m, host, log, control, feeds, npcSteps };
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

test('commons free time: the squad heads straight for the gallery, and at 45 s Giles comes back beside the door to call', async () => {
  const g = makeGame();
  endIntro(g);
  assert.equal(g.m.isRunning('commons_free'), true);
  await advance(g, 1);
  // "Briefing's in the gallery in ten": they go and wait at their briefing spots, not in the doorway.
  assert.ok(g.log.includes('to giles anchor:brief_giles') && g.log.includes('to okafor anchor:brief_okafor'), 'the squad waits in the gallery');
  await advance(g, 39);
  assert.equal(said(g, 'commons_giles_call_01'), 0, 'free time first');
  await advance(g, 8);
  assert.equal(said(g, 'commons_giles_call_01'), 1);
  assert.ok(g.log.includes('to giles anchor:dawdle_call'), 'Giles calls from beside the gallery door');
  assert.ok(!g.log.some((e) => e.includes('gallery_door')), 'no one waits in the doorway');
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

test('commons_dawdle: still wandering 45 s after the call, Giles calls out without locking Jay on rails', async () => {
  const g = makeGame();
  endIntro(g);
  assert.equal(g.host.flags['obj:obj_briefing'], 'active', 'briefing objective starts right after intro');
  await until(g, () => count(g, 'event commons:dawdle') === 1);
  assert.equal(g.m.isRunning('commons_dawdle'), true);
  assert.equal(g.control.state.move, 'free', 'never locks movement on rails');
  await advance(g, 30);
  assert.equal(said(g, 'commons_giles_hey_01'), 1);
  assert.equal(said(g, 'commons_giles_hey_02'), 1);
  assert.equal(g.host.flags['dawdle_caught'], true);
  assert.equal(g.control.state.move, 'free');
  noWarnings(g);
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

test('the briefing starts on the gallery spot once the intro is seen, stays free-roam, and runs only once', async () => {
  const g = makeGame();
  fire(g, 'trigger:gallery_brief_spot');
  assert.equal(g.m.isRunning('briefing_gallery'), false, 'not before the intro');
  g.host.flags['introSeen'] = true;
  fire(g, 'trigger:gallery_brief_spot');
  assert.equal(g.m.isRunning('briefing_gallery'), true);
  assert.equal(g.control.state.move, 'free', 'free-roam briefing');
  await advance(g, 120);
  assert.equal(g.host.flags['briefingSeen'], true);
  assert.equal(g.host.flags['obj:obj_briefing'], 'done');
  assert.equal(g.host.flags['obj:round_hydro'], 'active');
  fire(g, 'trigger:gallery_brief_spot');
  assert.equal(g.m.isRunning('briefing_gallery'), false, 'once');
});

test('TAG FM: Listen toggles the kitchen radio once per use; entering the commons brings it back; it never leaves the kitchen', async () => {
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
  // in-world-audio spec: the kitchen radio is the only one. The dive lockers no longer take it along.
  fire(g, 'trigger:dive_lockers_enter');
  await advance(g, 1);
  assert.equal(g.host.flags['radio_place'], 'commons');
  fire(g, 'trigger:commons_enter');
  await advance(g, 1);
  assert.equal(count(g, 'radio tag_fm_01'), 1, 'already playing in the kitchen: no restart');
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
    assert.ok(!g.log.some((e) => e.startsWith('npc npcFollow') && e.endsWith('stay')), 'the squad is not sent ahead; the drop places it (gallery-drop spec)');
    noWarnings(g);
  }
});

test('the commons changes as rounds complete: TV and the cook after the first, nothing more after the second', async () => {
  const g = makeGame();
  complete.hydro(g);
  await advance(g, 4);
  assert.equal(count(g, 'event screen:set'), 1);
  assert.ok(g.log.includes('npc npcMoveTo cook instant'));
  complete.dive(g);
  await advance(g, 4);
  assert.ok(!g.log.some((e) => e.startsWith('npc npcMoveTo crew_1')), 'crew_1 is gone from the commons');
  complete.admin(g);
  await advance(g, 4);
  assert.equal(count(g, 'event screen:set'), 1, 'no third change');
});

test('the hydro storeroom backtrack: denied says the line once; the store moment plays Jay, and no radio plays there', async () => {
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
  assert.equal(count(g, 'radio tag_fm_01'), 0, 'hydroponics-wing spec: the Storeroom has no radio');
  assert.equal(g.host.flags['radio_place'], undefined);
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

test('the drop: seals the door, blinds up, the bloom kills Voss, red lights, then control returns and cp_drop is taken', async () => {
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
  assert.equal(g.host.flags['gunDrawn'], undefined);
  // holster-until-the-drop: through the blackout, the vent rip and the creature's despawn the pistol stays down...
  await until(g, () => g.log.includes('npc despawn researcher_b_creature'), 120);
  assert.equal(g.control.state.weapons, false, 'still holstered at the reveal');
  assert.equal(g.host.flags['gunDrawn'], undefined);
  assert.equal(count(g, 'sfx ductBang'), 0);
  // ...and comes up on the first duct bang, before the drop is over.
  await until(g, () => g.log.includes('sfx ductBang'), 20);
  assert.equal(g.control.state.weapons, true, 'raised on the first duct bang');
  assert.equal(g.host.flags['gunDrawn'], true);
  assert.equal(g.host.flags['drop_done'], undefined);
  await until(g, () => !g.m.isRunning('drop'), 120);
  const at = (e: string): number => g.log.findIndex((x) => x.startsWith(e));
  assert.equal(g.host.flags['drop_done'], true);
  assert.ok(g.log.includes('door D_R02_R03 locked') || at('door D_R02_R03') >= 0, 'R03 sealed');
  assert.ok(at('event blinds:set') >= 0, 'blinds up');
  assert.ok(at('npc kill researcher_b') >= 0, 'the bloom kills Voss (infection-kills spec)');
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

test('the drop (gallery-drop spec): starts as Jay walks in with no walk or bars, Voss already distressed, free through the kill without a forced look, a short unbarred hold at the ambush', async () => {
  const g = makeGame();
  g.host.flags['briefingSeen'] = true;
  for (const r of ['hydro', 'dive', 'admin'] as const) complete[r](g);
  await advance(g, 30);
  assert.ok(g.log.includes('event blinds:set'), 'the blinds went up when the rounds finished');
  const before = count(g, 'event blinds:set');
  fire(g, 'trigger:gallery_enter');
  assert.equal(g.m.isRunning('drop'), true);
  assert.equal(g.control.state.move, 'free', 'no rails: Jay keeps walking in himself');
  assert.equal(g.control.state.look, 'free');
  assert.equal(g.control.state.weapons, false, 'weapons off from the start');
  assert.equal(g.control.state.interact, false);
  const kinds: string[] = [];
  walk(byId.get('drop')!.steps, (s) => void kinds.push(String(s['do'])));
  assert.ok(kinds.includes('squadCatchUpIn') && !kinds.includes('gatherIn'), 'the squad is caught up unseen, not gathered');
  assert.equal(kinds.includes('playerWalkTo'), false, 'Jay is never walked');
  assert.equal(kinds.includes('playerLookAt'), false, 'the view is never turned');
  assert.equal(g.log.includes('say drop_heins_01'), false, 'Heins does not announce the blinds');
  // Voss starts at once: her plea comes as the kill's scratch beat begins, and Okafor waits for it to end.
  await until(g, () => g.log.some((e) => e.startsWith('npc kill researcher_b')), 30);
  g.host.events.emit('kill:scratch', { npc: 'researcher_b', beat: 'scratch' });
  await advance(g, 0.1);
  assert.ok(g.log.includes('say drop_voss_01'), 'she says it is under her skin as the drop starts');
  assert.equal(g.log.includes('say drop_okafor_02'), false, 'Okafor waits for her to run');
  await until(g, () => g.log.includes('say drop_okafor_01'), 40);
  assert.ok(g.log.indexOf('say drop_okafor_01') > g.log.indexOf('say drop_voss_01'), 'Okafor asks after her plea');
  assert.equal(g.control.state.move, 'free', 'still free once Okafor has spoken');
  assert.equal(g.control.state.look, 'free');
  assert.equal(g.control.state.weapons, false, 'weapons stay off until the ambush');
  assert.equal(g.control.state.interact, false);
  assert.ok(g.log.some((e) => e.startsWith('door D_R02_R03')), 'sealed before Okafor speaks');
  assert.equal(count(g, 'event blinds:set'), before, 'no second blinds event in the drop');
  g.host.events.emit('kill:panic', { npc: 'researcher_b', beat: 'panic' });
  await advance(g, 0.1);
  assert.ok(g.log.includes('say drop_okafor_02'), 'Okafor says she is seizing as she runs');
  await until(g, () => g.log.includes('npc despawn researcher_b_creature'), 120);
  assert.equal(g.control.state.look, 'locked', 'the ambush hold');
  assert.notEqual(g.control.state.move, 'locked', 'held without cutscene bars');
  await until(g, () => g.log.includes('sfx ductScrape'), 20);
  assert.equal(g.control.state.look, 'free', 'the hold ends after the first duct bang');
  assert.equal(g.control.state.weapons, true);
  await until(g, () => !g.m.isRunning('drop'), 120);
  noWarnings(g);
});

test('after the rounds Voss breathes hard over the Lab B intercom until Jay walks into the gallery; then her plea starts and the squad is caught up (gallery-drop spec)', async () => {
  const g = makeGame();
  const caughtUp: string[] = [];
  g.host.squadCatchUpIn = (room: string) => (caughtUp.push(room), []);
  g.host.flags['briefingSeen'] = true;
  for (const r of ['hydro', 'dive', 'admin'] as const) complete[r](g);
  await advance(g, 30);
  assert.equal(g.host.flags['obj:round_return'], 'active', 'the return objective leads to the gallery');
  // Before Jay is back: the intercom is live and her breathing repeats from her, nothing else of the drop.
  assert.equal(g.m.isRunning('drop_approach'), true);
  assert.ok(g.log.includes('intercom labb on'), 'the Lab B intercom carries her into the gallery');
  const early = count(g, 'sfx voss_panic_breath');
  await advance(g, 12);
  const breaths = count(g, 'sfx voss_panic_breath');
  assert.ok(breaths - early >= 3, `she keeps breathing hard while Jay walks back (${breaths - early} breaths in 12 s)`);
  assert.equal(g.m.isRunning('drop'), false);
  assert.equal(g.log.includes('say drop_voss_01'), false, 'no plea until Jay walks in');
  assert.deepEqual(caughtUp, []);
  // He walks into the gallery: the drop starts at once and her plea begins with the scratch beat.
  fire(g, 'trigger:gallery_enter');
  assert.equal(g.m.isRunning('drop'), true, 'on walking in');
  assert.equal(g.m.isRunning('drop_approach'), false, 'the waiting breaths stop; the kill breathes for her now');
  assert.equal(g.control.state.move, 'free');
  await until(g, () => g.log.some((e) => e.startsWith('npc kill researcher_b')), 5);
  g.host.events.emit('kill:scratch', { npc: 'researcher_b', beat: 'scratch' });
  await advance(g, 0.1);
  assert.ok(g.log.includes('say drop_voss_01'), 'she says it is under her skin as he walks in');
  assert.ok(caughtUp.length > 0 && caughtUp.every((r) => r === 'R03'), 'stragglers are brought in, unseen, as the drop starts');
  const atStart = caughtUp.length;
  fire(g, 'trigger:gallery_brief_spot');
  await advance(g, 0.1);
  assert.ok(caughtUp.length > atStart, 'and again once he is a few steps in');
  assert.equal(count(g, 'sfx voss_panic_breath'), breaths, 'no waiting breaths after the drop starts');
});

test('a load between the rounds and the drop brings the breathing back; a load after the drop starts does not', () => {
  const waiting = makeGame(['quiet_restore', 'drop_approach']);
  Object.assign(waiting.host.flags, { introSeen: true, briefingSeen: true, rounds_done: true });
  waiting.host.events.emit('game:mode', { mode: 'playing', from: 'title' });
  assert.equal(waiting.m.isRunning('drop_approach'), true);
  assert.ok(waiting.log.includes('intercom labb on') && waiting.log.includes('sfx voss_panic_breath'));
  const after = makeGame(['quiet_restore', 'drop_approach']);
  Object.assign(after.host.flags, { introSeen: true, briefingSeen: true, rounds_done: true, drop_started: true, drop_done: true });
  after.host.events.emit('game:mode', { mode: 'playing', from: 'title' });
  assert.equal(after.m.isRunning('drop_approach'), false);
  assert.equal(after.log.includes('sfx voss_panic_breath'), false);
});

test('Hunched before Jay arrives (gallery-drop): from the end of the rounds, and after a load between them and the drop, Voss stands hunched holding her arm, not typing', async () => {
  const HUNCH = 'npc npcAnim researcher_b voss_hunch_hold';
  const typing = (g: ReturnType<typeof makeGame>, after: number): boolean => g.log.slice(after).some((e) => e.startsWith('npc npcAnim researcher_b typing'));
  // Arriving after the rounds: she has stopped typing before Jay walks back into the gallery.
  const g = makeGame();
  g.host.flags['briefingSeen'] = true;
  for (const r of ['hydro', 'dive', 'admin'] as const) complete[r](g);
  await advance(g, 30);
  assert.equal(g.m.isRunning('drop'), false, 'Jay is not back yet');
  const at = g.log.indexOf(HUNCH);
  assert.ok(at >= 0, 'she is hunched, holding her arm, as soon as the rounds are done');
  await advance(g, 12);
  assert.equal(typing(g, at), false, 'and stays so: no typing again');
  // Loading a save taken between the rounds and the drop: the same.
  const loaded = makeGame(['quiet_restore', 'drop_approach']);
  Object.assign(loaded.host.flags, { introSeen: true, briefingSeen: true, rounds_done: true });
  loaded.host.events.emit('game:mode', { mode: 'playing', from: 'title' });
  const after = loaded.log.indexOf(HUNCH);
  assert.ok(after >= 0, 'after the load she is hunched again');
  assert.equal(typing(loaded, after), false);
  // After the drop, a load lays out the aftermath instead (her kill, restored): no waiting pose.
  const done = makeGame(['quiet_restore', 'drop_approach']);
  Object.assign(done.host.flags, { introSeen: true, briefingSeen: true, rounds_done: true, drop_started: true, drop_done: true });
  done.host.events.emit('game:mode', { mode: 'playing', from: 'title' });
  assert.equal(done.log.includes(HUNCH), false);
});

test('the gallery entered before the rounds are done does not start the drop from afar when they finish (sequence-triggers spec)', async () => {
  const g = makeGame();
  const caughtUp: string[] = [];
  g.host.squadCatchUpIn = (room: string) => (caughtUp.push(room), []);
  g.host.flags['briefingSeen'] = true;
  // The morning briefing walks Jay into the gallery; its triggers fire again on every entry (`once: false`).
  const enter = (emit: string): void => {
    g.host.events.emit('trigger:fired', { id: `t_${emit}`, event: emit, once: false });
    g.host.events.emit(emit, { id: `t_${emit}` });
  };
  enter('trigger:gallery_enter');
  enter('trigger:gallery_brief_spot');
  await advance(g, 0.1);
  // The last round ends elsewhere in the station.
  for (const r of ['hydro', 'dive', 'admin'] as const) complete[r](g);
  await advance(g, 30);
  assert.equal(g.host.flags['rounds_done'], true);
  assert.equal(g.m.isRunning('drop'), false, 'the drop waits for Jay');
  assert.equal(g.host.flags['drop_started'], undefined);
  assert.equal(g.log.includes('say drop_voss_01'), false, 'no plea heard from afar');
  assert.deepEqual(caughtUp, [], 'the squad is not pulled into the gallery while Jay is away');
  enter('trigger:gallery_enter');
  assert.equal(g.m.isRunning('drop'), true, 'walking back into the gallery starts it');
});

test('holster-until-the-drop: Jay is unarmed on every load until the drop raises the pistol, and armed after', async () => {
  const armed = (g: Game): boolean => sidearmAllowed(g.host.flags, true);
  // Only the drop arms Jay: no other sequence sets the flags the rule reads.
  for (const def of defs.filter((d) => d.id !== 'drop' && !d.id.startsWith('test_'))) {
    walk(def.steps, (s) => {
      if (s['do'] === 'setFlag') assert.ok(s['flag'] !== 'gunDrawn' && s['flag'] !== 'drop_done', `${def.id} sets ${String(s['flag'])}`);
    });
  }
  // The Fire / Reload prompt waits for `combat:first`; no sequence may raise it, so it cannot show to an unarmed Jay.
  for (const def of defs) {
    walk(def.steps, (s) => {
      if (s['do'] === 'emit') assert.notEqual(s['event'], 'combat:first', `${def.id} emits combat:first`);
    });
  }
  const g = makeGame();
  assert.equal(armed(g), false, 'new game');
  endIntro(g);
  assert.equal(armed(g), false, 'after the intro (a cp_intro load)');
  g.host.flags['briefingSeen'] = true;
  for (const r of ['hydro', 'dive', 'admin'] as const) complete[r](g);
  await advance(g, 30);
  assert.equal(g.host.flags['rounds_done'], true);
  assert.equal(armed(g), false, 'after the rounds (a cp_round_* load)');
  fire(g, 'trigger:gallery_enter');
  await until(g, () => g.log.includes('npc despawn researcher_b_creature'), 120);
  assert.equal(armed(g), false, 'at the reveal, a mid-drop restart returns to a pre-drop checkpoint');
  await until(g, () => g.log.includes('sfx ductBang'), 20);
  assert.equal(armed(g), true, 'from the first duct bang');
  await until(g, () => !g.m.isRunning('drop'), 120);
  assert.equal(armed(g), true, 'a cp_drop load');
  const old = { ...g.host.flags };
  delete old['gunDrawn'];
  assert.equal(sidearmAllowed(old, true), true, 'a save from after the drop that never had gunDrawn');
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

test('the drop follows the kill: each line and light change waits for its beat, not a clock (infection-kills spec)', async () => {
  const g = makeGame();
  g.host.flags['briefingSeen'] = true;
  for (const r of ['hydro', 'dive', 'admin'] as const) complete[r](g);
  await advance(g, 30);
  fire(g, 'trigger:gallery_enter');
  await until(g, () => g.log.some((e) => e.startsWith('npc kill researcher_b')), 30);
  await advance(g, 0.2);
  const beat = async (id: string): Promise<void> => {
    g.host.events.emit(`kill:${id}`, { npc: 'researcher_b', beat: id });
    await advance(g, 0.1);
  };
  assert.equal(g.log.includes('say drop_voss_01'), false, 'her plea waits for the scratch beat');
  await beat('scratch');
  assert.ok(g.log.includes('say drop_voss_01'), 'she says "it is under my skin" as she claws her arm');
  assert.equal(g.log.includes('say drop_voss_02'), false, 'the scream waits for the glass');
  await beat('panic');
  await beat('glass');
  assert.ok(g.log.indexOf('say drop_voss_02') > g.log.indexOf('say drop_voss_01'), 'she screams at the glass');
  assert.equal(g.log.some((e) => e.endsWith('alarm emergency')), false, 'the alarm waits for the arch');
  await beat('arch');
  assert.ok(g.log.some((e) => e === 'light R04 alarm emergency'), 'alarm on the arch');
  await beat('burst');
  assert.ok(g.log.includes('shake'), 'the burst shakes the view');
  await beat('still');
  await advance(g, 3);
  assert.ok(g.log.includes('say drop_giles_01'), 'Giles reacts once she is still');
  await until(g, () => !g.m.isRunning('drop'), 60);
  assert.equal(g.host.flags['drop_done'], true);
  noWarnings(g);
});

test("the drop's lines and lights follow her clock: however late Okafor's question ends, each starts on its own beat (gallery-drop spec)", async () => {
  // Beat starts, in seconds after the question ends (voss-death-scene D1), and what the drop starts with each.
  const clock = [
    ['panic', 0, ['say drop_okafor_02', 'light R04 flicker', 'light R03 flicker']],
    ['glass', 6.5, ['say drop_voss_02']],
    ['arch', 10.1, ['light R04 alarm emergency', 'light R03 alarm emergency', 'sfx lockdownAlarm']],
    ['burst', 12.5, ['event bloom:spread', 'shake']],
    ['still', 13.1, ['say drop_okafor_04', 'say drop_giles_01']],
  ] as const;
  // The question ends soon, or 12 s in because the squad was far behind.
  for (const asked of [4, 12]) {
    const g = makeGame();
    g.host.flags['briefingSeen'] = true;
    for (const r of ['hydro', 'dive', 'admin'] as const) complete[r](g);
    await advance(g, 30);
    fire(g, 'trigger:gallery_enter');
    await until(g, () => g.log.some((e) => e.startsWith('npc kill researcher_b')), 5);
    g.host.events.emit('kill:scratch', { npc: 'researcher_b', beat: 'scratch' });
    // Seconds since the question ended.
    let now = -0.1;
    await advance(g, asked + now);
    for (const [id, at, starts] of clock) {
      await advance(g, at - 0.1 - now);
      for (const e of starts) assert.equal(g.log.includes(e), false, `${e} waits for ${id} (question ended at ${asked} s)`);
      await advance(g, 0.1);
      g.host.events.emit(`kill:${id}`, { npc: 'researcher_b', beat: id });
      await advance(g, 0.1);
      for (const e of starts) assert.ok(g.log.includes(e), `${e} starts with ${id} (question ended at ${asked} s)`);
      now = at + 0.1;
    }
    await until(g, () => !g.m.isRunning('drop'), 60);
    noWarnings(g);
  }
});

test('the Lab B escape (trim-lab-wing-encounters): it hammers, the lab goes dark, the vent tears, it crawls off, the lights come back on an empty lab', async () => {
  const g = makeGame();
  g.host.flags['briefingSeen'] = true;
  for (const r of ['hydro', 'dive', 'admin'] as const) complete[r](g);
  await advance(g, 30);
  fire(g, 'trigger:gallery_enter');
  await until(g, () => !g.m.isRunning('drop'), 120);
  const at = (e: string): number => g.log.indexOf(e);
  const order = [
    'say contact_giles_01',
    'say contact_okafor_01',
    'score labB escapeDark',
    'light R04 off black',
    'light R03 off black',
    'hush engineer,medic keep sfx',
    'sfx ventCoverRip',
    'npc despawn researcher_b_creature',
    'vent labb_vent open',
    'sfx ductBang',
    'light R04 steady emergency',
    'light R03 alarm emergency',
    'sfx ambushSting',
    'hush off',
    'score labB hold',
    'sfx ductScrape',
    'event drop:done',
  ];
  let pos = at('say contact_giles_01');
  for (const e of order) {
    const next = g.log.indexOf(e, pos);
    assert.ok(next >= pos, `${e} missing or out of order`);
    pos = next;
  }
  // Pitch black at once (no dying flicker), and the creature is gone before the lights return.
  assert.equal(at('light R04 off black') - at('score labB escapeDark'), 1, 'straight to black');
  assert.equal(g.log.some((e) => e === 'light R04 dying emergency'), false);
  assert.ok(g.log.lastIndexOf('light R04 alarm emergency') > at('sfx ambushSting'), 'the alarm resumes after the reveal');
  // The stinger lands on the lights coming back: the same step.
  assert.equal(at('sfx ambushSting') - g.log.lastIndexOf('light R03 alarm emergency'), 1, 'the stinger plays with the lights');
  // Only the rip and one bang in the dark; it is heard crawling away over R05 once the lights are back.
  assert.equal(count(g, 'sfx ductBang'), 3);
  assert.equal(g.log.slice(at('score labB escapeDark'), at('sfx ambushSting')).filter((e) => e.startsWith('sfx duct')).length, 1);
  assert.equal(g.m.isRunning('contact'), false);
  noWarnings(g);
});

test('a load after the drop: the creature is gone and the Lab B grate hangs open; nothing of the escape replays', () => {
  const g = makeGame(['quiet_restore']);
  Object.assign(g.host.flags, { introSeen: true, drop_started: true, drop_done: true });
  g.host.events.emit('game:mode', { mode: 'playing', from: 'title' });
  assert.ok(g.log.indexOf('npc despawn researcher_b_creature') > g.log.indexOf('npc kill researcher_b instant'), 'the kill lays down the end state, then the creature goes');
  assert.ok(g.log.includes('vent labb_vent open instant'));
  for (const e of ['sfx ventCoverRip', 'sfx ambushSting', 'say contact_giles_01']) assert.equal(g.log.includes(e), false, e);
  noWarnings(g);
});

test('physical-interaction "Restored kill" (voss-death-scene §5): the kill a load after the drop restores lays the swept glassware, the cart and its load out where a played kill leaves them', async () => {
  const g = makeGame(['quiet_restore']);
  Object.assign(g.host.flags, { introSeen: true, drop_started: true, drop_done: true });
  g.host.events.emit('game:mode', { mode: 'playing', from: 'title' });
  const kill = g.npcSteps.find((s) => s.action === 'kill' && s.step['npc'] === 'researcher_b');
  assert.ok(kill?.step['instant'], 'the load restores her kill');
  // The same step, given to the real kill director in the real Lab B (no physics: the level alone draws them).
  const { afterGroup, GROUPS, labBProps } = await import('../physics/labBTestKit.ts');
  const lab = await labBProps({ physics: false });
  void lab.npcs.command('kill', kill!.step);
  lab.run(0.5);
  const now = lab.poses();
  for (const name of [GROUPS.bench, GROUPS.cart, GROUPS.load]) {
    const group = afterGroup(name);
    assert.ok(group.size > 0, `${name} has resting spots`);
    for (const [id, at] of group) assert.ok(now.get(id)!.pos.distanceTo(at.pos) < 1e-4 && now.get(id)!.quat.angleTo(at.quat) < 1e-3, `${id} lies at its resting spot`);
  }
});

// ------------------------------------------------------------------------------- restore, walk-by, ruined room

test('quiet_restore on a load: radio, commons changes and the drop aftermath come back from the flags; a fresh game does nothing', async () => {
  const fresh = makeGame(['quiet_restore']);
  fresh.host.events.emit('game:mode', { mode: 'playing', from: 'title' });
  assert.equal(fresh.log.filter((e) => e.startsWith('radio') || e.startsWith('npc') || e.startsWith('light') || e.startsWith('glass')).length, 0);
  const g = makeGame(['quiet_restore']);
  Object.assign(g.host.flags, { introSeen: true, radio_place: 'commons', commons_changed_1: true, commons_changed_2: true, rounds_done: true, drop_started: true, drop_done: true });
  g.host.events.emit('game:mode', { mode: 'title' });
  assert.equal(g.log.filter((e) => e.startsWith('radio')).length, 0, 'only on playing');
  g.host.events.emit('game:mode', { mode: 'playing', from: 'title' });
  assert.equal(count(g, 'radio tag_fm_01'), 1);
  assert.ok(g.log.includes('npc npcTask dock_guard return_to_desk instant'), 'post-intro restore seats the dock guard at his desk');
  assert.equal(count(g, 'event screen:set'), 1);
  assert.ok(g.log.includes('npc npcMoveTo cook instant') && !g.log.some((e) => e.includes('crew_1')));
  // intro-sequence spec "The Commons after the intro": Bram back at his station, Priya off-stage at the medical bay.
  assert.ok(g.log.includes('to cook anchor:cook_stand') && g.log.includes('npc npcAnim cook idle instant'), 'Bram is at his station');
  assert.ok(!g.log.some((e) => e.includes('priya_exit')), 'no one is sent to the old doorway spot');
  assert.ok(!g.log.some((e) => e.startsWith('to priya')), 'no priya_met flag: Priya is left alone');
  const met = makeGame(['quiet_restore']);
  Object.assign(met.host.flags, { introSeen: true, priya_met: true });
  met.host.events.emit('game:mode', { mode: 'playing', from: 'title' });
  assert.ok(met.log.includes('to priya anchor:priya_offstage'), 'Load after the intro: Priya waits off-stage, out of every view');
  const afterR08 = makeGame(['quiet_restore']);
  Object.assign(afterR08.host.flags, { introSeen: true, priya_met: true, sec_done: true });
  afterR08.host.events.emit('game:mode', { mode: 'playing', from: 'title' });
  assert.ok(!afterR08.log.some((e) => e.startsWith('to priya')), 'after R08 the action restore owns her body');
  assert.ok(g.log.includes('event blinds:set'), 'blinds up from rounds_done');
  assert.ok(g.log.includes('npc kill researcher_b instant'), 'Voss lies dead and torn, the creature stands (infection-kills spec)');
  assert.equal(g.log.includes('npc npcAnim researcher_b shamble instant'), false);
  assert.ok(g.log.includes('light R04 alarm emergency') && g.log.includes('light R03 steady emergency'));
  assert.equal(g.log.includes('glass labb cracked'), false);
  noWarnings(g);
  // Muted stays muted; only the mid-quiet pieces apply before the drop.
  const muted = makeGame(['quiet_restore']);
  Object.assign(muted.host.flags, { radio_place: 'none', radio_muted: true, commons_changed_1: true });
  muted.host.events.emit('game:mode', { mode: 'playing', from: 'title' });
  assert.equal(count(muted, 'radio tag_fm_01'), 0);
  assert.equal(count(muted, 'event screen:set'), 1);
  assert.ok(!muted.log.some((e) => e.startsWith('light') || e.startsWith('glass')));
  // Only the kitchen radio comes back; a save from when the radio could move to other rooms loads with it off.
  for (const place of ['commons', 'hydro', 'dive', 'ruined']) {
    const r = makeGame(['quiet_restore']);
    r.host.flags['radio_place'] = place;
    r.host.events.emit('game:mode', { mode: 'playing', from: 'title' });
    assert.equal(count(r, 'radio tag_fm_01'), place === 'commons' ? 1 : 0, place);
    if (place !== 'commons') assert.equal(r.host.flags['radio_place'], 'none', place);
    assert.ok(!r.log.some((e) => e.includes('hydro_radio') || e.includes('dive_radio') || e.includes('r05_radio')), place);
  }
});

test('the first round changes the Commons with Bram back at his station, not in a doorway (intro-sequence spec "Bram at his station")', async () => {
  const g = makeGame(['rounds_commons_changes']);
  fire(g, 'rounds:progress');
  await advance(g, 1);
  assert.equal(g.host.flags['commons_changed_1'], true);
  assert.ok(g.log.includes('to cook anchor:cook_stand') && g.log.includes('npc npcAnim cook idle instant'));
  assert.ok(!g.log.some((e) => e.includes('priya_exit')));
  noWarnings(g);
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

test('in-world-audio "No radio outside the kitchen": every radio step plays at the kitchen radio, and the old radio spots are gone', () => {
  for (const d of byId.values()) {
    if (d.id.startsWith('test_') || d.id.endsWith('_test')) continue; // debug-only scenes
    walk(d.steps, (st) => {
      if (st['do'] === 'radio' && st['track']) assert.equal(st['at'], 'anchor:radio', `${d.id} starts the radio away from the kitchen`);
    });
  }
  for (const a of ['r05_radio', 'hydro_radio', 'dive_radio']) assert.equal(anchors.has(a), false, a);
  assert.equal(byId.has('ruined_radio_off'), false);
  assert.equal(byId.has('dive_radio'), false);
});

// ------------------------------------------------------------------------------- dock checkpoint (free play)

/** The `jayArmed` hook main.ts registers, with Jay's weapons faked. */
function dockGame(armed: boolean): Game {
  const g = makeGame(['dock_arch', 'dock_arch_cooldown']);
  g.m.registerHook('jayArmed', ({ flags }) => {
    flags['jay_armed'] = armed;
  });
  g.host.flags['introSeen'] = true;
  return g;
}
const scans = (g: Game): number => count(g, 'event detector:scan');
const guardLines = (g: Game): number => g.log.filter((e) => /^say guard_arch_0\d$/.test(e)).length;

test('dock arch, free play: Jay walks through armed, the arch alarms and the seated guard looks at Jay and reacts', async () => {
  const g = dockGame(true);
  fire(g, 'trigger:dock_arch');
  await advance(g, 2);
  assert.equal(scans(g), 1);
  assert.equal(count(g, 'sfx archAlarm'), 1);
  assert.equal(said(g, 'guard_arch_01'), 1);
  const lookAtPlayer = g.log.indexOf('npc npcLookAt dock_guard player');
  const speakIdx = g.log.indexOf('say guard_arch_01');
  const lookClear = g.log.indexOf('npc npcLookAt dock_guard none');
  assert.ok(lookAtPlayer >= 0 && lookAtPlayer < speakIdx, 'guard looks toward Jay before speaking');
  assert.ok(lookClear > speakIdx, 'guard returns gaze to desk after speaking');
  assert.ok(!g.log.some((e) => e.startsWith('npc npcMoveTo dock_guard') || e.startsWith('npc npcAnim dock_guard')), 'guard stays seated at his desk');
  noWarnings(g);
});

test('dock arch, free play: Jay walks through unarmed, the arch passes and the guard says nothing', async () => {
  const g = dockGame(false);
  fire(g, 'trigger:dock_arch');
  await advance(g, 2);
  assert.equal(count(g, 'sfx archPass'), 1);
  assert.equal(count(g, 'sfx archAlarm'), 0);
  assert.equal(guardLines(g), 0);
  assert.ok(!g.log.some((e) => e.includes('dock_guard')), 'guard stays on his desk routine without reacting');
});

test('dock arch, free play: back and forth within 20 s alarms twice, the guard speaks once, then again after the cooldown', async () => {
  const g = dockGame(true);
  fire(g, 'trigger:dock_arch');
  await advance(g, 3);
  fire(g, 'trigger:dock_arch');
  await advance(g, 3);
  assert.equal(count(g, 'sfx archAlarm'), 2, 'the arch alarms on every pass');
  assert.equal(guardLines(g), 1, 'the guard speaks only the first time');
  assert.equal(count(g, 'npc npcLookAt dock_guard player'), 1, 'guard looks only when reacting');
  await advance(g, 20);
  fire(g, 'trigger:dock_arch');
  await advance(g, 3);
  assert.equal(count(g, 'sfx archAlarm'), 3);
  assert.deepEqual(g.log.filter((e) => /^say guard_arch_0\d$/.test(e)), ['say guard_arch_01', 'say guard_arch_02'], 'a different line the next time');
  assert.equal(count(g, 'npc npcLookAt dock_guard player'), 2);
  assert.equal(count(g, 'npc npcLookAt dock_guard none'), 2);
  assert.ok(!g.log.some((e) => e.startsWith('npc npcMoveTo dock_guard') || e.startsWith('npc npcAnim dock_guard')), 'guard remains seated across repeated alarms');
});

test('dock arch, free play: seated guard actor keeps sit_typing_cctv and turns gaze toward Jay during his spoken response', async () => {
  const THREE = await import('three');
  const { loadSlice01 } = await import('../world/headlessSlice.ts');
  const { NpcDirector } = await import('../ai/npcs.ts');
  const { ctx } = await import('../ai/enemyTestKit.ts');

  const { level, events } = loadSlice01();
  const jayFeet = new THREE.Vector3(8.6, 0, 1.25);
  const jayHead = new THREE.Vector3(8.6, 1.62, 1.25);
  const npcs = new NpcDirector({
    ctx: { ...ctx(), colliders: level.collision },
    nav: level.navGraph(),
    colliders: level.collision,
    player: () => ({ feet: jayFeet, head: jayHead }),
    emit: (name, payload) => events.emit(name as never, payload as never),
    walk: (id) => level.walk(id) ?? null,
    setPropTransform: (id, pos, yaw) => level.setPropTransform(id, pos, yaw),
    setPropVisible: (id, visible) => level.setPropVisible(id, visible),
    propState: (id) => level.propState(id),
  });
  npcs.setResolver((ref) => {
    if (typeof ref === 'string' && ref.startsWith('anchor:')) {
      const a = level.anchor(ref.slice(7));
      return a ? { pos: { x: a.pos.x, y: a.pos.y, z: a.pos.z }, yaw: a.yaw } : null;
    }
    if (ref === 'player') return { pos: { x: jayHead.x, y: jayHead.y, z: jayHead.z } };
    return null;
  });
  npcs.spawnFromLevel(level.npcSpawns().filter((n) => n.id === 'dock_guard'));
  void npcs.command('npcTask', { npc: 'dock_guard', task: 'return_to_desk', instant: true });
  const guard = npcs.actor('dock_guard')!;
  const seatPos = guard.position.clone();
  const cam = new THREE.Vector3(8.6, 1.62, 1.25);

  const g = dockGame(true);
  let speaking = false;
  let resolveLine: () => void = () => undefined;
  g.host.say = (line) => {
    g.log.push(`say ${line}`);
    speaking = true;
    return { done: new Promise<void>((r) => { resolveLine = r; }) };
  };
  g.host.npc = (action, step) => npcs.command(action, step);

  fire(g, 'trigger:dock_arch');
  for (let i = 0; i < 30; i++) {
    g.m.update(1 / 60);
    npcs.update(1 / 60, cam);
  }
  assert.equal(speaking, true, 'guard is speaking his alarm response');
  assert.equal(guard.body.poseName, 'sit_typing_cctv', 'guard remains seated while responding');
  assert.ok(guard.position.distanceTo(seatPos) < 1e-4, 'guard does not stand or leave his chair');
  assert.ok(guard.body.lookTarget !== null && guard.body.lookTarget.distanceTo(jayHead) < 0.05, 'guard looks toward Jay during his spoken response');

  resolveLine();
  await Promise.resolve();
  for (let i = 0; i < 120; i++) {
    g.m.update(1 / 60);
    npcs.update(1 / 60, cam);
    if (i % 4 === 0) await Promise.resolve();
  }
  assert.equal(guard.body.poseName, 'sit_typing_cctv', 'guard stays seated after his response');
  assert.equal(guard.body.lookTarget, null, 'gaze clears back to desk once the reaction settles');
});

test('dock arch, free play: nothing before the intro is over or once the drop has started', async () => {
  const before = makeGame(['dock_arch', 'dock_arch_cooldown']);
  before.m.registerHook('jayArmed', ({ flags }) => void (flags['jay_armed'] = true));
  fire(before, 'trigger:dock_arch');
  await advance(before, 2);
  assert.equal(scans(before), 0);
  const after = dockGame(true);
  after.host.flags['drop_started'] = true;
  fire(after, 'trigger:dock_arch');
  await advance(after, 2);
  assert.equal(scans(after), 0);
});

// ------------------------------------------------------------------------------- dive bay (rebuild-dive-bay)

test('dive bay: the trunk is secured only after Sung and the mechanic finish, with chirp, hatch and vent at the trunk', async () => {
  const g = makeGame(['dive_moment', 'dive_trunk_secure']);
  const states: unknown[] = [];
  g.host.events.on('trunk:state', (p) => void states.push(p));
  g.host.flags['briefingSeen'] = true;
  fire(g, 'trigger:dive_enter');
  await advance(g, 12);
  const at = (e: string): number => g.log.indexOf(e);
  assert.ok(at('say dive_maint_01') >= 0 && at('say dive_maint_01') < at('sfx trunkChirp'), 'no chirp before the last line');
  assert.equal(count(g, 'sfx trunkChirp'), 2);
  assert.ok(at('event trunk:state') > at('sfx trunkChirp') && at('sfx trunkHatch') > at('event trunk:state') && at('sfx trunkVent') > at('sfx trunkHatch'));
  assert.deepEqual(states, [{ state: 'closed' }]);
  assert.equal(g.host.flags['dive_trunk_secured'], true);
  assert.equal(count(g, 'event trunk:beacon'), 2, 'beacon on, then off');
  g.host.events.emit('trunk:secure', undefined);
  await advance(g, 8);
  assert.equal(count(g, 'sfx trunkChirp'), 2, 'never replays');
  noWarnings(g);
});

test('dive bay: before the briefing the trunk stays open', async () => {
  const g = makeGame(['dive_moment', 'dive_trunk_secure']);
  fire(g, 'trigger:dive_enter');
  await advance(g, 12);
  assert.equal(count(g, 'event trunk:state'), 0);
  assert.equal(g.host.flags['dive_trunk_secured'], undefined);
});

test('dive bay: a load after securing shows the hatch closed at once, with no beacon, chirp or hiss', async () => {
  const g = makeGame(['quiet_restore', 'dive_trunk_secure']);
  const states: unknown[] = [];
  g.host.events.on('trunk:state', (p) => void states.push(p));
  g.host.flags['dive_trunk_secured'] = true;
  g.host.events.emit('game:mode', { mode: 'playing', from: 'title' });
  await advance(g, 2);
  assert.deepEqual(states, [{ state: 'closed', instant: true }]);
  assert.equal(count(g, 'sfx trunkChirp') + count(g, 'sfx trunkVent') + count(g, 'event trunk:beacon'), 0);
  const fresh = makeGame(['quiet_restore']);
  const none: unknown[] = [];
  fresh.host.events.on('trunk:state', (p) => void none.push(p));
  fresh.host.events.emit('game:mode', { mode: 'playing', from: 'title' });
  await advance(fresh, 1);
  assert.equal(none.length, 0, 'an unsecured trunk is left open');
});

// adaptive-music: the Lab B score is rendered before the drop needs it, and the Lab B klaxon lands on its beat.
test('the Lab B score loads at the gallery call and again as the drop starts; the drop klaxons wait for the beat', () => {
  const loads = (id: string): number => {
    let n = 0;
    walk(byId.get(id)!.steps, (s) => {
      if (s['do'] === 'score' && s['id'] === 'labB' && s['load'] === true) n++;
    });
    return n;
  };
  assert.equal(loads('rounds_return'), 1);
  assert.equal(loads('drop'), 1);
  const klaxons: Array<Record<string, unknown>> = [];
  walk(byId.get('drop')!.steps, (s) => {
    if (s['do'] === 'sfx' && s['id'] === 'lockdownAlarm') klaxons.push(s);
  });
  assert.ok(klaxons.length > 0);
  assert.ok(klaxons.every((k) => k['beat'] === true));
});

// ------------------------------------------------------------------------- dialogue channels (spatial-dialogue-channels)

test('dive stow: the round completes on use while Sung is still talking, and his line rides its own channel', async () => {
  const g = makeGame(['dive_moment', 'dive_case_taken', 'dive_stow']);
  const channels = new Map<string, string | undefined>();
  // Lines never finish in this test: Sung is mid-conversation the whole time.
  g.host.say = (line, opts) => {
    g.log.push(`say ${line}`);
    channels.set(line, opts?.channel);
    return { done: new Promise(() => undefined) };
  };
  g.host.flags['briefingSeen'] = true;
  fire(g, 'trigger:dive_enter');
  await advance(g, 2);
  assert.equal(said(g, 'dive_sung_01'), 1, 'Sung is talking');
  g.host.events.emit('item:given', { id: 'sample_case' });
  fire(g, 'round:dive_case');
  await advance(g, 0.1);
  assert.equal(g.host.flags['round_dive_done'], true, 'the objective does not wait for any line');
  assert.equal(g.host.flags['obj:round_dive'], 'done');
  assert.equal(count(g, 'event round:complete dive'), 1);
  assert.equal(said(g, 'dive_sung_03'), 1, 'Sung still acknowledges it');
  assert.ok(channels.get('dive_sung_01') && channels.get('dive_sung_03'));
  assert.notEqual(channels.get('dive_sung_01'), channels.get('dive_sung_03'), 'the stow is its own conversation');
});

test('dive bay: the trunk secures right after Sung finishes while Hale is still talking elsewhere', async () => {
  const g = makeGame(['admin_hale', 'dive_moment', 'dive_trunk_secure']);
  const base = g.host.say!;
  g.host.say = (line, opts) => (line.startsWith('admin_') ? (g.log.push(`say ${line}`), { done: new Promise(() => undefined) }) : base(line, opts));
  g.host.flags['briefingSeen'] = true;
  fire(g, 'trigger:hale_office');
  await advance(g, 0.5);
  assert.equal(said(g, 'admin_hale_01'), 1);
  fire(g, 'trigger:dive_enter');
  await advance(g, 12);
  assert.equal(g.host.flags['dive_trunk_secured'], true);
  assert.equal(said(g, 'admin_hale_02'), 0, 'Hale is still on his first line');
});
