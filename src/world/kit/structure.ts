import * as THREE from 'three';
import type { Rng } from '../../core/rng.ts';
import type { Materials } from '../../render/materials.ts';
import { at, cylinderBetween, pipe, rounded } from './geom.ts';
import { slab } from './shapes.ts';
import { bolts, ceilingHousing, inFrame, panelWall, pipeRun, plainWall, wallFrame, windowWall } from './detail.ts';
import { resolvePalette, type ResolvedPalette } from './palettes.ts';
import { CORRIDOR_H, CORRIDOR_W, ROOM_H, WALL_INSET, WALL_T, PieceBuilder, boolParam, numParam, strParam, type PieceDef, type PieceOutput, type PieceParams } from './types.ts';

/**
 * Structural kit (ADR-0003): corridors, room tiles, door frames, stairs, catwalks.
 * Conventions: origin at the floor centre of the cell, cell spans x and z in [-2, 2].
 * Corridors are 3 m wide and 3.2 m high and open toward their sockets. Room wall tiles
 * sit on the cell's -Z edge (rot 90 = -X edge, 180 = +Z, 270 = +X) and face inward.
 */

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const HALF = 2;
const HW = CORRIDOR_W / 2;
const H = CORRIDOR_H;
const PI = Math.PI;

type Side = 'n' | 's' | 'e' | 'w';
const DIR: Record<Side, [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
const OPPOSITE: Record<Side, Side> = { n: 's', s: 'n', e: 'w', w: 'e' };
const SIDES: Side[] = ['n', 'e', 's', 'w'];

// ------------------------------------------------------------------ corridors

type Interval = [number, number];

function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[1] - iv[0]) < 1e-6) last[1] = iv[1];
    else out.push([iv[0], iv[1]]);
  }
  return out;
}

interface CorridorOptions {
  open: Set<Side>;
  /** Trench floor (gratings over a pipe channel) for straight runs. */
  trench: boolean;
  /** Replace the east wall with a window onto the abyss. */
  window: boolean;
}

