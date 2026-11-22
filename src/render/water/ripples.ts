import * as THREE from 'three';
import { MAX_STAMPS, type WaterBody, type WaterStamp } from '../../world/water.ts';
import type { WaterSurfaceUniforms } from './surface.ts';

/**
 * Ripple simulation for a standing-water body (standing-water spec, overhaul-flooded-tunnel D6): a height-field wave
 * equation over the body's footprint, stepped on the GPU at a fixed 60 Hz in a ping-pong pair of half-float targets.
 * Walls, stair steps and anything else that stands through the surface are masked as reflecting edges, so waves
 * bounce off them, cross and fade. Disturbances come from `WaterBody.disturb` (feet, wakes, shots, bodies, drips).
 *
 * `stepRipplesCpu` is the same step on the CPU: the tests check the behaviour on it, and the shader mirrors it line
 * for line (same neighbours, same wall rule, same damping and stamp falloff).
 */

/** Metres per simulation texel. */
export const RIPPLE_TEXEL = 0.05;
/** Simulation steps per second. */
export const RIPPLE_HZ = 60;
/** Amplitude kept per step: a ring fades to half in about a second and is gone in a few. */
export const RIPPLE_DAMPING = 0.99;
/** At most this many steps per rendered frame (a long hitch drops time rather than stalling). */
const MAX_STEPS_PER_FRAME = 4;
/** Height (m) of noise a full hull-groan shudder adds per step. */
const SHUDDER_HEIGHT = 0.0018;

export interface RippleGrid {
  width: number;
  height: number;
  /** World x, z of texel (0, 0)'s corner and the size covered (m). */
  minX: number;
  minZ: number;
  sizeX: number;
  sizeZ: number;
}

export function rippleGrid(body: WaterBody, texel = RIPPLE_TEXEL): RippleGrid {
  const { minX, maxX, minZ, maxZ } = body.bounds;
  const width = Math.max(2, Math.ceil((maxX - minX) / texel));
  const height = Math.max(2, Math.ceil((maxZ - minZ) / texel));
  return { width, height, minX, minZ, sizeX: width * texel, sizeZ: height * texel };
}

/** Does something solid stand through the surface at (x, z)? (a wall, a step above the water, a case, a support) */
export type SolidThroughSurface = (x: number, z: number, level: number) => boolean;

/** 255 where water can move (it is sampled as 1.0), 0 at walls and outside the footprint. */
export function buildRippleMask(body: WaterBody, grid: RippleGrid, solid: SolidThroughSurface): Uint8Array<ArrayBuffer> {
  const mask = new Uint8Array(grid.width * grid.height);
  const texelX = grid.sizeX / grid.width;
  const texelZ = grid.sizeZ / grid.height;
  for (let j = 0; j < grid.height; j++) {
    const z = grid.minZ + (j + 0.5) * texelZ;
    for (let i = 0; i < grid.width; i++) {
      const x = grid.minX + (i + 0.5) * texelX;
      mask[j * grid.width + i] = body.contains(x, z) && !solid(x, z, body.level) ? 255 : 0;
    }
  }
  return mask;
}

/** Height a stamp adds at distance `d` (m): a smooth bump, full at the centre and 0 at its radius. */
export function stampFalloff(d: number, radius: number): number {
  if (d >= radius) return 0;
  const u = d / radius;
  return 0.5 + 0.5 * Math.cos(Math.PI * u);
}

/**
 * One step on the CPU. `cur` and `prev` are heights (m) per texel; the new heights are written to `out` (which may
 * be `prev`). A wall neighbour reads as the centre's own height, so waves reflect at walls.
 */
export function stepRipplesCpu(cur: Float32Array, prev: Float32Array, out: Float32Array, mask: Uint8Array, grid: RippleGrid, stamps: readonly WaterStamp[] = [], damping = RIPPLE_DAMPING): void {
  const { width: w, height: h } = grid;
  const texelX = grid.sizeX / w;
  const texelZ = grid.sizeZ / h;
  const at = (i: number, j: number, c: number): number => (i < 0 || j < 0 || i >= w || j >= h || mask[j * w + i] === 0 ? c : cur[j * w + i]!);
  const next = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      if (mask[k] === 0) continue;
      const c = cur[k]!;
      let v = ((at(i - 1, j, c) + at(i + 1, j, c) + at(i, j - 1, c) + at(i, j + 1, c)) * 0.5 - prev[k]!) * damping;
      if (stamps.length) {
        const x = grid.minX + (i + 0.5) * texelX;
        const z = grid.minZ + (j + 0.5) * texelZ;
        for (const s of stamps) v += s.strength * stampFalloff(Math.hypot(x - s.x, z - s.z), s.radius);
      }
      next[k] = v;
    }
  }
  prev.set(cur);
  out.set(next);
}

