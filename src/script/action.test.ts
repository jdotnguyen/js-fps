/**
 * The action half (ADR-0014 beats 3-8): first contact, cover me, the armory and Priya at the glass,
 * the biometric door, the tunnel and valve, the climax, the reveal, the title card and the stinger.
 * Every action sequence is checked against the real dialogue, sounds, anchors, doors, rooms,
 * objectives and spawn groups of slice01, and each chain is played headless on a host that
 * dispatches events like the game does (groups, panel tasks, checkpoints and deaths included).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { ControlStack } from '../actors/control.ts';
import { SAMPLE_URLS, SOUND_SPECS } from '../audio/sounds.ts';
import { DialogueLibrary } from '../dialogue/library.ts';
import { isParallel } from './actions.ts';
import type { CameraFeedOptions, SequenceHost } from './host.ts';
import { SequenceManager } from './runtime.ts';
import { validateSequences } from './schema.ts';
import type { Flags, Step } from './types.ts';
import scores from '../data/scores.json' with { type: 'json' };
import { readLevel } from '../data/levels/readLevel.ts';

const json = (rel: string): any => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const dir = new URL('../data/sequences/', import.meta.url);
const files: Record<string, unknown> = {};
for (const f of readdirSync(dir)) if (f.endsWith('.json')) files[f] = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
const defs = validateSequences(files);
const byId = new Map(defs.map((d) => [d.id, d]));
const ACTION_FILES = ['action_contact.json', 'action_security.json', 'action_tunnel.json', 'action_climax.json', 'action_restore.json'];
const actionDefs = ACTION_FILES.flatMap((f) => validateSequences({ [f]: files[f] }));
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
const groupIds = new Set<string>(level.rooms.flatMap((r: any) => (r.spawns ?? []).map((s: any) => s.group)).filter(Boolean));
const objectives = json('../data/objectives.json');
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

test('the action sequences name only things that exist: lines, sounds, anchors, NPCs, doors, rooms, objectives, groups', () => {
  assert.equal(actionDefs.length, 18);
  // `researcher_b_creature`: what grows out of Voss in the drop's kill (infection-kills spec), escapes through Lab B's ceiling vent at the end of the drop (trim-lab-wing-encounters).
  const npcSet = new Set([...npcIds, 'giles', 'okafor', 'r08_thing', 'researcher_b_creature', 'r09_flood_shambler', 'r16_finale_monster']);
  for (const def of actionDefs) {
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
      if (s['do'] === 'doorState' || s['do'] === 'doorPry') assert.ok(doorIds.has(s['id'] as string), `${where} door ${String(s['id'])}`);
      if (s['do'] === 'lightState') assert.ok(roomIds.has(s['room'] as string), `${where} room ${String(s['room'])}`);
      if (['spawnGroup', 'despawnGroup', 'waitGroup'].includes(String(s['do']))) assert.ok(groupIds.has(s['group'] as string), `${where} group ${String(s['group'])}`);
      if (typeof s['npc'] === 'string') assert.ok(npcSet.has(s['npc']), `${where} npc ${s['npc']}`);
      for (const field of ['to', 'target', 'at', 'from', 'lookAt', 'dir']) {
        const v = s[field];
        if (typeof v === 'string' && v.startsWith('anchor:')) assert.ok(anchors.has(v.slice(7)), `${where}.${field} ${v}`);
        if (typeof v === 'string' && v.startsWith('door:')) assert.ok(doorIds.has(v.slice(5)), `${where}.${field} ${v}`);
        if (typeof v === 'string' && v.startsWith('npc:')) assert.ok(npcSet.has(v.slice(4)), `${where}.${field} ${v}`);
      }
      const args = s['args'] as Record<string, unknown> | undefined;
      if (typeof args?.['at'] === 'string') assert.ok(anchors.has((args['at'] as string).slice(7)), `${where} task anchor ${String(args['at'])}`);
    });
    const ev = def.trigger?.event;
    if (ev && /^trigger:/.test(ev) && !ev.startsWith('trigger:fired')) assert.ok(triggerEmits.has(ev), `${def.id}: trigger ${ev} is not emitted by any level trigger`);
  }
});

test('gameplay beats are not skippable and resume after death; the stinger can be skipped', () => {
  for (const id of ['contact', 'cover_me', 'sec_glass', 'medlab_door', 'tunnel_enter', 'valve_turn', 'r11_power_bay']) {
    assert.notEqual(byId.get(id)?.skippable, true, `${id} stays unskippable`);
    assert.equal(byId.get(id)?.resumeFromCheckpoint, true, `${id} resumes from its checkpoint`);
  }
  assert.equal(byId.get('stinger_priya')?.skippable, true, 'stinger_priya');
  assert.notEqual(byId.get('title_card')?.skippable, true);
  for (const id of ['sec_glass', 'title_card', 'stinger_priya']) assert.equal(byId.get(id)?.exclusive, 'rails', id);
});

test('the checkpoint ladder: data checkpoints on room entry plus one sequence checkpoint per finished beat', () => {
  const ids = new Set<string>(level.checkpoints.map((c: any) => c.id));
  for (const id of ['cp_first_contact', 'cp_cover_me', 'cp_security', 'cp_flooded', 'cp_climax']) assert.ok(ids.has(id), id);
  const taken: string[] = [];
  for (const def of actionDefs) walk(def.steps, (s) => s['do'] === 'checkpoint' && taken.push(String(s['id'])));
  assert.deepEqual(taken, ['cp_contact_clear', 'cp_cover_done', 'cp_security_done', 'cp_valve', 'cp_r11_powered', 'cp_r16_arrived']);
});

test('slice01 level numbers: 0 + 1 + 0 enemies (R11 Power Bay has no combat spawns)', () => {
  const spawns = level.rooms.flatMap((r: any) => r.spawns ?? []);
  const total = (g: string): number => spawns.filter((s: any) => s.group === g).reduce((n: number, s: any) => n + (s.count ?? 1), 0);
  for (const g of ['r05_contact', 'r05_trickle', 'r07_playdead', 'r11_climax']) assert.equal(total(g), 0, g);
  assert.equal(total('r06_cover'), 1);
});

// ------------------------------------------------------------------------------- harness

interface Task {
  step: Record<string, unknown>;
  resolve: () => void;
}

function makeGame(only?: string[], opts: { holdMauled?: boolean } = {}) {
  /** `holdMauled`: a mauled kill step stays running until the test ends it (`kills`), so its beats can be played. */
  const kills: Array<{ step: Record<string, unknown>; resolve: () => void }> = [];
  const log: string[] = [];
  const control = new ControlStack();
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  const feeds: CameraFeedOptions[] = [];
  const tasks: Task[] = [];
  const groups = new Map<string, { triggered: boolean; cleared: boolean }>([...groupIds].map((id) => [id, { triggered: false, cleared: false }]));
  const cards: string[] = [];
  let ended = 0;
  const emitRaw = (name: string, payload?: unknown): void => {
    for (const fn of [...(handlers.get(name) ?? [])]) fn(payload);
  };
  const host: SequenceHost = {
    events: {
      on(name, fn) {
        const set = handlers.get(name) ?? new Set();
        handlers.set(name, set);
        set.add(fn);
        return () => set.delete(fn);
      },
      emit(name, payload) {
        log.push(`event ${name}`);
        emitRaw(name, payload);
      },
    },
    flags: {} as Flags,
    resolve: () => ({ x: 0, y: 0, z: 0 }),
    warn: (m) => void log.push(`warn ${m}`),
    pushControl: (over, owner) => control.push(over, owner),
    lookAt: () => undefined,
    clampLook: (at) => void log.push(at ? 'clamp' : 'unclamp'),
    frame: () => undefined,
    walkTo: () => (log.push('player walkTo'), Promise.resolve()),
    setFlashlight: (on) => void log.push(`flashlight ${on ? 'on' : 'off'}`),
    placePlayer: () => void log.push('place'),
    fade: (level) => void log.push(`fade ${level}`),
    cameraShake: () => void log.push('shake'),
    intercom: (id, live) => (log.push(`intercom ${id} ${live ? 'on' : 'off'}`), true),
    projectVoice: (npc, at) => void log.push(`project ${npc} ${at ?? 'off'}`),
    sfx: (id) => void log.push(`sfx ${id}`),
    score: (id, o) => void log.push(`score ${id} ${o.cue ?? (o.stinger ? `stinger ${o.stinger}` : 'load')}`),
    say: (line, opts) => {
      log.push(`say ${line}${opts?.overlap ? ' overlap' : ''}`);
      return { done: Promise.resolve() };
    },
    markLinePlayed: (line) => void log.push(`played ${line}`),
    stopSpeech: () => void log.push('stopSpeech'),
    checkpoint: (id) => void log.push(`checkpoint ${id}`),
    setDoor: (id, state) => (log.push(`door ${id} ${state}`), true),
    pryDoor: (id, open) => (log.push(`pry ${id} ${open}`), true),
    setLight: (room, pattern, tint) => (log.push(`light ${room} ${pattern}${tint ? ` ${tint}` : ''}`), true),
    glass: (id, state) => void log.push(`glass ${id} ${state}`),
    ventState: (id, state, instant) => void log.push(`vent ${id} ${state}${instant ? ' instant' : ''}`),
    water: (room, level, sec) => room === 'R09' && (log.push(`water ${room} ${level} ${sec}`), true),
    light: (id, pattern, tint, power) => (log.push(`namedLight ${id} ${pattern}${tint ? ` ${tint}` : ''}${power !== undefined ? ` power=${power}` : ''}`), true),
    setPower: (state) => void log.push(`power ${state}`),
    cameraFeed: (id, opts) => (feeds.push(opts), void log.push(`feed ${id} ${opts.state}${opts.fullscreen ? ' fullscreen' : ''}`)),
    radio: (track) => void log.push(track ? `radio ${track}` : 'radio stop'),
    gore: (kind) => void log.push(`gore ${kind}`),
    hush: (speakers) => void log.push(speakers ? `hush ${speakers.join(",")}` : "hush off"),
    titleCard: (title) => void cards.push(title),
    endSlice: () => void ended++,
    spawnGroup: (g) => {
      const st = groups.get(g);
      if (!st || st.triggered) return false;
      st.triggered = true;
      log.push(`group ${g}`);
      return true;
    },
    despawnGroup: (g) => (log.push(`despawnGroup ${g}`), groups.has(g)),
    groupCleared: (g) => groups.get(g)?.cleared ?? false,
    // Squad placement steps (unify-checkpoint-restore): everyone counts as in the room.
    squadRegroup: () => [],
    inRoom: () => true,
    squadPlaceIn: () => [],
    squadCatchUpIn: (room, _entry, force) => {
      log.push(`catchUp ${room}${force ? ' force' : ''}`);
      return [];
    },
    npc: (action, step) => {
      log.push(`npc ${action} ${String(step['npc'])}${step['anim'] ? ` ${String(step['anim'])}` : ''}${step['task'] ? ` ${String(step['task'])}` : ''}${step['instant'] ? ' instant' : ''}`);
      if (action === 'npcTask' && step['wait'] !== false) return new Promise<void>((resolve) => tasks.push({ step, resolve }));
      if (opts.holdMauled && action === 'kill' && step['kind'] === 'mauled' && !step['instant']) return new Promise<void>((resolve) => kills.push({ step, resolve }));
      // Otherwise a mauled kill plays its beats in order, as the kill engine does, then ends (overhaul-priya-r08-death D16).
      if (action === 'kill' && step['kind'] === 'mauled' && !step['instant']) {
        return (async () => {
          for (const beat of ['plead', 'noticed', 'impale', 'carry', 'slam', 'throw', 'still']) {
            await Promise.resolve();
            emitRaw(`kill:${beat}`, { npc: step['npc'], beat });
          }
        })();
      }
      return undefined;
    },
  };
  const m = new SequenceManager(host, only ? defs.filter((d) => only.includes(d.id)) : defs);
  const clear = (g: string): void => {
    const st = groups.get(g)!;
    st.triggered = true;
    st.cleared = true;
    host.flags[`group:${g}`] = 'cleared';
    host.events.emit('group:cleared', { group: g });
  };
  /** The squad AI finishes the oldest panel job. */
  const finishTask = (): void => {
    const t = tasks.shift();
    assert.ok(t, 'a panel job is running');
    host.events.emit('squad:taskDone', { id: 'engineer', task: String(t.step['task']), panel: null, progress: 1 });
    t.resolve();
  };
  return { m, host, log, control, feeds, tasks, groups, cards, kills, clear, finishTask, ended: () => ended };
}
type Game = ReturnType<typeof makeGame>;

async function advance(g: Game, seconds: number): Promise<void> {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    g.m.update(1 / 60);
    if (i % 3 === 0) await Promise.resolve();
  }
}
/** What a level trigger does (Level.fire): `trigger:fired`, then the emit name itself. */
function fire(g: Game, emit: string, payload: Record<string, unknown> = {}): void {
  g.host.events.emit('trigger:fired', { id: `t_${emit}`, event: emit });
  g.host.events.emit(emit, { id: `t_${emit}`, ...payload });
}
async function until(g: Game, cond: () => boolean, max = 200): Promise<void> {
  for (let i = 0; i < max * 60 && !cond(); i++) {
    g.m.update(1 / 60);
    if (i % 3 === 0) await Promise.resolve();
  }
  assert.ok(cond(), 'condition not reached');
}
const said = (g: Game, line: string): number => g.log.filter((e) => e === `say ${line}` || e === `say ${line} overlap`).length;
const count = (g: Game, entry: string): number => g.log.filter((e) => e === entry).length;
const at = (g: Game, entry: string): number => g.log.indexOf(entry);
const noWarnings = (g: Game): void => assert.ok(!g.log.some((e) => e.startsWith('warn')), g.log.filter((e) => e.startsWith('warn')).join('\n'));
const setFlags = (g: Game, flags: Record<string, string | number | boolean>): void => void Object.assign(g.host.flags, flags);
function inOrder(g: Game, entries: string[]): void {
  let last = -1;
  for (const e of entries) {
    const i = g.log.findIndex((x, n) => n > last && x === e);
    assert.ok(i > last, `"${e}" comes after ${last >= 0 ? `"${g.log[last]}"` : 'the start'} (log: ${g.log.filter((x) => x.startsWith('say')).join(', ')})`);
    last = i;
  }
}
const lines = (...ids: string[]): string[] => ids.map((i) => `say ${i}`);

// ------------------------------------------------------------------------------- new actions