function corridor(o: CorridorOptions, rng: Rng, m: Materials, p: PieceParams = {}): PieceOutput {
  const pb = new PieceBuilder();
  const pal = resolvePalette(p, m);
  const { open } = o;
  const isOpen = (s: Side): boolean => open.has(s);

  // Floor regions: centre square plus an arm per open side.
  const regions: Array<[number, number, number, number]> = [[-HW, -HW, HW, HW]];
  if (isOpen('n')) regions.push([-HW, -HALF, HW, -HW]);
  if (isOpen('s')) regions.push([-HW, HW, HW, HALF]);
  if (isOpen('e')) regions.push([HW, -HW, HALF, HW]);
  if (isOpen('w')) regions.push([-HALF, -HW, -HW, HW]);

  if (o.trench) {
    floorTrench(pb, m);
  } else {
    for (const [x0, z0, x1, z1] of regions) {
      pb.add(slab(x1 - x0, 0.1, z1 - z0), m.diamond, at((x0 + x1) / 2, -0.05, (z0 + z1) / 2));
    }
    // Inspection hatch in the middle.
    pb.add(rounded(1.3, 0.03, 1.3, 0.01), m.steel, at(0, 0.006, 0));
    pb.add(slab(1.1, 0.02, 1.1), m.paintDark, at(0, 0.02, 0));
    bolts(pb, m, at(0, 0.03, 0, -PI / 2, 0, 0), [-0.6, 0.6], [-0.6, 0.6], 0);
  }
  for (const [x0, z0, x1, z1] of regions) {
    pb.solid(x0, -0.2, z0, x1, 0, z1, 'metal');
    pb.add(slab(x1 - x0, 0.12, z1 - z0), m.paintDark, at((x0 + x1) / 2, H + 0.06, (z0 + z1) / 2));
    pb.solid(x0, H, z0, x1, H + 0.12, z1);
  }

  // Walls: gather intervals on the four wall lines and merge contiguous ones.
  const lines: Record<Side, Interval[]> = { n: [], s: [], e: [], w: [] };
  for (const side of ['e', 'w'] as const) {
    if (isOpen('n')) lines[side].push([-HALF, -HW]);
    if (!isOpen(side)) lines[side].push([-HW, HW]);
    if (isOpen('s')) lines[side].push([HW, HALF]);
  }
  for (const side of ['n', 's'] as const) {
    if (isOpen('w')) lines[side].push([-HALF, -HW]);
    if (!isOpen(side)) lines[side].push([-HW, HW]);
    if (isOpen('e')) lines[side].push([HW, HALF]);
  }
  let trayDone = false;
  for (const side of SIDES) {
    for (const [a, b] of mergeIntervals(lines[side])) {
      const L = b - a;
      const c = (a + b) / 2;
      // Frame: canonical wall along X facing +Z, placed on the line, facing the corridor.
      let f: THREE.Matrix4;
      if (side === 'e') f = wallFrame(HW, c, -PI / 2);
      else if (side === 'w') f = wallFrame(-HW, c, PI / 2);
      else if (side === 'n') f = wallFrame(c, -HW, 0);
      else f = wallFrame(c, HW, PI);
      if (side === 'e' && o.window) {
        windowWall(pb, m, f, { length: L, height: H, depth: 0.2, pal });
      } else if (L >= 1) {
        const cables = !trayDone && L >= 3 && (side === (o.window ? 'w' : 'e') || side === 'n' || side === 's');
        if (cables) trayDone = true;
        panelWall(pb, m, rng, f, { length: L, height: H, depth: 0.2, cables, pal });
      } else {
        plainWall(pb, m, rng, f, { length: L, height: H, depth: 0.2, pal });
      }
      const t = 0.25;
      if (side === 'e') pb.solid(HW, 0, a, HW + t, H, b);
      else if (side === 'w') pb.solid(-HW - t, 0, a, -HW, H, b);
      else if (side === 'n') pb.solid(a, 0, -HW - t, b, H, -HW);
      else pb.solid(a, 0, HW, b, H, HW + t);
    }
  }

  // Ribs: straight runs every 2 m; elsewhere at each opening.
  const straightNS = isOpen('n') && isOpen('s') && !isOpen('e') && !isOpen('w');
  if (straightNS) {
    rib(pb, m, 0, 0, 0);
    rib(pb, m, 0, -HALF, 0);
  } else {
    for (const s of SIDES) {
      if (!isOpen(s)) continue;
      const [dx, dz] = DIR[s];
      rib(pb, m, dx * HW, dz * HW, s === 'e' || s === 'w' ? PI / 2 : 0);
    }
  }

  // Ceiling pipes follow the corridor's path.
  pipes(pb, m, open, rng);
  if (straightNS && !o.window) {
    // Drop a valve wheel on the big pipe now and then.
    if (rng.chance(0.4)) valveWheel(pb, m, -0.9, 2.66, rng.range(-1.2, 1.2));
  }

  ceilingHousing(pb, m, 0, H - 0.1, 0, open.has('e') && !open.has('n') ? PI / 2 : 0);
  pb.light([0, H - 0.1, 0], 'ceiling', open.has('e') && !open.has('n') ? PI / 2 : 0);

  for (const s of SIDES) {
    if (!isOpen(s)) continue;
    const [dx, dz] = DIR[s];
    pb.socket(s, [dx * HALF, 0, dz * HALF], [dx, 0, dz], 'door');
    pb.nav(dx * 1.6, 0, dz * 1.6);
  }
  pb.socket('floor_center', [0, 0, 0], [0, 0, -1], 'floor');
  pb.socket('floor_center', [0, 0, 0], [0, 0, -1], 'floor');
  pb.nav(0, 0, 0);
  return pb.build();
}

/** Diamond-plate centre with grating strips over a pipe trench, along Z. */
function floorTrench(pb: PieceBuilder, m: Materials): void {
  pb.add(slab(1.8, 0.1, 4), m.diamond, at(0, -0.05, 0));
  for (const s of [-1, 1]) {
    const xc = s * 1.2;
    pb.add(slab(0.6, 0.03, 4, 1), m.grating, at(xc, -0.015, 0));
    pb.add(slab(0.6, 0.05, 4), m.paintDark, at(xc, -0.5, 0));
    pb.add(slab(0.05, 0.5, 4), m.paintDark, at(s * 0.9, -0.27, 0));
    for (let z = -1.75; z < 2; z += 1) pb.add(slab(0.6, 0.05, 0.05), m.steel, at(xc, -0.06, z));
    pb.add(pipe([V(s * 1.1, -0.32, -2), V(s * 1.1, -0.32, 2)], 0.07, 1, 12), m.steel);
    pb.add(pipe([V(s * 1.35, -0.4, -2), V(s * 1.35, -0.4, 2)], 0.035, 1, 8), m.cable);
    pb.add(slab(0.03, 0.02, 4), m.glowCyan, at(s * 1.46, -0.45, 0));
  }
  pb.surfaces.push({ box: { min: [-1.5, -0.2, -2], max: [-0.9, 0, 2] }, material: 'grate' });
  pb.surfaces.push({ box: { min: [0.9, -0.2, -2], max: [1.5, 0, 2] }, material: 'grate' });
}

