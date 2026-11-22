/**
 * Gemini TTS requests and the batch runner shared by the VO generators. A batch is only ever sent to its
 * speakers' pinned model: there is no fallback list (voice-playback spec, "VO generation never falls back
 * to another model").
 */
import type { TtsModel } from './voCast.ts';

export type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export type SpeechConfig =
  | { voiceConfig: { prebuiltVoiceConfig: { voiceName: string } } }
  | { multiSpeakerVoiceConfig: { speakerVoiceConfigs: Array<{ speaker: string; voiceConfig: { prebuiltVoiceConfig: { voiceName: string } } }> } };

/** The model's daily quota is spent, or a per-minute limit would not clear. Later batches on this model will fail too. */
export class QuotaExhaustedError extends Error {
  readonly model: string;
  constructor(model: string, detail: string) {
    super(`Quota exhausted on ${model}: ${detail}`);
    this.model = model;
  }
}

/** The model refused the request (HTTP 400/403/404): a bad request, no access, or a retired model. */
export class RequestRejectedError extends Error {
  readonly model: string;
  constructor(model: string, status: number, detail: string) {
    super(`${model} rejected the request (HTTP ${status}): ${detail}`);
    this.model = model;
  }
}

export interface TtsRequest {
  apiKey: string;
  model: TtsModel;
  prompt: string;
  speechConfig: SpeechConfig;
  /** For log lines. */
  label: string;
  fetchFn?: FetchFn;
  sleepFn?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  log?: (msg: string) => void;
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** One TTS request on exactly `req.model`. Retries per-minute 429s, empty audio and 5xx on the same model. */
export async function requestTts(req: TtsRequest): Promise<Buffer> {
  const fetchFn = req.fetchFn ?? (fetch as unknown as FetchFn);
  const sleep = req.sleepFn ?? realSleep;
  const log = req.log ?? ((m: string) => console.warn(m));
  const maxAttempts = req.maxAttempts ?? 3;
  const { model } = req;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': req.apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: req.speechConfig },
      }),
    });

    if (res.ok) {
      const json = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> }; finishReason?: string }>;
      };
      const data = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
      if (data) return Buffer.from(data, 'base64');
      const reason = json.candidates?.[0]?.finishReason ?? 'unknown';
      if (attempt < maxAttempts) {
        log(`[tts] empty audio on ${model} (${req.label}, finishReason=${reason}), retrying (${attempt}/${maxAttempts})...`);
        await sleep(5_000 * attempt);
        continue;
      }
      throw new Error(`${model} returned no audio for ${req.label} (finishReason=${reason})`);
    }

    const errText = await res.text();
    if (res.status === 429) {
      const isDaily = /PerDay|RPD|limit:\s*0\b/i.test(errText);
      if (!isDaily && attempt < maxAttempts) {
        const waitMs = 24_000 * attempt;
        log(`[tts] per-minute 429 on ${model} (${req.label}), waiting ${(waitMs / 1000).toFixed(0)}s on the same model (${attempt}/${maxAttempts})...`);
        await sleep(waitMs);
        continue;
      }
      throw new QuotaExhaustedError(model, errText.slice(0, 260));
    }
    if (res.status === 400 || res.status === 403 || res.status === 404) {
      throw new RequestRejectedError(model, res.status, errText.slice(0, 260));
    }
    if (res.status >= 500 && attempt < maxAttempts) {
      const waitMs = 6_000 * attempt;
      log(`[tts] HTTP ${res.status} on ${model} (${req.label}), retrying in ${(waitMs / 1000).toFixed(0)}s...`);
      await sleep(waitMs);
      continue;
    }
    throw new Error(`${model} HTTP ${res.status}: ${errText.slice(0, 400)}`);
  }
  throw new Error(`Failed on ${model} after ${maxAttempts} attempts`);
}

export interface RunnableBatch {
  name: string;
  speakers: readonly string[];
  model: TtsModel;
}

export interface RunReport {
  done: string[];
  failed: Array<{ name: string; error: string }>;
  /** Batches not attempted because an earlier batch hit its model's quota or a rejection for the same speaker. */
  skipped: Array<{ name: string; reason: string }>;
}

/**
 * Runs `work` for each batch in order. A quota error stops every later batch on that model, and a rejection
 * stops every later batch for those speakers; other speakers carry on. Nothing is retried on another model.
 */
export async function runBatches<B extends RunnableBatch>(batches: readonly B[], work: (batch: B, index: number) => Promise<void>): Promise<RunReport> {
  const report: RunReport = { done: [], failed: [], skipped: [] };
  const spentModels = new Map<string, string>();
  const blockedSpeakers = new Map<string, string>();

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!;
    const spent = spentModels.get(batch.model);
    const blocked = batch.speakers.map((s) => blockedSpeakers.get(s)).find(Boolean);
    if (spent || blocked) {
      report.skipped.push({ name: batch.name, reason: spent ?? blocked! });
      continue;
    }
    try {
      await work(batch, i);
      report.done.push(batch.name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      report.failed.push({ name: batch.name, error: msg });
      if (err instanceof QuotaExhaustedError) spentModels.set(batch.model, `${batch.model} quota exhausted at ${batch.name}`);
      if (err instanceof RequestRejectedError) for (const s of batch.speakers) blockedSpeakers.set(s, `${batch.model} rejected ${batch.name}`);
    }
  }
  return report;
}

/** Prints the run's unfinished batches. Returns true when every batch was made. */
export function printReport(tag: string, report: RunReport): boolean {
  if (report.failed.length > 0) {
    console.log(`\n[${tag}] FAILED BATCHES (${report.failed.length}):`);
    for (const f of report.failed) console.log(`  - ${f.name}: ${f.error}`);
  }
  if (report.skipped.length > 0) {
    console.log(`\n[${tag}] NOT GENERATED (${report.skipped.length}), rerun these once the quota resets:`);
    for (const s of report.skipped) console.log(`  - ${s.name} (${s.reason})`);
  }
  return report.failed.length === 0 && report.skipped.length === 0;
}
