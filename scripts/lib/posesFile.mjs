/**
 * Write poses into src/data/poses.json without reformatting the rest of the file (it keeps hand-written number literals
 * such as `95.0` that a full re-stringify would rewrite). A pose that exists is replaced in place; a new one is added at the
 * end of `poses`. Used while authoring the blade creature's poses (openspec rig-necromorph).
 *
 *   import { setPoses } from './lib/posesFile.mjs';
 *   setPoses({ blade_stance: { joints: { spine: [12, 0, 0] } } });
 */
import { readFileSync, writeFileSync } from 'node:fs';

export const POSES_PATH = new URL('../../src/data/poses.json', import.meta.url);

/** One pose as the file writes it: one-space indent per level, at the depth of a pose under `poses`. */
function block(name, pose, eol) {
  const body = JSON.stringify(pose, null, 1).split('\n');
  return [`  ${JSON.stringify(name)}: ${body[0]}`, ...body.slice(1).map((l) => `  ${l}`)].join(eol);
}

export function setPoses(poses, path = POSES_PATH) {
  let text = readFileSync(path, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const parsed = JSON.parse(text);
  for (const [name, pose] of Object.entries(poses)) {
    const key = `${eol}  ${JSON.stringify(name)}: {`;
    const start = text.indexOf(key);
    if (start >= 0 && name in parsed.poses) {
      // Replace in place: from the key to its closing brace at the same depth.
      const close = text.indexOf(`${eol}  }`, start + key.length);
      text = text.slice(0, start + eol.length) + block(name, pose, eol) + text.slice(close + eol.length + 3);
    } else {
      const end = text.indexOf(`${eol} },${eol} "sequences"`);
      if (end < 0) throw new Error('poses.json: could not find the end of "poses"');
      text = `${text.slice(0, end)},${eol}${block(name, pose, eol)}${text.slice(end)}`;
    }
  }
  const check = JSON.parse(text);
  for (const [name, pose] of Object.entries(poses)) {
    if (JSON.stringify(check.poses[name]) !== JSON.stringify(pose)) throw new Error(`poses.json: ${name} did not round-trip`);
  }
  writeFileSync(path, text);
}
