import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Rng } from '../../core/rng.ts';
import { fixtureMaterial, type Materials } from '../../render/materials.ts';
import { CanvasScreen, SCREEN_FONT } from '../../render/screens.ts';
import { mouthCues, mouthOpenAt, type MouthCue } from '../../actors/speechActing.ts';
import type { SpeechInfo } from '../../dialogue/speech.ts';
import { paintedDecal, stencilDecal } from '../../render/decals.ts';
import { drawTagBanner, drawTagLockup, drawTagMark } from '../../render/logo.ts';
import { NOISE_GLSL } from '../../render/fx/glsl.ts';
import { createShaft } from '../../render/fx/shafts.ts';
import { SUB_RADIUS, SUB_SAIL_TOP, SUB_LENGTH, SUB_SCALE, createSubModel } from '../../render/fx/subModel.ts';
import { createBeamConeGeometry, createExteriorBeamMaterial } from '../../render/fx/exterior.ts';
import { exteriorize } from '../../render/fx/exteriorLight.ts';
import { at, cylinderBetween, pipe, rounded } from './geom.ts';
import { PA_GRILLE_Y, PA_GRILLE_Z } from '../paSpeakers.ts';
import { lathe, slab } from './shapes.ts';
import { inFrame, panelWall, wallFrame } from './detail.ts';
import { AoMergeBuilder } from './merge.ts';
import { TILE_FLOOR_KEYS, paletteFor, resolvePalette } from './palettes.ts';
import { evaluateMisterCycle } from './misterCycle.ts';
import { MOONPOOL_WIDTH, PieceBuilder, TRUNK_DEPTH, WALL_T, boolParam, newJolt, numParam, strParam, swingAngle, type PieceDef, type PieceOutput, type PieceParams, type SoundLoopSlot } from './types.ts';

/**
 * Slice-01 kit additions (ADR-0014, ADR-0023, intro-sequence spec): the kitchen, the supply sub, the
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
 *   cctv_wall      `camera:feed` { id, state } (its live tile)
 *   metal_detector `detector:scan` { id, result: pass|alarm }
 *   glass_cracks   `glass:set` { id, state: intact|cracked|shattered }
 *   glass_blood    `glass:blood` { id, level: 0..3 }
 *   ceiling_vent   `ventGrate:set` { id, state: closed|open|fallen, instant? } (`ventState` step)
 *   fluid_trail    `reveal:trail`
 */

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const PI = Math.PI;

/** Metal detector light bar colours (dock-checkpoint). */
export const DETECTOR_IDLE = 0x8a5a1a;
export const DETECTOR_PASS = 0x39ff9e;
export const DETECTOR_ALARM = 0xff2a1f;

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
/** A flat paint colour. Opts into flat-colour merging (kit/merge.ts): it shares a roughness bucket's draw call. */
const plain = (key: string, color: number, roughness = 0.8, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial =>
  cached(key, () => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    m.userData['flat'] = true;
    return m;
  });
/** A non-animated glow. Opts into static-glow merging (kit/merge.ts): every glow in a room shares one draw call. */
const glow = (key: string, color: number, intensity: number): THREE.MeshStandardMaterial =>
  cached(`glow-${key}`, () => {
    const m = fixtureMaterial(color, intensity);
    m.userData['glow'] = true;
    return m;
  });

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
  foodStew: () => plain('foodStew', 0x6e3a1a, 0.5),
  foodGreens: () => plain('foodGreens', 0x3f6b25, 0.6),
  foodRice: () => plain('foodRice', 0xd9cfa6, 0.85),
  foodSauce: () => plain('foodSauce', 0x8e2a18, 0.35),
  foodPotato: () => plain('foodPotato', 0xc4a05a, 0.7),
  juiceOrange: () => plain('juiceOrange', 0xe07a1f, 0.2),
  juiceGreen: () => plain('juiceGreen', 0x8fbf3a, 0.2),
  waterJug: () => plain('waterJug', 0x8fc3d9, 0.2),
  rugTeal: () => plain('rugTeal', 0x23474b, 0.97),
  rugWarm: () => plain('rugWarm', 0x5a3b2c, 0.97),
  rugStripe: () => plain('rugStripe', 0xb89a5a, 0.95),
  tealGloss: () => plain('tealGloss', 0x2a6466, 0.45),
  shade: () => plain('shade', 0x1f2a2c, 0.5, 0, { side: THREE.DoubleSide }),
  shadeBrass: () => plain('shadeBrass', 0x8f7144, 0.35, 0.5, { side: THREE.DoubleSide }),
  deskPanel: () => plain('deskPanel', 0xd6d2c8, 0.55),
  deskDark: () => plain('deskDark', 0x202429, 0.45, 0.1),
  wallPlaster: () => plain('wallPlaster', 0xd8d3c8, 0.88),
  tomato: () => plain('tomato', 0xc92a22, 0.3),
  tomatoWarm: () => plain('tomatoWarm', 0xd96228, 0.35),
  trayWhite: () => plain('trayWhite', 0xe2e6e0, 0.38),
  tankPoly: () => plain('tankPoly', 0xcfdad6, 0.32),
  tankBlue: () => plain('tankBlue', 0x266c80, 0.25),
  tankAmber: () => plain('tankAmber', 0xb88022, 0.25),
  cotOlive: () => plain('cotOlive', 0x4b5748, 0.92),
  blanketNavy: () => plain('blanketNavy', 0x2a3b4e, 0.95),
  sackBurlap: () => plain('sackBurlap', 0xa68d68, 0.94),
  labCoat: () => plain('labCoat', 0xeceee8, 0.85),
  cardiganKnit: () => plain('cardiganKnit', 0x5b7a72, 0.97),
  bootYellow: () => plain('bootYellow', 0xc49520, 0.45),
  ductLight: () => plain('ductLight', 0x8e999e, 0.45, 0.5),
  book: (i: number) => plain(`book${i}`, [0x6b2a22, 0x22405a, 0x2f4a2a, 0x8a7a50, 0x3a2a4a][i % 5]!, 0.8),
};

/** Deep-water surface for the moon pool; one shared material and clock. */
const waterUniforms = { uTime: { value: 0 }, uTint: { value: new THREE.Color(0x0b3b40) } };

