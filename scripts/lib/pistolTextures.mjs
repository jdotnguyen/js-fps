/**
 * The pistol's gun textures (remove-pistol-decals): the author's 2048 px colour, roughness/metalness and normal maps
 * (material `Colt` of the 2K glTF download), with the author's decals painted out, re-encoded as WebP and put into a
 * built pistol.glb. Run by `scripts/fix-just-weapons-glb.mjs`.
 *
 * The step always starts from the source PNGs, so running it again gives the same textures. It needs ImageMagick.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export const SIZE = 2048;
const MATERIAL = 'Colt';

function magick(args, input) {
  const r = spawnSync('magick', args, { input, maxBuffer: 128 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`magick failed: ${r.error?.message ?? r.stderr.toString()}`);
  return r.stdout;
}

/** PNG/WebP bytes to a SIZE x SIZE RGB buffer. */
export function decodeRgb(image, what) {
  const rgb = magick(['-', '-depth', '8', 'rgb:-'], Buffer.from(image));
  if (rgb.length !== SIZE * SIZE * 3) throw new Error(`${what}: expected a ${SIZE} x ${SIZE} texture`);
  return rgb;
}

const encodeWebp = (rgb) => magick(['-size', `${SIZE}x${SIZE}`, '-depth', '8', 'rgb:-', '-quality', '88', '-define', 'webp:method=6', 'webp:-'], rgb);

// ------------------------------------------------------------------ painting out the decals

/**
 * Where the author painted decals, in texture pixels (x right, y down; boxes are [x0, y0, x1, y1), far edge excluded).
 * `maps` are the textures a repair applies to; the normal map has no trace of any decal. Repairs run in order.
 *
 * - `polygon` + `from`: cover the shape with metal found elsewhere in the same texture: shifted by (dx, dy), or, with
 *   `mirrorY`, read upside down (source y = mirrorY - y). Colour and roughness use the same source.
 *   These are blended into their surroundings (see `heal`), so each needs clean pixels around it; `rimFrom` leaves out
 *   surroundings left of that column, where a different surface begins.
 * - `box` + `rows`: a cut-off decal piece at an island's edge, replaced by the clean rows [a, b) of the same columns,
 *   mirrored back and forth. In colour they are copied as they are, so the edge between metal and unpainted background
 *   carries straight through; with `blend` (roughness) they are blended like a polygon.
 */
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const BOTH = ['base', 'orm'];
export const REPAIRS = [
  // The left side of the slide: skull, "BANG", skull. The clean metal below the grip serrations covers each of them (the
  // middle one upside down, so the scratches do not repeat side by side). The middle of the third then gets metal from the
  // slide's other face, which keeps this face's own edges and breaks the repeat of the first.
  { name: 'slide skull, front', maps: BOTH, polygon: rect(7, 397, 126, 519), from: { dx: 0, dy: -137 } },
  { name: 'slide BANG', maps: BOTH, polygon: rect(7, 534, 126, 659), from: { mirrorY: 921 } },
  { name: 'slide skull, rear', maps: BOTH, polygon: rect(11, 687, 126, 809), from: { dx: 0, dy: -427 }, rimFrom: 12 },
  { name: 'slide skull, rear, middle', maps: BOTH, polygon: [[24, 697], [108, 697], [116, 750], [108, 801], [24, 801], [16, 750]], from: { dx: 134, dy: 0 } },
  // The tilted skull on the magazine side (the roughness footprint is a larger square than the artwork).
  { name: 'magazine skull', maps: BOTH, polygon: [[97, 1285], [209, 1243], [252, 1358], [139, 1400]], from: { dx: 0, dy: 165 } },
  // Cut-off pieces at the edges of narrow frame surfaces: the artwork in colour, then its footprint in roughness.
  { name: 'frame skull piece', maps: ['base'], box: [1528, 1174, 1590, 1283], rows: [1285, 1322] },
  { name: 'frame BANG piece', maps: ['base'], box: [1528, 1326, 1590, 1436], rows: [1285, 1322] },
  { name: 'edge skull piece', maps: ['base'], box: [1594, 254, 1624, 362], rows: [364, 406] },
  { name: 'edge BANG piece', maps: ['base'], box: [1594, 408, 1624, 512], rows: [364, 406] },
  { name: 'lower skull sliver', maps: ['base'], box: [262, 1268, 290, 1356], rows: [1360, 1415] },
  { name: 'lower BANG sliver', maps: ['base'], box: [262, 1421, 290, 1512], rows: [1360, 1415] },
  { name: 'frame skull footprint', maps: ['orm'], box: [1532, 1175, 1589, 1283], rows: [1285, 1322], blend: true, rimFrom: 1532 },
  { name: 'frame BANG footprint', maps: ['orm'], box: [1532, 1327, 1589, 1434], rows: [1285, 1322], blend: true, rimFrom: 1532 },
  { name: 'edge skull footprint', maps: ['orm'], box: [1595, 256, 1621, 360], rows: [364, 406], blend: true },
  { name: 'edge BANG footprint', maps: ['orm'], box: [1595, 408, 1621, 511], rows: [364, 406], blend: true },
  { name: 'lower skull footprint', maps: ['orm'], box: [267, 1267, 286, 1356], rows: [1360, 1415], blend: true, rimFrom: 267 },
  { name: 'lower BANG footprint', maps: ['orm'], box: [267, 1422, 286, 1511], rows: [1360, 1415], blend: true, rimFrom: 267 },
];

