/**
 * Batched Gemini TTS generator + PCM silence-valley splitter (casting rules: docs/voice-casting-standard.md).
 *
 * Generates acted voice-over clips for dialogue lines in `src/data/dialogue/*.json`,
 * saves raw batch WAVs to `previews/vo-batches/` (gitignored, so re-splitting costs 0 API calls),
 * encodes normalized mono MP3s to `public/assets/vo/<id>.mp3`, and optionally patches
 * `"audio": "assets/vo/<id>.mp3"` into the dialogue chapter JSONs.
 *
 * Every new clip is first written to `previews/vo-staging/` and transcribed on this machine. It replaces the shipped
 * clip only if it says its line (scripts/lib/voGate.ts); otherwise it is held there. After listening to a held clip,
 * `--accept` ships it. Without the speech model (docs/voice-casting-standard.md §8) clips ship unchecked, and say so.
 *
 * Each batch is sent only to its speakers' pinned model from `scripts/lib/voCast.ts`. There is no model
 * fallback and no `--models` flag: when a quota runs out, the run stops that model's batches and lists them.
 * Every generated batch is appended to `scripts/vo-takes.json`.
 *
 * Usage (call node directly; PowerShell 5.1 strips `--` from `npm run`):
 *   node --experimental-strip-types scripts/vo-generate.ts --ids <id1,id2> --apply
 *   node --experimental-strip-types scripts/vo-generate.ts --mode all --apply
 *   node --experimental-strip-types scripts/vo-generate.ts --ids <id1,id2> --resplit --apply   (0 API calls)
 *   node --experimental-strip-types scripts/vo-generate.ts --mode all --dry-run
 *   node --experimental-strip-types scripts/vo-generate.ts --accept <id1,id2> --apply          (ship held clips)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { DialogueChapter, DialogueLine, Emote } from '../src/data/types/dialogue.ts';
import { allBatches, idsBatches, isNonVerbalOnly, maxBatchSeconds, type BatchSpec } from './lib/voBatches.ts';
import { batchModel, castFor, promptProfile } from './lib/voCast.ts';
import { recordBatch } from './lib/voTakes.ts';
import { TIGHT_LINES } from './lib/voPauses.ts';
import { tightenClip } from './lib/voTighten.ts';
import { printReport, requestTts, runBatches, type SpeechConfig } from './lib/voTts.ts';
import { manifestAudio } from './lib/voManifest.ts';
import { writeRecording } from './lib/voArchive.ts';
import { acceptClips, describeHeld, gateClip, recordAccepted, STAGING_DIR, stagedClip, type StagedTake } from './lib/voGate.ts';
import { sttSetup } from './lib/voStt.ts';

const ROOT = resolve(import.meta.dirname, '..');
const DIALOGUE_DIR = join(ROOT, 'src/data/dialogue');
const OUT_DIR = join(ROOT, 'public/assets/vo');
const BATCH_DIR = join(ROOT, 'previews/vo-batches');
const SAMPLE_RATE = 24000;
const DEFAULT_DELAY_MS = 21_000;
const DEFAULT_BATCH_SIZE = 14;

const EMOTE_HINT: Record<Emote, string> = {
  neutral: 'natural, grounded, conversational',
  question: 'curious, natural questioning inflection',
  urgent: 'urgent, loud, tense combat callout, fast and sharp',
  alarmed: 'startled, tense, sharp alertness',
  pained: 'strained, hurt, wincing effort',
  relieved: 'exhaling relief, warmer, softer',
  laugh: 'amused, wry chuckle or warm grin in the voice',
  whisper: 'hushed, close, quiet conspiratorial or frightened whisper',
  dread: 'quiet, heavy, shaken, haunted gravity',
  scream: 'terrified, strained cry',
};

function loadEnvKey(): string {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  const envPath = join(ROOT, '.env');
  if (existsSync(envPath)) {
    const raw = readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*GEMINI_API_KEY\s*=\s*(.+?)\s*$/.exec(line);
      if (m) return m[1]!.replace(/^['"]|['"]$/g, '').trim();
    }
  }
  throw new Error('GEMINI_API_KEY not found in environment or .env');
}

interface ChapterFile {
  file: string;
  path: string;
  data: DialogueChapter;
}

function loadChapters(): ChapterFile[] {
  const files = readdirSync(DIALOGUE_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'speakers.json' && f !== 'ui.json')
    .sort();
  return files.map((file) => {
    const p = join(DIALOGUE_DIR, file);
    return { file, path: p, data: JSON.parse(readFileSync(p, 'utf8')) as DialogueChapter };
  });
}

// ------------------------------------------------------------------ WAV & PCM splitting

function pcmToWav(pcm: Buffer, sampleRate = SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function readWavPcm(wavPath: string): { samples: Float32Array; sampleRate: number } {
  const buf = readFileSync(wavPath);
  const sampleRate = buf.readUInt32LE(24);
  // Find `data` chunk safely.
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'data') {
      const count = Math.floor(size / 2);
      const samples = new Float32Array(count);
      for (let i = 0; i < count; i++) samples[i] = buf.readInt16LE(off + 8 + i * 2) / 32768;
      return { samples, sampleRate };
    }
    off += 8 + size;
  }
  throw new Error(`No data chunk in ${wavPath}`);
}

interface Gap {
  start: number;
  end: number;
  mid: number;
  dur: number;
}

/**
 * Split a batched mono recording into `lines.length` clips by locating silence valleys
 * and choosing the best `N - 1` cuts via dynamic programming over (silence duration +
 * expected relative speech length).
 */
