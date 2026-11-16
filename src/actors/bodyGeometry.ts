import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../core/rng.ts';
import { clothPatch, heroColor, heroFace, heroScalpTorn, sculptHeroHead, sculptHero, tatterColor, tatterStrip } from './heroSculpt.ts';
import { fbm3, noise3 } from './noise3.ts';
import { HERO_NECK, HERO_NECK_EXTRA, JOINTS, jointDef, type JointName, type SegmentDef, type Side, type Vec3T } from './skeleton.ts';

/**
 * Procedural body meshes (ADR-0006). Every piece is built in the local space of the bone
 * that moves it, with `position`, `normal`, `color`, `aSkin`, `aGlow` and `aRot` attributes,
 * so it can be merged into the skinned body (rigid weights) or into a severed debris mesh.
 *
 * `aRot` marks where the bloom tears cloth and flesh and where blood runs (eyes, mouth,
 * collar); `aGlow` marks eyes, pustules and tendril tips. Both stay invisible on a healthy
 * body: the shader reveals them as infection rises, so one body can transform on cue.
 */

export const OUTFITS = ['security', 'engineer', 'medic', 'lab', 'crew'] as const;
export type Outfit = (typeof OUTFITS)[number];

/** Signature props a named character can carry (ADR-0022 / docs/characters.md). */
export type LookProp = 'glasses' | 'glassesOnHead' | 'penlight' | 'stethoscope' | 'multitool' | 'hiVis' | 'chestPatch' | 'grease';

/**
 * Hand-set appearance for named characters. Anything left out stays seeded, so crowds are unchanged.
 */
export interface Look {
  skin?: string;
  /** Hair colour, or null for bald. */
  hair?: string | null;
  /** Hairline height in head space (0.13..0.15 seeded; higher = receding). */
  hairLine?: number;
  /** Extra recession at the temples (0..1). */
  recede?: number;
  /** Close-cropped: scalp shows through the hair. */
  cropped?: boolean;
  /** Hair volume: 'curly' builds a curly mop that stands up on top. */
  hairStyle?: 'curly';
  /** Half-width of the visible mouth in metres (seeded bodies use the full face width). */
  mouth?: number;
  facial?: 'stubble' | 'beard' | null;
  facialColor?: string;
  /** Dark under the eyes. 0..1. */
  tired?: number;
  jaw?: number;
  nose?: number;
  /** Override the outfit's sleeve rule. */
  rolled?: boolean;
  props?: readonly LookProp[];
}

export interface BodyShape {
  outfit: Outfit;
  look?: Look;
  /** Metres; 1.78 is the reference. */
  height: number;
  /** Width multiplier, ~0.85 (slight) to 1.2 (heavy). */
  build: number;
  /** Build growths, ribs, tendrils and wounds (any infected or scripted body). */
  infectable: boolean;
  /** Hero tier: sculpted muscle, torn skin and tattered cloth (~40-60k triangles). */
  hero?: boolean;
  seed: string;
}

export const TENDRILS = 3;
export const TENDRIL_SEGMENTS = 4;

/** Bones that are not joints: they scale infection detail and stump caps in and out. */
export type ExtraBone =
  | 'growth_shoulder_L' | 'growth_shoulder_R' | 'growth_jaw' | 'growth_spine'
  | 'shards_arm' | 'shards_leg' | 'ribs'
  | `tendril_${number}_${number}`
  | `cloth_${number}_${number}`
  | `stump_${JointName}`;

export interface ExtraBoneDef {
  name: ExtraBone;
  parent: JointName | ExtraBone;
  offset: Vec3T;
  kind: 'growth' | 'shards' | 'ribs' | 'tendril' | 'cloth' | 'stump';
  /** Rest rotation (radians, XYZ) for bones that aim somewhere (tendril roots). */
  rest?: Vec3T;
}

/**
 * Skins a piece along a chain of bones by height instead of rigidly. `bones[0]` is the piece's own bone;
 * `ys[k]` is the height of bone k's pivot in that bone's space. A vertex between two pivots blends the
 * two bones, above the first pivot it follows `bones[0]`, below the last it follows the last bone.
 */
export interface ClothChain {
  bones: Array<JointName | ExtraBone>;
  ys: number[];
}

export interface PartGeometry {
  /** Joint or extra bone that owns the piece. */
  bone: JointName | ExtraBone;
  /** Matte material (skin, cloth) or wet material (flesh, growths, stumps). */
  layer: 'body' | 'wet';
  geometry: THREE.BufferGeometry;
  /** Cloth that bends along a bone chain (coat tails). */
  chain?: ClothChain;
}

export interface BodyGeometry {
  parts: PartGeometry[];
  extraBones: ExtraBoneDef[];
  /** `y`: uniform scale on the root bone for height; `w`: width (build) on x offsets and radii. */
  scale: { y: number; w: number };
  /** Per-body joint offsets that replace the reference skeleton's (hero neck/head). */
  jointOffsets: Partial<Record<JointName, Vec3T>>;
  skinTone: THREE.Color;
}

/** Attributes every piece carries (tests check this so merging never fails). */
export const BODY_ATTRIBUTES = ['aGlow', 'aRot', 'aSkin', 'color', 'normal', 'position'] as const;

/** Joints whose loss leaves a stump on the parent (ADR-0006 severing). */
export const STUMP_JOINTS: readonly JointName[] = [
  'head', 'upperArm_L', 'foreArm_L', 'upperArm_R', 'foreArm_R', 'thigh_L', 'shin_L', 'thigh_R', 'shin_R',
];

interface Scheme {
  suit: string;
  /** Vest, jacket or coat colour; null for none. */
  over: string | null;
  coat: boolean;
  boots: string;
  belt: string;
  /** Rolled sleeves: forearms show skin. */
  rolled: boolean;
}

const SCHEMES: Record<Outfit, Scheme> = {
  security: { suit: '#1c2631', over: '#2c3034', coat: false, boots: '#0c0d0f', belt: '#151515', rolled: false },
  engineer: { suit: '#7a4818', over: null, coat: false, boots: '#2a1d12', belt: '#33261a', rolled: true },
  medic: { suit: '#2c5256', over: '#c4c8c3', coat: false, boots: '#18191b', belt: '#202224', rolled: false },
  lab: { suit: '#45474a', over: '#cbc8bd', coat: true, boots: '#1a1a1b', belt: '#1a1a1b', rolled: false },
  crew: { suit: '#3d4246', over: null, coat: false, boots: '#141517', belt: '#1d1f21', rolled: false },
};

const SKIN_TONES = ['#f0c6a6', '#e3b08e', '#cf9471', '#b07650', '#8f5c3d', '#6a412b', '#4e2f1f', '#d9a27f'];
const HAIR = ['#17120e', '#2c1f15', '#4a3020', '#6f5236', '#121212', '#5d5b57', '#a07a4c'];
const FLESH = new THREE.Color('#5a1c22');
const FLESH_DARK = new THREE.Color('#240a10');
const FLESH_RAW = new THREE.Color('#7a2a2e');
const PUS = new THREE.Color('#8a8a4a');
const BONE = new THREE.Color('#d6cbb2');
const BONE_OLD = new THREE.Color('#b8a98a');
const CUT = new THREE.Color('#3d0709');
const MOUTH = new THREE.Color('#2a0709');
const TONGUE = new THREE.Color('#4e1418');

/** Per-vertex extras a painter may set (both default to 0). */
interface Fx {
  glow: number;
  rot: number;
}

type Painter = (p: THREE.Vector3, out: THREE.Color, fx: Fx) => number; // returns aSkin (0/1)

// ---------------------------------------------------------------- primitives

/** Closed tapered capsule from y0 to y1 (either order), scaled in x/z. */
export function taperedCapsule(s: SegmentDef, radial = 10, rings = 8, capSeg = 4): THREE.BufferGeometry {
  const bottomY = Math.min(s.y0, s.y1);
  const topY = Math.max(s.y0, s.y1);
  const rBottom = s.y0 < s.y1 ? s.r0 : s.r1;
  const rTop = s.y0 < s.y1 ? s.r1 : s.r0;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= capSeg; i++) {
    const a = -Math.PI / 2 + (i / capSeg) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(1e-4, rBottom * Math.cos(a)), bottomY + rBottom * Math.sin(a)));
  }
  for (let i = 1; i < rings; i++) {
    const t = i / rings;
    pts.push(new THREE.Vector2(rBottom + (rTop - rBottom) * t, bottomY + (topY - bottomY) * t));
  }
  for (let i = 0; i <= capSeg; i++) {
    const a = (i / capSeg) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(1e-4, rTop * Math.cos(a)), topY + rTop * Math.sin(a)));
  }
  const g = new THREE.LatheGeometry(pts, radial);
  g.scale(s.sx, 1, s.sz);
  return clean(g);
}

