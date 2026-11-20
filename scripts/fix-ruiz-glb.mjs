// Prepares the Sketchfab "Blue Overalls Technician" GLB (restore50, CC-BY 4.0) as Ines Ruiz's body for bodyModel.ts (ADR-0026).
//   node scripts/fix-ruiz-glb.mjs <source.glb> [public/assets/models/squad/ruiz.glb]
// The source is an unrigged 26 MB scan from restore50's exporter: 4 mesh chunks (~385k triangles) fused into one shell, 5 identical UV
// sets under a KHR_texture_transform, 4 PNG textures. A woman with long curly hair in navy coveralls and a tool belt, caught mid-stride
// (left leg forward on its heel, right leg trailing on its toes), carrying an ~80 cm metal toolbox in her right hand.
// What it does (26 MB -> ~0.4 MB), on top of scripts/lib/scan-body.mjs:
//   - bakes the transforms (Y-up metres, feet on y = 0, facing +Z) and welds the chunks;
//   - cuts the toolbox and its handle posts away by region + texture colour (grey metal, black handle; skin and navy cloth stay),
//     drops the box's leftover islands and caps the slit where the lid touched her hip;
//   - decimates by region (tight error on face and hands, looser on hair and cloth), skins to the Mixamo-named skeleton in J (measured off the scan) with a jaw mask;
//     bodyModel.ts straightens the stride and the arms from those bones like any rigged model;
//   - keeps only baseColor (1024 px) and normal (512 px) textures, as WebP; meshopt-compressed and quantized like the other bodies.
import { readGlb, bakeScan, decodeImage, vertexColors, removeTriangles, dropIslands, capHoles, decimate, labelArms, splitArms, skinScan, packBody, encodeWebp } from './lib/scan-body.mjs';

const [src, dst = 'public/assets/models/squad/ruiz.glb'] = process.argv.slice(2);
if (!src) throw new Error('usage: node scripts/fix-ruiz-glb.mjs <source.glb> [out.glb]');

const glb = readGlb(src);
const mat = glb.j.materials[0];
const colorPng = glb.imageBytes(mat.pbrMetallicRoughness.baseColorTexture.index);
const normalPng = glb.imageBytes(mat.normalTexture.index);
const tex = decodeImage(colorPng);
const mesh = bakeScan(glb);

// ------------------------------------------------------------------ toolbox
{
  const col = vertexColors(tex, mesh.UV);
  const P = mesh.P;
  const tri = (a, b, c) => {
    const k = [0, 1, 2].map((i) => (P[a * 3 + i] + P[b * 3 + i] + P[c * 3 + i]) / 3);
    const rgb = [0, 1, 2].map((i) => (col[a * 3 + i] + col[b * 3 + i] + col[c * 3 + i]) / 3);
    return { x: k[0], y: k[1], z: k[2], r: rgb[0], g: rgb[1], b: rgb[2], mean: (rgb[0] + rgb[1] + rgb[2]) / 3, spread: Math.max(...rgb) - Math.min(...rgb) };
  };
  const skin = (t) => t.r > 0.35 && t.r > t.b + 0.12;
  const cut = removeTriangles(mesh, (a, b, c) => {
    const t = tri(a, b, c);
    // The box: everything well outside her right hip below the hand, and grey metal anywhere next to it.
    if (t.x < -0.2 && t.y > 0.44 && t.y < 0.775) return true;
    if (t.x < -0.14 && t.y > 0.44 && t.y < 0.8 && t.mean > 0.3 && t.spread < 0.14) return true;
    // ...including the shadowed lid edge where it meets her hip (neutral grey; the navy cloth is bluer).
    if (t.x < -0.14 && t.y > 0.7 && t.y < 0.8 && t.mean > 0.2 && Math.abs(t.b - t.r) < 0.04 && t.spread < 0.1) return true;
    // Handle posts below the fist and the grip's ends poking out of it (black or grey, never skin).
    if (t.x > -0.345 && t.x < -0.225 && t.y > 0.74 && t.y < 0.875 && !skin(t) && (t.mean < 0.2 || t.spread < 0.14)) return true;
    return false;
  }, 'toolbox cut');
  dropIslands(mesh, (s) => s.max[1] < 0.86 && s.min[0] < -0.14 && s.count < 20000, 'toolbox remnants');
  // Caps take a texel from their own rim: skin where the grip left the fist, navy cloth where the lid touched her hip.
  const near = (v, c) => Math.hypot(P[v * 3] - c[0], P[v * 3 + 1] - c[1], P[v * 3 + 2] - c[2]);
  const isSkinV = (v) => col[v * 3] > 0.35 && col[v * 3] > col[v * 3 + 2] + 0.12;
  const isNavyV = (v) => col[v * 3 + 2] > col[v * 3] && (col[v * 3] + col[v * 3 + 1] + col[v * 3 + 2]) / 3 < 0.3;
  capHoles(mesh, cut, {
    maxLoop: 0.8,
    label: 'toolbox openings capped',
    pick: (rim, c) => {
      const inHand = c[0] < -0.22 && c[1] > 0.78 && c[1] < 0.9;
      const ok = rim.filter((v) => v < col.length / 3 && (inHand ? isSkinV(v) : isNavyV(v)));
      return (ok.length ? ok : rim).sort((a, b) => near(a, c) - near(b, c))[0];
    },
  });
}

