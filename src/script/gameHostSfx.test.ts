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
