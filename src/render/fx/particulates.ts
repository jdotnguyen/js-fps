import * as THREE from 'three';
import type { Rng } from '../../core/rng.ts';

/**
 * Floating dust / "marine snow" that always surrounds the camera (ADR-0002).
 * Points wrap around a box centred on the camera in the vertex shader, so a fixed count
 * fills any level with zero per-frame CPU particle updates or buffer uploads.
 */
export class Particulates {
  readonly points: THREE.Points;
  private readonly uTime: { value: number };
  private readonly uCamera: { value: THREE.Vector3 };
  private readonly uScale: { value: number };

  constructor(rng: Rng, count = 1400, half = 6, floor = 0, ceiling = 3.2) {
    const positions = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = rng.range(-half, half);
      positions[i * 3 + 1] = rng.range(floor, ceiling);
      positions[i * 3 + 2] = rng.range(-half, half);
      phase[i] = rng.range(0, Math.PI * 2);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    this.uTime = { value: 0 };
    this.uCamera = { value: new THREE.Vector3() };
    this.uScale = { value: typeof window !== 'undefined' ? window.innerHeight * 0.5 : 540 };
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.uTime,
        uCamera: this.uCamera,
        uScale: this.uScale,
        uHalf: { value: half },
        uFloor: { value: floor },
        uHeight: { value: ceiling - floor },
        uSize: { value: 0.014 },
        uColor: { value: new THREE.Color(0x9fc3cc) },
        uOpacity: { value: 0.55 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float aPhase;
        uniform float uTime;
        uniform vec3 uCamera;
        uniform float uScale;
        uniform float uHalf;
        uniform float uFloor;
        uniform float uHeight;
        uniform float uSize;
        void main() {
          float span = uHalf * 2.0;
          float x = position.x + sin(uTime * 0.21 + aPhase) * 0.14;
          float z = position.z + cos(uTime * 0.17 + aPhase * 1.3) * 0.17;
          float y = position.y - (0.012 + 0.01 * sin(aPhase)) * uTime;
          x = uCamera.x - uHalf + mod(x - uCamera.x + uHalf, span);
          z = uCamera.z - uHalf + mod(z - uCamera.z + uHalf, span);
          y = uFloor + mod(y - uFloor, uHeight);
          vec4 mvPosition = modelViewMatrix * vec4(x, y, z, 1.0);
          gl_PointSize = max(1.0, uSize * (uScale / max(0.001, -mvPosition.z)));
          gl_Position = projectionMatrix * mvPosition;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          gl_FragColor = vec4(uColor, uOpacity * smoothstep(0.5, 0.2, d));
        }`,
    });
    this.points = new THREE.Points(geom, material);
    this.points.frustumCulled = false;
  }

  update(camera: THREE.Vector3, t: number, _dt: number): void {
    this.uTime.value = t;
    this.uCamera.value.copy(camera);
    if (typeof window !== 'undefined') this.uScale.value = window.innerHeight * 0.5;
  }
}
