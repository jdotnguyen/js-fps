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

// ---- mauled (medbay-attack / infection-kills specs): impacts end the slam beat, and each impact moves her voice on.

const mauledStyle = (): KillStyle =>
  validate(
    validateKillTable,
    {
      m: {
        kind: 'mauled',
        beats: [
          { id: 'grab', poses: ['idle'], convulse: 0.2, until: 'time', s: 0.5, max: 1, lines: ['scream'] },
          {
            id: 'slam', poses: ['idle'], convulse: 0.6, until: 'impacts', impacts: 3, max: 6,
            lines: ['scream_full', 'cry_cut', 'gasp_wet', ''],
            events: [{ t: 0.5, do: 'slam', mark: 'cart' }, { t: 1.5, do: 'slam', mark: 'cart' }, { t: 2.5, do: 'slam', mark: 'cart' }],
          },
          { id: 'still', poses: ['idle'], convulse: 0, until: 'time', s: 1, max: 1 },
        ],
      },
    },
    'test',
  )['m']!;

function mauledHarness(style: KillStyle, impactOnSlam: boolean) {
  const beats: Array<{ id: string; at: number }> = [];
  const voice: Array<{ do: 'say' | 'cut'; line?: string; at: number }> = [];
  let now = 0;
  let run!: KillRun;
  const hooks: KillHooks = {
    beat: (id) => void beats.push({ id, at: now }),
    pose: () => undefined,
    convulse: () => undefined,
    bulge: () => undefined,
    event: (e) => {
      if (e.do === 'slam' && impactOnSlam) run.impact();
    },
    facesGlass: () => true,
    arrived: () => true,
    creatureReady: () => true,
    done: () => undefined,
    say: (line) => void voice.push({ do: 'say', line, at: now }),
    cutVoice: () => void voice.push({ do: 'cut', at: now }),
  };
  run = new KillRun(style, {}, hooks);
  const step = (seconds: number): void => {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      now += 1 / 60;
      run.update(1 / 60);
    }
  };
  return { run, beats, voice, step };
}

test('mauled: a kill style needs known events, and the attacker events only in mauled kills', () => {
  assert.throws(
    () => validate(validateKillTable, { m: { kind: 'mauled', beats: [{ id: 'a', poses: ['idle'], convulse: 0, until: 'time', s: 1, max: 1, events: [{ t: 0, do: 'bite' }] }] } }, 'k'),
    /k > m > beats\[0\] > events\[0\] > do: unknown value "bite", expected one of: .*slam/,
  );
  assert.throws(
    () => validate(validateKillTable, { g: { kind: 'grownInside', beats: [{ id: 'a', poses: ['idle'], convulse: 0, until: 'time', s: 1, max: 1, events: [{ t: 0, do: 'slam', mark: 'cart' }] }] } }, 'k'),
    /slam is only for "mauled" kills/,
  );
  assert.throws(() => validate(validateKillTable, { m: { kind: 'mauled', beats: [{ id: 'a', poses: ['idle'], convulse: 0, until: 'impacts', max: 1 }] } }, 'k'), /needs "impacts"/);
  assert.throws(() => validate(validateKillTable, { m: { kind: 'mauled', beats: [{ id: 'a', poses: ['idle'], convulse: 0, until: 'time', s: 1, max: 1, events: [{ t: 0, do: 'haulTo' }] }] } }, 'k'), /haulTo needs "mark"/);
});

test('mauled: three impacts end the slam beat, one tick each', () => {
  const h = mauledHarness(mauledStyle(), true);
  h.step(0.6); // grab ends at 0.5 s
  const slamAt = h.beats.find((b) => b.id === 'slam')!.at;
  h.step(2.6);
  const still = h.beats.find((b) => b.id === 'still');
  assert.ok(still, 'the beat ended');
  assert.ok(Math.abs(still.at - slamAt - 2.5) < 0.05, `it ended on the third impact (${(still.at - slamAt).toFixed(2)} s in), not at its 6 s limit`);
});

test('mauled: a missing slam still ends the beat at its time limit', () => {
  const h = mauledHarness(mauledStyle(), false);
  h.step(0.6);
  const slamAt = h.beats.find((b) => b.id === 'slam')!.at;
  h.step(7);
  const still = h.beats.find((b) => b.id === 'still')!;
  assert.ok(Math.abs(still.at - slamAt - 6) < 0.05, `ended at max (${(still.at - slamAt).toFixed(2)} s)`);
});

test('mauled: her voice goes scream, cut-off cry, wet gasp, then silence, cut at each impact', () => {
  const h = mauledHarness(mauledStyle(), true);
  h.step(4);
  const seq = h.voice.map((v) => (v.do === 'say' ? v.line : 'CUT'));
  assert.deepEqual(seq, ['scream', 'scream_full', 'CUT', 'cry_cut', 'CUT', 'gasp_wet', 'CUT']);
  const third = h.voice.filter((v) => v.do === 'cut')[2]!;
  assert.ok(h.voice.every((v) => v.do === 'cut' || v.at <= third.at), 'nothing is said after the third impact');
});

