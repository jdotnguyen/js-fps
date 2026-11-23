import * as THREE from 'three';
import type { ControlledLight, LightPattern } from './lights.ts';
import { projectCubeSh } from './roomLightProbe.ts';

/**
 * Per-room reflections (openspec change room-light-response, environment-lighting spec). Each room is captured into
 * its own filtered environment from its capture point, one cube face per frame, and the camera's room supplies
 * `scene.environment`, cross-fading on a room change. The same capture yields the room's bounce light (spherical
 * harmonics, read back asynchronously). The level supplies the rooms, their lighting versions and the rendering
 * (`CaptureHost`); this module owns the GPU targets and the schedule.
 */

/** The layer capture cameras see (design D1): the level's geometry and lights, never characters, viewmodel, gore or particles. */
export const CAPTURE_LAYER = 7;
/** Cube face size of a capture (design D1). PMREM filters it into its own 256 px minimum (three r187). */
export const CAPTURE_SIZE = 128;
/** Captures kept at once (design D4). */
export const MAX_CAPTURES = 8;
/** Room hand-over cross-fade (design D3; spec: 0.3 to 0.8 s). */
export const BLEND_SECONDS = 0.5;
/** Frames one capture takes: six faces, then the filter (design D1). */
export const CAPTURE_FRAMES = 7;
/** Face size of the downsampled cube read back for the bounce light (design D5). */
export const SH_SIZE = 16;

// ---------------------------------------------------------------- steady light patterns (design D2)

/**
 * A pattern's steady brightness for captures: flicker, pulse and strobe phases never show in a reflection, so a
 * room keeps one look per pattern. Two patterns with the same steady value capture the same.
 */
export function steadyPatternValue(pattern: LightPattern): number {
  switch (pattern) {
    case 'off':
      return 0;
    case 'dying':
    case 'strobe':
      return 0.2;
    case 'alarm':
      return 0.55;
    case 'steady':
    case 'flicker':
    case 'failing':
      return 1;
  }
}

/** Set every light to its steady value (as `LightController.update` would, without touching `level`, which audio reads). */
export function applySteadyLights(items: readonly ControlledLight[]): void {
  for (const it of items) {
    const v = steadyPatternValue(it.pattern) * it.power;
    if (it.light) it.light.intensity = it.base * v;
    for (const m of it.emissives) m.emissiveIntensity = it.emissiveBase * v;
    for (const s of it.shafts) s.uIntensity.value = it.shaftBase * v;
  }
}

// ---------------------------------------------------------------- schedule and cache (design D2, D4)

interface CacheEntry<T> {
  value: T;
  /** The room's lighting version this capture saw. */
  version: number;
  /** When the room was last the camera's room or a neighbour of it (a frame counter). */
  lastUsed: number;
}

/**
 * Which room to capture next, and which captures to keep. Pure bookkeeping, so the priority rules and the LRU can be
 * tested without a GPU. Only the camera's room and its portal neighbours are ever queued: a stale room far away
 * waits until the player comes near.
 */
export class CaptureSchedule<T> {
  readonly entries = new Map<string, CacheEntry<T>>();
  private readonly max: number;

  constructor(max = MAX_CAPTURES) {
    this.max = max;
  }

  /** True when the room has no capture, or its capture saw an older lighting version. */
  needs(room: string, version: number): boolean {
    const e = this.entries.get(room);
    return !e || e.version !== version;
  }

  /** The next room to capture: the camera's room if uncaptured or stale, else the first such neighbour, else none. */
  next(current: string | null, neighbours: Iterable<string>, versionOf: (room: string) => number): string | null {
    if (current !== null && this.needs(current, versionOf(current))) return current;
    for (const n of neighbours) if (this.needs(n, versionOf(n))) return n;
    return null;
  }

  /** Mark rooms as in use this frame (the camera's room and its neighbours). */
  touch(rooms: Iterable<string>, now: number): void {
    for (const r of rooms) {
      const e = this.entries.get(r);
      if (e) e.lastUsed = now;
    }
  }

  get(room: string): T | null {
    return this.entries.get(room)?.value ?? null;
  }