/** Drop uv/normal and weld seams so displacement and normals are smooth. */
function clean(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const merged = mergeVertices(g, 1e-5);
  g.dispose();
  merged.computeVertexNormals();
  return merged;
}

/** Push vertices along their normals by seeded noise, then recompute normals. */
function displace(g: THREE.BufferGeometry, amp: number, freq: number, seed: number, octaves = 2): void {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = fbm3(x * freq, y * freq, z * freq, seed, octaves) * amp;
    pos.setXYZ(i, x + nrm.getX(i) * n, y + nrm.getY(i) * n, z + nrm.getZ(i) * n);
  }
  g.computeVertexNormals();
}

/**
 * Write colour/aSkin/aGlow/aRot. With `blotch`, seeded patches are added to aRot so the bloom
 * eats through cloth and skin in irregular holes.
 */
function paint(g: THREE.BufferGeometry, painter: Painter, blotch: number | null = null): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const skin = new Float32Array(pos.count);
  const glow = new Float32Array(pos.count);
  const rot = new Float32Array(pos.count);
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  const fx: Fx = { glow: 0, rot: 0 };
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    fx.glow = 0;
    fx.rot = 0;
    skin[i] = painter(p, c, fx);
    if (blotch !== null) {
      const n = fbm3(p.x * 13, p.y * 13, p.z * 13, blotch, 3);
      // Wet surfaces (negative aRot) keep their gloss; elsewhere the infection blotches show through.
      if (fx.rot >= 0) fx.rot = Math.max(fx.rot, THREE.MathUtils.smoothstep(n + 0.25 * noise3(p.x * 60, p.y * 60, p.z * 60, blotch + 9), 0.16, 0.6));
    }
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
    glow[i] = fx.glow;
    rot[i] = fx.rot;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('aSkin', new THREE.BufferAttribute(skin, 1));
  g.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
  g.setAttribute('aRot', new THREE.BufferAttribute(rot, 1));
  return g;
}

const solid = (color: THREE.Color, skin = 0): Painter => (_p, out) => {
  out.copy(color);
  return skin;
};

/** Slight per-vertex variation so flat colours read as material, not plastic. */
function mottle(base: THREE.Color, p: THREE.Vector3, seed: number, amount: number, out: THREE.Color): THREE.Color {
  const n = noise3(p.x * 40, p.y * 40, p.z * 40, seed) * amount;
  return out.copy(base).multiplyScalar(1 + n);
}

/** Vertical blood runs: 1 inside a streak hanging below `top`, 0 elsewhere. */
function streak(x: number, y: number, top: number, seed: number, density = 90, maxLen = 0.14): number {
  const col = Math.floor(x * density);
  const len = 0.02 + maxLen * (0.5 + 0.5 * noise3(col * 0.71, 0.3, 0.9, seed));
  const width = Math.abs((x * density - col) - 0.5);
  if (y > top || y < top - len || width > 0.32) return 0;
  // Fade toward the drip's end.
  return 1 - Math.max(0, (top - y) / len - 0.7) / 0.3;
}

// ---------------------------------------------------------------- builders

interface Ctx {
  rng: Rng;
  seed: number;
  w: number;
  scheme: Scheme;
  skin: THREE.Color;
  suit: THREE.Color;
  over: THREE.Color | null;
  boots: THREE.Color;
  belt: THREE.Color;
  hair: THREE.Color | null;
  look: Look;
  outfit: Outfit;
  infectable: boolean;
  hero: boolean;
  parts: PartGeometry[];
}

function add(ctx: Ctx, bone: PartGeometry['bone'], layer: PartGeometry['layer'], g: THREE.BufferGeometry, chain?: ClothChain): void {
  ctx.parts.push(chain ? { bone, layer, geometry: g, chain } : { bone, layer, geometry: g });
}

function scaledSeg(s: SegmentDef, w: number): SegmentDef {
  return { ...s, r0: s.r0 * w, r1: s.r1 * w };
}

function limbSegment(ctx: Ctx, name: JointName, painter: Painter, radial = 10, rings = 8): void {
  const def = jointDef(name);
  if (!def.segment) return;
  const segment = ctx.hero && name === 'neck' ? HERO_NECK : def.segment;
  if (ctx.hero) {
    const hg = taperedCapsule(scaledSeg(segment, ctx.w), 40, 28, 6);
    sculptHero(hg, name, ctx.seed);
    add(ctx, name, 'body', paint(hg, (p, out, fx) => heroColor(name, p, ctx.seed, ctx.skin, out, fx), null));
    return;
  }
  const g = taperedCapsule(scaledSeg(segment, ctx.w), radial, rings);
  displace(g, 0.004, 9, ctx.seed + def.name.length * 13);
  add(ctx, name, 'body', paint(g, painter, ctx.infectable ? ctx.seed + name.length * 7 : null));
}

/** Long, crooked fangs for hero mouths: upper row on the skull, lower row on the jaw. */
function heroTeeth(ctx: Ctx): void {
  const rng = ctx.rng.fork('fangs');
  for (const lower of [false, true]) {
    const list: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 10; k++) {
      const x = -0.032 + (k / 9) * 0.064;
      const z = -0.077 + 0.018 * (x / 0.03) ** 2;
      const len = rng.range(0.016, 0.034) * (lower ? 0.85 : 1) * (k % 3 === 0 ? 1.45 : 1);
      const tooth = clean(new THREE.ConeGeometry(0.0044, len, 5, 1));
      if (!lower) tooth.rotateX(Math.PI);
      tooth.rotateZ(rng.range(-0.25, 0.25));
      tooth.rotateX(rng.range(-0.15, 0.15));
      const y = lower ? MOUTH_Y + len / 2 : MOUTH_Y - len / 2;
      tooth.translate(x, y - (lower ? JAW_HINGE[1] : 0), z - (lower ? JAW_HINGE[2] : 0) + rng.range(-0.002, 0.002));
      list.push(tooth);
    }
    const g = clean(list.reduce((acc, t) => mergeTwo(acc, t)));
    add(ctx, lower ? 'jaw' : 'head', 'body', paint(g, (_p, c) => {
      c.copy(BONE).lerp(BONE_OLD, rng.range(0.2, 0.9));
      return 0;
    }));
  }
}

/** Hero jaw baked open (radians) and stretched downward, so the mouth gapes even from eye level. */
const HERO_JAW_GAPE = 0.6;
const HERO_JAW_DROP = 1.12;
const HERO_HEAD_SCALE = 1.22;

/** Where a point given in the shut, unscaled jaw (head space) ends up after enlargeHead, in head space. */
function heroJawPoint(x: number, y: number, z: number): THREE.Vector3 {
  const h = JAW_HINGE;
  const p = new THREE.Vector3(x - h[0], (y - h[1]) * HERO_JAW_DROP, z - h[2]);
  p.applyAxisAngle(new THREE.Vector3(1, 0, 0), -HERO_JAW_GAPE);
  return p.add(new THREE.Vector3(h[0], h[1], h[2])).multiplyScalar(HERO_HEAD_SCALE);
}

/**
 * Hero face detail added after the head is enlarged (head space):
 * strands of cheek flesh stretched across the gape, skinned between skull and jaw so they stretch as it opens,
 * gums along both rows of fangs, and clusters of glowing bloom growths on one side of the face.
 */