test('mauled: a noticed reaction is only for mauled kills, and an unknown kind is refused', () => {
  const beat = { id: 'a', poses: ['idle'], convulse: 0, until: 'time', s: 1, max: 1 };
  assert.throws(() => validate(validateKillTable, { g: { kind: 'grownInside', noticed: { kind: 'stare', at: 1, hold: 1, target: 'player' }, beats: [beat] } }, 'k'), /only "mauled" kills/);
  assert.throws(() => validate(validateKillTable, { m: { kind: 'mauled', noticed: { kind: 'orient', at: 1, hold: 1, target: 'player' }, beats: [beat] } }, 'k'), /noticed > kind: unknown value "orient", expected one of: stare/);
});

test('slice-stinger: the bloom raises her in order - still, twitch, turn, rise, face', () => {
  const h = harness(kills['convertedRise']!);
  h.step(12);
  assert.deepEqual(h.beats, ['still', 'twitch', 'turn', 'rise', 'face']);
  assert.ok(h.done());
});

// ------------------------------------------------------------------ captured clips in beats (stinger-feed-and-rise)

/** A converted-style kill whose middle beat plays a clip; `poses` are the fallback. */
function clipStyle(beat: Record<string, unknown>): KillStyle {
  return validate(validateKillTable, {
    k: {
      kind: 'converted',
      beats: [
        { id: 'lie', poses: ['corpseProne'], convulse: 0, until: 'time', s: 0.5, max: 0.5 },
        { id: 'rise', poses: ['getUp_0', 'getUp_1', 'getUp_2'], period: 0.4, convulse: 0.1, until: 'clip', s: 1.5, max: 20, clip: 'rise_clip', ...beat },
        { id: 'face', poses: ['idle'], convulse: 0, until: 'time', s: 0.5, max: 0.5 },
      ],
    },
  }, 'kills')['k']!;
}

function clipHarness(style: KillStyle, clipSeconds: number | null) {
  const log: string[] = [];
  const phases: number[] = [];
  const warnings: string[] = [];
  let now = 0;
  const starts = new Map<string, number>();
  const hooks: KillHooks = {
    beat: (id) => void starts.set(id, now),
    pose: (name) => void log.push(`pose ${name}`),
    clip: (id, blend) => (log.push(`clip ${id} ${blend}`), clipSeconds),
    clipPhase: (u) => void phases.push(u),
    convulse: () => undefined,
    bulge: () => undefined,
    event: () => undefined,
    facesGlass: () => false,
    arrived: () => true,
    creatureReady: () => true,
    done: () => undefined,
  };
  const run = new KillRun(style, {}, hooks);
  run.warn = (m) => void warnings.push(m);
  const step = (seconds: number): void => {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      now += 1 / 60;
      run.update(1 / 60);
    }
  };
  const beatLength = (id: string, next: string): number => (starts.get(next) ?? NaN) - (starts.get(id) ?? NaN);
  return { run, log, phases, warnings, step, beatLength };
}

test('kill schema: a clip beat validates; bad speed keys, until clip without a clip and speed without a clip do not', () => {
  const ok = clipStyle({ speed: [[0, 0.5], [1, 1.2], [2.5, 0.6]] });
  assert.equal(ok.beats[1]!.clip, 'rise_clip');
  assert.deepEqual(ok.beats[1]!.speed, [[0, 0.5], [1, 1.2], [2.5, 0.6]]);
  assert.throws(() => clipStyle({ speed: [[1, 0.5], [0.5, 1]] }), /time order/);
  assert.throws(() => clipStyle({ speed: [[0, 9]] }), /speed|\[1\]/);
  assert.throws(() => clipStyle({ speed: 'fast' }), /speed/);
  assert.throws(() => clipStyle({ clip: undefined }), /"until": "clip" needs "clip"/);
  assert.throws(
    () => validate(validateKillTable, { k: { kind: 'converted', beats: [{ id: 'a', poses: ['idle'], convulse: 0, until: 'time', s: 1, max: 1, speed: 0.5 }] } }, 'kills'),
    /"speed" is for a "clip" beat/,
  );
});

test('a clip beat at speed 0.75 lasts its clip length / 0.75 and drives the clip from 0 to 1', () => {
  const h = clipHarness(clipStyle({ speed: 0.75 }), 3);
  h.step(8);
  assert.ok(Math.abs(h.beatLength('rise', 'face') - 4) < 0.05, `rise lasted ${h.beatLength('rise', 'face')} s`);
  assert.ok(h.log.includes('clip rise_clip 0.3'), 'the clip starts, blending in over the default 0.3 s');
  assert.equal(h.phases[0], 0);
  assert.equal(h.phases.at(-1), 1);
  for (let i = 1; i < h.phases.length; i++) assert.ok(h.phases[i]! >= h.phases[i - 1]!, 'progress never goes back');
  // The fallback poses never loop while the clip plays: only the beat's first pose (set on entry) and the next beat's.
  const poses = h.log.filter((l) => l.startsWith('pose '));
  assert.deepEqual(poses, ['pose corpseProne', 'pose getUp_0', 'pose idle']);
});

