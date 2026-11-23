import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TimeSlicer, runSteps, runStepsSliced } from './timeSlice.ts';

function clock(): { now: () => number; advance: (ms: number) => void } {
  let t = 0;
  return { now: () => t, advance: (ms) => void (t += ms) };
}

test('cheap steps do not yield; the budget being spent does', async () => {
  const c = clock();
  let yields = 0;
  const s = new TimeSlicer(async () => void yields++, 6, c.now);
  c.advance(2);
  await s.tick();
  c.advance(3);
  await s.tick();
  assert.equal(yields, 0, '5 ms spent of 6');
  c.advance(2);
  await s.tick();
  assert.equal(yields, 1, '7 ms spent: hand the thread back');
  await s.tick();
  assert.equal(yields, 1, 'the budget starts again after a yield');
});

test('a generator gives the same result run straight through or sliced', async () => {
  function* steps(log: string[]): Generator<void, number, void> {
    let sum = 0;
    for (let i = 1; i <= 5; i++) {
      sum += i;
      log.push(`s${i}`);
      yield;
    }
    return sum;
  }
  const a: string[] = [];
  const b: string[] = [];
  const c = clock();
  let yields = 0;
  const slicer = new TimeSlicer(async () => void yields++, 2, c.now);
  const sync = runSteps(steps(a));
  const sliced = await runStepsSliced(
    (function* () {
      const inner = steps(b);
      for (;;) {
        const r = inner.next();
        if (r.done) return r.value;
        c.advance(1); // each step costs 1 ms
        yield;
      }
    })(),
    slicer,
  );
  assert.equal(sync, 15);
  assert.equal(sliced, 15);
  assert.deepEqual(a, b, 'the same work in the same order');
  assert.ok(yields >= 2, 'the sliced run handed the thread back along the way');
});