test('waitFor match and min: waits for the payload, not just the event name', async () => {
  const d = validateSequences({
    'x.json': { id: 'wf', steps: [{ do: 'waitFor', event: 'squad:taskProgress', match: { task: 'power_restore' }, min: { progress: 0.5 } }, { do: 'setFlag', flag: 'went' }] },
  });
  const g = makeGame();
  const m = new SequenceManager(g.host, d);
  m.start('wf');
  const emit = (p: unknown): void => g.host.events.emit('squad:taskProgress', p);
  emit({ task: 'bypass', progress: 0.9 });
  emit({ task: 'power_restore', progress: 0.3 });
  m.update(0.1);
  assert.equal(g.host.flags['went'], undefined);
  emit({ task: 'power_restore', progress: 0.5 });
  m.update(0.1);
  assert.equal(g.host.flags['went'], true);
  assert.throws(() => validateSequences({ 'x.json': { id: 'bad', steps: [{ do: 'waitFor', event: 'a', min: { progress: 'half' } }] } }));
});

test('waitGroup waits for a group (or returns at once if it is cleared), honours its timeout, and skips', async () => {
  const d = validateSequences({ 'x.json': [{ id: 'wg', steps: [{ do: 'waitGroup', group: 'r06_cover', timeout: 5 }, { do: 'setFlag', flag: 'after' }] }] });
  const g = makeGame();
  const m = new SequenceManager(g.host, d);
  m.start('wg');
  m.update(1);
  assert.equal(g.host.flags['after'], undefined);
  g.clear('r06_cover');
  m.update(0.1);
  assert.equal(g.host.flags['after'], true);
  // Already cleared (restored from a save): no wait.
  const g2 = makeGame();
  g2.host.flags['group:r06_cover'] = 'cleared';
  new SequenceManager(g2.host, d).start('wg');
  assert.equal(g2.host.flags['after'], true);
  // Timeout.
  const g3 = makeGame();
  const m3 = new SequenceManager(g3.host, d);
  m3.start('wg');
  for (let i = 0; i < 6 * 60; i++) m3.update(1 / 60);
  assert.equal(g3.host.flags['after'], true);
  assert.throws(() => validateSequences({ 'x.json': { id: 'bad', steps: [{ do: 'waitGroup' }] } }));
});

test('gore and titleCard validate, reach the host, and warn (not crash) without one', () => {
  const d = validateSequences({
    'x.json': { id: 'dress', steps: [{ do: 'gore', at: [1, 2, 3], kind: 'splash', dir: 'player', count: 40, size: 1.2 }, { do: 'titleCard', title: 'T', sub: 'S', s: 4 }] },
  });
  const g = makeGame();
  new SequenceManager(g.host, d).start('dress');
  assert.deepEqual(g.log.filter((e) => e === 'gore splash'), ['gore splash']);
  assert.deepEqual(g.cards, ['T']);
  const bare = makeGame();
  delete (bare.host as { gore?: unknown }).gore;
  delete (bare.host as { titleCard?: unknown }).titleCard;
  new SequenceManager(bare.host, d).start('dress');
  assert.equal(bare.log.filter((e) => e.startsWith('warn')).length, 2);
  assert.throws(() => validateSequences({ 'x.json': { id: 'bad', steps: [{ do: 'gore', at: [0, 0, 0], kind: 'gush' }] } }));
  assert.throws(() => validateSequences({ 'x.json': { id: 'bad', steps: [{ do: 'titleCard' }] } }));
});

test('ventState: reaches the host, snaps when skipped or instant, and validates its state', () => {
  const d = validateSequences({
    'x.json': [
      { id: 'burst', skippable: true, steps: [{ do: 'wait', s: 5 }, { do: 'ventState', id: 'r06_vent', state: 'fallen' }] },
      { id: 'tear', steps: [{ do: 'ventState', id: 'labb_vent', state: 'open' }, { do: 'ventState', id: 'labb_vent', state: 'open', instant: true }] },
    ],
  });
  const g = makeGame();
  const m = new SequenceManager(g.host, d);
  m.start('tear');
  assert.deepEqual(g.log.filter((e) => e.startsWith('vent')), ['vent labb_vent open', 'vent labb_vent open instant']);
  m.start('burst');
  assert.equal(m.skip(), true);
  assert.equal(g.log.filter((e) => e.startsWith('vent')).at(-1), 'vent r06_vent fallen instant', 'a skip lands on the state without the fall');
  const bare = makeGame();
  delete (bare.host as { ventState?: unknown }).ventState;
  new SequenceManager(bare.host, d).start('tear');
  assert.ok(bare.log.some((e) => e.startsWith('warn')), 'warns without a host');
  assert.throws(() => validateSequences({ 'x.json': { id: 'bad', steps: [{ do: 'ventState', id: 'v', state: 'broken' }] } }));
});

test('water: a timed rise reaches the host, an unknown room warns, and a skip lands on the final level', () => {
  const d = validateSequences({
    'x.json': [
      { id: 'flood', skippable: true, steps: [{ do: 'water', room: 'R09', level: 0.05, s: 3.5, wait: true }, { do: 'water', room: 'R09', level: 2.2, s: 2 }] },
      { id: 'dry', steps: [{ do: 'water', room: 'R07', level: 1 }] },
    ],
  });
  const g = makeGame();
  const m = new SequenceManager(g.host, d);
  m.start('flood');
  assert.ok(g.log.includes('water R09 0.05 3.5'));
  assert.equal(g.log.includes('water R09 2.2 2'), false, 'the second step waits for the rise');
  assert.equal(m.skip(), true);
  assert.equal(g.log.filter((e) => e.startsWith('water')).at(-1), 'water R09 2.2 0', 'skip snaps to the final level');
  m.start('dry');
  assert.ok(g.log.some((e) => e.startsWith('warn') && /no water in room "R07"/.test(e)));
  assert.throws(() => validateSequences({ 'x.json': { id: 'bad', steps: [{ do: 'water', level: 1 }] } }), /room/);
});

test('power: switches station power, records it for saves, and validates its state', () => {
  const d = validateSequences({ 'x.json': { id: 'blackout', skippable: true, steps: [{ do: 'wait', s: 5 }, { do: 'power', state: 'backup' }] } });
  const g = makeGame();
  const m = new SequenceManager(g.host, d);
  m.start('blackout');
  assert.equal(g.log.includes('power backup'), false);
  assert.equal(m.skip(), true);
  assert.ok(g.log.includes('power backup'), 'a skipped scene still lands on backup power');
  assert.equal(g.host.flags['station_power'], 'backup');
  assert.throws(() => validateSequences({ 'x.json': { id: 'bad', steps: [{ do: 'power', state: 'half' }] } }));
});

test('a restart puts standing water back at the level the checkpoint save recorded', () => {
  const g = makeGame();
  g.host.flags['water:R09'] = 2.2;
  g.host.events.emit('game:restarted', { checkpoint: 'cp_valve' });
  assert.ok(g.log.includes('water R09 2.2 0'));
});

test('R09 never floods: a load past the valve keeps the tunnel at its authored water', () => {
  const g = makeGame();
  g.host.flags['valve_done'] = true;
  g.host.events.emit('game:mode', { mode: 'playing', from: 'title' });
  assert.equal(g.log.some((e) => e.startsWith('water')), false);
  const fresh = makeGame();
  fresh.host.events.emit('game:mode', { mode: 'playing', from: 'title' });
  assert.equal(fresh.log.some((e) => e.startsWith('water')), false, 'before the valve the tunnel keeps its authored water');
});

// ------------------------------------------------------------------------------- beat 3: first contact

test('R05 first contact (trim-lab-wing-encounters): no fight; the creature passes overhead toward R06, then the blackout and cp_contact_clear', async () => {
  const g = makeGame();
  fire(g, 'trigger:r05_enter');
  assert.equal(g.m.isRunning('contact'), false, 'needs the drop first');
  setFlags(g, { drop_done: true });
  fire(g, 'trigger:r05_enter');
  assert.equal(g.m.isRunning('contact'), true);
  assert.equal(g.m.skip(), false, 'not skippable');
  assert.ok(at(g, 'door D_R05_R06 sealed') >= 0, 'the way on stays shut while it passes');
  await until(g, () => !g.m.isRunning('contact'));
  assert.equal(g.log.some((e) => e.startsWith('group ')), false, 'no enemy in R05');
  assert.equal(at(g, 'door D_R04_R05 open'), -1, 'the Lab B door stays sealed');
  for (const l of ['contact_giles_01', 'contact_okafor_01', 'contact_okafor_02', 'contact_okafor_03']) assert.equal(said(g, l), 0, `${l} is not in R05`);
  // The bangs walk along the ducts toward R06.
  const bangs = g.log.filter((e) => e === 'sfx ductBang' || e === 'sfx ductScrape');
  assert.ok(bangs.length >= 5, `${bangs.length} duct sounds`);
  inOrder(g, ['sfx ductBang', 'sfx ductScrape']);
  // station-power spec: the blackout follows the last bang, then the door closes and the checkpoint saves on backup power.
  const lastBang = g.log.lastIndexOf('sfx ductBang');
  assert.ok(lastBang < at(g, 'say blackout_radio_ops_01 overlap'));
  inOrder(g, [...['blackout_radio_ops_01', 'blackout_radio_dock_01', 'blackout_radio_launch_01', 'blackout_radio_ops_02'].map((l) => `say ${l} overlap`), 'say blackout_pa_power_01 overlap', 'sfx powerDown', 'power backup', 'door D_R05_R06 closed', 'checkpoint cp_contact_clear']);
  assert.equal(g.host.flags['contact_done'], true);
  assert.equal(count(g, 'checkpoint cp_contact_clear'), 1);
  assert.equal(g.host.flags['station_power'], 'backup');
  assert.equal(at(g, 'radio tag_fm_01'), -1, 'no radio in the Lab Junction any more');
  assert.equal(g.host.flags['radio_place'], undefined);
  assert.equal(g.control.state.move, 'free');
  noWarnings(g);
  fire(g, 'trigger:r05_enter');
  assert.equal(g.m.isRunning('contact'), false, 'never twice');
});

test('the radio chatter starts within 2 s of the last bang over R05 (station-power spec)', async () => {
  const g = makeGame(['contact']);
  setFlags(g, { drop_done: true });
  fire(g, 'trigger:r05_enter');
  let lastBangAt = -1;
  let chatterAt = -1;
  let t = 0;
  for (let i = 0; i < 60 * 60 && chatterAt < 0; i++) {
    const n = g.log.length;
    await advance(g, 1 / 60);
    t += 1 / 60;
    for (const e of g.log.slice(n)) {
      if (e === 'sfx ductBang' || e === 'sfx ductScrape') lastBangAt = t;
      if (e === 'say blackout_radio_ops_01 overlap') chatterAt = t;
    }
  }
  assert.ok(lastBangAt > 0 && chatterAt > lastBangAt);
  assert.ok(chatterAt - lastBangAt <= 2, `chatter ${(chatterAt - lastBangAt).toFixed(2)} s after the last bang`);
});

test('restarting mid first contact replays the beat from its checkpoint; restarting after its checkpoint does not', async () => {
  const g = makeGame();
  setFlags(g, { drop_done: true });
  fire(g, 'trigger:r05_enter');
  await until(g, () => count(g, 'sfx ductBang') >= 1);
  g.host.events.emit('player:died', {});
  assert.equal(g.m.isRunning('contact'), false);
  g.host.events.emit('game:restarted', { checkpoint: 'cp_first_contact' });
  assert.equal(g.m.isRunning('contact'), true, 'replayed from step 0');
  await until(g, () => !g.m.isRunning('contact'));
  g.host.events.emit('player:died', {});
  g.host.events.emit('game:restarted', { checkpoint: 'cp_contact_clear' });
  assert.equal(g.m.isRunning('contact'), false, 'the beat is done, the checkpoint holds it');
});

// ------------------------------------------------------------------------------- beat 4: cover me

test('R06 cover me: Giles bypasses for 20 s, the escaped creature crawls in and drops, the door opens at the bypass, the legs lesson after it dies', async () => {
  const g = makeGame();
  fire(g, 'trigger:r06_door');
  assert.equal(g.m.isRunning('cover_me'), false, 'needs first contact done');
  setFlags(g, { contact_done: true });
  fire(g, 'trigger:r06_door');
  assert.equal(g.m.isRunning('cover_me'), true);
  assert.equal(g.m.skip(), false);
  await until(g, () => g.tasks.length === 1);
  assert.equal(g.tasks[0]!.step['task'], 'bypass');
  assert.deepEqual(g.tasks[0]!.step['args'], { at: 'anchor:r06_panel', panel: 'D_R06_R07', duration: 20 });
  assert.equal(at(g, 'group r06_cover'), -1, 'heard in the ducts first');
  await until(g, () => at(g, 'group r06_cover') >= 0, 20);
  // trim-lab-wing-encounters: bangs nearer and nearer, a hush, then the grate bursts as it drops; "Legs!" on landing.
  inOrder(g, [...lines('giles_cover_01'), 'sfx ductBang', 'sfx ductScrape', 'score labB dropHush', 'sfx ventCoverBurst', 'vent r06_vent fallen', 'group r06_cover', 'score labB door']);
  await until(g, () => said(g, 'contact_okafor_03') === 1, 5);
  assert.equal(g.host.flags['obj:obj_hold_door'], 'active');
  assert.equal(at(g, 'door D_R06_R07 open'), -1, 'locked until Giles is done');
  g.finishTask();
  await advance(g, 0.2);
  assert.ok(at(g, 'door D_R06_R07 open') >= 0);
  await advance(g, 3);
  g.clear('r06_cover');
  await until(g, () => !g.m.isRunning('cover_me'));
  // The win sets cover_done and takes the checkpoint at once; the talk follows (so stepping into R07 can cut it).
  inOrder(g, ['checkpoint cp_cover_done', 'score labB end']);
  // overhaul-priya-r08-death D14 (2026-11-23 amendment): she hides behind the desk through the fight; her run is the
  // cutscene that opens the R07 scene, so cover_me ends without it and cp_cover_done records her still hidden.
  inOrder(g, ['npc npcMoveTo priya instant', 'npc npcAnim priya priya_crouch instant', 'checkpoint cp_cover_done']);
  assert.equal(said(g, 'cover_okafor_run_01'), 0, 'no run in R06');
  assert.equal(at(g, 'door D_R07_R08 open'), -1, 'the medical bay door stays shut');
  // overhaul-priya-r08-death decision 22: Giles is not infected; no arm beat in R06.
  for (const id of ['cover_giles_03', 'cover_okafor_01', 'cover_giles_04']) assert.equal(said(g, id), 0, id);
  assert.equal(at(g, 'npc npcAnim giles flex_hand'), -1);
  assert.equal(g.host.flags['giles.infectionStage'], undefined);
  assert.equal(g.host.flags['cover_done'], true);
  assert.equal(g.host.flags['obj:obj_hold_door'], 'done');
  noWarnings(g);
});