function heroFaceDetail(ctx: Ctx): void {
  const k = HERO_HEAD_SCALE;
  const rng = ctx.rng.fork('face');
  const flesh = fleshPainter(ctx.seed + 401, 0.9);
  const wetFlesh: Painter = (p, out, fx) => {
    flesh(p, out, fx);
    out.lerp(FLESH_RAW, 0.5);
    fx.rot = -1;
    return 0;
  };
  // Cheek strands: three a side between the upper and lower lip corners, sagging under their own weight.
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const x = s * (0.03 + i * 0.008);
      const z = -0.072 + i * 0.008;
      const top = new THREE.Vector3(x, MOUTH_Y + 0.002, z).multiplyScalar(k);
      const bot = heroJawPoint(x, MOUTH_Y - 0.002, z);
      const mid = top.clone().lerp(bot, 0.5);
      mid.z -= 0.006 * k;
      mid.x += s * rng.range(0.002, 0.006);
      const curve = new THREE.CatmullRomCurve3([top, mid, bot]);
      const tube = clean(new THREE.TubeGeometry(curve, 8, rng.range(0.0022, 0.0038) * k, 5, false));
      add(ctx, 'head', 'wet', paint(tube, wetFlesh), { bones: ['head', 'jaw'], ys: [top.y, bot.y] });
    }
  }
  // Gums: a swollen ridge of raw tissue at the roots of each row of fangs.
  const gum = (lower: boolean): THREE.BufferGeometry => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const x = -0.034 + (i / 8) * 0.068;
      const z = -0.075 + 0.018 * (x / 0.03) ** 2;
      pts.push(lower ? heroJawPoint(x, MOUTH_Y + 0.001, z) : new THREE.Vector3(x, MOUTH_Y - 0.001, z).multiplyScalar(k));
    }
    return paint(clean(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.0045 * k, 5, false)), wetFlesh);
  };
  add(ctx, 'head', 'wet', gum(false));
  const lowerGum = gum(true);
  lowerGum.translate(-JAW_HINGE[0], -JAW_HINGE[1], -JAW_HINGE[2]);
  add(ctx, 'jaw', 'wet', lowerGum);
  // Bloom growths: a glowing cluster over one temple and cheek, a smaller one on the jaw.
  const side = rng.chance(0.5) ? -1 : 1;
  const cluster: Array<[number, number, number, number]> = [
    [0.062, 0.12, -0.05, 0.012], [0.07, 0.105, -0.04, 0.009], [0.055, 0.135, -0.04, 0.008], [0.066, 0.09, -0.055, 0.007],
    [0.075, 0.125, -0.025, 0.0075], [0.048, 0.145, -0.055, 0.006], [0.058, 0.078, -0.065, 0.0055],
  ];
  cluster.forEach(([x, y, z, r], i) => add(ctx, 'head', 'wet', growthBlob(ctx, r * k, new THREE.Vector3(side * x, y, z).multiplyScalar(k), 430 + i)));
  const jawBlobs: Array<[number, number, number, number]> = [[0.05, 0.03, -0.055, 0.008], [0.058, 0.04, -0.045, 0.006], [0.042, 0.022, -0.065, 0.005]];
  jawBlobs.forEach(([x, y, z, r], i) => {
    const at = heroJawPoint(side * x, y, z).sub(new THREE.Vector3(JAW_HINGE[0], JAW_HINGE[1], JAW_HINGE[2]));
    add(ctx, 'jaw', 'wet', growthBlob(ctx, r * k, at, 450 + i));
  });
}

/** Hero eyes: bloodshot dark sclera with one small hot pupil that glows, instead of a milky white ball. */
function heroEye(g: THREE.BufferGeometry, c: THREE.Vector3): void {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const col = g.getAttribute('color') as THREE.BufferAttribute;
  const glow = g.getAttribute('aGlow') as THREE.BufferAttribute;
  const skin = g.getAttribute('aSkin') as THREE.BufferAttribute;
  const sclera = new THREE.Color('#3a0e0e');
  const iris = new THREE.Color('#c8e8a0');
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i) - c.x;
    const ly = pos.getY(i) - c.y;
    const front = pos.getZ(i) < c.z - 0.006;
    const pupil = front && Math.hypot(lx, ly) < 0.0042;
    const cc = pupil ? iris : sclera;
    col.setXYZ(i, cc.r, cc.g, cc.b);
    glow.setX(i, pupil ? 1 : 0);
    skin.setX(i, 0);
  }
}

/** Bigger head for hero bodies; the jaw keeps meeting the skull at its hinge. */
function enlargeHead(ctx: Ctx, k: number): void {
  const hinge = JAW_HINGE;
  for (const part of ctx.parts) {
    if (part.bone === 'head') {
      if (part.geometry.getAttribute('position').count > 300) sculptHeroHead(part.geometry, [0, 0, 0]);
      part.geometry.computeBoundingBox();
      const bb = part.geometry.boundingBox;
      // Eyes (small pieces high on the face): smaller, so they read as glints in hollow sockets.
      if (bb && part.geometry.getAttribute('position').count <= 80 && bb.min.y > 0.1) {
        const c = bb.getCenter(new THREE.Vector3());
        part.geometry.translate(-c.x, -c.y, -c.z);
        part.geometry.scale(0.68, 0.68, 0.68);
        part.geometry.translate(c.x, c.y, c.z + 0.006);
        heroEye(part.geometry, c);
      }
      part.geometry.scale(k, k, k);
    } else if (part.bone === 'jaw') {
      if (part.geometry.getAttribute('position').count > 300) sculptHeroHead(part.geometry, hinge);
      // Jaw hangs open and dislocated at rest (dropped and stretched); the animator adds to it.
      part.geometry.scale(1, HERO_JAW_DROP, 1);
      part.geometry.rotateX(-HERO_JAW_GAPE);
      part.geometry.scale(k, k, k);
      part.geometry.translate((k - 1) * hinge[0], (k - 1) * hinge[1], (k - 1) * hinge[2]);
    }
  }
}

/** Coat-tail chains: bones hung from the spine that the tails are skinned along, so they bend and sway. */
export const COAT_CHAINS = 3;
const COAT_CHAIN_SEGMENTS = 2;
/** Spine-local heights of the coat's top edge and of each chain bone's pivot. */
const COAT_PIVOT_Y = [0.1, -0.12, -0.34] as const;

/** Coat, collar, lapels, sleeves, tie and trouser shreds on the sculpted hero body. */
function buildTatters(ctx: Ctx, extra: ExtraBoneDef[]): void {
  // Grimy, not white: a clean lab coat blows out under the flashlight.
  const coat = new THREE.Color('#a8a292');
  const lining = new THREE.Color('#8c8678');
  const trou = new THREE.Color('#3a3d3f');
  const tie = new THREE.Color('#2c3d52');
  const r = ctx.rng.fork('tatter');
  const W = ctx.w;
  const strip = (bone: JointName, x: number, y: number, z: number, w: number, len: number, curl: number, rotY: number, rotZ: number, base: THREE.Color, jag = 0.5, chain?: ClothChain): void => {
    const g = tatterStrip(w, len, curl, jag, Math.floor(r.next() * 1e5));
    g.rotateZ(rotZ);
    g.rotateY(rotY);
    g.translate(x, y, z);
    add(ctx, bone, 'body', paint(g, (p, out) => tatterColor(p, ctx.seed, base, out, y - len), null), chain);
  };
  const patch = (bone: JointName, g: THREE.BufferGeometry, base: THREE.Color, hemY: number): void => {
    add(ctx, bone, 'body', paint(g, (p, out) => tatterColor(p, ctx.seed, base, out, hemY), null));
  };

  // Coat tails: back and sides, ragged and uneven. Pairs of tails share a chain of two sway bones.
  const tails: Array<[number, number, number, number, number, number]> = [
    [-0.17, 0.1, 0.06, 0.62, -0.1, 0.5], [-0.1, 0.1, 0.1, 0.78, -0.08, 0.25], [-0.03, 0.1, 0.12, 0.6, -0.06, 0.05],
    [0.04, 0.1, 0.12, 0.82, -0.08, -0.08], [0.11, 0.1, 0.1, 0.66, -0.08, -0.3], [0.18, 0.1, 0.06, 0.58, -0.1, -0.55],
  ];
  const chains: ClothChain[] = [];
  for (let c = 0; c < COAT_CHAINS; c++) {
    const bones: ClothChain['bones'] = ['spine'];
    const pair = [tails[c * 2], tails[c * 2 + 1]];
    const cx = ((pair[0]?.[0] ?? 0) + (pair[1]?.[0] ?? 0)) * 0.5 * W * 1.1;
    for (let k = 0; k < COAT_CHAIN_SEGMENTS; k++) {
      const name: ExtraBone = `cloth_${c}_${k}`;
      bones.push(name);
      extra.push({
        name,
        parent: k === 0 ? 'spine' : `cloth_${c}_${k - 1}`,
        offset: k === 0 ? [cx, COAT_PIVOT_Y[1], 0.1 * W] : [0, COAT_PIVOT_Y[2] - COAT_PIVOT_Y[1], 0],
        kind: 'cloth',
      });
    }
    chains.push({ bones, ys: [...COAT_PIVOT_Y] });
  }
  tails.forEach(([x, y, z, len, curl, rotY], k) => strip('spine', x * W * 1.1, y, z * W, 0.15, len, curl, rotY, 0, coat, 0.6, chains[Math.floor(k / 2)]));

  // Collar: a thick band standing up around the neck, tallest at the back and torn open at the front.
  patch('chest', clothPatch(22, 5, (u, v) => {
    const th = -2.5 + u * 5.0;
    const k = 0.55 + 0.45 * Math.cos(th * 0.62);
    const rad = (0.092 + 0.05 * v ** 1.5) * W;
    return [rad * Math.sin(th), 0.2 + 0.11 * k * v, rad * Math.cos(th)];
  }, 1, 0.006, 0.35, ctx.seed + 31), coat, 0.2);

  // Lapels: a rolled panel each side of the chest opening, torn at the bottom.
  for (const s of [-1, 1] as const) {
    patch('chest', clothPatch(8, 12, (u, v) => {
      const w = 0.03 + 0.055 * Math.sin(Math.PI * v ** 0.6);
      const x = s * (0.04 + 0.02 * v) + s * u * w;
      const z = -0.145 * W - 0.03 * Math.sin(u * Math.PI * 0.85) * (1 - 0.4 * v);
      return [x, 0.235 - 0.19 * v, z];
    }, s > 0 ? 1 : -1, 0.006, 0.45, ctx.seed + 41 + s), lining, 0);
  }

  // Tie.
  strip('chest', 0.0, 0.215, -0.125 * W, 0.04, 0.17, -0.05, 0, 0, tie, 0.5);

  // Sleeve remnants: an open cuff of coat left on each upper arm, the left almost whole, the right shredded.
  for (const [side, bone, len, jag] of [[-1, 'upperArm_L', 0.27, 0.35], [1, 'upperArm_R', 0.13, 0.7]] as Array<[number, JointName, number, number]>) {
    patch(bone, clothPatch(16, 6, (u, v) => {
      const th = 0.5 + u * (Math.PI * 2 - 1.0);
      const rad = (0.098 - 0.018 * v) * W;
      return [rad * Math.sin(th), 0.04 - v * len, rad * Math.cos(th)];
    }, -1, 0.006, jag, ctx.seed + 51 + side), coat, 0.04 - len);
    // A flap hanging loose from the cuff.
    strip(bone, side * 0.0, 0.0, -0.1 * W, 0.07, len * 0.9, -0.03, 0.6 * side, 0, coat, 0.7);
  }

  // Trouser shreds below the belt.
  for (const [side, bone] of [[-1, 'thigh_L'], [1, 'thigh_R']] as Array<[number, JointName]>) {
    for (let i = 0; i < 3; i++) strip(bone, side * (i - 1) * 0.055 * W, -0.3, (i === 1 ? -0.06 : 0.04) * W, 0.07, 0.3, -0.03, i * 0.5, 0, trou, 0.8);
  }
}

