// n8ao 2.1.0 ships no type definitions. This declares the part of its postprocessing pass that we use.
declare module 'n8ao' {
  import type { Pass } from 'postprocessing';
  import type { Camera, Color, Scene } from 'three';

  export interface N8AOConfiguration {
    aoSamples: number;
    aoRadius: number;
    aoTones: number;
    denoiseSamples: number;
    denoiseRadius: number;
    distanceFalloff: number;
    intensity: number;
    denoiseIterations: number;
    renderMode: number;
    biasOffset: number;
    biasMultiplier: number;
    color: Color;
    gammaCorrection: boolean;
    screenSpaceRadius: boolean;
    halfRes: boolean;
    depthAwareUpsampling: boolean;
    colorMultiply: boolean;
    transparencyAware: boolean;
    accumulate: boolean;
  }

  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: N8AOConfiguration;
    /** Scans the scene for transparent materials every frame and turns on extra transparency renders. */
    autoDetectTransparency: boolean;
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
  }
}
