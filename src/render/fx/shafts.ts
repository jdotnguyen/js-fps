import * as THREE from 'three';
import { NOISE_GLSL } from './glsl.ts';
import type { ShaftUniforms } from '../lights.ts';

/**
 * Fake volumetric light shaft (ADR-0002): an open, additive frustum that is brightest
 * where it faces the viewer and fades toward the floor, with slow drifting dust noise.
 */
export function createShaft(
  topRadius: number,
  bottomRadius: number,
  height: number,
  color: THREE.ColorRepresentation,
): { mesh: THREE.Mesh; uniforms: ShaftUniforms & { uTime: { value: number } } } {
  const uniforms = {
    uIntensity: { value: 0.05 },
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(color) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewV;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewV = -mv.xyz;
        vNormalV = normalize(normalMatrix * normal);
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uIntensity;
      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewV;
      varying vec3 vWorld;
      ${NOISE_GLSL}
      void main() {
        float facing = abs(dot(normalize(vNormalV), normalize(vViewV)));
        float soft = pow(facing, 2.5);
        float fall = smoothstep(0.0, 0.9, vUv.y);
        float dust = 0.55 + 0.45 * vnoise(vec2(vWorld.x * 2.0 + vWorld.z * 1.3, vWorld.y * 1.6 - uTime * 0.25));
        gl_FragColor = vec4(uColor * soft * fall * dust * uIntensity, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(topRadius, bottomRadius, height, 28, 1, true), material);
  mesh.renderOrder = 2;
  return { mesh, uniforms };
}
