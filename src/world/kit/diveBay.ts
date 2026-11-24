import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Rng } from '../../core/rng.ts';
import { fixtureMaterial, type Materials } from '../../render/materials.ts';
import { CanvasScreen, SCREEN_FONT } from '../../render/screens.ts';
import { paintedDecal, stencilDecal } from '../../render/decals.ts';
import { NOISE_GLSL } from '../../render/fx/glsl.ts';
import { flashingState } from '../../render/flashing.ts';
import { at, cylinderBetween, rounded } from './geom.ts';
import { slab } from './shapes.ts';
import { boolParam, numParam, strParam, PieceBuilder, type PieceDef, type PieceParams } from './types.ts';

/**
 * Dive bay kit (openspec rebuild-dive-bay, dive-bay spec): the equipment of a 1-atm launch-and-recovery hall at
 * depth, its ROV workshop, sample store and wet vestibule.
 *
 * Conventions match props.ts and slice.ts: origin on the floor, the side you use faces -Z. Wall-backed props
 * (whiteboard, wet bench, racks, boards) have their back on z = 0 and stand out toward -Z, so the generator's
 * `wallProp` places them. Static parts merge per material: flat paint colours (`userData.flat`) and static glows
 * (`userData.glow`) cost no extra draw call; screens and painted decals are one call each.
 *
 * Event-driven pieces:
 *   pilot_console  `trunk:state` { state: open|closed, instant? } switches the trunk panel (closing, then
 *                  TRUNK SECURED); `level:reset` puts it back to open.
 */

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const PI = Math.PI;

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
/** A flat paint colour that merges into the room's shared flat materials. */
const paint = (key: string, color: number, roughness = 0.6, metalness = 0): THREE.MeshStandardMaterial =>
  cached(`dive-${key}`, () => {
    const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    mat.userData['flat'] = true;
    return mat;
  });
/** A static glow that merges into the room's shared glow call. */
const lamp = (key: string, color: number, intensity: number): THREE.MeshStandardMaterial =>
  cached(`glow-dive-${key}`, () => {
    const mat = fixtureMaterial(color, intensity);
    mat.userData['glow'] = true;
    return mat;
  });

const P = {
  yellow: () => paint('yellow', 0xc79a22, 0.5, 0.3),
  foam: () => paint('foam', 0xe39a1c, 0.78),
  alu: () => paint('alu', 0xb9c0c4, 0.35, 0.8),
  anodized: () => paint('anodized', 0x4f6574, 0.35, 0.6),
  dark: () => paint('dark', 0x22272b, 0.5, 0.5),
  black: () => paint('black', 0x0d0f10, 0.6),
  stainless: () => paint('stainless', 0xc4c9cc, 0.28, 0.9),
  cabinet: () => paint('cabinet', 0xc9ccc8, 0.55),
  greyBlue: () => paint('greyBlue', 0x5b6a74, 0.5, 0.2),
  rubber: () => paint('rubber', 0x151719, 0.92),
  green: () => paint('green', 0x1f7a4a, 0.5),
  white: () => paint('white', 0xe4e6e1, 0.5),
  red: () => paint('red', 0x9a2a1e, 0.5, 0.2),
  umbilical: () => paint('umbilical', 0xd28a1c, 0.55),
  pegboard: () => paint('pegboard', 0x8a8e88, 0.82),
  tool: () => paint('tool', 0x6f767b, 0.35, 0.8),
  toolGrip: () => paint('toolGrip', 0xb23a22, 0.55),
  amberGlass: () => paint('amberGlass', 0x7a4a12, 0.2),
  mud: (i: number) => paint(`mud${i % 5}`, [0x4a3b2c, 0x6b5a44, 0x3a3530, 0x7d6a50, 0x2f2a26][i % 5]!, 0.95),
};

/** Tinted glass door pane over a lit cabinet interior (not merged: transparent). */
const glassDoor = (): THREE.MeshStandardMaterial =>
  cached('dive-glass-door', () => new THREE.MeshStandardMaterial({ color: 0x9fb8c4, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.32 }));

const screenFont = (px: number, weight = 600): string => `${weight} ${px}px ${SCREEN_FONT}`;

/** A sediment core in a liner: banded mud along the axis (local Y), white end caps. */
function core(pb: PieceBuilder, rng: Rng, base: THREE.Matrix4, length: number, radius = 0.035): void {
  let y = 0.02;
  const bands = 4 + Math.floor(rng.next() * 3);
  for (let i = 0; i < bands; i++) {
    const h = i === bands - 1 ? length - 0.02 - y : rng.range(0.05, (length - 0.04) / bands + 0.04);
    if (h <= 0.005) break;
    pb.add(new THREE.CylinderGeometry(radius, radius, h, 10), P.mud(Math.floor(rng.next() * 5)), base.clone().multiply(at(0, y + h / 2, 0)));
    y += h;
  }
  for (const cy of [0.01, length - 0.01]) pb.add(new THREE.CylinderGeometry(radius + 0.004, radius + 0.004, 0.02, 10), P.white(), base.clone().multiply(at(0, cy, 0)));
}

/**
 * Soft drifting vapour (trunk mist, the R13d leak): value noise scrolled along the quad's V, faded at the edges.
 * `rise` > 0 drifts up (steam); 0 drifts sideways (mist lying on water). One material per look, shared.
 */
export const vapourUniforms = { uTime: { value: 0 } };
function vapourMaterial(key: string, color: number, opacity: number, rise: number): THREE.ShaderMaterial {
  return cached(`vapour-${key}`, () => {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: vapourUniforms.uTime, uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uGain: { value: 1 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uColor; uniform float uOpacity; uniform float uGain;
        varying vec2 vUv;
        ${NOISE_GLSL}
        void main() {
          vec2 p = vUv * vec2(3.0, 2.0) + vec2(uTime * ${rise > 0 ? '0.05' : '0.12'}, -uTime * ${rise.toFixed(2)});
          float n = vnoise(p) * 0.6 + vnoise(p * 2.3 + 7.0) * 0.4;
          float edge = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x) * smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, ${rise > 0 ? '0.2' : '0.6'}, vUv.y);
          float a = smoothstep(0.35, 0.85, n) * edge * uOpacity * uGain;
          if (a < 0.003) discard;
          gl_FragColor = vec4(uColor, a);
        }`,
    });
    return mat;
  });
}
/** Crossed vertical quads (one mesh) for a puff of vapour rising from a point. */
function vapourPuff(w: number, h: number, mat: THREE.Material): THREE.Mesh {
  const parts = [0, PI / 3, (2 * PI) / 3].map((r) => new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0).rotateY(r));
  const mesh = new THREE.Mesh(mergeGeometries(parts, false)!, mat);
  mesh.renderOrder = 4;
  return mesh;
}

/** Shared floor-wear decal materials, one per kind, so every patch of a kind in a room merges into one call. */
function wearMaterial(kind: string): THREE.MeshStandardMaterial {
  return cached(`dive-wear-${kind}`, () => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    const ctx = c.getContext('2d');
    let n = 7;
    const rnd = (): number => {
      n = (n * 16807) % 2147483647;
      return n / 2147483647;
    };
    if (ctx) {
      if (kind === 'prints') {
        for (let i = 0; i < 8; i++) {
          const x = 140 + (i % 2) * 180;
          const yy = 470 - i * 58;
          const g = ctx.createRadialGradient(x, yy, 4, x, yy, 34);
          g.addColorStop(0, `rgba(10,14,16,${0.75 - i * 0.07})`);
          g.addColorStop(1, 'rgba(10,14,16,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.ellipse(x, yy, 22, 40, 0, 0, PI * 2);
          ctx.fill();
        }
      } else if (kind === 'salt') {
        ctx.strokeStyle = 'rgba(230,232,224,0.55)';
        for (let i = 0; i < 5; i++) {
          ctx.lineWidth = 3 + rnd() * 6;
          ctx.beginPath();
          ctx.ellipse(256 + (rnd() - 0.5) * 40, 256 + (rnd() - 0.5) * 40, 150 + i * 18, 110 + i * 14, rnd(), 0, PI * 2);
          ctx.stroke();
        }
      } else {
        const tone = kind === 'oil' ? '22,18,14' : '8,14,18';
        for (let i = 0; i < 14; i++) {
          const x = 256 + (rnd() - 0.5) * 260;
          const yy = 256 + (rnd() - 0.5) * 260;
          const rad = 60 + rnd() * 110;
          const g = ctx.createRadialGradient(x, yy, rad * 0.2, x, yy, rad);
          g.addColorStop(0, `rgba(${tone},${kind === 'oil' ? 0.55 : 0.42})`);
          g.addColorStop(1, `rgba(${tone},0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, yy, rad, 0, PI * 2);
          ctx.fill();
        }
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      roughness: kind === 'salt' ? 0.9 : kind === 'oil' ? 0.25 : 0.06,
      metalness: kind === 'oil' ? 0.2 : 0,
    });
  });
}