/** Structural U-frame across the corridor at (x, z), rotated by ry. */
function rib(pb: PieceBuilder, m: Materials, x: number, z: number, ry: number): void {
  const f = at(x, 0, z, 0, ry, 0);
  for (const s of [-1, 1]) {
    pb.add(rounded(0.24, H - 0.05, 0.26, 0.03), m.steel, inFrame(f, s * (HW - 0.08), (H - 0.05) / 2, 0));
    pb.add(rounded(0.12, 0.6, 0.18, 0.02), m.steel, inFrame(f, s * (HW - 0.4), H - 0.42, 0, 0, 0, s * (PI / 4)));
    bolts(pb, m, inFrame(f, s * (HW - 0.2), 0, 0, 0, -s * (PI / 2), 0), [-0.08, 0.08], [0.4, 1.05, 1.7, 2.35], 0.0);
  }
  pb.add(rounded(CORRIDOR_W, 0.24, 0.26, 0.03), m.steel, inFrame(f, 0, H - 0.12, 0));
  // Ribs stand slightly proud of the wall; give them thin colliders.
  for (const s of [-1, 1]) {
    const p0 = new THREE.Vector3(s * (HW - 0.2), 0, -0.13).applyMatrix4(f);
    const p1 = new THREE.Vector3(s * HW, H, 0.13).applyMatrix4(f);
    pb.solid(Math.min(p0.x, p1.x), 0, Math.min(p0.z, p1.z), Math.max(p0.x, p1.x), H, Math.max(p0.z, p1.z));
  }
}

function valveWheel(pb: PieceBuilder, m: Materials, x: number, y: number, z: number, wheelMat: THREE.Material = m.paintTeal): void {
  pb.add(cylinderBetween(V(x, y + 0.24, z), V(x, y, z), 0.022), m.steel);
  pb.add(new THREE.TorusGeometry(0.14, 0.016, 8, 28), wheelMat, at(x, y, z, PI / 2, 0, 0));
  for (let k = 0; k < 3; k++) pb.add(slab(0.28, 0.012, 0.02), m.steel, at(x, y, z, 0, (k * PI) / 3, 0));
}

interface PipeSpec {
  o: number;
  y: number;
  r: number;
  mat: 'steel' | 'paintTeal' | 'paintDark';
  flanges: boolean;
}
const PIPES: PipeSpec[] = [
  { o: -0.9, y: 2.86, r: 0.1, mat: 'steel', flanges: true },
  { o: 0.75, y: 2.95, r: 0.06, mat: 'paintTeal', flanges: false },
  { o: 1.05, y: 2.84, r: 0.08, mat: 'paintDark', flanges: true },
];

function pipes(pb: PieceBuilder, m: Materials, open: Set<Side>, rng: Rng): void {
  const sides = SIDES.filter((s) => open.has(s));
  const path = (a: Side, b: Side, o: number, y: number): THREE.Vector3[] => {
    const [ax, az] = DIR[a];
    const [bx, bz] = DIR[b];
    // Right-hand side of someone walking from side a to side b.
    const rax = az;
    const raz = -ax;
    const rbx = -bz;
    const rbz = bx;
    if (a === OPPOSITE[b]) return [V(ax * HALF + rax * o, y, az * HALF + raz * o), V(bx * HALF + rax * o, y, bz * HALF + raz * o)];
    const corner = V((rax + rbx) * o, y, (raz + rbz) * o);
    const mid = (t: number, dx: number, dz: number, rx: number, rz: number): THREE.Vector3 => V(dx * t + rx * o, y, dz * t + rz * o);
    const ta = (HALF + Math.max(0, (ax * corner.x + az * corner.z))) / 2;
    const tb = (HALF + Math.max(0, (bx * corner.x + bz * corner.z))) / 2;
    return [mid(HALF, ax, az, rax, raz), mid(ta, ax, az, rax, raz), corner, mid(tb, bx, bz, rbx, rbz), mid(HALF, bx, bz, rbx, rbz)];
  };
  let pairs: Array<[Side, Side]> = [];
  let branch: Side | null = null;
  if (sides.length === 2) pairs = [[sides[0]!, sides[1]!]];
  else if (sides.length === 3) {
    const main = sides.find((s) => open.has(OPPOSITE[s]))!;
    pairs = [[main, OPPOSITE[main]]];
    branch = sides.find((s) => s !== main && s !== OPPOSITE[main]) ?? null;
  } else if (sides.length === 4) {
    pairs = [['n', 's']];
    branch = 'e';
  }
  for (const [a, b] of pairs) {
    for (const p of PIPES) pipeRun(pb, m, path(a, b, p.o, p.y), p.r, m[p.mat], H, p.flanges ? 2 : 99);
  }
  if (branch) {
    const [dx, dz] = DIR[branch];
    pipeRun(pb, m, [V(dx * HALF, 2.95, dz * HALF), V(dx * 0.3, 2.95, dz * 0.3)], 0.06, m.paintTeal, H, 99);
    pb.add(rounded(0.5, 0.3, 0.5, 0.04), m.steel, at(0, 2.95, 0));
  }
  if (sides.length === 1) {
    const s = sides[0]!;
    const [dx, dz] = DIR[s];
    for (const p of PIPES) {
      const rx = dz * p.o;
      const rz = -dx * p.o;
      pipeRun(pb, m, [V(dx * HALF + rx, p.y, dz * HALF + rz), V(rx - dx * 0.4, p.y, rz - dz * 0.4), V(rx - dx * 1.0, H + 0.1, rz - dz * 1.0)], p.r, m[p.mat], null, 99);
    }
  }
  if (rng.chance(0.3) && pairs.length) {
    // A hanging cable loop between pipe hangers.
    const [a] = pairs[0]!;
    const [ax, az] = DIR[a];
    const k = rng.range(-0.8, 0.8);
    pb.add(pipe([V(ax * 1.2 + az * k, 3.0, az * 1.2 - ax * k), V(az * k * 0.5, 2.2 + rng.range(0, 0.3), -ax * k * 0.5), V(-ax * 1.2 + az * k, 3.0, -az * 1.2 - ax * k)], 0.016, 1, 6), m.cable);
  }
}