const STEP_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const STEP_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uState;   // r: height now, g: height one step ago
uniform sampler2D uMask;    // r: 1 water, 0 wall
uniform vec2 uTexel;        // one texel in uv
uniform vec4 uBounds;       // world min x, min z, size x, size z
uniform float uDamping;
uniform vec4 uStamps[${MAX_STAMPS}]; // x, z, radius, strength
uniform int uStampCount;
uniform float uShudder;
uniform float uSeed;
varying vec2 vUv;
float hash12(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float nb(vec2 uv, float c) {
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 || texture2D(uMask, uv).r < 0.5) return c;
  return texture2D(uState, uv).r;
}
void main() {
  if (texture2D(uMask, vUv).r < 0.5) { gl_FragColor = vec4(0.0); return; }
  vec2 s = texture2D(uState, vUv).rg;
  float c = s.r;
  float v = (nb(vUv - vec2(uTexel.x, 0.0), c) + nb(vUv + vec2(uTexel.x, 0.0), c) + nb(vUv - vec2(0.0, uTexel.y), c) + nb(vUv + vec2(0.0, uTexel.y), c)) * 0.5 - s.g;
  v *= uDamping;
  vec2 world = uBounds.xy + vUv * uBounds.zw;
  for (int i = 0; i < ${MAX_STAMPS}; i++) {
    if (i >= uStampCount) break;
    vec4 st = uStamps[i];
    float d = distance(world, st.xy);
    if (d < st.z) v += st.w * (0.5 + 0.5 * cos(3.14159265 * d / st.z));
  }
  if (uShudder > 0.0) v += (hash12(vUv * 913.0 + uSeed) - 0.5) * 2.0 * uShudder * ${SHUDDER_HEIGHT};
  gl_FragColor = vec4(v, c, 0.0, 1.0);
}`;

/** Fixed-step GPU ripple simulation for one water body, feeding that body's surface shader. */
export class RippleSim {
  readonly grid: RippleGrid;
  private readonly body: WaterBody;
  private readonly surface: WaterSurfaceUniforms;
  private readonly solid: SolidThroughSurface;
  private targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private readonly maskTex: THREE.DataTexture;
  /** The mask texture's own data (rebuilt in place when the shoreline moves). */
  private readonly maskData: Uint8Array<ArrayBuffer>;
  private readonly material: THREE.ShaderMaterial;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly stampVecs = Array.from({ length: MAX_STAMPS }, () => new THREE.Vector4());
  private accumulator = 0;
  private asleep = true;
  private wasChanging = false;
  private seed = 0;

  constructor(body: WaterBody, surface: WaterSurfaceUniforms, solid: SolidThroughSurface) {
    this.body = body;
    this.surface = surface;
    this.solid = solid;
    this.grid = rippleGrid(body);
    const { width, height } = this.grid;
    const rt = (): THREE.WebGLRenderTarget =>
      new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false });
    this.targets = [rt(), rt()];
    this.maskData = buildRippleMask(body, this.grid, solid);
    this.maskTex = new THREE.DataTexture(this.maskData, width, height, THREE.RedFormat, THREE.UnsignedByteType);
    this.maskTex.needsUpdate = true;
    this.material = new THREE.ShaderMaterial({
      vertexShader: STEP_VERT,
      fragmentShader: STEP_FRAG,
      uniforms: {
        uState: { value: null },
        uMask: { value: this.maskTex },
        uTexel: { value: new THREE.Vector2(1 / width, 1 / height) },
        uBounds: { value: new THREE.Vector4(this.grid.minX, this.grid.minZ, this.grid.sizeX, this.grid.sizeZ) },
        uDamping: { value: RIPPLE_DAMPING },
        uStamps: { value: this.stampVecs },
        uStampCount: { value: 0 },
        uShudder: { value: 0 },
        uSeed: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
    surface.uRippleBounds.value.set(this.grid.minX, this.grid.minZ, this.grid.sizeX, this.grid.sizeZ);
    surface.uRippleTexel.value.set(1 / width, 1 / height);
  }

  /** Advance by `dt` while the room is drawn; asleep (no passes, stamps dropped) while it isn't. */
  update(renderer: THREE.WebGLRenderer, dt: number, visible: boolean): void {
    if (!visible) {
      if (!this.asleep) {
        this.asleep = true;
        this.surface.uRippleOn.value = 0;
      }
      this.body.takeStamps();
      this.body.shudder = 0;
      return;
    }
    const prevTarget = renderer.getRenderTarget();
    if (this.asleep) {
      // Wake from a flat field.
      this.asleep = false;
      this.accumulator = 0;
      const color = renderer.getClearColor(new THREE.Color());
      const alpha = renderer.getClearAlpha();
      renderer.setClearColor(0x000000, 0);
      for (const t of this.targets) {
        renderer.setRenderTarget(t);
        renderer.clear(true, false, false);
      }
      renderer.setClearColor(color, alpha);
    }
    // A finished rise or fall moves the shoreline: steps and supports above the water change.
    if (this.wasChanging && !this.body.changing) this.rebuildMask();
    this.wasChanging = this.body.changing;

    this.accumulator = Math.min(this.accumulator + dt, MAX_STEPS_PER_FRAME / RIPPLE_HZ);
    let stamps = this.body.takeStamps();
    const u = this.material.uniforms;
    while (this.accumulator >= 1 / RIPPLE_HZ) {
      this.accumulator -= 1 / RIPPLE_HZ;
      u['uStampCount']!.value = stamps.length;
      stamps.forEach((s, i) => this.stampVecs[i]!.set(s.x, s.z, s.radius, s.strength));
      stamps = [];
      u['uShudder']!.value = this.body.shudder;
      this.body.shudder = Math.max(0, this.body.shudder - 1 / (RIPPLE_HZ * 0.6));
      u['uSeed']!.value = this.seed = (this.seed + 0.6180339) % 1;
      u['uState']!.value = this.targets[0].texture;
      renderer.setRenderTarget(this.targets[1]);
      renderer.render(this.scene, this.camera);
      this.targets = [this.targets[1], this.targets[0]];
    }
    // Stamps that arrived between steps wait for the next one.
    for (const s of stamps) this.body.pending.push(s);
    renderer.setRenderTarget(prevTarget);
    this.surface.uRipple.value = this.targets[0].texture;
    this.surface.uRippleOn.value = 1;
  }

  rebuildMask(): void {
    this.maskData.set(buildRippleMask(this.body, this.grid, this.solid));
    this.maskTex.needsUpdate = true;
  }

  dispose(): void {
    for (const t of this.targets) t.dispose();
    this.maskTex.dispose();
    this.material.dispose();
    this.surface.uRippleOn.value = 0;
    this.surface.uRipple.value = null;
  }
}
