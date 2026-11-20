/**
 * Batched Gemini 2.5 Flash TTS generator + PCM silence-valley splitter (casting rules: docs/voice-casting-standard.md).
 *
 * Generates acted voice-over clips for dialogue lines in `src/data/dialogue/*.json`,
 * saves raw batch WAVs to `previews/vo-batches/` (gitignored, so re-splitting costs 0 API calls),
 * encodes normalized mono MP3s to `public/assets/vo/<id>.mp3`, and optionally patches
 * `"audio": "assets/vo/<id>.mp3"` into the dialogue chapter JSONs.
 *
 * Usage:
 *   npm run vo:generate -- --mode audition --apply
 *   npm run vo:generate -- --mode all --apply
 *   npm run vo:generate -- --resplit audition --apply   (0 API calls: re-splits saved WAVs)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { DialogueChapter, DialogueLine, Emote } from '../src/data/types/dialogue.ts';

const ROOT = resolve(import.meta.dirname, '..');
const DIALOGUE_DIR = join(ROOT, 'src/data/dialogue');
const OUT_DIR = join(ROOT, 'public/assets/vo');
const BATCH_DIR = join(ROOT, 'previews/vo-batches');
const DEFAULT_MODELS = [
  'gemini-2.5-pro-preview-tts',
  'gemini-3.1-flash-tts-preview',
  'gemini-3.8-flash-tts',
  'gemini-3.8-flash-lite-tts',
  'gemini-2.5-flash-preview-tts',
];
const SAMPLE_RATE = 24000;
const DEFAULT_DELAY_MS = 21_000;
const DEFAULT_BATCH_SIZE = 14;

interface CastMember {
  label: string;
  voice: string;
  profile: string;
}

/** Casting matched to docs/characters.md and src/data/dialogue/speakers.json. */
const CAST: Record<string, CastMember> = {
  engineer: {
    label: 'Giles',
    voice: 'Algenib',
    profile: 'August Giles, 42, weathered deep-sea systems engineer, blue-collar, gravelly warmth, wry dry humour hiding exhaustion and nerves.',
  },
  medic: {
    label: 'Okafor',
    voice: 'Charon',
    profile: 'Dr. Tomas Okafor, 50s, deep warm calm trauma surgeon; disciplined, measured authority; voice drops quiet when genuinely afraid.',
  },
  player: {
    label: 'Jay',
    voice: 'Orus',
    profile: 'Jay, 30s, steady grounded station security officer; kind, attentive, conversational lower-mid male voice.',
  },
  nurse: {
    label: 'Priya',
    voice: 'Sulafat',
    profile: 'Priya Anand, 29, warm cheerful sharp medical nurse; friendly, competent, affectionate teasing with coworkers.',
  },
  chief: {
    label: 'Heins',
    voice: 'Kore',
    profile: 'Katie Heins, 38, no-nonsense security chief; crisp, brisk, firm, slightly annoyed by corporate secrecy.',
  },
  director: {
    label: 'Hale',
    voice: 'Rasalgethi',
    profile: 'Director Hale, 48, smooth polished corporate station administrator; calm and rehearsed on intercom, clipped and nervous under stress.',
  },
  pa: {
    label: 'StationPA',
    voice: 'Gacrux',
    profile: 'TAG Industries automated station PA voice; smooth, mature, calm, overly polite, detached retro-corporate announcement.',
  },
  crew_ruiz: {
    label: 'Ruiz',
    voice: 'Aoede',
    profile: 'Ines Ruiz, 30s, relaxed breezy comms technician; friendly morning banter.',
  },
  crew_cook: {
    label: 'Bram',
    voice: 'Enceladus',
    profile: 'Bram, 45, dry deadpan station cook; raspy, tired, wry humour.',
  },
  crew_sung: {
    label: 'Sung',
    voice: 'Achird',
    profile: 'Sung, 30, friendly station diver just returning from shore leave; warm, easygoing.',
  },
  crew_lab: {
    label: 'Voss',
    voice: 'Leda',
    profile: 'Dr. Lena Voss, 34, sharp anxious microbiologist; terrified and pleading when infected.',
  },
  crew_botanist: {
    label: 'Botanist',
    voice: 'Puck',
    profile: 'Station hydroponics botanist; conversational, dryly amused, slightly exasperated.',
  },
  crew_assistant: {
    label: 'Assistant',
    voice: 'Despina',
    profile: 'Director Hale administrative assistant; quiet, tense, anxious around corporate secrets.',
  },
  crew_mess: {
    label: 'Crew',
    voice: 'Fenrir',
    profile: 'Casual off-shift station crew member in the mess hall; wry morning greeting.',
  },
  crew_maint: {
    label: 'Maint',
    voice: 'Iapetus',
    profile: 'Tired maintenance tech in the dive bay; practical, low-key warning.',
  },
  crew_dock_guard: {
    label: 'Guard',
    voice: 'Alnilam',
    profile: '40s, dock security guard who has scanned the same crew every morning for years; patient, dry, warm under the routine.',
  },
};

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

