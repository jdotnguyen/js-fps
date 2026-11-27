/** Which claw mark a hit leaves, where, and for how long (player-hit-feedback D4). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HitInfo, HitKind, HitSide } from '../actors/hit.ts';
import { Rng } from '../core/rng.ts';
import { CLEAR_RADIUS, HitMarks, MARK_CELLS, MARK_REACH, MARK_SLOTS, MARK_TIMING, markRect, markState, type Mark } from './hitMarks.ts';

const hit = (kind: HitKind, side: HitSide | null = null, severity = 0.6): HitInfo => ({ kind, side, severity, dir: { x: 0, y: 0 } });
const ASPECTS = [4 / 3, 16 / 10, 16 / 9, 21 / 9];

const seeded = (seed: string): HitMarks => {
  const rng = new Rng(seed);
  return new HitMarks(() => rng.range(0, 1));
};

/** How near the mark's art comes to the crosshair, in screen heights. */
function clearance(m: Mark, aspect: number): number {
  const x = (m.x - 0.5) * aspect;
  const y = m.y - 0.5;
  if (m.kind !== 'slam') return Math.hypot(x, y) - MARK_REACH[m.kind] * m.size;
  // The slam is a wide band, turned a little: the crosshair's distance from its upper edge.
  const above = -x * Math.sin(m.turn) - y * Math.cos(m.turn);
  return above - MARK_REACH.slam * m.size;
}

test('a swipe from the right lands on the right third, along its swing; from the left on the left, unmirrored', () => {
  for (const aspect of ASPECTS) {
    const marks = seeded(`swipe ${aspect}`);
    for (let i = 0; i < 40; i++) {
      const right = marks.add(hit('swipe', 'R'), aspect)!;
      assert.ok(right.x > 2 / 3, `right at ${right.x} (${aspect})`);
      assert.equal(right.mirrored, true);
      assert.ok(markRect(right)[2] < 0, 'the mirror image rakes from upper right to lower left');
      assert.ok(Math.abs(right.turn) <= 0.25);
      const left = marks.add(hit('swipe', 'L'), aspect)!;
      assert.ok(left.x < 1 / 3, `left at ${left.x} (${aspect})`);
      assert.ok(markRect(left)[2] > 0);
    }
  }
});

test('a bite and a slam have their own cells; the slam runs along the bottom; grabs and scripts leave nothing', () => {
  const marks = seeded('kinds');
  const cells = (kind: keyof typeof MARK_CELLS): string[] => MARK_CELLS[kind].map((c) => c.join());
  const all = [...cells('swipe'), ...cells('bite'), ...cells('slam')];
  assert.equal(new Set(all).size, all.length, 'no cell is shared');
  const bite = marks.add(hit('bite'), 16 / 9)!;
  assert.equal(bite.kind, 'bite');
  assert.ok(bite.y > 0.1 && bite.y < 0.35, 'low, but on the screen');
  const slam = marks.add(hit('slam'), 16 / 9)!;
  assert.equal(slam.kind, 'slam');
  assert.ok(slam.y < 0.2 && Math.abs(slam.x - 0.5) < 0.1, 'along the bottom');
  assert.equal(marks.add(hit('grab', 'L'), 16 / 9), null);
  assert.equal(marks.add(hit('generic'), 16 / 9), null);
});

test('bites and slams show on the screen, not under its bottom edge', () => {
  for (const aspect of ASPECTS) {
    const marks = seeded(`seen ${aspect}`);
    for (let i = 0; i < 100; i++) {
      const bite = marks.add(hit('bite', null, 1), aspect)!;
      assert.ok(bite.y > 0.1 && bite.x > 0.1 && bite.x < 0.9, `bite at ${bite.x}, ${bite.y}`);
      const slam = marks.add(hit('slam', null, 1), aspect)!;
      assert.ok(slam.y + MARK_REACH.slam * slam.size > 0.2, 'the slam band rises a good fifth of the screen');
    }
  }
});

test('the crosshair stays clear at every shape of screen', () => {
  for (const aspect of ASPECTS) {
    const marks = seeded(`clear ${aspect}`);
    for (let i = 0; i < 300; i++) {
      const kind = (['swipe', 'bite', 'slam'] as const)[i % 3]!;
      const m = marks.add(hit(kind, i % 2 ? 'L' : 'R', 1), aspect)!;
      assert.ok(clearance(m, aspect) >= CLEAR_RADIUS - 1e-9, `${kind} at ${aspect}: ${clearance(m, aspect)}`);
    }
  }
});

test('at most three marks show, a new one replacing the oldest', () => {
  const marks = seeded('slots');
  const added: Mark[] = [];
  for (let i = 0; i < 5; i++) {
    added.push(marks.add(hit('swipe', 'R'), 16 / 9)!);
    marks.update(0.1);
    assert.ok(marks.slots.filter(Boolean).length <= MARK_SLOTS);
  }
  assert.deepEqual(new Set(marks.slots), new Set(added.slice(2)));
});

test('consecutive marks of a kind are never identical', () => {
  for (const kind of ['swipe', 'bite', 'slam'] as const) {
    const marks = new HitMarks(() => 0.5); // even with the dice stuck
    let last = marks.add(hit(kind, 'L'), 16 / 9)!;
    for (let i = 0; i < 12; i++) {
      const next = marks.add(hit(kind, 'L'), 16 / 9)!;
      assert.notDeepEqual(markRect(next), markRect(last), kind);
      last = next;
    }
  }
});

test('a mark draws on within 0.1 s, holds, and is gone by 1.5 s; bigger hits mark harder', () => {
  const marks = seeded('timing');
  const m = marks.add(hit('swipe', 'R', 1), 16 / 9)!;
  assert.deepEqual(markState(m), { drawn: 0, opacity: 1 });
  marks.update(MARK_TIMING.drawOn);
  assert.equal(markState(m).drawn, 1);
  marks.update(MARK_TIMING.hold - 0.01);
  assert.equal(markState(m).opacity, 1, 'held');
  marks.update(0.5);
  const fading = markState(m).opacity;
  assert.ok(fading > 0.1 && fading < 0.9, `fading ${fading}`);
  marks.update(0);
  assert.equal(markState(m).opacity, fading, 'no time, no change (paused)');
  marks.update(1.5 - m.age);
  assert.deepEqual(marks.slots, [null, null, null]);
  assert.equal(marks.add(hit('swipe', 'R', 0), 16 / 9)!.strength, 0.55);
});

test('clearing empties every slot', () => {
  const marks = seeded('clear');
  for (let i = 0; i < 3; i++) marks.add(hit('swipe', 'L'), 16 / 9);
  marks.clear();
  assert.deepEqual(marks.slots, [null, null, null]);
});