/** A coverall on a hook: body, sleeves and a hood fold, in `color`. */
function coverall(pb: PieceBuilder, x: number, top: number, color: THREE.Material, reflective: THREE.Material): void {
  pb.add(rounded(0.42, 0.9, 0.12, 0.05), color, at(x, top - 0.55, -0.1));
  for (const s of [-1, 1]) pb.add(rounded(0.12, 0.62, 0.1, 0.04), color, at(x + s * 0.25, top - 0.45, -0.1, 0, 0, s * 0.08));
  pb.add(rounded(0.44, 0.04, 0.13, 0.01), reflective, at(x, top - 0.75, -0.1));
  pb.add(rounded(0.44, 0.04, 0.13, 0.01), reflective, at(x, top - 0.98, -0.1));
  pb.add(rounded(0.3, 0.14, 0.13, 0.05), color, at(x, top - 0.06, -0.1));
}

const GEN: Record<string, (p: PieceParams, rng: Rng, m: Materials, pb: PieceBuilder) => void> = {
  /**
   * Overhead gantry crane: two ceiling-hung runway beams along local Z at x = ±width/2, a bridge across X at
   * z = `bridge`, a trolley and hoist at x = `trolley` with the hook block at `hook` height. No floor colliders.
   */
  gantry_crane(p, _rng, m, pb) {
    const W = numParam(p, 'width', 10.2);
    const L = numParam(p, 'length', 10);
    const H = numParam(p, 'height', 4.5);
    const ceil = numParam(p, 'ceiling', 5);
    const bz = numParam(p, 'bridge', 2.4);
    const tx = numParam(p, 'trolley', 4.4);
    const hookY = numParam(p, 'hook', 2.1);
    const y = P.yellow();
    const dark = P.dark();
    for (const s of [-1, 1]) {
      const x = (s * W) / 2;
      pb.add(slab(0.1, 0.3, L), y, at(x, H, 0));
      for (const dy of [-0.15, 0.15]) pb.add(slab(0.28, 0.03, L), y, at(x, H + dy, 0));
      pb.add(slab(0.05, 0.03, L), m.steel, at(x, H + 0.18, 0));
      for (let z = -L / 2 + 0.6; z <= L / 2 - 0.4; z += 2.2) pb.add(slab(0.08, Math.max(0.05, ceil - H - 0.165), 0.08), dark, at(x, (ceil + H + 0.165) / 2, z));
      pb.add(rounded(0.36, 0.3, 0.8, 0.03), y, at(x, H + 0.32, bz));
    }
    pb.add(slab(W, 0.4, 0.14), y, at(0, H + 0.32, bz));
    for (const dz of [-0.13, 0.13]) pb.add(slab(W, 0.03, 0.04), y, at(0, H + 0.12, bz + dz));
    pb.add(rounded(0.7, 0.26, 0.56, 0.03), dark, at(tx, H + 0.02, bz));
    pb.add(new THREE.CylinderGeometry(0.17, 0.17, 0.5, 16).rotateZ(PI / 2), y, at(tx, H - 0.24, bz));
    pb.add(rounded(0.26, 0.2, 0.3, 0.03), m.steel, at(tx + 0.36, H - 0.24, bz));
    for (const dz of [-0.05, 0.05]) pb.add(cylinderBetween(V(tx, H - 0.4, bz + dz), V(tx, hookY + 0.36, bz + dz), 0.012, 6), dark);
    pb.add(rounded(0.24, 0.34, 0.16, 0.03), y, at(tx, hookY + 0.2, bz));
    pb.add(new THREE.TorusGeometry(0.085, 0.024, 6, 14, PI * 1.45).rotateZ(PI * 0.78), dark, at(tx, hookY - 0.04, bz));
    // Amber rotating beacon on the bridge: dark until `trunk:beacon` { on: true }; a steady glow under reduced flashing.
    const bx = -W / 4;
    pb.add(new THREE.CylinderGeometry(0.09, 0.1, 0.08, 16), dark, at(bx, H + 0.56, bz));
    const beaconMat = cached('dive-beacon', () => new THREE.MeshBasicMaterial({ color: 0xffa21a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    const beam = new THREE.ConeGeometry(0.5, 2.6, 16, 1, true).rotateZ(PI / 2).translate(1.3, 0, 0);
    const beacon = new THREE.Mesh(mergeGeometries([new THREE.SphereGeometry(0.085, 14, 10).toNonIndexed(), beam.toNonIndexed()], false)!, beaconMat);
    beacon.position.set(bx, H + 0.66, bz);
    beacon.name = 'gantry-beacon';
    beacon.visible = false;
    const beaconLens = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10), lamp('beacon-steady', 0xffa21a, 2.4));
    beaconLens.position.copy(beacon.position);
    beaconLens.visible = false;
    beaconLens.name = 'gantry-beacon-steady';
    pb.dynamic(beacon);
    pb.dynamic(beaconLens);
    let beaconOn = false;
    pb.tick((t) => {
      beacon.visible = beaconOn && !flashingState.reduced;
      beaconLens.visible = beaconOn && flashingState.reduced;
      beacon.rotation.y = t * 4.2;
    });
    pb.on('trunk:beacon', (e) => {
      beaconOn = (e as { on?: boolean } | undefined)?.on === true;
    });
    pb.on('level:reset', () => {
      beaconOn = false;
    });
    // Safe working load stencil on the bridge's north face (the side seen on entry).
    pb.add(new THREE.PlaneGeometry(0.9, 0.22), stencilDecal([{ text: 'SWL 5 t', size: 0.72, y: 0.8 }], 256, 64, '#141414', 'swl'), at(-1.5, H + 0.32, bz - 0.075, 0, PI, 0));
    pb.add(new THREE.PlaneGeometry(0.9, 0.22), stencilDecal([{ text: 'SWL 5 t', size: 0.72, y: 0.8 }], 256, 64, '#141414', 'swl'), at(1.5, H + 0.32, bz + 0.075));
  },

  /**
   * The recovered ROV on its deck cradle. Local -Z is its front (lamps, camera, arm, core basket).
   * `name` is stencilled on the float block.
   */
  rov(p, rng, m, pb) {
    const name = strParam(p, 'name', 'NEREUS');
    const base = boolParam(p, 'cradle', true) ? 0.32 : 0;
    const Wd = 1.3;
    const Ln = 1.8;
    const Hf = 0.95;
    const alu = P.alu();
    if (base > 0) {
      for (const s of [-1, 1]) {
        pb.add(slab(0.12, 0.12, 2.0), P.yellow(), at(s * 0.6, 0.06, 0));
        for (const z of [-0.7, 0.7]) pb.add(slab(0.08, 0.2, 0.08), P.yellow(), at(s * 0.6, 0.22, z));
      }
      for (const z of [-0.7, 0.7]) pb.add(slab(1.32, 0.08, 0.12), P.yellow(), at(0, 0.16, z));
      for (const [x, z] of [[-0.5, -0.6], [0.5, -0.6], [-0.5, 0.6], [0.5, 0.6]] as const) pb.add(slab(0.3, 0.06, 0.3), P.rubber(), at(x, base - 0.03, z));
    }
    const top = base + Hf;
    for (const x of [-Wd / 2, Wd / 2]) {
      for (const z of [-Ln / 2, Ln / 2]) pb.add(cylinderBetween(V(x, base, z), V(x, top, z), 0.03, 8), alu);
      for (const yy of [base, base + 0.5, top]) pb.add(cylinderBetween(V(x, yy, -Ln / 2), V(x, yy, Ln / 2), 0.026, 8), alu);
    }
    for (const z of [-Ln / 2, Ln / 2]) for (const yy of [base, top]) pb.add(cylinderBetween(V(-Wd / 2, yy, z), V(Wd / 2, yy, z), 0.026, 8), alu);
    // Syntactic foam float block, thruster ducts through it, the name on both flanks.
    pb.add(rounded(Wd + 0.08, 0.34, Ln + 0.06, 0.06), P.foam(), at(0, top + 0.17, 0));
    for (const [x, z] of [[-0.42, -0.58], [0.42, -0.58], [-0.42, 0.58], [0.42, 0.58]] as const) pb.add(new THREE.CylinderGeometry(0.12, 0.12, 0.36, 16), P.black(), at(x, top + 0.17, z));
    const tag = stencilDecal([{ text: name, size: 0.62, y: 0.74 }], 512, 96, '#15191c', `rov-${name}`);
    for (const s of [-1, 1]) pb.add(new THREE.PlaneGeometry(1.1, 0.2), tag, at(s * (Wd / 2 + 0.042), top + 0.17, 0, 0, (s * PI) / 2, 0));
    for (const s of [-1, 1]) pb.add(new THREE.CylinderGeometry(0.12, 0.12, 0.3, 16).rotateX(PI / 2), P.black(), at(s * 0.52, base + 0.55, Ln / 2 + 0.08, 0, s * 0.5, 0));
    // Pressure housings for the electronics and batteries.
    for (const x of [-0.3, 0.3]) pb.add(new THREE.CylinderGeometry(0.13, 0.13, 1.2, 16).rotateX(PI / 2), P.anodized(), at(x, base + 0.3, 0.1));
    pb.add(new THREE.CylinderGeometry(0.1, 0.1, 0.7, 14).rotateZ(PI / 2), P.dark(), at(0, base + 0.68, 0.2));
    // Lamps and camera at the front.
    for (const x of [-0.42, 0.42]) {
      pb.add(rounded(0.14, 0.14, 0.12, 0.02), P.dark(), at(x, top - 0.08, -Ln / 2 - 0.05));
      pb.add(new THREE.CircleGeometry(0.05, 16).rotateY(PI), lamp('rov-lamp', 0xe8f4ff, 1.6), at(x, top - 0.08, -Ln / 2 - 0.112));
    }
    pb.add(new THREE.SphereGeometry(0.08, 14, 10), m.glass, at(0, top - 0.25, -Ln / 2 - 0.06));
    pb.add(new THREE.CylinderGeometry(0.085, 0.085, 0.14, 14).rotateX(PI / 2), P.dark(), at(0, top - 0.25, -Ln / 2 + 0.02));
    // Manipulator arm, folded.
    const sh = V(0.38, base + 0.38, -Ln / 2);
    const el = V(0.36, base + 0.62, -Ln / 2 - 0.32);
    const wr = V(0.3, base + 0.36, -Ln / 2 - 0.5);
    pb.add(cylinderBetween(sh, el, 0.045, 10), P.anodized());
    pb.add(cylinderBetween(el, wr, 0.038, 10), P.anodized());
    pb.add(new THREE.SphereGeometry(0.06, 10, 8), P.dark(), at(el.x, el.y, el.z));
    for (const dx of [-0.04, 0.04]) pb.add(slab(0.025, 0.12, 0.05), P.dark(), at(wr.x + dx, wr.y - 0.07, wr.z));
    // Core basket, pulled out at the front bottom, six cores lying across it.
    pb.add(slab(1.0, 0.03, 0.42), alu, at(0, base + 0.04, -Ln / 2 - 0.24));
    for (const s of [-1, 1]) pb.add(slab(0.03, 0.18, 0.42), alu, at(s * 0.5, base + 0.12, -Ln / 2 - 0.24));
    pb.add(slab(1.0, 0.18, 0.03), alu, at(0, base + 0.12, -Ln / 2 - 0.44));
    for (let i = 0; i < 6; i++) {
      const z = -Ln / 2 - 0.08 - (i % 3) * 0.12;
      const yy = base + 0.09 + Math.floor(i / 3) * 0.075;
      core(pb, rng, at(-0.4, yy, z, 0, 0, -PI / 2), 0.8);
    }
    // Seawater still dripping off the frame: 12 drops falling to the deck, a ripple ring where the last one landed.
    const N = 12;
    const drops = Array.from({ length: N }, (_, i) => ({ x: rng.range(-Wd / 2, Wd / 2), z: rng.range(-Ln / 2, Ln / 2), y0: base + rng.range(0, 0.1), phase: i / N }));
    const pos = new Float32Array(N * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dripMat = cached('dive-drip', () => new THREE.PointsMaterial({ color: 0xcfe9f2, size: 0.028, transparent: true, opacity: 0.8, depthWrite: false }));
    const points = new THREE.Points(geo, dripMat);
    points.name = 'rov-drips';
    points.frustumCulled = false;
    pb.dynamic(points);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xcfe9f2, transparent: true, opacity: 0, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.045, 24).rotateX(-PI / 2), ringMat);
    ring.position.y = 0.012;
    ring.name = 'rov-ripple';
    pb.dynamic(ring);
    const PERIOD = 2.6;
    let lastHit = -1;
    let ringAge = 9;
    pb.tick((t, dt) => {
      for (let i = 0; i < N; i++) {
        const d = drops[i]!;
        const k = ((t / PERIOD + d.phase) % 1) * 2.2; // falls during the first ~45 % of its cycle
        const fall = Math.min(1, k);
        const y = d.y0 * (1 - fall * fall);
        pos[i * 3] = d.x;
        pos[i * 3 + 1] = k < 1 ? y : -10;
        pos[i * 3 + 2] = d.z;
        if (k >= 1 && k < 1.06 && lastHit !== i) {
          lastHit = i;
          ringAge = 0;
          ring.position.x = d.x;
          ring.position.z = d.z;
        }
      }
      (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      ringAge += dt;
      const s = 1 + ringAge * 6;
      ring.scale.set(s, 1, s);
      ringMat.opacity = Math.max(0, 0.5 - ringAge * 0.9);
    });
    pb.solid(-Wd / 2 - 0.08, 0, -Ln / 2 - 0.6, Wd / 2 + 0.08, top + 0.34, Ln / 2 + 0.25, 'metal');
  },

  /** Tether management winch: a drum of orange umbilical on a skid with its motor. */
  tether_winch(_p, _rng, m, pb) {
    pb.add(slab(1.7, 0.12, 1.0), P.dark(), at(0, 0.06, 0));
    for (const s of [-1, 1]) {
      pb.add(slab(0.1, 1.05, 0.9), P.yellow(), at(s * 0.64, 0.63, 0));
      pb.add(new THREE.CylinderGeometry(0.56, 0.56, 0.04, 28).rotateZ(PI / 2), P.dark(), at(s * 0.55, 0.72, 0));
    }
    pb.add(new THREE.CylinderGeometry(0.47, 0.47, 1.04, 28).rotateZ(PI / 2), P.umbilical(), at(0, 0.72, 0));
    for (let i = 0; i < 9; i++) pb.add(new THREE.TorusGeometry(0.475, 0.012, 6, 28).rotateY(PI / 2), P.dark(), at(-0.48 + i * 0.12, 0.72, 0));
    pb.add(new THREE.CylinderGeometry(0.06, 0.06, 1.5, 10).rotateZ(PI / 2), m.steel, at(0, 0.72, 0));
    pb.add(rounded(0.36, 0.4, 0.42, 0.04), P.greyBlue(), at(0.9, 0.62, 0));
    pb.add(new THREE.CylinderGeometry(0.15, 0.15, 0.3, 16).rotateZ(PI / 2), P.greyBlue(), at(0.9, 0.62, 0));
    pb.add(cylinderBetween(V(0.9, 0.85, 0.1), V(0.7, 1.3, 0.35), 0.02, 6), P.black());
    pb.add(cylinderBetween(V(0.9, 0.85, -0.1), V(0.7, 1.3, -0.35), 0.02, 6), P.black());
    pb.solid(-0.85, 0, -0.5, 1.1, 1.3, 0.5, 'metal');
  },

  /** Stainless wet bench with a sink, sample trays and an overhead shelf (wall-backed, back on z = 0). */
  wet_bench(p, rng, _m, pb) {
    const W = numParam(p, 'width', 2.2);
    const D = 0.75;
    pb.add(slab(W, 0.82, D - 0.07), P.cabinet(), at(0, 0.45, -(D - 0.07) / 2));
    pb.add(slab(W, 0.04, D - 0.07), P.black(), at(0, 0.02, -(D - 0.07) / 2 + 0.03));
    for (let i = 1; i < 4; i++) pb.add(slab(0.006, 0.7, 0.01), P.dark(), at(-W / 2 + (i * W) / 4, 0.46, -D + 0.065));
    pb.add(slab(W, 0.04, D), P.stainless(), at(0, 0.9, -D / 2));
    pb.add(slab(W, 0.6, 0.02), P.stainless(), at(0, 1.22, -0.01));
    // Sink and tap.
    pb.add(slab(0.55, 0.012, 0.4), P.dark(), at(-W / 2 + 0.45, 0.921, -0.4));
    pb.add(cylinderBetween(V(-W / 2 + 0.45, 0.92, -0.08), V(-W / 2 + 0.45, 1.22, -0.08), 0.015, 8), P.stainless());
    pb.add(cylinderBetween(V(-W / 2 + 0.45, 1.22, -0.08), V(-W / 2 + 0.45, 1.2, -0.28), 0.015, 8), P.stainless());
    // Sample trays with jars of mud and a clipboard.
    for (let t = 0; t < 2; t++) {
      const tx = 0.05 + t * 0.48;
      pb.add(slab(0.42, 0.04, 0.3), P.white(), at(tx, 0.94, -0.36));
      for (let j = 0; j < 6; j++) {
        const jx = tx - 0.14 + (j % 3) * 0.14;
        const jz = -0.43 + Math.floor(j / 3) * 0.14;
        pb.add(new THREE.CylinderGeometry(0.03, 0.03, 0.08, 10), P.mud(Math.floor(rng.next() * 5)), at(jx, 1.0, jz));
        pb.add(new THREE.CylinderGeometry(0.032, 0.032, 0.02, 10), P.white(), at(jx, 1.05, jz));
      }
    }
    pb.add(slab(0.23, 0.01, 0.31), P.white(), at(W / 2 - 0.3, 0.925, -0.42, 0, 0.2, 0));
    // Overhead shelf with reagent bottles; it also keeps the bench from being a jump top.
    pb.add(slab(W, 0.03, 0.3), P.stainless(), at(0, 1.72, -0.15));
    for (const x of [-W / 2 + 0.1, W / 2 - 0.1]) pb.add(slab(0.03, 0.2, 0.28), P.stainless(), at(x, 1.62, -0.15));
    for (let i = 0; i < 7; i++) pb.add(new THREE.CylinderGeometry(0.04, 0.04, 0.2, 10), i % 3 === 0 ? P.white() : P.amberGlass(), at(-W / 2 + 0.3 + i * 0.26, 1.835, -0.15));
    pb.solid(-W / 2, 0, -D, W / 2, 0.93, 0, 'metal');
    pb.solid(-W / 2, 1.7, -0.3, W / 2, 1.96, 0, 'metal');
  },

  /** Upright rack of sediment cores in three tiers (wall-backed). */
  core_rack(_p, rng, _m, pb) {
    const W = 1.2;
    for (const x of [-W / 2, W / 2]) pb.add(slab(0.04, 1.9, 0.4), P.stainless(), at(x, 0.95, -0.2));
    pb.add(slab(W, 1.9, 0.02), P.greyBlue(), at(0, 0.95, -0.01));
    for (const yy of [0.08, 0.72, 1.36]) {
      pb.add(slab(W, 0.03, 0.4), P.stainless(), at(0, yy, -0.2));
      pb.add(slab(W, 0.02, 0.36), P.dark(), at(0, yy + 0.4, -0.2));
      for (let i = 0; i < 9; i++) core(pb, rng, at(-W / 2 + 0.12 + i * 0.12, yy + 0.015, -0.2), 0.5, 0.032);
    }
    pb.solid(-W / 2 - 0.02, 0, -0.4, W / 2 + 0.02, 1.9, 0, 'metal');
  },

  /** Emergency eyewash and safety shower (wall-backed): yellow riser, bowls, pull handle and its green sign. */
  eyewash_station(_p, _rng, _m, pb) {
    const y = P.yellow();
    pb.add(cylinderBetween(V(0, 0, -0.1), V(0, 2.35, -0.1), 0.03, 10), y);
    pb.add(cylinderBetween(V(0, 2.3, -0.1), V(0, 2.3, -0.5), 0.025, 10), y);
    pb.add(new THREE.CylinderGeometry(0.16, 0.12, 0.06, 18), y, at(0, 2.25, -0.5));
    pb.add(cylinderBetween(V(0, 2.25, -0.32), V(0, 1.7, -0.32), 0.006, 4), P.dark());
    pb.add(new THREE.TorusGeometry(0.06, 0.012, 6, 3), y, at(0, 1.66, -0.32));
    pb.add(cylinderBetween(V(0, 0.95, -0.1), V(0, 0.95, -0.32), 0.02, 8), y);
    pb.add(new THREE.CylinderGeometry(0.15, 0.1, 0.08, 18), y, at(0, 1.0, -0.36));
    for (const dx of [-0.05, 0.05]) pb.add(new THREE.CylinderGeometry(0.025, 0.025, 0.04, 10), P.green(), at(dx, 1.05, -0.36));
    const sign = paintedDecal(
      (ctx, w, h) => {
        ctx.fillStyle = '#1b7a46';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#e8efe9';
        ctx.lineWidth = 6;
        ctx.strokeRect(8, 8, w - 16, h - 16);
        ctx.fillStyle = '#f2f5f2';
        ctx.textAlign = 'center';
        ctx.font = '800 54px "Arial Narrow", Arial, sans-serif';
        ctx.fillText('EYEWASH', w / 2, h * 0.43);
        ctx.font = '700 36px "Arial Narrow", Arial, sans-serif';
        ctx.fillText('SAFETY SHOWER', w / 2, h * 0.78);
      },
      320,
      200,
      'eyewash',
      false,
    );
    pb.add(new THREE.PlaneGeometry(0.44, 0.27), sign, at(0.36, 1.95, -0.012, 0, PI, 0));
    pb.solid(-0.12, 0, -0.22, 0.12, 2.35, 0);
  },

  /** Pegboard of ROV tools with painted outlines; a few tools are signed out (wall-backed). */
  shadow_board(_p, rng, _m, pb) {
    const W = 1.6;
    const H = 1.0;
    const cy = 1.5;
    pb.add(slab(W, H, 0.03), P.pegboard(), at(0, cy, -0.015));
    const outlines = paintedDecal(
      (ctx) => {
        ctx.fillStyle = '#e8e6df';
        ctx.font = '700 30px "Arial Narrow", Arial, sans-serif';
        ctx.fillText('ROV TOOLS — SIGN OUT', 20, 40);
        ctx.strokeStyle = '#2b2f33';
        ctx.lineWidth = 5;
        for (let i = 0; i < 6; i++) {
          const x = 70 + i * 100;
          ctx.strokeRect(x - 12, 80, 24, 150 + (i % 3) * 30);
        }
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.ellipse(120 + i * 160, 330, 50, 24, 0, 0, PI * 2);
          ctx.stroke();
        }
      },
      700,
      440,
      'shadow-board',
      false,
    );
    pb.add(new THREE.PlaneGeometry(W - 0.04, H - 0.04), outlines, at(0, cy, -0.031, 0, PI, 0));
    // Tools hanging in most outlines.
    const px = (u: number): number => -W / 2 + 0.02 + (u / 700) * (W - 0.04);
    const py = (v: number): number => cy + H / 2 - 0.02 - (v / 440) * (H - 0.04);
    for (let i = 0; i < 6; i++) {
      if (i === 2 || i === 5) continue;
      const len = (150 + (i % 3) * 30) / 440;
      pb.add(slab(0.035, len, 0.02), P.tool(), at(px(70 + i * 100), py(80) - len / 2, -0.045));
      pb.add(slab(0.05, 0.1, 0.03), P.toolGrip(), at(px(70 + i * 100), py(80) - len + 0.05, -0.05));
    }
    for (let i = 0; i < 4; i++) {
      if (i === 1) continue;
      pb.add(new THREE.TorusGeometry(0.045, 0.012, 6, 12), rng.chance(0.5) ? P.tool() : P.toolGrip(), at(px(120 + i * 160), py(330), -0.045, 0, 0, 0));
    }
    pb.solid(-W / 2, cy - H / 2, -0.06, W / 2, cy + H / 2, 0);
  },

  /** Dive-log whiteboard (wall-backed). `lines` is a `|`-separated list. */
  whiteboard(p, _rng, _m, pb) {
    const W = numParam(p, 'width', 1.8);
    const H = numParam(p, 'height', 1.05);
    const cy = numParam(p, 'y', 1.55);
    const lines = strParam(p, 'lines', 'DIVE 214').split('|');
    pb.add(slab(W + 0.06, H + 0.06, 0.03), P.alu(), at(0, cy, -0.015));
    const board = paintedDecal(
      (ctx, w, h) => {
        ctx.fillStyle = '#eef0ec';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(120,130,140,0.12)';
        for (let i = 0; i < 40; i++) ctx.fillRect((i * 97) % w, (i * 53) % h, 140, 6);
        ctx.textAlign = 'left';
        lines.forEach((line, i) => {
          const head = i === 0;
          ctx.fillStyle = line.startsWith('!') ? '#b02a1e' : head ? '#1d3f8a' : '#202326';
          ctx.font = `${head ? 700 : 500} ${head ? 64 : 44}px "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive`;
          ctx.fillText(line.replace(/^!/, ''), 34, 80 + (head ? 0 : 30) + i * 62);
        });
      },
      1024,
      600,
      'whiteboard',
      false,
    );
    pb.add(new THREE.PlaneGeometry(W, H), board, at(0, cy, -0.032, 0, PI, 0));
    pb.add(slab(W * 0.6, 0.03, 0.07), P.alu(), at(0, cy - H / 2 - 0.04, -0.05));
    for (const [x, c] of [[-0.2, P.red()], [-0.1, P.black()], [0.0, paint('markerBlue', 0x1d3f8a, 0.5)]] as const) pb.add(new THREE.CylinderGeometry(0.011, 0.011, 0.13, 8).rotateZ(PI / 2), c, at(x, cy - H / 2 - 0.02, -0.05));
    pb.solid(-W / 2, cy - H / 2 - 0.06, -0.09, W / 2, cy + H / 2, 0);
  },

  // ---------------------------------------------------------------- R13a wet vestibule

  /** Wall-backed boot-wash trough with a scrub brush, a hose on a hook and a tap. */
  boot_wash(p, _rng, m, pb) {
    const W = numParam(p, 'width', 1.3);
    pb.add(slab(W, 0.32, 0.45), P.stainless(), at(0, 0.16, -0.225));
    pb.add(slab(W - 0.08, 0.02, 0.37), P.dark(), at(0, 0.31, -0.225));
    pb.add(slab(W, 0.5, 0.02), P.stainless(), at(0, 0.62, -0.01));
    for (let i = 0; i < 5; i++) pb.add(slab(0.03, 0.06, 0.3), P.black(), at(-W / 2 + 0.2 + i * 0.07, 0.35, -0.22));
    pb.add(cylinderBetween(V(W / 2 - 0.2, 0.62, -0.03), V(W / 2 - 0.2, 0.9, -0.03), 0.018, 8), P.stainless());
    pb.add(cylinderBetween(V(W / 2 - 0.2, 0.9, -0.03), V(W / 2 - 0.2, 0.88, -0.2), 0.018, 8), P.stainless());
    pb.add(new THREE.TorusGeometry(0.16, 0.022, 8, 20), P.green(), at(-0.15, 1.15, -0.05));
    pb.add(rounded(0.06, 0.08, 0.06, 0.01), m.steel, at(-0.15, 1.32, -0.03));
    pb.solid(-W / 2, 0, -0.45, W / 2, 0.33, 0, 'metal');
  },

  /** Wall-backed hook rail with dive-bay coveralls and a row of boots under them. */
  coverall_hooks(p, _rng, m, pb) {
    const n = Math.round(numParam(p, 'count', 3));
    const W = n * 0.55;
    const top = 1.95;
    pb.add(slab(W + 0.1, 0.06, 0.04), P.stainless(), at(0, top, -0.02));
    const reflective = paint('reflective', 0xd8dcd6, 0.3, 0.4);
    const colors = [P.foam(), paint('navy', 0x22324a, 0.85), P.foam(), paint('navy', 0x22324a, 0.85)];
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + 0.275 + i * 0.55;
      pb.add(cylinderBetween(V(x, top, -0.03), V(x, top + 0.02, -0.12), 0.01, 6), m.steel);
      coverall(pb, x, top, colors[i % colors.length]!, reflective);
      for (const dx of [-0.08, 0.08]) {
        pb.add(rounded(0.11, 0.36, 0.14, 0.04), P.black(), at(x + dx, 0.18, -0.12));
        pb.add(rounded(0.11, 0.06, 0.26, 0.03), P.black(), at(x + dx, 0.03, -0.18));
      }
    }
    pb.solid(-W / 2, 0, -0.3, W / 2, 0.4, 0);
  },

  // ---------------------------------------------------------------- R13c ROV workshop

  /** Wall-backed workbench with a spare thruster, a manipulator arm in a vice and a parts tray. */
  workbench(p, rng, m, pb) {
    const W = numParam(p, 'width', 2.4);
    const D = 0.8;
    pb.add(slab(W, 0.06, D), paint('benchTop', 0x5d4a34, 0.7), at(0, 0.9, -D / 2));
    for (const x of [-W / 2 + 0.06, W / 2 - 0.06]) for (const z of [-D + 0.06, -0.06]) pb.add(slab(0.05, 0.87, 0.05), P.dark(), at(x, 0.435, z));
    pb.add(slab(W - 0.1, 0.03, D - 0.1), P.dark(), at(0, 0.22, -D / 2));
    pb.add(slab(W, 0.9, 0.02), P.pegboard(), at(0, 1.42, -0.01));
    // Spare thruster: shrouded propeller on its motor pod.
    pb.add(new THREE.CylinderGeometry(0.17, 0.17, 0.3, 20, 1, true).rotateZ(PI / 2), P.black(), at(-0.6, 1.12, -0.42));
    pb.add(new THREE.CylinderGeometry(0.07, 0.07, 0.36, 12).rotateZ(PI / 2), P.anodized(), at(-0.6, 1.12, -0.42));
    for (let i = 0; i < 3; i++) pb.add(slab(0.02, 0.24, 0.05), P.foam(), at(-0.6, 1.12, -0.42, (i * 2 * PI) / 3, 0, 0));
    pb.add(slab(0.3, 0.1, 0.2), P.dark(), at(-0.6, 0.98, -0.42));
    // Manipulator arm in the vice.
    pb.add(rounded(0.16, 0.12, 0.2, 0.02), P.greyBlue(), at(0.55, 0.99, -0.2));
    pb.add(cylinderBetween(V(0.55, 1.05, -0.3), V(0.2, 1.08, -0.55), 0.045, 10), P.anodized());
    pb.add(cylinderBetween(V(0.2, 1.08, -0.55), V(-0.05, 1.0, -0.62), 0.038, 10), P.anodized());
    for (const dz of [-0.035, 0.035]) pb.add(slab(0.12, 0.025, 0.02), P.dark(), at(-0.12, 0.99, -0.62 + dz));
    // Parts tray and tools.
    pb.add(slab(0.4, 0.05, 0.28), P.white(), at(1.0, 0.955, -0.45));
    for (let i = 0; i < 8; i++) pb.add(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 6), m.steel, at(0.88 + (i % 4) * 0.07, 0.99, -0.5 + Math.floor(i / 4) * 0.09));
    for (let i = 0; i < 4; i++) pb.add(slab(0.03, 0.22, 0.015), P.tool(), at(-W / 2 + 0.3 + i * 0.12, 1.55 + rng.range(-0.04, 0.04), -0.03));
    pb.add(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8).rotateZ(PI / 2), P.green(), at(0.2, 1.75, -0.04));
    pb.solid(-W / 2, 0, -D, W / 2, 0.93, 0, 'metal');
  },

  /** Wall-backed battery charging cabinet: three ROV battery pods on charge, status LEDs. */
  battery_charger(_p, _rng, _m, pb) {
    pb.add(slab(1.0, 1.5, 0.6), P.greyBlue(), at(0, 0.75, -0.3));
    for (let i = 0; i < 3; i++) {
      const y = 0.3 + i * 0.42;
      pb.add(slab(0.92, 0.02, 0.5), P.dark(), at(0, y - 0.18, -0.32));
      pb.add(new THREE.CylinderGeometry(0.11, 0.11, 0.62, 16).rotateZ(PI / 2), P.anodized(), at(-0.06, y - 0.05, -0.36));
      pb.add(slab(0.05, 0.03, 0.01), lamp(i === 2 ? 'charge-amber' : 'charge-green', i === 2 ? 0xffa21a : 0x39ff9e, 2.2), at(0.38, y, -0.605));
      pb.add(cylinderBetween(V(0.25, y - 0.05, -0.36), V(0.38, y - 0.12, -0.2), 0.012, 6), P.black());
    }
    pb.solid(-0.5, 0, -0.6, 0.5, 1.5, 0, 'metal');
  },

  /** Wall-backed rack of small parts bins in two colours. */
  parts_bins(p, _rng, _m, pb) {
    const W = numParam(p, 'width', 1.6);
    pb.add(slab(W, 1.2, 0.03), P.greyBlue(), at(0, 1.4, -0.015));
    const cols = Math.round(W / 0.2);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < cols; c++) {
        const x = -W / 2 + 0.1 + c * 0.2;
        pb.add(rounded(0.17, 0.2, 0.22, 0.02), (r + c) % 3 === 0 ? paint('binBlue', 0x2b5d8a, 0.6) : P.foam(), at(x, 0.95 + r * 0.28, -0.13));
        pb.add(slab(0.1, 0.03, 0.005), P.white(), at(x, 1.02 + r * 0.28, -0.243));
      }
    }
    pb.solid(-W / 2, 0.8, -0.26, W / 2, 2.0, 0);
  },

  /** Chained gas cylinders (nitrogen and air) in a floor rack, back to the wall. */
  gas_cylinder_rack(_p, _rng, _m, pb) {
    const colors = [paint('n2', 0x2a2d30, 0.5, 0.3), paint('air', 0xd8dad4, 0.5, 0.3), paint('n2', 0x2a2d30, 0.5, 0.3)];
    for (let i = 0; i < 3; i++) {
      const x = -0.32 + i * 0.32;
      pb.add(new THREE.CylinderGeometry(0.12, 0.12, 1.45, 18), colors[i]!, at(x, 0.725, -0.18));
      pb.add(new THREE.SphereGeometry(0.12, 16, 8, 0, PI * 2, 0, PI / 2), colors[i]!, at(x, 1.45, -0.18));
      pb.add(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 10), P.stainless(), at(x, 1.6, -0.18));
    }
    pb.add(slab(1.05, 0.05, 0.36), P.yellow(), at(0, 0.03, -0.18));
    for (const y of [0.5, 1.15]) pb.add(slab(1.05, 0.04, 0.02), P.yellow(), at(0, y, -0.32));
    pb.solid(-0.5, 0, -0.34, 0.5, 1.7, 0);
  },

  /** Wall-mounted hose reel with a coil of hydraulic hose. */
  hose_reel(_p, _rng, _m, pb) {
    pb.add(slab(0.5, 0.5, 0.04), P.dark(), at(0, 1.3, -0.02));
    pb.add(new THREE.CylinderGeometry(0.28, 0.28, 0.04, 24).rotateX(PI / 2), P.yellow(), at(0, 1.3, -0.06));
    pb.add(new THREE.TorusGeometry(0.2, 0.06, 10, 24), P.black(), at(0, 1.3, -0.15));
    pb.add(new THREE.CylinderGeometry(0.28, 0.28, 0.04, 24).rotateX(PI / 2), P.yellow(), at(0, 1.3, -0.24));
    pb.add(cylinderBetween(V(0.18, 1.1, -0.15), V(0.22, 0.4, -0.2), 0.022, 8), P.black());
    pb.solid(-0.3, 1.0, -0.27, 0.3, 1.6, 0);
  },

  // ---------------------------------------------------------------- R13e sample store

  /**
   * The chain-of-custody cold store (wall-backed): a 4 °C sample cabinet with a glass door full of cores, marked
   * for Lab B, and its custody terminal. The sample case is stowed here (`round:dive_case`).
   */
  cold_store(_p, rng, _m, pb) {
    const W = 1.2;
    const H = 2.0;
    const D = 0.72;
    pb.add(slab(W, H, D - 0.04), P.stainless(), at(0, H / 2, -(D - 0.04) / 2));
    pb.add(slab(W - 0.12, H - 0.3, 0.02), glassDoor(), at(0, H / 2 + 0.05, -D + 0.03));
    pb.add(new THREE.PlaneGeometry(W - 0.2, H - 0.4), lamp('fridge-light', 0xcfe7ff, 0.35), at(0, H / 2 + 0.05, -0.08, 0, PI, 0));
    for (let r = 0; r < 4; r++) {
      const y = 0.32 + r * 0.42;
      pb.add(slab(W - 0.2, 0.015, D - 0.2), P.stainless(), at(0, y, -D / 2));
      for (let i = 0; i < 7; i++) core(pb, rng, at(-0.42 + i * 0.14, y + 0.01, -D / 2 - 0.05), 0.32, 0.03);
    }
    pb.add(cylinderBetween(V(W / 2 - 0.1, 0.7, -D - 0.01), V(W / 2 - 0.1, 1.4, -D - 0.01), 0.015, 8), P.stainless());
    const tag = paintedDecal(
      (ctx, w, h) => {
        ctx.fillStyle = '#e9ece6';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#1d3f8a';
        ctx.fillRect(0, 0, w, 52);
        ctx.fillStyle = '#ffffff';
        ctx.font = '800 38px "Arial Narrow", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('LAB B · COLD STORE', w / 2, 40);
        ctx.fillStyle = '#202326';
        ctx.font = '700 30px "Arial Narrow", Arial, sans-serif';
        ctx.fillText('CHAIN OF CUSTODY', w / 2, 96);
        ctx.font = '500 24px "Arial Narrow", Arial, sans-serif';
        ctx.fillText('HOLD AT +4 °C · SIGN EVERY TRANSFER', w / 2, 138);
      },
      420,
      160,
      'cold-store',
      false,
    );
    pb.add(new THREE.PlaneGeometry(0.62, 0.24), tag, at(0, H - 0.12, -D - 0.005, 0, PI, 0));
    // Custody terminal on an arm to the right of the door.
    pb.add(rounded(0.36, 0.26, 0.05, 0.01), P.black(), at(W / 2 + 0.25, 1.35, -0.32, 0, 0.3, 0));
    pb.add(cylinderBetween(V(W / 2, 1.2, -0.05), V(W / 2 + 0.2, 1.3, -0.28), 0.02, 8), P.dark());
    pb.add(new THREE.PlaneGeometry(0.32, 0.21), lamp('custody-screen', 0x7dd3ff, 0.9), at(W / 2 + 0.24, 1.35, -0.35, 0, PI + 0.3, 0));
    pb.add(slab(0.08, 0.08, 0.02), lamp('custody-led', 0x39ff9e, 2.4), at(W / 2 + 0.24, 1.18, -0.33, 0, 0.3, 0));
    pb.solid(-W / 2, 0, -D, W / 2, H, 0, 'metal');
  },

  /** Wall-backed pair of glass-door lab fridges with core trays. */
  core_fridge(_p, rng, _m, pb) {
    for (const x of [-0.37, 0.37]) {
      pb.add(slab(0.72, 0.86, 0.6), P.white(), at(x, 0.43, -0.3));
      pb.add(slab(0.6, 0.6, 0.015), glassDoor(), at(x, 0.48, -0.605));
      pb.add(new THREE.PlaneGeometry(0.56, 0.56), lamp('fridge-light', 0xcfe7ff, 0.35), at(x, 0.48, -0.08, 0, PI, 0));
      for (let i = 0; i < 4; i++) core(pb, rng, at(x - 0.2 + i * 0.13, 0.22, -0.32), 0.42, 0.028);
    }
    pb.add(slab(1.48, 0.04, 0.62), P.stainless(), at(0, 0.88, -0.31));
    pb.add(slab(0.3, 0.12, 0.2), P.white(), at(0.4, 0.96, -0.3));
    pb.solid(-0.74, 0, -0.62, 0.74, 0.9, 0, 'metal');
  },

  /** Wall-backed upright -80 °C freezer, frost round its door seal. */
  freezer(_p, _rng, _m, pb) {
    pb.add(slab(0.8, 1.9, 0.75), P.white(), at(0, 0.95, -0.375));
    pb.add(slab(0.7, 1.4, 0.02), paint('freezerDoor', 0xd9dcd7, 0.45), at(0, 0.95, -0.76));
    pb.add(slab(0.72, 0.03, 0.03), paint('frost', 0xeef6fb, 0.9), at(0, 1.66, -0.765));
    pb.add(slab(0.03, 1.42, 0.03), paint('frost', 0xeef6fb, 0.9), at(-0.36, 0.95, -0.765));
    pb.add(slab(0.24, 0.1, 0.01), lamp('freezer-readout', 0xff5a3a, 1.6), at(0, 1.78, -0.755));
    pb.add(slab(0.04, 0.4, 0.05), P.stainless(), at(0.28, 1.0, -0.79));
    pb.solid(-0.4, 0, -0.78, 0.4, 1.9, 0, 'metal');
  },

  /** Wall-backed pressure-retaining sample cabinet: three pressure vessels with gauges, "HOLD AT 302 BAR". */
  pressure_cabinet(_p, _rng, _m, pb) {
    pb.add(slab(0.7, 1.4, 0.5), P.greyBlue(), at(0, 0.7, -0.25));
    for (let i = 0; i < 3; i++) {
      const x = -0.2 + i * 0.2;
      pb.add(new THREE.CylinderGeometry(0.07, 0.07, 0.6, 14), P.stainless(), at(x, 0.62, -0.32));
      pb.add(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 16).rotateX(PI / 2), P.white(), at(x, 1.0, -0.505));
      pb.add(slab(0.004, 0.035, 0.004), P.red(), at(x + 0.01, 1.005, -0.517, 0, 0, -0.7));
    }
    const sign = stencilDecal(
      [
        { text: 'PRESSURE SAMPLES', size: 0.26, y: 0.36 },
        { text: 'HOLD AT 302 BAR', size: 0.3, y: 0.8 },
      ],
      512,
      160,
      '#b02a1e',
      'pressure-cabinet',
    );
    pb.add(new THREE.PlaneGeometry(0.62, 0.2), sign, at(0, 1.22, -0.505, 0, PI, 0));
    pb.solid(-0.35, 0, -0.5, 0.35, 1.4, 0, 'metal');
  },

  /** Wall-backed hooks of orange emergency survival suits by the store door. */
  survival_suits(p, _rng, m, pb) {
    const n = Math.round(numParam(p, 'count', 3));
    const W = n * 0.36;
    const top = 1.9;
    pb.add(slab(W + 0.08, 0.05, 0.04), P.stainless(), at(0, top, -0.02));
    const suit = paint('survival', 0xd8551c, 0.7);
    const tape = paint('reflective', 0xd8dcd6, 0.3, 0.4);
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + 0.18 + i * 0.36;
      pb.add(cylinderBetween(V(x, top, -0.03), V(x, top + 0.02, -0.12), 0.01, 6), m.steel);
      pb.add(rounded(0.32, 1.1, 0.16, 0.06), suit, at(x, top - 0.65, -0.12));
      pb.add(rounded(0.33, 0.05, 0.17, 0.01), tape, at(x, top - 0.45, -0.12));
    }
    pb.solid(-W / 2, 0.6, -0.22, W / 2, top, 0);
  },

  // ---------------------------------------------------------------- R13d

  /** A hissing leak at a pipe joint: a slow vapour puff over a damp patch. */
  pipe_leak(_p, _rng, _m, pb) {
    pb.add(new THREE.TorusGeometry(0.075, 0.025, 8, 16).rotateY(PI / 2), P.dark(), at(0, 0, 0));
    const puff = vapourPuff(0.45, 0.9, vapourMaterial('leak', 0xc8d4d8, 0.35, 0.35));
    puff.name = 'leak-vapour';
    pb.dynamic(puff);
    pb.tick((t) => {
      vapourUniforms.uTime.value = t;
    });
  },

  // ---------------------------------------------------------------- signage and wear (tasks 5.1, 5.2)

  /**
   * Room plate, optionally with a life-support panel beside it, on one backlit canvas (wall-backed, one draw call).
   * `code` / `name` / `sub` fill the plate; `warn` adds a red line; `panel: false` drops the life-support half.
   */
  room_sign(p, _rng, _m, pb) {
    const panel = boolParam(p, 'panel', true);
    const y = numParam(p, 'y', 1.9);
    const code = strParam(p, 'code', 'R13');
    const name = strParam(p, 'name', '');
    const sub = strParam(p, 'sub', 'DECK 0 · DIVE BAY');
    const warn = strParam(p, 'warn', '');
    const o2 = numParam(p, 'o2', 20.9);
    const co2 = numParam(p, 'co2', 640);
    const rh = numParam(p, 'rh', 72);
    const W = numParam(p, 'width', panel ? 1.2 : 0.6);
    const canvas = document.createElement('canvas');
    canvas.width = panel ? 1024 : 512;
    canvas.height = 384;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Plate.
      ctx.fillStyle = '#e6e9e4';
      ctx.fillRect(0, 0, 512, 384);
      ctx.fillStyle = '#c79a22';
      ctx.fillRect(0, 0, 512, 64);
      ctx.fillStyle = '#15191c';
      ctx.font = '800 44px "Arial Narrow", Arial, sans-serif';
      ctx.fillText(sub, 24, 48);
      ctx.font = '800 110px "Arial Narrow", Arial, sans-serif';
      ctx.fillText(code, 24, 178);
      ctx.font = '700 52px "Arial Narrow", Arial, sans-serif';
      ctx.fillText(name, 24, 250);
      if (warn) {
        ctx.fillStyle = '#b02a1e';
        ctx.font = '700 38px "Arial Narrow", Arial, sans-serif';
        ctx.fillText(warn, 24, 330);
      }
      ctx.strokeStyle = '#9aa0a4';
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, 506, 378);
      if (panel) {
        ctx.fillStyle = '#0a1214';
        ctx.fillRect(524, 0, 500, 384);
        ctx.strokeStyle = '#3f5a62';
        ctx.strokeRect(527, 3, 494, 378);
        ctx.fillStyle = '#7dd3ff';
        ctx.font = `700 38px ${SCREEN_FONT}`;
        ctx.fillText('LIFE SUPPORT', 552, 60);
        const rows: Array<[string, string]> = [['O2', `${o2.toFixed(1)} %`], ['CO2', `${Math.round(co2)} ppm`], ['PRESS', '1.01 bar'], ['RH', `${Math.round(rh)} %`]];
        ctx.font = `600 34px ${SCREEN_FONT}`;
        rows.forEach(([k, v], i) => {
          ctx.fillStyle = '#39ff9e';
          ctx.beginPath();
          ctx.arc(566, 116 + i * 66, 9, 0, PI * 2);
          ctx.fill();
          ctx.fillStyle = '#7fa8b4';
          ctx.fillText(k, 590, 128 + i * 66);
          ctx.fillStyle = '#e2f6ff';
          ctx.fillText(v, 760, 128 + i * 66);
        });
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35, roughness: 0.4 });
    pb.add(slab(W + 0.04, 0.49, 0.02), P.dark(), at(0, y, -0.01));
    pb.add(new THREE.PlaneGeometry(W, 0.45), mat, at(0, y, -0.021, 0, PI, 0));
  },

  /**
   * Pipe identification bands with flow arrows along a pipe run (local X, at height `y`, radius `radius`):
   * `labels` is `|`-separated; each is `TEXT:colour`. One atlas, one draw call.
   */
  pipe_labels(p, _rng, _m, pb) {
    const L = numParam(p, 'length', 8);
    const y = numParam(p, 'y', 0.4);
    const r = numParam(p, 'radius', 0.1);
    const every = numParam(p, 'every', 2.5);
    const entries = strParam(p, 'labels', 'SEAWATER COOLING:#2f7a3a').split('|').map((e) => {
      const [text, color] = e.split(':');
      return { text: text ?? '', color: color ?? '#2f7a3a' };
    });
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 64 * entries.length;
    const ctx = canvas.getContext('2d');
    entries.forEach((e, i) => {
      if (!ctx) return;
      ctx.fillStyle = e.color;
      ctx.fillRect(0, i * 64, 512, 64);
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 36px "Arial Narrow", Arial, sans-serif';
      ctx.fillText(e.text, 18, i * 64 + 45);
      ctx.beginPath();
      ctx.moveTo(430, i * 64 + 14);
      ctx.lineTo(494, i * 64 + 32);
      ctx.lineTo(430, i * 64 + 50);
      ctx.closePath();
      ctx.fill();
    });
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 });
    const planes: THREE.BufferGeometry[] = [];
    let k = 0;
    for (let x = -L / 2 + every / 2; x < L / 2; x += every, k++) {
      const row = k % entries.length;
      const g = new THREE.PlaneGeometry(0.62, 0.075);
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      for (let v = 0; v < uv.count; v++) uv.setY(v, 1 - (row + 1 - uv.getY(v)) / entries.length);
      g.applyMatrix4(at(x, y, -r - 0.004, 0, PI, 0));
      planes.push(g);
    }
    if (planes.length) pb.add(mergeGeometries(planes, false)!, mat);
  },

  /** A floor wear decal: `kind` puddle | oil | salt | prints, `width` x `depth`. One shared material per kind. */
  floor_wear(p, _rng, _m, pb) {
    const kind = strParam(p, 'kind', 'puddle');
    const w = numParam(p, 'width', 1.2);
    const d = numParam(p, 'depth', 0.8);
    pb.add(new THREE.PlaneGeometry(w, d).rotateX(-PI / 2), wearMaterial(kind), at(0, 0.006, 0));
  },

  /**
   * ROV pilot console: a desk with three monitors (one canvas: sonar, telemetry, trunk state) and two chairs.
   * The pilots sit on the -Z side and the screens face them (and the room behind them).
   */
  pilot_console(_p, _rng, m, pb) {
    const W = 2.6;
    const D = 0.85;
    pb.add(slab(W, 0.04, D), P.dark(), at(0, 0.76, 0));
    for (const s of [-1, 1]) pb.add(slab(0.05, 0.74, D - 0.05), P.greyBlue(), at(s * (W / 2 - 0.05), 0.37, 0));
    pb.add(slab(0.6, 0.62, 0.6), P.greyBlue(), at(0.7, 0.33, 0.08));
    for (let i = 0; i < 8; i++) pb.add(slab(0.03, 0.012, 0.03), lamp(i % 3 === 0 ? 'rack-amber' : 'rack-green', i % 3 === 0 ? 0xffa21a : 0x39ff9e, 2), at(0.48 + i * 0.06, 0.55, -0.225));
    // Keyboards and joysticks for pilot and co-pilot.
    for (const x of [-0.6, 0.6]) {
      pb.add(rounded(0.5, 0.025, 0.17, 0.008), P.black(), at(x, 0.79, -0.18));
      pb.add(rounded(0.12, 0.04, 0.12, 0.02), P.black(), at(x + 0.38, 0.8, -0.22));
      pb.add(cylinderBetween(V(x + 0.38, 0.8, -0.22), V(x + 0.38, 0.95, -0.24), 0.014, 8), P.black());
    }
    // Monitor housings and stands.
    const mw = 0.8;
    const mh = 0.47;
    const mons = [-1, 0, 1].map((i) => ({ x: i * 0.82, ry: -i * 0.24, y: 1.2, z: 0.22 - Math.abs(i) * 0.1 }));
    for (const mo of mons) {
      pb.add(rounded(mw + 0.05, mh + 0.05, 0.05, 0.012), P.black(), at(mo.x, mo.y, mo.z + 0.03, 0, mo.ry, 0));
      pb.add(cylinderBetween(V(mo.x, 0.78, mo.z + 0.1), V(mo.x, mo.y - 0.2, mo.z + 0.06), 0.02, 8), P.dark());
    }
    // One canvas for all three screens, mapped across three planes merged into one mesh.
    let trunk: 'open' | 'closing' | 'closed' = 'open';
    let closeAt = 0;
    let now = 0;
    const screen = new CanvasScreen(1536, 288, (ctx, t, w, h) => drawPilot(ctx, t, w, h, trunk), 1.25, 6);
    const planes = mons.map((mo, i) => {
      const g = new THREE.PlaneGeometry(mw, mh);
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      // Monitor 0 (local -x) is on the pilots' right, so it shows the last panel: sonar, telemetry, trunk read left to right.
      for (let k = 0; k < uv.count; k++) uv.setX(k, (2 - i + uv.getX(k)) / 3);
      g.applyMatrix4(at(mo.x, mo.y, mo.z, 0, mo.ry + PI, 0).multiply(at(0, 0, 0.002)));
      return g;
    });
    const display = new THREE.Mesh(mergeGeometries(planes, false)!, screen.material);
    display.name = 'pilot-screens';
    display.userData['trunk'] = trunk;
    pb.dynamic(display);
    const set = (state: unknown, instant: unknown): void => {
      if (state === 'open') trunk = 'open';
      else if (state === 'closed') {
        trunk = instant === true ? 'closed' : 'closing';
        closeAt = now + 4;
      } else return;
      display.userData['trunk'] = trunk;
    };
    pb.tick((t) => {
      now = t;
      if (trunk === 'closing' && t >= closeAt) {
        trunk = 'closed';
        display.userData['trunk'] = trunk;
      }
      screen.update(t);
    });
    pb.on('trunk:state', (e) => {
      const ev = e as { state?: string; instant?: boolean } | undefined;
      set(ev?.state, ev?.instant);
    });
    pb.on('level:reset', () => set('open', true));
    // Pilot chairs on the -Z side, facing the screens.
    for (const x of [-0.6, 0.6]) {
      const cz = -0.75;
      pb.add(new THREE.CylinderGeometry(0.25, 0.25, 0.04, 5), P.black(), at(x, 0.04, cz));
      pb.add(cylinderBetween(V(x, 0.04, cz), V(x, 0.44, cz), 0.03, 8), m.steel);
      pb.add(rounded(0.48, 0.08, 0.46, 0.03), P.black(), at(x, 0.48, cz));
      pb.add(rounded(0.46, 0.55, 0.07, 0.03), P.black(), at(x, 0.82, cz - 0.24, -0.12, 0, 0));
    }
    pb.solid(-W / 2, 0, -D / 2, W / 2, 0.78, D / 2, 'metal');
    pb.solid(-1.3, 0.78, 0.0, 1.3, 1.5, 0.35);
  },
};

