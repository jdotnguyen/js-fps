import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Rng } from '../../core/rng.ts';
import { fixtureMaterial, type Materials } from '../../render/materials.ts';
import { CanvasScreen, SCREEN_FONT } from '../../render/screens.ts';
import { paintedDecal, stencilDecal } from '../../render/decals.ts';
import { drawTagBanner, drawTagLockup, drawTagMark } from '../../render/logo.ts';
import { NOISE_GLSL } from '../../render/fx/glsl.ts';
import { SUB_RADIUS, SUB_SAIL_TOP, SUB_LENGTH, SUB_SCALE, createSubModel } from '../../render/fx/subModel.ts';
import { at, cylinderBetween, pipe, rounded } from './geom.ts';
import { lathe, slab } from './shapes.ts';
import { inFrame, panelWall, wallFrame } from './detail.ts';
import { AoMergeBuilder } from './merge.ts';
import { PieceBuilder, WALL_T, boolParam, numParam, strParam, type PieceDef, type PieceOutput, type PieceParams } from './types.ts';

/**
 * Slice-01 kit additions (ADR-0014, ADR-0017, ADR-0023): the kitchen, the supply sub, the
 * briefing screen and Lab B blinds, hydroponics plants, the dive bay moon pool, the TAG
 * admin office and the action-half set dressing (valve wheel, consoles, armory).
 *
 * Conventions match props.ts: origin on the floor, the side you use faces -Z. Wall-mounted
 * props have their back on z = 0 and stick out toward -Z, so they go at the wall face with
 * rot 180 on a north wall, 0 on a south wall, 90 on an east wall and 270 on a west wall.
 * Static parts merge into the room per material (non-animated glows use shared emissive
 * materials so they merge too); only screens and moving parts are dynamic draw calls.
 *
 * Event-driven pieces (PieceBuilder.on) listen on the game bus and on level trigger emits:
 *   supply_sub     `intro:sub_dock` (animate in), `intro:sub_docked` (snap), `sub:leave`
 *   wall_screen    `screen:set` { id, state: on|off|static }, plus `briefing:screen` { state } when channel=briefing
 *   blinds         `blinds:set` { id, state: up|down, instant? }, and `blinds:<id>_up` / `blinds:<id>_down`
 *   valve_wheel    `valve:<id>` (spins two turns), `valve:<id>_reset`
 *   security_monitor `camera:feed` { id, state: live|figure|static }
 *   glass_cracks   `glass:set` { id, state: intact|cracked|shattered }
 *   glass_blood    `glass:blood` { id, level: 0..3 }
 *   fluid_trail    `reveal:trail`
 */

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const PI = Math.PI;

// ------------------------------------------------------------------ shared materials

const matCache = new Map<string, THREE.Material>();
function cached<T extends THREE.Material>(key: string, make: () => T): T {
  let m = matCache.get(key) as T | undefined;
  if (!m) {
    m = make();
    m.name = key;
    matCache.set(key, m);
  }
  return m;
}
const plain = (key: string, color: number, roughness = 0.8, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial =>
  cached(key, () => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra }));
/** A non-animated glow, shared so every copy merges into one draw call per room. */
const glow = (key: string, color: number, intensity: number): THREE.MeshStandardMaterial => cached(`glow-${key}`, () => fixtureMaterial(color, intensity));

const MAT = {
  wood: () => plain('wood', 0x6a4a30, 0.62),
  woodDark: () => plain('woodDark', 0x3b281a, 0.55),
  woodLight: () => plain('woodLight', 0x9a7550, 0.6),
  carpet: () => plain('carpet', 0x2e3440, 0.97),
  carpetBorder: () => plain('carpetBorder', 0x1d2129, 0.97),
  ceramic: () => plain('ceramic', 0xd9d5cc, 0.35),
  ceramicTeal: () => plain('ceramicTeal', 0x2f7f86, 0.35),
  ceramicRed: () => plain('ceramicRed', 0x8a2f28, 0.4),
  stone: () => plain('stone', 0x2a2c2f, 0.38, 0.05),
  tileWhite: () => plain('tileWhite', 0xc9cbc6, 0.3),
  tileGrey: () => plain('tileGrey', 0x8d918f, 0.35),
  grout: () => plain('grout', 0x4a4d4c, 0.9),
  leaf: () => plain('leaf', 0x2f6a2c, 0.65, 0, { side: THREE.DoubleSide }),
  leafDark: () => plain('leafDark', 0x1f4a22, 0.7, 0, { side: THREE.DoubleSide }),
  leafLight: () => plain('leafLight', 0x5c9a3a, 0.6, 0, { side: THREE.DoubleSide }),
  leafRed: () => plain('leafRed', 0x6a2a32, 0.65, 0, { side: THREE.DoubleSide }),
  soil: () => plain('soil', 0x24180f, 0.98),
  clay: () => plain('clay', 0x9a5636, 0.85),
  potWhite: () => plain('potWhite', 0xcfcac0, 0.5),
  potDark: () => plain('potDark', 0x22262a, 0.5),
  plastic: () => plain('plastic', 0xd8dcd6, 0.45),
  plasticGreen: () => plain('plasticGreen', 0x3d5c48, 0.5),
  neoprene: () => plain('neoprene', 0x15181c, 0.75),
  suitYellow: () => plain('suitYellow', 0xb08a1e, 0.5, 0.1),
  subHull: () => plain('subHull', 0xc08a2a, 0.55, 0.35),
  subDark: () => plain('subDark', 0x1c1f22, 0.5, 0.6),
  cork: () => plain('cork', 0x9b7448, 0.95),
  paper: () => plain('paper', 0xe6e0cf, 0.9),
  paperBlue: () => plain('paperBlue', 0x9fb8d0, 0.9),
  paperPink: () => plain('paperPink', 0xd8a0a8, 0.9),
  fabric: () => plain('fabric', 0x3b4650, 0.95),
  fabricWarm: () => plain('fabricWarm', 0x6b4a3a, 0.95),
  blind: () => plain('blind', 0xb8b2a4, 0.6, 0.2, { side: THREE.DoubleSide }),
  coffee: () => plain('coffee', 0x1a0d06, 0.2),
  book: (i: number) => plain(`book${i}`, [0x6b2a22, 0x22405a, 0x2f4a2a, 0x8a7a50, 0x3a2a4a][i % 5]!, 0.8),
};

/** Deep-water surface for the moon pool and the flooded tunnel; one shared material and clock. */
const waterUniforms = { uTime: { value: 0 }, uTint: { value: new THREE.Color(0x0b3b40) } };
function waterMaterial(): THREE.ShaderMaterial {
  return cached(
    'water',
    () =>
      new THREE.ShaderMaterial({
        uniforms: waterUniforms,
        transparent: true,
        depthWrite: false,
        vertexShader: /* glsl */ `
          varying vec3 vWorld;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            vWorld = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform vec3 uTint;
          varying vec3 vWorld;
          ${NOISE_GLSL}
          void main() {
            vec2 p = vWorld.xz;
            float n = vnoise(p * 1.7 + vec2(uTime * 0.35, uTime * 0.21)) * vnoise(p * 2.9 - vec2(uTime * 0.27, -uTime * 0.11));
            float spec = smoothstep(0.32, 0.62, n);
            vec3 col = uTint * (0.55 + 0.6 * n) + vec3(0.12, 0.22, 0.22) * spec;
            float view = clamp(abs(normalize(cameraPosition - vWorld).y), 0.0, 1.0);
            gl_FragColor = vec4(col, mix(0.94, 0.78, view));
          }`,
      }),
  );
}

// ------------------------------------------------------------------ small helpers

/** A tapered, curled leaf blade standing on its base along +Y (length `len`). */
function leafBlade(len: number, width: number, curl: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(width, len, 1, 4);
  g.translate(0, len / 2, 0);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / len;
    pos.setX(i, pos.getX(i) * (Math.sin(PI * Math.min(0.98, t * 0.9 + 0.08)) + 0.05));
    pos.setZ(i, t * t * curl * len);
  }
  g.computeVertexNormals();
  return g;
}

/** A rosette of blades: `n` leaves around a centre at (x, y, z). */
function rosette(pb: PieceBuilder, rng: Rng, mats: THREE.Material[], x: number, y: number, z: number, n: number, len: number, width: number, tilt: number): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * PI * 2 + rng.range(-0.3, 0.3);
    const l = len * rng.range(0.7, 1.15);
    pb.add(leafBlade(l, width * rng.range(0.8, 1.2), rng.range(0.2, 0.6)), rng.pick(mats), at(x, y, z, tilt * rng.range(0.7, 1.2), a, 0));
  }
}

/** A leafy clump (lettuce, shrub): squashed icosahedra. */
function clump(pb: PieceBuilder, rng: Rng, mats: THREE.Material[], x: number, y: number, z: number, r: number, n = 3): void {
  for (let i = 0; i < n; i++) {
    const g = new THREE.IcosahedronGeometry(r * rng.range(0.6, 1), 1);
    g.scale(1, rng.range(0.55, 0.8), 1);
    pb.add(g, rng.pick(mats), at(x + rng.range(-r, r) * 0.5, y + r * 0.4, z + rng.range(-r, r) * 0.5, rng.range(0, 1), rng.range(0, PI), 0));
  }
}

function mugAt(pb: PieceBuilder, mat: THREE.Material, x: number, y: number, z: number, ry: number): void {
  pb.add(lathe([[0, 0], [0.04, 0], [0.043, 0.095], [0.038, 0.095], [0.035, 0.01], [0, 0.01]], 14), mat, at(x, y, z, 0, ry, 0));
  pb.add(new THREE.TorusGeometry(0.026, 0.007, 6, 12, PI), mat, at(x, y + 0.048, z, 0, ry, 0).multiply(at(0.043, 0, 0, 0, 0, -PI / 2)));
}

const potMat = (kind: string): THREE.Material => (kind === 'white' ? MAT.potWhite() : kind === 'dark' ? MAT.potDark() : MAT.clay());

/** Canvas plane facing -Z (front of a wall prop). */
function screenPlane(material: THREE.Material, w: number, h: number, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  mesh.position.set(x, y, z);
  mesh.rotation.y = PI;
  return mesh;
}

