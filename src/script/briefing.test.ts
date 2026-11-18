/**
 * ADR-0023 briefing (data/sequences/briefing_gallery.json):
 * valid, every line exists and is story priority, plays through, and skipping lands in
 * the same end state (three round objectives, cp_briefing, view released).
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
    else visit(step);
  }
}

test('the briefing is skippable, runs once, and its lines and sounds exist as story lines', () => {
  assert.equal(briefing.skippable, true);
  assert.equal(briefing.once, true);
  const lines: string[] = [];
  walk(briefing.steps, (s) => {
    if (s['do'] === 'say') lines.push(s['line'] as string);
    if (s['do'] === 'sfx') assert.ok((s['id'] as string) in SOUND_SPECS, `unknown sound ${String(s['id'])}`);
  });
  for (const id of lines) {
    assert.ok(library.hasLine(id), `missing dialogue line "${id}"`);
    assert.equal(library.line(id).priority, 'story', id);
  }
  assert.equal(new Set(lines).size, lines.length, 'no line plays twice');
});

function makeHost() {
  const log: string[] = [];
  const control = new ControlStack();
  const host: SequenceHost = {
    events: { on: () => () => undefined, emit: (name) => void log.push(`event ${name}`) },
    flags: {} as Flags,
    resolve: () => ({ x: 0, y: 0, z: 0 }),
    warn: (m) => log.push(`warn ${m}`),
    pushControl: (over, owner) => control.push(over, owner),
    frame: (at) => log.push(at ? 'frame' : 'unframe'),
    walkTo: () => Promise.resolve(),
    placePlayer: () => log.push('place'),
    sfx: () => undefined,
    say: (line) => {
      log.push(`say ${line}`);
      return { done: Promise.resolve() };
    },
    markLinePlayed: (line) => log.push(`played ${line}`),
    stopSpeech: () => log.push('stopSpeech'),
    checkpoint: (id) => log.push(`checkpoint ${id}`),
    npc: (action) => void log.push(`npc ${action}`),
  };
  return { host, log, control };
}

function assertEnd(host: SequenceHost, log: string[], control: ControlStack): void {
  for (const id of ['round_hydro', 'round_dive', 'round_admin']) assert.equal(host.flags[`obj:${id}`], 'active', id);
  assert.equal(host.flags['briefingSeen'], true);
  assert.equal(control.state.move, 'free');
  assert.equal(log.filter((e) => e === 'checkpoint cp_briefing').length, 1);
  assert.equal(log.filter((e) => e === 'frame' || e === 'unframe').at(-1), 'unframe', 'the view is released');
  assert.ok(!log.some((e) => e.startsWith('warn')), log.filter((e) => e.startsWith('warn')).join('\n'));
}

test('watched to the end, the briefing hands out the rounds and takes cp_briefing', async () => {
  const { host, log, control } = makeHost();
  const m = new SequenceManager(host, [briefing]);
  m.start('briefing_gallery');
  for (let i = 0; i < 60 * 300 && m.running().length > 0; i++) {
    m.update(1 / 60);
    if (i % 4 === 0) await Promise.resolve();
  }
  assert.deepEqual(m.running(), []);
  assertEnd(host, log, control);
});

test('skipping the briefing lands in the same end state', () => {
  const { host, log, control } = makeHost();
  const m = new SequenceManager(host, [briefing]);
  m.start('briefing_gallery');
  for (let i = 0; i < 90; i++) m.update(1 / 60);
  assert.equal(m.skip(), true);
  assertEnd(host, log, control);
  assert.ok(log.includes('played brief_heins_08'), 'late lines are marked played');
});
