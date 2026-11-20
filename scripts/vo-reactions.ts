/**
 * Generates character-matched non-verbal vocal reactions (screams, gasps, grunts, choking)
 * in 3 variants per character/gender using each character's established Gemini TTS voice,
 * then wires the variant arrays into the 10 remaining non-verbal dialogue lines.
 *
 * Usage:
 *   node --experimental-strip-types scripts/vo-reactions.ts --apply
 *   node --experimental-strip-types scripts/vo-reactions.ts --resplit --apply
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIALOGUE_DIR = join(ROOT, 'src/data/dialogue');
const OUT_DIR = join(ROOT, 'public/assets/vo');
const BATCH_DIR = join(ROOT, 'previews/vo-batches');
const SAMPLE_RATE = 24000;
const MODELS = [
  'gemini-3.8-flash-lite-tts',
  'gemini-3.8-flash-tts',
  'gemini-3.1-flash-tts-preview',
  'gemini-2.5-flash-preview-tts',
];

interface ReactionTake {
  id: string;
  direction: string;
  vocalization: string;
}

interface ReactionBatch {
  name: string;
  voice: string;
  character: string;
  takes: ReactionTake[];
}

const BATCHES: ReactionBatch[] = [
  {
    name: 'react_jay_male',
    voice: 'Orus',
    character: 'Jay, 30s male security officer (grounded, steady lower-mid male voice)',
    takes: [
      { id: 'react_jay_scare_01', direction: 'sudden startled shout when grabbed from behind, raw sharp reflex', vocalization: 'Ah!' },
      { id: 'react_jay_scare_02', direction: 'startled flinch gasp at an explosion or jump scare', vocalization: 'Gah!' },
      { id: 'react_jay_scare_03', direction: 'sharp terrified intake gasp and clipped yelp', vocalization: 'Hh— ah!' },
      { id: 'react_jay_pain_01', direction: 'tight pained effort grunt while shoving a monster off', vocalization: 'Hngh!' },
      { id: 'react_jay_pain_02', direction: 'strained struggling grunt of pain', vocalization: 'Nngh— agh!' },
      { id: 'react_jay_pain_03', direction: 'low winded grunt taking a sudden hit', vocalization: 'Ughh!' },
    ],
  },
  {
    name: 'react_giles_male',
    voice: 'Algenib',
    character: 'August Giles, 42 male engineer (weathered, gravelly male voice)',
    takes: [
      { id: 'react_giles_cry_01', direction: 'raw strangled cry of sudden pain and horror, cut short', vocalization: 'Aaaagh!' },
      { id: 'react_giles_cry_02', direction: 'choked guttural agonized cry in a gravelly voice', vocalization: 'Ghh— aaaagh!' },
      { id: 'react_giles_cry_03', direction: 'desperate strained yell of sharp pain', vocalization: 'Nngh— aaah!' },
    ],
  },
  {
    name: 'react_priya_female',
    voice: 'Sulafat',
    character: 'Priya Anand, 29 female medical nurse (warm female voice, now utterly terrified in a horror scene)',
    takes: [
      { id: 'react_priya_scream_01', direction: 'raw terrified horror scream as she is grabbed in the dark', vocalization: 'Aaaahhh!' },
      { id: 'react_priya_scream_02', direction: 'panicked desperate two-part shriek of terror', vocalization: 'Aaaah! Aaaaahhh!' },
      { id: 'react_priya_scream_03', direction: 'agonized prolonged horror scream fading out', vocalization: 'Aaaaaaahhh!' },
      { id: 'react_priya_choke_01', direction: 'choking and gasping desperately for air', vocalization: 'Kh— khh— agh!' },
      { id: 'react_priya_choke_02', direction: 'air-starved strangled choking and gagging breaths', vocalization: 'Ghk— hh— khh!' },
      { id: 'react_priya_choke_03', direction: 'weak ragged choked wheeze struggling to breathe', vocalization: 'Hkh— ghh— hh!' },
    ],
  },
  {
    name: 'react_voss_female',
    voice: 'Leda',
    character: 'Dr. Lena Voss, 34 female microbiologist (sharp female voice, terrified and transforming behind lab glass)',
    takes: [
      { id: 'react_voss_scream_01', direction: 'piercing raw horror scream of agony and terror', vocalization: 'Aaaaaahhh!' },
      { id: 'react_voss_scream_02', direction: 'ragged agonized horror shriek breaking in the throat', vocalization: 'Aaaagh— aaaaahhh!' },
      { id: 'react_voss_scream_03', direction: 'frantic terrified scream over station comms', vocalization: 'Aaaahhh! Aah!' },
    ],
  },
  {
    // Her panic as the thing crawls up her arm (infection-kills spec, the scratch beat: sound `voss_panic_breath`). Its own batch so
    // `--only react_voss_panic` never regenerates her credited OpenGameArt screams above.
    name: 'react_voss_panic',
    voice: 'Leda',
    character: 'Dr. Lena Voss, 34 female microbiologist (sharp female voice, something is moving under the skin of her arm)',
    takes: [
      { id: 'react_voss_panic_01', direction: 'fast shallow terrified panting, breath catching, close to the mic', vocalization: 'Hh— hh— hh— hhh—' },
      { id: 'react_voss_panic_02', direction: 'choked whimpering sobs of disgust and fear, trying not to scream', vocalization: 'Nn— nnh— oh god— nnh—' },
      { id: 'react_voss_panic_03', direction: 'ragged hyperventilating gasps turning into a whimper', vocalization: 'Hah— hah— hahh— nnnh—' },
    ],
  },
];

/** Maps each non-verbal dialogue line to its 3-variant character-matched reaction pool. */
const LINE_POOLS: Record<string, string[]> = {
  bark_grab_jay_01: ['assets/vo/react_jay_scare_01.mp3', 'assets/vo/react_jay_scare_02.mp3', 'assets/vo/react_jay_scare_03.mp3'],
  bark_grab_jay_02: ['assets/vo/react_jay_pain_01.mp3', 'assets/vo/react_jay_pain_02.mp3', 'assets/vo/react_jay_pain_03.mp3'],
  bark_scare_jay_01: ['assets/vo/react_jay_scare_01.mp3', 'assets/vo/react_jay_scare_02.mp3', 'assets/vo/react_jay_scare_03.mp3'],
  bark_scare_jay_02: ['assets/vo/react_jay_scare_03.mp3', 'assets/vo/react_jay_scare_02.mp3', 'assets/vo/react_jay_scare_01.mp3'],
  sec_giles_05: ['assets/vo/react_giles_cry_01.mp3', 'assets/vo/react_giles_cry_02.mp3', 'assets/vo/react_giles_cry_03.mp3'],
  sec_priya_02: ['assets/vo/react_priya_scream_01.mp3', 'assets/vo/react_priya_scream_02.mp3', 'assets/vo/react_priya_scream_03.mp3'],
  stinger_priya_03: ['assets/vo/react_priya_scream_02.mp3', 'assets/vo/react_priya_scream_03.mp3', 'assets/vo/react_priya_scream_01.mp3'],
  sec_priya_03: ['assets/vo/react_priya_choke_01.mp3', 'assets/vo/react_priya_choke_02.mp3'],
  crew_lab_scream_01: ['assets/vo/react_voss_scream_01.mp3', 'assets/vo/react_voss_scream_02.mp3', 'assets/vo/react_voss_scream_03.mp3'],
  drop_voss_02: ['assets/vo/react_voss_scream_02.mp3', 'assets/vo/react_voss_scream_03.mp3', 'assets/vo/react_voss_scream_01.mp3'],
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

function pcmToWav(pcm: Buffer, sampleRate = SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
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

function findReactionSplits(samples: Float32Array, sr: number, count: number): Array<{ start: number; end: number }> {
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

  const activeThr = Math.max(peak * 0.025, 0.004);
  let firstActive = 0;
  let lastActive = frames - 1;
  while (firstActive < frames - 1 && rms[firstActive]! < activeThr) firstActive++;
  while (lastActive > firstActive && rms[lastActive]! < activeThr) lastActive--;
  const activeStart = Math.max(0, (firstActive * hop) / sr);
  const activeEnd = Math.min(totalDur, (lastActive * hop + win) / sr);

  if (count === 1) return [{ start: Math.max(0, activeStart - 0.02), end: Math.min(totalDur, activeEnd + 0.06) }];

  interface Gap { start: number; end: number; mid: number; dur: number }
  const collect = (thrRatio: number, minGap: number): Gap[] => {
    const thr = Math.max(peak * thrRatio, 0.003);
    const out: Gap[] = [];
    let inGap = false;
    let g0 = 0;
    for (let f = firstActive; f <= lastActive; f++) {
      const q = rms[f]! < thr;
      if (q && !inGap) { inGap = true; g0 = f; }
      else if (!q && inGap) {
        inGap = false;
        const s = (g0 * hop) / sr;
        const e = (f * hop) / sr;
        if (e - s >= minGap && s > activeStart + 0.08 && e < activeEnd - 0.08) {
          out.push({ start: s, end: e, mid: (s + e) / 2, dur: e - s });
        }
      }
    }
    return out;
  };

  let gaps = collect(0.035, 0.45);
  if (gaps.length < count - 1) gaps = collect(0.05, 0.28);
  if (gaps.length < count - 1) gaps = collect(0.08, 0.16);
  if (gaps.length < count - 1) throw new Error(`Only found ${gaps.length} silence gaps for ${count} reactions`);

  // Pick the `count - 1` longest silence gaps, sorted chronologically.
  const chosen = [...gaps].sort((a, b) => b.dur - a.dur).slice(0, count - 1).sort((a, b) => a.mid - b.mid);
  const pts = [activeStart, ...chosen.map((g) => g.mid), activeEnd];

  const segments: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < count; i++) {
    const rawS = pts[i]!;
    const rawE = pts[i + 1]!;
    let a = Math.max(0, Math.floor((rawS * sr) / hop));
    let b = Math.min(frames - 1, Math.ceil((rawE * sr) / hop));
    while (a < b && rms[a]! < activeThr) a++;
    while (b > a && rms[b]! < activeThr) b--;
    const start = Math.max(rawS, (a * hop) / sr - 0.02);
    const end = Math.min(rawE, (b * hop + win) / sr + 0.07);
    segments.push({ start, end: Math.max(start + 0.12, end) });
  }
  return segments;
}

function encodeClip(wavPath: string, start: number, end: number, outMp3: string): number {
  const dur = Math.max(0.12, end - start);
  const fadeOut = Math.max(0, dur - 0.03);
  execFileSync(
    'ffmpeg',
    [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-ss', start.toFixed(4), '-t', dur.toFixed(4),
      '-i', wavPath,
      '-af', `highpass=f=75,afade=t=in:st=0:d=0.01,afade=t=out:st=${fadeOut.toFixed(4)}:d=0.03,loudnorm=I=-16:TP=-1.5:LRA=11`,
      '-ac', '1', '-ar', '24000', '-b:a', '64k', outMp3,
    ],
    { stdio: 'inherit' },
  );
  return dur;
}

function buildPrompt(batch: ReactionBatch): string {
  const guide = batch.takes.map((t, i) => `${i + 1}. ${t.direction}`).join('\n');
  const script = batch.takes.map((t) => t.vocalization).join('\n\n');
  return [
    '# AUDIO PROFILE',
    `- ${batch.character}`,
    '',
    '## THE SCENE',
    'Sci-fi survival horror game recording session (Alien: Isolation / Dead Space feel). Performing pure raw human non-verbal vocal reactions (screams, gasps, grunts, choking).',
    '',
    "### DIRECTOR'S NOTES",
    '- Perform ONLY the raw non-verbal human sounds below — NEVER speak English words, numbers, or descriptions aloud.',
    '- Sound genuinely human, visceral, and cinematic — not cartoonish or robotic.',
    '- Emotional direction for each separate take:',
    guide,
    '- IMPORTANT: Leave a completely silent 2.5-second pause between each separate reaction take so each one can be cut cleanly.',
    '',
    '### TRANSCRIPT',
    script,
  ].join('\n');
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function requestBatch(apiKey: string, batch: ReactionBatch): Promise<{ pcm: Buffer; model: string }> {
  const prompt = buildPrompt(batch);
  for (const model of MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: batch.voice } } },
          },
        }),
      });
      if (res.ok) {
        const json = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }>;
        };
        const b64 = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
        if (b64) return { pcm: Buffer.from(b64, 'base64'), model };
        console.warn(`[react] empty audio from ${model}, retrying...`);
        await sleep(5_000);
        continue;
      }
      const errText = await res.text();
      if (res.status === 429 && /PerMinute|RPM|TPM/i.test(errText) && !/PerDay|RPD|limit:\s*(0|10)\b/i.test(errText) && attempt < 2) {
        console.warn(`[react] RPM 429 on ${model}, waiting 24s...`);
        await sleep(24_000);
        continue;
      }
      console.warn(`[react] ${model} failed (${res.status}), trying next model...`);
      break;
    }
  }
  throw new Error(`All models failed for ${batch.name}`);
}