/** Pure non-verbal reactions work better as real/procedural SFX than TTS. */
function isNonVerbalOnly(line: DialogueLine): boolean {
  const t = line.text.trim();
  if (/^\[.*\]$/.test(t)) return true;
  if (/^(ah|agh|hngh|hh|ugh|oof|hm+)[!.\-?]*$/i.test(t)) return true;
  return false;
}

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

interface BatchSpec {
  name: string;
  speakers: string[];
  lines: DialogueLine[];
  sceneNote: string;
}

function buildPrompt(batch: BatchSpec): string {
  const isMulti = batch.speakers.length > 1;
  const profiles = batch.speakers
    .map((sp) => {
      const c = CAST[sp] ?? { label: sp, voice: 'Charon', profile: 'Deep-sea station crew member.' };
      return `- ${c.label}: ${c.profile}`;
    })
    .join('\n');

  const lineGuide = batch.lines
    .map((l, i) => {
      const c = CAST[l.speaker] ?? { label: l.speaker, voice: 'Charon', profile: '' };
      const mood = EMOTE_HINT[l.emote ?? 'neutral'];
      return `${i + 1}. ${c.label} (${mood})`;
    })
    .join('\n');

  const cleanForTts = (t: string): string => t.replace(/-$/g, '—');

  const transcript = batch.lines
    .map((l) => {
      const c = CAST[l.speaker] ?? { label: l.speaker, voice: 'Charon', profile: '' };
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

class QuotaExhaustedError extends Error {
  readonly model: string;
  constructor(model: string, detail: string) {
    super(`Daily/model quota exhausted on ${model}: ${detail}`);
    this.model = model;
  }
}

async function synthesizeBatch(apiKey: string, model: string, batch: BatchSpec): Promise<Buffer> {
  const prompt = buildPrompt(batch);
  const speechConfig =
    batch.speakers.length > 1
      ? {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: batch.speakers.map((sp) => {
              const c = CAST[sp]!;
              return { speaker: c.label, voiceConfig: { prebuiltVoiceConfig: { voiceName: c.voice } } };
            }),
          },
        }
      : {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: (CAST[batch.speakers[0]!] ?? CAST.medic)!.voice },
          },
        };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig,
        },
      }),
    });

    if (res.ok) {
      const json = (await res.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> };
          finishReason?: string;
        }>;
      };
      const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      if (part?.inlineData?.data) return Buffer.from(part.inlineData.data, 'base64');
      if (attempt < maxAttempts) {
        console.warn(`[vo] empty audio on ${model} (finishReason=${json.candidates?.[0]?.finishReason ?? 'unknown'}), retrying (${attempt}/${maxAttempts})...`);
        await sleep(5_000 * attempt);
        continue;
      }
      throw new Error(`${model} returned no audio (finishReason=${json.candidates?.[0]?.finishReason ?? 'unknown'})`);
    }

    const errText = await res.text();
    if (res.status === 429) {
      const isPerMinute = /PerMinute|RPM|TPM/i.test(errText) && !/PerDay|RPD|limit:\s*0\b/i.test(errText);
      const isDaily = /PerDay|RPD|limit:\s*(0|10)\b/i.test(errText);
      if (isDaily && !isPerMinute) {
        throw new QuotaExhaustedError(model, errText.slice(0, 260));
      }
      if (attempt < maxAttempts) {
        const waitMs = 24_000 * attempt;
        console.warn(`[vo] RPM 429 on ${model} (${batch.name}), waiting ${(waitMs / 1000).toFixed(0)}s (attempt ${attempt}/${maxAttempts})...`);
        await sleep(waitMs);
        continue;
      }
      throw new QuotaExhaustedError(model, errText.slice(0, 260));
    }
    if (res.status >= 500 && attempt < maxAttempts) {
      const waitMs = 6_000 * attempt;
      console.warn(`[vo] HTTP ${res.status} on ${model} (${batch.name}), retrying in ${(waitMs / 1000).toFixed(0)}s...`);
      await sleep(waitMs);
      continue;
    }
    throw new Error(`${model} HTTP ${res.status}: ${errText.slice(0, 400)}`);
  }
  throw new Error(`Failed on ${model} after ${maxAttempts} attempts`);
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

