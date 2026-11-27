import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine } from '../audio/engine.ts';
import { installFakeWebAudio, type FakeAudioContext, type FakeSource } from '../audio/testing/fakeWebAudio.ts';
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
function beatHost(untilBeat: number | null): { host: ReturnType<typeof createGameHost>; played: Array<[string, number]>; cues: string[] } {
  const played: Array<[string, number]> = [];
  const cues: string[] = [];
  const audio = { hasSound: () => true, play: (name: string, opts?: { delay?: number }) => void played.push([name, opts?.delay ?? 0]) };
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

test('sfx on the beat is scheduled for the next beat of the score', () => {
  const { host, played } = beatHost(0.3);
  host.sfx!('klaxon', null, { beat: true });
  host.sfx!('klaxon', null);
  assert.deepEqual(played, [['klaxon', 0.3], ['klaxon', 0]], 'only a step that asks for the beat waits');
});

// game-pause "A sound waiting for the beat": the wait is on the audio clock, which a hold stops along with the score.
test('a klaxon waiting for the beat still lands on it after a hold', async (t) => {
  t.after(installFakeWebAudio());
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const audio = new AudioEngine();
  const ctx = audio.ctx as unknown as FakeAudioContext;
  (audio as unknown as { buffers: Map<string, unknown[]> }).buffers.set('klaxon', [ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)]);
  const BEAT = 0.5;
  /** A score whose beats fall every BEAT s of the audio clock. */
  const score = { untilBeat: () => Math.ceil(ctx.currentTime / BEAT - 1e-6) * BEAT - ctx.currentTime };
  const host = createGameHost({ audio, score, events: { on: () => () => undefined, emit: () => undefined } } as unknown as GameHostDeps);
  ctx.advance(1.2);
  host.sfx!('klaxon', null, { beat: true });
  const source = ctx.nodes.filter((n) => n.kind === 'source').at(-1) as FakeSource;
  audio.setHeld(true);
  t.mock.timers.tick(60_000);
  ctx.advance(60);
  audio.setHeld(false);
  await new Promise<void>((r) => setImmediate(r));
  assert.ok(Math.abs(source.started![0]! - 1.5) < 1e-9, `starts at ${source.started![0]}`);
  assert.ok(ctx.currentTime < 1.5, 'still ahead on release');
});

test('sfx on the beat plays at once with no score, or when the beat is now', () => {
  for (const until of [null, 0]) {
    const { host, played } = beatHost(until);
    host.sfx!('klaxon', null, { beat: true });
    assert.deepEqual(played, [['klaxon', 0]], String(until));
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
  assert.equal(calls[0]!.opts?.occlude, 'sealed', 'a positional step: only sealed glass muffles it');
  assert.ok(calls[0]!.opts?.position, 'still positional');
  assert.equal(calls[1]!.opts?.position, undefined, 'non-positional step has no position to occlude');
});