function buildTorso(ctx: Ctx): void {
  const { suit, over, scheme, seed } = ctx;
  const cloth = (base: THREE.Color): Painter => (p, out) => {
    mottle(base, p, seed, 0.06, out);
    return 0;
  };
  limbSegment(ctx, 'pelvis', cloth(suit), 14, 6);
  limbSegment(ctx, 'spine', cloth(over && scheme.coat ? over : suit), 14, 6);
  // Chest: blood has run from the mouth down the front.
  const chestBase = over && scheme.coat ? over : suit;
  limbSegment(ctx, 'chest', (p, out, fx) => {
    mottle(chestBase, p, seed, 0.06, out);
    if (p.z < -0.04) fx.rot = streak(p.x, p.y, 0.25, seed + 3, 70, 0.18);
    if (ctx.infectable && p.z < 0) fx.rot = Math.max(fx.rot, 1.15 * gauss(p.x * 0.75, p.y, 0, 0, 0.1, 0, 0.1 + 0.02 * noise3(p.x * 50, p.y * 50, 0, seed)));
    return 0;
  }, 14, 8);
  // Neck is skin; collar band at the base.
  limbSegment(ctx, 'neck', (p, out, fx) => {
    if (p.y < 0.0) {
      out.copy(over ?? suit);
      return 0;
    }
    mottle(ctx.skin, p, seed, 0.05, out);
    if (p.z < -0.02) fx.rot = streak(p.x, p.y, 0.1, seed + 4, 70, 0.12);
    return 1;
  }, 8, 4);

  // Vest / jacket over the chest.
  if (over && !scheme.coat) {
    const vest = taperedCapsule({ y0: -0.03, y1: 0.215, r0: 0.158 * ctx.w, r1: 0.142 * ctx.w, sx: 1.33, sz: 0.86 }, 14, 6, 3);
    displace(vest, 0.003, 14, seed + 7);
    add(ctx, 'chest', 'body', paint(vest, (p, out, fx) => {
      mottle(over, p, seed, 0.06, out);
      if (p.z < -0.04) fx.rot = streak(p.x, p.y, 0.23, seed + 5, 70, 0.2);
      if (ctx.infectable && p.z < 0) fx.rot = Math.max(fx.rot, 1.15 * gauss(p.x * 0.75, p.y, 0, 0, 0.1, 0, 0.11 + 0.02 * noise3(p.x * 50, p.y * 50, 0, seed)));
      return 0;
    }, ctx.infectable ? seed + 21 : null));
  }
  // Lab coat hem (a short flared skirt so it doesn't clip the thighs).
  if (over && scheme.coat && !ctx.hero) {
    const hem = taperedCapsule({ y0: 0.06, y1: -0.2, r0: 0.152 * ctx.w, r1: 0.172 * ctx.w, sx: 1.2, sz: 0.88 }, 16, 6, 2);
    displace(hem, 0.006, 6, seed + 11);
    add(ctx, 'pelvis', 'body', paint(hem, cloth(over), ctx.infectable ? seed + 23 : null));
  }
  // Belt.
  const belt = taperedCapsule({ y0: 0.07, y1: 0.11, r0: 0.152 * ctx.w, r1: 0.152 * ctx.w, sx: 1.22, sz: 0.84 }, 14, 1, 1);
  add(ctx, 'pelvis', 'body', paint(belt, solid(ctx.belt)));
  if (ctx.outfit === 'engineer' || ctx.outfit === 'security') {
    for (const sx of [-1, 1]) {
      const pouch = new THREE.BoxGeometry(0.07, 0.08, 0.05, 1, 1, 1);
      pouch.translate(sx * 0.15 * ctx.w, 0.06, 0.02);
      add(ctx, 'pelvis', 'body', paint(clean(pouch), solid(ctx.belt)));
    }
  }
}

// ---------------------------------------------------------------- hair volume

/**
 * A curly mop: a shell around the scalp pushed out by curl noise, thickest on top so it
 * stands up. Outside the hair region the shell tucks inside the skull, so it stays watertight.
 */
function buildCurlyHair(ctx: Ctx, hairLine: number, recede: number): void {
  const hair = ctx.hair!;
  const seed = ctx.seed;
  const g = clean(new THREE.SphereGeometry(1, 40, 30));
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const amount = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const x = p.x * 0.082;
    const y = p.y * 0.112 + 0.1;
    let z = p.z * 0.1;
    if (z > 0 && y > 0.08) z *= 1.08;
    if (z < 0) z *= 0.94;
    const line = hairLine + recede * 0.025 * Math.min(1, Math.abs(x) / 0.06) * (z < 0 ? 1 : 0);
    // Hair region weight: above the hairline at the front, down to the nape at the back.
    const front = THREE.MathUtils.smoothstep(y, line - 0.004, line + 0.012);
    const back = z > 0.0 ? THREE.MathUtils.smoothstep(y, 0.045, 0.075) * THREE.MathUtils.smoothstep(z, -0.01, 0.03) : 0;
    const sides = Math.abs(x) > 0.06 ? THREE.MathUtils.smoothstep(y, 0.105, 0.125) : 0;
    const w = Math.max(front, back, sides);
    n.set(x / 0.082, (y - 0.1) / 0.112, z / 0.1).normalize();
    const top = THREE.MathUtils.smoothstep(n.y, 0.2, 0.95);
    const curl = noise3(x * 70, y * 70, z * 70, seed + 41) * 0.009 + noise3(x * 170, y * 170, z * 170, seed + 42) * 0.005;
    const thick = w * (0.012 + 0.03 * top + curl);
    const inset = w > 0.02 ? 1 : 0.94;
    pos.setXYZ(i, x * inset + n.x * thick, y * inset + 0.1 * (1 - inset) + n.y * thick + w * top * 0.012, z * inset + n.z * thick);
    amount[i] = w;
  }
  g.computeVertexNormals();
  paint(g, (q, out) => {
    const shade = 0.75 + 0.35 * noise3(q.x * 170, q.y * 170, q.z * 170, seed + 42);
    out.copy(hair).multiplyScalar(shade);
    return 0;
  });
  add(ctx, 'head', 'body', g);
}

// ---------------------------------------------------------------- signature props

const PROP_DARK = new THREE.Color('#121416');

/** A thin box from a to b. */
function bar(a: [number, number, number], b: [number, number, number], t: number): THREE.BufferGeometry {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const g = new THREE.BoxGeometry(t, t, va.distanceTo(vb));
  const m = new THREE.Matrix4().lookAt(vb, va, new THREE.Vector3(0, 1, 0));
  g.applyMatrix4(m);
  g.translate((va.x + vb.x) / 2, (va.y + vb.y) / 2, (va.z + vb.z) / 2);
  return g;
}
const PROP_STEEL = new THREE.Color('#8d949a');
const HI_VIS = new THREE.Color('#c9c47a');

