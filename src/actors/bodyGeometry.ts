import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../core/rng.ts';
import { fbm3, noise3 } from './noise3.ts';
import { JOINTS, jointDef, type JointName, type SegmentDef, type Side, type Vec3T } from './skeleton.ts';

/**
 * Procedural body meshes (ADR-0006). Every piece is built in the local space of the joint
 * that moves it, with `position`, `normal`, `color` and `aSkin` attributes, so it can be
 * merged into the skinned body (rigid weights) or into a severed debris mesh.
 */

export const OUTFITS = ['security', 'engineer', 'medic', 'lab', 'crew'] as const;
export type Outfit = (typeof OUTFITS)[number];

export interface BodyShape {
  outfit: Outfit;
  /** Metres; 1.78 is the reference. */
  height: number;
  /** Width multiplier, ~0.85 (slight) to 1.2 (heavy). */
  build: number;
  /** Build growths, bone shards and transformation bones (any infected or scripted body). */
  infectable: boolean;
  seed: string;
}

/** Bones that are not joints: they scale infection detail and stump caps in and out. */
export type ExtraBone =
  | 'growth_shoulder_L' | 'growth_shoulder_R' | 'growth_jaw' | 'growth_spine'
  | 'shards_arm' | 'shards_leg'
  | `stump_${JointName}`;

export interface ExtraBoneDef {
  name: ExtraBone;
  parent: JointName;
  offset: Vec3T;
  kind: 'growth' | 'shards' | 'stump';
}

export interface PartGeometry {
  /** Joint or extra bone that owns the piece. */
  bone: JointName | ExtraBone;
  /** Matte material (skin, cloth) or wet material (flesh, growths, stumps). */
  layer: 'body' | 'wet';
  geometry: THREE.BufferGeometry;
}

export interface BodyGeometry {
  parts: PartGeometry[];
  extraBones: ExtraBoneDef[];
  /** `y`: uniform scale on the root bone for height; `w`: width (build) on x offsets and radii. */
  scale: { y: number; w: number };
  skinTone: THREE.Color;
}

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
const PUS = new THREE.Color('#8a7a3a');
const BONE = new THREE.Color('#d6cbb2');
const CUT = new THREE.Color('#3d0709');

type Painter = (p: THREE.Vector3, out: THREE.Color) => number; // returns aSkin (0/1)

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

function paint(g: THREE.BufferGeometry, painter: Painter): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const skin = new Float32Array(pos.count);
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    skin[i] = painter(p, c);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('aSkin', new THREE.BufferAttribute(skin, 1));
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
  parts: PartGeometry[];
}

function add(ctx: Ctx, bone: PartGeometry['bone'], layer: PartGeometry['layer'], g: THREE.BufferGeometry): void {
  ctx.parts.push({ bone, layer, geometry: g });
}

function scaledSeg(s: SegmentDef, w: number): SegmentDef {
  return { ...s, r0: s.r0 * w, r1: s.r1 * w };
}

function limbSegment(ctx: Ctx, name: JointName, painter: Painter, radial = 10, rings = 8): void {
  const def = jointDef(name);
  if (!def.segment) return;
  const g = taperedCapsule(scaledSeg(def.segment, ctx.w), radial, rings);
  displace(g, 0.004, 9, ctx.seed + def.name.length * 13);
  add(ctx, name, 'body', paint(g, painter));
}