test('cover me survives the last enemy dying before the bypass finishes', async () => {
  const g = makeGame(['cover_me']);
  setFlags(g, { contact_done: true });
  fire(g, 'trigger:r06_door');
  await until(g, () => g.tasks.length === 1);
  g.clear('r06_cover');
  await advance(g, 2);
  assert.equal(g.m.isRunning('cover_me'), true, 'still waiting for the panel');
  g.finishTask();
  await until(g, () => !g.m.isRunning('cover_me'));
  assert.equal(g.host.flags['cover_done'], true);
});

// ------------------------------------------------------------------------------- beat 5: security, armory, Priya

const COVER_DONE = { drop_done: true, contact_done: true, cover_done: true };

/** Into the security office after the cover fight: the R07 scene starts (overhaul-priya-r08-death D23). */
function toScene(g: Game): void {
  setFlags(g, COVER_DONE);
  fire(g, 'trigger:r07_enter');
}

/** Through the rescue to the armory bypass, finished. */
async function toArmoryDone(g: Game): Promise<void> {
  toScene(g);
  await until(g, () => g.tasks.length === 1, 120);
  assert.equal(g.tasks[0]!.step['task'], 'bypass_short');
  g.finishTask();
}

test('R07: entering the security office after the cover fight starts the scene: gather, seal, slow free walk, Okafor projected', async () => {
  const g = makeGame();
  fire(g, 'trigger:r07_enter');
  assert.equal(g.m.isRunning('sec_glass'), false, 'needs the cover fight done');
  toScene(g);
  assert.equal(g.m.isRunning('sec_glass'), true);
  // medbay-attack "She runs" / "The door seals behind her" / "Jay sees her go" (D14, 2026-11-23): the scene opens on a
  // cutscene of her run. Jay is held (letterbox bars), the squad is brought in behind him, and the door seals right after her.
  await advance(g, 0.1);
  assert.equal(g.control.state.move, 'locked', 'on rails: the bars show');
  assert.equal(g.control.state.interact, false);
  await until(g, () => at(g, 'score medbay enter') >= 0);
  inOrder(g, [
    'npc npcMoveTo priya instant', 'npc npcAnim priya priya_crouch instant', 'door D_R07_R08 sealed', 'catchUp R07',
    'door D_R07_R08 open', 'say cover_priya_run_02 overlap', 'npc npcAnim priya clip:priya_stumble', 'say cover_okafor_run_01 overlap', 'door D_R07_R08 sealed',
    'project okafor 3.5', 'score medbay enter',
  ]);
  // priya-door-rescue: she shouts "Don't shoot!" as she bolts, Okafor calls after her as she reaches the door, and the run
  // ends just inside it, facing it; she no longer runs to the beds and crouches, and nobody walks to the window.
  assert.ok(g.log.includes('npc npcMoveTo priya'), 'she runs');
  assert.equal(count(g, 'npc npcAnim priya priya_crouch'), 0, 'no crouch by the beds after the run');
  // D41: while the bars are up and Jay has walked in after her, the squad is put just behind him and the bulkhead seals,
  // so neither squadmate can be left on the R06 side of it.
  inOrder(g, ['catchUp R07', 'catchUp R07 force', 'door D_R06_R07 sealed', 'project okafor 3.5']);
  assert.equal(count(g, 'door D_R06_R07 sealed'), 1, 'sealed once, during the bars');
  assert.ok(!/Priya/.test(library.line('cover_okafor_run_01').text), 'the call does not use her name');
  assert.equal(said(g, 'cover_priya_run_02'), 1, 'she shouts as she runs');
  assert.equal(said(g, 'cover_priya_run_01'), 0, 'the shout replaces the sob');
  assert.equal(g.control.state.move, 'slow');
  assert.equal(g.control.state.look, 'free');
  assert.equal(g.control.state.weapons, true, 'medbay-attack "Weapons with the bars" (D34): the glass is armoured');
  assert.equal(g.control.state.interact, true, 'the bang prompt is offered from the start');
  assert.equal(g.m.skip(), false, 'Priya cannot be skipped');
  assert.equal(g.log.some((e) => e.includes('r07_playdead')), false, 'no play-dead ambush (trim-lab-wing-encounters)');
});

test('medbay-attack "Shooting the glass" (D34): a round on the glass brings the stare of the creature forward', async () => {
  const g = makeGame();
  toScene(g);
  await until(g, () => g.control.state.move === 'slow');
  g.host.events.emit('weapon:glass', { weapon: 'pistol', x: 1, y: 1.5, z: 45.7 });
  await advance(g, 0.2);
  assert.equal(count(g, 'event kill:notice'), 0, 'nothing to notice before the creature is in');
  g.host.flags['r08_thing_in'] = true;
  g.host.events.emit('weapon:glass', { weapon: 'pistol', x: 1, y: 1.5, z: 45.7 });
  await advance(g, 0.2);
  assert.equal(count(g, 'event kill:notice'), 1);
});

test('R07 straight after the fight: stepping in ends the R06 talk at once and the run cutscene starts (D14, 2026-11-23)', async () => {
  const g = makeGame(['cover_me', 'sec_glass']);
  setFlags(g, { drop_done: true, contact_done: true });
  fire(g, 'trigger:r06_door');
  await until(g, () => g.tasks.length === 1);
  g.finishTask();
  g.clear('r06_cover');
  await until(g, () => g.host.flags['cover_done'] === true);
  assert.ok(at(g, 'checkpoint cp_cover_done') >= 0, 'the checkpoint comes with the win, before the talk');
  fire(g, 'trigger:r07_enter');
  await advance(g, 0.1);
  assert.equal(g.m.isRunning('cover_me'), false, 'the R06 aftermath is stopped');
  assert.equal(g.m.isRunning('sec_glass'), true);
  assert.ok(at(g, 'stopSpeech') >= 0, 'every line still playing is cut');
  await advance(g, 3);
});

test('playerWalkTo with distance: a few steps from where Jay stands toward the target, never past it', async () => {
  const g = makeGame();
  const goals: Array<{ x: number; z: number }> = [];
  g.host.resolve = (ref) => (ref === 'player' ? { x: 0, y: 0, z: 39 } : { x: 4, y: 0, z: 45 });
  g.host.walkTo = (at) => (goals.push({ x: at.x, z: at.z }), Promise.resolve());
  const d = validateSequences({ 'x.json': { id: 'w', steps: [{ do: 'playerWalkTo', to: 'anchor:r07_medbay_door', distance: 2.8, wait: true }, { do: 'playerWalkTo', to: 'anchor:r07_medbay_door', distance: 20 }] } });
  const m = new SequenceManager(g.host, d);
  m.start('w');
  for (let i = 0; i < 6; i++) {
    m.update(1 / 60);
    await Promise.resolve();
  }
  assert.equal(goals.length, 2);
  assert.ok(Math.abs(Math.hypot(goals[0]!.x, goals[0]!.z - 39) - 2.8) < 1e-6, 'walks 2.8 m');
  assert.ok(goals[0]!.x > 0 && goals[0]!.z > 39, 'toward the door');
  assert.deepEqual(goals[1], { x: 4, z: 45 }, 'a distance past the target stops at it');
  const sec = actionDefs.find((s) => s.id === 'sec_glass')!;
  let follow: Record<string, unknown> | null = null;
  walk(sec.steps, (st) => void (st['do'] === 'playerWalkTo' && st['distance'] !== undefined && (follow = st)));
  assert.ok(follow && (follow['distance'] as number) >= 2.4 && (follow['distance'] as number) <= 3.2, 'Jay takes 3-4 steps after her');
});

test('medbay-attack rescue: denied on arrival, Giles reads the order and opens the intercom, triage, the tray, "Sit.", then the armory', async () => {
  const g = makeGame(undefined, { holdMauled: true });
  await toArmoryDone(g);
  await until(g, () => g.kills.length === 1, 120);
  // Denied on arrival / Giles reads the order / Before and after the switch.
  inOrder(g, [
    ...lines('sec_priya_10', 'sec_okafor_10', 'sec_priya_11'),
    'say sec_okafor_11 overlap',
    'event door:denied',
    ...lines('sec_priya_12', 'sec_giles_10', 'sec_giles_11'),
    'intercom medbay on',
    ...lines('sec_priya_13'),
    'say sec_okafor_12 overlap',
    // Triage.
    'score medbay triage',
    ...lines('sec_okafor_13', 'sec_okafor_14', 'sec_priya_14', 'sec_okafor_15'),
    // The surgery and the tray (the music cuts to the monitor).
    ...lines('sec_priya_15', 'sec_priya_16'),
    'sfx surgery_tray_fall',
    'score medbay hush',
    ...lines('sec_priya_17'),
    // Her own words back.
    ...lines('sec_okafor_16', 'sec_okafor_17', 'sec_priya_18'),
    // The armory opens before the creature comes out.
    'door D_R07_R07a open',
    'sfx surgery_latch',
    'npc spawn r08_thing',
    'score medbay emerge',
    'door D_R08_R08b open',
  ]);
  assert.ok(at(g, 'npc npcMoveTo priya') >= 0 && g.log.includes('npc npcAnim priya priya_sit_wall'), 'she sits against the wall');
  assert.ok(g.log.indexOf('intercom medbay on') > g.log.indexOf('event door:denied'), 'the intercom after the first refusal');
  // She is alive and talking first: at least eight Priya/Okafor lines before the surgery door opens.
  const opened = at(g, 'door D_R08_R08b open');
  const talk = g.log.slice(0, opened).filter((e) => /^say sec_(priya|okafor)_/.test(e)).length;
  assert.ok(talk >= 8, `${talk} lines between them before the door`);
  assert.equal(g.host.flags['armory_open'], true);
  assert.equal(g.host.flags['obj:obj_armory'], 'active', 'the armory objective comes with the open door');
  // The coffee, over the intercom, while Giles works the panel.
  for (const id of ['sec_priya_19', 'sec_okafor_18', 'sec_priya_20', 'sec_okafor_19', 'sec_giles_12', 'sec_giles_13']) assert.equal(said(g, id), 1, id);
  // The surgery is heard before the creature is seen.
  for (const s of ['sfx drip', 'sfx surgery_rattle', 'sfx surgery_breath', 'sfx surgery_scrape']) assert.ok(at(g, s) >= 0 && at(g, s) < at(g, 'npc spawn r08_thing'), s);
});

test('medbay-attack "She turns around" (D35): hands up, a slow turn to the surgery door, a freeze, a quicker turn back as Okafor asks on', async () => {
  const g = makeGame(undefined, { holdMauled: true });
  await toArmoryDone(g);
  inOrder(g, [
    'say sec_okafor_13',
    'npc npcAnim priya priya_hands_show',
    'npc npcLookAt priya',
    'npc npcLookAt priya',
    'npc npcAnim priya priya_hands_back_freeze',
    'npc npcAnim priya priya_hands_turn_back',
    'npc npcLookAt priya',
    'say sec_okafor_14',
    'npc npcAnim priya idle',
    'say sec_priya_14',
  ]);
  const sec = actionDefs.find((d) => d.id === 'sec_glass')!;
  const turns: Array<Record<string, unknown>> = [];
  walk(sec.steps, (st) => void (st['do'] === 'npcLookAt' && st['npc'] === 'priya' && st['turn'] === true && turns.push(st)));
  assert.equal(turns.length, 4, 'away and back, then the snap to the surgery door at the tray and back to Okafor');
  assert.equal(turns[0]!['target'], 'anchor:priya_turn_away', 'her back to the glass, facing the surgery door');
  assert.ok((turns[0]!['turnRate'] as number) < (turns[1]!['turnRate'] as number), 'slow away, quicker back');
  assert.ok((turns[0]!['turnRate'] as number) < 3.2, 'slower than the default turn');
  assert.equal(turns[1]!['target'], 'npc:okafor');
  // After the tray falls she whips round to the surgery door, then looks back to Okafor at "Look at me."
  assert.equal(turns[2]!['target'], 'anchor:r08_lurk');
  assert.ok((turns[2]!['turnRate'] as number) > 3.2, 'a panicked, fast snap');
  assert.equal(turns[3]!['target'], 'npc:okafor');
  inOrder(g, ['npc npcAnim priya priya_flinch', 'npc npcLookAt priya', 'say sec_priya_17', 'say sec_okafor_16']);
});

test('medbay-attack "The rescue is tight" (D36): from her first line to the armory opening in at most 80 s, lines timed by their clips', async () => {
  const g = makeGame(undefined, { holdMauled: true });
  // The clips are 64 kbps CBR mp3s: their length is their size.
  const clipS = (line: string): number => {
    try {
      return (statSync(new URL(`../../public/assets/vo/${line}.mp3`, import.meta.url)).size * 8) / 64000;
    } catch {
      return 1;
    }
  };
  let t = 0;
  const pending: Array<{ end: number; res: () => void }> = [];
  let first = -1;
  g.host.say = (line, opts) => {
    g.log.push(`say ${line}${opts?.overlap ? ' overlap' : ''}`);
    if (line === 'sec_priya_10' && first < 0) first = t;
    return { done: new Promise<void>((res) => pending.push({ end: t + clipS(line) + 0.15, res })) };
  };
  toScene(g);
  for (let i = 0; i < 200 * 60 && g.tasks.length === 0; i++) {
    t += 1 / 60;
    g.m.update(1 / 60);
    for (let k = pending.length - 1; k >= 0; k--) if (pending[k]!.end <= t) pending.splice(k, 1)[0]!.res();
    if (i % 3 === 0) await Promise.resolve();
  }
  assert.equal(g.tasks.length, 1, 'Giles starts the armory bypass');
  // The bypass itself takes its 8 s (squadBrain bypass_short) before the door opens.
  const span = t - first + 8;
  assert.ok(first >= 0 && span <= 80, `first line to the armory opening: ${span.toFixed(1)} s`);
});

test('medbay-attack "Jay is in the armory": the creature waits for him to step out, for at most 10 s', async () => {
  const g = makeGame(undefined, { holdMauled: true });
  let inArmory = false;
  g.host.inRoom = (who, room) => !(who === 'player' && room === 'R07' && inArmory);
  await toArmoryDone(g);
  inArmory = true;
  await until(g, () => said(g, 'sec_okafor_19') === 1, 60);
  await advance(g, 3);
  assert.equal(at(g, 'npc spawn r08_thing'), -1, 'still waiting while he is in the armory');
  inArmory = false;
  await advance(g, 3);
  assert.ok(at(g, 'npc spawn r08_thing') >= 0, 'he stepped out: it comes');
  // And never longer than 10 s.
  const h = makeGame(undefined, { holdMauled: true });
  let away = false;
  h.host.inRoom = (who, room) => !(who === 'player' && room === 'R07' && away);
  await toArmoryDone(h);
  away = true;
  await until(h, () => said(h, 'sec_okafor_19') === 1, 60);
  await advance(h, 12.5);
  assert.ok(at(h, 'npc spawn r08_thing') >= 0, 'after 10 s it comes anyway');
});

