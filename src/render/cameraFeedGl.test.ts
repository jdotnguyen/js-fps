import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOOKS, OVERLAY_SCAN, scanPitch } from './cameraFeedGl.ts';

// camera-feeds spec: the CCTV look's strength per feed. The GL passes need a context and are not run
// here; these pin the numbers the passes use.

test('the monitor look is the original CCTV look, unchanged', () => {
  // The values the pass used before looks existed: x2.2 gain, 20% colour, +/-0.05 grain,
  // 0.84 + 0.16 sin scanlines, 90% vignette, no contrast curve, caption at its original size and place.
  assert.deepEqual({ ...LOOKS.monitor }, { gain: 2.2, colour: 0.2, noise: 0.1, scan: 0.16, vignette: 0.9, gamma: 1, labelScale: 1, inset: 0 });
});

test('the fullscreen look is gentler and leaves scanlines to the overlay', () => {
  const m = LOOKS.monitor;
  const f = LOOKS.fullscreen;
  assert.ok(f.gain < m.gain && f.noise < m.noise && f.vignette < m.vignette, 'less gain, grain and vignette');
  assert.ok(f.colour > m.colour, 'more colour');
  assert.equal(f.scan, 0, 'no texel scanlines: they would be 3x thick when stretched');
  assert.ok(OVERLAY_SCAN.depth > 0);
  assert.ok(f.inset >= 0.11, 'caption and REC dot clear of the 11vh cinematic bars');
});

test('fullscreen scanlines are at most 4 screen pixels apart at any view height', () => {
  assert.equal(scanPitch(1080), 3);
  for (const h of [480, 720, 1080, 1440, 2160, 4320]) {
    const p = scanPitch(h);
    assert.ok(p >= 2 && p <= 4, `${p} px at ${h} px tall`);
  }
});
