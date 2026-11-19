import * as THREE from 'three';
import type { Settings } from '../core/settings.ts';

/** Pixel-ratio caps per quality tier (ADR-0002). */
export const PIXEL_RATIO_CAP: Record<Settings['quality'], number> = {
  low: 1,
  medium: 1.25,
  high: 1.5,
};

/**
 * Baseline renderer. ADR-0002 adds the post-processing chain, light pool and atmosphere.
 */
export function createRenderer(canvas: HTMLCanvasElement, settings: Readonly<Settings>): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  applyQuality(renderer, settings.quality);
  renderer.setSize(window.innerWidth, window.innerHeight);
  return renderer;
}

export function applyQuality(renderer: THREE.WebGLRenderer, quality: Settings['quality']): void {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, PIXEL_RATIO_CAP[quality]));
}
