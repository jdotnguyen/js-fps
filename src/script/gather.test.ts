import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SequenceHost } from './host.ts';
import { SequenceManager } from './runtime.ts';
import { validateSequences } from './schema.ts';
import type { Flags } from './types.ts';

// scene-gathering and squad-tasks specs: the `gatherIn` and `squadRegroup` steps.

type Who = 'player' | 'giles' | 'okafor';

function setup(steps: unknown[], skippable = false) {
  const inside: Record<Who, boolean> = { player: true, giles: false, okafor: false };
  const log: string[] = [];
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
        for (const fn of [...(handlers.get(name) ?? [])]) fn(payload);
      },
    },
    flags: {} as Flags,
    resolve: () => ({ x: 0, y: 0, z: 0 }),
    warn: (m) => log.push(`warn ${m}`),
    setDoor: (id, state) => {
      log.push(`door ${id} ${state}`);
      return true;
    },
    inRoom: (who, room) => {
      assert.equal(room, 'R03');
      return inside[who];
    },
    squadPlaceIn: (room) => {
      log.push(`placeIn ${room}`);
      const moved = (['giles', 'okafor'] as const).filter((w) => !inside[w]);
      for (const w of moved) inside[w] = true;
      return [...moved];
    },
    squadRegroup: (distance) => {
      log.push(`regroup ${distance ?? 'default'}`);
      return [];
    },
  };
  const defs = validateSequences({ 'test.json': [{ id: 'scene', ...(skippable ? { skippable: true } : {}), steps }] });
  const m = new SequenceManager(host, defs);
  const tick = (s: number): void => {
    for (let t = 0; t < s; t += 0.1) m.update(0.1);
  };
  return { m, inside, log, tick };
}

const SEAL = [
  { do: 'gatherIn', room: 'R03' },
  { do: 'doorState', id: 'D_R02_R03', state: 'sealed' },
];

test('gatherIn holds the seal until both squadmates walk in', () => {
  const { m, inside, log, tick } = setup(SEAL);
  m.start('scene');
  tick(3);
  assert.ok(!log.includes('door D_R02_R03 sealed'), 'squad still outside');
  inside.giles = true;
  tick(1);
  assert.ok(!log.includes('door D_R02_R03 sealed'), 'Okafor still outside');
  inside.okafor = true;
  tick(0.3);
  assert.ok(log.includes('door D_R02_R03 sealed'));
  assert.ok(!log.includes('placeIn R03'), 'nobody needed placing');
});

test('after the timeout stragglers are placed inside and the door seals', () => {
  const { m, log, tick } = setup([{ do: 'gatherIn', room: 'R03', timeout: 2 }, SEAL[1]]);
  m.start('scene');
  tick(1.5);
  assert.ok(!log.includes('placeIn R03'));
  tick(1);
  assert.ok(log.includes('placeIn R03'));
  tick(0.3);
  assert.ok(log.includes('door D_R02_R03 sealed'));
});

test('the door does not seal while Jay is outside, timeout or not', () => {
  const { m, inside, log, tick } = setup(SEAL);
  inside.player = false;
  inside.giles = true;
  inside.okafor = true;
  m.start('scene');
  tick(20);
  assert.ok(!log.includes('door D_R02_R03 sealed'), 'waits for Jay with no timeout');
  inside.player = true;
  tick(0.3);
  assert.ok(log.includes('door D_R02_R03 sealed'));
});

test('skipping a gather places the squad inside', () => {
  const { m, log, tick } = setup(SEAL, true);
  m.start('scene');
  tick(0.5);
  m.skip();
  tick(0.3);
  assert.ok(log.includes('placeIn R03'));
  assert.ok(log.includes('door D_R02_R03 sealed'));
  assert.ok(!m.isRunning('scene'));
});

test('squadRegroup asks the host to regroup and goes straight on', () => {
  const { m, log, tick } = setup([{ do: 'squadRegroup' }, { do: 'squadRegroup', distance: 20 }, SEAL[1]]);
  m.start('scene');
  tick(0.2);
  assert.deepEqual(log, ['regroup default', 'regroup 20', 'door D_R02_R03 sealed']);
});

test('slice01 data: the gallery seals only after the gather; the squad job beats regroup first', async () => {
  const { readFileSync } = await import('node:fs');
  const load = (f: string) => JSON.parse(readFileSync(new URL(`../data/sequences/${f}.json`, import.meta.url), 'utf8')) as Array<{ id: string; steps: Array<Record<string, unknown>> }>;
  const drop = load('drop').find((s) => s.id === 'drop')!.steps;
  const gather = drop.findIndex((s) => s['do'] === 'gatherIn' && s['room'] === 'R03');
  const seal = drop.findIndex((s) => s['do'] === 'doorState' && s['id'] === 'D_R02_R03');
  assert.ok(gather >= 0 && seal === gather + 1, 'gatherIn R03 right before the seal');
  assert.ok(drop.slice(0, gather).filter((s) => s['do'] === 'npcMoveTo').length === 2, 'both squadmates are sent in first');
  for (const [file, id] of [['action_contact', 'cover_me'], ['action_tunnel', 'medlab_door'], ['action_climax', 'climax']] as const) {
    assert.equal(load(file).find((s) => s.id === id)!.steps[0]!['do'], 'squadRegroup', `${id} starts with squadRegroup`);
  }
});

test('slice01 data: the climax seals the dive bay with its north entrance and gathers in R11 before sealing R11', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (f: string) => readFileSync(new URL(`../data/sequences/${f}.json`, import.meta.url), 'utf8');
  const climax = (JSON.parse(read('action_climax')) as Array<{ id: string; steps: Array<Record<string, unknown>> }>).find((s) => s.id === 'climax')!.steps;
  const at = (pred: (s: Record<string, unknown>) => boolean) => climax.findIndex(pred);
  const north = at((s) => s['do'] === 'doorState' && s['id'] === 'D_R13d_R11' && s['state'] === 'open');
  assert.equal(climax[north + 1]?.['id'], 'D_R13b_R13d', 'dive bay sealed as the corridor opens');
  assert.equal(climax[north + 1]?.['state'], 'sealed');
  const gather = at((s) => s['do'] === 'gatherIn' && s['room'] === 'R11');
  const line = at((s) => s['do'] === 'say' && s['line'] === 'climax_giles_03');
  const seal = at((s) => s['do'] === 'doorState' && s['id'] === 'D_R10_R11' && s['state'] === 'sealed');
  assert.ok(gather > at((s) => 'parallel' in s), 'after the fight');
  assert.ok(gather < line && line < seal, 'gather, then "Doors sealing", then the seal');
  assert.match(read('action_restore'), /"flag": "climax_started",\s*"then": \[\s*\{\s*"do": "doorState",\s*"id": "D_R13b_R13d",\s*"state": "sealed"/, 'a load re-seals the dive bay');
});
