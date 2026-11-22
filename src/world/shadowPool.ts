import * as THREE from 'three';
import type { LightSlotKind } from './kit/types.ts';
import { slotScore, type PooledSlot } from './lightPool.ts';
import { pauseShadow } from '../render/shadowMapKeep.ts';

/**
 * Downward cone per fixture kind: half-angle (degrees), penumbra, shadow biases and the soft-PCF
 * filter radius in shadow-map texels (`PCFShadowMap` since r183; render-lighting: soft edges).
 */
export const SHADOW_CONES: Record<LightSlotKind, { angle: number; penumbra: number; bias: number; normalBias: number; radius: number }> = {
  ceiling: { angle: 75, penumbra: 0.55, bias: -0.0005, normalBias: 0.03, radius: 2 },
  pendant: { angle: 60, penumbra: 0.6, bias: -0.0003, normalBias: 0.02, radius: 2 },
  wall: { angle: 70, penumbra: 0.6, bias: -0.0004, normalBias: 0.025, radius: 2 },
  emergency: { angle: 70, penumbra: 0.5, bias: -0.0004, normalBias: 0.025, radius: 2 },
};

/**
 * Fixed pool of shadow-casting room spot lights (render-lighting spec). Each frame, after culling,
 * the visible slots that opt in with `shadow: true` take the spots, current room first, nearest
 * first; the rest fall back to the fill pool. Spots always keep `castShadow` (toggling it
 * recompiles every material); an unbound spot sits at intensity 0 with its shadow pass skipped.
 */
export class ShadowPool {
  readonly lights: THREE.SpotLight[] = [];
  private readonly parent: THREE.Object3D;
  private mapSize: number;
  private readonly bound = new Map<THREE.SpotLight, PooledSlot>();
  private readonly boundSlots = new Set<PooledSlot>();
  private readonly candidates: PooledSlot[] = [];

  constructor(parent: THREE.Object3D, size = 0, mapSize = 1024) {
    this.parent = parent;
    this.mapSize = mapSize;
    this.resize(size, mapSize);
  }

  get size(): number {
    return this.lights.length;
  }

  /** Grow or shrink to `n` spots and set their shadow-map size (a quality-tier switch). */
  resize(n: number, mapSize = this.mapSize): void {
    const size = Math.max(0, Math.floor(n));
    while (this.lights.length > size) {
      const l = this.lights.pop()!;
      const slot = this.bound.get(l);
      if (slot) {
        slot.item.light = null;
        this.boundSlots.delete(slot);
      }
      this.bound.delete(l);
      this.parent.remove(l, l.target);
      l.shadow.map?.dispose();
      l.shadow.map = null;
      l.dispose();
    }
    while (this.lights.length < size) {
      const l = new THREE.SpotLight(0xffffff, 0, 10, THREE.MathUtils.degToRad(70), 0.5, 2);
      l.name = `shadow-light-${this.lights.length}`;
      l.castShadow = true;
      l.shadow.camera.near = 0.1;
      l.shadow.autoUpdate = false;
      l.target.name = `${l.name}:target`;
      this.parent.add(l, l.target);
      this.lights.push(l);
    }
    if (mapSize !== this.mapSize) {
      this.mapSize = mapSize;
      for (const l of this.lights) {
        l.shadow.map?.dispose();
        l.shadow.map = null;
      }
    }
    for (const l of this.lights) l.shadow.mapSize.set(this.mapSize, this.mapSize);
  }

  /**
   * Bind the opted-in slots nearest the camera (current room first) to the spots. Opted-in slots
   * that miss lose any light; the caller offers them to the fill pool. Call before LightController.update.
   */
  assign(slots: readonly PooledSlot[], camera: THREE.Vector3): void {
    const c = this.candidates;
    c.length = 0;
    for (const s of slots) {
      if (s.shadow !== true || s.pooled === false) continue;
      s.score = slotScore(s, camera);
      s.item.light = null;
      c.push(s);
    }
    c.sort((a, b) => a.score - b.score);
    this.bound.clear();
    this.boundSlots.clear();
    for (let i = 0; i < this.lights.length; i++) {
      const light = this.lights[i]!;
      const slot = c[i];
      if (!slot) {
        pauseShadow(light.shadow);
        continue;
      }
      const cone = SHADOW_CONES[slot.kind ?? 'ceiling'];
      light.position.copy(slot.position);
      light.target.position.copy(slot.position).setY(slot.position.y - 4);
      light.target.updateMatrixWorld();
      light.color.copy(slot.color);
      light.distance = slot.range;
      light.angle = THREE.MathUtils.degToRad(cone.angle);
      light.penumbra = cone.penumbra;
      light.shadow.bias = cone.bias;
      light.shadow.normalBias = cone.normalBias;
      light.shadow.radius = cone.radius;
      light.shadow.camera.far = slot.range;
      light.shadow.autoUpdate = true;
      slot.item.light = light;
      this.bound.set(light, slot);
      this.boundSlots.add(slot);
    }
  }

  /** True while `slot` holds a shadow spot this frame. */
  holds(slot: PooledSlot): boolean {
    return this.boundSlots.has(slot);
  }

  /** Darken spots that have no slot this frame. Call after LightController.update. */
  finish(): void {
    for (const l of this.lights) if (!this.bound.has(l)) l.intensity = 0;
  }

  boundCount(): number {
    return this.bound.size;
  }
}
