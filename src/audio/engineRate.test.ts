/** Fixed 48 kHz context (spec audio-mix: Fixed mix sample rate). Own file: these tests stub the global AudioContext. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUDIO_SAMPLE_RATE, createAudioContext } from './engine.ts';

type Opts = { latencyHint?: string; sampleRate?: number };

function stubAudioContext(refuseRate: boolean): Opts[] {
  const made: Opts[] = [];
  class FakeContext {
    readonly sampleRate: number;
    constructor(opts: Opts = {}) {
      if (refuseRate && opts.sampleRate !== undefined) throw new DOMException('rate not supported', 'NotSupportedError');
      made.push(opts);
      this.sampleRate = opts.sampleRate ?? 192000;
    }
  }
  Object.defineProperty(globalThis, 'AudioContext', { value: FakeContext, configurable: true, writable: true });
  return made;
}

test('the audio context is created at a fixed 48 kHz', () => {
  const made = stubAudioContext(false);
  try {
    const ctx = createAudioContext();
    assert.equal(AUDIO_SAMPLE_RATE, 48000);
    assert.equal(ctx.sampleRate, 48000);
    assert.deepEqual(made, [{ latencyHint: 'interactive', sampleRate: 48000 }]);
  } finally {
    delete (globalThis as { AudioContext?: unknown }).AudioContext;
  }
});

test('a refused rate falls back to the device rate with one [audio] warning', (t) => {
  const made = stubAudioContext(true);
  const warn = t.mock.method(console, 'warn', () => undefined);
  try {
    const ctx = createAudioContext();
    assert.equal(ctx.sampleRate, 192000);
    assert.deepEqual(made, [{ latencyHint: 'interactive' }]);
    assert.equal(warn.mock.callCount(), 1);
    assert.match(String(warn.mock.calls[0]!.arguments[0]), /^\[audio\] 48000 Hz context refused/);
  } finally {
    delete (globalThis as { AudioContext?: unknown }).AudioContext;
  }
});
