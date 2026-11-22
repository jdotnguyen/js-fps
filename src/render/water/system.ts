import * as THREE from 'three';
import type { Quality } from '../tiers.ts';
import type { Level } from '../../world/level.ts';
import { updateMurk } from './murk.ts';
import { RippleSim } from './ripples.ts';
import type { WaterSurface } from './surface.ts';

/**
 * Per-frame GPU work for a level's standing water (standing-water spec): each body's ripple simulation (D6) and the
 * planar reflection (D4), both done before the frame renders and only while the water's room is drawn.
 */

/** Reflection target size as a fraction of the drawing buffer, per quality tier (D4). 0: no mirror pass (Low). */
export const WATER_REFLECTION_SCALE: Readonly<Record<Quality, number>> = Object.freeze({ low: 0, medium: 0.25, high: 0.5 });

/** Pulls the oblique clip plane just under the surface so the waterline does not shimmer. */
const CLIP_BIAS = 0.003;

/**
 * Mirror camera for a horizontal plane at height `h` (three's Reflector, for a plane facing +Y), and the matrix that
 * projects a world point into the mirror texture. Returns false when the camera is at or below the plane.
 */
export function mirrorCamera(camera: THREE.PerspectiveCamera, h: number, out: THREE.PerspectiveCamera, textureMatrix: THREE.Matrix4): boolean {
  const normal = new THREE.Vector3(0, 1, 0);
  const camPos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  // Any point of the (infinite, horizontal) plane: the one under the camera.
  const planePoint = new THREE.Vector3(camPos.x, h, camPos.z);
  if (camPos.y <= h + 1e-3) return false;
  const rotation = new THREE.Matrix4().extractRotation(camera.matrixWorld);
  const view = new THREE.Vector3().subVectors(planePoint, camPos).reflect(normal).negate().add(planePoint);
  const lookAt = new THREE.Vector3(0, 0, -1).applyMatrix4(rotation).add(camPos);
  const target = new THREE.Vector3().subVectors(planePoint, lookAt).reflect(normal).negate().add(planePoint);
  out.position.copy(view);
  out.up.set(0, 1, 0).applyMatrix4(rotation).reflect(normal);
  out.lookAt(target);
  out.far = camera.far;
  out.near = camera.near;
  out.updateMatrixWorld();
  out.projectionMatrix.copy(camera.projectionMatrix);
  textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(out.projectionMatrix).multiply(out.matrixWorldInverse);
  // Oblique near plane at the water (Lengyel): nothing below the surface is drawn into the reflection.
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, planePoint).applyMatrix4(out.matrixWorldInverse);
  const clip = new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
  const p = out.projectionMatrix.elements;
  const q = new THREE.Vector4((Math.sign(clip.x) + p[8]!) / p[0]!, (Math.sign(clip.y) + p[9]!) / p[5]!, -1, (1 + p[10]!) / p[14]!);
  clip.multiplyScalar(2 / clip.dot(q));
  p[2] = clip.x;
  p[6] = clip.y;
  p[10] = clip.z + 1 - CLIP_BIAS;
  p[14] = clip.w;
  out.projectionMatrixInverse.copy(out.projectionMatrix).invert();
  return true;
}

export class WaterSystem {
  private readonly sims: Array<{ room: string; sim: RippleSim }> = [];
  private readonly level: Level;
  private readonly surfaces: WaterSurface[];
  private readonly mirror = new THREE.PerspectiveCamera();
  private readonly textureMatrix = new THREE.Matrix4();
  private target: THREE.WebGLRenderTarget | null = null;
  private scale = WATER_REFLECTION_SCALE.high;
  /** Objects hidden from the mirror (the first-person gun and hands); their lights stay on. */
  hideFromReflection: () => THREE.Object3D[] = () => [];

  constructor(level: Level) {
    this.level = level;
    this.surfaces = [...level.waterSurfaces.values()];
    for (const [room, surface] of level.waterSurfaces) {
      this.sims.push({ room, sim: new RippleSim(surface.body, surface.uniforms, (x, z, y) => level.solidThroughSurface(x, z, y)) });
    }
    this.mirror.layers.enableAll();
  }

