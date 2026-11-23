import * as THREE from 'three';
import { WeakRegistry } from './shadowCasters.ts';

/**
 * Soft contact shadows under characters (render-lighting "Characters are grounded", shadow-rich-rooms D8): one
 * instanced radial disc per visible body, flat on the floor under it, on every tier. It fades as the body leaves
 * the floor and weakens to a soft edge where the body already casts a real shadow.
 */

/** What a body reports for its contact shadow each frame. */
export interface ContactSample {
  /** Ground point under the body (x, z) and its lowest point's height (y, world). */
  readonly at: THREE.Vector3;
  /** Disc radius (m). */
  radius: number;
  /** True while the body casts a real shadow (within the character-shadow distance). */
  real: boolean;
}

export interface ContactBody {
  /** Fill `out` for this frame; false while the body is hidden, gone or shows no contact shadow. */
  contactShadow(out: ContactSample): boolean;
}

/** Bodies in the running world (humanoids register themselves; held weakly). */
export const contactBodies = new WeakRegistry<ContactBody>();

/** Darkness at the centre of a disc for a body standing on the floor. */
export const CONTACT_STRENGTH = 0.55;
/** Strength left under a real shadow: only the soft contact edge. */
export const CONTACT_UNDER_REAL = 0.3;
/** Fully faded once the body's lowest point is this high above the floor (m). */
export const CONTACT_FADE_HEIGHT = 0.6;
/** Beyond this camera distance (m) discs fade out over the next 10 m. */
export const CONTACT_FAR = 35;

const MAX = 64;

const VERT = /* glsl */ `
attribute float aStrength;
varying vec2 vUv;
varying float vStrength;
void main() {
  vUv = uv;
  vStrength = aStrength;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
varying vec2 vUv;
varying float vStrength;
void main() {
  float r = length(vUv * 2.0 - 1.0);
  float a = vStrength * (1.0 - smoothstep(0.1, 1.0, r));
  a *= a;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}
`;

export interface ContactUpdate {
  /** Floor height at (x, z); default 0 (deck level). */
  floorY?: (x: number, z: number) => number;
  /** Camera position, for the distance fade. */
  camera?: THREE.Vector3;
  /** True where a bound shadow light already shadows the floor (its pool of light). */
  shadowed?: (p: THREE.Vector3) => boolean;
}

/** One disc's placement and strength (tests). */
export interface ContactDisc {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  readonly strength: number;
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export class ContactShadows {
  readonly mesh: THREE.InstancedMesh;
  private readonly strength: THREE.InstancedBufferAttribute;
  private readonly sample: ContactSample = { at: new THREE.Vector3(), radius: 0, real: false };
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly list: ContactDisc[] = [];

  constructor(max = MAX) {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.strength = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    this.strength.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aStrength', this.strength);
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.name = 'contact-shadows';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 1;
    this.mesh.count = 0;
  }

  /** Discs placed by the last update (tests). */
  discs(): readonly ContactDisc[] {
    return this.list;
  }

  update(bodies: Iterable<ContactBody>, opts: ContactUpdate = {}): void {
    const max = this.strength.count;
    this.list.length = 0;
    let n = 0;
    for (const b of bodies) {
      if (n >= max) break;
      const s = this.sample;
      if (!b.contactShadow(s)) continue;
      const floor = opts.floorY ? opts.floorY(s.at.x, s.at.z) : 0;
      const lift = Math.max(0, s.at.y - floor);
      let k = CONTACT_STRENGTH * (1 - smooth(0, CONTACT_FADE_HEIGHT, lift));
      if (opts.camera) k *= 1 - smooth(CONTACT_FAR, CONTACT_FAR + 10, this.p.set(s.at.x, floor, s.at.z).distanceTo(opts.camera));
      this.p.set(s.at.x, floor + 0.01, s.at.z);
      if (s.real && opts.shadowed?.(this.p)) k = Math.min(k, CONTACT_UNDER_REAL * (1 - smooth(0, CONTACT_FADE_HEIGHT, lift)));
      if (k <= 0.005) continue;
      const d = s.radius * 2;
      this.m.compose(this.p, this.q, this.s.set(d, d, 1));
      this.mesh.setMatrixAt(n, this.m);
      this.strength.setX(n, k);
      this.list.push({ x: this.p.x, y: this.p.y, z: this.p.z, radius: s.radius, strength: k });
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.strength.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.removeFromParent();
  }
}