test('speed keys change the clip rate across the beat (linear between keys)', () => {
  // 0.5 -> 1.5 over the first 2 s covers 2 clip-seconds; the last clip-second at 1.5 takes 0.67 s.
  const h = clipHarness(clipStyle({ speed: [[0, 0.5], [2, 1.5]] }), 3);
  h.step(8);
  assert.ok(Math.abs(h.beatLength('rise', 'face') - 2.667) < 0.05, `rise lasted ${h.beatLength('rise', 'face')} s`);
});

test('a missing clip warns once and the beat plays its poses for its own time', () => {
  const h = clipHarness(clipStyle({}), null);
  h.step(4);
  assert.equal(h.warnings.length, 1);
  assert.match(h.warnings[0]!, /no clip "rise_clip"/);
  assert.ok(Math.abs(h.beatLength('rise', 'face') - 1.5) < 0.05, 'falls back to "s"');
  assert.ok(h.log.includes('pose getUp_1') && h.log.includes('pose getUp_2'), 'the fallback poses loop');
  assert.equal(h.phases.length, 0);
});

test('skipping during a clip beat ends on the last beat\'s pose', () => {
  const h = clipHarness(clipStyle({}), 3);
  h.step(1);
  assert.equal(h.run.beatId, 'rise');
  assert.ok(h.run.clipProgress !== null && h.run.clipProgress > 0);
  h.run.finishNow();
  assert.equal(h.log.at(-1), 'pose idle');
  assert.equal(h.run.over, true);
});

// overhaul-priya-r08-death D17 (medbay-attack "It reaches her by walking"): a `startWhen: inReach` beat waits for the
// attacker; the beat before holds, and past its time limit the attacker is walked in, never placed.
function reachHarness(reachAt: number) {
  const style = validate(validateKillTable, {
    s: {
      kind: 'mauled',
      beats: [
        { id: 'plead', poses: ['idle'], convulse: 0, until: 'time', s: 1, max: 2 },
        { id: 'impale', startWhen: 'inReach', reach: 0.7, poses: ['idle'], convulse: 0, until: 'time', s: 0.5, max: 1 },
      ],
    },
  }, 'k')['s']!;
  let now = 0;
  const starts: Record<string, number> = {};
  const closeIns: number[] = [];
  const run = new KillRun(style, {}, {
    beat: (id) => void (starts[id] = now),
    pose: () => undefined,
    convulse: () => undefined,
    bulge: () => undefined,
    event: () => undefined,
    facesGlass: () => true,
    arrived: () => true,
    creatureReady: () => true,
    done: () => undefined,
    inReach: () => now >= reachAt,
    closeIn: () => void closeIns.push(now),
  });
  run.warn = () => undefined;
  let holding = false;
  for (let i = 0; i < 60 * 12; i++) {
    now += 1 / 60;
    run.update(1 / 60);
    if (run.beatId === 'plead' && run.holding) holding = true;
  }
  return { starts, closeIns, holding };
}

test('Fixed beat clock: with the attacker already in reach, the beat starts when the one before ends, not earlier', () => {
  const r = reachHarness(0);
  assert.ok(Math.abs(r.starts['impale']! - 1) < 1 / 60 + 1e-6, `impale at ${r.starts['impale']!.toFixed(3)} s`);
  assert.deepEqual(r.closeIns, [], 'nobody is walked in');
});

test('Late arrival: the plead holds until the attacker reaches her; past its time limit it is walked in, once', () => {
  const r = reachHarness(3.2);
  assert.ok(r.holding, 'the plead holds');
  assert.ok(Math.abs(r.starts['impale']! - 3.2) < 1 / 60 + 1e-6, `impale waits for it (${r.starts['impale']!.toFixed(3)} s)`);
  assert.equal(r.closeIns.length, 1, 'walked in once');
  assert.ok(Math.abs(r.closeIns[0]! - 2) < 3 / 60, `from the plead's time limit (${r.closeIns[0]!.toFixed(3)} s)`);
});

test('an attacker that never arrives does not hang the kill: the beat starts after the close-in limit', () => {
  const r = reachHarness(Infinity);
  assert.ok(r.starts['impale']! > 2 && r.starts['impale']! < 2 + 6 + 0.1, `impale at ${r.starts['impale']!.toFixed(2)} s`);
});

test('startWhen is for mauled kills, never on the first beat, and reach needs it', () => {
  const beat = { poses: ['idle'], convulse: 0, until: 'time', s: 1, max: 1 };
  assert.throws(() => validate(validateKillTable, { s: { kind: 'grownInside', beats: [{ id: 'a', ...beat }, { id: 'b', startWhen: 'inReach', ...beat }] } }, 'k'), /only "mauled"/);
  assert.throws(() => validate(validateKillTable, { s: { kind: 'mauled', beats: [{ id: 'a', startWhen: 'inReach', ...beat }] } }, 'k'), /first beat/);
  assert.throws(() => validate(validateKillTable, { s: { kind: 'mauled', beats: [{ id: 'a', ...beat }, { id: 'b', reach: 1, ...beat }] } }, 'k'), /"reach" is for/);
});