/** Into the R08 attack with the kill held open, at its plead beat. */
async function toPlead(): Promise<Game> {
  const g = makeGame(undefined, { holdMauled: true });
  await toArmoryDone(g);
  await until(g, () => g.kills.length === 1, 120);
  g.host.events.emit('kill:plead', { npc: 'priya', beat: 'plead' });
  return g;
}

test('medbay-attack: the kill step is the creature on Priya at the centre pane, with the new marks', async () => {
  const g = await toPlead();
  const k = g.kills[0]!.step;
  assert.deepEqual([k['npc'], k['kind'], k['attacker'], k['glass']], ['priya', 'mauled', 'r08_thing', 'anchor:medbay_c_glass']);
  const marks = k['marks'] as Record<string, string>;
  for (const m of ['along', 'cower', 'impale', 'cart', 'throwAt', 'rest', 'surgery']) assert.ok(marks[m]?.startsWith('anchor:'), m);
});

test('medbay-attack: the attack lines ride the kill beats; the prompt goes with the impale; the music follows', async () => {
  const g = await toPlead();
  await advance(g, 2);
  // Okafor tries the door again and the lockdown refuses him; Giles cannot override it.
  inOrder(g, [...lines('sec_priya_01').map((l) => `${l} overlap`), 'say sec_priya_05 overlap', 'say sec_okafor_02 overlap', 'event door:denied', 'say sec_giles_06 overlap']);
  g.host.events.emit('kill:noticed', { npc: 'priya', attacker: 'r08_thing' });
  await advance(g, 2);
  assert.ok(g.log.includes('say sec_priya_04 overlap'));
  assert.ok(g.log.includes('score medbay walk'), 'the walk music after the stare');
  for (const beat of ['impale', 'carry', 'slam', 'throw', 'still']) {
    g.host.events.emit(`kill:${beat}`, { npc: 'priya', beat });
    await advance(g, 2);
    if (beat === 'impale') assert.equal(g.control.state.interact, false, 'the prompt goes with the impale');
  }
  inOrder(g, ['say sec_okafor_03 overlap', 'say sec_jay_01 overlap', 'say sec_okafor_08 overlap', 'say sec_giles_07 overlap', 'say sec_jay_02 overlap']);
  for (const id of ['sec_okafor_03', 'sec_jay_01', 'sec_okafor_08', 'sec_giles_07', 'sec_jay_02']) assert.equal(said(g, id), 1, id);
  // Okafor (medic), Giles (engineer), Jay (player) and Priya (nurse) are all heard.
  const speakers = new Set(g.log.filter((e) => e.startsWith('say ')).map((e) => library.line(e.split(' ')[1]!).speaker));
  for (const sp of ['medic', 'engineer', 'player', 'nurse']) assert.ok(speakers.has(sp), sp);
});

test('medbay-attack aftermath: silence, the intercom off, the notebook, "I told her she was fine.", a pause, "Med lab\'s through there."', async () => {
  const g = await toPlead();
  await advance(g, 2);
  for (const beat of ['impale', 'carry', 'slam', 'throw', 'still']) {
    g.host.events.emit(`kill:${beat}`, { npc: 'priya', beat });
    await advance(g, 1);
  }
  // D39: while it walks back to the surgery, Okafor goes to the glass, puts his hand on it and speaks to her.
  await advance(g, 5);
  inOrder(g, ['event kill:still', 'say sec_jay_02 overlap', 'npc npcMoveTo okafor', 'say sec_okafor_22']);
  const n = g.log.length;
  g.kills[0]!.resolve();
  await advance(g, 1);
  const after = (): string[] => g.log.slice(n);
  assert.ok(after().includes('door D_R08_R08b closed') && after().includes('npc despawn r08_thing'));
  assert.ok(!after().some((e) => e.startsWith('say ') && !['say sec_okafor_23', 'say sec_okafor_20', 'say sec_okafor_21'].includes(e)), 'after his exhale: only Okafor, starting with "Gotta keep moving." as he sets off');
  await until(g, () => !g.m.isRunning('sec_glass'), 60);
  inOrder(g, ['say sec_okafor_22', 'score medbay aftermath_out', 'say sec_okafor_23', 'say sec_okafor_20', 'intercom medbay off', 'score medbay end', 'npc npcAnim okafor okafor_notebook', 'say sec_okafor_21', 'door D_R06_R07 open', 'checkpoint cp_security_done']);
  const sayLines = after().filter((e) => e.startsWith('say '));
  assert.deepEqual(sayLines, ['say sec_okafor_23', 'say sec_okafor_20', 'say sec_okafor_21'], 'Priya and Okafor only: no other line in the aftermath');
  assert.equal(g.host.flags['sec_done'], true);
  assert.equal(g.host.flags['obj:obj_medlab'], 'active');
  assert.equal(g.control.state.move, 'free');
  assert.equal(g.control.state.weapons, true);
  assert.ok(g.log.includes('project okafor off'), 'the projection ends with the scene');
  // Giles says nothing in the aftermath and has no infection beats (decision 22).
  for (const id of ['sec_okafor_04', 'sec_okafor_05', 'sec_giles_03', 'sec_giles_05', 'sec_okafor_07', 'giles_cut_01', 'sec_okafor_06', 'sec_giles_04']) assert.equal(said(g, id), 0, id);
  assert.equal(at(g, 'npc npcAnim giles rub_forearm'), -1);
  assert.equal(g.host.flags['giles.infectionStage'], undefined);
  assert.equal(g.host.flags['giles.bandaged'], undefined);
  noWarnings(g);
});

test('medbay-attack: the vitals monitor beeps every 0.8 s on the score grid all through the scene ("The monitor does not race")', async () => {
  const g = makeGame(undefined, { holdMauled: true });
  toScene(g);
  // The run cutscene comes first; the monitor starts with the scene's score.
  await until(g, () => at(g, 'score medbay enter') >= 0);
  const before = g.log.filter((e) => e === 'sfx monitorBeep').length;
  await advance(g, 8.05);
  const beeps = g.log.filter((e) => e === 'sfx monitorBeep').length - before;
  assert.ok(beeps >= 10 && beeps <= 11, `${beeps} beeps in 8 s`);
  const sec = actionDefs.find((d) => d.id === 'sec_glass')!;
  let beat: Record<string, unknown> | null = null;
  walk(sec.steps, (s) => void (s['do'] === 'sfx' && s['id'] === 'monitorBeep' && (beat = s)));
  assert.equal(beat!['beat'], true, 'on the score grid');
  assert.equal(scores.medbay.beat, 0.8);
});

test('dying during the Priya scene replays it from the start; the control stack always comes back', async () => {
  const g = makeGame();
  toScene(g);
  await advance(g, 7);
  assert.equal(g.control.state.move, 'slow');
  g.host.events.emit('player:died', {});
  assert.equal(g.control.state.move, 'free', 'control released on death');
  g.host.events.emit('game:restarted', { checkpoint: 'cp_security' });
  assert.equal(g.m.isRunning('sec_glass'), true);
  for (let i = 0; i < 200 * 60 && g.m.isRunning('sec_glass'); i++) {
    g.m.update(1 / 60);
    if (i % 3 === 0) await Promise.resolve();
    if (g.tasks.length) g.finishTask();
  }
  assert.equal(g.host.flags['sec_done'], true);
  assert.equal(g.control.state.move, 'free');
});

// ------------------------------------------------------------------------------- beat 6: biometric door, tunnel, valve

test('the med-lab door: Okafor badges in (5 s biometric task) after the Priya scene, the tunnel then starts the valve hunt at tell stage 3', async () => {
  const g = makeGame();
  g.host.events.emit('door:denied', { id: 'D_R07_R09', reason: 'x' });
  setFlags(g, { ...COVER_DONE, sec_done: true, glass_near: true, armory_open: true });
  g.m.cancelAll();
  g.host.events.emit('door:denied', { id: 'D_R07_R09', reason: 'x' });
  assert.equal(g.m.isRunning('medlab_door'), true);
  await until(g, () => g.tasks.length === 1);
  assert.equal(g.tasks[0]!.step['task'], 'biometric');
  inOrder(g, [...lines('tunnel_okafor_01')]);
  assert.equal(at(g, 'door D_R07_R09 open'), -1);
  g.finishTask();
  await until(g, () => !g.m.isRunning('medlab_door'));
  assert.ok(at(g, 'door D_R07_R09 open') >= 0);
  assert.equal(g.host.flags['medlab_open'], true);
  g.host.events.emit('door:denied', { id: 'D_R07_R09', reason: 'x' });
  assert.equal(g.m.isRunning('medlab_door'), false, 'only once');
  // Into the water.
  fire(g, 'trigger:r09_enter');
  assert.equal(g.m.isRunning('tunnel_enter'), true);
  await until(g, () => !g.m.isRunning('tunnel_enter'));
  assert.equal(g.groups.get('r09_tunnel')!.triggered, true);
  inOrder(g, lines('okafor_quiet_01', 'tunnel_giles_01'));
  assert.equal(g.host.flags['giles.infectionStage'], undefined);
  assert.equal(g.host.flags['obj:obj_valve'], 'active');
  noWarnings(g);
});

test('the valve: the flood plays out, the objective moves on, cp_valve is taken', async () => {
  const g = makeGame();
  setFlags(g, { ...COVER_DONE, sec_done: true, medlab_open: true, tunnel_started: true, 'giles.infectionStage': 3 });
  fire(g, 'valve:r10_main');
  assert.equal(g.m.isRunning('valve_turn'), true);
  await until(g, () => !g.m.isRunning('valve_turn'));
  inOrder(g, [...lines('flood_okafor_01', 'flood_okafor_02'), 'checkpoint cp_valve', ...lines('flood_giles_02')]);
  // No casual lines after the panic (playtest).
  for (const l of ['valve_giles_01', 'valve_quiet_giles_01', 'valve_quiet_giles_02', 'valve_quiet_okafor_01']) assert.equal(said(g, l), 0, l);
  assert.equal(g.host.flags['valve_done'], true);
  assert.equal(g.host.flags['obj:obj_valve'], 'done');
  assert.equal(g.host.flags['obj:obj_power'], 'active');
  assert.equal(g.control.state.move, 'free', 'controls back after the cutscene');
  fire(g, 'valve:r10_main');
  assert.equal(said(g, 'flood_giles_02'), 1, 'once');
  noWarnings(g);
});

// flooded-tunnel spec (overhaul-flooded-tunnel D9): the flood cutscene.
const FLOOD_END = ['despawnGroup r09_tunnel', 'npc spawn r09_flood_shambler', 'namedLight r10_beacon alarm emergency', 'event flood:klaxon', 'door D_R09_R10 sealed', 'checkpoint cp_valve'];
const VALVE_READY_FLAGS = { ...COVER_DONE, sec_done: true, medlab_open: true, tunnel_started: true, 'giles.infectionStage': 3 };
const valveReady = (g: Game): void => setFlags(g, VALVE_READY_FLAGS);

test('the valve cutscene: on rails at the wheel, the squad placed unseen, beacon, the charge and seal, the pounding, then quiet', async () => {
  const g = makeGame();
  valveReady(g);
  fire(g, 'valve:r10_main');
  assert.equal(g.control.state.move, 'locked', 'on rails with the bars');
  assert.equal(g.m.skippable, false, 'not skippable the first time');
  await until(g, () => !g.m.isRunning('valve_turn'));
  inOrder(g, ['sfx valveTurn', ...FLOOD_END.slice(0, 5), 'checkpoint cp_valve', ...lines('flood_giles_02')]);
  assert.ok(g.log.includes('npc npcMoveTo giles'), 'Giles placed');
  assert.equal(g.log.some((e) => e.startsWith('water')), false, 'R09 does not flood');
  assert.equal(g.control.state.move, 'free', 'controls back at the end');
  assert.equal(g.host.flags['valve_done'], true);
  // Playtest fixes: the door is locked before anything can walk up to it; the alarm blares before the turn; the squad panics
  // during the charge; the camera is released with the controls (not held on the door through the lines).
  // The door stands open from the start (the stairs seen through it), the creature shrieks as it charges, the door slams,
  // it pounds on the door, then the hand. The pump room goes red with three beacons before the turn.
  inOrder(g, ['door D_R09_R10 open', 'npc spawn r09_flood_shambler', 'namedLight r09_charge_light steady', 'sfx creatureScreamFar', 'npc npcAnim r09_flood_shambler scream', 'npc npcMoveTo okafor', 'event squad:aim', 'sfx creatureChargeRage', 'event squad:scripted_fire', ...lines('flood_okafor_01'), 'door D_R09_R10 sealed', 'sfx floodSlamHit', 'sfx floodDoorSlam', 'sfx doorPound']);
  inOrder(g, ['sfx creatureScreamFar', 'npc npcMoveTo giles', 'event squad:aim', 'sfx creatureChargeRage']);
  inOrder(g, ['sfx creatureScreamFar', 'player walkTo', 'flashlight on', 'sfx creatureChargeRage']);
  assert.equal(count(g, 'event squad:scripted_fire'), 2, 'deliberate aimed fire starts during the charge and stops at the seal');
  assert.equal(count(g, 'sfx creatureScreamFar'), 1, 'one scream from far down the hall, before anyone speaks');
  assert.equal(count(g, 'sfx creatureChargeRage'), 1, 'the raging monster roar plays as it charges');
  assert.equal(count(g, 'sfx creatureCharge'), 0, 'the old shriek is not used in the cutscene');
  assert.equal(g.log.includes('event flood:handslap'), false, 'no hand at the porthole: its arms come later');
  assert.equal(g.log.filter((e) => e === 'sfx doorPound').length, 2, 'two rounds of pounding');
  inOrder(g, ['namedLight r10_beacon alarm emergency', 'namedLight r10_beacon_s alarm emergency', 'sfx alarmBlast', 'score labB floodAlarm']);
  // design D13: the score keeps going through the beat and only fades after the last line.
  inOrder(g, ['score labB load', 'score labB floodAlarm', 'score labB floodHold', 'score labB hold', ...lines('flood_giles_02'), 'score labB floodOut']);
  assert.equal(count(g, 'sfx floodStinger'), 0, 'the old 10 s stinger is gone');
  assert.equal(g.log.includes('light R10 alarm emergency'), false, 'the pump room stays well lit');
  for (const l of ['flood_okafor_01', 'flood_okafor_02', 'flood_giles_02']) assert.equal(said(g, l), 1, l);
  assert.equal(said(g, 'flood_giles_01'), 0, 'the wheel line no longer plays: the view is on the door by then');
  assert.equal(said(g, 'valve_giles_01'), 0, 'no casual lines after the panic');
});

