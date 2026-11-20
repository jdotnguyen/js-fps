import { test } from 'node:test';
import assert from 'node:assert/strict';
import killsJson from '../data/kills.json' with { type: 'json' };
import { validate } from '../core/validate.ts';
import { validateKillTable, type KillStyle } from '../data/types/kills.ts';
import { KillRun, type KillHooks } from './killRun.ts';

const kills = validate(validateKillTable, killsJson, 'data/kills.json');
const grown = kills['grownInside']!;

function harness(style: KillStyle, opts: { glass?: boolean; arriveAfter?: number; creatureAfter?: number } = {}) {
  const beats: string[] = [];
  const convulse = new Map<string, number>();
  const events: Array<{ beat: string; do: string; t: number }> = [];
  let now = 0;
  let current = '';
  let beatStart = 0;
  let isDone = false;
  const hooks: KillHooks = {
    beat: (id) => {
      beats.push(id);
      current = id;
      beatStart = now;
    },
    pose: () => undefined,
    convulse: (target) => void convulse.set(current, target),
    bulge: () => undefined,
    event: (e) => void events.push({ beat: current, do: e.do, t: now - beatStart }),
    facesGlass: () => opts.glass ?? true,
    arrived: () => now - beatStart >= (opts.arriveAfter ?? 1),
    creatureReady: () => now - beatStart >= (opts.creatureAfter ?? 1),
    done: () => void (isDone = true),
  };
  const run = new KillRun(style, { scratch: 'plea', glass: 'scream' }, hooks);
  const step = (seconds: number): void => {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      now += 1 / 60;
      run.update(1 / 60);
    }
  };
  return { run, beats, convulse, events, step, done: () => isDone, now: () => now };
}

test('a grown-inside kill plays its beats in order: scratch, panic, glass, arch, burst, still, creature', () => {
  const h = harness(grown);
  h.step(0.1);
  assert.deepEqual(h.beats, ['scratch']);
  h.run.lineEnded('plea');
  h.step(2);
  h.run.lineEnded('scream');
  h.step(15);
  assert.deepEqual(h.beats, ['scratch', 'panic', 'glass', 'arch', 'burst', 'still', 'creature']);
  assert.ok(h.done(), 'the kill ends');
});

test('beats follow their audio: the scream ending starts the arch', () => {
  const h = harness(grown);
  h.step(0.05);
  h.run.lineEnded('plea');
  h.step(1.5); // panic -> glass (arrived after 1 s)
  assert.equal(h.run.beatId, 'glass');
  h.step(0.5);
  assert.equal(h.run.beatId, 'glass', 'the glass beat holds while she screams');
  h.run.lineEnded('scream');
  h.step(1 / 60);
  assert.equal(h.run.beatId, 'arch', 'the arch begins as the scream ends');
});

test('a missing recording never stops the kill: each beat ends at its time limit', () => {
  const h = harness(grown, { arriveAfter: 99, creatureAfter: 99 });
  const limit = grown.beats.reduce((s, b) => s + b.max, 0);
  h.step(limit + 1);
  assert.deepEqual(h.beats, ['scratch', 'panic', 'glass', 'arch', 'burst', 'still', 'creature']);
  assert.ok(h.done());
});

test('a line that ends before its beat starts still closes that beat', () => {
  const h = harness(grown);
  h.run.lineEnded('plea');
  h.step(0.1);
  assert.equal(h.run.beatId, 'panic');
});

test('without glass the kill skips the glass beat', () => {
  const h = harness(grown, { glass: false });
  h.step(0.05);
  h.run.lineEnded('plea');
  h.step(14);
  assert.deepEqual(h.beats, ['scratch', 'panic', 'arch', 'burst', 'still', 'creature']);
});

test('convulsion builds to the burst: panic < arch < burst, and none once she is still', () => {
  const h = harness(grown);
  h.step(0.05);
  h.run.lineEnded('plea');
  h.run.lineEnded('scream');
  h.step(15);
  const c = (b: string): number => h.convulse.get(b) ?? -1;
  assert.ok(c('scratch') < c('panic') && c('panic') < c('arch') && c('arch') < c('burst'), JSON.stringify([...h.convulse]));
  assert.equal(c('burst'), 1);
  assert.equal(c('still'), 0);
  const twitches = h.events.filter((e) => e.beat === 'still' && e.do === 'kick');
  assert.ok(twitches.length <= 2, 'at most two death twitches');
});

test('every bone crunch in the arch comes with a jolt at the same moment', () => {
  const h = harness(grown);
  h.step(0.05);
  h.run.lineEnded('plea');
  h.run.lineEnded('scream');
  h.step(15);
  const arch = h.events.filter((e) => e.beat === 'arch');
  const crunches = arch.filter((e) => e.do === 'sfx');
  assert.ok(crunches.length >= 3);
  for (const c of crunches) assert.ok(arch.some((e) => e.do === 'kick' && Math.abs(e.t - c.t) < 1e-6), `a kick with the crunch at ${c.t.toFixed(2)} s`);
});

test('the creature appears in the first second of the burst, and the chest tears then', () => {
  const h = harness(grown);
  h.step(0.05);
  h.run.lineEnded('plea');
  h.run.lineEnded('scream');
  h.step(15);
  const burst = h.events.filter((e) => e.beat === 'burst');
  const creature = burst.find((e) => e.do === 'creature');
  assert.ok(creature && creature.t < 1);
  assert.ok(burst.some((e) => e.do === 'tear'));
});

test('a skipped or restored kill jumps to its end state at once', () => {
  const h = harness(grown);
  h.run.finishNow();
  assert.ok(h.done());
  const kinds = new Set(h.events.map((e) => e.do));
  for (const k of ['tear', 'die', 'creature']) assert.ok(kinds.has(k), k);
  assert.equal(kinds.has('sfx'), false, 'no sounds on a restore');
});

test('the kill table is checked: a beat with no time limit is refused', () => {
  const bad = structuredClone(killsJson) as Record<string, { beats: Array<Record<string, unknown>> }>;
  delete bad['grownInside']!.beats[0]!['max'];
  assert.throws(() => validate(validateKillTable, bad, 'kills'), /max/);
  const late = structuredClone(killsJson) as Record<string, { beats: Array<{ events?: Array<Record<string, unknown>> }> }>;
  late['grownInside']!.beats[3]!.events![0]!['t'] = 30;
  assert.throws(() => validate(validateKillTable, late, 'kills'), /time limit/);
});
