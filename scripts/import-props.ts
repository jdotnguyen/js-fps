/**
 * Imports third-party props into public/assets/models/props/ (openspec import-lab-props, docs/imported-props.md).
 *
 *   npm run props                      every entry in scripts/props.sources.json
 *   npm run props -- power_box cable_drum      only these ids
 *   npm run props -- --raw D:/downloads/props-src     raw folder (default ../props-src)
 *
 * Writes <id>.glb, its cost record in src/data/imported-props.json and its line in
 * src/data/kit-manifest.json. Needs ImageMagick with WebP support (as `npm run textures` does).
 * Exits non-zero if any entry was refused or failed; the others are still imported.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readSources } from './props/config.ts';
import { runImport } from './props/importer.ts';
import { findMagick } from './props/textures.ts';

const repo = decodeURIComponent(new URL('../', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const args = process.argv.slice(2);
const rawAt = args.indexOf('--raw');
const rawDir = resolve(repo, rawAt >= 0 ? (args[rawAt + 1] ?? '') : '../props-src');
const ids = args.filter((a, i) => !a.startsWith('--') && !(rawAt >= 0 && i === rawAt + 1));

const { ok: entries, refused } = readSources(JSON.parse(readFileSync(resolve(repo, 'scripts/props.sources.json'), 'utf8')));
for (const r of refused) console.error(`props: refused ${r}`);
const known = new Set(entries.map((e) => e.id));
const unknown = ids.filter((id) => !known.has(id));
if (unknown.length) {
  console.error(`props: unknown id(s) ${unknown.join(', ')}. Known: ${[...known].join(', ')}`);
  process.exit(1);
}
const magick = findMagick();
if (!('bin' in magick)) {
  console.error(`props: ${magick.error}`);
  process.exit(1);
}
const todo = ids.length ? entries.filter((e) => ids.includes(e.id)) : entries;
console.log(`props: importing ${todo.length} from ${rawDir}`);
const { ok, failed } = await runImport(todo, {
  rawDir,
  outDir: resolve(repo, 'public/assets/models/props'),
  recordsPath: resolve(repo, 'src/data/imported-props.json'),
  manifestPath: resolve(repo, 'src/data/kit-manifest.json'),
  magick: magick.bin,
});
console.log(`props: ${ok.length} imported, ${failed.length} failed, ${refused.length} refused`);
for (const f of failed) console.error(`props: ${f.id} failed at ${f.step}: ${f.message}`);
process.exit(failed.length || refused.length ? 1 : 0);