// design D13: lines queue one at a time, so the beats are timed off them. Clip lengths from public/assets/vo (ffprobe).
const FLOOD_CLIP_S: Record<string, number> = { flood_okafor_01: 3.22, flood_okafor_02: 1.4, flood_giles_02: 7.51 };
const SPEECH_GAP_S = 0.15;

test('the valve cutscene is timed off its lines: the seal comes on "Seal it now!", the hit on the leaves meeting, nothing said late', async () => {
  const g = makeGame();
  valveReady(g);
  let now = 0;
  let laneFree = 0;
  const times = new Map<string, number>();
  const stamp = (e: string): void => void (times.has(e) || times.set(e, now));
  const pending: Array<{ at: number; resolve: () => void }> = [];
  // A speech lane: a line starts when the one before it ends (plus the gap), and lasts its clip.
  g.host.say = (line) => {
    const start = Math.max(now, laneFree);
    const end = start + (FLOOD_CLIP_S[line] ?? 2);
    laneFree = end + SPEECH_GAP_S;
    times.set(`start ${line}`, start);
    times.set(`end ${line}`, end);
    g.log.push(`say ${line}`);
    return { done: new Promise<void>((resolve) => pending.push({ at: end, resolve })) };
  };
  const setDoor = g.host.setDoor!;
  g.host.setDoor = (id, state) => (stamp(`door ${id} ${state}`), setDoor(id, state));
  const sfx = g.host.sfx!;
  g.host.sfx = (id, at, o) => (stamp(`sfx ${id}`), sfx(id, at, o));
  const score = g.host.score!;
  g.host.score = (id, o) => (o.cue && stamp(`cue ${o.cue}`), score(id, o));
  fire(g, 'valve:r10_main');
  for (let i = 0; i < 60 * 60 && g.m.isRunning('valve_turn'); i++) {
    now += 1 / 60;
    for (const p of pending.filter((q) => q.at <= now)) (pending.splice(pending.indexOf(p), 1), p.resolve());
    g.m.update(1 / 60);
    if (i % 3 === 0) await Promise.resolve();
  }
  assert.equal(g.m.isRunning('valve_turn'), false, 'ends');
  const t = (k: string): number => {
    assert.ok(times.has(k), k);
    return times.get(k)!;
  };
  const sealed = t('door D_R09_R10 sealed');
  const leavesMeet = sealed + 0.9;
  assert.ok(t('end flood_okafor_01') <= t('start flood_okafor_02'), 'Okafor warns, then calls the seal');
  assert.ok(sealed > t('start flood_okafor_02') && sealed < t('end flood_okafor_02'), 'the door starts closing during "Seal it now!"');
  assert.ok(Math.abs(leavesMeet - t('end flood_okafor_02')) < 0.25, 'the leaves meet as the line ends');
  assert.ok(Math.abs(t('sfx floodSlamHit') - sealed) < 1e-6 && Math.abs(t('sfx floodDoorSlam') - sealed) < 1e-6, 'the hit and the slam (both 0.9 s in) fire with the seal');
  for (const [k, v] of times) if (k.startsWith('start ') && k !== 'start flood_giles_02') assert.ok(v < sealed, `${k} starts before the seal`);
  assert.ok(t('start flood_giles_02') > leavesMeet + 3, 'Is it gone? only after the pounding');
  assert.ok(t('cue floodAlarm') < t('cue floodCharge') && t('cue floodCharge') < sealed, 'the music builds into the charge');
  assert.ok(Math.abs(t('cue floodHold') - leavesMeet) < 0.05, 'and turns on the slam');
  assert.ok(t('cue floodOut') >= t('end flood_giles_02') - 1e-6, 'it fades only after the last line');
  assert.ok(t('sfx creatureScreamFar') < t('start flood_okafor_01'), 'the scream comes before anyone speaks');
  assert.ok(t('cue floodCharge') <= t('start flood_okafor_01'), 'and the music builds with it');
});

// flooded-tunnel spec (overhaul-valve-cutscene): the view is freed at the slam, so the pounds and the retreat play with control back.
test('the valve cutscene frees the view at the slam: free, flagged and checkpointed before the first pound', async () => {
  const g = makeGame();
  valveReady(g);
  const seenAtPound: Array<{ move: string; look: string; valveDone: unknown }> = [];
  const sfx = g.host.sfx!;
  g.host.sfx = (id, at, o) => {
    if (id === 'doorPound') seenAtPound.push({ move: g.control.state.move, look: g.control.state.look, valveDone: g.host.flags['valve_done'] });
    return sfx(id, at, o);
  };
  fire(g, 'valve:r10_main');
  await until(g, () => !g.m.isRunning('valve_turn'));
  assert.equal(seenAtPound.length, 2, 'two pounds');
  for (const p of seenAtPound) assert.deepEqual(p, { move: 'free', look: 'free', valveDone: true }, 'free to move and look while it pounds');
  inOrder(g, ['door D_R09_R10 sealed', 'sfx floodSlamHit', 'checkpoint cp_valve', 'sfx doorPound']);
});

test('once watched, skipping the flood cutscene at any point lands on the full end state', async () => {
  for (const at of [0.5, 5, 9, 11, 12.5, 15, 18]) {
    const g = makeGame();
    valveReady(g);
    const seen = new Set(['flood_cutscene']);
    g.host.seen = (id) => seen.has(id);
    fire(g, 'valve:r10_main');
    for (let t = 0; t < at; t += 1 / 60) g.m.update(1 / 60);
    assert.equal(g.m.skip(), true, `skippable at ${at} s`);
    await until(g, () => !g.m.isRunning('valve_turn'));
    for (const e of FLOOD_END) assert.ok(g.log.includes(e), `${e} (skipped at ${at} s)`);
    assert.equal(g.log.some((e) => e.startsWith('water')), false, `no flood (skipped at ${at} s)`);
    assert.equal(g.host.flags['valve_done'], true);
    assert.equal(g.control.state.move, 'free');
  }
});

test('after the valve, every load brings the alarm back: sealed door, beacons, klaxon', () => {
  const g = makeGame();
  g.host.flags['valve_done'] = true;
  g.host.events.emit('game:mode', { mode: 'playing', from: 'title' });
  for (const e of ['door D_R09_R10 sealed', 'namedLight r10_beacon alarm emergency', 'namedLight r10_beacon_n alarm emergency', 'event flood:klaxon']) assert.ok(g.log.includes(e), e);
});

// Playtest: it seems over, then at the R11 bulkhead it bursts back through the R09 door, which shears its arms off.
test('the ambush at the R11 door: only after the valve, once; the elite pries the door open from the middle, it slams on its arms, both forearms cut', async () => {
  const g = makeGame();
  fire(g, 'trigger:r10_ambush');
  assert.equal(g.m.isRunning('r10_ambush'), false, 'needs the valve');
  setFlags(g, { ...VALVE_READY_FLAGS, valve_done: true });
  fire(g, 'trigger:r10_ambush');
  assert.equal(g.m.isRunning('r10_ambush'), true);
  assert.equal(g.control.state.look, 'locked', 'the view is pulled to the door');
  await until(g, () => !g.m.isRunning('r10_ambush'));
  inOrder(g, ['npc spawn r09_flood_shambler', 'npc npcAnim r09_flood_shambler pry_reach', 'sfx ambushSting', 'pry D_R09_R10 0.16', 'npc npcAnim r09_flood_shambler pry_clamp', 'npc npcAnim r09_flood_shambler pry_wrench', 'sfx doorPry', 'pry D_R09_R10 0.5', 'npc npcAnim r09_flood_shambler pry_thrust', 'sfx floodDoorSlam', 'door D_R09_R10 sealed', 'npc npcSever r09_flood_shambler', 'sfx creatureSeverShriek', ...lines('flood_okafor_03')]);
  assert.equal(g.log.includes('door D_R09_R10 open'), false, 'the door is forced, never opened');
  assert.equal(g.control.state.move, 'free', 'controls back');
  assert.equal(g.host.flags['ambush_done'], true);
  fire(g, 'trigger:r10_ambush');
  assert.equal(g.m.isRunning('r10_ambush'), false, 'once');
  assert.equal(g.log.filter((e) => e === 'npc spawn r09_flood_shambler').length, 1, 'not again');
});

// flooded-tunnel spec (overhaul-valve-cutscene): walking into the ambush box cuts the aftermath short and starts the pry on that frame.
test('the ambush cuts the valve aftermath short: speech silenced, the music out, the pry started, nothing lost', async () => {
  const g = makeGame();
  valveReady(g);
  fire(g, 'valve:r10_main');
  // Run to the first pound: the door has sealed, Jay is free and flagged, Giles has not spoken yet.
  for (let i = 0; i < 60 * 60 && count(g, 'sfx doorPound') < 1; i++) {
    g.m.update(1 / 60);
    if (i % 3 === 0) await Promise.resolve();
  }
  assert.equal(g.host.flags['valve_done'], true, 'armed once the door has sealed');
  assert.equal(g.m.isRunning('valve_turn'), true, 'the aftermath is still playing');
  assert.equal(said(g, 'flood_giles_02'), 0);
  fire(g, 'trigger:r10_ambush');
  assert.equal(g.m.isRunning('valve_turn'), false, 'the aftermath is cut');
  assert.equal(g.m.isRunning('r10_ambush'), true, 'the pry starts on the same frame');
  assert.ok(g.log.includes('stopSpeech'), 'every line playing is silenced');
  assert.ok(g.log.includes('score labB floodOut'), 'the music still ends');
  await until(g, () => !g.m.isRunning('r10_ambush'));
  assert.equal(said(g, 'flood_giles_02'), 0, 'Giles never gets to ask');
  assert.equal(g.host.flags['obj:obj_power'], 'active');
  assert.ok(g.log.includes('checkpoint cp_valve'));
  assert.equal(g.control.state.move, 'free');
});

// ------------------------------------------------------------------------------- beat 7: R11 Power Bay

const VALVE_DONE = { ...COVER_DONE, sec_done: true, medlab_open: true, tunnel_started: true, valve_done: true };
const R11_LINES = ['r11_okafor_01', 'r11_jay_01', 'r11_giles_01', 'r11_giles_02', 'r11_giles_03', 'r11_giles_04', 'r11_giles_05', 'r11_giles_06', 'r11_okafor_02', 'r11_giles_07'];

test('R11 Power Bay sequence: cautious whispered entry, Giles diagnoses terminal, 3-phase generator rumble + light cascade, opens D_R13d_R11, no infection arc', async () => {
  const g = makeGame(['r11_power_bay']);
  fire(g, 'trigger:r11_enter');
  assert.equal(g.m.isRunning('r11_power_bay'), false, 'the valve first');
  setFlags(g, VALVE_DONE);
  fire(g, 'trigger:r11_enter');
  assert.equal(g.m.isRunning('r11_power_bay'), true);
  assert.equal(g.control.state.move, 'free', 'player keeps free movement in R11');
  await until(g, () => !g.m.isRunning('r11_power_bay'), 120);
  inOrder(g, lines(...R11_LINES));
  inOrder(g, [
    'door D_R13d_R11 locked',
    'sfx breakerClunk',
    'sfx generatorPhase1',
    'sfx generatorPhase2',
    'sfx generatorPhase3',
    'door D_R13d_R11 open',
    'checkpoint cp_r11_powered',
  ]);
  assert.equal(count(g, 'group r11_climax'), 0, 'no combat spawns in R11 Power Bay');
  assert.equal(g.host.flags['r11_powered'], true);
  assert.equal(g.host.flags['climax_done'], true);
  assert.equal(g.host.flags['obj:obj_power'], 'done');
  assert.equal(g.host.flags['obj:obj_transit_board'], 'active');
  assert.equal(g.host.flags['giles.infectionStage'], undefined, 'no Giles infection escalation');
  assert.equal(count(g, 'event reveal:trail'), 0, 'no infection reveal trail');
  assert.equal(g.log.some((e) => e === 'npc transform giles'), false, 'Giles never transforms');
  noWarnings(g);
});

test('r11_power_cascade plays all three generator phase rumbles and energizes R11 light banks', async () => {
  const g = makeGame(['r11_power_cascade']);
  g.host.events.emit('r11:power_up', {});
  await until(g, () => !g.m.isRunning('r11_power_cascade'), 30);
  inOrder(g, ['sfx breakerClunk', 'sfx generatorPhase1', 'sfx generatorPhase2', 'sfx generatorPhase3']);
  assert.equal(g.host.flags['r11_powered'], true);
  noWarnings(g);
});

// ------------------------------------------------------------------------------- beat 8: title card & stinger

/** slice-stinger: the bloom turns Priya's corpse on camera; she says nothing (her one breath is her kill's beat line). */

test('story:cliffhanger plays the title card and Priya CAM 04 stinger through to endSlice', async () => {
  const g = makeGame(['title_card', 'stinger_priya']);
  g.host.events.emit('story:cliffhanger', {});
  assert.equal(g.m.isRunning('title_card'), true);
  assert.equal(g.m.skip(), false, 'the title card is not skippable');
  await until(g, () => g.ended() === 1, 120);
  inOrder(g, ['event story:title_done', 'hush nurse', 'feed stinger live fullscreen', 'npc kill priya', 'feed stinger static fullscreen', 'fade 1', 'feed stinger off fullscreen']);
  assert.equal(g.log.filter((e) => e.startsWith('say stinger_')).length, 0, 'no words from her in the stinger');
  assert.equal(at(g, 'npc spawn r08_thing') > at(g, 'feed stinger live fullscreen'), false, 'nobody else in the room');
  assert.deepEqual(g.cards, ['THALASSA']);
  assert.equal(g.ended(), 1);
  assert.equal(g.control.state.move, 'free', 'every control layer is released at the end');
  assert.ok(g.feeds[0]!.fullscreen && g.feeds[0]!.state === 'live');
  // camera-feeds spec: the stinger is sharp and smooth, with the fullscreen look.
  assert.equal(g.feeds[0]!.fps, 30);
  assert.deepEqual(g.feeds[0]!.size, { w: 960, h: 540 });
  assert.equal(g.feeds[0]!.look, 'fullscreen');
  noWarnings(g);
});

