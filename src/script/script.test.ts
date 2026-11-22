import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ControlStack } from '../actors/control.ts';
import { ValidationError } from '../core/validate.ts';
import type { SequenceHost } from './host.ts';
import { SequenceManager } from './runtime.ts';
import { validateSequences } from './schema.ts';
import type { Flags, TargetRef, Vec3Like } from './types.ts';

/** In-memory host: records every call so tests can assert order and state. */
function makeHost() {
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  const log: string[] = [];
  const warnings: string[] = [];
  const speech: Array<{ line: string; finish: () => void }> = [];
  const control = new ControlStack();
  let timeScale = 1;
  const doors: Record<string, string> = { D1: 'closed', D2: 'locked' };
  const lights: Record<string, string> = { R03: 'steady' };
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
    resolve: (t: TargetRef): Vec3Like | null => (t === 'npc:ghost' ? null : { x: 1, y: 2, z: 3 }),
    warn: (m) => warnings.push(m),
    pushControl: (over, owner) => control.push(over, owner),
    lookAt: (_at, d) => log.push(`lookAt ${d}`),
    clampLook: (at) => log.push(`clamp ${at ? 'on' : 'off'}`),
    setTimeScale: (n) => {
      timeScale = n;
    },
    setDoor: (id, state) => {
      if (!(id in doors)) return false;
      doors[id] = state;
      log.push(`door ${id} ${state}`);
      return true;
    },
    doorStates: () => ({ ...doors }),
    setLight: (room, pattern) => {
      if (!(room in lights)) return false;
      lights[room] = pattern;
      log.push(`light ${room} ${pattern}`);
      return true;
    },
    lightStates: () => ({ ...lights }),
    glass: (id, state) => log.push(`glass ${id} ${state}`),
    sfx: (id) => log.push(`sfx ${id}`),
    say: (line) => {
      log.push(`say ${line}`);
      let finish = (): void => {};
      const done = new Promise<void>((r) => {
        finish = r;
      });
      speech.push({ line, finish });
      return { done };
    },
    checkpoint: (id) => {
      host.flags[`cp:${id}`] = true;
      log.push(`checkpoint ${id}`);
    },
    npc: (action, step) => {
      log.push(`npc ${action} ${String(step.npc ?? '')}`);
      return step.wait ? new Promise<void>((r) => setTimeout(r, 0)) : undefined;
    },
  };
  return { host, log, warnings, speech, control, doors, lights, get timeScale() { return timeScale; } };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

function tick(m: SequenceManager, seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / 60) m.update(1 / 60);
}

const EXAMPLE = {
  id: 'intro_drop',
  trigger: { event: 'trigger:r03_gallery_enter' },
  once: true,
  steps: [
    { do: 'playerControl', move: 'slow', look: 'free' },
    { do: 'say', line: 'giles_intro_03' },
    { do: 'wait', s: 1.5 },
    {
      parallel: [
        { do: 'lightState', room: 'R03', pattern: 'dying' },
        { do: 'sfx', id: 'power_down', at: 'room:R03' },
        { do: 'playerLookAt', target: 'npc:lab_researcher_01', duration: 0.8 },
      ],
    },
    { do: 'npcAnim', npc: 'lab_researcher_01', anim: 'convulse', wait: true },
    { do: 'transform', npc: 'lab_researcher_01', to: 3, duration: 6 },
    { do: 'glass', id: 'G_R03_R04', state: 'cracked' },
    { do: 'emit', event: 'story:first_drop' },
    { do: 'playerControl', reset: true },
    { do: 'setObjective', id: 'obj_survive_lab' },
    { do: 'checkpoint', id: 'cp_first_contact' },
  ],
};

function manager(defs: unknown[], t = makeHost()) {
  const parsed = validateSequences({ 'test.json': defs });
  return { t, m: new SequenceManager(t.host, parsed) };
}

// -------------------------------------------------------------------------- validation

test('the ADR example validates', () => {
  assert.equal(validateSequences({ 'example.json': EXAMPLE })[0]?.id, 'intro_drop');
});

test('errors carry a readable path', () => {
  assert.throws(
    () => validateSequences({ 'bad.json': { id: 'a', steps: [{ do: 'wait', s: 1 }, { do: 'explode' }] } }),
    (e: unknown) => e instanceof ValidationError && /bad\.json > steps\[1\] > do.*unknown action "explode"/.test(e.message),
  );
  assert.throws(
    () => validateSequences({ 'bad.json': { id: 'a', steps: [{ do: 'wait', s: 'soon' }] } }),
    /steps\[0\] > s/,
  );
  assert.throws(
    () => validateSequences({ 'bad.json': { id: 'a', steps: [{ do: 'wait', s: 1, speed: 2 }] } }),
    /unknown field/,
  );
});

