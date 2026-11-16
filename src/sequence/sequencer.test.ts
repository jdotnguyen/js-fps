import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { ControlStack } from '../actors/control.ts';
import { EventBus } from '../core/events.ts';
import type { LineHandle, SequenceHost, WalkHandle } from './action.ts';
import { Sequencer, type EndReason } from './sequencer.ts';
import type { Flags, SequenceDef, Vec3 } from './types.ts';

/** Records everything the sequencer asks of the game; lines and walks finish on demand. */
function fakeHost(control: ControlStack) {
  const log: string[] = [];
  const lines: Array<{ id: string; done: boolean }> = [];
  const walks: Array<{ pos: Vec3; done: boolean }> = [];
  const host: SequenceHost = {
    pushControl: (over, owner) => control.push(over, owner),
    say: (id) => {
      const l = { id, done: false };
      lines.push(l);
      log.push(`say:${id}`);
      const h: LineHandle = { isDone: () => l.done, stop: () => log.push(`stop:${id}`) };
      return h;
    },
    markLinePlayed: (id) => log.push(`played:${id}`),
    fade: (level, s) => log.push(`fade:${level}:${s}`),
    playerLookAt: () => log.push('lookAt'),
    playerWalkTo: (pos) => {
      const w = { pos, done: false };
      walks.push(w);
      log.push(`walk:${pos.join(',')}`);
      const h: WalkHandle = { isDone: () => w.done, cancel: () => log.push('walkCancel') };
      return h;
    },
    placePlayer: (pos) => log.push(`place:${pos.join(',')}`),
    sfx: (id) => log.push(`sfx:${id}`),
    checkpoint: (id) => log.push(`cp:${id}`),
  };
  return { host, log, lines, walks };
}

function setup(defs: SequenceDef[]) {
  const control = new ControlStack();
  const events = new EventBus();
  const flags: Flags = {};
  const fake = fakeHost(control);
  const seq = new Sequencer({ events, host: fake.host, flags });
  for (const d of defs) seq.register(d);
  const ended: Array<{ id: string; reason: EndReason }> = [];
  events.on('sequence:ended', (e) => ended.push(e));
  return { control, events, flags, seq, ended, ...fake };
}

const run = (seq: Sequencer, seconds: number, dt = 0.1): void => {
  for (let t = 0; t < seconds - 1e-9; t += dt) seq.update(dt);
};

test('steps run in order, waits take time, and the sequence ends', () => {
  const t = setup([{ id: 'a', steps: [{ do: 'sfx', id: 'one' }, { do: 'wait', s: 1 }, { do: 'sfx', id: 'two' }] }]);
  t.seq.play('a');
  assert.deepEqual(t.log, ['sfx:one']);
  run(t.seq, 0.5);
  assert.deepEqual(t.log, ['sfx:one']);
  run(t.seq, 0.6);
  assert.deepEqual(t.log, ['sfx:one', 'sfx:two']);
  assert.deepEqual(t.ended, [{ id: 'a', reason: 'completed' }]);
  assert.deepEqual(t.seq.running(), []);
});

test('say waits for the line, parallel waits for every branch', () => {
  const t = setup([
    { id: 'a', steps: [{ parallel: [{ do: 'say', line: 'l1' }, { do: 'wait', s: 2 }] }, { do: 'sfx', id: 'after' }] },
  ]);
  t.seq.play('a');
  run(t.seq, 3);
  assert.ok(!t.log.includes('sfx:after'), 'line has not finished');
  t.lines[0]!.done = true;
  run(t.seq, 0.2);
  assert.ok(t.log.includes('sfx:after'));
});

test('control layers are held until the sequence ends, then released', () => {
  const t = setup([
    { id: 'a', steps: [{ do: 'playerControl', move: 'locked', look: 'clamped', weapons: false }, { do: 'wait', s: 1 }] },
  ]);
  t.seq.play('a');
  assert.equal(t.control.state.move, 'locked');
  assert.equal(t.control.state.weapons, false);
  run(t.seq, 1.2);
  assert.equal(t.control.state.move, 'free');
  assert.equal(t.control.state.weapons, true);
});

test('playerControl reset releases layers mid-sequence', () => {
  const t = setup([
    { id: 'a', steps: [{ do: 'playerControl', move: 'locked' }, { do: 'wait', s: 1 }, { do: 'playerControl', reset: true }, { do: 'wait', s: 1 }] },
  ]);
  t.seq.play('a');
  run(t.seq, 1.2);
  assert.equal(t.control.state.move, 'free');
  assert.equal(t.seq.running().length, 1);
});

test('if picks a branch from a flag, and setFlag feeds later steps', () => {
  const t = setup([
    {
      id: 'a',
      steps: [
        { do: 'setFlag', flag: 'met', value: true },
        { if: { flag: 'met' }, then: [{ do: 'sfx', id: 'yes' }], else: [{ do: 'sfx', id: 'no' }] },
      ],
    },
  ]);
  t.seq.play('a');
  assert.deepEqual(t.log, ['sfx:yes']);
});

test('waitFor resumes on the event and honours a timeout', () => {
  const t = setup([
    { id: 'a', steps: [{ do: 'waitFor', event: 'door:opened' }, { do: 'sfx', id: 'go' }] },
    { id: 'b', steps: [{ do: 'waitFor', event: 'never', timeout: 1 }, { do: 'sfx', id: 'timed' }] },
  ]);
  t.seq.play('a');
  t.seq.play('b');
  run(t.seq, 0.5);
  assert.ok(!t.log.includes('sfx:go'));
  (t.events.emit as (n: string, p: unknown) => void)('door:opened', {});
  run(t.seq, 0.2);
  assert.ok(t.log.includes('sfx:go'));
  run(t.seq, 1);
  assert.ok(t.log.includes('sfx:timed'));
});