const body = await decimate(mesh, [
  { name: 'face', test: (x, y, z) => y > 1.5 && z > -0.02 && Math.abs(x - 0.05) < 0.09, error: 0.0012 },
  { name: 'hands', test: (x, y) => Math.abs(x) > 0.22 && y > 0.74 && y < 0.95, error: 0.0015 },
  { name: 'boots', test: (x, y) => y < 0.14, error: 0.003 },
  { name: 'rest', test: () => true, error: 0.005 },
]);

// ------------------------------------------------------------------ skeleton (metres, Y up, facing +Z; left is +X)
// Measured off the scan (1.90 m including hair). Hips are level in Z so bodyModel's yaw is 0. Her face is frontal (no head turn).
const J = {
  Hips: [0.005, 0.92, -0.01],
  Spine: [0.01, 1.08, -0.01],
  Spine1: [0.02, 1.28, -0.01],
  Neck: [0.04, 1.53, 0.0],
  Head: [0.05, 1.63, 0.01],
  HeadTop: [0.05, 1.895, 0.0],
  // Jaw hinge ahead of the ear and the chin tip (mouth line y 1.68, chin y 1.635, chin front z 0.09; the ear sits near z 0).
  Jaw: [0.05, 1.695, 0.0],
  JawEnd: [0.05, 1.637, 0.085],
  LeftShoulder: [0.06, 1.49, -0.01],
  LeftArm: [0.17, 1.46, -0.01],
  LeftForeArm: [0.255, 1.17, -0.01],
  LeftHand: [0.29, 0.905, -0.045],
  LeftHandMiddle1: [0.285, 0.835, -0.065],
  RightShoulder: [-0.04, 1.49, -0.01],
  RightArm: [-0.165, 1.46, -0.02],
  RightForeArm: [-0.255, 1.17, -0.03],
  RightHand: [-0.285, 0.905, -0.08],
  RightHandMiddle1: [-0.29, 0.835, -0.1],
  // Mid-stride: the left leg leads (heel down, toes up), the right trails (heel up, toes on the floor).
  LeftUpLeg: [0.085, 0.9, -0.02],
  LeftLeg: [0.085, 0.52, 0.19],
  LeftFoot: [0.035, 0.1, 0.3],
  LeftToeBase: [0.05, 0.045, 0.4],
  LeftToeEnd: [0.06, 0.04, 0.47],
  RightUpLeg: [-0.075, 0.9, -0.02],
  RightLeg: [-0.03, 0.5, -0.235],
  // Ankle placed along the shin so both legs measure 0.871 m: the feet land level once bodyModel straightens them.
  RightFoot: [0.065, 0.152, -0.44],
  RightToeBase: [0.045, 0.04, -0.33],
  RightToeEnd: [0.05, 0.02, -0.24],
};
// name: [parent, segment end (null: short stub), radius in metres]; *End names are segment ends only.
const BONES = {
  Hips: [null, 'Spine', 0.18],
  Spine: ['Hips', 'Spine1', 0.18],
  Spine1: ['Spine', 'Neck', 0.18],
  Neck: ['Spine1', 'Head', 0.07],
  Head: ['Neck', 'HeadTop', 0.15],
  Jaw: ['Head', 'JawEnd', 0.045],
  JawEnd: ['Jaw', null, 0.03],
  LeftShoulder: ['Spine1', 'LeftArm', 0.075],
  LeftArm: ['LeftShoulder', 'LeftForeArm', 0.08],
  LeftForeArm: ['LeftArm', 'LeftHand', 0.07],
  LeftHand: ['LeftForeArm', 'LeftHandMiddle1', 0.065],
  LeftHandMiddle1: ['LeftHand', null, 0.05],
  RightShoulder: ['Spine1', 'RightArm', 0.075],
  RightArm: ['RightShoulder', 'RightForeArm', 0.08],
  RightForeArm: ['RightArm', 'RightHand', 0.07],
  RightHand: ['RightForeArm', 'RightHandMiddle1', 0.065],
  RightHandMiddle1: ['RightHand', null, 0.05],
  LeftUpLeg: ['Hips', 'LeftLeg', 0.11],
  LeftLeg: ['LeftUpLeg', 'LeftFoot', 0.085],
  LeftFoot: ['LeftLeg', 'LeftToeBase', 0.07],
  LeftToeBase: ['LeftFoot', 'LeftToeEnd', 0.06],
  LeftToeEnd: ['LeftToeBase', null, 0.04],
  RightUpLeg: ['Hips', 'RightLeg', 0.11],
  RightLeg: ['RightUpLeg', 'RightFoot', 0.085],
  RightFoot: ['RightLeg', 'RightToeBase', 0.07],
  RightToeBase: ['RightFoot', 'RightToeEnd', 0.06],
  RightToeEnd: ['RightToeBase', null, 0.04],
};
const ARM = /^(Left|Right)(ForeArm|Hand)/;
const isNavy = (c) => c[2] > c[0] + 0.02 && (c[0] + c[1] + c[2]) / 3 < 0.35;
const TORSO_LEG = /^(Hips|Spine|(Left|Right)UpLeg)/;
const isSkin = (c) => c[0] > 0.35 && c[0] > c[2] + 0.12;
const adjust = (x, y, z, b, rgb) => {
  let s = 0;
  // Hands and cuffs hang beside the tool belt pouches: the belt and hips stay on the body, sleeves and skin on the arm.
  if (y < 1.2 && Math.abs(x) < 0.225 && ARM.test(b)) s += 2;
  if (y < 1.2 && Math.abs(x) > 0.25 && TORSO_LEG.test(b)) s += 2;
  if (rgb && isSkin(rgb) && y < 1.0 && !/Hand/.test(b)) s += 4;
  // The stride angled both thighs; below the hip joint the cloth follows the thighs, so straightening them leaves no bulge.
  if (b === 'Hips') s += Math.max(0, 0.87 - y) * 12;
  return s;
};

