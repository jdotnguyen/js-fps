import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FINGER_CHANNELS, sampleFingers, sharedMocapLibrary } from './mocap.ts';

test('finger tracks: clips whose source records fingers carry them; others carry none', () => {
  const lib = sharedMocapLibrary();
  const talk = lib.get('idle_talk');
  assert.ok(talk.fingers, 'idle_talk (Quaternius, finger joints) has a finger track');
  assert.equal(talk.fingers.length, talk.frames * FINGER_CHANNELS);
  assert.equal(lib.get('zombie_walk').fingers, null, 'zombie_walk (no finger joints) has none');

  const out = new Float32Array(FINGER_CHANNELS);
  assert.ok(sampleFingers(talk, 0.37, out));
  for (const v of out) assert.ok(v >= 0 && v < 5, `curl ${v} rad is plausible`);
  const left = out.slice(0, 6).reduce((a, b) => a + b, 0);
  const other = new Float32Array(FINGER_CHANNELS);
  sampleFingers(talk, 0.87, other);
  assert.notEqual(left, other.slice(0, 6).reduce((a, b) => a + b, 0), 'the fingers move over the clip');
  assert.equal(sampleFingers(lib.get('zombie_walk'), 0.5, out), false);
});
