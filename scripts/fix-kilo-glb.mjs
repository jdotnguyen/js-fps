// Prepares the Sketchfab "Kilo-class Submarine" GLB (spacelynxcanfly, CC-BY 4.0) for three r170.
// Its exporter wrote the material as KHR_materials_pbrSpecularGlossiness, which GLTFLoader dropped in r147 (the hull
// would load untextured). This rewrites it as plain metallic-roughness using the diffuse texture as the base colour
// and strips the three unused UV sets. Geometry, textures and the binary chunk are untouched.
//   node scripts/fix-kilo-glb.mjs <source.glb> [public/assets/models/vehicles/kilo_submarine.glb]
import fs from 'node:fs';
import path from 'node:path';

const [src, dst = 'public/assets/models/vehicles/kilo_submarine.glb'] = process.argv.slice(2);
if (!src) throw new Error('usage: node scripts/fix-kilo-glb.mjs <source.glb> [out.glb]');
const d = fs.readFileSync(src);
const jsonLen = d.readUInt32LE(12);
const json = JSON.parse(d.subarray(20, 20 + jsonLen).toString('utf8'));
const binStart = 20 + jsonLen; // 8-byte chunk header + payload, copied as is
const bin = d.subarray(binStart);

for (const m of json.materials) {
  const sg = m.extensions?.KHR_materials_pbrSpecularGlossiness;
  if (!sg) continue;
  delete m.extensions;
  m.pbrMetallicRoughness = { baseColorTexture: sg.diffuseTexture, baseColorFactor: sg.diffuseFactor, metallicFactor: 0.35, roughnessFactor: 0.6 };
}
delete json.extensionsUsed;
delete json.extensionsRequired;
for (const mesh of json.meshes) {
  for (const prim of mesh.primitives) {
    for (const k of ['TEXCOORD_1', 'TEXCOORD_2', 'TEXCOORD_3']) delete prim.attributes[k];
  }
}

let js = Buffer.from(JSON.stringify(json), 'utf8');
js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
const head = Buffer.alloc(20);
head.write('glTF', 0, 'ascii');
head.writeUInt32LE(2, 4);
head.writeUInt32LE(12 + 8 + js.length + bin.length, 8);
head.writeUInt32LE(js.length, 12);
head.writeUInt32LE(0x4e4f534a, 16); // 'JSON'
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.writeFileSync(dst, Buffer.concat([head, js, bin]));
console.log(`wrote ${dst} (${fs.statSync(dst).size} bytes)`);