test('loops must be able to end; ids must be unique', () => {
  assert.throws(() => validateSequences({ 'l.json': { id: 'l', steps: [{ do: 'loop', steps: [] }] } }), /never ends/);
  assert.throws(
    () => validateSequences({ 'a.json': { id: 'dup', steps: [] }, 'b.json': { id: 'dup', steps: [] } }),
    /duplicate sequence id "dup"/,
  );
});

test('nested steps are validated too', () => {
  assert.throws(
    () => validateSequences({ 'n.json': { id: 'n', steps: [{ parallel: [{ do: 'wait' }] }] } }),
    /parallel\[0\] > s: missing required field/,
  );
});

// -------------------------------------------------------------------------- running

test('the ADR example runs end to end and restores control', async () => {
  const { t, m } = manager([EXAMPLE]);
  t.host.events.emit('trigger:fired', { id: 'x', event: 'r03_gallery_enter' });
  assert.deepEqual(t.control.owners(), ['seq:intro_drop']);
  assert.equal(t.control.state.move, 'slow');
  assert.deepEqual(t.log.filter((l) => l.startsWith('say')), ['say giles_intro_03']);

  tick(m, 3);
  assert.ok(!t.log.includes('light R03 dying'), 'still waiting for the line to finish');
  t.speech[0]!.finish();
  await flush();
  tick(m, 1.4);
  assert.ok(!t.log.includes('light R03 dying'), 'then 1.5 s of wait');
  tick(m, 0.2);
  assert.ok(t.log.includes('light R03 dying') && t.log.includes('sfx power_down') && t.log.includes('lookAt 0.8'));

  await flush();
  tick(m, 0.1);
  await flush();
  tick(m, 0.1);
  assert.ok(!m.isRunning('intro_drop'));
  assert.deepEqual(t.log.filter((l) => l.startsWith('npc')), ['npc npcAnim lab_researcher_01', 'npc transform lab_researcher_01']);
  assert.ok(t.log.indexOf('glass G_R03_R04 cracked') < t.log.indexOf('event story:first_drop'));
  assert.equal(t.host.flags['obj:obj_survive_lab'], 'active');
  assert.equal(t.host.flags['cp:cp_first_contact'], true);
  assert.equal(t.host.flags['seq:intro_drop'], true);
  assert.deepEqual(t.control.owners(), [], 'control released');
  assert.equal(t.control.state.move, 'free');

  // once: the trigger does nothing the second time.
  t.log.length = 0;
  t.host.events.emit('trigger:fired', { id: 'x', event: 'r03_gallery_enter' });
  assert.ok(!m.isRunning('intro_drop'));
});

test('cancel and failure release everything the sequence took', () => {
  const { t, m } = manager([
    {
      id: 'hold',
      steps: [
        { do: 'playerControl', move: 'locked', look: 'locked' },
        { do: 'playerClampLook', target: [0, 0, 0] },
        { do: 'timeScale', scale: 0.5 },
        { do: 'wait', s: 99 },
      ],
    },
    { id: 'broken', steps: [{ do: 'playerControl', move: 'locked' }, { do: 'runHook', hook: 'nope' }] },
  ]);
  m.start('hold');
  assert.equal(t.control.state.move, 'locked');
  assert.equal(t.timeScale, 0.5);
  m.cancel('hold');
  assert.equal(t.control.state.move, 'free');
  assert.equal(t.timeScale, 1);
  assert.equal(t.log.at(-1), 'event sequence:ended');
  assert.ok(t.log.includes('clamp off'));

  m.start('broken');
  assert.equal(t.control.state.move, 'free', 'failed sequence did not leave the player locked');
  assert.match(t.warnings.at(-1) ?? '', /unknown hook "nope"/);
});

test('unresolvable targets and missing systems warn instead of hanging', () => {
  const { t, m } = manager([
    { id: 'soft', steps: [{ do: 'playerLookAt', target: 'npc:ghost', wait: true }, { do: 'water', room: 'R09', level: 1 }, { do: 'setFlag', flag: 'reached' }] },
  ]);
  m.start('soft');
  assert.equal(t.host.flags.reached, true);
  assert.ok(t.warnings.some((w) => /cannot resolve target/.test(w)));
  assert.ok(t.warnings.some((w) => /water is not available yet/.test(w)));
});

