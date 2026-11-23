import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StageTimer } from './stageTimer.ts';

function clock(): { now: () => number; advance: (ms: number) => void } {
  let t = 1000;
  return { now: () => t, advance: (ms) => void (t += ms) };
}

test('stages tile the load and each records its own duration', () => {
  const c = clock();
  const timer = new StageTimer(c.now);
  timer.begin('renderer');
  c.advance(120);
  timer.begin('textures');
  c.advance(900);
  timer.end();
  assert.deepEqual(
    timer.stages.map((s) => [s.name, s.ms]),
    [
      ['renderer', 120],
      ['textures', 900],
    ],
  );
});

test('markPrepared flags only the running stage', () => {
  const c = clock();
  const timer = new StageTimer(c.now);
  timer.begin('a');
  timer.markPrepared();
  c.advance(5);
  timer.begin('b');
  c.advance(7);
  timer.end();
  assert.deepEqual(
    timer.stages.map((s) => s.prepared),
    [true, false],
  );
});

test('markPrepared with no running stage does nothing', () => {
  const timer = new StageTimer(clock().now);
  timer.markPrepared();
  assert.equal(timer.stages.length, 0);
});

test('summary ends the running stage and reports total and prepared stages', () => {
  const c = clock();
  const timer = new StageTimer(c.now);
  timer.begin('level');
  timer.markPrepared();
  c.advance(300);
  timer.begin('gpu');
  c.advance(200);
  assert.equal(timer.summary(), 'total 500 ms | level 300 (prepared) | gpu 200');
});