function buildTorso(ctx: Ctx): void {
  const { suit, over, scheme, seed } = ctx;
  const cloth = (base: THREE.Color): Painter => (p, out) => {
    mottle(base, p, seed, 0.06, out);
    return 0;
  };
  limbSegment(ctx, 'pelvis', cloth(suit), 14, 6);
  limbSegment(ctx, 'spine', cloth(over && scheme.coat ? over : suit), 14, 6);
  limbSegment(ctx, 'chest', cloth(over && scheme.coat ? over : suit), 14, 8);
  // Neck is skin; collar band at the base.
  limbSegment(ctx, 'neck', (p, out) => {
    if (p.y < 0.0) {
      out.copy(over ?? suit);
      return 0;
    }
    mottle(ctx.skin, p, seed, 0.05, out);
    return 1;
  }, 8, 4);

  // Vest / jacket over the chest.
  if (over && !scheme.coat) {
    const vest = taperedCapsule({ y0: -0.03, y1: 0.215, r0: 0.158 * ctx.w, r1: 0.142 * ctx.w, sx: 1.33, sz: 0.86 }, 14, 6, 3);
    displace(vest, 0.003, 14, seed + 7);
    add(ctx, 'chest', 'body', paint(vest, cloth(over)));
  }
  // Lab coat hem (a short flared skirt so it doesn't clip the thighs).
  if (over && scheme.coat) {
    const hem = taperedCapsule({ y0: 0.06, y1: -0.2, r0: 0.152 * ctx.w, r1: 0.172 * ctx.w, sx: 1.2, sz: 0.88 }, 16, 6, 2);
    displace(hem, 0.006, 6, seed + 11);
    add(ctx, 'pelvis', 'body', paint(hem, cloth(over)));
  }
  // Belt.
  const belt = taperedCapsule({ y0: 0.07, y1: 0.11, r0: 0.152 * ctx.w, r1: 0.152 * ctx.w, sx: 1.22, sz: 0.84 }, 14, 1, 1);
  add(ctx, 'pelvis', 'body', paint(belt, solid(ctx.belt)));
  if (ctx.scheme === SCHEMES.engineer || ctx.scheme === SCHEMES.security) {
    // Pouches on the belt.
    for (const sx of [-1, 1]) {
      const pouch = new THREE.BoxGeometry(0.07, 0.08, 0.05, 1, 1, 1);
      pouch.translate(sx * 0.15 * ctx.w, 0.06, 0.02);
      add(ctx, 'pelvis', 'body', paint(clean(pouch), solid(ctx.belt)));
    }
  }
}

