/**
 * Hero-tier body detail: sculpted muscle, torn-skin wounds and tattered cloth.
 *
 * Pure geometry/colour helpers (no scene access). Joint-local space as in skeleton.ts:
 * limbs run down -Y, the body faces -Z, left is -X. All amounts are metres at the
 * reference 1.78 m, build 1 body (the root bone scales the result).
 */
import * as THREE from 'three';
import type { JointName } from './skeleton.ts';
import { fbm3, noise3 } from './noise3.ts';

const gauss = (p: THREE.Vector3, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, a: number): number => {
  const x = (p.x - cx) / rx;
  const y = (p.y - cy) / ry;
  const z = (p.z - cz) / rz;
  return a * Math.exp(-(x * x + y * y + z * z));
};

/** Which joints get wound patches and how much of them is torn open (0..1). */
const FLAY: Partial<Record<JointName, number>> = {
  chest: 0.7, spine: 0.55, upperArm_L: 0.75, upperArm_R: 0.55, foreArm_L: 0.8, foreArm_R: 0.65,
  thigh_L: 0.65, thigh_R: 0.45, shin_L: 0.6, shin_R: 0.4, neck: 0.4, pelvis: 0.3,
};

/** Wound mask 0..1: 1 deep inside a torn patch, a thin 0..0.3 band at the crusted rim. */
export function flayMask(joint: JointName, p: THREE.Vector3, seed: number): number {
  const amount = FLAY[joint];
  if (!amount) return 0;
  const base = 0.5 + 0.5 * fbm3(p.x * 9, p.y * 9, p.z * 9, seed + joint.length * 31, 3);
  const jag = 0.06 * noise3(p.x * 70, p.y * 70, p.z * 70, seed + 5);
  const facing = p.z < 0 ? 0.04 : -0.04; // wounds cluster on the front
  const v = base + jag + facing;
  const edge = 1 - amount * 0.8;
  return THREE.MathUtils.smoothstep(v, edge, edge + 0.07);
}

/** Muscle bulk added along the normal at local position `p`. */
export function muscle(joint: JointName, p: THREE.Vector3): number {
  const side = joint.endsWith('_L') ? -1 : 1;
  const ax = Math.abs(p.x);
  let m = 0;
  switch (joint) {
    case 'chest': {
      for (const s of [-1, 1]) {
        m += gauss(p, s * 0.078, 0.15, -0.1, 0.07, 0.05, 0.05, 0.034); // pecs
        m += gauss(p, s * 0.09, 0.2, 0.0, 0.06, 0.035, 0.07, 0.01); // traps
        m += gauss(p, s * 0.145, 0.09, 0.05, 0.05, 0.1, 0.08, 0.03); // lats
        m += gauss(p, s * 0.1, 0.1, -0.09, 0.05, 0.05, 0.05, 0.012); // serratus
      }
      if (p.z < -0.03) {
        m -= 0.013 * Math.exp(-((p.x / 0.012) ** 2)); // sternum groove
        m += ax > 0.05 ? 0.004 * Math.sin(p.y * 170) : 0; // rib ridges
      }
      break;
    }
    case 'spine': {
      for (const s of [-1, 1]) {
        m += gauss(p, s * 0.045, 0.09, -0.1, 0.04, 0.11, 0.04, 0.016); // rectus
        m += gauss(p, s * 0.125, 0.08, -0.03, 0.04, 0.1, 0.08, 0.022); // obliques
        m += gauss(p, s * 0.05, 0.1, 0.1, 0.05, 0.12, 0.05, 0.016); // spinal erectors
      }
      if (p.z < -0.03) {
        m -= 0.012 * Math.exp(-((p.x / 0.009) ** 2));
        m -= 0.011 * (Math.exp(-(((p.y - 0.06) / 0.009) ** 2)) + Math.exp(-(((p.y - 0.115) / 0.009) ** 2)));
      }
      break;
    }
    case 'pelvis': {
      for (const s of [-1, 1]) m += gauss(p, s * 0.07, -0.02, 0.1, 0.07, 0.07, 0.06, 0.026);
      break;
    }
    case 'neck': {
      for (const s of [-1, 1]) m += gauss(p, s * 0.032, 0.03, 0.0, 0.03, 0.07, 0.04, 0.012);
      for (const s of [-1, 1]) m += gauss(p, s * 0.026, 0.1, -0.012, 0.012, 0.06, 0.014, 0.008); // corded neck tendons (hero neck is longer)
      break;
    }
    case 'upperArm_L':
    case 'upperArm_R': {
      m += gauss(p, side * 0.02, -0.025, 0, 0.065, 0.075, 0.065, 0.03); // delt
      m += gauss(p, 0, -0.13, -0.04, 0.04, 0.09, 0.04, 0.028); // biceps
      m += gauss(p, 0, -0.12, 0.045, 0.045, 0.1, 0.04, 0.03); // triceps
      break;
    }
    case 'foreArm_L':
    case 'foreArm_R': {
      m += gauss(p, side * 0.03, -0.06, -0.01, 0.035, 0.08, 0.04, 0.024);
      m += gauss(p, -side * 0.02, -0.08, 0.02, 0.03, 0.09, 0.035, 0.018);
      break;
    }
    case 'thigh_L':
    case 'thigh_R': {
      m += gauss(p, 0, -0.17, -0.05, 0.07, 0.17, 0.05, 0.034); // quads
      m += gauss(p, side * 0.06, -0.2, 0.0, 0.04, 0.16, 0.05, 0.022);
      m += gauss(p, 0, -0.18, 0.06, 0.07, 0.17, 0.05, 0.028); // hamstrings
      break;
    }
    case 'shin_L':
    case 'shin_R': {
      m += gauss(p, 0, -0.12, 0.045, 0.05, 0.1, 0.04, 0.038); // calf
      m += gauss(p, side * 0.02, -0.14, 0.04, 0.03, 0.09, 0.03, 0.016);
      m += gauss(p, 0, -0.2, -0.045, 0.02, 0.15, 0.02, 0.009); // shin ridge
      break;
    }
    default:
      break;
  }
  return m;
}