/** Cracked-glass overlays, one texture per (seed, state), shared by every pane that asks. */
const crackCache = new Map<string, THREE.MeshBasicMaterial>();
function crackMaterial(seed: number, state: 'cracked' | 'shattered'): THREE.MeshBasicMaterial {
  const key = `${seed}:${state}`;
  let mat = crackCache.get(key);
  if (mat) return mat;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 580;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // Deterministic LCG so a pane always cracks the same way.
    let s = seed * 2654435761 + (state === 'cracked' ? 11 : 97);
    const rnd = (): number => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
    const impacts: Array<[number, number]> = state === 'cracked' ? [[0.3 + rnd() * 0.4, 0.3 + rnd() * 0.3]] : [[0.25 + rnd() * 0.2, 0.35], [0.6 + rnd() * 0.2, 0.5 + rnd() * 0.2], [0.45, 0.2 + rnd() * 0.2]];
    const rays = state === 'cracked' ? 9 : 16;
    ctx.lineCap = 'round';
    for (const [ix, iy] of impacts) {
      const cx = ix * canvas.width;
      const cy = iy * canvas.height;
      for (let r = 0; r < rays; r++) {
        let a = (r / rays) * Math.PI * 2 + rnd() * 0.3;
        let x = cx;
        let y = cy;
        let len = (state === 'cracked' ? 180 : 260) * (0.4 + rnd());
        let width = state === 'cracked' ? 2.4 : 3;
        while (len > 0) {
          const seg = 18 + rnd() * 26;
          const nx = x + Math.cos(a) * seg;
          const ny = y + Math.sin(a) * seg;
          ctx.strokeStyle = `rgba(235,245,255,${0.55 + rnd() * 0.3})`;
          ctx.lineWidth = width;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(nx, ny);
          ctx.stroke();
          x = nx;
          y = ny;
          a += (rnd() - 0.5) * 0.7;
          len -= seg;
          width = Math.max(0.8, width * 0.93);
          if (rnd() < 0.12 && len > 40) len -= 40; // a short branch ends here
        }
      }
      // The pitted star at the impact.
      ctx.fillStyle = 'rgba(240,250,255,0.5)';
      ctx.beginPath();
      ctx.arc(cx, cy, state === 'cracked' ? 7 : 12, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
  mat.name = `glass-cracks-${key}`;
  crackCache.set(key, mat);
  return mat;
}

/** Blood smears on glass, one texture per (seed, level), shared by every pane that asks. */
const bloodGlassCache = new Map<string, THREE.MeshBasicMaterial>();
function bloodGlassMaterial(seed: number, level: number): THREE.MeshBasicMaterial {
  const key = `${seed}:${level}`;
  let mat = bloodGlassCache.get(key);
  if (mat) return mat;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 580;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    let s = seed * 2246822519 + 7;
    const rnd = (): number => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
    const blob = (x: number, y: number, r: number, a: number): void => {
      ctx.fillStyle = `rgba(${96 + Math.floor(rnd() * 30)},6,10,${a})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };
    const streak = (x: number, y: number, len: number, r: number, a: number): void => {
      for (let t = 0; t < len; t += 5) blob(x + Math.sin(t * 0.05 + x) * 3, y + t, r * (1 - t / (len * 1.4)), a);
    };
    // Level 1: spatter. Level 2: a slammed hand and running streaks. Level 3: a long smear down and across.
    for (let i = 0; i < 14 * level; i++) blob(300 + rnd() * 420, 120 + rnd() * 260, 2 + rnd() * 7, 0.55 + rnd() * 0.3);
    if (level >= 2) {
      for (let f = 0; f < 5; f++) streak(470 + f * 26 + rnd() * 6, 190 + Math.abs(f - 2) * 14, 120 + rnd() * 90, 7, 0.7);
      blob(500, 280, 38, 0.8);
      for (let i = 0; i < 4; i++) streak(380 + rnd() * 260, 90 + rnd() * 80, 100 + rnd() * 160, 3 + rnd() * 3, 0.6);
    }
    if (level >= 3) {
      ctx.strokeStyle = 'rgba(100,6,10,0.78)';
      ctx.lineCap = 'round';
      ctx.lineWidth = 30;
      ctx.beginPath();
      ctx.moveTo(520, 230);
      ctx.bezierCurveTo(600, 330, 700, 330, 840, 470);
      ctx.stroke();
      ctx.lineWidth = 11;
      ctx.beginPath();
      ctx.moveTo(470, 250);
      ctx.bezierCurveTo(430, 360, 410, 430, 380, 540);
      ctx.stroke();
      for (let i = 0; i < 26; i++) blob(300 + rnd() * 560, 250 + rnd() * 300, 3 + rnd() * 9, 0.6);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
  mat.name = `glass-blood-${key}`;
  bloodGlassCache.set(key, mat);
  return mat;
}

/** The bloom's fluid trail: a wobbling wet smear with a faint teal glow, brightest where it starts. */
const trailCache = new Map<number, THREE.MeshStandardMaterial>();
function fluidTrailMaterial(seed: number): THREE.MeshStandardMaterial {
  let mat = trailCache.get(seed);
  if (mat) return mat;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    let s = seed * 3266489917 + 5;
    const rnd = (): number => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
    let x = 64;
    for (let y = 0; y < 1024; y += 6) {
      x = Math.max(34, Math.min(94, x + (rnd() - 0.5) * 9));
      const fade = 1 - (y / 1024) * 0.7;
      const r = (10 + rnd() * 16) * (0.5 + fade * 0.6);
      ctx.fillStyle = `rgba(70,${150 + Math.floor(rnd() * 50)},${140 + Math.floor(rnd() * 40)},${0.5 * fade + 0.2})`;
      ctx.beginPath();
      ctx.arc(x + (rnd() - 0.5) * 8, y, r, 0, Math.PI * 2);
      ctx.fill();
      if (rnd() < 0.08) {
        ctx.beginPath();
        ctx.arc(x + (rnd() - 0.5) * 50, y, 3 + rnd() * 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.15, metalness: 0, emissive: new THREE.Color(0x0b3a36), emissiveMap: tex, emissiveIntensity: 0.9 });
  mat.name = `fluid-trail-${seed}`;
  trailCache.set(seed, mat);
  return mat;
}

type Gen = (p: PieceParams, rng: Rng, m: Materials, pb: PieceBuilder) => void;

// ------------------------------------------------------------------ props

const GEN: Record<string, Gen> = {
  // ---------------------------------------------------------------- kitchen (ADR-0017)

  mug(p, _rng, _m, pb) {
    const c = strParam(p, 'color', 'white');
    mugAt(pb, c === 'teal' ? MAT.ceramicTeal() : c === 'red' ? MAT.ceramicRed() : MAT.ceramic(), 0, 0, 0, 0);
  },

  tray(p, rng, m, pb) {
    pb.add(rounded(0.46, 0.018, 0.32, 0.008), m.paintDark, at(0, 0.009, 0));
    for (const s of [-1, 1]) {
      pb.add(slab(0.46, 0.03, 0.012), m.paintDark, at(0, 0.025, s * 0.155));
      pb.add(slab(0.012, 0.03, 0.31), m.paintDark, at(s * 0.225, 0.025, 0));
    }
    const n = Math.round(numParam(p, 'mugs', 3));
    const mats = [MAT.ceramic(), MAT.ceramicTeal(), MAT.ceramicRed()];
    for (let i = 0; i < n; i++) mugAt(pb, mats[i % 3]!, -0.15 + (i % 3) * 0.15, 0.018, i < 3 ? -0.05 : 0.08, rng.range(0, PI * 2));
  },

  coffee_machine(_p, _rng, m, pb) {
    pb.add(rounded(0.42, 0.56, 0.4, 0.03), m.paintDark, at(0, 0.28, 0));
    pb.add(rounded(0.44, 0.06, 0.42, 0.02), m.steel, at(0, 0.59, 0));
    pb.add(lathe([[0, 0], [0.1, 0], [0.12, 0.16], [0.1, 0.18], [0, 0.18]], 16), MAT.coffee(), at(0.08, 0.62, 0.04));
    pb.add(slab(0.3, 0.24, 0.06), m.black, at(-0.02, 0.2, -0.18));
    pb.add(rounded(0.32, 0.025, 0.14, 0.008), m.steel, at(-0.02, 0.03, -0.18));
    pb.add(lathe([[0, 0], [0.065, 0], [0.075, 0.08], [0.05, 0.16], [0.055, 0.18], [0, 0.18]], 16), MAT.coffee(), at(-0.06, 0.045, -0.17));
    pb.add(cylinderBetween(V(-0.06, 0.2, -0.17), V(-0.06, 0.24, -0.17), 0.058, 14), m.steel);
    pb.add(slab(0.12, 0.05, 0.01), glow('coffee-led', 0x39ff9e, 2.2), at(0.12, 0.46, -0.202));
    pb.add(slab(0.03, 0.03, 0.01), glow('coffee-red', 0xff3b2f, 2.4), at(0.15, 0.38, -0.202));
    for (let i = 0; i < 3; i++) pb.add(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 10), m.steel, at(0.04 + i * 0.05, 0.38, -0.205, PI / 2, 0, 0));
    mugAt(pb, MAT.ceramic(), 0.1, 0.045, -0.17, 1.2);
    pb.solid(-0.22, 0, -0.21, 0.22, 0.64, 0.21, 'metal');
  },

  kitchen_counter(p, rng, m, pb) {
    const w = numParam(p, 'width', 4);
    const d = 0.64;
    const h = 0.92;
    pb.add(slab(w, h - 0.12, d - 0.06), MAT.plastic(), at(0, (h - 0.12) / 2 + 0.1, 0.03));
    pb.add(slab(w - 0.02, 0.1, d - 0.1), m.black, at(0, 0.05, 0.04));
    pb.add(rounded(w + 0.04, 0.045, d + 0.03, 0.01), MAT.stone(), at(0, h - 0.0225, 0));
    const doors = Math.max(1, Math.round(w / 0.6));
    const dw = w / doors;
    const sinkAt = boolParam(p, 'sink', false) ? Math.floor(doors / 2) : -1;
    for (let i = 0; i < doors; i++) {
      const x = -w / 2 + dw * (i + 0.5);
      const drawer = i % 3 === 1;
      pb.add(rounded(dw - 0.02, drawer ? 0.16 : h - 0.18, 0.02, 0.005), MAT.plastic(), at(x, drawer ? h - 0.17 : (h - 0.12) / 2 + 0.1, -d / 2 + 0.005));
      if (drawer) pb.add(rounded(dw - 0.02, h - 0.4, 0.02, 0.005), MAT.plastic(), at(x, 0.4, -d / 2 + 0.005));
      pb.add(rounded(0.16, 0.018, 0.025, 0.006), m.steel, at(x, h - 0.2, -d / 2 - 0.012));
    }
    if (sinkAt >= 0) {
      const x = -w / 2 + dw * (sinkAt + 0.5);
      pb.add(slab(0.5, 0.012, 0.4), m.black, at(x, h + 0.001, -0.02));
      pb.add(rounded(0.54, 0.015, 0.44, 0.005), m.steel, at(x, h + 0.003, -0.02));
      pb.add(pipe([V(x, h, 0.22), V(x, h + 0.3, 0.22), V(x, h + 0.34, 0.12), V(x, h + 0.26, 0.06)], 0.014, 1, 8), m.steel);
    }
    if (boolParam(p, 'splash', true)) {
      pb.add(slab(w, 0.55, 0.02), MAT.tileWhite(), at(0, h + 0.275, d / 2 - 0.01));
      for (let k = 1; k < 4; k++) pb.add(slab(w, 0.006, 0.022), MAT.grout(), at(0, h + k * 0.14, d / 2 - 0.01));
    }
    if (boolParam(p, 'upper', true)) {
      const uy = 1.55;
      pb.add(slab(w, 0.7, 0.34), MAT.plastic(), at(0, uy + 0.35, d / 2 - 0.17));
      for (let i = 0; i < doors; i++) {
        const x = -w / 2 + dw * (i + 0.5);
        pb.add(rounded(dw - 0.02, 0.66, 0.02, 0.005), MAT.plastic(), at(x, uy + 0.35, d / 2 - 0.345));
        pb.add(rounded(0.025, 0.12, 0.025, 0.006), m.steel, at(x + (i % 2 ? -1 : 1) * (dw / 2 - 0.06), uy + 0.1, d / 2 - 0.36));
      }
      pb.add(slab(w - 0.1, 0.02, 0.05), glow('under-cabinet', 0xffe2b0, 1.4), at(0, uy - 0.012, d / 2 - 0.3));
      pb.solid(-w / 2, uy, d / 2 - 0.34, w / 2, uy + 0.7, d / 2);
    }
    // Clutter: a jar, a cutting board.
    if (rng.chance(0.8)) pb.add(rounded(0.38, 0.02, 0.26, 0.006), MAT.woodLight(), at(-w / 2 + 0.5, h + 0.01, 0, 0, rng.range(-0.3, 0.3), 0));
    pb.add(lathe([[0, 0], [0.05, 0], [0.05, 0.14], [0.03, 0.16], [0, 0.16]], 12), MAT.ceramicTeal(), at(w / 2 - 0.25, h, 0.15));
    pb.solid(-w / 2, 0, -d / 2, w / 2, h, d / 2, 'metal');
    pb.nav(0, 0, -d / 2 - 0.6);
  },

  radio(_p, _rng, m, pb) {
    pb.add(rounded(0.32, 0.18, 0.11, 0.02), MAT.woodDark(), at(0, 0.09, 0));
    pb.add(slab(0.15, 0.13, 0.01, 0.2), m.grating, at(-0.07, 0.09, -0.056));
    pb.add(slab(0.11, 0.035, 0.008), glow('radio-dial', 0xffb24a, 1.8), at(0.08, 0.13, -0.056));
    for (const x of [0.05, 0.11]) pb.add(new THREE.CylinderGeometry(0.016, 0.016, 0.02, 12), m.steel, at(x, 0.06, -0.06, PI / 2, 0, 0));
    pb.add(cylinderBetween(V(0.13, 0.18, 0.03), V(0.22, 0.48, 0.06), 0.004, 6), m.steel);
    pb.add(rounded(0.24, 0.02, 0.02, 0.008), m.paintDark, at(0, 0.19, 0));
  },

  // ---------------------------------------------------------------- the supply sub (ADR-0017)

  supply_sub(p, _rng, m, pb) {
    // Origin is the docked centre of the hull, outside the dock window. Long axis on X.
    const group = new THREE.Group();
    group.name = 'supply_sub';
    const mb = new AoMergeBuilder();
    // The GLB hull when preloaded (main.ts), else the original procedural one.
    const kilo = createSubModel();
    const L = kilo ? SUB_LENGTH : 9;
    const R = kilo ? SUB_RADIUS : 1.35;
    const sailTop = kilo ? SUB_SAIL_TOP : R + 1.25;
    const K = kilo ? SUB_SCALE : 1; // lights and beams scale with the hull
    // A bigger hull stays the same distance from the window by moving out by the extra radius.
    const standoff = kilo ? R - 1.35 : 0;
    if (kilo) group.add(kilo);
    else {
      const hull = lathe([[0, -L / 2], [0.55, -L / 2 + 0.1], [1.05, -L / 2 + 0.6], [R, -L / 2 + 1.6], [R, L / 2 - 1.8], [1.1, L / 2 - 0.7], [0.6, L / 2 - 0.1], [0, L / 2]], 28);
      hull.rotateZ(PI / 2);
      mb.add(hull, MAT.subHull());
      mb.add(rounded(3.2, 1.0, 1.4, 0.2), MAT.subHull(), at(0.4, R + 0.3, 0));
      mb.add(rounded(1.2, 0.5, 1.0, 0.15), MAT.subDark(), at(0.4, R + 0.95, 0));
      for (const s of [-1, 1]) {
        mb.add(slab(L - 2.5, 0.16, 0.2), MAT.subDark(), at(0, -R - 0.25, s * 0.8));
        for (const x of [-2.5, 0, 2.5]) mb.add(slab(0.14, 0.4, 0.14), MAT.subDark(), at(x, -R - 0.05, s * 0.8));
        mb.add(rounded(1.8, 0.12, 0.9, 0.05), MAT.subHull(), at(-L / 2 + 1.0, 0.1, s * (R + 0.35)));
      }
      mb.add(new THREE.TorusGeometry(0.7, 0.12, 8, 24), MAT.subDark(), at(-L / 2 - 0.1, 0, 0, 0, PI / 2, 0));
      mb.add(cylinderBetween(V(-L / 2 - 0.35, 0, 0), V(-L / 2 + 0.2, 0, 0), 0.3, 12), MAT.subDark());
      // Viewport bubble at the bow and the hull band.
      mb.add(new THREE.SphereGeometry(0.75, 18, 12, 0, PI * 2, 0, PI / 2), m.black, at(L / 2 - 0.55, 0.15, 0, 0, 0, -PI / 2));
      for (const x of [-1.6, 1.4]) mb.add(new THREE.TorusGeometry(R + 0.02, 0.05, 6, 32), MAT.subDark(), at(x, 0, 0, 0, PI / 2, 0));
      mb.add(slab(0.8, 0.5, 0.02), m.hazard, at(-0.6, 0.4, R + 0.01));
      group.add(mb.build('supply_sub:hull', null));
    }
    // Lights: headlamps, beams, running lights.
    const lamp = fixtureMaterial(0xfff1d0, 4);
    const red = fixtureMaterial(0xff2a1a, 3);
    const green = fixtureMaterial(0x2aff7a, 3);
    const beamMat = cached('sub-beam', () => new THREE.MeshBasicMaterial({ color: 0x9fd8e0, transparent: true, opacity: 0.07, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    // Both headlamps in one mesh and both beams in another (draw calls).
    const heads: THREE.BufferGeometry[] = [];
    const beams: THREE.BufferGeometry[] = [];
    // Lamps sit on the bow flanks: further back and closer in on the slim GLB hull, which tapers early.
    const lampX = kilo ? L / 2 - 1.9 * K : L / 2 - 0.9;
    const lampY = kilo ? -0.2 * K : -0.55;
    const lampZ = kilo ? 0.55 * K : 0.75;
    for (const s of [-1, 1]) {
      heads.push(new THREE.SphereGeometry(0.13 * K, 12, 8).translate(lampX, lampY, s * lampZ));
      const b = new THREE.ConeGeometry(1.6 * K, 9 * K, 16, 1, true);
      b.translate(0, -4.5 * K, 0);
      b.rotateZ(PI / 2 - 0.25);
      b.translate(lampX, lampY, s * lampZ);
      beams.push(b);
    }
    group.add(new THREE.Mesh(mergeGeometries(heads, false) ?? heads[0]!, lamp), new THREE.Mesh(mergeGeometries(beams, false) ?? beams[0]!, beamMat));
    const port = new THREE.Mesh(new THREE.SphereGeometry(0.08 * K, 8, 6), red);
    port.position.set(0.4, sailTop, -0.4 * K);
    const star = new THREE.Mesh(new THREE.SphereGeometry(0.08 * K, 8, 6), green);
    star.position.set(0.4, sailTop, 0.4 * K);
    group.add(port, star);
    // Station docking cradle (visible through the dock window): four clamp arms hinge up from
    // plinth rails below the hull and swing in to grip its flanks; an umbilical boom ties the
    // cradle back to the station. Open, the arms lean outward so the hull slides in along X
    // between them without touching anything (the window truss poles stand 4+ m nearer the glass).
    const arms: THREE.Group[] = [];
    // Everything scales with the hull (K); the arms stand a fixed 0.5 m off its centreline radius so
    // their scaled-up heads still land on the flanks, and the whole cradle follows the hull's standoff.
    const off = R + 0.5;
    for (const s of [-1, 1]) {
      for (const x of [-2, 2]) {
        const arm = new THREE.Group();
        arm.position.set(x * K, -2.2 * K, -standoff + s * off);
        arm.userData['side'] = s;
        const amb = new AoMergeBuilder();
        amb.add(rounded(0.34 * K, 2.9 * K, 0.34 * K, 0.04 * K), m.steel, at(0, 1.45 * K, 0));
        amb.add(rounded(0.7 * K, 0.3 * K, 0.4 * K, 0.05 * K), m.hazard, at(0, 2.9 * K, -s * 0.4 * K));
        amb.add(cylinderBetween(V(-0.25 * K, 0, 0), V(0.25 * K, 0, 0), 0.2 * K, 12), m.steel);
        arm.add(amb.build('supply_sub:arm', null));
        arms.push(arm);
        pb.add(rounded(0.6 * K, 1.4 * K, 0.6 * K, 0.04 * K), m.paintDark, at(x * K, -3.0 * K, -standoff + s * off)); // pylon under the hinge
      }
      pb.add(rounded(5.2 * K, 0.3 * K, 0.6 * K, 0.04 * K), m.paintDark, at(0, -2.45 * K, -standoff + s * off)); // plinth rail
    }
    pb.add(slab(0.5 * K, 0.3 * K, 2 * off), m.paintDark, at(-0.1 * K, -2.45 * K, -standoff)); // cross beam under the hull
    // Umbilical boom from the station-side arm to the station wall (5.15 m from the piece origin).
    const nearZ = -standoff + off;
    const boomLen = Math.max(0.5, 5.15 - nearZ);
    pb.add(slab(0.5 * K, 0.3 * K, boomLen), m.paintDark, at(-0.1 * K, -2.45 * K, nearZ + boomLen / 2));
    const root = new THREE.Group();
    root.add(group, ...arms);
    pb.dynamic(root);

    // Animation: away (hidden) -> rising from the dark -> docked with the clamps closed.
    const docked = strParam(p, 'state', 'away') === 'docked';
    const dur = numParam(p, 'dockTime', 14);
    let now = 0;
    let start: number | null = null;
    let mode: 'away' | 'docking' | 'docked' | 'leaving' = docked ? 'docked' : 'away';
    const place = (k: number): void => {
      // k: 0 far out along the dock axis -> 1 docked. The hull slides in on X only (clear of the
      // truss poles and the open clamps), arrives with 2 s to spare, then the clamps close and it settles.
      const t = Math.min(1, Math.max(0, k)) * dur;
      const a = Math.min(1, t / Math.max(0.1, dur - 2));
      const e = 1 - Math.pow(1 - a, 3);
      const clamp = Math.min(1, Math.max(0, (t - (dur - 2)) / 2));
      group.position.set(-(26 + (L - 9) / 2) * (1 - e), -0.1 * (1 - e) - 0.07 * Math.sin(clamp * PI), -standoff);
      group.rotation.z = 0.02 * (1 - e);
      for (const a2 of arms) a2.rotation.x = (a2.userData['side'] as number) * (1 - clamp) * 0.9;
      group.visible = k > 0.001;
    };
    place(docked ? 1 : 0);
    pb.tick((t) => {
      now = t;
      const blink = Math.floor(t * 1.2) % 2 === 0;
      red.emissiveIntensity = blink ? 3 : 0.2;
      green.emissiveIntensity = blink ? 0.2 : 3;
      if (mode === 'docking' || mode === 'leaving') {
        if (start === null) start = t;
        const k = (t - start) / dur;
        place(mode === 'docking' ? k : 1 - k);
        if (k >= 1) mode = mode === 'docking' ? 'docked' : 'away';
      }
    });
    pb.on('intro:sub_dock', () => {
      if (mode === 'docked') return;
      mode = 'docking';
      start = now || null;
    });
    pb.on('intro:sub_docked', () => {
      mode = 'docked';
      place(1);
    });
    // A skipped intro ends with the sub docked.
    pb.on('sequence:ended', (e) => {
      if ((e as { id?: string } | undefined)?.id === 'intro_shift_change' && mode !== 'away') {
        mode = 'docked';
        place(1);
      }
    });
    pb.on('sub:leave', () => {
      if (mode === 'away') return;
      mode = 'leaving';
      start = now || null;
    });
  },

  // ---------------------------------------------------------------- briefing (ADR-0023)

  wall_screen(p, _rng, m, pb) {
    const w = numParam(p, 'width', 2.6);
    const h = numParam(p, 'height', w * 0.5625);
    const y = numParam(p, 'y', 1.75);
    const id = strParam(p, 'id', 'screen');
    const initial = strParam(p, 'state', 'off');
    let state = initial;
    let who = 'hale';
    const screen = new CanvasScreen(640, 360, (ctx, t, cw, ch) => drawBroadcast(ctx, t, cw, ch, state, who), 1.5, 10);
    pb.add(rounded(w + 0.12, h + 0.12, 0.08, 0.02), m.paintDark, at(0, y, -0.04));
    pb.add(slab(0.3, 0.2, 0.06), m.steel, at(0, y, -0.01));
    const display = screenPlane(screen.material, w, h, 0, y, -0.082);
    display.name = `screen:${id}`;
    pb.dynamic(display);
    const apply = (s: unknown): void => {
      if (typeof s !== 'string') return;
      state = s;
      screen.material.emissiveIntensity = s === 'off' ? 0.25 : 1.5;
    };
    apply(state);
    pb.tick((t) => screen.update(t));
    pb.on('screen:set', (e) => {
      const ev = e as { id?: string; state?: string } | undefined;
      if (ev?.id === id) apply(ev.state);
    });
    pb.on('level:reset', () => apply(initial));
    if (strParam(p, 'channel', '') === 'briefing') {
      pb.on('briefing:screen', (e) => {
        const ev = e as { state?: string; who?: string } | undefined;
        if (typeof ev?.who === 'string') who = ev.who;
        apply(ev?.state ?? 'on');
      });
    }
  },

  blinds(p, _rng, m, pb) {
    const w = numParam(p, 'width', 3.8);
    const h = numParam(p, 'height', 2.2);
    const top = numParam(p, 'top', 2.55);
    const id = strParam(p, 'id', 'blinds');
    pb.add(rounded(w + 0.06, 0.1, 0.1, 0.02), m.paintDark, at(0, top + 0.05, -0.05));
    const slats: THREE.BufferGeometry[] = [];
    for (let y = 0; y < h; y += 0.06) {
      const g = new THREE.BoxGeometry(w, 0.05, 0.008);
      g.rotateX(0.35);
      g.translate(0, -y - 0.03, 0);
      slats.push(g.toNonIndexed());
    }
    const merged = mergeGeometries(slats, false) ?? new THREE.BoxGeometry(w, h, 0.01);
    const curtain = new THREE.Mesh(merged, MAT.blind());
    curtain.position.set(0, top, -0.06);
    const rail = new THREE.Mesh(rounded(w, 0.03, 0.03, 0.01), m.steel);
    const root = new THREE.Group();
    root.add(curtain, rail);
    pb.dynamic(root);
    const startState = strParam(p, 'state', 'down');
    let k = startState === 'up' ? 0 : 1; // 1 = fully down
    let target = k;
    const place = (): void => {
      const s = Math.max(0.03, k);
      curtain.scale.y = s;
      curtain.visible = k > 0.02;
      rail.position.set(0, top - h * s, -0.06);
    };
    place();
    pb.tick((_t, dt) => {
      if (k === target) return;
      k = k < target ? Math.min(target, k + dt / 2.4) : Math.max(target, k - dt / 2.4);
      place();
    });
    const set = (state: unknown, instant: unknown): void => {
      if (state !== 'up' && state !== 'down') return;
      target = state === 'up' ? 0 : 1;
      if (instant === true) {
        k = target;
        place();
      }
    };
    pb.on('blinds:set', (e) => {
      const ev = e as { id?: string; state?: string; instant?: boolean } | undefined;
      if (ev?.id === id) set(ev.state, ev.instant);
    });
    pb.on('level:reset', () => set(startState, true));
    pb.on(`blinds:${id}_up`, () => set('up', false));
    pb.on(`blinds:${id}_down`, () => set('down', false));
  },

  /**
   * Crack overlay for a glass partition (ADR-0014 beat 2, `glass` action): hidden while intact,
   * a few cracks from one impact when `cracked`, a web of them with chips when `shattered`.
   */
  glass_cracks(p, _rng, _m, pb) {
    const w = numParam(p, 'width', 3.9);
    const h = numParam(p, 'height', 2.25);
    const y = numParam(p, 'y', 1.475);
    const id = strParam(p, 'id', 'glass');
    const seed = Math.round(numParam(p, 'seed', 1));
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), crackMaterial(seed, 'cracked'));
    mesh.position.set(0, y, 0);
    mesh.rotation.y = PI;
    mesh.renderOrder = 4;
    mesh.visible = false;
    pb.dynamic(mesh);
    const set = (state: unknown): void => {
      if (state !== 'intact' && state !== 'cracked' && state !== 'shattered') return;
      mesh.visible = state !== 'intact';
      if (state !== 'intact') mesh.material = crackMaterial(seed, state);
    };
    pb.on('glass:set', (e) => {
      const ev = e as { id?: string; state?: string } | undefined;
      if (ev?.id === id) set(ev.state);
    });
    pb.on('level:reset', () => set('intact'));
  },

  /**
   * Blood on a glass partition (ADR-0014 beat 5, Priya at the medical bay glass): hidden until
   * `glass:blood` { id, level 1..3 }, then drops, a handprint and long smears as the level rises.
   */
  glass_blood(p, _rng, _m, pb) {
    const w = numParam(p, 'width', 3.9);
    const h = numParam(p, 'height', 2.25);
    const y = numParam(p, 'y', 1.475);
    const id = strParam(p, 'id', 'glass');
    const seed = Math.round(numParam(p, 'seed', 1));
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), bloodGlassMaterial(seed, 1));
    mesh.position.set(0, y, 0);
    mesh.rotation.y = PI;
    mesh.renderOrder = 5;
    mesh.visible = false;
    pb.dynamic(mesh);
    pb.on('glass:blood', (e) => {
      const ev = e as { id?: string; level?: number } | undefined;
      if (ev?.id !== id) return;
      const level = Math.max(0, Math.min(3, Math.round(ev.level ?? 1)));
      mesh.visible = level > 0;
      if (level > 0) mesh.material = bloodGlassMaterial(seed, level);
    });
    pb.on('level:reset', () => {
      mesh.visible = false;
    });
  },

  /**
   * The bloom's fluid trail on the floor (ADR-0014 beat 8, ADR-0022): a wet, faintly glowing smear
   * `length` metres long running away from the prop's -Z, hidden until the `reveal:trail` event.
   */
  fluid_trail(p, _rng, _m, pb) {
    const length = numParam(p, 'length', 8);
    const width = numParam(p, 'width', 1);
    const seed = Math.round(numParam(p, 'seed', 1));
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, length), fluidTrailMaterial(seed));
    mesh.rotation.x = -PI / 2;
    mesh.position.set(0, 0.012, -length / 2);
    mesh.renderOrder = 2;
    mesh.visible = false;
    pb.dynamic(mesh);
    pb.on('reveal:trail', () => {
      mesh.visible = true;
    });
    pb.on('level:reset', () => {
      mesh.visible = false;
    });
  },

  // ---------------------------------------------------------------- hydroponics (ADR-0023)

  plant_rack(p, rng, m, pb) {
    const L = numParam(p, 'length', 2.4);
    const tiers = Math.round(numParam(p, 'tiers', 3));
    const light = strParam(p, 'light', 'magenta');
    const glowMat = light === 'white' ? glow('grow-white', 0xf2fff0, 2.2) : glow('grow-magenta', 0xff4fd8, 2.0);
    const d = 0.6;
    const gap = 0.62;
    for (const x of [-L / 2 + 0.03, L / 2 - 0.03]) for (const z of [-d / 2 + 0.03, d / 2 - 0.03]) pb.add(slab(0.05, tiers * gap + 0.35, 0.05), m.steel, at(x, (tiers * gap + 0.35) / 2, z));
    const greens = [MAT.leaf(), MAT.leafLight(), MAT.leafDark()];
    for (let t = 0; t < tiers; t++) {
      const y = 0.3 + t * gap;
      pb.add(rounded(L, 0.14, d - 0.06, 0.02), MAT.plasticGreen(), at(0, y, 0));
      pb.add(slab(L - 0.06, 0.02, d - 0.12), MAT.soil(), at(0, y + 0.065, 0));
      const per = Math.max(2, Math.floor(L / 0.26));
      for (let i = 0; i < per; i++) {
        const x = -L / 2 + (L / per) * (i + 0.5);
        for (const z of [-0.12, 0.12]) {
          if (rng.chance(0.12)) continue;
          if (rng.chance(0.55)) clump(pb, rng, greens, x, y + 0.07, z, rng.range(0.07, 0.11), 2);
          else rosette(pb, rng, greens, x, y + 0.07, z, 5, rng.range(0.14, 0.24), 0.05, 0.7);
        }
      }
      // Grow light under the shelf above (or a top bar).
      pb.add(slab(L - 0.1, 0.02, 0.08), glowMat, at(0, y + gap - 0.1, 0));
      pb.add(slab(L - 0.08, 0.03, 0.12), m.steel, at(0, y + gap - 0.08, 0));
    }
    pb.add(pipe([V(-L / 2, 0.22, d / 2 - 0.02), V(L / 2, 0.22, d / 2 - 0.02)], 0.02, 1, 8), m.paintTeal);
    pb.solid(-L / 2, 0, -d / 2, L / 2, tiers * gap + 0.35, d / 2, 'metal');
  },

  potted_plant(p, rng, _m, pb) {
    const kind = strParam(p, 'kind', rng.pick(['fern', 'palm', 'shrub', 'tall', 'succulent']));
    const s = numParam(p, 'size', 1);
    const potR = 0.18 * s;
    const potH = (kind === 'tall' || kind === 'palm' ? 0.42 : 0.3) * s;
    const pm = potMat(strParam(p, 'pot', rng.pick(['clay', 'white', 'dark'])));
    pb.add(lathe([[0, 0], [potR * 0.75, 0], [potR, potH], [potR * 1.08, potH], [potR * 1.08, potH + 0.03], [0, potH + 0.03]], 16), pm);
    pb.add(new THREE.CylinderGeometry(potR * 0.98, potR * 0.98, 0.02, 16), MAT.soil(), at(0, potH + 0.02, 0));
    const top = potH + 0.03;
    const greens = [MAT.leaf(), MAT.leafLight(), MAT.leafDark()];
    if (kind === 'fern') rosette(pb, rng, greens, 0, top, 0, 14, 0.55 * s, 0.12 * s, 1.0);
    else if (kind === 'palm') {
      const trunk = 0.9 * s;
      pb.add(cylinderBetween(V(0, top, 0), V(0.05, top + trunk, 0.02), 0.035 * s, 8), MAT.woodDark());
      rosette(pb, rng, greens, 0.05, top + trunk, 0.02, 9, 0.7 * s, 0.16 * s, 1.15);
    } else if (kind === 'tall') {
      for (let i = 0; i < 3; i++) {
        const a = rng.range(0, PI * 2);
        const h = rng.range(0.7, 1.3) * s;
        const tip = V(Math.cos(a) * 0.12, top + h, Math.sin(a) * 0.12);
        pb.add(cylinderBetween(V(0, top, 0), tip, 0.015 * s, 6), MAT.woodDark());
        clump(pb, rng, greens, tip.x, tip.y - 0.1, tip.z, 0.18 * s, 3);
      }
    } else if (kind === 'succulent') {
      rosette(pb, rng, [MAT.leafLight(), MAT.leaf()], 0, top, 0, 10, 0.16 * s, 0.07 * s, 0.5);
      rosette(pb, rng, [MAT.leafRed()], 0, top, 0, 5, 0.1 * s, 0.05 * s, 0.25);
    } else clump(pb, rng, greens, 0, top + 0.1 * s, 0, 0.26 * s, 5);
    pb.solid(-potR, 0, -potR, potR, potH + 0.3 * s, potR, 'metal');
  },

  hanging_plant(p, rng, m, pb) {
    const ceil = numParam(p, 'ceiling', 3.2);
    const drop = numParam(p, 'drop', 0.8);
    const y = ceil - drop;
    for (let k = 0; k < 3; k++) {
      const a = (k * 2 * PI) / 3;
      pb.add(cylinderBetween(V(0, ceil, 0), V(Math.cos(a) * 0.15, y + 0.2, Math.sin(a) * 0.15), 0.004, 4), m.cable);
    }
    pb.add(lathe([[0, 0], [0.1, 0.01], [0.16, 0.12], [0.17, 0.2], [0, 0.2]], 14), potMat(strParam(p, 'pot', 'white')), at(0, y, 0));
    const greens = [MAT.leaf(), MAT.leafLight()];
    clump(pb, rng, greens, 0, y + 0.18, 0, 0.16, 3);
    const vines = 6 + Math.floor(rng.range(0, 4));
    for (let i = 0; i < vines; i++) {
      const a = rng.range(0, PI * 2);
      const len = rng.range(0.4, 1.2);
      const pts = [V(Math.cos(a) * 0.15, y + 0.18, Math.sin(a) * 0.15), V(Math.cos(a) * 0.24, y - len * 0.4, Math.sin(a) * 0.24), V(Math.cos(a + 0.3) * 0.22, y - len, Math.sin(a + 0.3) * 0.22)];
      pb.add(pipe(pts, 0.006, 1, 4), MAT.leafDark());
      for (let j = 1; j < 5; j++) {
        const q = pts[1]!.clone().lerp(pts[j < 3 ? 0 : 2]!, j < 3 ? 1 - j / 3 : (j - 2) / 3);
        pb.add(leafBlade(0.07, 0.05, 0.4), rng.pick(greens), at(q.x, q.y, q.z, rng.range(1.5, 2.5), rng.range(0, PI * 2), 0));
      }
    }
  },

  mister(p, rng, m, pb) {
    const L = numParam(p, 'length', 3.6);
    const ceil = numParam(p, 'ceiling', 3.2);
    const y = ceil - 0.35;
    pb.add(pipe([V(-L / 2, y, 0), V(L / 2, y, 0)], 0.025, 1, 8), m.steel);
    for (const x of [-L / 2 + 0.2, L / 2 - 0.2]) pb.add(cylinderBetween(V(x, y, 0), V(x, ceil, 0), 0.01, 6), m.steel);
    const n = Math.max(2, Math.floor(L / 0.6));
    const count = 90;
    const pos = new Float32Array(count * 3);
    const seeds: number[] = [];
    for (let i = 0; i < count; i++) seeds.push(rng.range(0, 1));
    for (let i = 0; i < n; i++) pb.add(new THREE.ConeGeometry(0.02, 0.05, 8), m.steel, at(-L / 2 + (L / n) * (i + 0.5), y - 0.04, 0, PI, 0, 0));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = cached('mist', () => new THREE.PointsMaterial({ color: 0xd8f0ff, size: 0.12, transparent: true, opacity: 0.12, depthWrite: false }));
    const mist = new THREE.Points(geo, mat);
    mist.frustumCulled = false;
    pb.dynamic(mist);
    const period = numParam(p, 'period', 9);
    pb.tick((t) => {
      // Bursts of a few seconds every `period` s; drifting down and outward.
      const phase = (t % period) / period;
      const on = phase < 0.35;
      for (let i = 0; i < count; i++) {
        const s = seeds[i]!;
        const nozzle = -L / 2 + (L / n) * ((i % n) + 0.5);
        const age = (phase * 3 + s) % 1;
        const spread = age * 0.5;
        pos[i * 3] = nozzle + Math.sin(s * 40) * spread;
        pos[i * 3 + 1] = on ? y - 0.05 - age * 1.4 : -100;
        pos[i * 3 + 2] = Math.cos(s * 37) * spread;
      }
      geo.attributes['position']!.needsUpdate = true;
    });
  },

  // ---------------------------------------------------------------- dive bay (ADR-0023)

  water_surface(p, _rng, _m, pb) {
    const w = numParam(p, 'width', 4);
    const d = numParam(p, 'depth', 4);
    const level = numParam(p, 'level', 0.45);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, d, 1, 1), waterMaterial());
    plane.rotation.x = -PI / 2;
    plane.position.y = level;
    plane.renderOrder = 2;
    pb.dynamic(plane);
    pb.tick((t) => {
      waterUniforms.uTime.value = t;
    });
    // Footsteps read "water" here (a 1 mm surface box on top of the floor).
    const box = { min: [-w / 2, -0.05, -d / 2] as [number, number, number], max: [w / 2, 0.001, d / 2] as [number, number, number] };
    pb.surfaces.push({ box, material: 'water' });
  },

  dive_suit_rack(p, rng, m, pb) {
    const n = Math.round(numParam(p, 'suits', 3));
    const W = n * 0.7 + 0.2;
    for (const x of [-W / 2, W / 2]) pb.add(slab(0.06, 2.2, 0.06), m.steel, at(x, 1.1, 0.2));
    pb.add(cylinderBetween(V(-W / 2, 2.05, 0.2), V(W / 2, 2.05, 0.2), 0.025, 8), m.steel);
    pb.add(slab(W, 0.04, 0.45), m.grating, at(0, 2.2, 0.05));
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + 0.45 + i * 0.7;
      const hang = rng.chance(0.85);
      if (!hang) continue;
      const lean = rng.range(-0.05, 0.05);
      const f = at(x, 0, 0.12, 0, lean, 0);
      pb.add(cylinderBetween(V(x, 2.05, 0.18), V(x, 1.85, 0.12), 0.008, 4), m.steel);
      pb.add(rounded(0.46, 0.62, 0.24, 0.09), MAT.neoprene(), f.clone().multiply(at(0, 1.5, 0)));
      pb.add(slab(0.47, 0.07, 0.25), MAT.suitYellow(), f.clone().multiply(at(0, 1.62, 0)));
      for (const s of [-1, 1]) {
        pb.add(cylinderBetween(V(x + s * 0.26, 1.75, 0.12), V(x + s * 0.3, 1.18, 0.14), 0.06, 8), MAT.neoprene());
        pb.add(cylinderBetween(V(x + s * 0.11, 1.2, 0.12), V(x + s * 0.12, 0.45, 0.14), 0.075, 8), MAT.neoprene());
        pb.add(rounded(0.13, 0.12, 0.26, 0.04), m.rubber, at(x + s * 0.12, 0.06, 0.08));
      }
      // Helmet on the shelf above.
      pb.add(new THREE.SphereGeometry(0.17, 14, 10), MAT.suitYellow(), at(x, 2.39, 0.05));
      pb.add(new THREE.CircleGeometry(0.1, 14), m.black, at(x, 2.4, -0.115, 0, PI, 0));
    }
    for (let i = 0; i < Math.max(1, n - 1); i++) pb.add(lathe([[0, 0], [0.09, 0], [0.09, 0.6], [0.06, 0.68], [0.02, 0.72], [0, 0.72]], 12), MAT.suitYellow(), at(-W / 2 + 0.35 + i * 0.7, 0, -0.18));
    pb.solid(-W / 2, 0, -0.3, W / 2, 2.4, 0.3, 'metal');
  },

  // ---------------------------------------------------------------- TAG admin office (ADR-0023)

  office_desk(p, rng, m, pb) {
    const w = numParam(p, 'width', 1.6);
    const exec = boolParam(p, 'exec', false);
    const top = exec ? MAT.woodDark() : MAT.wood();
    pb.add(rounded(w, 0.05, 0.8, 0.012), top, at(0, 0.75, 0));
    pb.add(slab(w - 0.1, 0.6, 0.03), exec ? MAT.woodDark() : m.paintBone, at(0, 0.42, 0.36));
    for (const x of [-w / 2 + 0.04, w / 2 - 0.04]) pb.add(slab(0.04, 0.73, 0.76), exec ? MAT.woodDark() : m.steel, at(x, 0.365, 0));
    if (exec) pb.add(slab(0.45, 0.6, 0.7), MAT.woodDark(), at(w / 2 - 0.3, 0.42, 0));
    if (boolParam(p, 'monitor', true)) {
      pb.add(rounded(0.62, 0.38, 0.04, 0.01), m.paintDark, at(0, 1.12, 0.18));
      pb.add(slab(0.56, 0.32, 0.005), glow('office-monitor', 0x6fa8c8, 0.7), at(0, 1.12, 0.157));
      pb.add(cylinderBetween(V(0, 0.775, 0.2), V(0, 0.93, 0.2), 0.02, 8), m.steel);
      pb.add(rounded(0.22, 0.012, 0.16, 0.004), m.steel, at(0, 0.781, 0.2));
      pb.add(rounded(0.44, 0.015, 0.14, 0.004), m.paintDark, at(0, 0.783, -0.12));
    }
    const papers = Math.round(numParam(p, 'papers', 3));
    const pmats = [MAT.paper(), MAT.paperBlue(), MAT.paper()];
    for (let i = 0; i < papers; i++) pb.add(slab(0.21, 0.003 + i * 0.002, 0.297), pmats[i % 3]!, at(rng.range(-w / 2 + 0.25, w / 2 - 0.25), 0.777 + i * 0.003, rng.range(-0.25, 0.05), 0, rng.range(-0.5, 0.5), 0));
    if (rng.chance(0.6)) mugAt(pb, rng.pick([MAT.ceramic(), MAT.ceramicTeal(), MAT.ceramicRed()]), w / 2 - 0.2, 0.775, -0.2, rng.range(0, 6));
    if (exec) {
      pb.add(lathe([[0, 0], [0.08, 0], [0.02, 0.02], [0.012, 0.4], [0, 0.4]], 12), m.steel, at(-w / 2 + 0.2, 0.775, 0.2));
      pb.add(new THREE.ConeGeometry(0.12, 0.14, 14, 1, true), MAT.woodDark(), at(-w / 2 + 0.2, 1.2, 0.2));
      pb.add(slab(0.14, 0.02, 0.1), glow('desk-lamp', 0xffd9a0, 1.6), at(-w / 2 + 0.2, 1.13, 0.2));
    }
    pb.solid(-w / 2, 0, -0.4, w / 2, 0.78, 0.4, 'metal');
  },

  sofa(p, _rng, _m, pb) {
    const w = numParam(p, 'width', 2);
    const mat = strParam(p, 'tone', 'cool') === 'warm' ? MAT.fabricWarm() : MAT.fabric();
    pb.add(rounded(w, 0.4, 0.85, 0.06), mat, at(0, 0.2, 0));
    pb.add(rounded(w, 0.5, 0.2, 0.06), mat, at(0, 0.6, 0.33));
    for (const s of [-1, 1]) pb.add(rounded(0.18, 0.55, 0.85, 0.06), mat, at(s * (w / 2 - 0.09), 0.3, 0));
    const seats = Math.max(1, Math.round(w / 0.7));
    for (let i = 0; i < seats; i++) pb.add(rounded((w - 0.4) / seats - 0.02, 0.12, 0.6, 0.05), mat, at(-w / 2 + 0.2 + ((w - 0.4) / seats) * (i + 0.5), 0.45, -0.06));
    pb.solid(-w / 2, 0, -0.43, w / 2, 0.85, 0.43, 'rubber');
  },

  bookshelf(p, rng, _m, pb) {
    const w = numParam(p, 'width', 1.2);
    const h = numParam(p, 'height', 2);
    const d = 0.35;
    for (const x of [-w / 2 + 0.02, w / 2 - 0.02]) pb.add(slab(0.04, h, d), MAT.woodDark(), at(x, h / 2, 0));
    pb.add(slab(w, h, 0.02), MAT.woodDark(), at(0, h / 2, d / 2 - 0.01));
    const shelves = Math.max(2, Math.round(h / 0.4));
    for (let s = 0; s <= shelves; s++) {
      const y = 0.04 + (s * (h - 0.08)) / shelves;
      pb.add(slab(w - 0.04, 0.03, d - 0.02), MAT.woodDark(), at(0, y, 0));
      if (s === shelves) break;
      let x = -w / 2 + 0.06;
      while (x < w / 2 - 0.1) {
        const bw = rng.range(0.025, 0.06);
        const bh = rng.range(0.22, 0.32);
        if (rng.chance(0.85)) pb.add(slab(bw, bh, rng.range(0.18, 0.26)), MAT.book(Math.floor(rng.range(0, 5))), at(x + bw / 2, y + 0.015 + bh / 2, 0, 0, 0, rng.chance(0.1) ? 0.2 : 0));
        x += bw + 0.004;
      }
    }
    pb.solid(-w / 2, 0, -d / 2, w / 2, h, d / 2, 'metal');
  },

  security_monitor(p, rng, m, pb) {
    const id = strParam(p, 'id', 'cam');
    let feed = strParam(p, 'feed', 'live');
    const camLabel = strParam(p, 'camera', 'CAM 07  LAB B CORRIDOR');
    pb.add(rounded(1.8, 0.78, 0.7, 0.03), m.paintDark, at(0, 0.39, 0));
    pb.add(rounded(1.9, 0.05, 0.8, 0.015), m.steel, at(0, 0.8, -0.02));
    pb.add(rounded(0.6, 0.03, 0.22, 0.01), m.rubber, at(-0.3, 0.84, -0.2));
    pb.add(slab(1.8, 1.0, 0.12), m.paintDark, at(0, 1.4, 0.3));
    const small = [glow('cctv-a', 0x6f8c96, 0.6), glow('cctv-b', 0x4f6670, 0.5)];
    for (const [i, [x, y]] of ([[-0.62, 1.66], [-0.62, 1.16], [0.62, 1.66], [0.62, 1.16]] as const).entries()) {
      pb.add(rounded(0.5, 0.36, 0.06, 0.01), m.steel, at(x, y, 0.22));
      pb.add(slab(0.44, 0.3, 0.005), small[i % 2]!, at(x, y, 0.188));
    }
    const screen = new CanvasScreen(320, 240, (ctx, t, w, h) => drawCameraFeed(ctx, t, w, h, feed, camLabel), 1.3, 8);
    const main = screenPlane(screen.material, 0.66, 0.5, 0, 1.4, 0.2);
    main.name = `feed:${id}`;
    main.userData.feed = id;
    pb.dynamic(main);
    pb.tick((t) => screen.update(t));
    pb.on('camera:feed', (e) => {
      const ev = e as { id?: string; state?: string } | undefined;
      if (ev?.id === id && typeof ev.state === 'string') feed = ev.state;
    });
    for (let i = 0; i < 6; i++) pb.add(slab(0.03, 0.012, 0.03), glow('cctv-led', 0x39ff9e, 2), at(0.2 + i * 0.07, 0.83, -0.25 + rng.range(-0.01, 0.01)));
    pb.solid(-0.95, 0, -0.42, 0.95, 1.95, 0.38, 'metal');
  },

  // ---------------------------------------------------------------- walls: boards, posters, maps

  notice_board(p, rng, m, pb) {
    const w = numParam(p, 'width', 1.4);
    const h = 0.9;
    const y = 1.55;
    pb.add(rounded(w + 0.08, h + 0.08, 0.04, 0.01), MAT.woodDark(), at(0, y, -0.02));
    pb.add(slab(w, h, 0.02), MAT.cork(), at(0, y, -0.045));
    const pm = [MAT.paper(), MAT.paperBlue(), MAT.paperPink(), MAT.paper()];
    for (let i = 0; i < 7; i++) {
      const pw = rng.range(0.14, 0.24);
      pb.add(slab(pw, pw * 1.3, 0.003), rng.pick(pm), at(rng.range(-w / 2 + 0.15, w / 2 - 0.15), y + rng.range(-0.28, 0.28), -0.058, 0, 0, rng.range(-0.15, 0.15)));
    }
    const text = strParam(p, 'text', 'QUARANTINE NOTICE');
    const notice = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.56), noticeMat(text, strParam(p, 'detail', 'LAB B - ROUTINE')));
    notice.position.set(-w / 2 + 0.32, y + 0.05, -0.062);
    notice.rotation.set(0, PI, 0.03);
    pb.dynamic(notice);
    pb.add(new THREE.SphereGeometry(0.012, 6, 4), m.hazard, at(-w / 2 + 0.32, y + 0.31, -0.065));
    pb.solid(-w / 2 - 0.04, y - h / 2, -0.07, w / 2 + 0.04, y + h / 2, 0);
  },

  tag_poster(p, _rng, m, pb) {
    const w = numParam(p, 'width', 0.9);
    const h = w * 1.4;
    const y = numParam(p, 'y', 1.6);
    pb.add(rounded(w + 0.06, h + 0.06, 0.03, 0.008), m.steel, at(0, y, -0.015));
    const poster = screenPlane(posterMat(strParam(p, 'slogan', 'DEEPER. FURTHER. TOGETHER.')), w, h, 0, y, -0.032);
    pb.dynamic(poster);
  },

  map_station(p, _rng, m, pb) {
    const area = strParam(p, 'area', 'STATION');
    pb.add(rounded(0.9, 1.1, 0.12, 0.02), m.paintDark, at(0, 1.45, -0.06));
    pb.add(rounded(0.96, 0.1, 0.18, 0.02), m.steel, at(0, 2.05, -0.09));
    pb.add(slab(0.8, 0.02, 0.05), glow('map-strip', 0x4fd6d0, 2), at(0, 2.0, -0.17));
    const screen = new CanvasScreen(256, 320, (ctx, t, w, h) => drawMapStation(ctx, t, w, h, area), 1.4, 4);
    pb.dynamic(screenPlane(screen.material, 0.7, 0.875, 0, 1.45, -0.125));
    pb.tick((t) => screen.update(t));
    pb.solid(-0.48, 0.9, -0.2, 0.48, 2.1, 0);
  },

  // ---------------------------------------------------------------- action half

  valve_wheel(p, _rng, m, pb) {
    const id = strParam(p, 'id', 'valve');
    const y = numParam(p, 'y', 1.3);
    const r = numParam(p, 'radius', 0.42);
    pb.add(cylinderBetween(V(0, y, 0), V(0, y, -0.35), 0.12, 14), m.paintDark);
    for (const z of [-0.05, -0.3]) pb.add(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 16), m.steel, at(0, y, z, PI / 2, 0, 0));
    pb.add(pipe([V(0, y, -0.05), V(0, y + 0.6, -0.05), V(0, 3.2, 0)], 0.1, 1, 12), m.paintTeal);
    pb.add(pipe([V(0, y, -0.05), V(0, 0.4, -0.05), V(0.3, 0, 0)], 0.1, 1, 12), m.paintTeal);
    // Gauge beside it.
    pb.add(new THREE.CylinderGeometry(0.12, 0.12, 0.05, 18), m.steel, at(0.55, y + 0.35, -0.04, PI / 2, 0, 0));
    pb.add(new THREE.CircleGeometry(0.1, 18), MAT.paper(), at(0.55, y + 0.35, -0.066, 0, PI, 0));
    const needle = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.085, 0.004), m.hazard);
    needle.geometry.translate(0, 0.04, 0);
    needle.position.set(0.55, y + 0.35, -0.07);
    needle.rotation.z = 2.2;
    const wheel = new THREE.Group();
    const wb = new AoMergeBuilder();
    wb.add(new THREE.TorusGeometry(r, 0.035, 10, 36), m.hazard);
    for (let k = 0; k < 3; k++) wb.add(slab(r * 2, 0.04, 0.03), m.steel, at(0, 0, 0, 0, 0, (k * PI) / 3));
    wb.add(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 12), m.steel, at(0, 0, 0, PI / 2, 0, 0));
    wheel.add(wb.build(`valve:${id}`, null));
    wheel.position.set(0, y, -0.4);
    const root = new THREE.Group();
    root.add(wheel, needle);
    pb.dynamic(root);
    let spin = 0;
    let turned = 0;
    pb.tick((_t, dt) => {
      if (spin <= 0) return;
      const step = Math.min(spin, dt * 4.2);
      spin -= step;
      turned += step;
      wheel.rotation.z -= step;
      needle.rotation.z = 2.2 - Math.min(1, turned / (PI * 4)) * 4.2;
    });
    pb.on(`valve:${id}`, () => {
      spin += PI * 4;
    });
    pb.on(`valve:${id}_reset`, () => {
      turned = 0;
      needle.rotation.z = 2.2;
    });
    pb.solid(-r, y - r, -0.5, r, y + r, 0);
  },

  console_bank(p, _rng, m, pb) {
    const w = numParam(p, 'width', 3);
    const mode = strParam(p, 'mode', 'control');
    pb.add(rounded(w, 0.85, 0.75, 0.03), m.paintDark, at(0, 0.425, 0));
    pb.add(rounded(w + 0.1, 0.05, 0.9, 0.015), m.steel, at(0, 0.875, -0.05));
    for (let i = 0; i < Math.floor(w / 0.5); i++) pb.add(slab(0.03, 0.012, 0.03), glow('bank-amber', 0xffa21a, 2.2), at(-w / 2 + 0.25 + i * 0.5, 0.906, -0.25));
    pb.add(rounded(w - 0.2, 0.04, 0.28, 0.01), m.rubber, at(0, 0.92, -0.18));
    const screen = new CanvasScreen(1024, 192, (ctx, t, cw, ch) => drawBank(ctx, t, cw, ch, mode), 1.3, 6);
    pb.add(rounded(w - 0.1, 0.6, 0.1, 0.02), m.paintDark, at(0, 1.4, 0.28, 0.2, 0, 0));
    const disp = screenPlane(screen.material, w - 0.2, 0.5, 0, 1.4, 0.225);
    disp.rotation.x = 0.2;
    pb.dynamic(disp);
    pb.add(cylinderBetween(V(0, 0.9, 0.3), V(0, 1.12, 0.3), 0.04), m.steel);
    pb.tick((t) => screen.update(t));
    pb.solid(-w / 2, 0, -0.48, w / 2, 1.0, 0.4, 'metal');
  },

  armory_rack(p, _rng, m, pb) {
    const w = numParam(p, 'width', 2);
    pb.add(slab(w, 2.0, 0.08), m.grating, at(0, 1.1, 0.2));
    for (const x of [-w / 2, w / 2]) pb.add(slab(0.06, 2.2, 0.5), m.steel, at(x, 1.1, 0));
    pb.add(slab(w, 0.05, 0.5), m.steel, at(0, 0.5, 0));
    const empty = Math.round(numParam(p, 'empty', 1));
    const slots = Math.max(2, Math.floor(w / 0.35));
    for (let i = 0; i < slots; i++) {
      const x = -w / 2 + 0.2 + i * ((w - 0.4) / (slots - 1));
      pb.add(slab(0.08, 0.06, 0.12), m.rubber, at(x, 1.85, 0.1));
      pb.add(slab(0.08, 0.06, 0.12), m.rubber, at(x, 0.62, 0.1));
      if (i < empty) continue;
      pb.add(slab(0.05, 1.05, 0.12), m.black, at(x, 1.2, 0.06));
      pb.add(slab(0.06, 0.25, 0.18), m.paintDark, at(x, 0.85, 0.04));
    }
    for (let i = 0; i < 3; i++) pb.add(rounded(0.3, 0.18, 0.22, 0.01), m.paintTeal, at(-w / 2 + 0.3 + i * 0.36, 0.09, -0.05));
    pb.add(slab(0.6, 0.12, 0.02), stencilMat('ARMORY - SEC 07'), at(0, 2.3, 0.15));
    pb.solid(-w / 2, 0, -0.27, w / 2, 2.2, 0.27, 'metal');
  },

  dining_table(p, rng, m, pb) {
    const w = numParam(p, 'width', 1.8);
    const d = 0.9;
    pb.add(rounded(w, 0.05, d, 0.015), MAT.woodLight(), at(0, 0.74, 0));
    for (const x of [-w / 2 + 0.25, w / 2 - 0.25]) {
      pb.add(cylinderBetween(V(x, 0.02, 0), V(x, 0.72, 0), 0.05, 10), m.steel);
      pb.add(rounded(0.5, 0.03, 0.5, 0.01), m.steel, at(x, 0.015, 0));
    }
    const seats = Math.round(numParam(p, 'seats', 4));
    for (let i = 0; i < seats; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const k = Math.floor(i / 2);
      const per = Math.ceil(seats / 2);
      const x = -w / 2 + (w / per) * (k + 0.5) + rng.range(-0.05, 0.05);
      const z = side * (d / 2 + 0.35) + rng.range(-0.04, 0.04);
      pb.add(new THREE.CylinderGeometry(0.19, 0.19, 0.06, 14), m.rubber, at(x, 0.46, z));
      pb.add(cylinderBetween(V(x, 0.02, z), V(x, 0.43, z), 0.03, 8), m.steel);
      pb.add(new THREE.CylinderGeometry(0.17, 0.2, 0.02, 14), m.steel, at(x, 0.01, z));
      pb.solid(x - 0.2, 0, z - 0.2, x + 0.2, 0.49, z + 0.2, 'rubber');
    }
    for (let i = 0; i < Math.round(numParam(p, 'mugs', 1)); i++) mugAt(pb, rng.pick([MAT.ceramic(), MAT.ceramicTeal()]), rng.range(-w / 2 + 0.2, w / 2 - 0.2), 0.765, rng.range(-0.3, 0.3), rng.range(0, 6));
    pb.solid(-w / 2, 0, -d / 2, w / 2, 0.77, d / 2, 'metal');
  },

  lab_bench(p, rng, m, pb) {
    const w = numParam(p, 'width', 2.4);
    pb.add(rounded(w, 0.05, 0.75, 0.01), MAT.stone(), at(0, 0.9, 0));
    pb.add(slab(w - 0.04, 0.86, 0.68), m.paintBone, at(0, 0.44, 0.02));
    pb.add(slab(w, 0.7, 0.03), m.paintBone, at(0, 1.45, 0.36));
    pb.add(slab(w, 0.03, 0.3), m.steel, at(0, 1.6, 0.22));
    const glassy = [MAT.ceramic(), MAT.ceramicTeal(), MAT.plastic()];
    for (let i = 0; i < 7; i++) {
      const x = rng.range(-w / 2 + 0.2, w / 2 - 0.2);
      const r = rng.range(0.03, 0.06);
      const h = rng.range(0.08, 0.22);
      pb.add(lathe([[0, 0], [r, 0], [r, h], [r * 0.5, h + 0.03], [0, h + 0.03]], 12), rng.pick(glassy), at(x, 0.925, rng.range(-0.25, 0.1)));
    }
    // A microscope-ish instrument and a sample rack.
    pb.add(rounded(0.3, 0.06, 0.3, 0.01), m.paintDark, at(-w / 4, 0.955, 0));
    pb.add(cylinderBetween(V(-w / 4, 0.98, 0.08), V(-w / 4, 1.3, 0.0), 0.035, 10), m.paintDark);
    pb.add(cylinderBetween(V(-w / 4, 1.25, 0.0), V(-w / 4, 1.18, -0.12), 0.03, 10), m.black);
    pb.add(rounded(0.4, 0.08, 0.14, 0.01), m.steel, at(w / 4, 0.965, 0.1));
    for (let i = 0; i < 6; i++) pb.add(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 8), rng.pick([MAT.ceramicRed(), MAT.leafLight(), MAT.ceramicTeal()]), at(w / 4 - 0.15 + i * 0.06, 1.02, 0.1));
    pb.solid(-w / 2, 0, -0.38, w / 2, 0.93, 0.38, 'metal');
  },

  storage_shelf(p, rng, m, pb) {
    const w = numParam(p, 'width', 2);
    const h = 2.1;
    const d = 0.55;
    for (const x of [-w / 2 + 0.03, w / 2 - 0.03]) for (const z of [-d / 2 + 0.03, d / 2 - 0.03]) pb.add(slab(0.05, h, 0.05), m.steel, at(x, h / 2, z));
    const mats = [m.paintTeal, m.paintBone, MAT.plastic(), MAT.cork()];
    for (let s = 0; s < 4; s++) {
      const y = 0.12 + s * 0.62;
      pb.add(slab(w, 0.03, d), m.grating, at(0, y, 0));
      let x = -w / 2 + 0.1;
      while (x < w / 2 - 0.3) {
        const bw = rng.range(0.25, 0.5);
        if (rng.chance(0.75)) pb.add(rounded(bw, rng.range(0.2, 0.4), d - 0.12, 0.01), rng.pick(mats), at(x + bw / 2, y + 0.015 + 0.15, 0, 0, rng.range(-0.08, 0.08), 0));
        x += bw + 0.05;
      }
    }
    pb.solid(-w / 2, 0, -d / 2, w / 2, h, d / 2, 'metal');
  },
};

// ------------------------------------------------------------------ canvas art

const stencilCache = new Map<string, THREE.MeshStandardMaterial>();
function stencilMat(text: string): THREE.MeshStandardMaterial {
  let mat = stencilCache.get(text);
  if (!mat) {
    mat = stencilDecal([{ text, size: 0.7, y: 0.78 }], 512, 128, '#d8d2c0', `slice-${text}`);
    stencilCache.set(text, mat);
  }
  return mat;
}

const noticeCache = new Map<string, THREE.MeshStandardMaterial>();
function noticeMat(title: string, detail: string): THREE.MeshStandardMaterial {
  const key = `${title}|${detail}`;
  let mat = noticeCache.get(key);
  if (!mat) {
    mat = paintedDecal(
      (ctx, w, h) => {
        ctx.fillStyle = '#ece6d4';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#b8231c';
        ctx.fillRect(0, 0, w, h * 0.16);
        ctx.fillStyle = '#f4efe2';
        ctx.font = `700 ${Math.round(h * 0.07)}px "Arial Narrow", Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(title, w / 2, h * 0.11);
        ctx.fillStyle = '#2a2a26';
        ctx.font = `700 ${Math.round(h * 0.055)}px Arial, sans-serif`;
        ctx.fillText(detail, w / 2, h * 0.26);
        ctx.font = `${Math.round(h * 0.03)}px Arial, sans-serif`;
        ctx.textAlign = 'left';
        const lines = ['Access to Lab B is restricted', 'until further notice. This is a', 'routine precaution. Report any', 'unusual symptoms to Medical.', '', 'Thank you for your cooperation.', '- Office of the Director'];
        lines.forEach((l, i) => ctx.fillText(l, w * 0.1, h * 0.36 + i * h * 0.05));
        drawTagMark(ctx, w * 0.82, h * 0.88, h * 0.06, { ink: '#2a2a26', accent: '#3f8f82' });
      },
      256,
      340,
      `notice-${key}`,
      false,
    );
    mat.transparent = false;
    noticeCache.set(key, mat);
  }
  return mat;
}