/** Even-odd test at the pixel's centre. */
function inside(polygon, x, y) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, ay] = polygon[i];
    const [bx, by] = polygon[j];
    if (ay > y + 0.5 !== by > y + 0.5 && x + 0.5 < ((bx - ax) * (y + 0.5 - ay)) / (by - ay) + ax) hit = !hit;
  }
  return hit;
}

/** The pixels a repair covers, as [x, y] pairs. */
export function repairPixels(repair) {
  const polygon = repair.polygon ?? rect(...repair.box);
  const xs = polygon.map((p) => p[0]);
  const ys = polygon.map((p) => p[1]);
  const out = [];
  for (let y = Math.min(...ys); y < Math.max(...ys); y++) for (let x = Math.min(...xs); x < Math.max(...xs); x++) if (inside(polygon, x, y)) out.push([x, y]);
  return out;
}

/** Where a copied pixel is read from. */
function sourceOf(repair) {
  if (repair.rows) {
    const [a, b] = repair.rows;
    const n = b - a;
    return (x, y) => {
      const k = (((y - a) % (2 * n)) + 2 * n) % (2 * n);
      return [x, a + (k < n ? k : 2 * n - 1 - k)];
    };
  }
  const { dx = 0, dy = 0, mirrorY } = repair.from;
  return mirrorY === undefined ? (x, y) => [x + dx, y + dy] : (x, y) => [x, mirrorY - y];
}

/** Radius of the patch of surroundings sampled at each point of a repair's rim. */
const RIM = 6;
const median = (v) => v.sort((a, b) => a - b)[v.length >> 1];

/**
 * Cover the repair's pixels with source pixels, then add the smooth correction that makes them meet their surroundings:
 * the harmonic surface whose value on the rim around the shape is (surroundings - source), each the median of a small
 * patch so scratches on the rim do not tint the fill. The source's grain and scratches survive; only its shading
 * moves to match. Sources are read from the untouched `original`, surroundings from `out` (earlier repairs included).
 */
