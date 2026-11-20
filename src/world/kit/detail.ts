import * as THREE from 'three';
import type { Rng } from '../../core/rng.ts';
import type { Materials } from '../../render/materials.ts';
import { createSeabed } from '../../render/fx/seabed.ts';
import { at, cylinderBetween, pipe, rounded } from './geom.ts';
import { slab } from './shapes.ts';
import { WINDOW_HEAD, WINDOW_SILL, type PieceBuilder } from './types.ts';
import type { ResolvedPalette } from './palettes.ts';

/**
 * Reusable detail for kit pieces. Walls are authored in a canonical frame (running
 * along X, centred on x = 0, inner face on z = 0 facing +Z, built back into -Z) and
 * placed with a matrix, so corridors and room tiles share the same panel language.
 */

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Record a box (centre and size in the wall frame `f`) as a wall keep-out, as its axis-aligned bounds in piece space. */
function keepoutIn(pb: PieceBuilder, f: THREE.Matrix4, cx: number, cy: number, cz: number, w: number, h: number, d: number): void {
  const box = new THREE.Box3();
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) box.expandByPoint(V(cx + (sx * w) / 2, cy + (sy * h) / 2, cz + (sz * d) / 2).applyMatrix4(f));
  pb.keepout({ min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] });
}

/** Matrix for a canonical wall whose inner face sits at (x, z) facing `facing` (radians). */
export function wallFrame(x: number, z: number, facing: number): THREE.Matrix4 {
  return at(x, 0, z, 0, facing, 0);
}

/** Compose a local transform inside a frame. */
export function inFrame(frame: THREE.Matrix4, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Matrix4 {
  return frame.clone().multiply(at(x, y, z, rx, ry, rz));
}

export interface WallOptions {
  length: number;
  backdropDepth?: number;
  height: number;
  /** Back slab depth behind the face. */
  depth?: number;
  /** Pilaster at the -X end (rooms put one at every tile's left end). */
  pilaster?: boolean;
  /** Cable tray with sagging cables near the top. */
  cables?: boolean;
  /** Area palette (kit/palettes.ts); omitted = dark panels and steel trim. */
  pal?: ResolvedPalette;
}

/** Back slab, skirting and trim common to every wall style. */
function wallBase(pb: PieceBuilder, m: Materials, rng: Rng, f: THREE.Matrix4, o: WallOptions, backing: THREE.Material): void {
  const L = o.length;
  const h = o.height;
  const depth = o.depth ?? 0.12;
  const trim = o.pal?.trim ?? m.steel;
  pb.add(slab(L, h + 0.1, depth), backing, inFrame(f, 0, h / 2 - 0.05, -depth / 2));
  pb.add(slab(L - 0.08, 0.24, 0.03), m.steelBrushed, inFrame(f, 0, 0.12, 0.015));
  pb.add(slab(L, 0.06, 0.06), trim, inFrame(f, 0, Math.min(2.55, h - 0.5), 0.03));
  keepoutIn(pb, f, 0, Math.min(2.55, h - 0.5), 0.03, L, 0.06, 0.06);
  if (o.pilaster) pilaster(pb, trim, f, -L / 2 + 0.11, h);
  if (o.cables) {
    const trayY = Math.min(h, 3.2) - 0.55;
    cableTray(pb, m, rng, f, L, trayY, 0.3);
    keepoutIn(pb, f, 0, trayY - 0.1, 0.15, L, 0.25, 0.3); // tray plus sagging cables
  }
}

function pilaster(pb: PieceBuilder, trim: THREE.Material, f: THREE.Matrix4, x: number, h: number): void {
  pb.add(rounded(0.22, h, 0.16, 0.03), trim, inFrame(f, x, h / 2, 0.08));
  keepoutIn(pb, f, x, h / 2, 0.08, 0.22, h, 0.16);
  for (let y = 0.45; y < h - 0.3; y += 0.65) {
    for (const dx of [-0.06, 0.06]) pb.add(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 6), trim, inFrame(f, x + dx, y, 0.165, Math.PI / 2, 0, 0));
  }
}

