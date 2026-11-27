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
  const style = validate(validateKillTable, {
    k: {
      kind: 'grownInside',
      beats: [
        { id: 'glass', poses: ['idle'], convulse: 0, until: 'line', max: 4 },
        { id: 'arch', poses: ['idle'], convulse: 0, until: 'time', s: 1, max: 1 },
      ],
    },
  }, 'k')['k']!;
  const h = harness(style);
  h.step(2);
  assert.equal(h.run.beatId, 'glass', 'the beat holds while she screams');
  h.run.lineEnded('scream');
  h.step(1 / 60);
  assert.equal(h.run.beatId, 'arch', 'the arch begins as the scream ends');
});

test('Fixed beat ignores its audio: the Lab B glass beat runs its length, whether the scream is shorter or longer', () => {
  for (const screamAt of [0.5, 5]) {
    const h = harness(grown);
    h.step(0.05);
    h.run.lineEnded('plea');
    h.step(6.5 + 1 / 60);
    assert.equal(h.run.beatId, 'glass');
    for (let i = 0; i < 60 * 8 && h.run.beatId === 'glass'; i++) {
      if (h.run.beatTime >= screamAt) h.run.lineEnded('scream');
      h.step(1 / 60);
    }
    assert.equal(h.run.beatId, 'arch');
    assert.ok(Math.abs(h.run.clockT - 10.1) < 2 / 60, `the arch began ${h.run.clockT.toFixed(3)} s on the clock (scream ends at ${screamAt} s)`);
  }
});

test('the kill clock is 0 as panic begins, runs with the beats, and stands still while nothing updates the run', () => {
  const h = harness(grown);
  h.step(2);
  assert.equal(h.run.beatId, 'scratch');
  assert.equal(h.run.clockT, 0, 'not running while she waits for the question');
  h.run.lineEnded('plea');
  h.step(1 / 60);
  assert.equal(h.run.beatId, 'panic');
  assert.equal(h.run.clockT, 0, 'starts with panic');
  h.step(1);
  assert.ok(Math.abs(h.run.clockT - 1) < 1e-6, `${h.run.clockT} s`);
  const held = h.run.clockT;
  // A pause: time goes by outside, the run is not updated.
  assert.equal(h.run.clockT, held);
  h.step(6);
  assert.equal(h.run.beatId, 'glass');
  assert.ok(Math.abs(h.run.clockT - 6.5 - h.run.beatTime) < 1e-6, 'it carries across beats');
});

