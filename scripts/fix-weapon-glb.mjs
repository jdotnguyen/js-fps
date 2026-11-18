// Normalises the shotgun GLB exported from Sketchfab: its gun mesh is authored 10,000x too large and
// facing backwards and upside down (the arms and the pistol are fine). Rewrites POSITION and NORMAL in place as
// x' = x * 1e-4, y' = -y * 1e-4, z' = -z * 1e-4 (a half turn about X plus the scale), in the skin's bind space.
// (A half turn about Y alone gets the barrel pointing forward but leaves the gun upside down.)
// Idempotent: a file whose gun is already metre-sized is left alone.
//   node scripts/fix-weapon-glb.mjs [public/assets/models/weapons/shotgun.glb]
import fs from 'node:fs';

const file = process.argv[2] ?? 'public/assets/models/weapons/shotgun.glb';
const SCALE = 1e-4;
const d = fs.readFileSync(file);
const jsonLen = d.readUInt32LE(12);
const json = JSON.parse(d.subarray(20, 20 + jsonLen).toString('utf8'));
const binOff = 20 + jsonLen + 8; // BIN chunk header is 8 bytes
const mesh = json.meshes.find((m) => /boomstick/i.test(m.name ?? ''));
if (!mesh) throw new Error('no boomstick mesh found');
const prim = mesh.primitives[0];
const posAcc = json.accessors[prim.attributes.POSITION];
if (Math.max(...posAcc.max.map(Math.abs), ...posAcc.min.map(Math.abs)) < 50) {
  console.log('already normalised, nothing to do');
  process.exit(0);
}
const transform = (accIndex, scale) => {
  const acc = json.accessors[accIndex];
  const bv = json.bufferViews[acc.bufferView];
  const stride = bv.byteStride ?? 12;
  const start = binOff + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < acc.count; i++) {
    const o = start + i * stride;
    const v = [d.readFloatLE(o) * scale, -d.readFloatLE(o + 4) * scale, -d.readFloatLE(o + 8) * scale];
    v.forEach((c, k) => {
      d.writeFloatLE(c, o + k * 4);
      min[k] = Math.min(min[k], c);
      max[k] = Math.max(max[k], c);
    });
  }
  if (acc.min) {
    acc.min = min;
    acc.max = max;
  }
};
transform(prim.attributes.POSITION, SCALE);
if (prim.attributes.NORMAL !== undefined) transform(prim.attributes.NORMAL, 1);
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
fs.writeFileSync(file, out);
console.log('rewrote', file, 'gun bounds now', posAcc.min.map((x) => +x.toFixed(3)), posAcc.max.map((x) => +x.toFixed(3)));
