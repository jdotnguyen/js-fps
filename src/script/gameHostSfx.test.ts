import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameHost, type GameHostDeps } from './gameHost.ts';

// dock-checkpoint spec, "Missing sound files": a registered sound whose file never loaded is skipped with a warning; the
// sequence (and the scan's light feedback) carries on.

test('sfx with a registered but unloaded sample warns and does not throw', () => {
  const played: string[] = [];
  const audio = {
    hasSound: () => false,
    play: (name: string) => void played.push(name),
  };
  const host = createGameHost({ audio, events: { on: () => () => undefined, emit: () => undefined } } as unknown as GameHostDeps);
  const warn = console.warn;
  const warnings: string[] = [];
  console.warn = (m: unknown) => void warnings.push(String(m));
  try {
    for (const id of ['archPass', 'archAlarm', 'wandBeep']) assert.doesNotThrow(() => host.sfx!(id, null));
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(played, []);
  assert.equal(warnings.length, 3);
  assert.ok(warnings.every((w) => w.includes('not ready')));
});

// in-world-audio "World sound occlusion": sequence sounds play as authored, so positional ones opt out of wall muffling.
test('a positional sfx step opts out of occlusion', () => {
  type Opts = { occlude?: boolean; position?: unknown };
  const calls: Array<{ name: string; opts: Opts | undefined }> = [];
  const audio = { hasSound: () => true, play: (name: string, opts?: Opts) => void calls.push({ name, opts }) };
  const host = createGameHost({ audio, events: { on: () => () => undefined, emit: () => undefined } } as unknown as GameHostDeps);
  host.sfx!('klaxon', { x: 1, y: 2, z: 3 });
  host.sfx!('klaxon', null);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.opts?.occlude, false, 'positional step opts out');
  assert.ok(calls[0]!.opts?.position, 'still positional');
  assert.equal(calls[1]!.opts?.position, undefined, 'non-positional step has no position to occlude');
});
