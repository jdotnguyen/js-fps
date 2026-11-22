import * as THREE from 'three';

/**
 * Sparks from a broken fixture (flooded-tunnel spec "Failing lights and sparks in the tunnel", overhaul-flooded-tunnel
 * D11): one GPU `Points` system. Each spark flies ballistically from the fixture, cooling from white to orange, and
 * dies where it reaches the floor or a water surface. Landings in water are predicted when the burst is thrown, so the
 * hiss and the little ring happen when (and where) a spark actually comes down.
 */

export const MAX_SPARKS = 512;
const GRAVITY = 9.8;

/** Time (s) for a spark thrown upward at `vy` from height `y0` to fall to height `stopY` (Infinity if it never does). */
export function landingTime(y0: number, vy: number, stopY: number): number {
  // y0 + vy t - g t^2 / 2 = stopY
  const a = -0.5 * GRAVITY;
  const c = y0 - stopY;
  const disc = vy * vy - 4 * a * c;
  if (disc < 0) return Infinity;
  const t = (-vy - Math.sqrt(disc)) / (2 * a);
  return t > 0 ? t : Infinity;
}

const VERT = /* glsl */ `
uniform float uTime;
uniform float uScale;
attribute vec3 aStart;
attribute vec3 aVel;
attribute vec4 aInfo; // birth, life, size, stop height
varying float vHeat;
void main() {
  float t = uTime - aInfo.x;
  vec3 p = aStart + aVel * t + vec3(0.0, -0.5 * ${GRAVITY.toFixed(1)} * t * t, 0.0);
  bool dead = t < 0.0 || t > aInfo.y || p.y < aInfo.w;
  vHeat = dead ? -1.0 : 1.0 - t / aInfo.y;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = dead ? 0.0 : aInfo.z * uScale / max(-mv.z, 0.05);
}`;

const FRAG = /* glsl */ `
varying float vHeat;
void main() {
  if (vHeat < 0.0) discard;
  vec2 c = gl_PointCoord - 0.5;
  float r = dot(c, c);
  if (r > 0.25) discard;
  vec3 hot = mix(vec3(1.0, 0.35, 0.06), vec3(1.0, 0.92, 0.7), vHeat * vHeat);
  gl_FragColor = vec4(hot * (2.0 + 4.0 * vHeat), smoothstep(0.25, 0.0, r));
}`;

/** Where a spark burst should land: the floor or water height under a point, and whether that is water. */
export type SparkGround = (x: number, z: number) => { y: number; water: boolean };

export class Sparks {
  readonly points: THREE.Points;
  private readonly start = new Float32Array(MAX_SPARKS * 3);
  private readonly vel = new Float32Array(MAX_SPARKS * 3);
  private readonly info = new Float32Array(MAX_SPARKS * 4);
  private readonly material: THREE.ShaderMaterial;
  private readonly pending: Array<{ at: number; x: number; y: number; z: number }> = [];
  private cursor = 0;
  private time = 0;
  private readonly random: () => number;
  private readonly ground: SparkGround;
  /** A spark came down in water at (x, y, z): the hiss and the ring hook in here. */
  onWater: ((x: number, y: number, z: number) => void) | null = null;

  constructor(ground: SparkGround, random: () => number = Math.random) {
    this.ground = ground;
    this.random = random;
    for (let k = 0; k < MAX_SPARKS; k++) this.info[k * 4] = -1e6;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_SPARKS * 3), 3));
    g.setAttribute('aStart', new THREE.BufferAttribute(this.start, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aVel', new THREE.BufferAttribute(this.vel, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aInfo', new THREE.BufferAttribute(this.info, 4).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: { value: 0 }, uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.name = 'sparks';
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  /** A shower from a fixture at (x, y, z); `strong` when the tube cuts out (a bigger shower). */
  burst(x: number, y: number, z: number, strong: boolean): void {
    const n = strong ? 26 + Math.floor(this.random() * 14) : 8 + Math.floor(this.random() * 8);
    const ground = this.ground(x, z);
    for (let i = 0; i < n; i++) {
      const k = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_SPARKS;
      const a = this.random() * Math.PI * 2;
      const r = this.random() * 1.6;
      const vx = Math.cos(a) * r;
      const vz = Math.sin(a) * r;
      const vy = -0.4 + this.random() * 1.8;
      const life = 0.6 + this.random() * 0.9;
      this.start.set([x, y - 0.03, z], k * 3);
      this.vel.set([vx, vy, vz], k * 3);
      this.info.set([this.time, life, 0.008 + this.random() * 0.012, ground.y], k * 4);
      // A spark that lives long enough to reach the water lands there.
      const tl = landingTime(y - 0.03, vy, ground.y);
      if (ground.water && tl <= life && this.pending.length < 64) this.pending.push({ at: this.time + tl, x: x + vx * tl, y: ground.y, z: z + vz * tl });
    }
    const g = this.points.geometry;
    for (const name of ['aStart', 'aVel', 'aInfo']) (g.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
  }

  update(dt: number, viewportHeight: number, fovDeg: number): void {
    this.time += dt;
    this.material.uniforms['uTime']!.value = this.time;
    this.material.uniforms['uScale']!.value = viewportHeight / (2 * Math.tan((fovDeg * Math.PI) / 360));
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i]!;
      if (p.at > this.time) continue;
      this.pending.splice(i, 1);
      this.onWater?.(p.x, p.y, p.z);
    }
  }

  /** Landings still to come (tests). */
  get waiting(): number {
    return this.pending.length;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