  /** Store a finished capture. */
  set(room: string, value: T, version: number, now: number): void {
    this.entries.set(room, { value, version, lastUsed: now });
  }

  /**
   * Captures to drop so at most `max` remain, least recently used first. Rooms in `keep` (the camera's room, its
   * neighbours, and anything on screen mid-blend) are never dropped, even if that leaves more than `max`.
   */
  evict(keep: ReadonlySet<string>): Array<[string, T]> {
    const out: Array<[string, T]> = [];
    if (this.entries.size <= this.max) return out;
    const candidates = [...this.entries].filter(([room]) => !keep.has(room)).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [room, e] of candidates) {
      if (this.entries.size <= this.max) break;
      this.entries.delete(room);
      out.push([room, e.value]);
    }
    return out;
  }

  /** Remove every entry, returning their values for disposal. */
  clear(): T[] {
    const out = [...this.entries.values()].map((e) => e.value);
    this.entries.clear();
    return out;
  }
}

// ---------------------------------------------------------------- hand-over (design D3)

/** Cross-fade weight of the new map at `t` seconds into a hand-over: smooth, 0 at the start, 1 at `BLEND_SECONDS`. */
export function blendWeight(t: number, duration = BLEND_SECONDS): number {
  const x = Math.min(Math.max(t / duration, 0), 1);
  return x * x * (3 - 2 * x);
}

/** What `scene.environment` shows: one map, or a mix of two. `null` is the generic environment. */
export type HandoverState = { kind: 'static'; room: string | null } | { kind: 'blend'; from: string | null; to: string; weight: number };

/**
 * Which environment to show as the camera moves between rooms. A room without a capture yet keeps the old map until
 * its capture lands, then fades in. A hand-over runs to its end before the next one starts, so the view never jumps.
 */
export class Handover {
  private shown: string | null = null;
  private blend: { from: string | null; to: string; t: number } | null = null;

  /** Room whose capture is fully shown (`null`: the generic environment). */
  get current(): string | null {
    return this.shown;
  }

  /** Rooms the state refers to (never evict these). */
  inUse(): string[] {
    const out: string[] = [];
    if (this.shown !== null) out.push(this.shown);
    if (this.blend) {
      if (this.blend.from !== null) out.push(this.blend.from);
      out.push(this.blend.to);
    }
    return out;
  }

  /** Advance by `dt` toward `want` (the camera's room); `has` says whether a room's capture exists. */
  update(dt: number, want: string | null, has: (room: string) => boolean): HandoverState {
    if (this.blend) {
      this.blend.t += dt;
      if (this.blend.t < BLEND_SECONDS) return { kind: 'blend', from: this.blend.from, to: this.blend.to, weight: blendWeight(this.blend.t) };
      this.shown = this.blend.to;
      this.blend = null;
    }
    if (want !== null && want !== this.shown && has(want)) {
      this.blend = { from: this.shown, to: want, t: 0 };
      return { kind: 'blend', from: this.shown, to: want, weight: 0 };
    }
    return { kind: 'static', room: this.shown };
  }

  /** A shown room's capture was dropped (level reset): fall back to the generic environment. */
  forget(room: string): void {
    if (this.shown === room) this.shown = null;
    if (this.blend && (this.blend.from === room || this.blend.to === room)) this.blend = null;
  }

  reset(): void {
    this.shown = null;
    this.blend = null;
  }
}

// ---------------------------------------------------------------- GPU side

/** What the captures need from the level. */
export interface CaptureHost {
  /** The camera's room, or null outside every room. */
  currentRoom(): string | null;
  /** Rooms joined to `room` through open or see-through portals. */
  neighbours(room: string): Iterable<string>;
  /** Bumped whenever the room's lighting state changes (design D2). */
  lightingVersion(room: string): number;
  /** Where the room is captured from. */
  capturePoint(room: string, out: THREE.Vector3): THREE.Vector3;
  /** Put the level's own objects on `CAPTURE_LAYER` (once per capture; the level may have changed meanwhile). */
  prepareCapture(): void;
  /** Render `draw` from `eye` with the level set up for a capture: culled for `camera`, lights bound unshadowed and steady. */
  captureFromEye(eye: THREE.Vector3, draw: () => void, camera: THREE.Camera): void;
}