function findSplits(samples: Float32Array, sr: number, lines: DialogueLine[]): Array<{ start: number; end: number }> {
  const totalDur = samples.length / sr;
  const win = Math.round(sr * 0.02);
  const hop = Math.round(sr * 0.005);
  const frames = Math.max(1, Math.floor((samples.length - win) / hop));
  const rms = new Float32Array(frames);
  let peak = 1e-6;
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const base = f * hop;
    for (let i = 0; i < win; i++) {
      const v = samples[base + i]!;
      sum += v * v;
    }
    const r = Math.sqrt(sum / win);
    rms[f] = r;
    if (r > peak) peak = r;
  }

  // Find active audio bounds first so leading/trailing silence is excluded.
  const activeThr = Math.max(peak * 0.025, 0.004);
  let firstActive = 0;
  let lastActive = frames - 1;
  while (firstActive < frames - 1 && rms[firstActive]! < activeThr) firstActive++;
  while (lastActive > firstActive && rms[lastActive]! < activeThr) lastActive--;
  const activeStart = Math.max(0, (firstActive * hop) / sr);
  const activeEnd = Math.min(totalDur, ((lastActive * hop) + win) / sr);

  if (lines.length === 1) {
    return [{ start: Math.max(0, activeStart - 0.03), end: Math.min(totalDur, activeEnd + 0.08) }];
  }

  const collectGaps = (thrRatio: number, minGapS: number): Gap[] => {
    const thr = Math.max(peak * thrRatio, 0.003);
    const out: Gap[] = [];
    let inGap = false;
    let gStart = 0;
    for (let f = firstActive; f <= lastActive; f++) {
      const quiet = rms[f]! < thr;
      if (quiet && !inGap) {
        inGap = true;
        gStart = f;
      } else if (!quiet && inGap) {
        inGap = false;
        const s = (gStart * hop) / sr;
        const e = (f * hop) / sr;
        const dur = e - s;
        if (dur >= minGapS && s > activeStart + 0.12 && e < activeEnd - 0.12) {
          out.push({ start: s, end: e, mid: (s + e) / 2, dur });
        }
      }
    }
    return out;
  };

  let gaps = collectGaps(0.035, 0.35);
  if (gaps.length < lines.length - 1) gaps = collectGaps(0.05, 0.22);
  if (gaps.length < lines.length - 1) gaps = collectGaps(0.075, 0.14);
  if (gaps.length < lines.length - 1) {
    throw new Error(`Only found ${gaps.length} silence gaps for ${lines.length} lines (need ${lines.length - 1})`);
  }

  // Expected relative weight per line (characters + small base for punctuation/turn overhead).
  const weights = lines.map((l) => Math.max(6, l.text.replace(/[^A-Za-z0-9]/g, '').length + 8));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const activeSpan = activeEnd - activeStart;
  const expectedDurs = weights.map((w) => (w / totalWeight) * activeSpan);

  // DP: choose K = lines.length - 1 gaps maximizing silence width while matching expected segment lengths.
  // Candidate boundary times: b[0] = activeStart, b[1..G] = gaps[i].mid, b[G+1] = activeEnd.
  const K = lines.length;
  const G = gaps.length;
  const pts = [activeStart, ...gaps.map((g) => g.mid), activeEnd];
  const gapBonus = [0, ...gaps.map((g) => Math.min(2.5, g.dur) * 3.2), 0];

  // dp[seg][idx] = best score placing end of segment `seg` (1..K) at boundary point `idx`.
  const NEG = -1e9;
  const dp: Float64Array[] = Array.from({ length: K + 1 }, () => new Float64Array(G + 2).fill(NEG));
  const prev: Int32Array[] = Array.from({ length: K + 1 }, () => new Int32Array(G + 2).fill(-1));
  dp[0]![0] = 0;

  for (let seg = 1; seg <= K; seg++) {
    const exp = expectedDurs[seg - 1]!;
    const idxMin = seg === K ? G + 1 : seg;
    const idxMax = seg === K ? G + 1 : G;
    for (let j = idxMin; j <= idxMax; j++) {
      let best = NEG;
      let bestI = -1;
      const iMin = seg === 1 ? 0 : seg - 1;
      const iMax = seg === 1 ? 0 : j - 1;
      for (let i = iMin; i <= iMax; i++) {
        const base = dp[seg - 1]![i]!;
        if (base <= NEG / 2) continue;
        const dur = pts[j]! - pts[i]!;
        if (dur < 0.22) continue;
        const ratio = dur / Math.max(0.35, exp);
        const lenPenalty = Math.abs(Math.log(Math.max(0.15, ratio))) * 1.4;
        const score = base + gapBonus[j]! - lenPenalty;
        if (score > best) {
          best = score;
          bestI = i;
        }
      }
      dp[seg]![j] = best;
      prev[seg]![j] = bestI;
    }
  }

  const chosen: number[] = new Array(K + 1);
  let cur = G + 1;
  for (let seg = K; seg >= 0; seg--) {
    chosen[seg] = cur;
    cur = prev[seg]![cur]!;
  }

  // Trim each segment tightly to its own active speech bounds + tiny natural padding.
  const segments: Array<{ start: number; end: number }> = [];
  for (let seg = 0; seg < K; seg++) {
    const rawStart = pts[chosen[seg]!]!;
    const rawEnd = pts[chosen[seg + 1]!]!;
    const f0 = Math.max(0, Math.floor((rawStart * sr) / hop));
    const f1 = Math.min(frames - 1, Math.ceil((rawEnd * sr) / hop));
    let a = f0;
    let b = f1;
    while (a < b && rms[a]! < activeThr) a++;
    while (b > a && rms[b]! < activeThr) b--;
    const start = Math.max(rawStart, (a * hop) / sr - 0.025);
    const end = Math.min(rawEnd, ((b * hop) + win) / sr + 0.075);
    segments.push({ start, end: Math.max(start + 0.15, end) });
  }
  return segments;
}