function corridorDef(id: string, open: Side[], trench: boolean, window: boolean): PieceDef {
  return {
    id,
    family: 'structure',
    footprint: [1, 1],
    generate: (p, rng, m) => corridor({ open: new Set(open), trench, window }, rng, m, p),
  };
}

// ------------------------------------------------------------------ room tiles

const height = (p: PieceParams): number => numParam(p, 'height', ROOM_H);

function floorTile(p: PieceParams, rng: Rng, m: Materials, grate: boolean): PieceOutput {
  const pb = new PieceBuilder();
  const pal = resolvePalette(p, m);
  pb.add(slab(4, 0.1, 4), m.paintDark, at(0, -0.17, 0));
  if (grate || strParam(p, 'style', '') === 'grate') {
    pb.add(slab(4, 0.06, 0.12), pal.floorAlt, at(0, -0.03, -1.94));
    pb.add(slab(4, 0.06, 0.12), pal.floorAlt, at(0, -0.03, 1.94));
    pb.add(slab(0.12, 0.06, 3.76), pal.floorAlt, at(-1.94, -0.03, 0));
    pb.add(slab(0.12, 0.06, 3.76), pal.floorAlt, at(1.94, -0.03, 0));
    pb.add(slab(3.76, 0.03, 3.76, 1), m.grating, at(0, -0.015, 0));
    for (const x of [-0.94, 0, 0.94]) pb.add(slab(0.06, 0.08, 3.76), m.steel, at(x, -0.07, 0));
    pb.add(slab(3.8, 0.05, 3.8), m.black, at(0, -0.75, 0));
    for (const [x, r, mat] of [
      [-1.1, 0.12, m.steel],
      [-0.5, 0.07, pal.pipeAccent],
      [0.7, 0.09, pal.pipeMain],
      [1.3, 0.04, m.cable],
    ] as const) {
      pb.add(pipe([V(x, -0.55 + r, -2), V(x + rng.range(-0.1, 0.1), -0.55 + r, 2)], r, 1, 12), mat);
    }
    pb.add(slab(0.03, 0.02, 3.8), m.glowCyan, at(-1.8, -0.6, 0));
    pb.solid(-2, -0.2, -2, 2, 0, 2, 'grate');
  } else {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        pb.add(slab(1.98, 0.08, 1.98), pal.floor, at(sx, -0.04, sz));
      }
    }
    pb.solid(-2, -0.2, -2, 2, 0, 2, pal.floorSurface);
  }
  pb.socket('floor_center', [0, 0, 0], [0, 0, -1], 'floor');
  pb.nav(0, 0, 0);
  return pb.build();
}

