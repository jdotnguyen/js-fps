import type * as THREE from 'three';
import { hash2 } from './tex/noise.ts';

/** Light behaviours from ADR-0002. */
export const LIGHT_PATTERNS = ['steady', 'flicker', 'dying', 'strobe', 'alarm', 'off'] as const;
export type LightPattern = (typeof LIGHT_PATTERNS)[number];

/**
 * Brightness multiplier in [0, 1] for a pattern at time t (seconds).
 * reducedFlashing keeps changes to <= 3 per second with low contrast (ADR-0012).
 */
export function patternValue(pattern: LightPattern, t: number, seed: number, reducedFlashing: boolean): number {
  switch (pattern) {
    case 'steady':
      return 1;
    case 'off':
      return 0;
    case 'flicker': {
      const rate = reducedFlashing ? 3 : 14;
      const r = hash2(Math.floor(t * rate), 0, seed);
      if (reducedFlashing) return r < 0.15 ? 0.7 : 1;
      // Mostly on, with bursts of dropouts.
      const burst = hash2(Math.floor(t * 0.5), 1, seed) < 0.35;
      return burst && r < 0.45 ? 0.08 + r * 0.3 : 0.94 + r * 0.06;
    }
    case 'dying': {
      const rate = reducedFlashing ? 3 : 9;
      const r = hash2(Math.floor(t * rate), 2, seed);
      if (reducedFlashing) return 0.35 + 0.15 * r;
      return r > 0.86 ? 0.9 + r * 0.1 : 0.12 + r * 0.12;
    }
    case 'strobe': {
      if (reducedFlashing) return 0.6 + 0.4 * Math.sin(t * Math.PI);
      return (t * 2) % 1 < 0.18 ? 1 : 0.05;
    }
    case 'alarm':
      return 0.55 + 0.45 * Math.sin(t * Math.PI * 2 * (reducedFlashing ? 0.4 : 0.8));
  }
}

export interface ShaftUniforms {
  uIntensity: { value: number };
}

/** One logical light: a three.js light plus anything that should flicker with it. */
export interface ControlledLight {
  name: string;
  light: THREE.Light | null;
  base: number;
  pattern: LightPattern;
  seed: number;
  emissives: THREE.MeshStandardMaterial[];
  emissiveBase: number;
  shafts: ShaftUniforms[];
  shaftBase: number;
  /** Current pattern value in [0, 1] times `power`, updated every frame (audio follows it). */
  level: number;
  /** Station power scale (render-lighting spec "Backup lights"): 1 on main power, dim for a backup light, 0 when out. */
  power: number;
}

/**
 * Drives pooled lights by pattern. Lights are never added/removed or hidden at runtime
 * (that recompiles every material); only intensities change.
 */
export class LightController {
  readonly items: ControlledLight[] = [];

  add(item: Omit<ControlledLight, 'level' | 'power'>): ControlledLight {
    const full: ControlledLight = { ...item, level: 1, power: 1 };
    this.items.push(full);
    return full;
  }

  update(t: number, reducedFlashing: boolean): void {
    for (const it of this.items) {
      const v = patternValue(it.pattern, t, it.seed, reducedFlashing) * it.power;
      it.level = v;
      if (it.light) it.light.intensity = it.base * v;
      for (const m of it.emissives) m.emissiveIntensity = it.emissiveBase * v;
      for (const s of it.shafts) s.uIntensity.value = it.shaftBase * v;
    }
  }
}
