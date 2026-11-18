import * as THREE from 'three';
import type { ControlledLight } from '../render/lights.ts';

/** A claimed light slot that can borrow one of the pooled lights. */
export interface PooledSlot {
  item: ControlledLight;
  position: THREE.Vector3;
  color: THREE.Color;
  range: number;
  /** Larger = keep it lit before nearer slots (current room first). */
  priority: number;
  /** Scratch: score used while sorting. */
  score: number;
}

/**
 * Fixed pool of fill lights (ADR-0002: 8 point lights, no shadows). The scene's light
 * count never changes, so materials never recompile; lights are moved and recoloured
 * onto the slots nearest the camera in the rooms that are currently visible.
 */
export class LightPool {
  readonly lights: THREE.PointLight[] = [];
  private readonly bound = new Map<THREE.PointLight, PooledSlot>();
  private readonly candidates: PooledSlot[] = [];

  constructor(parent: THREE.Object3D, size = 8) {
    for (let i = 0; i < size; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      l.name = `pool-light-${i}`;
      l.castShadow = false;
      parent.add(l);
      this.lights.push(l);
    }
  }

  get size(): number {
    return this.lights.length;
  }

  /** Bind the best slots to pool lights. Call before LightController.update. */
  assign(slots: readonly PooledSlot[], camera: THREE.Vector3): void {
    const c = this.candidates;
    c.length = 0;
    for (const s of slots) {
      s.score = s.position.distanceToSquared(camera) - s.priority * 400;
      s.item.light = null;
      c.push(s);
    }
    c.sort((a, b) => a.score - b.score);
    this.bound.clear();
    for (let i = 0; i < this.lights.length; i++) {
      const light = this.lights[i]!;
      const slot = c[i];
      if (!slot) continue;
      light.position.copy(slot.position);
      light.color.copy(slot.color);
      light.distance = slot.range;
      slot.item.light = light;
      this.bound.set(light, slot);
    }
  }

  /** Darken pool lights that have no slot this frame. Call after LightController.update. */
  finish(): void {
    for (const l of this.lights) if (!this.bound.has(l)) l.intensity = 0;
  }

  boundCount(): number {
    return this.bound.size;
  }
}
