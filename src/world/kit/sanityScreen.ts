import * as THREE from 'three';
import type { Materials } from '../../render/materials.ts';
import { NOISE_GLSL } from '../../render/fx/glsl.ts';
import { slab } from './shapes.ts';
import type { PieceBuilder } from './types.ts';

/**
 * Sanity screens (openspec change overhaul-exterior-ocean, spec exterior-ocean): displays mounted
 * over the real glass of crew rooms, showing a bright daytime downtown view behind half-open blinds.
 * The view is one panorama along the wall (bays continue each other, like a window would), with a
 * little parallax between its layers, a pixel grid that only shows up close, and a faint scan band.
 */

const screenTime = { value: 0 };

const SCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vRight;
  varying vec3 vNormalW;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    // Works merged (world-space geometry) or placed: the wall's right is up x its normal.
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vRight = normalize(cross(vec3(0.0, 1.0, 0.0), vNormalW));
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const SCREEN_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uBrightness;
  uniform float uSillY;
  uniform float uHeight;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vRight;
  varying vec3 vNormalW;
  ${NOISE_GLSL}

  // Panorama coordinates (u along the wall in metres, v up the screen 0..1) seen at a virtual depth.
  vec2 layer(float depth) {
    vec3 view = normalize(vWorld - cameraPosition);
    float into = max(dot(view, -vNormalW), 0.25);
    vec3 p = vWorld + view * (depth / into);
    return vec2(dot(p, vRight), (p.y - uSillY) / uHeight);
  }

  // A row of buildings: returns (inside, window light).
  vec2 skyline(vec2 q, float width, float hMin, float hMax, float seed) {
    float id = floor(q.x / width);
    float f = fract(q.x / width);
    float h = mix(hMin, hMax, hash12(vec2(id, seed)));
    float gap = step(0.06 + 0.1 * hash12(vec2(id, seed + 3.0)), f);
    float inside = gap * step(q.y, h);
    vec2 cell = vec2(f * (5.0 + floor(hash12(vec2(id, seed + 5.0)) * 4.0)), q.y * 26.0);
    vec2 g = fract(cell);
    float win = step(0.22, g.x) * step(g.x, 0.78) * step(0.28, g.y) * step(g.y, 0.82) * step(0.12, f) * step(f, 0.94);
    win *= step(q.y, h - 0.02);
    return vec2(inside, win);
  }

  void main() {
    vec2 far = layer(0.6);
    vec2 mid = layer(0.3);
    vec2 near = layer(0.12);
    float v = far.y;

    // Daytime sky: pale at the horizon, clear blue up high, a few soft clouds and a sun haze.
    vec3 col = mix(vec3(0.86, 0.90, 0.93), vec3(0.36, 0.60, 0.86), smoothstep(0.3, 1.05, v));
    float cloud = smoothstep(0.55, 0.8, vnoise(vec2(far.x * 0.35 + uTime * 0.01, v * 3.0)) * vnoise(vec2(far.x * 0.9, v * 6.0 + 1.3)) * 1.8);
    col = mix(col, vec3(0.97, 0.98, 1.0), cloud * smoothstep(0.55, 0.85, v) * 0.7);
    col += vec3(1.0, 0.93, 0.78) * 0.18 * exp(-8.0 * abs(v - 0.42));

    // Three building layers, hazier with distance.
    vec2 b = skyline(far, 0.22, 0.42, 0.62, 1.0);
    col = mix(col, mix(vec3(0.66, 0.73, 0.80), vec3(0.80, 0.86, 0.90), b.y * 0.6), b.x);
    b = skyline(mid, 0.34, 0.34, 0.74, 2.0);
    col = mix(col, mix(vec3(0.48, 0.55, 0.63), vec3(0.72, 0.80, 0.88), b.y * 0.7), b.x);
    b = skyline(near, 0.55, 0.22, 0.9, 3.0);
    col = mix(col, mix(vec3(0.30, 0.34, 0.40), vec3(0.62, 0.72, 0.84), b.y * 0.8), b.x);

    // It is a screen: a pixel grid when seen up close, a slow scan band, darker edges.
    vec2 px = vUv * vec2(1280.0, 1080.0);
    float closeUp = 1.0 - smoothstep(0.35, 0.9, max(fwidth(px.x), fwidth(px.y)));
    vec2 cell = fract(px);
    float grid = mix(1.0, 0.82 + 0.18 * step(0.18, cell.x) * step(0.18, cell.y), closeUp);
    float band = 1.0 - 0.035 * exp(-pow((fract(vUv.y - uTime * 0.04) - 0.5) * 30.0, 2.0));
    vec2 e = min(vUv, 1.0 - vUv);
    float edge = smoothstep(0.0, 0.04, min(e.x, e.y));
    col *= grid * band * mix(0.75, 1.0, edge);

    // Authored in sRGB, written linear; capped so bloom stays soft.
    gl_FragColor = vec4(pow(col, vec3(2.2)) * uBrightness, 1.0);
  }`;

const STRIPE_FRAG = /* glsl */ `
  varying vec2 vUv;
  void main() {
    // Slat shadows on the floor: stripes parallel to the wall, fading away from it.
    float s = smoothstep(0.35, 0.5, abs(fract(vUv.y * 9.0) - 0.5) * 2.0);
    float fade = vUv.y * smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
    gl_FragColor = vec4(vec3(1.0, 0.95, 0.86) * 0.07 * s * fade * fade, 1.0);
  }`;

const UV_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const cache = new Map<string, THREE.Material>();
function cached<T extends THREE.Material>(key: string, make: () => T): T {
  let m = cache.get(key) as T | undefined;
  if (!m) {
    m = make();
    cache.set(key, m);
  }
  return m;
}

function screenMaterial(sill: number, height: number): THREE.ShaderMaterial {
  return cached(`screen:${sill}:${height}`, () => new THREE.ShaderMaterial({
    name: 'sanity-screen',
    uniforms: { uTime: screenTime, uBrightness: { value: 1.1 }, uSillY: { value: sill }, uHeight: { value: height } },
    vertexShader: SCREEN_VERT,
    fragmentShader: SCREEN_FRAG,
    fog: false,
  }));
}

export interface SanityScreenOptions {
  length: number;
  sill: number;
  head: number;
  mullions: number;
}

const MULLION_W = 0.14;
const SLAT_PITCH = 0.075;
/** Slat tilt (radians): about two-thirds open. */
const SLAT_TILT = 0.62;

/**
 * Screens, blinds, backing and floor stripes for one window wall, in the wall's frame (inner face
 * z = 0 facing +Z, glass at z = -0.04, floor at y = 0).
 */
export function sanityScreen(pb: PieceBuilder, m: Materials, f: THREE.Matrix4, o: SanityScreenOptions, inFrame: (frame: THREE.Matrix4, x: number, y: number, z: number, rx?: number, ry?: number, rz?: number) => THREE.Matrix4): void {
  const h = o.head - o.sill;
  const yc = (o.head + o.sill) / 2;
  const pitch = (o.length - MULLION_W) / (o.mullions - 1);
  const bayW = pitch - MULLION_W + 0.04;
  const screenMat = screenMaterial(o.sill, h);
  const blindMat = cached('screen:blind', () => {
    const b = new THREE.MeshStandardMaterial({ color: 0xe2ded4, roughness: 0.6, metalness: 0 });
    b.name = 'screen-blind';
    b.userData['flat'] = true;
    return b;
  });
  const stripeMat = cached('screen:stripes', () => new THREE.ShaderMaterial({
    name: 'screen-floor-stripes',
    vertexShader: UV_VERT,
    fragmentShader: STRIPE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    fog: false,
  }));
  const slats = Math.floor(h / SLAT_PITCH);
  for (let i = 0; i < o.mullions - 1; i++) {
    const x = -o.length / 2 + MULLION_W / 2 + pitch * (i + 0.5);
    // Static: merged per room with the other screens, so screens add no draw calls per bay.
    pb.add(new THREE.PlaneGeometry(bayW, h), screenMat, inFrame(f, x, yc, -0.015));
    // Dark back towards the glass, so nothing outside sees into the room or the screen.
    pb.add(new THREE.PlaneGeometry(bayW, h), m.black, inFrame(f, x, yc, -0.025, 0, Math.PI, 0));
    for (let k = 0; k < slats; k++) {
      pb.add(slab(bayW - 0.02, 0.004, 0.055), blindMat, inFrame(f, x, o.sill + (k + 0.5) * (h / slats), 0.045, SLAT_TILT, 0, 0));
    }
    pb.add(slab(bayW, 0.05, 0.08), blindMat, inFrame(f, x, o.head - 0.03, 0.05)); // head rail
    pb.add(new THREE.PlaneGeometry(bayW, 1.5), stripeMat, inFrame(f, x, 0.004, 0.2 + 0.75, -Math.PI / 2, 0, 0));
  }
  pb.tick((t) => {
    screenTime.value = t;
  });
}
