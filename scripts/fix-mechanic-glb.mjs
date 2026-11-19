// Renames the bones of the Sketchfab "Mechanic 1" GLB (SidewalkNZ, CC-BY 4.0) so bodyModel.ts can map them.
// Its exporter scrambled every joint name ("Joint c3fd111dea5825_1"); the node indices below were read from the
// skeleton hierarchy and bind positions. The model faces +Z, so its +X limbs are its own Left (ADR-0026).
//   node scripts/fix-mechanic-glb.mjs <source.glb> [public/assets/models/squad/mechanic.glb]
import fs from 'node:fs';
import path from 'node:path';

const [src, dst = 'public/assets/models/squad/mechanic.glb'] = process.argv.slice(2);
if (!src) throw new Error('usage: node scripts/fix-mechanic-glb.mjs <source.glb> [out.glb]');
const d = fs.readFileSync(src);
const jsonLen = d.readUInt32LE(12);
const json = JSON.parse(d.subarray(20, 20 + jsonLen).toString('utf8'));

const names = new Map();
const set = (i, n) => names.set(i, n);
set(6, 'Root'); set(7, 'Hips');
['Spine', 'Spine1', 'Spine2', 'Spine3'].forEach((n, k) => set(8 + k, n));
// Node 13 owns every head vertex and the eye bones hang off it, so it is the Head; 12 is the Neck above Spine3, and 14 is the
// jaw hinge (no vertices are weighted to it; bodyModel.ts weights the lower face to it, see the `jaw` entry in body-models.json).
set(12, 'Neck'); set(13, 'Head'); set(14, 'Jaw');
const arm = (side, first) => {
  set(first, `${side}Clavicle`); set(first + 1, `${side}Arm`); set(first + 2, `${side}ForeArm`); set(first + 3, `${side}Hand`);
  // Five finger chains hang off the hand, in order: thumb, index, middle, ring (4 long), pinky.
  const chains = [['Thumb', 3], ['Index', 3], ['Middle', 3], ['Ring', 4], ['Pinky', 3]];
  let n = first + 4;
  for (const [f, len] of chains) for (let k = 1; k <= len; k++) set(n++, `${side}Hand${f}${k}`);
};
arm('Right', 22); // -X, nodes 22..41
arm('Left', 49); // +X, nodes 49..68
const leg = (side, first) => {
  set(first, `${side}UpLeg`); set(first + 1, `${side}Leg`); set(first + 3, `${side}Foot`); set(first + 4, `${side}ToeBase`);
};
leg('Left', 76); leg('Right', 82);
json.nodes.forEach((n, i) => {
  if (!/^Joint /.test(n.name ?? '')) return;
  n.name = names.get(i) ?? `Helper_${i}`; // twist / corrective / end bones: follow their parent joint
});
const joints = new Set(json.skins[0].joints);
const used = new Set();
for (const i of joints) { const n = json.nodes[i].name; if (used.has(n)) throw new Error('duplicate ' + n); used.add(n); }

let js = Buffer.from(JSON.stringify(json));
js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
const rest = d.subarray(20 + jsonLen);
const out = Buffer.alloc(20 + js.length + rest.length);
d.copy(out, 0, 0, 12);
out.writeUInt32LE(js.length, 12);
out.writeUInt32LE(0x4e4f534a, 16);
js.copy(out, 20);
rest.copy(out, 20 + js.length);
out.writeUInt32LE(out.length, 8);
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.writeFileSync(dst, out);
console.log('wrote', dst, `${names.size} named bones, ${joints.size - names.size} helpers`);
