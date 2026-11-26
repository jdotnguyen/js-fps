#!/usr/bin/env node
/**
 * Repairs the Necromorph Slasher GLB ("Necromorph Slasher Varient 1 Rig" by NO.DONT.EAT.ME.CASEOH,
 * https://sketchfab.com/3d-models/necromorph-slasher-varient-1-rig-137342e28bf947c19d347d9643b66621, CC BY 4.0, credited in
 * CREDITS.md) for the blade creature (openspec rig-necromorph, design D2): it gives the jaw a joint of its own. What changes
 * and how is in scripts/lib/necromorphRepair.mjs.
 *
 *   git show 822dddf:public/assets/models/infected/necromorph_slasher.glb > previews/sources/necromorph_slasher_src.glb
 *   node scripts/fix-necromorph-glb.mjs                    # source -> public/assets/models/infected/necromorph_slasher.glb
 *   node scripts/fix-necromorph-glb.mjs --check            # rebuild in memory; exit 1 unless the shipped file matches
 *   node scripts/fix-necromorph-glb.mjs --out <file.glb> [--skip=jaw]   # write elsewhere, or leave a fix out
 *   node scripts/fix-necromorph-glb.mjs --fixture          # (re)write scripts/fixtures/necromorph-source.json from the source
 *
 * The source is the file as committed in 822dddf. It is read, never written, so the script can run again.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { FIXTURE_PATH, MODEL_PATH, SOURCE_HINT, SOURCE_PATH, createIO, prepareWrite, repair, sourceFacts } from './lib/necromorphRepair.mjs';

const args = process.argv.slice(2);
const value = (name) => {
  const hit = args.find((a) => a.startsWith(`${name}=`));
  if (hit) return hit.slice(name.length + 1);
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const src = value('--source') ?? SOURCE_PATH;
const out = value('--out') ?? MODEL_PATH;
const skip = new Set((value('--skip') ?? '').split(',').filter(Boolean));

if (!existsSync(src)) {
  console.error(`missing source ${src}; get it with:\n  ${SOURCE_HINT}`);
  process.exit(1);
}
const io = await createIO();
const doc = await io.read(src);

if (args.includes('--fixture')) {
  writeFileSync(FIXTURE_PATH, `${JSON.stringify(sourceFacts(doc))}\n`);
  console.log(`wrote ${FIXTURE_PATH}`);
  process.exit(0);
}

const report = repair(doc, { skip });
prepareWrite(doc);
const bytes = Buffer.from(await io.writeBinary(doc));
console.log(JSON.stringify(report));

if (args.includes('--check')) {
  const shipped = readFileSync(out);
  const same = shipped.equals(bytes);
  console.log(same ? `${out} matches the repair` : `${out} differs from the repair (${shipped.length} vs ${bytes.length} bytes)`);
  process.exit(same ? 0 : 1);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, bytes);
console.log(`wrote ${out} (${(bytes.length / 1024).toFixed(0)} KB)`);