function buildProps(ctx: Ctx): void {
  const props = ctx.look.props ?? [];
  const w = ctx.w;
  const has = (p: LookProp): boolean => props.includes(p);
  if (has('glassesOnHead')) {
    // Reading glasses pushed up onto the head (head space: front is -Z, crown at y 0.212).
    const parts: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) {
      const lens = new THREE.TorusGeometry(0.016, 0.0022, 5, 14);
      lens.scale(1.15, 0.8, 1);
      lens.rotateX(-1.3);
      lens.translate(sx * 0.03, 0.19, -0.05);
      parts.push(lens);
      // Arm from the hinge over the head and down to the ear.
      parts.push(bar([sx * 0.05, 0.188, -0.05], [sx * 0.078, 0.13, 0.015], 0.0026));
    }
    const bridge = new THREE.BoxGeometry(0.018, 0.003, 0.003);
    bridge.translate(0, 0.194, -0.056);
    parts.push(bridge);
    for (const g of parts) add(ctx, 'head', 'body', paint(clean(g), solid(PROP_DARK)));
  }
  if (has('glasses')) {
    // Worn glasses: rectangular frames over the eyes, arms back to the ears.
    const parts: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) {
      const lens = new THREE.TorusGeometry(0.016, 0.0021, 5, 4);
      lens.rotateZ(Math.PI / 4);
      lens.scale(1.25, 0.85, 1);
      lens.translate(sx * 0.031, 0.106, -0.104);
      parts.push(lens);
      parts.push(bar([sx * 0.052, 0.109, -0.1], [sx * 0.085, 0.102, 0.012], 0.0024));
    }
    parts.push(bar([-0.009, 0.109, -0.108], [0.009, 0.109, -0.108], 0.0024));
    for (const g of parts) add(ctx, 'head', 'body', paint(clean(g), solid(PROP_DARK)));
  }
  if (has('penlight')) {
    const pen = new THREE.CylinderGeometry(0.006, 0.006, 0.1, 8);
    pen.translate(0.075 * w, 0.16, -0.145 * w);
    add(ctx, 'chest', 'body', paint(clean(pen), solid(PROP_DARK)));
    const clip = new THREE.BoxGeometry(0.004, 0.03, 0.003);
    clip.translate(0.075 * w, 0.2, -0.149 * w);
    add(ctx, 'chest', 'body', paint(clean(clip), solid(PROP_STEEL)));
  }
  if (has('stethoscope')) {
    // Draped round the neck, ends hanging down the chest.
    const loop = new THREE.TorusGeometry(0.088, 0.006, 6, 24, Math.PI * 1.25);
    loop.rotateX(Math.PI / 2);
    loop.rotateY(-Math.PI * 0.125 + Math.PI / 2);
    loop.translate(0, -0.005, 0.01);
    add(ctx, 'neck', 'body', paint(clean(loop), solid(PROP_DARK)));
    for (const sx of [-1, 1]) {
      const tube = new THREE.CylinderGeometry(0.006, 0.006, 0.17, 6);
      tube.translate(sx * 0.06 * w, 0.14, -0.15 * w);
      add(ctx, 'chest', 'body', paint(clean(tube), solid(PROP_DARK)));
    }
    const bell = new THREE.CylinderGeometry(0.016, 0.016, 0.008, 12);
    bell.rotateX(Math.PI / 2);
    bell.translate(-0.06 * w, 0.05, -0.155 * w);
    add(ctx, 'chest', 'body', paint(clean(bell), solid(PROP_STEEL)));
  }
  if (has('multitool')) {
    const tool = new THREE.BoxGeometry(0.03, 0.09, 0.022);
    tool.translate(0.17 * w, 0.03, -0.03);
    add(ctx, 'pelvis', 'body', paint(clean(tool), solid(new THREE.Color('#1b1b1b'))));
  }
  if (has('chestPatch')) {
    const patch = new THREE.BoxGeometry(0.06, 0.035, 0.004);
    patch.translate(-0.07 * w, 0.17, -0.146 * w);
    add(ctx, 'chest', 'body', paint(clean(patch), solid(new THREE.Color('#d8d2c0'))));
  }
}

// ---------------------------------------------------------------- head, jaw, eyes, teeth

/** Mouth line: the jaw owns everything below MOUTH_Y and in front of MOUTH_Z (head space). */
const MOUTH_Y = 0.052;
const MOUTH_Z = 0.035;
const JAW_HINGE = jointDef('jaw').offset;

function gauss(x: number, y: number, z: number, cx: number, cy: number, cz: number, r: number): number {
  const d2 = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2;
  return Math.exp(-d2 / (r * r));
}

/** The full head surface before it is split into skull and jaw. */
function headSurface(ctx: Ctx, jaw: number, nose: number): THREE.BufferGeometry {
  const g = clean(new THREE.SphereGeometry(1, ctx.hero ? 56 : 30, ctx.hero ? 40 : 22));
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    let x = p.x * 0.082;
    const y = p.y * 0.112 + 0.1;
    let z = p.z * 0.1;
    if (y < 0.085) {
      const t = (0.085 - y) / 0.1;
      x *= 1 - 0.25 * t * jaw;
      z = z < 0 ? z * (1 - 0.04 * t) - 0.01 * t : z * (1 - 0.4 * t);
    }
    if (z > 0 && y > 0.08) z *= 1.08;
    if (z < 0) z *= 0.94;
    const fz = z < 0 ? 1 : 0;
    z -= fz * 0.03 * nose * gauss(x * 1.6, y, z, 0, 0.078, -0.094, 0.02);
    z -= fz * 0.014 * gauss(x * 2.2, y, z, 0, 0.1, -0.094, 0.022);
    z -= fz * 0.012 * gauss(x * 0.6, y, z, 0, 0.128, -0.09, 0.022);
    for (const sx of [-1, 1]) {
      z += fz * 0.017 * gauss(x, y, z, sx * 0.03, 0.106, -0.088, 0.017);
      z -= fz * 0.008 * gauss(x, y, z, sx * 0.05, 0.075, -0.075, 0.025);
    }
    z += fz * 0.007 * gauss(x * 0.5, y, z, 0, 0.05, -0.09, 0.012);
    z -= fz * 0.008 * gauss(x, y, z, 0, 0.018, -0.085, 0.02);
    pos.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  // Displace before splitting so skull and jaw meet exactly at the mouth line.
  displace(g, 0.0015, 30, ctx.seed + 3);
  return g;
}