/** The pilot console's three panels: sonar, ROV telemetry, and the trunk state. */
export function drawPilot(ctx: CanvasRenderingContext2D, t: number, w: number, h: number, trunk: 'open' | 'closing' | 'closed'): void {
  const pw = w / 3;
  ctx.fillStyle = '#020806';
  ctx.fillRect(0, 0, w, h);
  // 1. Sonar sweep.
  const cx = pw / 2;
  const cy = h / 2 + 14;
  const r = h / 2 - 24;
  ctx.strokeStyle = 'rgba(80,230,150,0.35)';
  ctx.lineWidth = 2;
  for (let i = 1; i <= 4; i++) {
    ctx.beginPath();
    ctx.arc(cx, cy, (r * i) / 4, 0, PI * 2);
    ctx.stroke();
  }
  const a = (t * 1.1) % (PI * 2);
  ctx.strokeStyle = 'rgba(120,255,180,0.9)';
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  ctx.stroke();
  for (const [ba, br] of [[0.6, 0.55], [2.4, 0.8], [4.1, 0.35], [5.2, 0.72]] as const) {
    const since = (a - ba + PI * 2) % (PI * 2);
    ctx.fillStyle = `rgba(150,255,190,${Math.max(0.15, 1 - since / 3)})`;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(ba) * r * br, cy + Math.sin(ba) * r * br, 5, 0, PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#7dffb4';
  ctx.font = screenFont(20);
  ctx.fillText('SONAR  300 kHz  RANGE 50 m', 16, 26);
  // 2. Telemetry.
  const x2 = pw + 22;
  ctx.fillStyle = '#9fe8ff';
  ctx.font = screenFont(26, 700);
  ctx.fillText('ROV NEREUS · DIVE 214', x2, 36);
  ctx.font = screenFont(21);
  const drift = (v: number, d: number): string => (v + Math.sin(t * 0.7 + v) * d).toFixed(1);
  const rows: Array<[string, string]> = [
    ['STATUS', 'ON DECK  RECOVERED 06:42'],
    ['MAX DEPTH', '3,018 m'],
    ['EXT PRESS', `${drift(302.4, 0.15)} BAR`],
    ['TETHER', '0 / 4,000 m'],
    ['HEADING', `${Math.round(212 + Math.sin(t * 0.3) * 2)}°`],
    ['BATTERY', '64 %  CHARGING'],
  ];
  rows.forEach(([k, v], i) => {
    ctx.fillStyle = '#5f9fb0';
    ctx.fillText(k, x2, 82 + i * 34);
    ctx.fillStyle = '#d8f4ff';
    ctx.fillText(v, x2 + 160, 82 + i * 34);
  });
  // 3. Trunk.
  const x3 = pw * 2;
  const sx = x3 + 40;
  const sy = 70;
  const sw = 90;
  const sh = 180;
  ctx.strokeStyle = '#9fe8ff';
  ctx.lineWidth = 3;
  ctx.strokeRect(sx, sy, sw, sh);
  ctx.fillStyle = 'rgba(29,143,160,0.6)';
  ctx.fillRect(sx + 2, sy + sh - 16, sw - 4, 14);
  ctx.strokeStyle = trunk === 'open' ? '#ffcf3a' : '#7dffb4';
  ctx.lineWidth = 6;
  ctx.beginPath();
  if (trunk === 'open') {
    ctx.moveTo(sx + sw, sy);
    ctx.lineTo(sx + sw + 14, sy - 60);
  } else {
    ctx.moveTo(sx - 6, sy);
    ctx.lineTo(sx + sw + 6, sy);
  }
  ctx.stroke();
  ctx.strokeStyle = '#7dffb4';
  ctx.beginPath();
  ctx.moveTo(sx - 6, sy + sh);
  ctx.lineTo(sx + sw + 6, sy + sh);
  ctx.stroke();
  const tx = sx + sw + 50;
  ctx.font = screenFont(20);
  ctx.fillStyle = '#5f9fb0';
  ctx.fillText('TRUNK 1', tx, 40);
  const inner = trunk === 'open' ? 'OPEN' : trunk === 'closing' ? 'CLOSING' : 'CLOSED';
  ctx.fillStyle = '#d8f4ff';
  ctx.fillText(`INNER HATCH  ${inner}`, tx, 92);
  ctx.fillText('TRUNK  DRAINED 1.0 BAR', tx, 128);
  ctx.fillText('OUTER HATCH  SEALED', tx, 164);
  ctx.fillText('SEA  302 BAR', tx, 200);
  ctx.font = screenFont(26, 800);
  if (trunk === 'closed') {
    ctx.fillStyle = '#7dffb4';
    ctx.fillText('TRUNK SECURED', tx, 256);
  } else if (trunk === 'closing') {
    ctx.fillStyle = Math.floor(t * 3) % 2 ? '#ffcf3a' : '#7a6420';
    ctx.fillText('HATCH MOVING', tx, 256);
  } else {
    ctx.fillStyle = '#ffcf3a';
    ctx.fillText('KEEP GATE SHUT', tx, 256);
  }
  ctx.fillStyle = 'rgba(159,232,255,0.25)';
  ctx.fillRect(pw - 1, 0, 2, h);
  ctx.fillRect(pw * 2 - 1, 0, 2, h);
}

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

export const DIVE_BAY_PROPS: PieceDef[] = Object.entries(GEN).map(([id, gen]) => def(id, gen));
