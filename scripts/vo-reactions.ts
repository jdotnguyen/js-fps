/**
 * Generates character-matched non-verbal vocal reactions (gasps, grunts, cries, choking, panting) in 3 variants
 * per batch, using each speaker's voice and pinned model from `scripts/lib/voCast.ts`, then wires the variant
 * arrays into the non-verbal dialogue lines. Batches live in `scripts/lib/voReactionBatches.ts`.
 *
 * There is no model fallback and no `--models` flag. Every generated batch is appended to `scripts/vo-takes.json`.
 *
 * Usage:
 *   node --experimental-strip-types scripts/vo-reactions.ts --apply
 *   node --experimental-strip-types scripts/vo-reactions.ts --only <batch> --apply
 *   node --experimental-strip-types scripts/vo-reactions.ts --only <batch> --per-take --apply   (one request per take)
 *   node --experimental-strip-types scripts/vo-reactions.ts --resplit --apply
 *
 * Screams, cries (including Giles's) and Jay's startled shouts are not TTS: they are credited OpenGameArt recordings (CREDITS.md), have no
 * batch here, and are only referenced by LINE_POOLS.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { castFor } from './lib/voCast.ts';
import { REACTION_BATCHES, reactionVoice, type ReactionBatch } from './lib/voReactionBatches.ts';
import { recordBatch } from './lib/voTakes.ts';
import { printReport, requestTts, runBatches } from './lib/voTts.ts';
const ROOT = resolve(import.meta.dirname, '..');
const DIALOGUE_DIR = join(ROOT, 'src/data/dialogue');
const OUT_DIR = join(ROOT, 'public/assets/vo');
const BATCH_DIR = join(ROOT, 'previews/vo-batches');
const SAMPLE_RATE = 24000;

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
    ...(castFor(batch.speaker).accent ? [`- Accent: ${castFor(batch.speaker).accent}.`] : []),
    '',
    '## THE SCENE',
    'Sci-fi survival horror game recording session (Alien: Isolation / Dead Space feel). Performing pure raw human non-verbal vocal reactions (screams, gasps, grunts, choking).',
    '',
    "### DIRECTOR'S NOTES",
    '- Perform ONLY the raw non-verbal human sounds below — NEVER speak English words, numbers, or descriptions aloud.',
    '- Sound genuinely human, visceral, and cinematic — not cartoonish or robotic.',
    '- Emotional direction for each separate take:',
    guide,
    batch.takes.length > 1
      ? '- IMPORTANT: Leave a completely silent 2.5-second pause between each separate reaction take so each one can be cut cleanly.'
      : '- Perform this one reaction once, then stop. No repeats, no extra breaths or words.',
    '',
    '### TRANSCRIPT',
    script,
  ].join('\n');
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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--models') || args.includes('--model')) {
    throw new Error('--models was removed: reactions use their speaker\'s pinned model from scripts/lib/voCast.ts.');
  }
  const resplit = args.includes('--resplit');
  const apply = args.includes('--apply');
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx >= 0 ? new Set(args[onlyIdx + 1]!.split(',')) : null;

  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(BATCH_DIR, { recursive: true });
  // --per-take sends one take per request, so nothing has to be cut apart. 3.1 tends to break a 3-take
  // reaction batch into many short bursts that the splitter cannot group back into takes (2026-11-21).
  // With --per-take, --only may also name single take ids, so one bad take can be redone on its own.
  const perTake = args.includes('--per-take');
  const isTake = (n: string): boolean => REACTION_BATCHES.some((b) => b.takes.some((t) => t.id === n));
  if (only) {
    const unknown = [...only].filter((n) => !REACTION_BATCHES.some((b) => b.name === n) && !(perTake && isTake(n)));
    if (unknown.length > 0) throw new Error(`Unknown reaction batch(es): ${unknown.join(', ')}${perTake ? '' : ' (take ids need --per-take)'}`);
  }
  const units = perTake
    ? REACTION_BATCHES.flatMap((b) => b.takes.map((t) => ({ ...b, name: t.id, takes: [t] }))).filter((u) => !only || only.has(u.name) || REACTION_BATCHES.some((b) => only.has(b.name) && b.speaker === u.speaker && b.takes.some((t) => t.id === u.name)))
    : REACTION_BATCHES.filter((b) => !only || only.has(b.name));
  const batches = units.map((b) => ({ ...b, speakers: [b.speaker], ...reactionVoice(b) }));
  if (args.includes('--dry-run')) {
    for (const b of batches) console.log(`  - ${b.name}: speaker=${b.speaker} voice=${b.voice} model=${b.model} takes=${b.takes.map((t) => t.id).join(', ')}`);
    return;
  }

  const apiKey = resplit ? '' : loadEnvKey();
  let calls = 0;
  const report = await runBatches(batches, async (batch, i) => {
    const wavPath = join(BATCH_DIR, `${batch.name}.wav`);
    if (!resplit) {
      if (calls > 0) await sleep(21_000);
      calls++;
      console.log(`[react] (${i + 1}/${batches.length}) generating ${batch.name} (${batch.takes.length} takes, voice=${batch.voice}) via ${batch.model}...`);
      const pcm = await requestTts({
        apiKey,
        model: batch.model,
        prompt: buildPrompt(batch),
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: batch.voice } } },
        label: batch.name,
        maxAttempts: 2,
      });
      writeFileSync(wavPath, pcmToWav(pcm, SAMPLE_RATE));
      console.log(`[react] saved ${(pcm.length / 2 / SAMPLE_RATE).toFixed(2)}s via ${batch.model}`);
    } else if (!existsSync(wavPath)) {
      throw new Error(`missing batch wav ${wavPath}`);
    }
    const { samples, sampleRate } = readWavPcm(wavPath);
    const segs = findReactionSplits(samples, sampleRate, batch.takes.length);
    for (let k = 0; k < batch.takes.length; k++) {
      const take = batch.takes[k]!;
      const seg = segs[k]!;
      const dur = encodeClip(wavPath, seg.start, seg.end, join(OUT_DIR, `${take.id}.mp3`));
      console.log(`  ✓ ${take.id.padEnd(24)} ${dur.toFixed(2).padStart(5)}s  "${take.vocalization}" (${take.direction})`);
    }
    recordBatch(
      { name: batch.name, speakers: [batch.speaker], voices: [batch.voice], model: batch.model, lines: batch.takes.map((t) => t.id) },
      { resplit },
    );
  });

  if (apply) {
    const n = applyPools();
    console.log(`[react] updated ${n} dialogue lines with reaction pools`);
  }
  if (!printReport('react', report)) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[react] error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
