/**
 * Write poses into their pose files (src/data/poseFiles.ts lists them) without reformatting the rest of a file (the files
 * keep hand-written number literals such as `95.0` that a full re-stringify would rewrite). A pose that exists is replaced in
 * the file that defines it; a new one is added at the end of `poses` in the file given, by default the blade creature's, which
 * this was written for (openspec rig-necromorph).
 *
 *   import { setPoses } from './lib/posesFile.mjs';
 *   setPoses({ blade_stance: { joints: { spine: [12, 0, 0] } } });
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const DATA = new URL('../../src/data/', import.meta.url);

/** Where new poses go unless a file is given. */
export const POSES_PATH = new URL('creatures/blade/poses.json', DATA);

/** Every pose file of the shared skeleton: the families, and each character's and creature's own. */
export function poseFilePaths() {
  const families = readdirSync(new URL('poses/', DATA)).map((f) => new URL(`poses/${f}`, DATA));
  const owned = ['cast/', 'creatures/'].flatMap((dir) =>
    readdirSync(new URL(dir, DATA), { recursive: true })
      .map((f) => String(f).replace(/\\/g, '/'))
      // The Juggernaut has its own rig: its poses are another format.
      .filter((f) => f.endsWith('/poses.json') && f !== 'juggernaut/poses.json')
      .map((f) => new URL(`${dir}${f}`, DATA)),
  );
  return [...families, ...owned];
}

/** One pose as the files write it: one-space indent per level, at the depth of a pose under `poses`. */
function block(name, pose, eol) {
  const body = JSON.stringify(pose, null, 1).split('\n');
  return [`  ${JSON.stringify(name)}: ${body[0]}`, ...body.slice(1).map((l) => `  ${l}`)].join(eol);
}

/** A file's text with one pose replaced or added. */
function withPose(text, name, pose) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const parsed = JSON.parse(text);
  if (name in parsed.poses) {
    // Replace in place: from the key to its closing brace at the same depth.
    const start = text.indexOf(`${eol}  ${JSON.stringify(name)}: {`);
    if (start < 0) throw new Error(`${name}: not written as its own block`);
    const close = text.indexOf(`${eol}  }`, start + eol.length);
    return text.slice(0, start + eol.length) + block(name, pose, eol) + text.slice(close + eol.length + 3);
  }
  if (Object.keys(parsed.poses).length === 0) return text.replace('"poses": {}', () => `"poses": {${eol}${block(name, pose, eol)}${eol} }`);
  const end = text.indexOf(`${eol} },${eol} "sequences"`);
  if (end < 0) throw new Error(`${name}: could not find the end of "poses"`);
  return `${text.slice(0, end)},${eol}${block(name, pose, eol)}${text.slice(end)}`;
}

/** Poses that exist are looked up in `files`; `path` receives the ones no file defines yet. */
export function setPoses(poses, path = POSES_PATH, files = poseFilePaths()) {
  const edited = new Map();
  const read = (url) => edited.get(url.href)?.text ?? readFileSync(url, 'utf8');
  for (const [name, pose] of Object.entries(poses)) {
    const owner = files.find((f) => name in JSON.parse(read(f)).poses) ?? path;
    const text = withPose(read(owner), name, pose);
    if (JSON.stringify(JSON.parse(text).poses[name]) !== JSON.stringify(pose)) throw new Error(`${owner.pathname}: ${name} did not round-trip`);
    edited.set(owner.href, { url: owner, text });
  }
  for (const { url, text } of edited.values()) writeFileSync(url, text);
}
