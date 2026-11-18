import * as THREE from 'three';
import { Field, meshField, type Bounds } from './sdf.ts';
import { fabricNormalMap, skinNormalMap, valueNoise } from './detailMaps.ts';

/**
 * Procedural first-person hand + sleeve (realism pass). Built from the anatomy outward:
 * a skeleton of joint positions posed with forward kinematics, fleshed out as a smooth
 * signed-distance field (palm, thenar mass, tendons, knuckles, finger pads), meshed once,
 * then given vertex-colour skin detail (veins, creases, blood-warmed tips) and real nails.
 *
 * Local frame (LEFT hand): +X toward the fingertips, +Y the back of the hand, +Z toward the
 * thumb, origin at the wrist crease. Right hands reuse the same build mirrored (scale.z = -1).
 */

export interface FingerPose {
  /** Flexion in radians at the knuckle, middle joint and fingertip joint (positive = curl to the palm). */
  mcp: number;
  pip: number;
  dip: number;
  /** Sideways splay of the whole finger in radians (positive = toward the thumb). */
  spread?: number;
}

/** A thumb segment direction: yaw swings toward +Z (the thumb side), pitch dips toward the palm. */
export type Dir = [yaw: number, pitch: number];

export interface ThumbPose {
  mc: Dir;
  pp: Dir;
  dp: Dir;
}

export interface HandPose {
  index: FingerPose;
  middle: FingerPose;
  ring: FingerPose;
  little: FingerPose;
  thumb: ThumbPose;
}

export interface HandMaterials {
  skin: THREE.MeshPhysicalMaterial;
  nail: THREE.MeshPhysicalMaterial;
  sleeve: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  screen: THREE.MeshStandardMaterial;
}

export function createHandMaterials(skinTone: THREE.ColorRepresentation = 0xb98468): HandMaterials {
  const skinMap = skinNormalMap();
  const fabricMap = fabricNormalMap();
  fabricMap.repeat.set(3, 3);
  const tone = new THREE.Color(skinTone);
  return {
    skin: new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.58,
      metalness: 0,
      normalMap: skinMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      sheen: 0.45,
      sheenRoughness: 0.55,
      sheenColor: tone.clone().lerp(new THREE.Color(0xffffff), 0.35),
      clearcoat: 0.06,
      clearcoatRoughness: 0.45,
      // Cheap subsurface stand-in: shadowed skin glows a little red instead of going grey.
      emissive: tone.clone().multiplyScalar(0.14).multiply(new THREE.Color(0xff5a3c)),
      emissiveIntensity: 1,
      envMapIntensity: 0.7,
    }),
    nail: new THREE.MeshPhysicalMaterial({
      color: tone.clone().lerp(new THREE.Color(0xf5d2c6), 0.75),
      roughness: 0.28,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.18,
    }),
    sleeve: new THREE.MeshStandardMaterial({
      color: 0x1d242b,
      roughness: 0.93,
      metalness: 0,
      normalMap: fabricMap,
      normalScale: new THREE.Vector2(0.9, 0.9),
      side: THREE.DoubleSide,
    }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.78, metalness: 0 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0a0f12, roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03 }),
    screen: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x2fd3ff, emissiveIntensity: 1.4, roughness: 0.3 }),
  };
}

// ---- anatomy (metres, adult male) -------------------------------------------------------

interface FingerSpec {
  base: THREE.Vector3;
  len: [number, number, number];
  radius: [number, number, number, number];
  pose: (p: HandPose) => FingerPose;
}

const TIP_PAD = 0.0068;

const FINGERS: FingerSpec[] = [
  { base: new THREE.Vector3(0.092, 0, 0.0285), len: [0.040, 0.023, 0.019], radius: [0.0094, 0.0085, 0.0077, 0.0068], pose: (p) => p.index },
  { base: new THREE.Vector3(0.094, 0, 0.0095), len: [0.044, 0.027, 0.020], radius: [0.0096, 0.0087, 0.0078, 0.0069], pose: (p) => p.middle },
  { base: new THREE.Vector3(0.089, 0, -0.0095), len: [0.041, 0.026, 0.019], radius: [0.0092, 0.0083, 0.0075, 0.0066], pose: (p) => p.ring },
  { base: new THREE.Vector3(0.080, 0, -0.0275), len: [0.033, 0.019, 0.017], radius: [0.0083, 0.0074, 0.0066, 0.0058], pose: (p) => p.little },
];