  get empty(): boolean {
    return this.sims.length === 0;
  }

  setQuality(q: Quality): void {
    this.scale = WATER_REFLECTION_SCALE[q];
    if (this.scale === 0) {
      this.target?.dispose();
      this.target = null;
      for (const s of this.surfaces) s.uniforms.uReflOn.value = 0;
    }
  }

  update(renderer: THREE.WebGLRenderer, dt: number, scene?: THREE.Scene, camera?: THREE.PerspectiveCamera): void {
    for (const { room, sim } of this.sims) sim.update(renderer, dt, this.level.roomVisible(room));
    updateMurk(this.surfaces.filter((s) => this.level.roomVisible(s.body.room)).map((s) => s.body));
    if (scene && camera) this.reflect(renderer, scene, camera);
  }

  /** Pre-allocate reflection target and compile ripple simulation shaders during session loading. */
  warm(renderer: THREE.WebGLRenderer): void {
    for (const { sim } of this.sims) sim.update(renderer, 1 / 60, true);
    if (this.scale > 0 && this.surfaces.length > 0) {
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      const w = Math.max(64, Math.round(size.x * this.scale));
      const hh = Math.max(64, Math.round(size.y * this.scale));
      if (!this.target) this.target = new THREE.WebGLRenderTarget(w, hh, { type: THREE.HalfFloatType, samples: 0 });
      else if (this.target.width !== w || this.target.height !== hh) this.target.setSize(w, hh);
      const prevTarget = renderer.getRenderTarget();
      renderer.setRenderTarget(this.target);
      renderer.clear();
      renderer.setRenderTarget(prevTarget);
    }
  }

  /** One mirror render for the visible water nearest the camera's height (all of a level's water shares a level). */
  private reflect(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    const visible = this.surfaces.filter((s) => this.level.roomVisible(s.body.room));
    for (const s of this.surfaces) if (!visible.includes(s)) s.uniforms.uReflOn.value = 0;
    if (this.scale === 0 || visible.length === 0) return;
    const h = visible[0]!.body.level;
    if (!mirrorCamera(camera, h, this.mirror, this.textureMatrix)) {
      for (const s of visible) s.uniforms.uReflOn.value = 0;
      return;
    }
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(64, Math.round(size.x * this.scale));
    const hh = Math.max(64, Math.round(size.y * this.scale));
    if (!this.target) this.target = new THREE.WebGLRenderTarget(w, hh, { type: THREE.HalfFloatType, samples: 0 });
    else if (this.target.width !== w || this.target.height !== hh) this.target.setSize(w, hh);

    const hidden: THREE.Object3D[] = [];
    for (const s of this.surfaces) if (s.mesh.visible) (s.mesh.visible = false), hidden.push(s.mesh);
    for (const o of this.hideFromReflection()) if (o.visible) (o.visible = false), hidden.push(o);
    const prevTarget = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.autoUpdate;
    const prevNeeds = renderer.shadowMap.needsUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = false;
    renderer.setRenderTarget(this.target);
    renderer.state.buffers.depth.setMask(true);
    renderer.clear();
    renderer.render(scene, this.mirror);
    renderer.setRenderTarget(prevTarget);
    renderer.shadowMap.autoUpdate = prevShadow;
    renderer.shadowMap.needsUpdate = prevNeeds;
    for (const o of hidden) o.visible = true;
    for (const s of visible) {
      s.uniforms.uRefl.value = this.target.texture;
      s.uniforms.uReflMatrix.value.copy(this.textureMatrix);
      s.uniforms.uReflOn.value = Math.abs(s.body.level - h) < 0.05 ? 1 : 0;
    }
  }

  dispose(): void {
    for (const { sim } of this.sims) sim.dispose();
    this.sims.length = 0;
    this.target?.dispose();
    this.target = null;
  }
}