test('beat lengths never add up late: at an uneven frame time each beat starts within a frame of its place on the clock', () => {
  for (const dt of [1 / 23, 1 / 30, 1 / 144, 0.037]) {
    const starts = new Map<string, number>();
    const h = harness(grown);
    h.run.lineEnded('plea');
    for (let i = 0; i < 20 / dt && !starts.has('creature'); i++) {
      h.run.update(dt);
      const id = h.run.beatId;
      // Where the clock was on the frame the beat began.
      if (id && !starts.has(id)) starts.set(id, h.run.clockT);
    }
    let at = 0;
    for (const beat of grown.beats.slice(1)) {
      const started = starts.get(beat.id)!;
      assert.ok(started >= at - 1e-6 && started < at + dt, `${beat.id} began at ${started.toFixed(4)} s, due ${at.toFixed(1)} s (frame ${dt.toFixed(4)} s)`);
      at += beat.s ?? 0;
    }
  }
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

test('the kill table checks the staged run\'s events: a sweep, a tip, a touch on the glass with its gap, and a sliding touch', () => {
  const table = (e: Record<string, unknown>): unknown => ({ k: { kind: 'grownInside', beats: [{ id: 'b', poses: ['idle'], convulse: 0, until: 'time', s: 1, max: 1, events: [{ t: 0.5, ...e }] }] } });
  const ok = (e: Record<string, unknown>): void => void validate(validateKillTable, table(e), 'kills');
  const bad = (e: Record<string, unknown>, why: RegExp): void => assert.throws(() => validate(validateKillTable, table(e), 'kills'), why);
  ok({ do: 'sweep', from: 'labb_bench_sweep', dir: [-1, 0.2], reach: 0.9, strength: 1 });
  ok({ do: 'tip', prop: 'labb_cart', s: 0.7 });
  ok({ do: 'touch', part: 'chest', mark: 'glass', gap: 0.13 });
  ok({ do: 'touch', part: 'hand_L', mark: 'labb_bench_top', slide: true });
  bad({ do: 'sweep', from: 'labb_bench_sweep', dir: 'back', reach: 0.9 }, /sweep needs/);
  bad({ do: 'sweep', dir: [1, 0], reach: 0.9 }, /sweep needs/);
  bad({ do: 'tip', prop: 'labb_cart' }, /tip needs/);
  bad({ do: 'kick', joint: 'chest', dir: [1, 0] }, /direction \[x, z\] is for a sweep/);
  bad({ do: 'kick', joint: 'chest', dir: [0, 0] }, /needs a length/);
  bad({ do: 'touch', part: 'chest', mark: 'labb_bench_top', gap: 0.1 }, /"gap" is for a touch on "glass"/);
  bad({ do: 'touch', part: 'chest', mark: 'glass', slide: true }, /"slide" is for a touch on a mark/);
  bad({ do: 'sfx', id: ['x'], from: 'labb_bench_sweep' }, /"from" is for a sweep/);
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

// ------------------------------------------------------------------ beat tracks (voss-death-scene D2)

/** One fixed 6 s beat with a track; `clips` gives each clip's length (absent = the body lacks it). */
function trackHarness(track: unknown[], clips: Record<string, number>, beat: Record<string, unknown> = {}) {
  const style = validate(validateKillTable, {
    k: {
      kind: 'grownInside',
      beats: [
        { id: 'run', poses: ['stagger_0', 'stagger_1'], period: 0.5, convulse: 0, until: 'time', s: 6, max: 6, track, ...beat },
        { id: 'after', poses: ['idle'], convulse: 0, until: 'time', s: 0.5, max: 0.5 },
      ],
    },
  }, 'kills')['k']!;
  const log: Array<{ at: number; what: string }> = [];
  const phases: Array<{ at: number; u: number }> = [];
  const warnings: string[] = [];
  let now = 0;
  const hooks: KillHooks = {
    beat: () => undefined,
    pose: (name, blend) => void log.push({ at: now, what: `pose ${name} ${blend}` }),
    clip: (id, blend, opts) => {
      log.push({ at: now, what: `clip ${id} ${blend} from ${opts.from}${opts.inPlace ? ' in place' : ''}` });
      return clips[id] ?? null;
    },
    clipPhase: (u) => void phases.push({ at: now, u }),
    layer: (joints, pose, blend) => void log.push({ at: now, what: joints ? `layer ${pose} ${blend} on ${joints.join(',')}` : `layer off ${blend}` }),
    convulse: () => undefined,
    bulge: () => undefined,
    event: () => undefined,
    facesGlass: () => true,
    arrived: () => true,
    creatureReady: () => true,
    done: () => undefined,
  };
  const run = new KillRun(style, {}, hooks);
  run.warn = (m) => void warnings.push(m);
  const step = (seconds: number, fps = 60): void => {
    for (let i = 0; i < Math.round(seconds * fps); i++) {
      now += 1 / fps;
      run.update(1 / fps);
    }
  };
  /** The phase reported closest to `t` s into the kill (the first frame starts the beat at 1/fps). */
  const phaseAt = (t: number): number => phases.reduce((best, p) => (Math.abs(p.at - t) < Math.abs(best.at - t) ? p : best)).u;
  return { run, log, phases, warnings, step, phaseAt, what: () => log.map((l) => l.what) };
}

test('kill schema: track pieces need a clip or a pose, in time order; "from"/"to" only on clips; not with "clip"', () => {
  const ok = (track: unknown[], beat: Record<string, unknown> = {}): void => void trackHarness(track, {}, beat);
  ok([{ at: 0, clip: 'a', from: 0.5, to: 1.5, speed: 1.2, blend: 0.2 }, { at: 1, pose: 'idle', blend: 0.1 }]);
  assert.throws(() => ok([{ at: 0 }]), /a "clip" or a "pose"/);
  assert.throws(() => ok([{ at: 0, clip: 'a', pose: 'idle' }]), /a "clip" or a "pose"/);
  assert.throws(() => ok([{ at: 0, pose: 'idle', from: 1 }]), /for a clip piece/);
  assert.throws(() => ok([{ at: 0, clip: 'a', from: 2, to: 1 }]), /"to" must come after "from"/);
  assert.throws(() => ok([{ at: 1, clip: 'a' }, { at: 1, pose: 'idle' }]), /time order/);
  assert.throws(() => ok([{ at: 0, clip: 'a' }], { clip: 'b' }), /not both/);
  assert.throws(() => ok([{ at: 0, clip: 'a' }, { at: 1, pose: 'idle' }], { until: 'clip' }), /"until": "clip" needs/);
});

test('Track order: each piece starts at its beat time, in order, blending from the one before over its own blend', () => {
  const h = trackHarness(
    [
      { at: 0, clip: 'stumble', blend: 0.2 },
      { at: 1.2, pose: 'bench_hit', blend: 0.1 },
      { at: 2, clip: 'walk', from: 0.4, to: 1, blend: 0.35 },
      { at: 3.5, pose: 'doubled', blend: 0.25 },
    ],
    { stumble: 1.5, walk: 2 },
  );
  h.step(4);
  // The beat's first pose is set on entry as the fallback; then the pieces, in order.
  assert.deepEqual(h.what(), ['pose stagger_0 0.25', 'clip stumble 0.2 from 0', 'pose bench_hit 0.1', 'clip walk 0.35 from 0.4', 'pose doubled 0.25']);
  const at = (what: string): number => h.log.find((l) => l.what.startsWith(what))!.at;
  for (const [what, t] of [['pose bench_hit', 1.2], ['clip walk', 2], ['pose doubled', 3.5]] as const) {
    assert.ok(Math.abs(at(what) - (t + 1 / 60)) <= 1 / 60 + 1e-9, `${what} at ${at(what).toFixed(3)} s (due ${t} s into the beat)`);
  }
  // A pose piece plays no clip, and the beat's own poses do not loop over the pieces.
  assert.equal(h.log.filter((l) => l.what.startsWith('pose stagger')).length, 1);
});

test('Track pieces keep to the clock: at 30 and 144 fps a piece starts on the same frame time and its clip is as far in', () => {
  const run = (fps: number) => {
    const h = trackHarness([{ at: 0, pose: 'a' }, { at: 1.01, clip: 'walk', from: 0.5 }], { walk: 2 });
    h.step(3, fps);
    return h;
  };
  const slow = run(30);
  const fast = run(144);
  // 1 s after the piece starts the clip is 0.5 + 1 = 1.5 s into its 2 s take, at either frame rate.
  assert.ok(Math.abs(slow.phaseAt(2.01 + 1 / 30) - 0.75) < 1 / 30 / 2 + 1e-6, `30 fps ${slow.phaseAt(2.01 + 1 / 30)}`);
  assert.ok(Math.abs(fast.phaseAt(2.01 + 1 / 144) - 0.75) < 1 / 144 / 2 + 1e-6, `144 fps ${fast.phaseAt(2.01 + 1 / 144)}`);
});

test('Holding the last frame: a clip piece plays from "from" to "to" at its speed, then holds "to" until the next piece', () => {
  // A 4 s take, 1 s to 2 s of it at speed 0.5: two beat seconds, then held at u = 0.5 until the pose at 3.5 s.
  const h = trackHarness([{ at: 0.5, clip: 'take', from: 1, to: 2, speed: 0.5 }, { at: 3.5, pose: 'idle' }], { take: 4 });
  h.step(5);
  const p = (t: number): number => h.phaseAt(t + 1 / 60);
  assert.ok(Math.abs(p(0.5) - 0.25) < 0.005, `starts at "from" (${p(0.5)})`);
  assert.ok(Math.abs(p(1.5) - 0.375) < 0.005, `halfway at half speed (${p(1.5)})`);
  assert.ok(Math.abs(p(2.5) - 0.5) < 1e-9, `reaches "to" (${p(2.5)})`);
  assert.ok(h.phases.filter((q) => q.at > 2.6 && q.at < 3.5).every((q) => q.u === 0.5), 'holds "to" until the next piece');
  assert.ok(h.phases.every((q) => q.at < 3.5 + 2 / 60), 'and the pose piece ends the clip');
  for (let i = 1; i < h.phases.length; i++) assert.ok(h.phases[i]!.u >= h.phases[i - 1]!.u, 'never runs back');
});

test('Track speed keys count from the piece\'s own start', () => {
  // Speed 0.5 for the first second of the piece, then 1.5: at 2 s into the beat (1 s into the piece) it has run 0.5 s.
  const h = trackHarness([{ at: 1, clip: 'take', speed: [[0, 0.5], [1, 0.5], [1.001, 1.5]] }], { take: 4 });
  h.step(3);
  assert.ok(Math.abs(h.phaseAt(2 + 1 / 60) - 0.125) < 0.005, `${h.phaseAt(2 + 1 / 60)}`);
});

test('Track clip missing: the beat\'s poses play while it is due, with one warning, and the next piece goes on', () => {
  const h = trackHarness([{ at: 0, clip: 'gone' }, { at: 2, pose: 'idle' }, { at: 3, clip: 'gone' }, { at: 4.5, clip: 'walk' }], { walk: 1 });
  h.step(5.5);
  assert.equal(h.warnings.length, 1, h.warnings.join('; '));
  assert.match(h.warnings[0]!, /no clip "gone"; playing its poses instead/);
  const before = h.log.filter((l) => l.at < 2);
  assert.ok(before.some((l) => l.what.startsWith('pose stagger_1')), 'the beat\'s poses loop while the missing clip is due');
  const during = h.log.filter((l) => l.at > 3 && l.at < 4.5).map((l) => l.what);
  assert.ok(during.some((w) => w.startsWith('pose stagger')), 'and again for its second piece');
  assert.ok(h.what().includes('clip walk 0.3 from 0'), 'the clip after it plays');
  assert.ok(h.log.filter((l) => l.at > 4.5 + 2 / 60 && l.at < 6).every((l) => !l.what.startsWith('pose stagger')), 'and the poses stop looping under it');
});

test('a route beat\'s clips play in place; a beat with no route plays them as before', () => {
  const routed = trackHarness([{ at: 0, clip: 'walk' }], { walk: 1 }, { route: [{ mark: 'glass', t: 2 }] });
  routed.step(0.1);
  assert.ok(routed.what().includes('clip walk 0.3 from 0 in place'));
  const plain = trackHarness([{ at: 0, clip: 'walk' }], { walk: 1 });
  plain.step(0.1);
  assert.ok(plain.what().includes('clip walk 0.3 from 0'));
});

// ------------------------------------------------------------------ waiting motion (voss-death-scene D6)

test('A looping clip piece plays round from "from" to "to" for as long as the beat lasts, keeping to the clock', () => {
  // A 4 s take looped from 1 s to 3 s at speed 0.5: one loop every 4 beat seconds.
  const h = trackHarness([{ at: 0, clip: 'wait', from: 1, to: 3, speed: 0.5, loop: true }], { wait: 4 });
  h.step(6);
  const p = (t: number): number => h.phaseAt(t + 1 / 60);
  assert.ok(Math.abs(p(0) - 0.25) < 0.005, `starts at "from" (${p(0)})`);
  assert.ok(Math.abs(p(2) - 0.5) < 0.005, `halfway round (${p(2)})`);
  assert.ok(Math.abs(p(5) - 0.375) < 0.005, `round again past the seam (${p(5)})`);
  assert.ok(h.phases.every((q) => q.u >= 0.25 - 1e-9 && q.u < 0.75 + 1e-9), 'never outside its stretch of the take');
  const wraps = h.phases.filter((q, i) => i > 0 && q.u < h.phases[i - 1]!.u).length;
  assert.equal(wraps, 1, 'wraps once in 6 s');
  // Whole take: no from/to.
  const whole = trackHarness([{ at: 0, clip: 'wait', loop: true }], { wait: 2 });
  whole.step(5);
  assert.ok(Math.abs(whole.phaseAt(4.5 + 1 / 60) - 0.25) < 0.01, `${whole.phaseAt(4.5 + 1 / 60)}`);
});

test('kill schema: "loop" is for clip pieces, a beat never waits for a looping clip to end, and a layer needs poses and joints', () => {
  const ok = (track: unknown[], beat: Record<string, unknown> = {}): void => void trackHarness(track, {}, beat);
  ok([{ at: 0, clip: 'a', loop: true }], { layer: { poses: ['idle'], period: 0.2, joints: ['hand_R'] } });
  assert.throws(() => ok([{ at: 0, pose: 'idle', loop: true }]), /for a clip piece/);
  assert.throws(() => ok([{ at: 0, clip: 'a', loop: true }], { until: 'clip' }), /never ends on a looping clip/);
  assert.throws(() => ok([], { layer: { poses: [], period: 0.2, joints: ['hand_R'] } }), /at least one pose/);
  assert.throws(() => ok([], { layer: { poses: ['idle'], period: 0.2, joints: [] } }), /at least one joint/);
  assert.throws(() => ok([], { layer: { poses: ['idle'], period: 0.2, joints: ['tail'] } }), /unknown joint/);
});

test('A layer loops its poses every period on its joints only, from the beat start, and goes off with the beat', () => {
  const h = trackHarness([{ at: 0, clip: 'wait', loop: true }], { wait: 4 }, { layer: { poses: ['scratch_0', 'scratch_1'], period: 0.15, blend: 0.1, joints: ['foreArm_R', 'hand_R'] } });
  h.step(6.4);
  const layer = h.log.filter((l) => l.what.startsWith('layer'));
  assert.equal(layer[0]!.what, 'layer scratch_0 0.1 on foreArm_R,hand_R');
  const on = layer.filter((l) => !l.what.startsWith('layer off'));
  // 6 s at 0.15 s a pose: 40 swaps, alternating.
  assert.ok(Math.abs(on.length - 40) <= 1, `${on.length} swaps`);
  for (let i = 1; i < on.length; i++) assert.notEqual(on[i]!.what, on[i - 1]!.what, 'alternates');
  const gaps = on.slice(1).map((l, i) => l.at - on[i]!.at);
  assert.ok(gaps.every((g) => Math.abs(g - 0.15) <= 1 / 60 + 1e-9), 'one swap every period');
  assert.equal(layer[layer.length - 1]!.what, 'layer off 0.25', 'the next beat has no layer: it goes off with that beat\'s blend');
  assert.ok(h.what().includes('clip wait 0.3 from 0'), 'and the clip plays under it');
});

test('a skipped kill turns the layer off', () => {
  const h = trackHarness([{ at: 0, pose: 'a' }], {}, { layer: { poses: ['s0', 's1'], period: 0.2, joints: ['hand_R'] } });
  h.step(0.5);
  h.run.finishNow();
  assert.equal(h.what().filter((w) => w.startsWith('layer')).pop(), 'layer off 0.01');
});

test('kill schema: route marks are reached after the beat starts, in time order, within its limit', () => {
  const ok = (route: unknown[]): void => void trackHarness([{ at: 0, pose: 'idle' }], {}, { route });
  ok([{ mark: 'bench_edge', t: 0.4 }, { mark: 'glass', t: 4, face: 'glass_point' }, { mark: 'x', t: 5, face: 90 }]);
  assert.throws(() => ok([{ mark: 'a', t: 0 }]), /after the beat starts/);
  assert.throws(() => ok([{ mark: 'a', t: 2 }, { mark: 'b', t: 1 }]), /time order/);
  assert.throws(() => ok([{ mark: 'a', t: 7 }]), /time limit/);
  assert.throws(() => ok([]), /at least one mark/);
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