test('skipping the stinger ends the slice at once with the feed off', async () => {
  const g = makeGame(['title_card', 'stinger_priya']);
  g.host.events.emit('story:cliffhanger', {});
  await until(g, () => g.m.isRunning('stinger_priya'), 60);
  await advance(g, 1);
  assert.equal(g.ended(), 0);
  assert.equal(g.m.skip(), true);
  assert.equal(g.ended(), 1);
  assert.equal(g.feeds.at(-1)!.state, 'off');
  assert.equal(g.m.isRunning('stinger_priya'), false);
  assert.equal(g.control.state.move, 'free');
  assert.equal(count(g, 'npc spawn r08_thing instant') + count(g, 'npc spawn r08_thing'), 0, 'slice-stinger: nobody else in the surgery');
  await advance(g, 30);
  assert.equal(g.ended(), 1, 'never twice');
});

// ------------------------------------------------------------------------------- the whole chain

/** Plays the action half the way a player would: walk into each trigger, finish panel jobs, kill every group. */
async function playThrough(g: Game, events: string[]): Promise<void> {
  const beatDone = (flag: string): boolean => g.host.flags[flag] === true;
  const settle = async (flag: string, max = 200): Promise<void> => {
    for (let i = 0; i < max * 60 && !beatDone(flag); i++) {
      g.m.update(1 / 60);
      if (i % 3 === 0) await Promise.resolve();
      if (g.tasks.length) g.finishTask();
      for (const [id, st] of g.groups) if (st.triggered && !st.cleared && i % 120 === 119) g.clear(id);
    }
    assert.ok(beatDone(flag), `${flag} reached (events so far: ${events.join(', ')})`);
  };
  g.host.events.emit('drop:done', {});
  g.host.flags['drop_done'] = true;
  fire(g, 'trigger:r05_enter');
  await settle('contact_done');
  fire(g, 'trigger:r06_enter');
  fire(g, 'trigger:r06_door');
  await settle('cover_done');
  // A player who lets the R06 talk finish (stepping in early cuts it: D14, 2026-11-23).
  await until(g, () => !g.m.isRunning('cover_me'));
  fire(g, 'trigger:r07_enter');
  await settle('sec_done');
  g.host.events.emit('door:denied', { id: 'D_R07_R09', reason: 'x' });
  await settle('medlab_open');
  fire(g, 'trigger:r09_enter');
  await settle('tunnel_started');
  fire(g, 'trigger:r10_enter');
  fire(g, 'valve:r10_main');
  await settle('valve_done');
  await until(g, () => !g.m.isRunning('valve_turn'));
  fire(g, 'trigger:r10_ambush');
  await settle('ambush_done');
  for (let i = 0; i < 12 * 60 && g.m.isRunning('r10_ambush'); i++) g.m.update(1 / 60);
  fire(g, 'trigger:r11_enter');
  await settle('r11_powered');
  await until(g, () => !g.m.isRunning('r11_power_bay'));
  await until(g, () => !g.m.isRunning('r13d_transit_walk'));
  // r13d_transit_walk opens the train door, walks Jay in on cutscene rails, releases control, and emits trigger:r15a_boarded.
  await until(g, () => g.host.flags['r15a_boarded'] === true);
  g.host.events.emit('transit:stage:pullout' as never, { stage: 'pullout' } as never);
  await until(g, () => g.log.includes('sfx trainPullout'));
  g.host.events.emit('transit:stage:sea_tunnel' as never, { stage: 'sea_tunnel' } as never);
  await until(g, () => said(g, 'r16_pa_01') >= 1);
  g.host.events.emit('transit:stage:arrival' as never, { stage: 'arrival' } as never);
  await until(g, () => said(g, 'r15a_okafor_03') >= 1);
  g.host.events.emit('transit:stage:arrived' as never, { stage: 'arrived' } as never);
  await settle('transit_ride_done');
  await until(g, () => !g.m.isRunning('r15a_train_ride'));
  await settle('r16_finale_done');
  await until(g, () => !g.m.isRunning('r16_arrival_finale'));
  await until(g, () => !g.m.isRunning('title_card'));
  await settle('reveal_done');
  await until(g, () => !g.m.isRunning('stinger_priya'));
}

test('the whole action half runs from drop:done through R16 arrival finale, title card, and Priya stinger with every checkpoint, in order, no warnings, no Giles infection tells', async () => {
  const g = makeGame();
  const events: string[] = [];
  await playThrough(g, events);
  const cps = g.log.filter((e) => e.startsWith('checkpoint ')).map((e) => e.slice(11));
  assert.deepEqual(cps, ['cp_contact_clear', 'cp_cover_done', 'cp_security_done', 'cp_valve', 'cp_r11_powered', 'cp_r16_arrived']);
  assert.equal(g.host.flags['giles.infectionStage'], undefined);
  assert.equal(g.host.flags['r16_finale_done'], true);
  assert.equal(g.host.flags['reveal_done'], true);
  assert.equal(g.m.running().length, 0, 'nothing left running');
  assert.equal(at(g, 'npc npcAnim giles flex_hand'), -1);
  assert.equal(at(g, 'npc npcAnim giles rub_forearm'), -1);
  assert.equal(at(g, 'npc npcAnim giles cough'), -1);
  noWarnings(g);
});

test('every dialogue line of the action half is played at least once on the way (nothing orphaned)', async () => {
  const g = makeGame();
  await playThrough(g, []);
  const used = new Set<string>();
  for (const def of actionDefs) walk(def.steps, (s) => s['do'] === 'say' && (Array.isArray(s['line']) ? [] : [String(s['line'])]).forEach((l) => used.add(l)));
  for (const l of used) assert.ok(said(g, l) >= 1, `${l} was said`);
  for (const l of ['contact_okafor_03', 'blackout_radio_ops_01', 'r11_giles_03']) assert.ok(used.has(l), l);
});

// ------------------------------------------------------------------------------- loads and restarts

test('a load after cover me lays the R06 grate on the floor; before it, the grate stays up for the fight to replay', () => {
  const during = makeGame(['action_restore']);
  setFlags(during, { drop_done: true, contact_done: true });
  during.host.events.emit('game:mode', { mode: 'playing', from: 'title' });
  assert.equal(during.log.some((e) => e.startsWith('vent r06_vent')), false, 'restoring at cp_contact_clear: the creature has not come yet');
  const after = makeGame(['action_restore']);
  setFlags(after, COVER_DONE);
  after.host.events.emit('game:mode', { mode: 'playing', from: 'title' });
  assert.ok(after.log.includes('vent r06_vent fallen instant'));
  assert.equal(after.log.includes('sfx grateClatter'), false);
});

test('a load or restart puts the doors the finished beats opened back, from the saved flags, and does nothing on a fresh game', () => {
  const fresh = makeGame(['action_restore']);
  fresh.host.events.emit('game:mode', { mode: 'playing', from: 'title' });
  assert.equal(fresh.log.filter((e) => e.startsWith('door ')).length, 0);
  const g = makeGame(['action_restore']);
  setFlags(g, { ...COVER_DONE, drop_started: true, armory_open: true, sec_done: true, medlab_open: true, valve_done: true });
  g.host.events.emit('game:mode', { mode: 'title' });
  assert.equal(g.log.filter((e) => e.startsWith('door ')).length, 0, 'only on playing');
  g.host.events.emit('game:mode', { mode: 'playing', from: 'title' });
  for (const d of ['D_R03_R05 closed', 'D_R05_R06 closed', 'D_R06_R07 open', 'D_R07_R07a open', 'D_R07_R09 open', 'D_R10_R11 closed']) assert.ok(at(g, `door ${d}`) >= 0, d);
  assert.equal(at(g, 'door D_R10_R11 sealed'), -1);
  setFlags(g, { r11_powered: true });
  g.host.events.emit('game:mode', { mode: 'playing', from: 'title' });
  assert.ok(at(g, 'door D_R13d_R11 open') >= 0 && at(g, 'door D_R13d_R15a closed') >= 0);
  assert.equal(at(g, 'door D_R13d_R11 sealed'), -1);
  noWarnings(g);
});

test('checkpoint-restore "Resume after a pause": returning from pause mid-scene restores nothing; a death restart still does', () => {
  const g = makeGame(['action_restore', 'quiet_restore', 'action_tunnel', 'action_climax']);
  setFlags(g, COVER_DONE);
  const before = g.log.length;
  g.host.events.emit('game:mode', { mode: 'paused', from: 'playing' });
  g.host.events.emit('game:mode', { mode: 'playing', from: 'paused' });
  for (let i = 0; i < 30; i++) g.m.update(1 / 30);
  assert.deepEqual(g.log.slice(before).filter((e) => e !== 'event game:mode'), [], 'Priya, the intercom and the doors are left as the scene put them');
  g.host.events.emit('game:restarted', { checkpoint: 'cp_cover_done' });
  for (let i = 0; i < 30; i++) g.m.update(1 / 30);
  assert.ok(at(g, 'door D_R06_R07 open') >= 0, 'death restart: the restore runs');
});

test('station-power "Panicked radio chatter": the calls come one after another, each letting the next start about 1 s before it ends', () => {
  const steps = byId.get('contact')!.steps as Array<Record<string, unknown>>;
  const calls = ['blackout_radio_ops_01', 'blackout_radio_dock_01', 'blackout_radio_launch_01'];
  for (const line of calls) {
    const i = steps.findIndex((s) => s['line'] === line);
    assert.ok(i >= 0 && steps[i]!['overlap'] === true && steps[i]!['wait'] === false, line);
    const next = steps[i + 1]!;
    // The wait is the clip's length minus about 1 s; the shortest clip runs 3.7 s.
    assert.ok(next['do'] === 'wait' && (next['s'] as number) >= 2.5, `${line} is followed by a wait of at least 2.5 s`);
  }
});

test('station-power: every sequence after the contact fight debug-starts under backup power', () => {
  for (const id of ['cover_me', 'sec_glass', 'medlab_door', 'tunnel_enter', 'valve_turn', 'r11_power_bay']) {
    const g = makeGame([id]);
    g.m.start(id, { debug: true });
    assert.ok(at(g, 'power backup') >= 0, `${id} starts on backup power`);
  }
  const g = makeGame(['contact']);
  g.m.start('contact', { debug: true });
  assert.equal(at(g, 'power backup'), -1, 'the contact fight itself starts on main power');
});

test('station-power "Power state survives checkpoints": a load after the blackout is on backup power, one before it is not', () => {
  const before = makeGame(['action_restore']);
  setFlags(before, { drop_started: true, drop_done: true });
  before.host.events.emit('game:mode', { mode: 'playing', from: 'title' });
  assert.equal(at(before, 'power backup'), -1, 'cp_drop loads on main power');
  const after = makeGame(['action_restore']);
  setFlags(after, { drop_started: true, drop_done: true, contact_done: true, station_power: 'backup' });
  after.host.events.emit('game:mode', { mode: 'playing', from: 'title' });
  assert.ok(at(after, 'power backup') >= 0);
  // A save made after the contact fight but before this change has no station_power flag.
  const old = makeGame(['action_restore']);
  setFlags(old, { drop_started: true, drop_done: true, contact_done: true });
  old.host.events.emit('game:mode', { mode: 'playing', from: 'title' });
  assert.ok(at(old, 'power backup') >= 0, 'an older save loads dark too');
  noWarnings(after);
});

test('medbay-attack "Restore after R08": Priya is put back dead where she was thrown, with the centre pane\'s marks, and the attack does not replay', () => {
  const g = makeGame(['action_restore']);
  setFlags(g, { ...COVER_DONE, armory_open: true, sec_done: true });
  g.host.events.emit('game:mode', { mode: 'playing', from: 'title' });
  const kill = at(g, 'npc kill priya instant');
  assert.ok(at(g, 'npc npcMoveTo priya instant') >= 0 && kill > at(g, 'npc npcMoveTo priya instant'), 'at the glass, then the kill played to its end at once');
  assert.ok(g.log.lastIndexOf('npc npcMoveTo priya instant') > kill, 'then laid at her resting spot by the pane');
  assert.ok(g.log.includes('intercom medbay off') && g.log.includes('door D_R07_R08 sealed'), 'the intercom is dead and the door still sealed');
  assert.ok(g.log.includes('gore pool'), 'in her pool');
  assert.ok(at(g, 'npc npcAnim priya corpseSlumped instant') > kill, 'dead, slumped as the scene leaves her');
  assert.equal(at(g, 'npc spawn r08_thing'), -1, 'no attacker comes back');
  noWarnings(g);
});

test('medbay-attack "Restore before the attack": from cp_cover_done Priya is hiding in the security office, the bay sealed, and the run waits for Jay to enter', () => {
  const g = makeGame(['action_restore']);
  setFlags(g, COVER_DONE);
  g.host.events.emit('game:mode', { mode: 'playing', from: 'title' });
  inOrder(g, ['intercom medbay off', 'door D_R07_R08 sealed', 'npc npcMoveTo priya instant', 'npc npcAnim priya priya_crouch instant']);
  assert.equal(at(g, 'npc kill priya instant'), -1, 'she is alive');
  assert.equal(g.log.some((e) => e.startsWith('say ')), false, 'no run call');
  noWarnings(g);
});

test('a counted loop inside a skipped sequence applies its body (a block, not an event loop)', () => {
  const d = validateSequences({
    'x.json': { id: 'blk', skippable: true, steps: [{ do: 'wait', s: 99 }, { do: 'loop', count: 1, steps: [{ do: 'say', line: 'climax_giles_02' }, { do: 'setFlag', flag: 'blockDone' }] }] },
  });
  const g = makeGame();
  const m = new SequenceManager(g.host, d);
  m.start('blk');
  assert.equal(m.skip(), true);
  assert.equal(g.host.flags['blockDone'], true);
  assert.ok(g.log.includes('played climax_giles_02'));
});

test('Priya\'s scene has no hand-placed gore (the kill clips its own at the pane), and a gore step\'s clip still reaches the host', () => {
  const sec = actionDefs.find((d) => d.id === 'sec_glass')!;
  let n = 0;
  walk(sec.steps, (st) => void (st['do'] === 'gore' && !(st['kind'] === 'pool' && st['at'] === 'anchor:priya_pool') && n++));
  assert.equal(n, 0, 'medbay-attack: the mauled kill derives its gore clip from the centre pane (z 45.78); only her floor pool is placed');
  const g = makeGame();
  let seen: unknown;
  g.host.gore = (_k, _a, _d, _c, _s, clip) => void (seen = clip);
  const d = validateSequences({ 'x.json': { id: 'cl', steps: [{ do: 'gore', at: [1, 1, 47], kind: 'burst', clipAxis: 'z', clipAt: 46.05, clipKeep: 'above' }] } });
  new SequenceManager(g.host, d).start('cl');
  assert.deepEqual(seen, { axis: 'z', at: 46.05, keep: 'above' });
  assert.throws(() => validateSequences({ 'x.json': { id: 'bad', steps: [{ do: 'gore', at: [0, 0, 0], kind: 'burst', clipAxis: 'w' }] } }));
});