/** Launch-trunk caustics (rebuild-dive-bay): soft moving light bands on the ceiling above the trunk, additive. */
const causticUniforms = { uTime: { value: 0 } };
function causticMaterial(): THREE.ShaderMaterial {
  // Not cached: `uGain` follows each trunk's own hatch.
  return new THREE.ShaderMaterial({
    uniforms: { uTime: causticUniforms.uTime, uGain: { value: 1 }, uColor: { value: new THREE.Color(0x58c8e0) } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uGain; uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv * 9.0;
        float t = uTime * 0.45;
        float c = 0.0;
        for (int i = 0; i < 3; i++) {
          p += vec2(sin(t + p.y * 1.3), cos(t * 0.8 + p.x * 1.1)) * 0.4;
          c += 1.0 / (1.0 + 22.0 * abs(sin(p.x) * sin(p.y)));
        }
        float fade = 1.0 - smoothstep(0.12, 0.5, length(vUv - 0.5));
        float a = pow(c / 3.0, 2.2) * fade * uGain * 0.55;
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
  });
}

/** Thin cold mist lying on the trunk's standing water: scrolled value noise, very faint. */
const trunkMistUniforms = { uTime: { value: 0 } };
function trunkMistMaterial(): THREE.ShaderMaterial {
  return cached(
    'trunk-mist',
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: trunkMistUniforms.uTime },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          varying vec2 vUv;
          ${NOISE_GLSL}
          void main() {
            vec2 p = vUv * 3.0 + vec2(uTime * 0.07, uTime * 0.03);
            float n = vnoise(p) * 0.6 + vnoise(p * 2.1 - uTime * 0.05) * 0.4;
            float edge = smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x) * smoothstep(0.0, 0.2, vUv.y) * smoothstep(1.0, 0.8, vUv.y);
            float a = smoothstep(0.4, 0.9, n) * edge * 0.32;
            if (a < 0.003) discard;
            gl_FragColor = vec4(0.72, 0.86, 0.9, a);
          }`,
      }),
  );
}
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

/** Lightweight GPU-driven rising steam wisps (Points, 0 CPU vertex uploads per frame). */
const STEAM_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uHeight;
  uniform float uPixelRatio;
  attribute vec3 aSeed; // x: phase, y: speed, z: size
  varying float vAlpha;

  void main() {
    float life = fract(aSeed.x + uTime * aSeed.y);
    vec3 p = position;
    p.y += life * uHeight;
    p.x += sin(uTime * 1.4 + aSeed.x * 29.0 + life * 5.0) * (0.02 + life * 0.06);
    p.z += cos(uTime * 1.1 + aSeed.x * 21.0 + life * 4.0) * (0.02 + life * 0.05);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float dist = max(0.8, -mv.z);
    vAlpha = smoothstep(0.0, 0.2, life) * smoothstep(1.0, 0.25, life) * smoothstep(16.0, 2.5, dist);
    gl_PointSize = clamp((aSeed.z * (0.65 + life * 1.1) * 260.0 * uPixelRatio) / dist, 3.0, 42.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const STEAM_FRAG = /* glsl */ `
  uniform float uOpacity;
  varying float vAlpha;

  void main() {
    float r = length(gl_PointCoord - 0.5);
    if (r > 0.5) discard;
    float puff = smoothstep(0.5, 0.0, r);
    gl_FragColor = vec4(vec3(0.95, 0.93, 0.89), puff * puff * vAlpha * uOpacity);
  }
`;

function steamPlume(
  pb: PieceBuilder,
  rng: Rng,
  o: { x?: number; y: number; z?: number; width: number; depth: number; height: number; count: number; opacity?: number; size?: number },
): void {
  const pos = new Float32Array(o.count * 3);
  const seed = new Float32Array(o.count * 3);
  const ox = o.x ?? 0;
  const oz = o.z ?? 0;
  const baseSize = o.size ?? 0.14;
  for (let i = 0; i < o.count; i++) {
    pos[i * 3] = ox + rng.range(-o.width / 2, o.width / 2);
    pos[i * 3 + 1] = o.y;
    pos[i * 3 + 2] = oz + rng.range(-o.depth / 2, o.depth / 2);
    seed[i * 3] = rng.range(0, 1);
    seed[i * 3 + 1] = rng.range(0.22, 0.42);
    seed[i * 3 + 2] = baseSize * rng.range(0.75, 1.3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
  const uTime = { value: 0 };
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime,
      uHeight: { value: o.height },
      uOpacity: { value: o.opacity ?? 0.18 },
      uPixelRatio: { value: typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1 },
    },
    vertexShader: STEAM_VERT,
    fragmentShader: STEAM_FRAG,
    transparent: true,
    depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.name = 'steam-plume';
  pts.userData['skipGtao'] = true;
  pts.frustumCulled = false;
  pts.renderOrder = 2;
  pb.dynamic(pts);
  pb.tick((t) => {
    uTime.value = t;
  });
}

/** GPU-driven pressurized downward mist spray cones beneath overhead hydroponics nozzles (0 CPU uploads/frame). */
const MISTER_CONE_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uSpray;
  uniform float uDrop;
  uniform float uPixelRatio;
  attribute vec4 aSeed; // x: phase, y: speed, z: angle, w: spreadFactor
  varying float vAlpha;
  varying float vLife;

  void main() {
    float life = fract(aSeed.x + uTime * aSeed.y);
    float spread = 0.015 + pow(life, 0.85) * 0.36 * aSeed.w;
    vec3 p = position;
    p.x += cos(aSeed.z) * spread + sin(uTime * 1.9 + aSeed.x * 23.0 + life * 4.0) * life * 0.04;
    p.z += sin(aSeed.z) * spread + cos(uTime * 1.6 + aSeed.x * 19.0 + life * 4.0) * life * 0.04;
    p.y -= life * uDrop;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float dist = max(0.7, -mv.z);
    vLife = life;
    vAlpha = uSpray * smoothstep(0.0, 0.14, life) * smoothstep(1.0, 0.32, life) * smoothstep(20.0, 2.0, dist);
    float size = mix(0.06, 0.30, life);
    gl_PointSize = clamp((size * 280.0 * uPixelRatio) / dist, 3.0, 60.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const MISTER_CONE_FRAG = /* glsl */ `
  uniform float uOpacity;
  varying float vAlpha;
  varying float vLife;

  void main() {
    if (vAlpha <= 0.002) discard;
    float r = length(gl_PointCoord - 0.5);
    if (r > 0.5) discard;
    float puff = smoothstep(0.5, 0.0, r);
    vec3 col = mix(vec3(0.95, 0.99, 1.0), vec3(0.86, 0.95, 0.98), vLife);
    gl_FragColor = vec4(col, pow(puff, 1.4) * vAlpha * uOpacity);
  }
`;

/** GPU-driven slow billowing vapor cloud that lingers and fades softly after the mister valve shuts. */
const MISTER_CLOUD_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uCloud;
  uniform float uDrop;
  uniform float uPixelRatio;
  attribute vec4 aSeed; // x: phase, y: speed, z: angle, w: sizeScale
  varying float vAlpha;

  void main() {
    float life = fract(aSeed.x + uTime * aSeed.y);
    float radial = 0.14 + life * 0.65;
    vec3 p = position;
    p.x += cos(aSeed.z + life * 1.1) * radial + sin(uTime * 0.75 + aSeed.x * 31.0) * (0.08 + life * 0.18);
    p.z += sin(aSeed.z + life * 0.9) * radial + cos(uTime * 0.65 + aSeed.x * 27.0) * (0.08 + life * 0.18);
    p.y -= 0.42 + life * uDrop;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float dist = max(0.8, -mv.z);
    vAlpha = uCloud * smoothstep(0.0, 0.2, life) * smoothstep(1.0, 0.22, life) * smoothstep(22.0, 2.2, dist);
    float size = (0.36 + life * 0.54) * aSeed.w;
    gl_PointSize = clamp((size * 280.0 * uPixelRatio) / dist, 5.0, 108.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const MISTER_CLOUD_FRAG = /* glsl */ `
  uniform float uOpacity;
  varying float vAlpha;

  void main() {
    if (vAlpha <= 0.002) discard;
    float r = length(gl_PointCoord - 0.5);
    if (r > 0.5) discard;
    float puff = smoothstep(0.5, 0.0, r);
    gl_FragColor = vec4(vec3(0.88, 0.96, 0.99), puff * puff * vAlpha * uOpacity);
  }
`;

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
  mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }); // seen from both sides of the glass (room-visibility)
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
  mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }); // seen from both sides of the glass (room-visibility)
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
  // ---------------------------------------------------------------- kitchen (intro-sequence spec)

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

  coffee_machine(_p, rng, m, pb) {
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
    steamPlume(pb, rng, { x: -0.02, y: 0.22, z: -0.18, width: 0.18, depth: 0.1, height: 0.34, count: 14, opacity: 0.17, size: 0.09 });
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

  // ---------------------------------------------------------------- the supply sub (intro-sequence spec)

  supply_sub(p, _rng, m, pb) {
    // Origin is the docked centre of the hull, outside the dock window. Long axis on X.
    const group = new THREE.Group();
    group.name = 'supply_sub';
    const mb = new AoMergeBuilder();
    // The GLB hull when preloaded (main.ts), else the original procedural one.
    const kilo = createSubModel();
    const L = kilo ? SUB_LENGTH : 9;
    const berthX = boolParam(p, 'alignBow', false) ? -L / 2 : 0;
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
      mb.add(slab(0.8, 0.5, 0.02), m.boltPanel, at(-0.6, 0.4, R + 0.01));
      group.add(mb.build('supply_sub:hull', null));
    }
    // Lights: headlamps, beams, running lights. Beams tilt down far enough to reach the seabed below R01.
    const LAMP_TILT = 0.36;
    const LAMP_OUTER = 0.25;
    const BEAM_LENGTH = 11.5 * K;
    const lamp = fixtureMaterial(0xfff1d0, 7);
    const red = fixtureMaterial(0xff2a1a, 3.5);
    const green = fixtureMaterial(0x2aff7a, 3.5);
    const beamMat = createExteriorBeamMaterial(1, 0.28);
    // Both headlamps in one mesh and both beams in another (draw calls).
    const heads: THREE.BufferGeometry[] = [];
    const beams: THREE.BufferGeometry[] = [];
    // Lamps sit on the bow flanks: slightly back on the tapered GLB bow, spaced so both twin beams read cleanly.
    const lampX = kilo ? L / 2 - 2.1 * K : L / 2 - 0.9;
    const lampY = kilo ? 0.15 * K : -0.35;
    const lampZ = kilo ? 0.68 * K : 0.75;
    for (const s of [-1, 1]) {
      const tilt = LAMP_TILT + s * 0.05;
      const yaw = s * 0.08;
      const dir = new THREE.Vector3(Math.cos(tilt) * Math.cos(yaw), -Math.sin(tilt), Math.cos(tilt) * Math.sin(yaw)).normalize();
      heads.push(new THREE.SphereGeometry(0.13 * K, 12, 8).translate(lampX, lampY, s * lampZ));
      const b = createBeamConeGeometry(Math.tan(LAMP_OUTER * 0.85) * BEAM_LENGTH, BEAM_LENGTH, 20, 4);
      b.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir));
      b.translate(lampX, lampY, s * lampZ);
      beams.push(b);
      // The same lamp lights the seabed (exterior-ocean spec, intro-sequence "Headlamps light the seabed").
      const marker = new THREE.Object3D();
      marker.name = 'exterior-lamp';
      marker.position.set(lampX, lampY, s * lampZ);
      marker.userData['exteriorLamp'] = { dir: [dir.x, dir.y, dir.z], color: 0xfff1d0, intensity: 48, range: 24, inner: 0.12, outer: LAMP_OUTER };
      group.add(marker);
    }
    const beamMesh = new THREE.Mesh(mergeGeometries(beams, false) ?? beams[0]!, beamMat);
    beamMesh.name = 'supply_sub:beams';
    beamMesh.renderOrder = 2;
    beamMesh.userData['skipGtao'] = true;
    group.add(new THREE.Mesh(mergeGeometries(heads, false) ?? heads[0]!, lamp), beamMesh);
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
        amb.add(rounded(0.7 * K, 0.3 * K, 0.4 * K, 0.05 * K), m.hazardClean, at(0, 2.9 * K, -s * 0.4 * K));
        amb.add(cylinderBetween(V(-0.25 * K, 0, 0), V(0.25 * K, 0, 0), 0.2 * K, 12), m.steel);
        arm.add(amb.build('supply_sub:arm', null));
        arms.push(arm);
        pb.add(rounded(0.6 * K, 1.4 * K, 0.6 * K, 0.04 * K), m.paintDark, at(berthX + x * K, -3.0 * K, -standoff + s * off)); // pylon under the hinge
      }
      pb.add(rounded(5.2 * K, 0.3 * K, 0.6 * K, 0.04 * K), m.paintDark, at(berthX, -2.45 * K, -standoff + s * off)); // plinth rail
    }
    pb.add(slab(0.5 * K, 0.3 * K, 2 * off), m.paintDark, at(berthX - 0.1 * K, -2.45 * K, -standoff)); // cross beam under the hull
    // Umbilical boom from the station-side arm to the station wall (5.15 m from the piece origin).
    const nearZ = -standoff + off;
    const boomLen = Math.max(0.5, 5.15 - nearZ);
    pb.add(slab(0.5 * K, 0.3 * K, boomLen), m.paintDark, at(berthX - 0.1 * K, -2.45 * K, nearZ + boomLen / 2));
    const root = new THREE.Group();
    root.position.x = berthX;
    exteriorize(group); // the hull is lit by lamps and fogged like the rest of the exterior
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
      beamMat.uniforms['uTime']!.value = t;
      const blink = Math.floor(t * 1.2) % 2 === 0;
      red.emissiveIntensity = blink ? 3.5 : 0.2;
      green.emissiveIntensity = blink ? 0.2 : 3.5;
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
    const channel = strParam(p, 'channel', '');
    const initial = strParam(p, 'state', 'off');
    let state = initial;
    let who = 'hale';
    // Hale's mouth on the feed follows his line: the same syllable cues his body uses in person (speechActing).
    let talk: { cues: MouthCue[]; start: number } | null = null;
    let now = 0;
    const draw = (ctx: CanvasRenderingContext2D, t: number, cw: number, ch: number): void => {
      if (state === 'on' && channel === 'boardroom') return drawBoardroomDeck(ctx, t, cw, ch);
      if (state === 'on' && channel === 'commons') return drawCommonsBoard(ctx, t, cw, ch);
      drawBroadcast(ctx, t, cw, ch, state, who, talk ? mouthOpenAt(talk.cues, t - talk.start) : 0);
    };
    const screen = new CanvasScreen(640, 360, draw, 1.4, channel === 'boardroom' || channel === 'commons' ? 4 : channel === 'briefing' ? 15 : 10);
    pb.add(rounded(w + 0.12, h + 0.12, 0.08, 0.02), m.paintDark, at(0, y, -0.04));
    pb.add(slab(0.3, 0.2, 0.06), m.steel, at(0, y, -0.01));
    const display = screenPlane(screen.material, w, h, 0, y, -0.082);
    display.name = `screen:${id}`;
    pb.dynamic(display);
    const apply = (s: unknown): void => {
      if (typeof s !== 'string') return;
      state = s;
      screen.material.emissiveIntensity = s === 'off' ? 0.25 : channel === 'boardroom' || channel === 'commons' ? 1.15 : 1.5;
    };
    apply(state);
    pb.tick((t) => {
      now = t;
      screen.update(t);
    });
    pb.on('screen:set', (e) => {
      const ev = e as { id?: string; state?: string } | undefined;
      if (ev?.id === id) apply(ev.state);
    });
    pb.on('level:reset', () => {
      talk = null;
      apply(initial);
    });
    if (channel === 'briefing') {
      pb.on('briefing:screen', (e) => {
        const ev = e as { state?: string; who?: string } | undefined;
        if (typeof ev?.who === 'string') who = ev.who;
        apply(ev?.state ?? 'on');
      });
      pb.on('speech:started', (e) => {
        const ev = e as Partial<SpeechInfo> | undefined;
        if (!ev || ev.speaker !== BROADCAST_SPEAKER[who] || typeof ev.text !== 'string' || typeof ev.duration !== 'number') return;
        talk = { cues: mouthCues(ev.text, ev.duration, ev.emote ?? null, ev.id ?? ev.text), start: now };
      });
      pb.on('speech:ended', (e) => {
        if ((e as { speaker?: string } | undefined)?.speaker === BROADCAST_SPEAKER[who]) talk = null;
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
   * A ceiling vent the Lab B creature uses (trim-lab-wing-encounters design D5). Origin on the floor; the framed grate
   * sits flush under the ceiling at `ceiling` m over a black duct mouth, `size` m square. `ventGrate:set` { id, state }:
   * `open` swings the grate down on its -X hinge and leaves it swaying; `fallen` tears it loose to drop to the floor,
   * bounce once and clatter (`grateClatter`). `instant` snaps to the state (restores, skips). No colliders: a fallen
   * grate is flat on the deck and walked over.
   */
  ceiling_vent(p, _rng, m, pb) {
    const s = numParam(p, 'size', 0.9);
    const ceiling = numParam(p, 'ceiling', 4);
    const id = strParam(p, 'id', 'vent');
    const y = ceiling - 0.012;
    // The frame and the duct mouth stay put.
    for (const dz of [-s / 2, s / 2]) pb.add(rounded(s + 0.1, 0.04, 0.05, 0.01), m.steel, at(0, y - 0.01, dz));
    for (const dx of [-s / 2, s / 2]) pb.add(rounded(0.05, 0.04, s, 0.01), m.steel, at(dx, y - 0.01, 0));
    pb.add(slab(s - 0.02, 0.004, s - 0.02), m.black, at(0, ceiling - 0.004, 0));
    // The grate swings about its hinge on the -X edge: the pivot sits there, the panel hangs off it toward +X.
    const pivot = new THREE.Group();
    pivot.name = 'vent-grate';
    pivot.position.set(-s / 2, y, 0);
    const panel = new THREE.Group();
    const part = (g: THREE.BufferGeometry, mat: THREE.Material, mx: THREE.Matrix4): THREE.Mesh => {
      const mesh = new THREE.Mesh(g, mat);
      mesh.applyMatrix4(mx);
      return mesh;
    };
    const slats = Math.round(s / 0.06);
    for (let i = 0; i <= slats; i++) {
      const z = -s / 2 + 0.03 + (i / slats) * (s - 0.06);
      panel.add(part(slab(s - 0.04, 0.012, 0.018), m.grating, at(s / 2, -0.012, z)));
    }
    for (const dz of [-s / 2 + 0.02, s / 2 - 0.02]) panel.add(part(slab(s - 0.02, 0.02, 0.03), m.steel, at(s / 2, -0.01, dz)));
    pivot.add(panel);
    pb.dynamic(pivot);
    type State = 'closed' | 'open' | 'fallen';
    let state: State = 'closed';
    let t = 0;
    let vy = 0;
    let landed = 0;
    const OPEN = (PI / 2) * 0.96;
    const reset = (): void => {
      pivot.position.set(-s / 2, y, 0);
      pivot.rotation.set(0, 0, 0);
      panel.position.set(0, 0, 0);
      panel.rotation.set(0, 0, 0);
    };
    const settle = (): void => {
      reset();
      if (state === 'open') pivot.rotation.z = -OPEN;
      if (state === 'fallen') {
        // Flat on the floor where it fell, a little skewed.
        pivot.position.set(-s / 2, 0.012, 0.05);
        panel.rotation.set(0, 0.35, 0);
      }
    };
    const set = (next: unknown, instant: boolean): void => {
      if (next !== 'closed' && next !== 'open' && next !== 'fallen') return;
      if (next === state && !instant) return;
      state = next;
      t = 0;
      vy = 0;
      landed = 0;
      if (instant || state === 'closed') settle();
    };
    pb.on('ventGrate:set', (e) => {
      const ev = e as { id?: string; state?: string; instant?: boolean } | undefined;
      if (ev?.id === id) set(ev.state, ev.instant === true);
    });
    pb.on('level:reset', () => set('closed', true));
    pb.tick((_time, dt) => {
      if (state === 'closed') return;
      t += dt;
      if (state === 'open') {
        // Swings down in 0.3 s, then sways on the hinge and settles.
        const swing = Math.min(1, t / 0.3);
        const sway = t > 0.3 ? Math.sin((t - 0.3) * 7) * 0.22 * Math.exp(-(t - 0.3) * 1.6) : 0;
        pivot.rotation.z = -(OPEN * swing * swing) + sway;
        return;
      }
      // Fallen: torn loose, it tips as it drops, hits the deck, bounces once, then lies flat.
      if (landed >= 2) return;
      vy -= 9.81 * dt;
      pivot.position.y += vy * dt;
      pivot.rotation.z = Math.max(-0.9, pivot.rotation.z - dt * 2.4) * (landed === 0 ? 1 : 0.4);
      if (pivot.position.y <= 0.012) {
        pivot.position.y = 0.012;
        if (landed === 0) pb.soundAt('grateClatter', [pivot.position.x + s / 2, 0.05, 0], { gain: 1 });
        landed++;
        vy = landed === 1 ? 1.1 : 0;
        if (landed >= 2) settle();
      }
    });
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
    const crop = strParam(p, 'crop', 'mixed');
    const pal = resolvePalette(p, m);
    const glowMat = light === 'white' ? glow('grow-white', 0xf6fff6, 2.2) : glow('grow-magenta', 0xff52dc, 2.0);
    const d = 0.64;
    const gap = 0.64;
    const totalH = tiers * gap + 0.36;
    const pipeMat = pal.pipeAccent;
    // Stainless uprights, foot pads, and end cross-braces.
    for (const x of [-L / 2 + 0.03, L / 2 - 0.03]) {
      for (const z of [-d / 2 + 0.03, d / 2 - 0.03]) {
        pb.add(slab(0.045, totalH, 0.045), m.steelBrushed, at(x, totalH / 2, z));
        pb.add(slab(0.09, 0.02, 0.09), m.steelDark, at(x, 0.01, z));
      }
      pb.add(slab(0.03, 0.04, d - 0.06), m.steelBrushed, at(x, 0.14, 0));
      pb.add(slab(0.03, 0.04, d - 0.06), m.steelBrushed, at(x, totalH - 0.04, 0));
    }
    const tomatoes = [MAT.tomato(), MAT.tomatoWarm()];
    for (let t = 0; t < tiers; t++) {
      const y = 0.32 + t * gap;
      // Food-grade white NFT grow trough + twin dark-substrate channels.
      pb.add(rounded(L - 0.02, 0.12, d - 0.06, 0.015), MAT.trayWhite(), at(0, y, 0));
      pb.add(slab(L - 0.08, 0.015, d - 0.14), MAT.soil(), at(0, y + 0.058, 0));
      const per = Math.max(3, Math.floor(L / 0.28));
      for (let i = 0; i < per; i++) {
        const x = -L / 2 + 0.12 + ((L - 0.24) / per) * (i + 0.5);
        for (const z of [-0.14, 0.14]) {
          if (rng.chance(0.08)) continue;
          // Net-cup collar seated in the NFT channel.
          pb.add(new THREE.CylinderGeometry(0.045, 0.04, 0.02, 8), MAT.potDark(), at(x, y + 0.068, z));
          const kind = crop === 'mixed' ? (t === 0 ? 'tomatoes' : t === 1 ? 'greens' : 'herbs') : crop;
          if (kind === 'tomatoes') {
            const vineH = rng.range(0.32, 0.44);
            pb.add(cylinderBetween(V(x, y + 0.07, z), V(x + rng.range(-0.02, 0.02), y + 0.07 + vineH, z), 0.006, 5), MAT.woodLight());
            rosette(pb, rng, [MAT.leafDark(), MAT.leaf()], x, y + 0.08, z, 5, rng.range(0.14, 0.2), 0.045, 0.85);
            clump(pb, rng, [MAT.leafDark(), MAT.leaf()], x, y + 0.24, z, rng.range(0.06, 0.09), 2);
            // Hanging clusters of ripe cherry tomatoes.
            const fruits = 2 + Math.floor(rng.range(0, 3));
            for (let f = 0; f < fruits; f++) {
              pb.add(
                new THREE.SphereGeometry(rng.range(0.018, 0.026), 7, 5),
                rng.pick(tomatoes),
                at(x + rng.range(-0.07, 0.07), y + rng.range(0.14, 0.34), z + rng.range(-0.06, 0.06)),
              );
            }
          } else if (kind === 'greens') {
            rosette(pb, rng, [MAT.leafLight(), MAT.leaf()], x, y + 0.075, z, 7, rng.range(0.13, 0.19), 0.065, 0.95);
            clump(pb, rng, [MAT.leafLight()], x, y + 0.085, z, rng.range(0.045, 0.065), 2);
          } else {
            const mats = rng.chance(0.28) ? [MAT.leafRed(), MAT.leaf()] : [MAT.leafLight(), MAT.leaf(), MAT.leafDark()];
            clump(pb, rng, mats, x, y + 0.08, z, rng.range(0.065, 0.1), 3);
            rosette(pb, rng, mats, x, y + 0.08, z, 4, rng.range(0.11, 0.16), 0.045, 0.65);
          }
        }
      }
      // Aluminum LED fixture hood + glowing grow bar under the shelf above.
      pb.add(slab(L - 0.1, 0.018, 0.085), glowMat, at(0, y + gap - 0.11, 0));
      pb.add(rounded(L - 0.06, 0.032, 0.13, 0.008), m.steelBrushed, at(0, y + gap - 0.085, 0));
      // Branch irrigation feed line into each tier.
      pb.add(cylinderBetween(V(-L / 2 - 0.04, y, 0), V(-L / 2 + 0.02, y, 0), 0.014, 6), pipeMat);
    }
    // Vertical irrigation supply riser & bottom return drain manifold along the rack.
    pb.add(pipe([V(-L / 2 - 0.04, 0.16, 0), V(-L / 2 - 0.04, totalH - 0.1, 0)], 0.022, 1, 8), pipeMat);
    pb.add(pipe([V(-L / 2 - 0.04, 0.16, d / 2 - 0.02), V(L / 2, 0.16, d / 2 - 0.02)], 0.02, 1, 8), pipeMat);
    // Clip-on digital RH / temp telemetry puck on the +X front upright.
    pb.add(rounded(0.09, 0.14, 0.04, 0.008), m.steelDark, at(L / 2 + 0.01, 1.45, -d / 2 + 0.03));
    pb.add(slab(0.06, 0.04, 0.006), glow('rack-sensor', 0x56f0b8, 1.4), at(L / 2 + 0.01, 1.47, -d / 2 + 0.008));
    pb.soundLoop({ sound: 'hydroTrickle', pos: [0, 0.55, 0], gain: 0.12, maxDist: 6.5, reverb: 0.25 });
    pb.spot('work_crouch', -L * 0.25, 0, -d / 2 - 0.56, PI);
    pb.spot('work_clipboard', L * 0.25, 0, d / 2 + 0.56, 0);
    pb.solid(-L / 2 - 0.04, 0, -d / 2, L / 2 + 0.04, totalH, d / 2, 'metal');
  },

  /** Recessed stainless boot-wash grate + sanitizing mat for the Hydroponics biosecurity vestibule (flush walkable). */
  boot_wash_mat(p, _rng, m, pb) {
    const w = numParam(p, 'width', 1.6);
    const d = numParam(p, 'depth', 1.2);
    pb.add(rounded(w + 0.12, 0.014, d + 0.12, 0.004), m.steelBrushed, at(0, 0.007, 0));
    pb.add(slab(w - 0.08, 0.018, d * 0.45), m.rubber, at(0, 0.009, -d * 0.24));
    pb.add(slab(w - 0.08, 0.018, d * 0.45, 0.5), m.grating, at(0, 0.009, d * 0.24));
    pb.add(slab(w - 0.1, 0.006, d * 0.43), MAT.tankBlue(), at(0, 0.003, d * 0.24));
    pb.surfaces.push({ box: { min: [-w / 2, -0.05, -d / 2], max: [w / 2, 0.02, d / 2] }, material: 'grate' });
  },

  /** Stainless wall-mounted hand-wash sink, soap/towel dispensers & biosecurity protocol sign (back on +Z, front faces -Z). */
  bio_wash_station(_p, _rng, m, pb) {
    const w = 0.85;
    const d = 0.46;
    const h = 0.88;
    // Pedestal & stainless basin.
    pb.add(rounded(w, 0.22, d, 0.015), m.steelBrushed, at(0, h - 0.11, 0));
    pb.add(slab(w - 0.16, 0.02, d - 0.14), m.steelDark, at(0, h + 0.002, -0.02));
    pb.add(cylinderBetween(V(0, 0, 0.08), V(0, h - 0.22, 0.08), 0.045, 10), m.steelBrushed);
    pb.add(slab(w, 0.45, 0.025), m.steelBrushed, at(0, h + 0.225, d / 2 - 0.015));
    // Gooseneck sensor faucet.
    pb.add(pipe([V(0, h, 0.15), V(0, h + 0.26, 0.15), V(0, h + 0.3, 0.04), V(0, h + 0.22, -0.02)], 0.014, 1, 8), m.steelBrushed);
    // Soap & paper towel dispensers.
    pb.add(rounded(0.11, 0.2, 0.09, 0.012), MAT.plastic(), at(-0.28, h + 0.34, d / 2 - 0.07));
    pb.add(rounded(0.28, 0.34, 0.13, 0.015), m.steelBrushed, at(0.24, h + 0.52, d / 2 - 0.08));
    pb.add(slab(0.2, 0.04, 0.02), MAT.paper(), at(0.24, h + 0.34, d / 2 - 0.08));
    // Biosecurity protocol sign above the sink.
    const sign = screenPlane(bioSignMat(), 0.72, 0.42, 0, 1.72, d / 2 - 0.02);
    pb.dynamic(sign);
    pb.solid(-w / 2, 0, -d / 2, w / 2, h + 0.02, d / 2, 'metal');
  },

  /**
   * Priya's cardigan draped over a chair back (overhaul-priya-r08-death D30). Place it at the same pos and rot as a
   * `fixed` `chair`: the back is at local +Z 0.22, its top at about 1.07 m. Soft knit, no collider.
   */
  cardigan(_p, _rng, _m, pb) {
    const knit = MAT.cardiganKnit();
    pb.add(rounded(0.44, 0.36, 0.035, 0.015), knit, at(0, 0.9, 0.17, -0.12, 0, 0));
    pb.add(rounded(0.44, 0.3, 0.035, 0.015), knit, at(0, 0.93, 0.29, 0.1, 0, 0));
    pb.add(rounded(0.46, 0.05, 0.14, 0.02), knit, at(0, 1.08, 0.23));
    for (const s of [-1, 1]) {
      pb.add(cylinderBetween(new THREE.Vector3(s * 0.2, 1.05, 0.28), new THREE.Vector3(s * 0.25, 0.6, 0.33), 0.045), knit);
      pb.add(rounded(0.08, 0.05, 0.08, 0.02), knit, at(s * 0.25, 0.58, 0.33));
    }
  },

  /** Wall-mounted garment rail with hanging botanical lab coats and waterproof boots underneath (back on +Z). */
  coat_rack(p, _rng, m, pb) {
    const w = numParam(p, 'width', 1.6);
    const d = 0.42;
    pb.add(slab(w, 0.04, 0.34), m.steelBrushed, at(0, 1.82, 0.04));
    pb.add(cylinderBetween(V(-w / 2 + 0.08, 1.74, -0.04), V(w / 2 - 0.08, 1.74, -0.04), 0.016, 8), m.steelBrushed);
    for (const x of [-w / 2 + 0.05, w / 2 - 0.05]) {
      pb.add(slab(0.04, 1.82, 0.04), m.steelBrushed, at(x, 0.91, 0.16));
      pb.add(slab(0.04, 0.04, 0.34), m.steelBrushed, at(x, 1.78, 0.02));
    }
    // Hanging white botanical lab coats.
    const coats = Math.max(2, Math.round(w / 0.48));
    for (let i = 0; i < coats; i++) {
      const x = -w / 2 + 0.28 + ((w - 0.56) * i) / Math.max(1, coats - 1);
      pb.add(rounded(0.34, 0.92, 0.12, 0.04), MAT.labCoat(), at(x, 1.2, -0.02));
      pb.add(slab(0.06, 0.78, 0.13), MAT.plastic(), at(x, 1.18, -0.025));
    }
    // Boot bench & pairs of waterproof yellow/dark rubber boots.
    pb.add(slab(w - 0.08, 0.035, 0.34), m.steelBrushed, at(0, 0.08, 0.02));
    for (let i = 0; i < 2; i++) {
      const bx = -0.35 + i * 0.7;
      for (const s of [-0.09, 0.09]) {
        const bm = i === 0 ? MAT.bootYellow() : MAT.neoprene();
        pb.add(new THREE.CylinderGeometry(0.055, 0.06, 0.3, 10), bm, at(bx + s, 0.25, 0.05));
        pb.add(rounded(0.11, 0.08, 0.24, 0.025), bm, at(bx + s, 0.135, -0.02));
      }
    }
    pb.solid(-w / 2, 0, -d / 2, w / 2, 1.85, d / 2, 'metal');
  },

  /** Waist-high NFT hydroponic grow bench (0.9 m tall, fits cleanly beneath ocean windows without blocking sightlines). */
  hydro_trough(p, rng, m, pb) {
    const L = numParam(p, 'length', 2.8);
    const d = 0.76;
    const h = 0.84;
    const pal = resolvePalette(p, m);
    for (const x of [-L / 2 + 0.08, 0, L / 2 - 0.08]) {
      for (const z of [-d / 2 + 0.08, d / 2 - 0.08]) pb.add(slab(0.045, h, 0.045), m.steelBrushed, at(x, h / 2, z));
    }
    pb.add(rounded(L, 0.05, d, 0.01), m.steelBrushed, at(0, h, 0));
    // Three parallel white NFT gullies with crisp leafy greens.
    const greens = [MAT.leafLight(), MAT.leaf()];
    for (const z of [-0.22, 0, 0.22]) {
      pb.add(rounded(L - 0.1, 0.09, 0.17, 0.015), MAT.trayWhite(), at(0, h + 0.065, z));
      const per = Math.max(4, Math.floor(L / 0.26));
      for (let i = 0; i < per; i++) {
        const x = -L / 2 + 0.18 + ((L - 0.36) * i) / Math.max(1, per - 1);
        pb.add(new THREE.CylinderGeometry(0.04, 0.035, 0.02, 8), MAT.potDark(), at(x, h + 0.115, z));
        rosette(pb, rng, greens, x, h + 0.12, z, 6, rng.range(0.11, 0.16), 0.055, 0.9);
      }
    }
    // Under-bench recirculating supply & return manifold.
    pb.add(pipe([V(-L / 2 + 0.06, 0.32, 0), V(L / 2 - 0.06, 0.32, 0)], 0.026, 1, 8), pal.pipeAccent);
    pb.add(rounded(0.45, 0.28, 0.36, 0.02), MAT.tankPoly(), at(0, 0.16, 0));
    pb.soundLoop({ sound: 'hydroTrickle', pos: [0, 0.72, 0], gain: 0.22, maxDist: 8.5, reverb: 0.25 });
    pb.spot('work_clipboard', 0, 0, d / 2 + 0.56, 0);
    pb.solid(-L / 2, 0, -d / 2, L / 2, h + 0.24, d / 2, 'metal');
  },

  /** Botanist irrigation-log & harvest workstation (back on +Z, front faces -Z). */
  hydro_workstation(_p, rng, m, pb) {
    const w = 2.2;
    const d = 0.76;
    const h = 0.9;
    // Stainless bench frame + lower shelf.
    pb.add(rounded(w, 0.045, d, 0.01), m.steelBrushed, at(0, h - 0.02, 0));
    pb.add(slab(w - 0.12, 0.03, d - 0.12), m.steelBrushed, at(0, 0.24, 0));
    for (const x of [-w / 2 + 0.05, w / 2 - 0.05]) {
      for (const z of [-d / 2 + 0.05, d / 2 - 0.05]) pb.add(slab(0.05, h - 0.04, 0.05), m.steelBrushed, at(x, (h - 0.04) / 2, z));
    }
    // Angled irrigation log telemetry screen on the left.
    const screen = new CanvasScreen(512, 288, drawHydroLog, 1.35, 6);
    const mon = new THREE.Group();
    mon.position.set(-0.48, h + 0.36, 0.14);
    mon.rotation.x = -0.22;
    mon.add(new THREE.Mesh(rounded(0.86, 0.52, 0.07, 0.015), m.steelDark));
    const disp = screenPlane(screen.material, 0.78, 0.44, 0, 0, -0.038);
    mon.add(disp);
    pb.dynamic(mon);
    pb.tick((t) => screen.update(t));
    pb.add(cylinderBetween(V(-0.48, h, 0.16), V(-0.48, h + 0.16, 0.16), 0.025, 8), m.steelBrushed);
    pb.add(rounded(0.46, 0.02, 0.16, 0.005), m.rubber, at(-0.48, h + 0.01, -0.14));
    // Clipboard + pen in the middle.
    pb.add(slab(0.24, 0.012, 0.32), MAT.woodLight(), at(0.14, h + 0.006, -0.1, 0, 0.12, 0));
    pb.add(slab(0.2, 0.015, 0.27), MAT.paper(), at(0.14, h + 0.01, -0.1, 0, 0.12, 0));
    // Harvest crate with freshly picked red tomatoes + pruning shears on the right.
    pb.add(rounded(0.54, 0.22, 0.38, 0.015), MAT.plasticGreen(), at(0.68, h + 0.11, 0.04));
    for (let i = 0; i < 10; i++) {
      pb.add(
        new THREE.SphereGeometry(rng.range(0.032, 0.044), 8, 6),
        i % 3 === 0 ? MAT.tomatoWarm() : MAT.tomato(),
        at(0.68 + rng.range(-0.18, 0.18), h + 0.22 + rng.range(0, 0.04), 0.04 + rng.range(-0.1, 0.1)),
      );
    }
    // Pair of pruning shears resting beside the clipboard.
    for (const ang of [-0.22, 0.22]) pb.add(slab(0.02, 0.01, 0.18), m.steelBrushed, at(0.32, h + 0.006, -0.18, 0, ang, 0));
    // Spare harvest crates on the lower shelf.
    pb.add(rounded(0.56, 0.22, 0.4, 0.015), MAT.trayWhite(), at(-0.55, 0.37, 0));
    pb.add(rounded(0.56, 0.22, 0.4, 0.015), MAT.plasticGreen(), at(0.2, 0.37, 0));
    pb.spot('work_bench', -0.48, 0, -d / 2 - 0.58, PI);
    pb.solid(-w / 2, 0, -d / 2, w / 2, h + 0.62, d / 2, 'metal');
  },

  /** Rolling stainless utility cart loaded with fresh tomato & greens harvest crates. */
  harvest_cart(_p, rng, m, pb) {
    const w = 1.05;
    const d = 0.58;
    const h = 0.88;
    for (const x of [-w / 2 + 0.04, w / 2 - 0.04]) {
      for (const z of [-d / 2 + 0.04, d / 2 - 0.04]) {
        pb.add(cylinderBetween(V(x, 0.08, z), V(x, h + (x < 0 ? 0.14 : 0), z), 0.018, 8), m.steelBrushed);
        pb.add(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 10), m.rubber, at(x, 0.045, z, 0, 0, PI / 2));
      }
    }
    pb.add(cylinderBetween(V(-w / 2 + 0.04, h + 0.14, -d / 2 + 0.04), V(-w / 2 + 0.04, h + 0.14, d / 2 - 0.04), 0.016, 8), m.steelBrushed);
    for (const y of [0.22, h]) pb.add(rounded(w, 0.035, d, 0.008), m.steelBrushed, at(0, y, 0));
    // Top crates: tomatoes on left, leafy greens on right.
    pb.add(rounded(0.44, 0.2, 0.44, 0.012), MAT.plasticGreen(), at(-0.24, h + 0.12, 0));
    for (let i = 0; i < 9; i++) {
      pb.add(new THREE.SphereGeometry(0.038, 7, 5), i % 3 === 0 ? MAT.tomatoWarm() : MAT.tomato(), at(-0.24 + rng.range(-0.14, 0.14), h + 0.22 + rng.range(0, 0.03), rng.range(-0.14, 0.14)));
    }
    pb.add(rounded(0.44, 0.2, 0.44, 0.012), MAT.trayWhite(), at(0.24, h + 0.12, 0));
    clump(pb, rng, [MAT.leafLight(), MAT.leaf()], 0.24, h + 0.2, 0, 0.14, 5);
    // Lower crate.
    pb.add(rounded(0.56, 0.22, 0.44, 0.012), MAT.trayWhite(), at(0, 0.35, 0));
    pb.spot('work_clipboard', 0, 0, -d / 2 - 0.54, PI);
    pb.solid(-w / 2, 0, -d / 2, w / 2, h + 0.26, d / 2, 'metal');
  },

  /** Illuminated glass-front seedling propagation incubator (back on +Z, front faces -Z). */
  germination_cabinet(p, rng, m, pb) {
    const w = numParam(p, 'width', 1.6);
    const d = 0.68;
    const h = 2.05;
    pb.add(slab(w, h, 0.05), m.steelBrushed, at(0, h / 2, d / 2 - 0.025));
    for (const s of [-1, 1]) pb.add(slab(0.05, h, d), m.steelBrushed, at(s * (w / 2 - 0.025), h / 2, 0));
    pb.add(rounded(w, 0.24, d, 0.015), m.steelDark, at(0, h - 0.12, 0));
    pb.add(slab(w, 0.14, d), m.steelDark, at(0, 0.07, 0));
    // Digital temp/RH controller on the top header.
    pb.add(slab(0.36, 0.1, 0.01), glow('germ-led', 0x62f4c8, 1.5), at(0, h - 0.12, -d / 2 - 0.004));
    // Four illuminated propagation shelves with plug trays & sprouts.
    const grow = glow('germ-strip', 0xf4fff2, 1.8);
    for (let t = 0; t < 4; t++) {
      const y = 0.28 + t * 0.38;
      pb.add(slab(w - 0.1, 0.02, d - 0.12), m.steelBrushed, at(0, y, 0));
      pb.add(rounded(w - 0.18, 0.045, d - 0.2, 0.008), MAT.trayWhite(), at(0, y + 0.035, 0));
      pb.add(slab(w - 0.22, 0.012, d - 0.24), MAT.soil(), at(0, y + 0.058, 0));
      for (let i = 0; i < 6; i++) {
        const sx = -w / 2 + 0.22 + ((w - 0.44) * i) / 5;
        for (const sz of [-0.1, 0.1]) rosette(pb, rng, [MAT.leafLight(), MAT.leaf()], sx, y + 0.065, sz, 4, 0.08, 0.035, 0.8);
      }
      pb.add(slab(w - 0.16, 0.015, 0.06), grow, at(0, y + 0.33, 0));
    }
    const doorPane = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.14, h - 0.42), m.glass);
    doorPane.position.set(0, h / 2 - 0.04, -d / 2 + 0.01);
    doorPane.rotation.y = PI;
    doorPane.renderOrder = 3;
    pb.dynamic(doorPane);
    pb.spot('work_clipboard', 0, 0, -d / 2 - 0.58, PI);
    pb.solid(-w / 2, 0, -d / 2, w / 2, h, d / 2, 'metal');
  },

  /** Cold-storage stainless seed archive cabinet with labelled specimen drawers (back on +Z). */
  seed_vault(p, _rng, m, pb) {
    const w = numParam(p, 'width', 1.4);
    const d = 0.62;
    const h = 1.9;
    pb.add(rounded(w, h, d, 0.02), m.steelBrushed, at(0, h / 2, 0));
    pb.add(rounded(w - 0.08, 0.2, 0.04, 0.008), m.steelDark, at(0, h - 0.14, -d / 2 - 0.01));
    pb.add(slab(0.32, 0.08, 0.01), glow('vault-temp', 0x5cd6ff, 1.7), at(w / 2 - 0.28, h - 0.14, -d / 2 - 0.032));
    // Six stainless specimen drawers.
    const rows = 5;
    for (let r = 0; r < rows; r++) {
      const y = 0.24 + r * 0.29;
      for (const s of [-1, 1]) {
        const x = s * (w / 4 - 0.02);
        pb.add(rounded(w / 2 - 0.1, 0.24, 0.025, 0.006), m.cleanWall, at(x, y, -d / 2 - 0.01));
        pb.add(rounded(0.18, 0.02, 0.025, 0.005), m.steelBrushed, at(x, y + 0.04, -d / 2 - 0.03));
        pb.add(slab(0.22, 0.045, 0.006), MAT.paper(), at(x, y - 0.04, -d / 2 - 0.025));
      }
    }
    pb.spot('work_clipboard', 0, 0, -d / 2 - 0.56, PI);
    pb.solid(-w / 2, 0, -d / 2, w / 2, h, d / 2, 'metal');
  },

  /** Industrial HDPE/stainless hydroponic nutrient mixing tank on steel skid with sight-glass gauge & piping. */
  fertigation_tank(p, _rng, m, pb) {
    const labelText = strParam(p, 'label', 'TANK A · NITROGEN');
    const fluid = strParam(p, 'fluid', 'blue') === 'amber' ? MAT.tankAmber() : MAT.tankBlue();
    const ceil = numParam(p, 'ceiling', 3.2);
    const r = 0.62;
    // Steel skid base & support legs.
    pb.add(rounded(1.4, 0.1, 1.4, 0.015), m.steelDark, at(0, 0.05, 0));
    for (let k = 0; k < 4; k++) {
      const a = (k * PI) / 2 + PI / 4;
      pb.add(cylinderBetween(V(Math.cos(a) * 0.46, 0.1, Math.sin(a) * 0.46), V(Math.cos(a) * 0.46, 0.42, Math.sin(a) * 0.46), 0.04, 8), m.steelBrushed);
    }
    // Main vertical cylindrical HDPE tank body + domed lid + retention bands.
    pb.add(lathe([[0, 0.36], [r * 0.9, 0.38], [r, 0.48], [r, 2.15], [r * 0.85, 2.34], [0.22, 2.38], [0, 2.38]], 28), MAT.tankPoly());
    for (const y of [0.75, 1.35, 1.95]) pb.add(new THREE.TorusGeometry(r + 0.012, 0.018, 6, 28), m.steelBrushed, at(0, y, 0, PI / 2, 0, 0));
    // Top electric agitator motor + overhead supply riser to ceiling.
    pb.add(new THREE.CylinderGeometry(0.14, 0.16, 0.32, 14), m.steelDark, at(0, 2.54, 0));
    pb.add(pipe([V(0.28, 2.34, 0), V(0.28, ceil, 0)], 0.045, 1, 10), m.cleanTeal);
    pb.add(pipe([V(-0.28, 2.34, 0), V(-0.28, ceil, 0)], 0.032, 1, 8), m.steelBrushed);
    // Front clear sight-glass level gauge showing nutrient fluid level.
    pb.add(rounded(0.14, 1.35, 0.05, 0.008), m.steelDark, at(0, 1.32, -r - 0.02));
    pb.add(new THREE.CylinderGeometry(0.032, 0.032, 0.96, 10), fluid, at(0, 1.14, -r - 0.045));
    pb.add(new THREE.CylinderGeometry(0.032, 0.032, 0.28, 10), MAT.paper(), at(0, 1.76, -r - 0.045));
    // Lower dosing pump & discharge valve manifold.
    pb.add(rounded(0.32, 0.2, 0.26, 0.02), m.steelDark, at(0.45, 0.2, -0.45));
    pb.add(pipe([V(0, 0.42, -r + 0.08), V(0, 0.24, -r - 0.05), V(0.45, 0.24, -0.45)], 0.028, 1, 8), m.cleanTeal);
    pb.add(new THREE.TorusGeometry(0.08, 0.014, 6, 16), MAT.tomato(), at(0.18, 0.24, -0.58, 0, 0, 0));
    // Label placard on tank front.
    const placard = screenPlane(stencilMat(labelText), 0.72, 0.16, 0, 2.08, -r - 0.018);
    pb.dynamic(placard);
    pb.soundLoop({ sound: 'fertigationPump', pos: [0.3, 0.55, -0.35], gain: 0.28, maxDist: 10, reverb: 0.3 });
    pb.spot('work_clipboard', 0, 0, -0.72 - 0.56, PI);
    pb.solid(-0.72, 0, -0.72, 0.72, 2.7, 0.72, 'metal');
  },

  /** Industrial HVAC air-handler & dehumidifier cabinet with blinking humidity-fault beacon (clears on `round:hydro_alarm`). */
  hvac_dehumidifier(p, _rng, m, pb) {
    const ceil = numParam(p, 'ceiling', 3.2);
    const w = 1.65;
    const d = 0.85;
    const h = 2.05;
    pb.add(rounded(w, h, d, 0.025), m.steelBrushed, at(0, h / 2, 0));
    pb.add(slab(w - 0.06, 0.12, d - 0.06), m.steelDark, at(0, 0.06, 0));
    // Upper intake louver grille & lower access service door.
    pb.add(slab(w - 0.28, 0.72, 0.03), m.black, at(0, 1.48, -d / 2 - 0.005));
    for (let k = 0; k < 8; k++) pb.add(slab(w - 0.3, 0.03, 0.05), MAT.ductLight(), at(0, 1.18 + k * 0.085, -d / 2 - 0.015, 0.45, 0, 0));
    pb.add(rounded(w - 0.32, 0.72, 0.025, 0.01), m.cleanSlate, at(0, 0.56, -d / 2 - 0.01));
    // Overhead galvanized HVAC exhaust duct rising cleanly to the ceiling.
    pb.add(slab(0.76, Math.max(0.3, ceil - h), 0.46), MAT.ductLight(), at(-0.22, h + Math.max(0.3, ceil - h) / 2, 0.08));
    pb.add(slab(0.84, 0.06, 0.54), m.steelDark, at(-0.22, h + 0.03, 0.08));
    // Condensate drain pipe dropping to floor.
    pb.add(pipe([V(w / 2 + 0.02, 0.38, 0), V(w / 2 + 0.14, 0.38, 0), V(w / 2 + 0.14, 0.02, 0)], 0.024, 1, 8), m.cleanTeal);
    // Pressure dial & live fault beacon that responds to `round:hydro_alarm`.
    pb.add(new THREE.CylinderGeometry(0.085, 0.085, 0.035, 16), m.steelDark, at(0.5, 0.72, -d / 2 - 0.025, PI / 2, 0, 0));
    pb.add(new THREE.CircleGeometry(0.07, 16), MAT.paper(), at(0.5, 0.72, -d / 2 - 0.044, 0, PI, 0));
    const lampMat = fixtureMaterial(0xff9a1a, 2.8);
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.11, 14), lampMat);
    beacon.position.set(0.56, h + 0.055, -0.2);
    pb.dynamic(beacon);
    pb.soundLoop({ sound: 'dehumidifierHum', pos: [0, 1.25, -0.38], gain: 0.34, maxDist: 12, reverb: 0.3 });
    let cleared = false;
    let nextChirp = -1;
    const CHIRP_INTERVAL = 3.8;
    pb.tick((t) => {
      if (cleared) {
        lampMat.emissive.setHex(0x39ff9e);
        lampMat.emissiveIntensity = 1.6;
      } else {
        lampMat.emissive.setHex(0xff7a1a);
        lampMat.emissiveIntensity = Math.floor(t * 2.4) % 2 === 0 ? 3.2 : 0.35;
        if (nextChirp < 0) nextChirp = t + 0.8;
        if (t >= nextChirp) {
          pb.soundAt('humidityAlarm', [0.56, h + 0.055, -0.2], { gain: 0.44, reverb: 0.32, maxDist: 16 });
          nextChirp = t + CHIRP_INTERVAL;
        }
      }
    });
    pb.on('round:hydro_alarm', () => {
      cleared = true;
    });
    pb.on('level:reset', () => {
      cleared = false;
      nextChirp = -1;
    });
    pb.spot('work_clipboard', 0, 0, -d / 2 - 0.56, PI);
    pb.solid(-w / 2, 0, -d / 2, w / 2 + 0.16, h, d / 2, 'metal');
  },

  /** Folding camp cot with sleeping pad, rumpled blanket & pillow (R12e hidden living space). */
  camp_cot(_p, _rng, m, pb) {
    const L = 1.95;
    const w = 0.78;
    const h = 0.42;
    // Crossed aluminum folding legs & side rails.
    for (const x of [-L / 2 + 0.22, 0, L / 2 - 0.22]) {
      pb.add(cylinderBetween(V(x, 0, -w / 2 + 0.06), V(x, h, w / 2 - 0.06), 0.016, 6), m.steelBrushed);
      pb.add(cylinderBetween(V(x, 0, w / 2 - 0.06), V(x, h, -w / 2 + 0.06), 0.016, 6), m.steelBrushed);
    }
    for (const z of [-w / 2 + 0.04, w / 2 - 0.04]) pb.add(cylinderBetween(V(-L / 2, h, z), V(L / 2, h, z), 0.018, 8), m.steelBrushed);
    // Canvas cot deck & foam sleeping pad.
    pb.add(rounded(L - 0.04, 0.06, w - 0.06, 0.02), MAT.cotOlive(), at(0, h + 0.02, 0));
    // Slightly rumpled navy blanket draped over the lower two-thirds.
    pb.add(rounded(L * 0.64, 0.08, w - 0.04, 0.03), MAT.blanketNavy(), at(L * 0.14, h + 0.07, 0.01, 0, 0.03, 0));
    pb.add(rounded(0.55, 0.07, w - 0.1, 0.03), MAT.blanketNavy(), at(-0.18, h + 0.09, -0.02, 0.04, -0.08, 0.05));
    // Pillow at the -X head end.
    pb.add(rounded(0.36, 0.13, 0.56, 0.055), MAT.paper(), at(-L / 2 + 0.26, h + 0.1, 0, 0, 0.06, 0.08));
    pb.solid(-L / 2, 0, -w / 2, L / 2, h + 0.18, w / 2, 'rubber');
  },

  /** Pallet stacked with burlap fertiliser sacks and chemical concentrate jugs (R12e). */
  fertiliser_pallet(_p, rng, m, pb) {
    const w = 1.18;
    const d = 0.92;
    // Wooden slat pallet base.
    for (const z of [-d / 2 + 0.08, 0, d / 2 - 0.08]) pb.add(slab(w, 0.1, 0.1), MAT.wood(), at(0, 0.05, z));
    for (let i = 0; i < 5; i++) pb.add(slab(w, 0.025, 0.14), MAT.woodLight(), at(0, 0.112, -d / 2 + 0.08 + i * ((d - 0.16) / 4)));
    // Stacked heavy fertiliser sacks on the left side.
    for (let row = 0; row < 3; row++) {
      for (const z of [-0.18, 0.18]) {
        pb.add(
          rounded(0.56, 0.18, 0.34, 0.055),
          row % 2 === 0 ? MAT.sackBurlap() : MAT.paper(),
          at(-0.24 + rng.range(-0.02, 0.02), 0.21 + row * 0.17, z + rng.range(-0.015, 0.015), 0, rng.range(-0.06, 0.06), 0),
        );
      }
    }
    // Sealed 20 L nutrient concentrate jugs on the right side.
    for (const [x, z, mat] of [
      [0.24, -0.22, MAT.plastic()],
      [0.44, -0.22, MAT.plastic()],
      [0.24, 0.16, MAT.tankBlue()],
      [0.44, 0.16, MAT.suitYellow()],
    ] as const) {
      pb.add(rounded(0.18, 0.34, 0.24, 0.03), mat, at(x, 0.3, z));
      pb.add(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 8), m.black, at(x, 0.49, z - 0.05));
    }
    pb.solid(-w / 2, 0, -d / 2, w / 2, 0.72, d / 2, 'metal');
  },

  /** Countertop electric kettle (with warm LED & gentle steam), ceramic mug, and a framed dog photo (R12e). */
  kettle_set(_p, rng, m, pb) {
    // Stainless electric kettle on power base.
    pb.add(new THREE.CylinderGeometry(0.09, 0.095, 0.022, 16), m.black, at(-0.18, 0.011, 0));
    pb.add(lathe([[0, 0.022], [0.085, 0.022], [0.088, 0.06], [0.072, 0.22], [0.076, 0.235], [0, 0.235]], 16), m.steelBrushed, at(-0.18, 0, 0));
    pb.add(new THREE.TorusGeometry(0.055, 0.012, 6, 12, PI), m.black, at(-0.1, 0.12, 0, 0, 0, -PI / 2));
    pb.add(slab(0.014, 0.014, 0.01), glow('kettle-led', 0xff7a2a, 2.2), at(-0.18, 0.04, -0.088));
    steamPlume(pb, rng, { x: -0.23, y: 0.24, z: 0, width: 0.06, depth: 0.06, height: 0.24, count: 10, opacity: 0.14, size: 0.07 });
    pb.soundLoop({ sound: 'kettleSimmer', pos: [-0.18, 0.24, 0], gain: 0.24, maxDist: 7.5, reverb: 0.15 });
    // Ceramic mug beside the kettle.
    mugAt(pb, MAT.ceramicTeal(), 0.02, 0, -0.04, 0.9);
    // Framed photo of somebody's dog, angled slightly toward the doorway.
    const f = at(0.24, 0, 0.02, -0.18, 0.24, 0);
    pb.add(rounded(0.18, 0.22, 0.018, 0.004), MAT.woodDark(), inFrame(f, 0, 0.11, 0));
    pb.add(slab(0.02, 0.14, 0.008), MAT.woodDark(), inFrame(f, 0, 0.08, 0.04, 0.45, 0, 0));
    const photo = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.18), dogPhotoMat());
    photo.applyMatrix4(inFrame(f, 0, 0.11, -0.011, 0, PI, 0));
    pb.dynamic(photo);
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
    const period = numParam(p, 'period', 10.5);
    const offset = numParam(p, 'offset', 0);
    const sputter = boolParam(p, 'sputter', false);
    const pal = resolvePalette(p, m);
    // Drop slightly lower in high-ceiling bays (4.5 m Grow Hall) so plumes settle into the rack canopy.
    const y = ceil - (ceil > 3.8 ? 0.72 : 0.35);

    // Brushed stainless header rail + end caps.
    pb.add(pipe([V(-L / 2, y, 0), V(L / 2, y, 0)], 0.024, 1, 10), m.steelBrushed);
    for (const sx of [-L / 2, L / 2]) pb.add(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 10), m.steelDark, at(sx, y, 0, 0, 0, PI / 2));

    // Ceiling drop hangers with upper flange plates & pipe clamps.
    const hangers = L > 4.5 ? [-L / 2 + 0.4, 0, L / 2 - 0.4] : [-L / 2 + 0.25, L / 2 - 0.25];
    for (const hx of hangers) {
      pb.add(cylinderBetween(V(hx, y + 0.02, 0), V(hx, ceil - 0.01, 0), 0.01, 6), m.steel);
      pb.add(new THREE.CylinderGeometry(0.05, 0.05, 0.022, 10), m.steelDark, at(hx, ceil - 0.011, 0));
      pb.add(new THREE.TorusGeometry(0.03, 0.008, 6, 12), m.steelDark, at(hx, y, 0, 0, PI / 2, 0));
    }

    // Pressurized feeder riser + brass solenoid valve box with active/sputter status LED.
    const valveX = -L / 2 + 0.18;
    pb.add(pipe([V(valveX, y + 0.02, 0), V(valveX, ceil, 0)], 0.018, 1, 8), pal.pipeAccent);
    pb.add(new THREE.CylinderGeometry(0.036, 0.036, 0.09, 10), MAT.shadeBrass(), at(valveX, y + 0.06, 0));
    pb.add(rounded(0.11, 0.085, 0.09, 0.01), m.steelDark, at(valveX + 0.06, y + 0.08, 0.03));
    const ledMat = fixtureMaterial(0x1c6660, 0.6);
    const led = new THREE.Mesh(slab(0.024, 0.024, 0.012), ledMat);
    led.position.set(valveX + 0.06, y + 0.075, -0.02);
    pb.dynamic(led);

    // Machined brass/stainless mist nozzle heads spaced cleanly along the rail.
    const n = Math.max(2, Math.floor(L / 0.65));
    const nozzleXs: number[] = [];
    for (let i = 0; i < n; i++) {
      const nx = -L / 2 + (L / n) * (i + 0.5);
      nozzleXs.push(nx);
      pb.add(new THREE.CylinderGeometry(0.028, 0.028, 0.026, 8), m.steelDark, at(nx, y, 0));
      pb.add(new THREE.CylinderGeometry(0.012, 0.014, 0.042, 8), MAT.shadeBrass(), at(nx, y - 0.032, 0));
      pb.add(new THREE.ConeGeometry(0.015, 0.028, 8), m.steelBrushed, at(nx, y - 0.06, 0, PI, 0, 0));
    }

    const pxRatio = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    const uTime = { value: 0 };
    const uSpray = { value: 0 };
    const uCloud = { value: 0 };

    // Layer A: fast pressurized downward spray cones directly under each nozzle.
    const conePerNozzle = 26;
    const coneCount = n * conePerNozzle;
    const conePos = new Float32Array(coneCount * 3);
    const coneSeed = new Float32Array(coneCount * 4);
    for (let i = 0; i < coneCount; i++) {
      const nx = nozzleXs[i % n]!;
      conePos[i * 3] = nx;
      conePos[i * 3 + 1] = y - 0.07;
      conePos[i * 3 + 2] = 0;
      coneSeed[i * 4] = rng.range(0, 1);
      coneSeed[i * 4 + 1] = rng.range(0.95, 1.55);
      coneSeed[i * 4 + 2] = rng.range(0, PI * 2);
      coneSeed[i * 4 + 3] = rng.range(0.55, 1.15);
    }
    const coneGeo = new THREE.BufferGeometry();
    coneGeo.setAttribute('position', new THREE.BufferAttribute(conePos, 3));
    coneGeo.setAttribute('aSeed', new THREE.BufferAttribute(coneSeed, 4));
    const coneMat = new THREE.ShaderMaterial({
      uniforms: { uTime, uSpray, uDrop: { value: 0.96 }, uOpacity: { value: 0.58 }, uPixelRatio: { value: pxRatio } },
      vertexShader: MISTER_CONE_VERT,
      fragmentShader: MISTER_CONE_FRAG,
      transparent: true,
      depthWrite: false,
    });
    const conePts = new THREE.Points(coneGeo, coneMat);
    conePts.name = 'mister-spray-cones';
    conePts.userData['skipGtao'] = true;
    conePts.frustumCulled = false;
    conePts.renderOrder = 2;
    pb.dynamic(conePts);

    // Layer B: broader slow vapor cloud that drifts down into the canopy and lingers after valve shutoff.
    const cloudPerNozzle = 20;
    const cloudCount = n * cloudPerNozzle;
    const cloudPos = new Float32Array(cloudCount * 3);
    const cloudSeed = new Float32Array(cloudCount * 4);
    for (let i = 0; i < cloudCount; i++) {
      const nx = nozzleXs[i % n]!;
      cloudPos[i * 3] = nx;
      cloudPos[i * 3 + 1] = y - 0.08;
      cloudPos[i * 3 + 2] = 0;
      cloudSeed[i * 4] = rng.range(0, 1);
      cloudSeed[i * 4 + 1] = rng.range(0.24, 0.44);
      cloudSeed[i * 4 + 2] = rng.range(0, PI * 2);
      cloudSeed[i * 4 + 3] = rng.range(0.75, 1.35);
    }
    const cloudGeo = new THREE.BufferGeometry();
    cloudGeo.setAttribute('position', new THREE.BufferAttribute(cloudPos, 3));
    cloudGeo.setAttribute('aSeed', new THREE.BufferAttribute(cloudSeed, 4));
    const cloudMat = new THREE.ShaderMaterial({
      uniforms: { uTime, uCloud, uDrop: { value: 1.45 }, uOpacity: { value: 0.36 }, uPixelRatio: { value: pxRatio } },
      vertexShader: MISTER_CLOUD_VERT,
      fragmentShader: MISTER_CLOUD_FRAG,
      transparent: true,
      depthWrite: false,
    });
    const cloudPts = new THREE.Points(cloudGeo, cloudMat);
    cloudPts.name = 'mister-vapor-cloud';
    cloudPts.userData['skipGtao'] = true;
    cloudPts.frustumCulled = false;
    cloudPts.renderOrder = 2;
    pb.dynamic(cloudPts);

    let prevCycle = -1;
    pb.tick((t) => {
      const st = evaluateMisterCycle(t, period, offset, sputter);
      uTime.value = t;
      uSpray.value = st.spray;
      uCloud.value = st.cloud;
      if (st.active) {
        if (st.kind === 'sputter') {
          ledMat.emissive.setHex(0xff9a22);
          ledMat.emissiveIntensity = 2.8;
        } else {
          ledMat.emissive.setHex(0x44f4ff);
          ledMat.emissiveIntensity = 2.4;
        }
      } else {
        ledMat.emissive.setHex(0x1c6660);
        ledMat.emissiveIntensity = 0.55;
      }
      if (st.cycle !== prevCycle) {
        if (st.localT < 0.5) {
          const isSputter = st.kind === 'sputter';
          pb.soundAt('misterValve', [valveX, y, 0], {
            gain: isSputter ? 0.46 : 0.42,
            reverb: 0.25,
            rate: isSputter ? 1.07 : rng.range(0.95, 1.05),
            maxDist: 22,
          });
          pb.soundAt(isSputter ? 'misterSputter' : 'misterSpray', [0, y - 0.3, 0], {
            gain: isSputter ? 0.52 : 0.48,
            reverb: 0.32,
            rate: rng.range(0.96, 1.04),
            maxDist: 22,
          });
        }
        prevCycle = st.cycle;
      }
    });
    pb.on('level:reset', () => {
      prevCycle = -1;
    });
  },

  // ---------------------------------------------------------------- dive bay (ADR-0023)

  // Standing water in a room (the flooded tunnel) is the room's `water` block, not a prop (standing-water spec).

  /**
   * The flood's source (flooded-tunnel spec "The flood has a visible source"): an overhead pipe running along X at
   * `height` m (default 3.6) above the origin, burst open at the origin, with a stream falling `fall` m (default
   * 2.85) into the water below and the pouring loop. Origin on the floor under the break.
   */
  burst_pipe(p, _rng, m, pb) {
    const h = numParam(p, 'height', 3.6);
    const fall = numParam(p, 'fall', 2.85);
    const r = 0.11;
    pb.add(cylinderBetween(V(-2, h, 0), V(-0.12, h, 0), r, 14), m.rustHeavy ?? m.steel);
    pb.add(cylinderBetween(V(0.16, h, 0), V(2, h, 0), r, 14), m.rustHeavy ?? m.steel);
    // Torn lips of the break, bent outward.
    for (const [x, lean] of [[-0.12, -0.5], [0.16, 0.5]] as const) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * PI * 2;
        pb.add(slab(0.05, 0.012, 0.07), m.steel, at(x + lean * 0.06, h + Math.sin(a) * r, Math.cos(a) * r, a, lean, 0));
      }
    }
    for (const x of [-1.6, 1.6]) pb.add(cylinderBetween(V(x, h, 0), V(x, h + 0.6, 0), 0.02, 6), m.steel);
    const uniforms = { uTime: { value: 0 } };
    const stream = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.1, fall, 14, 8, true),
      new THREE.ShaderMaterial({
        uniforms,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          varying vec2 vUv;
          ${NOISE_GLSL}
          void main() {
            float n = vnoise(vec2(vUv.x * 14.0, vUv.y * 6.0 + uTime * 5.5));
            float streak = smoothstep(0.35, 0.8, n);
            float a = (0.25 + 0.45 * streak) * smoothstep(0.0, 0.08, vUv.y);
            gl_FragColor = vec4(mix(vec3(0.05, 0.09, 0.09), vec3(0.45, 0.55, 0.55), streak), a);
          }`,
      }),
    );
    stream.position.set(0, h - fall / 2, 0);
    stream.renderOrder = 3;
    pb.dynamic(stream);
    pb.tick((t) => {
      uniforms.uTime.value = t;
    });
    pb.soundLoop({ sound: 'pipePour', pos: [0, h - fall * 0.8, 0], gain: 0.55, maxDist: 18, reverb: 0.35, bus: 'ambience' });
  },

  /**
   * Sprayed stencil on bare concrete (flooded-tunnel spec, task 11.3), worn by water and age. Wall-mounted: back at
   * z = 0, facing -Z. `kind`: "logo" (default: the TAG Industries lockup, the tunnel's name and its deck), or "depth" (a
   * water-depth gauge, 0 at the origin's height `y` and marked down 1.2 m). `y`: centre height above the origin.
   */
  tag_stencil(p, _rng, _m, pb) {
    const kind = strParam(p, 'kind', 'logo');
    const y = numParam(p, 'y', 0.9);
    const paint = '#d8d2b8';
    if (kind === 'depth') {
      const mat = paintedDecal(
        (ctx, w, h) => {
          ctx.fillStyle = paint;
          ctx.font = '800 30px "Arial Narrow", Arial, sans-serif';
          ctx.textAlign = 'left';
          for (let i = 0; i <= 12; i++) {
            const yy = 12 + (i / 12) * (h - 24);
            const major = i % 5 === 0;
            ctx.fillRect(0, yy - 3, major ? w * 0.55 : w * 0.3, 6);
            if (major) ctx.fillText((-i / 10).toFixed(1), w * 0.6, yy + 10);
          }
        },
        128,
        640,
        `depth-${y}`,
      );
      // 1.2 m tall, its top (0.0) at the origin's height y.
      pb.add(new THREE.PlaneGeometry(0.24, 1.25), mat, at(0, y - 0.6, -0.004, 0, PI, 0));
      return;
    }
    const mat = paintedDecal(
      (ctx, w, h) => {
        drawTagLockup(ctx, w * 0.05, h * 0.12, w * 0.5, { ink: paint, accent: '#c9b56a' });
        ctx.fillStyle = paint;
        ctx.textAlign = 'left';
        ctx.font = '800 64px "Arial Narrow", Arial, sans-serif';
        ctx.fillText('SERVICE TUNNEL 07', w * 0.05, h * 0.74);
        ctx.font = '700 40px "Arial Narrow", Arial, sans-serif';
        ctx.fillText('SUMP  ·  DECK 0  ·  NO ENTRY WHEN FLOODED', w * 0.05, h * 0.9);
        ctx.fillStyle = '#c9b56a';
        for (let i = 0; i < 6; i++) {
          ctx.save();
          ctx.translate(w * 0.62 + i * 46, h * 0.12);
          ctx.transform(1, 0, -0.5, 1, 0, 0);
          ctx.fillRect(0, 0, 22, h * 0.42);
          ctx.restore();
        }
      },
      1024,
      512,
      `tag-stencil-${y}`,
    );
    pb.add(new THREE.PlaneGeometry(2.0, 1.0), mat, at(0, y, -0.004, 0, PI, 0));
  },

  /**
   * A cable tray hung from the ceiling (flooded-tunnel spec, task 11.4): a grated tray `length` m long (default 4)
   * along X, `drop` m (default 0.35) under the ceiling on threaded rods, carrying bundled cables, a couple of which
   * sag out between the hangers. Origin on the floor under its middle; `ceiling` is the height above it.
   */
  cable_tray(p, rng, m, pb) {
    const len = numParam(p, 'length', 4);
    const ceiling = numParam(p, 'ceiling', 3.2);
    const y = ceiling - numParam(p, 'drop', 0.35);
    const w = 0.4;
    pb.add(slab(len, 0.02, w, 1), m.grating, at(0, y, 0));
    for (const z of [-w / 2, w / 2]) pb.add(slab(len, 0.08, 0.02), m.steel, at(0, y + 0.04, z));
    const hangers = Math.max(2, Math.round(len / 1.2) + 1);
    const xs: number[] = [];
    for (let i = 0; i < hangers; i++) {
      const x = -len / 2 + 0.1 + (i / (hangers - 1)) * (len - 0.2);
      xs.push(x);
      pb.add(slab(0.05, 0.03, w + 0.12), m.steel, at(x, y - 0.025, 0));
      for (const z of [-w / 2 - 0.04, w / 2 + 0.04]) pb.add(cylinderBetween(V(x, y - 0.03, z), V(x, ceiling, z), 0.008, 6), m.steel);
    }
    for (let k = 0; k < 6; k++) {
      const z = -w / 2 + 0.05 + k * 0.06;
      const r = rng.range(0.012, 0.024);
      pb.add(pipe([V(-len / 2, y + 0.02 + r, z), V(0, y + 0.02 + r + rng.range(0, 0.01), z + rng.range(-0.02, 0.02)), V(len / 2, y + 0.02 + r, z)], r, 8, 6), k % 3 === 0 ? m.cable : m.rubber);
    }
    // Loops that have slipped over the edge and sag between hangers.
    for (let i = 0; i < xs.length - 1; i++) {
      if (!rng.chance(0.55)) continue;
      const a = xs[i]!;
      const b = xs[i + 1]!;
      const sag = rng.range(0.2, 0.45);
      const z = (rng.chance(0.5) ? 1 : -1) * (w / 2 + 0.03);
      pb.add(pipe([V(a + 0.15, y + 0.03, z), V((a + b) / 2, y - sag, z * 1.15), V(b - 0.15, y + 0.03, z)], 0.016, 12, 6), m.cable);
    }
  },

  /**
   * The hand on the porthole (flooded-tunnel spec "A shambler is taken by the flood"): hidden until `flood:handslap`,
   * then a turned hand slaps the glass from the flooded side, drags down it and sinks away into the murk. Faces -Z
   * (the glass); place it just behind the porthole on the flooded side. A level reset hides it again.
   */
  porthole_hand(_p, _rng, _m, pb) {
    const skin = new THREE.MeshStandardMaterial({ color: 0x5b5a52, roughness: 0.42, metalness: 0 });
    skin.name = 'porthole-hand';
    const hand = new THREE.Group();
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.1, 0.025), skin);
    hand.add(palm);
    for (let i = 0; i < 4; i++) {
      const len = [0.07, 0.085, 0.08, 0.06][i]!;
      const f = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.01, len, 6), skin);
      f.position.set(-0.03 + i * 0.02, 0.05 + len / 2, 0);
      f.rotation.z = (i - 1.5) * 0.08;
      hand.add(f);
    }
    const thumb = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.011, 0.06, 6), skin);
    thumb.position.set(0.055, 0.0, 0);
    thumb.rotation.z = -0.9;
    hand.add(thumb);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.35, 8), skin);
    arm.position.set(0, -0.2, 0.08);
    arm.rotation.x = -0.5;
    hand.add(arm);
    hand.visible = false;
    hand.name = 'porthole-hand';
    pb.dynamic(hand);
    let start = -1;
    let clock = 0;
    pb.on('flood:handslap', () => {
      start = clock;
      hand.visible = true;
    });
    pb.on('level:reset', () => {
      start = -1;
      hand.visible = false;
    });
    pb.tick((t) => {
      clock = t;
      if (start < 0) return;
      const k = t - start;
      // Slap in (0.1 s), hold, drag down 30 cm, then sink back into the water.
      const z = k < 0.1 ? -0.18 * (1 - k / 0.1) : k < 1.1 ? 0 : -Math.min(0.5, (k - 1.1) * 0.5);
      const y = k < 0.45 ? 0 : -Math.min(0.3, (k - 0.45) * 0.45);
      hand.position.set(0, y, -z);
      hand.rotation.z = k > 0.45 ? Math.min(0.25, (k - 0.45) * 0.3) : 0;
      if (k > 2.4) {
        hand.visible = false;
        start = -1;
      }
    });
  },

  /**
   * An invisible looping sound at the origin (`sound`: a registered sample; `gain`, `range` m). With `on`, it is
   * silent until that event (a sequence `emit` or level trigger) and silent again after a level reset.
   */
  ambient_loop(p, _rng, _m, pb) {
    const sound = strParam(p, 'sound', 'waterLap') as SoundLoopSlot['sound'];
    const on = strParam(p, 'on', '');
    let active = on === '';
    if (on) {
      pb.on(on, () => {
        active = true;
      });
      pb.on('level:reset', () => {
        active = false;
      });
    }
    pb.soundLoop({ sound, pos: [0, numParam(p, 'y', 0.2), 0], gain: numParam(p, 'gain', 0.3), maxDist: numParam(p, 'range', 10), reverb: 0.3, bus: 'ambience', active: () => active });
  },

  /**
   * A water pump on a skid (flooded-tunnel spec "The pump room overlooks the sump"): motor, volute, flanged pipes into
   * the floor and a dial gauge whose needle hunts. Plays the pump-room loop. Footprint 1.4 x 0.8 m.
   */
  pump_unit(p, rng, m, pb) {
    const paint = strParam(p, 'paint', 'teal') === 'dark' ? m.paintDark : m.paintTeal;
    pb.add(rounded(1.4, 0.12, 0.8, 0.02), m.steel, at(0, 0.06, 0));
    pb.add(cylinderBetween(V(-0.55, 0.45, 0), V(0.05, 0.45, 0), 0.24, 18), paint);
    for (let i = 0; i < 9; i++) pb.add(slab(0.012, 0.5, 0.5), m.steelBrushed, at(-0.5 + i * 0.06, 0.45, 0));
    pb.add(new THREE.SphereGeometry(0.3, 16, 12), paint, at(0.35, 0.45, 0));
    pb.add(cylinderBetween(V(0.35, 0.45, 0), V(0.35, 0.45, -0.55), 0.1, 12), m.steel);
    pb.add(cylinderBetween(V(0.35, 0.75, 0), V(0.35, 1.4, 0), 0.09, 12), m.steel);
    pb.add(cylinderBetween(V(0.35, 1.4, 0), V(0.35, 1.4, 0.4), 0.09, 12), m.steel);
    pb.add(cylinderBetween(V(0.27, 1.05, 0.02), V(0.43, 1.05, 0.02), 0.13, 14), m.steelDark ?? m.steel);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.07, 20), fixtureMaterial(0xd8d2b4, 0.25));
    face.position.set(0.6, 0.9, 0.051 + 0.3);
    pb.add(cylinderBetween(V(0.6, 0.9, 0.3), V(0.6, 0.9, 0.35), 0.08, 18), m.steel);
    const needle = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.055, 0.004), m.black);
    needle.geometry.translate(0, 0.024, 0);
    needle.position.set(0.6, 0.9, 0.356);
    pb.dynamic(face);
    pb.dynamic(needle);
    const phase = rng.range(0, 10);
    pb.tick((t) => {
      needle.rotation.z = -0.6 + 0.25 * Math.sin(t * 1.7 + phase) + 0.08 * Math.sin(t * 7.3);
    });
    pb.soundLoop({ sound: 'pumpRoom', pos: [0, 0.5, 0], gain: 0.4, maxDist: 14, reverb: 0.3, bus: 'ambience' });
    pb.solid(-0.7, 0, -0.4, 0.7, 1.0, 0.4, 'metal');
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
    // `top: 'panel'` swaps the wood for the flat desk-panel paint (no extra textured material in a room without wood).
    const top = exec ? MAT.woodDark() : strParam(p, 'top', 'wood') === 'panel' ? MAT.deskPanel() : m.woodPanel;
    const metal = m.steelBrushed;
    const dark = MAT.deskDark();
    pb.add(rounded(w, 0.05, 0.8, 0.012), top, at(0, 0.75, 0));
    pb.add(slab(w - 0.1, 0.6, 0.03), exec ? MAT.woodDark() : MAT.deskPanel(), at(0, 0.42, 0.36));
    for (const x of [-w / 2 + 0.04, w / 2 - 0.04]) pb.add(slab(0.04, 0.73, 0.76), exec ? MAT.woodDark() : metal, at(x, 0.365, 0));
    if (exec) pb.add(slab(0.45, 0.6, 0.7), MAT.woodDark(), at(w / 2 - 0.3, 0.42, 0));
    if (boolParam(p, 'monitor', true)) {
      const screens = [
        glow('office-mon-teal', 0x56a8b8, 0.85),
        glow('office-mon-warm', 0xc9b48a, 0.78),
        glow('office-mon-blue', 0x6f9ec8, 0.85),
      ];
      const screenMat = rng.pick(screens);
      pb.add(rounded(0.62, 0.38, 0.04, 0.01), dark, at(0, 1.12, 0.18));
      pb.add(slab(0.56, 0.32, 0.005), screenMat, at(0, 1.12, 0.157));
      pb.add(slab(0.56, 0.045, 0.006), glow('office-mon-bar', 0x1c3a44, 0.55), at(0, 1.255, 0.155));
      pb.add(slab(0.018, 0.012, 0.006), glow('office-mon-led', 0x39ff9e, 1.8), at(0.25, 0.945, 0.155));
      pb.add(cylinderBetween(V(0, 0.775, 0.2), V(0, 0.93, 0.2), 0.02, 8), metal);
      pb.add(rounded(0.22, 0.012, 0.16, 0.004), metal, at(0, 0.781, 0.2));
      pb.add(rounded(0.44, 0.015, 0.14, 0.004), dark, at(0, 0.783, -0.12));
    }
    // Extra keyboard + mouse sets for a desk that faces a wall of screens instead of its own monitor (the dock security desk).
    const keyboards = Math.round(numParam(p, 'keyboards', 0));
    for (let i = 0; i < keyboards; i++) {
      const x = keyboards === 1 ? 0 : -w / 2 + 0.4 + ((w - 0.8) * i) / (keyboards - 1);
      pb.add(rounded(0.44, 0.015, 0.14, 0.004), dark, at(x, 0.783, -0.12));
      pb.add(rounded(0.06, 0.014, 0.1, 0.006), dark, at(x + 0.3, 0.783, -0.12));
    }
    const papers = Math.round(numParam(p, 'papers', 3));
    const pmats = [MAT.paper(), MAT.paperBlue(), MAT.paper()];
    for (let i = 0; i < papers; i++) pb.add(slab(0.21, 0.003 + i * 0.002, 0.297), pmats[i % 3]!, at(rng.range(-w / 2 + 0.25, w / 2 - 0.25), 0.777 + i * 0.003, rng.range(-0.25, 0.05), 0, rng.range(-0.5, 0.5), 0));
    if (rng.chance(0.6)) mugAt(pb, rng.pick([MAT.ceramic(), MAT.ceramicTeal(), MAT.ceramicRed()]), w / 2 - 0.2, 0.775, -0.2, rng.range(0, 6));
    if (exec) {
      pb.add(lathe([[0, 0], [0.08, 0], [0.02, 0.02], [0.012, 0.4], [0, 0.4]], 12), metal, at(-w / 2 + 0.2, 0.775, 0.2));
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
    for (let i = 0; i < seats; i++) {
      const x = -w / 2 + 0.2 + ((w - 0.4) / seats) * (i + 0.5);
      pb.add(rounded((w - 0.4) / seats - 0.02, 0.12, 0.6, 0.05), mat, at(x, 0.45, -0.06));
      pb.spot('sit_sofa', x, 0, -0.04, 0, 0.51); // ADR-0029: hips back against the backrest, facing out
    }
    pb.solid(-w / 2, 0, -0.43, w / 2, 0.85, 0.43, 'rubber');
  },

  /** Non-full-height partition wall (waist-high divider with steel cap rail and matching collider). */
  half_wall(p, _rng, m, pb) {
    const w = numParam(p, 'width', 3.2);
    const h = numParam(p, 'height', 1.15);
    const d = 0.2;
    const pal = resolvePalette(p, m);
    pb.add(rounded(w - 0.04, h - 0.08, d, 0.02), pal.wallMain, at(0, (h - 0.08) / 2, 0));
    pb.add(rounded(w, 0.08, d + 0.06, 0.015), m.steel, at(0, h - 0.04, 0));
    for (const sx of [-1, 1]) {
      pb.add(rounded(0.14, h, d + 0.04, 0.02), m.steel, at(sx * (w / 2 - 0.07), h / 2, 0));
    }
    for (const fz of [-1, 1]) {
      pb.add(slab(w - 0.16, 0.16, 0.02), m.steelBrushed, at(0, 0.08, fz * (d / 2 + 0.01)));
    }
    pb.solid(-w / 2, 0, -d / 2 - 0.03, w / 2, h, d / 2 + 0.03, 'metal');
  },

  /** Low lounge coffee table with steel frame and tabletop. */
  coffee_table(p, _rng, m, pb) {
    const w = numParam(p, 'width', 1.4);
    const d = numParam(p, 'depth', 0.7);
    const h = 0.44;
    pb.add(rounded(w, 0.05, d, 0.015), MAT.woodLight(), at(0, h - 0.025, 0));
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        pb.add(cylinderBetween(V(sx * (w / 2 - 0.08), 0, sz * (d / 2 - 0.08)), V(sx * (w / 2 - 0.08), h - 0.05, sz * (d / 2 - 0.08)), 0.022, 8), m.steel);
      }
    }
    pb.solid(-w / 2, 0, -d / 2, w / 2, h, d / 2, 'metal');
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

  // ---------------------------------------------------------------- dock checkpoint (dock-checkpoint spec)

  /**
   * Walk-through metal detector arch. The clear opening (`opening`, default 1.0 m) runs across local X;
   * people walk through along Z. The header's light bar idles dim amber; `detector:scan`
   * { id, result: pass|alarm } shows green for 1 s or a pulsing red for 1.5 s, then idles again.
   */
  metal_detector(p, _rng, m, pb) {
    const id = strParam(p, 'id', 'arch');
    const open = Math.max(0.9, numParam(p, 'opening', 1.0));
    const h = 2.2;
    const pw = 0.16;
    const d = 0.55;
    const px = open / 2 + pw / 2;
    for (const s of [-1, 1]) {
      pb.add(rounded(pw, h, d, 0.03), m.steelBrushed, at(s * px, h / 2, 0));
      pb.add(rounded(pw + 0.03, 0.1, d + 0.05, 0.02), m.steelDark, at(s * px, 0.05, 0));
      // Sensor strip down each inner face.
      pb.add(slab(0.01, h - 0.5, 0.05), m.steelDark, at(s * (open / 2 + 0.003), h / 2 + 0.05, 0));
      pb.solid(s * px - pw / 2, 0, -d / 2, s * px + pw / 2, h, d / 2, 'metal');
    }
    const hw = open + pw * 2;
    pb.add(rounded(hw, 0.24, d, 0.03), m.steelDark, at(0, h + 0.12, 0));
    pb.add(slab(hw - 0.08, 0.03, d + 0.01), m.steelBrushed, at(0, h + 0.012, 0));
    pb.solid(-hw / 2, h, -d / 2, hw / 2, h + 0.24, d / 2, 'metal');
    // Small status panel on the station-side face (+Z face is the exit side).
    pb.add(rounded(0.22, 0.14, 0.03, 0.01), m.steelDark, at(px, 1.45, d / 2 + 0.01));
    pb.add(slab(0.16, 0.08, 0.005), glow('detector-panel', 0x4fd6d0, 1.2), at(px, 1.45, d / 2 + 0.027));

    const bar = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: DETECTOR_IDLE, emissiveIntensity: 0.5, roughness: 0.4 });
    bar.name = 'detector-bar';
    const barMesh = new THREE.Mesh(new THREE.BoxGeometry(open * 0.8, 0.05, d + 0.02), bar);
    barMesh.position.set(0, h + 0.13, 0);
    barMesh.name = `detector:${id}`;
    pb.dynamic(barMesh);
    let state: 'idle' | 'pass' | 'alarm' = 'idle';
    let now = 0;
    let until = 0;
    const show = (): void => {
      bar.emissive.setHex(state === 'pass' ? DETECTOR_PASS : state === 'alarm' ? DETECTOR_ALARM : DETECTOR_IDLE);
      bar.emissiveIntensity = state === 'idle' ? 0.5 : 3;
    };
    barMesh.userData['detectorState'] = (): string => state;
    pb.tick((t) => {
      now = t;
      if (state !== 'idle' && t >= until) {
        state = 'idle';
        show();
      } else if (state === 'alarm') {
        bar.emissiveIntensity = 1.5 + 1.5 * (0.5 + 0.5 * Math.sin(t * 18));
      }
    });
    pb.on('detector:scan', (e) => {
      const ev = e as { id?: string; result?: string } | undefined;
      if (ev?.id !== id || (ev.result !== 'pass' && ev.result !== 'alarm')) return;
      state = ev.result;
      until = now + (state === 'pass' ? 1 : 1.5);
      show();
    });
  },

  /** Waist-high barrier rail along local X (`length`, default 1.5 m; `height`, default 1.0 m), posts about every metre. */
  rail(p, _rng, m, pb) {
    const len = numParam(p, 'length', 1.5);
    const h = Math.min(1.2, numParam(p, 'height', 1.0));
    const posts = Math.max(2, Math.ceil(len / 1.0) + 1);
    for (let i = 0; i < posts; i++) {
      const x = -len / 2 + (len * i) / (posts - 1);
      pb.add(cylinderBetween(V(x, 0, 0), V(x, h, 0), 0.03, 10), m.steelBrushed);
      pb.add(new THREE.CylinderGeometry(0.09, 0.1, 0.03, 14), m.steelDark, at(x, 0.015, 0));
    }
    pb.add(cylinderBetween(V(-len / 2, h, 0), V(len / 2, h, 0), 0.025, 10), m.steelBrushed);
    pb.add(cylinderBetween(V(-len / 2, h * 0.55, 0), V(len / 2, h * 0.55, 0), 0.018, 8), m.steelBrushed);
    pb.add(slab(len - 0.08, 0.09, 0.012), m.cleanTeal, at(0, h * 0.78, 0));
    pb.solid(-len / 2 - 0.05, 0, -0.06, len / 2 + 0.05, h, 0.06, 'metal');
  },

  /** A closed staff gate across local X (`width`, default 1.2 m). Decoration only: it never opens (design.md §4). */
  staff_gate(p, _rng, m, pb) {
    const w = numParam(p, 'width', 1.2);
    const h = 1.0;
    for (const s of [-1, 1]) {
      pb.add(rounded(0.09, h + 0.05, 0.09, 0.02), m.steelDark, at(s * (w / 2 - 0.045), (h + 0.05) / 2, 0));
    }
    const lw = w - 0.2;
    for (const y of [0.15, h - 0.05]) pb.add(cylinderBetween(V(-lw / 2, y, 0), V(lw / 2, y, 0), 0.022, 8), m.steelBrushed);
    for (const x of [-lw / 2, lw / 2]) pb.add(cylinderBetween(V(x, 0.15, 0), V(x, h - 0.05, 0), 0.022, 8), m.steelBrushed);
    for (let i = 1; i < 6; i++) {
      const x = -lw / 2 + (lw * i) / 6;
      pb.add(cylinderBetween(V(x, 0.15, 0), V(x, h - 0.05, 0), 0.01, 6), m.steelBrushed);
    }
    pb.add(rounded(0.36, 0.14, 0.012, 0.005), m.cleanTeal, at(0, h * 0.62, -0.02));
    pb.add(rounded(0.36, 0.14, 0.012, 0.005), m.cleanTeal, at(0, h * 0.62, 0.02));
    pb.solid(-w / 2, 0, -0.07, w / 2, h + 0.05, 0.07, 'metal');
  },

  /** Inspection tray table on the arrivals side of the detector, with a few grey trays. */
  tray_table(_p, rng, m, pb) {
    const w = 0.9;
    const d = 0.5;
    const h = 0.82;
    pb.add(rounded(w, 0.04, d, 0.01), m.steelBrushed, at(0, h - 0.02, 0));
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) pb.add(cylinderBetween(V(sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.05)), V(sx * (w / 2 - 0.05), h - 0.04, sz * (d / 2 - 0.05)), 0.018, 8), m.steel);
    }
    pb.add(slab(w - 0.1, 0.02, d - 0.1), m.steelDark, at(0, 0.2, 0));
    for (let i = 0; i < 3; i++) {
      const tray = m.steelDark;
      const y = h + 0.03 + i * 0.045;
      pb.add(rounded(0.42, 0.04, 0.32, 0.01), tray, at(-0.18 + rng.range(-0.02, 0.02), y, rng.range(-0.02, 0.02), 0, rng.range(-0.05, 0.05), 0));
    }
    pb.add(rounded(0.42, 0.04, 0.32, 0.01), m.steelDark, at(0.22, h + 0.03, 0.02, 0, 0.08, 0));
    pb.solid(-w / 2, 0, -d / 2, w / 2, h + 0.16, d / 2, 'metal');
  },

  /**
   * Wall bank of six camera feeds, 3 across x 2 high (`width` m overall), back on z = 0, facing -Z (rot 0 on a south wall). All six
   * tiles share one canvas screen (one draw call). The live tile (`live`, default index 1, the top middle) shows
   * the `camera` label and follows `camera:feed` { id, state } like `security_monitor`; the others loop. The bank
   * is named `cctv:<id>`, not `feed:<id>`, so a `cameraFeed` remote render does not take over the whole wall.
   */
  cctv_wall(p, rng, m, pb) {
    const id = strParam(p, 'id', 'cam');
    const live = Math.max(0, Math.min(5, Math.round(numParam(p, 'live', 1))));
    const labels = strParam(p, 'labels', 'CAM 01  DOCK RING|CAM 02  DOCK AIRLOCK|CAM 03  RING WALK|CAM 04  COMMONS|CAM 05  LAB B CORRIDOR|CAM 06  DIVE BAY').split('|');
    labels[live] = strParam(p, 'camera', labels[live] ?? 'CAM 02  DOCK AIRLOCK');
    let feed = strParam(p, 'feed', 'live');
    // `width` (default 2.1 m) sets the bank's overall width; tiles keep a 0.62:0.44 shape. Fit it between a wall's pilasters.
    const gap = 0.06;
    const tw = (Math.max(1.2, numParam(p, 'width', 2.1)) - gap * 4) / 3;
    const th = tw * (0.44 / 0.62);
    const y0 = numParam(p, 'y', 1.25);
    const W = tw * 3 + gap * 4;
    const H = th * 2 + gap * 3;
    pb.add(rounded(W, H, 0.1, 0.02), m.steelDark, at(0, y0 + H / 2, -0.05));
    pb.add(slab(W - 0.1, 0.02, 0.06), m.steelBrushed, at(0, y0 + 0.02, -0.11));
    const tile = (i: number): [number, number] => [-W / 2 + gap + tw / 2 + (i % 3) * (tw + gap), y0 + H - gap - th / 2 - Math.floor(i / 3) * (th + gap)];
    for (let i = 0; i < 6; i++) {
      const [x, y] = tile(i);
      pb.add(rounded(tw + 0.03, th + 0.03, 0.03, 0.008), m.steelDark, at(x, y, -0.105));
    }
    const PX = 220;
    const PY = Math.round((PX * th) / tw);
    const canvasW = PX * 3;
    const canvasH = PY * 2;
    const phases = Array.from({ length: 6 }, (_, i) => (i === live ? 0 : rng.range(0, 40)));
    const bank = new CanvasScreen(canvasW, canvasH, (ctx, t) => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvasW, canvasH);
      for (let i = 0; i < 6; i++) {
        ctx.save();
        ctx.translate((i % 3) * PX, Math.floor(i / 3) * PY);
        ctx.beginPath();
        ctx.rect(0, 0, PX, PY);
        ctx.clip();
        drawCameraFeed(ctx, t + phases[i]!, PX, PY, i === live ? feed : 'live', labels[i] ?? `CAM 0${i + 1}`);
        ctx.restore();
      }
    }, 1.25, 6);
    // One mesh for the bank: each tile's quad maps its own region of the canvas.
    const geos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) {
      const [x, y] = tile(i);
      const g = new THREE.PlaneGeometry(tw, th);
      const u0 = (i % 3) / 3;
      const v0 = 0.5 - Math.floor(i / 3) / 2;
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) / 3, v0 + uv.getY(k) / 2);
      g.rotateY(PI);
      g.translate(x, y, -0.125);
      geos.push(g);
    }
    const bankMesh = new THREE.Mesh(mergeGeometries(geos)!, bank.material);
    bankMesh.name = `cctv:${id}`;
    bankMesh.userData['feedState'] = (): string => feed;
    pb.dynamic(bankMesh);
    pb.tick((t) => bank.update(t));
    pb.on('camera:feed', (e) => {
      const ev = e as { id?: string; state?: string } | undefined;
      if (ev?.id === id && typeof ev.state === 'string') feed = ev.state;
    });
    pb.solid(-W / 2, y0, -0.16, W / 2, y0 + H, 0);
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
    pb.add(new THREE.SphereGeometry(0.012, 6, 4), m.steelBrushed, at(-w / 2 + 0.32, y + 0.31, -0.065));
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
    const needle = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.085, 0.004), m.black);
    needle.geometry.translate(0, 0.04, 0);
    needle.position.set(0.55, y + 0.35, -0.07);
    needle.rotation.z = 2.2;
    const wheel = new THREE.Group();
    const wb = new AoMergeBuilder();
    wb.add(new THREE.TorusGeometry(r, 0.035, 10, 36), m.paintTeal);
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
    // A notice on the first panel, lines split by '|' (overhaul-priya-r08-death D27, the medical deck lockdown order).
    const notice = strParam(p, 'notice', '').split('|').filter((s) => s !== '');
    const pal = resolvePalette(p, m);
    const clean = pal.doorPanel !== m.paintDark;
    const bodyMat = clean ? pal.doorPanel : m.paintDark;
    const trimMat = clean ? m.steelBrushed : m.steel;
    pb.add(rounded(w, 0.85, 0.75, 0.03), bodyMat, at(0, 0.425, 0));
    pb.add(rounded(w + 0.1, 0.05, 0.9, 0.015), trimMat, at(0, 0.875, -0.05));
    for (let i = 0; i < Math.floor(w / 0.5); i++) pb.add(slab(0.03, 0.012, 0.03), glow('bank-amber', 0xffa21a, 2.2), at(-w / 2 + 0.25 + i * 0.5, 0.906, -0.25));
    pb.add(rounded(w - 0.2, 0.04, 0.28, 0.01), m.rubber, at(0, 0.92, -0.18));
    const screen = new CanvasScreen(1024, 192, (ctx, t, cw, ch) => drawBank(ctx, t, cw, ch, mode, notice), 1.3, 6);
    pb.add(rounded(w - 0.1, 0.6, 0.1, 0.02), bodyMat, at(0, 1.4, 0.28, 0.2, 0, 0));
    const disp = screenPlane(screen.material, w - 0.2, 0.5, 0, 1.4, 0.225);
    disp.rotation.x = 0.2;
    pb.dynamic(disp);
    pb.add(cylinderBetween(V(0, 0.9, 0.3), V(0, 1.12, 0.3), 0.04), trimMat);
    pb.tick((t) => screen.update(t));
    pb.solid(-w / 2, 0, -0.48, w / 2, 1.0, 0.4, 'metal');
  },

  armory_rack(p, _rng, m, pb) {
    const w = numParam(p, 'width', 2);
    const pal = resolvePalette(p, m);
    const clean = pal.doorPanel !== m.paintDark;
    const frameMat = clean ? m.steelBrushed : m.steel;
    const stockMat = clean ? pal.doorPanel : m.paintDark;
    const caseMat = clean ? m.cleanTeal : m.paintTeal;
    pb.add(slab(w, 2.0, 0.08), m.grating, at(0, 1.1, 0.2));
    for (const x of [-w / 2, w / 2]) pb.add(slab(0.06, 2.2, 0.5), frameMat, at(x, 1.1, 0));
    pb.add(slab(w, 0.05, 0.5), frameMat, at(0, 0.5, 0));
    if (clean) {
      pb.add(slab(w, 0.05, 0.44), frameMat, at(0, 2.18, 0.02));
      pb.add(slab(w - 0.2, 0.025, 0.05), glow('rack-strip', 0xeaf4ff, 1.6), at(0, 2.14, -0.14));
    }
    const empty = Math.round(numParam(p, 'empty', 1));
    const slots = Math.max(2, Math.floor(w / 0.35));
    for (let i = 0; i < slots; i++) {
      const x = -w / 2 + 0.2 + i * ((w - 0.4) / (slots - 1));
      pb.add(slab(0.08, 0.06, 0.12), m.rubber, at(x, 1.85, 0.1));
      pb.add(slab(0.08, 0.06, 0.12), m.rubber, at(x, 0.62, 0.1));
      if (i < empty) continue;
      pb.add(slab(0.05, 1.05, 0.12), m.black, at(x, 1.2, 0.06));
      pb.add(slab(0.06, 0.25, 0.18), stockMat, at(x, 0.85, 0.04));
    }
    for (let i = 0; i < 3; i++) pb.add(rounded(0.3, 0.18, 0.22, 0.01), caseMat, at(-w / 2 + 0.3 + i * 0.36, 0.09, -0.05));
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
      pb.spot('sit_chair', x, 0, z, side < 0 ? PI : 0, 0.49); // ADR-0029: facing the table
    }
    for (let i = 0; i < Math.round(numParam(p, 'mugs', 1)); i++) mugAt(pb, rng.pick([MAT.ceramic(), MAT.ceramicTeal()]), rng.range(-w / 2 + 0.2, w / 2 - 0.2), 0.765, rng.range(-0.3, 0.3), rng.range(0, 6));
    if (boolParam(p, 'caddy', false)) {
      // Napkin holder and a salt / pepper pair in the middle of the table.
      pb.add(rounded(0.14, 0.1, 0.07, 0.008), m.steel, at(0, 0.815, 0));
      pb.add(slab(0.12, 0.06, 0.05), MAT.paper(), at(0, 0.87, 0));
      for (const [sx, mat] of [[-0.12, MAT.ceramic()], [0.12, MAT.potDark()]] as const) pb.add(lathe([[0, 0], [0.018, 0], [0.02, 0.06], [0.012, 0.075], [0, 0.075]], 10), mat, at(sx, 0.765, 0.02));
    }
    pb.solid(-w / 2, 0, -d / 2, w / 2, 0.77, d / 2, 'metal');
  },

  lab_bench(p, rng, m, pb) {
    const w = numParam(p, 'width', 2.4);
    const pal = resolvePalette(p, m);
    const clean = pal.doorPanel !== m.paintDark;
    const bodyMat = clean ? m.cleanWall : m.paintBone;
    const scopeMat = clean ? pal.doorPanel : m.paintDark;
    pb.add(rounded(w, 0.05, 0.75, 0.01), MAT.stone(), at(0, 0.9, 0));
    pb.add(slab(w - 0.04, 0.86, 0.68), bodyMat, at(0, 0.44, 0.02));
    pb.add(slab(w, 0.7, 0.03), bodyMat, at(0, 1.45, 0.36));
    pb.add(slab(w, 0.03, 0.3), m.steel, at(0, 1.6, 0.22));
    const glassy = [MAT.ceramic(), MAT.ceramicTeal(), MAT.plastic()];
    for (let i = 0; i < 7; i++) {
      const x = rng.range(-w / 2 + 0.2, w / 2 - 0.2);
      const r = rng.range(0.03, 0.06);
      const h = rng.range(0.08, 0.22);
      pb.add(lathe([[0, 0], [r, 0], [r, h], [r * 0.5, h + 0.03], [0, h + 0.03]], 12), rng.pick(glassy), at(x, 0.925, rng.range(-0.25, 0.1)));
    }
    // A microscope-ish instrument and a sample rack.
    pb.add(rounded(0.3, 0.06, 0.3, 0.01), scopeMat, at(-w / 4, 0.955, 0));
    pb.add(cylinderBetween(V(-w / 4, 0.98, 0.08), V(-w / 4, 1.3, 0.0), 0.035, 10), scopeMat);
    pb.add(cylinderBetween(V(-w / 4, 1.25, 0.0), V(-w / 4, 1.18, -0.12), 0.03, 10), m.black);
    pb.add(rounded(0.4, 0.08, 0.14, 0.01), m.steel, at(w / 4, 0.965, 0.1));
    for (let i = 0; i < 6; i++) pb.add(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 8), rng.pick([MAT.ceramicRed(), MAT.leafLight(), MAT.ceramicTeal()]), at(w / 4 - 0.15 + i * 0.06, 1.02, 0.1));
    pb.spot('work_bench', 0, 0, -0.38 - 0.56, PI);
    pb.spot('work_bench', 0, 0, 0.38 + 0.56, 0);
    pb.solid(-w / 2, 0, -0.38, w / 2, 0.93, 0.38, 'metal');
  },

  storage_shelf(p, rng, m, pb) {
    const w = numParam(p, 'width', 2);
    const h = 2.1;
    const d = 0.55;
    const pal = resolvePalette(p, m);
    const clean = pal.doorPanel !== m.paintDark;
    for (const x of [-w / 2 + 0.03, w / 2 - 0.03]) for (const z of [-d / 2 + 0.03, d / 2 - 0.03]) pb.add(slab(0.05, h, 0.05), m.steel, at(x, h / 2, z));
    const mats = clean ? [m.cleanTeal, m.cleanWall, MAT.plastic(), MAT.cork()] : [m.paintTeal, m.paintBone, MAT.plastic(), MAT.cork()];
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

  /**
   * Steel instrument cart (medbay-attack spec, R08): about 1.0 x 0.55 m, a lipped top at 0.9 m, a lower shelf, casters,
   * a push handle on the +X end and a few instruments. Long side along X. The top is the slam target (`r08_cart_top`).
   */
  instrument_cart(p, rng, m, pb) {
    const w = numParam(p, 'width', 1.0);
    const d = 0.55;
    const top = 0.9;
    for (const x of [-w / 2 + 0.03, w / 2 - 0.03]) for (const z of [-d / 2 + 0.03, d / 2 - 0.03]) {
      pb.add(cylinderBetween(V(x, 0.1, z), V(x, top - 0.02, z), 0.016, 8), m.steel);
      pb.add(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 12), m.rubber, at(x, 0.04, z, PI / 2, 0, 0));
      pb.add(slab(0.03, 0.05, 0.03), m.steel, at(x, 0.085, z));
    }
    // Top: a flat steel tray with a low lip, and a lower shelf.
    pb.add(rounded(w, 0.025, d, 0.006), m.steel, at(0, top - 0.0125, 0));
    for (const z of [-d / 2 + 0.008, d / 2 - 0.008]) pb.add(slab(w, 0.025, 0.016), m.steel, at(0, top + 0.0125, z));
    for (const x of [-w / 2 + 0.008, w / 2 - 0.008]) pb.add(slab(0.016, 0.025, d), m.steel, at(x, top + 0.0125, 0));
    pb.add(slab(w - 0.04, 0.02, d - 0.04), m.steel, at(0, 0.28, 0));
    // Push handle on the +X end.
    pb.add(cylinderBetween(V(w / 2 + 0.06, top - 0.02, -d / 2 + 0.06), V(w / 2 + 0.06, top - 0.02, d / 2 - 0.06), 0.012, 8), m.steel);
    for (const z of [-d / 2 + 0.06, d / 2 - 0.06]) pb.add(cylinderBetween(V(w / 2 - 0.02, top - 0.02, z), V(w / 2 + 0.06, top - 0.02, z), 0.01, 6), m.steel);
    // Instruments: a kidney dish, a wrapped pack, a few thin tools, and a box and a basin on the shelf.
    pb.add(lathe([[0, 0], [0.09, 0], [0.11, 0.035], [0.1, 0.04], [0, 0.04]], 14), m.steel, at(-w / 4, top + 0.002, rng.range(-0.08, 0.04)));
    pb.add(rounded(0.22, 0.04, 0.16, 0.01), MAT.paper(), at(w / 5, top + 0.02, 0.08, 0, rng.range(-0.3, 0.3), 0));
    for (let i = 0; i < 4; i++) pb.add(slab(0.14, 0.006, 0.012), m.steel, at(rng.range(-0.05, 0.2), top + 0.005, rng.range(-0.18, -0.06), 0, rng.range(-0.6, 0.6), 0));
    pb.add(rounded(0.3, 0.12, 0.2, 0.01), m.cleanWall, at(-w / 5, 0.35, 0));
    pb.add(lathe([[0, 0], [0.12, 0], [0.14, 0.06], [0, 0.06]], 14), m.steel, at(w / 4, 0.29, 0));
    pb.solid(-w / 2, 0, -d / 2, w / 2, top + 0.025, d / 2, 'metal');
  },

  // ---------------------------------------------------------------- commons galley + lounge (R02)

  /** Hot food line: steel body, teal fascia, recessed hot wells with food, sloped sneeze guard, heat lamps, tray slide on the customer (-Z) side. */
  servery(p, rng, m, pb) {
    const w = numParam(p, 'width', 3.6);
    const d = 0.78;
    const h = 0.9;
    pb.add(slab(w, h - 0.1, d - 0.08), m.steel, at(0, (h - 0.1) / 2 + 0.1, 0.02));
    pb.add(slab(w - 0.04, 0.1, d - 0.14), m.black, at(0, 0.05, 0.04));
    const bays = Math.max(1, Math.round(w / 0.9));
    const bw = w / bays;
    for (let i = 0; i < bays; i++) pb.add(rounded(bw - 0.05, h - 0.26, 0.02, 0.005), MAT.tealGloss(), at(-w / 2 + bw * (i + 0.5), 0.14 + (h - 0.26) / 2, -d / 2 + 0.01));
    pb.add(rounded(w + 0.04, 0.04, d + 0.02, 0.008), m.steel, at(0, h - 0.02, 0));
    // Hot wells: a dark pan with a steel lip, the food and a serving spoon.
    const pans = Math.max(1, Math.round(numParam(p, 'pans', Math.floor((w - 0.3) / 0.7))));
    const pw = (w - 0.3) / pans;
    const foods = [MAT.foodStew(), MAT.foodGreens(), MAT.foodRice(), MAT.foodSauce(), MAT.foodPotato()];
    const off = Math.floor(rng.range(0, foods.length));
    for (let i = 0; i < pans; i++) {
      const x = -w / 2 + 0.15 + pw * (i + 0.5);
      pb.add(slab(pw - 0.06, 0.006, 0.46), m.black, at(x, h + 0.003, 0.02));
      for (const s of [-1, 1]) {
        pb.add(slab(pw - 0.04, 0.014, 0.02), m.steel, at(x, h + 0.007, 0.02 + s * 0.24));
        pb.add(slab(0.02, 0.014, 0.5), m.steel, at(x + s * (pw / 2 - 0.02), h + 0.007, 0.02));
      }
      const food = foods[(i + off) % foods.length]!;
      pb.add(slab(pw - 0.1, 0.012, 0.42), food, at(x, h + 0.008, 0.02));
      for (let k = 0; k < 6; k++) {
        const g = new THREE.SphereGeometry(rng.range(0.025, 0.045), 7, 5);
        g.scale(1, 0.45, 1);
        pb.add(g, food, at(x + rng.range(-pw / 2 + 0.09, pw / 2 - 0.09), h + 0.016, 0.02 + rng.range(-0.15, 0.15)));
      }
      pb.add(cylinderBetween(V(x + pw * 0.15, h + 0.02, -0.06), V(x + pw * 0.3, h + 0.17, 0.2), 0.008, 6), m.steel);
    }
    // Sneeze guard: posts, a sloped pane leaning out over the wells, a shelf with heat lamps under it.
    const posts = Math.max(2, Math.round(w / 1.8) + 1);
    for (let i = 0; i < posts; i++) pb.add(cylinderBetween(V(-w / 2 + 0.06 + ((w - 0.12) * i) / (posts - 1), h, 0.12), V(-w / 2 + 0.06 + ((w - 0.12) * i) / (posts - 1), 1.47, 0.12), 0.018, 8), m.steel);
    pb.add(slab(w - 0.08, 0.44, 0.008), m.glass, at(0, 1.2, -0.12, 0.45, 0, 0));
    pb.add(rounded(w, 0.03, 0.4, 0.008), m.steel, at(0, 1.47, 0.05));
    for (let i = 0; i < pans; i++) pb.add(rounded(pw - 0.2, 0.06, 0.12, 0.01), m.paintDark, at(-w / 2 + 0.15 + pw * (i + 0.5), 1.42, 0.05));
    pb.add(slab(w - 0.3, 0.012, 0.06), glow('heat-lamp', 0xff8a3a, 2.2), at(0, 1.385, 0.05));
    // Tray slide on the customer side.
    for (let k = 0; k < 3; k++) pb.add(cylinderBetween(V(-w / 2 + 0.05, 0.84, -d / 2 - 0.1 - k * 0.07), V(w / 2 - 0.05, 0.84, -d / 2 - 0.1 - k * 0.07), 0.012, 8), m.steel);
    for (let i = 0; i <= Math.ceil(w / 1.2); i++) {
      const x = -w / 2 + 0.1 + ((w - 0.2) * i) / Math.ceil(w / 1.2);
      pb.add(slab(0.03, 0.03, 0.26), m.steel, at(x, 0.825, -d / 2 - 0.13));
    }
    // Soft rising steam across the hot food wells.
    steamPlume(pb, rng, { x: 0, y: h + 0.05, z: 0.0, width: Math.max(0.6, w - 0.5), depth: 0.36, height: 0.48, count: 38, opacity: 0.16, size: 0.16 });
    pb.solid(-w / 2, 0, -d / 2 - 0.28, w / 2, 0.95, d / 2, 'metal');
    pb.solid(-w / 2, 0.95, -0.2, w / 2, 1.5, d / 2);
    pb.spot('lean_counter', -Math.min(0.8, w * 0.22), 0, -d / 2 - 0.66, PI);
    pb.spot('lean_counter', Math.min(0.8, w * 0.22), 0, -d / 2 - 0.66, PI);
    pb.nav(0, 0, -d / 2 - 0.9);
  },

  /** Backlit galley menu board, wall-mounted (back on z = 0). */
  menu_board(p, _rng, m, pb) {
    const w = numParam(p, 'width', 3.2);
    const h = numParam(p, 'height', 1);
    const y = numParam(p, 'y', 2.95);
    pb.add(rounded(w + 0.1, h + 0.1, 0.08, 0.015), m.paintDark, at(0, y, -0.04));
    pb.add(slab(w + 0.14, 0.025, 0.1), glow('menu-edge', 0xffe9c8, 1.4), at(0, y + h / 2 + 0.065, -0.05));
    pb.dynamic(screenPlane(menuMat(strParam(p, 'title', 'GALLEY'), w / h), w, h, 0, y, -0.082));
    pb.solid(-w / 2 - 0.05, y - h / 2 - 0.05, -0.09, w / 2 + 0.05, y + h / 2 + 0.05, 0);
  },

  /** Self-serve drinks: low cabinet, three-tap juice dispenser, water cooler, cups, a tray stack and cutlery. Front faces -Z. */
  drink_station(p, rng, m, pb) {
    const w = numParam(p, 'width', 1.8);
    const d = 0.62;
    const h = 0.9;
    pb.add(slab(w, h - 0.1, d - 0.04), MAT.plastic(), at(0, (h - 0.1) / 2 + 0.1, 0.02));
    pb.add(slab(w - 0.02, 0.1, d - 0.1), m.black, at(0, 0.05, 0.04));
    for (const s of [-1, 1]) {
      pb.add(rounded(w / 2 - 0.03, h - 0.22, 0.02, 0.005), MAT.plastic(), at(s * (w / 4), 0.5, -d / 2 + 0.005));
      pb.add(rounded(0.14, 0.018, 0.025, 0.006), m.steel, at(s * 0.1, h - 0.2, -d / 2 - 0.012));
    }
    pb.add(rounded(w + 0.03, 0.04, d + 0.02, 0.008), MAT.stone(), at(0, h - 0.02, 0));
    // Juice dispenser.
    const dx = -w / 2 + 0.4;
    pb.add(rounded(0.62, 0.64, 0.4, 0.02), m.steel, at(dx, h + 0.32, 0.06));
    const juices = [MAT.juiceOrange(), MAT.juiceGreen(), MAT.waterJug()];
    for (let i = 0; i < 3; i++) {
      const x = dx - 0.2 + i * 0.2;
      pb.add(rounded(0.16, 0.3, 0.012, 0.006), juices[i]!, at(x, h + 0.44, -0.145));
      pb.add(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 8), m.black, at(x, h + 0.2, -0.15));
    }
    pb.add(slab(0.56, 0.04, 0.01), glow('dispenser', 0xcfefff, 1.6), at(dx, h + 0.66, -0.145));
    pb.add(slab(0.52, 0.012, 0.2), m.grating, at(dx, h + 0.006, -0.12));
    // Water cooler: base and an upturned jug.
    const wx = w / 2 - 0.26;
    pb.add(rounded(0.3, 0.32, 0.3, 0.03), MAT.plastic(), at(wx, h + 0.16, 0.06));
    pb.add(lathe([[0, 0], [0.13, 0.02], [0.14, 0.28], [0.06, 0.36], [0.03, 0.4], [0, 0.4]], 16), MAT.waterJug(), at(wx, h + 0.72, 0.06, PI, 0, 0));
    pb.add(new THREE.CylinderGeometry(0.012, 0.012, 0.05, 8), m.paintTeal, at(wx - 0.05, h + 0.2, -0.1, PI / 2, 0, 0));
    // Cup stacks, trays, cutlery caddy, napkins.
    for (let i = 0; i < 3; i++) {
      const n = 4 + Math.floor(rng.range(0, 4));
      pb.add(lathe([[0, 0], [0.035, 0], [0.045, 0.09 + n * 0.012], [0, 0.09 + n * 0.012]], 12), MAT.paper(), at(dx + 0.42 + i * 0.1, h, -0.16));
    }
    for (let i = 0; i < 7; i++) pb.add(rounded(0.46, 0.018, 0.34, 0.006), m.paintDark, at(0.12, h + 0.01 + i * 0.022, 0.02, 0, rng.range(-0.03, 0.03), 0));
    pb.add(rounded(0.26, 0.12, 0.12, 0.01), m.steel, at(wx - 0.02, h + 0.06, -0.2));
    for (let i = 0; i < 9; i++) pb.add(cylinderBetween(V(wx - 0.1 + (i % 3) * 0.08, h + 0.08, -0.22 + Math.floor(i / 3) * 0.04), V(wx - 0.1 + (i % 3) * 0.08 + 0.01, h + 0.2, -0.22 + Math.floor(i / 3) * 0.04), 0.005, 4), m.steel);
    pb.solid(-w / 2, 0, -d / 2, w / 2, h + 0.72, d / 2, 'metal');
    pb.spot('lean_counter', 0, 0, -d / 2 - 0.46, PI);
  },

  /** Waste and recycling bins in a steel frame, coloured lids. Front faces -Z. */
  bin_station(p, _rng, m, pb) {
    const n = Math.max(1, Math.round(numParam(p, 'count', 3)));
    const W = n * 0.52 + 0.08;
    const lids = [MAT.ceramicTeal(), MAT.suitYellow(), MAT.potWhite()];
    pb.add(slab(W, 1.0, 0.03), m.steel, at(0, 0.5, 0.26));
    for (const s of [-1, 1]) pb.add(slab(0.03, 1.0, 0.56), m.steel, at(s * (W / 2 - 0.015), 0.5, 0));
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + 0.3 + i * 0.52;
      pb.add(rounded(0.46, 0.84, 0.5, 0.04), MAT.potDark(), at(x, 0.42, 0));
      pb.add(rounded(0.48, 0.05, 0.52, 0.02), lids[i % lids.length]!, at(x, 0.865, 0));
      pb.add(slab(0.24, 0.012, 0.08), m.black, at(x, 0.89, -0.08));
    }
    pb.solid(-W / 2, 0, -0.28, W / 2, 1.0, 0.28, 'metal');
  },

  /** Floor rug: border band, woven field, two stripes. Sits on the floor (no collider); soft footsteps. */
  rug(p, _rng, _m, pb) {
    const w = numParam(p, 'width', 3);
    const d = numParam(p, 'depth', 2);
    const field = strParam(p, 'tone', 'teal') === 'warm' ? MAT.rugWarm() : MAT.rugTeal();
    pb.add(slab(w, 0.008, d), MAT.carpetBorder(), at(0, 0.004, 0));
    pb.add(slab(w - 0.24, 0.011, d - 0.24), field, at(0, 0.0055, 0));
    for (const s of [-1, 1]) pb.add(slab(w - 0.5, 0.014, 0.06), MAT.rugStripe(), at(0, 0.007, s * (d / 2 - 0.3)));
    pb.surfaces.push({ box: { min: [-w / 2, -0.05, -d / 2], max: [w / 2, 0.014, d / 2] }, material: 'rubber' });
  },

  /** Executive boardroom conference table: dark wood top, steel cable tray, high-back chairs with `sit_chair` spots, laptops, folders and water service. */
  conference_table(p, rng, m, pb) {
    const w = numParam(p, 'width', 4.4);
    const d = numParam(p, 'depth', 1.3);
    const h = 0.75;
    // Executive dark wood tabletop + brushed steel centre cable channel.
    pb.add(rounded(w, 0.06, d, 0.02), MAT.woodDark(), at(0, h - 0.03, 0));
    pb.add(rounded(w - 0.8, 0.012, 0.18, 0.004), m.steelBrushed, at(0, h + 0.002, 0));
    // Twin architectural pedestal bases.
    for (const x of [-w / 2 + 0.85, w / 2 - 0.85]) {
      pb.add(rounded(0.22, h - 0.08, d - 0.42, 0.02), MAT.woodDark(), at(x, (h - 0.08) / 2 + 0.02, 0));
      pb.add(rounded(0.5, 0.03, d - 0.28, 0.01), m.steelBrushed, at(x, 0.015, 0));
    }
    pb.add(slab(w - 1.8, 0.14, 0.12), m.steelBrushed, at(0, 0.32, 0));
    // Central conference phone puck + water carafe and glasses.
    pb.add(new THREE.CylinderGeometry(0.11, 0.13, 0.035, 16), MAT.deskDark(), at(0, h + 0.018, 0));
    pb.add(slab(0.05, 0.006, 0.03), glow('conf-led', 0x39ff9e, 1.8), at(0, h + 0.037, 0));
    pb.add(lathe([[0, 0], [0.055, 0], [0.06, 0.14], [0.038, 0.22], [0.044, 0.25], [0, 0.25]], 14), MAT.waterJug(), at(0.45, h, 0.04));
    for (const gx of [0.28, 0.62]) pb.add(lathe([[0, 0], [0.028, 0], [0.032, 0.09], [0, 0.09]], 10), MAT.ceramic(), at(gx, h, -0.06));

    const sidePer = Math.max(1, Math.round(numParam(p, 'sideSeats', 3)));
    const endEast = boolParam(p, 'endEast', true);
    const placeChair = (x: number, z: number, yaw: number): void => {
      const f = at(x, 0, z, 0, yaw, 0);
      // Local -Z faces the table; backrest sits on +Z behind the seated torso so it never clips.
      pb.add(rounded(0.48, 0.07, 0.46, 0.03), MAT.deskDark(), inFrame(f, 0, 0.455, 0));
      pb.add(rounded(0.46, 0.52, 0.06, 0.025), MAT.deskDark(), inFrame(f, 0, 0.78, 0.22, -0.1, 0, 0));
      for (const sx of [-0.25, 0.25]) pb.add(rounded(0.04, 0.03, 0.34, 0.01), m.steelBrushed, inFrame(f, sx, 0.63, 0.03));
      pb.add(cylinderBetween(V(x, 0.07, z), V(x, 0.43, z), 0.028, 8), m.steelBrushed);
      for (let k = 0; k < 5; k++) {
        const a = (k * 2 * PI) / 5 + yaw;
        pb.add(cylinderBetween(V(x, 0.07, z), V(x + Math.cos(a) * 0.26, 0.03, z + Math.sin(a) * 0.26), 0.016, 6), m.steelBrushed);
      }
      pb.solid(x - 0.26, 0, z - 0.26, x + 0.26, 1.04, z + 0.26, 'rubber');
      pb.spot('sit_chair', x, 0, z, yaw, 0.49);
    };

    const pmats = [MAT.paper(), MAT.paperBlue(), MAT.paper()];
    for (let k = 0; k < sidePer; k++) {
      const x = -w / 2 + (w / sidePer) * (k + 0.5);
      for (const side of [-1, 1] as const) {
        const jx = rng.range(-0.04, 0.04);
        const jz = rng.range(-0.03, 0.03);
        const cz = side * (d / 2 + 0.42) + jz;
        placeChair(x + jx, cz, side < 0 ? PI : 0);
        // Place settings: open laptop at alternating seats, folders/mugs at the rest.
        const lz = side * (d / 2 - 0.24);
        if ((k + (side > 0 ? 1 : 0)) % 2 === 0) {
          const lf = at(x, h, lz, 0, side < 0 ? PI : 0, 0);
          pb.add(rounded(0.32, 0.012, 0.22, 0.004), m.steelBrushed, inFrame(lf, 0, 0.006, 0));
          pb.add(rounded(0.32, 0.21, 0.01, 0.004), m.steelBrushed, inFrame(lf, 0, 0.108, -0.125, -0.25, 0, 0));
          pb.add(slab(0.28, 0.17, 0.004), glow('laptop-screen', 0x6fb8c8, 0.9), inFrame(lf, 0, 0.108, -0.118, -0.25, 0, 0));
        } else {
          pb.add(slab(0.22, 0.008, 0.3), pmats[(k + 1) % 3]!, at(x + rng.range(-0.04, 0.04), h + 0.004, lz, 0, rng.range(-0.2, 0.2), 0));
        }
        if (rng.chance(0.55)) mugAt(pb, rng.pick([MAT.ceramic(), MAT.ceramicTeal()]), x + 0.24 * side, h, lz + side * 0.04, rng.range(0, 6));
      }
    }
    if (endEast) placeChair(w / 2 + 0.44, 0, PI / 2);
    pb.solid(-w / 2, 0, -d / 2, w / 2, h + 0.02, d / 2, 'metal');
  },

  /** Executive sideboard / credenza (back on +Z, front faces -Z): dark wood cabinet with coffee service & folders. */
  credenza(p, rng, m, pb) {
    const w = numParam(p, 'width', 2.4);
    const d = 0.52;
    const h = 0.84;
    pb.add(rounded(w, h - 0.1, d - 0.04, 0.015), MAT.woodDark(), at(0, (h - 0.1) / 2 + 0.1, 0.01));
    pb.add(slab(w - 0.06, 0.1, d - 0.1), m.black, at(0, 0.05, 0.02));
    pb.add(rounded(w + 0.03, 0.035, d + 0.02, 0.01), MAT.stone(), at(0, h - 0.0175, 0));
    const doors = Math.max(2, Math.round(w / 0.6));
    const dw = w / doors;
    for (let i = 0; i < doors; i++) {
      const x = -w / 2 + dw * (i + 0.5);
      pb.add(rounded(dw - 0.03, h - 0.18, 0.02, 0.005), m.woodPanel, at(x, (h - 0.1) / 2 + 0.1, -d / 2 + 0.01));
      pb.add(rounded(0.14, 0.016, 0.024, 0.006), m.steelBrushed, at(x, h - 0.18, -d / 2 - 0.01));
    }
    // Coffee carafe, mug tray, and neat binder stack on top.
    pb.add(lathe([[0, 0], [0.065, 0], [0.075, 0.16], [0.05, 0.24], [0.058, 0.27], [0, 0.27]], 14), m.steelBrushed, at(-w / 2 + 0.35, h, 0));
    pb.add(rounded(0.42, 0.016, 0.28, 0.006), MAT.deskDark(), at(-w / 2 + 0.85, h + 0.008, 0));
    for (let i = 0; i < 3; i++) mugAt(pb, i === 1 ? MAT.ceramicTeal() : MAT.ceramic(), -w / 2 + 0.72 + i * 0.13, h + 0.016, rng.range(-0.04, 0.04), rng.range(0, 6));
    for (let i = 0; i < 3; i++) pb.add(slab(0.24, 0.02, 0.32), i % 2 === 0 ? MAT.paperBlue() : MAT.paper(), at(w / 2 - 0.35, h + 0.01 + i * 0.021, 0, 0, rng.range(-0.08, 0.08), 0));
    steamPlume(pb, rng, { x: -w / 2 + 0.35, y: h + 0.27, z: 0, width: 0.1, depth: 0.1, height: 0.26, count: 10, opacity: 0.15, size: 0.08 });
    pb.solid(-w / 2, 0, -d / 2, w / 2, h + 0.28, d / 2, 'metal');
    pb.spot('lean_counter', -w / 2 + 0.55, 0, -d / 2 - 0.46, PI);
  },

  /**
   * Pendant lamps on cables: cone shades with a warm bulb. `count` along X. By default the bulbs are a static
   * glow (emissive only, no light). `slots: true` instead offers one `pendant` light slot per bulb, so the room's
   * `lights` can claim them as real lights that follow patterns and tints (render-lighting spec).
   */
  pendant_light(p, _rng, m, pb) {
    const ceil = numParam(p, 'ceiling', 3.2);
    const drop = numParam(p, 'drop', 1.2);
    const n = Math.max(1, Math.round(numParam(p, 'count', 1)));
    const gap = numParam(p, 'spacing', 1);
    const shadeMat = strParam(p, 'shade', 'dark') === 'brass' ? MAT.shadeBrass() : MAT.shade();
    const slotted = boolParam(p, 'slots', false);
    // `sway`: true (0.06 rad) or an amplitude; each bulb swings on its cable at a pendulum's period (shadow-rich-rooms D6).
    const swayAmp = p['sway'] === true ? 0.06 : typeof p['sway'] === 'number' ? Math.min(0.4, Math.max(0, p['sway'])) : 0;
    const period = 2 * Math.PI * Math.sqrt(Math.max(0.2, drop) / 9.81);
    const y = ceil - drop;
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * gap;
      if (swayAmp > 0) {
        // The mount stays on the ceiling; cable, cap, shade (and a static bulb) hang from a pivot at its foot.
        const top = ceil - 0.04;
        pb.add(new THREE.CylinderGeometry(0.04, 0.04, 0.04, 10), m.steel, at(x, ceil - 0.02, 0));
        const pivot = new THREE.Group();
        pivot.name = 'pendant-sway';
        pivot.position.set(x, top, 0);
        const hang = (geo: THREE.BufferGeometry, mat: THREE.Material, yAt: number): void => {
          const mesh = new THREE.Mesh(geo, mat);
          mesh.position.y = yAt - top;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          pivot.add(mesh);
        };
        hang(new THREE.CylinderGeometry(0.005, 0.005, top - (y + 0.22), 5), m.cable, (top + y + 0.22) / 2);
        hang(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 10), m.steel, y + 0.21);
        hang(new THREE.ConeGeometry(0.21, 0.22, 20, 1, true), shadeMat, y + 0.11);
        if (!slotted) hang(new THREE.SphereGeometry(0.06, 12, 8), glow('pendant-bulb', 0xffdca8, 3.0), y + 0.055);
        pb.dynamic(pivot);
        // A slightly different period per bulb, so a row of lamps does not swing in lockstep. The piece and the level
        // both turn this swing at the same time (its jolt is shared and advanced once per time).
        const swing = { pivot: [x, top, 0] as [number, number, number], amp: swayAmp, period: period * (1 + 0.07 * i), jolt: newJolt() };
        pb.tick((t) => {
          pivot.rotation.x = swingAngle(swing, t);
        });
        if (slotted) pb.light([x, y + 0.055, 0], 'pendant', 0, swing);
        continue;
      }
      pb.add(cylinderBetween(V(x, ceil, 0), V(x, y + 0.22, 0), 0.005, 5), m.cable);
      pb.add(new THREE.CylinderGeometry(0.04, 0.04, 0.04, 10), m.steel, at(x, ceil - 0.02, 0));
      pb.add(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 10), m.steel, at(x, y + 0.21, 0));
      pb.add(new THREE.ConeGeometry(0.21, 0.22, 20, 1, true), shadeMat, at(x, y + 0.11, 0));
      if (slotted) pb.light([x, y + 0.055, 0], 'pendant');
      else pb.add(new THREE.SphereGeometry(0.06, 12, 8), glow('pendant-bulb', 0xffdca8, 3.0), at(x, y + 0.055, 0));
    }
  },

  /** High bar ledge with stools on the -Z side; the back can sit against a wall or a planter. */
  bar_counter(p, rng, m, pb) {
    const w = numParam(p, 'width', 3);
    const d = 0.44;
    const h = 1.06;
    pb.add(rounded(w, 0.05, d, 0.012), MAT.woodLight(), at(0, h - 0.025, 0));
    pb.add(slab(w - 0.04, h - 0.05, 0.04), MAT.tealGloss(), at(0, (h - 0.05) / 2, d / 2 - 0.06));
    for (const x of [-w / 2 + 0.06, w / 2 - 0.06]) pb.add(slab(0.05, h - 0.05, d - 0.06), m.steel, at(x, (h - 0.05) / 2, 0.02));
    pb.add(cylinderBetween(V(-w / 2 + 0.1, 0.24, -0.02), V(w / 2 - 0.1, 0.24, -0.02), 0.022, 10), m.steel);
    const stools = Math.max(1, Math.round(numParam(p, 'stools', Math.floor(w / 0.72))));
    for (let i = 0; i < stools; i++) {
      const x = -w / 2 + (w / stools) * (i + 0.5) + rng.range(-0.04, 0.04);
      const z = -d / 2 - 0.3 + rng.range(-0.04, 0.04);
      pb.add(new THREE.CylinderGeometry(0.19, 0.18, 0.07, 16), MAT.fabricWarm(), at(x, 0.76, z));
      pb.add(cylinderBetween(V(x, 0.02, z), V(x, 0.73, z), 0.025, 8), m.steel);
      pb.add(new THREE.TorusGeometry(0.16, 0.012, 6, 18), m.steel, at(x, 0.3, z, PI / 2, 0, 0));
      pb.add(new THREE.CylinderGeometry(0.2, 0.22, 0.025, 16), m.steel, at(x, 0.012, z));
      pb.solid(x - 0.2, 0, z - 0.2, x + 0.2, 0.8, z + 0.2, 'rubber');
      pb.spot('sit_stool', x, 0, z, PI, 0.795); // ADR-0029: facing the counter
    }
    for (let i = 0; i < Math.round(numParam(p, 'mugs', 1)); i++) mugAt(pb, rng.pick([MAT.ceramic(), MAT.ceramicTeal(), MAT.ceramicRed()]), rng.range(-w / 2 + 0.2, w / 2 - 0.2), h, rng.range(-0.1, 0.08), rng.range(0, 6));
    pb.solid(-w / 2, 0, -d / 2, w / 2, h, d / 2, 'metal');
  },

  pa_speaker(_p, _rng, m, pb) {
    const y = PA_GRILLE_Y;
    pb.add(slab(0.32, 0.22, 0.06), m.black, at(0, y, 0));
    pb.add(rounded(0.48, 0.36, 0.2, 0.025), m.steel, at(0, y, -0.134));
    pb.add(slab(0.408, 0.276, 0.008), m.black, at(0, y, PA_GRILLE_Z));
    for (const side of [-1, 1]) {
      pb.add(rounded(0.446, 0.025, 0.032, 0.006), m.steel, at(0, y + side * 0.15, PA_GRILLE_Z - 0.01));
      pb.add(slab(0.018, 0.276, 0.032), m.steel, at(side * 0.214, y, PA_GRILLE_Z - 0.01));
    }
    for (let row = -3; row <= 3; row++) {
      pb.add(slab(0.388, 0.014, 0.019), m.steel, at(0, y + row * 0.036, PA_GRILLE_Z - 0.01, -0.22, 0, 0));
    }
  },

  /** Wall clock (back on z = 0): steel rim, paper face, hands at `hour`:`minute` (the 06:40 shift change). */
  wall_clock(p, _rng, m, pb) {
    const r = numParam(p, 'radius', 0.22);
    const y = numParam(p, 'y', 2.7);
    const hr = numParam(p, 'hour', 6);
    const mn = numParam(p, 'minute', 40);
    pb.add(new THREE.CylinderGeometry(r + 0.025, r + 0.025, 0.05, 32), m.steel, at(0, y, -0.025, PI / 2, 0, 0));
    pb.add(new THREE.CircleGeometry(r, 32), MAT.paper(), at(0, y, -0.0505, 0, PI, 0));
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * PI * 2;
      const len = i % 3 === 0 ? 0.045 : 0.022;
      pb.add(slab(0.012, len, 0.003), m.black, at(-Math.sin(a) * (r - 0.02 - len / 2), y + Math.cos(a) * (r - 0.02 - len / 2), -0.053, 0, 0, a));
    }
    const hand = (a: number, len: number, wid: number, z: number): void => void pb.add(slab(wid, len, 0.003), m.black, at(-Math.sin(a) * (len / 2 - 0.02), y + Math.cos(a) * (len / 2 - 0.02), z, 0, 0, a));
    hand((((hr % 12) + mn / 60) / 12) * PI * 2, r * 0.6, 0.016, -0.056);
    hand((mn / 60) * PI * 2, r * 0.88, 0.01, -0.059);
    pb.add(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 10), m.steel, at(0, y, -0.062, PI / 2, 0, 0));
  },

  /** Long planter trough (room divider): dark wood box, steel rim, mixed greens. */
  planter(p, rng, m, pb) {
    const w = numParam(p, 'width', 2.4);
    const d = 0.5;
    const h = numParam(p, 'height', 0.7);
    pb.add(rounded(w, h, d, 0.02), MAT.woodDark(), at(0, h / 2, 0));
    for (let i = 0; i < Math.floor(w / 0.3); i++) pb.add(slab(0.012, h - 0.12, 0.004), MAT.wood(), at(-w / 2 + 0.15 + i * 0.3, h / 2, -d / 2 - 0.002));
    pb.add(rounded(w + 0.03, 0.03, d + 0.03, 0.008), m.steel, at(0, h, 0));
    pb.add(slab(w - 0.06, 0.02, d - 0.06), MAT.soil(), at(0, h - 0.01, 0));
    const greens = [MAT.leaf(), MAT.leafLight(), MAT.leafDark()];
    const n = Math.max(2, Math.round(w / 0.45));
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (w / n) * (i + 0.5) + rng.range(-0.05, 0.05);
      const k = (i + Math.floor(rng.range(0, 3))) % 3;
      if (k === 0) rosette(pb, rng, greens, x, h, rng.range(-0.08, 0.08), 12, 0.5, 0.11, 1.0);
      else if (k === 1) clump(pb, rng, greens, x, h + 0.14, 0, 0.22, 4);
      else {
        const tip = V(x + rng.range(-0.08, 0.08), h + rng.range(0.7, 1.0), rng.range(-0.06, 0.06));
        pb.add(cylinderBetween(V(x, h, 0), tip, 0.014, 6), MAT.woodDark());
        clump(pb, rng, greens, tip.x, tip.y - 0.1, tip.z, 0.2, 3);
      }
    }
    pb.solid(-w / 2, 0, -d / 2, w / 2, h + 0.35, d / 2, 'metal');
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

