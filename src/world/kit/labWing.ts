import * as THREE from 'three';
import type { Rng } from '../../core/rng.ts';
import { fixtureMaterial, type Materials } from '../../render/materials.ts';
import { SCREEN_FONT } from '../../render/screens.ts';
import { at, cylinderBetween, rounded } from './geom.ts';
import { slab } from './shapes.ts';
import { boolParam, numParam, strParam, PieceBuilder, type PieceDef, type PieceParams } from './types.ts';

/**
 * Lab wing kit (openspec rebuild-lab-wing, lab-wing spec): Voss's culture lab (R04), the decon junction (R05) and the
 * compartment boundary (R06), plus the coolant line the bloom follows through all three.
 *
 * Conventions match props.ts, slice.ts and diveBay.ts: origin on the floor, the side you use faces -Z. Wall-backed
 * pieces have their back on z = 0 and stand out toward -Z. Static parts merge per material: flat paint
 * (`userData.flat`) and static glows (`userData.glow`) cost no extra draw call; glass and canvas faces are one call each.
 *
 * Event-driven pieces:
 *   status_board  `door:opened` { id } for its `door` param turns it green (UNSEALED); `level:reset` puts it back.
 */

const PI = Math.PI;
const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

const cache = new Map<string, THREE.Material>();
function cached<T extends THREE.Material>(key: string, make: () => T): T {
  let mat = cache.get(key) as T | undefined;
  if (!mat) {
    mat = make();
    mat.name = key;
    cache.set(key, mat);
  }
  return mat;
}
const paint = (key: string, color: number, roughness = 0.6, metalness = 0): THREE.MeshStandardMaterial =>
  cached(`lab-${key}`, () => {
    const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    mat.userData['flat'] = true;
    return mat;
  });
const lamp = (key: string, color: number, intensity: number): THREE.MeshStandardMaterial =>
  cached(`glow-lab-${key}`, () => {
    const mat = fixtureMaterial(color, intensity);
    mat.userData['glow'] = true;
    return mat;
  });