test('loading a save after cp_r11_powered restores R11 online with D_R13d_R11 open and does not replay r11_power_bay', async () => {
  const saved = { ...VALVE_DONE, r11_started: true, r11_powered: true, climax_done: true, 'cp:cp_r11_powered': true };
  const r = makeGame(['action_restore', 'r11_power_bay']);
  setFlags(r, saved);
  r.host.events.emit('game:mode', { mode: 'playing', from: 'title' });
  assert.ok(at(r, 'door D_R13d_R11 open') >= 0, 'north transit door stays open');
  assert.ok(at(r, 'event r11:power_state') >= 0, 'terminal restored to online');
  assert.ok(at(r, 'event r11:hum_on') >= 0, 'generator hum restored');
  fire(r, 'trigger:r11_enter');
  assert.equal(r.m.isRunning('r11_power_bay'), false, 'power bay sequence does not replay');
  noWarnings(r);
});

// -------------------------------------------------------------------- speaker (conversation) shots

function shotHost() {
  const frames: Array<{ at: { x: number; y: number; z: number } | null; duration: number; follow: boolean }> = [];
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  const spots: Record<string, { x: number; y: number; z: number }> = {
    'npc:okafor': { x: 1, y: 1.6, z: 0 },
    'npc:giles': { x: 2, y: 1.6, z: 0 },
    'npc:start': { x: 9, y: 1.6, z: 9 },
  };
  const host: SequenceHost = {
    events: {
      on(name, fn) {
        const set = handlers.get(name) ?? new Set();
        handlers.set(name, set);
        set.add(fn);
        return () => set.delete(fn);
      },
      emit(name, payload) {
        for (const fn of [...(handlers.get(name) ?? [])]) fn(payload);
      },
    },
    flags: {} as Flags,
    resolve: (t) => (typeof t === 'string' ? (spots[t] ?? null) : null),
    warn: () => undefined,
    frame: (at, duration, _give, follow) => void frames.push({ at, duration, follow: follow !== undefined }),
    speakerTarget: (sp) => ({ medic: 'npc:okafor', engineer: 'npc:giles' })[sp] ?? null,
  };
  const speak = (speaker: string): void => host.events.emit('speech:started', { id: 'x', speaker });
  const def = (steps: unknown[]) => validateSequences({ 'shot.json': { id: 'shot', skippable: true, steps } })[0]!;
  const lastAt = () => frames.filter((f) => f.at).at(-1)?.at;
  return { host, frames, speak, def, lastAt, spots };
}

test('speaker shot: starts on the initial aim, turns to each NPC speaker (tracked) and holds on Jay', () => {
  const g = shotHost();
  const m = new SequenceManager(g.host, [g.def([{ do: 'playerFrame', target: 'speaker', initial: 'npc:start', duration: 0.5 }, { do: 'wait', s: 100 }])]);
  m.start('shot');
  assert.deepEqual(g.lastAt(), g.spots['npc:start']);
  g.speak('medic');
  assert.deepEqual(g.lastAt(), g.spots['npc:okafor']);
  const last = g.frames.at(-1)!;
  assert.equal(last.duration, 0.5);
  assert.equal(last.follow, true, 'the shot follows the NPC');
  g.speak('player');
  g.speak('pa');
  assert.deepEqual(g.lastAt(), g.spots['npc:okafor'], 'Jay and the PA keep the shot');
  g.speak('engineer');
  assert.deepEqual(g.lastAt(), g.spots['npc:giles']);
});

test('speaker shot: Jay talking to someone turns to the addressee; NPC lines still show the speaker', () => {
  const g = shotHost();
  const m = new SequenceManager(g.host, [g.def([{ do: 'playerFrame', target: 'speaker', initial: 'npc:start', duration: 0.5 }, { do: 'wait', s: 100 }])]);
  m.start('shot');
  const say = (speaker: string, to?: string): void => g.host.events.emit('speech:started', { id: 'x', speaker, ...(to ? { to } : {}) });
  say('player', 'giles');
  assert.deepEqual(g.lastAt(), g.spots['npc:giles'], 'an NPC id addressee');
  assert.equal(g.frames.at(-1)!.follow, true);
  say('player', 'medic');
  assert.deepEqual(g.lastAt(), g.spots['npc:okafor'], 'a speaker id addressee');
  const n = g.frames.length;
  say('player');
  say('player', 'player');
  say('player', 'nobody_here');
  assert.equal(g.frames.length, n, 'unaddressed, self-addressed or unknown addressees keep the shot');
  say('engineer', 'okafor');
  assert.deepEqual(g.lastAt(), g.spots['npc:giles'], 'an NPC speaking to someone is still shown speaking');
});

test('speaker shot: overheard background talk never turns the view', () => {
  const g = shotHost();
  const m = new SequenceManager(g.host, [g.def([{ do: 'playerFrame', target: 'speaker', initial: 'npc:start' }, { do: 'wait', s: 100 }])]);
  m.start('shot');
  const n = g.frames.length;
  g.host.events.emit('speech:started', { id: 'x', speaker: 'medic', priority: 'background' });
  assert.equal(g.frames.length, n);
});

test('speaker shot: a later explicit playerFrame ends it', () => {
  const g = shotHost();
  const m = new SequenceManager(g.host, [g.def([{ do: 'playerFrame', target: 'speaker' }, { do: 'wait', s: 1 }, { do: 'playerFrame', target: 'npc:giles', duration: 0 }, { do: 'wait', s: 100 }])]);
  m.start('shot');
  g.speak('medic');
  assert.deepEqual(g.lastAt(), g.spots['npc:okafor']);
  m.update(1.1);
  assert.deepEqual(g.lastAt(), g.spots['npc:giles']);
  const n = g.frames.length;
  g.speak('medic');
  assert.equal(g.frames.length, n, 'no longer listening');
});

test('speaker shot: skipping or ending the sequence releases the view', () => {
  const g = shotHost();
  const m = new SequenceManager(g.host, [g.def([{ do: 'playerFrame', target: 'speaker', initial: 'npc:okafor' }, { do: 'wait', s: 100 }])]);
  m.start('shot');
  assert.equal(m.skip(), true);
  assert.equal(g.frames.at(-1)!.at, null, 'cleared');
  const n = g.frames.length;
  g.speak('engineer');
  assert.equal(g.frames.length, n, 'listener gone');
});

// infection-kills "The fight is the creature" and adaptive-music "The Lab B score follows the incident".
test('the creature escapes in the drop and is the R06 enemy; the score holds through R05, slams as it drops and ends on its death', () => {
  const all = (id: string): Array<Record<string, unknown>> => {
    const out: Array<Record<string, unknown>> = [];
    walk(byId.get(id)!.steps, (s) => out.push(s));
    return out;
  };
  const cover = all('cover_me');
  assert.ok(!all('contact').some((s) => s['do'] === 'spawnGroup'), 'no fight in R05');
  assert.ok(!cover.some((s) => s['do'] === 'despawn' && s['npc'] === 'researcher_b_creature'), 'no stand-in swap in R06');
  const spawn = level.rooms.flatMap((r: any) => r.spawns ?? []).find((s: any) => s.id === 'r06_duct');
  assert.deepEqual([spawn.group, spawn.look, spawn.hp, spawn.start], ['r06_cover', 'lab_creature', 90, 'drop'], "the enemy wears the creature's body");
  const cues = (steps: Array<Record<string, unknown>>) => steps.filter((s) => s['do'] === 'score' || (s['do'] === 'waitGroup' && s['group'] === 'r06_cover')).map((s) => String(s['cue'] ?? s['stinger'] ?? s['do']));
  assert.deepEqual(cues(all('contact')), ['contact']);
  assert.deepEqual(cues(cover), ['dropHush', 'door', 'waitGroup', 'end']);
});

// flooded-tunnel spec "The flood cutscene can be skipped once seen" (overhaul-flooded-tunnel D9).
test('skippableAfter: not skippable the first time, skippable once watched to the end', async () => {
  const d = validateSequences({ 'x.json': { id: 'flood', skippableAfter: 'flood_cutscene', steps: [{ do: 'wait', s: 2 }, { do: 'setFlag', flag: 'flooded', value: true }] } });
  const g = makeGame();
  const seen = new Set<string>();
  g.host.seen = (id) => seen.has(id);
  g.host.markSeen = (id) => void seen.add(id);
  const m = new SequenceManager(g.host, d);
  m.start('flood');
  assert.equal(m.skippable, false);
  assert.equal(m.skip(), false, 'the first time it plays through');
  for (let i = 0; i < 180; i++) m.update(1 / 60);
  assert.equal(m.isRunning('flood'), false);
  assert.ok(seen.has('flood_cutscene'), 'watched to the end is remembered');
  m.start('flood');
  assert.equal(m.skippable, true);
  assert.equal(m.skip(), true);
  assert.equal(g.host.flags['flooded'], true, 'the skip applies the end state');
});

test('light step forwards optional auxiliary power scale to host.light', () => {
  const d = validateSequences({
    'x.json': {
      id: 'lpow',
      steps: [
        { do: 'light', id: 'r11_bank_1a', pattern: 'steady', power: 1 },
        { do: 'light', id: 'r11_beacon_ne', pattern: 'off', power: 0 },
        { do: 'light', id: 'r10_beacon', pattern: 'alarm', tint: 'emergency' },
      ],
    },
  });
  const g = makeGame();
  new SequenceManager(g.host, d).start('lpow');
  assert.ok(g.log.includes('namedLight r11_bank_1a steady power=1'));
  assert.ok(g.log.includes('namedLight r11_beacon_ne off power=0'));
  assert.ok(g.log.includes('namedLight r10_beacon alarm emergency'));
});

test('detail-r11-power-bay: r11_power_cascade staggers Banks 1 -> 2 -> 3, flips power_state, and restores on r11_powered', () => {
  const g = makeGame(['r11_power_cascade', 'action_restore']);
  setFlags(g, { station_power: 'backup', contact_done: true, tunnel_started: true, valve_done: true });
  const states: string[] = [];
  let humOn = false;
  g.host.events.on('r11:power_state' as never, (p: unknown) => void states.push((p as { state: string }).state));
  g.host.events.on('r11:hum_on' as never, () => void (humOn = true));

  g.host.events.emit('r11:power_up' as never, {} as never);
  g.m.update(0);
  assert.equal(g.host.flags['r11_powered'], true);
  assert.equal(humOn, true);
  assert.deepEqual(states, ['starting']);

  for (let i = 0; i < 60 * 3; i++) g.m.update(1 / 60);
  assert.deepEqual(states, ['starting', 'online']);
  const b1 = g.log.indexOf('namedLight r11_bank_1a steady power=1');
  const b2 = g.log.indexOf('namedLight r11_bank_2a steady power=1');
  const b3 = g.log.indexOf('namedLight r11_bank_3a steady power=1');
  const beaconsOff = g.log.indexOf('namedLight r11_beacon_ne off power=0');
  assert.ok(b1 >= 0 && b2 > b1 && b3 > b2 && beaconsOff > b3, 'banks energize 1 -> 2 -> 3 then extinguish beacons');
  noWarnings(g);

  // Restore with r11_powered set: immediately restores all 6 bank lights, beacons off, and online instant.
  const r = makeGame(['action_restore']);
  setFlags(r, { station_power: 'backup', contact_done: true, tunnel_started: true, valve_done: true, r11_powered: true });
  const restoredStates: Array<{ state: string; instant?: boolean }> = [];
  r.host.events.on('r11:power_state' as never, (p: unknown) => void restoredStates.push(p as { state: string; instant?: boolean }));
  r.host.events.emit('game:mode', { mode: 'playing', from: 'title' });
  assert.ok(r.log.includes('namedLight r11_bank_1a steady power=1'));
  assert.ok(r.log.includes('namedLight r11_bank_3b steady power=1'));
  assert.ok(r.log.includes('namedLight r11_beacon_sw off power=0'));
  assert.deepEqual(restoredStates, [{ state: 'online', instant: true }]);
  noWarnings(r);
});

