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

// adaptive-music spec / in-world-audio "Klaxon on the beat": an sfx step that asks for the beat waits for the score.
function beatHost(untilBeat: number | null): { host: ReturnType<typeof createGameHost>; played: string[]; cues: string[] } {
  const played: string[] = [];
  const cues: string[] = [];
  const audio = { hasSound: () => true, play: (name: string) => void played.push(name) };
  const score =
    untilBeat === null
      ? null
      : {
          load: (id: string) => void cues.push(`load ${id}`),
          cue: (id: string, c: string) => void cues.push(`${id} ${c}`),
          stinger: (s: string, id?: string) => void cues.push(`stinger ${s} ${id}`),
          untilBeat: () => untilBeat,
        };
  const host = createGameHost({ audio, score, events: { on: () => () => undefined, emit: () => undefined } } as unknown as GameHostDeps);
  return { host, played, cues };
}

test('sfx on the beat waits for the next beat of the score', async () => {
  const { host, played } = beatHost(0.05);
  host.sfx!('klaxon', null, { beat: true });
  assert.deepEqual(played, []);
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(played, ['klaxon']);
});

test('sfx on the beat plays at once with no score, or when the beat is now', () => {
  for (const until of [null, 0]) {
    const { host, played } = beatHost(until);
    host.sfx!('klaxon', null, { beat: true });
    assert.deepEqual(played, ['klaxon'], String(until));
  }
});

test('the score step loads, cues and fires stingers', () => {
  const { host, cues } = beatHost(0);
  host.score!('labB', { load: true });
  host.score!('labB', { cue: 'door' });
  host.score!('labB', { stinger: 'rise' });
  assert.deepEqual(cues, ['load labB', 'labB door', 'stinger rise labB']);
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