const glass = (key: string, color: number, opacity: number): THREE.MeshStandardMaterial =>
  cached(`lab-glass-${key}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.06, metalness: 0.1, transparent: true, opacity, depthWrite: false }));

const P = {
  lagging: () => paint('lagging', 0x8d9296, 0.92),
  band: () => paint('band', 0x2d6fa8, 0.6),
  steel: () => paint('steel', 0xaeb5ba, 0.32, 0.85),
  darkSteel: () => paint('darkSteel', 0x3a4046, 0.45, 0.7),
  white: () => paint('white', 0xe6e8e4, 0.45),
  offWhite: () => paint('offWhite', 0xd2d5cf, 0.55),
  grey: () => paint('grey', 0x6b7277, 0.6, 0.2),
  black: () => paint('black', 0x111315, 0.7),
  yellow: () => paint('yellow', 0xd1a21f, 0.5),
  safetyGreen: () => paint('safetyGreen', 0x2f9a4c, 0.5),
  red: () => paint('red', 0xa02a20, 0.5),
  frost: () => paint('frost', 0xe9f3f8, 0.95),
  flesh: () => paint('flesh', 0x7a2a2e, 0.35),
  fleshDark: () => paint('fleshDark', 0x3d1418, 0.4),
  hazmat: () => paint('hazmat', 0xd9b62a, 0.65),
  rubber: () => paint('rubber', 0x17191b, 0.92),
  trench: () => paint('trench', 0x0b0c0d, 0.95),
  grate: () => paint('grate', 0x5b6266, 0.5, 0.6),
};

function canvasFace(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, glow = 0.35): THREE.MeshStandardMaterial {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (ctx) draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: glow, roughness: 0.4 });
}

/** Parse `x,y,z;x,y,z;...` (piece space). */
export function parsePath(s: string): THREE.Vector3[] {
  return s
    .split(';')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const [x, y, z] = t.split(',').map(Number);
      return V(x ?? 0, y ?? 0, z ?? 0);
    });
}
const indexList = (s: string): number[] => s.split(/[;,]/).map((t) => t.trim()).filter(Boolean).map(Number);

/** Brackets per segment: one every 1.5 m, the first 0.75 m in. */
export const bracketsOn = (length: number): number => (length < 0.75 ? 0 : Math.floor((length - 0.75) / 1.5) + 1);

/** Organic blotch alpha (white = bloom) for `bloom_decal`, one per seed. */
function blotch(seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 256, 256);
    let s = seed * 9301 + 49297;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 26; i++) {
      const r = 18 + rnd() * 46 * (1 - i / 40);
      const a = rnd() * Math.PI * 2;
      const d = rnd() * 70;
      const g = ctx.createRadialGradient(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 0, 128 + Math.cos(a) * d, 128 + Math.sin(a) * d, r);
      g.addColorStop(0, '#fff');
      g.addColorStop(0.7, '#fff');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);
    }
  }
  return new THREE.CanvasTexture(c);
}

/** The bloom photo slot with a blotch mask, keeping its own UVs; one material per seed (4 seeds), shared by all decals. */
function bloomDecalMaterial(m: Materials, seed: number): THREE.MeshStandardMaterial {
  const base = m.bloom;
  return cached(`lab-bloom-decal-${base.uuid}-${seed % 4}`, () => {
    const mat = base.clone();
    mat.alphaMap = blotch(seed % 4);
    mat.alphaTest = 0.5;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.userData['keepUvs'] = true;
    return mat;
  });
}

const GEN: Record<string, (p: PieceParams, rng: Rng, m: Materials, pb: PieceBuilder) => void> = {
  /**
   * A patch of bloom on a wall (default: back on z = 0, facing -Z, centred at `y`) or on a ceiling (`ceiling: true`,
   * facing down at height `y`). `w` x `h` metres; `seed` 0-3 picks the blotch. The bloom slot, cut by an organic mask.
   */
  bloom_decal(p, _rng, m, pb) {
    const w = numParam(p, 'w', 1.2);
    const h = numParam(p, 'h', 0.9);
    const y = numParam(p, 'y', 1.4);
    const seed = numParam(p, 'seed', 0);
    const geo = new THREE.PlaneGeometry(w, h);
    if (boolParam(p, 'ceiling', false)) pb.add(geo, bloomDecalMaterial(m, seed), at(0, y - 0.006, 0, PI / 2, 0, 0));
    else pb.add(geo, bloomDecalMaterial(m, seed), at(0, y, -0.006, 0, PI, 0));
  },

  /**
   * The coolant line the bloom follows (lab-wing spec). `path`: waypoints `x,y,z;...` in piece space. `collars`:
   * waypoint indices where it passes through a wall. `valves` / `sight`: waypoint indices for a handwheel valve / a
   * lit sight glass (the coolant runs warm). Lagged pipe with blue bands every 2 m, a strap bracket with a hanger
   * rod every 1.5 m. Segments below 2 m get a thin collider.
   */
  coolant_line(p, _rng, _m, pb) {
    const pts = parsePath(strParam(p, 'path', '0,2.9,0;2,2.9,0'));
    const R = numParam(p, 'radius', 0.07);
    const collars = new Set(indexList(strParam(p, 'collars', '')));
    const valves = new Set(indexList(strParam(p, 'valves', '')));
    const sights = new Set(indexList(strParam(p, 'sight', '')));
    let brackets = 0;
    let length = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const seg = a.distanceTo(b);
      length += seg;
      pb.add(cylinderBetween(a, b, R, 12), P.lagging());
      const dir = b.clone().sub(a).normalize();
      for (let d = 2; d < seg; d += 2) {
        const c = a.clone().addScaledVector(dir, d);
        pb.add(cylinderBetween(c.clone().addScaledVector(dir, -0.04), c.clone().addScaledVector(dir, 0.04), R + 0.006, 12), P.band());
      }
      const n = bracketsOn(seg);
      for (let k = 0; k < n; k++) {
        const c = a.clone().addScaledVector(dir, 0.75 + k * 1.5);
        pb.add(cylinderBetween(c.clone().addScaledVector(dir, -0.025), c.clone().addScaledVector(dir, 0.025), R + 0.014, 12), P.darkSteel());
        // Hanger rod straight up (horizontal runs) or a stand-off to the side (vertical runs).
        if (Math.abs(dir.y) < 0.5) pb.add(cylinderBetween(c.clone().setY(c.y + R), c.clone().setY(c.y + 0.35), 0.008, 6), P.darkSteel());
        else pb.add(cylinderBetween(c, c.clone().add(V(0, 0, 0.12)), 0.012, 6), P.darkSteel());
      }
      brackets += n;
      if (Math.min(a.y, b.y) < 2) {
        const lo = a.clone().min(b).subScalar(R);
        const hi = a.clone().max(b).addScalar(R);
        pb.solid(lo.x, Math.max(0, lo.y), lo.z, hi.x, hi.y, hi.z, 'metal');
      }
    }
    pts.forEach((pt, i) => {
      if (i > 0 && i < pts.length - 1) pb.add(new THREE.SphereGeometry(R * 1.02, 12, 8), P.lagging(), at(pt.x, pt.y, pt.z));
      const along = (pts[i + 1] ?? pts[i - 1]!).clone().sub(pt).normalize();
      if (collars.has(i)) pb.add(cylinderBetween(pt.clone().addScaledVector(along, -0.04), pt.clone().addScaledVector(along, 0.04), R + 0.07, 14), P.steel());
      if (valves.has(i)) {
        pb.add(new THREE.SphereGeometry(R * 1.5, 12, 8), P.darkSteel(), at(pt.x, pt.y, pt.z));
        pb.add(cylinderBetween(pt, pt.clone().add(V(0, 0.22, 0)), 0.015, 6), P.darkSteel());
        pb.add(new THREE.TorusGeometry(0.11, 0.012, 6, 18), P.red(), at(pt.x, pt.y + 0.22, pt.z, PI / 2));
      }
      if (sights.has(i)) {
        pb.add(cylinderBetween(pt.clone().addScaledVector(along, -0.09), pt.clone().addScaledVector(along, 0.09), R + 0.02, 12), P.steel());
        pb.add(cylinderBetween(pt.clone().addScaledVector(along, -0.06), pt.clone().addScaledVector(along, 0.06), R + 0.024, 12), lamp('coolant', 0xffa640, 1.6));
      }
    });
    pb.object.userData['brackets'] = brackets;
    pb.object.userData['length'] = length;
  },

  /**
   * Voss's culture column: an amber-lit vessel on a skid with the bloom inside, a stainless head with ports and a
   * coolant jacket loop leaving toward +Z (where the coolant line meets it). About 1.2 x 2.7 x 1.2 m.
   */
  culture_column(_p, rng, _m, pb) {
    pb.add(rounded(1.2, 0.22, 1.2, 0.03), P.darkSteel(), at(0, 0.11, 0));
    pb.add(new THREE.CylinderGeometry(0.5, 0.52, 0.18, 24), P.steel(), at(0, 0.31, 0));
    pb.add(new THREE.CylinderGeometry(0.42, 0.42, 1.9, 24, 1, true), lamp('medium', 0xd9852c, 1.1), at(0, 1.35, 0));
    // The bloom inside: clustered dark lobes rising from the base.
    for (let i = 0; i < 14; i++) {
      const r = rng.range(0.06, 0.16);
      const a = rng.next() * PI * 2;
      const d = rng.range(0, 0.25);
      pb.add(new THREE.IcosahedronGeometry(r, 1), i % 3 ? P.flesh() : P.fleshDark(), at(Math.cos(a) * d, 0.45 + rng.next() * 1.2 * (1 - d), Math.sin(a) * d));
    }
    pb.dynamic(new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 1.95, 28, 1, true), glass('column', 0xcfe3e8, 0.22))).applyMatrix4(at(0, 1.35, 0));
    for (const y of [0.42, 2.28]) pb.add(new THREE.TorusGeometry(0.47, 0.035, 8, 28), P.steel(), at(0, y, 0, PI / 2));
    pb.add(new THREE.CylinderGeometry(0.5, 0.48, 0.24, 24), P.steel(), at(0, 2.42, 0));
    for (const [x, z] of [[0.18, 0], [-0.15, 0.12], [0, -0.2]] as const) pb.add(new THREE.CylinderGeometry(0.04, 0.04, 0.22, 10), P.darkSteel(), at(x, 2.64, z));
    // Coolant jacket loop to the back.
    pb.add(cylinderBetween(V(0.35, 2.0, 0.3), V(0.35, 2.0, 0.65), 0.05, 10), P.lagging());
    pb.add(cylinderBetween(V(0.35, 0.6, 0.3), V(0.35, 0.6, 0.65), 0.05, 10), P.lagging());
    pb.add(cylinderBetween(V(0.35, 0.6, 0.65), V(0.35, 2.9, 0.65), 0.05, 10), P.lagging());
    pb.solidC(0, 1.35, 0, 1.2, 2.7, 1.2, 'metal');
  },

  /** Class II biosafety cabinet, wall-backed: stand, work cavity behind a sloped sash, blower hood, status strip. */
  biosafety_cabinet(p, _rng, _m, pb) {
    const W = numParam(p, 'width', 1.5);
    const D = 0.8;
    pb.add(rounded(W, 0.75, D - 0.05, 0.02), P.offWhite(), at(0, 0.375, -D / 2));
    pb.add(slab(W, 0.04, D, 1), P.steel(), at(0, 0.77, -D / 2));
    for (const s of [-1, 1]) pb.add(slab(0.05, 0.75, D, 1), P.white(), at(s * (W / 2 - 0.025), 1.165, -D / 2));
    pb.add(slab(W, 0.75, 0.04, 1), P.steel(), at(0, 1.165, -0.03));
    pb.add(rounded(W, 0.4, D, 0.03), P.white(), at(0, 1.74, -D / 2));
    pb.add(slab(W - 0.2, 0.04, 0.01), lamp('bsc-strip', 0x7dff9a, 1.4), at(0, 1.62, -D - 0.006));
    const sash = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.1, 0.62), glass('sash', 0xd8eef2, 0.28));
    sash.applyMatrix4(at(0, 1.22, -D + 0.04, -0.18, PI, 0));
    pb.dynamic(sash);
    pb.solid(-W / 2, 0, -D, W / 2, 1.94, 0, 'metal');
  },

  /** −80 °C upright freezer, wall-backed: white body, frosted door seal, a red-lit readout. */
  freezer_ultra(_p, _rng, _m, pb) {
    pb.add(rounded(0.85, 1.95, 0.85, 0.03), P.white(), at(0, 0.975, -0.425));
    pb.add(rounded(0.8, 1.5, 0.03, 0.01), P.offWhite(), at(0, 0.95, -0.865));
    for (const y of [0.22, 1.68]) pb.add(rounded(0.82, 0.06, 0.04, 0.02), P.frost(), at(0, y, -0.875));
    pb.add(rounded(0.06, 1.46, 0.04, 0.02), P.frost(), at(0.39, 0.95, -0.875));
    pb.add(rounded(0.05, 0.5, 0.06, 0.02), P.steel(), at(-0.32, 1.0, -0.9));
    pb.add(slab(0.18, 0.06, 0.01), lamp('freezer-readout', 0xff4a3a, 1.8), at(0.15, 1.8, -0.882));
    pb.solid(-0.425, 0, -0.85, 0.425, 1.95, 0, 'metal');
  },

  /** Two stacked CO2 incubators on a stand, wall-backed, with green 37.0 readouts. */
  incubator_stack(_p, _rng, _m, pb) {
    pb.add(slab(0.75, 0.3, 0.7, 1), P.darkSteel(), at(0, 0.15, -0.35));
    for (const y of [0.3, 1.2]) {
      pb.add(rounded(0.72, 0.88, 0.7, 0.02), P.steel(), at(0, y + 0.44, -0.35));
      pb.add(rounded(0.62, 0.7, 0.02, 0.01), P.offWhite(), at(-0.02, y + 0.44, -0.71));
      pb.add(slab(0.12, 0.04, 0.01), lamp('incubator', 0x6dff8a, 1.6), at(0.24, y + 0.8, -0.722));
    }
    pb.solid(-0.375, 0, -0.7, 0.375, 2.08, 0, 'metal');
  },

  /** Negative-pressure gauge (wall): round dial reading −12 Pa in the red. */
  pressure_gauge(p, _rng, _m, pb) {
    const y = numParam(p, 'y', 1.6);
    const face = canvasFace(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#f2f1ea';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w / 2 - 4, 0, PI * 2);
      ctx.fill();
      ctx.lineWidth = 18;
      ctx.strokeStyle = '#2b9a4c';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w / 2 - 28, PI * 0.75, PI * 1.5);
      ctx.stroke();
      ctx.strokeStyle = '#c0281c';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w / 2 - 28, PI * 1.5, PI * 2.25);
      ctx.stroke();
      ctx.fillStyle = '#15191c';
      ctx.font = `700 30px ${SCREEN_FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('ROOM Pa', w / 2, h * 0.7);
      ctx.fillStyle = '#c0281c';
      ctx.fillText('-12', w / 2, h * 0.84);
      ctx.strokeStyle = '#15191c';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(w / 2, h / 2);
      ctx.lineTo(w / 2 + Math.cos(PI * 2.1) * 90, h / 2 + Math.sin(PI * 2.1) * 90);
      ctx.stroke();
    }, 0.25);
    pb.add(new THREE.CylinderGeometry(0.16, 0.16, 0.06, 24), P.darkSteel(), at(0, y, -0.03, PI / 2));
    pb.add(new THREE.CircleGeometry(0.14, 24), face, at(0, y, -0.062, 0, PI, 0));
  },

  /**
   * The warped service access panel on Lab B's service wall (wall): a bolted steel plate bowed out from inside, its
   * top corner sprung open with a dark gap, coolant stains below. Where Giles cut his arm three days ago.
   */
  service_panel(p, _rng, _m, pb) {
    const y = numParam(p, 'y', 1.25);
    const warped = boolParam(p, 'warped', true);
    pb.add(slab(0.8, 1.0, 0.03, 1), P.darkSteel(), at(0, y, -0.015));
    pb.add(slab(0.66, 0.86, 0.02, 1), P.trench(), at(0, y, -0.026));
    const plate = rounded(0.7, 0.9, 0.025, 0.01);
    pb.add(plate, P.grey(), warped ? at(0.02, y + 0.01, -0.06, -0.07, 0.05, 0.02) : at(0, y, -0.04));
    for (const [x, yy] of [[-0.3, -0.4], [0.3, -0.4], [-0.3, 0.4]] as const) pb.add(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 8), P.steel(), at(x, y + yy, -0.075, PI / 2));
    if (warped) pb.add(new THREE.CylinderGeometry(0.018, 0.018, 0.04, 8), P.steel(), at(0.36, y + 0.47, -0.11, PI / 2 - 0.4));
    pb.add(slab(0.5, 0.012, 0.004), lamp('panel-warning', 0xffd23a, 0.4), at(0, y + 0.52, -0.032));
  },

  /** Emergency shower with an eyewash bowl: a green-capped post, overhead head and pull rod, floor tray. */
  emergency_shower(_p, _rng, _m, pb) {
    pb.add(slab(1.0, 0.03, 1.0, 1), P.grate(), at(0, 0.015, 0));
    pb.add(new THREE.CylinderGeometry(0.035, 0.035, 2.35, 10), P.safetyGreen(), at(0.42, 1.175, 0.42));
    pb.add(cylinderBetween(V(0.42, 2.3, 0.42), V(0, 2.3, 0), 0.03, 8), P.safetyGreen());
    pb.add(new THREE.CylinderGeometry(0.16, 0.08, 0.1, 18), P.safetyGreen(), at(0, 2.24, 0));
    pb.add(cylinderBetween(V(0.2, 2.25, 0.2), V(0.2, 1.55, 0.2), 0.008, 6), P.steel());
    pb.add(new THREE.TorusGeometry(0.06, 0.01, 6, 14), P.safetyGreen(), at(0.2, 1.5, 0.2));
    pb.add(cylinderBetween(V(0.42, 1.0, 0.42), V(0.12, 1.0, 0.12), 0.025, 8), P.safetyGreen());
    pb.add(new THREE.CylinderGeometry(0.17, 0.12, 0.1, 18), P.yellow(), at(0.08, 1.02, 0.08));
    pb.solidC(0.42, 1.175, 0.42, 0.1, 2.35, 0.1, 'metal');
  },

  /** PPE locker, wall-backed (0.6 m wide): vents, a name strip; `open` swings the door with a lab coat inside. */
  ppe_locker(p, _rng, _m, pb) {
    const open = boolParam(p, 'open', false);
    pb.add(rounded(0.6, 1.9, 0.5, 0.015), P.offWhite(), at(0, 0.95, -0.25));
    const door = new THREE.Group();
    door.add(new THREE.Mesh(rounded(0.56, 1.8, 0.025, 0.01), P.white()));
    for (let i = 0; i < 4; i++) door.add(new THREE.Mesh(slab(0.3, 0.012, 0.01), P.grey()).translateY(0.7 - i * 0.04).translateZ(-0.015));
    door.add(new THREE.Mesh(slab(0.25, 0.05, 0.01), P.yellow()).translateY(0.45).translateZ(-0.015));
    if (open) {
      door.position.set(-0.28, 0.95, -0.52);
      door.rotation.y = -1.25;
      door.children.forEach((c) => c.translateX(0.28));
      pb.add(rounded(0.4, 1.0, 0.12, 0.04), P.white(), at(0, 1.25, -0.25));
    } else door.position.set(0, 0.95, -0.515);
    door.updateMatrixWorld(true);
    for (const c of door.children) {
      const mesh = c as THREE.Mesh;
      pb.add(mesh.geometry, mesh.material as THREE.Material, mesh.matrixWorld);
    }
    pb.solid(-0.3, 0, -0.5, 0.3, 1.9, 0, 'metal');
  },

  /** Hazmat suit rack, wall-backed: a rail at 1.95 m with `count` yellow suits and boots below. */
  hazmat_rack(p, _rng, _m, pb) {
    const n = numParam(p, 'count', 3);
    const W = numParam(p, 'width', 1.6);
    pb.add(cylinderBetween(V(-W / 2, 1.95, -0.25), V(W / 2, 1.95, -0.25), 0.018, 8), P.steel());
    for (const s of [-1, 1]) pb.add(slab(0.04, 0.04, 0.3, 1), P.steel(), at(s * W / 2, 1.95, -0.15));
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + (W / (n + 1)) * (i + 1);
      pb.add(rounded(0.46, 1.05, 0.2, 0.08), P.hazmat(), at(x, 1.3, -0.26));
      pb.add(rounded(0.36, 0.3, 0.22, 0.12), P.hazmat(), at(x, 1.86, -0.27));
      pb.add(rounded(0.24, 0.16, 0.02, 0.03), glass('visor', 0x9fc3cf, 0.6), at(x, 1.86, -0.385));
      for (const s of [-1, 1]) pb.add(rounded(0.12, 0.28, 0.24, 0.05), P.rubber(), at(x + s * 0.08, 0.14, -0.2));
    }
    pb.solid(-W / 2, 0.7, -0.4, W / 2, 2.0, 0, 'rubber');
  },

  /** Lab wing directory (wall): `rows` `TEXT:dir` separated by `|`, dir one of < > ^ v. */
  directory_sign(p, _rng, _m, pb) {
    const y = numParam(p, 'y', 1.75);
    const rows = strParam(p, 'rows', 'LAB B  QUARANTINE:>|DECON:<|PRESSURE HALL:v').split('|');
    const arrows: Record<string, string> = { '<': '←', '>': '→', '^': '↑', v: '↓' };
    const face = canvasFace(1024, 512, (ctx, w, h) => {
      ctx.fillStyle = '#e6e9e4';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#2d6fa8';
      ctx.fillRect(0, 0, w, 110);
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 72px "Arial Narrow", Arial, sans-serif';
      ctx.fillText('LAB WING  ·  DECK 0', 36, 82);
      ctx.font = '700 64px "Arial Narrow", Arial, sans-serif';
      rows.forEach((r, i) => {
        const [text, dir] = r.split(':');
        ctx.fillStyle = (text ?? '').includes('QUARANTINE') ? '#b02a1e' : '#15191c';
        ctx.fillText(text ?? '', 36, 200 + i * 105);
        ctx.fillText(arrows[dir ?? ''] ?? '', w - 110, 200 + i * 105);
      });
    }, 0.2);
    pb.add(slab(1.24, 0.64, 0.02), P.darkSteel(), at(0, y, -0.01));
    pb.add(new THREE.PlaneGeometry(1.2, 0.6), face, at(0, y, -0.021, 0, PI, 0));
  },

  /** Floor drain: a square grate flush with the floor over a dark sump (the R05 floor enemy's source). */
  floor_drain(p, _rng, _m, pb) {
    const s = numParam(p, 'size', 0.7);
    pb.add(slab(s, 0.3, s, 1), P.trench(), at(0, -0.16, 0));
    pb.add(slab(s + 0.06, 0.012, 0.03), P.steel(), at(0, 0.004, -s / 2));
    pb.add(slab(s + 0.06, 0.012, 0.03), P.steel(), at(0, 0.004, s / 2));
    for (let i = 0; i <= 6; i++) pb.add(slab(0.02, 0.012, s), P.grate(), at(-s / 2 + (s / 6) * i, 0.004, 0));
  },

  /** Steel sample cart, 0.8 x 0.4 m with two shelves; `tipped` lays it on its side (collider top 0.33 m). */
  sample_cart(p, rng, _m, pb) {
    const tipped = boolParam(p, 'tipped', false);
    const g = new THREE.Group();
    for (const y of [0.18, 0.78]) g.add(new THREE.Mesh(slab(0.8, 0.03, 0.4, 1), P.steel()).translateY(y));
    for (const [x, z] of [[-0.38, -0.18], [0.38, -0.18], [-0.38, 0.18], [0.38, 0.18]] as const) g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.8, 6), P.steel()).translateX(x).translateY(0.46).translateZ(z));
    if (tipped) {
      g.rotation.x = PI / 2;
      g.position.set(0, 0.2, 0);
    }
    g.updateMatrixWorld(true);
    for (const c of g.children) pb.add((c as THREE.Mesh).geometry, (c as THREE.Mesh).material as THREE.Material, c.matrixWorld);
    // Spilled sample tubes.
    if (tipped) {
      for (let i = 0; i < 6; i++) {
        const a = rng.next() * PI * 2;
        pb.add(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 6), i % 2 ? P.red() : P.white(), at(Math.cos(a) * rng.range(0.3, 0.9), 0.012, -0.5 + Math.sin(a) * 0.4, PI / 2, a, 0));
      }
      pb.solid(-0.42, 0, -0.85, 0.42, 0.33, -0.0, 'metal');
    } else pb.solid(-0.42, 0, -0.22, 0.42, 0.82, 0.22, 'metal');
  },

  /** Dogging wheel for a watertight bulkhead (wall): hub, 0.6 m rim, six spokes, a red handle knob. */
  bulkhead_wheel(p, _rng, _m, pb) {
    const y = numParam(p, 'y', 1.3);
    pb.add(new THREE.CylinderGeometry(0.06, 0.06, 0.16, 12), P.darkSteel(), at(0, y, -0.08, PI / 2));
    pb.add(new THREE.TorusGeometry(0.3, 0.025, 8, 28), P.yellow(), at(0, y, -0.15));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * PI * 2;
      pb.add(cylinderBetween(V(0, y, -0.15), V(Math.cos(a) * 0.3, y + Math.sin(a) * 0.3, -0.15), 0.014, 6), P.yellow());
    }
    pb.add(new THREE.CylinderGeometry(0.03, 0.03, 0.1, 8), P.red(), at(0.3, y, -0.2, PI / 2));
  },

  /** Pressure manifold (wall): a header pipe with three branches, gauges and valves. Width 1.4 m at `y`. */
  pressure_manifold(p, _rng, _m, pb) {
    const y = numParam(p, 'y', 1.2);
    const W = numParam(p, 'width', 1.4);
    pb.add(cylinderBetween(V(-W / 2, y, -0.18), V(W / 2, y, -0.18), 0.05, 12), P.steel());
    for (let i = 0; i < 3; i++) {
      const x = -W / 3 + (W / 3) * i;
      pb.add(cylinderBetween(V(x, y, -0.18), V(x, y + 0.5, -0.18), 0.035, 10), P.steel());
      pb.add(new THREE.CylinderGeometry(0.075, 0.075, 0.04, 18), P.darkSteel(), at(x, y + 0.6, -0.18, PI / 2));
      pb.add(new THREE.CircleGeometry(0.065, 18), P.offWhite(), at(x, y + 0.6, -0.201, 0, PI, 0));
      pb.add(slab(0.008, 0.05, 0.004), P.red(), at(x + 0.015, y + 0.615, -0.204, 0, 0, -0.6 + i * 0.5));
      pb.add(new THREE.TorusGeometry(0.07, 0.01, 6, 16), P.red(), at(x, y + 0.28, -0.25));
    }
    for (const s of [-1, 1]) pb.add(slab(0.05, 0.12, 0.18, 1), P.darkSteel(), at(s * (W / 2 - 0.1), y, -0.09));
    pb.solid(-W / 2, y - 0.08, -0.3, W / 2, y + 0.7, 0, 'metal');
  },

  /**
   * Compartment status board (wall): red LOCKDOWN / SEALED — SECURITY SIDE; turns green (UNSEALED) when its
   * `door` opens. Own draw call (canvas). `level:reset` returns it to red.
   */
  status_board(p, _rng, _m, pb) {
    const y = numParam(p, 'y', 2.2);
    const door = strParam(p, 'door', '');
    const draw = (sealed: boolean) => (ctx: CanvasRenderingContext2D, w: number, h: number): void => {
      ctx.fillStyle = '#070a0c';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = sealed ? '#ff3b2a' : '#39ff8e';
      ctx.font = `800 64px ${SCREEN_FONT}`;
      ctx.fillText('COMPARTMENT 3', 30, 80);
      ctx.font = `800 88px ${SCREEN_FONT}`;
      ctx.fillText(sealed ? 'LOCKDOWN' : 'UNSEALED', 30, 190);
      ctx.font = `600 50px ${SCREEN_FONT}`;
      ctx.fillText(sealed ? 'SEALED — SECURITY SIDE' : 'BYPASS ACTIVE', 30, 270);
      ctx.strokeStyle = sealed ? '#ff3b2a' : '#39ff8e';
      ctx.lineWidth = 6;
      ctx.strokeRect(4, 4, w - 8, h - 8);
    };
    const red = canvasFace(768, 320, draw(true), 0.9);
    const green = canvasFace(768, 320, draw(false), 0.9);
    pb.add(slab(1.24, 0.56, 0.05), P.darkSteel(), at(0, y, -0.025));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.18, 0.5), red);
    screen.applyMatrix4(at(0, y, -0.052, 0, PI, 0));
    screen.name = 'status_board:screen';
    pb.dynamic(screen);
    pb.on('door:opened', (e) => {
      if ((e as { id?: string } | undefined)?.id === door) screen.material = green;
    });
    pb.on('level:reset', () => void (screen.material = red));
  },

  /** Pump skid (1.6 x 1.2 x 0.9 m): base frame, two horizontal pumps and motors, piping, a control box. Not climbable. */
  pump_skid(_p, _rng, _m, pb) {
    pb.add(slab(1.6, 0.14, 0.9, 1), P.darkSteel(), at(0, 0.07, 0));
    for (const z of [-0.22, 0.22]) {
      pb.add(cylinderBetween(V(-0.6, 0.4, z), V(0.05, 0.4, z), 0.18, 16), P.band());
      pb.add(cylinderBetween(V(0.05, 0.4, z), V(0.55, 0.4, z), 0.14, 16), P.grey());
      pb.add(cylinderBetween(V(-0.4, 0.4, z), V(-0.4, 1.0, z), 0.06, 10), P.steel());
    }
    pb.add(cylinderBetween(V(-0.4, 1.0, -0.4), V(-0.4, 1.0, 0.4), 0.07, 12), P.steel());
    pb.add(rounded(0.4, 0.5, 0.2, 0.02), P.grey(), at(0.55, 0.95, 0.3));
    pb.add(slab(0.06, 0.06, 0.01), lamp('skid-run', 0x6dff8a, 1.6), at(0.45, 1.1, 0.195));
    pb.solid(-0.8, 0, -0.45, 0.8, 1.2, 0.45, 'metal');
  },

  /** Gas-cylinder cage (1.3 x 1.4 x 0.55 m): mesh walls, a chain across the front. Cylinders are placed separately. */
  cylinder_cage(_p, _rng, _m, pb) {
    const W = 1.3;
    const H = 1.4;
    const D = 0.55;
    for (const [x, z] of [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]] as const) pb.add(slab(0.04, H, 0.04, 1), P.darkSteel(), at(x, H / 2, z));
    for (const y of [0.05, H / 2, H - 0.02]) {
      pb.add(slab(W, 0.03, 0.03, 1), P.darkSteel(), at(0, y, D / 2));
      for (const s of [-1, 1]) pb.add(slab(0.03, 0.03, D, 1), P.darkSteel(), at(s * W / 2, y, 0));
      pb.add(slab(W, 0.03, 0.03, 1), P.darkSteel(), at(0, y, -D / 2));
    }
    for (let i = 1; i < 13; i++) pb.add(slab(0.012, H, 0.012, 1), P.grey(), at(-W / 2 + (W / 13) * i, H / 2, D / 2));
    for (const s of [-1, 1]) for (let i = 1; i < 5; i++) pb.add(slab(0.012, H, 0.012, 1), P.grey(), at(s * W / 2, H / 2, -D / 2 + (D / 5) * i));
    pb.add(slab(W, H, 0.02, 1), P.grey(), at(0, H / 2, D / 2 + 0.01));
    pb.add(cylinderBetween(V(-W / 2, 1.0, -D / 2 - 0.02), V(W / 2, 0.95, -D / 2 - 0.02), 0.012, 6), P.steel());
    pb.add(slab(W, 0.04, D, 1), P.grate(), at(0, 0.02, 0));
    pb.solid(-W / 2, 0, -D / 2, W / 2, H, D / 2, 'metal');
  },

  /** Service trench grate (floor), `length` along local X, 0.6 m wide: grate over a dark trench (an enemy source). */
  trench_grate(p, _rng, _m, pb) {
    const L = numParam(p, 'length', 2.4);
    pb.add(slab(L, 0.45, 0.6, 1), P.trench(), at(0, -0.24, 0));
    for (const s of [-1, 1]) pb.add(slab(L, 0.012, 0.04), P.steel(), at(0, 0.004, s * 0.3));
    for (let i = 0; i <= Math.round(L / 0.08); i++) pb.add(slab(0.018, 0.012, 0.6), P.grate(), at(-L / 2 + i * 0.08, 0.004, 0));
    // One grate panel pushed up and aside: something came through here.
    pb.add(slab(0.6, 0.02, 0.58, 1), P.grate(), at(L / 2 - 0.2, 0.08, -0.35, 0.25, 0.3, 0));
  },

  /**
   * Ruptured ceiling duct, `length` along local X, hung at `y` (bottom): a 0.6 x 0.45 m duct whose underside is torn
   * open in the middle, with peeled flaps hanging down (where the duct enemy drops from; the bloom mass sits here).
   */
  ruptured_duct(p, _rng, _m, pb) {
    const L = numParam(p, 'length', 4);
    const y = numParam(p, 'y', 3.4);
    const half = L / 2;
    for (const s of [-1, 1]) {
      const cx = s * (half / 2 + 0.3);
      pb.add(slab(half - 0.6, 0.45, 0.6, 1), P.steel(), at(cx, y + 0.225, 0));
    }
    pb.add(slab(1.2, 0.03, 0.6, 1), P.steel(), at(0, y + 0.435, 0));
    for (const s of [-1, 1]) pb.add(slab(1.2, 0.45, 0.02, 1), P.steel(), at(0, y + 0.225, s * 0.29));
    pb.add(slab(0.5, 0.02, 0.5, 1), P.steel(), at(-0.35, y - 0.2, 0, 0, 0, -1.0));
    pb.add(slab(0.45, 0.02, 0.5, 1), P.steel(), at(0.4, y - 0.18, 0.05, 0.2, 0, 1.1));
    pb.add(slab(1.15, 0.01, 0.55, 1), P.trench(), at(0, y + 0.42, 0));
    for (const s of [-1, 1]) pb.add(cylinderBetween(V(s * (half - 0.4), y + 0.45, 0), V(s * (half - 0.4), y + 0.8, 0), 0.01, 6), P.darkSteel());
  },
};

function def(id: string, gen: (p: PieceParams, rng: Rng, m: Materials, pb: PieceBuilder) => void): PieceDef {
  return {
    id,
    family: 'prop',
    footprint: [0, 0],
    generate(params, rng, m) {
      const pb = new PieceBuilder();
      gen(params, rng, m, pb);
      return pb.build();
    },
  };
}

export const LAB_WING_PROPS: PieceDef[] = Object.entries(GEN).map(([id, gen]) => def(id, gen));
