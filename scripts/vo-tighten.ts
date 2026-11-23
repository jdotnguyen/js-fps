/**
 * Cap the pauses inside the shipped VO clips listed in `scripts/lib/voPauses.ts` (overhaul-priya-r08-death decision
 * 36). Idempotent: a clip already inside its cap is left as it is. `vo-generate` applies the same caps to new takes.
 *
 *   node --experimental-strip-types scripts/vo-tighten.ts            # every listed line
 *   node --experimental-strip-types scripts/vo-tighten.ts sec_priya_12 sec_okafor_17
 *   node --experimental-strip-types scripts/vo-tighten.ts --dry-run  # report only
 */
import { join, resolve } from 'node:path';
import { tightenClip } from './lib/voTighten.ts';
import { TIGHT_LINES } from './lib/voPauses.ts';

const ROOT = resolve(import.meta.dirname, '..');
const OUT_DIR = join(ROOT, 'public/assets/vo');
const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const ids = args.filter((a) => !a.startsWith('--'));
const list = ids.length > 0 ? ids : Object.keys(TIGHT_LINES);
let saved = 0;
for (const id of list) {
  const cap = TIGHT_LINES[id];
  if (cap === undefined) {
    console.warn(`[vo-tighten] ${id}: not in TIGHT_LINES, skipped`);
    continue;
  }
  const r = tightenClip(join(OUT_DIR, `${id}.mp3`), cap, { dryRun: dry });
  saved += r.before - r.after;
  const what = r.changed ? (dry ? 'would cut' : 'cut') : 'kept';
  console.log(`  ${id.padEnd(16)} ${r.before.toFixed(2)}s -> ${r.after.toFixed(2)}s  longest pause ${r.pauseBefore.toFixed(2)}s -> ${r.pauseAfter.toFixed(2)}s (cap ${cap})  ${what}`);
}
console.log(`[vo-tighten] ${dry ? 'would save' : 'saved'} ${saved.toFixed(2)} s over ${list.length} clips`);