function buildHead(ctx: Ctx): void {
  const { seed, rng } = ctx;
  const look = ctx.look;
  const jawShape = look.jaw ?? rng.range(0.85, 1.05);
  const nose = look.nose ?? rng.range(0.85, 1.2);
  const hairLine = look.hairLine ?? rng.range(0.13, 0.15);
  const recede = look.recede ?? 0;
  const mouthHalf = look.mouth ?? Infinity;
  const lipHalf = Math.min(0.024, mouthHalf * 0.95);
  const facialCol = look.facial ? new THREE.Color(look.facialColor ?? ctx.hair ?? '#2a2018') : null;
  const lip = new THREE.Color(ctx.skin).lerp(new THREE.Color('#6a2a28'), 0.35);
  const brow = ctx.hair ?? new THREE.Color(ctx.skin).multiplyScalar(0.5);
  const face: Painter = (q, out, fx) => {
    const front = q.z < -0.03;
    const torn = ctx.hero && heroScalpTorn(q, seed);
    // Temples recede: the front hairline climbs toward the sides.
    const line = hairLine + recede * 0.025 * Math.min(1, Math.abs(q.x) / 0.06) * (q.z < 0 ? 1 : 0);
    if (ctx.hair && !torn && (q.y > line || (q.z > 0.01 && q.y > 0.07)) && !(front && q.y < line + 0.012)) {
      mottle(ctx.hair, q, seed + 5, 0.12, out);
      if (look.cropped) out.lerp(ctx.skin, 0.35 + 0.15 * noise3(q.x * 300, q.y * 300, q.z * 300, seed + 6));
      return 0;
    }
    if (ctx.hero) {
      if (heroFace(q, seed, ctx.skin, out, fx)) return 0.3;
    } else mottle(ctx.skin, q, seed, 0.05, out);
    let socket = 0;
    for (const sx of [-1, 1]) socket = Math.max(socket, gauss(q.x, q.y, q.z, sx * 0.03, 0.106, -0.085, 0.016));
    out.multiplyScalar(1 - 0.6 * socket);
    if (look.tired) {
      let bag = 0;
      for (const sx of [-1, 1]) bag = Math.max(bag, gauss(q.x, q.y, q.z, sx * 0.031, 0.093, -0.084, 0.013));
      out.lerp(new THREE.Color(ctx.skin).multiplyScalar(0.5).lerp(new THREE.Color('#5a3a4a'), 0.35), Math.min(1, bag * look.tired * 1.2));
    }
    if (facialCol) {
      // Jaw, chin, cheeks below the cheekbone and the upper lip; not the lips themselves.
      const lips = Math.abs(q.x) < lipHalf && q.y > 0.043 && q.y < 0.058;
      const cheek = q.y < 0.082 - 0.03 * Math.max(0, q.z + 0.02) / 0.06 && q.y > -0.02 && q.z < 0.03;
      const tache = Math.abs(q.x) < 0.03 && q.y >= 0.058 && q.y < 0.07 && front;
      if (!lips && (cheek || tache)) {
        const edge = Math.min(1, (0.082 - q.y) / 0.012, 1);
        if (look.facial === 'beard') out.lerp(facialCol, 0.88 * Math.max(0.4, edge));
        else out.lerp(facialCol, (0.62 + 0.18 * noise3(q.x * 400, q.y * 400, q.z * 400, seed + 8)) * Math.max(0.5, edge));
      }
    }
    if (front && Math.abs(q.x) < lipHalf && q.y > 0.043 && q.y < 0.058) out.lerp(lip, 0.7);
    if (front && Math.abs(q.y - 0.124) < 0.005 && Math.abs(q.x) > 0.012 && Math.abs(q.x) < 0.048) out.lerp(brow, 0.75);
    if (front) {
      // Blood weeping from the eyes and pouring from the mouth.
      let r = 0;
      for (const sx of [-1, 1]) if (Math.abs(q.x - sx * 0.03) < 0.012) r = Math.max(r, streak(q.x - sx * 0.03 + 0.5, q.y, 0.1, seed + 7 + sx, 160, 0.07));
      if (Math.abs(q.x) < 0.035) r = Math.max(r, streak(q.x + 0.5, q.y, 0.056, seed + 9, 120, 0.06));
      fx.rot = r;
    }
    return 1;
  };

  // Skull: the jaw's region is pushed onto its boundary, forming the roof of the mouth.
  const skull = headSurface(ctx, jawShape, nose);
  const jaw = headSurface(ctx, jawShape, nose);
  const roof = clampRegion(skull, 'outside');
  const floor = clampRegion(jaw, 'inside');
  paint(skull, face, ctx.infectable ? seed + 17 : null);
  paint(jaw, face, ctx.infectable ? seed + 17 : null);
  if (Number.isFinite(mouthHalf)) {
    // A smaller mouth: only the middle of the seam shows as mouth; the rest keeps the face paint.
    for (const [g, flags] of [[skull, roof], [jaw, floor]] as const) {
      const pos = g.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < flags.length; i++) if (flags[i] && Math.abs(pos.getX(i)) > mouthHalf) flags[i] = 0;
    }
  }
  colorFlagged(skull, roof, MOUTH);
  colorFlagged(jaw, floor, TONGUE);
  skull.computeVertexNormals();
  jaw.computeVertexNormals();
  add(ctx, 'head', 'body', skull);
  jaw.translate(-JAW_HINGE[0], -JAW_HINGE[1], -JAW_HINGE[2]);
  add(ctx, 'jaw', 'body', jaw);

  // Teeth: upper row on the skull, lower row on the jaw. Each row hides inside the other
  // piece while the mouth is shut.
  const teeth = (lower: boolean): THREE.BufferGeometry => {
    const list: THREE.BufferGeometry[] = [];
    const span = Math.min(0.026, mouthHalf * 0.85);
    for (let k = 0; k < 8; k++) {
      const x = (-0.026 + (k / 7) * 0.052) * (span / 0.026);
      const z = -0.079 + 0.016 * (x / 0.026) ** 2;
      const h = rng.range(0.006, 0.01) * (lower ? 0.8 : 1);
      const tooth = new THREE.BoxGeometry(0.0058 * Math.max(0.5, span / 0.026), h, 0.005);
      tooth.rotateY(Math.atan2(x, 0.05));
      tooth.translate(x, lower ? MOUTH_Y + h / 2 : MOUTH_Y - h / 2, z + 0.004);
      list.push(tooth);
    }
    const g = list.reduce((acc, t) => {
      const merged = mergeTwo(acc, t);
      return merged;
    });
    const out = clean(g);
    return paint(out, (_p, c) => {
      c.copy(BONE).lerp(BONE_OLD, rng.range(0, 0.6));
      return 0;
    });
  };
  add(ctx, 'head', 'body', teeth(false));
  const lower = teeth(true);
  lower.translate(-JAW_HINGE[0], -JAW_HINGE[1], -JAW_HINGE[2]);
  add(ctx, 'jaw', 'body', lower);

  // Eyes: human whites and irises; the shader turns them milky and lit as the bloom takes hold.
  for (const sx of [-1, 1]) {
    const eye = clean(new THREE.SphereGeometry(0.0125, 10, 8));
    eye.translate(sx * 0.03, 0.106, -0.08);
    add(ctx, 'head', 'body', paint(eye, (p, out, fx) => {
      const lx = p.x - sx * 0.03;
      const ly = p.y - 0.106;
      const front = p.z < -0.0905;
      out.set(front && Math.hypot(lx, ly) < 0.0055 ? '#2b241e' : '#d6d0c2');
      fx.glow = 1;
      return 0;
    }));
  }

  if (ctx.hair && look.hairStyle === 'curly') buildCurlyHair(ctx, hairLine, recede);

  // Ears.
  for (const sx of [-1, 1]) {
    const ear = clean(new THREE.SphereGeometry(0.024, 8, 6));
    ear.scale(0.35, 1, 0.7);
    ear.translate(sx * 0.081, 0.095, 0.008);
    add(ctx, 'head', 'body', paint(ear, (q, out) => {
      mottle(ctx.skin, q, seed, 0.05, out).multiplyScalar(0.92);
      return 1;
    }));
  }
}

/** Concatenate two indexed geometries with the same attributes (position only here). */
function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const ai = a.index ? a : a;
  const pa = ai.getAttribute('position') as THREE.BufferAttribute;
  const pb = b.getAttribute('position') as THREE.BufferAttribute;
  const ia = ai.getIndex();
  const ib = b.getIndex();
  if (!ia || !ib) throw new Error('mergeTwo needs indexed geometry');
  const pos = new Float32Array((pa.count + pb.count) * 3);
  pos.set(pa.array as Float32Array, 0);
  pos.set(pb.array as Float32Array, pa.count * 3);
  const idx: number[] = [...(ia.array as ArrayLike<number> as number[])];
  for (let i = 0; i < ib.count; i++) idx.push((ib.array[i] ?? 0) + pa.count);
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setIndex(idx);
  return out;
}

/**
 * Split the head surface at the mouth. 'outside' (skull) pushes jaw-region vertices onto the
 * nearest boundary plane; 'inside' (jaw) clamps everything into the jaw region. Returns which
 * vertices were moved, so they can be painted as the inside of the mouth.
 */
function clampRegion(g: THREE.BufferGeometry, keep: 'outside' | 'inside'): Uint8Array {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const moved = new Uint8Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const inJaw = y < MOUTH_Y && z < MOUTH_Z;
    if (keep === 'outside' && inJaw) {
      if (MOUTH_Y - y < MOUTH_Z - z) pos.setY(i, MOUTH_Y);
      else pos.setZ(i, MOUTH_Z);
      moved[i] = 1;
    } else if (keep === 'inside' && !inJaw) {
      pos.setY(i, Math.min(y, MOUTH_Y));
      pos.setZ(i, Math.min(z, MOUTH_Z));
      moved[i] = 1;
    }
  }
  return moved;
}

function colorFlagged(g: THREE.BufferGeometry, flags: Uint8Array, color: THREE.Color): void {
  const col = g.getAttribute('color') as THREE.BufferAttribute;
  const skin = g.getAttribute('aSkin') as THREE.BufferAttribute;
  const rot = g.getAttribute('aRot') as THREE.BufferAttribute;
  for (let i = 0; i < flags.length; i++) {
    if (!flags[i]) continue;
    col.setXYZ(i, color.r, color.g, color.b);
    skin.setX(i, 0);
    rot.setX(i, 0);
  }
}

// ---------------------------------------------------------------- hands, feet, limbs

function buildHand(ctx: Ctx, side: Side): void {
  const name: JointName = `hand_${side}`;
  const skin: Painter = (p, out) => {
    mottle(ctx.skin, p, ctx.seed, 0.05, out);
    return 1;
  };
  const palm = taperedCapsule({ y0: -0.005, y1: -0.085, r0: 0.04 * ctx.w, r1: 0.042 * ctx.w, sx: 0.5, sz: 1 }, 8, 3, 2);
  add(ctx, name, 'body', paint(palm, skin, ctx.infectable ? ctx.seed + 31 : null));
  for (let f = 0; f < 4; f++) {
    const len = [0.07, 0.078, 0.074, 0.06][f] ?? 0.07;
    const fg = taperedCapsule({ y0: 0, y1: -len, r0: 0.0105, r1: 0.008, sx: 1, sz: 1 }, 5, 2, 2);
    fg.rotateX(0.18);
    fg.translate(0, -0.085, (f - 1.5) * 0.019 * ctx.w);
    // Nails darken to claws with infection (rot at the tips).
    add(ctx, name, 'body', paint(fg, (p, out, fx) => {
      skin(p, out, fx);
      fx.rot = p.y < -0.085 - len * 0.75 ? 1 : 0;
      return 1;
    }));
  }
  const thumb = taperedCapsule({ y0: 0, y1: -0.055, r0: 0.012, r1: 0.01, sx: 1, sz: 1 }, 5, 2, 2);
  thumb.rotateX(0.7);
  thumb.translate(0, -0.03, -0.036 * ctx.w);
  add(ctx, name, 'body', paint(thumb, skin));
}

