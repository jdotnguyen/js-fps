import * as THREE from 'three';
import { NOISE_GLSL } from './glsl.ts';

/**
 * The ocean outside the station windows: depth gradient, light rays from far above,
 * caustic shimmer, falling marine snow, and every ~50 s something very large drifting
 * past in the distance.
 */
/** Seconds between passes of the large silhouette (audio syncs a moan to it). */
export const ABYSS_CYCLE = 52;

export function createAbyss(width: number, height: number): { mesh: THREE.Mesh; uniforms: { uTime: { value: number } } } {
  const uniforms = {
    uTime: { value: 0 },
    uSize: { value: new THREE.Vector2(width, height) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec2 uSize;
      varying vec2 vUv;
      ${NOISE_GLSL}
      void main() {
        vec2 p = vUv * uSize;
        float up = vUv.y;
        vec3 col = mix(vec3(0.0, 0.004, 0.009), vec3(0.003, 0.04, 0.055), smoothstep(0.05, 1.0, up));

        float rays = vnoise(vec2(p.x * 0.3 + uTime * 0.04, 0.5));
        rays = pow(rays, 3.0) * smoothstep(0.25, 1.0, up);
        col += vec3(0.006, 0.05, 0.06) * rays;

        float c = vnoise(p * 1.3 + vec2(uTime * 0.2, uTime * 0.13)) * vnoise(p * 2.1 - vec2(uTime * 0.17, 0.0));
        col += vec3(0.0, 0.025, 0.03) * c * c * smoothstep(0.5, 1.0, up);

        // Marine snow.
        vec2 sp = p * 5.0 + vec2(sin(uTime * 0.1) * 0.5, uTime * 0.35);
        vec2 cell = floor(sp);
        vec2 f = fract(sp) - 0.5;
        float h = hash12(cell);
        vec2 jitter = vec2(hash12(cell + 3.1), hash12(cell + 7.7)) - 0.5;
        float d = length(f - jitter * 0.6);
        col += vec3(0.05, 0.08, 0.08) * step(0.92, h) * smoothstep(0.07, 0.0, d);

        // Something large, far away. Only a silhouette against the faint light above.
        float cycle = fract(uTime / ${ABYSS_CYCLE.toFixed(1)});
        vec2 centre = vec2(mix(-0.3, 1.3, cycle) * uSize.x, uSize.y * 0.72 + sin(uTime * 0.07) * 0.6);
        vec2 q = (p - centre) / vec2(uSize.x * 0.22, uSize.y * 0.08);
        float tail = smoothstep(1.0, 0.0, length((p - centre - vec2(-uSize.x * 0.2, 0.3)) / vec2(uSize.x * 0.12, uSize.y * 0.03)));
        float body = max(smoothstep(1.0, 0.55, length(q)), tail * 0.8);
        col *= 1.0 - 0.8 * body;

        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  return { mesh: new THREE.Mesh(new THREE.PlaneGeometry(width, height), material), uniforms };
}
