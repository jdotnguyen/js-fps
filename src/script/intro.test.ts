/**
 * The ADR-0017 opening, still a draft in data/sequences/drafts (it moves up to
 * data/sequences once the dock and kitchen rooms and the squad exist). These tests keep
 * the draft honest: valid schema, every line and sound it names exists, and it plays
 * through headless and skips to the same end state.
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
const draft = json('../data/sequences/drafts/intro_shift_change.json');
const [intro] = validateSequences({ 'drafts/intro_shift_change.json': draft }) as [SequenceDef];

const library = new DialogueLibrary(json('../data/dialogue/speakers.json'), { slice01: json('../data/dialogue/slice01.json') });

function walk(steps: Step[], visit: (s: Record<string, unknown>) => void): void {
  for (const step of steps) {
    if (isParallel(step)) walk(step.parallel, visit);
    else visit(step);
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

test('the player stays silent: only the squad, crew and PA speak', () => {
  walk(intro.steps, (s) => {
    if (s['do'] !== 'say') return;
    const speaker = library.line(s['line'] as string).speaker;
    assert.ok(['engineer', 'medic', 'pa'].includes(speaker) || speaker.startsWith('crew_'), `${String(s['line'])}: ${speaker}`);
  });
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
    walkTo: () => Promise.resolve(),
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
  assert.equal(control.state.move, 'free');
  assert.equal(log.filter((e) => e === 'checkpoint cp_intro').length, 1);
  assert.ok(log.includes('played intro_giles_09'), 'late lines are marked played');
  assert.ok(log.includes('event intro:coffee_done'), 'the coffee prompt is closed');
  assert.ok(log.includes('stopSpeech'));
  // The scene fades back in and ends clear, not black.
  assert.equal(log.filter((e) => e.startsWith('fade')).at(-1), 'fade 0 0');
});
