import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADAPT_KEY, ADAPT_MAX, ADAPT_MIN, adaptMultiplier, initialAdaptState, stepAdaptation, type AdaptState } from './eyeAdaptation.ts';

// post-processing spec "Eye adaptation", "Brief flashes do not pump the exposure" (room-light-response D6).

const DT = 1 / 60;
const log = (x: number): number => Math.log2(x);

/** Run the filter over a luminance sequence (one value per frame); returns the multiplier per frame. */
function run(start: AdaptState, lum: (t: number) => number, seconds: number): { mul: number[]; end: AdaptState } {
  let s = start;
  const mul: number[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    s = stepAdaptation(s, log(lum(i * DT)), DT);
    mul.push(adaptMultiplier(s.adapted));
  }
  return { mul, end: s };
}

/** Seconds until the multiplier has covered 90% of its change (in stops). */
function settle(mul: number[], from: number): number {
  const to = mul.at(-1)!;
  const total = Math.log2(to / from);
  const i = mul.findIndex((m) => Math.abs(Math.log2(m / from)) >= 0.9 * Math.abs(total));
  return (i + 1) * DT;
}

test('into a dark room: darkest on entry, then brightens over 2 to 4 s, capped so it stays dark', () => {
  const start = initialAdaptState(log(ADAPT_KEY));
  assert.ok(Math.abs(adaptMultiplier(start.adapted) - 1) < 1e-9, 'neutral at the key');
  const { mul } = run(start, () => ADAPT_KEY / 16, 8); // backup power: four stops darker
  assert.ok(mul[0]! < 1.02, 'no jump on entry');
  const t = settle(mul, 1);
  assert.ok(t >= 2 && t <= 4, `settles in ${t.toFixed(2)} s`);
  assert.ok(Math.abs(mul.at(-1)! - ADAPT_MAX) < 0.01, `capped at ${ADAPT_MAX}: the room is still 2.5 stops dark`);
  assert.ok(mul.at(-1)! * (1 / 16) < 0.15, 'adapted, the dark room shows at under 15% of the key');
});

test('out into the light: too bright for a moment, settles within 1.5 s', () => {
  const dark = run(initialAdaptState(log(ADAPT_KEY)), () => ADAPT_KEY / 16, 10).end;
  const { mul } = run(dark, () => ADAPT_KEY * 2, 4);
  assert.ok(mul[0]! > 1.5, 'the first frames are over-exposed');
  const t = settle(mul, mul[0]!);
  assert.ok(t >= 0.5 && t <= 1.5, `settles in ${t.toFixed(2)} s`);
  assert.ok(Math.abs(mul.at(-1)! - ADAPT_MIN) < 0.01, 'a view twice the key settles on the floor multiplier');
  assert.ok(mul.every((m) => m >= ADAPT_MIN - 1e-9 && m <= ADAPT_MAX + 1e-9));
});

test('a 0.1 s flash (16× brighter) does not move the exposure', () => {
  for (const base of [ADAPT_KEY, ADAPT_KEY / 16]) {
    const settled = run(initialAdaptState(log(base)), () => base, 6).end;
    const before = adaptMultiplier(settled.adapted);
    const { mul } = run(settled, (t) => (t >= 0.5 && t < 0.6 ? base * 16 : base), 3);
    const worst = Math.max(...mul.map((m) => Math.abs(m / before - 1)));
    assert.ok(worst < 0.01, `exposure moved ${(worst * 100).toFixed(2)}% (base ${base})`);
  }
});

test('repeated shots in a dark room (0.08 s flashes every 0.3 s) do not pump it', () => {
  const base = ADAPT_KEY / 16;
  const settled = run(initialAdaptState(log(base)), () => base, 6).end;
  const before = adaptMultiplier(settled.adapted);
  const { mul } = run(settled, (t) => (t % 0.3 < 0.08 ? base * 8 : base), 4);
  const worst = Math.max(...mul.map((m) => Math.abs(m / before - 1)));
  assert.ok(worst < 0.02, `exposure moved ${(worst * 100).toFixed(2)}%`);
});

test('a change that lasts (a light coming on for good) passes the gate after 0.25 s', () => {
  const settled = run(initialAdaptState(log(ADAPT_KEY)), () => ADAPT_KEY, 3).end;
  const { mul } = run(settled, () => ADAPT_KEY * 4, 3);
  assert.ok(Math.abs(mul[10]! - 1) < 1e-9, 'held through the gate');
  assert.ok(mul.at(-1)! < 0.75, 'then adapts');
});