test('skipping applies every remaining end state and matches watching to the end', () => {
  const def: SequenceDef = {
    id: 'intro',
    skippable: true,
    steps: [
      { do: 'fade', to: 0, s: 1 },
      { do: 'playerControl', move: 'locked' },
      { do: 'say', line: 'l1' },
      { do: 'setFlag', flag: 'introSeen', value: true },
      { do: 'playerWalkTo', pos: [1, 0, 2] },
      { do: 'say', line: 'l2' },
      { do: 'playerPlace', pos: [5, 0, 5], yaw: 1 },
      { do: 'checkpoint', id: 'cp_intro' },
    ],
  };
  const watched = setup([def]);
  watched.seq.play('intro');
  for (let i = 0; i < 200; i++) {
    for (const l of watched.lines) l.done = true;
    for (const w of watched.walks) w.done = true;
    watched.seq.update(0.1);
  }
  const skipped = setup([def]);
  skipped.seq.play('intro');
  run(skipped.seq, 0.3); // partway through the opening fade
  assert.equal(skipped.seq.skippable, true);
  assert.equal(skipped.seq.skip(), true);

  assert.equal(skipped.flags['introSeen'], true);
  assert.equal(skipped.control.state.move, 'free', 'layers released when the sequence ends');
  assert.deepEqual(skipped.ended, [{ id: 'intro', reason: 'skipped' }]);
  assert.deepEqual(skipped.seq.running(), []);
  for (const must of ['played:l1', 'played:l2', 'place:1,0,2', 'place:5,0,5', 'cp:cp_intro', 'fade:0:0']) {
    assert.ok(skipped.log.includes(must), `skip log is missing ${must}: ${skipped.log.join(' ')}`);
  }
  // Same end state as watching: last placement, checkpoint, flag.
  assert.equal(watched.flags['introSeen'], skipped.flags['introSeen']);
  assert.equal(watched.log.filter((e) => e.startsWith('cp:')).length, skipped.log.filter((e) => e.startsWith('cp:')).length);
  assert.equal(watched.log.filter((e) => e.startsWith('place:')).at(-1), skipped.log.filter((e) => e.startsWith('place:')).at(-1));
});

test('a sequence that is not skippable ignores skip', () => {
  const t = setup([{ id: 'drop', steps: [{ do: 'wait', s: 5 }] }]);
  t.seq.play('drop');
  assert.equal(t.seq.skippable, false);
  assert.equal(t.seq.skip(), false);
  assert.equal(t.seq.running().length, 1);
});

test('skip works at any point, including the very first step and a step already finished', () => {
  const def: SequenceDef = { id: 's', skippable: true, steps: [{ do: 'checkpoint', id: 'c' }, { do: 'wait', s: 9 }, { do: 'sfx', id: 'end' }] };
  const t = setup([def]);
  t.seq.play('s');
  t.seq.skip();
  assert.equal(t.log.filter((e) => e === 'cp:c').length, 1, 'a completed step is not applied twice');
  assert.ok(t.log.includes('sfx:end'));
});

test('cancelAll stops with no end state and frees control; once marks only finished runs', () => {
  const t = setup([{ id: 'a', once: true, steps: [{ do: 'playerControl', move: 'locked' }, { do: 'wait', s: 9 }, { do: 'checkpoint', id: 'late' }] }]);
  t.seq.play('a');
  t.seq.cancelAll();
  assert.equal(t.control.state.move, 'free');
  assert.ok(!t.log.includes('cp:late'));
  assert.deepEqual(t.ended, [{ id: 'a', reason: 'cancelled' }]);
  assert.equal(t.seq.play('a'), true, 'a cancelled once-sequence may run again');
  t.seq.skip(); // not skippable: no effect
  t.seq.cancelAll();
});

test('once: a completed or skipped sequence does not run again', () => {
  const t = setup([{ id: 'a', once: true, skippable: true, steps: [{ do: 'wait', s: 9 }] }]);
  t.seq.play('a');
  t.seq.skip();
  assert.equal(t.flags['seq:a'], true);
  assert.equal(t.seq.play('a'), false);
});

test('exclusive groups and duplicate plays are refused', () => {
  const t = setup([
    { id: 'a', exclusive: 'player', steps: [{ do: 'wait', s: 9 }] },
    { id: 'b', exclusive: 'player', steps: [{ do: 'wait', s: 9 }] },
  ]);
  assert.equal(t.seq.play('a'), true);
  assert.equal(t.seq.play('a'), false);
  assert.equal(t.seq.play('b'), false);
});

test('bad data fails at register with a readable path', () => {
  const t = setup([]);
  assert.throws(() => t.seq.register({ id: 'x', steps: [{ do: 'wiat', s: 1 }] }), /steps\[0\].*unknown action 'wiat'/);
  assert.throws(() => t.seq.register({ id: 'x', steps: [{ do: 'wait', s: 'two' }] }), /"s" must be a number/);
  assert.throws(() => t.seq.register({ id: 'x', steps: [{ parallel: [{ do: 'fade', to: 3 }] }] }), /parallel.*"to" must be 0 to 1/);
  assert.throws(() => t.seq.play('missing'), /Unknown sequence/);
});

test('every shipped cutscene file registers with this runtime (data/cutscenes)', () => {
  const dir = new URL('../data/cutscenes/', import.meta.url);
  const defs = readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .map((n) => JSON.parse(readFileSync(new URL(n, dir), 'utf8')) as SequenceDef);
  assert.ok(defs.length > 0);
  setup(defs);
});