const THUMB_BASE = new THREE.Vector3(0.020, -0.007, 0.025);
const THUMB_LEN: [number, number, number] = [0.040, 0.028, 0.023];
const THUMB_RADIUS: [number, number, number, number] = [0.0118, 0.0101, 0.0091, 0.0081];

function flexDir(a: number, spread: number): THREE.Vector3 {
  const ca = Math.cos(a);
  return new THREE.Vector3(ca * Math.cos(spread), -Math.sin(a), ca * Math.sin(spread));
}

function thumbDir(d: Dir): THREE.Vector3 {
  const cp = Math.cos(d[1]);
  return new THREE.Vector3(cp * Math.cos(d[0]), -Math.sin(d[1]), cp * Math.sin(d[0]));
}

interface Digit {
  joints: THREE.Vector3[]; // base, prox end, mid end, tip
  dirs: THREE.Vector3[]; // per segment
  normals: THREE.Vector3[]; // dorsal normal per segment
  radius: number[];
  thumb: boolean;
}

function solveFinger(spec: FingerSpec, pose: FingerPose): Digit {
  const spread = pose.spread ?? 0;
  const angles = [pose.mcp, pose.mcp + pose.pip, pose.mcp + pose.pip + pose.dip];
  const joints = [spec.base.clone()];
  const dirs: THREE.Vector3[] = [];
  const normals: THREE.Vector3[] = [];
  for (let i = 0; i < 3; i++) {
    const a = angles[i]!;
    const d = flexDir(a, spread);
    const len = spec.len[i]! + (i === 2 ? TIP_PAD : 0);
    joints.push(joints[i]!.clone().addScaledVector(d, len));
    dirs.push(d);
    normals.push(new THREE.Vector3(Math.sin(a), Math.cos(a), 0).normalize());
  }
  return { joints, dirs, normals, radius: [...spec.radius], thumb: false };
}

function solveThumb(pose: ThumbPose): Digit {
  const joints = [THUMB_BASE.clone()];
  const dirs: THREE.Vector3[] = [];
  const normals: THREE.Vector3[] = [];
  const segs = [pose.mc, pose.pp, pose.dp];
  for (let i = 0; i < 3; i++) {
    const d = thumbDir(segs[i]!);
    const len = THUMB_LEN[i]! + (i === 2 ? TIP_PAD : 0);
    joints.push(joints[i]!.clone().addScaledVector(d, len));
    dirs.push(d);
    const up = new THREE.Vector3(0, 1, 0);
    up.addScaledVector(d, -up.dot(d));
    const side = new THREE.Vector3(0, 0, 1);
    side.addScaledVector(d, -side.dot(d));
    normals.push(up.addScaledVector(side, 0.55).normalize());
  }
  return { joints, dirs, normals, radius: [...THUMB_RADIUS], thumb: true };
}

const v3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

