import * as THREE from 'three';
import type { Rng } from '../../core/rng.ts';

/**
 * Floating dust / "marine snow" that always surrounds the camera (ADR-0002).
 * Points wrap around a box centred on the camera, so a fixed count fills any level.
 */
export class Particulates {
  readonly points: THREE.Points;
  private readonly positions: Float32Array<ArrayBuffer>;
  private readonly phase: Float32Array<ArrayBuffer>;
  private readonly half: number;
  private readonly floor: number;
  private readonly ceiling: number;

  constructor(rng: Rng, count = 1400, half = 6, floor = 0, ceiling = 3.2) {
    this.half = half;
    this.floor = floor;
    this.ceiling = ceiling;
    this.positions = new Float32Array(count * 3);
    this.phase = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.positions[i * 3] = rng.range(-half, half);
      this.positions[i * 3 + 1] = rng.range(floor, ceiling);
      this.positions[i * 3 + 2] = rng.range(-half, half);
      this.phase[i] = rng.range(0, Math.PI * 2);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    const material = new THREE.PointsMaterial({
      color: 0x9fc3cc,
      size: 0.014,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geom, material);
    this.points.frustumCulled = false;
  }

  update(camera: THREE.Vector3, t: number, dt: number): void {
    const p = this.positions;
    const span = this.half * 2;
    const height = this.ceiling - this.floor;
    for (let i = 0; i < this.phase.length; i++) {
      const ph = this.phase[i]!;
      const j = i * 3;
      let x = p[j]! + Math.sin(t * 0.21 + ph) * 0.03 * dt;
      let y = p[j + 1]! - (0.012 + 0.01 * Math.sin(ph)) * dt;
      let z = p[j + 2]! + Math.cos(t * 0.17 + ph * 1.3) * 0.03 * dt;
      // Wrap into the box around the camera.
      x = camera.x - this.half + (((x - camera.x + this.half) % span) + span) % span;
      z = camera.z - this.half + (((z - camera.z + this.half) % span) + span) % span;
      if (y < this.floor) y += height;
      p[j] = x;
      p[j + 1] = y;
      p[j + 2] = z;
    }
    const attr = this.points.geometry.getAttribute('position');
    attr.needsUpdate = true;
  }
}
