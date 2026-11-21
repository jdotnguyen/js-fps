/**
 * ADR-0023 / morning-briefing spec (data/sequences/briefing_gallery.json):
 * valid, every line exists and is story priority, runs free-roam without locking control,
 * locks D_R02_R03 guarded on everyone inside R03 and unlocks it at the end, activates the
 * three rounds live on brief_heins_05, and skipping lands in the same end state.
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
const [briefing] = validateSequences({ 'briefing_gallery.json': json('../data/sequences/briefing_gallery.json') }) as [SequenceDef];
const library = new DialogueLibrary(json('../data/dialogue/speakers.json'), { slice01: json('../data/dialogue/slice01.json') });

function walk(steps: Step[], visit: (s: Record<string, unknown>) => void): void {
  for (const step of steps) {
    if (isParallel(step)) walk(step.parallel, visit);
    else {
      visit(step);
      if (step['do'] === 'loop' && Array.isArray(step['steps'])) walk(step['steps'] as Step[], visit);
    }
  }
}

test('the briefing is skippable, free-roam, runs once, and its lines and sounds exist as story lines', () => {
  assert.equal(briefing.skippable, true);
  assert.equal(briefing.once, true);
  assert.equal(briefing.exclusive, undefined, 'free-roam: not on rails');
  const lines: string[] = [];
  walk(briefing.steps, (s) => {
    assert.notEqual(s['do'], 'playerControl', 'free-roam: never locks movement');
    assert.notEqual(s['do'], 'playerWalkTo', 'free-roam: never walks player on rails');
    if (s['do'] === 'say') lines.push(s['line'] as string);
    if (s['do'] === 'sfx') assert.ok((s['id'] as string) in SOUND_SPECS, `unknown sound ${String(s['id'])}`);
  });
  assert.ok(lines.includes('brief_heins_door'), 'includes Heins door-lock cue');
  for (const id of lines) {
    assert.ok(library.hasLine(id), `missing dialogue line "${id}"`);
    assert.equal(library.line(id).priority, 'story', id);
  }
  assert.equal(new Set(lines).size, lines.length, 'no line plays twice');
});

function makeHost(opts: { playerInR03?: boolean } = {}) {
  const log: string[] = [];
  const control = new ControlStack();
  const inside = { player: opts.playerInR03 ?? true, giles: false, okafor: false };
  const doors: Record<string, string> = { D_R02_R03: 'closed' };
  const host: SequenceHost = {
    events: { on: () => () => undefined, emit: (name) => void log.push(`event ${name}`) },
    flags: { 'obj:obj_briefing': 'active' } as Flags,
    resolve: () => ({ x: 0, y: 0, z: 0 }),
    warn: (m) => log.push(`warn ${m}`),
    pushControl: (over, owner) => control.push(over, owner),
    frame: (at) => log.push(at ? 'frame' : 'unframe'),
    walkTo: () => Promise.resolve(),
    placePlayer: () => log.push('place'),
    setDoor: (id, state) => {
      doors[id] = state;
      log.push(`door ${id} ${state}`);
      return true;
    },
    inRoom: (who) => inside[who],
    squadCatchUpIn: (room) => {
      log.push(`catchUpIn ${room}`);
      inside.giles = true;
      inside.okafor = true;
      return ['engineer', 'medic'];
    },
    squadPlaceIn: (room) => {
      log.push(`placeIn ${room}`);
      inside.giles = true;
      inside.okafor = true;
      return ['engineer', 'medic'];
    },
    sfx: () => undefined,
    say: (line) => {
      log.push(`say ${line}`);
      return { done: Promise.resolve() };
    },
    markLinePlayed: (line) => log.push(`played ${line}`),
    stopSpeech: () => log.push('stopSpeech'),
    checkpoint: (id) => log.push(`checkpoint ${id}`),
    npc: (action, step) => void log.push(`npc ${action} ${String(step['npc'] ?? '')}`),
  };
  return { host, log, control, doors };
}

function assertEnd(host: SequenceHost, log: string[], control: ControlStack, doors: Record<string, string>): void {
  assert.equal(host.flags['obj:obj_briefing'], 'done', 'obj_briefing completed');
  for (const id of ['round_hydro', 'round_dive', 'round_admin']) assert.equal(host.flags[`obj:${id}`], 'active', id);
  assert.equal(host.flags['briefingSeen'], true);
  assert.equal(control.state.move, 'free');
  assert.equal(doors['D_R02_R03'], 'closed', 'gallery door unlocked at end');
  assert.equal(log.filter((e) => e === 'checkpoint cp_briefing').length, 1);
  assert.ok(!log.some((e) => e.startsWith('warn')), log.filter((e) => e.startsWith('warn')).join('\n'));
}

test('watched to the end, the briefing stays free-roam, locks and unlocks D_R02_R03, hands out the rounds live and takes cp_briefing', async () => {
  const { host, log, control, doors } = makeHost();
  const m = new SequenceManager(host, [briefing]);
  m.start('briefing_gallery');
  for (let i = 0; i < 60 * 300 && m.running().length > 0; i++) {
    assert.equal(control.state.move, 'free', 'never locks movement');
    m.update(1 / 60);
    if (i % 4 === 0) await Promise.resolve();
  }
  assert.deepEqual(m.running(), []);
  assertEnd(host, log, control, doors);
  assert.ok(log.includes('door D_R02_R03 locked'), 'locks door once everyone is in R03');
  assert.ok(log.indexOf('door D_R02_R03 locked') < log.lastIndexOf('door D_R02_R03 closed'), 'unlocks at end');
  assert.ok(log.indexOf('say brief_heins_05') < log.indexOf('say brief_heins_08'), 'rounds arrive during brief_heins_05');
});

test('if Jay stepped back out of R03 before the lock cue, D_R02_R03 does not lock him out', async () => {
  const { host, log, control, doors } = makeHost({ playerInR03: false });
  const m = new SequenceManager(host, [briefing]);
  m.start('briefing_gallery');
  for (let i = 0; i < 60 * 300 && m.running().length > 0; i++) {
    m.update(1 / 60);
    if (i % 4 === 0) await Promise.resolve();
  }
  assertEnd(host, log, control, doors);
  assert.ok(!log.includes('door D_R02_R03 locked'), 'never locks Jay outside R03');
});

test('skipping the briefing lands in the same end state with D_R02_R03 unlocked', () => {
  const { host, log, control, doors } = makeHost();
  const m = new SequenceManager(host, [briefing]);
  m.start('briefing_gallery');
  for (let i = 0; i < 90; i++) m.update(1 / 60);
  assert.equal(m.skip(), true);
  assertEnd(host, log, control, doors);
  assert.ok(log.includes('played brief_heins_08'), 'late lines are marked played');
});