function ceilingTile(p: PieceParams, rng: Rng, m: Materials, withPipes: boolean): PieceOutput {
  const pb = new PieceBuilder();
  const pal = resolvePalette(p, m);
  const h = height(p);
  pb.add(slab(4, 0.12, 4), pal.ceiling, at(0, h + 0.06, 0));
  for (const z of [-1, 1]) pb.add(rounded(4, 0.2, 0.22, 0.02), pal.trim, at(0, h - 0.1, z));
  pb.solid(-2, h, -2, 2, h + 0.12, 2);
  if (withPipes) {
    pipeRun(pb, m, [V(-1.3, h - 0.38, -2), V(-1.3, h - 0.38, 2)], 0.12, pal.trim, h, 2, pal.trim);
    pipeRun(pb, m, [V(-0.8, h - 0.32, -2), V(-0.8, h - 0.32, 2)], 0.06, pal.pipeAccent, h, 99, pal.trim);
    pipeRun(pb, m, [V(1.35, h - 0.42, -2), V(1.35, h - 0.42, 2)], 0.16, pal.pipeMain, h, 2, pal.trim);
    if (rng.chance(0.5)) valveWheel(pb, m, 1.35, h - 0.8, rng.range(-1.2, 1.2), pal.pipeAccent);
  }
  if (boolParam(p, 'fixture', true)) {
    ceilingHousing(pb, m, 0, h - 0.1, 0, PI / 2, pal.trim);
    pb.light([0, h - 0.1, 0], 'ceiling', PI / 2);
  }
  return pb.build();
}

type WallStyle = 'plain' | 'panel' | 'window' | 'screen' | 'glass' | 'vent';

function wallTile(p: PieceParams, rng: Rng, m: Materials, style: WallStyle): PieceOutput {
  const pb = new PieceBuilder();
  const pal = resolvePalette(p, m);
  const h = height(p);
  const f = wallFrame(0, -HALF + WALL_T, 0);
  const o = { length: 4, height: h, depth: WALL_T - WALL_INSET, pilaster: true, pal };
  if (style === 'plain' || style === 'vent') plainWall(pb, m, rng, f, o);
  else if (style === 'panel') panelWall(pb, m, rng, f, { ...o, cables: boolParam(p, 'cables', false) });
  else if (style === 'window') {
    windowWall(pb, m, f, { ...o, flicker: boolParam(p, 'flicker', false) });
  } else if (style === 'screen') {
    windowWall(pb, m, f, o, 'screen');
  } else {
    glassPartition(pb, m, f, h, pal);
  }
  if (style === 'vent') wallVent(pb, m, inFrame(f, 0.9, 0.55, 0.0), pal.trim);
  if (style === 'plain' || style === 'panel' || style === 'vent') {
    pb.socket('wall_center', [0, 1.4, -HALF + WALL_T], [0, 0, 1], 'wall');
  }
  // A glass partition muffles sound only lightly (in-world-audio: Glass muffles lightly).
  pb.solid(-HALF, 0, -HALF, HALF, h, -HALF + WALL_T, undefined, style === 'glass' ? 'glass' : undefined);
  return pb.build();
}

function glassPartition(pb: PieceBuilder, m: Materials, f: THREE.Matrix4, h: number, pal?: ResolvedPalette): void {
  const trim = pal?.trim ?? m.steel;
  const wall = pal ? (pal.wallMain === m.woodPanel ? pal.wallMain : pal.doorSurround) : m.paintDark;
  pb.add(rounded(4, 0.35, 0.2, 0.02), wall, inFrame(f, 0, 0.175, -0.1));
  pb.add(rounded(4, 0.12, 0.2, 0.02), trim, inFrame(f, 0, 2.6, -0.1));
  if (h > 2.7) pb.add(slab(4, h - 2.66, 0.2), wall, inFrame(f, 0, (h + 2.66) / 2, -0.1));
  for (const x of [-1.95, -0.65, 0.65, 1.95]) pb.add(rounded(0.1, 2.3, 0.22, 0.02), trim, inFrame(f, x, 1.45, -0.1));
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(3.9, 2.25), m.glass);
  glass.applyMatrix4(inFrame(f, 0, 1.475, -0.1));
  glass.renderOrder = 3;
  pb.dynamic(glass);
}

/** Wall vent with a spinning fan; its frame faces +Z in the given frame. */
function wallVent(pb: PieceBuilder, m: Materials, f: THREE.Matrix4, trim: THREE.Material = m.steel): void {
  for (const dy of [-0.28, 0.28]) pb.add(rounded(0.62, 0.06, 0.08, 0.01), trim, inFrame(f, 0, dy, 0.04));
  for (const dx of [-0.28, 0.28]) pb.add(rounded(0.06, 0.62, 0.08, 0.01), trim, inFrame(f, dx, 0, 0.04));
  pb.add(slab(0.5, 0.5, 0.015, 0.4), m.grating, inFrame(f, 0, 0, 0.05));
  pb.add(slab(0.5, 0.5, 0.01), m.black, inFrame(f, 0, 0, -0.1));
  const parts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(0.05, 0.05, 0.03, 12).rotateX(PI / 2)];
  for (let k = 0; k < 4; k++) {
    const a = (k * PI) / 2;
    const blade = new THREE.BoxGeometry(0.06, 0.2, 0.006);
    blade.rotateY(0.4);
    blade.translate(0, 0.12, 0);
    blade.rotateZ(a);
    parts.push(blade.toNonIndexed());
  }
  const merged = mergeFan(parts);
  const fan = new THREE.Mesh(merged, m.steel);
  fan.applyMatrix4(inFrame(f, 0, 0, -0.03));
  pb.dynamic(fan);
  pb.tick((_t, dt) => {
    fan.rotateZ(dt * 9);
  });
}