function buildFoot(ctx: Ctx, side: Side): void {
  const g = taperedCapsule({ y0: 0, y1: 0.24, r0: 0.042 * ctx.w, r1: 0.046 * ctx.w, sx: 1, sz: 0.62 }, 9, 4, 3);
  g.rotateX(-Math.PI / 2); // now runs toward -Z (forward)
  g.translate(0, -0.035, 0.06);
  add(ctx, `foot_${side}`, 'body', paint(g, solid(ctx.boots)));
}

function buildLimbs(ctx: Ctx, side: Side): void {
  const { suit, over, scheme, seed } = ctx;
  const sleeve = over && scheme.coat ? over : suit;
  const props = ctx.look.props ?? [];
  const hiVis = props.includes('hiVis');
  const grease = props.includes('grease');
  const cloth = (base: THREE.Color): Painter => (p, out) => {
    mottle(base, p, seed, 0.06, out);
    if (grease) out.multiplyScalar(1 - 0.45 * THREE.MathUtils.smoothstep(noise3(p.x * 18, p.y * 18, p.z * 18, seed + 31), 0.35, 0.6));
    if (hiVis && Math.abs(p.y + 0.16) < 0.014) out.copy(HI_VIS);
    return 0;
  };
  limbSegment(ctx, `upperArm_${side}`, cloth(sleeve));
  limbSegment(ctx, `foreArm_${side}`, scheme.rolled
    ? (p, out) => {
        if (p.y > -0.05) {
          out.copy(sleeve).multiplyScalar(0.9);
          return 0;
        }
        mottle(ctx.skin, p, seed, 0.05, out);
        return 1;
      }
    : (p, out) => {
        if (p.y < -0.235) {
          mottle(ctx.skin, p, seed, 0.05, out);
          return 1;
        }
        mottle(sleeve, p, seed, 0.06, out);
        if (grease) out.multiplyScalar(1 - 0.45 * THREE.MathUtils.smoothstep(noise3(p.x * 18, p.y * 18, p.z * 18, seed + 31), 0.35, 0.6));
        if (hiVis && Math.abs(p.y + 0.1) < 0.012) out.copy(HI_VIS);
        return 0;
      });
  limbSegment(ctx, `thigh_${side}`, cloth(suit));
  limbSegment(ctx, `shin_${side}`, (p, out) => {
    if (p.y < -0.27) {
      out.copy(ctx.boots);
      return 0;
    }
    mottle(suit, p, seed, 0.06, out);
    return 0;
  });
  buildHand(ctx, side);
  buildFoot(ctx, side);
}

// ---------------------------------------------------------------- infection detail

const fleshPainter = (seed: number, glowAbove = 0.62): Painter => (p, out, fx) => {
  const n = noise3(p.x * 60, p.y * 60, p.z * 60, seed);
  out.copy(FLESH).lerp(FLESH_DARK, 0.5 + 0.5 * n);
  if (n > 0.5) out.lerp(PUS, (n - 0.5) * 2);
  // Bioluminescent pustules: the bloom glows faintly in the dark.
  fx.glow = n > glowAbove ? Math.min(1, (n - glowAbove) * 5) : 0;
  return 0;
};

function growthBlob(ctx: Ctx, r: number, at: THREE.Vector3, seedOff: number): THREE.BufferGeometry {
  const g = clean(new THREE.IcosahedronGeometry(r, 2));
  displace(g, r * 0.55, 3.2 / r, ctx.seed + seedOff, 3);
  g.translate(at.x, at.y, at.z);
  return paint(g, fleshPainter(ctx.seed + seedOff));
}

function buildGrowths(ctx: Ctx, extra: ExtraBoneDef[]): void {
  const { rng } = ctx;
  const jawSide = rng.chance(0.5) ? -1 : 1;
  const defs: Array<[ExtraBone, JointName, Vec3T, number]> = [
    ['growth_shoulder_L', 'shoulder_L', [-0.02, 0.03, 0.02], 2],
    ['growth_shoulder_R', 'shoulder_R', [0.02, 0.03, 0.02], 1],
    ['growth_jaw', 'head', [jawSide * 0.06, 0.07, -0.01], 1],
    ['growth_spine', 'chest', [0, 0.14, 0.1], 3],
  ];
  for (const [name, parent, offset, blobs] of defs) {
    extra.push({ name, parent, offset, kind: 'growth' });
    for (let i = 0; i < blobs; i++) {
      const r = rng.range(0.035, name === 'growth_jaw' ? 0.04 : 0.065);
      const at = new THREE.Vector3(rng.range(-0.04, 0.04), rng.range(-0.04, 0.05), rng.range(-0.03, 0.04));
      if (name === 'growth_spine') at.set(rng.range(-0.09, 0.09), rng.range(-0.14, 0.06), rng.range(0, 0.03));
      add(ctx, name, 'wet', growthBlob(ctx, r, at, i * 31 + name.length));
    }
  }

  // Split skin and exposed bone on one forearm and the opposite shin.
  const armSide: Side = rng.chance(0.5) ? 'L' : 'R';
  const legSide: Side = armSide === 'L' ? 'R' : 'L';
  extra.push({ name: 'shards_arm', parent: `foreArm_${armSide}`, offset: [0, -0.12, 0], kind: 'shards' });
  extra.push({ name: 'shards_leg', parent: `shin_${legSide}`, offset: [0, -0.18, 0], kind: 'shards' });
  for (const bone of ['shards_arm', 'shards_leg'] as const) {
    const r = bone === 'shards_arm' ? 0.04 : 0.05;
    const wound = clean(new THREE.SphereGeometry(r, 10, 8));
    wound.scale(1, 2.2, 0.55);
    wound.translate(0, 0, -r * 0.62);
    displace(wound, 0.006, 40, ctx.seed + bone.length);
    add(ctx, bone, 'wet', paint(wound, (p, out) => {
      out.copy(CUT).lerp(FLESH_RAW, 0.5 + 0.5 * noise3(p.x * 80, p.y * 80, p.z * 80, ctx.seed));
      return 0;
    }));
    for (let k = 0; k < 3; k++) {
      const shard = new THREE.ConeGeometry(0.008, rng.range(0.04, 0.07), 5);
      shard.rotateX(-Math.PI / 2 + rng.range(-0.5, 0.5));
      shard.rotateZ(rng.range(-0.6, 0.6));
      shard.translate(rng.range(-0.012, 0.012), rng.range(-0.05, 0.05), -r * 0.9);
      add(ctx, bone, 'wet', paint(clean(shard), solid(BONE)));
    }
  }

  // Ribs bursting through the front of the chest, around a raw cavity.
  extra.push({ name: 'ribs', parent: 'chest', offset: [0, 0.11, -0.112 * ctx.w], kind: 'ribs' });
  const cavity = clean(new THREE.SphereGeometry(0.1, 16, 10));
  cavity.scale(1.15 * ctx.w, 1.1, 0.28);
  displace(cavity, 0.014, 22, ctx.seed + 41, 3);
  add(ctx, 'ribs', 'wet', paint(cavity, (p, out, fx) => {
    const n = noise3(p.x * 70, p.y * 70, p.z * 70, ctx.seed + 41);
    const rim = Math.min(1, Math.hypot(p.x / 1.15, p.y) / 0.1);
    out.copy(FLESH_DARK).lerp(FLESH_RAW, (0.5 + 0.5 * n) * (1 - rim * 0.7));
    if (n > 0.55) out.lerp(PUS, (n - 0.55) * 1.5);
    fx.glow = n > 0.72 ? 0.7 : 0;
    return 0;
  }));
  for (let k = 0; k < 6; k++) {
    const side = k % 2 === 0 ? -1 : 1;
    const y = 0.055 - Math.floor(k / 2) * 0.045 + rng.range(-0.008, 0.008);
    const arc = Math.PI * rng.range(0.28, 0.42);
    const rib = clean(new THREE.TorusGeometry(0.085 * ctx.w, 0.0075, 4, 10, arc));
    rib.rotateX(Math.PI / 2);
    // Each rib runs from the flank toward the sternum and ends snapped short of it,
    // standing just proud of the cavity.
    rib.rotateY(side < 0 ? -Math.PI : arc);
    rib.rotateZ(side * rng.range(0.05, 0.25));
    rib.translate(0, y, 0.058);
    add(ctx, 'ribs', 'wet', paint(rib, (p, out) => {
      out.copy(BONE).lerp(BONE_OLD, 0.5 + 0.5 * noise3(p.x * 90, p.y * 90, p.z * 90, ctx.seed));
      out.lerp(CUT, Math.max(0, noise3(p.x * 40, p.y * 40, p.z * 40, ctx.seed + 7)) * 0.7);
      return 0;
    }));
  }
  const sternum = clean(new THREE.BoxGeometry(0.018, 0.12, 0.012));
  sternum.rotateZ(rng.range(-0.25, 0.25));
  sternum.translate(rng.range(-0.01, 0.01), 0.0, -0.012);
  add(ctx, 'ribs', 'wet', paint(sternum, (p, out) => {
    out.copy(BONE_OLD).lerp(CUT, 0.4 + 0.4 * noise3(p.x * 90, p.y * 90, p.z * 90, ctx.seed));
    return 0;
  }));

  // Tendrils: slick, glowing-tipped strands that writhe from the back, shoulder and jaw.
  const roots: Array<[JointName, Vec3T, Vec3T]> = [
    ['chest', [0.06, 0.2, 0.1], [0.9, 0, -0.4]],
    [jawSide < 0 ? 'shoulder_R' : 'shoulder_L', [0, 0.04, 0.03], [0.5, 0, jawSide * 0.9]],
    ['head', [jawSide * 0.05, 0.04, -0.02], [-2.2, 0, jawSide * 0.6]],
  ];
  roots.forEach(([parent, offset, rest], t) => {
    const len = t === 2 ? 0.045 : 0.075;
    for (let s = 0; s < TENDRIL_SEGMENTS; s++) {
      const name: ExtraBone = `tendril_${t}_${s}`;
      const parentBone: JointName | ExtraBone = s === 0 ? parent : `tendril_${t}_${s - 1}`;
      extra.push({
        name,
        parent: parentBone,
        offset: s === 0 ? offset : [0, len, 0],
        kind: 'tendril',
        ...(s === 0 ? { rest } : {}),
      });
      const r0 = 0.02 * (1 - s / TENDRIL_SEGMENTS) + 0.004;
      const r1 = 0.02 * (1 - (s + 1) / TENDRIL_SEGMENTS) + 0.003;
      const seg = taperedCapsule({ y0: 0, y1: len * 1.05, r0, r1, sx: 1, sz: 0.8 }, 6, 2, 1);
      const tip = s === TENDRIL_SEGMENTS - 1;
      add(ctx, name, 'wet', paint(seg, (p, out, fx) => {
        fleshPainter(ctx.seed + t * 13 + s, 0.4)(p, out, fx);
        if (tip && p.y > len * 0.6) fx.glow = 1;
        return 0;
      }));
    }
  });
}

