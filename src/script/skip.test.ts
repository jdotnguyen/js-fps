/** intro-sequence spec: skipping a sequence applies every remaining end state, exactly once. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ControlStack } from '../actors/control.ts';
import type { SequenceHost } from './host.ts';
import { SequenceManager } from './runtime.ts';
import { validateSequences } from './schema.ts';
import type { Flags, SequenceDef } from './types.ts';

function makeHost() {
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  const log: string[] = [];
  const ended: Array<Record<string, unknown>> = [];
  const control = new ControlStack();
  const walks: Array<() => void> = [];
  const lines: Array<() => void> = [];
  let fadeLevel = 0;
  const host: SequenceHost = {
    events: {
      on(name, fn) {
        const set = handlers.get(name) ?? new Set();
        handlers.set(name, set);
        set.add(fn);
        return () => set.delete(fn);
      },
      emit(name, payload) {
        if (name === 'sequence:ended') ended.push(payload as Record<string, unknown>);
        for (const fn of [...(handlers.get(name) ?? [])]) fn(payload);
      },
    },
    flags: {} as Flags,
    resolve: (t) => (Array.isArray(t) ? { x: t[0], y: t[1], z: t[2] } : { x: 9, y: 0, z: 9 }),
    warn: (m) => log.push(`warn ${m}`),
    pushControl: (over, owner) => control.push(over, owner),
    fade: (level, s) => {
      fadeLevel = level;
      log.push(`fade ${level} ${s}`);
    },
    walkTo: (at) => {
      log.push(`walk ${at.x},${at.z}`);
      return new Promise<void>((r) => walks.push(r));
    },
    placePlayer: (at, yaw) => log.push(`place ${at.x},${at.y ?? '-'},${at.z}${yaw === undefined ? '' : ` yaw ${yaw}`}`),
    say: (line) => {
      log.push(`say ${line}`);
      return { done: new Promise<void>((r) => lines.push(r)) };
    },
    markLinePlayed: (line) => log.push(`played ${line}`),
    stopSpeech: () => log.push('stopSpeech'),
    sfx: (id) => log.push(`sfx ${id}`),
    setDoor: (id, state) => {
      log.push(`door ${id} ${state}`);
      return true;
    },
    checkpoint: (id) => log.push(`checkpoint ${id}`),
    npc: (action, step) => {
      log.push(`npc ${action} ${String(step['npc'])}${step['instant'] ? ' instant' : ''}`);
    },
  };
  return { host, log, ended, control, walks, lines, get fadeLevel() { return fadeLevel; } };
}

function setup(defs: unknown[]) {
  const t = makeHost();
  return { t, m: new SequenceManager(t.host, validateSequences({ 'test.json': defs })) };
}

const tick = (m: SequenceManager, seconds: number): void => {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) m.update(1 / 60);
};

const INTRO: SequenceDef = {
  id: 'intro',
  skippable: true,
  steps: [
    { do: 'fade', to: 0, s: 1, wait: true },
    { do: 'playerControl', move: 'locked' },
    { do: 'say', line: 'l1' },
    { do: 'setFlag', flag: 'introSeen', value: true },
    { do: 'playerWalkTo', to: [1, 0, 2], wait: true },
    { do: 'npcMoveTo', npc: 'giles', to: [3, 0, 3], wait: true },
    { do: 'say', line: 'l2' },
    { do: 'playerPlace', at: [5, 0, 5], yaw: 1 },
    { do: 'sfx', id: 'door' },
    { do: 'checkpoint', id: 'cp_intro' },
  ],
};

test('skip mid-scene applies every remaining end state once and releases control', () => {
  const { t, m } = setup([INTRO]);
  m.start('intro');
  tick(m, 0.3); // partway through the opening fade
  assert.equal(m.skippable, true);
  assert.equal(m.skip(), true);

  assert.equal(t.host.flags['introSeen'], true);
  assert.equal(t.control.state.move, 'free', 'control layers released when the scene ends');
  assert.deepEqual(m.running(), []);
  assert.equal(t.ended.at(-1)?.['skipped'], true);
  assert.equal(t.fadeLevel, 0);
  assert.ok(t.log.includes('fade 0 0'), 'the in-flight fade jumps to its final level');
  for (const must of ['played l1', 'played l2', 'place 1,-,2', 'place 5,0,5 yaw 1', 'npc npcMoveTo giles instant', 'checkpoint cp_intro', 'stopSpeech']) {
    assert.ok(t.log.includes(must), `missing "${must}" in: ${t.log.join(' | ')}`);
  }
  assert.ok(!t.log.includes('sfx door'), 'sounds are not replayed when skipping');
  assert.equal(t.log.filter((e) => e === 'checkpoint cp_intro').length, 1);
});

test('skipping reaches the same end state as watching to the end', async () => {
  const watched = setup([INTRO]);
  watched.m.start('intro');
  for (let i = 0; i < 600; i++) {
    for (const r of watched.t.walks.splice(0)) r();
    for (const r of watched.t.lines.splice(0)) r();
    watched.m.update(1 / 60);
    await Promise.resolve(); // let resolved walks and lines settle, as real frames do
    await Promise.resolve();
  }
  assert.deepEqual(watched.m.running(), [], 'the watched scene finished');
  const skipped = setup([INTRO]);
  skipped.m.start('intro');
  tick(skipped.m, 0.5);
  skipped.m.skip();

  assert.equal(skipped.t.host.flags['introSeen'], watched.t.host.flags['introSeen']);
  assert.equal(skipped.t.fadeLevel, watched.t.fadeLevel);
  assert.equal(skipped.t.log.filter((e) => e.startsWith('checkpoint')).length, watched.t.log.filter((e) => e.startsWith('checkpoint')).length);
  assert.equal(skipped.t.log.filter((e) => e.startsWith('place ')).at(-1), watched.t.log.filter((e) => e.startsWith('place ')).at(-1));
});

test('a step that already finished is not applied again; parallel children skip individually', () => {
  const { t, m } = setup([
    {
      id: 'p',
      skippable: true,
      steps: [
        { parallel: [{ do: 'checkpoint', id: 'cp_a' }, { do: 'wait', s: 9 }, { do: 'doorState', id: 'D1', state: 'sealed' }] },
        { do: 'checkpoint', id: 'cp_b' },
      ],
    },
  ]);
  m.start('p');
  tick(m, 0.2); // the instant children ran; the wait is still going
  m.skip();
  assert.equal(t.log.filter((e) => e === 'checkpoint cp_a').length, 1);
  assert.equal(t.log.filter((e) => e === 'door D1 sealed').length, 1);
  assert.equal(t.log.filter((e) => e === 'checkpoint cp_b').length, 1);
});

test('skipping inside an if branch finishes that branch and the steps after it', () => {
  const { t, m } = setup([
    {
      id: 'b',
      skippable: true,
      steps: [
        { do: 'setFlag', flag: 'met' },
        { do: 'if', flag: 'met', then: [{ do: 'wait', s: 9 }, { do: 'doorState', id: 'D1', state: 'open' }], else: [{ do: 'doorState', id: 'D1', state: 'sealed' }] },
        { do: 'doorState', id: 'D2', state: 'closed' },
      ],
    },
  ]);
  m.start('b');
  tick(m, 0.2);
  m.skip();
  assert.deepEqual(t.log.filter((e) => e.startsWith('door')), ['door D1 open', 'door D2 closed']);
});

test('an if that was never reached picks its branch from the flags at skip time', () => {
  const { t, m } = setup([
    {
      id: 'c',
      skippable: true,
      steps: [
        { do: 'wait', s: 9 },
        { do: 'setFlag', flag: 'met' },
        { do: 'if', flag: 'met', then: [{ do: 'doorState', id: 'D1', state: 'open' }], else: [{ do: 'doorState', id: 'D1', state: 'sealed' }] },
      ],
    },
  ]);
  m.start('c');
  m.skip();
  assert.deepEqual(t.log.filter((e) => e.startsWith('door')), ['door D1 open']);
});

test('a sequence that is not skippable ignores skip', () => {
  const { t, m } = setup([{ id: 'drop', steps: [{ do: 'wait', s: 9 }, { do: 'checkpoint', id: 'late' }] }]);
  m.start('drop');
  assert.equal(m.skippable, false);
  assert.equal(m.skip(), false);
  assert.equal(m.running().length, 1);
  assert.ok(!t.log.includes('checkpoint late'));
});

test('skip and the skippable flag show up in running(), and once-sequences stay done', () => {
  const { t, m } = setup([{ id: 'o', skippable: true, once: true, steps: [{ do: 'wait', s: 9 }] }]);
  m.start('o');
  assert.equal(m.running()[0]?.skippable, true);
  m.skip();
  assert.equal(t.host.flags['seq:o'], true);
  assert.equal(t.ended.at(-1)?.['cancelled'], false);
});

test('a skippable sequence with waitFor, loop and timeScale skips cleanly', () => {
  const { t, m } = setup([
    {
      id: 'w',
      skippable: true,
      steps: [
        { do: 'waitFor', event: 'never' },
        { do: 'loop', until: 'never', steps: [{ do: 'wait', s: 1 }] },
        { do: 'timeScale', scale: 0.5, s: 5 },
        { do: 'setFlag', flag: 'done' },
      ],
    },
  ]);
  m.start('w');
  tick(m, 0.2);
  m.skip();
  assert.equal(t.host.flags['done'], true);
  assert.deepEqual(m.running(), []);
});

test('schema accepts skippable and rejects a non-boolean', () => {
  assert.equal(validateSequences({ 'a.json': { id: 'a', skippable: true, steps: [] } })[0]?.skippable, true);
  assert.throws(() => validateSequences({ 'a.json': { id: 'a', skippable: 'yes', steps: [] } }), /skippable/);
});