function encodeClip(wavPath: string, start: number, end: number, outMp3: string): number {
  const dur = Math.max(0.15, end - start);
  const fadeOutStart = Math.max(0, dur - 0.035);
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      start.toFixed(4),
      '-t',
      dur.toFixed(4),
      '-i',
      wavPath,
      '-af',
      `highpass=f=75,afade=t=in:st=0:d=0.012,afade=t=out:st=${fadeOutStart.toFixed(4)}:d=0.035,loudnorm=I=-16:TP=-1.5:LRA=11`,
      '-ac',
      '1',
      '-ar',
      '24000',
      '-b:a',
      '64k',
      outMp3,
    ],
    { stdio: 'inherit' },
  );
  return dur;
}

// ------------------------------------------------------------------ Gemini TTS API

function buildPrompt(batch: BatchSpec): string {
  const isMulti = batch.speakers.length > 1;
  const profiles = batch.speakers
    .map((sp) => {
      return `- ${castFor(sp).label}: ${promptProfile(sp)}`;
    })
    .join('\n');

  const lineGuide = batch.lines
    .map((l, i) => {
      const c = castFor(l.speaker);
      const mood = EMOTE_HINT[l.emote ?? 'neutral'];
      return `${i + 1}. ${c.label} (${mood}${l.direction ? `; ${l.direction}` : ''})`;
    })
    .join('\n');

  const cleanForTts = (t: string): string => t.replace(/-$/g, '—');

  const transcript = batch.lines
    .map((l) => {
      const c = castFor(l.speaker);
      const text = cleanForTts(l.text);
      return isMulti ? `${c.label}: ${text}` : text;
    })
    .join('\n\n');

  return [
    '# AUDIO PROFILES',
    profiles,
    '',
    '## THE SCENE',
    batch.sceneNote,
    '',
    "### DIRECTOR'S NOTES",
    '- Perform every line naturally like grounded AAA sci-fi horror game voice acting (Alien: Isolation / SOMA feel). Never sound robotic or theatrical.',
    '- Pronunciation consistency: "Thalassa" = thuh-LASS-uh, "Giles" = Jiles (soft G), "Okafor" = oh-KAH-for, "Priya" = PREE-yuh, "Heins" = Hynz.',
    '- Follow the per-line emotional direction below strictly, without reading any notes, speaker names, or numbers aloud:',
    lineGuide,
    '- IMPORTANT FOR RECORDING: Leave a clean, completely silent 2-second pause between every separate line so each take can be cut cleanly.',
    '',
    '### TRANSCRIPT',
    transcript,
  ].join('\n');
}

