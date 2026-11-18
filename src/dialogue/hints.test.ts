import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ObjectiveDef } from '../data/types/objectives.ts';
import { HintDirector } from './hints.ts';

const hydro: ObjectiveDef = { id: 'round_hydro', title: 'Hydro', required: true, area: 'hydroponics', hints: [['h1a', 'h1b'], ['h2a'], ['h3a']] };
const opt: ObjectiveDef = { id: 'opt', title: 'Opt', required: false, hints: [['o1']] };

function setup(over: { active?: ObjectiveDef[]; delays?: number[] } = {}) {
  const said: string[] = [];
  const pulses: string[] = [];
  let speaking: { priority: string } | null = null;
  let blocked = false;
  let dist: number | null = 50;
  const h = new HintDirector({
    active: () => over.active ?? [hydro, opt],
    delays: () => over.delays ?? [45, 90],
    speech: { speaking: () => speaking, say: (id) => said.push(id) },
    blocked: () => blocked,
    distance: () => dist,
    onPulse: (d) => pulses.push(d.id),
  });
  const run = (seconds: number, step = 0.5): void => {
    for (let t = 0; t < seconds - 1e-9; t += step) h.update(step);
  };
  return {
    h,
    said,
    pulses,
    run,
    speak: (p: string | null) => (speaking = p ? { priority: p } : null),
    block: (b: boolean) => (blocked = b),
    setDist: (d: number | null) => (dist = d),
  };
}

test('tiers escalate at d1, d2, then 2*d2-d1; the last tier pulses', () => {
  const s = setup();
  s.run(44.5);
  assert.deepEqual(s.said, []);
  s.run(1);
  assert.deepEqual(s.said, ['h1a']);
  s.run(45);
  assert.deepEqual(s.said, ['h1a', 'h2a']);
  assert.deepEqual(s.pulses, []);
  s.run(45);
  assert.deepEqual(s.said, ['h1a', 'h2a', 'h3a']);
  assert.deepEqual(s.pulses, ['round_hydro']);
  s.run(89);
  assert.equal(s.said.length, 3);
  s.run(1.5);
  assert.deepEqual(s.said.slice(3), ['h3a'], 'the last tier repeats every d2');
});

test('difficulty delays are used (Story 20 / 40)', () => {
  const s = setup({ delays: [20, 40] });
  s.run(20);
  assert.deepEqual(s.said, ['h1a']);
  s.run(20);
  assert.deepEqual(s.said, ['h1a', 'h2a']);
});

test('never over a story or hint line, never while blocked (combat, rails)', () => {
  const s = setup();
  s.speak('story');
  s.run(60);
  assert.deepEqual(s.said, [], 'waits out the story line');
  s.speak('combat');
  s.run(0.5);
  assert.deepEqual(s.said, ['h1a'], 'a bark may be cut off');
  const t = setup();
  t.block(true);
  t.run(200);
  assert.deepEqual(t.said, []);
  assert.equal(t.h.stuck, 0, 'the clock does not run while blocked');
});

test('progress (getting 3 m closer) resets the clock and steps back a tier', () => {
  const s = setup();
  s.run(46);
  assert.deepEqual(s.said, ['h1a']);
  s.setDist(47.5);
  s.run(10);
  assert.ok(s.h.stuck > 50, 'under 3 m closer is not progress');
  s.setDist(40);
  s.run(0.5);
  assert.ok(s.h.stuck <= 0.5);
  assert.equal(s.h.tierOf('round_hydro'), 0);
  s.run(45);
  assert.deepEqual(s.said, ['h1a', 'h1b'], 'same level again, next variant');
  s.h.progress();
  s.h.reset();
  assert.equal(s.h.tierOf('round_hydro'), 0);
});

test('optional objectives never get hints', () => {
  const s = setup({ active: [opt] });
  s.run(300);
  assert.deepEqual(s.said, []);
});