test('flags, if, loop, waitFor and hooks', async () => {
  const { t, m } = manager([
    {
      id: 'logic',
      steps: [
        { do: 'setFlag', flag: 'power', value: false },
        { do: 'if', flag: 'power', then: [{ do: 'setFlag', flag: 'branch', value: 'on' }], else: [{ do: 'setFlag', flag: 'branch', value: 'off' }] },
        { do: 'runHook', hook: 'tally', args: { n: 2 } },
        { do: 'loop', until: 'story:stop', steps: [{ do: 'sfx', id: 'beep' }, { do: 'wait', s: 0.5 }] },
        { do: 'waitFor', event: 'never', timeout: 0.25 },
        { do: 'setFlag', flag: 'finished' },
      ],
    },
  ]);
  let tally = 0;
  m.registerHook('tally', ({ args }) => {
    tally += Number(args.n);
  });
  m.start('logic');
  assert.equal(t.host.flags.branch, 'off');
  assert.equal(tally, 2);
  tick(m, 1.2);
  const beeps = t.log.filter((l) => l === 'sfx beep').length;
  assert.ok(beeps >= 3, `loop repeats (${beeps})`);
  t.host.events.emit('story:stop', {});
  tick(m, 0.1);
  assert.ok(!t.host.flags.finished, 'waitFor times out first');
  tick(m, 0.4);
  assert.equal(t.host.flags.finished, true);
  await flush();
});

test('exclusive sequences queue instead of overlapping', () => {
  const { t, m } = manager([
    { id: 'one', exclusive: 'player', steps: [{ do: 'wait', s: 1 }, { do: 'setFlag', flag: 'one' }] },
    { id: 'two', exclusive: 'player', steps: [{ do: 'setFlag', flag: 'two' }] },
  ]);
  m.start('one');
  m.start('two');
  assert.ok(!t.host.flags.two);
  tick(m, 1.1);
  assert.equal(t.host.flags.one, true);
  assert.equal(t.host.flags.two, true);
});

test('triggers honour `requires`', () => {
  const { t, m } = manager([{ id: 'gated', trigger: { event: 'door:opened', requires: 'armed' }, steps: [{ do: 'setFlag', flag: 'ran' }] }]);
  t.host.events.emit('door:opened', { id: 'D1' });
  assert.ok(!t.host.flags.ran);
  t.host.flags.armed = true;
  t.host.events.emit('door:opened', { id: 'D1' });
  assert.equal(t.host.flags.ran, true);
  void m;
});

const GATED_ROOM = { id: 'armory', trigger: { event: 'trigger:r07_enter', requires: 'cover_done', unless: 'armory_open' }, steps: [{ do: 'setFlag', flag: 'ran_count', value: 1 }] };
/** A level trigger as the level announces it: `trigger:fired` plus the emit name on the bus (ADR-0003). */
function enterTrigger(t: ReturnType<typeof makeHost>, emit: string): void {
  t.host.events.emit('trigger:fired', { id: `trig_${emit}`, event: `trigger:${emit}` });
  t.host.events.emit(`trigger:${emit}`, {});
}

test('a level trigger reached before `requires` is held, and starts once the flag is set', () => {
  const { t, m } = manager([GATED_ROOM]);
  enterTrigger(t, 'r07_enter');
  tick(m, 0.5);
  assert.ok(!t.host.flags.ran_count, 'not yet');
  t.host.flags.cover_done = true;
  tick(m, 0.1);
  assert.equal(t.host.flags.ran_count, 1);
  // At most once, even though it reached the sequence by both routes.
  t.host.flags.ran_count = 0;
  tick(m, 1);
  assert.equal(t.host.flags.ran_count, 0);
});

test('a held level trigger is dropped when `unless` is set first', () => {
  const { t, m } = manager([GATED_ROOM]);
  enterTrigger(t, 'r07_enter');
  t.host.flags.armory_open = true;
  tick(m, 0.1);
  t.host.flags.cover_done = true;
  tick(m, 0.5);
  assert.ok(!t.host.flags.ran_count);
});

test('a repeatable bus event is not held', () => {
  const { t, m } = manager([{ id: 'medlab', trigger: { event: 'door:denied', match: { id: 'D_R07_R09' }, requires: 'sec_done' }, steps: [{ do: 'setFlag', flag: 'ran' }] }]);
  t.host.events.emit('door:denied', { id: 'D_R07_R09' });
  t.host.flags.sec_done = true;
  tick(m, 0.5);
  assert.ok(!t.host.flags.ran, 'the early try is not replayed');
  t.host.events.emit('door:denied', { id: 'D_R07_R09' });
  assert.equal(t.host.flags.ran, true, 'a try after sec_done starts it');
});