// ------------------------------------------------------------------ arms off the torso (openspec fix-scan-body-skinning)
// Her sleeves lie against the coverall sides and the tool-belt pouches from the armpit to the wrists: cut them apart below the
// armpit and cap both sides, navy cloth on the caps (skin where a cap closes off a hand).
const colors = vertexColors(tex, body.uv);
// The tool-belt pouches hang against her forearms at the hips: anything there that is not navy sleeve or skin, or that sits more
// than 7 cm off the forearm/hand axis, stays on the body (otherwise a pouch would swing out with the arm).
const segDist = (p, a, b) => {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)));
  return Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t, p[2] - a[2] - ab[2] * t);
};
const forearmDist = (p) =>
  Math.min(...['Left', 'Right'].flatMap((s) => [segDist(p, J[`${s}ForeArm`], J[`${s}Hand`]), segDist(p, J[`${s}Hand`], J[`${s}HandMiddle1`])]));
const pouch = (x, y, z, rgb) => {
  if (y < 0.84 || y > 1.12) return undefined;
  const d = forearmDist([x, y, z]);
  if (d > 0.07 || (d > 0.045 && rgb && !isNavy(rgb) && !isSkin(rgb))) return 0;
  return undefined;
};
const armLabels = labelArms(body, { J, BONES, color: colors, adjust, override: pouch });
const texelColor = (v) => colors.subarray(v * 3, v * 3 + 3);
const pickTexel = (rim, c) => {
  const near = (v) => Math.hypot(body.pos[v * 3] - c[0], body.pos[v * 3 + 1] - c[1], body.pos[v * 3 + 2] - c[2]);
  const navy = rim.filter((v) => isNavy(texelColor(v)));
  const skin = rim.filter((v) => isSkin(texelColor(v)));
  const from = navy.length >= rim.length * 0.3 ? navy : skin.length ? skin : rim;
  return from.reduce((best, v) => (near(v) < near(best) ? v : best), from[0]);
};
const arms = splitArms(body, armLabels, { armpitY: { Left: 1.35, Right: 1.35 }, torsoAxis: [J.Spine1[0], J.Spine1[2]], J, pick: pickTexel, blend: 0.06 });

const skin = skinScan({
  pos: body.pos,
  indices: body.indices,
  J,
  BONES,
  color: vertexColors(tex, body.uv),
  adjust,
  arms,
  // Neck column measured off the scan: her hair wraps the neck from y 1.5 up, with a strip of throat skin in front; skin and the
  // hair next to it turn with the head, the coverall collar (navy) stays on the chest.
  neck: { collarY: 1.52, jawLineY: 1.635, axis: [0.045, -0.005], radius: 0.065, margin: 0.015, faceRadius: 0.17, include: (c) => !isNavy(c) },
  jaw: { mouthY: 1.68, chinY: 1.635, hingeZ: J.Jaw[2], cx: J.Jaw[0] },
});

await packBody({
  dst,
  meshName: 'Ruiz',
  materialName: 'technician',
  generator: 'scripts/fix-ruiz-glb.mjs',
  extras: glb.j.asset.extras,
  body,
  skin,
  J,
  color: encodeWebp(colorPng, 1024, 86),
  normal: encodeWebp(normalPng, 512, 90),
});
