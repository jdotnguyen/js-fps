import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SLAM_KICK, slamKick } from './slamKick.ts';

// medbay-attack "The slams jolt the view" (livelier-cart-slam D8).
const neighbours = (room: string): readonly string[] => (room === 'R08' ? ['R07', 'R08b'] : []);

test('a slam dips the view in its own room and the rooms beside it, harder with each impact', () => {
  const first = slamKick({ n: 1 }, 'R07', 'R08', neighbours);
  const third = slamKick({ n: 3 }, 'R07', 'R08', neighbours);
  assert.ok(first < 0, 'the view dips');
  assert.ok(third < first, 'the third is felt harder');
  assert.equal(slamKick({ n: 1 }, 'R08', 'R08', neighbours), -(SLAM_KICK.base + SLAM_KICK.per));
});

test('nothing is felt far away, in a skipped scene, or with no room', () => {
  assert.equal(slamKick({ n: 2 }, 'R09', 'R08', neighbours), 0);
  assert.equal(slamKick({ n: 2, instant: true }, 'R07', 'R08', neighbours), 0);
  assert.equal(slamKick({ n: 2 }, undefined, 'R08', neighbours), 0);
});
