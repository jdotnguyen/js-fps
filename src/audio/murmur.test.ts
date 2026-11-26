import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { AmbienceAudio } from './ambience.ts';
import type { VoiceOptions } from './engine.ts';
import { ConversationMurmur, MURMUR_SOUNDS, MURMUR_TUNING, type MurmurSource } from './murmur.ts';

interface Loop {
  name: string;
  opts: VoiceOptions;
  gain: number;
  /** Fade-out seconds once stopped. */
  stopped: number | null;
  at: number[];
}

function setup(init: { ready?: boolean } = {}) {
  const loops: Loop[] = [];
  const state = { ready: init.ready ?? true, heard: new Map<number, number>() };
  const audio: AmbienceAudio = {
    hasSound: () => state.ready,
    hasSample: () => state.ready,
    onSampleLoaded: () => () => undefined,
    play: () => undefined,
    loop: (name, opts = {}) => {
      const l: Loop = { name, opts, gain: opts.gain ?? 1, stopped: null, at: [] };
      loops.push(l);
      return {
        setGain: (v) => (l.gain = v),
        setPosition: (x, y, z) => (l.at = [x, y, z]),
        stop: (s = 0) => (l.stopped = s),
      };
    },
  };
  // Hearing is keyed by the source's x, so a test can wall one group off.
  const murmur = new ConversationMurmur(audio, (p) => state.heard.get(p.x) ?? 1);
  murmur.setMode('playing');
  return { murmur, loops, state, live: () => loops.filter((l) => l.stopped === null) };
}

const at = (id: string, x: number): MurmurSource => ({ id, position: new THREE.Vector3(x, 1.2, 0) });
const BAR = at('commons_bar', 1);
const WALL = at('commons_wall', -1);

test('each talking group murmurs from where it is, on the ambience bus, and no two sound alike', () => {
  const g = setup();
  const groups = [BAR, WALL, at('commons_t17', 3), at('dyn:sofa', 5)];
  g.murmur.update(groups, null, false);
  assert.equal(g.live().length, 4);
  for (const [i, l] of g.live().entries()) {
    assert.equal(l.opts.bus, 'ambience');
    assert.equal(l.opts.position?.x, groups[i]!.position.x);
    assert.equal(l.gain, MURMUR_TUNING.gain);
  }
  assert.equal(new Set(g.loops.slice(0, 3).map((l) => l.name)).size, MURMUR_SOUNDS.length, 'recordings are shared out');
  assert.equal(new Set(g.loops.map((l) => `${l.name}@${l.opts.rate}`)).size, 4);
  g.murmur.update(groups, null, false);
  assert.equal(g.loops.length, 4, 'one loop per group, not one per update');
});

test('a group that breaks up fades out over about a second', () => {
  const g = setup();
  g.murmur.update([BAR, WALL], null, false);
  g.murmur.update([BAR], null, false);
  assert.equal(g.loops[1]!.stopped, MURMUR_TUNING.fadeOut);
  assert.equal(g.loops[0]!.stopped, null);
});

test('during an exchange the speaking pair falls silent and the others drop back, then both return', () => {
  const g = setup();
  g.murmur.update([BAR, WALL], null, false);
  g.murmur.update([BAR, WALL], 'commons_bar', false);
  assert.equal(g.loops[0]!.gain, 0);
  assert.equal(g.loops[1]!.gain, MURMUR_TUNING.gain * MURMUR_TUNING.makeWay);
  g.murmur.update([BAR, WALL], null, false);
  assert.deepEqual(g.loops.map((l) => l.gain), [MURMUR_TUNING.gain, MURMUR_TUNING.gain]);
});

test('rooms and closed doors act on its level, and it is silent where a voice would be', () => {
  const g = setup();
  g.state.heard.set(BAR.position.x, 0.2);
  g.state.heard.set(WALL.position.x, 0);
  g.murmur.update([BAR, WALL], null, false);
  assert.ok(Math.abs(g.loops[0]!.gain - MURMUR_TUNING.gain * 0.2) < 1e-9);
  assert.equal(g.loops[1]!.gain, 0);
});

test('it follows the game mode as ambience does: lower when paused, gone on the title', () => {
  const g = setup();
  g.murmur.update([BAR], null, false);
  g.murmur.setMode('paused');
  assert.ok(Math.abs(g.loops[0]!.gain - MURMUR_TUNING.gain * 0.35) < 1e-9);
  g.murmur.setMode('playing');
  assert.equal(g.loops[0]!.gain, MURMUR_TUNING.gain);
  g.murmur.setMode('title');
  assert.equal(g.live().length, 0);
  g.murmur.update([BAR], null, false);
  assert.equal(g.live().length, 0);
});

test('from the drop on there is no murmur', () => {
  const g = setup();
  g.murmur.update([BAR, WALL], null, false);
  g.murmur.update([BAR, WALL], null, true);
  assert.equal(g.live().length, 0);
  g.murmur.update([BAR, WALL], null, true);
  assert.equal(g.loops.length, 2);
});

test('with nothing decoded yet it stays quiet, then starts once a recording is ready', () => {
  const g = setup({ ready: false });
  g.murmur.update([BAR], null, false);
  assert.equal(g.loops.length, 0);
  g.state.ready = true;
  g.murmur.update([BAR], null, false);
  assert.equal(g.live().length, 1);
});
