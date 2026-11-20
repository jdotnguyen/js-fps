/**
 * The new-game opening (openspec/specs/intro-sequence) (data/sequences/intro_shift_change.json). These tests keep it
 * honest: valid schema, every line and sound it names exists, and it plays through
 * headless and skips to the same end state.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ControlStack } from '../actors/control.ts';
import { SAMPLE_URLS, SOUND_SPECS } from '../audio/sounds.ts';
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
    if (s['do'] === 'sfx') assert.ok((s['id'] as string) in SOUND_SPECS || (s['id'] as string) in SAMPLE_URLS, `unknown sound ${String(s['id'])}`);
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

test('the intro takes control of both squadmates in the airlock before Jay sees the dock', () => {
  const staged = new Map<unknown, unknown>();
  for (const step of intro.steps) {
    if (isParallel(step)) continue;
    if (step['do'] === 'fade' && step['to'] === 0) break;
    if (step['do'] === 'spawn') staged.set(step['npc'], step['at']);
  }
  for (const id of ['okafor', 'giles']) assert.equal(staged.get(id), `anchor:${id}_start`);
});

test('Ruiz and Sung come in at once: Sung queues, each badges in at the counter, then goes through the arch', () => {
  const moves: string[] = [];
  walk(intro.steps, (s) => {
    if (s['do'] === 'npcMoveTo' && (s['npc'] === 'ruiz' || s['npc'] === 'sung')) moves.push(`${String(s['npc'])}>${String(s['to'])}`);
  });
  assert.deepEqual(moves, [
    'ruiz>anchor:walkby_stop',
    'sung>anchor:walkby_queue',
    'ruiz>anchor:arch_scan',
    'ruiz>anchor:arch_exit',
    'ruiz>anchor:crew_ruiz_commons',
    'sung>anchor:walkby_stop',
    'sung>anchor:arch_scan',
    'sung>anchor:arch_exit',
    'sung>anchor:crew_sung_commons',
  ]);
});

test('Okafor and Giles come through one at a time: counter, arch, then the station side', () => {
  const moves: string[] = [];
  walk(intro.steps, (s) => {
    if (s['do'] === 'npcMoveTo' && (s['npc'] === 'okafor' || s['npc'] === 'giles') && !String(s['to']).includes('counter_')) moves.push(`${String(s['npc'])}>${String(s['to'])}`);
  });
  assert.deepEqual(moves, [
    'okafor>anchor:walkby_stop',
    'giles>anchor:walkby_queue',
    'okafor>anchor:arch_scan',
    'giles>anchor:walkby_stop',
    'okafor>anchor:post_okafor',
    'giles>anchor:arch_scan',
    'giles>anchor:post_giles',
  ]);
});

test('only Giles sets off the arch; everyone else passes, and Ruiz alone gets the wand', () => {
  const scans: string[] = [];
  const wanded: string[] = [];
  let last = '';
  walk(intro.steps, (s) => {
    if (s['do'] === 'npcMoveTo' && s['to'] === 'anchor:arch_scan') last = String(s['npc']);
    if (s['do'] === 'emit' && s['event'] === 'detector:scan') {
      const p = s['payload'] as { id: string; result: string };
      assert.equal(p.id, 'dock_arch');
      scans.push(`${last}:${p.result}`);
    }
    if (s['do'] === 'npcAnim' && s['anim'] === 'arms_out') wanded.push(String(s['npc']));
  });
  assert.deepEqual(scans, ['ruiz:pass', 'sung:pass', 'okafor:pass', 'giles:alarm']);
  assert.deepEqual(wanded, ['ruiz']);
});

test('the guard never leaves his post and ends the scan with the wand at rest', () => {
  const guard: Array<Record<string, unknown>> = [];
  walk(intro.steps, (s) => {
    if (s['npc'] === 'dock_guard') guard.push(s);
  });
  assert.ok(guard.length > 0);
  assert.ok(guard.every((s) => s['do'] === 'npcAnim'), 'the guard is only animated, never moved');
  assert.equal(guard[guard.length - 1]!['anim'], 'idle_wand');
  // Everyone the guard scans lowers their arms again.
  const arms = new Map<string, string>();
  walk(intro.steps, (s) => {
    if (s['do'] === 'npcAnim' && s['npc'] !== 'dock_guard' && (s['anim'] === 'arms_out' || s['anim'] === 'idle')) arms.set(String(s['npc']), String(s['anim']));
  });
  for (const [who, a] of arms) assert.equal(a, 'idle', `${who} lowers their arms`);
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

test('speaker shots at the post, the heading shot on the walk, speaker shots again once Jay walks into the Commons', () => {
  const shots: string[] = [];
  let shotAtWalk = '';
  walk(intro.steps, (s) => {
    if (s['do'] === 'playerFrame') shots.push(String(s['target']));
    if (s['do'] === 'playerWalkTo' && s['to'] === 'anchor:kitchen_stand') shotAtWalk = shots.at(-1) ?? '';
  });
  assert.equal(shotAtWalk, 'heading', 'Jay walks out facing along the rails');
  const h = shots.indexOf('heading');
  assert.ok(shots.slice(0, h).includes('speaker'), 'speaker shots at the post');
  assert.equal(shots.filter((t) => t === 'heading').length, 1, 'one heading shot: the walk');
  assert.equal(shots[h + 1], 'speaker', 'the next shot after the walk starts is the kitchen speaker shot');
});

test('the kitchen follows whoever talks, Priya included; only the mug offer is a tight framed shot', () => {
  const frames: Array<Record<string, unknown>> = [];
  walk(intro.steps, (s) => {
    if (s['do'] === 'playerFrame') frames.push(s);
  });
  const kitchen = frames.slice(frames.findIndex((f) => f['target'] === 'heading') + 1);
  assert.ok(kitchen.length > 0);
  assert.ok(kitchen.every((f) => f['give'] === undefined || f['give'] === 6), 'no wide leeway shots in the kitchen');
  const fixed = kitchen.filter((f) => f['target'] !== 'speaker');
  assert.deepEqual(fixed.map((f) => f['target']), ['npc:priya'], 'only the mug offer holds a fixed shot');
  assert.ok(kitchen.some((f) => f['target'] === 'speaker' && f['initial'] === 'npc:priya'), 'Priya walks in to a speaker shot that starts on her');
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
    frameHeading: () => log.push('frame heading'),
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

// ---- intro-sequence spec, "Skip ends in the watched end state": the same NPC spots and poses, flags, checkpoint and
// played lines whether the intro is watched or skipped at the start, mid-scan or mid-walk.

interface EndState {
  flags: Record<string, unknown>;
  spot: Record<string, string>;
  pose: Record<string, string>;
  lines: string[];
  checkpoints: string[];
}

async function runIntro(skipWhen: ((log: string[]) => boolean) | null, opts: { walkHangs?: boolean } = {}): Promise<EndState> {
  const { host, log } = makeHost();
  const spot: Record<string, string> = {};
  const pose: Record<string, string> = {};
  host.npc = (action, step) => {
    log.push(`npc ${action}`);
    const who = String(step['npc']);
    if (action === 'npcMoveTo' || action === 'spawn') spot[who] = String(step['to'] ?? step['at']);
    if (action === 'npcAnim') {
      const a = String(step['anim']);
      // Timed gestures end back on the base pose; held ones become it (npcActor.playAnim).
      if (!['wand_up', 'wand_down', 'rub_forearm', 'drink', 'glance', 'cough', 'gesture', 'flex_hand'].includes(a)) pose[who] = a;
      log.push(`anim ${who} ${a}`);
    }
  };
  let walking = false;
  host.walkTo = () => {
    walking = true;
    log.push('walk');
    return opts.walkHangs ? new Promise<void>(() => undefined) : Promise.resolve();
  };
  const m = new SequenceManager(host, [intro]);
  m.start('intro_shift_change');
  let skipped = false;
  for (let i = 0; i < 60 * 400 && m.running().length > 0; i++) {
    if (skipWhen && !skipped && skipWhen(log)) {
      assert.equal(m.skip(), true);
      skipped = true;
      break;
    }
    m.update(1 / 60);
    if (i % 4 === 0) await Promise.resolve();
  }
  assert.deepEqual(m.running(), [], 'the intro ended');
  if (skipWhen) assert.ok(skipped, 'the skip point was reached');
  void walking;
  const lines = [...new Set(log.filter((e) => e.startsWith('say ') || e.startsWith('played ')).map((e) => e.slice(e.indexOf(' ') + 1)))].sort();
  return { flags: { ...host.flags }, spot, pose, lines, checkpoints: log.filter((e) => e.startsWith('checkpoint')) };
}

test('skipping mid-scan or mid-walk ends exactly like watching the intro through', async () => {
  const watched = await runIntro(null);
  assert.equal(watched.pose['dock_guard'], 'idle_wand');
  assert.equal(watched.pose['ruiz'], 'idle');
  const points: Array<[string, ((log: string[]) => boolean), { walkHangs?: boolean }]> = [
    ['at the first second', (log) => log.includes('fade 0 2.5'), {}],
    ['mid-scan (Ruiz arms out)', (log) => log.includes('anim ruiz arms_out'), {}],
    ['mid-alarm (Giles at the arch)', (log) => log.filter((e) => e === 'event detector:scan').length === 4, {}],
    ['mid-walk to the kitchen', (log) => log.includes('walk'), { walkHangs: true }],
  ];
  for (const [label, when, opts] of points) {
    const skipped = await runIntro(when, opts);
    assert.deepEqual(skipped.flags, watched.flags, `${label}: flags`);
    assert.deepEqual(skipped.spot, watched.spot, `${label}: everyone ends on the same spot`);
    assert.deepEqual(skipped.pose, watched.pose, `${label}: everyone ends in the same pose (guard holding the wand at rest)`);
    assert.deepEqual(skipped.lines, watched.lines, `${label}: every line counts as played`);
    assert.deepEqual(skipped.checkpoints, watched.checkpoints, `${label}: cp_intro once`);
  }
});

test('walking into the Commons: the view turns to whoever speaks first, and Bram starts as Jay walks in', () => {
  const walkStep = intro.steps.find((s) => isParallel(s) && JSON.stringify(s).includes('"anchor:kitchen_stand"'));
  assert.ok(walkStep && isParallel(walkStep));
  const branches = walkStep.parallel.map((b) => JSON.stringify(b));
  const jay = branches.findIndex((b) => b.includes('"playerWalkTo"'));
  const greet = branches.findIndex((b) => b.includes('"intro_cook_01"'));
  const cam = branches.findIndex((b) => b.includes('"playerFrame"'));
  assert.ok(jay >= 0 && greet >= 0 && cam >= 0 && new Set([jay, greet, cam]).size === 3);
  // The camera waits for Jay to come through the Commons door, then follows speakers (no initial aim: whoever talks first).
  const c = branches[cam]!;
  assert.ok(c.indexOf('"trigger:commons_enter"') < c.indexOf('"playerFrame"'));
  assert.ok(c.includes('"speaker"') && !c.includes('"initial"'));
  // Bram holds his greeting until Jay walks in (the squad are out of sight behind the door meanwhile); a flag covers Jay arriving first.
  const g = branches[greet]!;
  assert.ok(g.indexOf('"trigger:commons_enter"') < g.indexOf('"intro_cook_01"'));
  assert.ok(g.includes('"intro_jay_in_kitchen"') && c.includes('"intro_jay_in_kitchen"'));
  assert.ok(!g.includes('"playerFrame"'), "the greeting itself does not move the view");
  assert.ok(branches[jay]!.includes('"radio"'), 'the radio starts when Jay reaches the kitchen');
});