/** A world that takes room captures and their bounce light: the station level. */
export interface CaptureWorld extends CaptureHost {
  setRoomIrradiance(room: string, sh: THREE.SphericalHarmonics3): void;
}

/**
 * Whether a world gets per-room captures (design D7). Only the station level does; the lab world, the demo room and
 * the corner test keep the generic environment.
 */
export function isCaptureWorld(world: unknown): world is CaptureWorld {
  const w = world as Partial<Record<keyof CaptureWorld, unknown>> | null;
  return (
    !!w &&
    typeof w.currentRoom === 'function' &&
    typeof w.neighbours === 'function' &&
    typeof w.lightingVersion === 'function' &&
    typeof w.capturePoint === 'function' &&
    typeof w.prepareCapture === 'function' &&
    typeof w.captureFromEye === 'function' &&
    typeof w.setRoomIrradiance === 'function'
  );
}

/** The renderer calls the captures make (a `WebGLRenderer`, or a stub in tests). */
export interface CaptureRenderer {
  readonly coordinateSystem: THREE.CoordinateSystem;
  readonly shadowMap: { needsUpdate: boolean };
  getRenderTarget(): THREE.WebGLRenderTarget | null;
  getActiveCubeFace(): number;
  getActiveMipmapLevel(): number;
  setRenderTarget(target: THREE.WebGLRenderTarget | null, activeCubeFace?: number, activeMipmapLevel?: number): void;
  render(scene: THREE.Object3D, camera: THREE.Camera): void;
  readRenderTargetPixelsAsync(
    target: THREE.WebGLRenderTarget,
    x: number,
    y: number,
    width: number,
    height: number,
    buffer: THREE.TypedArray,
    activeCubeFaceIndex?: number,
  ): Promise<THREE.TypedArray>;
}

/** Filters a raw capture into a PMREM, reusing `target` when given (a `PMREMGenerator.fromCubemap`). */
export type PmremFilter = (cube: THREE.CubeTexture, target: THREE.WebGLCubeRenderTarget | null) => THREE.WebGLCubeRenderTarget;

export interface RoomCapturesDeps {
  renderer: CaptureRenderer;
  scene: THREE.Scene;
  host: CaptureHost;
  filter: PmremFilter;
  /** The generic environment (cold start, design D7). Must be a PMREM of the same size as the captures. */
  generic: THREE.Texture | null;
  /** A room's bounce light landed (9 RGB coefficients, raw radiance). */
  onIrradiance?: (room: string, sh: THREE.SphericalHarmonics3) => void;
  /** Override the `CAPTURE_SIZE` cube target (tests). */
  size?: number;
  /** Runs once on `dispose` (the session frees its PMREM generator here). */
  onDispose?: () => void;
}

const BLEND_FRAG = /* glsl */ `
varying vec3 vWorldDirection;
uniform samplerCube envA;
uniform samplerCube envB;
uniform float weight;
uniform float lod;
void main() {
  vec3 a = textureLod(envA, vWorldDirection, lod).rgb;
  vec3 b = textureLod(envB, vWorldDirection, lod).rgb;
  gl_FragColor = vec4(mix(a, b, weight), 1.0);
}`;

const DOWNSAMPLE_FRAG = /* glsl */ `
varying vec3 vWorldDirection;
uniform samplerCube envMap;
uniform float lod;
void main() {
  gl_FragColor = vec4(textureLod(envMap, vWorldDirection, lod).rgb, 1.0);
}`;

function cubeMaterial(name: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name,
    uniforms,
    vertexShader: THREE.ShaderChunk.cube_vert,
    fragmentShader,
    side: THREE.BackSide,
    blending: THREE.NoBlending,
    depthTest: false,
    depthWrite: false,
  });
}

