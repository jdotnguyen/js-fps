import * as THREE from 'three';
import type { Settings } from '../core/settings.ts';
import { RENDER_TIERS } from './tiers.ts';

/**
 * Baseline renderer. The post chain, light pools and atmosphere are added by their own modules;
 * every per-tier budget comes from RENDER_TIERS (render-quality spec).
 */
export function createRenderer(canvas: HTMLCanvasElement, settings: Readonly<Settings>): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  applyQuality(renderer, settings.quality);
  renderer.setSize(window.innerWidth, window.innerHeight);
  return renderer;
}

/** The pixel ratio a tier renders at on a display with `devicePixelRatio`. */
export function tierPixelRatio(quality: Settings['quality'], devicePixelRatio: number): number {
  return Math.min(devicePixelRatio, RENDER_TIERS[quality].pixelRatioCap);
}

export function applyQuality(renderer: Pick<THREE.WebGLRenderer, 'setPixelRatio'>, quality: Settings['quality'], devicePixelRatio = window.devicePixelRatio): void {
  renderer.setPixelRatio(tierPixelRatio(quality, devicePixelRatio));
}
