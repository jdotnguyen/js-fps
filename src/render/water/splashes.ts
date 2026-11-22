import * as THREE from 'three';
import type { SplashEvent } from '../../world/waterDisturbances.ts';

/**
 * Spray thrown by splashes (standing-water spec "Splashes", overhaul-flooded-tunnel D7): one GPU `Points` system for
 * the level. A burst writes its droplets' start, velocity, birth time and life into a ring buffer once; the vertex
 * shader moves them ballistically and hides each one when it falls back through the surface, so frames upload nothing.
 */

export const MAX_DROPLETS = 2048;
const GRAVITY = 9.8;

export interface SplashPreset {
  count: number;
  /** Upward speed range (m/s). */
  up: [number, number];
  /** Sideways speed (m/s) at most. */
  spread: number;
  /** Droplet size (m) and life (s). */
  size: number;
  life: number;
}

export const SPLASH_PRESETS: Readonly<Record<SplashEvent['kind'], SplashPreset>> = {
  step: { count: 10, up: [0.5, 1.1], spread: 0.45, size: 0.011, life: 0.5 },
  takeoff: { count: 36, up: [1.4, 2.4], spread: 0.9, size: 0.014, life: 0.8 },
  land: { count: 64, up: [1.6, 3.0], spread: 1.5, size: 0.015, life: 0.9 },
  bullet: { count: 28, up: [2.2, 4.2], spread: 0.35, size: 0.01, life: 0.8 },
  body: { count: 96, up: [1.8, 3.4], spread: 1.8, size: 0.017, life: 1.0 },
  part: { count: 20, up: [1.0, 2.0], spread: 0.8, size: 0.012, life: 0.7 },
  drip: { count: 3, up: [0.3, 0.6], spread: 0.15, size: 0.007, life: 0.35 },
  spark: { count: 5, up: [0.2, 0.5], spread: 0.2, size: 0.007, life: 0.3 },
};

/** Droplets a burst of `kind` at `size` (0..1) throws. */
export function burstCount(kind: SplashEvent['kind'], size: number): number {
  const p = SPLASH_PRESETS[kind];
  return Math.max(1, Math.round(p.count * (0.5 + Math.min(1, Math.max(0, size)))));
}

const VERT = /* glsl */ `
uniform float uTime;
uniform float uScale;
attribute vec3 aStart;
attribute vec3 aVel;
attribute vec3 aInfo; // birth time, life, size
varying float vAlpha;
void main() {
  float t = uTime - aInfo.x;
  vec3 p = aStart + aVel * t + vec3(0.0, -0.5 * ${GRAVITY.toFixed(1)} * t * t, 0.0);
  // Gone once its life is over, or once it falls back through the surface it left.
  bool dead = t < 0.0 || t > aInfo.y || (t > 0.05 && p.y < aStart.y);
  vAlpha = dead ? 0.0 : (1.0 - t / aInfo.y);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = dead ? 0.0 : aInfo.z * uScale / max(-mv.z, 0.05);
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  if (vAlpha <= 0.0) discard;
  vec2 c = gl_PointCoord - 0.5;
  float r = dot(c, c);
  if (r > 0.25) discard;
  float edge = smoothstep(0.25, 0.05, r);
  gl_FragColor = vec4(uColor, vAlpha * edge * 0.85);
}`;

export class WaterSplashes {
  readonly points: THREE.Points;
  private readonly start = new Float32Array(MAX_DROPLETS * 3);
  private readonly vel = new Float32Array(MAX_DROPLETS * 3);
  private readonly info = new Float32Array(MAX_DROPLETS * 3);
  private readonly material: THREE.ShaderMaterial;
  private cursor = 0;
  private time = 0;
  private readonly random: () => number;

  constructor(random: () => number = Math.random) {
    this.random = random;
    this.info.fill(-1e6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_DROPLETS * 3), 3));
    g.setAttribute('aStart', new THREE.BufferAttribute(this.start, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aVel', new THREE.BufferAttribute(this.vel, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aInfo', new THREE.BufferAttribute(this.info, 3).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: { value: 0 }, uScale: { value: 600 }, uColor: { value: new THREE.Color(0.16, 0.21, 0.2) } },
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.name = 'water-splashes';
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  /** Throw a burst (the `onSplash` of `WaterDisturbances`). */
  burst(s: SplashEvent): void {
    const p = SPLASH_PRESETS[s.kind];
    const n = burstCount(s.kind, s.size);
    const scale = 0.7 + Math.min(1, Math.max(0, s.size)) * 0.6;
    const g = this.points.geometry;
    for (let i = 0; i < n; i++) {
      const k = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_DROPLETS;
      const a = this.random() * Math.PI * 2;
      const r = Math.sqrt(this.random()) * p.spread * scale;
      this.start.set([s.x + Math.cos(a) * 0.04, s.y + 0.01, s.z + Math.sin(a) * 0.04], k * 3);
      this.vel.set([Math.cos(a) * r, (p.up[0] + this.random() * (p.up[1] - p.up[0])) * scale, Math.sin(a) * r], k * 3);
      this.info.set([this.time + this.random() * 0.04, p.life * (0.7 + this.random() * 0.6), p.size * (0.35 + this.random() * 1.3)], k * 3);
    }
    for (const name of ['aStart', 'aVel', 'aInfo']) (g.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Live droplets at the current time (tests and stats). */
  live(): number {
    let n = 0;
    for (let k = 0; k < MAX_DROPLETS; k++) {
      const t = this.time - this.info[k * 3]!;
      if (t >= 0 && t <= this.info[k * 3 + 1]!) n++;
    }
    return n;
  }

  update(dt: number, viewportHeight: number, fovDeg: number): void {
    this.time += dt;
    this.material.uniforms['uTime']!.value = this.time;
    // Point size in pixels for a 1 m droplet at 1 m.
    this.material.uniforms['uScale']!.value = viewportHeight / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