/**
 * Sculpt a limb or torso piece in place: muscle bulk, tendon and vein ridges, wound
 * craters with raised crusted rims. Recomputes normals.
 */
export function sculptHero(g: THREE.BufferGeometry, joint: JointName, seed: number): void {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    let d = muscle(joint, p);
    // Cords and veins: thin ridges following the limb.
    const vein = Math.abs(noise3(p.x * 34, p.y * 9, p.z * 34, seed + 17));
    d = d * 1.7 + 0.005 * Math.max(0, 1 - vein * 7);
    d += 0.002 * fbm3(p.x * 40, p.y * 40, p.z * 40, seed, 2);
    d += 0.0045 * scarRidge(p, seed);
    const f = flayMask(joint, p, seed);
    if (f > 0) {
      const rim = Math.max(0, 1 - Math.abs(f - 0.3) / 0.3); // ridge at the torn edge
      d += 0.008 * rim - 0.014 * f;
      d += 0.0025 * Math.sin(Math.atan2(p.x, p.z) * 46 + 4 * noise3(0, p.y * 14, 0, seed)) * f; // fibre grooves
    }
    pos.setXYZ(i, p.x + nrm.getX(i) * d, p.y + nrm.getY(i) * d, p.z + nrm.getZ(i) * d);
  }
  g.computeVertexNormals();
}

/** Thin raised scar lines where a low-frequency noise field crosses zero. */
function scarRidge(p: THREE.Vector3, seed: number): number {
  const v = noise3(p.x * 6 + 3, p.y * 6, p.z * 6, seed + 90);
  return Math.max(0, 1 - Math.abs(v) * 16);
}

export interface HeroFx {
  glow: number;
  rot: number;
}

const SALLOW = new THREE.Color('#8e9886');
const BRUISE = new THREE.Color('#4a3a58');
const VEIN = new THREE.Color('#2a3a48');
const SCAR = new THREE.Color('#9a7a78');
const FIBRE_DARK = new THREE.Color('#210406');
const FIBRE_LIGHT = new THREE.Color('#8e2c26');
const CLOT = new THREE.Color('#14060a');
const SINEW = new THREE.Color('#9a8570');
const CRUST = new THREE.Color('#25080a');
const SHIRT = new THREE.Color('#bdb8a8');
const TROUSER = new THREE.Color('#2e3234');
const SHIRT_STAIN = new THREE.Color('#8a1a1a');

function trouserCovers(joint: JointName, p: THREE.Vector3, rag: number): boolean {
  switch (joint) {
    case 'pelvis': return p.y < 0.1;
    case 'thigh_L': case 'thigh_R': return p.y > -0.3 + rag * 3.5;
    case 'shin_L': case 'shin_R': return p.y > -0.1 + rag * 3.5;
    default: return false;
  }
}

