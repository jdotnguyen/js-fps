import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AudioEngine, LoopHandle } from './engine.ts';
import { MenuMusic } from './menuMusic.ts';

test('a sequence dips its cued track, the pause menu dips it further, and a new cue is back at full', () => {
  const music = new MenuMusic({} as AudioEngine, 'playing');
  let gain = -1;
  // The theme renders in a worker, so stand in for the loop it would start.
  (music as unknown as { handle: Pick<LoopHandle, 'setGain'> }).handle = { setGain: (v: number) => (gain = v) };

  music.cue('main_theme');
  assert.equal(gain, 1);
  music.cue('main_theme', 0.3);
  assert.equal(gain, 0.3);
  music.setMode('paused');
  assert.equal(gain, 0.3 * 0.4);
  music.setMode('playing');
  assert.equal(gain, 0.3);
  music.cue(null);
  assert.equal(gain, 0);
  music.cue('main_theme');
  assert.equal(gain, 1);
});
