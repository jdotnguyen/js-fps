/**
 * Re-cuts voice clips as `scripts/vo-recuts.json` says (scripts/lib/voRecut.ts), with no voice request. Each clip is
 * written to staging and ships only if it says its line (scripts/lib/voGate.ts). Dialogue files and `vo-takes.json`
 * are not touched: the audio is still the take it came from.
 *
 *   node --experimental-strip-types scripts/vo-recut.ts                      # every clip in the recipe
 *   node --experimental-strip-types scripts/vo-recut.ts --only id1,id2
 *   node --experimental-strip-types scripts/vo-recut.ts --dry-run            # list the spans only
 *
 * Ship a held clip after listening to it: node --experimental-strip-types scripts/vo-generate.ts --accept <ids>
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isNonVerbalOnly } from './lib/voBatches.ts';
import { describeHeld, gateClip, STAGING_DIR, stagedClip } from './lib/voGate.ts';
import { neighbourTexts, readLines } from './lib/voLines.ts';
import { decodeMono, encodeRecut, validateRecipe, type Recipe, type RecipePart } from './lib/voRecut.ts';
import { sttSetup } from './lib/voStt.ts';
import { readTakes } from './lib/voTakes.ts';

const ROOT = resolve(import.meta.dirname, '..');
const OUT_DIR = join(ROOT, 'public/assets/vo');
const BATCH_DIR = join(ROOT, 'previews/vo-batches');
const RECIPE_PATH = join(import.meta.dirname, 'vo-recuts.json');

const args = process.argv.slice(2);
const onlyAt = args.indexOf('--only');
const only = onlyAt >= 0 ? (args[onlyAt + 1] ?? '').split(',').filter(Boolean) : null;

const recipe = JSON.parse(readFileSync(RECIPE_PATH, 'utf8')) as Recipe;
validateRecipe(recipe);
const unknown = only?.filter((id) => !(id in recipe.clips)) ?? [];
if (unknown.length > 0) throw new Error(`[vo-recut] not in the recipe: ${unknown.join(', ')}`);
const wanted = Object.entries(recipe.clips).filter(([id]) => !only || only.includes(id));

const describe = (p: RecipePart): string => `${p.wav ?? `${p.clip} @ ${recipe.commit}`} ${p.from}-${p.to}s${p.gap ? ` after ${p.gap}s` : ''}`;
if (args.includes('--dry-run')) {
  for (const [id, parts] of wanted) console.log(`  ${id.padEnd(18)} ${parts.map(describe).join(' + ')}`);
  process.exit(0);
}

const temp = mkdtempSync(join(tmpdir(), 'vo-recut-src-'));
const loaded = new Map<string, Float32Array>();
const shippedAtCommit = (clip: string): Buffer => execFileSync('git', ['show', `${recipe.commit}:public/assets/vo/${clip}.mp3`], { cwd: ROOT, maxBuffer: 1 << 26 });
function load(part: RecipePart): Float32Array {
  const key = part.wav !== undefined ? `wav:${part.wav}` : `clip:${part.clip}`;
  let samples = loaded.get(key);
  if (!samples) {
    if (part.wav !== undefined) samples = decodeMono(join(BATCH_DIR, part.wav));
    else {
      const path = join(temp, `${part.clip}.mp3`);
      writeFileSync(path, shippedAtCommit(part.clip!));
      samples = decodeMono(path);
    }
    loaded.set(key, samples);
  }
  return samples;
}

const lines = readLines();
const takes = readTakes();
const stt = sttSetup();
if (!stt.transcribe) console.warn(`[vo-recut] clips will ship unchecked: ${stt.reason}`);
const held: string[] = [];
const unchecked: string[] = [];
try {
  for (const [id, parts] of wanted) {
    const line = lines.get(id);
    if (!line) throw new Error(`[vo-recut] no dialogue line "${id}"`);
    const staged = stagedClip(STAGING_DIR, id);
    const [first] = parts;
    let seconds: number;
    if (parts.length === 1 && first!.clip !== undefined && !first!.gap && !first!.gainDb && first!.from === 0 && first!.to * 24000 >= load(first!).length) {
      // A whole clip under another name keeps its exact audio, with no second encode.
      mkdirSync(STAGING_DIR, { recursive: true });
      writeFileSync(staged, shippedAtCommit(first!.clip));
      seconds = load(first!).length / 24000;
    } else seconds = encodeRecut(parts, load, staged);
    const result = gateClip({
      id,
      text: line.text,
      ...neighbourTexts(id, takes, lines),
      verbal: !isNonVerbalOnly(line),
      staged,
      shipped: join(OUT_DIR, `${id}.mp3`),
      take: null,
      transcribe: stt.transcribe,
    });
    console.log(`  ${result.status === 'held' ? '✗' : '✓'} ${id.padEnd(18)} ${seconds.toFixed(2).padStart(5)}s  ${result.status}`);
    if (result.status === 'held') held.push(describeHeld(id, line.text, result.heard, result.reasons));
    if (result.status === 'unchecked') unchecked.push(id);
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
console.log(`\n[vo-recut] ${wanted.length} clips: ${wanted.length - held.length} shipped, ${held.length} held`);
if (unchecked.length > 0) console.log(`[vo-recut] UNCHECKED (shipped without a word check): ${unchecked.join(' ')}`);
if (held.length > 0) {
  console.log(`[vo-recut] HELD in ${STAGING_DIR}:\n${held.join('\n')}`);
  process.exitCode = 1;
}
