/**
 * The mocap bake list (scripts/mocap.sources.json, mocap-library spec): which free sources the clip library is baked from,
 * where each source file lives inside the project, and which take each clip comes from.
 */
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const DEFAULT_MANIFEST = path.join(ROOT, 'scripts/mocap.sources.json');

/** Licences the project accepts for motion (mocap-library spec: free, credited; non-commercial accepted). */
export const ACCEPTED_LICENCES = ['CC0-1.0', 'CC-BY-4.0', 'CC-BY-NC-4.0', 'unrestricted'];

const SOURCE_ROOT = path.join(ROOT, 'previews/sources');

/** True when `p` (absolute) is inside the project tree. */
function inside(base, p) {
  const rel = path.relative(base, p);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Read and validate the bake list. Throws with a readable message on any problem. */
export function loadManifest(file = DEFAULT_MANIFEST) {
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  const problems = [];
  for (const [id, s] of Object.entries(m.sources ?? {})) {
    if (!ACCEPTED_LICENCES.includes(s.licence)) problems.push(`source "${id}": licence "${s.licence}" is not one of ${ACCEPTED_LICENCES.join(', ')}`);
    for (const k of ['title', 'author', 'url']) if (!s[k]) problems.push(`source "${id}": missing ${k}`);
    const rel = s.path ?? s.dir;
    if (!rel) {
      problems.push(`source "${id}": missing path or dir`);
      continue;
    }
    const abs = path.resolve(ROOT, rel);
    // Sources live under previews/sources/ (kept out of git); the only exception is an asset already committed to the repo.
    if (s.committed ? !inside(ROOT, abs) : !inside(SOURCE_ROOT, abs)) {
      problems.push(`source "${id}": ${rel} must be under previews/sources/${s.committed ? ' or inside the project' : ''}`);
    }
  }
  const ids = new Set();
  for (const c of m.clips ?? []) {
    if (!c.id || ids.has(c.id)) problems.push(`clip "${c.id}": missing or duplicate id`);
    ids.add(c.id);
    if (!m.sources?.[c.source]) problems.push(`clip "${c.id}": unknown source "${c.source}"`);
    if (!c.take) problems.push(`clip "${c.id}": missing take`);
    // A clip made from another (`from`) needs the rotations to add, and its base baked before it. `rotate` without `from`
    // turns the clip's own joints once it is baked.
    if (c.from !== undefined && !(ids.has(c.from) && c.from !== c.id)) problems.push(`clip "${c.id}": "from" must name a clip listed before it`);
    if (c.from !== undefined && c.rotate === undefined) problems.push(`clip "${c.id}": "from" needs "rotate"`);
  }
  if (problems.length) throw new Error(`${path.relative(ROOT, file)}:\n  ${problems.join('\n  ')}`);
  return m;
}

/** Absolute path of a clip's source file. */
export function sourceFile(m, clip) {
  const s = m.sources[clip.source];
  if (s.kind === 'bvh') return path.resolve(ROOT, s.dir, `${clip.take}.bvh`);
  return path.resolve(ROOT, s.path);
}

/** Where to get a missing file: the fetch URL(s) or the manual instructions. */
export function whereToGet(m, clip) {
  const s = m.sources[clip.source];
  if (s.kind === 'bvh' && s.fetchPattern) return takeUrl(s, clip.take);
  if (s.fetch) return s.fetch.join(' and ');
  if (s.gitObject) return `from this repository's history (git show ${s.gitObject})`;
  return s.manual ?? s.url;
}

/** Remote URL of one BVH take. CMU takes are `<subject>_<n>`, stored under a zero-padded subject folder. */
export function takeUrl(s, take) {
  const subject = take.split('_')[0].padStart(3, '0');
  return s.fetchPattern.replace('{subject}', subject).replace('{take}', take);
}

/** Source files the bake list needs that are not present. */
export function missingSources(m) {
  const out = [];
  const seen = new Set();
  for (const c of m.clips) {
    const f = sourceFile(m, c);
    if (seen.has(f)) continue;
    seen.add(f);
    if (!fs.existsSync(f)) out.push({ clip: c.id, file: path.relative(ROOT, f).split(path.sep).join('/'), get: whereToGet(m, c) });
  }
  return out;
}