/** Where the (torn) shirt reaches, per joint: cloth above/below the cut line plus noise. */
function shirtCovers(joint: JointName, p: THREE.Vector3, seed: number): boolean {
  const rag = 0.05 * fbm3(p.x * 20, 0, p.z * 20, seed + 40, 2) + 0.03 * noise3(p.x * 60, 0, p.z * 60, seed + 41);
  // Big irregular holes: the shirt hangs on in rags, the body shows through.
  const hole = fbm3(p.x * 11, p.y * 11, p.z * 11, seed + 60, 3) + 0.15 * noise3(p.x * 45, p.y * 45, p.z * 45, seed + 61);
  const legs = joint === 'pelvis' || joint.startsWith('thigh') || joint.startsWith('shin');
  if (hole < (legs ? -0.18 : 0.14)) return false;
  switch (joint) {
    case 'chest': return p.y > 0.06 + rag * 2;
    case 'spine': return p.y > 0.1 + rag * 3.2;
    case 'upperArm_L': case 'upperArm_R': return p.y > -0.08 + rag * 2.5;
    default: return trouserCovers(joint, p, rag);
  }
}

/** Colour for a hero body vertex. Returns aSkin (1 = skin). */
/** Gaunt, bruised hero face colouring with a torn scalp. Returns true when it handled the vertex. */
export function heroScalpTorn(q: THREE.Vector3, seed: number): boolean {
  return q.y > 0.07 && 0.5 + 0.5 * fbm3(q.x * 22, q.y * 22, q.z * 22, seed + 81, 3) + 2.5 * (q.y - 0.07) - (q.x > 0.02 ? 0.35 : 0) > 0.66;
}

export function heroFace(q: THREE.Vector3, seed: number, skin: THREE.Color, out: THREE.Color, fx: HeroFx): boolean {
  const n = 0.5 + 0.5 * noise3(q.x * 50, q.y * 50, q.z * 50, seed + 2);
  const scalp = THREE.MathUtils.smoothstep(0.5 + 0.5 * fbm3(q.x * 22, q.y * 22, q.z * 22, seed + 81, 3) + 0.25 * (q.y - 0.07) * 10 - (q.x > 0.02 ? 0.35 : 0), 0.62, 0.7);
  if (scalp > 0.5 && q.y > 0.07) {
    out.copy(FIBRE_DARK).lerp(FIBRE_LIGHT, 0.5 + 0.5 * Math.sin(q.x * 300 + q.z * 120 + 4 * noise3(0, q.y * 20, 0, seed)));
    fx.rot = -1;
    return true;
  }
  out.copy(skin).lerp(SALLOW, 0.75).multiplyScalar(0.42 + 0.18 * n);
  const hollow = Math.max(gauss(q, -0.052, 0.07, -0.07, 0.025, 0.03, 0.03, 1), gauss(q, 0.052, 0.07, -0.07, 0.025, 0.03, 0.03, 1));
  out.multiplyScalar(1 - 0.5 * hollow);
  out.lerp(BRUISE, 0.5 * THREE.MathUtils.smoothstep(fbmStain(q, seed + 5), 0.5, 0.72));
  return false;
}

export function heroColor(joint: JointName, p: THREE.Vector3, seed: number, skin: THREE.Color, out: THREE.Color, fx: HeroFx): number {
  const f = flayMask(joint, p, seed);
  const n = 0.5 + 0.5 * noise3(p.x * 40, p.y * 40, p.z * 40, seed);
  if (f > 0.5) {
    // Raw muscle: dark fibres with bright wet ridges, clotted blood and pale sinew, never flat red.
    const ang = Math.atan2(p.x, p.z);
    const fib = 0.5 + 0.5 * Math.sin(ang * 52 + 5 * noise3(0, p.y * 12, 0, seed + 3));
    const fine = 0.5 + 0.5 * Math.sin(ang * 130 + 9 * noise3(0, p.y * 25, 0, seed + 4));
    out.copy(FIBRE_DARK).lerp(FIBRE_LIGHT, Math.pow(fib, 2.2) * 0.9 * (0.4 + 0.6 * n) + 0.25 * fine);
    const clot = THREE.MathUtils.smoothstep(fbmStain(p, seed + 21), 0.55, 0.78);
    out.lerp(CLOT, clot * 0.8);
    const sinew = THREE.MathUtils.smoothstep(noise3(p.x * 18, p.y * 4, p.z * 18, seed + 31), 0.5, 0.8);
    out.lerp(SINEW, sinew * 0.55);
    fx.rot = -1; // wet: the shader drops roughness for negative aRot
    return 0;
  }
  if (f > 0.02) {
    out.copy(CRUST).lerp(FIBRE_DARK, 0.4 * n);
    fx.rot = 0.7;
    return 0;
  }
  if (shirtCovers(joint, p, seed)) {
    const trousers = joint === 'pelvis' || joint.startsWith('thigh') || joint.startsWith('shin');
    out.copy(trousers ? TROUSER : SHIRT).multiplyScalar(0.82 + 0.2 * n);
    const stain = THREE.MathUtils.smoothstep(fbmStain(p, seed), 0.45, 0.7);
    out.lerp(SHIRT_STAIN, stain * 0.85);
    return 0;
  }
  const scar = scarRidge(p, seed);
  const valley = THREE.MathUtils.clamp(muscle(joint, p) / 0.03, -1, 1); // groove -1, bulge +1
  const ao = 0.62 + 0.38 * THREE.MathUtils.smoothstep(valley, -0.7, 0.6);
  out.copy(skin).lerp(SALLOW, 0.7).multiplyScalar((0.4 + 0.2 * n) * ao);
  out.lerp(BRUISE, 0.55 * THREE.MathUtils.smoothstep(fbmStain(p, seed + 9), 0.5, 0.75));
  const vein = Math.abs(noise3(p.x * 26, p.y * 7, p.z * 26, seed + 12));
  out.lerp(VEIN, 0.6 * Math.max(0, 1 - vein * 6));
  out.lerp(SCAR, 0.7 * scar);
  return 0.3; // keep most of the painted tone; the infection shader still adds some sheen
}