/** A cube target laid out like a PMREM (`PMREMGenerator._allocateTarget`), for the blended map. */
export function pmremLikeTarget(size: number, levels: number): THREE.WebGLCubeRenderTarget {
  const t = new THREE.WebGLCubeRenderTarget(size, {
    minFilter: THREE.LinearMipmapLinearFilter,
    generateMipmaps: false,
    type: THREE.HalfFloatType,
    colorSpace: THREE.LinearSRGBColorSpace,
    depthBuffer: false,
  });
  const mips = t.texture.mipmaps as unknown[];
  for (let lod = 0; lod < levels; lod++) mips.push({ width: size >> lod, height: size >> lod });
  t.texture.name = 'PMREM';
  (t.texture as THREE.Texture & { isPMREMTexture?: boolean }).isPMREMTexture = true;
  return t;
}

interface Job {
  room: string;
  version: number;
  face: number;
  eye: THREE.Vector3;
}

/**
 * Captures rooms one face per frame and drives `scene.environment` (design D1, D3, D4). Call `step(dt)` once per frame
 * before the level's own update (as camera feeds do), and `dispose()` with the level.
 */
export class RoomCaptures {
  readonly schedule = new CaptureSchedule<THREE.WebGLCubeRenderTarget>();
  readonly handover = new Handover();
  private readonly deps: RoomCapturesDeps;
  private readonly raw: THREE.WebGLCubeRenderTarget;
  private readonly cube: THREE.CubeCamera;
  private readonly box = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 5));
  private readonly boxCam = new THREE.CubeCamera(1, 10, null as unknown as THREE.WebGLCubeRenderTarget);
  private readonly blendMat = cubeMaterial('RoomEnvBlend', BLEND_FRAG, {
    envA: { value: null },
    envB: { value: null },
    weight: { value: 0 },
    lod: { value: 0 },
  });
  private readonly downMat = cubeMaterial('RoomEnvDownsample', DOWNSAMPLE_FRAG, { envMap: { value: null }, lod: { value: 0 } });
  private readonly small: THREE.WebGLCubeRenderTarget;
  private blendTarget: THREE.WebGLCubeRenderTarget | null = null;
  private job: Job | null = null;
  private frame = 0;
  private readback: Promise<void> = Promise.resolve();
  private disposed = false;
  /** Rooms whose bounce light is being read back. */
  private readonly pendingSh = new Set<string>();
  private environment: THREE.Texture | null;
  private readonly scratchNeighbours: string[] = [];

  constructor(deps: RoomCapturesDeps) {
    this.deps = deps;
    const size = deps.size ?? CAPTURE_SIZE;
    this.raw = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, colorSpace: THREE.LinearSRGBColorSpace });
    this.cube = new THREE.CubeCamera(0.05, 80, this.raw);
    this.cube.layers.set(CAPTURE_LAYER);
    this.small = new THREE.WebGLCubeRenderTarget(SH_SIZE, { type: THREE.HalfFloatType, generateMipmaps: false, depthBuffer: false, colorSpace: THREE.LinearSRGBColorSpace });
    this.environment = deps.generic;
  }

  /** The texture `scene.environment` should use this frame. */
  get texture(): THREE.Texture | null {
    return this.environment;
  }

  /** The room being captured, if any (debug). */
  get capturing(): string | null {
    return this.job?.room ?? null;
  }

  /** One frame of work: at most one capture face or one filter, plus the hand-over. */
  step(dt: number): void {
    if (this.disposed) return;
    this.frame++;
    const { host } = this.deps;
    const current = host.currentRoom();
    const near = this.scratchNeighbours;
    near.length = 0;
    if (current !== null) for (const n of host.neighbours(current)) if (n !== current) near.push(n);
    this.schedule.touch(current === null ? near : [current, ...near], this.frame);

    if (!this.job) {
      const room = this.schedule.next(current, near, (r) => host.lightingVersion(r));
      if (room !== null) {
        this.job = { room, version: host.lightingVersion(room), face: 0, eye: host.capturePoint(room, new THREE.Vector3()) };
        host.prepareCapture();
      }
    }
    if (this.job) this.advance(this.job, current, near);
    this.updateHandover(dt, current);
  }

  private advance(job: Job, current: string | null, near: readonly string[]): void {
    const { renderer, scene, host, filter } = this.deps;
    if (job.face < 6) {
      this.syncCoordinates(this.cube);
      this.cube.position.copy(job.eye);
      this.cube.updateMatrixWorld(true);
      const cam = this.cube.children[job.face] as THREE.PerspectiveCamera;
      const face = job.face;
      const prev = renderer.getRenderTarget();
      const prevFace = renderer.getActiveCubeFace();
      const prevMip = renderer.getActiveMipmapLevel();
      // The frame's shadow pass belongs to the player's view; captures light their rooms unshadowed.
      const needsShadow = renderer.shadowMap.needsUpdate;
      renderer.shadowMap.needsUpdate = false;
      const borrowed = this.borrowLights(scene);
      try {
        host.captureFromEye(
          job.eye,
          () => {
            renderer.setRenderTarget(this.raw, face);
            renderer.render(scene, cam);
          },
          cam,
        );
      } finally {
        this.returnLights(borrowed);
        renderer.setRenderTarget(prev, prevFace, prevMip);
        renderer.shadowMap.needsUpdate = needsShadow;
      }
      job.face++;
      return;
    }
    // Frame 7: filter into the room's own map (reusing its old one when recapturing).
    const old = this.schedule.get(job.room);
    const pmrem = filter(this.raw.texture as unknown as THREE.CubeTexture, old);
    this.schedule.set(job.room, pmrem, job.version, this.frame);
    this.job = null;
    this.readIrradiance(job.room);
    const keep = new Set<string>([...(current === null ? [] : [current]), ...near, ...this.handover.inUse()]);
    for (const [, target] of this.schedule.evict(keep)) target.dispose();
  }

  private readonly borrowedLights: Array<{ light: THREE.Light; intensity: number; mask: number }> = [];

  /**
   * Lights outside the level (the player's flashlight, the muzzle flash) stay out of a capture's look but must still be
   * counted: three keys every program by its light counts, so a capture that saw fewer lights than the player's view
   * would compile a second variant of every material it draws. They join the capture layer at zero intensity.
   */
  private borrowLights(scene: THREE.Object3D): Array<{ light: THREE.Light; intensity: number; mask: number }> {
    const out = this.borrowedLights;
    out.length = 0;
    scene.traverseVisible((o) => {
      const light = o as THREE.Light;
      if (!light.isLight || light.layers.isEnabled(CAPTURE_LAYER)) return;
      out.push({ light, intensity: light.intensity, mask: light.layers.mask });
      light.layers.enable(CAPTURE_LAYER);
      light.intensity = 0;
    });
    return out;
  }

  private returnLights(borrowed: ReadonlyArray<{ light: THREE.Light; intensity: number; mask: number }>): void {
    for (const b of borrowed) {
      b.light.intensity = b.intensity;
      b.light.layers.mask = b.mask;
    }
  }

  /** Downsample the raw capture to 16 px faces and project them onto spherical harmonics, without stalling (design D5). */
  private readIrradiance(room: string): void {
    const { renderer, onIrradiance } = this.deps;
    if (!onIrradiance || this.pendingSh.has(room)) return;
    this.downMat.uniforms['envMap']!.value = this.raw.texture;
    this.downMat.uniforms['lod']!.value = Math.log2((this.deps.size ?? CAPTURE_SIZE) / SH_SIZE);
    this.renderCube(this.small, 0, this.downMat);
    const faces = Array.from({ length: 6 }, () => new Uint16Array(SH_SIZE * SH_SIZE * 4));
    this.pendingSh.add(room);
    const flip = renderer.coordinateSystem === THREE.WebGLCoordinateSystem ? -1 : 1;
    // Reads run one after another; each starts when this frame's commands are queued, so none stalls the GPU.
    this.readback = this.readback
      .then(async () => {
        for (let f = 0; f < 6; f++) {
          if (this.disposed) return;
          await renderer.readRenderTargetPixelsAsync(this.small, 0, 0, SH_SIZE, SH_SIZE, faces[f]!, f);
        }
        if (this.disposed) return;
        onIrradiance(room, projectCubeSh(faces.map(halfToFloat), SH_SIZE, flip));
      })
      .catch((err: unknown) => console.warn('[roomCaptures] bounce light readback failed', err))
      .finally(() => this.pendingSh.delete(room));
  }

  private updateHandover(dt: number, current: string | null): void {
    const state = this.handover.update(dt, current, (r) => this.schedule.get(r) !== null);
    const texOf = (room: string | null): THREE.Texture | null => (room === null ? this.deps.generic : (this.schedule.get(room)?.texture ?? null));
    if (state.kind === 'static') {
      this.environment = texOf(state.room) ?? this.deps.generic;
      return;
    }
    const a = texOf(state.from);
    const b = texOf(state.to);
    if (!b) {
      this.environment = a;
      return;
    }
    if (!a || state.weight >= 1) {
      this.environment = b;
      return;
    }
    this.environment = this.renderBlend(a, b, state.weight);
  }

  /** Mix two filtered maps into the blend target, mip by mip, face by face (design D3). */
  private renderBlend(a: THREE.Texture, b: THREE.Texture, weight: number): THREE.Texture {
    const size = (b.image as { width?: number } | undefined)?.width ?? 256;
    const levels = b.mipmaps?.length ?? 1;
    if (!this.blendTarget || this.blendTarget.width !== size || this.blendTarget.texture.mipmaps.length !== levels) {
      this.blendTarget?.dispose();
      this.blendTarget = pmremLikeTarget(size, levels);
    }
    const u = this.blendMat.uniforms;
    u['envA']!.value = a;
    u['envB']!.value = b;
    u['weight']!.value = weight;
    for (let lod = 0; lod < levels; lod++) {
      u['lod']!.value = lod;
      this.renderCube(this.blendTarget, lod, this.blendMat);
    }
    return this.blendTarget.texture;
  }

  /** Draw `material` on a box around a cube camera into every face of `target` at mip `lod` (as PMREMGenerator does). */
  private renderCube(target: THREE.WebGLCubeRenderTarget, lod: number, material: THREE.Material): void {
    const { renderer } = this.deps;
    this.syncCoordinates(this.boxCam);
    this.box.material = material;
    const prev = renderer.getRenderTarget();
    const prevFace = renderer.getActiveCubeFace();
    const prevMip = renderer.getActiveMipmapLevel();
    const s = target.width >> lod;
    target.viewport.set(0, 0, s, s);
    try {
      for (let f = 0; f < 6; f++) {
        renderer.setRenderTarget(target, f, lod);
        renderer.render(this.box, this.boxCam.children[f] as THREE.Camera);
      }
    } finally {
      target.viewport.set(0, 0, target.width, target.height);
      renderer.setRenderTarget(prev, prevFace, prevMip);
    }
  }

  private syncCoordinates(cam: THREE.CubeCamera): void {
    const cs = this.deps.renderer.coordinateSystem;
    if (cam.coordinateSystem !== cs) {
      cam.coordinateSystem = cs;
      cam.updateCoordinateSystem();
    }
    if (cam.parent === null) cam.updateMatrixWorld(true);
  }

  /** Drop every capture (a level reset: rooms show their authored lighting again). */
  invalidate(): void {
    this.job = null;
    for (const t of this.schedule.clear()) t.dispose();
    this.handover.reset();
    this.environment = this.deps.generic;
  }

  /** Release every target and material (level teardown, runtime-memory spec). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.deps.onDispose?.();
    this.job = null;
    for (const t of this.schedule.clear()) t.dispose();
    this.blendTarget?.dispose();
    this.blendTarget = null;
    this.raw.dispose();
    this.small.dispose();
    this.blendMat.dispose();
    this.downMat.dispose();
    this.box.geometry.dispose();
    this.environment = this.deps.generic;
  }
}

/** Half floats to floats. */
function halfToFloat(src: Uint16Array): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = THREE.DataUtils.fromHalfFloat(src[i]!);
  return out;
}
