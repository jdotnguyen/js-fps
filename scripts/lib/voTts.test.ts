import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REACTION_BATCHES, reactionVoice } from './voReactionBatches.ts';
import { QuotaExhaustedError, requestTts, runBatches, type FetchFn } from './voTts.ts';
import type { TtsModel } from './voCast.ts';

const AUDIO = Buffer.from([1, 0, 2, 0]).toString('base64');
const ok = () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: AUDIO } }] } }] }), text: async () => '' });
const err = (status: number, body: string) => ({ ok: false, status, json: async () => ({}), text: async () => body });
const DAILY = '{"error":{"message":"Quota exceeded for metric: generate_requests_per_model_per_day, limit: 15","details":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}}';
const PER_MINUTE = '{"error":{"message":"Quota exceeded","details":[{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}]}}';

/** A fetch stub that answers by model and records every model it was asked for. */
type StubResponse = Awaited<ReturnType<FetchFn>>;

function stubFetch(answer: (model: string, call: number) => StubResponse): { fetchFn: FetchFn; models: string[] } {
  const models: string[] = [];
  const fetchFn: FetchFn = async (url) => {
    const model = /models\/([^:]+):/.exec(url)![1]!;
    models.push(model);
    return answer(model, models.length);
  };
  return { fetchFn, models };
}

const noSleep = async (): Promise<void> => {};
const quiet = (): void => {};

function makeBatches(): Array<{ name: string; speakers: string[]; model: TtsModel }> {
  return [
    { name: 'retake_medic_01', speakers: ['medic'], model: 'gemini-2.5-flash-preview-tts' },
    { name: 'retake_medic_02', speakers: ['medic'], model: 'gemini-2.5-flash-preview-tts' },
    { name: 'retake_medic_03', speakers: ['medic'], model: 'gemini-2.5-flash-preview-tts' },
    { name: 'retake_player_01', speakers: ['player'], model: 'gemini-3.1-flash-tts-preview' },
    { name: 'retake_medic_04', speakers: ['medic'], model: 'gemini-2.5-flash-preview-tts' },
  ];
}

test('no fallback: a daily-quota 429 fails the batch, skips that model, continues other speakers, and never tries another model', async () => {
  const { fetchFn, models } = stubFetch((model, call) => (model === 'gemini-2.5-flash-preview-tts' && call === 3 ? err(429, DAILY) : ok()));
  const written: string[] = [];
  const batches = makeBatches();
  const report = await runBatches(batches, async (b) => {
    await requestTts({ apiKey: 'k', model: b.model, prompt: 'p', speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } } }, label: b.name, fetchFn, sleepFn: noSleep, log: quiet });
    written.push(b.name);
  });

  assert.deepEqual(written, ['retake_medic_01', 'retake_medic_02', 'retake_player_01']);
  assert.deepEqual(report.failed.map((f) => f.name), ['retake_medic_03']);
  assert.deepEqual(report.skipped.map((s) => s.name), ['retake_medic_04']);
  // Every Okafor request went to his pinned model; Jay's went to his. Nothing else was asked for.
  assert.deepEqual(models, ['gemini-2.5-flash-preview-tts', 'gemini-2.5-flash-preview-tts', 'gemini-2.5-flash-preview-tts', 'gemini-3.1-flash-tts-preview']);
});

test('no fallback: a 404 (retired model) stops that speaker only', async () => {
  const { fetchFn } = stubFetch((model) => (model === 'gemini-2.5-flash-preview-tts' ? err(404, 'model not found') : ok()));
  const report = await runBatches(makeBatches(), (b) =>
    requestTts({ apiKey: 'k', model: b.model, prompt: 'p', speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'x' } } }, label: b.name, fetchFn, sleepFn: noSleep, log: quiet }).then(() => {}),
  );
  assert.deepEqual(report.done, ['retake_player_01']);
  assert.deepEqual(report.failed.map((f) => f.name), ['retake_medic_01']);
  assert.equal(report.skipped.length, 3);
});

test('per-minute 429: waits and retries on the same model, then writes the batch', async () => {
  const { fetchFn, models } = stubFetch((_m, call) => (call === 1 ? err(429, PER_MINUTE) : ok()));
  const waits: number[] = [];
  const pcm = await requestTts({
    apiKey: 'k', model: 'gemini-2.5-flash-preview-tts', prompt: 'p',
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Algenib' } } }, label: 'retake_engineer_01',
    fetchFn, sleepFn: async (ms) => { waits.push(ms); }, log: quiet,
  });
  assert.equal(pcm.length, 4);
  assert.deepEqual(models, ['gemini-2.5-flash-preview-tts', 'gemini-2.5-flash-preview-tts']);
  assert.equal(waits.length, 1);
});

test('per-minute 429 that never clears becomes a quota error on that model', async () => {
  const { fetchFn, models } = stubFetch(() => err(429, PER_MINUTE));
  await assert.rejects(
    requestTts({ apiKey: 'k', model: 'gemini-3.1-flash-tts-preview', prompt: 'p', speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Orus' } } }, label: 'x', fetchFn, sleepFn: noSleep, log: quiet }),
    QuotaExhaustedError,
  );
  assert.ok(models.every((m) => m === 'gemini-3.1-flash-tts-preview'));
});

test('reactions: a quota error fails the reaction batch without trying another model', async () => {
  const jay = REACTION_BATCHES.find((b) => b.name === 'react_jay_pain')!;
  const { voice, model } = reactionVoice(jay);
  const { fetchFn, models } = stubFetch(() => err(429, DAILY));
  const report = await runBatches([{ ...jay, speakers: [jay.speaker], voice, model }], (b) =>
    requestTts({ apiKey: 'k', model: b.model, prompt: 'p', speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: b.voice } } }, label: b.name, fetchFn, sleepFn: noSleep, maxAttempts: 2, log: quiet }).then(() => {}),
  );
  assert.deepEqual(report.failed.map((f) => f.name), ['react_jay_pain']);
  assert.deepEqual(models, ['gemini-3.1-flash-tts-preview']);
});