function speechConfigFor(batch: BatchSpec): SpeechConfig {
  if (batch.speakers.length > 1) {
    return {
      multiSpeakerVoiceConfig: {
        speakerVoiceConfigs: batch.speakers.map((sp) => {
          const c = castFor(sp);
          return { speaker: c.label, voiceConfig: { prebuiltVoiceConfig: { voiceName: c.voice } } };
        }),
      },
    };
  }
  return { voiceConfig: { prebuiltVoiceConfig: { voiceName: castFor(batch.speakers[0]!).voice } } };
}

// ------------------------------------------------------------------ Batch planning

function auditionBatches(byId: Map<string, DialogueLine>): BatchSpec[] {
  const pick = (ids: string[]): DialogueLine[] =>
    ids.map((id) => {
      const l = byId.get(id);
      if (!l) throw new Error(`Audition line "${id}" not found`);
      return l;
    });
  return [
    {
      name: 'audition_giles_okafor',
      speakers: ['engineer', 'medic'],
      sceneNote: 'Deep-sea research station Thalassa, 3000m underwater. Starts with warm tired morning banter, shifts into tense combat callouts, hushed horror whisper, and heavy dread.',
      lines: pick([
        'intro_giles_02',
        'intro_okafor_02',
        'giles_cover_01',
        'okafor_legs_01',
        'okafor_quiet_01',
        'giles_reveal_01',
      ]),
    },
    {
      name: 'audition_priya_jay',
      speakers: ['nurse', 'player'],
      sceneNote: 'Morning shift change in the warm station mess kitchen aboard Thalassa. Friendly, grounded, easygoing coworkers sharing coffee.',
      lines: pick(['intro_priya_01', 'intro_jay_05', 'intro_priya_06']),
    },
    {
      name: 'audition_hale_pa',
      speakers: ['director', 'pa'],
      sceneNote: 'Corporate station briefing intercom and automated station PA loudspeaker aboard Thalassa.',
      lines: pick(['brief_hale_01', 'pa_quarantine_01']),
    },
  ];
}

