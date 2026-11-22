import type * as THREE from 'three';
import { hash2 } from './tex/noise.ts';

/** Light behaviours from ADR-0002. */
export const LIGHT_PATTERNS = ['steady', 'flicker', 'dying', 'strobe', 'alarm', 'off', 'failing'] as const;
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
    case 'failing':
      // Slow by design: never more than 3 changes a second, so reduced flashing leaves it as it is (render-lighting spec).
      return failingValue(t, seed);
    case 'alarm':
      return 0.55 + 0.45 * Math.sin(t * Math.PI * 2 * (reducedFlashing ? 0.4 : 0.8));
  }
}

/** Failing-tube pattern (render-lighting spec): each window plans a hold, a stutter and, every other window, a dark spell. */
export const FAILING_WINDOW = 14;
/** Shortest time a failing tube stays in one state (s): at most 3 changes a second. */
export const FAILING_MIN_STATE = 0.34;

/** Brightness of a failing tube at time t: lit, stuttering, or dark for 1-4 s before stuttering back. */
export function failingValue(t: number, seed: number): number {
  const w = Math.floor(t / FAILING_WINDOW);
  let u = t - w * FAILING_WINDOW;
  const h = (k: number): number => hash2(w, 40 + k, seed);
  const ON = 0.95 + 0.05 * h(9);
  const DIM = 0.08;
  const OFF = 0;
  // Hold lit for 3-5 s.
  const hold = 3 + 2 * h(0);
  if (u < hold) return ON;
  u -= hold;
  // Stutter: 2-3 off/on blinks, each state at least FAILING_MIN_STATE long. The longest plan (13.4 s) fits the window.
  const blinks = 2 + Math.floor(h(1) * 2);
  for (let i = 0; i < blinks; i++) {
    const off = FAILING_MIN_STATE + 0.18 * h(10 + i);
    if (u < off) return DIM;
    u -= off;
    const on = FAILING_MIN_STATE + 0.3 * h(20 + i);
    if (u < on) return ON;
    u -= on;
  }
  // Every other window (by seed) the tube then dies for 1-4 s and stutters back once.
  const darkWindow = (w + seed) % 2 === 0;
  if (darkWindow) {
    const dark = 1 + 3 * h(3);
    if (u < dark) return OFF;
    u -= dark;
    const back = FAILING_MIN_STATE + 0.2 * h(4);
    if (u < back) return ON;
    u -= back;
    if (u < FAILING_MIN_STATE) return DIM;
  }
  return ON;
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
