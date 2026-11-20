/**
 * Suggest an authored curve walk (ADR-0028) for slice01:
 *
 *   npm run walks:suggest -- <id> <start> [via...] <end>
 *
 * Points are anchor ids or "x,z" feet positions. Doors count as open. Prints a `walks` entry
 * to paste into the room in src/data/levels/slice01.json (then tweak by hand; the slice01 walk
 * test checks every authored curve stays clear of walls).
 */
import { suggestWalk } from '../src/ai/walkAuthor.ts';
import { loadSlice01 } from '../src/world/headlessSlice.ts';

const [id, ...refs] = process.argv.slice(2);
if (!id || refs.length < 2) {
  console.error('usage: npm run walks:suggest -- <id> <start> [via...] <end>   (anchor ids or "x,z")');
  process.exit(1);
}
const { level, doors } = loadSlice01();
for (const d of doors) d.collider.enabled = false;

const points = refs.map((r) => {
  const m = /^(-?[\d.]+),(-?[\d.]+)$/.exec(r);
  if (m) return { x: +m[1]!, y: 0, z: +m[2]! };
  const a = level.anchor(r);
  if (!a) throw new Error(`no anchor "${r}"`);
  // Look-target anchors sit up in the air: walk on the deck under them.
  return { x: a.pos.x, y: a.pos.y < 0.5 ? a.pos.y : 0, z: a.pos.z };
});
const s = suggestWalk(level.collision, points);
// Via points given as anchors stay anchor ids, so moving the anchor moves the walk.
const out = s.points.map((p) => {
  const k = points.findIndex((v) => Math.hypot(v.x - p.x, v.z - p.z) < 1e-6);
  if (k >= 0 && !/,/.test(refs[k]!)) return refs[k]!;
  return [p.x, 0, p.z];
});
console.error(`${id}: ${s.points.length} points, ${s.length.toFixed(1)} m, tightest gap ${s.minGap.toFixed(2)} m beyond the body`);
console.log(JSON.stringify({ id, points: out }));