function addDigit(field: Field, dg: Digit): void {
  const { joints, dirs, normals, radius } = dg;
  if (dg.thumb) {
    // A thumb reads as three joints (CMC in the palm, MCP, IP): plain tapered capsules blended
    // smoothly, a single soft swell at each visible joint and one tip pad. No per-segment bulges.
    for (let i = 0; i < 3; i++) field.capsule(joints[i]!, joints[i + 1]!, radius[i]!, radius[i + 1]!, 0.008);
    for (const j of [1, 2] as const) {
      const n = normals[j - 1]!.clone().lerp(normals[j]!, 0.5).normalize();
      field.sphere(joints[j]!.clone().addScaledVector(n, 0.0008), radius[j]! * 0.97, 0.006);
    }
    const tipJ = joints[3]!;
    field.sphere(tipJ.clone().addScaledVector(dirs[2]!, -0.003).addScaledVector(normals[2]!, -radius[3]! * 0.25), radius[3]! * 0.98, 0.005);
    return;
  }
  for (let i = 0; i < 3; i++) {
    const a = joints[i]!;
    const b = joints[i + 1]!;
    field.capsule(a, b, radius[i]!, radius[i + 1]!, 0.004);
    const mid = a.clone().lerp(b, 0.5);
    const n = normals[i]!;
    const rm = (radius[i]! + radius[i + 1]!) * 0.5;
    // Finger pad: fuller on the palmar side.
    field.sphere(mid.clone().addScaledVector(n, -rm * 0.2), rm * 0.96, 0.003);
  }
  // Knuckle swell at the dorsal side of the middle and fingertip joints.
  const kn1 = joints[1]!.clone().addScaledVector(normals[0]!.clone().lerp(normals[1]!, 0.5).normalize(), dg.thumb ? 0.001 : 0.0017);
  field.sphere(kn1, radius[1]! * 0.93, 0.004);
  const kn2 = joints[2]!.clone().addScaledVector(normals[1]!.clone().lerp(normals[2]!, 0.5).normalize(), 0.0016);
  field.sphere(kn2, radius[2]! * 0.93, 0.004);
  // Fingertip pad, slightly proud under the tip.
  const tip = joints[3]!;
  field.sphere(tip.clone().addScaledVector(dirs[2]!, -0.0025).addScaledVector(normals[2]!, -radius[3]! * 0.28), radius[3]! * 1.0, 0.003);
}

function palmField(field: Field): void {
  const xc = 0.047;
  const hx = 0.047;
  const rr = 0.009;
  const bb: Bounds = [-0.002, -0.02, -0.05, 0.096, 0.02, 0.05];
  field.add((x, y, z) => {
    const u = Math.min(1, Math.max(0, x / 0.092));
    const hw = 0.031 + 0.0115 * u;
    const zc = 0.003 - 0.0025 * u;
    const hy = 0.0155 - 0.0035 * u;
    const qx = Math.abs(x - xc) - (hx - rr);
    const qy = Math.abs(y + 0.0015) - (hy - rr);
    const qz = Math.abs(z - zc) - (hw - rr);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - rr;
  }, bb, 0.006);
  // Thenar mass (thumb muscle), hypothenar edge, pads under the finger bases.
  field.ellipsoid(v3(0.036, -0.0085, 0.025), 0.027, 0.0125, 0.0185, 0.01);
  field.ellipsoid(v3(0.041, -0.0055, -0.031), 0.025, 0.0105, 0.0115, 0.008);
  field.ellipsoid(v3(0.083, -0.0065, 0.001), 0.0085, 0.0075, 0.041, 0.006);
  // Knuckles and the ridges of the metacarpals / extensor tendons on the back.
  for (const f of FINGERS) {
    field.sphere(v3(f.base.x - 0.001, 0.0082, f.base.z), 0.0088, 0.004);
    field.capsule(v3(0.008, 0.0128, f.base.z * 0.75), v3(f.base.x - 0.007, 0.0108, f.base.z), 0.0034, 0.0042, 0.007);
  }
  // Wrist and the stub of forearm that shows below the cuff; ulnar styloid bump.
  const wbb: Bounds = [-0.09, -0.03, -0.04, 0.014, 0.03, 0.04];
  field.add((x, y, z) => {
    const t = Math.min(1, Math.max(0, (x + 0.09) / 0.1));
    const ay = 0.0215 - 0.0012 * t;
    const az = 0.0295 + 0.0035 * t;
    const e = (Math.hypot(y / ay, z / az) - 1) * Math.min(ay, az);
    return Math.max(e, -0.09 - x);
  }, wbb, 0.012);
  field.sphere(v3(-0.012, 0.004, -0.0285), 0.0085, 0.008);
  field.sphere(v3(-0.004, 0.0, 0.0275), 0.0085, 0.008);
}

// ---- skin colouring ---------------------------------------------------------------------

function distToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = b.clone().sub(a);
  const t = Math.min(1, Math.max(0, p.clone().sub(a).dot(ab) / ab.lengthSq()));
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