/** Tray with three sagging cables (seeded sag). */
export function cableTray(pb: PieceBuilder, m: Materials, rng: Rng, f: THREE.Matrix4, L: number, y: number, out: number): void {
  pb.add(slab(L, 0.025, out, 0.5), m.grating, inFrame(f, 0, y, out / 2));
  for (let c = 0; c < 3; c++) {
    const z = 0.08 + c * 0.08;
    const sag = 0.08 + rng.range(0, 0.12);
    const a = -L / 2 + 0.1;
    const b = L / 2 - 0.1;
    const pts = [V(a, y + 0.02, z), V(a + L * 0.25, y - sag * 0.75, z), V(0, y - sag, z), V(b - L * 0.25, y - sag * 0.75, z), V(b, y + 0.02, z)];
    pb.add(pipe(pts.map((p) => p.applyMatrix4(f)), 0.012 + c * 0.005, 1, 6), m.cable);
  }
}

/** Plain wall: consistent plates with clean horizontal seams. */
export function plainWall(pb: PieceBuilder, m: Materials, rng: Rng, f: THREE.Matrix4, o: WallOptions): void {
  wallBase(pb, m, rng, f, o, o.pal?.wallMain ?? m.paintDark);
  const L = o.length;
  const h = o.height;
  const mat = o.pal?.wallMain ?? m.paintDark;
  const rows = h > 3.4 ? [0.3, 1.45, 2.7, 3.7] : [0.3, 1.45, 2.6];
  for (let i = 0; i < rows.length; i++) {
    const y0 = rows[i]!;
    const y1 = Math.min(rows[i + 1] ?? h - 0.1, h - 0.1);
    if (y1 - y0 < 0.3) continue;
    pb.add(rounded(L - 0.3, y1 - y0 - 0.06, 0.04, 0.015), mat, inFrame(f, 0, (y0 + y1) / 2, 0.02));
  }
}

/** Panelled wall in ~2 m bays: consistent lower panels, upper accent panels, ribs at bay ends. */
export function panelWall(pb: PieceBuilder, m: Materials, rng: Rng, f: THREE.Matrix4, o: WallOptions): void {
  wallBase(pb, m, rng, f, o, m.black);
  const lower = o.pal?.wallMain ?? m.paintDark;
  const upper = o.pal?.wallAlt ?? m.paintTeal;
  const L = o.length;
  const h = o.height;
  const bays = Math.max(1, Math.round(L / 2));
  const bayW = L / bays;
  for (let b = 0; b < bays; b++) {
    const xc = -L / 2 + bayW * (b + 0.5);
    const pw = bayW / 2 - 0.1;
    for (const dx of [-bayW / 4, bayW / 4]) {
      const x = xc + dx;
      pb.add(rounded(pw, 1.0, 0.06), lower, inFrame(f, x, 0.82, 0.03));
      pb.add(rounded(pw, 1.1, 0.06), upper, inFrame(f, x, 1.92, 0.03));
      if (h > 3.4) pb.add(rounded(pw, Math.min(1.2, h - 2.95), 0.06), lower, inFrame(f, x, 2.65 + Math.min(1.2, h - 2.95) / 2, 0.03));
    }
    if (b > 0) pilaster(pb, o.pal?.trim ?? m.steel, f, -L / 2 + bayW * b, h);
  }
}

/**
 * Window wall onto the abyss: low wall, glass, header, mullions. The abyss plane and
 * truss sit `outside` metres behind the face, so only use it on edges facing open water.
 */
