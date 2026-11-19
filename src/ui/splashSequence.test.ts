import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACT_LENGTH, attachedAt, kick, LOGO_H, LOGO_W, PIECES, poseAt, pumpTimes, SHOTS } from './splashSequence.ts';

test('pieces stay inside the logo and do not overlap', () => {
  for (const p of PIECES) {
    assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.w <= LOGO_W && p.y + p.h <= LOGO_H, p.id);
  }
  for (const a of PIECES) {
    for (const b of PIECES) {
      if (a === b) continue;
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      assert.ok(!overlap, `${a.id} overlaps ${b.id}`);
    }
  }
});

test('every piece is blown off exactly once and the last blast clears the rest', () => {
  const all = SHOTS.flatMap((s) => s.removes);
  assert.deepEqual([...all].sort(), PIECES.map((p) => p.id).sort());
  assert.equal(attachedAt(0).size, PIECES.length);
  assert.equal(attachedAt(SHOTS[0]!.at + 0.01).has('0c'), false);
  assert.equal(attachedAt(SHOTS[SHOTS.length - 1]!.at).size, 0);
  assert.ok(SHOTS.at(-1)!.final && SHOTS.slice(0, -1).every((s) => !s.final));
});

test('blasts are far enough apart to pump the shotgun between them', () => {
  const pumps = pumpTimes();
  assert.equal(pumps.length, SHOTS.length - 1);
  pumps.forEach((p, i) => assert.ok(p + 0.56 < SHOTS[i + 1]!.at, `pump ${i} finishes before the next blast`));
  assert.ok(ACT_LENGTH > SHOTS.at(-1)!.at);
});

test('a hit snaps the logo back, then the spring settles', () => {
  assert.equal(kick(-1), 0);
  assert.equal(kick(0), 1);
  assert.ok(Math.abs(kick(2)) < 0.01);
  const s = SHOTS[0]!;
  const before = poseAt(s.at - 0.01);
  const hit = poseAt(s.at + 0.06);
  assert.ok(hit.rot < before.rot, 'head snaps back');
  assert.ok(hit.flash > 0.5 && before.flash === 0);
});

test('the logo closes in while it shambles', () => {
  assert.ok(poseAt(3).scale > poseAt(0).scale);
  assert.ok(poseAt(3).y < 0 || poseAt(3.5).y < 0 || poseAt(2.2).y < 0, 'it bobs with each step');
});

test('every pose is finite', () => {
  for (let t = 0; t <= ACT_LENGTH; t += 0.05) for (const v of Object.values(poseAt(t))) assert.ok(Number.isFinite(v));
});
