/**
 * The action half (ADR-0014 beats 3-8): first contact, cover me, the armory and Priya at the glass,
 * the biometric door, the tunnel and valve, the climax, the reveal, the title card and the stinger.
 * Every action sequence is checked against the real dialogue, sounds, anchors, doors, rooms,
 * objectives and spawn groups of slice01, and each chain is played headless on a host that
 * dispatches events like the game does (groups, panel tasks, checkpoints and deaths included).
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
const ACTION_FILES = ['action_contact.json', 'action_security.json', 'action_tunnel.json', 'action_climax.json', 'action_restore.json'];
const actionDefs = ACTION_FILES.flatMap((f) => validateSequences({ [f]: files[f] }));
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
  assert.equal(actionDefs.length, 17);
  // `researcher_b_creature`: what grows out of Voss in the drop's kill (infection-kills spec), gone through the door at contact.
  const npcSet = new Set([...npcIds, 'giles', 'okafor', 'r08_thing', 'researcher_b_creature']);
  for (const def of actionDefs) {
    walk(def.steps, (s) => {
      const where = `${def.id}: ${String(s['do'])}`;
      if (s['do'] === 'say') {
        assert.ok(library.hasLine(s['line'] as string), `${where} line ${String(s['line'])}`);
        assert.equal(library.line(s['line'] as string).priority, 'story', `${where} ${String(s['line'])} must be story priority`);
      }
      if (s['do'] === 'sfx') assert.ok((s['id'] as string) in SOUND_SPECS, `${where} sound ${String(s['id'])}`);
      if (s['do'] === 'setObjective' || s['do'] === 'completeObjective') assert.ok(String(s['id']) in objectives, `${where} objective ${String(s['id'])}`);
      if (s['do'] === 'doorState') assert.ok(doorIds.has(s['id'] as string), `${where} door ${String(s['id'])}`);
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

test('gameplay beats are not skippable and resume after death; the reveal and the stinger can be skipped', () => {
  for (const id of ['contact', 'cover_me', 'armory_auto', 'sec_glass', 'medlab_door', 'tunnel_enter', 'valve_turn', 'climax']) {
    assert.notEqual(byId.get(id)?.skippable, true, `${id} stays unskippable`);
    assert.equal(byId.get(id)?.resumeFromCheckpoint, true, `${id} resumes from its checkpoint`);
  }
  for (const id of ['cliffhanger', 'stinger_priya']) assert.equal(byId.get(id)?.skippable, true, id);
  assert.notEqual(byId.get('title_card')?.skippable, true);
  for (const id of ['sec_glass', 'cliffhanger', 'title_card', 'stinger_priya']) assert.equal(byId.get(id)?.exclusive, 'rails', id);
});

test('the checkpoint ladder: data checkpoints on room entry plus one sequence checkpoint per finished beat', () => {
  const ids = new Set<string>(level.checkpoints.map((c: any) => c.id));
  for (const id of ['cp_first_contact', 'cp_cover_me', 'cp_security', 'cp_flooded', 'cp_climax']) assert.ok(ids.has(id), id);
  const taken: string[] = [];
  for (const def of actionDefs) walk(def.steps, (s) => s['do'] === 'checkpoint' && taken.push(String(s['id'])));
  assert.deepEqual(taken, ['cp_contact_clear', 'cp_cover_done', 'cp_security_done', 'cp_valve', 'cp_climax_won']);
});

test('slice01 level numbers: 1 + 3 + 6 + 14 enemies, a hero, spawn counts per group', () => {
  const spawns = level.rooms.flatMap((r: any) => r.spawns ?? []);
  const total = (g: string): number => spawns.filter((s: any) => s.group === g).reduce((n: number, s: any) => n + (s.count ?? 1), 0);
  assert.equal(total('r05_contact'), 1);
  assert.equal(total('r05_trickle'), 3);
  assert.equal(total('r06_cover'), 6);
  assert.equal(total('r11_climax'), 14);
  assert.ok(spawns.some((s: any) => s.group === 'r11_climax' && s.variant === 'hero'));
});

// ------------------------------------------------------------------------------- harness

interface Task {
  step: Record<string, unknown>;
  resolve: () => void;
}

function makeGame(only?: string[]) {
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
    walkTo: () => Promise.resolve(),
    placePlayer: () => void log.push('place'),
    fade: (level) => void log.push(`fade ${level}`),
    cameraShake: () => void log.push('shake'),
    sfx: (id) => void log.push(`sfx ${id}`),
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
    cameraFeed: (id, opts) => (feeds.push(opts), void log.push(`feed ${id} ${opts.state}${opts.fullscreen ? ' fullscreen' : ''}`)),
    radio: (track) => void log.push(track ? `radio ${track}` : 'radio stop'),
    gore: (kind) => void log.push(`gore ${kind}`),
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
    npc: (action, step) => {
      log.push(`npc ${action} ${String(step['npc'])}${step['anim'] ? ` ${String(step['anim'])}` : ''}${step['task'] ? ` ${String(step['task'])}` : ''}${step['instant'] ? ' instant' : ''}`);
      if (action === 'npcTask' && step['wait'] !== false) return new Promise<void>((resolve) => tasks.push({ step, resolve }));
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
  return { m, host, log, control, feeds, tasks, groups, cards, clear, finishTask, ended: () => ended };
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

// ------------------------------------------------------------------------------- beat 3: first contact

test('R05 first contact: knocks, the door gives, legs, the revive rule, the trickle, then the door opens and cp_contact_clear', async () => {
  const g = makeGame();
  fire(g, 'trigger:r05_enter');
  assert.equal(g.m.isRunning('contact'), false, 'needs the drop first');
  setFlags(g, { drop_done: true });
  fire(g, 'trigger:r05_enter');
  assert.equal(g.m.isRunning('contact'), true);
  assert.equal(g.m.skip(), false, 'not skippable');
  assert.ok(at(g, 'door D_R05_R06 sealed') >= 0, 'the way on stays shut during the fight');
  await until(g, () => g.groups.get('r05_contact')!.triggered);
  inOrder(g, ['sfx metalKnock', ...lines('contact_giles_01', 'contact_okafor_01'), 'door D_R04_R05 open', 'group r05_contact']);
  await until(g, () => said(g, 'contact_okafor_03') === 1);
  assert.equal(said(g, 'contact_after_01'), 0, 'the legs lesson waits for the kill');
  g.clear('r05_contact');
  await until(g, () => g.groups.get('r05_trickle')!.triggered);
  inOrder(g, [...lines('contact_okafor_03', 'contact_after_01', 'okafor_revive_rule_01'), 'group r05_trickle']);
  await until(g, () => said(g, 'contact_okafor_02') === 1);
  assert.equal(g.host.flags['contact_done'], undefined);
  g.clear('r05_trickle');
  await until(g, () => !g.m.isRunning('contact'));
  assert.equal(g.host.flags['contact_done'], true);
  assert.ok(at(g, 'door D_R05_R06 closed') > at(g, 'group r05_trickle'));
  assert.equal(count(g, 'checkpoint cp_contact_clear'), 1);
  assert.equal(g.host.flags['radio_place'], 'ruined', 'TAG FM plays in the ruined junction, set before the checkpoint');
  assert.ok(at(g, 'radio tag_fm_01') >= 0 && at(g, 'radio tag_fm_01') < at(g, 'checkpoint cp_contact_clear'));
  assert.equal(g.control.state.move, 'free');
  noWarnings(g);
  fire(g, 'trigger:r05_enter');
  assert.equal(g.m.isRunning('contact'), false, 'never twice');
});

test('dying during first contact restarts the beat from its checkpoint; dying after its checkpoint does not', async () => {
  const g = makeGame();
  setFlags(g, { drop_done: true });
  fire(g, 'trigger:r05_enter');
  await until(g, () => g.groups.get('r05_contact')!.triggered);
  g.host.events.emit('player:died', {});
  assert.equal(g.m.isRunning('contact'), false);
  g.groups.get('r05_contact')!.triggered = false;
  g.host.events.emit('game:restarted', { checkpoint: 'cp_first_contact' });
  assert.equal(g.m.isRunning('contact'), true, 'replayed from step 0');
  await until(g, () => g.groups.get('r05_contact')!.triggered);
  assert.equal(count(g, 'group r05_contact'), 2);
  g.clear('r05_contact');
  await until(g, () => g.groups.get('r05_trickle')!.triggered);
  g.clear('r05_trickle');
  await until(g, () => !g.m.isRunning('contact'));
  g.host.events.emit('player:died', {});
  g.host.events.emit('game:restarted', { checkpoint: 'cp_contact_clear' });
  assert.equal(g.m.isRunning('contact'), false, 'the beat is done, the checkpoint holds it');
});

// ------------------------------------------------------------------------------- beat 4: cover me

test('R06 cover me: Giles bypasses for 20 s, 6 come, the door opens at the bypass, the stage-1 tell after the last one dies', async () => {
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
  inOrder(g, [...lines('giles_cover_01'), 'group r06_cover']);
  assert.equal(g.host.flags['obj:obj_hold_door'], 'active');
  assert.equal(at(g, 'door D_R06_R07 open'), -1, 'locked until Giles is done');
  g.finishTask();
  await advance(g, 0.2);
  assert.ok(at(g, 'door D_R06_R07 open') >= 0);
  assert.equal(g.host.flags['giles.infectionStage'], undefined, 'the tell waits for the fight to end');
  await advance(g, 3);
  assert.equal(said(g, 'cover_giles_03'), 0);
  g.clear('r06_cover');
  await until(g, () => !g.m.isRunning('cover_me'));
  inOrder(g, [...lines('cover_giles_02', 'cover_giles_03', 'cover_okafor_01', 'cover_giles_04'), 'checkpoint cp_cover_done']);
  assert.ok(at(g, 'npc npcAnim giles flex_hand') >= 0 && at(g, 'npc npcAnim okafor glance') >= 0);
  assert.equal(g.host.flags['giles.infectionStage'], 1);
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

const COVER_DONE = { drop_done: true, contact_done: true, cover_done: true, 'giles.infectionStage': 1 };

test('R07 armory: Priya is placed in the medical bay, Giles bypasses the armory door on his own and opens it', async () => {
  const g = makeGame();
  fire(g, 'trigger:r07_enter');
  assert.equal(g.m.isRunning('armory_auto'), false, 'needs cover me done');
  setFlags(g, COVER_DONE);
  fire(g, 'trigger:r07_enter');
  assert.ok(at(g, 'npc npcMoveTo priya instant') >= 0, 'Priya is in R08 for the player to see through the glass');
  assert.equal(g.host.flags['obj:obj_armory'], 'active');
  await until(g, () => g.tasks.length === 1);
  assert.equal(g.tasks[0]!.step['task'], 'bypass_short');
  assert.equal(at(g, 'door D_R07_R07a open'), -1);
  g.finishTask();
  await until(g, () => !g.m.isRunning('armory_auto'));
  inOrder(g, [...lines('sec_giles_01', 'sec_giles_02')]);
  assert.ok(at(g, 'door D_R07_R07a open') >= 0);
  assert.equal(g.host.flags['armory_open'], true);
  assert.equal(g.m.isRunning('sec_glass'), false, 'no glass scene before the player is at the glass');
  noWarnings(g);
});

async function armoryThenGlass(g: Game): Promise<void> {
  setFlags(g, COVER_DONE);
  fire(g, 'trigger:r07_enter');
  await until(g, () => g.tasks.length === 1);
  g.finishTask();
  await until(g, () => !g.m.isRunning('armory_auto'));
}

test('the glass scene starts when BOTH the armory is open and Jay is at the glass, in either order', async () => {
  const a = makeGame();
  await armoryThenGlass(a);
  fire(a, 'trigger:r08_glass');
  assert.equal(a.m.isRunning('sec_glass'), true, 'armory first, then the glass');
  const b = makeGame();
  setFlags(b, COVER_DONE);
  fire(b, 'trigger:r07_enter');
  fire(b, 'trigger:r08_glass');
  assert.equal(b.m.isRunning('sec_glass'), false, 'the glass first: the scene waits for the armory');
  assert.equal(b.host.flags['glass_near'], true);
  await until(b, () => b.tasks.length === 1);
  b.finishTask();
  await advance(b, 0.5);
  assert.equal(b.m.isRunning('sec_glass'), true, 'and starts the moment the door is open');
});

test('walking into Security before the cover fight ends: the armory bypass and the glass scene still play once each', async () => {
  const g = makeGame();
  setFlags(g, { drop_done: true, contact_done: true });
  fire(g, 'trigger:r06_door');
  await until(g, () => g.tasks.length === 1);
  g.finishTask();
  await advance(g, 0.2);
  assert.ok(at(g, 'door D_R06_R07 open') >= 0, 'the pressure door is open mid-fight');
  // Jay goes straight through while r06_cover is still alive: both one-shot triggers fire before cover_done.
  fire(g, 'trigger:r07_enter');
  fire(g, 'trigger:r08_glass');
  assert.equal(g.m.isRunning('armory_auto'), false);
  assert.equal(g.host.flags['cover_done'], undefined);
  g.clear('r06_cover');
  await until(g, () => !g.m.isRunning('cover_me'));
  assert.equal(g.host.flags['cover_done'], true);
  await until(g, () => g.tasks.length === 1);
  assert.equal(g.tasks[0]!.step['task'], 'bypass_short', 'Giles goes to the armory panel');
  g.finishTask();
  await until(g, () => g.m.isRunning('sec_glass'));
  g.clear('r07_playdead');
  await until(g, () => !g.m.isRunning('sec_glass'), 120);
  assert.equal(g.host.flags['sec_done'], true);
  assert.equal(count(g, 'checkpoint cp_security_done'), 1);
  assert.equal(count(g, 'say sec_giles_01'), 1, 'the armory beat ran once');
  noWarnings(g);
});

test('trying the biometric door early starts the glass scene anyway (a latched trigger cannot strand the player)', async () => {
  const g = makeGame();
  setFlags(g, COVER_DONE);
  g.host.events.emit('door:denied', { id: 'D_R07_R09', reason: 'x' });
  assert.equal(g.m.isRunning('sec_glass'), true);
  assert.ok(at(g, 'door D_R07_R07a open') >= 0);
  const other = makeGame();
  setFlags(other, COVER_DONE);
  other.host.events.emit('door:denied', { id: 'D_R06_R07', reason: 'x' });
  assert.equal(other.m.isRunning('sec_glass'), false, 'only that door');
});

test('the glass scene waits for the play-dead (or 20 s), then locks Jay in, plays Priya and ends with the bandage and cp_security_done', async () => {
  const g = makeGame();
  await armoryThenGlass(g);
  g.groups.get('r07_playdead')!.triggered = true;
  fire(g, 'trigger:r08_glass');
  await advance(g, 10);
  assert.equal(g.control.state.move, 'free', 'a live play-dead is dealt with first');
  g.clear('r07_playdead');
  await advance(g, 0.5);
  assert.equal(g.control.state.move, 'locked');
  assert.equal(g.control.state.weapons, false);
  assert.equal(g.m.skip(), false, 'Priya cannot be skipped');
  await until(g, () => !g.m.isRunning('sec_glass'), 120);
  inOrder(g, [
    ...lines('sec_okafor_01', 'sec_okafor_02', 'sec_priya_01', 'sec_okafor_03', 'sec_priya_04', 'sec_priya_02', 'sec_priya_03', 'sec_okafor_04', 'sec_okafor_05', 'sec_giles_03', 'sec_giles_05', 'sec_okafor_07', 'giles_cut_01', 'sec_okafor_06', 'sec_giles_04'),
    'checkpoint cp_security_done',
  ]);
  // Gruesome through the glass: blood climbs in three levels, the pane cracks, gore of every kind, a drag trail.
  for (const kind of ['burst', 'splash', 'chunks', 'pool']) assert.ok(at(g, `gore ${kind}`) >= 0, `gore ${kind}`);
  assert.equal(count(g, 'event glass:blood'), 3);
  assert.ok(at(g, 'glass medbay cracked') > at(g, 'event glass:blood') && at(g, 'sfx bodyDrag') > at(g, 'glass medbay cracked'));
  // She survives: hidden in the surgery, the attacker removed, the sealed door shut again.
  assert.ok(g.log.indexOf('npc spawn r08_thing') >= 0 && g.log.indexOf('npc despawn r08_thing') > g.log.indexOf('npc spawn r08_thing'));
  const hide = g.log.lastIndexOf('npc npcMoveTo priya instant');
  assert.ok(hide > at(g, 'sfx bodyDrag'), 'Priya ends hidden, not dead');
  assert.ok(g.log.lastIndexOf('door D_R08_R08b closed') > g.log.lastIndexOf('door D_R08_R08b open'));
  // Foreshadow 2 and the stage.
  assert.equal(g.host.flags['giles.infectionStage'], 2);
  assert.ok(at(g, 'npc npcAnim giles rub_forearm') > at(g, 'say sec_okafor_07'));
  assert.equal(g.control.state.move, 'free');
  assert.equal(g.control.state.weapons, true);
  assert.equal(g.host.flags['sec_done'], true);
  assert.equal(g.host.flags['obj:obj_medlab'], 'active');
  noWarnings(g);
});

test('a play-dead that never rises is removed after 20 s so it cannot attack Jay while he is locked in', async () => {
  const g = makeGame();
  await armoryThenGlass(g);
  g.groups.get('r07_playdead')!.triggered = true;
  fire(g, 'trigger:r08_glass');
  await advance(g, 19);
  assert.equal(count(g, 'despawnGroup r07_playdead'), 0);
  await advance(g, 2);
  assert.equal(count(g, 'despawnGroup r07_playdead'), 1);
  assert.equal(g.control.state.move, 'locked');
});

test('dying during the Priya scene replays it from the start; the control stack always comes back', async () => {
  const g = makeGame();
  await armoryThenGlass(g);
  fire(g, 'trigger:r08_glass');
  await advance(g, 26);
  assert.equal(g.control.state.move, 'locked');
  g.host.events.emit('player:died', {});
  assert.equal(g.control.state.move, 'free', 'control released on death');
  g.host.events.emit('game:restarted', { checkpoint: 'cp_security' });
  assert.equal(g.m.isRunning('sec_glass'), true);
  await until(g, () => !g.m.isRunning('sec_glass'), 120);
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
  assert.equal(g.host.flags['giles.infectionStage'], 3);
  assert.equal(g.host.flags['obj:obj_valve'], 'active');
  noWarnings(g);
});

test('the valve: Giles says the only word about Mara, the objective moves on, cp_valve is taken', async () => {
  const g = makeGame();
  setFlags(g, { ...COVER_DONE, sec_done: true, medlab_open: true, tunnel_started: true, 'giles.infectionStage': 3 });
  fire(g, 'valve:r10_main');
  assert.equal(g.m.isRunning('valve_turn'), true);
  await until(g, () => !g.m.isRunning('valve_turn'));
  inOrder(g, [...lines('valve_giles_01', 'valve_quiet_giles_01', 'valve_quiet_giles_02', 'valve_quiet_okafor_01'), 'checkpoint cp_valve']);
  assert.equal(g.host.flags['valve_done'], true);
  assert.equal(g.host.flags['obj:obj_valve'], 'done');
  assert.equal(g.host.flags['obj:obj_power'], 'active');
  assert.equal(g.control.state.move, 'free', 'the Mara moment never takes Jay\'s controls');
  fire(g, 'valve:r10_main');
  assert.equal(said(g, 'valve_giles_01'), 1, 'once');
  noWarnings(g);
});

// ------------------------------------------------------------------------------- beat 7: the climax

const VALVE_DONE = { ...COVER_DONE, sec_done: true, medlab_open: true, tunnel_started: true, valve_done: true, 'giles.infectionStage': 3 };

test('R11 climax: needs the valve; both entrances open; 30 s power job; halfway call at 50 %; won only when the job AND all 14 are done', async () => {
  const g = makeGame(['climax', 'climax_hero']);
  fire(g, 'trigger:r11_enter');
  assert.equal(g.m.isRunning('climax'), false, 'the valve first');
  setFlags(g, VALVE_DONE);
  fire(g, 'trigger:r11_enter');
  assert.equal(g.m.isRunning('climax'), true);
  assert.equal(g.m.skip(), false);
  await until(g, () => g.tasks.length === 1);
  assert.ok(at(g, 'door D_R10_R11 open') >= 0 && at(g, 'door D_R13d_R11 open') >= 0, 'two entrances');
  assert.equal(g.tasks[0]!.step['task'], 'power_restore');
  assert.equal((g.tasks[0]!.step['args'] as Record<string, unknown>)['duration'], 30);
  inOrder(g, [...lines('climax_giles_01'), 'group r11_climax']);
  await until(g, () => said(g, 'climax_okafor_01') === 1);
  g.host.events.emit('squad:taskProgress', { id: 'engineer', task: 'power_restore', panel: null, progress: 0.4 });
  await advance(g, 1);
  assert.equal(said(g, 'climax_giles_02'), 0);
  g.host.events.emit('squad:taskProgress', { id: 'engineer', task: 'power_restore', panel: null, progress: 0.52 });
  await advance(g, 1);
  assert.equal(said(g, 'climax_giles_02'), 1);
  // The job finishes first: still holding until the last enemy falls.
  g.finishTask();
  await advance(g, 4);
  assert.equal(g.host.flags['climax_done'], undefined);
  assert.equal(said(g, 'climax_giles_03'), 0);
  g.clear('r11_climax');
  await until(g, () => !g.m.isRunning('climax'));
  assert.equal(said(g, 'climax_giles_03'), 1);
  assert.ok(at(g, 'door D_R10_R11 sealed') > at(g, 'say climax_giles_03') && at(g, 'door D_R13d_R11 sealed') > 0);
  assert.equal(count(g, 'event climax:won'), 1);
  assert.equal(g.host.flags['climax_done'], true);
  assert.equal(g.host.flags['obj:obj_power'], 'done');
  noWarnings(g);
});

test('the climax is won in either order: all 14 dead first, then the power job', async () => {
  const g = makeGame(['climax']);
  setFlags(g, VALVE_DONE);
  fire(g, 'trigger:r11_enter');
  await until(g, () => g.tasks.length === 1);
  g.clear('r11_climax');
  await advance(g, 5);
  assert.equal(g.host.flags['climax_done'], undefined, 'the job is not done');
  g.finishTask();
  await until(g, () => g.host.flags['climax_done'] === true);
  assert.equal(count(g, 'event climax:won'), 1);
});

test('the hero gets one line from Okafor, only during the climax', async () => {
  const g = makeGame(['climax', 'climax_hero']);
  g.host.events.emit('enemy:spawned', { id: 'a', variant: 'hero', group: 'r11_climax' });
  await advance(g, 3);
  assert.equal(said(g, 'climax_okafor_02'), 0, 'not before the climax');
  setFlags(g, VALVE_DONE);
  fire(g, 'trigger:r11_enter');
  g.host.events.emit('enemy:spawned', { id: 'b', variant: 'shambler', group: 'r11_climax' });
  await advance(g, 3);
  assert.equal(said(g, 'climax_okafor_02'), 0, 'only the hero');
  g.host.events.emit('enemy:spawned', { id: 'c', variant: 'hero', group: 'r11_climax' });
  await advance(g, 3);
  assert.equal(said(g, 'climax_okafor_02'), 1);
});

test('dying in the climax replays it from cp_climax with the entrances open again and the group free to spawn', async () => {
  const g = makeGame(['climax']);
  setFlags(g, VALVE_DONE);
  fire(g, 'trigger:r11_enter');
  await until(g, () => g.tasks.length === 1);
  g.host.events.emit('player:died', {});
  g.tasks.length = 0;
  g.groups.get('r11_climax')!.triggered = false;
  g.host.events.emit('game:restarted', { checkpoint: 'cp_climax' });
  assert.equal(g.m.isRunning('climax'), true);
  await until(g, () => g.tasks.length === 1);
  assert.equal(count(g, 'group r11_climax'), 2);
});

// ------------------------------------------------------------------------------- beat 8: reveal, title card, stinger

const WON = { ...VALVE_DONE, climax_started: true, climax_done: true };
const REVEAL_LINES = ['end_okafor_01', 'end_giles_01', 'end_jay_01', 'end_giles_02', 'giles_reveal_01', 'end_giles_03', 'end_giles_04', 'end_giles_05', 'end_jay_02', 'end_okafor_02', 'end_giles_06'];
const STINGER_LINES = ['stinger_priya_01', 'stinger_priya_02', 'stinger_priya_04', 'stinger_priya_05', 'stinger_priya_03'];

test('cliffhanger to endSlice: banter, lights and trail, "I didn\'t want you to see this", Okafor steps in, "Stay back, Tomas.", black, title card, the stinger feed, end', async () => {
  const g = makeGame();
  setFlags(g, WON);
  g.host.events.emit('climax:won', {});
  assert.equal(g.m.isRunning('cliffhanger'), true);
  assert.equal(g.control.state.move, 'locked');
  assert.equal(g.control.state.weapons, false);
  await until(g, () => said(g, 'end_giles_02') === 1);
  assert.equal(g.host.flags['giles.infectionStage'], 3, 'the change waits for the lights');
  assert.equal(count(g, 'event reveal:trail'), 0);
  await until(g, () => said(g, 'giles_reveal_01') === 1);
  assert.equal(g.host.flags['giles.infectionStage'], 4);
  assert.equal(count(g, 'event reveal:trail'), 1);
  assert.ok(at(g, 'light R11 steady none') >= 0, 'the lights come back');
  assert.ok(at(g, 'event reveal:trail') < at(g, 'say giles_reveal_01'), 'the trail is visible before he speaks');
  assert.ok(at(g, 'clamp') >= 0 && at(g, 'clamp') < at(g, 'say giles_reveal_01'), 'the view is soft-locked on him');
  await until(g, () => said(g, 'end_giles_06') === 1);
  // The change begins, Okafor steps toward him: both before the last line.
  assert.ok(g.log.some((e) => e === 'npc transform giles'));
  assert.ok(g.log.lastIndexOf('npc npcMoveTo okafor') > at(g, 'say end_jay_02') && at(g, 'say end_okafor_02') < at(g, 'say end_giles_06'));
  await until(g, () => g.ended() === 1, 120);
  inOrder(g, lines(...REVEAL_LINES));
  inOrder(g, [...lines('end_giles_06'), 'fade 1', 'event story:cliffhanger', 'feed stinger live fullscreen', ...lines(...STINGER_LINES), 'feed stinger static fullscreen', 'fade 1', 'feed stinger off fullscreen']);
  assert.deepEqual(g.cards, ['THALASSA']);
  assert.ok(at(g, 'event story:cliffhanger') < at(g, 'event story:title_done') && at(g, 'event story:title_done') < at(g, 'feed stinger live fullscreen'));
  assert.equal(g.ended(), 1);
  assert.equal(g.control.state.move, 'free', 'every control layer is released at the end');
  assert.ok(g.feeds[0]!.fullscreen && g.feeds[0]!.state === 'live');
  // camera-feeds spec: the stinger is sharp and smooth, with the fullscreen look.
  assert.equal(g.feeds[0]!.fps, 30);
  assert.deepEqual(g.feeds[0]!.size, { w: 960, h: 540 });
  assert.equal(g.feeds[0]!.look, 'fullscreen');
  assert.ok(count(g, 'gore splash') >= 1, 'the stinger');
  noWarnings(g);
});

test('skipping the reveal applies its end state, then the title card and the stinger still play to endSlice', async () => {
  const g = makeGame();
  setFlags(g, WON);
  g.host.events.emit('climax:won', {});
  await until(g, () => said(g, 'end_giles_01') === 1);
  assert.equal(g.m.skippable, true);
  assert.equal(g.m.skip(), true);
  assert.equal(g.m.isRunning('cliffhanger'), false);
  assert.equal(g.host.flags['giles.infectionStage'], 4);
  assert.equal(count(g, 'event reveal:trail'), 1);
  assert.ok(at(g, 'light R11 steady none') >= 0);
  assert.ok(at(g, 'fade 1') >= 0);
  assert.equal(count(g, 'event story:cliffhanger'), 1);
  for (const l of REVEAL_LINES.slice(2)) assert.ok(g.log.includes(`played ${l}`) || said(g, l) === 1, `${l} played or marked played`);
  assert.equal(g.ended(), 0, 'the end is still ahead');
  assert.equal(g.m.isRunning('title_card'), true);
  assert.equal(g.m.skip(), false, 'the title card is not skippable');
  await until(g, () => g.ended() === 1, 120);
  assert.deepEqual(g.cards, ['THALASSA']);
  assert.equal(g.control.state.move, 'free');
  noWarnings(g);
});

test('skipping the stinger ends the slice at once with the feed off; skipping right at the start of the reveal works too', async () => {
  const g = makeGame();
  setFlags(g, WON);
  g.host.events.emit('climax:won', {});
  g.m.skip();
  await until(g, () => g.m.isRunning('stinger_priya'), 60);
  await advance(g, 1);
  assert.equal(g.ended(), 0);
  assert.equal(g.m.skip(), true);
  assert.equal(g.ended(), 1);
  assert.equal(g.feeds.at(-1)!.state, 'off');
  assert.equal(g.m.isRunning('stinger_priya'), false);
  assert.equal(g.control.state.move, 'free');
  assert.equal(count(g, 'npc spawn r08_thing instant') + count(g, 'npc spawn r08_thing'), 1);
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
  fire(g, 'trigger:r07_enter');
  fire(g, 'trigger:r08_glass');
  await settle('sec_done');
  g.host.events.emit('door:denied', { id: 'D_R07_R09', reason: 'x' });
  await settle('medlab_open');
  fire(g, 'trigger:r09_enter');
  await settle('tunnel_started');
  fire(g, 'trigger:r10_enter');
  fire(g, 'valve:r10_main');
  await settle('valve_done');
  fire(g, 'trigger:r11_enter');
  await settle('climax_done');
}

test('the whole action half runs from drop:done to endSlice with every checkpoint, in order, no warnings, controls free at the end', async () => {
  const g = makeGame();
  const events: string[] = [];
  await playThrough(g, events);
  await until(g, () => g.ended() === 1, 200);
  const cps = g.log.filter((e) => e.startsWith('checkpoint ')).map((e) => e.slice(11));
  assert.deepEqual(cps, ['cp_contact_clear', 'cp_cover_done', 'cp_security_done', 'cp_valve', 'cp_climax_won']);
  const stages = ['giles.infectionStage'];
  assert.equal(g.host.flags[stages[0]!], 4);
  assert.equal(g.ended(), 1);
  assert.deepEqual(g.cards, ['THALASSA']);
  assert.equal(g.control.state.move, 'free');
  assert.equal(g.control.state.weapons, true);
  assert.equal(g.m.running().length, 0, 'nothing left running');
  // Tell ladder (ADR-0022) in the order it was raised.
  const tellOrder = ['npc npcAnim giles flex_hand', 'npc npcAnim giles rub_forearm', 'npc npcAnim giles cough'].map((e) => at(g, e));
  assert.ok(tellOrder[0]! < tellOrder[1]! && tellOrder[1]! < tellOrder[2]!);
  noWarnings(g);
});

test('every dialogue line of the action half is played at least once on the way (nothing orphaned)', async () => {
  const g = makeGame();
  await playThrough(g, []);
  await until(g, () => g.ended() === 1, 200);
  const used = new Set<string>();
  for (const def of actionDefs) walk(def.steps, (s) => s['do'] === 'say' && used.add(String(s['line'])));
  // Everything the sequences can say was said in this run except the hero call (a separate trigger).
  for (const l of used) if (l !== 'climax_okafor_02') assert.ok(said(g, l) >= 1, `${l} was said`);
  assert.ok(used.has('climax_okafor_02'));
  // And the action half has a voice for every beat of ADR-0014: Okafor's legs, revive rule, "Stay back, Tomas."
  for (const l of ['contact_okafor_03', 'okafor_revive_rule_01', 'end_giles_06', 'giles_cut_01']) assert.ok(used.has(l), l);
});

// ------------------------------------------------------------------------------- loads and restarts

test('a load or restart puts the doors the finished beats opened back, from the saved flags, and does nothing on a fresh game', () => {
  const fresh = makeGame(['action_restore']);
  fresh.host.events.emit('game:mode', { mode: 'playing' });
  assert.equal(fresh.log.filter((e) => e.startsWith('door ')).length, 0);
  const g = makeGame(['action_restore']);
  setFlags(g, { ...COVER_DONE, drop_started: true, armory_open: true, sec_done: true, medlab_open: true, valve_done: true });
  g.host.events.emit('game:mode', { mode: 'title' });
  assert.equal(g.log.filter((e) => e.startsWith('door ')).length, 0, 'only on playing');
  g.host.events.emit('game:mode', { mode: 'playing' });
  for (const d of ['D_R03_R05 closed', 'D_R05_R06 closed', 'D_R06_R07 open', 'D_R07_R07a open', 'D_R07_R09 open', 'D_R10_R11 closed']) assert.ok(at(g, `door ${d}`) >= 0, d);
  assert.equal(at(g, 'door D_R10_R11 sealed'), -1);
  setFlags(g, { climax_done: true });
  g.host.events.emit('game:mode', { mode: 'playing' });
  assert.ok(at(g, 'door D_R10_R11 sealed') >= 0 && at(g, 'door D_R13d_R11 sealed') >= 0);
  noWarnings(g);
});

test('a counted loop inside a skipped sequence applies its body (a block, not an event loop)', () => {
  const d = validateSequences({
    'x.json': { id: 'blk', skippable: true, steps: [{ do: 'wait', s: 99 }, { do: 'loop', count: 1, steps: [{ do: 'say', line: 'end_giles_06' }, { do: 'setFlag', flag: 'blockDone' }] }] },
  });
  const g = makeGame();
  const m = new SequenceManager(g.host, d);
  m.start('blk');
  assert.equal(m.skip(), true);
  assert.equal(g.host.flags['blockDone'], true);
  assert.ok(g.log.includes('played end_giles_06'));
});

test('every gore step in Priya\'s scene carries the glass clip, and the clip reaches the host', () => {
  const sec = actionDefs.find((d) => d.id === 'sec_glass')!;
  let n = 0;
  walk(sec.steps, (st) => {
    if (st['do'] !== 'gore') return;
    n++;
    assert.equal(st['clipAxis'], 'z');
    assert.equal(st['clipKeep'], 'above');
    assert.ok(Number(st['clipAt']) > 46 && Number(st['clipAt']) < 46.5);
  });
  assert.ok(n >= 6);
  const g = makeGame();
  let seen: unknown;
  g.host.gore = (_k, _a, _d, _c, _s, clip) => void (seen = clip);
  const d = validateSequences({ 'x.json': { id: 'cl', steps: [{ do: 'gore', at: [1, 1, 47], kind: 'burst', clipAxis: 'z', clipAt: 46.05, clipKeep: 'above' }] } });
  new SequenceManager(g.host, d).start('cl');
  assert.deepEqual(seen, { axis: 'z', at: 46.05, keep: 'above' });
  assert.throws(() => validateSequences({ 'x.json': { id: 'bad', steps: [{ do: 'gore', at: [0, 0, 0], kind: 'burst', clipAxis: 'w' }] } }));
});

test('the climax takes cp_climax_won before the reveal; a reload there replays the reveal, not the fight', async () => {
  const g = makeGame(['climax']);
  setFlags(g, VALVE_DONE);
  fire(g, 'trigger:r11_enter');
  await until(g, () => g.tasks.length === 1);
  g.clear('r11_climax');
  g.finishTask();
  await until(g, () => g.host.flags['climax_done'] === true);
  assert.ok(at(g, 'checkpoint cp_climax_won') >= 0, 'checkpoint taken');
  assert.ok(at(g, 'checkpoint cp_climax_won') < at(g, 'event climax:won'), 'before the reveal starts');
  // Reload from that autosave in a fresh session: flags as saved (no seq:cliffhanger yet), the group cleared.
  const saved = { ...VALVE_DONE, climax_started: true, climax_done: true, 'group:r11_climax': 'cleared', 'cp:cp_climax_won': true };
  const r = makeGame(['reveal_restore', 'cliffhanger']);
  setFlags(r, saved);
  r.host.events.emit('game:mode', { mode: 'playing' });
  await until(r, () => r.m.isRunning('cliffhanger'));
  assert.equal(count(r, 'group r11_climax'), 0, 'the fight does not replay');
  assert.equal(r.host.flags['giles.infectionStage'], 3);
  assert.ok(at(r, 'light R11 dying emergency') >= 0, 'lights as they were before the reveal');
  assert.ok(at(r, 'npc npcMoveTo giles instant') >= 0 && at(r, 'npc npcMoveTo okafor instant') >= 0, 'squad placed');
  // Pause and resume mid-reveal must not start a second one.
  const before = count(r, 'event sequence:started');
  r.host.events.emit('game:mode', { mode: 'paused' });
  r.host.events.emit('game:mode', { mode: 'playing' });
  assert.equal(count(r, 'event sequence:started') - before, 1, 'only the restore itself, no second cliffhanger');
  assert.equal(r.log.filter((e) => e === 'event climax:won').length, 1);
});

test('after the slice ends (reveal_done) a load does not replay the reveal; a fresh game never does', () => {
  const done = makeGame(['reveal_restore', 'cliffhanger']);
  setFlags(done, { climax_done: true, reveal_done: true });
  done.host.events.emit('game:mode', { mode: 'playing' });
  assert.equal(done.m.isRunning('cliffhanger'), false);
  const fresh = makeGame(['reveal_restore', 'cliffhanger']);
  fresh.host.events.emit('game:mode', { mode: 'playing' });
  assert.equal(fresh.log.filter((e) => e === 'event climax:won').length, 0);
});

test('a manual save taken mid-reveal replays the reveal on load, and never twice while it plays', async () => {
  // Saved flags: the reveal had started (seq:cliffhanger is remembered) but not finished.
  const saved = { ...VALVE_DONE, climax_started: true, climax_done: true, 'group:r11_climax': 'cleared', 'seq:cliffhanger': true, 'cp:cp_climax_won': true };
  const r = makeGame(['reveal_restore', 'cliffhanger', 'title_card', 'stinger_priya']);
  setFlags(r, saved);
  r.host.events.emit('game:mode', { mode: 'playing' });
  await until(r, () => r.m.isRunning('cliffhanger'));
  assert.equal(count(r, 'group r11_climax'), 0, 'no fight');
  assert.equal(r.host.flags['giles.infectionStage'], 3);
  assert.equal(r.host.flags['giles.bandaged'], true);
  assert.equal(count(r, 'event climax:won'), 1);
  // Pause and resume while it plays: nothing restarts.
  const before = count(r, 'event sequence:started');
  r.host.events.emit('game:mode', { mode: 'paused' });
  r.host.events.emit('game:mode', { mode: 'playing' });
  assert.equal(count(r, 'event sequence:started') - before, 1, 'only the (idempotent) restore itself');
  assert.equal(count(r, 'event climax:won'), 1, 'the reveal was not started again');
  // A save taken during the title card or the stinger replays the reveal too, but pausing there does not.
  const t = makeGame(['reveal_restore', 'cliffhanger', 'title_card', 'stinger_priya']);
  setFlags(t, { ...saved, 'seq:title_card': true });
  t.host.events.emit('game:mode', { mode: 'playing' });
  await until(t, () => t.m.isRunning('cliffhanger'));
  assert.equal(t.host.flags['seq:title_card'], false, 'the later beats may play again');
});

test('a death restart into cp_climax_won replays the reveal (the restore is not cancelled by the restart)', async () => {
  const saved = { ...VALVE_DONE, climax_started: true, climax_done: true, 'group:r11_climax': 'cleared', 'cp:cp_climax_won': true };
  const r = makeGame(['reveal_restore', 'cliffhanger']);
  setFlags(r, saved);
  // What the game does: load the autosave (game:mode playing), then announce the restart.
  r.host.events.emit('game:mode', { mode: 'playing' });
  r.host.events.emit('game:restarted', { checkpoint: 'cp_climax_won' });
  await until(r, () => r.m.isRunning('cliffhanger'));
  assert.equal(r.m.isRunning('cliffhanger'), true);
  assert.equal(count(r, 'group r11_climax'), 0, 'no fight');
  assert.equal(r.host.flags['giles.infectionStage'], 3);
  assert.ok(at(r, 'npc npcMoveTo giles instant') >= 0 && at(r, 'npc npcMoveTo okafor instant') >= 0, 'squad placed after the restart');
  // A finished slice does not replay on a restart either.
  const done = makeGame(['reveal_restore', 'cliffhanger']);
  setFlags(done, { climax_done: true, reveal_done: true });
  done.host.events.emit('game:mode', { mode: 'playing' });
  done.host.events.emit('game:restarted', { checkpoint: 'cp_climax_won' });
  assert.equal(done.m.isRunning('cliffhanger'), false);
  assert.equal(count(done, 'event climax:won'), 0);
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