function allBatches(allLines: DialogueLine[], force: boolean, batchSize: number, pairSmall: boolean): BatchSpec[] {
  const pending = allLines.filter((l) => {
    if (isNonVerbalOnly(l)) return false;
    const outFile = join(OUT_DIR, `${l.id}.mp3`);
    return force || !existsSync(outFile);
  });

  const bySpeaker = new Map<string, DialogueLine[]>();
  for (const l of pending) {
    const list = bySpeaker.get(l.speaker) ?? [];
    list.push(l);
    bySpeaker.set(l.speaker, list);
  }

  const batches: BatchSpec[] = [];
  const small: Array<[string, DialogueLine[]]> = [];

  for (const [sp, list] of bySpeaker) {
    if (pairSmall && list.length <= Math.floor(batchSize / 2)) {
      small.push([sp, list]);
      continue;
    }
    const numChunks = Math.max(1, Math.ceil(list.length / batchSize), Math.ceil(list.reduce((s, l) => s + l.text.length, 0) / 800));
    const perChunk = Math.ceil(list.length / numChunks);
    for (let idx = 0; idx < numChunks; idx++) {
      const chunk = list.slice(idx * perChunk, (idx + 1) * perChunk);
      if (chunk.length === 0) continue;
      batches.push({
        name: `vo_${sp}_${String(idx + 1).padStart(2, '0')}`,
        speakers: [sp],
        lines: chunk,
        sceneNote: `Thalassa Deep Research Station, 3000m underwater. Isolated character takes for ${CAST[sp]?.label ?? sp}.`,
      });
    }
  }

  // Pair small speakers into 2-speaker batches so we conserve daily model quota.
  small.sort((a, b) => b[1].length - a[1].length);
  for (let i = 0; i < small.length; i += 2) {
    const a = small[i]!;
    const b = small[i + 1];
    if (b) {
      batches.push({
        name: `vo_${a[0]}_${b[0]}`,
        speakers: [a[0], b[0]],
        lines: [...a[1], ...b[1]],
        sceneNote: 'Thalassa Deep Research Station, 3000m underwater. Isolated character takes for two crew members.',
      });
    } else {
      batches.push({
        name: `vo_${a[0]}_01`,
        speakers: [a[0]],
        lines: a[1],
        sceneNote: `Thalassa Deep Research Station, 3000m underwater. Isolated character takes for ${CAST[a[0]]?.label ?? a[0]}.`,
      });
    }
  }

  return batches;
}

function idsBatches(byId: Map<string, DialogueLine>, ids: string[], batchSize: number): BatchSpec[] {
  const bySpeaker = new Map<string, DialogueLine[]>();
  for (const id of ids) {
    const l = byId.get(id);
    if (!l) throw new Error(`Unknown line id "${id}"`);
    const list = bySpeaker.get(l.speaker) ?? [];
    list.push(l);
    bySpeaker.set(l.speaker, list);
  }
  const batches: BatchSpec[] = [];
  for (const [sp, list] of bySpeaker) {
    const numChunks = Math.max(1, Math.ceil(list.length / batchSize));
    const perChunk = Math.ceil(list.length / numChunks);
    for (let idx = 0; idx < numChunks; idx++) {
      const chunk = list.slice(idx * perChunk, (idx + 1) * perChunk);
      if (chunk.length === 0) continue;
      batches.push({
        name: `retake_${sp}_${String(idx + 1).padStart(2, '0')}`,
        speakers: [sp],
        lines: chunk,
        sceneNote: `Thalassa Deep Research Station, 3000m underwater. Isolated retake lines for ${CAST[sp]?.label ?? sp}. Leave a VERY LONG, completely silent 3-second pause between each line and do not sigh or breathe during the pause.`,
      });
    }
  }
  return batches;
}

