#!/usr/bin/env node
/**
 * Repairs the Monster Juggernaut GLB ("monster juggernaut" by sanyaork, https://sketchfab.com/3d-models/monster-juggernaut-a36b8b8d97ac4f68ac2759591bfcf95f,
 * CC BY 4.0, credited in CREDITS.md) for the creature rig (openspec rig-juggernaut). What it fixes and how is described in
 * scripts/lib/juggernautRepair.mjs: the eyes, teeth and tongue are moved onto the head, the hands and feet onto their limbs,
 * the aim marker onto the head, and the model is set to its neutral (bind) pose, with the exported frame written to the pose
 * file as `exported_rest`.
 *
 *   git show 900e513:public/assets/models/infected/monster_juggernaut.glb > previews/sources/monster_juggernaut_src.glb
 *   node scripts/fix-juggernaut-glb.mjs                  # source -> public/assets/models/infected/monster_juggernaut.glb
 *   node scripts/fix-juggernaut-glb.mjs --check          # rebuild in memory; exit 1 unless the shipped files match
 *   node scripts/fix-juggernaut-glb.mjs --out <file.glb> [--skip=face,reparent,neutral]   # compare single fixes
 *
 * The source is the Sketchfab export as committed in 900e513. It is read, never written, so the script can run again.
 * The face parts must pass the acceptance checks (inside the head, mirrored, on their joints, teeth between the jaws,
 * tongue behind the teeth) or nothing is written.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  FIXTURE_PATH,
  MODEL_PATH,
  POSES_PATH,
  SOURCE_HINT,
  SOURCE_PATH,
  createIO,
  faceChecks,
  metresPerUnit,
  posesJson,
  repair,
  sourceFixture,
} from './lib/juggernautRepair.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const hit = args.find((a) => a.startsWith(`${name}=`));
  if (hit) return hit.slice(name.length + 1);
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const src = value('--source') ?? SOURCE_PATH;
const out = value('--out') ?? MODEL_PATH;
const skip = new Set((value('--skip') ?? '').split(',').filter(Boolean));
const check = flag('--check');

if (!existsSync(src)) {
  console.error(`missing source ${src}; get it with:\n  ${SOURCE_HINT}`);
  process.exit(1);
}

const io = createIO();
const source = await io.read(src);
const m = metresPerUnit(source);
const doc = await io.read(src);
const { exportedRest, report } = repair(doc, { face: !skip.has('face'), reparent: !skip.has('reparent'), neutral: !skip.has('neutral') });

for (const g of report.face ?? []) {
  console.log(`face: ${g.group}: scale ${g.scale.toFixed(5)}, joints ${g.residuals.map((r) => `${r.joint} ${(r.units * m * 100).toFixed(1)} cm`).join(', ')}`);
}
if (report.neutral) console.log(`neutral: ${report.neutral.weighted} weighted joints at their bind pose, ${report.neutral.rebuiltInverseBinds} unweighted inverse-binds rebuilt`);

if (!skip.has('face')) {
  const checks = faceChecks(doc, m);
  let failed = 0;
  for (const c of checks) {
    if (!c.ok) failed++;
    console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.part}: ${c.check} (${(c.metres * 100).toFixed(2)} cm)`);
  }
  if (failed) {
    console.error(`${failed} face-part check(s) failed; nothing written. The fallback is the original from Sketchfab (ask first).`);
    process.exit(1);
  }
}

const glb = Buffer.from(await io.writeBinary(doc));
const poses = exportedRest ? posesJson(existsSync(POSES_PATH) ? JSON.parse(readFileSync(POSES_PATH, 'utf8')) : null, exportedRest) : null;
const fixture = JSON.stringify(sourceFixture(source)) + '\n';
const shipping = out === MODEL_PATH;

if (check) {
  const same = (path, text) => existsSync(path) && readFileSync(path, 'utf8') === text;
  const results = [[out, existsSync(out) && Buffer.compare(readFileSync(out), glb) === 0]];
  if (poses) results.push([`${POSES_PATH} exported_rest`, same(POSES_PATH, poses)]);
  if (shipping) results.push([FIXTURE_PATH, same(FIXTURE_PATH, fixture)]);
  for (const [what, ok] of results) console.log(`${what}: ${ok ? 'matches' : 'DIFFERS'}`);
  process.exit(results.every(([, ok]) => ok) ? 0 : 1);
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, glb);
console.log(`wrote ${out} (${(glb.length / 1e6).toFixed(2)} MB)`);
if (shipping) {
  if (poses) {
    mkdirSync(dirname(POSES_PATH), { recursive: true });
    writeFileSync(POSES_PATH, poses);
    console.log(`wrote ${POSES_PATH} (exported_rest: ${Object.keys(exportedRest.joints).length} joints)`);
  }
  writeFileSync(FIXTURE_PATH, fixture);
  console.log(`wrote ${FIXTURE_PATH}`);
}