function fbmStain(p: THREE.Vector3, seed: number): number {
  return 0.5 + 0.5 * fbm3(p.x * 14, p.y * 14, p.z * 14, seed + 77, 3);
}

/** Cloth colour for tatters: dirty coat with blood wicking up from the hem. */
export function tatterColor(p: THREE.Vector3, seed: number, base: THREE.Color, out: THREE.Color, hemY: number): number {
  const n = 0.5 + 0.5 * noise3(p.x * 30, p.y * 30, p.z * 30, seed);
  out.copy(base).multiplyScalar(0.78 + 0.22 * n);
  const blood = THREE.MathUtils.smoothstep(fbmStain(p, seed) + (hemY - p.y) * 0.8, 0.55, 0.8);
  out.lerp(SHIRT_STAIN, blood * 0.9);
  return 0;
}

/**
 * Hanging cloth strip in the local XY plane, top at y = 0, running down `length`.
 * `curl` bows it out in +Z; `jag` ragged-ness of the hem. Double sided.
 */
export function tatterStrip(width: number, length: number, curl: number, jag: number, seed: number, cols = 6, rows = 10, thick = 0.007): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const hem: number[] = [];
  for (let c = 0; c <= cols; c++) {
    const u = c / cols;
    const colLen = length * (1 - jag * (0.5 + 0.5 * noise3(c * 1.7, 0.2, 0.4, seed)) * (c % 2 ? 1 : 0.35));
    for (let r = 0; r <= rows; r++) {
      const t = r / rows;
      const y = -colLen * t;
      const x = (u - 0.5) * width * (1 + 0.25 * t) + 0.01 * noise3(c, r * 0.5, 0.1, seed);
      const z = curl * t * t + 0.03 * Math.sin(u * 9.4 + seed) * (0.3 + t) + 0.012 * Math.sin(u * 23 + seed * 2) * t;
      pos.push(x, y, z);
      hem.push(y);
    }
  }
  const stride = rows + 1;
  const n = pos.length / 3;
  // Back sheet sits `thick` behind the front, thinning toward the hem, so the cloth has a body and a visible edge.
  for (let i = 0; i < n; i++) {
    const t = (i % stride) / rows;
    pos.push(pos[i * 3] as number, pos[i * 3 + 1] as number, (pos[i * 3 + 2] as number) - thick * (1 - 0.45 * t));
  }
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const a = c * stride + r;
      const b = (c + 1) * stride + r;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
      idx.push(n + a, n + a + 1, n + b, n + b, n + a + 1, n + b + 1);
    }
  }
  // Edge walls (both windings) along the sides and the hem close the gap between the sheets.
  const wall = (f0: number, f1: number): void => {
    idx.push(f0, f1, n + f0, f1, n + f1, n + f0, f0, n + f0, f1, f1, n + f0, n + f1);
  };
  for (let r = 0; r < rows; r++) {
    wall(r, r + 1);
    wall(cols * stride + r, cols * stride + r + 1);
  }
  for (let c = 0; c < cols; c++) wall(c * stride + rows, (c + 1) * stride + rows);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A thick, ragged sheet of cloth over a parametric surface. `at(u, v)` gives a point for u, v in 0..1;
 * the sheet's outer face points along du x dv times `outward` (1 or -1). The back sheet sits `thick`
 * behind it, the far edge (v = 1) is torn by `jag`, and walls close the rim. Double sided like tatterStrip.
 */