function applyPools(): number {
  const files = readdirSync(DIALOGUE_DIR).filter((f) => f.endsWith('.json') && f !== 'speakers.json' && f !== 'ui.json');
  let updated = 0;
  for (const f of files) {
    const p = join(DIALOGUE_DIR, f);
    let raw = readFileSync(p, 'utf8');
    let changed = false;
    for (const [lineId, pool] of Object.entries(LINE_POOLS)) {
      const existing = pool.filter((u) => existsSync(join(ROOT, 'public', u)));
      if (existing.length === 0) continue;
      const escapedId = lineId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`("id":\\s*"${escapedId}"[\\s\\S]*?"audio":\\s*)(null|"[^"]*"|\\[[^\\]]*\\])`);
      const replacement = JSON.stringify(existing);
      if (re.test(raw)) {
        const next = raw.replace(re, `$1${replacement}`);
        if (next !== raw) {
          raw = next;
          changed = true;
          updated++;
        }
      }
    }
    if (changed) writeFileSync(p, raw, 'utf8');
  }
  return updated;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const resplit = args.includes('--resplit');
  const apply = args.includes('--apply');
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx >= 0 ? new Set(args[onlyIdx + 1]!.split(',')) : null;

  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(BATCH_DIR, { recursive: true });
  const apiKey = resplit ? '' : loadEnvKey();
  const batches = only ? BATCHES.filter((b) => only.has(b.name)) : BATCHES;

  let calls = 0;
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!;
    const wavPath = join(BATCH_DIR, `${batch.name}.wav`);
    if (!resplit) {
      if (calls > 0) await sleep(21_000);
      console.log(`[react] (${i + 1}/${batches.length}) generating ${batch.name} (${batch.takes.length} takes, voice=${batch.voice})...`);
      const { pcm, model } = await requestBatch(apiKey, batch);
      writeFileSync(wavPath, pcmToWav(pcm, SAMPLE_RATE));
      calls++;
      console.log(`[react] saved ${(pcm.length / 2 / SAMPLE_RATE).toFixed(2)}s via ${model}`);
    }
    const { samples, sampleRate } = readWavPcm(wavPath);
    const segs = findReactionSplits(samples, sampleRate, batch.takes.length);
    for (let k = 0; k < batch.takes.length; k++) {
      const take = batch.takes[k]!;
      const seg = segs[k]!;
      const outMp3 = join(OUT_DIR, `${take.id}.mp3`);
      const dur = encodeClip(wavPath, seg.start, seg.end, outMp3);
      console.log(`  ✓ ${take.id.padEnd(24)} ${dur.toFixed(2).padStart(5)}s  "${take.vocalization}" (${take.direction})`);
    }
  }

  if (apply) {
    const n = applyPools();
    console.log(`[react] updated ${n} dialogue lines with 3-variant reaction pools`);
  }
}

main().catch((err) => {
  console.error('[react] error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
