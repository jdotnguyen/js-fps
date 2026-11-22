import * as THREE from 'three';
import { WATER_JUNK_KINDS } from '../../data/types/level.ts';
import type { WaterSurfaceUniforms } from './surface.ts';

/**
 * Junk floating on standing water (flooded-tunnel spec "The tunnel looks long-flooded", overhaul-flooded-tunnel task
 * 3.9): paper, a hard hat, a glove, cups and oil sheen. Each item sits at the water's level and its vertices ride the
 * ripple simulation's heights (read in the vertex shader), so it bobs and tilts as waves pass and lies still on calm
 * water, with a faint idle drift. No physics: moving debris that collides waits for the physics engine.
 */

export const JUNK_KINDS = WATER_JUNK_KINDS;
export type JunkKind = (typeof JUNK_KINDS)[number];

export interface JunkItem {
  kind: JunkKind;
  /** World x, z. */
  at: readonly [number, number];
  /** Yaw in degrees. */
  rot?: number;
  scale?: number;
}

const VERT_PARS = /* glsl */ `
uniform float uTime;
uniform sampler2D uRipple;
uniform float uRippleOn;
uniform vec4 uRippleBounds;
float junkRipple(vec2 p) {
  if (uRippleOn < 0.5) return 0.0;
  return texture2D(uRipple, (p - uRippleBounds.xy) / uRippleBounds.zw).r;
}`;

const VERT_MAIN = /* glsl */ `
{
  vec2 jw = (modelMatrix * vec4(transformed, 1.0)).xz;
  vec2 jc = modelMatrix[3].xz;
  float drift = 0.004 * sin(uTime * 1.3 + jc.x * 3.1 + jc.y * 1.7);
  // The whole item rides the height under its middle; each vertex adds its own wave, so flat things flex.
  transformed.y += junkRipple(jc) * 0.7 + junkRipple(jw) * 0.3 + drift;
}`;

/** Where the junk patch goes (`junk.test.ts` checks each exists). */
export const JUNK_ANCHORS = { vertexPars: '#include <common>', vertexMain: '#include <begin_vertex>' } as const;

export function patchJunkShader(shader: { vertexShader: string; uniforms: Record<string, THREE.IUniform> }, u: WaterSurfaceUniforms): void {
  shader.uniforms['uTime'] = u.uTime;
  shader.uniforms['uRipple'] = u.uRipple;
  shader.uniforms['uRippleOn'] = u.uRippleOn;
  shader.uniforms['uRippleBounds'] = u.uRippleBounds;
  shader.vertexShader = shader.vertexShader
    .replace(JUNK_ANCHORS.vertexPars, `${JUNK_ANCHORS.vertexPars}\n${VERT_PARS}`)
    .replace(JUNK_ANCHORS.vertexMain, `${JUNK_ANCHORS.vertexMain}\n${VERT_MAIN}`);
}


/** Geometry and material for one kind; y = 0 is the waterline (things float mostly submerged). */
function piece(kind: JunkKind): { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial } {
  switch (kind) {
    case 'paper': {
      const g = new THREE.PlaneGeometry(0.21, 0.3, 4, 6).rotateX(-Math.PI / 2).translate(0, 0.002, 0);
      return { geometry: g, material: new THREE.MeshStandardMaterial({ color: 0x8f8d80, roughness: 0.75, side: THREE.DoubleSide }) };
    }
    case 'hardhat': {
      const g = new THREE.SphereGeometry(0.14, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.8, 1.15);
      const brim = new THREE.CylinderGeometry(0.17, 0.17, 0.01, 18).scale(1, 1, 1.2);
      // Floats crown up, a third under.
      g.translate(0, -0.04, 0);
      brim.translate(0, -0.035, 0);
      const merged = mergeTwo(g, brim);
      return { geometry: merged, material: new THREE.MeshStandardMaterial({ color: 0xc9a316, roughness: 0.45 }) };
    }
    case 'glove': {
      const g = new THREE.BoxGeometry(0.1, 0.025, 0.24, 2, 1, 4).translate(0, 0.004, 0);
      return { geometry: g, material: new THREE.MeshStandardMaterial({ color: 0x9a4a18, roughness: 0.6 }) };
    }
    case 'cup': {
      const g = new THREE.CylinderGeometry(0.045, 0.035, 0.1, 12, 1, true).rotateZ(Math.PI / 2).translate(0, 0.01, 0);
      return { geometry: g, material: new THREE.MeshStandardMaterial({ color: 0xd8d6cc, roughness: 0.8, side: THREE.DoubleSide }) };
    }
    case 'sheen': {
      const g = new THREE.CircleGeometry(0.6, 24).rotateX(-Math.PI / 2).translate(0, 0.003, 0);
      const m = new THREE.MeshPhysicalMaterial({
        color: 0x050505,
        roughness: 0.08,
        metalness: 0,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        iridescence: 1,
        iridescenceIOR: 1.35,
        iridescenceThicknessRange: [180, 520],
      });
      return { geometry: g, material: m };
    }
  }
}

function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const ai = a.toNonIndexed();
  const bi = b.toNonIndexed();
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const x = ai.getAttribute(name);
    const y = bi.getAttribute(name);
    const arr = new Float32Array(x.array.length + y.array.length);
    arr.set(x.array as Float32Array, 0);
    arr.set(y.array as Float32Array, x.array.length);
    out.setAttribute(name, new THREE.BufferAttribute(arr, x.itemSize));
  }
  return out;
}

/** The floating junk of one water body: a group whose height follows the body's level. */
export class FloatingJunk {
  readonly group = new THREE.Group();

  constructor(items: readonly JunkItem[], uniforms: WaterSurfaceUniforms) {
    this.group.name = 'water-junk';
    const materials = new Map<JunkKind, THREE.MeshStandardMaterial>();
    for (const item of items) {
      const p = piece(item.kind);
      let m = materials.get(item.kind);
      if (!m) {
        m = p.material;
        m.name = `water-junk-${item.kind}`;
        m.onBeforeCompile = (shader) => patchJunkShader(shader, uniforms);
        m.customProgramCacheKey = () => `water-junk-${item.kind}`;
        materials.set(item.kind, m);
      } else p.material.dispose();
      const mesh = new THREE.Mesh(p.geometry, m);
      mesh.position.set(item.at[0], 0, item.at[1]);
      mesh.rotation.y = ((item.rot ?? 0) * Math.PI) / 180;
      mesh.scale.setScalar(item.scale ?? 1);
      mesh.name = `water-junk:${item.kind}`;
      mesh.renderOrder = item.kind === 'sheen' ? 3 : 0;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  /** Follow the water's level (the meshes ride the ripples in their shader). */
  update(level: number): void {
    this.group.position.y = level;
  }
}