test('r15a-train-ride-narrative: R13d walk-and-talk, R15a boarding, 3-stage Heins radio ride, and R16a arrival handoff', async () => {
  const g = makeGame(['r13d_transit_walk', 'r15a_boarding', 'r15a_train_ride', 'action_restore']);
  setFlags(g, { station_power: 'backup', contact_done: true, tunnel_started: true, valve_done: true, r11_powered: true });
  const commsStates: string[] = [];
  let startRidePayload: Record<string, unknown> | null = null;
  let arrivedR16 = false;
  g.host.events.on('transit:comms_state' as never, (p: unknown) => void commsStates.push((p as { state: string }).state));
  g.host.events.on('transit:start_ride' as never, (p: unknown) => void (startRidePayload = p as Record<string, unknown>));
  g.host.events.on('transit:arrived_r16' as never, () => void (arrivedR16 = true));

  // R13d walk-and-talk banter fires after R11 finishes, keeping player free-roam:
  // Train Car A door starts closed, Giles works the R15a platform console during the banter, then releases the door and both board on the same lane.
  const doorOpens: Array<{ carId: string; open: boolean }> = [];
  g.host.events.on('transit:train_door' as never, (p: unknown) => void doorOpens.push(p as { carId: string; open: boolean }));
  g.host.events.emit('r11:walk_to_train' as never, {} as never);
  // Entering R15a mid-walk must NOT start a second overlapping r15a_boarding lane.
  g.host.events.emit('trigger:r15a_enter' as never, {} as never);
  assert.equal(g.m.isRunning('r15a_boarding'), false, 'r15a_boarding does not overlap r13d_transit_walk');
  await until(g, () => !g.m.isRunning('r13d_transit_walk'));
  for (const id of ['r13d_okafor_01', 'r13d_giles_01', 'r13d_jay_01', 'r13d_giles_02', 'r13d_okafor_02', 'r15a_giles_01', 'r15a_okafor_01']) {
    assert.ok(said(g, id) >= 1, `single-lane walk/boarding line ${id} played`);
  }
  assert.ok(g.log.some((e) => e.includes('door D_R13d_R15a open')), 'D_R13d_R15a opens as squad approaches');
  assert.ok(doorOpens.some((d) => d.carId === 'r15a_train' && d.open === false), 'Car A door starts closed until Giles releases it');
  assert.ok(doorOpens.some((d) => d.carId === 'r15a_train' && d.open === true), 'Giles opens Car A door after platform console work');
  assert.ok(g.log.includes('npc npcAnim giles typing'), 'Giles works the R15a platform console');
  assert.ok(g.log.includes('npc npcMoveTo giles'), 'Giles moves into Train Car A');
  assert.ok(g.log.includes('npc npcMoveTo okafor'), 'Okafor moves into Train Car A');

  // Boarding Train Car A launches the 3-stage ride with extended Stage 2 tunnelSeconds.
  g.host.events.emit('trigger:r15a_boarded' as never, {} as never);
  await until(g, () => g.host.flags['r15a_boarded'] === true);
  assert.ok(startRidePayload && typeof startRidePayload['tunnelSeconds'] === 'number' && (startRidePayload['tunnelSeconds'] as number) >= 30, 'transit:start_ride extends Stage 2 tunnelSeconds');
  assert.ok(g.log.some((e) => e.includes('door D_R13d_R15a locked')), 'D_R13d_R15a locks once boarded');

  // Drive stage transitions and verify Heins radio exchange + comms LED state + R16a arrival handoff.
  g.host.events.emit('transit:stage:pullout' as never, { stage: 'pullout' } as never);
  await until(g, () => g.log.includes('sfx trainPullout'));
  g.host.events.emit('transit:stage:sea_tunnel' as never, { stage: 'sea_tunnel' } as never);
  await until(g, () => commsStates.includes('lost'));
  for (const id of ['r15a_giles_03', 'r15a_heins_01', 'r15a_jay_01', 'r15a_heins_02', 'r15a_okafor_02', 'r15a_heins_03', 'r15a_jay_02', 'r15a_heins_04']) {
    assert.ok(said(g, id) >= 1, `Stage 2 radio line ${id} played`);
  }
  assert.deepEqual(commsStates, ['ringing', 'active', 'lost'], 'rear-bulkhead comms LED transitions ringing -> active -> lost');
  // Giles answers the lost call over the power-loss announcement, before the glide.
  await until(g, () => g.log.includes('say r15a_giles_04 overlap'));
  inOrder(g, ['say r15a_heins_04', 'say r16_pa_01', 'say r15a_giles_04 overlap']);

  g.host.events.emit('transit:stage:arrival' as never, { stage: 'arrival' } as never);
  await until(g, () => said(g, 'r15a_okafor_03') >= 1);
  assert.equal(said(g, 'r15a_giles_04'), 1, 'said once');

  g.host.events.emit('transit:stage:arrived' as never, { stage: 'arrived' } as never);
  await until(g, () => !g.m.isRunning('r15a_train_ride'));
  assert.equal(g.host.flags['transit_ride_done'], true);
  assert.equal(arrivedR16, true, 'transit:arrived_r16 emitted for Part 3 handoff');
  noWarnings(g);

  // Restore with transit_ride_done seals r16a_north, keeps r16a_train door closed, and sets comms lost.
  const r = makeGame(['action_restore']);
  setFlags(r, { station_power: 'backup', contact_done: true, tunnel_started: true, valve_done: true, r11_powered: true, transit_ride_done: true });
  const rComms: string[] = [];
  r.host.events.on('transit:comms_state' as never, (p: unknown) => void rComms.push((p as { state: string }).state));
  r.host.events.emit('game:mode', { mode: 'playing', from: 'title' });
  assert.deepEqual(rComms, ['lost']);
  noWarnings(r);
});

// transit-wing "Restoring the Arrival Terminal checkpoint starts the finale" (fix-r13d-r16-finale).
test('a load at cp_r16_arrived replays the arrival finale once, from a dark R16 with the squad in the car', async () => {
  const only = ['action_restore', 'r16_restore', 'r16_arrival_finale'];
  const saved: Flags = { station_power: 'backup', contact_done: true, tunnel_started: true, valve_done: true, r11_powered: true, transit_ride_done: true };
  const started = (g: Game): number => count(g, 'event transit:arrived_r16');
  // A load as the game does it: play begins from the title (restore scripts start), then the restart cancels and re-runs them.
  const load = async (g: Game): Promise<void> => {
    g.host.events.emit('game:mode', { mode: 'playing', from: 'title' });
    g.host.events.emit('game:restarted', { checkpoint: 'cp_r16_arrived' });
    await advance(g, 0.5);
  };
  const g = makeGame(only);
  setFlags(g, saved);
  await load(g);
  assert.equal(started(g), 1);
  assert.equal(g.m.isRunning('r16_arrival_finale'), true);
  inOrder(g, ['light R16a off black', 'npc npcMoveTo giles instant', 'npc npcMoveTo okafor instant', 'event transit:arrived_r16']);
  assert.ok(g.log.includes('light R16b off black') && g.log.includes('namedLight r16a_train_cabin_a steady #ffb974 power=1'));
  g.host.events.emit('game:mode', { mode: 'paused', from: 'playing' });
  g.host.events.emit('game:mode', { mode: 'playing', from: 'paused' });
  await advance(g, 0.5);
  assert.equal(started(g), 1, 'a pause and resume does not start it again');
  // Quit to title during the finale, then Continue: the same save plays it again.
  g.host.events.emit('game:mode', { mode: 'title' });
  g.m.cancelAll();
  for (const key of Object.keys(g.host.flags)) delete g.host.flags[key];
  setFlags(g, saved);
  await load(g);
  assert.equal(started(g), 2);
  assert.equal(g.m.isRunning('r16_arrival_finale'), true);

  const done = makeGame(only);
  setFlags(done, { ...saved, r16_finale_done: true });
  await load(done);
  assert.equal(started(done), 0, 'a finished finale does not play again');
  assert.equal(done.m.isRunning('r16_arrival_finale'), false);
  const early = makeGame(only);
  setFlags(early, { station_power: 'backup', r11_powered: true });
  await load(early);
  assert.equal(started(early), 0, 'nothing before the ride has finished');
});

test('r16-arrival-finale: surveillance reveal, the Juggernaut walks out and roars twice on camera, cut to black, title card', async () => {
  const g = makeGame(['r16_arrival_finale', 'title_card', 'action_restore']);
  setFlags(g, { station_power: 'backup', contact_done: true, tunnel_started: true, valve_done: true, r11_powered: true, transit_ride_done: true });

  const auxLights: boolean[] = [];
  const squadFlashlights: boolean[] = [];
  const juggernautShows: boolean[] = [];
  const subtitles: string[] = [];
  const showCard = g.host.titleCard!;
  g.host.titleCard = (title, sub, seconds) => {
    subtitles.push(sub);
    showCard(title, sub, seconds);
  };
  let scriptedFired = false;
  let cliffhanger = false;
  g.host.events.on('transit:train_aux_lights' as never, (p: unknown) => void auxLights.push((p as { on: boolean }).on));
  g.host.events.on('squad:flashlight' as never, (p: unknown) => void squadFlashlights.push((p as { on: boolean }).on));
  g.host.events.on('transit:juggernaut_reveal' as never, (p: unknown) => {
    const rec = p as { show?: boolean };
    if (typeof rec.show === 'boolean') juggernautShows.push(rec.show);
  });
  const fires: Array<{ bursts?: number; target?: string }> = [];
  const acts: string[] = [];
  g.host.events.on('squad:scripted_fire' as never, (p: unknown) => {
    scriptedFired = true;
    fires.push(p as { bursts?: number; target?: string });
  });
  g.host.events.on('transit:juggernaut_act' as never, (p: unknown) => void acts.push((p as { sequence: string }).sequence));
  g.host.events.on('story:cliffhanger' as never, () => void (cliffhanger = true));
  // Any magnified shot (there is none since the north-pillar scare was cut).
  const zooms: number[] = [];
  g.host.frame = (_at, _duration, _give, _follow, opts) => void (opts?.zoom !== undefined && zooms.push(opts.zoom));

  g.host.events.emit('transit:arrived_r16' as never, {} as never);
  assert.equal(g.m.isRunning('r16_arrival_finale'), true);
  await until(g, () => auxLights.includes(true));
  assert.equal(g.control.state.move, 'locked', 'cutscene locks player movement once auxiliary lights engage');

  // openspec juggernaut-walk-and-roar D7: it walks out acting the CCTV roar while they fire and back away facing it, stops,
  // they yell, it acts the long roar on camera over their quieter fire, and the cut to black lands on the roar's last beat.
  await until(g, () => juggernautShows.includes(true));
  await advance(g, 1.65);
  assert.ok(!g.log.includes('sfx r16MonsterRoar'), 'the scream waits for the Juggernaut to enter the frame');
  await until(g, () => g.log.includes('sfx r16MonsterRoar'), 0.2);
  assert.deepEqual(acts, ['roar_walk'], 'it acts the first roar as it walks');
  assert.equal(fires.at(-1)?.target, 'anchor:r16_monster_face_aim', 'they keep firing at it as it walks');
  assert.ok(g.log.includes('npc npcMoveTo giles') && g.log.includes('npc npcMoveTo okafor'), 'they back away');
  for (const f of fires) assert.ok((f as { interval?: number }).interval! >= 0.6 && (f as { gain?: number }).gain! <= 0.6, 'slow, quiet shots');
  await advance(g, 3.4);
  assert.deepEqual(acts, ['roar_walk'], 'still walking');
  await until(g, () => acts.length === 2, 0.3);
  assert.equal(acts[1], 'roar_full', 'it stops and rears up for the long roar');
  assert.equal(fires.at(-1)?.target, 'anchor:r16_monster_face_aim', 'they keep firing as it rears up');
  assert.equal((fires.at(-1) as { gain?: number }).gain, 0.4, 'quieter still, so the roar overpowers it');
  assert.ok(g.log.includes('say r16_giles_05'), 'Giles yells');
  assert.deepEqual(juggernautShows, [true], 'CAM 10 stays live');
  await until(g, () => said(g, 'r16_okafor_04') === 1, 0.6); // over Giles: an overlapping line
  assert.ok(!g.log.includes('sfx r16MonsterRoarBlackout'), 'both yell before the long roar drowns them');
  await until(g, () => g.log.includes('sfx r16MonsterRoarBlackout'), 0.5);
  assert.equal(g.feeds.at(-1)?.state, 'live', 'the long roar plays on camera');
  await advance(g, 3.1);
  assert.deepEqual(juggernautShows, [true], 'on camera through the roar');
  await until(g, () => juggernautShows.length === 2, 0.4);
  const cutAt = g.log.length;
  await advance(g, 0.8);
  assert.equal(cliffhanger, false, 'about a second of black and silence first');
  await until(g, () => cliffhanger, 0.4);
  assert.ok(!g.log.slice(cutAt).some((e) => e.startsWith('sfx r16Monster')), 'no creature sound after the cut');
  // The music hush before the roars must still let Giles and Okafor be heard, or their screams are dropped.
  for (const [line, speaker] of [['r16_giles_05', 'engineer'], ['r16_okafor_04', 'medic']] as const) {
    const at = g.log.findIndex((e) => e.startsWith(`say ${line}`));
    const lastHush = g.log.slice(0, at).filter((e) => e.startsWith('hush')).at(-1);
    assert.ok(!lastHush || lastHush === 'hush off' || lastHush.slice(5).split(',').includes(speaker), `${line} is heard through "${lastHush}"`);
  }
  await until(g, () => !g.m.isRunning('r16_arrival_finale'));

  // transit-wing "Okafor's order cuts to the surveillance feed": nothing is said, lit or moved between his order and
  // the cut to black, and the feed comes up straight after it.
  const order = g.log.indexOf('say r16_okafor_01');
  const cut = g.log.slice(order, g.log.indexOf('feed r16_cam live fullscreen') + 1);
  assert.deepEqual(
    cut.filter((e) => /^(say|light R16|npc npcMoveTo|score|feed)/.test(e)),
    ['say r16_okafor_01', 'score labB r16Cut', 'npc npcMoveTo giles instant', 'npc npcMoveTo okafor instant', 'feed r16_cam live fullscreen'],
  );
  assert.deepEqual(zooms, [], 'no magnified shot');

  // Dialogue lines across PA, cabin banter, and radio-filtered surveillance.
  for (const id of ['r16_pa_02', 'r16_jay_01', 'r16_giles_01', 'r16_okafor_01', 'r16_okafor_02', 'r16_giles_03', 'r16_okafor_03', 'r16_giles_04', 'r16_giles_05', 'r16_okafor_04']) {
    assert.ok(said(g, id) >= 1, `R16 finale line ${id} played`);
  }
  assert.equal(said(g, 'r16_jay_03'), 0, 'Jay stays quiet during the squad advance');
  const arrivalScore = ['score labB load', 'score labB r16Build', 'score labB r16Stalk', 'score labB r16Cut'];
  assert.deepEqual(g.log.filter((entry) => entry.startsWith('score ')), arrivalScore);
  inOrder(g, [
    'score labB load', 'say r16_pa_02', 'sfx breakerClunk',
    'sfx r16HorrorHit', 'say r16_jay_01', 'score labB r16Build', 'sfx r16HorrorHit',
    'score labB r16Stalk', 'score labB r16Cut', 'feed r16_cam live fullscreen',
    'sfx r16MonsterRoar', 'say r16_giles_05', 'say r16_okafor_04 overlap', 'sfx r16MonsterRoarBlackout', 'feed r16_cam off fullscreen',
  ]);
  assert.equal(scores.labB.cues.r16Cut.cut, true);

  // Lighting, horror hit, surveillance feeds, squad flashlights, gunfire, monster roar, and dead-silence cut.
  assert.deepEqual(auxLights, [true, false], 'Train Car B downward auxiliary lights turn on then off on blackout');
  assert.deepEqual(squadFlashlights, [true, false], 'Giles and Okafor weapon flashlights turn on then off on blackout');
  assert.equal(scriptedFired, true, 'scripted squad gunfire fires before CAM 10');
  assert.ok(g.log.includes('sfx r16HorrorHit'), 'bass horror impact plays on massacre reveal');
  assert.deepEqual(juggernautShows, [true, false], 'the Juggernaut shows on CAM 10 through both roars and hides at the cut');
  assert.equal(g.feeds.at(-1)?.state, 'off');
  assert.equal(g.host.flags['r16_finale_done'], true);
  assert.equal(cliffhanger, true, 'story:cliffhanger emitted to chain into title_card -> stinger_priya -> endSlice');
  assert.equal(g.m.isRunning('title_card'), true, 'title_card triggers immediately on story:cliffhanger');
  assert.equal(g.control.state.move, 'locked', 'the player stays locked during the blackout');
  await advance(g, 0.9);
  assert.deepEqual(g.cards, [], 'the frame stays black before the splash');
  await until(g, () => g.cards.length > 0, 0.2);
  assert.deepEqual(g.cards, ['THALASSA']);
  assert.deepEqual(subtitles, ['']);
  noWarnings(g);
});