const posterCache = new Map<string, THREE.MeshStandardMaterial>();
function posterMat(slogan: string): THREE.MeshStandardMaterial {
  let mat = posterCache.get(slogan);
  if (!mat) {
    mat = paintedDecal(
      (ctx, w, h) => {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#0d2a33');
        g.addColorStop(1, '#03090c');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        // A stylised station silhouette rising from the deep.
        ctx.fillStyle = '#123c46';
        for (let i = 0; i < 9; i++) ctx.fillRect(w * 0.1 + i * w * 0.09, h * (0.62 - (i % 3) * 0.06), w * 0.06, h * 0.4);
        ctx.fillStyle = '#4fd6d0';
        for (let i = 0; i < 30; i++) ctx.fillRect(w * 0.12 + ((i * 37) % 80) * w * 0.0095, h * 0.66 + ((i * 53) % 25) * h * 0.01, 2, 2);
        drawTagLockup(ctx, w * 0.1, h * 0.08, w * 0.8);
        ctx.fillStyle = '#cfe8f0';
        ctx.font = `700 ${Math.round(w * 0.075)}px "Arial Narrow", Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(slogan, w / 2, h * 0.5);
        ctx.font = `${Math.round(w * 0.04)}px Arial, sans-serif`;
        ctx.fillText('THALASSA DEEP RESEARCH STATION', w / 2, h * 0.56);
      },
      360,
      504,
      `poster-${slogan}`,
      false,
    );
    mat.transparent = false;
    posterCache.set(slogan, mat);
  }
  return mat;
}

function drawBroadcast(ctx: CanvasRenderingContext2D, t: number, w: number, h: number, state: string, who: string): void {
  if (state === 'off') {
    ctx.fillStyle = '#020405';
    ctx.fillRect(0, 0, w, h);
    drawTagMark(ctx, w / 2, h / 2, h * 0.12, { ink: '#0d1f24', accent: '#0a1a1d' });
    return;
  }
  if (state === 'static') {
    for (let i = 0; i < 900; i++) {
      const v = Math.floor(Math.random() * 200);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 6, 3);
    }
    return;
  }
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#1d3b44');
  g.addColorStop(1, '#0a161a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  drawTagBanner(ctx, w * 0.06, h * 0.06, w * 0.4);
  // Presenter silhouette, gently moving as he talks.
  const bob = Math.sin(t * 2.3) * 2;
  ctx.fillStyle = '#c9b8a6';
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 0.38 + bob, h * 0.1, h * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#23262c';
  ctx.beginPath();
  ctx.moveTo(w * 0.3, h);
  ctx.quadraticCurveTo(w * 0.32, h * 0.58, w * 0.5, h * 0.55 + bob);
  ctx.quadraticCurveTo(w * 0.68, h * 0.58, w * 0.7, h);
  ctx.fill();
  ctx.fillStyle = '#e6e9ea';
  ctx.fillRect(w * 0.49, h * 0.58 + bob, w * 0.02, h * 0.2);
  // Lower third.
  ctx.fillStyle = 'rgba(4,12,14,0.85)';
  ctx.fillRect(0, h * 0.76, w, h * 0.24);
  ctx.fillStyle = '#4fd6d0';
  ctx.fillRect(0, h * 0.76, w * 0.012, h * 0.24);
  ctx.font = `600 ${Math.round(h * 0.07)}px ${SCREEN_FONT}`;
  ctx.fillStyle = '#e8f6f4';
  ctx.fillText(who === 'hale' ? 'DIRECTOR M. HALE' : who.toUpperCase(), w * 0.04, h * 0.85);
  ctx.font = `${Math.round(h * 0.05)}px ${SCREEN_FONT}`;
  ctx.fillStyle = '#9fd0c8';
  const ticker = 'STATION ANNOUNCEMENT  -  LAB B: ROUTINE QUARANTINE  -  NO ACTION REQUIRED  -  ';
  const off = (t * 60) % (ticker.length * h * 0.03);
  ctx.fillText(ticker + ticker, w * 0.04 - off, h * 0.94);
  if (Math.floor(t * 1.5) % 2 === 0) {
    ctx.fillStyle = '#ff3b2f';
    ctx.beginPath();
    ctx.arc(w * 0.9, h * 0.1, h * 0.022, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#e8f6f4';
  ctx.fillText('LIVE', w * 0.92, h * 0.115);
}

function drawCameraFeed(ctx: CanvasRenderingContext2D, t: number, w: number, h: number, state: string, label: string): void {
  if (state === 'static') {
    for (let i = 0; i < 500; i++) {
      const v = Math.floor(Math.random() * 180);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 4, 2);
    }
    return;
  }
  // A grainy corridor in perspective.
  ctx.fillStyle = '#0b1210';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#3d5a50';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const [x0, y0] of [[0, 0], [w, 0], [0, h], [w, h]] as const) {
    ctx.moveTo(x0, y0);
    ctx.lineTo(w * 0.5 + (x0 ? 30 : -30), h * 0.45 + (y0 ? 26 : -26));
  }
  ctx.rect(w * 0.5 - 30, h * 0.45 - 26, 60, 52);
  ctx.stroke();
  ctx.fillStyle = '#1c2a25';
  ctx.fillRect(w * 0.5 - 28, h * 0.45 - 24, 56, 48);
  if (state === 'figure') {
    // Someone standing very still, facing the far wall.
    ctx.fillStyle = '#050807';
    ctx.fillRect(w * 0.5 - 6, h * 0.45 - 14, 12, 34);
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.45 - 18, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 160; i++) {
    const v = 40 + Math.floor(Math.random() * 60);
    ctx.fillStyle = `rgba(${v},${v + 20},${v},0.35)`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 2, 1);
  }
  ctx.font = `14px ${SCREEN_FONT}`;
  ctx.fillStyle = '#cfe8d8';
  ctx.fillText(label, 10, 20);
  const s = Math.floor(t) % 60;
  ctx.fillText(`06:5${Math.floor(t / 60) % 10}:${s < 10 ? '0' : ''}${s}`, w - 90, h - 12);
  if (Math.floor(t * 2) % 2 === 0) {
    ctx.fillStyle = '#ff3b2f';
    ctx.fillText('REC', w - 46, 20);
  }
}

function drawMapStation(ctx: CanvasRenderingContext2D, t: number, w: number, h: number, area: string): void {
  ctx.fillStyle = '#02090b';
  ctx.fillRect(0, 0, w, h);
  ctx.font = `600 18px ${SCREEN_FONT}`;
  ctx.fillStyle = '#7fe3d0';
  ctx.fillText('STATION MAP', 14, 26);
  ctx.font = `14px ${SCREEN_FONT}`;
  ctx.fillText(area.toUpperCase(), 14, 46);
  ctx.strokeStyle = '#3f8f82';
  ctx.lineWidth = 2;
  const boxes: Array<[number, number, number, number]> = [[30, 80, 80, 60], [130, 80, 90, 100], [40, 160, 70, 50], [120, 200, 100, 70], [50, 230, 50, 50]];
  for (const [x, y, bw, bh] of boxes) ctx.strokeRect(x, y, bw, bh);
  ctx.beginPath();
  ctx.moveTo(110, 110);
  ctx.lineTo(130, 110);
  ctx.moveTo(75, 140);
  ctx.lineTo(75, 160);
  ctx.moveTo(170, 180);
  ctx.lineTo(170, 200);
  ctx.stroke();
  if (Math.floor(t * 2) % 2 === 0) {
    ctx.fillStyle = '#ffb020';
    ctx.beginPath();
    ctx.arc(165, 130, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#ffb020';
  ctx.fillText('YOU ARE HERE', 14, h - 40);
  ctx.fillStyle = '#5fb8a8';
  ctx.fillText('[E] DOWNLOAD MAP', 14, h - 16);
}

function drawBank(ctx: CanvasRenderingContext2D, t: number, w: number, h: number, mode: string): void {
  ctx.fillStyle = '#020a0c';
  ctx.fillRect(0, 0, w, h);
  const panels = 3;
  const pw = w / panels;
  ctx.font = `600 18px ${SCREEN_FONT}`;
  for (let i = 0; i < panels; i++) {
    const x = i * pw;
    ctx.strokeStyle = '#1f4a44';
    ctx.strokeRect(x + 6, 6, pw - 12, h - 12);
    ctx.fillStyle = '#7fe3d0';
    const titles = mode === 'security' ? ['DOORS', 'CAMERAS', 'ALARMS'] : mode === 'lab' ? ['SAMPLES', 'CONTAINMENT', 'LOG'] : ['POWER', 'PRESSURE', 'LIFE SUPPORT'];
    ctx.fillText(titles[i]!, x + 18, 32);
    ctx.strokeStyle = '#5fb8a8';
    ctx.beginPath();
    for (let k = 0; k < pw - 40; k += 4) {
      const y = h * 0.62 + Math.sin(k * 0.05 + t * (1 + i * 0.4)) * 22 * Math.sin(t * 0.3 + i);
      if (k === 0) ctx.moveTo(x + 20 + k, y);
      else ctx.lineTo(x + 20 + k, y);
    }
    ctx.stroke();
  }
}

// ------------------------------------------------------------------ structure pieces

const HALF = 2;

function wallBack(pb: PieceBuilder, m: Materials, h: number): THREE.Matrix4 {
  const f = wallFrame(0, -HALF + WALL_T, 0);
  pb.add(slab(4, h + 0.1, WALL_T), m.paintDark, inFrame(f, 0, h / 2 - 0.05, -WALL_T / 2));
  pb.solid(-HALF, 0, -HALF, HALF, h, -HALF + WALL_T);
  return f;
}

const STRUCT: Record<string, (p: PieceParams, rng: Rng, m: Materials, pb: PieceBuilder) => void> = {
  /** Office carpet over the deck; soft footsteps. */
  floor_carpet(_p, _rng, m, pb) {
    pb.add(slab(4, 0.1, 4), m.paintDark, at(0, -0.17, 0));
    pb.add(slab(4, 0.08, 4, 2), MAT.carpet(), at(0, -0.04, 0));
    for (const s of [-1, 1]) {
      pb.add(slab(4, 0.081, 0.12), MAT.carpetBorder(), at(0, -0.04, s * 1.94));
      pb.add(slab(0.12, 0.081, 4), MAT.carpetBorder(), at(s * 1.94, -0.04, 0));
    }
    pb.solid(-2, -0.2, -2, 2, 0, 2, 'rubber');
    pb.nav(0, 0, 0);
  },

  /** Ceramic tiles (kitchen, medical, hydroponics wet floors). */
  floor_tiles(p, rng, m, pb) {
    const wet = boolParam(p, 'wet', false);
    pb.add(slab(4, 0.1, 4), m.paintDark, at(0, -0.17, 0));
    for (let i = 0; i < 4; i++) {
      for (let k = 0; k < 4; k++) {
        const mat = (i + k) % 2 === 0 ? MAT.tileWhite() : MAT.tileGrey();
        pb.add(slab(0.98, 0.08, 0.98), mat, at(-1.5 + i, -0.04, -1.5 + k));
      }
    }
    pb.add(slab(4, 0.07, 4), MAT.grout(), at(0, -0.045, 0));
    if (wet) {
      const puddle = cached('puddle', () => new THREE.MeshStandardMaterial({ color: 0x0a1416, roughness: 0.02, metalness: 0.2, transparent: true, opacity: 0.55, depthWrite: false }));
      for (let i = 0; i < 2; i++) {
        const g = new THREE.CircleGeometry(rng.range(0.3, 0.7), 14);
        g.scale(1, rng.range(0.5, 1), 1);
        pb.add(g, puddle, at(rng.range(-1.2, 1.2), 0.003, rng.range(-1.2, 1.2), -PI / 2, 0, rng.range(0, PI)));
      }
    }
    pb.solid(-2, -0.2, -2, 2, 0, 2, 'metal');
    pb.nav(0, 0, 0);
  },

  /** Warm wood panelling (admin office). */
  wall_wood(p, rng, m, pb) {
    const h = numParam(p, 'height', 3.2);
    const f = wallBack(pb, m, h);
    pb.add(slab(4, 0.14, 0.04), MAT.woodDark(), inFrame(f, 0, 0.07, 0.02));
    pb.add(slab(4, 0.06, 0.05), MAT.woodDark(), inFrame(f, 0, Math.min(2.6, h - 0.3), 0.025));
    for (let i = 0; i < 4; i++) {
      const x = -1.5 + i;
      const mat = rng.chance(0.5) ? MAT.wood() : MAT.woodLight();
      pb.add(rounded(0.96, Math.min(2.6, h - 0.3) - 0.24, 0.03, 0.006), mat, inFrame(f, x, (Math.min(2.6, h - 0.3) + 0.14) / 2, 0.015));
    }
    if (h > 2.95) pb.add(slab(4, h - 2.66, 0.02), m.paintBone, inFrame(f, 0, (h + 2.66) / 2, 0.01));
  },

  /** White tile wall (kitchen, medical). */
  wall_tiles(p, _rng, m, pb) {
    const h = numParam(p, 'height', 3.2);
    const f = wallBack(pb, m, h);
    pb.add(slab(4, Math.min(2.4, h), 0.02), MAT.tileWhite(), inFrame(f, 0, Math.min(2.4, h) / 2, 0.01));
    for (let y = 0.3; y < Math.min(2.4, h); y += 0.3) pb.add(slab(4, 0.008, 0.024), MAT.grout(), inFrame(f, 0, y, 0.01));
    for (let x = -1.7; x < 2; x += 0.3) pb.add(slab(0.008, Math.min(2.4, h), 0.024), MAT.grout(), inFrame(f, x, Math.min(2.4, h) / 2, 0.01));
    pb.add(slab(4, 0.06, 0.05), m.steel, inFrame(f, 0, Math.min(2.4, h) + 0.03, 0.025));
  },

  /** Hydroponics wall: panel wall with a condensation-streaked green glass grow window. */
  wall_greenhouse(p, rng, m, pb) {
    const h = numParam(p, 'height', 3.2);
    const f = wallFrame(0, -HALF + WALL_T, 0);
    panelWall(pb, m, rng, f, { length: 4, height: h, depth: WALL_T, pilaster: true, cables: false });
    pb.add(rounded(2.4, 1.2, 0.06, 0.02), m.steel, inFrame(f, 0, 1.6, 0.03));
    pb.add(slab(2.2, 1.0, 0.02), glow('greenhouse', 0x3a8a4a, 0.8), inFrame(f, 0, 1.6, 0.065));
    const greens = [MAT.leaf(), MAT.leafLight()];
    for (let i = 0; i < 6; i++) pb.add(leafBlade(rng.range(0.3, 0.6), 0.12, 0.3), rng.pick(greens), inFrame(f, -0.9 + i * 0.36, 1.1, 0.09, 0.1, 0, rng.range(-0.3, 0.3)));
    pb.solid(-HALF, 0, -HALF, HALF, h, -HALF + WALL_T);
  },

  /** A floor tile with the dive bay's moon pool cut in it, railed so nobody falls in. */
  floor_moonpool(_p, _rng, m, pb) {
    const hole = 2.4;
    const rim = (4 - hole) / 2;
    for (const s of [-1, 1]) {
      pb.add(slab(4, 0.1, rim), m.diamond, at(0, -0.05, s * (hole / 2 + rim / 2)));
      pb.add(slab(rim, 0.1, hole), m.diamond, at(s * (hole / 2 + rim / 2), -0.05, 0));
      pb.solid(-2, -0.2, s > 0 ? hole / 2 : -2, 2, 0, s > 0 ? 2 : -hole / 2, 'grate');
      pb.solid(s > 0 ? hole / 2 : -2, -0.2, -hole / 2, s > 0 ? 2 : -hole / 2, 0, hole / 2, 'grate');
      // Shaft walls and hazard lip.
      pb.add(slab(hole, 3, 0.1), m.paintDark, at(0, -1.6, s * (hole / 2 + 0.05)));
      pb.add(slab(0.1, 3, hole), m.paintDark, at(s * (hole / 2 + 0.05), -1.6, 0));
      pb.add(slab(hole + 0.2, 0.02, 0.12), m.hazard, at(0, 0.005, s * (hole / 2 + 0.06)));
      pb.add(slab(0.12, 0.02, hole), m.hazard, at(s * (hole / 2 + 0.06), 0.005, 0));
    }
    // Railing (colliders keep bodies out of the water).
    const r = hole / 2 + 0.25;
    for (const [x, z] of [[-r, -r], [r, -r], [r, r], [-r, r]] as const) pb.add(cylinderBetween(V(x, 0, z), V(x, 1.05, z), 0.03, 8), m.steel);
    for (const y of [0.55, 1.05]) {
      for (const s of [-1, 1]) {
        pb.add(cylinderBetween(V(-r, y, s * r), V(r, y, s * r), 0.022, 8), m.hazard);
        pb.add(cylinderBetween(V(s * r, y, -r), V(s * r, y, r), 0.022, 8), m.hazard);
      }
    }
    for (const s of [-1, 1]) {
      pb.solid(-r - 0.05, 0, s * r - 0.05, r + 0.05, 1.1, s * r + 0.05);
      pb.solid(s * r - 0.05, 0, -r - 0.05, s * r + 0.05, 1.1, r + 0.05);
    }
    // The water and a cold glow from below.
    pb.add(slab(hole, 0.02, hole), glow('moonpool-deep', 0x1d8fa0, 0.6), at(0, -2.8, 0));
    const water = new THREE.Mesh(new THREE.PlaneGeometry(hole, hole), waterMaterial());
    water.rotation.x = -PI / 2;
    water.position.y = -0.55;
    water.renderOrder = 2;
    pb.dynamic(water);
    pb.tick((t) => {
      waterUniforms.uTime.value = t;
    });
    for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [1.6, 1.6], [-1.6, 1.6]] as const) pb.nav(x, 0, z);
  },
};

// ------------------------------------------------------------------ definitions

function def(id: string, family: 'prop' | 'structure', gen: Gen): PieceDef {
  return {
    id,
    family,
    footprint: family === 'prop' ? [0, 0] : [1, 1],
    generate(params: PieceParams, rng: Rng, m: Materials): PieceOutput {
      const pb = new PieceBuilder();
      gen(params, rng, m, pb);
      return pb.build();
    },
  };
}

export const SLICE_PROPS: PieceDef[] = Object.entries(GEN).map(([id, gen]) => def(id, 'prop', gen));
export const SLICE_STRUCTURE: PieceDef[] = Object.entries(STRUCT).map(([id, gen]) => def(id, 'structure', gen));