function distToPolyline(p: THREE.Vector3, pts: THREE.Vector3[]): number {
  let m = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) m = Math.min(m, distToSegment(p, pts[i]!, pts[i + 1]!));
  return m;
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const VEINS = [
  [v3(0.012, 0.0125, 0.012), v3(0.04, 0.0128, 0.016), v3(0.066, 0.0118, 0.022), v3(0.086, 0.0098, 0.028)],
  [v3(0.008, 0.0135, -0.008), v3(0.03, 0.0132, 0.002), v3(0.056, 0.0126, 0.004), v3(0.082, 0.0105, -0.002)],
  [v3(0.02, 0.0125, -0.02), v3(0.045, 0.0122, -0.014), v3(0.07, 0.0108, -0.018)],
];
const PALM_LINES = [
  [v3(0.088, -0.011, 0.034), v3(0.07, -0.0125, 0.012), v3(0.058, -0.0125, -0.012), v3(0.05, -0.012, -0.03)],
  [v3(0.072, -0.0125, 0.032), v3(0.058, -0.0135, 0.012), v3(0.05, -0.0135, -0.004)],
  [v3(0.065, -0.0125, 0.03), v3(0.045, -0.0145, 0.026), v3(0.025, -0.0145, 0.016), v3(0.012, -0.0125, 0.01)],
];

function skinColor(base: THREE.Color, p: THREE.Vector3, n: THREE.Vector3, digits: Digit[], out: number[]): void {
  let r = 1, g = 1, b = 1;
  const dorsal = smoothstep(0.1, 0.7, n.y);
  const palmar = smoothstep(0.1, 0.7, -n.y);
  // Mottling.
  const m = valueNoise(p.x * 40 + 3.1, p.z * 40 + 1.7, 16, 21) * 0.5 + valueNoise(p.y * 60 + 5.3, p.x * 60 + 8.2, 16, 22) * 0.5;
  const mott = 0.94 + m * 0.12;
  r *= mott; g *= 0.98 + m * 0.04; b *= 0.98 + m * 0.04;
  // Veins on the back of the hand.
  if (dorsal > 0 && p.x > 0.005 && p.x < 0.092) {
    for (const v of VEINS) {
      const d = distToPolyline(p, v);
      const k = (1 - smoothstep(0.0014, 0.0042, d)) * dorsal * 0.55;
      r *= 1 - k * 0.22; g *= 1 - k * 0.16; b *= 1 - k * 0.04;
    }
  }
  // Palm creases.
  if (palmar > 0 && p.x > 0.008 && p.x < 0.09) {
    for (const v of PALM_LINES) {
      const d = distToPolyline(p, v);
      const k = (1 - smoothstep(0.0005, 0.0019, d)) * palmar;
      r *= 1 - k * 0.2; g *= 1 - k * 0.34; b *= 1 - k * 0.3;
    }
  }
  for (const dg of digits) {
    // Joint creases on the palmar side and warm knuckles on the back.
    for (let i = 1; i <= 2; i++) {
      const j = dg.joints[i]!;
      const d = p.distanceTo(j);
      const near = 1 - smoothstep(0.004, 0.011, d);
      if (near <= 0) continue;
      const side = n.dot(dg.normals[Math.min(i, 2) - 1]!);
      if (side < -0.2) {
        const k = near * smoothstep(0.2, 0.8, -side);
        r *= 1 - k * 0.1; g *= 1 - k * 0.2; b *= 1 - k * 0.2;
      } else if (side > 0.2) {
        const k = near * smoothstep(0.2, 0.8, side) * (dg.thumb ? 0.5 : 1);
        r *= 1 + k * 0.05; g *= 1 - k * 0.1; b *= 1 - k * 0.1;
      }
    }
    // Fingertips run warmer; nail bed paler (nail covers it, but the cuticle edge shows).
    const tip = dg.joints[3]!;
    const dt = p.distanceTo(tip);
    const warm = 1 - smoothstep(0.004, 0.016, dt);
    r *= 1 + warm * 0.08; g *= 1 - warm * 0.1; b *= 1 - warm * 0.08;
  }
  // Knuckle blush across the metacarpal heads.
  for (const f of FINGERS) {
    const d = Math.hypot(p.x - f.base.x, p.z - f.base.z) / 0.012;
    const k = (1 - smoothstep(0.5, 1.3, d)) * dorsal;
    r *= 1 + k * 0.05; g *= 1 - k * 0.1; b *= 1 - k * 0.08;
  }
  // Wrist: a touch paler toward the sleeve (shaded).
  const sh = smoothstep(-0.08, -0.03, p.x);
  r *= 0.84 + sh * 0.16; g *= 0.86 + sh * 0.14; b *= 0.88 + sh * 0.12;
  out[0] = base.r * r;
  out[1] = base.g * g;
  out[2] = base.b * b;
}

