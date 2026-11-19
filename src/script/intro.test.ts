/**
 * The ADR-0017 opening (data/sequences/intro_shift_change.json). These tests keep it
 * honest: valid schema, every line and sound it names exists, and it plays through
 * headless and skips to the same end state.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ControlStack } from '../actors/control.ts';
import { SOUND_SPECS } from '../audio/sounds.ts';
import { DialogueLibrary } from '../dialogue/library.ts';
import { isParallel } from './actions.ts';
import type { SequenceHost } from './host.ts';
import { SequenceManager } from './runtime.ts';
import { validateSequences } from './schema.ts';
import type { Flags, SequenceDef, Step } from './types.ts';

const json = (rel: string): unknown => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const level = json('../data/levels/slice01.json') as { rooms: Array<{ id: string; anchors?: Array<{ id: string; pos: number[] }> }> };
const draft = json('../data/sequences/intro_shift_change.json');
const [intro] = validateSequences({ 'intro_shift_change.json': draft }) as [SequenceDef];

const library = new DialogueLibrary(json('../data/dialogue/speakers.json'), { slice01: json('../data/dialogue/slice01.json') });

function walk(steps: Step[], visit: (s: Record<string, unknown>) => void): void {
  for (const step of steps) {
    if (isParallel(step)) walk(step.parallel, visit);
    else {
      visit(step);
      const inner = step['steps'];
      if (Array.isArray(inner)) walk(inner as Step[], visit);
    }
  }
}

test('the intro is skippable, runs once, and uses only lines and sounds that exist', () => {
  assert.equal(intro.skippable, true);
  assert.equal(intro.once, true);
  const lines: string[] = [];
  walk(intro.steps, (s) => {
    if (s['do'] === 'say') lines.push(s['line'] as string);
    if (s['do'] === 'sfx') assert.ok((s['id'] as string) in SOUND_SPECS, `unknown sound ${String(s['id'])}`);
  });
  assert.ok(lines.length >= 20);
  for (const id of lines) assert.ok(library.hasLine(id), `missing dialogue line "${id}"`);
  assert.equal(new Set(lines).size, lines.length, 'no line plays twice');
});

test('every intro line is story priority, so the speech queue never drops it', () => {
  walk(intro.steps, (s) => {
    if (s['do'] === 'say') assert.equal(library.line(s['line'] as string).priority, 'story', String(s['line']));
  });
});

test('only Jay, the squad, Priya, crew and the PA speak', () => {
  walk(intro.steps, (s) => {
    if (s['do'] !== 'say') return;
    const speaker = library.line(s['line'] as string).speaker;
    assert.ok(['player', 'engineer', 'medic', 'nurse', 'pa'].includes(speaker) || speaker.startsWith('crew_'), `${String(s['line'])}: ${speaker}`);
  });
});

test('Ruiz and Sung both come in at once, Sung queues until Ruiz is done', () => {
  const moves: string[] = [];
  walk(intro.steps, (s) => {
    if (s['do'] === 'npcMoveTo' && (s['npc'] === 'ruiz' || s['npc'] === 'sung')) moves.push(`${String(s['npc'])}>${String(s['to'])}`);
  });
  assert.deepEqual(moves, [
    'ruiz>anchor:walkby_stop',
    'sung>anchor:walkby_queue',
    'ruiz>anchor:crew_ruiz_commons',
    'sung>anchor:walkby_stop',
    'sung>anchor:crew_sung_commons',
  ]);
});

test('the walk to the kitchen is one banter walk, no window stop', () => {
  const walks: Record<string, unknown>[] = [];
  walk(intro.steps, (s) => {
    assert.ok(!String(s['to'] ?? '').includes('window'), 'no window anchors');
    assert.ok(!String(s['target'] ?? '').includes('window') || s['target'] === 'anchor:dock_window', 'no abyss window shot');
    if (s['do'] === 'playerWalkTo') walks.push(s);
  });
  assert.equal(walks.filter((w) => w['to'] === 'anchor:kitchen_stand').length, 1);
  assert.equal(typeof walks.find((w) => w['to'] === 'anchor:kitchen_stand')!['timeout'], 'number', 'a blocked walk times out instead of hanging the intro');
});

test('Ruiz and Sung walk to their own Commons spots, never the kitchen_door aim point', () => {
  const dests: Record<string, string> = {};
  walk(intro.steps, (s) => {
    if (s['do'] !== 'npcMoveTo') return;
    assert.notEqual(s['to'], 'anchor:kitchen_door', `${String(s['npc'])} must not park in the doorway`);
    if (s['npc'] === 'ruiz' || s['npc'] === 'sung') dests[s['npc']] = String(s['to']);
  });
  assert.deepEqual(dests, { ruiz: 'anchor:crew_ruiz_commons', sung: 'anchor:crew_sung_commons' }, 'the last move of each decides where they end up');
  const r02 = level.rooms.find((r) => r.id === 'R02')!;
  for (const id of ['crew_ruiz_commons', 'crew_sung_commons']) {
    const a = r02.anchors!.find((x) => x.id === id);
    assert.ok(a, `anchor ${id} exists in R02`);
    assert.equal(a.pos[1], 0, 'on the floor');
    assert.ok(Math.hypot(a.pos[0]! - 24, a.pos[2]! - 10) >= 2.5, 'clear of the doorway');
  }
});

test('Jay walks to the kitchen in one continuous walk at the NPCs speed, no walk_mid stop', () => {
  const walks: Record<string, unknown>[] = [];
  walk(intro.steps, (s) => {
    if (s['do'] === 'playerWalkTo') walks.push(s);
  });
  assert.ok(!walks.some((w) => w['to'] === 'anchor:walk_mid'));
  assert.equal(walks.length, 1);
  assert.equal(walks[0]!['speed'], 1.3);
  assert.equal(walks[0]!['wait'], true);
});

test('the intro uses speaker shots for its group conversations', () => {
  let speakerShots = 0;
  walk(intro.steps, (s) => {
    if (s['do'] === 'playerFrame' && s['target'] === 'speaker') speakerShots++;
  });
  assert.ok(speakerShots >= 4);
});

function makeHost() {
  const log: string[] = [];
  const control = new ControlStack();
  const handlers = new Map<string, Set<(p: unknown) => void>>();
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
        for (const fn of [...(handlers.get(name) ?? [])]) fn(payload);
      },
    },
    flags: {} as Flags,
    resolve: () => ({ x: 0, y: 0, z: 0 }),
    warn: (m) => log.push(`warn ${m}`),
    pushControl: (over, owner) => control.push(over, owner),
    lookAt: () => undefined,
    clampLook: () => undefined,
    frame: (at) => log.push(at ? 'frame' : 'unframe'),
    walkTo: () => Promise.resolve(),
    music: () => undefined,
    radio: () => undefined,
    fade: (level, s) => log.push(`fade ${level} ${s}`),
    placePlayer: () => log.push('place'),
    sfx: () => undefined,
    say: (line) => {
      log.push(`say ${line}`);
      return { done: Promise.resolve() };
    },
    markLinePlayed: (line) => log.push(`played ${line}`),
    stopSpeech: () => log.push('stopSpeech'),
    checkpoint: (id) => log.push(`checkpoint ${id}`),
    setDoor: (id, state) => (log.push(`door ${id} ${state}`), true),
    npc: (action) => {
      log.push(`npc ${action}`);
    },
  };
  return { host, log, control };
}

test('watched to the end, the intro sets its flags, hands back control and takes cp_intro', async () => {
  const { host, log, control } = makeHost();
  const m = new SequenceManager(host, [intro]);
  m.start('intro_shift_change');
  assert.equal(control.state.move, 'locked');
  for (let i = 0; i < 60 * 400 && m.running().length > 0; i++) {
    m.update(1 / 60);
    if (i % 4 === 0) await Promise.resolve(); // let resolved lines and walks settle
  }
  assert.deepEqual(m.running(), [], 'finished within 400 s of simulated time');
  assert.equal(host.flags['introSeen'], true);
  assert.equal(host.flags['pa_quarantine_played'], true);
  assert.equal(host.flags['giles_forearm_seen'], true);
  assert.equal(host.flags['mara_mentioned'], true);
  assert.equal(host.flags['priya_met'], true);
  assert.equal(control.state.move, 'free');
  assert.equal(log.filter((e) => e === 'checkpoint cp_intro').length, 1);
  assert.ok(!log.some((e) => e.startsWith('warn')), log.filter((e) => e.startsWith('warn')).join('\n'));
});

test('skipping the intro from the first second lands in the same end state', () => {
  const { host, log, control } = makeHost();
  const m = new SequenceManager(host, [intro]);
  m.start('intro_shift_change');
  for (let i = 0; i < 60; i++) m.update(1 / 60);
  assert.equal(m.skippable, true);
  assert.equal(m.skip(), true);
  assert.deepEqual(m.running(), []);
  assert.equal(host.flags['introSeen'], true);
  assert.equal(host.flags['pa_quarantine_played'], true);
  assert.equal(host.flags['giles_forearm_seen'], true);
  assert.equal(host.flags['mara_mentioned'], true);
  assert.equal(host.flags['priya_met'], true);
  assert.equal(control.state.move, 'free');
  assert.equal(log.filter((e) => e === 'checkpoint cp_intro').length, 1);
  assert.ok(log.includes('played intro_giles_14'), 'late lines are marked played');
  assert.ok(log.includes('event intro:coffee_done'), 'the coffee prompt is closed');
  assert.ok(log.includes('stopSpeech'));
  assert.equal(log.filter((e) => e.startsWith('frame') || e === 'unframe').at(-1), 'unframe', 'the view is released after a skip');
  // The scene fades back in and ends clear, not black.
  assert.equal(log.filter((e) => e.startsWith('fade')).at(-1), 'fade 0 0');
});
