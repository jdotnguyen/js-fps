/**
 * Download exactly the motion-capture takes the bake list (scripts/mocap.sources.json) names into previews/sources/mocap/.
 * Files already present are left alone. Sources marked `manual` (100STYLE) are listed with instructions instead.
 *
 * Usage: node scripts/mocap-fetch.mjs [--manifest path]
 */
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_MANIFEST, ROOT, loadManifest, missingSources, sourceFile, takeUrl } from './lib/mocapSources.mjs';

const mi = process.argv.indexOf('--manifest');
const m = loadManifest(mi > 0 ? path.resolve(process.argv[mi + 1]) : DEFAULT_MANIFEST);

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  console.log(`fetched ${path.relative(ROOT, dest)}`);
}

const manual = [];
for (const miss of missingSources(m)) {
  const clip = m.clips.find((c) => c.id === miss.clip);
  const s = m.sources[clip.source];
  if (s.kind === 'bvh' && s.fetchPattern) await download(takeUrl(s, clip.take), sourceFile(m, clip));
  else if (s.fetch) for (const url of s.fetch) await download(url, path.join(path.dirname(sourceFile(m, clip)), path.basename(new URL(url).pathname)));
  else manual.push(miss);
}
for (const miss of manual) console.log(`manual: ${miss.file} (clip ${miss.clip}): ${miss.get}`);
if (manual.length) process.exitCode = 1;