function heal(out, original, repair) {
  const at = (x, y) => (y * SIZE + x) * 3;
  const source = sourceOf(repair);
  const pixels = repairPixels(repair);
  const index = new Map(pixels.map(([x, y], i) => [y * SIZE + x, i]));
  const n = pixels.length;
  const fix = new Float64Array(n * 3);
  const sum = new Float64Array(n * 3);
  const rim = new Map();
  const rimAt = (x, y) => {
    let v = rim.get(y * SIZE + x);
    if (v !== undefined) return v;
    const seen = [[], [], []];
    for (let qy = y - RIM; qy <= y + RIM; qy++) {
      for (let qx = x - RIM; qx <= x + RIM; qx++) {
        if (qx < (repair.rimFrom ?? 0) || qy < 0 || index.has(qy * SIZE + qx)) continue;
        const [sx, sy] = source(qx, qy);
        for (let c = 0; c < 3; c++) seen[c].push(out[at(qx, qy) + c] - original[at(sx, sy) + c]);
      }
    }
    // Nothing to match on this stretch of the rim: the correction is left free there.
    v = seen[0].length ? seen.map(median) : null;
    rim.set(y * SIZE + x, v);
    return v;
  };
  const terms = new Uint8Array(n);
  const neighbours = pixels.map(([x, y], i) => {
    const inner = [];
    for (const [qx, qy] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      const j = index.get(qy * SIZE + qx);
      if (j !== undefined) {
        inner.push(j);
        terms[i]++;
        continue;
      }
      const v = rimAt(qx, qy);
      if (!v) continue;
      terms[i]++;
      for (let c = 0; c < 3; c++) sum[i * 3 + c] += v[c];
    }
    return inner;
  });
  // Successive over-relaxation; these shapes (about 125 px across) are settled well within the passes.
  for (let pass = 0; pass < 600; pass++) {
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 3; c++) {
        let v = sum[i * 3 + c];
        for (const j of neighbours[i]) v += fix[j * 3 + c];
        fix[i * 3 + c] += 1.9 * (v / terms[i] - fix[i * 3 + c]);
      }
    }
  }
  pixels.forEach(([x, y], i) => {
    const [sx, sy] = source(x, y);
    for (let c = 0; c < 3; c++) out[at(x, y) + c] = Math.max(0, Math.min(255, Math.round(original[at(sx, sy) + c] + fix[i * 3 + c])));
  });
}

/** One map ('base', 'orm' or 'normal') with its repairs applied. Sources are read from the untouched `original`. */
export function repairMap(original, map) {
  const out = Buffer.from(original);
  for (const repair of REPAIRS) {
    if (!repair.maps.includes(map)) continue;
    if (!repair.rows || repair.blend) {
      heal(out, original, repair);
      continue;
    }
    const source = sourceOf(repair);
    for (const [x, y] of repairPixels(repair)) {
      const [sx, sy] = source(x, y);
      original.copy(out, (y * SIZE + x) * 3, (sy * SIZE + sx) * 3, (sy * SIZE + sx) * 3 + 3);
    }
  }
  return out;
}

function colt(doc, where) {
  const m = doc.getRoot().listMaterials().find((x) => x.getName() === MATERIAL);
  if (!m) throw new Error(`${where}: no material ${MATERIAL}`);
  const maps = { base: m.getBaseColorTexture(), orm: m.getMetallicRoughnessTexture(), normal: m.getNormalTexture() };
  for (const [name, tex] of Object.entries(maps)) if (!tex) throw new Error(`${where}: material ${MATERIAL} has no ${name} texture`);
  return { material: m, maps };
}

/** Replace the three gun textures of `doc` (a built pistol model) with those of the 2K glTF at `sourcePath`. */
export async function applyPistolTextures(doc, io, sourcePath) {
  if (!existsSync(sourcePath)) throw new Error(`no 2048 px pistol source at ${sourcePath}`);
  const source = colt(await io.read(sourcePath), sourcePath);
  const target = colt(doc, 'pistol model');
  for (const name of ['base', 'orm', 'normal']) {
    const rgb = decodeRgb(source.maps[name].getImage(), `${sourcePath} ${name}`);
    target.maps[name].setImage(encodeWebp(repairMap(rgb, name))).setMimeType('image/webp');
  }
  // Roughness/metalness and occlusion are one packed texture; keep them one.
  if (target.material.getOcclusionTexture() && target.material.getOcclusionTexture() !== target.maps.orm) {
    throw new Error('pistol model: occlusion is not packed with roughness/metalness');
  }
}