// ---------------------------------------------------------------- stumps

/**
 * Wound cap facing along `dirY` (+1 or -1 along local Y): torn flesh, a splintered bone
 * and dangling strands of tissue. Used on the body side (stump bone) and on the severed end.
 */
export function woundCap(radius: number, dirY: 1 | -1, seed: number): THREE.BufferGeometry[] {
  const rng = new Rng(`wound:${seed}`);
  const cap = clean(new THREE.SphereGeometry(radius * 1.06, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2));
  cap.scale(1, 0.4, 1);
  displace(cap, radius * 0.18, 26, seed);
  if (dirY < 0) cap.rotateX(Math.PI);
  paint(cap, (p, out) => {
    const rim = Math.min(1, Math.hypot(p.x, p.z) / radius);
    out.copy(CUT).lerp(FLESH_RAW, 0.5 + 0.5 * noise3(p.x * 90, p.y * 90, p.z * 90, seed)).multiplyScalar(0.55 + 0.45 * rim);
    return 0;
  });
  // Splintered bone: a shaft with a jagged tip.
  const bone = clean(new THREE.CylinderGeometry(radius * 0.22, radius * 0.28, radius * 0.9, 6, 1));
  bone.translate(0, dirY * radius * 0.45, 0);
  paint(bone, solid(BONE));
  const splinter = clean(new THREE.ConeGeometry(radius * 0.16, radius * 0.7, 5));
  if (dirY < 0) splinter.rotateX(Math.PI);
  splinter.translate(radius * 0.06, dirY * radius * 1.15, 0);
  paint(splinter, solid(BONE_OLD));
  const parts = [cap, bone, splinter];
  // Hanging tissue.
  for (let k = 0; k < 2; k++) {
    const a = rng.range(0, Math.PI * 2);
    const len = radius * rng.range(0.9, 1.6);
    const strand = taperedCapsule({ y0: 0, y1: -len, r0: radius * 0.1, r1: radius * 0.05, sx: 1, sz: 1 }, 4, 2, 1);
    strand.rotateZ(rng.range(-0.4, 0.4));
    if (dirY > 0) strand.rotateX(Math.PI);
    strand.translate(Math.cos(a) * radius * 0.6, dirY * radius * 0.2, Math.sin(a) * radius * 0.6);
    parts.push(paint(strand, (p, out) => {
      out.copy(FLESH_RAW).lerp(CUT, 0.5 + 0.5 * noise3(p.x * 120, p.y * 120, p.z * 120, seed + k));
      return 0;
    }));
  }
  return parts;
}

function buildStumps(ctx: Ctx, extra: ExtraBoneDef[], offsets: Partial<Record<JointName, Vec3T>>): void {
  for (const name of STUMP_JOINTS) {
    const def = jointDef(name);
    if (!def.parent) continue;
    const at = offsets[name] ?? def.offset;
    const bone: ExtraBone = `stump_${name}`;
    extra.push({
      name: bone,
      parent: def.parent,
      offset: [at[0] * ctx.w, at[1], at[2]],
      kind: 'stump',
    });
    const r = name === 'head' ? 0.05 * ctx.w : (def.segment?.r0 ?? 0.05) * ctx.w;
    const dir: 1 | -1 = name === 'head' ? 1 : -1;
    for (const g of woundCap(r, dir, ctx.seed + name.length)) add(ctx, bone, 'wet', g);
  }
}

// ---------------------------------------------------------------- entry

/** Build every mesh piece for one body. Deterministic for a given shape. */
export function buildBodyGeometry(shape: BodyShape): BodyGeometry {
  const rng = new Rng(`body:${shape.seed}`);
  const look = shape.look ?? {};
  const baseScheme = SCHEMES[shape.outfit];
  const scheme = look.rolled === undefined ? baseScheme : { ...baseScheme, rolled: look.rolled };
  // Always draw from the rng so seeded bodies stay identical whether or not a look is given.
  const seededSkin = rng.pick(SKIN_TONES);
  const skin = new THREE.Color(look.skin ?? seededSkin);
  const ctx: Ctx = {
    rng,
    seed: Math.floor(rng.next() * 1e6),
    w: shape.build,
    scheme,
    skin,
    suit: new THREE.Color(scheme.suit),
    over: scheme.over ? new THREE.Color(scheme.over) : null,
    boots: new THREE.Color(scheme.boots),
    belt: new THREE.Color(scheme.belt),
    hair: ((): THREE.Color | null => {
      const seeded = rng.chance(0.85) ? rng.pick(HAIR) : null;
      const h = look.hair === undefined ? seeded : look.hair;
      return h ? new THREE.Color(h) : null;
    })(),
    look,
    outfit: shape.outfit,
    infectable: shape.infectable,
    hero: shape.hero === true,
    parts: [],
  };
  // A hero's longer neck raises the head, so the reference height is stretched to match and the body stays at `shape.height`.
  const neckExtra = ctx.hero ? HERO_NECK_EXTRA : 0;
  const jointOffsets: Partial<Record<JointName, Vec3T>> = ctx.hero ? { head: [0, jointDef('head').offset[1] + neckExtra, 0] } : {};
  const scaleY = shape.height / (1.78 + neckExtra);
  const extra: ExtraBoneDef[] = [];
  buildTorso(ctx);
  if (ctx.hero) buildTatters(ctx, extra);
  buildHead(ctx);
  if (ctx.hero) {
    heroTeeth(ctx);
    enlargeHead(ctx, HERO_HEAD_SCALE);
    heroFaceDetail(ctx);
  }
  buildLimbs(ctx, 'L');
  buildLimbs(ctx, 'R');
  buildProps(ctx);
  if (shape.infectable) buildGrowths(ctx, extra);
  buildStumps(ctx, extra, jointOffsets);
  // Geometry is built at the reference height; the root bone scales the whole body by scaleY.
  return { parts: ctx.parts, extraBones: extra, scale: { y: scaleY, w: shape.build }, jointOffsets, skinTone: skin };
}

/** Triangle count of the pieces, for the per-body budget (ADR-0006). */
export function triangleCount(parts: readonly PartGeometry[]): number {
  let n = 0;
  for (const p of parts) {
    const idx = p.geometry.getIndex();
    n += (idx ? idx.count : p.geometry.getAttribute('position').count) / 3;
  }
  return n;
}

export { JOINTS };
