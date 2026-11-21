import { test } from 'node:test';
import assert from 'node:assert/strict';
import objectivesJson from '../data/objectives.json' with { type: 'json' };
import { validate } from '../core/validate.ts';
import { objectivesValidator } from '../data/types/objectives.ts';
import { ObjectiveBanner, ObjectiveTracker, eventMatches, type LooseBus } from './objectives.ts';

function bus(): LooseBus & { log: Array<[string, unknown]> } {
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  const log: Array<[string, unknown]> = [];
  return {
    log,
    on(name, fn) {
      const s = handlers.get(name) ?? new Set();
      s.add(fn);
      handlers.set(name, s);
      return () => s.delete(fn);
    },
    emit(name, payload) {
      log.push([name, payload]);
      for (const fn of [...(handlers.get(name) ?? [])]) fn(payload);
    },
  };
}

const defs = validate(objectivesValidator(), objectivesJson, 'data/objectives.json');

test('shipped objectives validate; briefing and rounds are required with concrete targets, optionals are not', () => {
  assert.equal(defs['obj_briefing']!.required, true);
  assert.equal(defs['obj_briefing']!.target, 'anchor:brief_jay');
  assert.equal(defs['round_hydro']!.required, true);
  assert.equal(defs['round_hydro']!.target, 'anchor:hydro_log');
  assert.equal(defs['round_dive']!.target, 'anchor:dive_case_pickup');
  assert.deepEqual(defs['round_dive']!.targetWhenHeld, { item: 'sample_case', target: 'anchor:dive_case_locker' });
  assert.equal(defs['round_admin']!.target, 'anchor:hale_desk');
  assert.equal(defs['opt_hydro_storeroom']!.required, false);
  assert.throws(() => validate(objectivesValidator(new Set()), objectivesJson, 'x'), /unknown dialogue line/);
});

test('tracker reads and writes the obj:<id> flags the sequence actions use', () => {
  const b = bus();
  let flags: Record<string, string | number | boolean> = {};
  const t = new ObjectiveTracker(defs, () => flags, b);
  const changes: string[] = [];
  t.onChange((c) => changes.push(`${c.kind}:${c.def.id}`));
  // What setObjective does:
  flags['obj:round_hydro'] = 'active';
  b.emit('objective:set', { id: 'round_hydro' });
  t.start('round_dive');
  assert.equal(t.start('round_dive'), false, 'already active');
  assert.deepEqual(t.active().map((d) => d.id), ['round_hydro', 'round_dive']);
  t.complete('round_hydro');
  assert.deepEqual(changes, ['new:round_hydro', 'new:round_dive', 'done:round_hydro']);
  const { required } = t.list();
  assert.deepEqual(required.map((e) => [e.def.id, e.state]), [['round_hydro', 'done'], ['round_dive', 'active']]);
  // Loading a save swaps the flags object: the tracker follows.
  flags = { 'obj:round_admin': 'active' };
  assert.deepEqual(t.active().map((d) => d.id), ['round_admin']);
  assert.equal(t.def('obj_unknown_thing').title, 'Unknown thing', 'unknown ids get a readable fallback');
});

test('startOn / completeOn fire from matching game events only', () => {
  const b = bus();
  const flags: Record<string, string | number | boolean> = {};
  const t = new ObjectiveTracker(defs, () => flags, b);
  b.emit('access:denied', { id: 'D9', requires: 'vent_driver' });
  assert.equal(t.state('opt_hydro_storeroom'), null);
  b.emit('access:denied', { id: 'D3', requires: 'card_l2' });
  assert.equal(t.state('opt_hydro_storeroom'), 'active');
  assert.equal(t.list().optional.length, 1);
  b.emit('access:granted', { id: 'D3', requires: 'card_l2' });
  assert.equal(t.state('opt_hydro_storeroom'), 'done');
  assert.ok(b.log.some(([n, p]) => n === 'objective:done' && (p as { id: string }).id === 'opt_hydro_storeroom'));
  assert.equal(eventMatches({ event: 'x' }, null), true);
  assert.equal(eventMatches({ event: 'x', match: { a: 1 } }, { a: 2 }), false);
});

test('persistent objective list stays visible while active, highlights new, lingers briefly on completion, and pulses on Tab', () => {
  const banner = new ObjectiveBanner(3.5, 2.5, 2.0);
  assert.equal(banner.snapshot([]).visible, false);

  banner.push({ kind: 'new', def: defs['round_hydro']! });
  let snap = banner.snapshot([defs['round_hydro']!]);
  assert.equal(snap.visible, true);
  assert.equal(snap.lines[0]!.fresh, true);

  // Even long after NEW_SECONDS expires, active objectives remain visible.
  banner.update(10);
  snap = banner.snapshot([defs['round_hydro']!, defs['opt_map_hydro']!]);
  assert.equal(snap.visible, true);
  assert.equal(snap.lines.length, 2);
  assert.equal(snap.lines[0]!.fresh, false);
  assert.equal(snap.lines[1]!.optional, true);

  // Completing an objective lingers with a checkmark for doneSeconds, then clears.
  banner.push({ kind: 'done', def: defs['round_hydro']! });
  snap = banner.snapshot([defs['opt_map_hydro']!]);
  assert.equal(snap.lines.length, 2);
  assert.equal(snap.lines[1]!.done, true);
  banner.update(3.6);
  snap = banner.snapshot([defs['opt_map_hydro']!]);
  assert.equal(snap.lines.length, 1);

  // Tab pulses the list, and when empty briefly shows "No current objectives".
  banner.recall([defs['opt_map_hydro']!]);
  assert.equal(banner.pulsed, true);
  banner.update(2.1);
  assert.equal(banner.pulsed, false);

  banner.recall([]);
  snap = banner.snapshot([]);
  assert.equal(snap.visible, true);
  assert.equal(snap.lines[0]!.text, 'No current objectives');
  banner.update(2.1);
  assert.equal(banner.snapshot([]).visible, false);
});
