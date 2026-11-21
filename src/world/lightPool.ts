import * as THREE from 'three';
import type { ControlledLight } from '../render/lights.ts';
import type { LightSlotKind } from './kit/types.ts';

/** A claimed light slot that can borrow one of the pooled lights. */
export interface PooledSlot {
  item: ControlledLight;
  position: THREE.Vector3;
  color: THREE.Color;
  range: number;
  /** Larger = keep it lit before nearer slots (current room first). */
  priority: number;
  /** false: glow-only (render-lighting spec). The slot keeps its fixture glow but is never offered to the pool. */
  pooled?: boolean;
  /** true: the level data opted this light in to shadows; it takes a shadow spot when one is free (render-lighting spec). */
  shadow?: boolean;
  /** Fixture kind, for the shadow spot's cone and bias. */
  kind?: LightSlotKind;
  /** Scratch: score used while sorting. */
  score: number;
}

/** Sort key shared by both pools: nearest first, the current room scored 20 m closer. */
export function slotScore(slot: PooledSlot, camera: THREE.Vector3): number {
  return slot.position.distanceToSquared(camera) - slot.priority * 400;
}

/**
 * Fixed pool of fill point lights, no shadows (render-lighting spec). Its size is set by the
 * quality tier and changes only on a tier switch (`resize`), so materials recompile only then;
 * during play lights are moved and recoloured onto the slots nearest the camera in the visible rooms.
 */
export class LightPool {
  readonly lights: THREE.PointLight[] = [];
  private readonly parent: THREE.Object3D;
  private readonly bound = new Map<THREE.PointLight, PooledSlot>();
  private readonly candidates: PooledSlot[] = [];

  constructor(parent: THREE.Object3D, size = 8) {
    this.parent = parent;
    this.resize(size);
  }

  get size(): number {
    return this.lights.length;
  }

  /** Grow or shrink to `n` lights (a quality-tier switch). Materials recompile once afterwards. */
  resize(n: number): void {
    const size = Math.max(0, Math.floor(n));
    while (this.lights.length > size) {
      const l = this.lights.pop()!;
      const slot = this.bound.get(l);
      if (slot) slot.item.light = null;
      this.bound.delete(l);
      this.parent.remove(l);
      l.dispose();
    }
    while (this.lights.length < size) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      l.name = `pool-light-${this.lights.length}`;
      l.castShadow = false;
      this.parent.add(l);
      this.lights.push(l);
    }
  }

  /** Bind the best slots to pool lights. Call before LightController.update. */
  assign(slots: readonly PooledSlot[], camera: THREE.Vector3): void {
    const c = this.candidates;
    c.length = 0;
    for (const s of slots) {
      s.score = slotScore(s, camera);
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
