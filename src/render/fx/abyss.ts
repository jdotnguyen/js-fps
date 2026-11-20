import * as THREE from 'three';
import { NOISE_GLSL } from './glsl.ts';

/**
 * The ocean outside the station windows: depth gradient, light rays from far above,
 * caustic shimmer, falling marine snow, and every ~50 s something very large drifting
 * past in the distance.
 */
/** Seconds between passes of the large silhouette (audio syncs a moan to it). */
export const ABYSS_CYCLE = 52;

export function createAbyss(width: number, height: number): {
  mesh: THREE.Mesh;
  uniforms: { uTime: { value: number }; uPortal: { value: THREE.Vector4 } };
} {
  const uniforms = {
    uTime: { value: 0 },
    uSize: { value: new THREE.Vector2(width, height) },
    /** Optional window portal clip: (depth, centerYOffset, halfW, halfH). Disabled when halfW <= 0. */
    uPortal: { value: new THREE.Vector4(0, 0, 0, 0) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      uniform vec4 uPortal;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vWinCenter;
      varying vec3 vWinRight;
      varying vec3 vWinUp;
      varying vec3 vWinNormal;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        if (uPortal.z > 0.0) {
          vWinRight = normalize((modelMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
          vWinUp = normalize((modelMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          vWinNormal = normalize((modelMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
          vec3 origin = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          vWinCenter = origin + vWinNormal * uPortal.x + vWinUp * uPortal.y;
        }
        gl_Position = projectionMatrix * viewMatrix * world;
        // Keep the portal projection, but put the water background behind all station geometry.
        if (uPortal.z > 0.0) gl_Position.z = gl_Position.w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec2 uSize;
      uniform vec4 uPortal;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vWinCenter;
      varying vec3 vWinRight;
      varying vec3 vWinUp;
      varying vec3 vWinNormal;
      ${NOISE_GLSL}
      void main() {
        if (uPortal.z > 0.0) {
          float camDist = dot(cameraPosition - vWinCenter, vWinNormal);
          if (camDist <= 0.01) discard;
          vec3 ray = vWorld - cameraPosition;
          float denom = dot(ray, vWinNormal);
          if (denom >= -0.0001) discard;
          vec3 hit = cameraPosition + ray * (-camDist / denom) - vWinCenter;
          if (abs(dot(hit, vWinRight)) > uPortal.z || abs(dot(hit, vWinUp)) > uPortal.w) discard;
        }
        vec2 p = vUv * uSize;
        float up = vUv.y;
        vec3 col = mix(vec3(0.001, 0.008, 0.016), vec3(0.008, 0.068, 0.092), smoothstep(0.05, 1.0, up));

        // Layered volumetric god-rays swaying gently from far above.
        float sway = sin(uTime * 0.25) * 0.35;
        float raysA = vnoise(vec2(p.x * 0.28 + sway + uTime * 0.05, 0.5 + up * 0.25));
        float raysB = vnoise(vec2(p.x * 0.52 - uTime * 0.04, 1.7 + up * 0.35));
        float rays = (pow(raysA, 2.6) * 0.7 + pow(raysB, 3.0) * 0.5) * smoothstep(0.18, 1.0, up);
        col += vec3(0.012, 0.085, 0.105) * rays;

        // Dual-layer drifting caustic shimmer in the upper water column.
        float c1 = vnoise(p * 1.15 + vec2(uTime * 0.28, uTime * 0.17)) * vnoise(p * 2.0 - vec2(uTime * 0.22, -uTime * 0.09));
        float c2 = vnoise(p * 1.8 - vec2(uTime * 0.19, -uTime * 0.14)) * vnoise(p * 2.9 + vec2(uTime * 0.15, uTime * 0.11));
        col += vec3(0.008, 0.052, 0.064) * (c1 * c1 + c2 * c2 * 0.7) * smoothstep(0.32, 1.0, up);

        // Two-layer parallax marine snow + occasional glowing bioluminescent motes.
        vec2 sp = p * 4.5 + vec2(sin(uTime * 0.16) * 0.7 + uTime * 0.12, uTime * 0.38);
        vec2 cell = floor(sp);
        vec2 f = fract(sp) - 0.5;
        float h = hash12(cell);
        vec2 jitter = vec2(hash12(cell + 3.1), hash12(cell + 7.7)) - 0.5;
        float d = length(f - jitter * 0.6);
        float pulse = 0.6 + 0.4 * sin(uTime * 1.8 + h * 40.0);
        col += mix(vec3(0.06, 0.11, 0.12), vec3(0.08, 0.28, 0.30), step(0.96, h)) * step(0.89, h) * smoothstep(0.09, 0.0, d) * pulse;

        // Distant gliding manta / pelagic school silhouettes crossing mid-water (~19 s cycle).
        float mCycle = fract(uTime / 19.0 + 0.37);
        vec2 mPos = vec2(mix(1.2, -0.25, mCycle) * uSize.x, uSize.y * 0.58 + sin(uTime * 0.55) * 0.45);
        vec2 mq = (p - mPos) / vec2(uSize.x * 0.065, uSize.y * 0.022);
        float wing = 1.0 - smoothstep(0.25, 1.0, length(mq + vec2(0.0, sin(uTime * 2.4 + mq.x * 2.0) * 0.18)));
        col *= 1.0 - 0.42 * wing;

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
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.name = 'abyss-backdrop';
  mesh.userData['skipGtao'] = true;
  return { mesh, uniforms };
}