export function clothPatch(
  cols: number,
  rows: number,
  at: (u: number, v: number) => readonly [number, number, number],
  outward: 1 | -1,
  thick: number,
  jag: number,
  seed: number,
): THREE.BufferGeometry {
  const stride = rows + 1;
  const front: THREE.Vector3[] = [];
  for (let c = 0; c <= cols; c++) {
    const u = c / cols;
    const vMax = 1 - jag * (0.5 + 0.5 * noise3(c * 1.9, 0.3, 0.7, seed)) * (c % 2 ? 1 : 0.3);
    for (let r = 0; r <= rows; r++) {
      const p = at(u, (r / rows) * vMax);
      front.push(new THREE.Vector3(p[0], p[1], p[2]));
    }
  }
  const at2 = (c: number, r: number): THREE.Vector3 => front[Math.min(cols, Math.max(0, c)) * stride + Math.min(rows, Math.max(0, r))] as THREE.Vector3;
  const pos: number[] = [];
  const nrm = new THREE.Vector3();
  const du = new THREE.Vector3();
  const dv = new THREE.Vector3();
  for (const v of front) pos.push(v.x, v.y, v.z);
  for (let c = 0; c <= cols; c++) {
    for (let r = 0; r <= rows; r++) {
      du.subVectors(at2(c + 1, r), at2(c - 1, r));
      dv.subVectors(at2(c, r + 1), at2(c, r - 1));
      nrm.crossVectors(du, dv).normalize().multiplyScalar(outward * thick * (1 - 0.4 * (r / rows)));
      const v = at2(c, r);
      pos.push(v.x - nrm.x, v.y - nrm.y, v.z - nrm.z);
    }
  }
  const n = front.length;
  const idx: number[] = [];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const a = c * stride + r;
      const b = (c + 1) * stride + r;
      if (outward > 0) {
        idx.push(a, b, a + 1, b, b + 1, a + 1, n + a, n + a + 1, n + b, n + b, n + a + 1, n + b + 1);
      } else {
        idx.push(a, a + 1, b, b, a + 1, b + 1, n + a, n + b, n + a + 1, n + b, n + b + 1, n + a + 1);
      }
    }
  }
  const wall = (f0: number, f1: number): void => {
    idx.push(f0, f1, n + f0, f1, n + f1, n + f0, f0, n + f0, f1, f1, n + f0, n + f1);
  };
  for (let r = 0; r < rows; r++) {
    wall(r, r + 1);
    wall(cols * stride + r, cols * stride + r + 1);
  }
  for (let c = 0; c < cols; c++) wall(c * stride + rows, (c + 1) * stride + rows);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Gaunt hero face: heavy brow, hollow cheeks, deep sockets, sunken temples. `origin` is the
 * position of the geometry's local origin in head space (zero for the skull, the jaw hinge for the jaw).
 */
export function sculptHeroHead(g: THREE.BufferGeometry, origin: readonly [number, number, number]): void {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  const q = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    q.set(pos.getX(i) + origin[0], pos.getY(i) + origin[1], pos.getZ(i) + origin[2]);
    let d = 0;
    if (q.z < -0.03) {
      const ax = Math.abs(q.x);
      d += gauss(q, 0, 0.112, -0.088, 0.05, 0.008, 0.02, 0.013); // brow ridge
      for (const s of [-1, 1]) {
        d -= gauss(q, s * 0.03, 0.104, -0.088, 0.018, 0.016, 0.02, 0.011); // sockets
        d -= gauss(q, s * 0.055, 0.062, -0.07, 0.03, 0.035, 0.035, 0.013); // hollow cheeks
        d += gauss(q, s * 0.05, 0.088, -0.078, 0.02, 0.012, 0.02, 0.006); // cheekbones
        d -= gauss(q, s * 0.07, 0.11, -0.04, 0.02, 0.03, 0.04, 0.007); // temples
      }
      if (ax < 0.012) d -= gauss(q, 0, 0.088, -0.092, 0.012, 0.012, 0.02, 0.006); // nose bridge pinched
    }
    d += 0.0016 * noise3(q.x * 120, q.y * 120, q.z * 120, 41);
    pos.setXYZ(i, pos.getX(i) + nrm.getX(i) * d, pos.getY(i) + nrm.getY(i) * d, pos.getZ(i) + nrm.getZ(i) * d);
  }
  g.computeVertexNormals();
}