function applyAudioManifest(chapters: ChapterFile[]): number {
  let updated = 0;
  for (const ch of chapters) {
    let changed = false;
    const raw = readFileSync(ch.path, 'utf8');
    let next = raw;
    for (const line of ch.data.lines) {
      // A held clip leaves its line as it is, even one already pointing at the file it is waiting to become.
      if (existsSync(stagedClip(STAGING_DIR, line.id))) continue;
      const target = manifestAudio(line.id, line.audio, (p) => existsSync(join(ROOT, 'public', p)));
      if (target === undefined) continue;
      // Preserve existing compact JSON formatting by updating only this line's "audio" property.
      const escapedId = line.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`("id":\\s*"${escapedId}"[\\s\\S]*?"audio":\\s*)(null|"[^"]*")`);
      if (re.test(next)) {
        next = next.replace(re, `$1${target === null ? 'null' : JSON.stringify(target)}`);
        changed = true;
        updated++;
      }
    }
    if (changed) writeFileSync(ch.path, next, 'utf8');
  }
  return updated;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flagVal = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  if (args.includes('--models') || args.includes('--model')) {
    throw new Error('--models was removed: each speaker is pinned to one model in scripts/lib/voCast.ts. To recast a speaker, change their entry there and re-record all their lines.');
  }
  const mode = flagVal('--mode') ?? 'audition';
  const idsArg = flagVal('--ids');
  const resplit = args.includes('--resplit');
  const apply = args.includes('--apply');
  const force = args.includes('--force');
  const pairSmall = !args.includes('--no-pair');
  const limit = flagVal('--limit') ? Number(flagVal('--limit')) : Infinity;
  const batchSize = flagVal('--batch-size') ? Number(flagVal('--batch-size')) : DEFAULT_BATCH_SIZE;
  const delayMs = flagVal('--delay') ? Number(flagVal('--delay')) * 1000 : DEFAULT_DELAY_MS;
  const dryRun = args.includes('--dry-run');

  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(BATCH_DIR, { recursive: true });
  mkdirSync(STAGING_DIR, { recursive: true });

  if (args.includes('--accept')) {
    const ids = (flagVal('--accept') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) throw new Error('--accept needs the ids of held clips: --accept <id1,id2>');
    recordAccepted(acceptClips(ids, STAGING_DIR, OUT_DIR));
    console.log(`[vo] accepted and shipped: ${ids.join(', ')}`);
    if (apply) console.log(`[vo] manifest sync: +${applyAudioManifest(loadChapters())} entries`);
    return;
  }

  const chapters = loadChapters();
  const allLines = chapters.flatMap((c) => c.data.lines);
  const byId = new Map(allLines.map((l) => [l.id, l]));

  let specs = idsArg
    ? idsBatches(byId, idsArg.split(',').map((s) => s.trim()).filter(Boolean), batchSize)
    : mode === 'all'
      // A held clip counts as a clip: it waits for --accept (or an --ids retake) instead of spending quota again.
      ? allBatches(allLines, { force, batchSize, pairSmall, hasClip: (id) => existsSync(join(OUT_DIR, `${id}.mp3`)) || existsSync(stagedClip(STAGING_DIR, id)) })
      : auditionBatches(byId);
  if (Number.isFinite(limit)) specs = specs.slice(0, limit);
  const batches = specs.map((b) => ({ ...b, model: batchModel(b.speakers) }));

  console.log(`[vo] mode=${idsArg ? 'ids' : mode} batches=${batches.length} totalLines=${batches.reduce((s, b) => s + b.lines.length, 0)} batchSize=${batchSize} delay=${(delayMs / 1000).toFixed(1)}s resplit=${resplit}`);
  if (dryRun) {
    for (const b of batches) {
      const voices = b.speakers.map((s) => castFor(s).voice).join(', ');
      console.log(`  - ${b.name}: speakers=[${b.speakers.join(', ')}] voices=[${voices}] model=${b.model} lines=${b.lines.length}`);
    }
    return;
  }

  const apiKey = resplit ? '' : loadEnvKey();
  const lastCallAt = new Map<string, number>();
  const flagged: Array<{ id: string; dur: number; expected: number; text: string }> = [];
  const held: string[] = [];
  const heldIds: string[] = [];
  const unchecked: string[] = [];
  const stt = sttSetup();
  if (!stt.transcribe) console.warn(`[vo] clips will ship UNCHECKED: ${stt.reason}`);

  const report = await runBatches(batches, async (batch, i) => {
    const wavPath = join(BATCH_DIR, `${batch.name}.wav`);
    if (!resplit) {
      const since = Date.now() - (lastCallAt.get(batch.model) ?? -Infinity);
      if (since < delayMs) await sleep(delayMs - since);
      console.log(`[vo] (${i + 1}/${batches.length}) requesting ${batch.name} (${batch.lines.length} lines) via ${batch.model}...`);
      lastCallAt.set(batch.model, Date.now());
      const pcm = await requestTts({ apiKey, model: batch.model, prompt: buildPrompt(batch), speechConfig: speechConfigFor(batch), label: batch.name });
      const seconds = pcm.length / 2 / SAMPLE_RATE;
      if (seconds > maxBatchSeconds(batch.lines.length)) {
        // Runaway output (minutes of silence, or the model trailing off). Keep it for inspection, write no clips.
        writeFileSync(`${wavPath}.rejected`, pcmToWav(pcm, SAMPLE_RATE));
        throw new Error(`runaway output: ${seconds.toFixed(0)}s for ${batch.lines.length} lines (max ${maxBatchSeconds(batch.lines.length)}s); no clips written, raw audio in ${batch.name}.wav.rejected`);
      }
      writeRecording(wavPath, pcmToWav(pcm, SAMPLE_RATE));
      console.log(`[vo] saved raw batch ${(pcm.length / 2 / SAMPLE_RATE).toFixed(2)}s -> previews/vo-batches/${batch.name}.wav`);
    } else if (!existsSync(wavPath)) {
      throw new Error(`missing batch wav ${wavPath}`);
    }

    const { samples, sampleRate } = readWavPcm(wavPath);
    const segments = findSplits(samples, sampleRate, batch.lines);
    const voices = batch.speakers.map((s) => castFor(s).voice);
    const take: StagedTake = { name: batch.name, speakers: batch.speakers, voices, model: batch.model, at: new Date().toISOString(), resplit };
    const shipped: string[] = [];
    // Every clip is encoded before any is transcribed: vo-trace.ts matches a clip to its WAV by file time.
    const clips = batch.lines.map((line, k) => {
      const seg = segments[k]!;
      const out = stagedClip(STAGING_DIR, line.id);
      let dur = encodeClip(wavPath, seg.start, seg.end, out);
      // Scene lines with pause caps (lib/voPauses.ts) keep them on every new take.
      const cap = TIGHT_LINES[line.id];
      if (cap !== undefined) dur = tightenClip(out, cap).after;
      return { line, out, dur };
    });
    for (const [k, { line, out, dur }] of clips.entries()) {
      const words = line.text.trim().split(/\s+/).length;
      const expected = Math.max(0.6, words * 0.34);
      const suspect = dur < expected * 0.45 || dur > expected * 3.0;
      if (suspect) flagged.push({ id: line.id, dur, expected, text: line.text });
      const result = gateClip({
        id: line.id,
        text: line.text,
        previous: batch.lines[k - 1]?.text,
        next: batch.lines[k + 1]?.text,
        verbal: !isNonVerbalOnly(line),
        staged: out,
        shipped: join(OUT_DIR, `${line.id}.mp3`),
        take,
        transcribe: stt.transcribe,
      });
      if (result.status === 'held') {
        heldIds.push(line.id);
        held.push(describeHeld(line.id, line.text, result.heard, result.reasons));
      } else shipped.push(line.id);
      if (result.status === 'unchecked') unchecked.push(line.id);
      console.log(`  ${result.status === 'held' ? '✗' : '✓'} ${line.id.padEnd(28)} ${dur.toFixed(2).padStart(5)}s  (${line.speaker}/${line.emote ?? 'none'})  "${line.text}"${result.status === 'held' ? '  <-- HELD' : suspect ? '  <-- CHECK' : ''}`);
    }
    // Only shipped clips are traced to this batch; an accepted one is recorded when it ships.
    if (shipped.length > 0) recordBatch({ name: batch.name, speakers: batch.speakers, voices, model: batch.model, lines: shipped }, { resplit });
    if (apply) {
      const updated = applyAudioManifest(loadChapters());
      if (updated > 0) console.log(`[vo] applied +${updated} manifest entries`);
    }
  });

  if (apply) {
    const count = applyAudioManifest(loadChapters());
    if (count > 0) console.log(`[vo] final manifest sync: +${count} entries`);
  }
  if (flagged.length > 0) {
    console.log(`\n[vo] FLAGGED FOR CHECK (${flagged.length}):`);
    for (const f of flagged) console.log(`  - ${f.id} (${f.dur.toFixed(2)}s vs ~${f.expected.toFixed(2)}s): "${f.text}"`);
  }
  if (unchecked.length > 0) console.log(`\n[vo] UNCHECKED, shipped without a word check (${unchecked.length}): ${unchecked.join(' ')}`);
  if (held.length > 0) {
    console.log(`\n[vo] HELD in ${STAGING_DIR} (${held.length}); the shipped clips are unchanged:\n${held.join('\n')}`);
    console.log(`[vo] after listening: node --experimental-strip-types scripts/vo-generate.ts --accept ${heldIds.join(',')} --apply`);
    process.exitCode = 1;
  }
  if (!printReport('vo', report)) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[vo] error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
