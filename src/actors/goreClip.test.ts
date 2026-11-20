import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLIP_GAP, clipCoord, crossed, sameClip, type GoreClip, clearOfBand } from './goreClip.ts';

const glass: GoreClip = { axis: 'z', at: 46.05, keep: 'above' };

test('a particle that crosses the glass plane is stopped on the bay side with its push through it removed', () => {
  assert.equal(crossed(glass, 45.9), true);
  assert.equal(crossed(glass, 46.2), false);
  // Thrown toward Jay (-z): clamped just inside the bay, velocity along z zeroed.
  const [p, v] = clipCoord(glass, 45.9, -2);
  assert.ok(Math.abs(p - (46.05 + CLIP_GAP)) < 1e-9);
  assert.equal(v, 0);
  // Already on the right side: untouched.
  assert.deepEqual(clipCoord(glass, 47, -1), [47, -1]);
  // On the wrong side but moving back into the bay: keeps its velocity.
  assert.equal(clipCoord(glass, 45.9, 1)[1], 1);
});

test('keep below mirrors the rule and sameClip compares all fields', () => {
  const c: GoreClip = { axis: 'x', at: 0, keep: 'below' };
  assert.deepEqual(clipCoord(c, 0.5, 3), [-CLIP_GAP, 0]);
  assert.deepEqual(clipCoord(c, -2, 3), [-2, 3]);
  assert.equal(sameClip(c, { ...c }), true);
  assert.equal(sameClip(c, { ...c, keep: 'above' }), false);
});

test('a simulated spray thrown at the glass never ends up on Jay\'s side', () => {
  let z = 47;
  let vz = -3;
  for (let i = 0; i < 200; i++) {
    z += vz * 0.016;
    [z, vz] = clipCoord(glass, z, vz);
    assert.ok(z >= 46.05, `z=${z}`);
  }
});

test('blood marks on glass move out of the clear band, below or above it (infection-kills spec)', () => {
  const band = { min: 1.1, max: 1.8 };
  assert.equal(clearOfBand(0.6, 0.3, band), 0.6, 'already below');
  assert.equal(clearOfBand(2.1, 0.3, band), 2.1, 'already above');
  const low = clearOfBand(1.2, 0.3, band);
  assert.ok(low + 0.15 <= band.min, 'a mark low in the band drops below it');
  const high = clearOfBand(1.7, 0.3, band);
  assert.ok(high - 0.15 >= band.max, 'a mark high in the band rises above it');
  assert.equal(clearOfBand(1.4, 0.3, undefined), 1.4, 'no band, no move');
});