test('death and checkpoint restart drop held level triggers', () => {
  const { t, m } = manager([GATED_ROOM]);
  enterTrigger(t, 'r07_enter');
  t.host.events.emit('player:died', {});
  t.host.events.emit('game:restarted', { checkpoint: null });
  t.host.flags.cover_done = true;
  tick(m, 0.5);
  assert.ok(!t.host.flags.ran_count, 'nothing held after the restart');
  enterTrigger(t, 'r07_enter');
  tick(m, 0.1);
  assert.equal(t.host.flags.ran_count, 1, 'entering again works under the flags as they stand');
});

// -------------------------------------------------------------------------- checkpoints

test('dying mid-sequence restores a consistent state', () => {
  const { t, m } = manager([
    {
      id: 'lockdown',
      resumeFromCheckpoint: true,
      steps: [
        { do: 'playerControl', move: 'locked' },
        { do: 'doorState', id: 'D1', state: 'sealed' },
        { do: 'lightState', room: 'R03', pattern: 'alarm' },
        { do: 'wait', s: 5 },
        { do: 'checkpoint', id: 'cp_after' },
      ],
    },
    {
      id: 'ambient',
      steps: [{ do: 'doorState', id: 'D2', state: 'open' }, { do: 'wait', s: 99 }],
    },
    { id: 'early', steps: [{ do: 'checkpoint', id: 'cp_early' }] },
  ]);
  m.start('early');
  const flagsAtCheckpoint = { ...t.host.flags };
  assert.equal(t.doors.D1, 'closed');

  m.start('lockdown');
  m.start('ambient');
  tick(m, 1);
  assert.equal(t.doors.D1, 'sealed');
  assert.equal(t.doors.D2, 'open');
  assert.equal(t.lights.R03, 'alarm');

  // The player dies; the game reloads the checkpoint autosave (flags back to checkpoint).
  t.host.events.emit('player:died', {});
  assert.deepEqual(m.running(), [], 'everything stopped at death');
  assert.equal(t.control.state.move, 'free');
  t.host.flags = { ...flagsAtCheckpoint } as Flags;
  t.host.events.emit('game:restarted', { checkpoint: 'cp_early' });

  assert.equal(t.doors.D2, 'locked', 'a non-resumable sequence\'s door change was undone');
  // `lockdown` was resumable and had not reached its checkpoint: it replays from step 0.
  assert.deepEqual(m.running().map((r) => r.id), ['lockdown']);
  assert.equal(m.running()[0]?.elapsed, 0);
  assert.equal(t.doors.D1, 'sealed');
  assert.equal(t.lights.R03, 'alarm');
  assert.equal(t.control.state.move, 'locked');
  tick(m, 5.2);
  assert.ok(!m.isRunning('lockdown'));
  assert.equal(t.control.state.move, 'free');
  assert.equal(t.host.flags['cp:cp_after'], true);
});

test('a sequence that already took its checkpoint is not replayed', () => {
  const { t, m } = manager([
    { id: 'done', resumeFromCheckpoint: true, steps: [{ do: 'checkpoint', id: 'cp_a' }, { do: 'wait', s: 10 }] },
  ]);
  m.start('done');
  t.host.events.emit('player:died', {});
  t.host.events.emit('game:restarted', { checkpoint: 'cp_a' });
  assert.deepEqual(m.running(), []);
});

// -------------------------------------------------------------------------- shipped data

test('every shipped sequence file validates', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const dir = new URL('../data/sequences/', import.meta.url);
  const files: Record<string, unknown> = {};
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.json')) files[`data/sequences/${name}`] = JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
  }
  const defs = validateSequences(files);
  assert.ok(defs.some((d) => d.id === 'test_drop'));
});

test('a music step naming an unknown track fails validation, naming the step', () => {
  assert.throws(
    () => validateSequences({ 'data/sequences/t.json': { id: 't', steps: [{ do: 'music', id: 'nope' }] } }),
    (e: Error) => /t\.json/.test(e.message) && /steps\[0\]/.test(e.message) && /nope/.test(e.message),
  );
  // Known tracks and stop steps validate.
  validateSequences({ 'data/sequences/t.json': { id: 't', steps: [{ do: 'music', id: 'main_theme' }, { do: 'music', stop: true }] } });
});

test('the shipped test_drop sequence runs headless to its checkpoint', async () => {
  const { readFileSync } = await import('node:fs');
  const raw = JSON.parse(readFileSync(new URL('../data/sequences/test_drop.json', import.meta.url), 'utf8')) as unknown;
  const { t, m } = manager([raw]);
  m.start('test_drop');
  t.speech[0]?.finish();
  for (let i = 0; i < 8; i++) {
    tick(m, 1);
    await flush();
  }
  assert.ok(!m.isRunning('test_drop'), 'finished');
  assert.equal(t.host.flags['cp:cp_lab'], true);
  assert.equal(t.doors.D1, 'sealed');
  assert.equal(t.control.state.move, 'free');
});