function buildHead(ctx: Ctx): void {
  const { seed, rng } = ctx;
  const g = clean(new THREE.SphereGeometry(1, 30, 22));
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  const jaw = rng.range(0.85, 1.05);
  const nose = rng.range(0.85, 1.2);
  const gauss = (x: number, y: number, z: number, cx: number, cy: number, cz: number, r: number): number => {
    const d2 = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2;
    return Math.exp(-d2 / (r * r));
  };
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    let x = p.x * 0.082;
    const y = p.y * 0.112 + 0.1;
    let z = p.z * 0.1;
    // Jaw narrows toward the chin, which sits forward (-Z is the face).
    if (y < 0.085) {
      const t = (0.085 - y) / 0.1;
      x *= 1 - 0.25 * t * jaw;
      z = z < 0 ? z * (1 - 0.04 * t) - 0.01 * t : z * (1 - 0.4 * t);
    }
    // Fuller back of the skull, flatter face.
    if (z > 0 && y > 0.08) z *= 1.08;
    if (z < 0) z *= 0.94;
    const fz = z < 0 ? 1 : 0;
    // Nose (bridge + tip), brow ridge, cheekbones, chin; eye sockets and mouth pressed in.
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
  displace(g, 0.0015, 30, seed + 3);
  const hairLine = rng.range(0.13, 0.15);
  const lip = new THREE.Color(ctx.skin).lerp(new THREE.Color('#6a2a28'), 0.35);
  const brow = ctx.hair ?? new THREE.Color(ctx.skin).multiplyScalar(0.5);
  add(ctx, 'head', 'body', paint(g, (q, out) => {
    const front = q.z < -0.03;
    if (ctx.hair && (q.y > hairLine || (q.z > 0.01 && q.y > 0.07)) && !(front && q.y < hairLine + 0.012)) {
      mottle(ctx.hair, q, seed + 5, 0.12, out);
      return 0;
    }
    mottle(ctx.skin, q, seed, 0.05, out);
    let socket = 0;
    for (const sx of [-1, 1]) socket = Math.max(socket, gauss(q.x, q.y, q.z, sx * 0.03, 0.106, -0.085, 0.016));
    out.multiplyScalar(1 - 0.6 * socket);
    if (front && Math.abs(q.x) < 0.024 && q.y > 0.043 && q.y < 0.058) out.lerp(lip, 0.7);
    if (front && Math.abs(q.y - 0.124) < 0.005 && Math.abs(q.x) > 0.012 && Math.abs(q.x) < 0.048) out.lerp(brow, 0.75);
    return 1;
  }));
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

function buildHand(ctx: Ctx, side: Side): void {
  const name: JointName = `hand_${side}`;
  const skin: Painter = (p, out) => {
    mottle(ctx.skin, p, ctx.seed, 0.05, out);
    return 1;
  };
  const palm = taperedCapsule({ y0: -0.005, y1: -0.085, r0: 0.04 * ctx.w, r1: 0.042 * ctx.w, sx: 0.5, sz: 1 }, 8, 3, 2);
  add(ctx, name, 'body', paint(palm, skin));
  // Four fingers spread along z (the palm faces the thigh), slightly curled forward.
  for (let f = 0; f < 4; f++) {
    const len = [0.07, 0.078, 0.074, 0.06][f] ?? 0.07;
    const fg = taperedCapsule({ y0: 0, y1: -len, r0: 0.0105, r1: 0.009, sx: 1, sz: 1 }, 5, 2, 2);
    fg.rotateX(0.18);
    fg.translate(0, -0.085, (f - 1.5) * 0.019 * ctx.w);
    add(ctx, name, 'body', paint(fg, skin));
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
  const cloth = (base: THREE.Color): Painter => (p, out) => {
    mottle(base, p, seed, 0.06, out);
    return 0;
  };
  // Upper arm with a deltoid swell near the top.
  limbSegment(ctx, `upperArm_${side}`, cloth(sleeve));
  limbSegment(ctx, `foreArm_${side}`, scheme.rolled
    ? (p, out) => {
        if (p.y > -0.05) {
          out.copy(sleeve).multiplyScalar(0.9); // rolled cuff
          return 0;
        }
        mottle(ctx.skin, p, seed, 0.05, out);
        return 1;
      }
    : (p, out) => {
        if (p.y < -0.235) {
          mottle(ctx.skin, p, seed, 0.05, out); // wrist
          return 1;
        }
        mottle(sleeve, p, seed, 0.06, out);
        return 0;
      });
  limbSegment(ctx, `thigh_${side}`, cloth(suit));
  // Boot shaft on the lower shin.
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

function growthBlob(ctx: Ctx, r: number, at: THREE.Vector3, seedOff: number): THREE.BufferGeometry {
  const g = clean(new THREE.IcosahedronGeometry(r, 2));
  displace(g, r * 0.55, 3.2 / r, ctx.seed + seedOff, 3);
  g.translate(at.x, at.y, at.z);
  const s = ctx.seed + seedOff;
  return paint(g, (p, out) => {
    const n = noise3(p.x * 60, p.y * 60, p.z * 60, s);
    out.copy(FLESH).lerp(FLESH_DARK, 0.5 + 0.5 * n);
    if (n > 0.55) out.lerp(PUS, (n - 0.55) * 2);
    return 0;
  });
}

function buildGrowths(ctx: Ctx, extra: ExtraBoneDef[]): void {
  const { rng } = ctx;
  const jawSide = rng.chance(0.5) ? -1 : 1;
  const defs: Array<[ExtraBone, JointName, Vec3T]> = [
    ['growth_shoulder_L', 'shoulder_L', [-0.02, 0.03, 0.02]],
    ['growth_shoulder_R', 'shoulder_R', [0.02, 0.03, 0.02]],
    ['growth_jaw', 'head', [jawSide * 0.05, 0.05, -0.03]],
    ['growth_spine', 'chest', [0, 0.14, 0.1]],
  ];
  for (const [name, parent, offset] of defs) {
    extra.push({ name, parent, offset, kind: 'growth' });
    const blobs = name === 'growth_spine' ? 2 : 1;
    for (let i = 0; i < blobs; i++) {
      const r = rng.range(0.035, name === 'growth_jaw' ? 0.045 : 0.065);
      const at = new THREE.Vector3(rng.range(-0.04, 0.04), rng.range(-0.04, 0.05), rng.range(-0.03, 0.04));
      if (name === 'growth_spine') at.set(rng.range(-0.08, 0.08), rng.range(-0.12, 0.05), rng.range(0, 0.03));
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
      out.copy(CUT).lerp(FLESH, 0.5 + 0.5 * noise3(p.x * 80, p.y * 80, p.z * 80, ctx.seed));
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
}

// ---------------------------------------------------------------- stumps

/**
 * Wound cap facing along `dirY` (+1 or -1 along local Y) with a bone stub. Used on the
 * body side (stump bone) and on the debris side (built at sever time).
 */
export function woundCap(radius: number, dirY: 1 | -1, seed: number): THREE.BufferGeometry[] {
  const cap = clean(new THREE.SphereGeometry(radius * 1.04, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2));
  cap.scale(1, 0.35, 1);
  displace(cap, radius * 0.12, 30, seed);
  if (dirY < 0) cap.rotateX(Math.PI);
  paint(cap, (p, out) => {
    const rim = Math.min(1, Math.hypot(p.x, p.z) / radius);
    out.copy(CUT).lerp(FLESH, 0.5 + 0.5 * noise3(p.x * 90, p.y * 90, p.z * 90, seed)).multiplyScalar(0.55 + 0.45 * rim);
    return 0;
  });
  const bone = clean(new THREE.CylinderGeometry(radius * 0.22, radius * 0.28, radius * 0.9, 6, 1));
  bone.translate(0, dirY * radius * 0.45, 0);
  paint(bone, solid(BONE));
  return [cap, bone];
}

function buildStumps(ctx: Ctx, extra: ExtraBoneDef[]): void {
  for (const name of STUMP_JOINTS) {
    const def = jointDef(name);
    if (!def.parent) continue;
    const bone: ExtraBone = `stump_${name}`;
    // Sits where the joint was, on the parent, facing toward the lost part.
    extra.push({
      name: bone,
      parent: def.parent,
      offset: [def.offset[0] * ctx.w, def.offset[1], def.offset[2]],
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
  const scheme = SCHEMES[shape.outfit];
  const skin = new THREE.Color(rng.pick(SKIN_TONES));
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
    hair: rng.chance(0.85) ? new THREE.Color(rng.pick(HAIR)) : null,
    parts: [],
  };
  const scaleY = shape.height / 1.78;
  const extra: ExtraBoneDef[] = [];
  buildTorso(ctx);
  buildHead(ctx);
  buildLimbs(ctx, 'L');
  buildLimbs(ctx, 'R');
  if (shape.infectable) buildGrowths(ctx, extra);
  buildStumps(ctx, extra);
  // Geometry is built at the reference height; the root bone scales the whole body by scaleY.
  return { parts: ctx.parts, extraBones: extra, scale: { y: scaleY, w: shape.build }, skinTone: skin };
}

/** Triangle count of the pieces, for the 6-10k budget (ADR-0006). */
export function triangleCount(parts: readonly PartGeometry[]): number {
  let n = 0;
  for (const p of parts) {
    const idx = p.geometry.getIndex();
    n += (idx ? idx.count : p.geometry.getAttribute('position').count) / 3;
  }
  return n;
}

export { JOINTS };