function mergeFan(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const list = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const total = list.reduce((n, g) => n + g.getAttribute('position').count, 0);
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  let o = 0;
  for (const g of list) {
    pos.set(g.getAttribute('position').array as Float32Array, o * 3);
    nor.set(g.getAttribute('normal').array as Float32Array, o * 3);
    o += g.getAttribute('position').count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

// ------------------------------------------------------------------ door frame

export interface DoorFrameMaterials {
  trim?: THREE.Material;
  /** Jamb/lintel inset strip on the +Z (cell) face; defaults to `m.paintDark`. */
  paintFront?: THREE.Material;
  /** Jamb/lintel inset strip on the -Z (far) face; defaults to `paintFront`. */
  paintBack?: THREE.Material;
  /** Wall filler & transom surround on the +Z (cell) face; defaults to `m.paintDark`. */
  surroundFront?: THREE.Material;
  /** Wall filler & transom surround on the -Z (far) face; defaults to `surroundFront`. */
  surroundBack?: THREE.Material;
}

/**
 * Door frame on the cell's -Z edge (straddling it by WALL_T on both sides), with a
 * 2 m x 2.4 m opening. `width` fills the rest of the edge, `height` the space above.
 * Door leaves are added by world/kit/doors.ts.
 */
export function doorFrame(pb: PieceBuilder, m: Materials, width: number, h: number, mats: DoorFrameMaterials = {}): void {
  const trim = mats.trim ?? m.steelBrushed;
  const paintFront = mats.paintFront ?? m.paintDark;
  const paintBack = mats.paintBack ?? paintFront;
  const surroundFront = mats.surroundFront ?? m.paintDark;
  const surroundBack = mats.surroundBack ?? surroundFront;
  const z = -HALF;
  const t = WALL_T * 2;
  const side = (width - 2.56) / 2;
  const splitSurround = surroundFront !== surroundBack;
  if (side > 0.01) {
    for (const s of [-1, 1]) {
      const x = s * (1.28 + side / 2);
      if (splitSurround) {
        pb.add(slab(side, h, WALL_T), surroundFront, at(x, h / 2, z + WALL_T / 2));
        pb.add(slab(side, h, WALL_T), surroundBack, at(x, h / 2, z - WALL_T / 2));
      } else {
        pb.add(slab(side, h, t), surroundFront, at(x, h / 2, z));
      }
    }
  }
  if (h > 2.76) {
    const th = h - 2.76;
    const ty = (h + 2.76) / 2;
    if (splitSurround) {
      pb.add(slab(2.56, th, WALL_T), surroundFront, at(0, ty, z + WALL_T / 2));
      pb.add(slab(2.56, th, WALL_T), surroundBack, at(0, ty, z - WALL_T / 2));
    } else {
      pb.add(slab(2.56, th, t), surroundFront, at(0, ty, z));
    }
  }
  for (const s of [-1, 1]) {
    pb.add(rounded(0.32, 2.76, 0.6, 0.03), trim, at(s * 1.16, 1.38, z));
    for (const fz of [-1, 1]) {
      pb.add(slab(0.2, 2.2, 0.02), fz > 0 ? paintFront : paintBack, at(s * 1.16, 1.2, z + fz * 0.305));
      bolts(pb, m, at(s * 1.16, 0, z + fz * 0.31, 0, fz > 0 ? 0 : PI, 0), [-0.1, 0.1], [0.25, 2.25], 0, trim);
    }
  }
  pb.add(rounded(2.64, 0.36, 0.6, 0.03), trim, at(0, 2.58, z));
  pb.add(rounded(2.0, 0.04, 0.56, 0.01), trim, at(0, 0, z));
  for (const fz of [-1, 1]) pb.add(slab(1.9, 0.16, 0.02), fz > 0 ? paintFront : paintBack, at(0, 2.58, z + fz * 0.305));
  const half = width / 2;
  pb.solid(-half, 0, z - WALL_T, -1, h, z + WALL_T);
  pb.solid(1, 0, z - WALL_T, half, h, z + WALL_T);
  pb.solid(-1, 2.4, z - WALL_T, 1, h, z + WALL_T);
  pb.socket('north', [0, 0, z], [0, 0, -1], 'door');
  pb.nav(0, 0, z + 0.9);
  pb.nav(0, 0, z - 0.9);
}

// ------------------------------------------------------------------ stairs and catwalk

/** Stairs rising toward -Z by `rise` m (default 2) over the cell, `steps` steps. */
function stairs(p: PieceParams, _rng: Rng, m: Materials): PieceOutput {
  const pb = new PieceBuilder();
  const rise = numParam(p, 'rise', 2);
  const n = Math.max(2, Math.round(numParam(p, 'steps', Math.ceil(rise / 0.25))));
  const w = numParam(p, 'width', 3);
  const rails = strParam(p, 'rails', 'both');
  const run = 3.6;
  const tread = run / n;
  const z0 = run / 2;
  const hw = w / 2;
  const profile = new THREE.Shape();
  profile.moveTo(-z0, 0);
  for (let i = 0; i < n; i++) {
    const top = ((i + 1) * rise) / n;
    const zf = z0 - i * tread;
    const zb = zf - tread;
    pb.add(slab(w - 0.1, 0.05, tread - 0.02), m.diamond, at(0, top - 0.025, (zf + zb) / 2));
    pb.add(slab(w - 0.1, rise / n, 0.03), m.paintDark, at(0, top - rise / n / 2, zf - 0.015));
    pb.add(slab(w - 0.12, 0.03, 0.04), m.steelBrushed, at(0, top - 0.01, zf - 0.03));
    pb.solid(-hw, 0, zb, hw, top, zf, 'metal');
    profile.lineTo(-zf, top);
    profile.lineTo(-zb, top);
  }
  profile.lineTo(z0, 0);
  profile.lineTo(-z0, 0);
  // Side stringers: extruded stepped profile (shape x = -z, y = y), turned to face X.
  for (const s of [-1, 1]) {
    const g = new THREE.ExtrudeGeometry(profile, { depth: 0.06, bevelEnabled: false });
    g.rotateY(PI / 2);
    g.translate(s * (hw + 0.01) - 0.03, 0, 0);
    pb.add(g, m.paintDark);
  }
  const railSides = rails === 'both' ? [-1, 1] : rails === 'left' ? [-1] : rails === 'right' ? [1] : [];
  for (const s of railSides) {
    const x = s * (hw - 0.05);
    const ptsTop: THREE.Vector3[] = [];
    for (let k = 0; k <= 4; k++) {
      const u = k / 4;
      const zz = z0 - u * run;
      const yy = rise * u + 1.0;
      ptsTop.push(V(x, yy, zz));
      pb.add(cylinderBetween(V(x, rise * u, zz), V(x, yy, zz), 0.025, 8), m.steel);
    }
    pb.add(pipe(ptsTop, 0.03, 1, 8), m.steel);
    pb.add(pipe(ptsTop.map((q) => V(q.x, q.y - 0.5, q.z)), 0.02, 1, 8), m.steel);
    for (let i = 0; i < n; i++) {
      const top = ((i + 1) * rise) / n;
      const zf = z0 - i * tread;
      pb.solid(s > 0 ? hw - 0.1 : -hw, top, zf - tread, s > 0 ? hw : -hw + 0.1, top + 1.05, zf);
    }
  }
  pb.socket('bottom', [0, 0, HALF], [0, 0, 1]);
  pb.socket('top', [0, rise, -HALF], [0, 0, -1]);
  pb.nav(0, 0, z0 + 0.3);
  pb.nav(0, rise, -z0);
  return pb.build();
}

/** Grating platform at `height` with posts, bracing and railings on `rails` (e.g. "s,w"). */
function catwalk(p: PieceParams, _rng: Rng, m: Materials): PieceOutput {
  const pb = new PieceBuilder();
  const pal = resolvePalette(p, m);
  const h = numParam(p, 'height', 2);
  const w = numParam(p, 'width', 4);
  const d = numParam(p, 'depth', 4);
  const rails = new Set(strParam(p, 'rails', 'n,e,s,w').split(',').map((s) => s.trim()));
  const hw = w / 2;
  const hd = d / 2;
  pb.add(slab(w, 0.03, d, 1), m.grating, at(0, h - 0.015, 0));
  for (const z of [-hd + 0.06, hd - 0.06]) pb.add(slab(w, 0.16, 0.12), m.steel, at(0, h - 0.11, z));
  for (const x of [-hw + 0.06, hw - 0.06]) pb.add(slab(0.12, 0.16, d), m.steel, at(x, h - 0.11, 0));
  for (let x = -hw + 1; x < hw - 0.5; x += 1) pb.add(slab(0.06, 0.1, d), m.steel, at(x, h - 0.08, 0));
  for (const x of [-hw + 0.15, hw - 0.15]) {
    for (const z of [-hd + 0.15, hd - 0.15]) {
      pb.add(rounded(0.16, h - 0.19, 0.16, 0.02), m.paintDark, at(x, (h - 0.19) / 2, z));
      pb.solidC(x, (h - 0.19) / 2, z, 0.16, h - 0.19, 0.16);
    }
  }
  // Cross bracing on the open long sides.
  for (const z of [-hd + 0.15, hd - 0.15]) {
    pb.add(cylinderBetween(V(-hw + 0.15, 0.2, z), V(hw - 0.15, h - 0.3, z), 0.025), m.steel);
  }
  pb.solid(-hw, h - 0.19, -hd, hw, h, hd, 'grate');
  const railH = 1.05;
  const railLine = (x0: number, z0: number, x1: number, z1: number): void => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const posts = Math.max(2, Math.round(len) + 1);
    for (let i = 0; i < posts; i++) {
      const u = i / (posts - 1);
      const x = x0 + (x1 - x0) * u;
      const z = z0 + (z1 - z0) * u;
      pb.add(cylinderBetween(V(x, h, z), V(x, h + railH, z), 0.025, 8), m.steel);
    }
    pb.add(cylinderBetween(V(x0, h + railH, z0), V(x1, h + railH, z1), 0.03, 8), m.steel);
    pb.add(cylinderBetween(V(x0, h + 0.55, z0), V(x1, h + 0.55, z1), 0.02, 8), m.steel);
    pb.add(slab(Math.abs(x1 - x0) + 0.04, 0.12, Math.abs(z1 - z0) + 0.04), pal.hazard, at((x0 + x1) / 2, h + 0.06, (z0 + z1) / 2));
    pb.solid(Math.min(x0, x1) - 0.05, h, Math.min(z0, z1) - 0.05, Math.max(x0, x1) + 0.05, h + railH, Math.max(z0, z1) + 0.05);
  };
  const e = 0.05;
  if (rails.has('n')) railLine(-hw + e, -hd + e, hw - e, -hd + e);
  if (rails.has('s')) railLine(-hw + e, hd - e, hw - e, hd - e);
  if (rails.has('w')) railLine(-hw + e, -hd + e, -hw + e, hd - e);
  if (rails.has('e')) railLine(hw - e, -hd + e, hw - e, hd - e);
  pb.nav(0, h, 0);
  pb.socket('floor_center', [0, 0, 0], [0, 0, -1], 'floor');
  pb.nav(0, 0, 0);
  return pb.build();
}

// ------------------------------------------------------------------ definitions

function tile(id: string, gen: (p: PieceParams, rng: Rng, m: Materials) => PieceOutput): PieceDef {
  return { id, family: 'structure', footprint: [1, 1], generate: gen };
}

export const STRUCTURE_PIECES: PieceDef[] = [
  corridorDef('corridor_straight', ['n', 's'], true, false),
  corridorDef('corridor_window', ['n', 's'], true, true),
  corridorDef('corridor_corner', ['s', 'e'], false, false),
  corridorDef('corridor_t', ['n', 's', 'e'], false, false),
  corridorDef('corridor_end', ['n'], false, false),
  tile('floor', (p, rng, m) => floorTile(p, rng, m, false)),
  tile('floor_grate', (p, rng, m) => floorTile(p, rng, m, true)),
  tile('ceiling', (p, rng, m) => ceilingTile(p, rng, m, false)),
  tile('ceiling_pipes', (p, rng, m) => ceilingTile(p, rng, m, true)),
  tile('wall_plain', (p, rng, m) => wallTile(p, rng, m, 'plain')),
  tile('wall_panel', (p, rng, m) => wallTile(p, rng, m, 'panel')),
  tile('wall_window', (p, rng, m) => wallTile(p, rng, m, 'window')),
  tile('wall_sanity_screen', (p, rng, m) => wallTile(p, rng, m, 'screen')),
  tile('wall_glass_partition', (p, rng, m) => wallTile(p, rng, m, 'glass')),
  tile('wall_vent', (p, rng, m) => wallTile(p, rng, m, 'vent')),
  tile('door_frame', (p, _rng, m) => {
    const pb = new PieceBuilder();
    const pal = resolvePalette(p, m);
    doorFrame(pb, m, numParam(p, 'width', 4), height(p), {
      trim: pal.trim,
      paintFront: pal.doorPanel,
      surroundFront: pal.doorSurround,
    });
    return pb.build();
  }),
  tile('stairs', stairs),
  tile('catwalk', catwalk),
];