// ---- nails, sleeve, watch ----------------------------------------------------------------

function nailGeometry(dg: Digit, widthScale = 1): THREE.BufferGeometry {
  const dir = dg.dirs[2]!;
  const n = dg.normals[2]!;
  const side = new THREE.Vector3().crossVectors(dir, n).normalize();
  const r = dg.radius[3]!;
  const g = new THREE.SphereGeometry(1, 20, 12);
  // Slightly dished plate: long along the finger, thin, a little curved across.
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    pos.setXYZ(i, x * 0.0052, y * 0.00095 - z * z * 0.0007, z * (r * 0.62) * widthScale);
  }
  g.computeVertexNormals();
  const basis = new THREE.Matrix4().makeBasis(dir, n, side);
  const centre = dg.joints[2]!.clone().addScaledVector(dir, (dg.joints[3]!.distanceTo(dg.joints[2]!)) * 0.52).addScaledVector(n, r * 0.9);
  g.applyMatrix4(basis.setPosition(centre));
  return g;
}

function sleeveGeometry(x0: number, x1: number, ry0: number, rz0: number, ry1: number, rz1: number): THREE.BufferGeometry {
  const rings = 40;
  const radial = 40;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const x = x0 + (x1 - x0) * t;
    const flare = t * t * (3 - 2 * t);
    const ry = ry0 + (ry1 - ry0) * flare;
    const rz = rz0 + (rz1 - rz0) * flare;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      // Fabric folds bunch up near the cuff and relax toward the elbow.
      const fold = (Math.sin(a * 6 + x * 55) * 0.0016 + Math.sin(a * 3 - x * 25) * 0.0022) * (1 - t * 0.6) * (i === 0 ? 0 : 1);
      const bulge = i < 3 ? 1 + (3 - i) * 0.012 : 1; // rolled hem
      pos.push(x, Math.cos(a) * (ry * bulge + fold), Math.sin(a) * (rz * bulge + fold));
      uv.push(j / radial, t * 3);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function watchGroup(m: HandMaterials): THREE.Group {
  const g = new THREE.Group();
  g.name = 'watch';
  const x = -0.026;
  // Strap: a rubber ring hugging the wrist ellipse.
  const strap = new THREE.TorusGeometry(1, 0.0016, 8, 48);
  strap.rotateY(Math.PI / 2);
  strap.scale(1, 0.0215 + 0.0014, 0.0305 + 0.0014);
  const strapMesh = new THREE.Mesh(strap, m.rubber);
  strapMesh.position.set(x, 0, 0);
  const wide = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.017, 48, 1, true), m.rubber);
  wide.rotation.z = Math.PI / 2;
  wide.scale.set(0.0215 + 0.0018, 1, 0.0305 + 0.0018);
  wide.position.set(x, 0, 0);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.0095, 0.033), m.rubber);
  head.position.set(x, 0.0272, 0);
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.031, 0.0016, 0.028), m.glass);
  bezel.position.set(x, 0.0326, 0);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.022, 0.0155), m.screen);
  face.rotation.x = -Math.PI / 2;
  face.position.set(x, 0.0335, 0);
  g.add(wide, strapMesh, head, bezel, face);
  return g;
}

export interface HandOptions {
  /** Mirror to build a right hand. */
  right: boolean;
  materials: HandMaterials;
  skinTone?: THREE.ColorRepresentation;
  watch?: boolean;
  /** Mesh resolution in metres. */
  voxel?: number;
  /** Bend of the wrist/forearm relative to the hand (radians): yaw about the hand's Y, pitch about its Z. */
  bend?: { yaw: number; pitch: number };
}

/** Yaw/pitch that swing the forearm axis (-X) onto `e` (a unit vector in the hand's built frame). */
export function bendToward(e: THREE.Vector3): { yaw: number; pitch: number } {
  return { pitch: Math.asin(THREE.MathUtils.clamp(-e.y, -1, 1)), yaw: Math.atan2(e.z, -e.x) };
}

