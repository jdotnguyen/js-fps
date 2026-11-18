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

test('shipped objectives validate; rounds are required, optionals are not', () => {
  assert.equal(defs['round_hydro']!.required, true);
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

test('banner: 5 s on change, changes stack, Tab recalls the active list', () => {
  const banner = new ObjectiveBanner(5);
  assert.equal(banner.visible, false);
  banner.push({ kind: 'new', def: defs['round_hydro']! });
  banner.update(2);
  banner.push({ kind: 'new', def: defs['round_dive']! });
  assert.deepEqual(banner.lines.map((l) => l.label), ['New objective', 'New objective']);
  banner.update(4.9);
  assert.equal(banner.visible, true, 'the second change restarted the 5 s');
  banner.update(0.2);
  assert.equal(banner.visible, false);
  banner.push({ kind: 'done', def: defs['round_dive']! });
  assert.deepEqual(banner.lines.map((l) => l.label), ['Objective complete'], 'a new banner starts fresh');
  banner.recall([defs['round_hydro']!, defs['opt_map_hydro']!]);
  assert.deepEqual(banner.lines.map((l) => l.label), ['Objective', 'Optional']);
  banner.push({ kind: 'new', def: defs['round_admin']! });
  assert.equal(banner.lines.length, 1, 'a change replaces the recalled list');
  banner.recall([]);
  assert.equal(banner.lines[0]!.text, 'No current objectives');
});