export function windowWall(
  pb: PieceBuilder,
  m: Materials,
  f: THREE.Matrix4,
  o: WallOptions,
  abyss: { mesh: THREE.Mesh; uniforms: { uTime: { value: number }; uPortal?: { value: THREE.Vector4 } } } | null,
): void {
  const L = o.length;
  const h = o.height;
  const sill = WINDOW_SILL;
  const head = WINDOW_HEAD;
  const trim = o.pal?.trim ?? m.steel;
  pb.add(slab(L, sill + 0.1, 0.12), m.black, inFrame(f, 0, sill / 2 - 0.05, -0.06));
  pb.add(slab(L, h - head + 0.1, 0.12), m.black, inFrame(f, 0, (h + head) / 2 + 0.05, -0.06));
  pb.add(slab(L - 0.08, 0.24, 0.03), m.steelBrushed, inFrame(f, 0, 0.12, 0.015));
  pb.add(rounded(L - 0.1, 0.48, 0.06), o.pal?.wallMain ?? m.paintDark, inFrame(f, 0, 0.58, 0.03));
  pb.add(rounded(L, 0.14, 0.3, 0.03), trim, inFrame(f, 0, sill - 0.02, 0.06));
  pb.add(rounded(L, 0.18, 0.3, 0.03), trim, inFrame(f, 0, head + 0.06, 0.06));
  const mullions = Math.max(2, Math.round(L / 2) + 1);
  for (let i = 0; i < mullions; i++) {
    const x = -L / 2 + 0.07 + ((L - 0.14) * i) / (mullions - 1);
    pb.add(rounded(0.14, head - sill, 0.24, 0.03), trim, inFrame(f, x, (head + sill) / 2, 0.02));
  }
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(L, head - sill), m.glass);
  glass.applyMatrix4(inFrame(f, 0, (head + sill) / 2, -0.04));
  glass.renderOrder = 3;
  pb.dynamic(glass);

  // Station truss outside, silhouetted against the water.
  for (const x of [-L * 0.4, L * 0.35]) pb.add(slab(0.35, 10, 0.35), m.paintDark, inFrame(f, x, 1.2, -2.6));
  pb.add(slab(L * 3, 0.3, 0.3), m.paintDark, inFrame(f, 0, -0.8, -2.2));
  if (abyss) {
    const depth = o.backdropDepth ?? 9;
    abyss.mesh.scale.set(depth / 9, depth / 9, 1);
    abyss.mesh.applyMatrix4(inFrame(f, 0, 1.5, -depth));
    abyss.uniforms.uPortal?.value.set(depth, (head + sill) / 2 - 1.5, L / 2 + 0.04, (head - sill) / 2 + 0.04);
    pb.dynamic(abyss.mesh);
    pb.tick((t) => {
      abyss.uniforms.uTime.value = t;
    });
    // Keep the foreground seabed close to the glass.
    const seabed = createSeabed({ length: L, depth: Math.min(9, depth), floorY: -4.5, pad: 0.8, seed: Math.round(Math.abs(f.elements[12] * 31 + f.elements[14] * 17)) + 1 });
    seabed.applyMatrix4(f);
    pb.dynamic(seabed);
    // Marker consumed by Level.buildRoom to batch 3D ocean life across every window in the room (1 Mesh + 1 Points per room).
    const zone = new THREE.Object3D();
    zone.name = 'ocean-zone';
    zone.userData['oceanZone'] = { width: L, depth: Math.min(9, depth) };
    zone.applyMatrix4(inFrame(f, 0, (head + sill) / 2, 0));
    pb.dynamic(zone);
  }
}

/** Light housing (the loader adds the glowing diffuser for claimed slots). */
export function ceilingHousing(pb: PieceBuilder, m: Materials, x: number, y: number, z: number, ry = 0, trim: THREE.Material = m.steel): void {
  pb.add(rounded(1.3, 0.09, 0.34, 0.02), trim, at(x, y + 0.045, z, 0, ry, 0));
  for (const dx of [-0.45, -0.15, 0.15, 0.45]) {
    pb.add(slab(0.02, 0.02, 0.32), trim, new THREE.Matrix4().multiplyMatrices(at(x, y - 0.012, z, 0, ry, 0), at(dx, 0, 0)));
  }
}

/** Pipe run between points with flanges every `flangeEvery` m and hangers to `ceilingY`. */
export function pipeRun(pb: PieceBuilder, m: Materials, points: THREE.Vector3[], r: number, mat: THREE.Material, ceilingY: number | null, flangeEvery = 2, trim: THREE.Material = m.steel): void {
  pb.add(pipe(points, r, 1, 14), mat);
  const curve = new THREE.CatmullRomCurve3(points);
  const len = curve.getLength();
  const n = Math.max(1, Math.floor(len / flangeEvery));
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const p = curve.getPointAt(u);
    const tan = curve.getTangentAt(u);
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), tan);
    const flange = new THREE.CylinderGeometry(r * 1.35, r * 1.35, 0.06, 14);
    flange.applyQuaternion(q);
    flange.translate(p.x, p.y, p.z);
    pb.add(flange, trim);
    if (ceilingY !== null && ceilingY > p.y + r + 0.02) {
      pb.add(cylinderBetween(V(p.x, ceilingY, p.z), V(p.x, p.y + r, p.z), 0.012, 6), trim);
    }
  }
}

/** Grid of bolts on a face (merged later, so they cost no draw calls). */
export function bolts(pb: PieceBuilder, m: Materials, f: THREE.Matrix4, xs: number[], ys: number[], z: number, trim: THREE.Material = m.steel): void {
  for (const x of xs) for (const y of ys) pb.add(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 6), trim, inFrame(f, x, y, z, Math.PI / 2, 0, 0));
}