let bioSignMatCache: THREE.MeshStandardMaterial | null = null;
function bioSignMat(): THREE.MeshStandardMaterial {
  if (!bioSignMatCache) {
    bioSignMatCache = paintedDecal(
      (ctx, w, h) => {
        ctx.fillStyle = '#eff3ef';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#1f6f58';
        ctx.fillRect(0, 0, w, h * 0.28);
        ctx.fillStyle = '#f5faf6';
        ctx.font = `700 ${Math.round(h * 0.15)}px "Arial Narrow", Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('HYDROPONICS BIOSECURITY', w / 2, h * 0.2);
        ctx.fillStyle = '#1d2926';
        ctx.font = `700 ${Math.round(h * 0.11)}px Arial, sans-serif`;
        ctx.fillText('1. SANITIZE BOOTS ON MAT', w / 2, h * 0.48);
        ctx.fillText('2. WASH HANDS BEFORE ENTRY', w / 2, h * 0.66);
        ctx.fillStyle = '#3a6b5c';
        ctx.font = `${Math.round(h * 0.085)}px Arial, sans-serif`;
        ctx.fillText('TAG AGRICULTURAL BAY  ·  DECK 1', w / 2, h * 0.87);
      },
      512,
      300,
      'hydro-biosign',
      false,
    );
    bioSignMatCache.transparent = false;
    bioSignMatCache.depthWrite = true;
  }
  return bioSignMatCache;
}

let dogPhotoCache: THREE.MeshStandardMaterial | null = null;
/** Warm framed snapshot of somebody's golden retriever on a sunlit lawn (R12e hidden living space). */
function dogPhotoMat(): THREE.MeshStandardMaterial {
  if (!dogPhotoCache) {
    dogPhotoCache = paintedDecal(
      (ctx, w, h) => {
        // Soft sunlit park background (sky + grass).
        const sky = ctx.createLinearGradient(0, 0, 0, h * 0.6);
        sky.addColorStop(0, '#8cc2dc');
        sky.addColorStop(1, '#d8e8ec');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, w, h * 0.62);
        ctx.fillStyle = '#6c9a4e';
        ctx.fillRect(0, h * 0.58, w, h * 0.42);
        // Golden dog silhouette (warm fur, floppy ears, red collar, bright eyes & nose).
        ctx.fillStyle = '#c88d42';
        ctx.beginPath();
        ctx.ellipse(w * 0.5, h * 0.72, w * 0.26, h * 0.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#d9a456';
        ctx.beginPath();
        ctx.arc(w * 0.5, h * 0.44, w * 0.2, 0, Math.PI * 2);
        ctx.fill();
        // Floppy ears.
        ctx.fillStyle = '#a86f2c';
        ctx.beginPath();
        ctx.ellipse(w * 0.3, h * 0.48, w * 0.07, h * 0.12, 0.25, 0, Math.PI * 2);
        ctx.ellipse(w * 0.7, h * 0.48, w * 0.07, h * 0.12, -0.25, 0, Math.PI * 2);
        ctx.fill();
        // Snout, nose, eyes, tongue & red collar.
        ctx.fillStyle = '#e8c488';
        ctx.beginPath();
        ctx.ellipse(w * 0.5, h * 0.5, w * 0.09, h * 0.07, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#241812';
        ctx.beginPath();
        ctx.ellipse(w * 0.5, h * 0.47, w * 0.035, h * 0.024, 0, 0, Math.PI * 2);
        ctx.arc(w * 0.42, h * 0.4, w * 0.022, 0, Math.PI * 2);
        ctx.arc(w * 0.58, h * 0.4, w * 0.022, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#d86670';
        ctx.beginPath();
        ctx.ellipse(w * 0.5, h * 0.555, w * 0.032, h * 0.038, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#b82824';
        ctx.fillRect(w * 0.36, h * 0.6, w * 0.28, h * 0.045);
        // Thin photo mat border.
        ctx.strokeStyle = '#f2ede2';
        ctx.lineWidth = 10;
        ctx.strokeRect(5, 5, w - 10, h - 10);
      },
      256,
      320,
      'hydro-dog-photo',
      false,
    );
    dogPhotoCache.transparent = false;
    dogPhotoCache.depthWrite = true;
  }
  return dogPhotoCache;
}

function drawHydroLog(ctx: CanvasRenderingContext2D, t: number, w: number, h: number): void {
  ctx.fillStyle = '#071411';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#112a24';
  ctx.fillRect(0, 0, w, h * 0.19);
  ctx.fillStyle = '#4fd6a8';
  ctx.fillRect(0, h * 0.19, w, 3);
  drawTagMark(ctx, w * 0.06, h * 0.095, h * 0.06, { ink: '#e8f6f0', accent: '#4fd6a8' });
  ctx.textAlign = 'left';
  ctx.font = `700 ${Math.round(h * 0.072)}px ${SCREEN_FONT}`;
  ctx.fillStyle = '#eef8f4';
  ctx.fillText('IRRIGATION LOG  //  GROW HALL 12B', w * 0.13, h * 0.13);
  const rows: Array<[string, string, string]> = [
    ['BAY A · TOMATOES', 'EC 2.1  ·  DRIP NOMINAL', '#7fe3a8'],
    ['BAY B · HYDRO GREENS', 'EC 1.6  ·  NFT FLOW OK', '#7fe3a8'],
    ['BAY C · HERBS / BASIL', 'EC 1.5  ·  LIGHT 16h', '#7fe3a8'],
    ['MISTING & HUMIDITY', `${(85.8 + Math.sin(t * 0.8) * 0.5).toFixed(1)} % RH  (CHECK 12D)`, '#ffb020'],
  ];
  ctx.font = `${Math.round(h * 0.058)}px ${SCREEN_FONT}`;
  rows.forEach(([k, v, c], i) => {
    const y = h * 0.34 + i * h * 0.135;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#9ec4b8';
    ctx.fillText(k, w * 0.05, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = c;
    ctx.fillText(v, w * 0.95, y);
  });
  ctx.textAlign = 'left';
  ctx.fillStyle = Math.floor(t * 1.8) % 2 === 0 ? '#f2c14e' : '#7a6328';
  ctx.font = `700 ${Math.round(h * 0.06)}px ${SCREEN_FONT}`;
  ctx.fillText('[E] SIGN DAILY IRRIGATION LOG  ·  WEN', w * 0.05, h * 0.92);
}

const menuCache = new Map<string, THREE.MeshStandardMaterial>();
/** The galley menu: three service columns on dark slate, backlit (emissive from its own map). */
function menuMat(title: string, aspect: number): THREE.MeshStandardMaterial {
  const key = `${title}|${aspect.toFixed(2)}`;
  let mat = menuCache.get(key);
  if (!mat) {
    const W = 1024;
    const H = Math.round(W / aspect);
    mat = paintedDecal(
      (ctx, w, h) => {
        ctx.fillStyle = '#121719';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#1c2427';
        ctx.fillRect(0, 0, w, h * 0.2);
        ctx.fillStyle = '#3aa8a3';
        ctx.fillRect(0, h * 0.2, w, Math.max(2, h * 0.012));
        drawTagMark(ctx, h * 0.12, h * 0.1, h * 0.07, { ink: '#e9e4d8', accent: '#3aa8a3' });
        ctx.fillStyle = '#f2c14e';
        ctx.font = `700 ${Math.round(h * 0.11)}px "Arial Narrow", Arial, sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillText(title, h * 0.24, h * 0.14);
        ctx.fillStyle = '#9fb3b0';
        ctx.font = `${Math.round(h * 0.05)}px Arial, sans-serif`;
        ctx.textAlign = 'right';
        ctx.fillText('THALASSA DEEP  \u00b7  COMMONS  \u00b7  DECK 1', w - h * 0.08, h * 0.13);
        const cols: Array<[string, string, string[]]> = [
          ['BREAKFAST', '0600 - 0930', ['Kelp & egg scramble', 'Oat porridge, brown sugar', 'Protein loaf, butter', 'Fruit cup (hydro)']],
          ['MAIN SHIFT', '1130 - 1400', ['Farmed cod stew', 'Hydro greens, lemon oil', 'Steamed rice', 'Roast potatoes']],
          ['NIGHT', '2200 - 0100', ['Soup of the day', 'Toasted flatbread', 'Leftovers, labelled', 'Ask the galley']],
        ];
        const cw = w / cols.length;
        cols.forEach(([name, hours, lines], i) => {
          const x = cw * i + cw * 0.08;
          ctx.textAlign = 'left';
          ctx.fillStyle = '#f2c14e';
          ctx.font = `700 ${Math.round(h * 0.075)}px "Arial Narrow", Arial, sans-serif`;
          ctx.fillText(name, x, h * 0.34);
          ctx.fillStyle = '#7f9592';
          ctx.font = `${Math.round(h * 0.045)}px Arial, sans-serif`;
          ctx.fillText(hours, x, h * 0.41);
          ctx.fillStyle = '#e9e4d8';
          ctx.font = `${Math.round(h * 0.055)}px Arial, sans-serif`;
          lines.forEach((l, k) => ctx.fillText(l, x, h * 0.51 + k * h * 0.1));
          if (i > 0) {
            ctx.fillStyle = '#26302f';
            ctx.fillRect(cw * i, h * 0.27, 2, h * 0.6);
          }
        });
        ctx.fillStyle = '#3aa8a3';
        ctx.font = `700 ${Math.round(h * 0.045)}px Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('COFFEE IS ON THE HOUSE  \u00b7  PLEASE RETURN YOUR MUG', w / 2, h * 0.95);
      },
      W,
      H,
      `menu-${key}`,
      false,
    );
    mat.transparent = false;
    // Opaque now, so it must write depth or the frame behind can draw over it.
    mat.depthWrite = true;
    mat.emissive.set(0xffffff);
    mat.emissiveMap = mat.map;
    mat.emissiveIntensity = 0.45;
    menuCache.set(key, mat);
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

function drawBoardroomDeck(ctx: CanvasRenderingContext2D, t: number, w: number, h: number): void {
  const slide = Math.floor(t / 12) % 3;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#0f222a');
  g.addColorStop(1, '#071015');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Header bar with TAG mark and slide indicator.
  ctx.fillStyle = '#132d36';
  ctx.fillRect(0, 0, w, h * 0.17);
  ctx.fillStyle = '#4fd6d0';
  ctx.fillRect(0, h * 0.17, w, 3);
  drawTagMark(ctx, w * 0.06, h * 0.085, h * 0.055, { ink: '#e8f4f2', accent: '#4fd6d0' });
  ctx.textAlign = 'left';
  ctx.font = `700 ${Math.round(h * 0.062)}px ${SCREEN_FONT}`;
  ctx.fillStyle = '#eef7f5';
  const titles = ['Q4 DEEP-CORE YIELD  //  SECTOR 7', 'THALASSA STATION TELEMETRY', 'CONTAINMENT BRIEF  //  LAB B'];
  ctx.fillText(titles[slide]!, w * 0.12, h * 0.11);
  ctx.textAlign = 'right';
  ctx.font = `${Math.round(h * 0.042)}px ${SCREEN_FONT}`;
  ctx.fillStyle = '#8cc4be';
  ctx.fillText(`SLIDE 0${slide + 1} / 03`, w * 0.95, h * 0.105);

  ctx.textAlign = 'left';
  if (slide === 0) {
    // Bar chart of quarterly mineral & bio-sample output.
    const bars = [0.48, 0.62, 0.71, 0.89, 0.76, 0.94];
    const labels = ['MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT'];
    const base = h * 0.78;
    const maxH = h * 0.44;
    ctx.strokeStyle = '#1f444e';
    ctx.lineWidth = 1;
    for (let r = 0; r < 4; r++) {
      const y = base - (maxH * r) / 3;
      ctx.beginPath();
      ctx.moveTo(w * 0.08, y);
      ctx.lineTo(w * 0.62, y);
      ctx.stroke();
    }
    bars.forEach((v, i) => {
      const pulse = 1 + Math.sin(t * 1.4 + i) * 0.02;
      const bh = maxH * v * pulse;
      const bx = w * 0.1 + i * w * 0.085;
      ctx.fillStyle = i === 5 ? '#f2c14e' : '#3fb5ae';
      ctx.fillRect(bx, base - bh, w * 0.055, bh);
      ctx.fillStyle = '#9fc4c0';
      ctx.font = `${Math.round(h * 0.038)}px ${SCREEN_FONT}`;
      ctx.fillText(labels[i]!, bx, base + h * 0.06);
    });
    // Right-hand KPI callouts.
    const kpis: Array<[string, string, string]> = [
      ['CORE OUTPUT', '+18.4%', '#4fd6d0'],
      ['HULL INTEGRITY', '99.2%', '#eef7f5'],
      ['NEXT RESUPPLY', 'DOCKED', '#f2c14e'],
    ];
    kpis.forEach(([k, val, col], i) => {
      const y = h * 0.32 + i * h * 0.18;
      ctx.fillStyle = 'rgba(20,48,58,0.7)';
      ctx.fillRect(w * 0.67, y - h * 0.06, w * 0.28, h * 0.14);
      ctx.fillStyle = '#89b4b0';
      ctx.font = `${Math.round(h * 0.036)}px ${SCREEN_FONT}`;
      ctx.fillText(k, w * 0.69, y);
      ctx.fillStyle = col;
      ctx.font = `700 ${Math.round(h * 0.065)}px ${SCREEN_FONT}`;
      ctx.fillText(val, w * 0.69, y + h * 0.065);
    });
  } else if (slide === 1) {
    // Live waveform + sector rows.
    const rows: Array<[string, string, string]> = [
      ['DEPTH', '3,210 m', '#4fd6d0'],
      ['EXTERNAL PRESSURE', `${(319.8 + Math.sin(t * 0.5) * 0.2).toFixed(1)} ATM`, '#eef7f5'],
      ['HYDRO O2 OUTPUT', `${(104.2 + Math.sin(t * 0.8) * 0.4).toFixed(1)} %`, '#7fe3a0'],
      ['REACTOR LOAD', '68.4 %', '#f2c14e'],
    ];
    rows.forEach(([k, val, col], i) => {
      const y = h * 0.31 + i * h * 0.12;
      ctx.fillStyle = '#8ab6b2';
      ctx.font = `${Math.round(h * 0.044)}px ${SCREEN_FONT}`;
      ctx.fillText(k, w * 0.08, y);
      ctx.fillStyle = col;
      ctx.font = `700 ${Math.round(h * 0.048)}px ${SCREEN_FONT}`;
      ctx.fillText(val, w * 0.48, y);
    });
    ctx.strokeStyle = '#4fd6d0';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let x = 0; x < w * 0.84; x += 6) {
      const y = h * 0.82 + Math.sin(x * 0.03 + t * 2.2) * 14 * Math.cos(x * 0.01 - t * 0.4);
      if (x === 0) ctx.moveTo(w * 0.08 + x, y);
      else ctx.lineTo(w * 0.08 + x, y);
    }
    ctx.stroke();
  } else {
    // Subtle story-foreshadowing TAG slide about Lab B.
    ctx.fillStyle = 'rgba(184, 35, 28, 0.22)';
    ctx.fillRect(w * 0.08, h * 0.26, w * 0.84, h * 0.14);
    ctx.fillStyle = '#f2c14e';
    ctx.font = `700 ${Math.round(h * 0.055)}px ${SCREEN_FONT}`;
    ctx.fillText('ADVISORY: LAB B SAMPLE ISOLATION (ROUTINE)', w * 0.11, h * 0.35);
    const bullets = [
      '•  Specimen 04-C remains sealed under Level-2 containment.',
      '•  Security rounds scheduled for 07:00 across Admin, Hydro & Dive Bay.',
      '•  Topside corporate uplink deferred until next buoy window.',
      '•  All personnel reminded: direct inquiries to Director Hale.',
    ];
    ctx.fillStyle = '#d8ecea';
    ctx.font = `${Math.round(h * 0.044)}px ${SCREEN_FONT}`;
    bullets.forEach((b, i) => ctx.fillText(b, w * 0.09, h * 0.5 + i * h * 0.1));
  }
}

function drawCommonsBoard(ctx: CanvasRenderingContext2D, t: number, w: number, h: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#17292e');
  g.addColorStop(1, '#0b1418');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#1f363c';
  ctx.fillRect(0, 0, w, h * 0.2);
  ctx.fillStyle = '#f2c14e';
  ctx.fillRect(0, h * 0.2, w, 3);
  drawTagMark(ctx, w * 0.06, h * 0.1, h * 0.06, { ink: '#f2ede0', accent: '#4fd6d0' });
  ctx.textAlign = 'left';
  ctx.font = `700 ${Math.round(h * 0.072)}px ${SCREEN_FONT}`;
  ctx.fillStyle = '#f5efe2';
  ctx.fillText('THALASSA COMMONS  //  MORNING BRIEF', w * 0.12, h * 0.125);
  ctx.textAlign = 'right';
  const mins = 40 + (Math.floor(t / 15) % 19);
  ctx.fillStyle = '#f2c14e';
  ctx.fillText(`06:${mins < 10 ? '0' : ''}${mins}`, w * 0.95, h * 0.125);

  ctx.textAlign = 'left';
  const cards: Array<[string, string, string]> = [
    ['SEAFLOOR CONDITIONS', '2.1 °C  ·  CURRENT 0.4 KT', '#4fd6d0'],
    ['SUPPLY SUB BERTH 01', 'CARGO UNLOAD IN PROGRESS', '#f2c14e'],
    ['GALLEY SPECIAL', 'KELP SCRAMBLE & HOT COFFEE', '#d9f0d0'],
  ];
  cards.forEach(([hdr, body, col], i) => {
    const y = h * 0.29 + i * h * 0.19;
    ctx.fillStyle = 'rgba(12, 24, 28, 0.72)';
    ctx.fillRect(w * 0.06, y, w * 0.88, h * 0.15);
    ctx.fillStyle = col;
    ctx.fillRect(w * 0.06, y, 5, h * 0.15);
    ctx.font = `700 ${Math.round(h * 0.04)}px ${SCREEN_FONT}`;
    ctx.fillText(hdr, w * 0.09, y + h * 0.055);
    ctx.fillStyle = '#eef4f2';
    ctx.font = `${Math.round(h * 0.048)}px ${SCREEN_FONT}`;
    ctx.fillText(body, w * 0.09, y + h * 0.118);
  });
  // Bottom scrolling ticker.
  ctx.fillStyle = '#091215';
  ctx.fillRect(0, h * 0.87, w, h * 0.13);
  ctx.fillStyle = '#8cc4be';
  ctx.font = `${Math.round(h * 0.044)}px ${SCREEN_FONT}`;
  const ticker = 'SHIFT CHANGEOVER 06:40  ·  HYDRO FRESH GREENS DELIVERED TO GALLEY  ·  ROTATION SHUTTLE IN 42 DAYS  ·  ';
  const off = (t * 48) % (ticker.length * h * 0.025);
  ctx.fillText(ticker + ticker, w * 0.04 - off, h * 0.95);
}

/** Who says the broadcast presenter's lines (data/dialogue/speakers.json), by presenter. */
const BROADCAST_SPEAKER: Readonly<Record<string, string>> = { hale: 'director' };

/**
 * Director Hale's broadcast portrait: his real body model, head and shoulders, at three jaw openings side by side
 * (closed, half, open; 320x360 each). Baked by /sandbox/hale-portrait.html (src/sandbox/halePortrait.ts).
 */
const HALE_PORTRAIT = { url: 'assets/brand/hale_broadcast.png', frameW: 320, frameH: 360, frames: 3 };
let halePortrait: HTMLImageElement | null = null;

/** The portrait sheet once it has loaded, or null (still loading, or no DOM in node tests). Loads on first use. */
function halePortraitSheet(): HTMLImageElement | null {
  if (!halePortrait) {
    if (typeof Image === 'undefined') return null;
    halePortrait = new Image();
    halePortrait.src = `${import.meta.env?.BASE_URL ?? '/'}${HALE_PORTRAIT.url}`;
  }
  return halePortrait.complete && halePortrait.naturalWidth > 0 ? halePortrait : null;
}

/** The portrait frame for a jaw opening of 0..1. */
export function portraitFrame(mouth: number): number {
  return mouth < 0.22 ? 0 : mouth < 0.6 ? 1 : 2;
}

function drawBroadcast(ctx: CanvasRenderingContext2D, t: number, w: number, h: number, state: string, who: string, mouth = 0): void {
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
  // The presenter: Hale's portrait with his mouth following the line, breathing gently; a silhouette until it loads.
  const bob = Math.sin(t * 2.3) * 2;
  const sheet = who === 'hale' ? halePortraitSheet() : null;
  if (sheet) {
    const { frameW, frameH } = HALE_PORTRAIT;
    // Anchor framing: head and shoulders fill the frame above the lower third.
    const dh = h * 1.5;
    const dw = (dh * frameW) / frameH;
    const breathe = Math.sin(t * 1.1) * h * 0.004;
    ctx.drawImage(sheet, portraitFrame(mouth) * frameW, 0, frameW, frameH, w * 0.5 - dw / 2, -h * 0.02 + breathe, dw, dh);
  } else {
    drawPresenterSilhouette(ctx, w, h, bob);
  }
  drawTagBanner(ctx, w * 0.06, h * 0.06, w * 0.4); // over the presenter's shoulder, like a channel bug
  drawBroadcastLowerThird(ctx, t, w, h, who);
}

function drawPresenterSilhouette(ctx: CanvasRenderingContext2D, w: number, h: number, bob: number): void {
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
}

function drawBroadcastLowerThird(ctx: CanvasRenderingContext2D, t: number, w: number, h: number, who: string): void {
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

function drawBank(ctx: CanvasRenderingContext2D, t: number, w: number, h: number, mode: string, notice: readonly string[] = []): void {
  ctx.fillStyle = '#020a0c';
  ctx.fillRect(0, 0, w, h);
  const panels = 3;
  const pw = w / panels;
  ctx.font = `600 18px ${SCREEN_FONT}`;
  for (let i = 0; i < panels; i++) {
    const x = i * pw;
    // A notice takes the first two panels.
    if (i === 1 && notice.length > 0) continue;
    ctx.strokeStyle = '#1f4a44';
    ctx.strokeRect(x + 6, 6, (i === 0 && notice.length > 0 ? 2 * pw : pw) - 12, h - 12);
    ctx.fillStyle = '#7fe3d0';
    const titles = mode === 'security' ? ['DOORS', 'CAMERAS', 'ALARMS'] : mode === 'lab' ? ['SAMPLES', 'CONTAINMENT', 'LOG'] : ['POWER', 'PRESSURE', 'LIFE SUPPORT'];
    if (i === 0 && notice.length > 0) {
      // The first line blinks red, like a live alarm; the rest is steady.
      ctx.fillStyle = Math.floor(t * 1.6) % 2 === 0 ? '#ff5a4a' : '#7a2620';
      ctx.fillText(notice[0]!, x + 18, 32);
      ctx.fillStyle = '#e8d8b0';
      ctx.font = `500 15px ${SCREEN_FONT}`;
      for (let k = 1; k < notice.length; k++) ctx.fillText(notice[k]!, x + 18, 32 + k * 30);
      ctx.font = `600 18px ${SCREEN_FONT}`;
      continue;
    }
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

function wallBack(pb: PieceBuilder, m: Materials, h: number, back: THREE.Material = m.paintDark): THREE.Matrix4 {
  const f = wallFrame(0, -HALF + WALL_T, 0);
  pb.add(slab(4, h + 0.1, WALL_T), back, inFrame(f, 0, h / 2 - 0.05, -WALL_T / 2));
  pb.solid(-HALF, 0, -HALF, HALF, h, -HALF + WALL_T);
  return f;
}

const STRUCT: Record<string, (p: PieceParams, rng: Rng, m: Materials, pb: PieceBuilder) => void> = {
  /**
   * Office carpet over the deck; soft footsteps. `bareEdge` ('n' | 'e' | 's' | 'w', piece space: n = -Z) with
   * `bareWidth` (m, from the cell edge) leaves a band of the area palette's `floorAlt` metal along that edge,
   * with hard footsteps and the carpet border on the seam (level-kit spec, the gallery's strip by the glass).
   */
  floor_carpet(p, _rng, m, pb) {
    pb.add(slab(4, 0.1, 4), m.paintDark, at(0, -0.17, 0));
    const edge = strParam(p, 'bareEdge', '');
    const bw = edge === 'n' || edge === 'e' || edge === 's' || edge === 'w' ? Math.min(3.5, Math.max(0, numParam(p, 'bareWidth', 1))) : 0;
    // Carpet rectangle [x0, x1] x [z0, z1]; the bare band is the rest of the cell.
    let [x0, x1, z0, z1] = [-2, 2, -2, 2];
    if (bw > 0) {
      if (edge === 'n') z0 = -2 + bw;
      else if (edge === 's') z1 = 2 - bw;
      else if (edge === 'w') x0 = -2 + bw;
      else x1 = 2 - bw;
      const [bx0, bx1, bz0, bz1] = edge === 'n' ? [-2, 2, -2, z0] : edge === 's' ? [-2, 2, z1, 2] : edge === 'w' ? [-2, x0, -2, 2] : [x1, 2, -2, 2];
      pb.add(slab(bx1 - bx0, 0.08, bz1 - bz0), resolvePalette(p, m).floorAlt, at((bx0 + bx1) / 2, -0.04, (bz0 + bz1) / 2));
      pb.solid(bx0, -0.2, bz0, bx1, 0, bz1, 'metal');
    }
    const w = x1 - x0;
    const d = z1 - z0;
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    pb.add(slab(w, 0.08, d), m.carpet, at(mx, -0.04, mz));
    // Border all round the carpet: along the walls as before, and along the seam with the bare band.
    pb.add(slab(w, 0.081, 0.12), MAT.carpetBorder(), at(mx, -0.04, z0 + 0.06));
    pb.add(slab(w, 0.081, 0.12), MAT.carpetBorder(), at(mx, -0.04, z1 - 0.06));
    pb.add(slab(0.12, 0.081, d), MAT.carpetBorder(), at(x0 + 0.06, -0.04, mz));
    pb.add(slab(0.12, 0.081, d), MAT.carpetBorder(), at(x1 - 0.06, -0.04, mz));
    pb.solid(x0, -0.2, z0, x1, 0, z1, 'rubber');
    pb.nav(0, 0, 0);
  },

  /** Ceramic tiles (kitchen, medical, hydroponics wet floors). */
  floor_tiles(p, rng, m, pb) {
    const wet = boolParam(p, 'wet', false);
    pb.add(slab(4, 0.1, 4), m.paintDark, at(0, -0.17, 0));
    // One metre-UV slab: the photo tile texture carries its own grout lines (manifest metersPerTile).
    const pal = resolvePalette(p, m);
    const tileMat = pal.overridden || TILE_FLOOR_KEYS.some((k) => m[k] === pal.floor) ? pal.floor : m.labTile;
    pb.add(slab(4, 0.08, 4), tileMat, at(0, -0.04, 0));
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

  /** Warm wood panelling (admin office): clean dark-wood reveals, grained wood panels, matte plaster header. */
  wall_wood(p, _rng, m, pb) {
    const h = numParam(p, 'height', 3.2);
    const f = wallBack(pb, m, h, MAT.woodDark());
    pb.add(slab(4, 0.14, 0.04), MAT.woodDark(), inFrame(f, 0, 0.07, 0.02));
    pb.add(slab(4, 0.06, 0.05), MAT.woodDark(), inFrame(f, 0, Math.min(2.6, h - 0.3), 0.025));
    for (let i = 0; i < 4; i++) {
      const x = -1.5 + i;
      pb.add(rounded(0.96, Math.min(2.6, h - 0.3) - 0.24, 0.03, 0.006), m.woodPanel, inFrame(f, x, (Math.min(2.6, h - 0.3) + 0.14) / 2, 0.015));
    }
    if (h > 2.95) pb.add(slab(4, h - 2.66, 0.02), MAT.wallPlaster(), inFrame(f, 0, (h + 2.66) / 2, 0.01));
  },

  /** White tile wall (kitchen, medical). */
  wall_tiles(p, _rng, m, pb) {
    const h = numParam(p, 'height', 3.2);
    const pal = resolvePalette(p, m);
    // Above the tiles: the area's upper-band material when its palette names one (commons), else the old dark paint.
    const upper = paletteFor(typeof p.area === 'string' ? p.area : undefined).wallAlt;
    const f = wallBack(pb, m, h, upper ? m[upper] : m.paintDark);
    // One metre-UV slab; the tileWall texture carries its own grout lines.
    const mat = p.material !== undefined ? pal.wallMain : m.tileWall;
    pb.add(slab(4, Math.min(2.4, h), 0.02), mat, inFrame(f, 0, Math.min(2.4, h) / 2, 0.01));
    pb.add(slab(4, 0.06, 0.05), pal.trim, inFrame(f, 0, Math.min(2.4, h) + 0.03, 0.025));
  },

  /** Hydroponics wall: panel wall with a condensation-streaked green glass grow window. */
  wall_greenhouse(p, rng, m, pb) {
    const h = numParam(p, 'height', 3.2);
    const f = wallFrame(0, -HALF + WALL_T, 0);
    panelWall(pb, m, rng, f, { length: 4, height: h, depth: WALL_T, pilaster: true, cables: false, pal: resolvePalette(p, m) });
    pb.add(rounded(2.4, 1.2, 0.06, 0.02), m.steel, inFrame(f, 0, 1.6, 0.03));
    pb.add(slab(2.2, 1.0, 0.02), glow('greenhouse', 0x3a8a4a, 0.8), inFrame(f, 0, 1.6, 0.065));
    const greens = [MAT.leaf(), MAT.leafLight()];
    for (let i = 0; i < 6; i++) pb.add(leafBlade(rng.range(0.3, 0.6), 0.12, 0.3), rng.pick(greens), inFrame(f, -0.9 + i * 0.36, 1.1, 0.09, 0.1, 0, rng.range(-0.3, 0.3)));
    pb.solid(-HALF, 0, -HALF, HALF, h, -HALF + WALL_T);
  },

  /**
   * The dive bay's "moon pool" (rebuild-dive-bay, dive-bay spec "Launch trunk"): a closed 1-atm lock trunk, not
   * an open pool. Deck coaming, an inner hatch hinged on the east edge with two hydraulic rams, a drained steel
   * shaft with depth marks down to the outer hatch (lit viewport) and a little standing water. Railed on all
   * four sides (the east side is a gate, modelled shut); the rail is the only barrier, so the hatch has no
   * collider. Listens for `trunk:state` { state: open|closed, instant? } and resets to open on `level:reset`.
   */
  floor_moonpool(p, _rng, m, pb) {
    const pal = resolvePalette(p, m);
    const hole = MOONPOOL_WIDTH;
    const h2 = hole / 2;
    const rim = (4 - hole) / 2;
    const depth = TRUNK_DEPTH;
    const white = plain('trunk-marks', 0xd9dbd4, 0.6);
    const seam = plain('trunk-seam', 0x2a2f33, 0.7, 0.4);
    // Deck around the trunk: grating, walkable.
    for (const s of [-1, 1]) {
      pb.add(slab(4, 0.1, rim), pal.floorAlt, at(0, -0.05, s * (h2 + rim / 2)));
      pb.add(slab(rim, 0.1, hole), pal.floorAlt, at(s * (h2 + rim / 2), -0.05, 0));
      pb.solid(-2, -0.2, s > 0 ? h2 : -2, 2, 0, s > 0 ? 2 : -h2, 'grate');
      pb.solid(s > 0 ? h2 : -2, -0.2, -h2, s > 0 ? 2 : -h2, 0, h2, 'grate');
      // Coaming ring and its painted top, and the hazard band on the deck around it.
      pb.add(slab(hole + 0.12, 0.12, 0.06), m.steel, at(0, 0.06, s * (h2 + 0.03)));
      pb.add(slab(0.06, 0.12, hole), m.steel, at(s * (h2 + 0.03), 0.06, 0));
      pb.add(slab(hole + 0.6, 0.02, 0.18), pal.hazard, at(0, 0.006, s * (h2 + 0.17)));
      pb.add(slab(0.18, 0.02, hole + 0.24), pal.hazard, at(s * (h2 + 0.17), 0.006, 0));
      // Shaft walls in pressure-hull plate, with weld seams.
      pb.add(slab(hole, depth, 0.1), m.hullPlate, at(0, -depth / 2, s * (h2 + 0.05)));
      pb.add(slab(0.1, depth, hole), m.hullPlate, at(s * (h2 + 0.05), -depth / 2, 0));
      for (const y of [-1, -2]) {
        pb.add(slab(hole, 0.03, 0.02), seam, at(0, y, s * (h2 - 0.005)));
        pb.add(slab(0.02, 0.03, hole), seam, at(s * (h2 - 0.005), y, 0));
      }
      // Depth marks every 0.5 m on the north and south walls, long ones on whole metres.
      for (let d = 0.5; d < depth - 0.1; d += 0.5) {
        const whole = Math.abs(d - Math.round(d)) < 0.01;
        pb.add(slab(whole ? 0.5 : 0.25, 0.035, 0.012), white, at(-0.6, -d, s * (h2 - 0.007)));
      }
      // Shaft lamps near the foot, and the closed outer hatch's viewport glow.
      pb.add(slab(0.3, 0.08, 0.04), glow('trunk-lamp', 0xbfe9ff, 1.4), at(0.55, -2.35, s * (h2 - 0.02)));
    }
    // A wall light slot on the north shaft lamp: claimed by the room, it lights the shaft and throws blue up out of the trunk.
    pb.light([0.55, -2.25, -(h2 - 0.08)], 'wall');
    pb.add(slab(hole, 0.12, hole), plain('trunk-outer', 0x30373c, 0.5, 0.6), at(0, -depth - 0.06, 0));
    pb.add(new THREE.CircleGeometry(0.5, 32).rotateX(-PI / 2), glow('moonpool-deep', 0x1d8fa0, 0.9), at(0, -depth + 0.002, 0));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * PI * 2;
      pb.add(slab(0.08, 0.05, 0.08), m.steel, at(Math.cos(a) * 0.62, -depth + 0.025, Math.sin(a) * 0.62));
    }
    // Standing water at the foot of the drained trunk.
    const water = new THREE.Mesh(new THREE.PlaneGeometry(hole, hole), waterMaterial());
    water.rotation.x = -PI / 2;
    water.position.y = -depth + 0.15;
    water.renderOrder = 2;
    water.name = 'trunk-water';
    pb.dynamic(water);

    // Inner hatch: plate with a round viewport, hinged on the east coaming. Angle 0 = closed, OPEN = open.
    const span = hole + 0.1;
    const hingeX = span / 2;
    const hingeY = 0.12;
    const shape = new THREE.Shape();
    shape.moveTo(-span, -span / 2);
    shape.lineTo(0, -span / 2);
    shape.lineTo(0, span / 2);
    shape.lineTo(-span, span / 2);
    shape.closePath();
    const port = new THREE.Path();
    port.absarc(-span / 2, 0, 0.42, 0, PI * 2, true);
    shape.holes.push(port);
    const plateGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false }).rotateX(PI / 2).translate(0, 0.08, 0);
    const parts: THREE.BufferGeometry[] = [plateGeo, new THREE.TorusGeometry(0.43, 0.035, 8, 32).rotateX(PI / 2).translate(-span / 2, 0.09, 0)];
    for (const z of [-0.8, 0, 0.8]) parts.push(rounded(0.16, 0.06, 0.22, 0.02).translate(-span + 0.06, 0.1, z)); // dogs
    for (const z of [-0.9, 0.9]) parts.push(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 12).rotateX(PI / 2).translate(0, 0.04, z)); // hinge knuckles
    const hatchMat = cached('trunk-hatch', () => new THREE.MeshStandardMaterial({ color: 0xb8952a, roughness: 0.55, metalness: 0.35 }));
    const plate = new THREE.Mesh(mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false)!, hatchMat);
    const pane = new THREE.Mesh(new THREE.CircleGeometry(0.42, 32).rotateX(-PI / 2).translate(-span / 2, 0.05, 0), m.glass);
    pane.renderOrder = 3;
    const hatch = new THREE.Group();
    hatch.name = 'trunk-hatch';
    hatch.position.set(hingeX, hingeY, 0);
    hatch.add(plate, pane);
    pb.dynamic(hatch);
    // Rams from brackets on the east shaft wall to lugs 0.6 m out along the hatch.
    const ramMat = cached('trunk-ram', () => new THREE.MeshStandardMaterial({ color: 0xc8ced2, roughness: 0.25, metalness: 0.9 }));
    const rams = [-0.7, 0.7].map((z) => {
      const ram = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 10), ramMat);
      pb.dynamic(ram);
      return { ram, base: V(h2 - 0.12, -0.35, z) };
    });
    const OPEN = (100 * PI) / 180;
    const lug = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    let angle = OPEN;
    let target = OPEN;
    const place = (): void => {
      hatch.rotation.z = -angle;
      hatch.userData['open'] = angle / OPEN;
      for (const { ram, base } of rams) {
        lug.set(hingeX - 0.6 * Math.cos(angle), hingeY + 0.6 * Math.sin(angle), base.z);
        const dir = lug.clone().sub(base);
        const len = dir.length();
        ram.position.copy(base).addScaledVector(dir, 0.5);
        ram.quaternion.setFromUnitVectors(up, dir.normalize());
        ram.scale.set(1, len, 1);
      }
    };
    place();
    pb.tick((t, dt) => {
      waterUniforms.uTime.value = t;
      if (angle === target) return;
      const step = (OPEN / 4) * dt; // about 4 s end to end
      angle = angle < target ? Math.min(target, angle + step) : Math.max(target, angle - step);
      place();
    });
    // Light out of the trunk (dive-bay spec "Lighting and atmosphere"): an upward blue shaft, moving caustics on the
    // ceiling above, and a thin mist on the shaft water. The shaft and caustics fade as the inner hatch closes.
    const roomH = numParam(p, 'height', 5);
    const upH = roomH - 0.3;
    const upShaft = createShaft(1.0, 1.9, upH, 0x58c8e0);
    upShaft.mesh.rotation.x = PI;
    upShaft.mesh.position.set(0, 0.15 + upH / 2, 0);
    upShaft.mesh.name = 'trunk-upshaft';
    pb.dynamic(upShaft.mesh);
    const caustics = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 5.6).rotateX(PI / 2), causticMaterial());
    caustics.position.y = roomH - 0.035;
    caustics.renderOrder = 3;
    caustics.name = 'trunk-caustics';
    pb.dynamic(caustics);
    const mist = new THREE.Mesh(
      mergeGeometries([new THREE.PlaneGeometry(hole - 0.05, hole - 0.05).rotateX(-PI / 2).translate(0, 0.18, 0), new THREE.PlaneGeometry(hole - 0.05, hole - 0.05).rotateX(-PI / 2).translate(0, 0.38, 0)], false)!,
      trunkMistMaterial(),
    );
    mist.position.y = -depth + 0.15;
    mist.renderOrder = 3;
    mist.name = 'trunk-mist';
    pb.dynamic(mist);
    const causticGain = (caustics.material as THREE.ShaderMaterial).uniforms['uGain']!;
    const glowFx = (): void => {
      const open = angle / OPEN;
      upShaft.uniforms.uIntensity.value = 0.045 * open;
      upShaft.mesh.visible = open > 0.01;
      causticGain.value = open;
      caustics.visible = open > 0.01;
    };
    glowFx();
    pb.tick((t) => {
      upShaft.uniforms.uTime.value = t;
      causticUniforms.uTime.value = t;
      trunkMistUniforms.uTime.value = t;
      glowFx();
    });
    const set = (state: unknown, instant: unknown): void => {
      if (state !== 'open' && state !== 'closed') return;
      target = state === 'open' ? OPEN : 0;
      if (instant === true) {
        angle = target;
        place();
      }
    };
    pb.on('trunk:state', (e) => {
      const ev = e as { state?: string; instant?: boolean } | undefined;
      set(ev?.state, ev?.instant);
    });
    pb.on('level:reset', () => set('open', true));

    // Rail on all four sides; the east side carries a gate (modelled shut). Colliders keep bodies out.
    const r = h2 + 0.25;
    for (const [x, z] of [[-r, -r], [r, -r], [r, r], [-r, r], [r, -0.55], [r, 0.55]] as const) pb.add(cylinderBetween(V(x, 0, z), V(x, 1.05, z), 0.03, 8), m.steel);
    for (const y of [0.55, 1.05]) {
      for (const s of [-1, 1]) {
        pb.add(cylinderBetween(V(-r, y, s * r), V(r, y, s * r), 0.022, 8), pal.hazard);
        pb.add(cylinderBetween(V(s * r, y, -r), V(s * r, y, r), 0.022, 8), pal.hazard);
      }
    }
    for (const z of [-0.3, 0, 0.3]) pb.add(cylinderBetween(V(r, 0.1, z), V(r, 1.0, z), 0.015, 6), m.steel); // gate bars
    pb.add(rounded(0.06, 0.12, 0.08, 0.01), plain('trunk-latch', 0x9a2a1e, 0.5, 0.3), at(r + 0.03, 0.85, 0.5));
    for (const s of [-1, 1]) {
      pb.solid(-r - 0.05, 0, s * r - 0.05, r + 0.05, 1.1, s * r + 0.05);
      pb.solid(s * r - 0.05, 0, -r - 0.05, s * r + 0.05, 1.1, r + 0.05);
    }
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