function applyAudioManifest(chapters: ChapterFile[]): number {
  let updated = 0;
  for (const ch of chapters) {
    let changed = false;
    const raw = readFileSync(ch.path, 'utf8');
    let next = raw;
    for (const line of ch.data.lines) {
      if (Array.isArray(line.audio)) continue;
      const mp3 = join(OUT_DIR, `${line.id}.mp3`);
      const target = existsSync(mp3) ? `assets/vo/${line.id}.mp3` : null;
      if (line.audio === target) continue;
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
  const mode = flagVal('--mode') ?? 'audition';
  const idsArg = flagVal('--ids');
  const modelsArg = flagVal('--models') ?? flagVal('--model');
  const models = modelsArg
    ? modelsArg.split(',').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_MODELS;
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

  const chapters = loadChapters();
  const allLines = chapters.flatMap((c) => c.data.lines);
  const byId = new Map(allLines.map((l) => [l.id, l]));

  let batches = idsArg
    ? idsBatches(byId, idsArg.split(',').map((s) => s.trim()).filter(Boolean), batchSize)
    : mode === 'all'
      ? allBatches(allLines, force, batchSize, pairSmall)
      : auditionBatches(byId);
  if (Number.isFinite(limit)) batches = batches.slice(0, limit);

  console.log(`[vo] mode=${idsArg ? 'ids' : mode} batches=${batches.length} totalLines=${batches.reduce((s, b) => s + b.lines.length, 0)} batchSize=${batchSize} delay=${(delayMs / 1000).toFixed(1)}s models=[${models.join(' -> ')}] resplit=${resplit}`);
  if (dryRun) {
    for (const b of batches) {
      console.log(`  - ${b.name}: speakers=[${b.speakers.join(', ')}] lines=${b.lines.length}`);
    }
    return;
  }

  const apiKey = resplit ? '' : loadEnvKey();
  let modelIdx = 0;
  let lastCallModel = '';
  const flagged: Array<{ id: string; dur: number; expected: number; text: string }> = [];
  const failedBatches: Array<{ name: string; error: string }> = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!;
    const wavPath = join(BATCH_DIR, `${batch.name}.wav`);

    try {
      if (!resplit) {
        let pcm: Buffer | null = null;
        while (modelIdx < models.length && !pcm) {
          const model = models[modelIdx]!;
          if (lastCallModel === model && delayMs > 0) {
            await sleep(delayMs);
          }
          console.log(`[vo] (${i + 1}/${batches.length}) requesting ${batch.name} (${batch.lines.length} lines) via ${model}...`);
          try {
            pcm = await synthesizeBatch(apiKey, model, batch);
            lastCallModel = model;
          } catch (err) {
            if (err instanceof QuotaExhaustedError) {
              console.warn(`[vo] ${model} quota exhausted; switching to next model...`);
              modelIdx++;
              lastCallModel = '';
              continue;
            }
            // If a newer preview model rejects a request format, fall through cleanly too.
            const msg = err instanceof Error ? err.message : String(err);
            if (/HTTP (400|403|404)/.test(msg) && modelIdx + 1 < models.length) {
              console.warn(`[vo] ${model} rejected request (${msg.slice(0, 140)}); switching to next model...`);
              modelIdx++;
              lastCallModel = '';
              continue;
            }
            throw err;
          }
        }
        if (!pcm) throw new Error('All configured TTS models exhausted their quotas');
        writeFileSync(wavPath, pcmToWav(pcm, SAMPLE_RATE));
        console.log(`[vo] saved raw batch ${(pcm.length / 2 / SAMPLE_RATE).toFixed(2)}s -> previews/vo-batches/${batch.name}.wav`);
      } else if (!existsSync(wavPath)) {
        console.warn(`[vo] skipping missing batch wav: ${wavPath}`);
        continue;
      }

      const { samples, sampleRate } = readWavPcm(wavPath);
      const segments = findSplits(samples, sampleRate, batch.lines);
      for (let k = 0; k < batch.lines.length; k++) {
        const line = batch.lines[k]!;
        const seg = segments[k]!;
        const outMp3 = join(OUT_DIR, `${line.id}.mp3`);
        const dur = encodeClip(wavPath, seg.start, seg.end, outMp3);
        const words = line.text.trim().split(/\s+/).length;
        const expected = Math.max(0.6, words * 0.34);
        const suspect = dur < expected * 0.45 || dur > expected * 3.0;
        if (suspect) flagged.push({ id: line.id, dur, expected, text: line.text });
        console.log(`  ✓ ${line.id.padEnd(28)} ${dur.toFixed(2).padStart(5)}s  (${line.speaker}/${line.emote ?? 'none'})  "${line.text}"${suspect ? '  <-- CHECK' : ''}`);
      }
      if (apply) {
        const updated = applyAudioManifest(loadChapters());
        if (updated > 0) console.log(`[vo] applied +${updated} manifest entries`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[vo] batch ${batch.name} failed: ${msg}`);
      failedBatches.push({ name: batch.name, error: msg });
    }
  }

  if (apply) {
    const count = applyAudioManifest(loadChapters());
    if (count > 0) console.log(`[vo] final manifest sync: +${count} entries`);
  }
  if (flagged.length > 0) {
    console.log(`\n[vo] FLAGGED FOR CHECK (${flagged.length}):`);
    for (const f of flagged) console.log(`  - ${f.id} (${f.dur.toFixed(2)}s vs ~${f.expected.toFixed(2)}s): "${f.text}"`);
  }
  if (failedBatches.length > 0) {
    console.log(`\n[vo] FAILED BATCHES (${failedBatches.length}):`);
    for (const f of failedBatches) console.log(`  - ${f.name}: ${f.error}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[vo] error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
