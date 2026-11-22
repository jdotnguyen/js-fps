/**
 * Read-only: reports which Gemini TTS model made each shipped VO clip, from the raw batch WAVs in
 * `previews/vo-batches/` and the clips' file times (method: scripts/lib/voTrace.ts). Lists every clip that is
 * not on its speaker's pinned model (scripts/lib/voCast.ts) and every clip it could not trace.
 *
 * Usage:
 *   node --experimental-strip-types scripts/vo-trace.ts            report only
 *   node --experimental-strip-types scripts/vo-trace.ts --write    also add entries for clips not yet in scripts/vo-takes.json
 *   node --experimental-strip-types scripts/vo-trace.ts --retrace  ignore the record and trace every clip from WAVs again
 *
 * Clips already in scripts/vo-takes.json are reported from it, not traced: a newer batch with the same name may
 * have overwritten the WAV they came from.
 *   node --experimental-strip-types scripts/vo-trace.ts --json     machine-readable report
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { DialogueChapter } from '../src/data/types/dialogue.ts';
import { CAST, castFor } from './lib/voCast.ts';
import { CREDITED_REACTION_CLIPS, REACTION_BATCHES } from './lib/voReactionBatches.ts';
import { latestByLine, readTakes, writeTakes, type TakeEntry } from './lib/voTakes.ts';
import { traceClips, tracedEntries, type TraceClip, type TraceWav } from './lib/voTrace.ts';

const ROOT = resolve(import.meta.dirname, '..');
const DIALOGUE_DIR = join(ROOT, 'src/data/dialogue');
const OUT_DIR = join(ROOT, 'public/assets/vo');
const BATCH_DIR = join(ROOT, 'previews/vo-batches');

/** Batch names that don't spell out their speakers. */
const NAMED_BATCH_SPEAKERS: Readonly<Record<string, readonly string[]>> = {
  audition_giles_okafor: ['engineer', 'medic'],
  audition_priya_jay: ['nurse', 'player'],
  audition_hale_pa: ['director', 'pa'],
  react_jay_male: ['player'],
  react_giles_male: ['engineer'],
  react_priya_female: ['nurse'],
  react_voss_female: ['crew_lab'],
  ...Object.fromEntries(REACTION_BATCHES.map((b) => [b.name, [b.speaker]])),
};

/** `vo_crew_sung_crew_botanist` -> [crew_sung, crew_botanist]; `retake_medic_01` -> [medic]. */
export function speakersForWav(name: string): string[] {
  const named = NAMED_BATCH_SPEAKERS[name];
  if (named) return [...named];
  let rest = name.replace(/^(vo|retake)_/, '').replace(/_\d+$/, '');
  const ids = Object.keys(CAST).sort((a, b) => b.length - a.length);
  const out: string[] = [];
  while (rest.length > 0) {
    const id = ids.find((k) => rest === k || rest.startsWith(`${k}_`));
    if (!id) break;
    out.push(id);
    rest = rest.slice(id.length).replace(/^_/, '');
  }
  return out;
}

function wavSamples(path: string): number {
  const buf = readFileSync(path);
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'data') return Math.floor(size / 2);
    off += 8 + size;
  }
  throw new Error(`No data chunk in ${path}`);
}

function loadWavs(): TraceWav[] {
  if (!existsSync(BATCH_DIR)) return [];
  return readdirSync(BATCH_DIR)
    .filter((f) => f.endsWith('.wav'))
    .map((f) => {
      const p = join(BATCH_DIR, f);
      const name = f.replace(/\.wav$/, '');
      return { name, mtimeMs: statSync(p).mtimeMs, samples: wavSamples(p), speakers: speakersForWav(name) };
    });
}

function loadClips(): TraceClip[] {
  const clips: TraceClip[] = [];
  const add = (id: string, speaker: string): void => {
    const p = join(OUT_DIR, `${id}.mp3`);
    if (existsSync(p)) clips.push({ id, speaker, mtimeMs: statSync(p).mtimeMs });
  };
  const files = readdirSync(DIALOGUE_DIR).filter((f) => f.endsWith('.json') && f !== 'speakers.json' && f !== 'ui.json').sort();
  for (const f of files) {
    for (const l of (JSON.parse(readFileSync(join(DIALOGUE_DIR, f), 'utf8')) as DialogueChapter).lines) {
      if (typeof l.audio === 'string' && l.audio === `assets/vo/${l.id}.mp3`) add(l.id, l.speaker);
    }
  }
  for (const b of REACTION_BATCHES) for (const t of b.takes) if (!CREDITED_REACTION_CLIPS.includes(t.id)) add(t.id, b.speaker);
  return clips;
}

interface Row {
  id: string;
  speaker: string;
  model: string | null;
  confidence: 'recorded' | 'direct' | 'inferred' | 'flagged';
  reason: string;
}

function main(): void {
  const args = process.argv.slice(2);
  const retrace = args.includes('--retrace');
  const takes = readTakes();
  // Clips already in the record keep it: their old batch WAV may since have been overwritten by a newer
  // batch of the same name, so file times can no longer be trusted for them.
  const recorded = retrace ? new Map<string, TakeEntry>() : latestByLine(takes);
  const clips = loadClips();
  const unrecorded = clips.filter((c) => !recorded.has(c.id));
  const traced = traceClips(loadWavs(), unrecorded);
  const rows: Row[] = [
    ...clips.filter((c) => recorded.has(c.id)).map((c): Row => {
      const e = recorded.get(c.id)!;
      return { id: c.id, speaker: c.speaker, model: e.model, confidence: 'recorded', reason: `${e.batch} (${e.source}${e.confidence ? `, ${e.confidence}` : ''}, ${e.at.slice(0, 16)})` };
    }),
    ...traced,
  ];
  if (args.includes('--json')) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const off = rows.filter((t) => t.model !== null && t.model !== castFor(t.speaker).model);
  const flagged = rows.filter((t) => t.confidence === 'flagged');
  const counts = { recorded: 0, direct: 0, inferred: 0, flagged: 0 };
  for (const t of rows) counts[t.confidence]++;
  console.log(`[trace] ${rows.length} clips: ${counts.recorded} from vo-takes.json, ${counts.direct} direct, ${counts.inferred} inferred, ${counts.flagged} flagged`);

  const bySpeaker = new Map<string, Row[]>();
  for (const t of off) bySpeaker.set(t.speaker, [...(bySpeaker.get(t.speaker) ?? []), t]);
  console.log(`
[trace] NOT ON THEIR SPEAKER'S PINNED MODEL (${off.length}):`);
  for (const [sp, list] of bySpeaker) {
    console.log(`  ${sp} (pinned ${castFor(sp).model}):`);
    for (const t of list) console.log(`    - ${t.id.padEnd(26)} ${t.model} [${t.confidence}] ${t.reason}`);
  }
  if (flagged.length > 0) {
    console.log(`
[trace] FLAGGED, could not trace (${flagged.length}):`);
    for (const t of flagged) console.log(`  - ${t.id.padEnd(26)} (${t.speaker}) ${t.reason}`);
  }

  if (args.includes('--write')) {
    const entries = tracedEntries(traced, unrecorded, (sp) => castFor(sp).voice);
    const kept = retrace ? takes.filter((e) => e.source === 'generated') : takes;
    writeTakes([...entries, ...kept].sort((x, y) => x.at.localeCompare(y.at)));
    console.log(`
[trace] added ${entries.length} traced entries to scripts/vo-takes.json (${kept.length} kept)`);
  }
}

main();