/** Bend the wrist region of a mesh: vertices behind the wrist crease swing by up to (yaw, pitch). */
function bendMesh(positions: Float32Array, normals: Float32Array, yaw: number, pitch: number): void {
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < positions.length / 3; i++) {
    v.fromArray(positions, i * 3);
    if (v.x >= 0) continue;
    const t = smoothstep(0, 1, Math.min(1, -v.x / 0.055));
    const a = yaw * t;
    const b = pitch * t;
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
    const rot = (u: THREE.Vector3): void => {
      const x1 = u.x * cb - u.y * sb;
      const y1 = u.x * sb + u.y * cb;
      u.set(x1 * ca + u.z * sa, y1, -x1 * sa + u.z * ca);
    };
    rot(v);
    v.toArray(positions, i * 3);
    n.fromArray(normals, i * 3);
    rot(n);
    n.toArray(normals, i * 3);
  }
}

export interface BuiltHand {
  group: THREE.Group;
  skin: THREE.Mesh;
  /** Fingertip positions in the hand's local frame (index, middle, ring, little, thumb). */
  tips: THREE.Vector3[];
}

export function buildHand(pose: HandPose, opts: HandOptions): BuiltHand {
  const digits = [...FINGERS.map((f) => solveFinger(f, f.pose(pose))), solveThumb(pose.thumb)];
  const field = new Field();
  palmField(field);
  for (const dg of digits) addDigit(field, dg);
  const bounds = field.bounds(0.004);
  const mesh = meshField((x, y, z) => field.eval(x, y, z), bounds, opts.voxel ?? 0.0013);

  const bend = opts.bend ?? { yaw: 0, pitch: 0 };
  const count = mesh.positions.length / 3;
  const colors = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const base = new THREE.Color(opts.skinTone ?? 0xb98468);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const col = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    p.fromArray(mesh.positions, i * 3);
    n.fromArray(mesh.normals, i * 3);
    skinColor(base, p, n, digits, col);
    colors[i * 3] = col[0]!;
    colors[i * 3 + 1] = col[1]!;
    colors[i * 3 + 2] = col[2]!;
    // Box-projected UVs for the micro-relief (triangles are ~1 mm, so seams don't read).
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    const s = 1 / 0.016;
    if (ay >= ax && ay >= az) { uvs[i * 2] = p.x * s; uvs[i * 2 + 1] = p.z * s; }
    else if (ax >= az) { uvs[i * 2] = p.z * s; uvs[i * 2 + 1] = p.y * s; }
    else { uvs[i * 2] = p.x * s; uvs[i * 2 + 1] = p.y * s; }
  }
  if (bend.yaw !== 0 || bend.pitch !== 0) bendMesh(mesh.positions, mesh.normals, bend.yaw, bend.pitch);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geo.computeBoundingSphere();
  const skin = new THREE.Mesh(geo, opts.materials.skin);
  skin.name = 'skin';

  const group = new THREE.Group();
  group.name = opts.right ? 'hand-right' : 'hand-left';
  group.add(skin);
  digits.forEach((dg, i) => {
    const nail = new THREE.Mesh(nailGeometry(dg, i === 4 ? 1.12 : i === 3 ? 0.88 : 1), opts.materials.nail);
    nail.name = 'nail';
    group.add(nail);
  });
  const forearm = new THREE.Group();
  forearm.name = 'forearm';
  forearm.rotation.order = 'YZX';
  forearm.rotation.set(0, bend.yaw, bend.pitch);
  const sleeve = new THREE.Mesh(sleeveGeometry(-0.046, -0.4, 0.034, 0.0415, 0.058, 0.066), opts.materials.sleeve);
  sleeve.name = 'sleeve';
  forearm.add(sleeve);
  if (opts.watch) forearm.add(watchGroup(opts.materials));
  group.add(forearm);
  if (opts.right) group.scale.z = -1;
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = false;
      o.receiveShadow = false;
    }
  });
  return { group, skin, tips: digits.map((d) => d.joints[3]!.clone()) };
}
